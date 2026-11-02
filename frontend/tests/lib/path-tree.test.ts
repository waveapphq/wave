/**
 * Shared flat-path to nested-tree builder and its subtree byte rollup.
 *
 * Module: frontend/src/lib/path-tree.ts
 */

import { describe, it, expect } from 'vitest'
import { buildPathTree, subtreeSize, type PathTreeNode } from '@/lib/path-tree'

interface Entry {
  path: string
  size_bytes: number
}

const getPath = (entry: Entry): string => entry.path

function entry(path: string, sizeBytes = 0): Entry {
  return { path, size_bytes: sizeBytes }
}

function names(nodes: PathTreeNode<Entry>[]): string[] {
  return nodes.map((node) => node.name)
}

function find(nodes: PathTreeNode<Entry>[], name: string): PathTreeNode<Entry> {
  const node = nodes.find((candidate) => candidate.name === name)
  if (!node) throw new Error(`no node named ${name}`)
  return node
}

describe('buildPathTree - structure', () => {
  it('returns an empty forest for no items', () => {
    expect(buildPathTree<Entry>([], getPath)).toEqual([])
  })

  it('turns a single-segment path into a root leaf carrying its item', () => {
    const readme = entry('readme.md', 5)

    const roots = buildPathTree([readme], getPath)

    expect(roots).toHaveLength(1)
    expect(roots[0].name).toBe('readme.md')
    expect(roots[0].path).toBe('readme.md')
    expect(roots[0].item).toBe(readme)
    expect(roots[0].children).toEqual([])
  })

  it('nests folders from flat relative paths', () => {
    const roots = buildPathTree(
      [entry('logs/app.log', 10), entry('logs/db/query.log', 20), entry('readme.md', 5)],
      getPath
    )

    const logs = find(roots, 'logs')
    expect(names(logs.children)).toEqual(['app.log', 'db'])
    expect(names(find(logs.children, 'db').children)).toEqual(['query.log'])
  })

  it('accumulates the full path on every node', () => {
    const roots = buildPathTree([entry('a/b/c/d/e.txt', 1)], getPath)

    const a = find(roots, 'a')
    const b = find(a.children, 'b')
    const c = find(b.children, 'c')
    const d = find(c.children, 'd')
    const e = find(d.children, 'e.txt')

    expect([a.path, b.path, c.path, d.path, e.path]).toEqual([
      'a',
      'a/b',
      'a/b/c',
      'a/b/c/d',
      'a/b/c/d/e.txt',
    ])
  })

  it('leaves an implied intermediate folder without an item', () => {
    const roots = buildPathTree([entry('fixtures/users.csv', 12)], getPath)

    expect(find(roots, 'fixtures').item).toBeNull()
  })

  it('shares one node between two paths under the same folder', () => {
    const roots = buildPathTree(
      [entry('fixtures/users.csv', 12), entry('fixtures/orders.csv', 8)],
      getPath
    )

    expect(roots).toHaveLength(1)
    expect(names(find(roots, 'fixtures').children)).toEqual(['users.csv', 'orders.csv'])
  })
})

describe('buildPathTree - explicit directory entries', () => {
  it('attaches an explicit directory entry to the folder node its children build', () => {
    const dir = entry('fixtures')
    const roots = buildPathTree([dir, entry('fixtures/users.csv', 12)], getPath)

    const fixtures = find(roots, 'fixtures')
    expect(fixtures.item).toBe(dir)
    expect(names(fixtures.children)).toEqual(['users.csv'])
  })

  it('keeps an explicit directory entry that has no children', () => {
    const dir = entry('empty')
    const roots = buildPathTree([dir], getPath)

    const empty = find(roots, 'empty')
    expect(empty.item).toBe(dir)
    expect(empty.children).toEqual([])
  })

  it('attaches an explicit directory entry that arrives after its children', () => {
    const dir = entry('fixtures')
    const roots = buildPathTree([entry('fixtures/users.csv', 12), dir], getPath)

    expect(find(roots, 'fixtures').item).toBe(dir)
  })
})

describe('buildPathTree - ordering', () => {
  it('keeps the input order by default', () => {
    const roots = buildPathTree(
      [entry('readme.md', 5), entry('logs/app.log', 10), entry('data/rows.csv', 7)],
      getPath
    )

    expect(names(roots)).toEqual(['readme.md', 'logs', 'data'])
  })

  it('puts folders before files at the root when asked', () => {
    const roots = buildPathTree(
      [entry('readme.md', 5), entry('logs/app.log', 10), entry('data/rows.csv', 7)],
      getPath,
      { order: 'folders-first' }
    )

    expect(names(roots)).toEqual(['data', 'logs', 'readme.md'])
  })

  it('puts folders before files inside a folder', () => {
    const roots = buildPathTree(
      [entry('logs/app.log', 10), entry('logs/db/query.log', 20)],
      getPath,
      { order: 'folders-first' }
    )

    expect(names(find(roots, 'logs').children)).toEqual(['db', 'app.log'])
  })

  it('orders siblings case-insensitively', () => {
    const roots = buildPathTree(
      [entry('Beta.txt', 1), entry('alpha.txt', 1), entry('Gamma.txt', 1)],
      getPath,
      { order: 'folders-first' }
    )

    expect(names(roots)).toEqual(['alpha.txt', 'Beta.txt', 'Gamma.txt'])
  })

  it('orders folders case-insensitively too', () => {
    const roots = buildPathTree(
      [entry('Zebra/a.txt', 1), entry('apple/b.txt', 1), entry('Mango/c.txt', 1)],
      getPath,
      { order: 'folders-first' }
    )

    expect(names(roots)).toEqual(['apple', 'Mango', 'Zebra'])
  })
})

describe('subtreeSize', () => {
  it('returns a leaf item its own size', () => {
    const roots = buildPathTree([entry('readme.md', 512)], getPath)

    expect(subtreeSize(find(roots, 'readme.md'))).toBe(512)
  })

  it('aggregates every file directly inside a folder', () => {
    const roots = buildPathTree(
      [entry('fixtures/users.csv', 100), entry('fixtures/orders.csv', 50)],
      getPath
    )

    expect(subtreeSize(find(roots, 'fixtures'))).toBe(150)
  })

  it('aggregates nested folders as well', () => {
    const roots = buildPathTree(
      [
        entry('fixtures/users.csv', 100),
        entry('fixtures/deep/orders.csv', 50),
        entry('fixtures/deep/deeper/rows.csv', 25),
      ],
      getPath
    )

    expect(subtreeSize(find(roots, 'fixtures'))).toBe(175)
  })

  it('returns zero for an empty folder', () => {
    const roots = buildPathTree([entry('empty')], getPath)

    expect(subtreeSize(find(roots, 'empty'))).toBe(0)
  })

  it('counts only the subtree it is asked about', () => {
    const roots = buildPathTree(
      [entry('a/one.csv', 10), entry('b/two.csv', 90)],
      getPath
    )

    expect(subtreeSize(find(roots, 'a'))).toBe(10)
    expect(subtreeSize(find(roots, 'b'))).toBe(90)
  })
})
