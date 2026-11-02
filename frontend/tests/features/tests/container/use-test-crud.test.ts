/**
 * useTestCrud - New Test / Open in Workbench session gates.
 *
 * Module: frontend/src/features/tests/container/use-test-crud.ts
 *
 * handleNewTest probes the CURRENT session (not just a running one) and gates
 * on `isDirty || session`, exactly like its sibling handleOpenInWorkbench -
 * closing the silent-wipe hole where a clean canvas + terminal session was
 * cleared without any prompt. Both handlers fetch the session artifact count
 * when they open the switch dialog so the dialog can render the
 * artifact-loss callout; tracked sessions never produce a positive count
 * (their artifacts persist in the permanent store).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTestCrud } from '@/features/tests/container/use-test-crud'
import { addTestToSuite, removeTestFromSuite } from '@/features/suites/api/crud'
import { cloneTest } from '@/features/tests/api/crud'
import { workbenchApi } from '@/features/workbench/api/workbench'
import { testdataApi } from '@/features/tests/api/testdata'
import type { TestDataUploadRow } from '@/features/tests/api/types'

/** One file on its way into the open test, as the server reports it. */
function uploadRow(name: string): TestDataUploadRow {
  return {
    id: name,
    folder: '',
    name,
    path: name,
    total_bytes: 100,
    loaded_bytes: 10,
    eta_seconds: null,
    started_at: 1_757_000_000_000,
    session: 'tab-1',
  }
}

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const { storeState } = vi.hoisted(() => ({
  storeState: {
    isDirty: false,
    editingTestId: null as string | null,
    reset: vi.fn(),
    setEditingTest: vi.fn(),
  },
}))

vi.mock('@/features/workbench/stores/workflow-store', () => {
  const useWorkflowStore = Object.assign(
    vi.fn((selector?: (s: typeof storeState) => unknown) =>
      selector ? selector(storeState) : storeState
    ),
    { getState: () => storeState }
  )
  return { useWorkflowStore }
})

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    getCurrentSession: vi.fn(),
    getRunningSession: vi.fn(),
    clearSession: vi.fn().mockResolvedValue({ cleared: true }),
    listSessionArtifacts: vi.fn().mockResolvedValue({ items: [] }),
  },
}))

vi.mock('@/features/tests/api/testdata', () => ({
  testdataApi: {
    uploadState: vi.fn().mockResolvedValue({ uploads: [], interruptions: [] }),
  },
}))

vi.mock('@/features/tests/api/crud', () => ({
  deleteTest: vi.fn(),
  cloneTest: vi.fn(),
  batchDeleteTests: vi.fn(),
  updateTestMetadata: vi.fn(),
}))

vi.mock('@/features/suites/api/crud', () => ({
  addTestToSuite: vi.fn(),
  removeTestFromSuite: vi.fn(),
}))

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: mockToastError, info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/lib/delete-conflict-toast', () => ({
  handleDeleteConflict: vi.fn().mockReturnValue(false),
}))

interface SessionShape {
  session_id: string
  status: string
  test_id: string
  websocket_topic: string
  test_name?: string | null
  execution_id?: string | null
  parent_execution_id?: string | null
}

function mockSession(session: SessionShape | null) {
  vi.mocked(workbenchApi.getCurrentSession).mockResolvedValue(session as never)
  vi.mocked(workbenchApi.getRunningSession).mockResolvedValue(
    session && (session.status === 'running' || session.status === 'paused')
      ? { testName: session.test_name ?? null }
      : null
  )
}

function makeSession(overrides: Partial<SessionShape> = {}): SessionShape {
  return {
    session_id: 'sess-1',
    status: 'passed',
    test_id: 'test-42',
    websocket_topic: 'workbench:sess-1',
    test_name: 'Recovered Test',
    execution_id: null,
    parent_execution_id: null,
    ...overrides,
  }
}

function createDeps() {
  return {
    tests: [],
    selectedIds: [] as string[],
    clearSelection: vi.fn(),
    setSelectionModeActive: vi.fn(),
    loadData: vi.fn().mockResolvedValue(undefined),
    setSwitchTestDialogOpen: vi.fn(),
    setSwitchTestExecutionActive: vi.fn(),
    setPendingOpenTestId: vi.fn(),
    setNewTestDialogOpen: vi.fn(),
    setRunningSession: vi.fn(),
    setSessionArtifactCount: vi.fn(),
    setUploadCount: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  storeState.isDirty = false
  storeState.editingTestId = null
  vi.mocked(workbenchApi.clearSession).mockResolvedValue({ cleared: true })
  vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue({ items: [] })
  mockSession(null)
})

describe('useTestCrud - handleNewTest session gate', () => {
  it('opens the switch dialog when a terminal session exists on a clean canvas', async () => {
    mockSession(makeSession({ status: 'passed' }))
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(deps.setSwitchTestDialogOpen).toHaveBeenCalledWith(true)
    expect(deps.setSwitchTestExecutionActive).toHaveBeenCalledWith(true)
    expect(deps.setNewTestDialogOpen).not.toHaveBeenCalled()
  })

  it('goes straight to the new-test dialog when clean with no session', async () => {
    mockSession(null)
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(deps.setNewTestDialogOpen).toHaveBeenCalledWith(true)
    expect(deps.setSwitchTestDialogOpen).not.toHaveBeenCalled()
    expect(deps.setRunningSession).not.toHaveBeenCalled()
  })

  it('still clears a cleanly-open test (no session) before the new-test dialog', async () => {
    mockSession(null)
    storeState.editingTestId = 'test-open'
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(storeState.reset).toHaveBeenCalled()
    expect(workbenchApi.clearSession).toHaveBeenCalled()
    expect(deps.setNewTestDialogOpen).toHaveBeenCalledWith(true)
  })

  it('reports a failed session clear and does not start the new test', async () => {
    mockSession(null)
    storeState.editingTestId = 'test-open'
    vi.mocked(workbenchApi.clearSession).mockRejectedValue(new Error('Service Unavailable'))
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(mockToastError).toHaveBeenCalledWith(
      'The workbench session is still open on the server: Service Unavailable',
      'Session Not Cleared',
    )
    // The open test stays on the canvas and no new test is offered.
    expect(storeState.reset).not.toHaveBeenCalled()
    expect(deps.setNewTestDialogOpen).not.toHaveBeenCalled()
  })

  it('reports a failed session read and does not open the new-test dialog', async () => {
    vi.mocked(workbenchApi.getRunningSession).mockRejectedValue(new Error('Service Unavailable'))
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(mockToastError).toHaveBeenCalledWith(
      'Could not read the workbench session: Service Unavailable',
      'New Test Not Started',
    )
    expect(deps.setNewTestDialogOpen).not.toHaveBeenCalled()
    expect(deps.setSwitchTestDialogOpen).not.toHaveBeenCalled()
    expect(deps.setRunningSession).not.toHaveBeenCalled()
  })

  it('reports a failed artifact read and does not open the switch dialog', async () => {
    mockSession(makeSession({ status: 'passed' }))
    vi.mocked(workbenchApi.listSessionArtifacts).mockRejectedValue(new Error('Gateway Timeout'))
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(mockToastError).toHaveBeenCalledWith(
      'Could not read the workbench session: Gateway Timeout',
      'New Test Not Started',
    )
    expect(deps.setSwitchTestDialogOpen).not.toHaveBeenCalled()
  })

  it('still blocks while a session is running', async () => {
    mockSession(makeSession({ status: 'running', test_name: 'Live Run' }))
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(deps.setRunningSession).toHaveBeenCalledWith({ testName: 'Live Run' })
    expect(deps.setSwitchTestDialogOpen).not.toHaveBeenCalled()
    expect(deps.setNewTestDialogOpen).not.toHaveBeenCalled()
  })

  it('opens the switch dialog for a dirty canvas without a session (no execution variant)', async () => {
    mockSession(null)
    storeState.isDirty = true
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(deps.setSwitchTestDialogOpen).toHaveBeenCalledWith(true)
    expect(deps.setSwitchTestExecutionActive).toHaveBeenCalledWith(false)
    expect(deps.setNewTestDialogOpen).not.toHaveBeenCalled()
  })

  it('fetches the artifact count for the dialog callout on an ephemeral session', async () => {
    mockSession(makeSession({ status: 'passed' }))
    vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue({
      items: [
        { path: 'report.json', size_bytes: 1024, created_at: '2026-07-02T10:00:00+00:00' },
        { path: 'output/data.json', size_bytes: 2048, created_at: '2026-07-02T10:00:01+00:00' },
      ],
    })
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(workbenchApi.listSessionArtifacts).toHaveBeenCalled()
    expect(deps.setSessionArtifactCount).toHaveBeenCalledWith(2)
  })

  it('reads what the open test still has arriving, for the same dialog (TDATA-14)', async () => {
    mockSession(makeSession({ status: 'passed' }))
    storeState.editingTestId = 'test-7'
    vi.mocked(testdataApi.uploadState).mockResolvedValue({
      uploads: [uploadRow('a.csv'), uploadRow('b.csv')],
      interruptions: [],
    })
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(testdataApi.uploadState).toHaveBeenCalledWith('test-7')
    expect(deps.setUploadCount).toHaveBeenCalledWith(2)
  })

  it('asks for nothing when no test is open in the workbench', async () => {
    mockSession(makeSession({ status: 'passed' }))
    storeState.editingTestId = null
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(testdataApi.uploadState).not.toHaveBeenCalled()
    expect(deps.setUploadCount).toHaveBeenCalledWith(0)
  })

  it('lets a failed upload read pass rather than block the dialog', async () => {
    mockSession(makeSession({ status: 'passed' }))
    storeState.editingTestId = 'test-7'
    vi.mocked(testdataApi.uploadState).mockRejectedValue(new Error('gone'))
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    expect(deps.setSwitchTestDialogOpen).toHaveBeenCalledWith(true)
  })

  it('never sets a positive artifact count for a tracked session', async () => {
    mockSession(makeSession({ status: 'passed', execution_id: 'exec-9' }))
    vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue({
      items: [
        { path: 'report.json', size_bytes: 1024, created_at: '2026-07-02T10:00:00+00:00' },
      ],
    })
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleNewTest()
    })

    for (const call of deps.setSessionArtifactCount.mock.calls) {
      expect(call[0]).toBe(0)
    }
  })
})

describe('useTestCrud - handleOpenInWorkbench artifact count', () => {
  it('fetches the artifact count when the switch dialog opens over a terminal session', async () => {
    mockSession(makeSession({ status: 'failed' }))
    vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue({
      items: [
        { path: 'report.json', size_bytes: 1024, created_at: '2026-07-02T10:00:00+00:00' },
        { path: 'output/data.json', size_bytes: 2048, created_at: '2026-07-02T10:00:01+00:00' },
      ],
    })
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleOpenInWorkbench('test-other')
    })

    expect(deps.setSwitchTestDialogOpen).toHaveBeenCalledWith(true)
    expect(deps.setPendingOpenTestId).toHaveBeenCalledWith('test-other')
    expect(deps.setSessionArtifactCount).toHaveBeenCalledWith(2)
  })

  it('reports a failed session read and does not navigate', async () => {
    vi.mocked(workbenchApi.getCurrentSession).mockRejectedValue(new Error('Service Unavailable'))
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleOpenInWorkbench('test-other')
    })

    expect(mockToastError).toHaveBeenCalledWith(
      'Could not read the workbench session: Service Unavailable',
      'Test Not Opened',
    )
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(deps.setSwitchTestDialogOpen).not.toHaveBeenCalled()
  })

  it('navigates directly when clean with no session (count stays untouched at a positive value never set)', async () => {
    mockSession(null)
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleOpenInWorkbench('test-other')
    })

    expect(mockNavigate).toHaveBeenCalledWith('/workbench?editTest=test-other')
    expect(deps.setSwitchTestDialogOpen).not.toHaveBeenCalled()
    for (const call of deps.setSessionArtifactCount.mock.calls) {
      expect(call[0]).toBe(0)
    }
  })
})

describe('useTestCrud - suite membership', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(addTestToSuite).mockResolvedValue(undefined)
    vi.mocked(removeTestFromSuite).mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('adds the test to the suite, then reloads', async () => {
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleAddToSuite('test-1', 'suite-1')
    })

    expect(addTestToSuite).toHaveBeenCalledWith('suite-1', 'test-1')
    expect(deps.loadData).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports a failed add where the user is looking', async () => {
    vi.mocked(addTestToSuite).mockRejectedValue(new Error('Service Unavailable'))
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleAddToSuite('test-1', 'suite-1')
    })

    expect(mockToastError).toHaveBeenCalledWith('Service Unavailable', 'Add to Suite Failed')
    expect(deps.loadData).not.toHaveBeenCalled()
  })

  it('reports a non-Error add rejection verbatim', async () => {
    vi.mocked(addTestToSuite).mockRejectedValue('weird')
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleAddToSuite('test-1', 'suite-1')
    })

    expect(mockToastError).toHaveBeenCalledWith('weird', 'Add to Suite Failed')
  })

  it('removes the test from the suite, then reloads', async () => {
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleRemoveFromSuite('test-1', 'suite-1')
    })

    expect(removeTestFromSuite).toHaveBeenCalledWith('suite-1', 'test-1')
    expect(deps.loadData).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports a failed remove where the user is looking', async () => {
    vi.mocked(removeTestFromSuite).mockRejectedValue(new Error('Service Unavailable'))
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleRemoveFromSuite('test-1', 'suite-1')
    })

    expect(mockToastError).toHaveBeenCalledWith('Service Unavailable', 'Remove from Suite Failed')
    expect(deps.loadData).not.toHaveBeenCalled()
  })

  it('reports a non-Error remove rejection verbatim', async () => {
    vi.mocked(removeTestFromSuite).mockRejectedValue('weird')
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleRemoveFromSuite('test-1', 'suite-1')
    })

    expect(mockToastError).toHaveBeenCalledWith('weird', 'Remove from Suite Failed')
  })
})

describe('useTestCrud - handleBulkAddToSuite', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(addTestToSuite).mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('does nothing when nothing is selected', async () => {
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleBulkAddToSuite('suite-1')
    })

    expect(addTestToSuite).not.toHaveBeenCalled()
    expect(deps.loadData).not.toHaveBeenCalled()
  })

  it('adds every selected test, then clears the selection and reloads', async () => {
    const deps = { ...createDeps(), selectedIds: ['test-1', 'test-2'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleBulkAddToSuite('suite-1')
    })

    expect(addTestToSuite).toHaveBeenCalledWith('suite-1', 'test-1')
    expect(addTestToSuite).toHaveBeenCalledWith('suite-1', 'test-2')
    expect(deps.clearSelection).toHaveBeenCalled()
    expect(deps.setSelectionModeActive).toHaveBeenCalledWith(false)
    expect(deps.loadData).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports the failure and keeps the selection when an add fails', async () => {
    vi.mocked(addTestToSuite).mockRejectedValue(new Error('Service Unavailable'))
    const deps = { ...createDeps(), selectedIds: ['test-1', 'test-2'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleBulkAddToSuite('suite-1')
    })

    expect(mockToastError).toHaveBeenCalledWith('Service Unavailable', 'Add to Suite Failed')
    expect(deps.clearSelection).not.toHaveBeenCalled()
    expect(deps.loadData).toHaveBeenCalled()
  })

  it('names what landed when only some adds fail', async () => {
    vi.mocked(addTestToSuite)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Service Unavailable'))
    const deps = { ...createDeps(), selectedIds: ['test-1', 'test-2'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleBulkAddToSuite('suite-1')
    })

    expect(mockToastError).toHaveBeenCalledWith(
      'Added 1 of 2 tests to the suite. The rest failed: Service Unavailable',
      'Add to Suite Failed'
    )
    expect(deps.clearSelection).not.toHaveBeenCalled()
    expect(deps.setSelectionModeActive).not.toHaveBeenCalled()
    expect(deps.loadData).toHaveBeenCalled()
  })

  it('reports a non-Error rejection verbatim', async () => {
    vi.mocked(addTestToSuite).mockRejectedValue('weird')
    const deps = { ...createDeps(), selectedIds: ['test-1'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleBulkAddToSuite('suite-1')
    })

    expect(mockToastError).toHaveBeenCalledWith('weird', 'Add to Suite Failed')
  })
})

describe('useTestCrud - handleBulkRemoveFromSuite', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(removeTestFromSuite).mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('does nothing when nothing is selected', async () => {
    const deps = createDeps()
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleBulkRemoveFromSuite('suite-1')
    })

    expect(removeTestFromSuite).not.toHaveBeenCalled()
    expect(deps.loadData).not.toHaveBeenCalled()
  })

  it('removes every selected test, then clears the selection and reloads', async () => {
    const deps = { ...createDeps(), selectedIds: ['test-1', 'test-2'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleBulkRemoveFromSuite('suite-1')
    })

    expect(removeTestFromSuite).toHaveBeenCalledWith('suite-1', 'test-1')
    expect(removeTestFromSuite).toHaveBeenCalledWith('suite-1', 'test-2')
    expect(deps.clearSelection).toHaveBeenCalled()
    expect(deps.setSelectionModeActive).toHaveBeenCalledWith(false)
    expect(deps.loadData).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports the failure and keeps the selection when a remove fails', async () => {
    vi.mocked(removeTestFromSuite).mockRejectedValue(new Error('Service Unavailable'))
    const deps = { ...createDeps(), selectedIds: ['test-1', 'test-2'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleBulkRemoveFromSuite('suite-1')
    })

    expect(mockToastError).toHaveBeenCalledWith('Service Unavailable', 'Remove from Suite Failed')
    expect(deps.clearSelection).not.toHaveBeenCalled()
    expect(deps.setSelectionModeActive).not.toHaveBeenCalled()
    expect(deps.loadData).toHaveBeenCalled()
  })

  it('names what landed when only some removes fail', async () => {
    vi.mocked(removeTestFromSuite)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Service Unavailable'))
    const deps = { ...createDeps(), selectedIds: ['test-1', 'test-2'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleBulkRemoveFromSuite('suite-1')
    })

    expect(mockToastError).toHaveBeenCalledWith(
      'Removed 1 of 2 tests from the suite. The rest failed: Service Unavailable',
      'Remove from Suite Failed'
    )
    expect(deps.clearSelection).not.toHaveBeenCalled()
    expect(deps.setSelectionModeActive).not.toHaveBeenCalled()
    expect(deps.loadData).toHaveBeenCalled()
  })

  it('reports a non-Error rejection verbatim', async () => {
    vi.mocked(removeTestFromSuite).mockRejectedValue('weird')
    const deps = { ...createDeps(), selectedIds: ['test-1'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      await result.current.handleBulkRemoveFromSuite('suite-1')
    })

    expect(mockToastError).toHaveBeenCalledWith('weird', 'Remove from Suite Failed')
  })
})

describe('useTestCrud - handleBulkDuplicate', () => {
  beforeEach(() => {
    vi.mocked(cloneTest).mockResolvedValue({ id: 'clone-1' } as never)
  })

  it('duplicates every selected test, then clears the selection and reloads', async () => {
    const deps = { ...createDeps(), selectedIds: ['test-1', 'test-2'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      result.current.handleBulkDuplicate()
    })

    expect(cloneTest).toHaveBeenCalledWith('test-1')
    expect(cloneTest).toHaveBeenCalledWith('test-2')
    expect(deps.clearSelection).toHaveBeenCalled()
    expect(deps.setSelectionModeActive).toHaveBeenCalledWith(false)
    expect(deps.loadData).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports the reason and keeps the selection when every duplicate fails', async () => {
    vi.mocked(cloneTest).mockRejectedValue(new Error('Service Unavailable'))
    const deps = { ...createDeps(), selectedIds: ['test-1', 'test-2'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      result.current.handleBulkDuplicate()
    })

    expect(mockToastError).toHaveBeenCalledWith('Service Unavailable', 'Duplicate Failed')
    expect(deps.clearSelection).not.toHaveBeenCalled()
    expect(deps.setSelectionModeActive).not.toHaveBeenCalled()
    expect(deps.loadData).toHaveBeenCalled()
  })

  it('names what landed when only some duplicates fail', async () => {
    vi.mocked(cloneTest)
      .mockResolvedValueOnce({ id: 'clone-1' } as never)
      .mockRejectedValueOnce(new Error('Service Unavailable'))
    const deps = { ...createDeps(), selectedIds: ['test-1', 'test-2'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      result.current.handleBulkDuplicate()
    })

    expect(mockToastError).toHaveBeenCalledWith(
      'Duplicated 1 of 2 tests. The rest failed: Service Unavailable',
      'Duplicate Failed'
    )
    expect(deps.clearSelection).not.toHaveBeenCalled()
    expect(deps.loadData).toHaveBeenCalled()
  })

  it('reports a non-Error rejection verbatim', async () => {
    vi.mocked(cloneTest).mockRejectedValue('weird')
    const deps = { ...createDeps(), selectedIds: ['test-1'] }
    const { result } = renderHook(() => useTestCrud(deps))

    await act(async () => {
      result.current.handleBulkDuplicate()
    })

    expect(mockToastError).toHaveBeenCalledWith('weird', 'Duplicate Failed')
  })
})
