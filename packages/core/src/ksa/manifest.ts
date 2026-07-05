/**
 * KSA `manifest.toml` synchronization.
 *
 * KSA decides which mod folders are active from
 * `<Documents>/My Games/Kitten Space Agency/manifest.toml` — a flat list of
 * `[[mods]]` entries with `id` and `enabled` keys (a missing `enabled`
 * means active). StarMap piggybacks on the same manifest.
 *
 * Discipline (mirrors the hardened CKAN-KSA implementation):
 *  - never flip an existing entry's enabled state during sync (respect
 *    in-game disables); explicit setEnabled edits are separate;
 *  - unknown keys in an entry round-trip verbatim;
 *  - only prune entries for folders toybox manages (tracked in state).
 *
 * Parsing is intentionally line-based and lossless rather than a full TOML
 * round-trip, because the game writes this file by hand too.
 */

export interface ManifestEntry {
  id: string
  enabled: boolean
  /** Raw lines we do not understand, preserved verbatim on rewrite. */
  extraLines: string[]
}

export function parseManifest(text: string): ManifestEntry[] {
  const entries: ManifestEntry[] = []
  let current: ManifestEntry | null = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '[[mods]]') {
      current = { id: '', enabled: true, extraLines: [] }
      entries.push(current)
      continue
    }
    const eq = line.indexOf('=')
    if (!current || line.length === 0 || eq < 1 || line.startsWith('#')) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    switch (key) {
      case 'id':
        current.id = parseTomlScalar(value)
        break
      case 'enabled':
        current.enabled = parseTomlScalar(value) === 'true'
        break
      default:
        current.extraLines.push(line)
    }
  }
  return entries
}

/** Strip quotes/escapes/inline comments from a TOML scalar. */
export function parseTomlScalar(raw: string): string {
  const s = raw.trim()
  if (s.startsWith('"')) {
    let out = ''
    for (let i = 1; i < s.length; i++) {
      const c = s[i]!
      if (c === '\\' && i + 1 < s.length) {
        const n = s[i + 1]!
        out += n === 'n' ? '\n' : n === 't' ? '\t' : n
        i++
        continue
      }
      if (c === '"') break
      out += c
    }
    return out
  }
  if (s.startsWith("'")) {
    const close = s.indexOf("'", 1)
    return close > 0 ? s.slice(1, close) : s.slice(1)
  }
  const hash = s.indexOf('#')
  return (hash >= 0 ? s.slice(0, hash) : s).trim()
}

function escapeTomlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function serializeManifest(entries: readonly ManifestEntry[]): string {
  let out = ''
  for (const e of entries) {
    out += '[[mods]]\n'
    out += `id = "${escapeTomlString(e.id)}"\n`
    out += `enabled = ${e.enabled}\n`
    for (const line of e.extraLines) out += `${line}\n`
    out += '\n'
  }
  return out
}

export interface ManifestSyncResult {
  entries: ManifestEntry[]
  added: string[]
  removed: string[]
  changed: boolean
}

/**
 * Reconcile the manifest with the set of mod folders that exist on disk and
 * the set toybox manages:
 *  - every present folder gains an entry (enabled) if missing;
 *  - entries for toybox-managed folders that no longer exist are pruned;
 *  - everything else (including enabled flags) is left untouched.
 */
export function syncManifest(
  entries: readonly ManifestEntry[],
  presentFolders: readonly string[],
  managedFolders: readonly string[],
): ManifestSyncResult {
  const result: ManifestEntry[] = entries.map((e) => ({ ...e, extraLines: [...e.extraLines] }))
  const byId = new Map(result.map((e) => [e.id.toLowerCase(), e] as const))
  const present = new Set(presentFolders.map((f) => f.toLowerCase()))
  const managed = new Set(managedFolders.map((f) => f.toLowerCase()))
  const added: string[] = []
  const removed: string[] = []

  for (const folder of presentFolders) {
    if (!byId.has(folder.toLowerCase())) {
      const entry: ManifestEntry = { id: folder, enabled: true, extraLines: [] }
      result.push(entry)
      byId.set(folder.toLowerCase(), entry)
      added.push(folder)
    }
  }

  const pruned = result.filter((e) => {
    const key = e.id.toLowerCase()
    const stale = managed.has(key) && !present.has(key)
    if (stale) removed.push(e.id)
    return !stale
  })

  return {
    entries: pruned,
    added,
    removed,
    changed: added.length > 0 || removed.length > 0,
  }
}

export function setEnabled(
  entries: readonly ManifestEntry[],
  id: string,
  enabled: boolean,
): ManifestEntry[] {
  return entries.map((e) =>
    e.id.toLowerCase() === id.toLowerCase() ? { ...e, enabled } : { ...e },
  )
}
