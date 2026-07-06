/**
 * Semantic-version parsing, comparison, and cargo-style range matching.
 *
 * toybox layers a real version model on top of StarMap (which is
 * version-agnostic at load time: dependencies are matched purely by ModId).
 * The grammar deliberately follows cargo/npm conventions publishers already
 * know: `^1.2`, `~1.2.3`, `>=1.0 <2.0`, `1.x`, exact versions, and `||`
 * alternatives.
 *
 * Prerelease ordering follows the semver 2.0 spec. Loose inputs like `1.2`
 * are accepted as versions (missing components default to 0) because mod
 * authors are not always strict.
 */

export interface SemVer {
  major: number
  minor: number
  patch: number
  /** Dot-separated prerelease identifiers, e.g. ['tip', '20260703']. Empty = release. */
  prerelease: readonly (string | number)[]
  /** Original string as parsed (without build metadata). */
  raw: string
}

const VERSION_RE =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** Parse a version string. Returns null when it is not a recognizable semver. */
export function tryParseVersion(input: string): SemVer | null {
  const m = VERSION_RE.exec(input.trim())
  if (!m) return null
  const prerelease = (m[4] ?? '')
    .split('.')
    .filter((s) => s.length > 0)
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s))
  return {
    major: Number(m[1]),
    minor: Number(m[2] ?? 0),
    patch: Number(m[3] ?? 0),
    prerelease,
    raw: input.trim().replace(/^v/, ''),
  }
}

export function parseVersion(input: string): SemVer {
  const v = tryParseVersion(input)
  if (!v) throw new Error(`Invalid version: "${input}"`)
  return v
}

/** semver precedence: -1 | 0 | 1. Build metadata is ignored. */
export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePrerelease(a.prerelease, b.prerelease)
}

function comparePrerelease(
  a: readonly (string | number)[],
  b: readonly (string | number)[],
): number {
  if (a.length === 0 && b.length === 0) return 0
  // A release version has higher precedence than any of its prereleases.
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i]
    const bi = b[i]
    // Shorter list sorts first when all preceding identifiers are equal.
    if (ai === undefined) return -1
    if (bi === undefined) return 1
    if (ai === bi) continue
    const aNum = typeof ai === 'number'
    const bNum = typeof bi === 'number'
    // Numeric identifiers always have lower precedence than alphanumeric.
    if (aNum && !bNum) return -1
    if (!aNum && bNum) return 1
    return ai < bi ? -1 : 1
  }
  return 0
}

export function compareVersionStrings(a: string, b: string): number {
  return compareVersions(parseVersion(a), parseVersion(b))
}

export function isPrerelease(v: SemVer): boolean {
  return v.prerelease.length > 0
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

type Op = '>=' | '<=' | '>' | '<' | '='

interface Comparator {
  op: Op
  version: SemVer
}

/** One `||` alternative: every comparator must hold (AND). */
interface Conjunction {
  comparators: Comparator[]
  /**
   * Prereleases only satisfy a conjunction when one of its comparators
   * mentions a prerelease of the same major.minor.patch (npm semantics), or
   * when matching is done with includePrerelease.
   */
  prereleaseAnchors: SemVer[]
}

export interface VersionRange {
  raw: string
  alternatives: Conjunction[]
}

/** `*` / empty — matches every release version. */
export function anyRange(): VersionRange {
  return { raw: '*', alternatives: [{ comparators: [], prereleaseAnchors: [] }] }
}

/**
 * Parse a range expression. Grammar (whitespace = AND, `||` = OR):
 *   `*` | `1.2.3` (exact) | `^1.2.3` | `~1.2.3` | `>=1.2 <2` | `1.x` | `1.2.x`
 */
export function parseRange(input: string): VersionRange {
  const raw = input.trim()
  if (raw === '' || raw === '*') return anyRange()
  const alternatives = raw.split('||').map((alt) => parseConjunction(alt.trim(), raw))
  return { raw, alternatives }
}

export function tryParseRange(input: string): VersionRange | null {
  try {
    return parseRange(input)
  } catch {
    return null
  }
}

function parseConjunction(alt: string, whole: string): Conjunction {
  if (alt === '' || alt === '*') return { comparators: [], prereleaseAnchors: [] }
  const comparators: Comparator[] = []
  const anchors: SemVer[] = []
  // Hyphen ranges: `1.2.3 - 2.0.0`
  const hyphen = /^([^\s]+)\s+-\s+([^\s]+)$/.exec(alt)
  const parts = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : alt.split(/\s+/)
  for (const part of parts) {
    for (const c of parsePart(part, whole)) {
      comparators.push(c)
      if (c.version.prerelease.length > 0) anchors.push(c.version)
    }
  }
  return { comparators, prereleaseAnchors: anchors }
}

function parsePart(part: string, whole: string): Comparator[] {
  const opMatch = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(part)
  if (!opMatch) throw new Error(`Invalid range: "${whole}"`)
  const op = opMatch[1] ?? ''
  const rest = opMatch[2] ?? ''

  // Wildcard forms: 1.x / 1.2.x / 1.* — only valid without an operator.
  const wild = /^(\d+)(?:\.(\d+))?\.[x*]$/.exec(rest)
  if (wild && (op === '' || op === '=')) {
    const major = Number(wild[1])
    if (wild[2] === undefined) {
      return rangeGte(major, 0, 0, major + 1, 0, 0)
    }
    const minor = Number(wild[2])
    return rangeGte(major, minor, 0, major, minor + 1, 0)
  }

  const v = tryParseVersion(rest)
  if (!v) throw new Error(`Invalid range: "${whole}" (bad version "${rest}")`)

  switch (op) {
    case '':
    case '=': {
      // Partial versions without an operator behave like wildcards: `1.2` == `1.2.x`.
      const dots = rest.replace(/^v/, '').split('-')[0]!.split('.').length
      if (v.prerelease.length === 0 && dots === 1) {
        return rangeGte(v.major, 0, 0, v.major + 1, 0, 0)
      }
      if (v.prerelease.length === 0 && dots === 2) {
        return rangeGte(v.major, v.minor, 0, v.major, v.minor + 1, 0)
      }
      return [{ op: '=', version: v }]
    }
    case '^': {
      // Caret: compatible within the leftmost non-zero component (cargo default).
      if (v.major > 0) return [gte(v), lt(v.major + 1, 0, 0)]
      if (v.minor > 0) return [gte(v), lt(0, v.minor + 1, 0)]
      return [gte(v), lt(0, 0, v.patch + 1)]
    }
    case '~': {
      // Tilde: patch-level changes allowed.
      return [gte(v), lt(v.major, v.minor + 1, 0)]
    }
    default:
      return [{ op: op as Op, version: v }]
  }
}

function gte(v: SemVer): Comparator {
  return { op: '>=', version: v }
}
function lt(major: number, minor: number, patch: number): Comparator {
  return {
    op: '<',
    version: { major, minor, patch, prerelease: [], raw: `${major}.${minor}.${patch}` },
  }
}
function rangeGte(
  aMaj: number,
  aMin: number,
  aPat: number,
  bMaj: number,
  bMin: number,
  bPat: number,
): Comparator[] {
  return [
    gte({ major: aMaj, minor: aMin, patch: aPat, prerelease: [], raw: `${aMaj}.${aMin}.${aPat}` }),
    lt(bMaj, bMin, bPat),
  ]
}

function testComparator(v: SemVer, c: Comparator): boolean {
  const cmp = compareVersions(v, c.version)
  switch (c.op) {
    case '=':
      return cmp === 0
    case '>':
      return cmp > 0
    case '>=':
      return cmp >= 0
    case '<':
      return cmp < 0
    case '<=':
      return cmp <= 0
  }
}

export interface SatisfiesOptions {
  /** Allow prerelease versions to satisfy ranges that never mention a prerelease. */
  includePrerelease?: boolean
}

export function satisfies(version: SemVer, range: VersionRange, opts?: SatisfiesOptions): boolean {
  for (const alt of range.alternatives) {
    if (!alt.comparators.every((c) => testComparator(version, c))) continue
    if (version.prerelease.length > 0 && !opts?.includePrerelease) {
      // npm rule: a prerelease only matches when the range anchors a
      // prerelease at the same [major, minor, patch].
      const anchored = alt.prereleaseAnchors.some(
        (a) => a.major === version.major && a.minor === version.minor && a.patch === version.patch,
      )
      if (!anchored) continue
    }
    return true
  }
  return false
}

export function satisfiesString(version: string, range: string, opts?: SatisfiesOptions): boolean {
  return satisfies(parseVersion(version), parseRange(range), opts)
}

/** Newest-first sort of version strings (invalid versions sort last, stable). */
export function sortVersionsDescending(versions: readonly string[]): string[] {
  return [...versions].sort((a, b) => {
    const va = tryParseVersion(a)
    const vb = tryParseVersion(b)
    if (va && vb) return -compareVersions(va, vb)
    if (va) return -1
    if (vb) return 1
    return 0
  })
}
