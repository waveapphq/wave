/**
 * Remote Body Membership tests (REQ-3.4.1.3).
 *
 * getRemoteBodyMembers returns every node inside a Remote Execution container's
 * body sub-flow (reached forward from the cyan `body` handle). The `then`
 * continuation and nodes before the container are excluded. Memoized on the
 * (nodes, edges) references.
 */

import { describe, it, expect } from 'vitest'
import {
  getRemoteBodyMembers,
  isInRemoteBody,
  runsOnExecutionHost,
} from '@/features/workbench/lib/remote-body-membership'

const rex = (id: string) => ({ id, data: { elementType: 'remote-execution' } })
const plugin = (id: string) => ({ id, data: { elementType: 'http-client' } })

describe('getRemoteBodyMembers', () => {
  it('includes the whole body chain reached from the body handle', () => {
    const nodes = [rex('rex'), plugin('a'), plugin('b'), plugin('then')]
    const edges = [
      { source: 'rex', target: 'a', sourceHandle: 'body' },
      { source: 'a', target: 'b' },
      { source: 'rex', target: 'then', sourceHandle: 'then' },
    ]
    const members = getRemoteBodyMembers(nodes, edges)
    expect(members.has('a')).toBe(true)
    expect(members.has('b')).toBe(true)
  })

  it('excludes the then continuation and the container itself', () => {
    const nodes = [rex('rex'), plugin('a'), plugin('then')]
    const edges = [
      { source: 'rex', target: 'a', sourceHandle: 'body' },
      { source: 'rex', target: 'then', sourceHandle: 'then' },
    ]
    const members = getRemoteBodyMembers(nodes, edges)
    expect(members.has('then')).toBe(false)
    expect(members.has('rex')).toBe(false)
  })

  it('returns an empty set when a container has no body edge', () => {
    const nodes = [rex('rex'), plugin('a')]
    const edges = [{ source: 'rex', target: 'a', sourceHandle: 'then' }]
    expect(getRemoteBodyMembers(nodes, edges).size).toBe(0)
  })

  it('handles a body that cycles back without looping forever', () => {
    const nodes = [rex('rex'), plugin('a'), plugin('b')]
    const edges = [
      { source: 'rex', target: 'a', sourceHandle: 'body' },
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ]
    const members = getRemoteBodyMembers(nodes, edges)
    expect(members.has('a')).toBe(true)
    expect(members.has('b')).toBe(true)
  })

  it('memoizes on the (nodes, edges) references', () => {
    const nodes = [rex('rex'), plugin('a')]
    const edges = [{ source: 'rex', target: 'a', sourceHandle: 'body' }]
    const first = getRemoteBodyMembers(nodes, edges)
    const second = getRemoteBodyMembers(nodes, edges)
    expect(second).toBe(first) // same reference = cache hit

    const recomputed = getRemoteBodyMembers([...nodes], edges)
    expect(recomputed).not.toBe(first) // new nodes reference = recompute
    expect(recomputed.has('a')).toBe(true)
  })

  it('handles a diamond body where a node is reachable via two paths', () => {
    // rex -> a (body); a -> b, a -> c; b -> d, c -> d. `d` is enqueued twice
    // before it is processed, exercising the already-visited guard.
    const nodes = [rex('rex'), plugin('a'), plugin('b'), plugin('c'), plugin('d')]
    const edges = [
      { source: 'rex', target: 'a', sourceHandle: 'body' },
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ]
    const members = getRemoteBodyMembers(nodes, edges)
    expect([...members].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('collects members across multiple containers', () => {
    const nodes = [rex('rex1'), rex('rex2'), plugin('a'), plugin('b')]
    const edges = [
      { source: 'rex1', target: 'a', sourceHandle: 'body' },
      { source: 'rex2', target: 'b', sourceHandle: 'body' },
    ]
    const members = getRemoteBodyMembers(nodes, edges)
    expect(members.has('a')).toBe(true)
    expect(members.has('b')).toBe(true)
  })
})

/**
 * The host-locus rule: only a remotable block inside a body runs on the
 * execution host (SHRUN-1, SHRUN-17, TDATA-8). It drives both the R / L badge
 * and Browse.
 */
describe('runsOnExecutionHost', () => {
  it('sends a remotable block inside a body to the execution host', () => {
    expect(runsOnExecutionHost(true, 'http-client')).toBe(true)
  })

  it('keeps a non-remotable block inside a body on the WAVE server', () => {
    expect(runsOnExecutionHost(true, 'shell-script')).toBe(false)
    expect(runsOnExecutionHost(true, 'shell-exec')).toBe(false)
  })

  it('keeps a remotable block outside a body on the WAVE server', () => {
    expect(runsOnExecutionHost(false, 'http-client')).toBe(false)
  })
})

const fn = (id: string, nodes: unknown[], edges: unknown[]) => ({
  id,
  data: { elementType: 'function', nodeType: 'function', localDefinition: { workflow: { nodes, edges } } },
})
const drill = (...ids: string[]) => ids.map((nodeId) => ({ nodeId, label: nodeId }))

/**
 * Membership in the scope the canvas shows: a drilled Function body runs where its
 * instance runs, so an instance inside a body puts its whole body inside that body.
 */
describe('isInRemoteBody', () => {
  const inner = fn('fn', [plugin('read'), rex('inner-rex'), plugin('host-read')], [
    { source: 'inner-rex', target: 'host-read', sourceHandle: 'body' },
  ])

  it('reads membership from the root graph when nothing is drilled', () => {
    const nodes = [rex('rex'), plugin('a'), plugin('b')]
    const edges = [{ source: 'rex', target: 'a', sourceHandle: 'body' }]
    expect(isInRemoteBody(nodes, edges, [], 'a')).toBe(true)
    expect(isInRemoteBody(nodes, edges, [], 'b')).toBe(false)
  })

  it('puts every block of a drilled Function body inside the body its instance sits in', () => {
    const nodes = [rex('rex'), inner]
    const edges = [{ source: 'rex', target: 'fn', sourceHandle: 'body' }]
    expect(isInRemoteBody(nodes, edges, drill('fn'), 'read')).toBe(true)
  })

  it('keeps a drilled Function body outside a body when its instance is outside one', () => {
    const nodes = [rex('rex'), inner]
    const edges = [{ source: 'rex', target: 'fn', sourceHandle: 'then' }]
    expect(isInRemoteBody(nodes, edges, drill('fn'), 'read')).toBe(false)
  })

  it('finds a Remote Execution body inside the drilled Function body', () => {
    const nodes = [inner]
    expect(isInRemoteBody(nodes, [], drill('fn'), 'host-read')).toBe(true)
    expect(isInRemoteBody(nodes, [], drill('fn'), 'read')).toBe(false)
  })

  it('carries the call site through every drilled level', () => {
    const outer = fn('outer', [inner], [])
    const nodes = [rex('rex'), outer]
    const edges = [{ source: 'rex', target: 'outer', sourceHandle: 'body' }]
    expect(isInRemoteBody(nodes, edges, drill('outer', 'fn'), 'read')).toBe(true)
  })

  it('stops at the deepest drill entry that resolves, as the canvas scope does', () => {
    const nodes = [rex('rex'), inner]
    const edges = [{ source: 'inner-rex', target: 'x', sourceHandle: 'body' }]
    expect(isInRemoteBody(nodes, edges, drill('fn', 'missing'), 'host-read')).toBe(true)
    expect(isInRemoteBody(nodes, edges, drill('missing'), 'read')).toBe(false)
  })

  it('reads an empty drilled body as holding nothing', () => {
    const bare = { id: 'bare', data: { elementType: 'function', nodeType: 'function', localDefinition: { workflow: {} } } }
    expect(isInRemoteBody([bare], [], drill('bare'), 'read')).toBe(false)
  })
})
