/**
 * On-disk state toybox keeps inside the granted folder, under
 * `mods/.toybox/`. This is the ONLY place toybox persists anything — no
 * backend, no localStorage. Wiping the browser and re-granting the folder
 * fully restores the managed state.
 *
 *   mods/.toybox/state.json      installed-mod registry (per-file sha256!)
 *   mods/.toybox/journal.json    present only while a transaction is applying
 *   mods/.toybox/settings.json   user preferences
 *
 * Unlike CKAN (whose InstalledModuleFile records no checksum, so it cannot
 * tell a user-edited file from a pristine one), every installed file records
 * size + sha256, enabling: verify, safe upgrades that flag user-modified
 * files, and adoption of manual installs by content match.
 */

export interface ToyboxState {
  schema: 1
  mods: Record<string, InstalledMod>
  /**
   * manifest.toml entry ids toybox itself added, so sync only ever prunes
   * entries it owns (mirrors CKAN's ksa-manifest-managed-mods.json).
   */
  manifestOwned?: string[]
}

export interface InstalledMod {
  id: string
  version: string
  artifactKey: string
  /** Folder under mods/ this mod owns (== StarMap ModId). */
  installDir: string
  installedAt: string
  /** True when installed only to satisfy a dependency (auto-removable). */
  autoInstalled: boolean
  /** Where the artifact came from + its verified digest, for provenance. */
  source: {
    url: string
    sha256: string
  }
  /** Every file toybox wrote, relative to installDir. */
  files: InstalledFile[]
  /**
   * 'index' = installed by toybox from the catalog;
   * 'adopted' = a pre-existing manual install matched to a catalog release
   * (content-verified or trusted by the user).
   */
  origin: 'index' | 'adopted'
}

export interface InstalledFile {
  path: string
  size: number
  sha256: string
}

export interface ToyboxSettings {
  schema: 1
  /** Optional GitHub token to lift API rate limits on downloads. */
  githubToken?: string
  /** Preferred release channel when picking versions. */
  channel: 'stable' | 'prerelease'
  /** Known KSA game version (user-set or detected), raw string. */
  ksaVersion?: string
  /** Index URL override (default: the meow-sci/toybox-index Pages URL). */
  indexUrl?: string
}

// ---------------------------------------------------------------------------
// Transaction journal — crash recovery
// ---------------------------------------------------------------------------

/**
 * The journal is written before any live file is touched and deleted after
 * state.json reflects the transaction. Phases:
 *
 *   'staging'  — downloading/extracting into .toybox/staging/<txId>/. The
 *                live mods tree is untouched; recovery = delete staging.
 *   'applying' — staged files are being promoted into the live tree (after
 *                old managed files were removed). Recovery = re-promote the
 *                remaining staged files (idempotent), then finish.
 */
export interface TransactionJournal {
  schema: 1
  txId: string
  startedAt: string
  phase: 'staging' | 'applying'
  steps: JournalStep[]
}

export type JournalStep =
  | {
      action: 'install'
      modId: string
      version: string
      artifactKey: string
      installDir: string
      autoInstalled: boolean
      sourceUrl: string
      sourceSha256: string
      /** Files staged under .toybox/staging/<txId>/<installDir>/ */
      files: InstalledFile[]
      /** For upgrades: the previous version's record to remove first. */
      replaces?: { version: string; files: InstalledFile[] }
    }
  | {
      action: 'remove'
      modId: string
      installDir: string
      files: InstalledFile[]
    }

export const DEFAULT_SETTINGS: ToyboxSettings = {
  schema: 1,
  channel: 'stable',
}

export function emptyState(): ToyboxState {
  return { schema: 1, mods: {} }
}
