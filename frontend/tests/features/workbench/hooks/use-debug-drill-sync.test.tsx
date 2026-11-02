/**
 * Tests for useDebugDrillSync - the debug-driven "canvas follows
 * execution" sync.
 *
 * While debugging, the active canvas must track where execution is paused:
 * when a pause lands inside a Function body the canvas drills into that
 * Function and selects the paused node; when execution leaves the body the
 * canvas pops back out. The hook resolves the paused node's drill path from
 * the in-memory nested workflow (the workflow store's `nodes` tree - no
 * backend WS change) and reuses the promoted `drillToPath` helper.
 *
 * Contract:
 *   useDebugDrillSync({ pausedNodeId, isPaused })
 *     - isPaused && pausedNodeId inside a Function body -> drill the canvas to
 *       that Function's ancestor chain and select the paused node.
 *     - isPaused && pausedNodeId at the root -> root canvas, select the node.
 *     - isPaused && pausedNodeId N levels deep -> drill the full chain.
 *     - resume / leave (isPaused false) -> pop back to the root canvas.
 *
 * Asserted against the real workflow store (the established pattern), so the
 * test is robust to the hook's internal structure.
 *
 * REQ scope: REQ-3.2.1.3 (Step Into / canvas follows execution).
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useDebugDrillSync } from '@/features/workbench/hooks/use-debug-drill-sync'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

vi.mock('@/features/functions/api/functions-api', async (orig) => {
  const actual = await orig<typeof import('@/features/functions/api/functions-api')>()
  return { ...actual, getFunction: vi.fn(), getFunctionVersion: vi.fn() }
})
import {
  getFunction as getFunctionImport,
  getFunctionVersion as getFunctionVersionImport,
} from '@/features/functions/api/functions-api'
const getFunctionMock = getFunctionImport as unknown as Mock
const getFunctionVersionMock = getFunctionVersionImport as unknown as Mock

interface MinimalNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    nodeType?: 'control' | 'plugin' | 'function'
    functionLifecycle?: 'local' | 'shared'
    functionId?: string
    functionVersion?: string
    editMode?: boolean
    draft?: { workflow: { nodes: MinimalNode[]; edges: unknown[] }; inputs: unknown[]; outputs: unknown[] }
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
    localDefinition: { workflow: { nodes: inner, edges: [] }, inputs: [], outputs: [], variables: [] },
  },
})

function setStore(nodes: MinimalNode[], drillPath: { nodeId: string; label: string }[] = []): void {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    drillPath,
    selectedNodeIds: [],
    fitViewRequested: false,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

function drillIds(): string[] {
  const s = useWorkflowStore.getState() as unknown as { drillPath: { nodeId: string }[] }
  return s.drillPath.map((e) => e.nodeId)
}

function selectedIds(): string[] {
  const s = useWorkflowStore.getState() as unknown as { selectedNodeIds: string[] }
  return s.selectedNodeIds
}

const sharedFn = (id: string, extra: Partial<MinimalNode['data']> = {}): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: { label: id, nodeType: 'function', functionLifecycle: 'shared', functionId: `lib-${id}`, ...extra },
})

const libraryBody = (nodes: MinimalNode[]) => ({
  definition: { workflow: { nodes, edges: [] }, inputs: [], outputs: [] },
  etag: 'etag-1',
})

type SyncProps = Parameters<typeof useDebugDrillSync>[0]

beforeEach(() => {
  setStore([])
  getFunctionMock.mockReset()
  getFunctionVersionMock.mockReset()
})

describe('useDebugDrillSync', () => {
  it('drills the canvas into the Function when the pause lands inside its body', () => {
    setStore([plugin('setup'), localFn('fn-1', 'Function_1', [plugin('deep-log')])])

    renderHook(() => useDebugDrillSync({ pausedNodeId: 'deep-log', isPaused: true, isRunning: false }))

    expect(drillIds()).toEqual(['fn-1'])
    expect(selectedIds()).toEqual(['deep-log'])
  })

  it('stays at the root canvas when the pause is on a root-level node', () => {
    setStore([plugin('setup'), localFn('fn-1', 'Function_1', [plugin('deep-log')])])

    renderHook(() => useDebugDrillSync({ pausedNodeId: 'setup', isPaused: true, isRunning: false }))

    expect(drillIds()).toEqual([])
    expect(selectedIds()).toEqual(['setup'])
  })

  it('drills the full ancestor chain when the pause is several levels deep', () => {
    const deepest = plugin('deepest-log')
    const inner = localFn('fn-2', 'Helper_2', [deepest])
    const outer = localFn('fn-1', 'Function_1', [inner])
    setStore([outer])

    renderHook(() => useDebugDrillSync({ pausedNodeId: 'deepest-log', isPaused: true, isRunning: false }))

    expect(drillIds()).toEqual(['fn-1', 'fn-2'])
    expect(selectedIds()).toEqual(['deepest-log'])
  })

  it('pops back to the root canvas when execution RESUMES (running)', () => {
    setStore([localFn('fn-1', 'Function_1', [plugin('deep-log')])])

    type Props = { pausedNodeId: string | null; isPaused: boolean; isRunning: boolean }
    const { rerender } = renderHook<void, Props>((props) => useDebugDrillSync(props), {
      initialProps: { pausedNodeId: 'deep-log', isPaused: true, isRunning: false },
    })
    expect(drillIds()).toEqual(['fn-1'])

    rerender({ pausedNodeId: null, isPaused: false, isRunning: true })
    expect(drillIds()).toEqual([])
  })

  it('stays inside the Function on Stop / terminal (not running)', () => {
    setStore([localFn('fn-1', 'Function_1', [plugin('deep-log')])])

    type Props = { pausedNodeId: string | null; isPaused: boolean; isRunning: boolean }
    const { rerender } = renderHook<void, Props>((props) => useDebugDrillSync(props), {
      initialProps: { pausedNodeId: 'deep-log', isPaused: true, isRunning: false },
    })
    expect(drillIds()).toEqual(['fn-1'])

    // Stop: status leaves 'paused' but is NOT 'running' - the canvas must not pop.
    rerender({ pausedNodeId: null, isPaused: false, isRunning: false })
    expect(drillIds()).toEqual(['fn-1'])
  })

  it('does not drill when not paused', () => {
    setStore([localFn('fn-1', 'Function_1', [plugin('deep-log')])])

    renderHook(() => useDebugDrillSync({ pausedNodeId: null, isPaused: false, isRunning: false }))

    expect(drillIds()).toEqual([])
  })
})

describe('useDebugDrillSync - library (Shared) Function bodies', () => {
  it('opens a Shared body that is not loaded when the pause lands inside it', async () => {
    setStore([plugin('setup'), sharedFn('inner', { functionVersion: '1.0.0' })])
    getFunctionVersionMock.mockResolvedValue(libraryBody([plugin('bp')]))

    renderHook(() => useDebugDrillSync({ pausedNodeId: 'bp', isPaused: true, isRunning: false }))

    await waitFor(() => expect(drillIds()).toEqual(['inner']))
    expect(selectedIds()).toEqual(['bp'])
    expect(getFunctionVersionMock).toHaveBeenCalledWith('lib-inner', '1.0.0')
  })

  it('reopens the body the user dug into after Continue popped the canvas back to the root', async () => {
    setStore([plugin('setup'), sharedFn('inner')])
    getFunctionMock.mockResolvedValue(libraryBody([plugin('bp'), plugin('next')]))

    const { rerender } = renderHook<void, SyncProps>((props) => useDebugDrillSync(props), {
      initialProps: { pausedNodeId: 'inner', isPaused: true, isRunning: false },
    })
    expect(drillIds()).toEqual([])
    act(() => {
      useWorkflowStore.getState().pushSharedDrill('inner', {
        workflow: { nodes: [plugin('bp'), plugin('next')] as unknown as never, edges: [] },
        inputs: [],
        outputs: [],
        variables: [],
      })
    })
    expect(drillIds()).toEqual(['inner'])

    rerender({ pausedNodeId: null, isPaused: false, isRunning: true })
    expect(drillIds()).toEqual([])

    rerender({ pausedNodeId: 'bp', isPaused: true, isRunning: false })
    await waitFor(() => expect(drillIds()).toEqual(['inner']))
    expect(selectedIds()).toEqual(['bp'])
    expect(getFunctionMock).toHaveBeenCalledWith('lib-inner')
  })

  it('keeps a loaded Shared body open when a step lands on the next Block inside it', () => {
    setStore([sharedFn('inner')])
    act(() => {
      useWorkflowStore.getState().pushSharedDrill('inner', {
        workflow: { nodes: [plugin('bp'), plugin('next')] as unknown as never, edges: [] },
        inputs: [],
        outputs: [],
        variables: [],
      })
    })

    renderHook(() => useDebugDrillSync({ pausedNodeId: 'next', isPaused: true, isRunning: false }))

    expect(drillIds()).toEqual(['inner'])
    expect(selectedIds()).toEqual(['next'])
    expect(getFunctionMock).not.toHaveBeenCalled()
  })

  it('opens a Shared body nested inside a Local Function body', async () => {
    setStore([localFn('fn-1', 'Function_1', [sharedFn('inner', { functionVersion: '2.0.0' })])])
    getFunctionVersionMock.mockResolvedValue(libraryBody([plugin('bp')]))

    renderHook(() => useDebugDrillSync({ pausedNodeId: 'bp', isPaused: true, isRunning: false }))

    await waitFor(() => expect(drillIds()).toEqual(['fn-1', 'inner']))
    expect(selectedIds()).toEqual(['bp'])
  })

  it('opens a Shared body nested inside another Shared body', async () => {
    setStore([sharedFn('outer', { functionVersion: '1.0.0' })])
    getFunctionVersionMock.mockImplementation((functionId: string) =>
      Promise.resolve(
        functionId === 'lib-outer'
          ? libraryBody([sharedFn('inner', { functionVersion: '1.0.0' })])
          : libraryBody([plugin('bp')]),
      ),
    )

    renderHook(() => useDebugDrillSync({ pausedNodeId: 'bp', isPaused: true, isRunning: false }))

    await waitFor(() => expect(drillIds()).toEqual(['outer', 'inner']))
    expect(selectedIds()).toEqual(['bp'])
  })

  it('opens an edit-mode Shared instance on its draft without a fetch', async () => {
    const draft = { workflow: { nodes: [plugin('bp')], edges: [] }, inputs: [], outputs: [] }
    setStore([sharedFn('inner', { editMode: true, draft })])

    renderHook(() => useDebugDrillSync({ pausedNodeId: 'bp', isPaused: true, isRunning: false }))

    await waitFor(() => expect(drillIds()).toEqual(['inner']))
    expect(getFunctionMock).not.toHaveBeenCalled()
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })

  it('stays put without throwing when no body holds the paused node', async () => {
    setStore([plugin('setup'), sharedFn('inner'), sharedFn('unlinked', { functionId: undefined })])
    getFunctionMock.mockResolvedValue(libraryBody([plugin('other')]))

    expect(() =>
      renderHook(() => useDebugDrillSync({ pausedNodeId: 'ghost', isPaused: true, isRunning: false })),
    ).not.toThrow()

    await waitFor(() => expect(getFunctionMock).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(drillIds()).toEqual([])
  })

  it('reports a body that fails to load and stays on the current canvas', async () => {
    const toastError = vi.fn()
    setStore([sharedFn('inner')])
    getFunctionMock.mockRejectedValue(new Error('library offline'))

    renderHook(() =>
      useDebugDrillSync({ pausedNodeId: 'bp', isPaused: true, isRunning: false, toastError }),
    )

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('library offline', 'Could Not Load Function Body'))
    expect(drillIds()).toEqual([])
  })

  it('drops a body that resolves after the run already moved on', async () => {
    setStore([sharedFn('inner')])
    let resolveBody: (value: unknown) => void = () => {}
    getFunctionMock.mockReturnValue(new Promise((resolve) => { resolveBody = resolve }))

    const { rerender } = renderHook<void, SyncProps>((props) => useDebugDrillSync(props), {
      initialProps: { pausedNodeId: 'bp', isPaused: true, isRunning: false },
    })
    rerender({ pausedNodeId: null, isPaused: false, isRunning: true })

    await act(async () => {
      resolveBody(libraryBody([plugin('bp')]))
    })
    expect(drillIds()).toEqual([])
  })
})
