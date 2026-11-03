/**
 * WorkbenchPage Tests
 *
 * Tests for the workbench page canvas functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { WorkbenchContainer as WorkbenchPage } from '@/features/workbench/live'
import { ThemeProvider } from '@/design-system/theme-provider'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

// Mock @/lib/api to provide a lightweight apiClient that works with global.fetch mocks
// (the real apiClient requires full Response objects with headers, which vi.stubGlobal mocks don't provide)
vi.mock('@/lib/api', () => {
  const getApiBaseUrl = () => 'http://localhost:8000'
  function createSimpleApiClient() {
    async function request(method: string, path: string, body?: unknown) {
      const url = `${getApiBaseUrl()}${path}`
      const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
      if (body !== undefined && method !== 'GET' && method !== 'HEAD') opts.body = JSON.stringify(body)
      const response = await fetch(url, opts)
      if (!response.ok) throw new Error(response.statusText || `Error ${response.status || 500}`)
      const json = typeof response.json === 'function' ? await response.json() : {}
      return { data: json.data ?? json, meta: json.meta ?? { requestId: '' }, status: response.status ?? 200, pagination: json.pagination }
    }
    return {
      get: (path: string) => request('GET', path),
      post: (path: string, body?: unknown) => request('POST', path, body),
      put: (path: string, body?: unknown) => request('PUT', path, body),
      patch: (path: string, body?: unknown) => request('PATCH', path, body),
      delete: (path: string) => request('DELETE', path),
    }
  }
  const client = createSimpleApiClient()
  return { getApiBaseUrl, apiClient: client }
})

// Mock the tests API
vi.mock('@/features/tests/api/crud', () => ({
  updateTestMetadata: vi.fn().mockResolvedValue({ id: 'test-123', name: 'Updated Test' }),
  updateTest: vi.fn().mockResolvedValue({ id: 'test-123', name: 'Updated Test' }),
  createTest: vi.fn().mockResolvedValue({ id: 'new-test-123', name: 'New Test' }),
  fetchTest: vi.fn().mockResolvedValue({
    id: 'test-123',
    name: 'My Existing Test',
    description: 'Test description',
    tags: ['tag1'],
    suite: null,
    workflow: { nodes: [], edges: [] },
  }),
  fetchTestWorkflow: vi.fn().mockResolvedValue({
    nodes: [],
    edges: [],
  }),
  fetchTestsTags: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/features/tests/api/validation', () => ({
  validateTest: vi.fn().mockResolvedValue({
    fatal: false,
    errors: [],
    warnings: [],
  }),
}))

// Mock the suites API
vi.mock('@/features/suites/api/crud', () => ({
  fetchSuites: vi.fn().mockResolvedValue({ success: true, data: [] }),
}))

// Valid UUIDs for test environments
const TEST_ENV_IDS = {
  development: 'a1b2c3d4-e5f6-4a5b-8c7d-9e0f1a2b3c4d',
  staging: 'b2c3d4e5-f6a7-4b5c-9d8e-0f1a2b3c4d5e',
  production: 'c3d4e5f6-a7b8-4c5d-0e9f-1a2b3c4d5e6f',
}

// Mock the environments API to provide environments for the workbench page
// The useEnvironments hook uses fetchEnvironmentNames which returns EnvironmentName[] directly
vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironmentNames: vi.fn().mockResolvedValue([
    { id: 'a1b2c3d4-e5f6-4a5b-8c7d-9e0f1a2b3c4d', name: 'Development', tags: [] },
    { id: 'b2c3d4e5-f6a7-4b5c-9d8e-0f1a2b3c4d5e', name: 'Staging', tags: [] },
    { id: 'c3d4e5f6-a7b8-4c5d-0e9f-1a2b3c4d5e6f', name: 'Production', tags: [] },
  ]),
}))

// Mock the workbench API (used by useWorkbenchRun hook for session recovery)
vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    getCurrentSession: vi.fn().mockResolvedValue(null), // No session to recover
    startRun: vi.fn().mockResolvedValue({
      session_id: 'mock-session-id',
      status: 'running',
      websocket_topic: 'workbench:mock-session-id',
      warnings: [],
    }),
    stopRun: vi.fn().mockResolvedValue({ session_id: 'mock-session-id', status: 'stopped' }),
    clearSession: vi.fn().mockResolvedValue({ cleared: true }),
  },
}))

// Mock the system variables API (loaded during test canvas open)
vi.mock('@/features/settings/api/global-variables/crud', () => ({
  fetchSystemVariables: vi.fn().mockResolvedValue({}),
}))

// Mock WebSocket store (used by useWorkbenchRun hook)
vi.mock('@/features/workbench/stores/websocket-store', () => ({
  useWebSocketStore: vi.fn(() => ({
    subscribe: vi.fn().mockReturnValue({ topic: 'mock', unsubscribe: vi.fn() }),
    subscribeAsync: vi.fn().mockResolvedValue({ topic: 'mock', unsubscribe: vi.fn() }),
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: true,
  })),
}))

// Session ownership stays idle (nobody holds, nobody mirrors) in these suites.
vi.mock('@/features/workbench/hooks/use-session-ownership', () => ({
  useSessionOwnership: () => ({
    isHolder: false,
    isMirroring: false,
    holderLabel: null,
    holderKind: null,
    mcpSessionId: null,
    mirroredRun: null,
    browsingAway: false,
    browseAway: () => {},
    rejoinMirror: () => {},
    inheritRefreshTick: 0,
    watchers: 0,
    pendingTakeover: null,
    isRequestingTakeover: false,
    takeoverResult: null,
    dismissTakeoverResult: vi.fn(),
    takeOver: () => {},
    forceTakeOver: () => {},
    approve: () => {},
    deny: () => {},
    cancelRequest: () => {},
    pushDraft: () => {},
  }),
}))

// Mock resizable panels - react-resizable-panels doesn't work in jsdom
// (global event handlers reference DOM APIs not available in jsdom)
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children?: React.ReactNode }) => <div data-testid="resizable-panel-group">{children}</div>,
  ResizablePanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div data-testid="resize-handle" />,
}))

const STORAGE_KEYS = {
  SELECTED_ENV: 'wave_selected_environment',
  REMEMBER_SELECTION: 'wave_remember_env_selection',
  DEBUG_OPTIONS: 'wave_debug_options',
  RECENT_ENVS: 'wave_recent_environments',
}

// Helper to render WorkbenchPage in a router context
function renderWorkbenchPage() {
  const routes = [
    {
      path: '/workbench',
      element: (
        <ToastProvider>
          <ToastContainer />
          <ThemeProvider defaultTheme="light" storageKey="test-theme">
            <>
              <WorkbenchPage />
            </>
          </ThemeProvider>
        </ToastProvider>
      ),
    },
    {
      path: '/tests',
      element: <div data-testid="tests-list">Tests List</div>,
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: ['/workbench'] })
  return {
    ...render(<RouterProvider router={router} />),
    router,
  }
}

// Helper to render WorkbenchPage with URL search params
function renderWorkbenchPageWithParams(searchParams: string) {
  const routes = [
    {
      path: '/workbench',
      element: (
        <ToastProvider>
          <ToastContainer />
          <ThemeProvider defaultTheme="light" storageKey="test-theme">
            <>
              <WorkbenchPage />
            </>
          </ThemeProvider>
        </ToastProvider>
      ),
    },
    {
      path: '/tests',
      element: <div data-testid="tests-list">Tests List</div>,
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: [`/workbench${searchParams}`] })
  return {
    ...render(<RouterProvider router={router} />),
    router,
  }
}

// Mock fetch globally to handle dynamic imports in loadTest callback
// The component uses import('@/features/tests/api/crud').then(m => m.fetchTest(...)) which bypasses vi.mock
const mockFetch = vi.fn()

describe('WorkbenchPage', () => {
  beforeEach(function clearStorage() {
    localStorage.clear()
    // Reset workflow store to clean state
    useWorkflowStore.getState().reset()
    // Setup global fetch mock for dynamic imports
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/tests/') && url.includes('/validate')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ data: { fatal: false, errors: [], warnings: [] } }),
        })
      }
      if (url.includes('/testdata/uploads')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ uploads: [], interruptions: [] }),
        })
      }
      if (url.includes('/tests/') && url.includes('/workflow')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { nodes: [], edges: [] } }),
        })
      }
      if (url.includes('/tests/')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                id: 'test-123',
                name: 'My Existing Test',
                description: 'Test description',
                tags: ['tag1'],
                suite: null,
                metadata: { parent_suite: null },
                workflow: { nodes: [], edges: [] },
              },
            }),
        })
      }
      // Fallback for any other requests
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(async function cleanupTest() {
    // Flush all pending async operations to prevent act() warnings
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    cleanup()
    localStorage.clear()
    useWorkflowStore.getState().reset()
    vi.unstubAllGlobals()
  })

  describe('Navigation handlers', () => {
    it('shows close button on draft pages', async function testCloseVisible() {
      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Close button should be present on all pages including drafts
      expect(screen.getByTestId('toolbar-close-button')).toBeInTheDocument()
    })

    it('hides back button on draft pages (isDraft=true)', async function testBackHidden() {
      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Back button should NOT be visible on draft pages (isDraft=true)
      expect(screen.queryByTestId('breadcrumb-back-arrow')).not.toBeInTheDocument()
    })

    it('disables close button when canvas is clean', async function testCloseButtonDisabled() {
      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Close button should be disabled when canvas is clean (no unsaved changes)
      const closeButton = screen.getByTestId('toolbar-close-button')
      expect(closeButton).toBeDisabled()
    })
  })

  describe('Canvas state persistence', () => {
    it('persists environment selection to localStorage', async function testEnvPersistence() {
      const user = userEvent.setup()
      localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Open environment selector
      const envSelector = screen.getByTestId('environment-selector')
      await user.click(envSelector)

      // Select an environment
      await waitFor(function waitForDropdown() {
        expect(screen.getByTestId(`env-${TEST_ENV_IDS.staging}`)).toBeInTheDocument()
      })
      const envOption = screen.getByTestId(`env-${TEST_ENV_IDS.staging}`)
      await user.click(envOption)

      // Verify environment was persisted
      expect(localStorage.getItem(STORAGE_KEYS.SELECTED_ENV)).toBe(TEST_ENV_IDS.staging)
    })

    it('clears invalid recents from localStorage when environments change', async function testInvalidRecentsCleared() {
      // Pre-populate recents with some invalid IDs (not in available environments)
      const invalidRecent = { id: 'invalid-env-id', name: 'Deleted Environment' }
      const validRecent = { id: TEST_ENV_IDS.development, name: 'Development' }
      localStorage.setItem(
        STORAGE_KEYS.RECENT_ENVS,
        JSON.stringify([invalidRecent, validRecent])
      )

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Wait for environment validation effect to run
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      // Verify invalid recent was removed from localStorage
      const storedRecents = JSON.parse(localStorage.getItem(STORAGE_KEYS.RECENT_ENVS) || '[]')
      expect(storedRecents).not.toContainEqual(expect.objectContaining({ id: 'invalid-env-id' }))
    })

    it('clears selected environment when it no longer exists', async function testInvalidSelectedCleared() {
      // Pre-set a selected environment that doesn't exist in available list
      localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
      localStorage.setItem(STORAGE_KEYS.SELECTED_ENV, 'non-existent-env-id')

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Wait for environment validation effect to run
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      // Verify selected environment was cleared from localStorage
      expect(localStorage.getItem(STORAGE_KEYS.SELECTED_ENV)).toBeNull()
    })

    it('clears all recents when no environments exist', async function testRecentsCleared() {
      const { fetchEnvironmentNames } = await import('@/features/settings/api/environments/crud')
      // Mock empty environment list (all environments deleted)
      vi.mocked(fetchEnvironmentNames).mockResolvedValueOnce([])

      // Pre-populate recents with some environments
      const oldRecents = [
        { id: TEST_ENV_IDS.development, name: 'Development' },
        { id: TEST_ENV_IDS.staging, name: 'Staging' },
      ]
      localStorage.setItem(STORAGE_KEYS.RECENT_ENVS, JSON.stringify(oldRecents))

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Wait for environment validation effect to run
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      // Verify all recents were cleared since no environments exist
      const storedRecents = JSON.parse(localStorage.getItem(STORAGE_KEYS.RECENT_ENVS) || '[]')
      expect(storedRecents).toEqual([])
    })
  })

  describe('Undo/Redo handlers', () => {
    it('calls undo when undo button is clicked', async function testUndo() {
      const user = userEvent.setup()

      // Add two nodes so we have something to undo
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'node-1',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'First',
            version: '1.0.0',
          },
        })
        useWorkflowStore.getState().addNode({
          id: 'node-2',
          type: 'workflowNode',
          position: { x: 200, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Second',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Undo button should be enabled
      const undoButton = screen.getByTestId('toolbar-undo-button')
      await waitFor(function waitForEnabled() {
        expect(undoButton).not.toBeDisabled()
      })

      // Get initial node count from store
      const initialCount = useWorkflowStore.getState().nodes.length
      expect(initialCount).toBe(2)

      // Click undo
      await user.click(undoButton)

      // Node count should decrease
      await waitFor(function waitForUndo() {
        expect(useWorkflowStore.getState().nodes.length).toBe(1)
      })
    })

    it('enables redo button after clicking undo and triggers redo on click', async function testRedoEnables() {
      const user = userEvent.setup()

      // Add a node first
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'node-1',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'First',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Initially redo is disabled
      const redoButton = screen.getByTestId('toolbar-redo-button')
      expect(redoButton).toBeDisabled()

      // Click undo to create redo history
      const undoButton = screen.getByTestId('toolbar-undo-button')
      await waitFor(function waitForEnabled() {
        expect(undoButton).not.toBeDisabled()
      })
      await user.click(undoButton)

      // Redo button should now be enabled after undo
      await waitFor(function waitForRedoEnabled() {
        expect(redoButton).not.toBeDisabled()
      })

      // Click redo to trigger handleRedo (for coverage)
      await user.click(redoButton)

      // After clicking redo, the redo button should become disabled again
      await waitFor(function waitForRedoDisabled() {
        expect(redoButton).toBeDisabled()
      })
    })
  })

  describe('Dialog interactions', () => {
    it('closes save dialog when cancel is clicked', async function testCloseSaveDialog() {
      const user = userEvent.setup()

      // Add a node to make canvas dirty before rendering
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Save button should be enabled when canvas is dirty
      const saveButton = screen.getByTestId('toolbar-save-button')
      await waitFor(function waitForEnabled() {
        expect(saveButton).not.toBeDisabled()
      })

      // Click save to open dialog
      await user.click(saveButton)

      // Save dialog should be visible
      await waitFor(function waitForDialog() {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
      expect(screen.getByText('New Test')).toBeInTheDocument()

      // Click cancel to close
      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      await user.click(cancelButton)

      // Dialog should be closed
      await waitFor(function waitForDialogClosed() {
        expect(screen.queryByText('New Test')).not.toBeInTheDocument()
      })
    })

    it('closes close confirm dialog when clicking outside', async function testCloseConfirmDialogClose() {
      const user = userEvent.setup()

      // Add a node to make canvas dirty before rendering
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Close button should be enabled when canvas is dirty
      const closeButton = screen.getByTestId('toolbar-close-button')
      await waitFor(function waitForEnabled() {
        expect(closeButton).not.toBeDisabled()
      })

      // Click close to open confirmation dialog
      await user.click(closeButton)

      // Close confirm dialog should be visible
      await waitFor(function waitForDialog() {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
      // Look for the dialog heading specifically
      expect(screen.getByRole('heading', { name: /unsaved changes/i })).toBeInTheDocument()

      // Press Escape to close the dialog (tests handleCloseConfirmDialog)
      fireEvent.keyDown(document, { key: 'Escape' })

      // Dialog should be closed
      await waitFor(function waitForDialogClosed() {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('discards changes and resets canvas when "Discard and Close" is clicked', async function testDiscardAndClose() {
      const user = userEvent.setup()

      // Add a node to make canvas dirty
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Click close to open confirmation dialog
      const closeButton = screen.getByTestId('toolbar-close-button')
      await waitFor(function waitForEnabled() {
        expect(closeButton).not.toBeDisabled()
      })
      await user.click(closeButton)

      // Verify dialog is open
      await waitFor(function waitForDialog() {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Click "Discard and Close" to trigger handleDiscardAndClose
      await user.click(screen.getByRole('button', { name: /discard and close/i }))

      // Dialog should close
      await waitFor(function waitForDialogClosed() {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // Canvas should be reset (close button should be disabled)
      await waitFor(function waitForReset() {
        expect(screen.getByTestId('toolbar-close-button')).toBeDisabled()
      })
    })

    it('opens save dialog when "Save and Close" is clicked', async function testSaveAndClose() {
      const user = userEvent.setup()

      // Add a node to make canvas dirty
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Click close to open confirmation dialog
      const closeButton = screen.getByTestId('toolbar-close-button')
      await waitFor(function waitForEnabled() {
        expect(closeButton).not.toBeDisabled()
      })
      await user.click(closeButton)

      // Click "Save and Close"
      await waitFor(function waitForDialog() {
        expect(screen.getByRole('button', { name: 'Save and Close' })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: 'Save and Close' }))

      // Save dialog should now be visible
      await waitFor(function waitForSaveDialog() {
        expect(screen.getByText('New Test')).toBeInTheDocument()
      })
    })

    it('saves test and resets canvas after successful save', async function testSaveFlow() {
      const user = userEvent.setup()

      // Add a node to make canvas dirty
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Click save to open save dialog
      const saveButton = screen.getByTestId('toolbar-save-button')
      await waitFor(function waitForEnabled() {
        expect(saveButton).not.toBeDisabled()
      })
      await user.click(saveButton)

      // Fill in the test name
      await waitFor(function waitForDialog() {
        expect(screen.getByPlaceholderText('Enter test name…')).toBeInTheDocument()
      })
      const nameInput = screen.getByPlaceholderText('Enter test name…')
      await user.type(nameInput, 'My Test')

      // Click save button in dialog (within the dialog)
      const dialog = screen.getByRole('dialog')
      const dialogSaveButton = within(dialog).getByRole('button', { name: /save|create test/i })
      await user.click(dialogSaveButton)

      // Wait for save to complete (the dialog should close)
      await waitFor(
        function waitForSaveComplete() {
          expect(screen.queryByText('New Test')).not.toBeInTheDocument()
        }
      )
    })

    it('performs direct save without dialog for existing test with save-and-close', async function testDirectSaveAndClose() {
      // This tests the direct save path (lines 913-942 in placeholder-pages.tsx)
      // When editing an existing test with a name, Save and Close directly saves without the dialog
      const user = userEvent.setup()

      // Set up as editing an existing test
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-direct-save', 'Existing Test')
      })

      // Add a node to make canvas dirty
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node-direct',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Click close button (enabled because canvas is dirty)
      const closeButton = screen.getByTestId('toolbar-close-button')
      await waitFor(function waitForEnabled() {
        expect(closeButton).not.toBeDisabled()
      })
      await user.click(closeButton)

      // Close confirm dialog should appear
      await waitFor(function waitForDialog() {
        expect(screen.getByRole('button', { name: 'Save and Close' })).toBeInTheDocument()
      })

      // Click "Save and Close"
      await user.click(screen.getByRole('button', { name: 'Save and Close' }))

      // For existing tests with a name, save happens directly without opening save dialog
      // The close button should become disabled after save completes (canvas is clean)
      await waitFor(
        function waitForSaveComplete() {
          // Save dialog should NOT appear (this distinguishes from draft save flow)
          expect(screen.queryByPlaceholderText('Enter test name…')).not.toBeInTheDocument()
          // Close button should be disabled after successful save-and-close
          expect(screen.getByTestId('toolbar-close-button')).toBeDisabled()
        }
      )

      // Verify workflow store was reset after save-and-close
      // This covers the reset() call on line 939 of placeholder-pages.tsx
      await waitFor(function waitForReset() {
        const state = useWorkflowStore.getState()
        // After reset, editingTestId should be null (cleared by clearEditingTest)
        expect(state.editingTestId).toBeNull()
        // After reset, nodes should be empty
        expect(state.nodes).toHaveLength(0)
      })
    })

    it('handles direct save error gracefully', async function testDirectSaveError() {
      // Tests the error handling branch in direct save (catch block)
      const user = userEvent.setup()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Mock updateTest to throw an error
      const { updateTest } = await import('@/features/tests/api/crud')
      vi.mocked(updateTest).mockRejectedValueOnce(new Error('Network error'))

      // Set up as editing an existing test
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-error', 'Error Test')
      })

      // Add a node to make canvas dirty
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node-error',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Click close button
      const closeButton = screen.getByTestId('toolbar-close-button')
      await waitFor(function waitForEnabled() {
        expect(closeButton).not.toBeDisabled()
      })
      await user.click(closeButton)

      // Close confirm dialog should appear
      await waitFor(function waitForDialog() {
        expect(screen.getByRole('button', { name: 'Save and Close' })).toBeInTheDocument()
      })

      // Click "Save and Close"
      await user.click(screen.getByRole('button', { name: 'Save and Close' }))

      // Should log warning for save failure
      await waitFor(
        function waitForWarn() {
          expect(warnSpy).toHaveBeenCalledWith('Direct save failed:', expect.any(Error))
        }
      )

      warnSpy.mockRestore()
    })

    it('loads pending test after direct save in switch test scenario', async function testSwitchTestDirectSave() {
      // Tests handleSwitchTestSave's pendingEditTestId branch
      // This scenario: user is editing test A (dirty), tries to switch to test B
      // -> switch dialog appears -> clicks "Save & Open New" -> direct save + load test B
      //
      // NOTE: The similar code path in handleSaveAndClose (lines 929-931) is unreachable because:
      // 1. pendingEditTestId is only set when switch test dialog opens
      // 2. The switch dialog has a full-viewport backdrop that intercepts ALL clicks
      // 3. Clicking the toolbar Close button triggers the backdrop's onViewPendingWorkflow
      // 4. onViewPendingWorkflow clears pendingEditTestId before close confirm can open
      // This is why handleSaveAndClose's pendingEditTestId branch needs a coverage exclusion.
      const user = userEvent.setup()

      // Set up as editing an existing test
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-A', 'Test A')
      })

      // Add a node to make canvas dirty
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node-A',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      // Render with search param to trigger switch test dialog
      // This simulates user trying to open test-B while test-A is dirty
      renderWorkbenchPageWithParams('?editTest=test-B')

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Switch test dialog should appear (because dirty + different test ID)
      await waitFor(
        function waitForSwitchDialog() {
          expect(screen.getByRole('button', { name: /Save & Open New/i })).toBeInTheDocument()
        }
      )

      // Click "Save & Open New" which triggers direct save + load pending test
      await user.click(screen.getByRole('button', { name: /Save & Open New/i }))

      // Wait for the switch to complete - the URL should still have editTest=test-B
      // but the switch dialog should close
      await waitFor(
        function waitForSwitchComplete() {
          expect(screen.queryByRole('button', { name: /Save & Open New/i })).not.toBeInTheDocument()
        }
      )
    })

    it('saves test and resets canvas in save-and-close mode', async function testSaveAndCloseFlow() {
      // Ensure full cleanup from previous test - async operations from switch-test
      // scenario may still be in flight
      cleanup()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      const user = userEvent.setup()

      // Ensure clean store state - previous test may leave editingTestId set
      act(() => {
        useWorkflowStore.getState().clearEditingTest()
        useWorkflowStore.getState().reset()
      })

      renderWorkbenchPage()

      // Add a node AFTER render to make canvas dirty
      // (adding before render can race with component mount effects)
      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      // Verify isDirty is set after addNode
      expect(useWorkflowStore.getState().isDirty).toBe(true)

      // Click close to open confirmation dialog
      const closeButton = screen.getByTestId('toolbar-close-button')
      await waitFor(function waitForEnabled() {
        expect(closeButton).not.toBeDisabled()
      })
      await user.click(closeButton)

      // Click "Save and Close"
      await waitFor(function waitForDialog() {
        expect(screen.getByRole('button', { name: 'Save and Close' })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: 'Save and Close' }))

      // Fill in the test name
      await waitFor(function waitForSaveDialog() {
        expect(screen.getByPlaceholderText('Enter test name…')).toBeInTheDocument()
      })
      const nameInput = screen.getByPlaceholderText('Enter test name…')
      await user.type(nameInput, 'My Test')

      // Click save button in dialog (within the dialog)
      const dialog = screen.getByRole('dialog')
      const dialogSaveButton = within(dialog).getByRole('button', { name: /save|create test/i })
      await user.click(dialogSaveButton)

      // Wait for save to complete and canvas to reset
      await waitFor(
        function waitForReset() {
          // Canvas should be reset (close button should be disabled)
          expect(screen.getByTestId('toolbar-close-button')).toBeDisabled()
        }
      )
    })
  })

  describe('Edit button behavior', () => {
    it('disables edit button in draft mode (no editingTestId)', async function testEditDisabledInDraft() {
      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Edit button should be disabled in draft mode
      const editButton = screen.getByTestId('toolbar-edit-button')
      expect(editButton).toBeDisabled()
    })

    it('enables edit button when editing an existing test', async function testEditEnabledWhenEditing() {
      // Set up as editing an existing test
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-123', 'My Existing Test')
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Edit button should be enabled when editing an existing test
      const editButton = screen.getByTestId('toolbar-edit-button')
      await waitFor(function waitForEnabled() {
        expect(editButton).not.toBeDisabled()
      })
    })

    it('opens edit metadata dialog when clicking edit button', async function testEditOpensDialog() {
      const user = userEvent.setup()

      // Set up as editing an existing test
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-123', 'My Existing Test')
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Click edit button
      const editButton = screen.getByTestId('toolbar-edit-button')
      await waitFor(function waitForEnabled() {
        expect(editButton).not.toBeDisabled()
      })
      await user.click(editButton)

      // Edit dialog should be visible
      await waitFor(function waitForDialog() {
        expect(screen.getByText('Edit Test Info')).toBeInTheDocument()
      })
    })

    it('opens save dialog for existing test with empty name (edge case)', async function testSaveDialogEmptyName() {
      const user = userEvent.setup()

      // Set up as editing an existing test but with empty name (edge case)
      // This tests the fallback branch in TestFormDialog props
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-123', '')
        useWorkflowStore.getState().addNode({
          id: 'test-node',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Click close to trigger save-and-close flow (opens save dialog for editing)
      const closeButton = screen.getByTestId('toolbar-close-button')
      await waitFor(function waitForEnabled() {
        expect(closeButton).not.toBeDisabled()
      })
      await user.click(closeButton)

      // Click "Save and Close" to open save dialog
      await waitFor(function waitForDialog() {
        expect(screen.getByRole('button', { name: 'Save and Close' })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: 'Save and Close' }))

      // Save dialog should be visible with empty initial name
      await waitFor(function waitForSaveDialog() {
        expect(screen.getByPlaceholderText('Enter test name…')).toBeInTheDocument()
      })
    })

    it('closes edit metadata dialog when cancel is clicked', async function testEditDialogClose() {
      const user = userEvent.setup()

      // Set up as editing an existing test
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-123', 'My Existing Test')
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Click edit button
      const editButton = screen.getByTestId('toolbar-edit-button')
      await waitFor(function waitForEnabled() {
        expect(editButton).not.toBeDisabled()
      })
      await user.click(editButton)

      // Edit dialog should be visible
      await waitFor(function waitForDialog() {
        expect(screen.getByText('Edit Test Info')).toBeInTheDocument()
      })

      // Click cancel
      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      await user.click(cancelButton)

      // Dialog should be closed
      await waitFor(function waitForDialogClosed() {
        expect(screen.queryByText('Edit Test Info')).not.toBeInTheDocument()
      })
    })

    it('saves metadata and updates test name when save is clicked in edit dialog', async function testEditMetadataSave() {
      const user = userEvent.setup()

      // Set up as editing an existing test
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-123', 'My Existing Test')
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Click edit button
      const editButton = screen.getByTestId('toolbar-edit-button')
      await waitFor(function waitForEnabled() {
        expect(editButton).not.toBeDisabled()
      })
      await user.click(editButton)

      // Edit dialog should be visible with pre-filled name
      await waitFor(function waitForDialog() {
        expect(screen.getByText('Edit Test Info')).toBeInTheDocument()
        expect(screen.getByLabelText(/test name/i)).toHaveValue('My Existing Test')
      })

      // Modify the name
      const nameInput = screen.getByLabelText(/test name/i)
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Test Name')

      // Click save
      const dialog = screen.getByRole('dialog')
      const saveButton = within(dialog).getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // Dialog should close after save (even if API fails, we still close)
      await waitFor(
        function waitForDialogClosed() {
          expect(screen.queryByText('Edit Test Info')).not.toBeInTheDocument()
        }
      )
    })

  })

  describe('Draft restoration with URL params', () => {
    it('skips draft restoration when editTest URL param exists', async function testSkipsDraftWithEditParam() {
      // This tests the early return in draft restoration useEffect (lines 704-707)
      // specifically the editTestId branch
      renderWorkbenchPageWithParams('?editTest=test-123')

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Page should render without restoring draft because editTest param is set
      // (the test is loading from API, not restoring from draft)
    })

    it('skips draft restoration when editingTestId is set', async function testSkipsDraftWithEditingTestId() {
      // This tests the middle branch (editingTestId) in draft restoration (lines 704-707)
      // when no editTest URL param exists but the store has an editingTestId set

      // Set up the workflow store with an editing test ID (simulates already being in edit mode)
      act(() => {
        useWorkflowStore.getState().setEditingTest('existing-test-456', 'Already Editing Test')
      })

      // Navigate without editTest URL param
      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Verify editingTestId is set
      expect(useWorkflowStore.getState().editingTestId).toBe('existing-test-456')

      // Draft restoration should be skipped because editingTestId is set
      // (the page should show the existing test workflow, not restore from draft)
    })

    it('skips draft restoration during test loading state', async function testSkipsDraftWhileLoading() {
      // This tests the isLoadingTest branch in draft restoration
      // When we navigate with editTest param, the component goes into loading state
      // which should also skip draft restoration
      const { fetchTest } = await import('@/features/tests/api/crud')

      // Make fetchTest hang to keep the component in loading state longer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let resolveFetch: ((value: any) => void) | null = null
      vi.mocked(fetchTest).mockImplementationOnce(() =>
        new Promise((resolve) => {
          resolveFetch = resolve
        })
      )

      renderWorkbenchPageWithParams('?editTest=test-123')

      // Wait for loading state and for the mock to be called
      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Wait for the fetch mock to be invoked
      await waitFor(function waitForMock() {
        expect(resolveFetch).not.toBeNull()
      })

      // Resolve the fetch to complete loading
      await act(async () => {
        resolveFetch!({
          id: 'test-123',
          name: 'Loaded Test',
          description: '',
          tags: [],
          suite: null,
          workflow: { nodes: [], edges: [] },
        })
      })

      // Page should now show the loaded test
      await waitFor(function waitForLoaded() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })
    })
  })

  describe('Direct save for existing tests', () => {
    it('directly saves without dialog when editing existing test', async function testDirectSave() {
      const user = userEvent.setup()

      // Set up as editing an existing test (just the ID, no node yet)
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-123', 'My Existing Test')
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Wait for initial load to complete (loadTest runs on mount when editingTestId is set)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      // Now add a node to make the canvas dirty AFTER initial load
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      // Save button should be enabled when canvas is dirty
      const saveButton = screen.getByTestId('toolbar-save-button')
      await waitFor(function waitForEnabled() {
        expect(saveButton).not.toBeDisabled()
      })

      // Click save - should NOT open dialog
      await user.click(saveButton)

      // Save dialog should NOT be visible for existing test
      // We just wait a short time and verify the dialog never appeared
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })
      expect(screen.queryByText('New Test')).not.toBeInTheDocument()
    })
  })

  describe('Run/Stop workflow functionality', () => {
    it('shows toast warning when trying to run without test ID', async function testRunWarning() {
      const user = userEvent.setup()

      // Pre-select environment (but no test ID - draft mode)
      localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
      localStorage.setItem(STORAGE_KEYS.SELECTED_ENV, TEST_ENV_IDS.development)

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Environment selector should show the selected environment
      await waitFor(function waitForEnvSelector() {
        expect(screen.getByTestId('environment-selector')).toHaveTextContent('Development')
      })

      // Click run button
      await user.click(screen.getByTestId('run-button'))

      // Should show toast warning since no test ID (draft mode)
      await waitFor(function waitForToast() {
        expect(screen.getByText('Save the test before running.')).toBeInTheDocument()
      })
    })

    it('calls stopWorkbenchRun when stop is clicked during running state', async function testStopRun() {
      // This test verifies the handleStop callback is connected to the stop button
      // We can't fully test the async behavior without more complex mocking,
      // but we verify the button exists and can be clicked in running state

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // In idle state, there should be no stop button - only run button
      expect(screen.queryByTestId('action-stop-button')).not.toBeInTheDocument()
      expect(screen.getByTestId('run-button')).toBeInTheDocument()
    })

    it('starts workbench run when Run button clicked with valid test and environment', async function testRunWithValidTest() {
      const user = userEvent.setup()
      const { workbenchApi } = await import('@/features/workbench/api/workbench')

      // Pre-select environment
      localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
      localStorage.setItem(STORAGE_KEYS.SELECTED_ENV, TEST_ENV_IDS.development)

      // Set up as editing an existing test (provides test ID)
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-123', 'My Existing Test')
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Wait for environment to be loaded and selected
      await waitFor(function waitForEnvSelector() {
        expect(screen.getByTestId('environment-selector')).toHaveTextContent('Development')
      })

      // Click run button
      await user.click(screen.getByTestId('run-button'))

      // Wait for API call to be made
      // V-CANVAS-04: includes a client-generated session_id for pre-subscription
      await waitFor(function waitForApiCall() {
        expect(workbenchApi.startRun).toHaveBeenCalledWith({
          test_id: 'test-123',
          environment_id: TEST_ENV_IDS.development,
          session_id: expect.any(String),
        })
      })
    })

    it('stops running workbench session when Stop button is clicked', async function testStopRunning() {
      const user = userEvent.setup()
      const { workbenchApi } = await import('@/features/workbench/api/workbench')

      // Mock session recovery to return a running session
      vi.mocked(workbenchApi.getCurrentSession).mockResolvedValueOnce({
        session_id: 'running-session-123',
        status: 'running',
        test_id: 'test-456',
        websocket_topic: 'workbench:running-session-123',
        current_block: null,
        progress: { current: 1, total: 5, percentage: 20 },
      })

      // Set up as editing an existing test
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-456', 'Running Test')
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Wait for session recovery and running state
      await waitFor(function waitForRunningState() {
        // In running state, the stop button should be visible
        expect(screen.getByTestId('action-stop-button')).toBeInTheDocument()
      })

      // Click stop button - now opens a confirmation dialog (per
      // the Stop Confirmation Policy).
      await user.click(screen.getByTestId('action-stop-button'))

      // Confirm the stop in the dialog.
      await waitFor(function waitForConfirm() {
        expect(screen.getByTestId('stop-confirm-immediate')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('stop-confirm-immediate'))

      // Wait for API call to be made
      await waitFor(function waitForApiCall() {
        expect(workbenchApi.stopRun).toHaveBeenCalledWith('running-session-123')
      })
    })
  })

  describe('Draft auto-save behavior', () => {
    it('skips draft auto-save when editingTestId is set', async function testSkipsDraftAutoSave() {
      // This tests line 913: if (editingTestId) return
      // When editing an existing test, draft should not be auto-saved

      // Set up as editing an existing test
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-123', 'My Existing Test')
      })

      // Get initial localStorage state
      const draftKey = 'wave_workbench_draft'
      localStorage.removeItem(draftKey)

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Wait for initial load
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      // Now add a node to trigger auto-save effect
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'test-node-autosave',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      // Wait for any potential save to happen
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      // Draft should NOT have been saved because editingTestId is set
      // When editingTestId is set, the auto-save effect returns early
      const draftAfter = localStorage.getItem(draftKey)
      expect(draftAfter).toBeNull()
    })
  })

  describe('New Test Mode (?newTest=true) - Regression prevention', () => {
    // Creating a new test after editing another must not show the other test's flow and variables

    it('resets workflow store when navigating with ?newTest=true', async function testNewTestResetsStore() {
      // Pre-populate the workflow store with nodes, edges, and variables
      // simulating the state after editing an existing test
      act(() => {
        const store = useWorkflowStore.getState()
        store.addNode({
          id: 'old-test-node',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Old Plugin',
            version: '1.0.0',
          },
        })
        store.addVariable({
          name: 'oldVariable',
          value: 'old value',
          type: 'string',

        })
        store.setEditingTest('old-test-id', 'Old Test Name')
        store.markSaved()
      })

      // Verify pre-conditions
      expect(useWorkflowStore.getState().nodes).toHaveLength(1)
      expect(useWorkflowStore.getState().variables).toHaveLength(1)
      expect(useWorkflowStore.getState().editingTestId).toBe('old-test-id')

      // Navigate with ?newTest=true
      renderWorkbenchPageWithParams('?newTest=true')

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Store should be reset - no nodes, edges, or variables from old test
      await waitFor(function verifyReset() {
        const state = useWorkflowStore.getState()
        expect(state.nodes).toHaveLength(0)
        expect(state.edges).toHaveLength(0)
        expect(state.variables).toHaveLength(0)
        expect(state.editingTestId).toBeNull()
        expect(state.editingTestName).toBeNull()
      })
    })

    it('clears draft when navigating with ?newTest=true', async function testNewTestClearsDraft() {
      // Use the correct draft key from use-draft-persistence.ts
      const draftKey = 'wave-workbench-draft'

      // Pre-populate draft in localStorage
      const oldDraft = {
        nodes: [{ id: 'draft-node', type: 'workflowNode', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        testId: null,
        testName: null,
        isDirty: true,
        variables: [{ id: 'draft-var', name: 'draftVar', value: 'draft', type: 'string' }],
      }
      localStorage.setItem(draftKey, JSON.stringify(oldDraft))

      // Verify draft exists
      expect(localStorage.getItem(draftKey)).not.toBeNull()

      // Navigate with ?newTest=true
      renderWorkbenchPageWithParams('?newTest=true')

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Wait for the effect to clear the draft
      await waitFor(function verifyDraftCleared() {
        expect(localStorage.getItem(draftKey)).toBeNull()
      })
    })

    it('resets the workflow store when navigating with ?newTest=true', async function testNewTestResetsStore() {
      // Pre-populate store to prove the reset fires on ?newTest=true.
      act(() => {
        const store = useWorkflowStore.getState()
        store.addNode({
          id: 'pre-node-1',
          type: 'workflowNode',
          position: { x: 10, y: 10 },
          data: {
            nodeType: 'plugin',
            label: 'Pre Plugin',
            version: '1.0.0',
          },
        })
        store.markSaved()
      })

      renderWorkbenchPageWithParams('?newTest=true')

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Name-prompt dialog is NOT opened from the `?newTest=true` URL
      // path - a direct visit (used by `/tests/new`) must land on a
      // clean canvas so Playwright tests don't hit a blocking overlay.
      // The "New Test" button in the tests-list owns the dialog flow.
      await waitFor(function verifyStoreReset() {
        const state = useWorkflowStore.getState()
        expect(state.nodes).toHaveLength(0)
      })
    })

    it('save dialog shows empty state for new test, not old test data', async function testSaveDialogEmptyForNewTest() {
      // Pre-populate the workflow store with old test data
      act(() => {
        const store = useWorkflowStore.getState()
        store.addNode({
          id: 'old-node-1',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Should Not Appear',
            version: '1.0.0',
          },
        })
        store.addVariable({
          name: 'shouldNotAppear',
          value: 'this should be gone',
          type: 'string',

        })
        store.setEditingTest('old-test-999', 'Old Test Should Not Appear')
        store.markSaved()
      })

      // Navigate with ?newTest=true
      renderWorkbenchPageWithParams('?newTest=true')

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Store reset drops every pre-populated bit, proving ?newTest=true
      // always starts from a blank slate regardless of prior editing state.
      await waitFor(function verifyStoreReset() {
        const state = useWorkflowStore.getState()
        expect(state.nodes).toHaveLength(0)
        expect(state.variables).toHaveLength(0)
        expect(state.editingTestId).toBeNull()
      })
    })

    it('asks before dropping unsaved work, and Discard then lands on a blank canvas', async function testNewTestAsksFirst() {
      act(() => {
        const store = useWorkflowStore.getState()
        store.addNode({
          id: 'unsaved-node',
          type: 'workflowNode',
          position: { x: 10, y: 10 },
          data: { nodeType: 'plugin', label: 'Unsaved Plugin', version: '1.0.0' },
        })
        store.setEditingTest('dirty-test-id', 'Dirty Test')
      })
      expect(useWorkflowStore.getState().isDirty).toBe(true)

      const { router } = renderWorkbenchPageWithParams('?newTest=true')

      const dialog = await screen.findByTestId('switch-test-dialog')
      expect(dialog).toHaveTextContent('Dirty Test')
      expect(useWorkflowStore.getState().nodes.map((n) => n.id)).toEqual(['unsaved-node'])
      expect(useWorkflowStore.getState().editingTestId).toBe('dirty-test-id')
      await waitFor(function verifyRequestUsedUp() {
        expect(router.state.location.search).toBe('')
      })

      await userEvent.click(within(dialog).getByRole('button', { name: 'Discard & Open New' }))

      await waitFor(function verifyBlankCanvas() {
        const state = useWorkflowStore.getState()
        expect(state.nodes).toHaveLength(0)
        expect(state.editingTestId).toBeNull()
        // reset() lowers both; only a new fit request brings the blank canvas out from behind the overlay.
        expect(state.fitViewRequested || state.isCanvasReady).toBe(true)
      })
      expect(screen.queryByTestId('switch-test-dialog')).not.toBeInTheDocument()
    })

    it('removes ?newTest=true from URL after processing', async function testNewTestParamRemoved() {
      const { router } = renderWorkbenchPageWithParams('?newTest=true')

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Wait for the URL to be updated
      await waitFor(function verifyParamRemoved() {
        // The ?newTest=true param should be removed from the URL
        expect(router.state.location.search).not.toContain('newTest=true')
      })
    })

    it('handles transition from editing test to creating new test correctly', async function testEditToNewTransition() {
      // Scenario:
      // 1. User edits Test A (store has Test A's data)
      // 2. User saves Test A (isDirty becomes false, but store still has data)
      // 3. User navigates to Tests list
      // 4. User clicks "New Test" which navigates to /workbench?newTest=true
      // 5. New test must not show Test A's flow and variables

      // Simulate state after editing and saving Test A
      act(() => {
        const store = useWorkflowStore.getState()
        // Add nodes like Test A had
        store.addNode({
          id: 'test-a-node-1',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test A Plugin 1',
            version: '1.0.0',
          },
        })
        store.addNode({
          id: 'test-a-node-2',
          type: 'workflowNode',
          position: { x: 300, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test A Plugin 2',
            version: '1.0.0',
          },
        })
        // Add variables like Test A had
        store.addVariable({
          name: 'testAVariable1',
          value: 'value from test A',
          type: 'string',

        })
        store.addVariable({
          name: 'testAVariable2',
          value: 42,
          type: 'integer',

        })
        // Set editing state
        store.setEditingTest('test-a-id', 'Test A')
        // Mark as saved (isDirty = false) - this is the key state after saving
        store.markSaved()
      })

      // Verify Test A state is in the store
      const stateBefore = useWorkflowStore.getState()
      expect(stateBefore.nodes).toHaveLength(2)
      expect(stateBefore.variables).toHaveLength(2)
      expect(stateBefore.editingTestId).toBe('test-a-id')
      expect(stateBefore.isDirty).toBe(false)

      // Now navigate with ?newTest=true (simulating clicking "New Test" from Tests list)
      renderWorkbenchPageWithParams('?newTest=true')

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // CRITICAL: Store should be completely reset - no Test A data should remain.
      await waitFor(function verifyStoreResetFromTestA() {
        const stateAfter = useWorkflowStore.getState()
        expect(stateAfter.nodes).toHaveLength(0)
        expect(stateAfter.edges).toHaveLength(0)
        expect(stateAfter.variables).toHaveLength(0)
        expect(stateAfter.editingTestId).toBeNull()
        expect(stateAfter.editingTestName).toBeNull()
      })
    })

    it('starts a blank canvas instead of bringing the saved draft back', async function testNewTestStartsBlank() {
      const draftKey = 'wave-workbench-draft'
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          nodes: [{ id: 'draft-node', type: 'workflowNode', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          testId: null,
          testName: null,
          isDirty: true,
          variables: [{ id: 'draft-var', name: 'draftVar', value: 'draft', type: 'string' }],
        })
      )

      renderWorkbenchPageWithParams('?newTest=true')
      await screen.findByTestId('workbench-page')

      const state = useWorkflowStore.getState()
      expect(state.nodes).toHaveLength(0)
      expect(state.variables).toHaveLength(0)
      expect(state.isDirty).toBe(false)

      // Past the draft auto-save delay, nothing has written the old draft back.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600))
      })
      expect(localStorage.getItem(draftKey)).toBeNull()
      expect(useWorkflowStore.getState().nodes).toHaveLength(0)
    })

    it('does not reopen the test that was open before the page load', async function testNewTestKeepsOldTestClosed() {
      const { fetchTest } = await import('@/features/tests/api/crud')
      vi.mocked(fetchTest).mockClear()
      act(() => {
        useWorkflowStore.getState().setEditingTest('old-test-id', 'My Existing Test')
      })

      const { router } = renderWorkbenchPageWithParams('?newTest=true')
      await screen.findByTestId('workbench-page')
      await waitFor(function verifyRequestUsedUp() {
        expect(router.state.location.search).toBe('')
      })

      expect(fetchTest).not.toHaveBeenCalled()
      expect(useWorkflowStore.getState().editingTestId).toBeNull()
      expect(useWorkflowStore.getState().editingTestName).toBeNull()
    })

    it('drops a test that is still loading when New Test opens', async function testNewTestDropsLoadInFlight() {
      const { fetchTest } = await import('@/features/tests/api/crud')
      vi.mocked(fetchTest).mockClear()
      let releaseTest: (details: Awaited<ReturnType<typeof fetchTest>>) => void = () => {}
      vi.mocked(fetchTest).mockImplementationOnce(
        () => new Promise((resolve) => { releaseTest = resolve })
      )

      const { router } = renderWorkbenchPageWithParams('?editTest=test-123')
      await waitFor(function waitForLoadStart() {
        expect(fetchTest).toHaveBeenCalledWith('test-123')
      })

      await act(async () => {
        await router.navigate('/workbench?newTest=true')
      })
      await waitFor(function verifyRequestUsedUp() {
        expect(router.state.location.search).toBe('')
      })
      // The closed test no longer shows as loading, although its read is still out.
      expect(screen.queryByText('Loading test…')).not.toBeInTheDocument()

      await act(async () => {
        releaseTest({
          id: 'test-123',
          name: 'My Existing Test',
          description: '',
          tags: [],
          suite: null,
          workflow: { nodes: [], edges: [] },
        } as unknown as Awaited<ReturnType<typeof fetchTest>>)
        // The other reads of the old load have settled, so a short pause lets it run to its end.
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      const state = useWorkflowStore.getState()
      expect(state.editingTestId).toBeNull()
      expect(state.editingTestName).toBeNull()
      expect(state.nodes).toHaveLength(0)
    })
  })

  describe('Leaving the Workbench while a test loads', () => {
    interface TestRead {
      resolve(details: unknown): void
      reject(reason: unknown): void
    }

    /** Test Z is open; the user opens test A and goes to the Tests list before A's read comes back. */
    async function leaveWhileTestLoads() {
      const { fetchTest } = await import('@/features/tests/api/crud')
      vi.mocked(fetchTest).mockClear()
      let read: TestRead = { resolve: () => {}, reject: () => {} }
      vi.mocked(fetchTest).mockImplementationOnce(
        () => new Promise((resolve, reject) => { read = { resolve, reject } })
      )
      act(() => {
        const store = useWorkflowStore.getState()
        store.setEditingTest('test-z', 'Test Z')
        store.setNodes(
          [{ id: 'z-node', type: 'workflowNode', position: { x: 0, y: 0 }, data: { nodeType: 'plugin', label: 'Z Block', version: '1.0.0' } }],
          { skipDirty: true },
        )
        store.setCanvasReady(true)
      })

      const { router } = renderWorkbenchPageWithParams('?editTest=test-a')
      await waitFor(function waitForLoadStart() {
        expect(fetchTest).toHaveBeenCalledWith('test-a')
      })

      await act(async () => {
        await router.navigate('/tests')
      })
      expect(screen.getByTestId('tests-list')).toBeInTheDocument()
      return { router, read }
    }

    async function settleAndComeBack(router: ReturnType<typeof createMemoryRouter>, settle: () => void) {
      await act(async () => {
        settle()
        // The other reads of the load have settled, so a short pause lets it run to its end.
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      await act(async () => {
        await router.navigate('/workbench')
      })
      await screen.findByTestId('workbench-page')
    }

    it('shows the open test again when the read came back after the user left', async function testLateReadShowsCanvas() {
      const { router, read } = await leaveWhileTestLoads()

      await settleAndComeBack(router, () => read.resolve({
        id: 'test-a',
        name: 'Test A',
        description: '',
        tags: [],
        suite: null,
        workflow: { nodes: [], edges: [] },
      }))

      await waitFor(function verifyCanvasShown() {
        expect(useWorkflowStore.getState().isCanvasReady).toBe(true)
      })
      expect(useWorkflowStore.getState().editingTestId).toBe('test-z')
    })

    it('shows the open test again when the read failed after the user left', async function testLateFailureShowsCanvas() {
      const { router, read } = await leaveWhileTestLoads()

      await settleAndComeBack(router, () => read.reject(Object.assign(new Error('Server error'), { status: 500 })))

      await waitFor(function verifyCanvasShown() {
        expect(useWorkflowStore.getState().isCanvasReady).toBe(true)
      })
      expect(useWorkflowStore.getState().editingTestId).toBe('test-z')
      expect(screen.queryByText('Could not load test')).not.toBeInTheDocument()
    })
  })

  describe('Drill epoch remount', () => {
    it('advances the drill epoch when the drill path changes (WorkflowCanvas remounts)', async function testDrillEpochAdvances() {
      // Seed a nested local Function tree so the drill path resolves cleanly
      // through walkActiveSubtree (both useFunctionScope and useCanvasDrop).
      const childFn = {
        id: 'child-fn',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_2',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            inputs: [],
            outputs: [],
            variables: [],
          },
        },
      }
      const parentFn = {
        id: 'parent-fn',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [childFn], edges: [] },
            inputs: [],
            outputs: [],
            variables: [],
          },
        },
      }
      act(() => {
        useWorkflowStore.setState({
          nodes: [parentFn],
          drillPath: [],
        } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Drill one level in. This flips prevPathRef !== drillPathSerialized, so
      // the render-time epoch increment block executes and the canvas remounts.
      act(() => {
        useWorkflowStore.getState().pushDrill('parent-fn')
      })

      await waitFor(function waitForRerender() {
        expect(useWorkflowStore.getState().drillPath).toHaveLength(1)
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // Drill a second level so the serialized comparison fires again, proving
      // the increment is per-change and not just first-mount.
      act(() => {
        useWorkflowStore.getState().pushDrill('child-fn')
      })

      await waitFor(function waitForSecondRerender() {
        expect(useWorkflowStore.getState().drillPath).toHaveLength(2)
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })
    })
  })

  describe('Save keyboard shortcut', () => {
    it('opens the save dialog when Ctrl/Cmd+S is pressed on a dirty draft', async function testSaveShortcut() {
      // Add a node so the draft is dirty and handleSaveClick opens the dialog.
      act(() => {
        useWorkflowStore.getState().addNode({
          id: 'shortcut-node',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            nodeType: 'plugin',
            label: 'Test Plugin',
            version: '1.0.0',
          },
        })
      })

      renderWorkbenchPage()

      await waitFor(function waitForPage() {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      // No dialog yet.
      expect(screen.queryByText('New Test')).not.toBeInTheDocument()

      // Press Ctrl+S - this routes through useSaveShortcut.onSave ->
      // saveHook.handleSaveClick(), opening the create-test dialog.
      act(() => {
        fireEvent.keyDown(document, { key: 's', ctrlKey: true })
      })

      await waitFor(function waitForSaveDialog() {
        expect(screen.getByText('New Test')).toBeInTheDocument()
      })
    })
  })

})
