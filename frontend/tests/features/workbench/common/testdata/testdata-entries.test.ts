/**
 * Test Data pure helpers (REQ-3.4.3.2).
 *
 * Module: frontend/src/features/workbench/common/testdata/testdata-entries.ts
 *
 * The server answers a flat listing sorted bytewise; the tree is built here
 * over the promoted path-tree helper, folders first then files, ordered
 * case-insensitively, with each folder carrying its subtree's bytes. The
 * filter keeps a match's ancestor folders so a nested hit stays reachable.
 */

import { describe, it, expect } from 'vitest'
import {
  buildTree,
  entryReference,
  filterEntries,
  parentOf,
} from '@/features/workbench/common/testdata/testdata-entries'
import type { TestDataEntry } from '@/features/tests/api/types'

function dir(path: string): TestDataEntry {
  return { path, kind: 'dir', size_bytes: 0, modified_at: '2026-09-01T10:00:00+00:00' }
}

function file(path: string, sizeBytes: number): TestDataEntry {
  return {
    path,
    kind: 'file',
    size_bytes: sizeBytes,
    modified_at: '2026-09-01T10:00:00+00:00',
  }
}

const ENTRIES: TestDataEntry[] = [
  dir('fixtures'),
  file('fixtures/users.csv', 18_432),
  file('fixtures/orders.json', 4_198),
  dir('payloads'),
  file('payloads/big.bin', 98_304),
  file('schema.xsd', 2_355),
]

function paths(entries: TestDataEntry[]): string[] {
  return entries.map((entry) => entry.path)
}

describe('filterEntries', () => {
  it('returns every entry for an empty query', () => {
    expect(filterEntries(ENTRIES, '')).toEqual(ENTRIES)
  })

  it('keeps a nested match together with its ancestor folder', () => {
    expect(paths(filterEntries(ENTRIES, 'users'))).toEqual(['fixtures', 'fixtures/users.csv'])
  })

  it('matches case-insensitively', () => {
    expect(paths(filterEntries(ENTRIES, 'USERS'))).toEqual(['fixtures', 'fixtures/users.csv'])
  })

  it('keeps a folder whose own name matches', () => {
    const result = paths(filterEntries(ENTRIES, 'payload'))

    expect(result).toContain('payloads')
    expect(result).not.toContain('schema.xsd')
  })

  it('returns nothing when no entry matches', () => {
    expect(filterEntries(ENTRIES, 'nothing-here')).toEqual([])
  })

  it('keeps every ancestor of a deeply nested match', () => {
    const deep = [dir('a'), dir('a/b'), dir('a/b/c'), file('a/b/c/target.txt', 10)]

    expect(paths(filterEntries(deep, 'target'))).toEqual([
      'a',
      'a/b',
      'a/b/c',
      'a/b/c/target.txt',
    ])
  })
})

describe('buildTree', () => {
  it('nests folders from the flat relative paths', () => {
    const [fixtures] = buildTree(ENTRIES)

    expect(fixtures.name).toBe('fixtures')
    expect(fixtures.path).toBe('fixtures')
    expect(fixtures.kind).toBe('dir')
    expect(fixtures.children.map((child) => child.path)).toEqual([
      'fixtures/orders.json',
      'fixtures/users.csv',
    ])
  })

  it('puts folders before files at every level', () => {
    expect(buildTree(ENTRIES).map((node) => node.name)).toEqual([
      'fixtures',
      'payloads',
      'schema.xsd',
    ])
  })

  it('orders siblings case-insensitively', () => {
    const mixed = [file('Beta.txt', 1), file('alpha.txt', 1), file('Gamma.txt', 1)]

    expect(buildTree(mixed).map((node) => node.name)).toEqual([
      'alpha.txt',
      'Beta.txt',
      'Gamma.txt',
    ])
  })

  it('gives each folder the aggregate size of its subtree', () => {
    const [fixtures, payloads] = buildTree(ENTRIES)

    expect(fixtures.sizeBytes).toBe(18_432 + 4_198)
    expect(payloads.sizeBytes).toBe(98_304)
  })

  it('aggregates nested folders into their parent', () => {
    const nested = [
      dir('a'),
      dir('a/b'),
      file('a/b/one.txt', 100),
      file('a/two.txt', 50),
    ]
    const [a] = buildTree(nested)

    expect(a.sizeBytes).toBe(150)
  })

  it('gives a file node its own size and no children', () => {
    const schema = buildTree(ENTRIES)[2]

    expect(schema.kind).toBe('file')
    expect(schema.sizeBytes).toBe(2_355)
    expect(schema.children).toEqual([])
    expect(schema.entry).toEqual(file('schema.xsd', 2_355))
  })

  it('keeps an explicit empty folder entry as a folder with no children', () => {
    const [empty] = buildTree([dir('scratch')])

    expect(empty.kind).toBe('dir')
    expect(empty.children).toEqual([])
    expect(empty.sizeBytes).toBe(0)
    expect(empty.entry).toEqual(dir('scratch'))
  })

  it('creates a folder node for a path with no explicit dir entry', () => {
    const [implied] = buildTree([file('implied/only.txt', 7)])

    expect(implied.name).toBe('implied')
    expect(implied.kind).toBe('dir')
    expect(implied.entry).toBeNull()
    expect(implied.sizeBytes).toBe(7)
  })

  it('returns nothing for an empty listing', () => {
    expect(buildTree([])).toEqual([])
  })
})

describe('entryReference', () => {
  it('builds the testdata reference for a nested path', () => {
    expect(entryReference('fixtures/users.csv')).toBe('testdata://fixtures/users.csv')
  })

  it('builds the testdata reference for a root-level path', () => {
    expect(entryReference('schema.xsd')).toBe('testdata://schema.xsd')
  })
})

describe('parentOf', () => {
  it('returns the containing folder of a nested path', () => {
    expect(parentOf('fixtures/nested/users.csv')).toBe('fixtures/nested')
  })

  it('returns the root for a path at the top level', () => {
    expect(parentOf('schema.xsd')).toBe('')
  })

  it('returns the root for the root itself', () => {
    expect(parentOf('')).toBe('')
  })
})
