/**
 * Toybox — the headless package manager facade.
 *
 * The Svelte app (or any other frontend, or a test) drives everything
 * through this class; nothing UI-shaped lives below it and nothing
 * engine-shaped needs to live above it.
 *
 * A Toybox instance is bound to a granted directory. Two grant shapes are
 * accepted, inferred by convention:
 *   - the KSA user folder (`…/My Games/Kitten Space Agency/`), detected by a
 *     `mods` subfolder — full functionality including manifest.toml
 *     enable/disable sync;
 *   - the mods folder itself — everything except manifest sync.
 * All persistent data lives in `mods/.toybox/` on the user's disk: the app
 * is fully ephemeral and a browser wipe loses nothing.
 */

import type {
  CatalogArtifact,
  CatalogMod,
  CatalogRelease,
  Platform,
  ToyboxIndex,
} from './catalog/types.ts'
import { IndexClient } from './catalog/client.ts'
import type { ToyDir } from './fs/types.ts'
import { pathExists, readTextIfExists, fileAtPath } from './fs/types.ts'
import {
  acquireArtifact,
  verifyLocalArtifact,
  type AcquiredArtifact,
  type DownloadProgress,
} from './install/download.ts'
import type {
  ApplyPhase,
  PlanWarning,
  PlannedOperation,
  TransactionPlan,
} from './install/transaction.ts'
import {
  applyTransaction,
  auditPlan,
  recoverIfNeeded,
  type ApplyResult,
  type RecoveryReport,
} from './install/transaction.ts'
import type { ManifestEntry } from './ksa/manifest.ts'
import { parseManifest, serializeManifest, setEnabled, syncManifest } from './ksa/manifest.ts'
import { artifactForPlatform, eligibleReleases, searchMods } from './catalog/select.ts'
import { resolve, type ResolveResult, type ResolutionChange } from './resolve/resolver.ts'
import {
  adoptFolder,
  scanModsDir,
  verifyInstalled,
  type AdoptionCandidate,
  type ForeignScan,
  type ScanResult,
  type VerifyResult,
} from './scan/scan.ts'
import type { SearchResult } from './search/fuzzy.ts'
import { StateStore, TOYBOX_DIR } from './state/store.ts'
import type { InstalledMod, ToyboxSettings, ToyboxState } from './state/types.ts'
import type { ArtifactManifest } from './catalog/types.ts'

export interface ToyboxOptions {
  fetchFn?: typeof fetch
  indexUrl?: string
  platform?: Platform
  now?: () => string
}

export interface GrantInfo {
  /** What the granted folder turned out to be. */
  mode: 'ksa-root' | 'mods-only'
  /** Whether KSA manifest.toml sync is available. */
  manifestSync: boolean
}

export interface CartItem {
  id: string
  /** Specific version to install; undefined = newest compatible. */
  version?: string
}

export interface PlannedTransaction {
  resolution: Extract<ResolveResult, { ok: true }>
  plan: TransactionPlan
  changes: ResolutionChange[]
  warnings: PlanWarning[]
}

export type ApplyEvent =
  | { type: 'phase'; phase: ApplyPhase }
  | { type: 'download'; modId: string; progress: DownloadProgress }
  | { type: 'file'; modId: string; path: string; index: number; total: number | null }
  | {
      type: 'needs-local-file'
      modId: string
      artifact: CatalogArtifact
      /** Resolve with the user-picked file (verified before use) or reject to abort. */
      provide: (file: Blob) => void
      abort: (reason?: string) => void
    }

export class Toybox {
  private readonly root: ToyDir
  private modsDir!: ToyDir
  private store!: StateStore
  private stateCache: ToyboxState = { schema: 1, mods: {} }
  private settingsCache: ToyboxSettings = { schema: 1, channel: 'stable' }
  private indexCache: ToyboxIndex | null = null
  private manifestCache = new Map<string, ArtifactManifest | null>()
  private client: IndexClient
  grant: GrantInfo = { mode: 'mods-only', manifestSync: false }

  readonly platform: Platform
  private readonly fetchFn: typeof fetch
  private readonly now: () => string

  constructor(grantedDir: ToyDir, opts: ToyboxOptions = {}) {
    this.root = grantedDir
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init))
    this.platform = opts.platform ?? detectPlatform()
    this.now = opts.now ?? (() => new Date().toISOString())
    this.client = new IndexClient({
      ...(opts.indexUrl !== undefined ? { indexUrl: opts.indexUrl } : {}),
      fetchFn: this.fetchFn,
    })
  }

  /**
   * Bind to the granted folder, run crash recovery, and load state. Always
   * call (and await) this before anything else.
   */
  async open(): Promise<{ grant: GrantInfo; recovery: RecoveryReport }> {
    if ((await this.root.has('mods')) === 'dir') {
      this.grant = { mode: 'ksa-root', manifestSync: true }
      this.modsDir = await this.root.getDir('mods')
    } else {
      this.grant = { mode: 'mods-only', manifestSync: false }
      this.modsDir = this.root
    }
    this.store = new StateStore(this.modsDir)
    this.stateCache = await this.store.loadState()
    const recovery = await recoverIfNeeded(this.modsDir, this.store, this.stateCache)
    if (recovery.state) this.stateCache = recovery.state
    this.settingsCache = await this.store.loadSettings()
    if (this.settingsCache.indexUrl) {
      this.client = new IndexClient({
        indexUrl: this.settingsCache.indexUrl,
        fetchFn: this.fetchFn,
      })
    }
    return { grant: this.grant, recovery }
  }

  // -------------------------------------------------------------------------
  // State / settings
  // -------------------------------------------------------------------------

  get state(): ToyboxState {
    return this.stateCache
  }

  get settings(): ToyboxSettings {
    return this.settingsCache
  }

  async updateSettings(patch: Partial<ToyboxSettings>): Promise<ToyboxSettings> {
    this.settingsCache = { ...this.settingsCache, ...patch, schema: 1 }
    await this.store.saveSettings(this.settingsCache)
    if (patch.indexUrl !== undefined) {
      this.client = new IndexClient({
        ...(patch.indexUrl ? { indexUrl: patch.indexUrl } : {}),
        fetchFn: this.fetchFn,
      })
      this.indexCache = null
      this.manifestCache.clear()
    }
    return this.settingsCache
  }

  installedMods(): InstalledMod[] {
    return Object.values(this.stateCache.mods)
  }

  // -------------------------------------------------------------------------
  // Index
  // -------------------------------------------------------------------------

  get index(): ToyboxIndex | null {
    return this.indexCache
  }

  async refreshIndex(): Promise<ToyboxIndex> {
    this.indexCache = await this.client.fetchIndex()
    this.manifestCache.clear()
    this.readmeCache.clear()
    return this.indexCache
  }

  private requireIndex(): ToyboxIndex {
    if (!this.indexCache) throw new Error('Index not loaded — call refreshIndex() first.')
    return this.indexCache
  }

  private readmeCache = new Map<string, string | null>()

  /** Lazy-fetched, cached markdown readme for a mod (null when absent). */
  async readmeFor(mod: CatalogMod): Promise<string | null> {
    if (this.readmeCache.has(mod.id)) return this.readmeCache.get(mod.id)!
    const readme = await this.client.fetchReadme(mod).catch(() => null)
    this.readmeCache.set(mod.id, readme)
    return readme
  }

  async manifestFor(artifact: CatalogArtifact): Promise<ArtifactManifest | null> {
    const key = `${artifact.url}#${artifact.key}`
    if (this.manifestCache.has(key)) return this.manifestCache.get(key)!
    const manifest = await this.client.fetchManifest(artifact).catch(() => null)
    this.manifestCache.set(key, manifest)
    return manifest
  }

  /** Fuzzy search across id/name/summary/tags/authors. */
  search(query: string): SearchResult<CatalogMod>[] {
    return searchMods(this.requireIndex().mods, query)
  }

  /** Releases of a mod eligible for this platform, newest first. */
  eligibleReleases(mod: CatalogMod): CatalogRelease[] {
    return eligibleReleases(mod, this.platform)
  }

  artifactFor(release: CatalogRelease): CatalogArtifact | null {
    return artifactForPlatform(release, this.platform)
  }

  // -------------------------------------------------------------------------
  // Plan / apply (the transactional cart)
  // -------------------------------------------------------------------------

  /**
   * Resolve a cart into a reviewable transaction: the full dependency
   * solution, the concrete operations, and every warning (unmanaged
   * collisions, user-modified files, optional-dep version skew).
   */
  async plan(cart: {
    install?: CartItem[]
    remove?: string[]
    policy?: 'keep' | 'upgrade'
  }): Promise<PlannedTransaction | Extract<ResolveResult, { ok: false }>> {
    const index = this.requireIndex()
    const installed: Record<string, { version: string; autoInstalled: boolean }> = {}
    for (const m of this.installedMods()) {
      installed[m.id] = { version: m.version, autoInstalled: m.autoInstalled }
    }
    const resolution = resolve(index, {
      install: (cart.install ?? []).map((c) => ({
        id: c.id,
        ...(c.version !== undefined ? { range: `=${c.version}` } : {}),
      })),
      remove: cart.remove ?? [],
      installed,
      policy: cart.policy ?? 'keep',
      includePrerelease: this.settingsCache.channel === 'prerelease',
      platform: this.platform,
      ...(this.settingsCache.ksaVersion !== undefined
        ? { ksaVersion: this.settingsCache.ksaVersion }
        : {}),
    })
    if (!resolution.ok) return resolution

    const operations: PlannedOperation[] = []
    let totalDownloadBytes = 0
    for (const change of resolution.changes) {
      if (change.kind === 'remove') {
        const cur = this.stateCache.mods[change.id]
        if (cur) operations.push({ kind: 'remove', installed: cur })
        continue
      }
      const mod = index.mods.find((m) => m.id === change.id)!
      const version = change.kind === 'install' ? change.version : change.to
      const release = mod.releases.find((r) => r.version === version)!
      const artifact = this.artifactFor(release)
      if (!artifact) {
        throw new Error(`No ${this.platform} artifact for ${mod.id}@${version}`)
      }
      const replaces = this.stateCache.mods[change.id]
      const unmanagedCollision =
        !replaces && (await pathExists(this.modsDir, artifact.installAs)) === 'dir'
      totalDownloadBytes += artifact.size
      operations.push({
        kind: change.kind,
        mod,
        release,
        artifact,
        autoInstalled: resolution.target[mod.id]?.autoInstalled ?? false,
        ...(replaces ? { replaces } : {}),
        overwritesUnmanaged: unmanagedCollision,
      })
    }

    const warnings = await auditPlan(this.modsDir, operations)
    return {
      resolution,
      plan: { operations, warnings, totalDownloadBytes },
      changes: resolution.changes,
      warnings,
    }
  }

  /**
   * Apply a reviewed plan. Emits progress events; when a network download is
   * impossible (CORS/rate limits) it emits `needs-local-file` so the UI can
   * hand over a user-downloaded file — verified exactly like a fetched one.
   */
  async apply(
    planned: PlannedTransaction,
    onEvent: (e: ApplyEvent) => void = () => {},
    opts?: { allowUnmanagedOverwrite?: boolean; signal?: AbortSignal },
  ): Promise<ApplyResult> {
    const result = await applyTransaction(
      this.modsDir,
      this.store,
      this.stateCache,
      planned.plan,
      {
        acquire: async (op) => this.acquire(op.mod.id, op.artifact, onEvent, opts?.signal),
        manifestFor: (artifact) => this.manifestFor(artifact),
        onPhase: (phase) => onEvent({ type: 'phase', phase }),
        onFileProgress: (info) => onEvent({ type: 'file', ...info }),
      },
      {
        ...(opts?.allowUnmanagedOverwrite !== undefined
          ? { allowUnmanagedOverwrite: opts.allowUnmanagedOverwrite }
          : {}),
        now: this.now,
      },
    )
    this.stateCache = result.state
    await this.syncKsaManifest().catch(() => {})
    return result
  }

  private async acquire(
    modId: string,
    artifact: CatalogArtifact,
    onEvent: (e: ApplyEvent) => void,
    signal?: AbortSignal,
  ): Promise<AcquiredArtifact> {
    try {
      return await acquireArtifact(artifact, {
        fetchFn: this.fetchFn,
        ...(artifact.mirror
          ? { mirrorUrl: this.client.resolveIndexRelative(artifact.mirror) }
          : {}),
        ...(this.settingsCache.githubToken !== undefined
          ? { githubToken: this.settingsCache.githubToken }
          : {}),
        onProgress: (progress) => onEvent({ type: 'download', modId, progress }),
        ...(signal ? { signal } : {}),
      })
    } catch (e) {
      if (
        (e as { kind?: string }).kind === 'checksum' ||
        (e as { kind?: string }).kind === 'aborted'
      ) {
        throw e
      }
      // Network path failed — ask the UI for a locally-downloaded file.
      const file = await new Promise<Blob>((resolvePromise, rejectPromise) => {
        onEvent({
          type: 'needs-local-file',
          modId,
          artifact,
          provide: resolvePromise,
          abort: (reason) => rejectPromise(new Error(reason ?? 'Install cancelled')),
        })
      })
      return verifyLocalArtifact(artifact, file)
    }
  }

  // -------------------------------------------------------------------------
  // Scan / adopt / verify
  // -------------------------------------------------------------------------

  async scan(): Promise<ScanResult> {
    return scanModsDir(this.modsDir, this.stateCache, this.indexCache, {
      manifestFor: (artifact) => this.manifestFor(artifact),
    })
  }

  /** Adopt a foreign folder as a managed install (exact content match only). */
  async adopt(
    scanEntry: ForeignScan,
    candidate: AdoptionCandidate,
  ): Promise<{ ok: boolean; mismatches: string[] }> {
    const manifest = await this.manifestFor(candidate.artifact)
    if (!manifest) return { ok: false, mismatches: ['No file manifest available for this release'] }
    const result = await adoptFolder(this.modsDir, scanEntry.folder, candidate, manifest, this.now)
    if (result.ok && result.installed) {
      this.stateCache = {
        schema: 1,
        mods: { ...this.stateCache.mods, [result.installed.id]: result.installed },
      }
      await this.store.saveState(this.stateCache)
    }
    return { ok: result.ok, mismatches: result.mismatches }
  }

  /** Release a mod from management without touching its files. */
  async forget(modId: string): Promise<void> {
    const mods = { ...this.stateCache.mods }
    delete mods[modId]
    this.stateCache = { schema: 1, mods }
    await this.store.saveState(this.stateCache)
  }

  async verify(modId: string): Promise<VerifyResult> {
    const mod = this.stateCache.mods[modId]
    if (!mod) throw new Error(`${modId} is not managed by toybox`)
    return verifyInstalled(this.modsDir, mod)
  }

  // -------------------------------------------------------------------------
  // KSA manifest.toml (enable/disable) — ksa-root grants only
  // -------------------------------------------------------------------------

  async readKsaManifest(): Promise<ManifestEntry[] | null> {
    if (!this.grant.manifestSync) return null
    const text = await readTextIfExists(this.root, 'manifest.toml')
    return text === null ? [] : parseManifest(text)
  }

  /**
   * Reconcile manifest.toml with the folders on disk: adds entries for new
   * folders (enabled), prunes entries toybox added whose folders were
   * removed, never flips an existing enabled flag. Which entries toybox
   * "owns" is tracked in state (manifestOwned) so entries the game or the
   * player wrote are never pruned.
   */
  async syncKsaManifest(): Promise<{ added: string[]; removed: string[] } | null> {
    if (!this.grant.manifestSync) return null
    const entries = (await this.readKsaManifest()) ?? []
    const present: string[] = []
    for await (const entry of this.modsDir.entries()) {
      if (entry.kind === 'dir' && entry.name !== TOYBOX_DIR) {
        if ((await pathExists(this.modsDir, `${entry.name}/mod.toml`)) === 'file') {
          present.push(entry.name)
        }
      }
    }
    const owned = new Set(this.stateCache.manifestOwned ?? [])
    for (const m of Object.values(this.stateCache.mods)) owned.add(m.installDir)
    const result = syncManifest(entries, present, [...owned])
    if (result.changed) {
      const f = await fileAtPath(this.root, 'manifest.toml', { create: true })
      await f.write(serializeManifest(result.entries))
    }
    for (const added of result.added) owned.add(added)
    for (const removed of result.removed) owned.delete(removed)
    const nextOwned = [...owned].sort()
    const prevOwned = [...(this.stateCache.manifestOwned ?? [])].sort()
    if (JSON.stringify(nextOwned) !== JSON.stringify(prevOwned)) {
      this.stateCache = { ...this.stateCache, manifestOwned: nextOwned }
      await this.store.saveState(this.stateCache)
    }
    return { added: result.added, removed: result.removed }
  }

  async setModEnabled(id: string, enabled: boolean): Promise<void> {
    if (!this.grant.manifestSync) {
      throw new Error(
        'Enable/disable needs access to the Kitten Space Agency folder (the parent of mods/), which contains manifest.toml.',
      )
    }
    const entries = (await this.readKsaManifest()) ?? []
    const f = await fileAtPath(this.root, 'manifest.toml', { create: true })
    await f.write(serializeManifest(setEnabled(entries, id, enabled)))
  }
}

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'windows'
  const ua = navigator.userAgent
  if (/Mac/i.test(ua)) return 'macos'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return 'windows'
}
