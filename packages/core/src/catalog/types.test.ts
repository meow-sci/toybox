import { describe, expect, it } from 'vitest'
import { IndexValidationError, parseArtifactManifest, parseIndex } from './types.ts'

const validIndex = {
  schema: 1,
  generatedAt: '2026-07-05T00:00:00Z',
  mods: [
    {
      id: 'purrTTY',
      name: 'purrTTY',
      summary: 'terminal',
      authors: ['Alex'],
      tags: ['terminal'],
      owners: ['alex-sherwin'],
      releases: [
        {
          version: '1.1.0',
          channel: 'stable',
          dependencies: [],
          artifacts: [
            {
              key: 'universal',
              platforms: ['*'],
              url: 'https://github.com/meow-sci/purrtty/releases/download/v1.1.0/purrTTY-1.1.0.zip',
              size: 24367747,
              sha256: '331b3ab82b669f45417cc74c6e55593727c8e12b0db83f8dc2f6acc232c2e4b0',
              root: 'purrTTY',
              installAs: 'purrTTY',
            },
          ],
        },
      ],
    },
  ],
}

describe('parseIndex', () => {
  it('parses a valid index and expands platform wildcards', () => {
    const idx = parseIndex(validIndex)
    expect(idx.mods[0]!.releases[0]!.artifacts[0]!.platforms).toEqual(['windows', 'linux', 'macos'])
  })

  it('parses the optional mirror path', () => {
    const doc = structuredClone(validIndex)
    ;(doc.mods[0]!.releases[0]!.artifacts[0]! as Record<string, unknown>).mirror =
      'mods/purrtty/artifacts/1.1.0.universal.zip'
    expect(parseIndex(doc).mods[0]!.releases[0]!.artifacts[0]!.mirror).toBe(
      'mods/purrtty/artifacts/1.1.0.universal.zip',
    )
  })

  it('accepts sha256 with the sha256: prefix (GitHub digest format)', () => {
    const doc = structuredClone(validIndex)
    doc.mods[0]!.releases[0]!.artifacts[0]!.sha256 = `sha256:${'a'.repeat(64)}`
    expect(parseIndex(doc).mods[0]!.releases[0]!.artifacts[0]!.sha256).toBe('a'.repeat(64))
  })

  it('rejects wrong schema, duplicate ids, bad hashes, http urls, empty artifacts', () => {
    expect(() => parseIndex({ ...validIndex, schema: 2 })).toThrow(IndexValidationError)

    const dup = structuredClone(validIndex)
    dup.mods.push(structuredClone(dup.mods[0]!))
    expect(() => parseIndex(dup)).toThrow(/duplicate/)

    const badHash = structuredClone(validIndex)
    badHash.mods[0]!.releases[0]!.artifacts[0]!.sha256 = 'nope'
    expect(() => parseIndex(badHash)).toThrow(/sha256/)

    const httpUrl = structuredClone(validIndex)
    httpUrl.mods[0]!.releases[0]!.artifacts[0]!.url = 'http://insecure.example/x.zip'
    expect(() => parseIndex(httpUrl)).toThrow(/https/)

    const noArtifacts = structuredClone(validIndex) as Record<string, unknown>
    ;(noArtifacts.mods as Record<string, unknown>[])[0]!.releases = [
      { version: '1.0.0', artifacts: [] },
    ]
    expect(() => parseIndex(noArtifacts)).toThrow(/non-empty/)
  })

  it('rejects malformed mod ids', () => {
    const bad = structuredClone(validIndex)
    bad.mods[0]!.id = '../escape'
    expect(() => parseIndex(bad)).toThrow(/bad mod id/)
  })
})

describe('parseArtifactManifest', () => {
  it('parses valid manifests and rejects unclean paths', () => {
    const m = parseArtifactManifest({
      schema: 1,
      modId: 'purrTTY',
      version: '1.1.0',
      artifactKey: 'universal',
      sha256: 'a'.repeat(64),
      files: [{ path: 'mod.toml', size: 10, sha256: 'b'.repeat(64) }],
    })
    expect(m.files).toHaveLength(1)

    expect(() =>
      parseArtifactManifest({
        schema: 1,
        modId: 'x',
        version: '1',
        sha256: 'a'.repeat(64),
        files: [{ path: '../evil', size: 1, sha256: 'b'.repeat(64) }],
      }),
    ).toThrow(/clean relative path/)
  })
})
