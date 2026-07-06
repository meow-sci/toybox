/**
 * Dependency resolver with human-readable derivations.
 *
 * Design goals (deliberately departing from CKAN, whose transitive-conflict
 * errors are notoriously opaque — see TooManyModsProvideKraken /
 * DependenciesNotSatisfiedKraken):
 *
 *  1. One version per mod id, mirroring the loader's reality: StarMap loads
 *     whatever single folder exists per ModId, so resolution = choose a
 *     single version per id (like cargo's per-crate unification, not
 *     maven's nearest-wins).
 *  2. Every decision carries a "why" chain: requirement edges record which
 *     mod@version demanded them, so failures render as a derivation the
 *     user can act on, never a bare "conflict".
 *  3. Deterministic: candidate versions are tried newest-first (stable
 *     before prerelease unless the caller opts in), so results are
 *     reproducible from (index, request) alone.
 *  4. Only `required` references drive resolution. `recommends` are never
 *     auto-installed — they surface in the UI — but when a recommended mod
 *     IS present its version should satisfy the range (StarMap semantics:
 *     optional-present shares assemblies, so a wrong version is a real
 *     problem), which is reported as a post-solve warning.
 *
 * The search is exhaustive backtracking over a small domain (a KSA mod set
 * is tens of mods, each with a handful of versions), collecting the reasons
 * for every rejected candidate so the final error is a complete explanation
 * rather than the last failure encountered.
 */

import type { CatalogMod, CatalogRelease, Platform, ToyboxIndex } from '../catalog/types.ts'
import { ksaSatisfies, tryParseKsaRange, tryParseKsaVersion } from '../version/ksa.ts'
import {
  compareVersions,
  isPrerelease,
  parseRange,
  satisfies,
  tryParseVersion,
} from '../version/semver.ts'

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface ResolveRequest {
  /** Mods the user explicitly wants installed (id + optional version range). */
  install: { id: string; range?: string }[]
  /** Mods the user explicitly wants removed. */
  remove: string[]
  /** Currently installed mods (id -> version + whether auto-installed). */
  installed: Record<string, { version: string; autoInstalled: boolean }>
  /**
   * Upgrade policy for installed mods that are not explicitly requested:
   * 'keep' pins them at their installed version; 'upgrade' allows newer.
   */
  policy?: 'keep' | 'upgrade'
  /** Allow prerelease versions to be chosen. */
  includePrerelease?: boolean
  /** Current platform; releases with no artifact for it are not eligible. */
  platform: Platform
  /** Known game version (raw string); gates `ksa` compat ranges when set. */
  ksaVersion?: string
}

export interface Resolution {
  ok: true
  /** Complete target set: id -> chosen version. */
  target: Record<string, ResolvedMod>
  /** The plan diff vs. `installed`. */
  changes: ResolutionChange[]
  warnings: ResolutionWarning[]
}

export interface ResolvedMod {
  id: string
  version: string
  /** Why this mod is in the set (root request or dependency chain). */
  reasons: Requirement[]
  autoInstalled: boolean
}

export type ResolutionChange =
  | { kind: 'install'; id: string; version: string; reasons: Requirement[] }
  | { kind: 'upgrade'; id: string; from: string; to: string; reasons: Requirement[] }
  | { kind: 'downgrade'; id: string; from: string; to: string; reasons: Requirement[] }
  | { kind: 'remove'; id: string; version: string; reason: string }

export interface ResolutionWarning {
  id: string
  message: string
}

export interface ResolutionFailure {
  ok: false
  /** Human-readable multi-line explanation of why resolution failed. */
  explanation: string
  /** Structured details for UI rendering. */
  problems: Problem[]
}

export interface Problem {
  /** The unsatisfiable requirement. */
  requirement: Requirement
  /** Every candidate version considered and why each was rejected. */
  rejections: Rejection[]
}

export interface Requirement {
  id: string
  range: string
  /** Who demanded it: 'user' or `modId@version`. */
  requiredBy: string
  /** Chain from the root request down to this requirement, for display. */
  chain: string[]
  /** Publisher-authored "why" carried from the catalog reference. */
  description?: string
}

export interface Rejection {
  version: string
  reason: string
}

export type ResolveResult = Resolution | ResolutionFailure

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface Candidate {
  release: CatalogRelease
  mod: CatalogMod
}

export function resolve(index: ToyboxIndex, request: ResolveRequest): ResolveResult {
  const mods = new Map<string, CatalogMod>()
  for (const m of index.mods) mods.set(m.id.toLowerCase(), m)

  const removeSet = new Set(request.remove.map((r) => r.toLowerCase()))
  const policy = request.policy ?? 'keep'
  const ksa = request.ksaVersion ? tryParseKsaVersion(request.ksaVersion) : null

  // Root requirements: explicit installs + retained installed mods.
  const roots: Requirement[] = []
  for (const req of request.install) {
    roots.push({
      id: req.id,
      range: req.range ?? '*',
      requiredBy: 'user',
      chain: [],
    })
  }
  for (const [id, info] of Object.entries(request.installed)) {
    const key = id.toLowerCase()
    if (removeSet.has(key)) continue
    if (request.install.some((r) => r.id.toLowerCase() === key)) continue
    if (!mods.has(key)) continue // unmanaged/unknown installs are not resolved over
    roots.push({
      id,
      range: policy === 'keep' ? `=${info.version}` : '*',
      requiredBy: info.autoInstalled ? 'installed-auto' : 'installed',
      chain: [],
    })
  }

  /**
   * Candidate versions for a mod, eligibility-filtered (platform, ksa,
   * channel), newest first. Rejections for ineligible versions are recorded
   * so failures can explain "1.2.0 exists but has no linux artifact".
   */
  const eligibility = (mod: CatalogMod): { candidates: Candidate[]; rejections: Rejection[] } => {
    const rejections: Rejection[] = []
    const candidates: Candidate[] = []
    const releases = [...mod.releases].sort((a, b) => {
      const va = tryParseVersion(a.version)
      const vb = tryParseVersion(b.version)
      if (!va || !vb) return 0
      return -compareVersions(va, vb)
    })
    for (const release of releases) {
      const v = tryParseVersion(release.version)
      if (!v) {
        rejections.push({ version: release.version, reason: 'unparseable version' })
        continue
      }
      if ((release.channel === 'prerelease' || isPrerelease(v)) && !request.includePrerelease) {
        rejections.push({ version: release.version, reason: 'prerelease (channel is stable)' })
        continue
      }
      if (!release.artifacts.some((a) => a.platforms.includes(request.platform))) {
        rejections.push({
          version: release.version,
          reason: `no artifact for platform "${request.platform}"`,
        })
        continue
      }
      if (ksa && release.ksa) {
        const range = tryParseKsaRange(release.ksa)
        if (range && !ksaSatisfies(ksa, range)) {
          rejections.push({
            version: release.version,
            reason: `requires KSA ${release.ksa}, you have ${request.ksaVersion}`,
          })
          continue
        }
      }
      candidates.push({ release, mod })
    }
    return { candidates, rejections }
  }

  // Backtracking search state.
  const chosen = new Map<string, { candidate: Candidate; reasons: Requirement[] }>()
  const problems: Problem[] = []

  const rangeSatisfied = (version: string, range: string): boolean => {
    const v = tryParseVersion(version)
    if (!v) return false
    return satisfies(v, parseRange(range), { includePrerelease: true })
  }

  /**
   * Attempt to satisfy `queue` of requirements given current `chosen`.
   * Returns null on success or the first unsolvable Problem (after trying
   * every candidate and backtracking alternative).
   */
  const solve = (queue: Requirement[]): Problem | null => {
    if (queue.length === 0) return null
    const [req, ...rest] = queue as [Requirement, ...Requirement[]]
    const key = req.id.toLowerCase()

    if (removeSet.has(key)) {
      return {
        requirement: req,
        rejections: [
          {
            version: '(any)',
            reason: `"${req.id}" is marked for removal but ${describeRequirer(req)} requires it`,
          },
        ],
      }
    }

    const existing = chosen.get(key)
    if (existing) {
      if (rangeSatisfied(existing.candidate.release.version, req.range)) {
        existing.reasons.push(req)
        const out = solve(rest)
        if (out) existing.reasons.pop()
        return out
      }
      // Version conflict on an already-chosen mod: try to re-choose it with
      // the combined constraints by backtracking to alternatives.
      const mod = mods.get(key)
      if (!mod) {
        return { requirement: req, rejections: [{ version: '(none)', reason: 'not in the index' }] }
      }
      const { candidates, rejections } = eligibility(mod)
      const combinedRejections: Rejection[] = [...rejections]
      for (const cand of candidates) {
        if (!rangeSatisfied(cand.release.version, req.range)) {
          combinedRejections.push({
            version: cand.release.version,
            reason: `does not satisfy "${req.range}" required by ${describeRequirer(req)}`,
          })
          continue
        }
        const failedPrior = existing.reasons.find(
          (r) => !rangeSatisfied(cand.release.version, r.range),
        )
        if (failedPrior) {
          combinedRejections.push({
            version: cand.release.version,
            reason: `does not satisfy "${failedPrior.range}" required by ${describeRequirer(failedPrior)}`,
          })
          continue
        }
        // Re-choose and re-expand this mod's dependencies.
        const saved = existing.candidate
        existing.candidate = cand
        existing.reasons.push(req)
        const depReqs = dependencyRequirements(cand, mods, chosen)
        const out = solve([...depReqs, ...rest])
        if (!out) return null
        existing.reasons.pop()
        existing.candidate = saved
        combinedRejections.push({
          version: cand.release.version,
          reason: describeNestedProblem(out),
        })
      }
      return { requirement: req, rejections: combinedRejections }
    }

    const mod = mods.get(key)
    if (!mod) {
      return {
        requirement: req,
        rejections: [{ version: '(none)', reason: `"${req.id}" is not in the index` }],
      }
    }

    const { candidates, rejections } = eligibility(mod)
    const tried: Rejection[] = [...rejections]
    for (const cand of candidates) {
      if (!rangeSatisfied(cand.release.version, req.range)) {
        tried.push({
          version: cand.release.version,
          reason: `does not satisfy "${req.range}" required by ${describeRequirer(req)}`,
        })
        continue
      }
      const conflict = findConflict(cand, chosen, mods)
      if (conflict) {
        tried.push({ version: cand.release.version, reason: conflict })
        continue
      }
      chosen.set(key, { candidate: cand, reasons: [req] })
      const depReqs = dependencyRequirements(cand, mods, chosen)
      const out = solve([...depReqs, ...rest])
      if (!out) return null
      chosen.delete(key)
      tried.push({
        version: cand.release.version,
        reason: describeNestedProblem(out),
      })
    }
    return { requirement: req, rejections: tried }
  }

  const failure = solve(roots)
  if (failure) {
    problems.push(failure)
    return { ok: false, explanation: explain(problems), problems }
  }

  // Drop auto-installed mods nothing depends on anymore (CKAN's
  // FindRemovableAutoInstalled equivalent, but computed structurally).
  const warnings: ResolutionWarning[] = []
  pruneOrphans(chosen)

  // Recommends version check: a recommended mod is never forced in, but if
  // both sides are present the range should hold (assembly sharing makes
  // mismatches real bugs).
  for (const [, { candidate }] of chosen) {
    for (const rec of candidate.release.recommends) {
      const target = chosen.get(rec.id.toLowerCase())
      if (target && !rangeSatisfied(target.candidate.release.version, rec.range)) {
        warnings.push({
          id: rec.id,
          message:
            `${candidate.mod.id}@${candidate.release.version} recommends ` +
            `${rec.id} ${rec.range}, but ${target.candidate.release.version} is selected — ` +
            'they may not work together',
        })
      }
    }
  }

  const target: Record<string, ResolvedMod> = {}
  for (const [, { candidate, reasons }] of chosen) {
    const isRoot = reasons.some((r) => r.requiredBy === 'user' || r.requiredBy === 'installed')
    target[candidate.mod.id] = {
      id: candidate.mod.id,
      version: candidate.release.version,
      reasons: [...reasons],
      autoInstalled: !isRoot,
    }
  }

  return { ok: true, target, changes: diff(target, request, new Set(mods.keys())), warnings }
}

function describeRequirer(req: Requirement): string {
  const who =
    req.requiredBy === 'user'
      ? 'you'
      : req.requiredBy === 'installed'
        ? 'your installed mods'
        : req.requiredBy === 'installed-auto'
          ? 'a previously auto-installed dependency'
          : req.requiredBy
  if (req.chain.length === 0) return who
  return `${who} (via ${req.chain.join(' → ')})`
}

/** Flatten a nested unsolvable requirement into a readable rejection reason. */
function describeNestedProblem(out: Problem): string {
  const inner = out.rejections
    .slice(0, 6)
    .map((r) => `${out.requirement.id} ${r.version}: ${r.reason}`)
    .join('; ')
  return (
    `needs ${out.requirement.id} ${out.requirement.range} ` +
    `(required by ${describeRequirer(out.requirement)}` +
    (out.requirement.description ? ` — ${out.requirement.description}` : '') +
    `) which is unsatisfiable — ${inner}`
  )
}

function dependencyRequirements(
  cand: Candidate,
  mods: Map<string, CatalogMod>,
  chosen: Map<string, { candidate: Candidate; reasons: Requirement[] }>,
): Requirement[] {
  const self = `${cand.mod.id}@${cand.release.version}`
  const out: Requirement[] = []
  for (const dep of cand.release.required) {
    out.push({
      id: dep.id,
      range: dep.range,
      requiredBy: self,
      chain: [...(chosen.get(cand.mod.id.toLowerCase())?.reasons[0]?.chain ?? []), self],
      ...(dep.description !== undefined ? { description: dep.description } : {}),
    })
    void mods
  }
  return out
}

function findConflict(
  cand: Candidate,
  chosen: Map<string, { candidate: Candidate; reasons: Requirement[] }>,
  mods: Map<string, CatalogMod>,
): string | null {
  void mods
  // Declared conflicts of the candidate against already-chosen mods.
  for (const c of cand.release.conflicts) {
    const other = chosen.get(c.id.toLowerCase())
    if (!other) continue
    const v = tryParseVersion(other.candidate.release.version)
    if (v && satisfies(v, parseRange(c.range), { includePrerelease: true })) {
      return (
        `conflicts with ${other.candidate.mod.id}@${other.candidate.release.version}` +
        (c.reason ? ` (${c.reason})` : '')
      )
    }
  }
  // And the reverse: already-chosen mods declaring conflicts with the candidate.
  const candV = tryParseVersion(cand.release.version)
  for (const [, { candidate: other }] of chosen) {
    for (const c of other.release.conflicts) {
      if (c.id.toLowerCase() !== cand.mod.id.toLowerCase()) continue
      if (candV && satisfies(candV, parseRange(c.range), { includePrerelease: true })) {
        return (
          `${other.mod.id}@${other.release.version} declares a conflict with ` +
          `${cand.mod.id} ${c.range}` +
          (c.reason ? ` (${c.reason})` : '')
        )
      }
    }
  }
  return null
}

function pruneOrphans(chosen: Map<string, { candidate: Candidate; reasons: Requirement[] }>): void {
  // A mod stays if any reason is a root, or any chooser that stays requires it.
  for (;;) {
    let removed = false
    const snapshot = Array.from(chosen)
    for (const [key, { candidate, reasons }] of snapshot) {
      const isRoot = reasons.some((r) => r.requiredBy === 'user' || r.requiredBy === 'installed')
      if (isRoot) continue
      const stillNeeded = [...chosen.values()].some(
        (c) =>
          c.candidate.mod.id !== candidate.mod.id &&
          c.candidate.release.required.some((d) => d.id.toLowerCase() === key),
      )
      if (!stillNeeded) {
        chosen.delete(key)
        removed = true
      }
    }
    if (!removed) break
  }
}

function diff(
  target: Record<string, ResolvedMod>,
  request: ResolveRequest,
  knownIds: ReadonlySet<string>,
): ResolutionChange[] {
  const changes: ResolutionChange[] = []
  const installedByKey = new Map(
    Object.entries(request.installed)
      .filter(([id]) => knownIds.has(id.toLowerCase()))
      .map(([id, v]) => [id.toLowerCase(), { id, ...v }] as const),
  )
  for (const mod of Object.values(target)) {
    const cur = installedByKey.get(mod.id.toLowerCase())
    if (!cur) {
      changes.push({ kind: 'install', id: mod.id, version: mod.version, reasons: mod.reasons })
      continue
    }
    const a = tryParseVersion(cur.version)
    const b = tryParseVersion(mod.version)
    if (cur.version === mod.version || !a || !b || compareVersions(a, b) === 0) continue
    changes.push({
      kind: compareVersions(a, b) < 0 ? 'upgrade' : 'downgrade',
      id: mod.id,
      from: cur.version,
      to: mod.version,
      reasons: mod.reasons,
    })
  }
  const targetKeys = new Set(Object.keys(target).map((k) => k.toLowerCase()))
  for (const [key, cur] of installedByKey) {
    if (targetKeys.has(key)) continue
    const explicit = request.remove.some((r) => r.toLowerCase() === key)
    changes.push({
      kind: 'remove',
      id: cur.id,
      version: cur.version,
      reason: explicit ? 'requested' : 'no longer required (auto-installed dependency)',
    })
  }
  return changes
}

function explain(problems: Problem[]): string {
  const lines: string[] = []
  for (const p of problems) {
    const req = p.requirement
    lines.push(
      `Cannot satisfy: ${req.id} ${req.range === '*' ? '(any version)' : req.range} — required by ${describeRequirer(req)}`,
    )
    if (req.description) lines.push(`  (${req.description})`)
    for (const r of p.rejections) {
      lines.push(`  • ${req.id} ${r.version}: ${r.reason}`)
    }
  }
  lines.push('')
  lines.push(
    'Nothing was changed. Adjust the plan (pick different versions, remove the conflicting mod, or update the game) and try again.',
  )
  return lines.join('\n')
}
