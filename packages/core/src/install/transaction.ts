/**
 * Transactional install engine.
 *
 * The browser has no filesystem transactions (CKAN leans on .NET's
 * TxFileManager; we cannot), so safety comes from ordering + a journal:
 *
 *   1. STAGE   — download → verify sha256 → extract into
 *                mods/.toybox/staging/<txId>/ with per-file hashing (and
 *                per-file verification against the index manifest when one
 *                exists). The live mods tree is untouched. A crash here
 *                leaves only garbage staging to sweep.
 *   2. JOURNAL — write the full apply plan (including every staged file's
 *                path/size/sha256) and flip phase to 'applying'.
 *   3. APPLY   — delete old managed files (never unmanaged ones), then
 *                promote staged files into place, deleting each staged file
 *                after its copy so recovery is a simple "copy what remains".
 *   4. COMMIT  — write state.json, clear journal, sweep staging.
 *
 * Recovery (`recoverIfNeeded`) runs on open: a 'staging' journal is swept
 * with zero risk; an 'applying' journal is rolled FORWARD (idempotent
 * re-promotion from the journal's file lists) because at that point the old
 * files are already partially gone and forward is the only consistent
 * direction.
 */

import type {
  ArtifactManifest,
  CatalogArtifact,
  CatalogMod,
  CatalogRelease,
} from '../catalog/types.ts'
import type { ToyDir } from '../fs/types.ts'
import { deleteFileAndPrune, fileAtPath, listFilesRecursive, pathExists } from '../fs/types.ts'
import type { StateStore } from '../state/store.ts'
import type {
  InstalledFile,
  InstalledMod,
  JournalStep,
  ToyboxState,
  TransactionJournal,
} from '../state/types.ts'
import type { AcquiredArtifact } from './download.ts'
import { normalizeSha256 } from './hash.ts'
import type { ZipFileWriter } from './zip.ts'
import { extractZipStream } from './zip.ts'

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type PlannedOperation =
  | {
      kind: 'install' | 'upgrade' | 'downgrade'
      mod: CatalogMod
      release: CatalogRelease
      artifact: CatalogArtifact
      autoInstalled: boolean
      /** Present on upgrade/downgrade: what is being replaced. */
      replaces?: InstalledMod
      /**
       * Set when the target folder exists on disk but toybox does not manage
       * it. Apply refuses unless the caller confirmed overwriting.
       */
      overwritesUnmanaged: boolean
    }
  | {
      kind: 'remove'
      installed: InstalledMod
    }

export interface PlanWarning {
  modId: string
  severity: 'info' | 'warning'
  message: string
}

export interface TransactionPlan {
  operations: PlannedOperation[]
  warnings: PlanWarning[]
  totalDownloadBytes: number
}

/**
 * Inspect the live tree for hazards the resolver cannot see: unmanaged
 * folder collisions and user-modified managed files (quick size check; full
 * hashes are verified at stage time / via verify()).
 */
export async function auditPlan(
  modsDir: ToyDir,
  operations: PlannedOperation[],
): Promise<PlanWarning[]> {
  const warnings: PlanWarning[] = []
  for (const op of operations) {
    if (op.kind === 'remove') {
      const changed = await quickModifiedCheck(modsDir, op.installed)
      for (const path of changed) {
        warnings.push({
          modId: op.installed.id,
          severity: 'warning',
          message: `${op.installed.installDir}/${path} was modified after install; removing ${op.installed.id} deletes your changes`,
        })
      }
      continue
    }
    if (op.overwritesUnmanaged) {
      warnings.push({
        modId: op.mod.id,
        severity: 'warning',
        message: `mods/${op.artifact.installAs} already exists but is not managed by toybox — applying will replace its contents`,
      })
    }
    if (op.replaces) {
      const changed = await quickModifiedCheck(modsDir, op.replaces)
      for (const path of changed) {
        warnings.push({
          modId: op.mod.id,
          severity: 'warning',
          message: `${op.replaces.installDir}/${path} was modified after install; upgrading replaces it`,
        })
      }
    }
  }
  return warnings
}

async function quickModifiedCheck(modsDir: ToyDir, installed: InstalledMod): Promise<string[]> {
  const out: string[] = []
  for (const f of installed.files) {
    const full = `${installed.installDir}/${f.path}`
    if ((await pathExists(modsDir, full)) !== 'file') {
      out.push(`${f.path} (missing)`)
      continue
    }
    const file = await fileAtPath(modsDir, full)
    if ((await file.size()) !== f.size) out.push(f.path)
  }
  return out
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface ApplyCallbacks {
  acquire: (
    op: Extract<PlannedOperation, { kind: 'install' | 'upgrade' | 'downgrade' }>,
  ) => Promise<AcquiredArtifact>
  manifestFor?: (artifact: CatalogArtifact) => Promise<ArtifactManifest | null>
  onPhase?: (phase: ApplyPhase) => void
  onFileProgress?: (info: {
    modId: string
    path: string
    index: number
    total: number | null
  }) => void
}

export type ApplyPhase =
  | { step: 'staging'; modId: string; version: string }
  | { step: 'verifying'; modId: string }
  | { step: 'applying'; modId: string }
  | { step: 'finalizing' }

export class TransactionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransactionError'
  }
}

export interface ApplyResult {
  state: ToyboxState
  installed: string[]
  removed: string[]
}

export async function applyTransaction(
  modsDir: ToyDir,
  store: StateStore,
  state: ToyboxState,
  plan: TransactionPlan,
  callbacks: ApplyCallbacks,
  opts?: { allowUnmanagedOverwrite?: boolean; now?: () => string; txId?: string },
): Promise<ApplyResult> {
  const existing = await store.loadJournal()
  if (existing) {
    throw new TransactionError(
      'A previous transaction was interrupted and has not been recovered yet — run recovery first.',
    )
  }
  for (const op of plan.operations) {
    if (op.kind !== 'remove' && op.overwritesUnmanaged && !opts?.allowUnmanagedOverwrite) {
      throw new TransactionError(
        `mods/${op.artifact.installAs} exists but is unmanaged; confirm overwriting before applying.`,
      )
    }
  }

  const txId = opts?.txId ?? randomTxId()
  const now = opts?.now ?? (() => new Date().toISOString())

  // ---- Phase 1: stage ------------------------------------------------------
  const journal: TransactionJournal = {
    schema: 1,
    txId,
    startedAt: now(),
    phase: 'staging',
    steps: [],
  }
  await store.saveJournal(journal)
  const staging = await store.stagingDir(txId, { create: true })

  const steps: JournalStep[] = []
  try {
    for (const op of plan.operations) {
      if (op.kind === 'remove') {
        steps.push({
          action: 'remove',
          modId: op.installed.id,
          installDir: op.installed.installDir,
          files: op.installed.files,
        })
        continue
      }
      callbacks.onPhase?.({ step: 'staging', modId: op.mod.id, version: op.release.version })
      const acquired = await callbacks.acquire(op)
      if (normalizeSha256(acquired.sha256) !== normalizeSha256(op.artifact.sha256)) {
        throw new TransactionError(
          `Artifact for ${op.mod.id}@${op.release.version} failed verification — refusing to install.`,
        )
      }

      const destRoot = await staging.getDir(op.artifact.installAs, { create: true })
      const rootPrefix = op.artifact.root.replace(/\/+$/, '')
      let entryIndex = 0
      const total = op.artifact.fileCount ?? null
      const files = await extractZipStream(
        (acquired.blob.stream
          ? acquired.blob.stream()
          : new Response(acquired.blob).body!) as ReadableStream<Uint8Array>,
        {
          file: async (path): Promise<ZipFileWriter | null> => {
            // Only entries under the declared root become mod files; the
            // installed path strips that root prefix.
            let rel: string
            if (rootPrefix === '' || rootPrefix === '.') rel = path
            else if (path === rootPrefix) return null
            else if (path.startsWith(`${rootPrefix}/`)) rel = path.slice(rootPrefix.length + 1)
            else return null
            if (rel.length === 0) return null
            entryIndex += 1
            callbacks.onFileProgress?.({
              modId: op.mod.id,
              path: rel,
              index: entryIndex,
              total,
            })
            const f = await fileAtPath(destRoot, rel, { create: true })
            const w = await f.createWritable()
            return { write: (c) => w.write(c), close: () => w.close(), abort: () => w.abort() }
          },
        },
      )
      const installedFiles: InstalledFile[] = files
        .filter(
          (f) => f.path === rootPrefix || rootPrefix === '' || f.path.startsWith(`${rootPrefix}/`),
        )
        .map((f) => ({
          path: rootPrefix === '' ? f.path : f.path.slice(rootPrefix.length + 1),
          size: f.size,
          sha256: f.sha256,
        }))
      if (installedFiles.length === 0) {
        throw new TransactionError(
          `Artifact for ${op.mod.id}@${op.release.version} contained no files under its declared root "${op.artifact.root}" — bad index metadata.`,
        )
      }

      // Cross-check against the index's per-file manifest when available.
      callbacks.onPhase?.({ step: 'verifying', modId: op.mod.id })
      const manifest = await callbacks.manifestFor?.(op.artifact)
      if (manifest) {
        verifyAgainstManifest(op.mod.id, installedFiles, manifest)
      }

      steps.push({
        action: 'install',
        modId: op.mod.id,
        version: op.release.version,
        artifactKey: op.artifact.key,
        installDir: op.artifact.installAs,
        autoInstalled: op.autoInstalled,
        sourceUrl: op.artifact.url,
        sourceSha256: normalizeSha256(op.artifact.sha256),
        files: installedFiles,
        ...(op.replaces
          ? { replaces: { version: op.replaces.version, files: op.replaces.files } }
          : {}),
      })
    }
  } catch (e) {
    // Nothing live was touched: sweep staging and clear the journal.
    await store.removeStaging(txId).catch(() => {})
    await store.clearJournal().catch(() => {})
    throw e
  }

  // ---- Phase 2: point of no return — journal the apply plan ---------------
  journal.steps = steps
  journal.phase = 'applying'
  await store.saveJournal(journal)

  // ---- Phase 3: apply ------------------------------------------------------
  const result = await promoteSteps(modsDir, store, state, journal, callbacks)

  // ---- Phase 4: commit -----------------------------------------------------
  callbacks.onPhase?.({ step: 'finalizing' })
  await store.saveState(result.state)
  await store.clearJournal()
  await store.removeStaging(txId).catch(() => {})
  return result
}

export function verifyAgainstManifest(
  modId: string,
  files: InstalledFile[],
  manifest: ArtifactManifest,
): void {
  const expected = new Map(manifest.files.map((f) => [f.path, f] as const))
  for (const f of files) {
    const m = expected.get(f.path)
    if (!m) {
      throw new TransactionError(
        `${modId}: archive contains "${f.path}" which is not in the published file manifest — refusing to install.`,
      )
    }
    if (normalizeSha256(m.sha256) !== f.sha256 || m.size !== f.size) {
      throw new TransactionError(
        `${modId}: "${f.path}" does not match the published file manifest — refusing to install.`,
      )
    }
    expected.delete(f.path)
  }
  if (expected.size > 0) {
    const missing = [...expected.keys()].slice(0, 5).join(', ')
    throw new TransactionError(
      `${modId}: archive is missing ${expected.size} file(s) from the published manifest (${missing}…) — refusing to install.`,
    )
  }
}

/**
 * Execute the 'applying' phase from a journal. Used both by the normal apply
 * path and by crash recovery — every operation is idempotent.
 */
async function promoteSteps(
  modsDir: ToyDir,
  store: StateStore,
  state: ToyboxState,
  journal: TransactionJournal,
  callbacks: ApplyCallbacks,
): Promise<ApplyResult> {
  const nextState: ToyboxState = { ...state, schema: 1, mods: { ...state.mods } }
  const installed: string[] = []
  const removed: string[] = []
  const staging = await store.stagingDir(journal.txId, { create: true })

  for (const step of journal.steps) {
    if (step.action === 'remove') {
      callbacks.onPhase?.({ step: 'applying', modId: step.modId })
      await removeManagedFiles(modsDir, step.installDir, step.files)
      delete nextState.mods[step.modId]
      removed.push(step.modId)
      continue
    }

    callbacks.onPhase?.({ step: 'applying', modId: step.modId })
    // 1. Remove the files of the version being replaced (managed only).
    if (step.replaces) {
      await removeManagedFiles(modsDir, step.installDir, step.replaces.files)
    }
    // 2. Promote staged files. Files already promoted (recovery re-run) are
    //    gone from staging; copy whatever remains.
    const stagedRoot = await staging.getDir(step.installDir, { create: true })
    let index = 0
    for (const f of step.files) {
      index += 1
      const exists = await pathExists(stagedRoot, f.path)
      if (exists !== 'file') continue // already promoted before a crash
      callbacks.onFileProgress?.({
        modId: step.modId,
        path: f.path,
        index,
        total: step.files.length,
      })
      const src = await fileAtPath(stagedRoot, f.path)
      const dest = await fileAtPath(modsDir, `${step.installDir}/${f.path}`, { create: true })
      const w = await dest.createWritable()
      const reader = (await src.stream()).getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          await w.write(value)
        }
        await w.close()
      } catch (e) {
        await w.abort().catch(() => {})
        throw e
      }
      await deleteFileAndPrune(stagedRoot, f.path)
    }

    nextState.mods[step.modId] = {
      id: step.modId,
      version: step.version,
      artifactKey: step.artifactKey,
      installDir: step.installDir,
      installedAt: journal.startedAt,
      autoInstalled: step.autoInstalled,
      source: { url: step.sourceUrl, sha256: step.sourceSha256 },
      files: step.files,
      origin: 'index',
    }
    installed.push(step.modId)
  }

  return { state: nextState, installed, removed }
}

/**
 * Delete exactly the files toybox recorded for a mod (pruning emptied dirs),
 * then drop the install dir itself if nothing else is left in it. Files the
 * user added inside the mod folder are left alone — and keep the folder
 * alive — mirroring CKAN's "never touch unowned files" rule.
 */
async function removeManagedFiles(
  modsDir: ToyDir,
  installDir: string,
  files: readonly InstalledFile[],
): Promise<void> {
  if ((await pathExists(modsDir, installDir)) !== 'dir') return
  const root = await modsDir.getDir(installDir)
  for (const f of files) {
    await deleteFileAndPrune(root, f.path).catch(() => {})
  }
  const leftovers = await listFilesRecursive(root)
  if (leftovers.length === 0) {
    await modsDir.remove(installDir, { recursive: true })
  }
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export interface RecoveryReport {
  recovered: boolean
  action: 'none' | 'swept-staging' | 'rolled-forward'
  detail: string
  state?: ToyboxState
}

export async function recoverIfNeeded(
  modsDir: ToyDir,
  store: StateStore,
  state: ToyboxState,
  callbacks: Pick<ApplyCallbacks, 'onPhase' | 'onFileProgress'> = {},
): Promise<RecoveryReport> {
  const promoteCallbacks: ApplyCallbacks = {
    acquire: () => Promise.reject(new TransactionError('recovery never downloads')),
    ...callbacks,
  }
  const journal = await store.loadJournal()
  if (!journal) {
    // Sweep any orphan staging left by a crash before the journal existed.
    await store.removeStaging().catch(() => {})
    return { recovered: false, action: 'none', detail: 'No interrupted transaction.' }
  }
  if (journal.phase === 'staging') {
    await store.removeStaging(journal.txId).catch(() => {})
    await store.clearJournal()
    return {
      recovered: true,
      action: 'swept-staging',
      detail:
        'A previous operation was interrupted while downloading — nothing in your mods folder was touched. Cleaned up temporary files.',
    }
  }
  // 'applying': roll forward.
  const result = await promoteSteps(modsDir, store, state, journal, promoteCallbacks)
  await store.saveState(result.state)
  await store.clearJournal()
  await store.removeStaging(journal.txId).catch(() => {})
  return {
    recovered: true,
    action: 'rolled-forward',
    detail: `A previous operation was interrupted mid-apply and has been completed: ${[
      ...result.installed.map((m) => `installed ${m}`),
      ...result.removed.map((m) => `removed ${m}`),
    ].join(', ')}.`,
    state: result.state,
  }
}

function randomTxId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
