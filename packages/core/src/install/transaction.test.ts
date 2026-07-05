import { describe, expect, it } from 'vitest'
import { MemDir } from '../fs/memory.ts'
import { fileAtPath, pathExists, readTextIfExists } from '../fs/types.ts'
import { StateStore } from '../state/store.ts'
import type { ToyboxState } from '../state/types.ts'
import { artifact, makeZip, manifestOfZip, mod, release } from '../testing/fixtures.ts'
import type { AcquiredArtifact } from './download.ts'
import {
  applyTransaction,
  auditPlan,
  recoverIfNeeded,
  TransactionError,
  type PlannedOperation,
  type TransactionPlan,
} from './transaction.ts'

const V1_FILES = {
  'ModA/mod.toml': 'name = "ModA"\nversion = "1.0.0"\n',
  'ModA/ModA.dll': new Uint8Array([1, 1, 1]),
  'ModA/data/old-only.txt': 'removed in v2',
}
const V2_FILES = {
  'ModA/mod.toml': 'name = "ModA"\nversion = "2.0.0"\n',
  'ModA/ModA.dll': new Uint8Array([2, 2, 2, 2]),
  'ModA/data/new-only.txt': 'added in v2',
}

function setup(files: Record<string, string | Uint8Array>, version: string) {
  const zip = makeZip(files)
  const art = artifact({
    url: `https://example.com/ModA-${version}.zip`,
    sha256: zip.sha256,
    size: zip.bytes.byteLength,
    root: 'ModA',
    installAs: 'ModA',
  })
  const rel = release(version, [art])
  const theMod = mod('ModA', [rel])
  const acquired: AcquiredArtifact = { blob: zip.blob, sha256: zip.sha256, via: 'direct' }
  const manifest = manifestOfZip('ModA', version, 'universal', zip.sha256, files, 'ModA')
  return { zip, art, rel, theMod, acquired, manifest }
}

function installPlan(
  s: ReturnType<typeof setup>,
  over: Partial<Exclude<PlannedOperation, { kind: 'remove' }>> = {},
): TransactionPlan {
  return {
    operations: [
      {
        kind: 'install',
        mod: s.theMod,
        release: s.rel,
        artifact: s.art,
        autoInstalled: false,
        overwritesUnmanaged: false,
        ...over,
      },
    ],
    warnings: [],
    totalDownloadBytes: s.art.size,
  }
}

const NOW = () => '2026-07-05T12:00:00Z'

describe('applyTransaction: install', () => {
  it('installs files, records per-file digests, cleans staging + journal', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    const s = setup(V1_FILES, '1.0.0')
    const result = await applyTransaction(
      modsDir,
      store,
      { schema: 1, mods: {} },
      installPlan(s),
      { acquire: async () => s.acquired, manifestFor: async () => s.manifest },
      { now: NOW },
    )
    expect(result.installed).toEqual(['ModA'])
    expect(await readTextIfExists(modsDir, 'ModA/mod.toml')).toContain('ModA')
    expect(await pathExists(modsDir, 'ModA/data/old-only.txt')).toBe('file')

    const installed = result.state.mods.ModA!
    expect(installed.version).toBe('1.0.0')
    expect(installed.files).toHaveLength(3)
    expect(installed.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true)

    // Journal cleared, staging swept, state persisted.
    expect(await store.loadJournal()).toBeNull()
    expect(await pathExists(modsDir, '.toybox/staging')).not.toBe('dir')
    expect((await store.loadState()).mods.ModA!.version).toBe('1.0.0')
  })

  it('rejects artifacts that do not match the manifest (extra file)', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    const s = setup(V1_FILES, '1.0.0')
    const truncated = { ...s.manifest, files: s.manifest.files.slice(1) }
    await expect(
      applyTransaction(
        modsDir,
        store,
        { schema: 1, mods: {} },
        installPlan(s),
        { acquire: async () => s.acquired, manifestFor: async () => truncated },
        { now: NOW },
      ),
    ).rejects.toThrow(/not in the published file manifest/)
    // Live tree untouched, no leftovers.
    expect(await pathExists(modsDir, 'ModA')).not.toBe('dir')
    expect(await store.loadJournal()).toBeNull()
  })

  it('refuses to overwrite an unmanaged folder without confirmation', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    await (await fileAtPath(modsDir, 'ModA/handmade.txt', { create: true })).write('mine')
    const s = setup(V1_FILES, '1.0.0')
    await expect(
      applyTransaction(
        modsDir,
        store,
        { schema: 1, mods: {} },
        installPlan(s, { overwritesUnmanaged: true }),
        { acquire: async () => s.acquired },
        { now: NOW },
      ),
    ).rejects.toThrow(TransactionError)

    // With explicit consent it proceeds — and the unmanaged file survives
    // (toybox only writes its own files).
    await applyTransaction(
      modsDir,
      store,
      { schema: 1, mods: {} },
      installPlan(s, { overwritesUnmanaged: true }),
      { acquire: async () => s.acquired },
      { allowUnmanagedOverwrite: true, now: NOW },
    )
    expect(await readTextIfExists(modsDir, 'ModA/handmade.txt')).toBe('mine')
    expect(await pathExists(modsDir, 'ModA/mod.toml')).toBe('file')
  })

  it('rejects artifacts whose bytes do not match the declared sha256', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    const s = setup(V1_FILES, '1.0.0')
    const wrong = { ...s.acquired, sha256: 'f'.repeat(64) }
    await expect(
      applyTransaction(modsDir, store, { schema: 1, mods: {} }, installPlan(s), {
        acquire: async () => wrong,
      }),
    ).rejects.toThrow(/failed verification/)
  })
})

describe('applyTransaction: upgrade & remove', () => {
  async function installedV1(modsDir: MemDir, store: StateStore): Promise<ToyboxState> {
    const s1 = setup(V1_FILES, '1.0.0')
    const r = await applyTransaction(
      modsDir,
      store,
      { schema: 1, mods: {} },
      installPlan(s1),
      { acquire: async () => s1.acquired },
      { now: NOW },
    )
    return r.state
  }

  it('upgrade removes files dropped by the new version and keeps user files', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    const state = await installedV1(modsDir, store)
    // The player adds their own file inside the managed folder.
    await (await fileAtPath(modsDir, 'ModA/notes.md', { create: true })).write('my notes')

    const s2 = setup(V2_FILES, '2.0.0')
    const result = await applyTransaction(
      modsDir,
      store,
      state,
      installPlan(s2, { kind: 'upgrade', replaces: state.mods.ModA! }),
      { acquire: async () => s2.acquired },
      { now: NOW },
    )

    expect(await pathExists(modsDir, 'ModA/data/old-only.txt')).toBeNull() // stale file removed
    expect(await pathExists(modsDir, 'ModA/data/new-only.txt')).toBe('file')
    expect(await readTextIfExists(modsDir, 'ModA/notes.md')).toBe('my notes') // user file kept
    expect(result.state.mods.ModA!.version).toBe('2.0.0')
    const dll = result.state.mods.ModA!.files.find((f) => f.path === 'ModA.dll')!
    expect(dll.size).toBe(4)
  })

  it('remove deletes managed files, prunes empty dirs, keeps user files + folder', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    const state = await installedV1(modsDir, store)
    await (await fileAtPath(modsDir, 'ModA/notes.md', { create: true })).write('keep me')

    const result = await applyTransaction(
      modsDir,
      store,
      state,
      {
        operations: [{ kind: 'remove', installed: state.mods.ModA! }],
        warnings: [],
        totalDownloadBytes: 0,
      },
      { acquire: async () => Promise.reject(new Error('unused')) },
      { now: NOW },
    )
    expect(result.removed).toEqual(['ModA'])
    expect(result.state.mods.ModA).toBeUndefined()
    expect(await pathExists(modsDir, 'ModA/mod.toml')).toBeNull()
    expect(await pathExists(modsDir, 'ModA/data')).toBeNull() // pruned
    expect(await readTextIfExists(modsDir, 'ModA/notes.md')).toBe('keep me')
    expect(await pathExists(modsDir, 'ModA')).toBe('dir') // folder kept alive by user file
  })

  it('remove of a pristine install deletes the whole folder', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    const state = await installedV1(modsDir, store)
    await applyTransaction(
      modsDir,
      store,
      state,
      {
        operations: [{ kind: 'remove', installed: state.mods.ModA! }],
        warnings: [],
        totalDownloadBytes: 0,
      },
      { acquire: async () => Promise.reject(new Error('unused')) },
      { now: NOW },
    )
    expect(await pathExists(modsDir, 'ModA')).toBeNull()
  })
})

describe('auditPlan', () => {
  it('flags user-modified files before an upgrade', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    const s1 = setup(V1_FILES, '1.0.0')
    const r = await applyTransaction(
      modsDir,
      store,
      { schema: 1, mods: {} },
      installPlan(s1),
      { acquire: async () => s1.acquired },
      { now: NOW },
    )
    // Player edits a managed file (size changes).
    await (await fileAtPath(modsDir, 'ModA/mod.toml')).write('name = "ModA" # edited by hand\n')

    const s2 = setup(V2_FILES, '2.0.0')
    const warnings = await auditPlan(modsDir, [
      {
        kind: 'upgrade',
        mod: s2.theMod,
        release: s2.rel,
        artifact: s2.art,
        autoInstalled: false,
        replaces: r.state.mods.ModA!,
        overwritesUnmanaged: false,
      },
    ])
    expect(
      warnings.some((w) => w.message.includes('mod.toml') && w.message.includes('modified')),
    ).toBe(true)
  })
})

describe('crash recovery', () => {
  it('sweeps a staging-phase journal without touching the live tree', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    // Simulate a crash mid-staging: journal + partial staged files exist.
    await store.saveJournal({
      schema: 1,
      txId: 'deadbeef',
      startedAt: NOW(),
      phase: 'staging',
      steps: [],
    })
    const staging = await store.stagingDir('deadbeef', { create: true })
    await (await staging.getFile('partial.bin', { create: true })).write(new Uint8Array([1]))

    const report = await recoverIfNeeded(modsDir, store, { schema: 1, mods: {} })
    expect(report.action).toBe('swept-staging')
    expect(await store.loadJournal()).toBeNull()
    expect(await pathExists(modsDir, '.toybox/staging/deadbeef')).toBeNull()
  })

  it('rolls an applying-phase journal forward to completion', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    const s = setup(V1_FILES, '1.0.0')

    // Simulate: staging completed, apply crashed after promoting ONE file.
    const staging = await store.stagingDir('cafebabe', { create: true })
    const stagedRoot = await staging.getDir('ModA', { create: true })
    const entries = Object.entries(V1_FILES).map(([p, c]) => ({
      rel: p.slice('ModA/'.length),
      bytes: typeof c === 'string' ? new TextEncoder().encode(c) : c,
    }))
    // First file was already promoted (and removed from staging) pre-crash.
    const promoted = entries[0]!
    await (
      await fileAtPath(modsDir, `ModA/${promoted.rel}`, { create: true })
    ).write(promoted.bytes)
    for (const e of entries.slice(1)) {
      await (await fileAtPath(stagedRoot, e.rel, { create: true })).write(e.bytes)
    }
    const files = s.manifest.files
    await store.saveJournal({
      schema: 1,
      txId: 'cafebabe',
      startedAt: NOW(),
      phase: 'applying',
      steps: [
        {
          action: 'install',
          modId: 'ModA',
          version: '1.0.0',
          artifactKey: 'universal',
          installDir: 'ModA',
          autoInstalled: false,
          sourceUrl: s.art.url,
          sourceSha256: s.zip.sha256,
          files,
        },
      ],
    })

    const report = await recoverIfNeeded(modsDir, store, { schema: 1, mods: {} })
    expect(report.action).toBe('rolled-forward')
    expect(report.detail).toContain('installed ModA')
    // All files present and state rebuilt.
    for (const e of entries) {
      expect(await pathExists(modsDir, `ModA/${e.rel}`)).toBe('file')
    }
    const state = await store.loadState()
    expect(state.mods.ModA!.version).toBe('1.0.0')
    expect(await store.loadJournal()).toBeNull()
  })

  it('refuses to start a transaction while a journal exists', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    await store.saveJournal({ schema: 1, txId: 'x', startedAt: NOW(), phase: 'staging', steps: [] })
    const s = setup(V1_FILES, '1.0.0')
    await expect(
      applyTransaction(modsDir, store, { schema: 1, mods: {} }, installPlan(s), {
        acquire: async () => s.acquired,
      }),
    ).rejects.toThrow(/interrupted/)
  })

  it('reports nothing to do when no journal exists', async () => {
    const modsDir = new MemDir()
    const store = new StateStore(modsDir)
    const report = await recoverIfNeeded(modsDir, store, { schema: 1, mods: {} })
    expect(report.action).toBe('none')
  })
})
