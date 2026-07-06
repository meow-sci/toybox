import { describe, expect, it } from 'vitest'
import { MemDir } from '../fs/memory.ts'
import { fileAtPath } from '../fs/types.ts'
import { sha256Hex } from '../install/hash.ts'
import type { ToyboxState } from '../state/types.ts'
import { artifact, index, makeZip, manifestOfZip, mod, release } from '../testing/fixtures.ts'
import { adoptFolder, scanModsDir, verifyInstalled } from './scan.ts'

const FILES = {
  'purrTTY/mod.toml': 'name = "purrTTY"\nversion = "1.1.0"\n',
  'purrTTY/purrTTY.GameMod.dll': new Uint8Array([7, 7, 7]),
}
const zip = makeZip(FILES)
const art = artifact({
  url: 'https://example.com/purrTTY-1.1.0.zip',
  sha256: zip.sha256,
  size: zip.bytes.byteLength,
  root: 'purrTTY',
  installAs: 'purrTTY',
  manifest: 'manifests/purrtty/1.1.0.universal.json',
})
const manifest = manifestOfZip('purrTTY', '1.1.0', 'universal', zip.sha256, FILES, 'purrTTY')
const idx = index([mod('purrTTY', [release('1.1.0', [art])])])
const manifestFor = async () => manifest

async function writeFiles(modsDir: MemDir, files: Record<string, string | Uint8Array>) {
  for (const [p, c] of Object.entries(files)) {
    await (await fileAtPath(modsDir, p, { create: true })).write(c)
  }
}

function installedState(): ToyboxState {
  return {
    schema: 1,
    mods: {
      purrTTY: {
        id: 'purrTTY',
        version: '1.1.0',
        artifactKey: 'universal',
        installDir: 'purrTTY',
        installedAt: '2026-07-01T00:00:00Z',
        autoInstalled: false,
        source: { url: art.url, sha256: art.sha256 },
        files: manifest.files,
        origin: 'index',
      },
    },
  }
}

describe('scanModsDir: managed', () => {
  it('reports ok for a pristine managed install', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, FILES)
    const result = await scanModsDir(modsDir, installedState(), idx, { manifestFor })
    expect(result.managed[0]).toMatchObject({ status: 'ok', problems: [] })
    expect(result.foreign).toEqual([])
  })

  it('reports modified when sizes drift and missing when files vanish', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, FILES)
    await (await fileAtPath(modsDir, 'purrTTY/mod.toml')).write('tampered content here')
    const modified = await scanModsDir(modsDir, installedState(), idx, { manifestFor })
    expect(modified.managed[0]!.status).toBe('modified')

    const gone = new MemDir()
    const result = await scanModsDir(gone, installedState(), idx, { manifestFor })
    expect(result.managed[0]!.status).toBe('missing')
  })
})

describe('scanModsDir: foreign folders', () => {
  it('classifies an exact manual install as adoptable', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, FILES) // present on disk but NOT in state
    const result = await scanModsDir(modsDir, { schema: 1, mods: {} }, idx, { manifestFor })
    expect(result.foreign).toHaveLength(1)
    const f = result.foreign[0]!
    expect(f.status).toBe('adoptable')
    expect(f.catalogMod!.id).toBe('purrTTY')
    expect(f.candidates[0]!.match).toBe('exact')
    expect(f.modToml).toMatchObject({ name: 'purrTTY', version: '1.1.0' })
  })

  it('classifies a recognized-but-changed folder as recognized-modified', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, {
      ...FILES,
      'purrTTY/mod.toml': 'name = "purrTTY"\nversion = "1.1.0"\n# user edit makes this longer\n',
    })
    const result = await scanModsDir(modsDir, { schema: 1, mods: {} }, idx, { manifestFor })
    expect(result.foreign[0]!.status).toBe('recognized-modified')
    expect(result.foreign[0]!.candidates[0]!.changedFiles).toContain('mod.toml')
  })

  it('classifies unknown folders as unknown and never touches them', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, { 'MysteryMod/mod.toml': 'name = "MysteryMod"\n' })
    const result = await scanModsDir(modsDir, { schema: 1, mods: {} }, idx, { manifestFor })
    expect(result.foreign[0]!).toMatchObject({ folder: 'MysteryMod', status: 'unknown' })
  })

  it('ignores the .toybox folder', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, { '.toybox/state.json': '{}' })
    const result = await scanModsDir(modsDir, { schema: 1, mods: {} }, idx, { manifestFor })
    expect(result.foreign).toEqual([])
  })

  it('recognizes by mod.toml name when the folder is cased differently', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, {
      'purrtty/mod.toml': 'name = "purrTTY"\nversion = "1.1.0"\n',
      'purrtty/purrTTY.GameMod.dll': new Uint8Array([7, 7, 7]),
    })
    const result = await scanModsDir(modsDir, { schema: 1, mods: {} }, idx, { manifestFor })
    expect(result.foreign[0]!.catalogMod?.id).toBe('purrTTY')
  })
})

describe('adoptFolder', () => {
  it('adopts on exact content match with full hashes recorded', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, FILES)
    const scan = await scanModsDir(modsDir, { schema: 1, mods: {} }, idx, { manifestFor })
    const result = await adoptFolder(
      modsDir,
      'purrTTY',
      scan.foreign[0]!.candidates[0]!,
      manifest,
      () => '2026-07-05T00:00:00Z',
    )
    expect(result.ok).toBe(true)
    expect(result.installed!.origin).toBe('adopted')
    expect(result.installed!.files).toHaveLength(2)
    expect(result.installed!.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses adoption when content differs, naming the files', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, {
      ...FILES,
      // Same size as the original DLL but different bytes: only full hashing catches this.
      'purrTTY/purrTTY.GameMod.dll': new Uint8Array([9, 9, 9]),
    })
    const scan = await scanModsDir(modsDir, { schema: 1, mods: {} }, idx, { manifestFor })
    expect(scan.foreign[0]!.status).toBe('adoptable') // size-match looked fine…
    const result = await adoptFolder(modsDir, 'purrTTY', scan.foreign[0]!.candidates[0]!, manifest)
    expect(result.ok).toBe(false) // …but hashes disagree
    expect(result.mismatches).toContain('purrTTY.GameMod.dll (content differs)')
  })
})

describe('verifyInstalled', () => {
  it('passes a pristine install and pinpoints tampered files', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, FILES)
    const state = installedState()
    const ok = await verifyInstalled(modsDir, state.mods.purrTTY!)
    expect(ok).toMatchObject({ ok: true, modified: [], missing: [] })

    // Same-size tamper: verify() must catch what the quick scan cannot.
    const tampered = new Uint8Array([9, 9, 9])
    expect(tampered.byteLength).toBe(3)
    expect(sha256Hex(tampered)).not.toBe(state.mods.purrTTY!.files[1]!.sha256)
    await (await fileAtPath(modsDir, 'purrTTY/purrTTY.GameMod.dll')).write(tampered)
    const bad = await verifyInstalled(modsDir, state.mods.purrTTY!)
    expect(bad.ok).toBe(false)
    expect(bad.modified).toEqual(['purrTTY.GameMod.dll'])
  })

  it('lists extra unmanaged files informationally', async () => {
    const modsDir = new MemDir()
    await writeFiles(modsDir, { ...FILES, 'purrTTY/user-config.toml': 'mine' })
    const result = await verifyInstalled(modsDir, installedState().mods.purrTTY!)
    expect(result.ok).toBe(true)
    expect(result.extra).toEqual(['user-config.toml'])
  })
})
