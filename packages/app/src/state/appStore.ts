/**
 * The app state: nanostores atoms + action functions around the headless
 * Toybox facade (flexo's pattern — logic lives here, components subscribe
 * with useStore and stay thin).
 *
 * The Toybox instance itself is intentionally NOT reactive — every screen
 * reads reactive snapshots these atoms mirror after each engine operation.
 * Helpers that components call during render are pure functions of their
 * arguments (React Compiler-safe); anything reading `.get()` is an action
 * or event handler.
 */

import {
  FsaDir,
  IndexClient,
  Toybox,
  artifactForPlatform,
  buildModBundle,
  detectPlatform,
  modIndexFolder,
  resolve,
  searchMods,
  sortVersionsDescending,
  type ApplyEvent,
  type ArtifactManifest,
  type CartItem,
  type CatalogArtifact,
  type CatalogMod,
  type CatalogRelease,
  type GrantInfo,
  type InstalledMod,
  type PlannedTransaction,
  type Platform,
  type RecoveryReport,
  type Resolution,
  type ResolutionFailure,
  type ScanResult,
  type SearchResult,
  type ToyboxIndex,
  type ToyboxSettings,
  type VerifyResult,
} from '@toybox/core'
import { atom, computed } from 'nanostores'
import {
  forgetGrant,
  fsaSupported,
  initGrant,
  pickFolder,
  regrant,
  type GrantStatus,
} from '../lib/grant.ts'

export interface DownloadState {
  modId: string
  received: number
  total: number | null
}

export interface LocalFileRequest {
  modId: string
  artifact: CatalogArtifact
  provide: (file: Blob) => void
  abort: (reason?: string) => void
}

export type View = 'browse' | 'installed' | 'settings'

/** A recommendation surfaced by a plan: `from` recommends `id`, not selected. */
export interface RecommendHint {
  from: string
  id: string
  range: string
  description?: string
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/**
 * 'full'    — File System Access available: grant a folder, install/manage.
 * 'catalog' — any other browser: browse/search/resolve fully; the final
 *             install is replaced by a greenfield bundle (.zip) download.
 */
export const $mode = atom<'full' | 'catalog'>('full')
export const $platform = atom<Platform>(detectPlatform())

// Grant / boot
export const $status = atom<GrantStatus | 'boot' | 'opening'>('boot')
export const $grant = atom<GrantInfo | null>(null)
export const $grantName = atom('')
export const $recovery = atom<RecoveryReport | null>(null)
export const $fatalError = atom<string | null>(null)

// Catalog + installed state (reactive mirrors)
export const $view = atom<View>('browse')
export const $index = atom<ToyboxIndex | null>(null)
export const $indexError = atom<string | null>(null)
export const $installed = atom<InstalledMod[]>([])
export const $settings = atom<ToyboxSettings | null>(null)
export const $scan = atom<ScanResult | null>(null)
export const $scanning = atom(false)

// Browse / search
export const $query = atom('')
export const $selectedModId = atom<string | null>(null)
/** Whether the (single, reusable) cart panel is open. */
export const $cartOpen = atom(false)

// Cart → plan → apply
export const $cartInstall = atom<CartItem[]>([])
export const $cartRemove = atom<string[]>([])
export const $planned = atom<PlannedTransaction | null>(null)
export const $planFailure = atom<ResolutionFailure | null>(null)
export const $planning = atom(false)
export const $applying = atom(false)
export const $applyPhase = atom<string | null>(null)
export const $applyError = atom<string | null>(null)
export const $applyDone = atom<{ installed: string[]; removed: string[] } | null>(null)
export const $download = atom<DownloadState | null>(null)
export const $fileProgress = atom<{
  modId: string
  path: string
  index: number
  total: number | null
} | null>(null)
export const $localFileRequest = atom<LocalFileRequest | null>(null)

// Catalog mode: greenfield plan + bundle download state
export const $catalogPlan = atom<Resolution | null>(null)
export const $bundling = atom(false)
export const $bundleDone = atom<{
  filename: string
  contents: { id: string; version: string }[]
} | null>(null)

export const $verifyResults = atom<Record<string, VerifyResult>>({})
/** Lazily-fetched readmes: undefined = not requested, null = none/failed. */
export const $readmes = atom<Record<string, string | null | 'loading'>>({})
/**
 * Lazily-fetched per-file artifact manifests, keyed by the artifact's
 * sha256: undefined = not requested, null = none published / failed.
 */
export const $manifests = atom<Record<string, ArtifactManifest | null | 'loading'>>({})
export const $manifestEnabled = atom<Record<string, boolean>>({})

// Derived
export const $cartSize = computed(
  [$cartInstall, $cartRemove],
  (install, remove) => install.length + remove.length,
)
export const $results = computed([$index, $query], (index, query): SearchResult<CatalogMod>[] =>
  index ? searchMods(index.mods, query) : [],
)
export const $active = computed(
  [$status, $grant, $mode],
  (status, grant, mode) => status === 'ready' && (grant !== null || mode === 'catalog'),
)

// Non-reactive engine internals
let toybox: Toybox | null = null
let handle: FileSystemDirectoryHandle | null = null
const catalogClient = new IndexClient()

/** Test-only: reset the module-level engine state. */
export function resetEngineForTests(): void {
  toybox = null
  handle = null
}

export function engine(): Toybox | null {
  return toybox
}

// ---------------------------------------------------------------------------
// Boot / grant
// ---------------------------------------------------------------------------

export async function boot(): Promise<void> {
  if (!fsaSupported()) {
    // The whole app works — browse, search, resolve, review — only the
    // final on-disk install is unavailable; installs become bundle downloads.
    $mode.set('catalog')
    $status.set('ready')
    await refreshIndex()
    return
  }
  const grant = await initGrant()
  handle = grant.handle
  $status.set(grant.status)
  if (grant.status === 'ready' && grant.handle) await openHandle(grant.handle)
}

export async function pick(): Promise<void> {
  const picked = await pickFolder()
  if (!picked) return
  handle = picked
  await openHandle(picked)
}

export async function regrantStored(): Promise<void> {
  if (!handle) return
  if (await regrant(handle)) await openHandle(handle)
}

export async function forget(): Promise<void> {
  await forgetGrant()
  toybox = null
  handle = null
  $grant.set(null)
  $index.set(null)
  $installed.set([])
  $status.set('none')
}

async function openHandle(h: FileSystemDirectoryHandle): Promise<void> {
  $status.set('opening')
  $fatalError.set(null)
  try {
    const t = new Toybox(new FsaDir(h))
    const { grant, recovery } = await t.open()
    toybox = t
    $grant.set(grant)
    $grantName.set(h.name)
    $recovery.set(recovery.recovered ? recovery : null)
    $settings.set(t.settings)
    $installed.set(t.installedMods())
    $platform.set(t.platform)
    $status.set('ready')
    await refreshIndex()
    void rescan()
  } catch (e) {
    $fatalError.set((e as Error).message)
    $status.set('ready')
  }
}

// ---------------------------------------------------------------------------
// Index / search / scan
// ---------------------------------------------------------------------------

export async function refreshIndex(): Promise<void> {
  $indexError.set(null)
  try {
    $index.set(toybox ? await toybox.refreshIndex() : await catalogClient.fetchIndex())
    $readmes.set({})
  } catch (e) {
    $indexError.set((e as Error).message)
  }
}

/**
 * ALL releases, newest first, with NO platform filter. This is THE release
 * list for every display surface: the catalog always shows every version to
 * every user regardless of host-OS detection — per-release platform
 * availability is marked in the UI, never used to hide a version.
 * (Platform eligibility still gates *installation*, in the resolver and in
 * the update-available check.)
 */
export function sortedReleases(mod: CatalogMod): CatalogRelease[] {
  const order = sortVersionsDescending(mod.releases.map((r) => r.version))
  const byVersion = new Map(mod.releases.map((r) => [r.version, r] as const))
  return order.map((v) => byVersion.get(v)!)
}

export function artifactRef(release: CatalogRelease, platform: Platform): CatalogArtifact | null {
  return artifactForPlatform(release, platform)
}

/**
 * Absolute URL of a folder in the published index's directory browser
 * (always '/'-terminated — the listing pages are served as folder URLs).
 */
export function indexBrowseUrl(relFolder = ''): string {
  const client = toybox ?? catalogClient
  const url = client.resolveIndexRelative(relFolder === '' ? '.' : relFolder)
  return url.endsWith('/') ? url : `${url}/`
}

/** Browse URL of a mod's folder in the index, when derivable. */
export function modBrowseUrl(mod: CatalogMod): string | null {
  const folder = modIndexFolder(mod)
  return folder ? indexBrowseUrl(folder) : null
}

/** Kick off (or reuse) the lazy readme fetch for a mod. */
export function loadReadme(mod: CatalogMod): void {
  if ($readmes.get()[mod.id] !== undefined) return
  if (!mod.readmePath) {
    $readmes.set({ ...$readmes.get(), [mod.id]: null })
    return
  }
  $readmes.set({ ...$readmes.get(), [mod.id]: 'loading' })
  const fetchIt = toybox ? toybox.readmeFor(mod) : catalogClient.fetchReadme(mod).catch(() => null)
  void fetchIt.then((text) => {
    $readmes.set({ ...$readmes.get(), [mod.id]: text })
  })
}

/** Kick off (or reuse) the lazy per-file manifest fetch for an artifact. */
export function loadManifest(artifact: CatalogArtifact): void {
  const key = artifact.sha256
  if ($manifests.get()[key] !== undefined) return
  if (!artifact.manifest) {
    $manifests.set({ ...$manifests.get(), [key]: null })
    return
  }
  $manifests.set({ ...$manifests.get(), [key]: 'loading' })
  const fetchIt = toybox
    ? toybox.manifestFor(artifact)
    : catalogClient.fetchManifest(artifact).catch(() => null)
  void fetchIt.then((manifest) => {
    $manifests.set({ ...$manifests.get(), [key]: manifest })
  })
}

/**
 * Retarget artifact selection at a different platform. Detection is only a
 * GUESS at a sensible default — the mods folder's platform belongs to the
 * game install, not the browser (Proton, shared drives, bundles for
 * friends) — so the user may pick any platform in both modes.
 */
export function setPlatform(platform: Platform): void {
  $platform.set(platform)
  toybox?.setPlatform(platform)
  invalidatePlan()
}

/** Pure lookup helpers (pass the subscribed values in from the component). */
export function modById(index: ToyboxIndex | null, id: string): CatalogMod | null {
  return index?.mods.find((m) => m.id === id) ?? null
}

export function installedById(installed: InstalledMod[], id: string): InstalledMod | null {
  return installed.find((m) => m.id === id) ?? null
}

export async function rescan(): Promise<void> {
  if (!toybox) return
  $scanning.set(true)
  try {
    $scan.set(await toybox.scan())
  } catch {
    $scan.set(null)
  } finally {
    $scanning.set(false)
  }
}

export async function verifyMod(modId: string): Promise<void> {
  if (!toybox) return
  const result = await toybox.verify(modId)
  $verifyResults.set({ ...$verifyResults.get(), [modId]: result })
}

/**
 * An update is available when a newer eligible release exists. Pure in the
 * catalog data (pass the subscribed index); consults the engine only for
 * its channel/KSA-version eligibility rules, which are stable per settings.
 */
export function updateAvailable(index: ToyboxIndex | null, mod: InstalledMod): string | null {
  if (!toybox) return null
  const catalogMod = modById(index, mod.id)
  if (!catalogMod) return null
  const newest = toybox.eligibleReleases(catalogMod)[0]
  if (!newest || newest.version === mod.version) return null
  return newest.version
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export function inCart(
  install: CartItem[],
  remove: string[],
  id: string,
): 'install' | 'remove' | null {
  if (install.some((c) => c.id === id)) return 'install'
  if (remove.includes(id)) return 'remove'
  return null
}

export function addInstall(id: string, version?: string): void {
  $cartRemove.set($cartRemove.get().filter((r) => r !== id))
  const rest = $cartInstall.get().filter((c) => c.id !== id)
  $cartInstall.set([...rest, { id, ...(version !== undefined ? { version } : {}) }])
  invalidatePlan()
}

/**
 * Stage an install explicitly targeted at `platform` (the split-button
 * dropdown). The cart has ONE target platform — a mods folder serves one
 * game install — so this retargets the whole cart and stages the item.
 */
export function addInstallFor(id: string, platform: Platform, version?: string): void {
  setPlatform(platform)
  addInstall(id, version)
}

export function addRemove(id: string): void {
  $cartInstall.set($cartInstall.get().filter((c) => c.id !== id))
  if (!$cartRemove.get().includes(id)) $cartRemove.set([...$cartRemove.get(), id])
  invalidatePlan()
}

export function dropFromCart(id: string): void {
  $cartInstall.set($cartInstall.get().filter((c) => c.id !== id))
  $cartRemove.set($cartRemove.get().filter((r) => r !== id))
  invalidatePlan()
}

export function clearCart(): void {
  $cartInstall.set([])
  $cartRemove.set([])
  invalidatePlan()
}

function invalidatePlan(): void {
  $planned.set(null)
  $planFailure.set(null)
  $applyDone.set(null)
  $applyError.set(null)
  $catalogPlan.set(null)
  $bundleDone.set(null)
}

// ---------------------------------------------------------------------------
// Plan / apply
// ---------------------------------------------------------------------------

export async function buildPlan(): Promise<void> {
  if (!toybox) return
  $planning.set(true)
  $planned.set(null)
  $planFailure.set(null)
  try {
    const result = await toybox.plan({
      install: $cartInstall.get(),
      remove: $cartRemove.get(),
    })
    if ('plan' in result) $planned.set(result)
    else $planFailure.set(result)
  } catch (e) {
    $planFailure.set({ ok: false, explanation: (e as Error).message, problems: [] })
  } finally {
    $planning.set(false)
  }
}

function handleProgressEvent(e: ApplyEvent): void {
  switch (e.type) {
    case 'phase':
      $applyPhase.set(
        e.phase.step === 'finalizing'
          ? 'Finalizing…'
          : `${e.phase.step === 'staging' ? 'Downloading & extracting' : e.phase.step === 'verifying' ? 'Verifying' : 'Applying'} ${e.phase.modId}`,
      )
      if (e.phase.step !== 'staging') $download.set(null)
      break
    case 'download':
      $download.set({
        modId: e.modId,
        received: e.progress.bytesReceived,
        total: e.progress.totalBytes,
      })
      break
    case 'file':
      $fileProgress.set({ modId: e.modId, path: e.path, index: e.index, total: e.total })
      break
    case 'needs-local-file':
      $localFileRequest.set({
        modId: e.modId,
        artifact: e.artifact,
        provide: (file) => {
          $localFileRequest.set(null)
          e.provide(file)
        },
        abort: (reason) => {
          $localFileRequest.set(null)
          e.abort(reason)
        },
      })
      break
  }
}

export async function applyPlan(allowUnmanagedOverwrite: boolean): Promise<void> {
  const planned = $planned.get()
  if (!toybox || !planned) return
  $applying.set(true)
  $applyError.set(null)
  $applyDone.set(null)
  try {
    const result = await toybox.apply(planned, handleProgressEvent, { allowUnmanagedOverwrite })
    $applyDone.set({ installed: result.installed, removed: result.removed })
    $installed.set(toybox.installedMods())
    clearCart()
    void rescan()
  } catch (e) {
    $applyError.set((e as Error).message)
  } finally {
    $applying.set(false)
    $applyPhase.set(null)
    $download.set(null)
    $fileProgress.set(null)
    $localFileRequest.set(null)
  }
}

// ---------------------------------------------------------------------------
// Catalog mode: greenfield plan review + bundle download
// ---------------------------------------------------------------------------

/** Resolve the cart greenfield (no installed state) for review. */
export function buildCatalogPlan(): void {
  const index = $index.get()
  if (!index) return
  $planFailure.set(null)
  $catalogPlan.set(null)
  $bundleDone.set(null)
  const result = resolve(index, {
    install: $cartInstall.get().map((c) => ({
      id: c.id,
      ...(c.version !== undefined ? { range: `=${c.version}` } : {}),
    })),
    remove: [],
    installed: {},
    platform: $platform.get(),
  })
  if (result.ok) $catalogPlan.set(result)
  else $planFailure.set(result)
}

/**
 * Recommends surfaced by a plan: mods in the target set recommend these,
 * but they are neither in the plan nor installed. Never enforced — just
 * shown so the user can add them deliberately. Pure.
 */
export function recommendHints(
  index: ToyboxIndex | null,
  installed: InstalledMod[],
  resolution: Resolution | null,
): RecommendHint[] {
  if (!resolution || !index) return []
  const present = new Set(Object.keys(resolution.target).map((k) => k.toLowerCase()))
  for (const m of installed) present.add(m.id.toLowerCase())
  const hints: RecommendHint[] = []
  const seen = new Set<string>()
  for (const t of Object.values(resolution.target)) {
    const mod = index.mods.find((m) => m.id === t.id)
    const release = mod?.releases.find((r) => r.version === t.version)
    for (const rec of release?.recommends ?? []) {
      const key = rec.id.toLowerCase()
      if (present.has(key) || seen.has(key)) continue
      if (!index.mods.some((m) => m.id.toLowerCase() === key)) continue
      seen.add(key)
      hints.push({ from: t.id, ...rec })
    }
  }
  return hints
}

/** Total download size of a greenfield plan. Pure. */
export function catalogDownloadBytes(
  index: ToyboxIndex | null,
  plan: Resolution | null,
  platform: Platform,
): number {
  if (!plan || !index) return 0
  let total = 0
  for (const target of Object.values(plan.target)) {
    const mod = index.mods.find((m) => m.id === target.id)
    const release = mod?.releases.find((r) => r.version === target.version)
    const artifact = release ? artifactForPlatform(release, platform) : null
    total += artifact?.size ?? 0
  }
  return total
}

/**
 * Build the greenfield bundle (verified end to end, exactly like an
 * install) and hand it to the browser as a .zip download.
 */
export async function downloadBundle(): Promise<void> {
  const index = $index.get()
  if (!index || $cartInstall.get().length === 0) return
  $bundling.set(true)
  $applyError.set(null)
  $bundleDone.set(null)
  try {
    const result = await buildModBundle(
      {
        index,
        select: $cartInstall.get(),
        platform: $platform.get(),
      },
      {
        manifestFor: (artifact) => catalogClient.fetchManifest(artifact).catch(() => null),
        resolveIndexRelative: (path) => catalogClient.resolveIndexRelative(path),
        onEvent: (e) => {
          switch (e.type) {
            case 'phase':
              $applyPhase.set(
                e.phase === 'downloading'
                  ? `Downloading ${e.modId}`
                  : e.phase === 'packing'
                    ? `Packing ${e.modId}`
                    : `Verifying ${e.modId}`,
              )
              if (e.phase !== 'downloading') $download.set(null)
              break
            case 'download':
              $download.set({
                modId: e.modId,
                received: e.progress.bytesReceived,
                total: e.progress.totalBytes,
              })
              break
            case 'file':
              $fileProgress.set({ modId: e.modId, path: e.path, index: 0, total: null })
              break
            case 'needs-local-file':
              $localFileRequest.set({
                modId: e.modId,
                artifact: e.artifact,
                provide: (file) => {
                  $localFileRequest.set(null)
                  e.provide(file)
                },
                abort: (reason) => {
                  $localFileRequest.set(null)
                  e.abort(reason)
                },
              })
              break
          }
        },
      },
    )
    if (!result.ok) {
      $planFailure.set(result)
      return
    }
    const url = URL.createObjectURL(result.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 120_000)
    $bundleDone.set({ filename: result.filename, contents: result.contents })
    $cartInstall.set([])
    $catalogPlan.set(null)
  } catch (e) {
    $applyError.set((e as Error).message)
  } finally {
    $bundling.set(false)
    $applyPhase.set(null)
    $download.set(null)
    $fileProgress.set(null)
    $localFileRequest.set(null)
  }
}

// ---------------------------------------------------------------------------
// Adoption / manifest / settings
// ---------------------------------------------------------------------------

export async function adopt(folderIndex: number, candidateIndex: number): Promise<string | null> {
  const scan = $scan.get()
  if (!toybox || !scan) return 'not ready'
  const entry = scan.foreign[folderIndex]
  const candidate = entry?.candidates[candidateIndex]
  if (!entry || !candidate) return 'candidate not found'
  const result = await toybox.adopt(entry, candidate)
  if (result.ok) {
    $installed.set(toybox.installedMods())
    await toybox.syncKsaManifest().catch(() => {})
    await rescan()
    return null
  }
  return `Content does not match ${entry.catalogMod?.id}@${candidate.release.version}: ${result.mismatches.slice(0, 5).join(', ')}`
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  if (!toybox) return
  await toybox.setModEnabled(id, enabled)
  $manifestEnabled.set({ ...$manifestEnabled.get(), [id.toLowerCase()]: enabled })
}

export async function refreshManifestState(): Promise<void> {
  if (!toybox) return
  const entries = await toybox.readKsaManifest()
  if (!entries) return
  const map: Record<string, boolean> = {}
  for (const e of entries) map[e.id.toLowerCase()] = e.enabled
  $manifestEnabled.set(map)
}

export async function saveSettings(patch: Partial<ToyboxSettings>): Promise<void> {
  if (!toybox) return
  $settings.set(await toybox.updateSettings(patch))
  if (patch.indexUrl !== undefined || patch.channel !== undefined) await refreshIndex()
}

export async function forgetMod(id: string): Promise<void> {
  if (!toybox) return
  await toybox.forget(id)
  $installed.set(toybox.installedMods())
  void rescan()
}
