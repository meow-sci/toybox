/**
 * Lightweight fzf-style fuzzy matcher for mod discovery.
 *
 * Subsequence matching with a positional scoring model: word-boundary and
 * camelCase starts score high, consecutive matches accumulate a streak
 * bonus, gaps are penalized. Multi-token queries AND together (every token
 * must match somewhere). Fields are weighted so an id/name hit outranks a
 * readme hit.
 */

export interface FuzzyField {
  text: string
  weight: number
}

export interface FuzzyMatch {
  score: number
  /** Matched character indexes of the best field, for highlight rendering. */
  positions: number[]
  /** Index of the field that produced the best score. */
  fieldIndex: number
}

const SCORE_MATCH = 16
const BONUS_BOUNDARY = 8
const BONUS_CAMEL = 7
const BONUS_CONSECUTIVE = 4
const BONUS_FIRST_CHAR = 8
const PENALTY_GAP_START = 3
const PENALTY_GAP_EXTEND = 1

function isLower(c: string): boolean {
  return c >= 'a' && c <= 'z'
}
function isUpper(c: string): boolean {
  return c >= 'A' && c <= 'Z'
}
function isAlnum(c: string): boolean {
  return isLower(c) || isUpper(c) || (c >= '0' && c <= '9')
}

/** Bonus for matching at position i of text (boundary/camel detection). */
function positionBonus(text: string, i: number): number {
  if (i === 0) return BONUS_BOUNDARY + BONUS_FIRST_CHAR
  const prev = text[i - 1]!
  const cur = text[i]!
  if (!isAlnum(prev)) return BONUS_BOUNDARY
  if (isLower(prev) && isUpper(cur)) return BONUS_CAMEL
  return 0
}

/**
 * Score one query token against one text. Greedy forward pass that prefers
 * boundary starts; O(n·m) worst case but with early exits — fine for
 * catalog-sized data (hundreds to low thousands of entries).
 */
export function matchToken(
  query: string,
  text: string,
): { score: number; positions: number[] } | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (q.length === 0) return { score: 0, positions: [] }
  if (q.length > t.length) return null

  // First check it is a subsequence at all (cheap rejection).
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  if (qi < q.length) return null

  // Try each viable starting position of the first query char, with two
  // greedy alignment strategies per start — plain first-occurrence (always
  // completes when a subsequence exists from that start) and
  // boundary-preferring (scores better but can dead-end after a jump) — and
  // keep the best-scoring successful alignment. Recovers most of the
  // optimal-DP quality at a fraction of the cost.
  let best: { score: number; positions: number[] } | null = null
  for (let start = 0; start <= t.length - q.length; start++) {
    if (t[start] !== q[0]) continue
    for (const preferBoundaries of [false, true]) {
      const positions: number[] = [start]
      let score = SCORE_MATCH + positionBonus(text, start)
      let prev = start
      let ok = true
      for (let i = 1; i < q.length; i++) {
        let found = -1
        let boundary = -1
        for (let ti = prev + 1; ti < t.length; ti++) {
          if (t[ti] !== q[i]) continue
          if (found === -1) found = ti
          if (!preferBoundaries) break
          if (positionBonus(text, ti) > 0) {
            boundary = ti
            break
          }
          // Don't scan unboundedly for a boundary once we have a close match.
          if (found !== -1 && ti - found > 24) break
        }
        // A contiguous continuation always beats a boundary jump.
        const contiguous = found === prev + 1
        const pick =
          preferBoundaries &&
          !contiguous &&
          boundary !== -1 &&
          (found === -1 || boundary - prev <= 8)
            ? boundary
            : found
        if (pick === -1) {
          ok = false
          break
        }
        const gap = pick - prev - 1
        score += SCORE_MATCH + positionBonus(text, pick)
        if (gap === 0) score += BONUS_CONSECUTIVE
        else score -= PENALTY_GAP_START + (gap - 1) * PENALTY_GAP_EXTEND
        positions.push(pick)
        prev = pick
      }
      if (!ok) continue
      // Shorter texts win ties: normalize slightly by text length.
      const normalized = score - Math.floor(text.length / 8)
      if (!best || normalized > best.score) best = { score: normalized, positions }
    }
  }
  return best
}

/**
 * Match a whole query (whitespace-separated tokens, all required) against a
 * set of weighted fields. Returns null unless every token matches at least
 * one field.
 */
export function fuzzyMatch(query: string, fields: readonly FuzzyField[]): FuzzyMatch | null {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return { score: 0, positions: [], fieldIndex: 0 }
  let total = 0
  let bestField = { score: -1, positions: [] as number[], fieldIndex: 0 }
  for (const token of tokens) {
    let tokenBest: { score: number; positions: number[]; fieldIndex: number } | null = null
    for (let fi = 0; fi < fields.length; fi++) {
      const field = fields[fi]!
      const m = matchToken(token, field.text)
      if (!m) continue
      const weighted = m.score * field.weight
      if (!tokenBest || weighted > tokenBest.score) {
        tokenBest = { score: weighted, positions: m.positions, fieldIndex: fi }
      }
    }
    if (!tokenBest) return null
    total += tokenBest.score
    if (tokenBest.score > bestField.score) bestField = tokenBest
  }
  return { score: total, positions: bestField.positions, fieldIndex: bestField.fieldIndex }
}

export interface SearchResult<T> {
  item: T
  match: FuzzyMatch
}

/** Rank items by fuzzy score, descending. Empty query returns all, score 0. */
export function fuzzySearch<T>(
  query: string,
  items: readonly T[],
  fieldsOf: (item: T) => readonly FuzzyField[],
): SearchResult<T>[] {
  const results: SearchResult<T>[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, fieldsOf(item))
    if (match) results.push({ item, match })
  }
  results.sort((a, b) => b.match.score - a.match.score)
  return results
}
