/**
 * Tests for useDrillHandler - the centralized drill action surface used by
 * the dig-in glyph handler, the kebab "Open" item, the Cmd/Ctrl+Enter
 * shortcut, and the breadcrumb-segment click path.
 *
 * Contract:
 *   - pushDrill(nodeId): resolves the node's data.label, appends
 *     { nodeId, label } to drillPath. No-op if the node is not a Function
 *     (defensive).
 *   - popOne(): removes the last entry from drillPath. Idempotent on empty.
 *   - popDrillTo(depth): truncates drillPath to length `depth`.
 *   - clearDrill(): sets drillPath = [].
 *
 * REQ scope: REQ-3.1.1.4 (nested Function composition - drill navigation).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useDrillHandler } from '@/features/functions/canvas/use-drill-handler'
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

const plugin = (id: string, label = id): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: { label, nodeType: 'plugin' },
})

const localFn = (id: string, label: string, inner: MinimalNode[] = []): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: {
    label,
    nodeType: 'function',
    functionLifecycle: 'local',
    localDefinition: {
      workflow: { nodes: inner, edges: [] },
      inputs: [],
      outputs: [],
      variables: [],
    },
  },
})

const sharedFn = (id: string, label: string): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: {
    label,
    nodeType: 'function',
    functionLifecycle: 'shared',
  },
})

function resetStore(nodes: MinimalNode[]): void {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    drillPath: [],
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

beforeEach(() => {
  resetStore([])
})

describe('useDrillHandler - pushDrill', () => {
  it('appends a drill entry for a local Function node, resolving the label from node.data.label', () => {
    const fn = localFn('fn-1', 'My Function')
    resetStore([fn])

    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.pushDrill('fn-1'))

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toEqual([{ nodeId: 'fn-1', label: 'My Function' }])
  })

  it('appends successive entries when pushDrill is called on a nested Function', () => {
    const child = localFn('child', 'Helper_2')
    const parent = localFn('parent', 'Function_1', [child])
    resetStore([parent])

    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.pushDrill('parent'))
    act(() => result.current.pushDrill('child'))

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toEqual([
      { nodeId: 'parent', label: 'Function_1' },
      { nodeId: 'child', label: 'Helper_2' },
    ])
  })

  it('is a no-op when the target node is not a Function (defensive guard)', () => {
    const plug = plugin('p1', 'Shell Script')
    resetStore([plug])

    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.pushDrill('p1'))

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toEqual([])
  })

  it('is a no-op when the target node does not exist', () => {
    resetStore([plugin('p1')])

    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.pushDrill('missing'))

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toEqual([])
  })

  it('is a no-op when the target is a shared Function', () => {
    // The handler is the last line of defense if some test fixture or
    // future keyboard path tries to drill into a shared node.
    const shared = sharedFn('fn-shared', 'Library Fn')
    resetStore([shared])

    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.pushDrill('fn-shared'))

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toEqual([])
  })
})

describe('useDrillHandler - popOne', () => {
  it('removes the last entry from drillPath', () => {
    const child = localFn('child', 'Helper_2')
    const parent = localFn('parent', 'Function_1', [child])
    resetStore([parent])

    const { result } = renderHook(() => useDrillHandler())
    act(() => {
      result.current.pushDrill('parent')
      result.current.pushDrill('child')
    })
    act(() => result.current.popOne())

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toEqual([{ nodeId: 'parent', label: 'Function_1' }])
  })

  it('is idempotent on an empty drillPath', () => {
    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.popOne())
    act(() => result.current.popOne())

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toEqual([])
  })
})

describe('useDrillHandler - popDrillTo', () => {
  it('truncates drillPath to the requested depth', () => {
    const child = localFn('child', 'Helper_2')
    const parent = localFn('parent', 'Function_1', [child])
    resetStore([parent])

    const { result } = renderHook(() => useDrillHandler())
    act(() => {
      result.current.pushDrill('parent')
      result.current.pushDrill('child')
    })
    act(() => result.current.popDrillTo(1))

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toHaveLength(1)
    expect(drill[0]?.nodeId).toBe('parent')
  })

  it('popDrillTo(0) clears the drill path', () => {
    const fn = localFn('fn-1', 'Function_1')
    resetStore([fn])

    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.pushDrill('fn-1'))
    act(() => result.current.popDrillTo(0))

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toEqual([])
  })

  it('is idempotent when called with a depth equal to or greater than the current length', () => {
    const fn = localFn('fn-1', 'Function_1')
    resetStore([fn])

    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.pushDrill('fn-1'))
    act(() => result.current.popDrillTo(5))

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toEqual([{ nodeId: 'fn-1', label: 'Function_1' }])
  })
})

describe('useDrillHandler - clearDrill', () => {
  it('empties the drillPath stack', () => {
    const child = localFn('child', 'Helper_2')
    const parent = localFn('parent', 'Function_1', [child])
    resetStore([parent])

    const { result } = renderHook(() => useDrillHandler())
    act(() => {
      result.current.pushDrill('parent')
      result.current.pushDrill('child')
    })
    act(() => result.current.clearDrill())

    const drill = (useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string; label: string }[] }).drillPath
    expect(drill).toEqual([])
  })
})

describe('useDrillHandler - dirty-sheet drill guard', () => {
  interface GuardSlice {
    pendingDrillAction: { run: () => void } | null
    setConfigSheetDirty: (nodeId: string, dirty: boolean) => void
    confirmPendingDrill: () => void
    cancelPendingDrill: () => void
    drillPath: { nodeId: string; label: string }[]
  }
  const guard = () => useWorkflowStore.getState() as unknown as GuardSlice

  beforeEach(() => {
    guard().setConfigSheetDirty('any', false)
    guard().cancelPendingDrill()
  })

  it('defers pushDrill while a config sheet has unsaved edits; confirm executes it', () => {
    resetStore([localFn('fn-1', 'Function_1')])
    guard().setConfigSheetDirty('some-node', true)

    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.pushDrill('fn-1'))
    expect(guard().drillPath).toEqual([])
    expect(guard().pendingDrillAction).not.toBeNull()

    act(() => guard().confirmPendingDrill())
    expect(guard().drillPath).toEqual([{ nodeId: 'fn-1', label: 'Function_1' }])
    guard().setConfigSheetDirty('some-node', false)
  })

  it('defers breadcrumb pops while dirty; cancel keeps the current scope', () => {
    const child = localFn('child', 'Helper_2')
    resetStore([localFn('parent', 'Function_1', [child])])

    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.pushDrill('parent'))
    guard().setConfigSheetDirty('some-node', true)

    act(() => result.current.popOne())
    expect(guard().drillPath).toHaveLength(1)
    act(() => guard().cancelPendingDrill())
    expect(guard().drillPath).toHaveLength(1)

    act(() => result.current.popDrillTo(0))
    expect(guard().drillPath).toHaveLength(1)
    act(() => guard().confirmPendingDrill())
    expect(guard().drillPath).toEqual([])
    guard().setConfigSheetDirty('some-node', false)
  })

  it('routes clearDrill through the guard as well', () => {
    resetStore([localFn('fn-1', 'Function_1')])
    const { result } = renderHook(() => useDrillHandler())
    act(() => result.current.pushDrill('fn-1'))
    guard().setConfigSheetDirty('some-node', true)

    act(() => result.current.clearDrill())
    expect(guard().drillPath).toHaveLength(1)
    act(() => guard().confirmPendingDrill())
    expect(guard().drillPath).toEqual([])
    guard().setConfigSheetDirty('some-node', false)
  })
})
