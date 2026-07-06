/**
 * @toybox/core — the headless KSA mod package manager.
 *
 * Public surface: the Toybox facade plus every type a frontend needs to
 * render plans, progress, scans, and failures. Nothing here imports a UI
 * framework; everything is exercised headlessly by the test suite.
 */

export { Toybox, detectPlatform } from './manager.ts'
export type {
  ToyboxOptions,
  GrantInfo,
  CartItem,
  PlannedTransaction,
  ApplyEvent,
} from './manager.ts'

export type {
  ToyboxIndex,
  CatalogMod,
  CatalogRelease,
  CatalogReference,
  CatalogConflict,
  CatalogArtifact,
  ArtifactManifest,
  ManifestFile,
  Platform,
} from './catalog/types.ts'
export {
  parseIndex,
  parseArtifactManifest,
  IndexValidationError,
  ALL_PLATFORMS,
} from './catalog/types.ts'
export { IndexClient, DEFAULT_INDEX_URL } from './catalog/client.ts'
export {
  searchMods,
  eligibleReleases,
  artifactForPlatform,
  modIndexFolder,
} from './catalog/select.ts'

export type { ToyDir, ToyFile, ToyEntry, ToyWritable } from './fs/types.ts'
export {
  splitPath,
  joinPath,
  dirAtPath,
  fileAtPath,
  pathExists,
  readTextIfExists,
  listFilesRecursive,
  deleteFileAndPrune,
} from './fs/types.ts'
export { FsaDir } from './fs/fsa.ts'
export { MemDir } from './fs/memory.ts'

export type {
  ToyboxState,
  ToyboxSettings,
  InstalledMod,
  InstalledFile,
  TransactionJournal,
  JournalStep,
} from './state/types.ts'
export { StateStore, TOYBOX_DIR } from './state/store.ts'

export { resolve } from './resolve/resolver.ts'
export type {
  ResolveRequest,
  ResolveResult,
  Resolution,
  ResolutionFailure,
  ResolutionChange,
  ResolutionWarning,
  ResolvedMod,
  Requirement,
  Problem,
  Rejection,
} from './resolve/resolver.ts'

export {
  applyTransaction,
  recoverIfNeeded,
  auditPlan,
  TransactionError,
} from './install/transaction.ts'
export type {
  TransactionPlan,
  PlannedOperation,
  PlanWarning,
  ApplyPhase,
  ApplyResult,
  RecoveryReport,
} from './install/transaction.ts'
export {
  acquireArtifact,
  verifyLocalArtifact,
  DownloadError,
  parseGithubReleaseUrl,
} from './install/download.ts'
export { buildModBundle } from './install/bundle.ts'
export type {
  BundleRequest,
  BundleOptions,
  BundleEvent,
  BundleResult,
  BundleOutcome,
} from './install/bundle.ts'
export type { AcquiredArtifact, DownloadProgress } from './install/download.ts'
export { extractZipStream, ZipError } from './install/zip.ts'
export type { ZipEntryResult, ZipSink, ZipFileWriter } from './install/zip.ts'
export { createSha256, sha256Hex, sha256HexOfStream, normalizeSha256 } from './install/hash.ts'

export { scanModsDir, adoptFolder, verifyInstalled } from './scan/scan.ts'
export type {
  ScanResult,
  ManagedScan,
  ForeignScan,
  AdoptionCandidate,
  AdoptionResult,
  VerifyResult,
} from './scan/scan.ts'

export { parseManifest, serializeManifest, syncManifest, setEnabled } from './ksa/manifest.ts'
export type { ManifestEntry, ManifestSyncResult } from './ksa/manifest.ts'

export {
  parseVersion,
  tryParseVersion,
  compareVersions,
  compareVersionStrings,
  parseRange,
  tryParseRange,
  satisfies,
  satisfiesString,
  sortVersionsDescending,
  isPrerelease,
  anyRange,
} from './version/semver.ts'
export type { SemVer, VersionRange } from './version/semver.ts'
export {
  tryParseKsaVersion,
  parseKsaRange,
  tryParseKsaRange,
  ksaSatisfies,
  compareKsaVersions,
  formatKsaVersion,
} from './version/ksa.ts'
export type { KsaVersion, KsaRange } from './version/ksa.ts'

export { fuzzySearch, fuzzyMatch, matchToken } from './search/fuzzy.ts'
export type { FuzzyField, FuzzyMatch, SearchResult } from './search/fuzzy.ts'
