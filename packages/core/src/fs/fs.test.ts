import { describe, expect, it } from 'vitest'
import { MemDir } from './memory.ts'
import {
  deleteFileAndPrune,
  fileAtPath,
  listFilesRecursive,
  pathExists,
  readTextIfExists,
  splitPath,
} from './types.ts'

describe('splitPath', () => {
  it('splits and rejects traversal', () => {
    expect(splitPath('a/b/c')).toEqual(['a', 'b', 'c'])
    expect(splitPath('/a//b/')).toEqual(['a', 'b'])
    expect(() => splitPath('a/../b')).toThrow()
  })
})

describe('MemDir + path helpers', () => {
  it('creates nested files and reads them back', async () => {
    const root = new MemDir()
    const f = await fileAtPath(root, 'mods/purrTTY/mod.toml', { create: true })
    await f.write('name = "purrTTY"')
    expect(await readTextIfExists(root, 'mods/purrTTY/mod.toml')).toBe('name = "purrTTY"')
    expect(await pathExists(root, 'mods/purrTTY')).toBe('dir')
    expect(await pathExists(root, 'mods/nope')).toBeNull()
  })

  it('streaming writes publish on close only', async () => {
    const root = new MemDir()
    const f = await fileAtPath(root, 'x.bin', { create: true })
    const w = await f.createWritable()
    await w.write(new Uint8Array([1, 2]))
    await w.write(new Uint8Array([3]))
    await w.close()
    expect([...(await f.bytes())]).toEqual([1, 2, 3])
  })

  it('aborted writes leave the previous content', async () => {
    const root = new MemDir()
    const f = await fileAtPath(root, 'x.bin', { create: true })
    await f.write(new Uint8Array([9]))
    const w = await f.createWritable()
    await w.write(new Uint8Array([1]))
    await w.abort()
    expect([...(await f.bytes())]).toEqual([9])
  })

  it('listFilesRecursive lists deep paths', async () => {
    const root = new MemDir()
    await (await fileAtPath(root, 'a/b/c.txt', { create: true })).write('x')
    await (await fileAtPath(root, 'a/d.txt', { create: true })).write('y')
    const files = await listFilesRecursive(root)
    expect(files.sort()).toEqual(['a/b/c.txt', 'a/d.txt'])
  })

  it('deleteFileAndPrune removes empty parents but not shared ones', async () => {
    const root = new MemDir()
    await (await fileAtPath(root, 'a/b/c.txt', { create: true })).write('x')
    await (await fileAtPath(root, 'a/keep.txt', { create: true })).write('y')
    await deleteFileAndPrune(root, 'a/b/c.txt')
    expect(await pathExists(root, 'a/b')).toBeNull() // pruned
    expect(await pathExists(root, 'a/keep.txt')).toBe('file') // kept
    expect(await pathExists(root, 'a')).toBe('dir')
  })

  it('deleteFileAndPrune tolerates missing files', async () => {
    const root = new MemDir()
    await expect(deleteFileAndPrune(root, 'nope/nothing.txt')).resolves.toBeUndefined()
  })
})
