/**
 * TestsListContainer Tests
 *
 * Tests for the tests list container callbacks that require integration testing.
 *
 * Test coverage:
 * - Switch Test Dialog (handleDiscardAndCreateNew)
 * - Bulk Delete with Editing Test (confirmBulkDelete reset)
 * - Filter changes (handleFilterChange)
 * - Selection changes (handleSelectionChange)
 * - Bulk delete flow (handleBulkDelete)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { TestsListContainer } from '@/features/tests/container'
import { ThemeProvider } from '@/design-system/theme-provider'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { usePageBlockStore } from '@/stores/page-block-store'

// Hoisted mock references for suites API (REQ-9.5.3.5: fetchSuiteNames replaces fetchSuites)
const suiteMocks = vi.hoisted(() => ({
  fetchSuiteNames: vi.fn(),
  fetchSuites: vi.fn(),
  transformApiSuite: vi.fn(),
}))

// Mock environments API to prevent real backend calls. The list's run dialog
// reads the names endpoint, so it is mocked too.
const environmentMocks = vi.hoisted(() => ({
  fetchEnvironmentNames: vi.fn(),
}))

vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironments: vi.fn().mockResolvedValue({
    data: [{ id: 'env-1', name: 'Test Environment' }],
    total: 1,
    page: 1,
    per_page: 100,
    pages: 1,
  }),
  fetchEnvironmentNames: environmentMocks.fetchEnvironmentNames,
}))

// The Test Data chip reads what the open test has in flight; this page never
// asserts on it, so the module is stubbed rather than routed.
vi.mock('@/features/tests/api/testdata', () => ({
  testdataApi: {
    uploadState: vi.fn().mockResolvedValue({ uploads: [], interruptions: [] }),
  },
}))

// Mock the tests API
vi.mock('@/features/tests/api/crud', () => ({
  fetchTests: vi.fn().mockResolvedValue({
    data: [
      { id: 'test-1', name: 'Test 1', status: 'passed', last_run: '2025-01-01T00:00:00Z', tags: [] },
      { id: 'test-2', name: 'Test 2', status: 'failed', last_run: '2025-01-02T00:00:00Z', tags: [] },
    ],
    pagination: {
      total: 2,
      page: 1,
      per_page: 25,
      total_pages: 1,
    },
  }),
  fetchTestsTags: vi.fn().mockResolvedValue(['api', 'unit']),
  transformApiTest: vi.fn((test) => ({
    id: test.id,
    name: test.name,
    status: test.status,
    lastRun: test.last_run,
    suiteCount: test.suite_count ?? 0,
    suiteIds: test.suite_ids ?? [],
    suiteNames: test.suite_names ?? [],
    tags: test.tags || [],
  })),
  deleteTest: vi.fn().mockResolvedValue(undefined),
  cloneTest: vi.fn().mockResolvedValue({ id: 'cloned-test' }),
  batchDeleteTests: vi.fn().mockResolvedValue(undefined),
  batchUpdateTests: vi.fn().mockResolvedValue(undefined),
  updateTestMetadata: vi.fn().mockResolvedValue({}),
  updateTest: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/features/tests/api/export-import', () => ({
  exportTest: vi.fn().mockResolvedValue(new Blob()),
  exportTests: vi.fn().mockResolvedValue(new Blob()),
  validateTestImport: vi.fn().mockResolvedValue({ tests: [], total: 0, importable: 0, blocked: 0 }),
  importTests: vi.fn().mockResolvedValue({ imported: [], skipped: [], fixes_applied: [], total_imported: 0, total_skipped: 0 }),
}))

// jsdom has no URL.createObjectURL; the export flow must not hit the real helper
vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

// Marker mock for the SHARED export dialog: the container must render this
// component (the features/tests fork is deleted), passing the entity props.
vi.mock('@/components/shared/dialogs/export-dialog', () => ({
  ExportDialog: ({
    open,
    entityLabel,
    entityNames,
    onExport,
  }: {
    open: boolean
    entityLabel: string
    entityNames: string[]
    onExport: (opts: { format: 'yaml' | 'json'; secrets: 'mask' | 'encrypted' | 'plaintext' }) => void
  }) =>
    open ? (
      <div
        data-testid="shared-export-dialog"
        data-entity-label={entityLabel}
        data-entity-names={JSON.stringify(entityNames)}
      >
        <button
          data-testid="shared-export-confirm"
          onClick={() => onExport({ format: 'yaml', secrets: 'mask' })}
        >
          Confirm
        </button>
      </div>
    ) : null,
}))

// Mock the workbench API (clearSession is called when resetting before opening
// the new test dialog so the backend session does not re-hydrate the previous
// test; getRunningSession gates destructive actions while a live execution
// is in progress).
vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    clearSession: vi.fn().mockResolvedValue({ success: true }),
    startRun: vi.fn(),
    stopRun: vi.fn(),
    getStatus: vi.fn(),
    getCurrentSession: vi.fn().mockResolvedValue(null),
    getRunningSession: vi.fn().mockResolvedValue(null),
    updateSkippedNodes: vi.fn(),
    listSessionArtifacts: vi.fn().mockResolvedValue({ items: [] }),
  },
}))

// Mock the suites API (REQ-9.5.3.5: fetchSuiteNames replaces fetchSuites for dropdown)
vi.mock('@/features/suites/api/crud', () => ({
  fetchSuiteNames: suiteMocks.fetchSuiteNames.mockResolvedValue([]),
  fetchSuites: suiteMocks.fetchSuites.mockResolvedValue({
    data: [],
    pagination: { total: 0, page: 1, per_page: 25, total_pages: 0 },
  }),
  transformApiSuite: suiteMocks.transformApiSuite.mockImplementation(
    (suite: unknown) => suite
  ),
}))

// A void-typed prop cannot carry a rejection, so the container reports it. The
// real hook is kept; only the one handler under test is swapped.
const dialogsOverride = vi.hoisted(() => ({ exportRejects: false }))
vi.mock('@/features/tests/container/use-test-dialogs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/tests/container/use-test-dialogs')>()
  return {
    useTestDialogs: (deps: Parameters<typeof actual.useTestDialogs>[0]) => {
      const real = actual.useTestDialogs(deps)
      if (!dialogsOverride.exportRejects) return real
      return {
        ...real,
        handleExportAction: () => Promise.reject(new Error('Service Unavailable')),
      }
    },
  }
})

// Helper to render TestsListContainer in a router context
function renderTestsListContainer() {
  // Create modal root for portals
  let modalRoot = document.getElementById('modal-root')
  if (!modalRoot) {
    modalRoot = document.createElement('div')
    modalRoot.id = 'modal-root'
    document.body.appendChild(modalRoot)
  }

  const routes = [
    {
      path: '/tests',
      element: (
        <ThemeProvider defaultTheme="light" storageKey="test-theme">
          <ToastProvider>
            <>
              <TestsListContainer />
              <ToastContainer />
            </>
          </ToastProvider>
        </ThemeProvider>
      ),
    },
    {
      path: '/workbench',
      element: <div data-testid="workbench-page">Workbench Page</div>,
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: ['/tests'] })
  return {
    ...render(<RouterProvider router={router} />),
    router,
  }
}

describe('TestsListContainer', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset workflow store to clean state
    useWorkflowStore.getState().reset()
    dialogsOverride.exportRejects = false
    vi.clearAllMocks()
    environmentMocks.fetchEnvironmentNames.mockResolvedValue([
      { id: 'env-1', name: 'Test Environment', tags: [] },
    ])
    usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set<string>() })
  })

  afterEach(() => {
    localStorage.clear()
    // Do NOT reset useWorkflowStore here: the container is still mounted
    // when test-file afterEach runs (cleanup() lives in setup.ts afterEach,
    // which runs later), so a store reset triggers Zustand subscribers on
    // the live Radix Selects to re-render outside React's act scope. The
    // beforeEach above already resets the store for the next test.
    // Clean up modal root
    const modalRoot = document.getElementById('modal-root')
    if (modalRoot) {
      document.body.removeChild(modalRoot)
    }
  })

  // ===========================================================================
  // Switch Test Dialog - handleDiscardAndCreateNew
  // ===========================================================================
  describe('Switch Test Dialog - handleDiscardAndCreateNew', () => {
    it('discards changes and opens New Test dialog on Tests List when Discard & Create clicked', async () => {
      const user = userEvent.setup()

      // Set workflow store to be dirty
      const store = useWorkflowStore.getState()
      store.addNode({
        id: 'test-node',
        type: 'workflowNode',
        position: { x: 100, y: 100 },
        data: { label: 'Test', nodeType: 'plugin' },
      })
      // The store is now dirty (has nodes)
      expect(useWorkflowStore.getState().isDirty).toBe(true)

      const { router } = renderTestsListContainer()

      // Wait for page to load
      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      // Click "New Test" button in header
      const createButton = screen.getByRole('button', { name: /new test/i })
      await user.click(createButton)

      // SwitchTestConfirmDialog should be open
      await waitFor(() => {
        expect(screen.getByText(/Unsaved Changes in Workbench/i)).toBeInTheDocument()
      })

      // Click "Discard & Create Test" button
      const discardButton = screen.getByRole('button', { name: /discard.*create/i })
      await user.click(discardButton)

      // The new test dialog (TestFormDialog mode="create") opens on Tests List
      // (no navigation to workbench - that happens only AFTER the test is created)
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'New Test' })).toBeInTheDocument()
      })

      // Should still be on /tests, NOT navigated to /workbench
      expect(router.state.location.pathname).toBe('/tests')

      // Workflow store should be reset (no leftovers from old test)
      const stateAfter = useWorkflowStore.getState()
      expect(stateAfter.isDirty).toBe(false)
      expect(stateAfter.nodes).toHaveLength(0)
      expect(stateAfter.editingTestId).toBeNull()
    })

    it('resets the workbench when New Test is clicked while a clean test is loaded', async () => {
      const user = userEvent.setup()

      // Simulate a clean test loaded in the workbench: editingTestId set,
      // nodes/variables present, but isDirty=false (test was saved).
      const store = useWorkflowStore.getState()
      store.addNode({
        id: 'old-test-node',
        type: 'workflowNode',
        position: { x: 50, y: 50 },
        data: { label: 'Old', nodeType: 'plugin' },
      })
      store.addVariable({ name: 'oldVar', value: 'leftover', type: 'string' })
      store.setEditingTest('old-test-id', 'Old Test')
      store.markSaved()
      expect(useWorkflowStore.getState().isDirty).toBe(false)
      expect(useWorkflowStore.getState().editingTestId).toBe('old-test-id')

      const { router } = renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      // Click "New Test" - no Switch dialog because not dirty, just open new dialog.
      await user.click(screen.getByRole('button', { name: /new test/i }))

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'New Test' })).toBeInTheDocument()
      })

      // Still on /tests, no leakage of old test state.
      expect(router.state.location.pathname).toBe('/tests')
      const stateAfter = useWorkflowStore.getState()
      expect(stateAfter.editingTestId).toBeNull()
      expect(stateAfter.nodes).toHaveLength(0)
      expect(stateAfter.variables).toHaveLength(0)
    })
  })

  // ===========================================================================
  // Running-session blocker
  // ===========================================================================
  describe('Running-session blocker', () => {
    it('blocks New Test with a stop-first dialog when a test is running in the workbench', async () => {
      const user = userEvent.setup()

      // Simulate a running session on the backend.
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      vi.mocked(workbenchApi.getRunningSession).mockResolvedValueOnce({
        testName: 'Live Login Test',
      })

      // Pre-load the workflow store with a "previous" test so we can verify
      // it is NOT reset when New Test is blocked.
      const store = useWorkflowStore.getState()
      store.setEditingTest('prev-test-id', 'Previous Test')
      store.markSaved()

      const { router } = renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /new test/i }))

      // Stop-first dialog appears with the running test name.
      await waitFor(() => {
        expect(screen.getByText('Test is Running')).toBeInTheDocument()
      })
      expect(screen.getByText(/Live Login Test/)).toBeInTheDocument()
      // Cancel + Go-to-Workbench are offered; no destructive option.
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /go to workbench/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument()

      // The new-test dialog must NOT be opened, and the workflow store must
      // be untouched (the running test's state is preserved).
      expect(screen.queryByRole('heading', { name: 'New Test' })).not.toBeInTheDocument()
      expect(useWorkflowStore.getState().editingTestId).toBe('prev-test-id')
      expect(workbenchApi.clearSession).not.toHaveBeenCalled()

      // Clicking "Go to Workbench" navigates to /workbench so the user can stop the run.
      await user.click(screen.getByRole('button', { name: /go to workbench/i }))
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/workbench')
      })
    })

    it('falls back to "Draft Workflow" when the running session has no testName', async () => {
      const user = userEvent.setup()

      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      vi.mocked(workbenchApi.getRunningSession).mockResolvedValueOnce({
        testName: null,
      })

      const store = useWorkflowStore.getState()
      store.setEditingTest('prev-test-id', 'Previous Test')
      store.markSaved()

      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /new test/i }))

      await waitFor(() => {
        expect(screen.getByText('Test is Running')).toBeInTheDocument()
      })
      // testName is null -> the dialog falls through to its "Draft Workflow"
      // default (covers the testName=null branch of the parent's prop).
      expect(screen.getByText(/Draft Workflow/)).toBeInTheDocument()
    })

    it('refuses New Test with a toast and no running dialog when the session read fails', async () => {
      const user = userEvent.setup()

      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      vi.mocked(workbenchApi.getRunningSession).mockRejectedValueOnce(
        new Error('Service Unavailable')
      )

      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /new test/i }))

      // Nothing is known about the session, so the gesture reports the failure.
      expect(await screen.findByText('New Test Not Started')).toBeInTheDocument()
      expect(
        screen.getByText('Could not read the workbench session: Service Unavailable')
      ).toBeInTheDocument()
      expect(screen.queryByText('Test is Running')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'New Test' })).not.toBeInTheDocument()
      expect(workbenchApi.clearSession).not.toHaveBeenCalled()
    })

    it('dismisses the stop-first dialog when Cancel is clicked, preserving workbench state', async () => {
      const user = userEvent.setup()

      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      vi.mocked(workbenchApi.getRunningSession).mockResolvedValueOnce({
        testName: 'Live Login Test',
      })

      const store = useWorkflowStore.getState()
      store.setEditingTest('prev-test-id', 'Previous Test')
      store.markSaved()

      const { router } = renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /new test/i }))

      await waitFor(() => {
        expect(screen.getByText('Test is Running')).toBeInTheDocument()
      })

      // Cancel closes the dialog without navigation.
      await user.click(screen.getByRole('button', { name: /^cancel$/i }))

      await waitFor(() => {
        expect(screen.queryByText('Test is Running')).not.toBeInTheDocument()
      })

      // Still on /tests, workbench state untouched.
      expect(router.state.location.pathname).toBe('/tests')
      expect(useWorkflowStore.getState().editingTestId).toBe('prev-test-id')
    })

  })

  // ===========================================================================
  // Switch Test Dialog - clean-and-executed timing
  // When the user opens a different test from the tests list while
  // their currently-loaded workbench test is clean (saved) but has terminal
  // execution state on the backend session, the switch dialog must open at
  // the tests list (BEFORE navigating to /workbench), not after.
  // ===========================================================================
  describe('Switch Test Dialog - clean test with terminal session', () => {
    beforeEach(() => {
      const store = useWorkflowStore.getState()
      store.setEditingTest('test-1', 'Test 1')
      store.markSaved()
    })

    it('opens the switch dialog at the tests list when a terminal session exists', async () => {
      const user = userEvent.setup()
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      vi.mocked(workbenchApi.getCurrentSession).mockResolvedValueOnce({
        session_id: 's-1',
        status: 'passed',
        test_id: 'test-1',
        websocket_topic: 't',
        test_name: 'Test 1',
      })

      const { router } = renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      const rows = screen.getAllByTestId('test-row')
      await user.click(within(rows[1]).getByTestId('test-name'))

      await waitFor(() => {
        expect(screen.getByTestId('switch-test-dialog')).toBeInTheDocument()
      })

      expect(router.state.location.pathname).toBe('/tests')
      expect(screen.getByText('Active Execution State')).toBeInTheDocument()
    })

    it('navigates directly when clean test has no backend session', async () => {
      const user = userEvent.setup()

      const { router } = renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      const rows = screen.getAllByTestId('test-row')
      await user.click(within(rows[1]).getByTestId('test-name'))

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/workbench')
      })

      expect(screen.queryByTestId('switch-test-dialog')).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Suite Names Loading - REQ-9.5.3.5
  // Container should use fetchSuiteNames (lightweight) instead of fetchSuites
  // ===========================================================================
  describe('Suite Names Loading (REQ-9.5.3.5)', () => {
    beforeEach(() => {
      // Reset suite mock implementations (clearAllMocks doesn't reset implementations)
      suiteMocks.fetchSuiteNames.mockResolvedValue([])
      suiteMocks.fetchSuites.mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, per_page: 25, total_pages: 0 },
      })
    })

    it('calls fetchSuiteNames on mount to populate suites dropdown', async () => {
      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      expect(suiteMocks.fetchSuiteNames).toHaveBeenCalledTimes(1)
    })

    it('uses fetchSuiteNames response directly without transformation', async () => {
      suiteMocks.fetchSuiteNames.mockResolvedValue([
        { id: 'suite-1', name: 'Alpha Suite' },
        { id: 'suite-2', name: 'Beta Suite' },
      ])

      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      // fetchSuiteNames returns [{id, name}] directly - no transformation needed
      expect(suiteMocks.fetchSuiteNames).toHaveBeenCalledTimes(1)
      expect(suiteMocks.transformApiSuite).not.toHaveBeenCalled()
    })

    it('does not call fetchSuites (replaced by fetchSuiteNames)', async () => {
      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      expect(suiteMocks.fetchSuites).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Environments read gating (the run dialog's list is the page's own read)
  // ===========================================================================
  describe('Environments read', () => {
    it('shows only the list error state when the environments read fails too', async () => {
      const { fetchTests } = await import('@/features/tests/api/crud')
      vi.mocked(fetchTests).mockRejectedValueOnce(new Error('Network error'))
      environmentMocks.fetchEnvironmentNames.mockRejectedValue(
        new Error('Environments unavailable')
      )

      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(environmentMocks.fetchEnvironmentNames).toHaveBeenCalled()
      })
      expect(usePageBlockStore.getState().block).toBeNull()
      expect(screen.queryByTestId('page-blocked-card')).not.toBeInTheDocument()
    })

    it('blocks the page when only the environments read fails', async () => {
      environmentMocks.fetchEnvironmentNames.mockRejectedValue(
        new Error('Environments unavailable')
      )

      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(usePageBlockStore.getState().block?.title).toBe('Could not load environments')
      })
    })

    it('reads the environments list once for the whole page', async () => {
      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByText('Test 1')).toBeInTheDocument()
      })
      expect(environmentMocks.fetchEnvironmentNames).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // Container Callback Coverage
  // Tests for handlers that need UI interaction to invoke
  // ===========================================================================
  describe('Container Callback Coverage', () => {
    it('handleFilterChange updates URL when status filter toggled', async () => {
      const user = userEvent.setup()

      const { router } = renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByText('Test 1')).toBeInTheDocument()
      })

      // Open status filter popover (no debounce - fires onFilterChange immediately)
      await user.click(screen.getByTestId('filter-status'))

      // Click "Passed" option in the popover (use role=option to target CommandItem)
      await user.click(screen.getByRole('option', { name: /Passed/i }))

      // URL should contain status param from handleFilterChange
      await waitFor(() => {
        expect(router.state.location.search).toContain('status=passed')
      })
    })

    it('handleSelectionChange toggles test selection when checkbox clicked', async () => {
      const user = userEvent.setup()

      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByText('Test 1')).toBeInTheDocument()
      })

      // Enter selection mode by clicking "Mass Action"
      await user.click(screen.getByText('Mass Action'))

      // Click a row checkbox to toggle selection
      const checkboxes = screen.getAllByTestId('row-checkbox')
      await user.click(checkboxes[0])

      // Selection counter should reflect 1 selected
      await waitFor(() => {
        expect(screen.getByTestId('selection-counter')).toHaveTextContent('1 selected')
      })
    })

    it('handleBulkDelete opens confirmation dialog when items selected', async () => {
      const user = userEvent.setup()

      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByText('Test 1')).toBeInTheDocument()
      })

      // Enter selection mode
      await user.click(screen.getByText('Mass Action'))

      // Select a test
      const checkboxes = screen.getAllByTestId('row-checkbox')
      await user.click(checkboxes[0])

      // Open bulk actions dropdown
      await user.click(screen.getByTestId('selection-counter'))

      // Click Delete action
      await user.click(screen.getByTestId('bulk-action-delete'))

      // Bulk delete confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByText(/permanently removed/i)).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Shared Export Dialog (features/tests fork deleted)
  // ===========================================================================
  describe('Shared Export Dialog', () => {
    it('row Export opens the SHARED export dialog with the test entity props', async () => {
      const user = userEvent.setup()
      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      await user.click(screen.getAllByTestId('action-menu-trigger')[0])
      await user.click(await screen.findByTestId('action-export'))

      const dialog = await screen.findByTestId('shared-export-dialog')
      expect(dialog).toHaveAttribute('data-entity-label', 'test')
      expect(dialog).toHaveAttribute('data-entity-names', JSON.stringify(['Test 1']))
    })

    it('reports a rejection the export prop cannot carry', async () => {
      dialogsOverride.exportRejects = true
      const user = userEvent.setup()
      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      await user.click(screen.getAllByTestId('action-menu-trigger')[0])
      await user.click(await screen.findByTestId('action-export'))
      await user.click(await screen.findByTestId('shared-export-confirm'))

      expect(await screen.findByText('Service Unavailable')).toBeInTheDocument()
      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument()
    })

    it('export flow passes the secrets mode + format through to the API', async () => {
      const { exportTest } = await import('@/features/tests/api/export-import')
      const user = userEvent.setup()
      renderTestsListContainer()

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      })

      await user.click(screen.getAllByTestId('action-menu-trigger')[0])
      await user.click(await screen.findByTestId('action-export'))
      await user.click(await screen.findByTestId('shared-export-confirm'))

      await waitFor(() => {
        expect(vi.mocked(exportTest)).toHaveBeenCalledWith('test-1', {
          format: 'yaml',
          secrets: 'mask',
          name: 'Test 1',
        })
      })
    })
  })

})
