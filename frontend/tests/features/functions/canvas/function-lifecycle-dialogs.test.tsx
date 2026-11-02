/**
 * Tests for `FunctionLifecycleDialogs` - the wiring layer that picks the
 * right backend path (saved-test routes vs in-memory create/get) based on
 * the canvas state (`editingTestId`, `isDirty`).
 *
 * Behaviors covered:
 *   - Saved + clean Test → publish_local_function / detach_published_instance
 *   - Saved + dirty Test → createFunction / getFunction (in-memory fallback)
 *   - Draft Test (no editingTestId) → createFunction / getFunction
 *   - On publish success → node lifecycle swaps to shared with new functionId
 *   - On detach success → node lifecycle swaps to local with copied body
 *   - When no dialog node id is queued → renders nothing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'

const publishMock = vi.fn()
const detachMock = vi.fn()
const createFunctionMock = vi.fn()
const getFunctionMock = vi.fn()
const getFunctionVersionMock = vi.fn()
const addFunctionVersionMock = vi.fn()

vi.mock('@/features/functions/api/functions-api', () => ({
  publishLocalFunction: (...args: unknown[]) => publishMock(...args),
  detachPublishedInstance: (...args: unknown[]) => detachMock(...args),
  createFunction: (...args: unknown[]) => createFunctionMock(...args),
  getFunction: (...args: unknown[]) => getFunctionMock(...args),
  getFunctionVersion: (...args: unknown[]) => getFunctionVersionMock(...args),
  addFunctionVersion: (...args: unknown[]) => addFunctionVersionMock(...args),
  listFunctionTags: vi.fn(async () => []),
  listFunctions: vi.fn(async () => ({
    functions: [],
    pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
  })),
  listFunctionVersions: vi.fn(),
  validateBumps: vi.fn(),
  deleteFunction: vi.fn(),
  getDependents: vi.fn(),
  batchCreateFunctions: vi.fn(),
  batchDeleteFunctions: vi.fn(),
  exportFunction: vi.fn(),
  exportFunctionsBatch: vi.fn(),
  importFunctions: vi.fn(),
  runScopedFunction: vi.fn(),
}))

// The edit-mode publish dialog reads its allowed-bumps map from a fetching
// hook; the parent prefills source metadata from the versions hook. Both are
// mocked at the module boundary so no network IO leaks into this unit test.
const useFunctionVersionsMock = vi.fn()
vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: (...args: unknown[]) => useFunctionVersionsMock(...args),
}))

vi.mock('@/features/functions/hooks/use-allowed-bumps', () => ({
  useAllowedBumps: () => ({
    allowed: ['patch', 'minor', 'major'],
    blocked: {},
    isLoading: false,
    failed: false,
    retry: () => {},
  }),
}))

import { FunctionLifecycleDialogs } from '@/features/functions/canvas/function-lifecycle-dialogs'
import { ToastContext } from '@/components/ui/toast'

type ToastContextValue = NonNullable<React.ContextType<typeof ToastContext>>
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { usePageBlockStore } from '@/stores/page-block-store'

const LOCAL_NODE = {
  id: 'fn-local',
  type: 'workflowNode' as const,
  position: { x: 0, y: 0 },
  data: {
    label: 'My Local Function',
    elementType: 'function',
    nodeType: 'function' as const,
    functionLifecycle: 'local' as const,
    localDefinition: {
      name: 'My Local Function',
      description: '',
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
    },
  },
}

const SHARED_NODE = {
  id: 'fn-shared',
  type: 'workflowNode' as const,
  position: { x: 0, y: 0 },
  data: {
    label: 'Greet User',
    elementType: 'function',
    nodeType: 'function' as const,
    functionLifecycle: 'shared' as const,
    functionId: '00000000-0000-0000-0000-0000000000aa',
  },
}

function resetStore(): void {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    drillPath: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    publishDialogNodeId: null,
    makeLocalDialogNodeId: null,
    publishEditModeDialogNodeId: null,
    dropChangesDialogNodeId: null,
    editingTestId: null,
    isDirty: false,
    functionViewMode: null,
  })
}

beforeEach(() => {
  publishMock.mockReset()
  detachMock.mockReset()
  createFunctionMock.mockReset()
  getFunctionMock.mockReset()
  getFunctionVersionMock.mockReset()
  addFunctionVersionMock.mockReset()
  useFunctionVersionsMock.mockReset()
  useFunctionVersionsMock.mockReturnValue({
    versions: [],
    latest: '',
    isLoading: false,
    failed: false,
    retry: () => {},
  })
  addFunctionVersionMock.mockResolvedValue({
    function_id: '00000000-0000-0000-0000-0000000000aa',
    version: '2.0.1',
  })
  getFunctionVersionMock.mockResolvedValue({
    definition: {
      workflow: { nodes: [{ id: 'published', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'P', nodeType: 'plugin' } }], edges: [] },
      inputs: [],
      outputs: [],
    },
  })

  publishMock.mockResolvedValue({
    function_id: 'pub-1',
    version: '1.0.0',
    node: { id: 'fn-local', data: { functionLifecycle: 'shared', functionId: 'pub-1' } },
  })
  detachMock.mockResolvedValue({
    node: {
      id: 'fn-shared',
      data: {
        functionLifecycle: 'local',
        localDefinition: { name: 'Greet User', inputs: [], outputs: [] },
      },
    },
  })
  createFunctionMock.mockResolvedValue({
    definition: {
      id: 'new-fn-1',
      name: 'My Local Function',
      description: '',
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
      metadata: { author: 'wave', created_at: '', updated_at: '' },
    },
    etag: '"new-etag"',
  })
  getFunctionMock.mockResolvedValue({
    definition: {
      id: '00000000-0000-0000-0000-0000000000aa',
      name: 'Greet User',
      description: 'lib body',
      tags: ['demo'],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
      metadata: { author: 'wave', created_at: '', updated_at: '' },
    },
    etag: '"x"',
  })
  resetStore()
  usePageBlockStore.setState({ block: null, retrying: false })
})


describe('FunctionLifecycleDialogs - renders nothing when idle', () => {
  it('renders nothing when no dialog is queued', () => {
    render(<FunctionLifecycleDialogs />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})


describe('FunctionLifecycleDialogs - Publish (saved + clean Test path)', () => {
  it('hits publishLocalFunction when editingTestId is set and isDirty=false', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [LOCAL_NODE],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: false,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(publishMock).toHaveBeenCalledTimes(1)
    })
    expect(createFunctionMock).not.toHaveBeenCalled()
    // Node lifecycle is swapped to shared.
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === 'fn-local')
    expect(node?.data.functionLifecycle).toBe('shared')
    expect(node?.data.functionId).toBe('pub-1')
  })
})


describe('FunctionLifecycleDialogs - Publish (draft path)', () => {
  it('hits createFunction when no editingTestId is set', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [LOCAL_NODE],
        editingTestId: null,
        isDirty: true,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(createFunctionMock).toHaveBeenCalledTimes(1)
    })
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('forwards the typed version to createFunction so the library matches the node pin', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [LOCAL_NODE],
        editingTestId: null,
        isDirty: true,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    const versionInput = screen.getByLabelText('Version')
    await user.clear(versionInput)
    await user.type(versionInput, '1.0.0-rc.20260101.build1234')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(createFunctionMock).toHaveBeenCalledTimes(1)
    })
    const payload = createFunctionMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.version).toBe('1.0.0-rc.20260101.build1234')
  })
})


describe('FunctionLifecycleDialogs - Publish (saved + dirty falls back to in-memory)', () => {
  it('hits createFunction when isDirty=true even with editingTestId set', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [LOCAL_NODE],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: true,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(createFunctionMock).toHaveBeenCalledTimes(1)
    })
    expect(publishMock).not.toHaveBeenCalled()
  })
})


describe('FunctionLifecycleDialogs - Make Local (saved + clean Test path)', () => {
  it('hits detachPublishedInstance when editingTestId is set and isDirty=false', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [SHARED_NODE],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: false,
        makeLocalDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: /^make local$/i }))
    await waitFor(() => {
      expect(detachMock).toHaveBeenCalledTimes(1)
    })
    expect(getFunctionMock).not.toHaveBeenCalled()
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === 'fn-shared')
    expect(node?.data.functionLifecycle).toBe('local')
  })
})


describe('FunctionLifecycleDialogs - Drop changes re-resolves the drilled body', () => {
  const sharedEditNode = {
    id: 'fn-shared',
    type: 'workflowNode' as const,
    position: { x: 0, y: 0 },
    data: {
      label: 'Greet User',
      elementType: 'function',
      nodeType: 'function' as const,
      functionLifecycle: 'shared' as const,
      functionId: '00000000-0000-0000-0000-0000000000aa',
      functionVersion: '1.0.0',
      editMode: true,
      upstreamLink: { functionId: '00000000-0000-0000-0000-0000000000aa', sourceVersion: '1.0.0' },
      draft: { name: 'Greet User', workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], dependencies: { functions: [], plugins: [] } },
      localDefinition: { workflow: { nodes: [{ id: 'edited', type: 'workflowNode' as const, position: { x: 0, y: 0 }, data: { label: 'E', nodeType: 'plugin' as const } }], edges: [] }, inputs: [], outputs: [], variables: [] },
    },
  }
  const drilled = {
    nodes: [sharedEditNode],
    drillPath: [{ nodeId: 'fn-shared', label: 'Greet User' }],
    dropChangesDialogNodeId: 'fn-shared',
    editingTestId: 'test-1',
    isDirty: true,
  }
  const confirmDrop = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: /^drop changes$/i }))
  }
  const sharedNode = () => useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-shared')

  it('in-Test drop while drilled pops to the nearest valid scope without a refetch', async () => {
    const user = userEvent.setup()
    act(() => { useWorkflowStore.setState(drilled) })
    await confirmDrop(user)
    await waitFor(() => expect((sharedNode()?.data as Record<string, unknown> | undefined)?.editMode).toBeUndefined())
    // The store-side surgery reconciles the drill location, so no library
    // fetch happens for the in-Test drop.
    expect(useWorkflowStore.getState().drillPath).toEqual([])
    expect(sharedNode()?.data.localDefinition).toBeUndefined()
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })

  it('library View: drop re-drills into the reverted published body', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        ...drilled,
        editingTestId: null,
        functionViewMode: { functionId: '00000000-0000-0000-0000-0000000000aa', version: '1.0.0', editable: true },
      })
    })
    await confirmDrop(user)
    await waitFor(() => expect(getFunctionVersionMock).toHaveBeenCalledWith('00000000-0000-0000-0000-0000000000aa', '1.0.0'))
    await waitFor(() => {
      const ids = ((sharedNode()?.data.localDefinition?.workflow.nodes ?? []) as { id: string }[]).map((n) => n.id)
      expect(ids).toEqual(['published'])
    })
    expect(useWorkflowStore.getState().drillPath).toEqual([{ nodeId: 'fn-shared', label: 'Greet User' }])
  })

  it('skips the re-resolve when not drilled into the node', async () => {
    const user = userEvent.setup()
    act(() => { useWorkflowStore.setState({ ...drilled, drillPath: [] }) })
    await confirmDrop(user)
    await waitFor(() => expect((sharedNode()?.data as Record<string, unknown> | undefined)?.editMode).toBeUndefined())
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })

  it('skips the re-resolve when the node has no functionId', async () => {
    const user = userEvent.setup()
    const noFid = { ...sharedEditNode, data: { ...sharedEditNode.data, functionId: undefined } }
    act(() => { useWorkflowStore.setState({ ...drilled, nodes: [noFid] }) })
    await confirmDrop(user)
    await waitFor(() => expect((sharedNode()?.data as Record<string, unknown> | undefined)?.editMode).toBeUndefined())
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })

  it('library View: a failed re-drill blocks the canvas (drop still applied)', async () => {
    const user = userEvent.setup()
    getFunctionVersionMock.mockRejectedValue(new Error('gone'))
    act(() => {
      useWorkflowStore.setState({
        ...drilled,
        editingTestId: null,
        functionViewMode: { functionId: '00000000-0000-0000-0000-0000000000aa', version: '1.0.0', editable: true },
      })
    })
    await confirmDrop(user)
    await waitFor(() => expect(getFunctionVersionMock).toHaveBeenCalled())
    expect((sharedNode()?.data as Record<string, unknown> | undefined)?.editMode).toBeUndefined()
    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load Function body')
    })
    expect(usePageBlockStore.getState().block?.detail.message).toBe('gone')
  })

  it('library View: Try Again re-runs the re-drill and clears the card on success', async () => {
    const user = userEvent.setup()
    getFunctionVersionMock.mockRejectedValueOnce(new Error('gone'))
    act(() => {
      useWorkflowStore.setState({
        ...drilled,
        editingTestId: null,
        functionViewMode: { functionId: '00000000-0000-0000-0000-0000000000aa', version: '1.0.0', editable: true },
      })
    })
    await confirmDrop(user)
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    await act(async () => {
      await usePageBlockStore.getState().block!.retry()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    const ids = ((sharedNode()?.data.localDefinition?.workflow.nodes ?? []) as { id: string }[]).map((n) => n.id)
    expect(ids).toEqual(['published'])
  })
})

describe('FunctionLifecycleDialogs - Make Local (draft path)', () => {
  it('hits getFunction when no editingTestId is set', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [SHARED_NODE],
        editingTestId: null,
        isDirty: true,
        makeLocalDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: /^make local$/i }))
    await waitFor(() => {
      expect(getFunctionMock).toHaveBeenCalledTimes(1)
    })
    expect(detachMock).not.toHaveBeenCalled()
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === 'fn-shared')
    expect(node?.data.functionLifecycle).toBe('local')
    expect(node?.data.localDefinition).toMatchObject({ name: 'Greet User' })
  })

  it('copies the version the Block pins, not the latest', async () => {
    const user = userEvent.setup()
    getFunctionVersionMock.mockResolvedValue({
      definition: {
        id: '00000000-0000-0000-0000-0000000000aa',
        name: 'Greet User',
        description: 'pinned body',
        tags: [],
        inputs: [{ name: 'count', type: 'integer', required: false }],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: [], edges: [] },
        metadata: { author: 'wave', created_at: '', updated_at: '' },
      },
      etag: '"v1"',
    })
    act(() => {
      useWorkflowStore.setState({
        nodes: [{ ...SHARED_NODE, data: { ...SHARED_NODE.data, functionVersion: '1.0.0' } }],
        editingTestId: null,
        isDirty: true,
        makeLocalDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: /^make local$/i }))
    await waitFor(() => {
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-shared')
      expect(node?.data.functionLifecycle).toBe('local')
    })
    expect(getFunctionVersionMock).toHaveBeenCalledWith('00000000-0000-0000-0000-0000000000aa', '1.0.0')
    expect(getFunctionMock).not.toHaveBeenCalled()
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-shared')
    expect(node?.data.localDefinition).toMatchObject({
      description: 'pinned body',
      inputs: [{ name: 'count', type: 'integer', required: false }],
    })
  })
})


describe('FunctionLifecycleDialogs - Make Local (saved + dirty falls back to in-memory)', () => {
  it('hits getFunction when isDirty=true even with editingTestId set', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [SHARED_NODE],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: true,
        makeLocalDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: /^make local$/i }))
    await waitFor(() => {
      expect(getFunctionMock).toHaveBeenCalledTimes(1)
    })
    expect(detachMock).not.toHaveBeenCalled()
  })
})


describe('FunctionLifecycleDialogs - missing localDefinition guard', () => {
  it('surfaces an inline error when the local node has no localDefinition', async () => {
    const user = userEvent.setup()
    const nodeNoLocalDef = {
      ...LOCAL_NODE,
      data: { ...LOCAL_NODE.data, localDefinition: undefined },
    }
    act(() => {
      useWorkflowStore.setState({
        nodes: [nodeNoLocalDef],
        editingTestId: null,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    expect(
      await screen.findByText(/local function definition is missing/i),
    ).toBeInTheDocument()
    expect(createFunctionMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })
})


describe('FunctionLifecycleDialogs - nullish-coalescing fallbacks', () => {
  it('handles a local Function with a sparse localDefinition (no inputs/outputs/dependencies/workflow keys)', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            ...LOCAL_NODE,
            data: {
              ...LOCAL_NODE.data,
              // Drop optional fields so the helper falls back to its defaults.
              localDefinition: { name: 'Sparse' } as never,
            },
          },
        ],
        editingTestId: null,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(createFunctionMock).toHaveBeenCalledTimes(1)
    })
    const payload = createFunctionMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.inputs).toEqual([])
    expect(payload.outputs).toEqual([])
    expect(payload.dependencies).toEqual({ functions: [], plugins: [] })
    expect(payload.workflow).toEqual({ nodes: [], edges: [] })
  })

  it('falls back to empty name / "Function" when the node has no label', async () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            ...LOCAL_NODE,
            data: { ...LOCAL_NODE.data, label: undefined as never },
          },
        ],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    // The Name input is initialized from suggestedName which falls back
    // to an empty string when the node has no label.
    expect((screen.getByLabelText(/^name\b/i) as HTMLInputElement).value).toBe('')
  })

  it('falls back to "Function" in the Make Local dialog when the shared node has no label', async () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            ...SHARED_NODE,
            data: { ...SHARED_NODE.data, label: undefined as never },
          },
        ],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        makeLocalDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    const dialog = await screen.findByRole('alertdialog')
    // The dialog body interpolates `functionName` - falls back to "Function".
    expect(dialog.textContent).toMatch(/Making\s+Function/i)
  })
})


describe('FunctionLifecycleDialogs - node-missing guards', () => {
  it('does not render the publish dialog when the queued node is not on the canvas', () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        publishDialogNodeId: 'ghost',
      })
    })
    render(<FunctionLifecycleDialogs />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not render the make-local dialog when the shared node has no functionId', () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            ...SHARED_NODE,
            data: { ...SHARED_NODE.data, functionId: undefined },
          },
        ],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        makeLocalDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})


describe('FunctionLifecycleDialogs - deep-search into a drilled Shared body', () => {
  it('resolves a node nested inside another node localDefinition.workflow.nodes', async () => {
    const user = userEvent.setup()
    // Outer Shared whose local body contains the target local Function. The
    // dialog id points at the INNER node, forcing findNodeAnywhere to recurse.
    const outerNode = {
      id: 'fn-outer',
      type: 'workflowNode' as const,
      position: { x: 0, y: 0 },
      data: {
        label: 'Outer',
        elementType: 'function',
        nodeType: 'function' as const,
        functionLifecycle: 'shared' as const,
        // A sibling node WITHOUT a localDefinition exercises the false side of
        // the `localDef?.workflow?.nodes` guard before the match is found.
        localDefinition: {
          inputs: [],
          outputs: [],
          workflow: {
            nodes: [
              {
                id: 'fn-plain',
                type: 'workflowNode' as const,
                position: { x: 0, y: 0 },
                data: { label: 'Plain', nodeType: 'plugin' as const },
              },
              LOCAL_NODE,
            ],
            edges: [],
          },
        },
      },
    }
    act(() => {
      useWorkflowStore.setState({
        nodes: [outerNode],
        editingTestId: null,
        isDirty: true,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(createFunctionMock).toHaveBeenCalledTimes(1)
    })
  })
})


const EDIT_NODE = {
  id: 'fn-shared',
  type: 'workflowNode' as const,
  position: { x: 0, y: 0 },
  data: {
    label: 'Greet User',
    elementType: 'function',
    nodeType: 'function' as const,
    functionLifecycle: 'shared' as const,
    functionId: '00000000-0000-0000-0000-0000000000aa',
    editMode: true,
    upstreamLink: { functionId: '00000000-0000-0000-0000-0000000000aa', sourceVersion: '2.0.0' },
    draft: { name: 'Greet User', workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], dependencies: { functions: [], plugins: [] } },
    // Drill-stamped working body: present whenever the node is on the drill
    // path (pushSharedDrill), required for stay-put reconciliation.
    localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] },
  },
}


describe('FunctionLifecycleDialogs - Publish edit-mode draft', () => {
  it('opens the outcome dialog on Publish, then Set New publishes and re-pins', async () => {
    const user = userEvent.setup()
    useFunctionVersionsMock.mockReturnValue({
      versions: [
        { version: '2.0.0', description: 'src desc', tags: ['t'], details: 'src details', published_at: '2026-01-01' },
      ],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    act(() => {
      useWorkflowStore.setState({
        nodes: [EDIT_NODE],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: false,
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    // Changelog is mandatory; fill it so Publish enables. Publish opens the
    // three-option outcome dialog (it does NOT publish directly).
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'bump it')
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    await user.click(await screen.findByRole('button', { name: /publish and set new/i }))
    await waitFor(() => {
      expect(addFunctionVersionMock).toHaveBeenCalledTimes(1)
    })
    // Set New re-pins the node to the authoritative published version.
    await waitFor(() => {
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-shared')
      expect(node?.data.functionVersion).toBe('2.0.1')
    })
    expect(useWorkflowStore.getState().publishEditModeDialogNodeId).toBeNull()
    // useFunctionVersions was queried with the node's functionId.
    expect(useFunctionVersionsMock).toHaveBeenCalledWith('00000000-0000-0000-0000-0000000000aa')
  })

  it('Keep Old publishes the new version but leaves the instance on the source', async () => {
    const user = userEvent.setup()
    useFunctionVersionsMock.mockReturnValue({
      versions: [
        { version: '2.0.0', description: 'src desc', tags: ['t'], details: 'src details', published_at: '2026-01-01' },
      ],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    act(() => {
      useWorkflowStore.setState({
        nodes: [EDIT_NODE],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: false,
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'keep old')
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    await user.click(await screen.findByRole('button', { name: /publish and keep old/i }))
    await waitFor(() => {
      expect(addFunctionVersionMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-shared')
      // Instance stays on the source version; the draft + markers are cleared.
      expect(node?.data.functionVersion).toBe('2.0.0')
      expect((node?.data as { editMode?: boolean }).editMode).toBeUndefined()
    })
  })

  it('Set New publishes a draft that has no declared inputs/outputs (empty contract)', async () => {
    const user = userEvent.setup()
    useFunctionVersionsMock.mockReturnValue({
      versions: [
        { version: '2.0.0', description: 'src desc', tags: ['t'], details: 'src details', published_at: '2026-01-01' },
      ],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    const node = {
      ...EDIT_NODE,
      data: {
        ...EDIT_NODE.data,
        draft: { name: 'Greet User', workflow: { nodes: [], edges: [] }, dependencies: { functions: [], plugins: [] } },
      },
    }
    delete (node.data as { localDefinition?: unknown }).localDefinition
    act(() => {
      useWorkflowStore.setState({
        nodes: [node],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: false,
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'no io')
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    await user.click(await screen.findByRole('button', { name: /publish and set new/i }))
    await waitFor(() => {
      expect(addFunctionVersionMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      const updated = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-shared')
      expect(updated?.data.functionVersion).toBe('2.0.1')
    })
  })

  it('Keep Old drops the input values the pinned contract no longer declares, with their flags', async () => {
    const user = userEvent.setup()
    useFunctionVersionsMock.mockReturnValue({
      versions: [
        { version: '2.0.0', description: 'src desc', tags: ['t'], details: 'src details', published_at: '2026-01-01' },
      ],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    const node = {
      ...EDIT_NODE,
      data: {
        ...EDIT_NODE.data,
        resolvedInputs: [{ name: 'keep' }],
        config: { values: { keep: 'var_a', stale: 'var_b' } },
        expressionFields: ['keep', 'stale'],
      },
    }
    act(() => {
      useWorkflowStore.setState({
        nodes: [node],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: false,
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'keep old')
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    await user.click(await screen.findByRole('button', { name: /publish and keep old/i }))
    await waitFor(() => {
      const updated = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-shared')
      const config = updated?.data.config as { values?: Record<string, unknown> }
      expect(config.values).toEqual({ keep: 'var_a' })
    })
    const updated = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-shared')
    expect((updated?.data as Record<string, unknown>).expressionFields).toEqual(['keep'])
    expect(updated?.data).not.toHaveProperty('inputBindings')
  })

  it('Keep Old reconciles output bindings against a pinned outputs-only contract', async () => {
    const user = userEvent.setup()
    useFunctionVersionsMock.mockReturnValue({
      versions: [
        { version: '2.0.0', description: 'src desc', tags: ['t'], details: 'src details', published_at: '2026-01-01' },
      ],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    const node = {
      ...EDIT_NODE,
      data: {
        ...EDIT_NODE.data,
        resolvedOutputs: [{ name: 'out_keep' }],
        config: { outputBindings: { out_keep: 'var_c', out_stale: 'var_d' } },
      },
    }
    act(() => {
      useWorkflowStore.setState({
        nodes: [node],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: false,
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'keep old')
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    await user.click(await screen.findByRole('button', { name: /publish and keep old/i }))
    await waitFor(() => {
      const updated = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-shared')
      const config = updated?.data.config as { outputBindings?: Record<string, string> }
      expect(config.outputBindings).toEqual({ out_keep: 'var_c' })
    })
  })

  it('library View: single-outcome Publish publishes and switches the View to the new version', async () => {
    const user = userEvent.setup()
    useFunctionVersionsMock.mockReturnValue({
      versions: [{ version: '2.0.0', description: 'src', tags: ['t'], details: 'src details', published_at: '2026-01-01' }],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    act(() => {
      useWorkflowStore.setState({
        nodes: [EDIT_NODE],
        drillPath: [{ nodeId: 'fn-shared', label: 'Greet User' }],
        editingTestId: null,
        isDirty: false,
        functionViewMode: {
          functionId: '00000000-0000-0000-0000-0000000000aa',
          version: '2.0.0',
          editable: true,
        },
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'view publish')
    // First Publish (edit-mode dialog) opens the single-outcome confirm.
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    const confirm = await screen.findByTestId('publish-outcome-single-confirm')
    // Single mode shows no three-option buttons.
    expect(screen.queryByRole('button', { name: /publish and set new/i })).toBeNull()
    await user.click(confirm)
    await waitFor(() => expect(addFunctionVersionMock).toHaveBeenCalledTimes(1))
    // The View switches to the freshly published version + refreshes the body.
    await waitFor(() =>
      expect(useWorkflowStore.getState().functionViewMode?.version).toBe('2.0.1'),
    )
    await waitFor(() =>
      expect(getFunctionVersionMock).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-0000000000aa',
        '2.0.1',
      ),
    )
  })

  it('library View: the published body becomes the baseline its secrets compare to', async () => {
    const user = userEvent.setup()
    useFunctionVersionsMock.mockReturnValue({
      versions: [{ version: '2.0.0', description: 'src', tags: ['t'], details: 'src details', published_at: '2026-01-01' }],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    const loaded = { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] }
    act(() => {
      useWorkflowStore.setState({
        nodes: [EDIT_NODE],
        drillPath: [{ nodeId: 'fn-shared', label: 'Greet User' }],
        editingTestId: null,
        isDirty: false,
        functionViewMode: { functionId: '00000000-0000-0000-0000-0000000000aa', version: '2.0.0', editable: true },
        functionViewBaseline: { nodeId: 'fn-shared', body: loaded },
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'view publish')
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    await user.click(await screen.findByTestId('publish-outcome-single-confirm'))

    await waitFor(() => expect(useWorkflowStore.getState().functionViewBaseline?.body).not.toBe(loaded))
    expect(useWorkflowStore.getState().functionViewBaseline?.nodeId).toBe('fn-shared')
    act(() => {
      useWorkflowStore.setState({ functionViewBaseline: null })
    })
  })

  it('library View: a publish while drilled two levels deep makes the published body the baseline', async () => {
    const user = userEvent.setup()
    useFunctionVersionsMock.mockReturnValue({
      versions: [{ version: '2.0.0', description: 'src', tags: ['t'], details: 'src details', published_at: '2026-01-01' }],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    const changedSecret = { id: 'l-tok', name: 'tok', type: 'string', isSecret: true, value: 'sk-new' }
    const inner = {
      id: 'fn-inner',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Inner',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [changedSecret] },
      },
    }
    const viewRoot = {
      ...EDIT_NODE,
      data: {
        ...EDIT_NODE.data,
        localDefinition: { workflow: { nodes: [inner], edges: [] }, inputs: [], outputs: [], variables: [] },
      },
    }
    const loaded = { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] }
    act(() => {
      useWorkflowStore.setState({
        nodes: [viewRoot] as never,
        drillPath: [
          { nodeId: 'fn-shared', label: 'Greet User' },
          { nodeId: 'fn-inner', label: 'Inner' },
        ],
        editingTestId: null,
        isDirty: false,
        functionViewMode: { functionId: '00000000-0000-0000-0000-0000000000aa', version: '2.0.0', editable: true },
        functionViewBaseline: { nodeId: 'fn-shared', body: loaded },
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'deep publish')
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    await user.click(await screen.findByTestId('publish-outcome-single-confirm'))

    await waitFor(() => expect(useWorkflowStore.getState().functionViewBaseline?.body).not.toBe(loaded))
    const baseline = useWorkflowStore.getState().functionViewBaseline
    expect(baseline?.nodeId).toBe('fn-shared')
    const innerBody = (baseline?.body.workflow.nodes[0]?.data as { localDefinition?: { variables?: unknown[] } })
      .localDefinition
    expect(innerBody?.variables).toEqual([expect.objectContaining({ name: 'tok', value: 'sk-new', isSecret: true })])
    act(() => {
      useWorkflowStore.setState({ functionViewBaseline: null, drillPath: [] })
    })
  })

  it('library View: a failed body refresh after publish blocks the canvas (View still switches)', async () => {
    const user = userEvent.setup()
    getFunctionVersionMock.mockRejectedValue(new Error('refresh gone'))
    useFunctionVersionsMock.mockReturnValue({
      versions: [{ version: '2.0.0', description: 'src', tags: ['t'], details: 'src details', published_at: '2026-01-01' }],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    act(() => {
      useWorkflowStore.setState({
        nodes: [EDIT_NODE],
        drillPath: [{ nodeId: 'fn-shared', label: 'Greet User' }],
        editingTestId: null,
        isDirty: false,
        functionViewMode: {
          functionId: '00000000-0000-0000-0000-0000000000aa',
          version: '2.0.0',
          editable: true,
        },
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'view publish fail')
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    const confirm = await screen.findByTestId('publish-outcome-single-confirm')
    await user.click(confirm)
    await waitFor(() => expect(addFunctionVersionMock).toHaveBeenCalledTimes(1))
    // Despite the refresh failure, the View version still switched.
    await waitFor(() =>
      expect(useWorkflowStore.getState().functionViewMode?.version).toBe('2.0.1'),
    )
    // The stale drilled body is reported instead of being shown as the new one.
    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load Function body')
    })
    expect(usePageBlockStore.getState().block?.detail.message).toBe('refresh gone')
    // The publish itself is not reported as failed.
    expect(screen.queryByTestId('publish-outcome-single-confirm')).toBeNull()
  })

  it('library View: publishes the EDITED drilled body, folding localDefinition into the stale draft', async () => {
    // In the View, adding an input writes node.localDefinition (the drilled
    // scope) but NOT node.draft. Publishing while still drilled in (no pop, so no
    // fold-on-pop) must fold localDefinition into the draft so the new version
    // includes the input - else the input is lost and PATCH is wrongly allowed.
    const user = userEvent.setup()
    useFunctionVersionsMock.mockReturnValue({
      versions: [
        { version: '1.0.0', description: 'src', tags: ['t'], details: 'src details', published_at: '2026-01-01' },
      ],
      latest: '1.0.0',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    const editedNode = {
      ...EDIT_NODE,
      data: {
        ...EDIT_NODE.data,
        functionVersion: '1.0.0',
        upstreamLink: { functionId: '00000000-0000-0000-0000-0000000000aa', sourceVersion: '1.0.0' },
        // Stale draft (source body: only input x).
        draft: {
          name: 'Greet User',
          description: '',
          tags: [],
          inputs: [{ name: 'x', type: 'string', required: false }],
          outputs: [],
          dependencies: { functions: [], plugins: [] },
          workflow: { nodes: [], edges: [] },
        },
        // Drilled-in edited body: a NEW input y was added via the Var Manager.
        localDefinition: {
          inputs: [
            { name: 'x', type: 'string', required: false },
            { name: 'y', type: 'string', required: false },
          ],
          outputs: [],
          dependencies: { functions: [], plugins: [] },
          workflow: { nodes: [], edges: [] },
        },
      } as unknown as typeof EDIT_NODE.data,
    }
    act(() => {
      useWorkflowStore.setState({
        nodes: [editedNode],
        drillPath: [{ nodeId: 'fn-shared', label: 'Greet User' }],
        editingTestId: null,
        isDirty: false,
        functionViewMode: {
          functionId: '00000000-0000-0000-0000-0000000000aa',
          version: '1.0.0',
          editable: true,
        },
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'added input y')
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    await user.click(await screen.findByTestId('publish-outcome-single-confirm'))
    await waitFor(() => expect(addFunctionVersionMock).toHaveBeenCalledTimes(1))
    const opts = addFunctionVersionMock.mock.calls[0][1] as {
      draftDefinition: { inputs: { name: string }[] }
    }
    const inputNames = opts.draftDefinition.inputs.map((i) => i.name)
    expect(inputNames).toContain('y')
  })

  it('does not render the edit-mode dialog when the node has no draft', () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          { ...EDIT_NODE, data: { ...EDIT_NODE.data, draft: undefined } as unknown as typeof EDIT_NODE.data },
        ],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('falls back through functionVersion then 1.0.0 for the source version', async () => {
    // No upstreamLink and no functionVersion -> sourceVersion resolves to 1.0.0.
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            ...EDIT_NODE,
            data: { ...EDIT_NODE.data, upstreamLink: undefined, functionVersion: undefined } as unknown as typeof EDIT_NODE.data,
          },
        ],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/source v1\.0\.0/i)
  })

  it('falls back to "Function" name and empty testId in draft (no editingTestId) mode', async () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          { ...EDIT_NODE, data: { ...EDIT_NODE.data, label: undefined } as unknown as typeof EDIT_NODE.data },
        ],
        editingTestId: null,
        isDirty: true,
        publishEditModeDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    const dialog = await screen.findByRole('dialog')
    // functionName fell back to "Function" in the locked source chip.
    expect(dialog.textContent).toMatch(/Function/)
  })
})


describe('FunctionLifecycleDialogs - Drop changes (saved + clean Test path)', () => {
  const cleanDrilled = {
    nodes: [
      {
        id: 'fn-shared',
        type: 'workflowNode' as const,
        position: { x: 0, y: 0 },
        data: {
          label: 'Greet User',
          elementType: 'function',
          nodeType: 'function' as const,
          functionLifecycle: 'shared' as const,
          functionId: '00000000-0000-0000-0000-0000000000aa',
          functionVersion: '1.0.0',
          editMode: true,
          upstreamLink: { functionId: '00000000-0000-0000-0000-0000000000aa', sourceVersion: '1.0.0' },
        },
      },
    ],
    drillPath: [],
    dropChangesDialogNodeId: 'fn-shared',
    editingTestId: '00000000-0000-0000-0000-000000000001',
    isDirty: false,
  }

  it('drops edit-mode markers client-side when editingTestId is set and clean (no BE round-trip)', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState(cleanDrilled)
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: /^drop changes$/i }))
    await waitFor(() => {
      expect(useWorkflowStore.getState().dropChangesDialogNodeId).toBeNull()
    })
    // The edit-mode markers are stripped in-memory; no BE drop round-trip.
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-shared')
    expect((node?.data as { editMode?: boolean }).editMode).toBeUndefined()
    // Not drilled into this node, so no re-resolve fetch fires.
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })
})


describe('FunctionLifecycleDialogs - Drop changes source-version fallbacks', () => {
  const dropNode = (data: Record<string, unknown>) => ({
    id: 'fn-shared',
    type: 'workflowNode' as const,
    position: { x: 0, y: 0 },
    data: {
      label: 'Greet User',
      elementType: 'function',
      nodeType: 'function' as const,
      functionLifecycle: 'shared' as const,
      functionId: '00000000-0000-0000-0000-0000000000aa',
      ...data,
    },
  })

  it('uses functionVersion when there is no upstreamLink.sourceVersion', async () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [dropNode({ functionVersion: '3.4.5' })],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: true,
        dropChangesDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toMatch(/3\.4\.5/)
  })

  it('falls back to 1.0.0 when neither upstreamLink nor functionVersion is set', async () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [dropNode({})],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: true,
        dropChangesDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toMatch(/1\.0\.0/)
  })

  it('falls back to "Function" when the drop-changes node has no label', async () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [dropNode({ label: undefined })],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: true,
        dropChangesDialogNodeId: 'fn-shared',
      })
    })
    render(<FunctionLifecycleDialogs />)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toMatch(/Function/)
  })
})


describe('FunctionLifecycleDialogs - publish success toast', () => {
  function makeToast(): ToastContextValue {
    return {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    } as unknown as ToastContextValue
  }

  it('fires a success toast naming the published Function and version', async () => {
    const user = userEvent.setup()
    const toast = makeToast()
    act(() => {
      useWorkflowStore.setState({
        nodes: [LOCAL_NODE],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: false,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(
      <ToastContext.Provider value={toast}>
        <FunctionLifecycleDialogs />
      </ToastContext.Provider>,
    )
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledTimes(1)
    })
    const [message] = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(message).toContain('My Local Function')
    expect(message).toContain('v1.0.0')
    expect(message.toLowerCase()).toContain('published')
  })

  it('stays silent (no crash) without a ToastContext provider', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [LOCAL_NODE],
        editingTestId: '00000000-0000-0000-0000-000000000001',
        isDirty: false,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(publishMock).toHaveBeenCalledTimes(1)
    })
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-local')
    expect(node?.data.functionLifecycle).toBe('shared')
  })
})


describe('FunctionLifecycleDialogs - Publish carries the local variables in the stored shape (REQ-3.1.2.1)', () => {
  it('sends each local by name, its secret flag as secret, never its canvas id', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            ...LOCAL_NODE,
            data: {
              ...LOCAL_NODE.data,
              localDefinition: {
                ...LOCAL_NODE.data.localDefinition,
                variables: [
                  { id: 'var-1', name: 'api_key', type: 'string', value: 'wave:enc:v1:c2VhbGVk', isSecret: true },
                  { id: 'var-2', name: 'retries', type: 'integer', value: 3 },
                ],
              } as never,
            },
          },
        ],
        editingTestId: null,
        isDirty: true,
        publishDialogNodeId: 'fn-local',
      })
    })
    render(<FunctionLifecycleDialogs />)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(createFunctionMock).toHaveBeenCalledTimes(1)
    })

    const payload = createFunctionMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.variables).toEqual([
      { name: 'api_key', type: 'string', value: 'wave:enc:v1:c2VhbGVk', secret: true },
      { name: 'retries', type: 'integer', value: 3 },
    ])
  })
})
