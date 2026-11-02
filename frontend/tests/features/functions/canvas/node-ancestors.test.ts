/**
 * indexNodeAncestors tests - maps every node id to its Function-ancestor drill
 * path (nodeId + shared flag), at any nesting depth.
 */

import { describe, it, expect } from 'vitest'
import { indexNodeAncestors, type AncestorNode } from '@/features/functions/canvas/node-ancestors'

function fnNode(id: string, lifecycle: 'local' | 'shared', children: AncestorNode[]): AncestorNode {
  return { id, data: { functionLifecycle: lifecycle, localDefinition: { workflow: { nodes: children } } } }
}

function leaf(id: string): AncestorNode {
  return { id, data: {} }
}

describe('indexNodeAncestors', () => {
  it('maps top-level nodes to an empty path', () => {
    const index = indexNodeAncestors([leaf('a'), leaf('b')])
    expect(index.get('a')).toEqual([])
    expect(index.get('b')).toEqual([])
  })

  it('maps a nested block to its local Function ancestor', () => {
    const index = indexNodeAncestors([fnNode('f1', 'local', [leaf('child')])])
    expect(index.get('f1')).toEqual([])
    expect(index.get('child')).toEqual([{ nodeId: 'f1', shared: false }])
  })

  it('marks a shared Function ancestor segment', () => {
    const index = indexNodeAncestors([fnNode('f1', 'shared', [leaf('child')])])
    expect(index.get('child')).toEqual([{ nodeId: 'f1', shared: true }])
  })

  it('resolves a deeply nested block to the full ancestor chain', () => {
    const index = indexNodeAncestors([
      fnNode('outer', 'local', [fnNode('inner', 'shared', [leaf('deep')])]),
    ])
    expect(index.get('deep')).toEqual([
      { nodeId: 'outer', shared: false },
      { nodeId: 'inner', shared: true },
    ])
  })

  it('returns undefined for an unknown node', () => {
    expect(indexNodeAncestors([leaf('a')]).get('nope')).toBeUndefined()
  })
})
