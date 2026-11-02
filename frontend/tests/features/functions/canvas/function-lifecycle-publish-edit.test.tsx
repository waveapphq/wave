/**
 * FunctionLifecycleDialogs - in-memory edit-mode publish flow.
 *
 * Publishing an edit-mode draft does not force-save the Test. The Publish
 * action opens the three-option PublishOutcomeDialog,
 * and the chosen outcome runs the test-independent `addFunctionVersion`
 * (`POST /functions/{id}/versions`) then applies the result in-memory:
 *
 *   - Publish and set New  -> re-pin this instance to the new version, clear markers.
 *   - Publish and keep Old -> publish to the library but leave this instance on
 *     its source version, discard the draft.
 *
 * No Test save is performed; other unsaved canvas edits are untouched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const addFunctionVersionMock = vi.fn()
const publishEditModeMock = vi.fn()
const publishLocalMock = vi.fn()

vi.mock('@/features/functions/api/functions-api', () => ({
  addFunctionVersion: (...args: unknown[]) => addFunctionVersionMock(...args),
  publishEditModeDraft: (...args: unknown[]) => publishEditModeMock(...args),
  publishLocalFunction: (...args: unknown[]) => publishLocalMock(...args),
  detachPublishedInstance: vi.fn(),
  createFunction: vi.fn(),
  getFunction: vi.fn(),
  getFunctionVersion: vi.fn(),
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
}))

vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: () => ({ versions: [], latest: '1.0.0', isLoading: false, failed: false, retry: () => {} }),
}))

vi.mock('@/features/functions/hooks/use-allowed-bumps', () => ({
  useAllowedBumps: () => ({ allowed: ['patch'], blocked: {}, isLoading: false, failed: false, retry: () => {} }),
}))

import { FunctionLifecycleDialogs } from '@/features/functions/canvas/function-lifecycle-dialogs'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const DRAFT = {
  name: 'Greet User',
  description: 'desc',
  tags: ['demo'],
  inputs: [{ name: 'x', type: 'string', required: true }],
  outputs: [{ name: 'result', type: 'string' }],
  dependencies: { functions: [], plugins: [] },
  workflow: { nodes: [], edges: [] },
}

const EDIT_NODE = {
  id: 'fn-edit',
  type: 'workflowNode' as const,
  position: { x: 0, y: 0 },
  data: {
    label: 'Greet User',
    elementType: 'function',
    nodeType: 'function' as const,
    functionLifecycle: 'shared' as const,
    functionId: 'lib-F1',
    functionVersion: '1.0.0',
    editMode: true,
    upstreamLink: { functionId: 'lib-F1', sourceVersion: '1.0.0' },
    draft: DRAFT,
  },
}

const OTHER_NODE = {
  id: 'other',
  type: 'workflowNode' as const,
  position: { x: 200, y: 0 },
  data: { label: 'untouched', nodeType: 'plugin' as const, elementType: 'log' },
}

function seed(): void {
  useWorkflowStore.setState({
    nodes: [EDIT_NODE, OTHER_NODE] as unknown as never,
    edges: [] as unknown as never,
    variables: [] as never,
    drillPath: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    publishDialogNodeId: null,
    makeLocalDialogNodeId: null,
    publishEditModeDialogNodeId: 'fn-edit',
    dropChangesDialogNodeId: null,
    // saved Test + dirty canvas -> in-memory path (mirrors from-Local useInMemoryPath)
    editingTestId: 'test-1',
    isDirty: true,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

function func(): Record<string, unknown> | undefined {
  return useWorkflowStore.getState().nodes.find((n) => n.id === 'fn-edit')?.data as
    | Record<string, unknown>
    | undefined
}

async function openOutcome(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'my changes')
  await user.click(screen.getByRole('button', { name: /^publish$/i }))
}

beforeEach(() => {
  addFunctionVersionMock.mockReset()
  addFunctionVersionMock.mockResolvedValue({ function_id: 'lib-F1', version: '1.0.1' })
  publishEditModeMock.mockReset()
  publishLocalMock.mockReset()
  seed()
})

describe('in-memory edit-mode publish - Publish and set New', () => {
  it('calls addFunctionVersion (not the test-coupled publishEditModeDraft)', async () => {
    const user = userEvent.setup()
    render(<FunctionLifecycleDialogs />)
    await openOutcome(user)
    await user.click(screen.getByRole('button', { name: /publish and set new/i }))

    await waitFor(() => {
      expect(addFunctionVersionMock).toHaveBeenCalledWith(
        'lib-F1',
        expect.objectContaining({
          sourceVersion: '1.0.0',
          targetVersion: '1.0.1',
          draftDefinition: expect.objectContaining({ name: 'Greet User' }),
          changelog: 'my changes',
        }),
      )
    })
    expect(publishEditModeMock).not.toHaveBeenCalled()
  })

  it('re-pins the instance to the new version and clears the edit markers', async () => {
    const user = userEvent.setup()
    render(<FunctionLifecycleDialogs />)
    await openOutcome(user)
    await user.click(screen.getByRole('button', { name: /publish and set new/i }))

    await waitFor(() => expect(func()?.functionVersion).toBe('1.0.1'))
    expect(func()?.editMode).toBeFalsy()
    expect(func()?.draft).toBeUndefined()
  })

  it('refreshes the resolved I/O contract to the published draft', async () => {
    // Without the contract refresh the re-pinned node keeps stale/absent
    // resolved I/O and the config modal renders empty input/output sections.
    const user = userEvent.setup()
    render(<FunctionLifecycleDialogs />)
    await openOutcome(user)
    await user.click(screen.getByRole('button', { name: /publish and set new/i }))

    await waitFor(() => expect(func()?.functionVersion).toBe('1.0.1'))
    expect(func()?.resolvedInputs).toEqual(DRAFT.inputs)
    expect(func()?.resolvedOutputs).toEqual(DRAFT.outputs)
  })

  it('does not force a Test save and leaves other unsaved edits untouched', async () => {
    const user = userEvent.setup()
    render(<FunctionLifecycleDialogs />)
    await openOutcome(user)
    await user.click(screen.getByRole('button', { name: /publish and set new/i }))

    await waitFor(() => expect(addFunctionVersionMock).toHaveBeenCalled())
    expect(publishLocalMock).not.toHaveBeenCalled()
    expect(useWorkflowStore.getState().nodes.find((n) => n.id === 'other')).toBeDefined()
  })
})

describe('in-memory edit-mode publish - Publish and set New applies the input fit rule (FNCFG-9)', () => {
  it('drops a pick the new version no longer allows and keeps a still-allowed pick and an expression', async () => {
    const enumDraft = {
      ...DRAFT,
      inputs: [
        { name: 'level', type: 'string', required: true, enumValues: ['low', 'medium'] },
        { name: 'tier', type: 'string', required: true, enumValues: ['gold', 'silver'] },
        { name: 'count', type: 'integer', required: true },
      ],
    }
    const stored = {
      config: { values: { level: 'high', tier: 'gold', count: 'chosen_count' } },
      expressionFields: ['count'],
    }
    useWorkflowStore.setState({
      nodes: [{ ...EDIT_NODE, data: { ...EDIT_NODE.data, draft: enumDraft, ...stored } }, OTHER_NODE] as unknown as never,
    })
    const user = userEvent.setup()
    render(<FunctionLifecycleDialogs />)
    await openOutcome(user)
    await user.click(screen.getByRole('button', { name: /publish and set new/i }))

    await waitFor(() => expect(func()?.functionVersion).toBe('1.0.1'))
    expect((func()?.config as { values?: Record<string, unknown> }).values).toEqual({ tier: 'gold', count: 'chosen_count' })
    expect(func()?.expressionFields).toEqual(['count'])
    expect(func()).not.toHaveProperty('inputBindings')
  })
})

describe('in-memory edit-mode publish - Publish and keep Old', () => {
  it('publishes the new version but leaves the instance pinned to the source', async () => {
    const user = userEvent.setup()
    render(<FunctionLifecycleDialogs />)
    await openOutcome(user)
    await user.click(screen.getByRole('button', { name: /publish and keep old/i }))

    await waitFor(() => expect(addFunctionVersionMock).toHaveBeenCalled())
    // Instance stays on the source version; the draft is discarded.
    expect(func()?.functionVersion).toBe('1.0.0')
    expect(func()?.editMode).toBeFalsy()
    expect(func()?.draft).toBeUndefined()
  })

  it('keeps the instance on the source contract, not the draft', async () => {
    // Keep Old leaves the instance on its source version, so it must NOT adopt
    // the draft's resolved I/O (which belongs to the newly-published version).
    const user = userEvent.setup()
    render(<FunctionLifecycleDialogs />)
    await openOutcome(user)
    await user.click(screen.getByRole('button', { name: /publish and keep old/i }))

    await waitFor(() => expect(addFunctionVersionMock).toHaveBeenCalled())
    expect(func()?.resolvedInputs).toBeUndefined()
    expect(func()?.resolvedOutputs).toBeUndefined()
  })
})

describe('in-memory edit-mode publish - outcome dialog controls', () => {
  it('Cancel on the outcome dialog closes it without publishing', async () => {
    const user = userEvent.setup()
    render(<FunctionLifecycleDialogs />)
    await openOutcome(user)
    const outcome = screen.getByRole('alertdialog')
    await user.click(within(outcome).getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(addFunctionVersionMock).not.toHaveBeenCalled()
    // The node is left untouched (still in edit mode).
    expect(func()?.editMode).toBe(true)
  })

  it('surfaces an inline error when addFunctionVersion rejects', async () => {
    addFunctionVersionMock.mockRejectedValueOnce({
      status: 409,
      message: "Target version '1.0.1' already exists in the library",
    })
    const user = userEvent.setup()
    render(<FunctionLifecycleDialogs />)
    await openOutcome(user)
    await user.click(screen.getByRole('button', { name: /publish and set new/i }))
    expect(await screen.findByText(/already exists in the library/i)).toBeInTheDocument()
    // Failure leaves the node in edit mode (not re-pinned).
    expect(func()?.editMode).toBe(true)
    expect(func()?.functionVersion).toBe('1.0.0')
  })

  it('falls back to "Publish failed" when the rejection carries no message', async () => {
    addFunctionVersionMock.mockRejectedValueOnce({})
    const user = userEvent.setup()
    render(<FunctionLifecycleDialogs />)
    await openOutcome(user)
    await user.click(screen.getByRole('button', { name: /publish and set new/i }))
    expect(await screen.findByText('Publish failed')).toBeInTheDocument()
  })
})
