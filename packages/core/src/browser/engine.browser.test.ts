/**
 * Real-browser end-to-end suite.
 *
 * Runs in headless Chromium (vitest browser mode) against OPFS —
 * navigator.storage.getDirectory() returns real FileSystemDirectoryHandle /
 * FileSystemFileHandle objects, so FsaDir, streaming writables, removeEntry
 * semantics, and the whole install engine run on the genuine File System
 * Access API rather than the in-memory test double.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsaDir } from '../fs/fsa.ts'
import {
  fileAtPath,
  listFilesRecursive,
  pathExists,
  readTextIfExists,
  type ToyDir,
} from '../fs/types.ts'
import { extractZipStream } from '../install/zip.ts'
import { Toybox, type PlannedTransaction } from '../manager.ts'
import { StateStore } from '../state/store.ts'
import { makeZip } from '../testing/fixtures.ts'
import { buildWorld, GATOS_1_1_0, PURRTTY_1_1_0, WORLD_INDEX_URL } from '../testing/world.ts'

let opfsRoot: FileSystemDirectoryHandle
let root: ToyDir

beforeEach(async () => {
  opfsRoot = await navigator.storage.getDirectory()
  // Isolate each test in a fresh directory.
  const name = `t-${Math.random().toString(36).slice(2)}`
  root = new FsaDir(await opfsRoot.getDirectoryHandle(name, { create: true }))
})

afterEach(async () => {
  for await (const [name] of (
    opfsRoot as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
  ).entries()) {
    await opfsRoot.removeEntry(name, { recursive: true }).catch(() => {})
  }
})

function expectPlanned(p: Awaited<ReturnType<Toybox['plan']>>): PlannedTransaction {
  if (!('plan' in p)) throw new Error(`plan failed: ${p.explanation}`)
  return p
}

async function makeToybox() {
  const { fetchFn } = buildWorld()
  await (await fileAtPath(root, 'mods/.keep', { create: true })).write('')
  const tb = new Toybox(root, { fetchFn, indexUrl: WORLD_INDEX_URL, platform: 'windows' })
  await tb.open()
  await tb.refreshIndex()
  return tb
}

describe('FsaDir over real OPFS handles', () => {
  it('creates nested trees, streams writes, lists and removes', async () => {
    const f = await fileAtPath(root, 'a/b/c/data.bin', { create: true })
    const w = await f.createWritable()
    await w.write(new Uint8Array([1, 2, 3]))
    await w.write(new Uint8Array([4, 5]))
    await w.close()
    expect([...(await f.bytes())]).toEqual([1, 2, 3, 4, 5])
    expect(await f.size()).toBe(5)
    expect(await listFilesRecursive(root)).toEqual(['a/b/c/data.bin'])
    expect(await pathExists(root, 'a/b')).toBe('dir')

    const a = await root.getDir('a')
    await a.remove('b', { recursive: true })
    expect(await pathExists(root, 'a/b')).toBeNull()
  })

  it('FSA writable semantics: content is published on close, not before', async () => {
    const f = await fileAtPath(root, 'x.txt', { create: true })
    await f.write('old')
    const w = await f.createWritable()
    await w.write(new TextEncoder().encode('new!'))
    // Not yet closed — reads still see the old content (real FSA behavior).
    expect(await f.text()).toBe('old')
    await w.close()
    expect(await f.text()).toBe('new!')
  })
})

describe('streaming zip extraction onto OPFS', () => {
  it('extracts a multi-file archive with verified digests', async () => {
    const big = new Uint8Array(500_000)
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 256
    const { blob } = makeZip({
      'Mod/mod.toml': 'name = "Mod"\n',
      'Mod/data/big.bin': big,
      'Mod/nested/deep/file.txt': 'hello',
    })
    const results = await extractZipStream(blob.stream() as ReadableStream<Uint8Array>, {
      file: async (path) => {
        const f = await fileAtPath(root, path, { create: true })
        const w = await f.createWritable()
        return { write: (c) => w.write(c), close: () => w.close(), abort: () => w.abort() }
      },
    })
    expect(results).toHaveLength(3)
    const bigFile = await fileAtPath(root, 'Mod/data/big.bin')
    expect(await bigFile.size()).toBe(big.byteLength)
    expect(await readTextIfExists(root, 'Mod/nested/deep/file.txt')).toBe('hello')
  })
})

describe('Toybox engine on real FSA handles', () => {
  it('full lifecycle: install → verify → upgrade → remove', async () => {
    const tb = await makeToybox()

    await tb.apply(expectPlanned(await tb.plan({ install: [{ id: 'purrTTY', version: '1.0.1' }] })))
    expect(await readTextIfExists(root, 'mods/purrTTY/mod.toml')).toContain('1.0.1')
    expect((await readTextIfExists(root, 'manifest.toml'))!).toContain('id = "purrTTY"')

    const verify = await tb.verify('purrTTY')
    expect(verify.ok).toBe(true)

    await tb.apply(expectPlanned(await tb.plan({ install: [{ id: 'purrTTY' }] })))
    expect(await readTextIfExists(root, 'mods/purrTTY/mod.toml')).toContain('1.1.0')
    expect(await pathExists(root, 'mods/purrTTY/TerminalThemes/dracula.toml')).toBe('file')

    await tb.apply(expectPlanned(await tb.plan({ remove: ['purrTTY'] })))
    expect(await pathExists(root, 'mods/purrTTY')).toBeNull()
    expect((await readTextIfExists(root, 'manifest.toml'))!).not.toContain('purrTTY')
  })

  it('state survives a fresh session over the same directory (browser-wipe survival)', async () => {
    const tb1 = await makeToybox()
    await tb1.apply(expectPlanned(await tb1.plan({ install: [{ id: 'gatOS' }] })))

    const { fetchFn } = buildWorld()
    const tb2 = new Toybox(root, { fetchFn, indexUrl: WORLD_INDEX_URL, platform: 'windows' })
    await tb2.open()
    await tb2.refreshIndex()
    expect(tb2.state.mods.gatOS!.version).toBe('1.1.0')
    const scan = await tb2.scan()
    expect(scan.managed[0]).toMatchObject({ status: 'ok' })
    const verify = await tb2.verify('gatOS')
    expect(verify.ok).toBe(true)
  })

  it('adopts a manual install after content verification', async () => {
    for (const [p, c] of Object.entries(PURRTTY_1_1_0)) {
      await (await fileAtPath(root, `mods/${p}`, { create: true })).write(c)
    }
    const tb = await makeToybox()
    const scan = await tb.scan()
    const entry = scan.foreign.find((f) => f.folder === 'purrTTY')!
    expect(entry.status).toBe('adoptable')
    const result = await tb.adopt(entry, entry.candidates[0]!)
    expect(result.ok).toBe(true)
    expect(tb.state.mods.purrTTY!.origin).toBe('adopted')
  })

  it('leaves user files alone through upgrade and remove', async () => {
    const tb = await makeToybox()
    await tb.apply(expectPlanned(await tb.plan({ install: [{ id: 'purrTTY', version: '1.0.1' }] })))
    await (await fileAtPath(root, 'mods/purrTTY/my-notes.md', { create: true })).write('mine')

    await tb.apply(expectPlanned(await tb.plan({ install: [{ id: 'purrTTY' }] })))
    expect(await readTextIfExists(root, 'mods/purrTTY/my-notes.md')).toBe('mine')

    await tb.apply(expectPlanned(await tb.plan({ remove: ['purrTTY'] })))
    expect(await readTextIfExists(root, 'mods/purrTTY/my-notes.md')).toBe('mine')
    expect(await pathExists(root, 'mods/purrTTY/mod.toml')).toBeNull()
  })

  it('crash recovery: an interrupted applying-phase journal rolls forward on open', async () => {
    // Install normally first to produce genuine staged content layouts.
    const tb1 = await makeToybox()
    await tb1.apply(expectPlanned(await tb1.plan({ install: [{ id: 'gatOS' }] })))

    // Simulate a crash: re-stage gatOS's files by hand and leave an
    // 'applying' journal (as if the process died mid-promotion).
    const modsDir = await root.getDir('mods')
    const store = new StateStore(modsDir)
    const staging = await store.stagingDir('crashed1', { create: true })
    const files = []
    for (const [p, c] of Object.entries(GATOS_1_1_0)) {
      const rel = p.slice('gatOS/'.length)
      const bytes = typeof c === 'string' ? new TextEncoder().encode(c) : c
      await (await fileAtPath(staging, `gatOS/${rel}`, { create: true })).write(bytes)
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      files.push({ path: rel, size: bytes.byteLength, sha256: digest })
    }
    // Delete the live install to simulate "old files removed, promotion not finished".
    await modsDir.remove('gatOS', { recursive: true })
    await store.saveJournal({
      schema: 1,
      txId: 'crashed1',
      startedAt: '2026-07-05T00:00:00Z',
      phase: 'applying',
      steps: [
        {
          action: 'install',
          modId: 'gatOS',
          version: '1.1.0',
          artifactKey: 'windows',
          installDir: 'gatOS',
          autoInstalled: false,
          sourceUrl: 'https://dl.test/gatOS-windows-1.1.0.zip',
          sourceSha256: '0'.repeat(64),
          files,
        },
      ],
    })

    // A fresh session must roll the transaction forward during open().
    const { fetchFn } = buildWorld()
    const tb2 = new Toybox(root, { fetchFn, indexUrl: WORLD_INDEX_URL, platform: 'windows' })
    const { recovery } = await tb2.open()
    expect(recovery.action).toBe('rolled-forward')
    expect(await readTextIfExists(root, 'mods/gatOS/mod.toml')).toContain('gatOS')
    expect(tb2.state.mods.gatOS!.version).toBe('1.1.0')
  })

  it('serves the local-file fallback path end to end', async () => {
    const world = buildWorld()
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://dl.test/')) throw new TypeError('Failed to fetch')
      return world.fetchFn(input)
    }) as typeof fetch
    await (await fileAtPath(root, 'mods/.keep', { create: true })).write('')
    const tb = new Toybox(root, { fetchFn, indexUrl: WORLD_INDEX_URL, platform: 'windows' })
    await tb.open()
    await tb.refreshIndex()

    const planned = expectPlanned(await tb.plan({ install: [{ id: 'purrTTY' }] }))
    const zip = makeZip(PURRTTY_1_1_0)
    await tb.apply(planned, (e) => {
      if (e.type === 'needs-local-file') e.provide(zip.blob)
    })
    expect(tb.state.mods.purrTTY!.version).toBe('1.1.0')
    expect(await pathExists(root, 'mods/purrTTY/purrTTY.GameMod.dll')).toBe('file')
  })
})
