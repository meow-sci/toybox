import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './hash.ts'
import { buildModBundle, type BundleEvent } from './bundle.ts'
import { artifact, index, makeZip, manifestOfZip, mod, release } from '../testing/fixtures.ts'
import { buildWorld, GATOS_1_1_0, PURRTTY_1_1_0, WORLD_INDEX_URL } from '../testing/world.ts'

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('buildModBundle: single mod (passthrough)', () => {
  it('returns the verified upstream zip byte-exact', async () => {
    const { fetchFn, zips } = buildWorld()
    const idxRes = await fetchFn(WORLD_INDEX_URL)
    const idx = await idxRes.json()
    const result = await buildModBundle(
      { index: idx, select: [{ id: 'purrTTY' }], platform: 'windows' },
      { fetchFn },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.via).toBe('original')
    expect(result.filename).toBe('purrTTY-1.1.0.zip')
    expect(result.contents).toEqual([{ id: 'purrTTY', version: '1.1.0' }])
    expect(sha256Hex(await blobBytes(result.blob))).toBe(zips.p110.sha256)
  })

  it('greenfield: recommends are NOT pulled in', async () => {
    const { fetchFn } = buildWorld()
    const idx = await (await fetchFn(WORLD_INDEX_URL)).json()
    const result = await buildModBundle(
      { index: idx, select: [{ id: 'gatOS' }], platform: 'windows' },
      { fetchFn },
    )
    expect(result.ok && result.contents).toEqual([{ id: 'gatOS', version: '1.1.0' }])
  })
})

describe('buildModBundle: multi-mod repack', () => {
  it('bundles the whole selection into one zip of mod folders', async () => {
    const { fetchFn } = buildWorld()
    const idx = await (await fetchFn(WORLD_INDEX_URL)).json()
    const events: BundleEvent[] = []
    const result = await buildModBundle(
      {
        index: idx,
        select: [{ id: 'gatOS' }, { id: 'purrTTY', version: '1.0.1' }],
        platform: 'windows',
      },
      { fetchFn, onEvent: (e) => events.push(e) },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.via).toBe('repacked')
    expect(result.contents).toEqual([
      { id: 'gatOS', version: '1.1.0' },
      { id: 'purrTTY', version: '1.0.1' },
    ])

    // Round-trip: the bundle extracts to exactly the mod folders.
    const entries = unzipSync(await blobBytes(result.blob))
    const paths = Object.keys(entries).filter((p) => !p.endsWith('/'))
    expect(paths.sort()).toEqual([
      'gatOS/gatOS.GameMod.dll',
      'gatOS/mod.toml',
      'purrTTY/mod.toml',
      'purrTTY/purrTTY.GameMod.dll',
    ])
    // Bytes survive the repack.
    expect(new TextDecoder().decode(entries['gatOS/mod.toml'])).toBe(GATOS_1_1_0['gatOS/mod.toml'])
    expect([...entries['purrTTY/purrTTY.GameMod.dll']!]).toEqual([1, 0, 1])
    expect(events.some((e) => e.type === 'download')).toBe(true)
    expect(events.some((e) => e.type === 'phase' && e.phase === 'packing')).toBe(true)
  })

  it('pulls required dependencies into the bundle', async () => {
    const lib = makeZip({ 'Lib/mod.toml': 'name = "Lib"\n' })
    const app = makeZip({ 'App/mod.toml': 'name = "App"\n' })
    const libArt = artifact({
      url: 'https://dl.test/Lib-1.0.0.zip',
      sha256: lib.sha256,
      size: lib.bytes.byteLength,
      root: 'Lib',
      installAs: 'Lib',
    })
    const appArt = artifact({
      url: 'https://dl.test/App-1.0.0.zip',
      sha256: app.sha256,
      size: app.bytes.byteLength,
      root: 'App',
      installAs: 'App',
    })
    const idx = index([
      mod('Lib', [release('1.0.0', [libArt])]),
      mod('App', [
        release('1.0.0', [appArt], {
          required: [{ id: 'Lib', range: '^1.0' }],
        }),
      ]),
    ])
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === libArt.url) return new Response(lib.blob)
      if (url === appArt.url) return new Response(app.blob)
      return new Response('nope', { status: 404 })
    }) as typeof fetch
    const result = await buildModBundle(
      { index: idx, select: [{ id: 'App' }], platform: 'windows' },
      { fetchFn },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.contents.map((c) => c.id)).toEqual(['App', 'Lib'])
    const entries = unzipSync(await blobBytes(result.blob))
    expect(
      Object.keys(entries)
        .filter((p) => !p.endsWith('/'))
        .sort(),
    ).toEqual(['App/mod.toml', 'Lib/mod.toml'])
  })
})

describe('buildModBundle: failure modes', () => {
  it('returns the resolution failure (with explanation) for impossible selections', async () => {
    const { fetchFn } = buildWorld()
    const idx = await (await fetchFn(WORLD_INDEX_URL)).json()
    const result = await buildModBundle(
      { index: idx, select: [{ id: 'gatOS' }], platform: 'linux' },
      { fetchFn },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.explanation).toContain('no artifact for platform "linux"')
  })

  it('verifies against the published file manifest during repack', async () => {
    const { fetchFn } = buildWorld()
    const idx = await (await fetchFn(WORLD_INDEX_URL)).json()
    // A manifest that disagrees with the real archive content.
    const zip = makeZip(PURRTTY_1_1_0)
    const badManifest = manifestOfZip(
      'purrTTY',
      '1.1.0',
      'universal',
      zip.sha256,
      PURRTTY_1_1_0,
      'purrTTY',
    )
    badManifest.files = badManifest.files.slice(1)
    const result = buildModBundle(
      { index: idx, select: [{ id: 'gatOS' }, { id: 'purrTTY' }], platform: 'windows' },
      { fetchFn, manifestFor: async (a) => (a.url.includes('purrTTY') ? badManifest : null) },
    )
    await expect(result).rejects.toThrow(/not in the published file manifest/)
  })

  it('offers the local-file fallback when the network path fails', async () => {
    const world = buildWorld()
    const idx = await (await world.fetchFn(WORLD_INDEX_URL)).json()
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://dl.test/') || url.includes('/artifacts/')) {
        throw new TypeError('Failed to fetch')
      }
      return world.fetchFn(input)
    }) as typeof fetch
    const zip = makeZip(PURRTTY_1_1_0)
    let asked = false
    const result = await buildModBundle(
      { index: idx, select: [{ id: 'purrTTY' }], platform: 'windows' },
      {
        fetchFn,
        onEvent: (e) => {
          if (e.type === 'needs-local-file') {
            asked = true
            e.provide(zip.blob)
          }
        },
      },
    )
    expect(asked).toBe(true)
    expect(result.ok && result.via).toBe('original')
  })
})
