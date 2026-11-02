/**
 * useReadOnlyCanvas - reads `isCurrentScopeReadOnly` from the workflow store
 * and returns it as a boolean. Drives:
 *   - LiveActionBar showReadOnlyChrome prop
 *   - WorkflowCanvas readOnly prop
 *
 * Contract:
 *   - returns false when drillPath is empty
 *   - returns false when drilled into a local Function
 *   - returns true when drilled into a shared (published) Function
 *   - returns true when ANY drillPath entry is shared (nested)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import {
  useReadOnlyCanvas,
  useIsDrilledIntoShared,
} from '@/features/workbench/common/canvas/use-readonly-canvas'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

interface MinimalNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    nodeType?: 'control' | 'plugin' | 'function'
    functionLifecycle?: 'local' | 'shared'
    functionId?: string
    localDefinition?: {
      workflow: { nodes: MinimalNode[]; edges: never[] }
      inputs: unknown[]
      outputs: unknown[]
      variables?: unknown[]
    }
  }
}

function localFn(id: string, label: string, inner: MinimalNode[] = []): MinimalNode {
  return {
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
  }
}

function sharedFn(id: string, label: string): MinimalNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label,
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: 'lib-1',
    },
  }
}

function seedStore(nodes: MinimalNode[]) {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    edges: [] as unknown as never,
    variables: [] as unknown as never,
    drillPath: [],
    isDirty: false,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

beforeEach(() => {
  seedStore([])
})

describe('useReadOnlyCanvas', () => {
  it('returns false at the Test root', () => {
    seedStore([localFn('fn-1', 'Function_1')])
    const { result } = renderHook(() => useReadOnlyCanvas())
    expect(result.current).toBe(false)
  })

  it('returns false when drilled into a local Function', () => {
    seedStore([localFn('fn-1', 'Function_1')])
    const { result } = renderHook(() => useReadOnlyCanvas())
    act(() => {
      useWorkflowStore.getState().pushDrill('fn-1')
    })
    expect(result.current).toBe(false)
  })

  it('returns true when drilled into a shared Function', () => {
    seedStore([sharedFn('s1', 'FetchUser')])
    const { result } = renderHook(() => useReadOnlyCanvas())
    act(() => {
      useWorkflowStore.getState().pushSharedDrill('s1', {
        workflow: { nodes: [] as unknown as never, edges: [] as unknown as never },
        inputs: [],
        outputs: [],
        variables: [],
      })
    })
    expect(result.current).toBe(true)
  })

  it('flips back to false after popping out of the shared scope', () => {
    seedStore([sharedFn('s1', 'FetchUser')])
    const { result } = renderHook(() => useReadOnlyCanvas())
    act(() => {
      useWorkflowStore.getState().pushSharedDrill('s1', {
        workflow: { nodes: [] as unknown as never, edges: [] as unknown as never },
        inputs: [],
        outputs: [],
        variables: [],
      })
    })
    expect(result.current).toBe(true)

    act(() => {
      useWorkflowStore.getState().popDrillOne()
    })
    expect(result.current).toBe(false)
  })

  it('returns false defensively when drillPath has a missing node id', () => {
    seedStore([localFn('fn-1', 'Function_1')])
    act(() => {
      useWorkflowStore.setState({
        drillPath: [{ nodeId: 'does-not-exist', label: 'Ghost' }],
      } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
    })
    const { result } = renderHook(() => useReadOnlyCanvas())
    expect(result.current).toBe(false)
  })

  it('returns false defensively when a local drill-path node has no localDefinition (malformed)', () => {
    // Defensive branch: if a drill entry references a local Function whose
    // localDefinition is missing (e.g. transient state during a load),
    // the walk cannot descend. Treat the canvas as editable (the
    // structurally safer default) until the data stabilizes.
    const malformed: MinimalNode = {
      id: 'fn-bad',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: { label: 'Broken', nodeType: 'function', functionLifecycle: 'local' },
    }
    seedStore([malformed])
    act(() => {
      useWorkflowStore.setState({
        drillPath: [{ nodeId: 'fn-bad', label: 'Broken' }],
      } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
    })
    const { result } = renderHook(() => useReadOnlyCanvas())
    expect(result.current).toBe(false)
  })
})

describe('useIsDrilledIntoShared', () => {
  it('returns false at the Test root', () => {
    seedStore([sharedFn('s1', 'FetchUser')])
    const { result } = renderHook(() => useIsDrilledIntoShared())
    expect(result.current).toBe(false)
  })

  it('returns true when a Shared instance is on the drill path', () => {
    seedStore([sharedFn('s1', 'FetchUser')])
    const { result } = renderHook(() => useIsDrilledIntoShared())
    act(() => {
      useWorkflowStore.getState().pushSharedDrill('s1', {
        workflow: { nodes: [] as unknown as never, edges: [] as unknown as never },
        inputs: [],
        outputs: [],
        variables: [],
      })
    })
    expect(result.current).toBe(true)
  })

  it('returns false when only local Functions are on the drill path', () => {
    seedStore([localFn('fn-1', 'Function_1')])
    const { result } = renderHook(() => useIsDrilledIntoShared())
    act(() => {
      useWorkflowStore.getState().pushDrill('fn-1')
    })
    expect(result.current).toBe(false)
  })

  it('returns false when the drill path references a missing node', () => {
    seedStore([localFn('fn-1', 'Function_1')])
    act(() => {
      useWorkflowStore.setState({
        drillPath: [{ nodeId: 'ghost', label: 'Ghost' }],
      } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
    })
    const { result } = renderHook(() => useIsDrilledIntoShared())
    expect(result.current).toBe(false)
  })

  it('returns true for a drilled Shared whose body is not stamped yet', () => {
    seedStore([sharedFn('s1', 'FetchUser')])
    act(() => {
      useWorkflowStore.setState({
        drillPath: [{ nodeId: 's1', label: 'FetchUser' }],
      } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
    })
    const { result } = renderHook(() => useIsDrilledIntoShared())
    expect(result.current).toBe(true)
  })

  it('returns true for a drilled Shared whose stamp has no workflow body', () => {
    const stampless = {
      ...sharedFn('s1', 'FetchUser'),
      data: { ...sharedFn('s1', 'FetchUser').data, localDefinition: {} },
    } as unknown as MinimalNode
    seedStore([stampless])
    act(() => {
      useWorkflowStore.setState({
        drillPath: [{ nodeId: 's1', label: 'FetchUser' }],
      } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
    })
    const { result } = renderHook(() => useIsDrilledIntoShared())
    expect(result.current).toBe(true)
  })
})
