/**
 * A complete fake ecosystem (index + manifests + artifact downloads behind a
 * stubbed fetch), shaped exactly like the compiled toybox-index output.
 * Shared by the node integration suite and the real-browser (OPFS) suite.
 */

import { artifact, index, jsonResponse, makeZip, manifestOfZip, mod, release } from './fixtures.ts'

export const WORLD_INDEX_URL = 'https://index.test/v1/index.json'

export const PURRTTY_1_0_1 = {
  'purrTTY/mod.toml': 'name = "purrTTY"\nversion = "1.0.1"\n',
  'purrTTY/purrTTY.GameMod.dll': new Uint8Array([1, 0, 1]),
}
export const PURRTTY_1_1_0 = {
  'purrTTY/mod.toml': 'name = "purrTTY"\nversion = "1.1.0"\n',
  'purrTTY/purrTTY.GameMod.dll': new Uint8Array([1, 1, 0, 0]),
  'purrTTY/TerminalThemes/dracula.toml': 'theme',
}
export const GATOS_1_1_0 = {
  'gatOS/mod.toml': 'name = "gatOS"\nversion = "1.1.0"\n',
  'gatOS/gatOS.GameMod.dll': new Uint8Array([42]),
}

export function buildWorld() {
  const p101 = makeZip(PURRTTY_1_0_1)
  const p110 = makeZip(PURRTTY_1_1_0)
  const g110 = makeZip(GATOS_1_1_0)

  const p101art = artifact({
    url: 'https://dl.test/purrTTY-1.0.1.zip',
    sha256: p101.sha256,
    size: p101.bytes.byteLength,
    root: 'purrTTY',
    installAs: 'purrTTY',
    manifest: 'manifests/purrtty/1.0.1.universal.json',
  })
  const p110art = artifact({
    url: 'https://dl.test/purrTTY-1.1.0.zip',
    sha256: p110.sha256,
    size: p110.bytes.byteLength,
    root: 'purrTTY',
    installAs: 'purrTTY',
    manifest: 'manifests/purrtty/1.1.0.universal.json',
    mirror: 'mods/purrtty/artifacts/1.1.0.universal.zip',
  })
  const g110art = artifact({
    key: 'windows',
    platforms: ['windows'],
    url: 'https://dl.test/gatOS-windows-1.1.0.zip',
    sha256: g110.sha256,
    size: g110.bytes.byteLength,
    root: 'gatOS',
    installAs: 'gatOS',
    manifest: 'manifests/gatos/1.1.0.windows.json',
  })

  const idx = index([
    mod('purrTTY', [release('1.1.0', [p110art]), release('1.0.1', [p101art])], {
      summary: 'A terminal emulator for KSA',
      tags: ['terminal', 'utility'],
      readmePath: 'mods/purrtty/readme.md',
    }),
    mod(
      'gatOS',
      [
        release('1.1.0', [g110art], {
          recommends: [
            {
              id: 'purrTTY',
              range: '^1.0',
              description: 'Terminal sessions open inside purrTTY windows when it is installed.',
            },
          ],
        }),
      ],
      { summary: 'Alpine Linux in a QEMU microVM', tags: ['linux', 'telemetry'] },
    ),
  ])

  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    switch (url) {
      case WORLD_INDEX_URL:
        return jsonResponse(idx)
      case 'https://index.test/v1/mods/purrtty/readme.md':
        return new Response('# purrTTY\n\nA terminal emulator for KSA.')
      case 'https://index.test/v1/manifests/purrtty/1.0.1.universal.json':
        return jsonResponse(
          manifestOfZip('purrTTY', '1.0.1', 'universal', p101.sha256, PURRTTY_1_0_1, 'purrTTY'),
        )
      case 'https://index.test/v1/manifests/purrtty/1.1.0.universal.json':
        return jsonResponse(
          manifestOfZip('purrTTY', '1.1.0', 'universal', p110.sha256, PURRTTY_1_1_0, 'purrTTY'),
        )
      case 'https://index.test/v1/manifests/gatos/1.1.0.windows.json':
        return jsonResponse(
          manifestOfZip('gatOS', '1.1.0', 'windows', g110.sha256, GATOS_1_1_0, 'gatOS'),
        )
      case 'https://dl.test/purrTTY-1.0.1.zip':
        return new Response(p101.blob)
      case 'https://dl.test/purrTTY-1.1.0.zip':
      case 'https://index.test/v1/mods/purrtty/artifacts/1.1.0.universal.zip':
        return new Response(p110.blob)
      case 'https://dl.test/gatOS-windows-1.1.0.zip':
        return new Response(g110.blob)
      default:
        return new Response('not found', { status: 404 })
    }
  }) as typeof fetch

  return { idx, fetchFn, zips: { p101, p110, g110 } }
}
