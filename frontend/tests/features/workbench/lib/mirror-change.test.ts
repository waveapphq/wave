/**
 * changedMirrorNode tests - finds the block added or changed (position / label /
 * config) between two mirror snapshots, at any nesting depth. Metadata/variable
 * frames (no node change) and the initial load return null.
 */

import { describe, it, expect } from 'vitest'
import { changedMirrorNode } from '@/features/workbench/lib/mirror-change'

function node(id: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return { id, position: { x, y }, data: { label: id, config: {}, ...extra } }
}

describe('changedMirrorNode', () => {
  it('returns null for the initial snapshot (empty previous)', () => {
    expect(changedMirrorNode([], [node('a', 0, 0)])).toBeNull()
  })

  it('returns null when nothing changed', () => {
    const prev = [node('a', 0, 0), node('b', 10, 10)]
    const next = [node('a', 0, 0), node('b', 10, 10)]
    expect(changedMirrorNode(prev, next)).toBeNull()
  })

  it('detects a moved block', () => {
    const prev = [node('a', 0, 0), node('b', 10, 10)]
    const next = [node('a', 0, 0), node('b', 99, 10)]
    expect(changedMirrorNode(prev, next)).toBe('b')
  })

  it('detects an added block', () => {
    const prev = [node('a', 0, 0)]
    const next = [node('a', 0, 0), node('b', 10, 10)]
    expect(changedMirrorNode(prev, next)).toBe('b')
  })

  it('detects a config edit', () => {
    const prev = [node('a', 0, 0)]
    const next = [{ id: 'a', position: { x: 0, y: 0 }, data: { label: 'a', config: { url: 'x' } } }]
    expect(changedMirrorNode(prev, next)).toBe('a')
  })

  it('detects a label change', () => {
    const prev = [node('a', 0, 0)]
    const next = [{ id: 'a', position: { x: 0, y: 0 }, data: { label: 'renamed', config: {} } }]
    expect(changedMirrorNode(prev, next)).toBe('a')
  })

  it('detects a change nested inside a Function body', () => {
    const withChild = (childX: number) => [
      {
        id: 'f1',
        position: { x: 0, y: 0 },
        data: {
          label: 'f1',
          config: {},
          localDefinition: { workflow: { nodes: [node('child', childX, 5)] } },
        },
      },
    ]
    expect(changedMirrorNode(withChild(0), withChild(50))).toBe('child')
  })

  it('ignores a variable-only frame (nodes identical)', () => {
    const nodes = [node('a', 0, 0), node('b', 10, 10)]
    expect(changedMirrorNode(nodes, nodes.map((n) => ({ ...n })))).toBeNull()
  })
})
