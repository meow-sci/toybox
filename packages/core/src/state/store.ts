/**
 * Reads/writes the `.toybox/` data folder inside the mods directory.
 */

import type { ToyDir } from '../fs/types.ts'
import { fileAtPath, pathExists, readTextIfExists } from '../fs/types.ts'
import type { ToyboxSettings, ToyboxState, TransactionJournal } from './types.ts'
import { DEFAULT_SETTINGS, emptyState } from './types.ts'

export const TOYBOX_DIR = '.toybox'
const STATE_PATH = `${TOYBOX_DIR}/state.json`
const SETTINGS_PATH = `${TOYBOX_DIR}/settings.json`
const JOURNAL_PATH = `${TOYBOX_DIR}/journal.json`
export const STAGING_DIR = `${TOYBOX_DIR}/staging`

export class StateStore {
  private readonly modsDir: ToyDir
  constructor(modsDir: ToyDir) {
    this.modsDir = modsDir
  }

  async loadState(): Promise<ToyboxState> {
    const text = await readTextIfExists(this.modsDir, STATE_PATH)
    if (!text) return emptyState()
    try {
      const parsed = JSON.parse(text) as ToyboxState
      if (parsed.schema !== 1 || typeof parsed.mods !== 'object' || parsed.mods === null) {
        throw new Error('unexpected shape')
      }
      return parsed
    } catch (e) {
      throw new Error(
        `mods/.toybox/state.json is corrupt (${(e as Error).message}). ` +
          'Move it aside to start fresh; installed mods can be re-adopted.',
      )
    }
  }

  async saveState(state: ToyboxState): Promise<void> {
    const f = await fileAtPath(this.modsDir, STATE_PATH, { create: true })
    await f.write(JSON.stringify(state, null, 2))
  }

  async loadSettings(): Promise<ToyboxSettings> {
    const text = await readTextIfExists(this.modsDir, SETTINGS_PATH)
    if (!text) return { ...DEFAULT_SETTINGS }
    try {
      const parsed = JSON.parse(text) as ToyboxSettings
      return { ...DEFAULT_SETTINGS, ...parsed }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  async saveSettings(settings: ToyboxSettings): Promise<void> {
    const f = await fileAtPath(this.modsDir, SETTINGS_PATH, { create: true })
    await f.write(JSON.stringify(settings, null, 2))
  }

  async loadJournal(): Promise<TransactionJournal | null> {
    const text = await readTextIfExists(this.modsDir, JOURNAL_PATH)
    if (!text) return null
    try {
      const parsed = JSON.parse(text) as TransactionJournal
      return parsed.schema === 1 ? parsed : null
    } catch {
      return null
    }
  }

  async saveJournal(journal: TransactionJournal): Promise<void> {
    const f = await fileAtPath(this.modsDir, JOURNAL_PATH, { create: true })
    await f.write(JSON.stringify(journal, null, 2))
  }

  async clearJournal(): Promise<void> {
    if ((await pathExists(this.modsDir, JOURNAL_PATH)) === 'file') {
      const dir = await this.modsDir.getDir(TOYBOX_DIR)
      await dir.remove('journal.json')
    }
  }

  async stagingDir(txId: string, opts?: { create?: boolean }): Promise<ToyDir> {
    const toybox = await this.modsDir.getDir(TOYBOX_DIR, opts)
    const staging = await toybox.getDir('staging', opts)
    return staging.getDir(txId, opts)
  }

  async removeStaging(txId?: string): Promise<void> {
    const has = await pathExists(this.modsDir, STAGING_DIR)
    if (has !== 'dir') return
    const toybox = await this.modsDir.getDir(TOYBOX_DIR)
    if (txId === undefined) {
      await toybox.remove('staging', { recursive: true })
      return
    }
    const staging = await toybox.getDir('staging')
    await staging.remove(txId, { recursive: true })
    let empty = true
    for await (const _ of staging.entries()) {
      empty = false
      break
    }
    if (empty) await toybox.remove('staging', { recursive: true })
  }
}
