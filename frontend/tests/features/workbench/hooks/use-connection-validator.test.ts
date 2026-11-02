/**
 * useConnectionValidator Hook - Scope Isolation Tests
 *
 * Tests the try-catch scope isolation logic (REQ-3.2.2.6):
 * - findNodeScope traces backwards through edges to find try-catch scope
 * - Cross-scope connections are rejected
 * - Outer-to-inner and inner-to-occupied-outer connections are rejected
 * - Inner-to-free-outer and same-scope connections are allowed
 */

import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useConnectionValidator } from '@/features/workbench/hooks/use-connection-validator'

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
): { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null } {
  return { id: `e-${source}-${target}`, source, target, sourceHandle: sourceHandle ?? null, targetHandle: null }
}

function node(id: string, elementType?: string): { id: string; data?: Record<string, unknown> } {
  return elementType ? { id, data: { elementType } } : { id }
}

describe('useConnectionValidator - Scope Isolation (REQ-3.2.2.6)', () => {
  it('rejects cross-scope: source in try scope, target in catch scope', () => {
    const nodes = [node('tc1', 'try-catch-finally'), node('A'), node('B')]
    const edges = [edge('tc1', 'A', 'try'), edge('tc1', 'B', 'catch')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    expect(result.current.validate({ source: 'A', target: 'B' })).toEqual({ valid: false, reason: 'cross-scope' })
  })

  it('rejects outer-to-inner: source unscoped, target in try scope', () => {
    const nodes = [node('tc1', 'try-catch-finally'), node('A'), node('outer')]
    const edges = [edge('tc1', 'A', 'try')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    expect(result.current.validate({ source: 'outer', target: 'A' })).toEqual({ valid: false, reason: 'cross-scope' })
  })

  it('rejects inner-to-occupied-outer: source in scope, target unscoped with incoming edges', () => {
    const nodes = [node('tc1', 'try-catch-finally'), node('A'), node('outer1'), node('outer2')]
    const edges = [edge('tc1', 'A', 'try'), edge('outer1', 'outer2')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    // A is in tc1:try, outer2 is unscoped but has an incoming edge
    expect(result.current.validate({ source: 'A', target: 'outer2' })).toEqual({ valid: false, reason: 'cross-scope' })
  })

  it('allows inner-to-free-outer: source in scope, target unscoped with no incoming edges', () => {
    const nodes = [node('tc1', 'try-catch-finally'), node('A'), node('free')]
    const edges = [edge('tc1', 'A', 'try')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    expect(result.current.validate({ source: 'A', target: 'free' })).toEqual({ valid: true })
  })

  it('allows same scope: both nodes in try scope of same try-catch', () => {
    const nodes = [node('tc1', 'try-catch-finally'), node('A'), node('B')]
    // Both A and B are direct children of tc1's try handle
    const edges = [edge('tc1', 'A', 'try'), edge('tc1', 'B', 'try')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    expect(result.current.validate({ source: 'A', target: 'B' })).toEqual({ valid: true })
  })

  it('allows both unscoped: normal outer flow', () => {
    const nodes = [node('tc1', 'try-catch-finally'), node('outer1'), node('outer2')]
    const edges = [edge('tc1', 'X', 'try')] // unrelated scoped edge

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    expect(result.current.validate({ source: 'outer1', target: 'outer2' })).toEqual({ valid: true })
  })

  it('findNodeScope traverses multiple hops to find try-catch scope', () => {
    // Chain: tc1 --try--> hop1 --> hop2 --> hop3
    const nodes = [node('tc1', 'try-catch-finally'), node('hop1'), node('hop2'), node('hop3'), node('free')]
    const edges = [edge('tc1', 'hop1', 'try'), edge('hop1', 'hop2'), edge('hop2', 'hop3')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    // hop3 is 3 hops from tc1:try handle; connecting to free (no incoming) -> allowed
    expect(result.current.validate({ source: 'hop3', target: 'free' })).toEqual({ valid: true })

    // Make free occupied so it becomes outer flow -> reject
    const occupiedEdges = [...edges, edge('some-outer', 'free')]
    const occupiedNodes = [...nodes, node('some-outer')]

    const { result: result2 } = renderHook(() =>
      useConnectionValidator({ edges: occupiedEdges, nodes: occupiedNodes }),
    )
    expect(result2.current.validate({ source: 'hop3', target: 'free' })).toEqual({ valid: false, reason: 'cross-scope' })
  })

  it('rejects cross-scope between different try-catch nodes', () => {
    const nodes = [node('tc1', 'try-catch-finally'), node('tc2', 'try-catch-finally'), node('A'), node('C')]
    const edges = [edge('tc1', 'A', 'try'), edge('tc2', 'C', 'try')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    expect(result.current.validate({ source: 'A', target: 'C' })).toEqual({ valid: false, reason: 'cross-scope' })
  })

  it('BFS visited guard fires when shared ancestor is reachable via two paths', () => {
    // Diamond: X -> Y -> target, X -> Z -> target (no try-catch involved)
    // findNodeScope(target) BFS backwards: visits target -> Y,Z -> X,X
    // The second X in queue triggers visited.has(current) -> continue at L91.
    // The function returns null (outer flow) since no try-catch is found.
    const nodes = [node('X'), node('Y'), node('Z'), node('target'), node('other')]
    const edges = [
      edge('X', 'Y'), edge('X', 'Z'),
      edge('Y', 'target'), edge('Z', 'target'),
    ]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    // Both target and other are unscoped (no try-catch at all) -> allowed
    expect(result.current.validate({ source: 'target', target: 'other' })).toEqual({ valid: true })
  })

  // --- For Loop scope isolation (REQ-3.5.1.15) ---

  it('for loop body handle creates a scope', () => {
    const nodes = [node('for1', 'for'), node('A'), node('B')]
    const edges = [edge('for1', 'A', 'body'), edge('for1', 'B', 'body')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    // Both A and B are in for1:body scope -> allowed
    expect(result.current.validate({ source: 'A', target: 'B' })).toEqual({ valid: true })
  })

  it('rejects body-to-outer for for loop (cross-scope)', () => {
    const nodes = [node('for1', 'for'), node('A'), node('outer')]
    const edges = [edge('for1', 'A', 'body')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    // A is in for1:body scope, outer is unscoped -> reject outer-to-inner
    expect(result.current.validate({ source: 'outer', target: 'A' })).toEqual({ valid: false, reason: 'cross-scope' })
  })

  it('for loop then handle is NOT scoped (outer flow)', () => {
    const nodes = [node('for1', 'for'), node('A'), node('B')]
    const edges = [edge('for1', 'A', 'then'), edge('for1', 'B', 'body')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    // A is connected via 'then' (not scoped), B is in body scope -> cross-scope reject
    expect(result.current.validate({ source: 'A', target: 'B' })).toEqual({ valid: false, reason: 'cross-scope' })
  })

  // Every container that draws a body lane must scope it.
  it.each([
    ['while', 'while1'],
    ['for-each', 'foreach1'],
    ['remote-execution', 'remote1'],
  ])('scopes the body lane of a %s container', (elementType, id) => {
    const nodes = [node(id, elementType), node('A'), node('outer')]
    const edges = [edge(id, 'A', 'body')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    expect(result.current.validate({ source: 'outer', target: 'A' })).toEqual({
      valid: false,
      reason: 'cross-scope',
    })
  })

  it('rejects cross-scope between for loop body and try-catch try', () => {
    const nodes = [node('for1', 'for'), node('tc1', 'try-catch-finally'), node('A'), node('C')]
    const edges = [edge('for1', 'A', 'body'), edge('tc1', 'C', 'try')]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    expect(result.current.validate({ source: 'A', target: 'C' })).toEqual({ valid: false, reason: 'cross-scope' })
  })

  it('handles target with multiple incoming edges in reverseAdj', () => {
    // Node D has two incoming edges (from B and C) - exercises the reverseAdj list.push branch
    // Diamond: tc1 -> B -> D, tc1 -> C -> D (D has two parents in try scope)
    // Also tests BFS visited guard: when checking D's scope, BFS backwards hits both paths
    // to B and C, which both lead to tc1. The second path through the shared node exercises L91.
    const nodes = [
      node('tc1', 'try-catch-finally'),
      node('B'), node('C'), node('D'),
      node('mid'), // shared ancestor: B->mid and C->mid, mid->D
      node('E'),
    ]
    const edges = [
      edge('tc1', 'B', 'try'),
      edge('tc1', 'C', 'try'),
      edge('B', 'mid'),
      edge('C', 'mid'),   // mid has 2 incoming (reverseAdj push branch L72)
      edge('mid', 'D'),
    ]

    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    // D is in tc1:try scope, E is free -> allowed
    expect(result.current.validate({ source: 'D', target: 'E' })).toEqual({ valid: true })
  })
})

describe('useConnectionValidator - nested Try/Catch scope (REQ-3.2.2.6)', () => {
  const nodes = [
    node('outer', 'try-catch-finally'),
    node('head'),
    node('inner', 'try-catch-finally'),
    node('inner-try'),
    node('after'),
    node('tail'),
    node('done'),
    node('outer-catch'),
  ]
  const edges = [
    edge('outer', 'head', 'try'),
    edge('head', 'inner'),
    edge('inner', 'inner-try', 'try'),
    edge('inner', 'after', 'then'),
    edge('outer', 'done', 'then'),
    edge('outer', 'outer-catch', 'catch'),
  ]

  it.each([
    ['head', 'inner', edges.filter((e) => e.id !== 'e-head-inner')],
    ['after', 'tail', edges],
  ])('allows %s -> %s inside the outer try path', (source, target, existing) => {
    const { result } = renderHook(() => useConnectionValidator({ edges: existing, nodes }))
    expect(result.current.validate({ source, target })).toEqual({ valid: true })
  })

  it.each([
    ['inner-try', 'after'],
    ['after', 'done'],
    ['done', 'inner-try'],
    ['after', 'outer-catch'],
  ])('rejects %s -> %s across a scope', (source, target) => {
    const { result } = renderHook(() => useConnectionValidator({ edges, nodes }))
    expect(result.current.validate({ source, target })).toEqual({ valid: false, reason: 'cross-scope' })
  })
})
