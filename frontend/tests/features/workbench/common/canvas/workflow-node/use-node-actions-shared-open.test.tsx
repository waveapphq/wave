/**
 * useNodeActions - 'open' action on a shared Function fetches the library
 * entry and pushes the shared drill.
 *
 * Contract:
 *   - elementType === 'function' && functionLifecycle === 'shared' → 'open'
 *     resolves the body via getFunctionVersion(functionId, pinnedVersion) when
 *     the instance pins a version, else getFunction(functionId) (latest), then
 *     calls workflowStore.pushSharedDrill(id, definition).
 *   - When functionId is missing: 'open' is a no-op.
 *   - When the fetch rejects: the user stays on the parent canvas, the reason
 *     is reported on the gesture, and the glyph can be pressed again.
 *   - For local Function: 'open' calls pushDrill.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useNodeActions } from '@/features/workbench/common/canvas/workflow-node/use-node-actions'
import { AdHocActionsProvider } from '@/features/workbench/common/canvas/adhoc-actions-context'

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: mockToastError }),
}))

// Mock the library fetches so we control resolution / rejection in each test.
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
    elementType?: string
    functionLifecycle?: 'local' | 'shared'
    functionId?: string
    functionVersion?: string
    localDefinition?: {
      workflow: { nodes: MinimalNode[]; edges: never[] }
      inputs: unknown[]
      outputs: unknown[]
      variables?: unknown[]
    }
  }
}

function sharedFn(
  id: string,
  label: string,
  functionId?: string,
  functionVersion?: string,
): MinimalNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label,
      nodeType: 'function',
      elementType: 'function',
      functionLifecycle: 'shared',
      ...(functionId ? { functionId } : {}),
      ...(functionVersion ? { functionVersion } : {}),
    },
  }
}

function localFn(id: string, label: string): MinimalNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label,
      nodeType: 'function',
      elementType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        workflow: { nodes: [], edges: [] },
        inputs: [],
        outputs: [],
        variables: [],
      },
    },
  }
}

function reset(nodes: MinimalNode[] = []) {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    edges: [] as unknown as never,
    variables: [] as never,
    drillPath: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    isDirty: false,
    digInPendingNodeId: null,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AdHocActionsProvider dispatch={() => {}}>{children}</AdHocActionsProvider>
)

beforeEach(() => {
  reset()
  getFunctionMock.mockReset()
  getFunctionVersionMock.mockReset()
  mockToastError.mockReset()
})

const RESOLVED = {
  definition: {
    id: 'lib-1',
    name: 'FetchUser',
    description: '',
    tags: [],
    inputs: [{ name: 'msg', type: 'string', required: true, default: '', description: '' }],
    outputs: [{ name: 'out', type: 'string', description: '' }],
    dependencies: { functions: [], plugins: ['log'] },
    workflow: { nodes: [], edges: [] },
    metadata: { author: 'x', created_at: '', updated_at: '' },
  },
  etag: 'W/"v1"',
}

describe("useNodeActions - 'open' on shared Function", () => {
  it('fetches the library entry and pushes the shared drill on success', async () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-1')])
    getFunctionMock.mockResolvedValueOnce(RESOLVED)

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))

    await waitFor(() => {
      expect(getFunctionMock).toHaveBeenCalledWith('lib-1')
    })
    await waitFor(() => {
      const state = useWorkflowStore.getState()
      expect(state.drillPath).toEqual([{ nodeId: 's1', label: 'FetchUser' }])
    })
  })

  it('drills into the pinned version via getFunctionVersion when functionVersion is set', async () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-1', '1.0.0')])
    getFunctionVersionMock.mockResolvedValueOnce(RESOLVED)

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))

    await waitFor(() => {
      expect(getFunctionVersionMock).toHaveBeenCalledWith('lib-1', '1.0.0')
    })
    expect(getFunctionMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(useWorkflowStore.getState().drillPath).toEqual([
        { nodeId: 's1', label: 'FetchUser' },
      ])
    })
  })

  it('is a no-op when functionId is missing', async () => {
    reset([sharedFn('s1', 'FetchUser' /* no functionId */)])

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))

    // Yield a microtask + macrotask so any scheduled async work would resolve.
    await new Promise((r) => setTimeout(r, 10))
    expect(getFunctionMock).not.toHaveBeenCalled()
    expect(useWorkflowStore.getState().drillPath).toEqual([])
  })

  it('keeps the user on the parent canvas when the library fetch rejects', async () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-1')])
    getFunctionMock.mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))

    await waitFor(() => {
      expect(getFunctionMock).toHaveBeenCalledWith('lib-1')
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(useWorkflowStore.getState().drillPath).toEqual([])
  })

  it('routes local Function open through pushDrill (regression)', async () => {
    reset([localFn('fn-local', 'Helper')])

    const { result } = renderHook(() => useNodeActions({ id: 'fn-local' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))

    // pushDrill is synchronous; no library fetch should have happened.
    expect(getFunctionMock).not.toHaveBeenCalled()
    expect(useWorkflowStore.getState().drillPath).toEqual([
      { nodeId: 'fn-local', label: 'Helper' },
    ])
  })

  it('drills into the in-Test edit-mode draft body without refetching the library', () => {
    // editMode + draft.workflow present: 'open' must use the persisted draft
    // (canvas mutations round-trip into data.draft) and NOT refetch the library.
    const draftNode: MinimalNode = {
      ...sharedFn('s1', 'FetchUser', 'lib-1', '1.0.0'),
    }
    draftNode.data = {
      ...draftNode.data,
      editMode: true,
      draft: {
        workflow: { nodes: [], edges: [] },
        inputs: [{ name: 'd-in' }],
        outputs: [{ name: 'd-out' }],
      },
    } as unknown as MinimalNode['data']
    reset([draftNode])

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))

    // Synchronous draft drill - no library fetch of any kind.
    expect(getFunctionMock).not.toHaveBeenCalled()
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
    expect(useWorkflowStore.getState().drillPath).toEqual([
      { nodeId: 's1', label: 'FetchUser' },
    ])
  })

  it('drills into the edit-mode draft with empty inputs/outputs when the draft omits them', () => {
    // draft.inputs / draft.outputs undefined: the `?? []` fallback path.
    const draftNode: MinimalNode = {
      ...sharedFn('s1', 'FetchUser', 'lib-1', '1.0.0'),
    }
    draftNode.data = {
      ...draftNode.data,
      editMode: true,
      draft: { workflow: { nodes: [], edges: [] } },
    } as unknown as MinimalNode['data']
    reset([draftNode])

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))

    expect(getFunctionMock).not.toHaveBeenCalled()
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
    expect(useWorkflowStore.getState().drillPath).toEqual([
      { nodeId: 's1', label: 'FetchUser' },
    ])
  })
})


// Dig-in observability. The silent no-op is replaced with an
// instant pending state on the glyph, an in-flight lock so stacked clicks are
// ignored while a resolve is pending, and a failed resolve that clears the
// pending state and blocks the canvas with the reason.
describe("useNodeActions - 'open' dig-in observability", () => {
  it('sets the dig-in pending state on click while the body resolves', () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-1')])
    // Never resolves: lets us observe the pending state mid-flight.
    getFunctionMock.mockReturnValueOnce(new Promise(() => {}))

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))

    expect(useWorkflowStore.getState().digInPendingNodeId).toBe('s1')
  })

  it('ignores stacked dig-in clicks while a resolve is in flight', () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-1')])
    getFunctionMock.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))
    act(() => result.current.handleContextMenuAction('open'))
    act(() => result.current.handleContextMenuAction('open'))

    expect(getFunctionMock).toHaveBeenCalledTimes(1)
  })

  it('clears the pending state, reports the reason and does not drill when the resolve fails', async () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-1')])
    let rejectResolve!: (err: Error) => void
    getFunctionMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectResolve = reject
      }),
    )

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))
    expect(useWorkflowStore.getState().digInPendingNodeId).toBe('s1')

    await act(async () => {
      rejectResolve(new Error('boom'))
      await Promise.resolve()
    })

    await waitFor(() => expect(useWorkflowStore.getState().digInPendingNodeId).toBeNull())
    expect(useWorkflowStore.getState().drillPath).toEqual([])
    expect(mockToastError).toHaveBeenCalledWith('boom', 'Could Not Load Function Body')
  })

  it('drills in when the gesture is repeated after a failure', async () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-1')])
    getFunctionMock.mockRejectedValueOnce(new Error('boom'))
    getFunctionMock.mockResolvedValueOnce(RESOLVED)

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('open'))
    await waitFor(() => expect(mockToastError).toHaveBeenCalled())

    // The in-flight lock is released, so pressing Open again re-reads.
    await act(async () => {
      result.current.handleContextMenuAction('open')
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(useWorkflowStore.getState().drillPath).toEqual([
        { nodeId: 's1', label: 'FetchUser' },
      ]),
    )
  })
})
