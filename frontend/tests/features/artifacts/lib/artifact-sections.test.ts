/**
 * artifact-sections - pure grouping + tree building
 *
 * Module: frontend/src/features/artifacts/lib/artifact-sections.ts
 *
 * Groups a flat ArtifactMeta list into the four drill sections in fixed order:
 *   error.json        -> Failure summary
 *   report.json/html  -> Reports
 *   logs/**           -> Logs
 *   everything else   -> Files
 * and builds a nested path tree (used by the Logs/Files Tree view). Pure
 * functions, no React, no API.
 */

import { describe, it, expect, vi } from 'vitest'

const pathTreeSpies = vi.hoisted(() => ({ buildPathTree: vi.fn() }))

vi.mock('@/lib/path-tree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/path-tree')>()
  pathTreeSpies.buildPathTree.mockImplementation(actual.buildPathTree)
  return { ...actual, buildPathTree: pathTreeSpies.buildPathTree }
})
import {
  groupArtifactSections,
  buildArtifactTree,
  buildLogTree,
  knownFileDescription,
  logEntityKind,
  logScopeKey,
  nodeCounts,
  subtreeSize,
  type ArtifactTreeNode,
} from '@/features/artifacts/lib/artifact-sections'
import type { ArtifactMeta } from '@/features/artifacts/api/types'

function makeArtifact(path: string, extra: Partial<ArtifactMeta> = {}): ArtifactMeta {
  return {
    id: `20260609-120000-exec-1/${path}`,
    execution_id: 'exec-1',
    name: path.split('/').pop() ?? path,
    path,
    size_bytes: 10,
    content_type: 'text/plain',
    compression: null,
    created_at: '2026-06-09T12:00:00Z',
    ...extra,
  }
}

describe('groupArtifactSections', () => {
  it('returns four empty buckets for an empty list', () => {
    expect(groupArtifactSections([])).toEqual({
      failure: [],
      reports: [],
      logs: [],
      files: [],
    })
  })

  it('routes error.json to the failure bucket only', () => {
    const error = makeArtifact('error.json')
    const sections = groupArtifactSections([error])

    expect(sections.failure).toEqual([error])
    expect(sections.reports).toEqual([])
    expect(sections.logs).toEqual([])
    expect(sections.files).toEqual([])
  })

  it('routes report.json and report.html to the reports bucket', () => {
    const json = makeArtifact('report.json')
    const html = makeArtifact('report.html')

    const sections = groupArtifactSections([json, html])

    expect(sections.reports).toEqual([json, html])
    expect(sections.files).toEqual([])
  })

  it('routes anything under logs/ to the logs bucket', () => {
    const suiteLog = makeArtifact('logs/smoke/login.log')
    const regressionLog = makeArtifact('logs/nightly/smoke/login.log')

    const sections = groupArtifactSections([suiteLog, regressionLog])

    expect(sections.logs).toEqual([suiteLog, regressionLog])
    expect(sections.files).toEqual([])
  })

  it('routes everything else to the files bucket', () => {
    const csv = makeArtifact('output.csv')
    const png = makeArtifact('captures/screen.png')

    const sections = groupArtifactSections([csv, png])

    expect(sections.files).toEqual([csv, png])
  })

  it('does not treat a reporter.* plugin file as a report (exact name match)', () => {
    const reporter = makeArtifact('reporter.json')

    const sections = groupArtifactSections([reporter])

    expect(sections.reports).toEqual([])
    expect(sections.files).toEqual([reporter])
  })

  it('groups a removed (tombstone) artifact by its path like a live one', () => {
    const removedLog = makeArtifact('logs/smoke/login.log', {
      removed_at: '2026-06-09T13:00:00Z',
      removed_by: 'wparker',
    })

    const sections = groupArtifactSections([removedLog])

    expect(sections.logs).toEqual([removedLog])
  })
})

describe('buildArtifactTree', () => {
  it('returns top-level leaf nodes for flat files', () => {
    const a = makeArtifact('a.log')
    const b = makeArtifact('b.log')

    const tree = buildArtifactTree([a, b])

    expect(tree).toHaveLength(2)
    expect(tree[0]).toMatchObject({ name: 'a.log', path: 'a.log', artifact: a, children: [] })
    expect(tree[1]).toMatchObject({ name: 'b.log', path: 'b.log', artifact: b, children: [] })
  })

  it('nests a single path segment under a directory node', () => {
    const leaf = makeArtifact('smoke/login.log')

    const tree = buildArtifactTree([leaf])

    expect(tree).toHaveLength(1)
    const dir = tree[0]
    expect(dir).toMatchObject({ name: 'smoke', path: 'smoke', artifact: null })
    expect(dir.children).toHaveLength(1)
    expect(dir.children[0]).toMatchObject({
      name: 'login.log',
      path: 'smoke/login.log',
      artifact: leaf,
      children: [],
    })
  })

  it('merges siblings under a shared directory node', () => {
    const a = makeArtifact('smoke/a.log')
    const b = makeArtifact('smoke/b.log')

    const tree = buildArtifactTree([a, b])

    expect(tree).toHaveLength(1)
    expect(tree[0].children.map((c: ArtifactTreeNode) => c.name)).toEqual(['a.log', 'b.log'])
  })

  it('accumulates the full path on every node across deep nesting', () => {
    const leaf = makeArtifact('logs/nightly/smoke/login.log')

    const [logs] = buildArtifactTree([leaf])
    const nightly = logs.children[0]
    const smoke = nightly.children[0]
    const test = smoke.children[0]

    expect(logs.path).toBe('logs')
    expect(nightly.path).toBe('logs/nightly')
    expect(smoke.path).toBe('logs/nightly/smoke')
    expect(test.path).toBe('logs/nightly/smoke/login.log')
    expect(test.artifact).toBe(leaf)
  })
})

describe('buildLogTree', () => {
  it('unwraps the logs/ root so the forest reads suite > test', () => {
    const tree = buildLogTree([makeArtifact('logs/smoke/login.log')])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ name: 'smoke', path: 'logs/smoke' })
    expect(tree[0].children[0]).toMatchObject({ name: 'login.log', path: 'logs/smoke/login.log' })
  })

  it('surfaces standalone test leaves directly (no suite directory)', () => {
    const tree = buildLogTree([makeArtifact('logs/login.log')])

    expect(tree.map((node) => node.name)).toEqual(['login.log'])
  })

  it('passes a forest through unchanged when there is no logs root', () => {
    const tree = buildLogTree([makeArtifact('smoke/login.log')])

    expect(tree[0].name).toBe('smoke')
  })
})

describe('logEntityKind', () => {
  it('classifies a leaf as a test', () => {
    const [logs] = buildArtifactTree([makeArtifact('logs/smoke/login.log')])
    const test = logs.children[0].children[0]

    expect(logEntityKind(test)).toBe('test')
  })

  it('classifies a directory of leaves as a suite', () => {
    const [suite] = buildLogTree([makeArtifact('logs/smoke/login.log')])

    expect(logEntityKind(suite)).toBe('suite')
  })

  it('classifies a directory of directories as a regression', () => {
    const [regression] = buildLogTree([makeArtifact('logs/nightly/smoke/login.log')])

    expect(logEntityKind(regression)).toBe('regression')
  })
})

describe('logScopeKey', () => {
  it('strips the logs/ prefix and .log suffix to match error.json scope_path', () => {
    const [logs] = buildArtifactTree([makeArtifact('logs/smoke/login.log')])
    const test = logs.children[0].children[0]

    expect(logScopeKey(test)).toBe('smoke/login')
  })
})

describe('subtreeSize', () => {
  it('sums every leaf size beneath a node', () => {
    const a = makeArtifact('logs/smoke/a.log', { size_bytes: 30 })
    const b = makeArtifact('logs/smoke/b.log', { size_bytes: 12 })
    const [suite] = buildLogTree([a, b])

    expect(subtreeSize(suite)).toBe(42)
  })
})

describe('knownFileDescription', () => {
  it('describes the causal error.json', () => {
    expect(knownFileDescription('error.json')).toBe(
      'Causal error / fatal logs across all failures',
    )
  })

  it('describes the self-contained report.html', () => {
    expect(knownFileDescription('report.html')).toBe('Self-contained execution report')
  })

  it('describes the canonical report.json model', () => {
    expect(knownFileDescription('report.json')).toBe('Canonical report model')
  })

  it('returns undefined for an unknown file', () => {
    expect(knownFileDescription('cart.log')).toBeUndefined()
  })
})

describe('nodeCounts', () => {
  it('counts failed and total tests in a suite (unit = tests)', () => {
    const [suite] = buildLogTree([
      makeArtifact('logs/smoke/login.log'),
      makeArtifact('logs/smoke/logout.log'),
    ])

    expect(nodeCounts(suite, new Set(['smoke/login']))).toEqual({
      failed: 1,
      total: 2,
      unit: 'tests',
    })
  })

  it('reports zero failed when the suite is clean', () => {
    const [suite] = buildLogTree([makeArtifact('logs/smoke/login.log')])

    expect(nodeCounts(suite, new Set())).toEqual({ failed: 0, total: 1, unit: 'tests' })
  })

  it('counts failed leaves but totals suites for a regression (unit = suites)', () => {
    const [regression] = buildLogTree([
      makeArtifact('logs/nightly/smoke/a.log'),
      makeArtifact('logs/nightly/login/b.log'),
    ])

    expect(nodeCounts(regression, new Set(['nightly/smoke/a']))).toEqual({
      failed: 1,
      total: 2,
      unit: 'suites',
    })
  })
})

describe('buildArtifactTree - delegation to the shared path-tree helper', () => {
  it('builds the forest through buildPathTree instead of a private walker', () => {
    pathTreeSpies.buildPathTree.mockClear()

    buildArtifactTree([makeArtifact('smoke/login.log')])

    expect(pathTreeSpies.buildPathTree).toHaveBeenCalledTimes(1)
  })

  it('keeps the nested shape the drill already renders', () => {
    const leaf = makeArtifact('logs/smoke/login.log')

    const [logs] = buildArtifactTree([leaf])

    expect(logs).toMatchObject({ name: 'logs', path: 'logs', artifact: null })
    expect(logs.children[0]).toMatchObject({ name: 'smoke', path: 'logs/smoke', artifact: null })
    expect(logs.children[0].children[0]).toMatchObject({
      name: 'login.log',
      path: 'logs/smoke/login.log',
      artifact: leaf,
    })
  })

  it('keeps the aggregate size unchanged', () => {
    const a = makeArtifact('logs/smoke/a.log', { size_bytes: 30 })
    const b = makeArtifact('logs/smoke/b.log', { size_bytes: 12 })

    const [logs] = buildArtifactTree([a, b])

    expect(subtreeSize(logs)).toBe(42)
  })
})
