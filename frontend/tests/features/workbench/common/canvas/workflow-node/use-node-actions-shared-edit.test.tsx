/**
 * useNodeActions - 'edit' action on a Shared Function instance.
 *
 * Edit-mode entry is always client-side - the draft is built from the
 * pinned version and the node is marked dirty (it persists only on Test Save).
 * There is no BE enter-edit-mode endpoint, so no BE round-trip.
 *
 * The client draft MUST carry the locked `name`
 * (via buildEditModeDraft), else the publish-time name-lock blocks every bump.
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

vi.mock('@/features/functions/api/functions-api', async (orig) => {
  const actual = await orig<typeof import('@/features/functions/api/functions-api')>()
  return { ...actual, getFunctionVersion: vi.fn() }
})
import { getFunctionVersion as getFunctionVersionImport } from '@/features/functions/api/functions-api'
const getFunctionVersionMock = getFunctionVersionImport as unknown as Mock

const wrapper = ({ children }: { children: ReactNode }) => (
  <AdHocActionsProvider dispatch={() => {}}>{children}</AdHocActionsProvider>
)

const DEFINITION = {
  id: 'lib-1',
  name: 'F1-Func',
  description: 'd',
  tags: ['t'],
  inputs: [],
  outputs: [],
  dependencies: { functions: [], plugins: [] },
  workflow: { nodes: [], edges: [] },
  metadata: { author: '', created_at: '', updated_at: '' },
}

function sharedInstance() {
  return {
    id: 's1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'F1-Func',
      nodeType: 'function',
      elementType: 'function',
      functionLifecycle: 'shared',
      functionId: 'lib-1',
      functionVersion: '1.0.0',
    },
  }
}

beforeEach(() => {
  getFunctionVersionMock.mockReset()
  mockToastError.mockReset()
  useWorkflowStore.setState({
    nodes: [sharedInstance()] as unknown as never,
    edges: [] as unknown as never,
    variables: [] as never,
    drillPath: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    editingTestId: null,
    isDirty: false,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
})

describe("useNodeActions - 'edit' on a Shared instance (draft canvas)", () => {
  it('seeds the draft with the locked name from the pinned version', async () => {
    getFunctionVersionMock.mockResolvedValueOnce({ definition: DEFINITION })

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('edit'))

    await waitFor(() => {
      expect(getFunctionVersionMock).toHaveBeenCalledWith('lib-1', '1.0.0')
    })
    await waitFor(() => {
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 's1')
      const draft = (node?.data as { draft?: { name?: string } }).draft
      expect(draft?.name).toBe('F1-Func')
    })
  })

  it('enters edit mode client-side even on a saved Test (never a BE endpoint)', async () => {
    // Edit-mode entry is always client-side now. Even when editingTestId
    // is set, Edit fetches the pinned version and applies the draft client-side,
    // marking the node dirty (it persists only on Test Save).
    useWorkflowStore.setState({
      editingTestId: 'test-1',
    } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
    getFunctionVersionMock.mockResolvedValue({ definition: DEFINITION })

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('edit'))

    await waitFor(() => expect(getFunctionVersionMock).toHaveBeenCalledWith('lib-1', '1.0.0'))
    await waitFor(() => {
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 's1')
      const data = node?.data as { editMode?: boolean; draft?: { name?: string } }
      expect(data.editMode).toBe(true)
      expect(data.draft?.name).toBe('F1-Func')
    })
    expect(useWorkflowStore.getState().isDirty).toBe(true)
  })

  it('reports on the gesture and enters no edit mode when the pinned version cannot be read', async () => {
    getFunctionVersionMock.mockRejectedValueOnce(new Error('library down'))

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('edit'))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('library down', 'Could Not Load Function Body'),
    )
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 's1')
    expect((node?.data as { editMode?: boolean }).editMode).toBeUndefined()
  })

  it('enters edit mode when the gesture is repeated after a failure', async () => {
    getFunctionVersionMock.mockRejectedValueOnce(new Error('library down'))
    getFunctionVersionMock.mockResolvedValueOnce({ definition: DEFINITION })

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('edit'))
    await waitFor(() => expect(mockToastError).toHaveBeenCalled())

    await act(async () => {
      result.current.handleContextMenuAction('edit')
      await Promise.resolve()
    })

    await waitFor(() => {
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 's1')
      expect((node?.data as { editMode?: boolean }).editMode).toBe(true)
    })
  })

  it("'publish-edit-mode' opens the publish-edit-mode dialog for the node", () => {
    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('publish-edit-mode'))
    expect(useWorkflowStore.getState().publishEditModeDialogNodeId).toBe('s1')
  })

  it("'drop-changes' opens the drop-changes dialog for the node", () => {
    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('drop-changes'))
    expect(useWorkflowStore.getState().dropChangesDialogNodeId).toBe('s1')
  })

  it("'edit' is a no-op when the instance carries no functionId", async () => {
    // runEditAction guard: `if (!functionId) return` - the client draft path
    // never runs when the node lacks a library link.
    const node = sharedInstance()
    node.data = { ...node.data, functionId: undefined } as unknown as typeof node.data
    useWorkflowStore.setState({
      nodes: [node] as unknown as never,
    } as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('edit'))

    await new Promise((r) => setTimeout(r, 10))
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
    const stored = useWorkflowStore.getState().nodes.find((n) => n.id === 's1')
    expect((stored?.data as { editMode?: boolean }).editMode).toBeUndefined()
  })

  it("'edit' (draft canvas) is a no-op when no source version can be resolved", async () => {
    // functionId present but neither data.functionVersion nor the selector pins
    // a version: sourceVersion falls back to undefined and runEditAction bails
    // via `if (!sourceVersion) return`.
    const node = sharedInstance()
    node.data = { ...node.data, functionVersion: undefined } as unknown as typeof node.data
    useWorkflowStore.setState({
      nodes: [node] as unknown as never,
      editingTestId: null,
    } as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    const { result } = renderHook(() => useNodeActions({ id: 's1' }), { wrapper })
    act(() => result.current.handleContextMenuAction('edit'))

    await new Promise((r) => setTimeout(r, 10))
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
    const stored = useWorkflowStore.getState().nodes.find((n) => n.id === 's1')
    expect((stored?.data as { editMode?: boolean }).editMode).toBeUndefined()
  })
})
