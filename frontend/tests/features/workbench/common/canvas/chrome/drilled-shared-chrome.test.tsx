/**
 * Tests for DrilledSharedChrome - the store-connected wrapper that gates the
 * read-only/edit-mode chrome on drill state and wires Edit Function (always
 * client-side from the pinned version) + Drop changes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: mockToastError }),
}))

const getFunctionVersionMock = vi.fn()
vi.mock('@/features/functions/api/functions-api', () => ({
  getFunctionVersion: (...args: unknown[]) => getFunctionVersionMock(...args),
}))

let mockInfo: { nodeId: string; editMode: boolean; sourceVersion?: string } | null = null
vi.mock('@/features/workbench/common/canvas/use-readonly-canvas', () => ({
  useDrilledSharedInfo: () => mockInfo,
}))

const store = {
  editingTestId: null as string | null,
  applyEditModeEntered: vi.fn(),
  openDropChangesDialog: vi.fn(),
  openPublishEditModeDialog: vi.fn(),
  nodes: [] as { id: string; data?: Record<string, unknown> }[],
}
vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector: (s: typeof store) => unknown) => selector(store),
}))

import { DrilledSharedChrome } from '@/features/workbench/common/canvas/chrome/drilled-shared-chrome'

const LIB_DEFINITION = {
  name: 'F1-Func',
  description: '',
  tags: ['t'],
  workflow: { nodes: [], edges: [] },
  inputs: [],
  outputs: [],
  dependencies: { functions: [], plugins: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInfo = null
  store.editingTestId = null
  store.nodes = []
})

describe('DrilledSharedChrome', () => {
  it('renders nothing when not drilled into a Shared instance', () => {
    const { container } = render(<DrilledSharedChrome />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the read-only chrome variant when drilled in (not edit mode)', () => {
    mockInfo = { nodeId: 's1', editMode: false }
    render(<DrilledSharedChrome />)
    expect(screen.getByLabelText('Read-only inspect mode')).toBeInTheDocument()
    expect(screen.getByLabelText('Edit Function')).toBeInTheDocument()
  })

  it('Edit Function on a saved Test enters edit mode client-side (never a BE endpoint)', async () => {
    // Even on a saved Test, Edit builds the draft client-side from the
    // pinned version (the BE enter-edit-mode endpoint is removed).
    mockInfo = { nodeId: 's1', editMode: false, sourceVersion: '1.0.0' }
    store.editingTestId = 'test-1'
    store.nodes = [{ id: 's1', data: { functionId: 'lib-1', functionVersion: '1.0.0' } }]
    getFunctionVersionMock.mockResolvedValue({ definition: LIB_DEFINITION })

    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Edit Function'))

    expect(getFunctionVersionMock).toHaveBeenCalledWith('lib-1', '1.0.0')
    await waitFor(() => {
      const applied = store.applyEditModeEntered.mock.calls.at(-1)
      expect(applied?.[0]).toBe('s1')
      const data = applied?.[1] as { editMode?: boolean; draft?: { name?: string } }
      expect(data.editMode).toBe(true)
      expect(data.draft?.name).toBe('F1-Func')
    })
  })

  it('Edit Function on a draft canvas builds an in-memory snapshot from the library version', async () => {
    mockInfo = { nodeId: 's1', editMode: false, sourceVersion: '1.0.0' }
    store.editingTestId = null
    store.nodes = [{ id: 's1', data: { functionId: 'lib-1', functionVersion: '1.0.0' } }]
    getFunctionVersionMock.mockResolvedValue({ definition: LIB_DEFINITION })

    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Edit Function'))

    expect(getFunctionVersionMock).toHaveBeenCalledWith('lib-1', '1.0.0')
    await waitFor(() => {
      const call = store.applyEditModeEntered.mock.calls[0]
      expect(call[0]).toBe('s1')
      const applied = call[1] as { editMode: boolean; draft: { name?: string } }
      expect(applied.editMode).toBe(true)
      // Guard: the client draft carries the locked library name.
      expect(applied.draft.name).toBe('F1-Func')
    })
  })

  it('reports on the gesture when the library-version fetch fails', async () => {
    mockInfo = { nodeId: 's1', editMode: false, sourceVersion: '1.0.0' }
    store.editingTestId = null
    store.nodes = [{ id: 's1', data: { functionId: 'lib-1', functionVersion: '1.0.0' } }]
    getFunctionVersionMock.mockRejectedValue(new Error('gone'))

    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Edit Function'))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('gone', 'Could Not Load Function Body'),
    )
    expect(store.applyEditModeEntered).not.toHaveBeenCalled()
  })

  it('enters edit mode when Edit Function is pressed again after a failure', async () => {
    mockInfo = { nodeId: 's1', editMode: false, sourceVersion: '1.0.0' }
    store.editingTestId = null
    store.nodes = [{ id: 's1', data: { functionId: 'lib-1', functionVersion: '1.0.0' } }]
    getFunctionVersionMock.mockRejectedValueOnce(new Error('gone'))
    getFunctionVersionMock.mockResolvedValueOnce({ definition: LIB_DEFINITION })

    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Edit Function'))
    await waitFor(() => expect(mockToastError).toHaveBeenCalled())

    await act(async () => {
      await userEvent.click(screen.getByLabelText('Edit Function'))
    })

    await waitFor(() => expect(store.applyEditModeEntered).toHaveBeenCalled())
  })

  it('finds a Shared node nested inside a Local Function body', async () => {
    mockInfo = { nodeId: 's-inner', editMode: false, sourceVersion: '1.0.0' }
    store.editingTestId = 'test-1'
    store.nodes = [
      {
        id: 'fn-local',
        data: {
          localDefinition: { workflow: { nodes: [{ id: 's-inner', data: { functionId: 'lib-1' } }] } },
        },
      },
    ]
    getFunctionVersionMock.mockResolvedValue({ definition: LIB_DEFINITION })

    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Edit Function'))

    expect(getFunctionVersionMock).toHaveBeenCalledWith('lib-1', '1.0.0')
  })

  it('is a no-op when the drilled node cannot be located', async () => {
    mockInfo = { nodeId: 's1', editMode: false, sourceVersion: '1.0.0' }
    store.editingTestId = 'test-1'
    store.nodes = [{ id: 'other', data: {} }]

    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Edit Function'))

    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })

  it('is a no-op when the located node has no functionId', async () => {
    mockInfo = { nodeId: 's1', editMode: false, sourceVersion: '1.0.0' }
    store.editingTestId = 'test-1'
    store.nodes = [{ id: 's1', data: {} }]

    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Edit Function'))

    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })

  it('defaults to an empty data object when the matched node carries no data', async () => {
    mockInfo = { nodeId: 's1', editMode: false, sourceVersion: '1.0.0' }
    store.editingTestId = 'test-1'
    store.nodes = [{ id: 's1', data: undefined }]

    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Edit Function'))

    // Node is located (data ?? {} -> {}), but the empty data has no functionId,
    // so the flow stops before reaching the client-side draft fetch.
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })

  it('is a no-op on a draft canvas when no source version can be resolved', async () => {
    mockInfo = { nodeId: 's1', editMode: false }
    store.editingTestId = null
    store.nodes = [{ id: 's1', data: { functionId: 'lib-1' } }]

    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Edit Function'))

    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })

  it('Drop changes opens the drop-changes dialog (edit-mode variant)', async () => {
    mockInfo = { nodeId: 's1', editMode: true }
    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Drop changes'))
    expect(store.openDropChangesDialog).toHaveBeenCalledWith('s1')
  })

  it('Publish opens the publish-edit-mode dialog', async () => {
    mockInfo = { nodeId: 's1', editMode: true }
    render(<DrilledSharedChrome />)
    await userEvent.click(screen.getByLabelText('Publish'))
    expect(store.openPublishEditModeDialog).toHaveBeenCalledWith('s1')
  })
})
