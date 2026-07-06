/**
 * The app store: a thin reactive driver around the headless Toybox facade.
 *
 * The Toybox instance itself is intentionally NOT reactive — every screen
 * reads reactive snapshots this store mirrors after each engine operation.
 */

import {
  FsaDir,
  IndexClient,
  Toybox,
  artifactForPlatform,
  buildModBundle,
  detectPlatform,
  eligibleReleases,
  resolve,
  searchMods,
  type ApplyEvent,
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
import {
  forgetGrant,
  fsaSupported,
  initGrant,
  pickFolder,
  regrant,
  type GrantStatus,
} from './grant.ts'

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

class AppStore {
  /**
   * 'full'    — File System Access available: grant a folder, install/manage.
   * 'catalog' — any other browser: browse/search/resolve fully; the final
   *             install is replaced by a greenfield bundle (.zip) download.
   */
  mode = $state<'full' | 'catalog'>('full')
  platform = $state<Platform>(detectPlatform())

  // Grant / boot
  status = $state<GrantStatus | 'boot' | 'opening'>('boot')
  grant = $state<GrantInfo | null>(null)
  grantName = $state('')
  recovery = $state<RecoveryReport | null>(null)
  fatalError = $state<string | null>(null)

  // Catalog + installed state (reactive mirrors)
  view = $state<View>('browse')
  index = $state<ToyboxIndex | null>(null)
  indexError = $state<string | null>(null)
  installed = $state<InstalledMod[]>([])
  settings = $state<ToyboxSettings | null>(null)
  scan = $state<ScanResult | null>(null)
  scanning = $state(false)

  // Browse / search
  query = $state('')
  selectedModId = $state<string | null>(null)

  // Cart → plan → apply
  cartInstall = $state<CartItem[]>([])
  cartRemove = $state<string[]>([])
  planned = $state<PlannedTransaction | null>(null)
  planFailure = $state<ResolutionFailure | null>(null)
  planning = $state(false)
  applying = $state(false)
  applyPhase = $state<string | null>(null)
  applyError = $state<string | null>(null)
  applyDone = $state<{ installed: string[]; removed: string[] } | null>(null)
  download = $state<DownloadState | null>(null)
  fileProgress = $state<{
    modId: string
    path: string
    index: number
    total: number | null
  } | null>(null)
  localFileRequest = $state<LocalFileRequest | null>(null)

  // Catalog mode: greenfield plan + bundle download state
  catalogPlan = $state<Resolution | null>(null)
  bundling = $state(false)
  bundleDone = $state<{ filename: string; contents: { id: string; version: string }[] } | null>(
    null,
  )

  verifyResults = $state<Record<string, VerifyResult>>({})
  /** Lazily-fetched readmes: undefined = not requested, null = none/failed. */
  readmes = $state<Record<string, string | null | 'loading'>>({})

  private toybox: Toybox | null = null
  private handle: FileSystemDirectoryHandle | null = null
  private catalogClient = new IndexClient()

  // ---------------------------------------------------------------------
  // Boot / grant
  // ---------------------------------------------------------------------

  async boot(): Promise<void> {
    if (!fsaSupported()) {
      // The whole app works — browse, search, resolve, review — only the
      // final on-disk install is unavailable; installs become bundle
      // downloads.
      this.mode = 'catalog'
      this.status = 'ready'
      await this.refreshIndex()
      return
    }
    const { status, handle } = await initGrant()
    this.handle = handle
    this.status = status
    if (status === 'ready' && handle) await this.openHandle(handle)
  }

  async pick(): Promise<void> {
    const handle = await pickFolder()
    if (!handle) return
    this.handle = handle
    await this.openHandle(handle)
  }

  async regrantStored(): Promise<void> {
    if (!this.handle) return
    if (await regrant(this.handle)) await this.openHandle(this.handle)
  }

  async forget(): Promise<void> {
    await forgetGrant()
    this.toybox = null
    this.handle = null
    this.grant = null
    this.index = null
    this.installed = []
    this.status = 'none'
  }

  private async openHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    this.status = 'opening'
    this.fatalError = null
    try {
      const toybox = new Toybox(new FsaDir(handle))
      const { grant, recovery } = await toybox.open()
      this.toybox = toybox
      this.grant = grant
      this.grantName = handle.name
      this.recovery = recovery.recovered ? recovery : null
      this.settings = toybox.settings
      this.installed = toybox.installedMods()
      this.platform = toybox.platform
      this.status = 'ready'
      await this.refreshIndex()
      void this.rescan()
    } catch (e) {
      this.fatalError = (e as Error).message
      this.status = 'ready'
    }
  }

  // ---------------------------------------------------------------------
  // Index / search / scan
  // ---------------------------------------------------------------------

  async refreshIndex(): Promise<void> {
    this.indexError = null
    try {
      this.index = this.toybox
        ? await this.toybox.refreshIndex()
        : await this.catalogClient.fetchIndex()
      this.readmes = {}
    } catch (e) {
      this.indexError = (e as Error).message
    }
  }

  results(): SearchResult<CatalogMod>[] {
    if (!this.index) return []
    return searchMods(this.index.mods, this.query)
  }

  /** Platform-eligible releases, newest first — works in both modes. */
  releasesFor(mod: CatalogMod): CatalogRelease[] {
    return eligibleReleases(mod, this.platform)
  }

  artifactRef(release: CatalogRelease): CatalogArtifact | null {
    return artifactForPlatform(release, this.platform)
  }

  /** Kick off (or reuse) the lazy readme fetch for a mod. */
  loadReadme(mod: CatalogMod): void {
    if (this.readmes[mod.id] !== undefined) return
    if (!mod.readmePath) {
      this.readmes = { ...this.readmes, [mod.id]: null }
      return
    }
    this.readmes = { ...this.readmes, [mod.id]: 'loading' }
    const fetchIt = this.toybox
      ? this.toybox.readmeFor(mod)
      : this.catalogClient.fetchReadme(mod).catch(() => null)
    void fetchIt.then((text) => {
      this.readmes = { ...this.readmes, [mod.id]: text }
    })
  }

  /** Catalog mode only: retarget the bundle at a different OS. */
  setPlatform(platform: Platform): void {
    this.platform = platform
    this.invalidatePlan()
  }

  modById(id: string): CatalogMod | null {
    return this.index?.mods.find((m) => m.id === id) ?? null
  }

  installedById(id: string): InstalledMod | null {
    return this.installed.find((m) => m.id === id) ?? null
  }

  get engine(): Toybox | null {
    return this.toybox
  }

  async rescan(): Promise<void> {
    if (!this.toybox) return
    this.scanning = true
    try {
      this.scan = await this.toybox.scan()
    } catch {
      this.scan = null
    } finally {
      this.scanning = false
    }
  }

  async verify(modId: string): Promise<void> {
    if (!this.toybox) return
    const result = await this.toybox.verify(modId)
    this.verifyResults = { ...this.verifyResults, [modId]: result }
  }

  /** An update is available when a newer eligible release exists. */
  updateAvailable(installedMod: InstalledMod): string | null {
    if (!this.toybox) return null
    const mod = this.modById(installedMod.id)
    if (!mod) return null
    const newest = this.toybox.eligibleReleases(mod)[0]
    if (!newest || newest.version === installedMod.version) return null
    return newest.version
  }

  // ---------------------------------------------------------------------
  // Cart
  // ---------------------------------------------------------------------

  get cartSize(): number {
    return this.cartInstall.length + this.cartRemove.length
  }

  inCart(id: string): 'install' | 'remove' | null {
    if (this.cartInstall.some((c) => c.id === id)) return 'install'
    if (this.cartRemove.includes(id)) return 'remove'
    return null
  }

  addInstall(id: string, version?: string): void {
    this.cartRemove = this.cartRemove.filter((r) => r !== id)
    const rest = this.cartInstall.filter((c) => c.id !== id)
    this.cartInstall = [...rest, { id, ...(version !== undefined ? { version } : {}) }]
    this.invalidatePlan()
  }

  addRemove(id: string): void {
    this.cartInstall = this.cartInstall.filter((c) => c.id !== id)
    if (!this.cartRemove.includes(id)) this.cartRemove = [...this.cartRemove, id]
    this.invalidatePlan()
  }

  drop(id: string): void {
    this.cartInstall = this.cartInstall.filter((c) => c.id !== id)
    this.cartRemove = this.cartRemove.filter((r) => r !== id)
    this.invalidatePlan()
  }

  clearCart(): void {
    this.cartInstall = []
    this.cartRemove = []
    this.invalidatePlan()
  }

  private invalidatePlan(): void {
    this.planned = null
    this.planFailure = null
    this.applyDone = null
    this.applyError = null
    this.catalogPlan = null
    this.bundleDone = null
  }

  // ---------------------------------------------------------------------
  // Plan / apply
  // ---------------------------------------------------------------------

  async buildPlan(): Promise<void> {
    if (!this.toybox) return
    this.planning = true
    this.planned = null
    this.planFailure = null
    try {
      const result = await this.toybox.plan({
        install: this.cartInstall,
        remove: this.cartRemove,
      })
      if ('plan' in result) this.planned = result
      else this.planFailure = result
    } catch (e) {
      this.planFailure = {
        ok: false,
        explanation: (e as Error).message,
        problems: [],
      }
    } finally {
      this.planning = false
    }
  }

  async applyPlan(allowUnmanagedOverwrite: boolean): Promise<void> {
    if (!this.toybox || !this.planned) return
    this.applying = true
    this.applyError = null
    this.applyDone = null
    try {
      const result = await this.toybox.apply(
        this.planned,
        (e: ApplyEvent) => {
          switch (e.type) {
            case 'phase':
              this.applyPhase =
                e.phase.step === 'finalizing'
                  ? 'Finalizing…'
                  : `${e.phase.step === 'staging' ? 'Downloading & extracting' : e.phase.step === 'verifying' ? 'Verifying' : 'Applying'} ${e.phase.modId}`
              if (e.phase.step !== 'staging') this.download = null
              break
            case 'download':
              this.download = {
                modId: e.modId,
                received: e.progress.bytesReceived,
                total: e.progress.totalBytes,
              }
              break
            case 'file':
              this.fileProgress = { modId: e.modId, path: e.path, index: e.index, total: e.total }
              break
            case 'needs-local-file':
              this.localFileRequest = {
                modId: e.modId,
                artifact: e.artifact,
                provide: (file) => {
                  this.localFileRequest = null
                  e.provide(file)
                },
                abort: (reason) => {
                  this.localFileRequest = null
                  e.abort(reason)
                },
              }
              break
          }
        },
        { allowUnmanagedOverwrite },
      )
      this.applyDone = { installed: result.installed, removed: result.removed }
      this.installed = this.toybox.installedMods()
      this.clearCart()
      void this.rescan()
    } catch (e) {
      this.applyError = (e as Error).message
    } finally {
      this.applying = false
      this.applyPhase = null
      this.download = null
      this.fileProgress = null
      this.localFileRequest = null
    }
  }

  // ---------------------------------------------------------------------
  // Catalog mode: greenfield plan review + bundle download
  // ---------------------------------------------------------------------

  /** Resolve the cart greenfield (no installed state) for review. */
  buildCatalogPlan(): void {
    if (!this.index) return
    this.planFailure = null
    this.catalogPlan = null
    this.bundleDone = null
    const result = resolve(this.index, {
      install: this.cartInstall.map((c) => ({
        id: c.id,
        ...(c.version !== undefined ? { range: `=${c.version}` } : {}),
      })),
      remove: [],
      installed: {},
      platform: this.platform,
    })
    if (result.ok) this.catalogPlan = result
    else this.planFailure = result
  }

  catalogDownloadBytes(): number {
    if (!this.catalogPlan || !this.index) return 0
    let total = 0
    for (const target of Object.values(this.catalogPlan.target)) {
      const mod = this.index.mods.find((m) => m.id === target.id)
      const release = mod?.releases.find((r) => r.version === target.version)
      const artifact = release ? this.artifactRef(release) : null
      total += artifact?.size ?? 0
    }
    return total
  }

  /**
   * Build the greenfield bundle (verified end to end, exactly like an
   * install) and hand it to the browser as a .zip download.
   */
  async downloadBundle(): Promise<void> {
    if (!this.index || this.cartInstall.length === 0) return
    this.bundling = true
    this.applyError = null
    this.bundleDone = null
    try {
      const result = await buildModBundle(
        {
          index: this.index,
          select: this.cartInstall,
          platform: this.platform,
        },
        {
          manifestFor: (artifact) => this.catalogClient.fetchManifest(artifact).catch(() => null),
          resolveIndexRelative: (path) => this.catalogClient.resolveIndexRelative(path),
          onEvent: (e) => {
            switch (e.type) {
              case 'phase':
                this.applyPhase =
                  e.phase === 'downloading'
                    ? `Downloading ${e.modId}`
                    : e.phase === 'packing'
                      ? `Packing ${e.modId}`
                      : `Verifying ${e.modId}`
                if (e.phase !== 'downloading') this.download = null
                break
              case 'download':
                this.download = {
                  modId: e.modId,
                  received: e.progress.bytesReceived,
                  total: e.progress.totalBytes,
                }
                break
              case 'file':
                this.fileProgress = { modId: e.modId, path: e.path, index: 0, total: null }
                break
              case 'needs-local-file':
                this.localFileRequest = {
                  modId: e.modId,
                  artifact: e.artifact,
                  provide: (file) => {
                    this.localFileRequest = null
                    e.provide(file)
                  },
                  abort: (reason) => {
                    this.localFileRequest = null
                    e.abort(reason)
                  },
                }
                break
            }
          },
        },
      )
      if (!result.ok) {
        this.planFailure = result
        return
      }
      const url = URL.createObjectURL(result.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 120_000)
      this.bundleDone = { filename: result.filename, contents: result.contents }
      this.cartInstall = []
      this.catalogPlan = null
    } catch (e) {
      this.applyError = (e as Error).message
    } finally {
      this.bundling = false
      this.applyPhase = null
      this.download = null
      this.fileProgress = null
      this.localFileRequest = null
    }
  }

  // ---------------------------------------------------------------------
  // Adoption / manifest / settings
  // ---------------------------------------------------------------------

  async adopt(folderIndex: number, candidateIndex: number): Promise<string | null> {
    if (!this.toybox || !this.scan) return 'not ready'
    const entry = this.scan.foreign[folderIndex]
    const candidate = entry?.candidates[candidateIndex]
    if (!entry || !candidate) return 'candidate not found'
    const result = await this.toybox.adopt(entry, candidate)
    if (result.ok) {
      this.installed = this.toybox.installedMods()
      await this.toybox.syncKsaManifest().catch(() => {})
      await this.rescan()
      return null
    }
    return `Content does not match ${entry.catalogMod?.id}@${candidate.release.version}: ${result.mismatches.slice(0, 5).join(', ')}`
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!this.toybox) return
    await this.toybox.setModEnabled(id, enabled)
    this.manifestEnabled = { ...this.manifestEnabled, [id.toLowerCase()]: enabled }
  }

  manifestEnabled = $state<Record<string, boolean>>({})

  async refreshManifestState(): Promise<void> {
    if (!this.toybox) return
    const entries = await this.toybox.readKsaManifest()
    if (!entries) return
    const map: Record<string, boolean> = {}
    for (const e of entries) map[e.id.toLowerCase()] = e.enabled
    this.manifestEnabled = map
  }

  async saveSettings(patch: Partial<ToyboxSettings>): Promise<void> {
    if (!this.toybox) return
    this.settings = await this.toybox.updateSettings(patch)
    if (patch.indexUrl !== undefined || patch.channel !== undefined) await this.refreshIndex()
  }

  async forgetMod(id: string): Promise<void> {
    if (!this.toybox) return
    await this.toybox.forget(id)
    this.installed = this.toybox.installedMods()
    void this.rescan()
  }
}

export const app = new AppStore()
