/**
 * Mods-folder scanning: reconciling what is on disk with what toybox
 * manages and what the index knows.
 *
 * Players sometimes install mods by hand (download zip, extract into
 * mods/). toybox embraces that instead of fighting it:
 *
 *  - a managed folder is re-checked against its recorded file list
 *    (existence + size quickly; full sha256 via verify());
 *  - an unmanaged folder with a mod.toml is matched against the index by
 *    folder name / mod.toml name, and against release file manifests by
 *    path+size (cheap) — an exact content match makes it ADOPTABLE, i.e.
 *    toybox can take over management without reinstalling;
 *  - checksum mismatches on a recognized mod are surfaced as warnings;
 *  - anything unrecognized is listed as unmanaged and never touched.
 */

import type {
  ArtifactManifest,
  CatalogArtifact,
  CatalogMod,
  CatalogRelease,
  ToyboxIndex,
} from '../catalog/types.ts'
import type { ToyDir } from '../fs/types.ts'
import { fileAtPath, listFilesRecursive, pathExists, readTextIfExists } from '../fs/types.ts'
import { sha256HexOfStream } from '../install/hash.ts'
import { TOYBOX_DIR } from '../state/store.ts'
import type { InstalledFile, InstalledMod, ToyboxState } from '../state/types.ts'
import { parse as parseToml } from 'smol-toml'

export interface ScanResult {
  managed: ManagedScan[]
  foreign: ForeignScan[]
}

export interface ManagedScan {
  installed: InstalledMod
  status: 'ok' | 'incomplete' | 'modified' | 'missing'
  /** Paths with problems (missing or size-changed). */
  problems: string[]
}

export interface ForeignScan {
  folder: string
  /** Parsed identity from the folder's mod.toml, when present. */
  modToml: { name?: string; version?: string; description?: string } | null
  /** The catalog mod this folder appears to be, when recognizable. */
  catalogMod: CatalogMod | null
  status: 'adoptable' | 'recognized-modified' | 'recognized-unverified' | 'unknown'
  /** Candidate (release, artifact) matches ordered best-first. */
  candidates: AdoptionCandidate[]
  fileCount: number
}

export interface AdoptionCandidate {
  release: CatalogRelease
  artifact: CatalogArtifact
  /** path+size comparison verdict (hashes are checked at adopt time). */
  match: 'exact' | 'partial'
  matchedFiles: number
  totalManifestFiles: number
  extraFiles: string[]
  missingFiles: string[]
  changedFiles: string[]
}

export interface ScanOptions {
  /** Fetch a release artifact's file manifest (null = unavailable). */
  manifestFor: (artifact: CatalogArtifact) => Promise<ArtifactManifest | null>
}

export async function scanModsDir(
  modsDir: ToyDir,
  state: ToyboxState,
  index: ToyboxIndex | null,
  opts: ScanOptions,
): Promise<ScanResult> {
  const managed: ManagedScan[] = []
  const foreign: ForeignScan[] = []
  const managedDirs = new Map<string, InstalledMod>()
  for (const mod of Object.values(state.mods)) {
    managedDirs.set(mod.installDir.toLowerCase(), mod)
  }

  const presentDirs: string[] = []
  for await (const entry of modsDir.entries()) {
    if (entry.kind !== 'dir') continue
    if (entry.name === TOYBOX_DIR) continue
    presentDirs.push(entry.name)
  }

  for (const mod of Object.values(state.mods)) {
    managed.push(await checkManaged(modsDir, mod))
  }

  for (const folder of presentDirs) {
    if (managedDirs.has(folder.toLowerCase())) continue
    foreign.push(await inspectForeign(modsDir, folder, index, opts))
  }

  return { managed, foreign }
}

async function checkManaged(modsDir: ToyDir, mod: InstalledMod): Promise<ManagedScan> {
  if ((await pathExists(modsDir, mod.installDir)) !== 'dir') {
    return { installed: mod, status: 'missing', problems: ['(folder deleted)'] }
  }
  const problems: string[] = []
  let missing = 0
  for (const f of mod.files) {
    const full = `${mod.installDir}/${f.path}`
    if ((await pathExists(modsDir, full)) !== 'file') {
      problems.push(`${f.path} (missing)`)
      missing++
      continue
    }
    const file = await fileAtPath(modsDir, full)
    if ((await file.size()) !== f.size) problems.push(`${f.path} (size changed)`)
  }
  const status: ManagedScan['status'] =
    problems.length === 0
      ? 'ok'
      : missing === mod.files.length
        ? 'missing'
        : missing > 0
          ? 'incomplete'
          : 'modified'
  return { installed: mod, status, problems }
}

async function inspectForeign(
  modsDir: ToyDir,
  folder: string,
  index: ToyboxIndex | null,
  opts: ScanOptions,
): Promise<ForeignScan> {
  const dir = await modsDir.getDir(folder)
  const tomlText = await readTextIfExists(modsDir, `${folder}/mod.toml`)
  let modToml: ForeignScan['modToml'] = null
  if (tomlText !== null) {
    try {
      const parsed = parseToml(tomlText) as Record<string, unknown>
      modToml = {
        ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
        ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
        ...(typeof parsed.description === 'string' ? { description: parsed.description } : {}),
      }
    } catch {
      modToml = null
    }
  }

  const filePaths = await listFilesRecursive(dir)
  const fileCount = filePaths.length

  // Identity: the StarMap ModId is the folder name (mod.toml name should
  // match); look the mod up by either.
  const catalogMod =
    index?.mods.find(
      (m) =>
        m.id.toLowerCase() === folder.toLowerCase() ||
        (modToml?.name !== undefined && m.id.toLowerCase() === modToml.name.toLowerCase()),
    ) ?? null

  if (!catalogMod) {
    return { folder, modToml, catalogMod: null, status: 'unknown', candidates: [], fileCount }
  }

  // Compare disk content (paths + sizes) against each release manifest.
  const sizes = new Map<string, number>()
  for (const p of filePaths) {
    const f = await fileAtPath(dir, p)
    sizes.set(p, await f.size())
  }

  const candidates: AdoptionCandidate[] = []
  for (const release of catalogMod.releases) {
    for (const artifact of release.artifacts) {
      if (artifact.installAs.toLowerCase() !== folder.toLowerCase()) continue
      const manifest = await opts.manifestFor(artifact).catch(() => null)
      if (!manifest) continue
      const cand = compareToManifest(sizes, manifest, release, artifact)
      candidates.push(cand)
    }
  }
  candidates.sort((a, b) => {
    if (a.match !== b.match) return a.match === 'exact' ? -1 : 1
    return b.matchedFiles - a.matchedFiles
  })

  let status: ForeignScan['status']
  if (candidates.length === 0) status = 'recognized-unverified'
  else if (candidates[0]!.match === 'exact') status = 'adoptable'
  else status = 'recognized-modified'

  return { folder, modToml, catalogMod, status, candidates, fileCount }
}

function compareToManifest(
  diskSizes: Map<string, number>,
  manifest: ArtifactManifest,
  release: CatalogRelease,
  artifact: CatalogArtifact,
): AdoptionCandidate {
  const missing: string[] = []
  const changed: string[] = []
  let matched = 0
  const manifestPaths = new Set<string>()
  for (const f of manifest.files) {
    manifestPaths.add(f.path)
    const size = diskSizes.get(f.path)
    if (size === undefined) missing.push(f.path)
    else if (size !== f.size) changed.push(f.path)
    else matched++
  }
  const extra = [...diskSizes.keys()].filter((p) => !manifestPaths.has(p))
  return {
    release,
    artifact,
    match: missing.length === 0 && changed.length === 0 && extra.length === 0 ? 'exact' : 'partial',
    matchedFiles: matched,
    totalManifestFiles: manifest.files.length,
    extraFiles: extra,
    missingFiles: missing,
    changedFiles: changed,
  }
}

// ---------------------------------------------------------------------------
// Adoption & verification (full-hash operations)
// ---------------------------------------------------------------------------

export interface AdoptionResult {
  ok: boolean
  installed?: InstalledMod
  mismatches: string[]
}

/**
 * Take over management of a manually-installed folder. Every file is hashed
 * and must match the release manifest exactly — adoption never guesses.
 */
export async function adoptFolder(
  modsDir: ToyDir,
  folder: string,
  candidate: AdoptionCandidate,
  manifest: ArtifactManifest,
  now: () => string = () => new Date().toISOString(),
): Promise<AdoptionResult> {
  const dir = await modsDir.getDir(folder)
  const mismatches: string[] = []
  const files: InstalledFile[] = []
  const byPath = new Map(manifest.files.map((f) => [f.path, f] as const))

  const diskPaths = await listFilesRecursive(dir)
  for (const p of diskPaths) {
    if (!byPath.has(p)) mismatches.push(`${p} (unexpected file)`)
  }
  for (const mf of manifest.files) {
    if (!diskPaths.includes(mf.path)) {
      mismatches.push(`${mf.path} (missing)`)
      continue
    }
    const f = await fileAtPath(dir, mf.path)
    const digest = await sha256HexOfStream(await f.stream())
    if (digest !== mf.sha256) {
      mismatches.push(`${mf.path} (content differs)`)
      continue
    }
    files.push({ path: mf.path, size: mf.size, sha256: mf.sha256 })
  }
  if (mismatches.length > 0) return { ok: false, mismatches }

  const installed: InstalledMod = {
    id: manifest.modId,
    version: manifest.version,
    artifactKey: candidate.artifact.key,
    installDir: folder,
    installedAt: now(),
    autoInstalled: false,
    source: { url: candidate.artifact.url, sha256: candidate.artifact.sha256 },
    files,
    origin: 'adopted',
  }
  return { ok: true, installed, mismatches: [] }
}

export interface VerifyResult {
  modId: string
  ok: boolean
  modified: string[]
  missing: string[]
  /** Files inside the mod folder that toybox does not manage (informational). */
  extra: string[]
}

/** Full-hash integrity check of a managed install. */
export async function verifyInstalled(modsDir: ToyDir, mod: InstalledMod): Promise<VerifyResult> {
  const modified: string[] = []
  const missing: string[] = []
  let extra: string[] = []
  if ((await pathExists(modsDir, mod.installDir)) !== 'dir') {
    return {
      modId: mod.id,
      ok: false,
      modified: [],
      missing: mod.files.map((f) => f.path),
      extra: [],
    }
  }
  const dir = await modsDir.getDir(mod.installDir)
  const disk = new Set(await listFilesRecursive(dir))
  const recorded = new Set(mod.files.map((f) => f.path))
  extra = [...disk].filter((p) => !recorded.has(p))
  for (const f of mod.files) {
    if (!disk.has(f.path)) {
      missing.push(f.path)
      continue
    }
    const file = await fileAtPath(dir, f.path)
    const digest = await sha256HexOfStream(await file.stream())
    if (digest !== f.sha256) modified.push(f.path)
  }
  return {
    modId: mod.id,
    ok: modified.length === 0 && missing.length === 0,
    modified,
    missing,
    extra,
  }
}
