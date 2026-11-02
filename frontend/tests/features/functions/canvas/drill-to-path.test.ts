/**
 * Tests for the promoted `drillToPath` helper.
 *
 * `drillToPath` is extracted from the inline drill chain in
 * `use-validation.ts:navigateToIssue` so that BOTH validation-navigation and
 * the debug-drill sync share one implementation.
 *
 * Contract:
 *   drillToPath(segments: { nodeId: string; shared?: boolean }[], leafNodeId?: string)
 *     1. resets the drill stack to the root (popDrillTo(0)),
 *     2. pushes each ancestor in order - local via pushDrill, shared via
 *        pushSharedDrill,
 *     3. selects the leaf node when leafNodeId is provided,
 *     4. requests a fit-view.
 *
 * Asserted against the real workflow store (the established pattern in
 * use-drill-handler.test.ts / use-function-scope.test.ts), so the test is
 * robust to how the helper is structured internally.
 *
 * REQ scope: REQ-3.1.1.4 (drill navigation) feeding REQ-3.2.1.3 (debug drill).
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { drillToPath } from '@/features/functions/canvas/use-drill-handler'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

interface MinimalNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    nodeType?: 'control' | 'plugin' | 'function'
    functionLifecycle?: 'local' | 'shared'
    localDefinition?: {
      workflow: { nodes: MinimalNode[]; edges: unknown[] }
      inputs: unknown[]
      outputs: unknown[]
      variables?: unknown[]
    }
  }
}

const localFn = (id: string, label: string, inner: MinimalNode[] = []): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: {
    label,
    nodeType: 'function',
    functionLifecycle: 'local',
    localDefinition: { workflow: { nodes: inner, edges: [] }, inputs: [], outputs: [], variables: [] },
  },
})

const plugin = (id: string, label = id): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: { label, nodeType: 'plugin' },
})

function setStore(nodes: MinimalNode[], drillPath: { nodeId: string; label: string }[] = []): void {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    drillPath,
    selectedNodeIds: [],
    fitViewRequested: false,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

function snapshot(): {
  drillPath: { nodeId: string; label: string }[]
  selectedNodeIds: string[]
  fitViewRequested: boolean
} {
  const s = useWorkflowStore.getState() as unknown as {
    drillPath: { nodeId: string; label: string }[]
    selectedNodeIds: string[]
    fitViewRequested: boolean
  }
  return { drillPath: s.drillPath, selectedNodeIds: s.selectedNodeIds, fitViewRequested: s.fitViewRequested }
}

beforeEach(() => {
  setStore([])
})

describe('drillToPath - local ancestors', () => {
  it('drills one local ancestor and selects the leaf', () => {
    const leaf = plugin('inner-leaf', 'Inner Leaf')
    setStore([localFn('fn-1', 'Function_1', [leaf])])

    drillToPath([{ nodeId: 'fn-1' }], 'inner-leaf')

    const { drillPath, selectedNodeIds, fitViewRequested } = snapshot()
    expect(drillPath.map((e) => e.nodeId)).toEqual(['fn-1'])
    expect(selectedNodeIds).toEqual(['inner-leaf'])
    expect(fitViewRequested).toBe(true)
  })

  it('drills a 2-level local ancestor chain in order and selects the deep leaf', () => {
    const deepLeaf = plugin('deep-leaf', 'Deep Leaf')
    const inner = localFn('fn-2', 'Helper_2', [deepLeaf])
    const outer = localFn('fn-1', 'Function_1', [inner])
    setStore([outer])

    drillToPath([{ nodeId: 'fn-1' }, { nodeId: 'fn-2' }], 'deep-leaf')

    const { drillPath, selectedNodeIds } = snapshot()
    expect(drillPath.map((e) => e.nodeId)).toEqual(['fn-1', 'fn-2'])
    expect(selectedNodeIds).toEqual(['deep-leaf'])
  })

  it('with no segments, resets to root and selects a root-level leaf', () => {
    setStore([plugin('root-leaf', 'Root Leaf')], [{ nodeId: 'stale', label: 'Stale' }])

    drillToPath([], 'root-leaf')

    const { drillPath, selectedNodeIds } = snapshot()
    expect(drillPath).toEqual([])
    expect(selectedNodeIds).toEqual(['root-leaf'])
  })

  it('resets a stale drill stack before drilling the new path', () => {
    const leaf = plugin('inner-leaf', 'Inner Leaf')
    setStore([localFn('fn-1', 'Function_1', [leaf])], [{ nodeId: 'stale-a', label: 'A' }, { nodeId: 'stale-b', label: 'B' }])

    drillToPath([{ nodeId: 'fn-1' }], 'inner-leaf')

    const { drillPath } = snapshot()
    expect(drillPath.map((e) => e.nodeId)).toEqual(['fn-1'])
  })

  it('drills without selecting when no leaf node id is given', () => {
    const leaf = plugin('inner-leaf', 'Inner Leaf')
    setStore([localFn('fn-1', 'Function_1', [leaf])])

    drillToPath([{ nodeId: 'fn-1' }])

    const { drillPath, selectedNodeIds } = snapshot()
    expect(drillPath.map((e) => e.nodeId)).toEqual(['fn-1'])
    expect(selectedNodeIds).toEqual([])
  })
})

describe('drillToPath - consumed identically by validation navigation', () => {
  it('produces the same drill+select effect navigateToIssue used to inline', () => {
    // navigateToIssue drilled each functionPath segment then selected the
    // leaf node_id. drillToPath must reproduce that exact effect.
    const leaf = plugin('Log_1', 'Log_1')
    const inner = localFn('inner-1', 'Inner_Fn', [leaf])
    const outer = localFn('outer-1', 'Outer_Fn', [inner])
    setStore([outer])

    drillToPath([{ nodeId: 'outer-1' }, { nodeId: 'inner-1' }], 'Log_1')

    const { drillPath, selectedNodeIds } = snapshot()
    expect(drillPath.map((e) => e.nodeId)).toEqual(['outer-1', 'inner-1'])
    expect(selectedNodeIds).toEqual(['Log_1'])
  })
})

describe('drillToPath - Shared ancestors', () => {
  const sharedFn = (id: string): MinimalNode => ({
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label: id, nodeType: 'function', functionLifecycle: 'shared' },
  })
  const body = (nodes: MinimalNode[]) => ({
    workflow: { nodes: nodes as unknown as never, edges: [] },
    inputs: [],
    outputs: [],
    variables: [],
  })

  it('opens a Shared ancestor on the body the segment carries', () => {
    setStore([localFn('fn-1', 'Function_1', [sharedFn('lib-1')])])

    drillToPath([{ nodeId: 'fn-1' }, { nodeId: 'lib-1', shared: true, body: body([plugin('bp')]) }], 'bp')

    const { drillPath, selectedNodeIds } = snapshot()
    expect(drillPath.map((e) => e.nodeId)).toEqual(['fn-1', 'lib-1'])
    expect(selectedNodeIds).toEqual(['bp'])
  })

  it('keeps an open Shared ancestor that the new path still passes through', () => {
    setStore([sharedFn('lib-1')])
    useWorkflowStore.getState().pushSharedDrill('lib-1', body([plugin('bp'), plugin('next')]))

    drillToPath([{ nodeId: 'lib-1', shared: true }], 'next')

    const { drillPath, selectedNodeIds } = snapshot()
    expect(drillPath.map((e) => e.nodeId)).toEqual(['lib-1'])
    expect(selectedNodeIds).toEqual(['next'])
  })

  it('reopens a loaded Shared ancestor that sits below a popped level', () => {
    const lib: MinimalNode = {
      ...sharedFn('lib-1'),
      data: { ...sharedFn('lib-1').data, localDefinition: body([plugin('bp')]) as unknown as MinimalNode['data']['localDefinition'] },
    }
    setStore([localFn('fn-1', 'Function_1', [lib]), localFn('fn-2', 'Function_2', [])], [{ nodeId: 'fn-2', label: 'Function_2' }])

    drillToPath([{ nodeId: 'fn-1' }, { nodeId: 'lib-1', shared: true }], 'bp')

    expect(snapshot().drillPath.map((e) => e.nodeId)).toEqual(['fn-1', 'lib-1'])
  })

  it('skips a Shared ancestor that has no body to open', () => {
    setStore([sharedFn('lib-1')])

    drillToPath([{ nodeId: 'lib-1', shared: true }], 'bp')

    expect(snapshot().drillPath).toEqual([])
  })
})
