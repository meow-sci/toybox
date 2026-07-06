/**
 * The compiled toybox index — the contract between the toybox-index repo's
 * build pipeline and this app.
 *
 * Source of truth: human-authored TOML under `mods/<id>/` in the
 * meow-sci/toybox-index repo, compiled by CI into:
 *
 *   v1/index.json                      — everything below except per-file manifests
 *   v1/manifests/<id>/<version>.<artifactKey>.json — ArtifactManifest, fetched on demand
 *
 * Design notes:
 * - `id` is the canonical StarMap ModId == the mod folder name under mods/
 *   == mod.toml `name`. Everything keys on it (StarMap matches dependencies
 *   purely by this string; toybox layers the version model on top).
 * - Every artifact carries the release-asset sha256 (GitHub publishes asset
 *   digests; CI re-verifies by downloading) and a per-file manifest so the
 *   installer can verify streams as they are written, adopt manual installs
 *   by content match, and detect user-modified files before upgrades.
 */

export type Platform = 'windows' | 'linux' | 'macos'
export const ALL_PLATFORMS: readonly Platform[] = ['windows', 'linux', 'macos']

export interface ToyboxIndex {
  schema: 1
  generatedAt: string
  /** Repo+commit the index was compiled from, for provenance display. */
  source?: { repository: string; commit: string }
  mods: CatalogMod[]
}

export interface CatalogMod {
  id: string
  name: string
  summary: string
  authors: string[]
  license?: string
  repository?: string
  homepage?: string
  tags: string[]
  /** GitHub logins allowed to self-publish releases (governance metadata). */
  owners: string[]
  /**
   * Index-relative path of the mod's markdown readme (convention:
   * `mods/<slug>/readme.md`). Fetched on demand — never inlined, so the
   * central index stays small no matter how large the catalog grows.
   */
  readmePath?: string
  /** Sorted newest-first by semver. */
  releases: CatalogRelease[]
}

export interface CatalogRelease {
  version: string
  channel: 'stable' | 'prerelease'
  publishedAt?: string
  /** KSA game-version compatibility range (build counter ignored), e.g. ">=2026.7". */
  ksa?: string
  /** Release notes markdown. */
  notes?: string
  dependencies: CatalogDependency[]
  conflicts: CatalogConflict[]
  artifacts: CatalogArtifact[]
}

export interface CatalogDependency {
  id: string
  /** Semver range; "*" = any. */
  range: string
  /**
   * Mirrors StarMap's Optional flag: an optional dependency never *has* to
   * be installed, but when it is installed its version must satisfy `range`.
   */
  optional: boolean
}

export interface CatalogConflict {
  id: string
  range: string
  reason?: string
}

export interface CatalogArtifact {
  /** Stable key within the release, e.g. "universal", "windows", "linux". */
  key: string
  platforms: Platform[]
  url: string
  /** GitHub API asset URL — the CORS-viable download path for release assets. */
  apiUrl?: string
  size: number
  sha256: string
  /** Top-level directory inside the zip that is the mod folder. */
  root: string
  /** Folder name created under mods/ — must equal the StarMap ModId. */
  installAs: string
  /** Relative URL (from the index base) of the ArtifactManifest JSON. */
  manifest?: string
  fileCount?: number
  installSize?: number
}

/** Per-file manifest of one artifact; paths relative to the install dir. */
export interface ArtifactManifest {
  schema: 1
  modId: string
  version: string
  artifactKey: string
  sha256: string
  files: ManifestFile[]
}

export interface ManifestFile {
  path: string
  size: number
  sha256: string
}

// ---------------------------------------------------------------------------
// Runtime validation (the index is remote input — never trust it blindly)
// ---------------------------------------------------------------------------

export class IndexValidationError extends Error {
  constructor(message: string) {
    super(`Invalid index: ${message}`)
    this.name = 'IndexValidationError'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new IndexValidationError(`${what} must be a string`)
  return v
}
function optStr(v: unknown, what: string): string | undefined {
  if (v === undefined || v === null) return undefined
  return str(v, what)
}
function strArray(v: unknown, what: string): string[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new IndexValidationError(`${what} must be an array`)
  return v.map((x, i) => str(x, `${what}[${i}]`))
}
function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new IndexValidationError(`${what} must be a number`)
  }
  return v
}

const MOD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/
const SHA256_RE = /^[0-9a-f]{64}$/

export function validateModId(id: string): string {
  if (!MOD_ID_RE.test(id)) throw new IndexValidationError(`bad mod id "${id}"`)
  return id
}

function validateSha256(v: unknown, what: string): string {
  const s = str(v, what)
    .toLowerCase()
    .replace(/^sha256:/, '')
  if (!SHA256_RE.test(s)) throw new IndexValidationError(`${what} is not a sha256 hex digest`)
  return s
}

function validatePlatforms(v: unknown, what: string): Platform[] {
  const arr = strArray(v, what)
  if (arr.length === 0 || arr.includes('*')) return [...ALL_PLATFORMS]
  for (const p of arr) {
    if (!ALL_PLATFORMS.includes(p as Platform)) {
      throw new IndexValidationError(`${what}: unknown platform "${p}"`)
    }
  }
  return arr as Platform[]
}

export function parseIndex(json: unknown): ToyboxIndex {
  if (!isRecord(json)) throw new IndexValidationError('root must be an object')
  if (json.schema !== 1) throw new IndexValidationError(`unsupported schema ${String(json.schema)}`)
  if (!Array.isArray(json.mods)) throw new IndexValidationError('mods must be an array')
  const seen = new Set<string>()
  const mods = json.mods.map((m, i) => {
    const mod = parseMod(m, `mods[${i}]`)
    const key = mod.id.toLowerCase()
    if (seen.has(key)) throw new IndexValidationError(`duplicate mod id "${mod.id}"`)
    seen.add(key)
    return mod
  })
  const source = isRecord(json.source)
    ? {
        repository: str(json.source.repository, 'source.repository'),
        commit: str(json.source.commit, 'source.commit'),
      }
    : undefined
  return {
    schema: 1,
    generatedAt: str(json.generatedAt ?? '', 'generatedAt'),
    ...(source ? { source } : {}),
    mods,
  }
}

function parseMod(v: unknown, what: string): CatalogMod {
  if (!isRecord(v)) throw new IndexValidationError(`${what} must be an object`)
  const id = validateModId(str(v.id, `${what}.id`))
  if (!Array.isArray(v.releases))
    throw new IndexValidationError(`${what}.releases must be an array`)
  const releases = v.releases.map((r, i) => parseRelease(r, `${what}.releases[${i}]`, id))
  return {
    id,
    name: str(v.name ?? id, `${what}.name`),
    summary: str(v.summary ?? '', `${what}.summary`),
    authors: strArray(v.authors, `${what}.authors`),
    ...(optStr(v.license, `${what}.license`) !== undefined ? { license: v.license as string } : {}),
    ...(optStr(v.repository, `${what}.repository`) !== undefined
      ? { repository: v.repository as string }
      : {}),
    ...(optStr(v.homepage, `${what}.homepage`) !== undefined
      ? { homepage: v.homepage as string }
      : {}),
    tags: strArray(v.tags, `${what}.tags`),
    owners: strArray(v.owners, `${what}.owners`),
    ...(optStr(v.readmePath, `${what}.readmePath`) !== undefined
      ? { readmePath: v.readmePath as string }
      : {}),
    releases,
  }
}

function parseRelease(v: unknown, what: string, modId: string): CatalogRelease {
  if (!isRecord(v)) throw new IndexValidationError(`${what} must be an object`)
  const version = str(v.version, `${what}.version`)
  const channel = v.channel === 'prerelease' ? 'prerelease' : 'stable'
  const deps = Array.isArray(v.dependencies)
    ? v.dependencies.map((d, i) => parseDependency(d, `${what}.dependencies[${i}]`))
    : []
  const conflicts = Array.isArray(v.conflicts)
    ? v.conflicts.map((c, i) => parseConflict(c, `${what}.conflicts[${i}]`))
    : []
  if (!Array.isArray(v.artifacts) || v.artifacts.length === 0) {
    throw new IndexValidationError(`${what}.artifacts must be a non-empty array`)
  }
  const artifacts = v.artifacts.map((a, i) => parseArtifact(a, `${what}.artifacts[${i}]`, modId))
  const keys = new Set<string>()
  for (const a of artifacts) {
    if (keys.has(a.key))
      throw new IndexValidationError(`${what}: duplicate artifact key "${a.key}"`)
    keys.add(a.key)
  }
  return {
    version,
    channel,
    ...(optStr(v.publishedAt, `${what}.publishedAt`) !== undefined
      ? { publishedAt: v.publishedAt as string }
      : {}),
    ...(optStr(v.ksa, `${what}.ksa`) !== undefined ? { ksa: v.ksa as string } : {}),
    ...(optStr(v.notes, `${what}.notes`) !== undefined ? { notes: v.notes as string } : {}),
    dependencies: deps,
    conflicts,
    artifacts,
  }
}

function parseDependency(v: unknown, what: string): CatalogDependency {
  if (!isRecord(v)) throw new IndexValidationError(`${what} must be an object`)
  return {
    id: validateModId(str(v.id, `${what}.id`)),
    range: str(v.range ?? '*', `${what}.range`),
    optional: v.optional === true,
  }
}

function parseConflict(v: unknown, what: string): CatalogConflict {
  if (!isRecord(v)) throw new IndexValidationError(`${what} must be an object`)
  return {
    id: validateModId(str(v.id, `${what}.id`)),
    range: str(v.range ?? '*', `${what}.range`),
    ...(optStr(v.reason, `${what}.reason`) !== undefined ? { reason: v.reason as string } : {}),
  }
}

function parseArtifact(v: unknown, what: string, modId: string): CatalogArtifact {
  if (!isRecord(v)) throw new IndexValidationError(`${what} must be an object`)
  const url = str(v.url, `${what}.url`)
  if (!url.startsWith('https://')) throw new IndexValidationError(`${what}.url must be https`)
  return {
    key: str(v.key ?? 'universal', `${what}.key`),
    platforms: validatePlatforms(v.platforms, `${what}.platforms`),
    url,
    ...(optStr(v.apiUrl, `${what}.apiUrl`) !== undefined ? { apiUrl: v.apiUrl as string } : {}),
    size: num(v.size, `${what}.size`),
    sha256: validateSha256(v.sha256, `${what}.sha256`),
    root: str(v.root ?? modId, `${what}.root`),
    installAs: validateModId(str(v.installAs ?? modId, `${what}.installAs`)),
    ...(optStr(v.manifest, `${what}.manifest`) !== undefined
      ? { manifest: v.manifest as string }
      : {}),
    ...(v.fileCount !== undefined ? { fileCount: num(v.fileCount, `${what}.fileCount`) } : {}),
    ...(v.installSize !== undefined
      ? { installSize: num(v.installSize, `${what}.installSize`) }
      : {}),
  }
}

export function parseArtifactManifest(json: unknown): ArtifactManifest {
  if (!isRecord(json)) throw new IndexValidationError('manifest root must be an object')
  if (json.schema !== 1) throw new IndexValidationError('unsupported manifest schema')
  if (!Array.isArray(json.files)) throw new IndexValidationError('manifest.files must be an array')
  const files = json.files.map((f, i) => {
    if (!isRecord(f)) throw new IndexValidationError(`files[${i}] must be an object`)
    const path = str(f.path, `files[${i}].path`)
    if (path.startsWith('/') || path.split('/').some((s) => s === '..' || s === '')) {
      throw new IndexValidationError(`files[${i}].path is not a clean relative path`)
    }
    return {
      path,
      size: num(f.size, `files[${i}].size`),
      sha256: validateSha256(f.sha256, `files[${i}].sha256`),
    }
  })
  return {
    schema: 1,
    modId: str(json.modId, 'manifest.modId'),
    version: str(json.version, 'manifest.version'),
    artifactKey: str(json.artifactKey ?? 'universal', 'manifest.artifactKey'),
    sha256: validateSha256(json.sha256, 'manifest.sha256'),
    files,
  }
}
