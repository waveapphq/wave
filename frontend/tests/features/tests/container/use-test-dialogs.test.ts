/**
 * useTestDialogs Hook Tests - Run Handler Wiring
 *
 * REQ-5.2.4.6: Wire RunDialog to tracked execution API
 *
 * Tests for handleTestRunDialogRun:
 * - Calls startExecution with test ID and environment ID
 * - Navigates to /executions/{id} on success
 * - Closes dialog after successful execution start
 * - Shows error on failure (does not navigate)
 *
 * Module: frontend/src/features/tests/container/use-test-dialogs.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTestDialogs } from '@/features/tests/container/use-test-dialogs'
import { createSimpleRouterWrapper } from '../../../utils/router-test-utils'

// Hoist mocks for navigate
const mockNavigate = vi.fn()

// Mock react-router-dom to capture navigate calls
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// Mock the executions API
vi.mock('@/features/executions/api/executions', () => ({
  startExecution: vi.fn(),
  fetchExecutions: vi.fn(),
  fetchExecution: vi.fn(),
  stopExecution: vi.fn(),
  deleteExecution: vi.fn(),
  transformApiExecution: vi.fn(),
}))

vi.mock('@/lib/format-duration', () => ({
  formatDuration: vi.fn(),
}))

// The surface passes its gated environments list in; the hook reads nothing.
const TEST_ENVIRONMENTS = [
  { id: 'env-1', name: 'Development' },
  { id: 'env-2', name: 'Staging' },
]

// Mock workflow store
const workflowState = {
  editingTestName: null as string | null,
  editingTestId: null as string | null,
  nodes: [] as unknown[],
  edges: [] as unknown[],
  markSaved: vi.fn(),
  reset: vi.fn(),
}

vi.mock('@/features/workbench/stores/workflow-store', () => {
  const store = vi.fn((selector: (state: typeof workflowState) => unknown) => selector(workflowState))
  Object.assign(store, { getState: () => workflowState })
  return { useWorkflowStore: store }
})

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: { clearSession: vi.fn() },
}))

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))

vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: mockToastError }),
}))

// Mock export-import
vi.mock('@/features/tests/api/export-import', () => ({
  exportTest: vi.fn(),
  exportTests: vi.fn(),
}))

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

// Mock the tests CRUD API so handleCreateNewTest / handleCloseNewTestDialog
// can be exercised without touching the network.
vi.mock('@/features/tests/api/crud', () => ({
  createTest: vi.fn().mockResolvedValue({ id: 'created-id', name: 'Created' }),
  fetchTests: vi.fn(),
  updateTest: vi.fn(),
  deleteTest: vi.fn(),
}))

import { startExecution } from '@/features/executions/api/executions'
import { createTest, updateTest } from '@/features/tests/api/crud'
import { exportTest, exportTests } from '@/features/tests/api/export-import'
import { downloadBlob } from '@/lib/download-blob'
import { workbenchApi } from '@/features/workbench/api/workbench'

describe('useTestDialogs - handleTestRunDialogRun', () => {
  const wrapper = createSimpleRouterWrapper()

  function createDeps() {
    return {
      tests: [
        {
          id: 'test-1',
          name: 'Login Test',
          status: 'passed' as const,
          lastRun: null,
          suiteCount: 0,
          suiteIds: [],
          suiteNames: [],
          tags: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      selectedIds: [] as string[],
      loadData: vi.fn().mockResolvedValue(undefined),
      setError: vi.fn(),
      environments: TEST_ENVIRONMENTS,
      setSwitchTestDialogOpen: vi.fn(),
      pendingOpenTestId: null,
      setPendingOpenTestId: vi.fn(),
      setNewTestDialogOpen: vi.fn(),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls startExecution with test ID and environment ID', async () => {
    vi.mocked(startExecution).mockResolvedValue({ id: 'exec-new-1' })
    const deps = createDeps()

    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    // Open the run dialog with a test
    act(() => {
      result.current.handleRunTest('test-1')
    })

    // Select an environment
    act(() => {
      result.current.handleTestEnvironmentSelect('env-1')
    })

    // Run
    await act(async () => {
      await result.current.handleTestRunDialogRun()
    })

    expect(startExecution).toHaveBeenCalledWith({
      type: 'test',
      id: 'test-1',
      environmentId: 'env-1',
    })
  })

  it('navigates to /workbench on success (live run streams there)', async () => {
    vi.mocked(startExecution).mockResolvedValue({ id: 'exec-new-2' })
    const deps = createDeps()

    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    act(() => {
      result.current.handleRunTest('test-1')
    })

    act(() => {
      result.current.handleTestEnvironmentSelect('env-1')
    })

    await act(async () => {
      await result.current.handleTestRunDialogRun()
    })

    expect(mockNavigate).toHaveBeenCalledWith('/workbench')
  })

  it('closes dialog after successful execution start', async () => {
    vi.mocked(startExecution).mockResolvedValue({ id: 'exec-new-3' })
    const deps = createDeps()

    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    act(() => {
      result.current.handleRunTest('test-1')
    })
    expect(result.current.testRunDialogOpen).toBe(true)

    act(() => {
      result.current.handleTestEnvironmentSelect('env-1')
    })

    await act(async () => {
      await result.current.handleTestRunDialogRun()
    })

    expect(result.current.testRunDialogOpen).toBe(false)
  })

  it('shows error on failure (does not navigate)', async () => {
    vi.mocked(startExecution).mockRejectedValue(new Error('Server Error'))
    const deps = createDeps()

    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    act(() => {
      result.current.handleRunTest('test-1')
    })

    act(() => {
      result.current.handleTestEnvironmentSelect('env-1')
    })

    await act(async () => {
      await result.current.handleTestRunDialogRun()
    })

    expect(mockNavigate).not.toHaveBeenCalled()
    expect(deps.setError).toHaveBeenCalledWith('Server Error')
  })

  it('shows generic error message when rejection is not an Error instance', async () => {
    vi.mocked(startExecution).mockRejectedValue('not an error object')
    const deps = createDeps()

    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    act(() => {
      result.current.handleRunTest('test-1')
    })
    act(() => {
      result.current.handleTestEnvironmentSelect('env-1')
    })

    await act(async () => {
      await result.current.handleTestRunDialogRun()
    })

    expect(mockNavigate).not.toHaveBeenCalled()
    expect(deps.setError).toHaveBeenCalledWith('Failed to start execution')
  })
})

describe('useTestDialogs - new test dialog handlers', () => {
  const wrapper = createSimpleRouterWrapper()

  beforeEach(() => {
    vi.mocked(createTest).mockResolvedValue({
      id: 'created-id',
      name: 'Created',
    } as unknown as Awaited<ReturnType<typeof createTest>>)
  })

  it('handleCreateNewTest creates the test and navigates to its workbench tab', async () => {
    const deps = {
      tests: [],
      selectedIds: [],
      loadData: vi.fn().mockResolvedValue(undefined),
      setError: vi.fn(),
      environments: TEST_ENVIRONMENTS,
      setSwitchTestDialogOpen: vi.fn(),
      pendingOpenTestId: null,
      setPendingOpenTestId: vi.fn(),
      setNewTestDialogOpen: vi.fn(),
    }
    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    await act(async () => {
      await result.current.handleCreateNewTest({
        name: 'Fresh',
        description: '',
        tags: ['smoke'],
      })
    })

    expect(vi.mocked(createTest)).toHaveBeenCalledWith({
      name: 'Fresh',
      description: undefined,
      tags: ['smoke'],
      workflow: { nodes: [], edges: [] },
    })
    expect(deps.setNewTestDialogOpen).toHaveBeenCalledWith(false)
    expect(mockNavigate).toHaveBeenCalledWith('/workbench?editTest=created-id')
  })

  it('handleCloseNewTestDialog closes the dialog without other side effects', () => {
    const deps = {
      tests: [],
      selectedIds: [],
      loadData: vi.fn().mockResolvedValue(undefined),
      setError: vi.fn(),
      environments: TEST_ENVIRONMENTS,
      setSwitchTestDialogOpen: vi.fn(),
      pendingOpenTestId: null,
      setPendingOpenTestId: vi.fn(),
      setNewTestDialogOpen: vi.fn(),
    }
    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })
    act(() => {
      result.current.handleCloseNewTestDialog()
    })
    expect(deps.setNewTestDialogOpen).toHaveBeenCalledWith(false)
  })
})

describe('useTestDialogs - save before switching test', () => {
  const wrapper = createSimpleRouterWrapper()

  function createDeps(pendingOpenTestId: string | null = null) {
    return {
      tests: [],
      selectedIds: [] as string[],
      loadData: vi.fn().mockResolvedValue(undefined),
      setError: vi.fn(),
      environments: TEST_ENVIRONMENTS,
      setSwitchTestDialogOpen: vi.fn(),
      pendingOpenTestId,
      setPendingOpenTestId: vi.fn(),
      setNewTestDialogOpen: vi.fn(),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'Login Test'
    vi.mocked(updateTest).mockResolvedValue(undefined as never)
    vi.mocked(workbenchApi.clearSession).mockResolvedValue(undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('saves the open test, clears the session and opens the target test', async () => {
    const deps = createDeps('test-2')
    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    await act(async () => {
      await result.current.handleSaveAndCreateNew()
    })

    expect(vi.mocked(updateTest)).toHaveBeenCalledWith('test-1', {
      name: 'Login Test',
      workflow: { nodes: [], edges: [] },
    })
    expect(workflowState.markSaved).toHaveBeenCalled()
    expect(vi.mocked(workbenchApi.clearSession)).toHaveBeenCalled()
    expect(deps.setSwitchTestDialogOpen).toHaveBeenCalledWith(false)
    expect(mockNavigate).toHaveBeenCalledWith('/workbench?editTest=test-2')
    expect(deps.setError).not.toHaveBeenCalled()
    expect(result.current.isSavingBeforeNewTest).toBe(false)
  })

  it('opens the new-test dialog when nothing is queued, and skips the save with no open test', async () => {
    workflowState.editingTestId = null
    workflowState.editingTestName = null
    const deps = createDeps(null)
    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    await act(async () => {
      await result.current.handleSaveAndCreateNew()
    })

    expect(vi.mocked(updateTest)).not.toHaveBeenCalled()
    expect(deps.setNewTestDialogOpen).toHaveBeenCalledWith(true)
  })

  it('does not save when the open test has no name', async () => {
    workflowState.editingTestName = null
    const deps = createDeps(null)
    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    await act(async () => {
      await result.current.handleSaveAndCreateNew()
    })

    expect(vi.mocked(updateTest)).not.toHaveBeenCalled()
  })

  it('reports a failed session clear and does not switch', async () => {
    vi.mocked(workbenchApi.clearSession).mockRejectedValue(new Error('Service Unavailable'))
    const deps = createDeps('test-2')
    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    await act(async () => {
      await result.current.handleSaveAndCreateNew()
    })

    expect(mockToastError).toHaveBeenCalledWith(
      'The workbench session is still open on the server: Service Unavailable',
      'Session Not Cleared',
    )
    // The save landed, but the switch does not present as done.
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(deps.setSwitchTestDialogOpen).not.toHaveBeenCalledWith(false)
    expect(workflowState.reset).not.toHaveBeenCalled()
    expect(result.current.isSavingBeforeNewTest).toBe(false)
  })

  it('discards the canvas and opens the target test once the session is cleared', async () => {
    const deps = createDeps('test-2')
    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    await act(async () => {
      await result.current.handleDiscardAndCreateNew()
    })

    expect(workflowState.reset).toHaveBeenCalled()
    expect(deps.setSwitchTestDialogOpen).toHaveBeenCalledWith(false)
    expect(mockNavigate).toHaveBeenCalledWith('/workbench?editTest=test-2')
  })

  it('keeps the canvas and reports when the discard cannot clear the session', async () => {
    vi.mocked(workbenchApi.clearSession).mockRejectedValue(new Error('Service Unavailable'))
    const deps = createDeps('test-2')
    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    await act(async () => {
      await result.current.handleDiscardAndCreateNew()
    })

    expect(mockToastError).toHaveBeenCalledWith(
      'The workbench session is still open on the server: Service Unavailable',
      'Session Not Cleared',
    )
    expect(workflowState.reset).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(deps.setSwitchTestDialogOpen).not.toHaveBeenCalled()
  })

  it('reports the reason and does not switch when the save fails', async () => {
    vi.mocked(updateTest).mockRejectedValue(new Error('Suite variable collision'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = createDeps('test-2')
    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    await act(async () => {
      await result.current.handleSaveAndCreateNew()
    })

    expect(deps.setError).toHaveBeenCalledWith('Suite variable collision')
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(deps.setSwitchTestDialogOpen).not.toHaveBeenCalled()
    expect(result.current.isSavingBeforeNewTest).toBe(false)
  })

  it('reports a generic reason when the rejection is not an Error', async () => {
    vi.mocked(updateTest).mockRejectedValue('not an error object')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = createDeps('test-2')
    const { result } = renderHook(() => useTestDialogs(deps), { wrapper })

    await act(async () => {
      await result.current.handleSaveAndCreateNew()
    })

    expect(deps.setError).toHaveBeenCalledWith('Failed to save test')
  })
})

describe('useTestDialogs - export downloads', () => {
  const wrapper = createSimpleRouterWrapper()

  function createDeps(selectedIds: string[] = []) {
    return {
      tests: [
        {
          id: 'test-1',
          name: 'Login Test',
          status: 'passed' as const,
          lastRun: null,
          suiteCount: 0,
          suiteIds: [],
          suiteNames: [],
          tags: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'test-2',
          name: 'Checkout Test',
          status: 'failed' as const,
          lastRun: null,
          suiteCount: 0,
          suiteIds: [],
          suiteNames: [],
          tags: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      selectedIds,
      loadData: vi.fn().mockResolvedValue(undefined),
      setError: vi.fn(),
      environments: TEST_ENVIRONMENTS,
      setSwitchTestDialogOpen: vi.fn(),
      pendingOpenTestId: null,
      setPendingOpenTestId: vi.fn(),
      setNewTestDialogOpen: vi.fn(),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('single export downloads through the shared downloadBlob helper', async () => {
    const blob = new Blob(['test-yaml'], { type: 'application/x-yaml' })
    vi.mocked(exportTest).mockResolvedValue({ blob, filename: 'Login Test.yaml' })
    const { result } = renderHook(() => useTestDialogs(createDeps()), { wrapper })

    act(() => {
      result.current.handleExportTest('test-1')
    })
    await act(async () => {
      await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
    })

    expect(vi.mocked(exportTest)).toHaveBeenCalledWith(
      'test-1',
      expect.objectContaining({ format: 'yaml', secrets: 'mask' })
    )
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'Login Test.yaml')
    expect(result.current.exportDialogOpen).toBe(false)
  })

  it('single export uses the name the server sent, not <name>.<format>', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' })
    vi.mocked(exportTest).mockResolvedValue({ blob, filename: 'Login Test.zip' })
    const { result } = renderHook(() => useTestDialogs(createDeps()), { wrapper })

    act(() => {
      result.current.handleExportTest('test-1')
    })
    await act(async () => {
      await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
    })

    expect(downloadBlob).toHaveBeenCalledWith(blob, 'Login Test.zip')
    expect(downloadBlob).not.toHaveBeenCalledWith(blob, 'Login Test.yaml')
  })

  it('bulk export downloads the ZIP through the shared downloadBlob helper', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' })
    vi.mocked(exportTests).mockResolvedValue(blob)
    const { result } = renderHook(() => useTestDialogs(createDeps(['test-1', 'test-2'])), {
      wrapper,
    })

    act(() => {
      result.current.handleBulkExport()
    })
    await act(async () => {
      await result.current.handleExportAction({ format: 'json', secrets: 'plaintext' })
    })

    expect(vi.mocked(exportTests)).toHaveBeenCalledWith(['test-1', 'test-2'], {
      format: 'json',
      secrets: 'plaintext',
    })
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'tests-export.zip')
  })

  it('several tests keep the fixed archive name even when one export returns a filename', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' })
    vi.mocked(exportTests).mockResolvedValue(blob)
    const { result } = renderHook(() => useTestDialogs(createDeps(['test-1', 'test-2'])), {
      wrapper,
    })

    act(() => {
      result.current.handleBulkExport()
    })
    await act(async () => {
      await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
    })

    expect(vi.mocked(exportTest)).not.toHaveBeenCalled()
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'tests-export.zip')
  })
})

describe('useTestDialogs - reload after import', () => {
  const wrapper = createSimpleRouterWrapper()

  function deps(loadData: () => Promise<void>) {
    return {
      tests: [],
      selectedIds: [],
      loadData,
      setError: vi.fn(),
      environments: TEST_ENVIRONMENTS,
      setSwitchTestDialogOpen: vi.fn(),
      pendingOpenTestId: null,
      setPendingOpenTestId: vi.fn(),
      setNewTestDialogOpen: vi.fn(),
    }
  }

  const importResult = { imported: [], skipped: [], failed: [] } as unknown as Parameters<
    ReturnType<typeof useTestDialogs>['handleImportComplete']
  >[0]

  it('names a reload that failed after the import dialog closed', async () => {
    const d = deps(vi.fn().mockRejectedValue(new Error('Service Unavailable')))
    const { result } = renderHook(() => useTestDialogs(d), { wrapper })

    await act(async () => {
      result.current.handleImportComplete(importResult)
    })

    expect(d.setError).toHaveBeenCalledWith('Service Unavailable')
  })

  it('falls back to a plain reason when the reload rejects with something else', async () => {
    const d = deps(vi.fn().mockRejectedValue('offline'))
    const { result } = renderHook(() => useTestDialogs(d), { wrapper })

    await act(async () => {
      result.current.handleImportComplete(importResult)
    })

    expect(d.setError).toHaveBeenCalledWith('Could not reload the tests')
  })
})
