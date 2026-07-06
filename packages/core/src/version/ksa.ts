/**
 * KSA game-version handling.
 *
 * KSA builds are versioned `year.month.buildcounter.revision`, e.g.
 * `2026.7.3.4826`. The third component (build counter) is per-build-machine
 * and NOT monotonic, so it must never participate in ordering or
 * compatibility decisions — the CKAN KSA fork normalizes it to 0 everywhere
 * (`KittenSpaceAgency.NormalizeBuildCounter`) and toybox does the same.
 * Ordering therefore falls through to the fourth component (revision),
 * which is the real ordinal.
 */

export interface KsaVersion {
  year: number
  month: number
  /** Always 0 after normalization; kept for round-tripping displays. */
  build: number
  revision: number
  raw: string
}

const KSA_RE = /^(\d{4})(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?$/

export function tryParseKsaVersion(input: string): KsaVersion | null {
  const m = KSA_RE.exec(input.trim())
  if (!m) return null
  return {
    year: Number(m[1]),
    month: Number(m[2] ?? 0),
    build: 0, // normalized: the build counter is machine-local noise
    revision: Number(m[4] ?? 0),
    raw: input.trim(),
  }
}

export function compareKsaVersions(a: KsaVersion, b: KsaVersion): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1
  if (a.month !== b.month) return a.month < b.month ? -1 : 1
  if (a.revision !== b.revision) return a.revision < b.revision ? -1 : 1
  return 0
}

interface KsaComparator {
  op: '>=' | '<=' | '>' | '<' | '='
  version: KsaVersion
  /** How many components the author wrote; comparisons truncate to this. */
  specificity: 1 | 2 | 4
}

export interface KsaRange {
  raw: string
  comparators: KsaComparator[]
}

/**
 * Parse a KSA compatibility range: whitespace-separated comparators, e.g.
 * `>=2026.7`, `>=2026.6 <=2026.7`, `2026.7` (that month), `*`.
 */
export function parseKsaRange(input: string): KsaRange {
  const raw = input.trim()
  const comparators: KsaComparator[] = []
  if (raw === '' || raw === '*') return { raw: raw || '*', comparators }
  for (const part of raw.split(/\s+/)) {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(part)
    const op = (m?.[1] ?? '=') as KsaComparator['op']
    const vs = m?.[2] ?? ''
    const v = tryParseKsaVersion(vs)
    if (!v) throw new Error(`Invalid KSA version range: "${input}" (bad version "${vs}")`)
    const dots = vs.split('.').length
    const specificity: 1 | 2 | 4 = dots <= 1 ? 1 : dots === 2 ? 2 : 4
    comparators.push({ op, version: v, specificity })
  }
  return { raw, comparators }
}

export function tryParseKsaRange(input: string): KsaRange | null {
  try {
    return parseKsaRange(input)
  } catch {
    return null
  }
}

function compareTruncated(v: KsaVersion, c: KsaComparator): number {
  if (v.year !== c.version.year) return v.year < c.version.year ? -1 : 1
  if (c.specificity === 1) return 0
  if (v.month !== c.version.month) return v.month < c.version.month ? -1 : 1
  if (c.specificity === 2) return 0
  if (v.revision !== c.version.revision) return v.revision < c.version.revision ? -1 : 1
  return 0
}

export function ksaSatisfies(version: KsaVersion, range: KsaRange): boolean {
  return range.comparators.every((c) => {
    const cmp = compareTruncated(version, c)
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
  })
}

/** Format for display: month-granular versions render as `2026.7.*`. */
export function formatKsaVersion(v: KsaVersion): string {
  return v.revision > 0 ? `${v.year}.${v.month}.*.${v.revision}` : `${v.year}.${v.month}.*`
}
