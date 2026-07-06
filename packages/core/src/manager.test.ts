/**
 * End-to-end integration of the Toybox facade over the in-memory filesystem
 * and a stubbed network: the exact engine the browser runs, exercised
 * headlessly. Mirrors the real toybox-index shape (purrTTY + gatOS).
 */

import { describe, expect, it } from 'vitest'
import { MemDir } from './fs/memory.ts'
import { fileAtPath, pathExists, readTextIfExists } from './fs/types.ts'
import { Toybox, type ApplyEvent, type PlannedTransaction } from './manager.ts'
import { makeZip } from './testing/fixtures.ts'
import { buildWorld, PURRTTY_1_1_0, WORLD_INDEX_URL as INDEX_URL } from './testing/world.ts'

async function makeToybox(root: MemDir) {
  const { fetchFn } = buildWorld()
  const tb = new Toybox(root, {
    fetchFn,
    indexUrl: INDEX_URL,
    platform: 'windows',
    now: () => '2026-07-05T12:00:00Z',
  })
  await tb.open()
  await tb.refreshIndex()
  return tb
}

function expectPlanned(p: Awaited<ReturnType<Toybox['plan']>>): PlannedTransaction {
  if (!('plan' in p)) throw new Error(`plan failed: ${p.explanation}`)
  return p
}

describe('Toybox: grant detection', () => {
  it('detects a KSA root grant (mods/ subfolder) and enables manifest sync', async () => {
    const root = new MemDir()
    await (await fileAtPath(root, 'mods/.keep', { create: true })).write('')
    const tb = new Toybox(root, { platform: 'windows', indexUrl: INDEX_URL })
    const { grant } = await tb.open()
    expect(grant).toEqual({ mode: 'ksa-root', manifestSync: true })
  })

  it('falls back to mods-only mode', async () => {
    const root = new MemDir()
    const tb = new Toybox(root, { platform: 'windows', indexUrl: INDEX_URL })
    const { grant } = await tb.open()
    expect(grant).toEqual({ mode: 'mods-only', manifestSync: false })
  })
})

describe('Toybox: full lifecycle', () => {
  it('install → upgrade → remove, with manifest.toml kept in sync', async () => {
    const root = new MemDir()
    await (await fileAtPath(root, 'mods/.keep', { create: true })).write('')
    const tb = await makeToybox(root)

    // --- install purrTTY 1.0.1 (pinned) ---
    const p1 = expectPlanned(await tb.plan({ install: [{ id: 'purrTTY', version: '1.0.1' }] }))
    expect(p1.changes).toEqual([
      expect.objectContaining({ kind: 'install', id: 'purrTTY', version: '1.0.1' }),
    ])
    const events: ApplyEvent[] = []
    await tb.apply(p1, (e) => events.push(e))
    expect(await readTextIfExists(root, 'mods/purrTTY/mod.toml')).toContain('1.0.1')
    expect(events.some((e) => e.type === 'download')).toBe(true)
    expect(events.some((e) => e.type === 'file')).toBe(true)
    // manifest.toml gained an enabled entry
    const manifestText = await readTextIfExists(root, 'manifest.toml')
    expect(manifestText).toContain('id = "purrTTY"')
    expect(manifestText).toContain('enabled = true')

    // --- upgrade to 1.1.0 ---
    const p2 = expectPlanned(await tb.plan({ install: [{ id: 'purrTTY' }] }))
    expect(p2.changes).toEqual([
      expect.objectContaining({ kind: 'upgrade', id: 'purrTTY', from: '1.0.1', to: '1.1.0' }),
    ])
    await tb.apply(p2)
    expect(await readTextIfExists(root, 'mods/purrTTY/mod.toml')).toContain('1.1.0')
    expect(await pathExists(root, 'mods/purrTTY/TerminalThemes/dracula.toml')).toBe('file')
    expect(tb.state.mods.purrTTY!.version).toBe('1.1.0')

    // --- install gatOS (recommends purrTTY: no forced changes) ---
    const p3 = expectPlanned(await tb.plan({ install: [{ id: 'gatOS' }] }))
    expect(p3.changes).toEqual([
      expect.objectContaining({ kind: 'install', id: 'gatOS', version: '1.1.0' }),
    ])
    await tb.apply(p3)
    expect((await readTextIfExists(root, 'manifest.toml'))!).toContain('id = "gatOS"')

    // --- verify integrity ---
    const verify = await tb.verify('purrTTY')
    expect(verify.ok).toBe(true)

    // --- remove gatOS: files gone, manifest entry pruned ---
    const p4 = expectPlanned(await tb.plan({ remove: ['gatOS'] }))
    await tb.apply(p4)
    expect(await pathExists(root, 'mods/gatOS')).toBeNull()
    expect((await readTextIfExists(root, 'manifest.toml'))!).not.toContain('gatOS')
    expect(tb.state.mods.gatOS).toBeUndefined()
  })

  it('re-opening from disk restores all state (browser-wipe survival)', async () => {
    const root = new MemDir()
    await (await fileAtPath(root, 'mods/.keep', { create: true })).write('')
    const tb1 = await makeToybox(root)
    await tb1.apply(expectPlanned(await tb1.plan({ install: [{ id: 'purrTTY' }] })))

    // Fresh instance over the same tree — as after clearing the browser.
    const tb2 = await makeToybox(root)
    expect(tb2.state.mods.purrTTY!.version).toBe('1.1.0')
    const scan = await tb2.scan()
    expect(scan.managed[0]).toMatchObject({ status: 'ok' })
  })

  it('adopts a manual install found on disk', async () => {
    const root = new MemDir()
    for (const [p, c] of Object.entries(PURRTTY_1_1_0)) {
      await (await fileAtPath(root, `mods/${p}`, { create: true })).write(c)
    }
    const tb = await makeToybox(root)
    const scan = await tb.scan()
    expect(scan.foreign[0]!.status).toBe('adoptable')
    const result = await tb.adopt(scan.foreign[0]!, scan.foreign[0]!.candidates[0]!)
    expect(result.ok).toBe(true)
    expect(tb.state.mods.purrTTY).toMatchObject({ version: '1.1.0', origin: 'adopted' })

    // An adopted mod upgrades exactly like an installed one.
    const plan = await tb.plan({ install: [{ id: 'purrTTY', version: '1.0.1' }] })
    expect(expectPlanned(plan).changes[0]).toMatchObject({ kind: 'downgrade' })
  })

  it('falls back to needs-local-file when the network path fails', async () => {
    const root = new MemDir()
    await (await fileAtPath(root, 'mods/.keep', { create: true })).write('')
    const world = buildWorld()
    const zip = makeZip(PURRTTY_1_1_0)
    // Network: index + manifests work, every artifact byte source fails
    // (mirror included — e.g. an offline Pages deploy or an old index).
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://dl.test/') || url.includes('/artifacts/')) {
        throw new TypeError('Failed to fetch')
      }
      return world.fetchFn(input)
    }) as typeof fetch
    const tb = new Toybox(root, { fetchFn, indexUrl: INDEX_URL, platform: 'windows' })
    await tb.open()
    await tb.refreshIndex()

    const planned = expectPlanned(await tb.plan({ install: [{ id: 'purrTTY' }] }))
    let asked = false
    await tb.apply(planned, (e) => {
      if (e.type === 'needs-local-file') {
        asked = true
        expect(e.artifact.url).toBe('https://dl.test/purrTTY-1.1.0.zip')
        e.provide(zip.blob) // the user hands over the file they downloaded
      }
    })
    expect(asked).toBe(true)
    expect(tb.state.mods.purrTTY!.version).toBe('1.1.0')
  })

  it('surfaces resolution failures with explanations instead of applying', async () => {
    const root = new MemDir()
    await (await fileAtPath(root, 'mods/.keep', { create: true })).write('')
    const tb = await makeToybox(root)
    const result = await tb.plan({ install: [{ id: 'NoSuchMod' }] })
    expect('plan' in result).toBe(false)
    if (!('plan' in result)) expect(result.explanation).toContain('NoSuchMod')
  })

  it('fetches readmes lazily by convention path (and caches misses)', async () => {
    const root = new MemDir()
    const tb = await makeToybox(root)
    const purrtty = tb.index!.mods.find((m) => m.id === 'purrTTY')!
    expect(purrtty.readmePath).toBe('mods/purrtty/readme.md')
    const readme = await tb.readmeFor(purrtty)
    expect(readme).toContain('# purrTTY')
    const gatos = tb.index!.mods.find((m) => m.id === 'gatOS')!
    expect(await tb.readmeFor(gatos)).toBeNull() // no readmePath declared
  })

  it('search finds mods fuzzily', async () => {
    const root = new MemDir()
    const tb = await makeToybox(root)
    expect(tb.search('term').map((r) => r.item.id)).toContain('purrTTY')
    expect(tb.search('qemu')[0]!.item.id).toBe('gatOS')
    expect(tb.search('gatos')[0]!.item.id).toBe('gatOS')
  })

  it('enable/disable rewrites manifest.toml without disturbing other entries', async () => {
    const root = new MemDir()
    await (await fileAtPath(root, 'mods/.keep', { create: true })).write('')
    await (
      await fileAtPath(root, 'manifest.toml', { create: true })
    ).write('[[mods]]\nid = "Core"\nenabled = true\nweird = "keep"\n')
    const tb = await makeToybox(root)
    await tb.apply(expectPlanned(await tb.plan({ install: [{ id: 'purrTTY' }] })))
    await tb.setModEnabled('purrTTY', false)
    const text = (await readTextIfExists(root, 'manifest.toml'))!
    expect(text).toContain('weird = "keep"')
    const entries = (await tb.readKsaManifest())!
    expect(entries.find((e) => e.id === 'purrTTY')!.enabled).toBe(false)
    expect(entries.find((e) => e.id === 'Core')!.enabled).toBe(true)
  })

  it('platform gating: gatOS windows artifact is invisible on linux', async () => {
    const root = new MemDir()
    const { fetchFn } = buildWorld()
    const tb = new Toybox(root, { fetchFn, indexUrl: INDEX_URL, platform: 'linux' })
    await tb.open()
    await tb.refreshIndex()
    const result = await tb.plan({ install: [{ id: 'gatOS' }] })
    expect('plan' in result).toBe(false)
    if (!('plan' in result))
      expect(result.explanation).toContain('no artifact for platform "linux"')
  })
})
