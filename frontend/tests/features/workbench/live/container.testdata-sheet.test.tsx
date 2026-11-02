/**
 * WorkbenchContainer - Test Data chip + sheet wiring (TDATA-3).
 *
 * The container owns the testDataOpen state, mounts TestDataSheet with the
 * session's test id (null for an unsaved test), opens it from the breadcrumb
 * chip and re-focuses the open sheet when the chip is clicked again.
 * TestDataSheet itself is stubbed here - its own suite covers its chrome.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { WorkbenchContainer } from '@/features/workbench/live'
import { ThemeProvider } from '@/design-system/theme-provider'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { workbenchApi } from '@/features/workbench/api/workbench'

const sheetSpies = vi.hoisted(() => ({ refocusSheet: vi.fn() }))

// Lightweight apiClient over the global fetch mock - mirrors the workbench
// container harness.
vi.mock('@/lib/api', () => {
  const getApiBaseUrl = () => 'http://localhost:8000'
  async function request(method: string, path: string, body?: unknown) {
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
    if (body !== undefined && method !== 'GET' && method !== 'HEAD') opts.body = JSON.stringify(body)
    const response = await fetch(`${getApiBaseUrl()}${path}`, opts)
    if (!response.ok) throw new Error(response.statusText || `Error ${response.status || 500}`)
    const json = typeof response.json === 'function' ? await response.json() : {}
    return { data: json.data ?? json, meta: json.meta ?? { requestId: '' }, status: response.status ?? 200, pagination: json.pagination }
  }
  return {
    getApiBaseUrl,
    apiClient: {
      get: (path: string) => request('GET', path),
      post: (path: string, body?: unknown) => request('POST', path, body),
      put: (path: string, body?: unknown) => request('PUT', path, body),
      patch: (path: string, body?: unknown) => request('PATCH', path, body),
      delete: (path: string) => request('DELETE', path),
    },
  }
})

vi.mock('@/components/shared/draggable-sheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/draggable-sheet')>()
  return { ...actual, refocusSheet: sheetSpies.refocusSheet }
})

vi.mock('@/features/workbench/live/testdata-sheet', () => ({
  TestDataSheet: ({
    open,
    testId,
    readOnly,
    onClose,
  }: Readonly<{
    open: boolean
    testId: string | null
    readOnly?: boolean
    onClose: () => void
  }>) =>
    open ? (
      <div
        data-testid="testdata-sheet-stub"
        data-test-id-prop={testId ?? 'null'}
        data-read-only-prop={String(readOnly)}
      >
        <button type="button" onClick={onClose}>
          Close test data
        </button>
      </div>
    ) : null,
}))

const activity = vi.hoisted(() => ({ value: { uploads: 0, interruptions: 0 } }))

vi.mock('@/features/workbench/common/testdata/use-testdata-activity', () => ({
  useTestDataActivity: () => activity.value,
}))

vi.mock('@/features/tests/api/crud', () => ({
  updateTestMetadata: vi.fn().mockResolvedValue({ id: 'test-456', name: 'Recovered Test' }),
  updateTest: vi.fn().mockResolvedValue({ id: 'test-456', name: 'Recovered Test' }),
  createTest: vi.fn().mockResolvedValue({ id: 'new-test-1', name: 'New Test' }),
  fetchTest: vi.fn().mockResolvedValue({
    id: 'test-456',
    name: 'Recovered Test',
    description: '',
    tags: [],
    suite: null,
    workflow: { nodes: [], edges: [] },
  }),
  fetchTestWorkflow: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  fetchTestsTags: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/features/tests/api/validation', () => ({
  validateTest: vi.fn().mockResolvedValue({ fatal: false, errors: [], warnings: [] }),
}))

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuites: vi.fn().mockResolvedValue({ success: true, data: [] }),
}))

vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironmentNames: vi.fn().mockResolvedValue([
    { id: 'a1b2c3d4-e5f6-4a5b-8c7d-9e0f1a2b3c4d', name: 'Development', tags: [] },
  ]),
}))

vi.mock('@/features/settings/api/global-variables/crud', () => ({
  fetchSystemVariables: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    getCurrentSession: vi.fn().mockResolvedValue(null),
    getRunningSession: vi.fn().mockResolvedValue(null),
    getStatus: vi.fn().mockResolvedValue(null),
    startRun: vi.fn(),
    startDebugRun: vi.fn(),
    stopRun: vi.fn(),
    clearSession: vi.fn().mockResolvedValue({ cleared: true }),
    updateSkippedNodes: vi.fn(),
    updateWorkbenchBreakpoints: vi.fn(),
    updateDebugOptions: vi.fn(),
    continueExecution: vi.fn(),
    skipBlockAtPause: vi.fn(),
    stepOver: vi.fn(),
    stepInto: vi.fn(),
    repeatStep: vi.fn(),
    getSessionVariables: vi.fn().mockResolvedValue({}),
    setVariableOverride: vi.fn(),
    listSessionArtifacts: vi.fn().mockResolvedValue({ items: [] }),
    deleteSessionArtifact: vi.fn().mockResolvedValue(undefined),
    downloadSessionArtifact: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/features/workbench/stores/websocket-store', () => ({
  useWebSocketStore: vi.fn(() => ({
    subscribe: vi.fn().mockReturnValue({ topic: 'mock', unsubscribe: vi.fn() }),
    subscribeAsync: vi.fn().mockResolvedValue({ topic: 'mock', unsubscribe: vi.fn() }),
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: true,
  })),
}))

// Session ownership stays idle (nobody holds, nobody mirrors) in this suite.
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

// react-resizable-panels does not work in jsdom.
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}))

const PASSED_SESSION = {
  session_id: 'sess-testdata-1',
  status: 'passed',
  test_id: 'test-456',
  websocket_topic: 'workbench:sess-testdata-1',
  block_states: {},
}

function renderContainer() {
  const router = createMemoryRouter(
    [
      {
        path: '/workbench',
        element: (
          <ToastProvider>
            <ToastContainer />
            <ThemeProvider defaultTheme="light" storageKey="test-theme">
              <WorkbenchContainer />
            </ThemeProvider>
          </ToastProvider>
        ),
      },
    ],
    { initialEntries: ['/workbench'] }
  )
  return render(<RouterProvider router={router} />)
}

async function renderWithSavedTest() {
  act(() => {
    useWorkflowStore.getState().setEditingTest('test-456', 'Recovered Test')
  })
  renderContainer()
  await waitFor(() => {
    expect(screen.getByTestId('workflow-status')).toHaveAttribute('data-status', 'passed')
  })
}

async function renderWithUnsavedTest() {
  renderContainer()
  await waitFor(() => {
    expect(screen.getByTestId('canvas-breadcrumb')).toBeInTheDocument()
  })
}

describe('WorkbenchContainer - Test Data sheet wiring', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkflowStore.getState().reset()
    activity.value = { uploads: 0, interruptions: 0 }
    vi.clearAllMocks()
    vi.mocked(workbenchApi.getCurrentSession).mockResolvedValue(PASSED_SESSION as never)
    vi.mocked(workbenchApi.getSessionVariables).mockResolvedValue({})
    vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue({ items: [] })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: {} }) })
    )
  })

  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    cleanup()
    localStorage.clear()
    useWorkflowStore.getState().reset()
    vi.unstubAllGlobals()
  })

  it('keeps the sheet closed until the chip is clicked', async () => {
    await renderWithSavedTest()

    expect(screen.getByTestId('breadcrumb-testdata-chip')).toBeInTheDocument()
    expect(screen.queryByTestId('testdata-sheet-stub')).not.toBeInTheDocument()
  })

  it('opens the sheet from the chip with the session test id', async () => {
    const user = userEvent.setup()
    await renderWithSavedTest()

    await user.click(screen.getByTestId('breadcrumb-testdata-chip'))

    const sheet = await screen.findByTestId('testdata-sheet-stub')
    expect(sheet).toHaveAttribute('data-test-id-prop', 'test-456')
  })

  it('lends the sheet the write rule the canvas already follows (TDATA-13)', async () => {
    const user = userEvent.setup()
    await renderWithSavedTest()

    await user.click(screen.getByTestId('breadcrumb-testdata-chip'))

    const sheet = await screen.findByTestId('testdata-sheet-stub')
    expect(sheet, 'this session holds the test, so it writes').toHaveAttribute(
      'data-read-only-prop',
      'false'
    )
  })

  it('carries the chip state for the open test (TDATA-16)', async () => {
    activity.value = { uploads: 2, interruptions: 1 }
    await renderWithSavedTest()

    const state = await screen.findByTestId('breadcrumb-testdata-state')
    expect(state).toHaveAttribute('data-uploading', 'true')
    expect(state).toHaveAttribute('data-interrupted', 'true')
  })

  it('leaves the chip bare when the test has nothing going on', async () => {
    await renderWithSavedTest()

    expect(screen.queryByTestId('breadcrumb-testdata-state')).not.toBeInTheDocument()
  })

  it('mounts the sheet with a null test id for an unsaved test', async () => {
    const user = userEvent.setup()
    vi.mocked(workbenchApi.getCurrentSession).mockResolvedValue(null)
    await renderWithUnsavedTest()

    await user.click(screen.getByTestId('breadcrumb-testdata-chip'))

    const sheet = await screen.findByTestId('testdata-sheet-stub')
    expect(sheet).toHaveAttribute('data-test-id-prop', 'null')
  })

  it('re-focuses the open sheet when the chip is clicked again', async () => {
    const user = userEvent.setup()
    await renderWithSavedTest()

    const chip = screen.getByTestId('breadcrumb-testdata-chip')
    await user.click(chip)
    const sheet = await screen.findByTestId('testdata-sheet-stub')
    expect(sheetSpies.refocusSheet).not.toHaveBeenCalledWith('testdata')

    await user.click(chip)

    expect(sheetSpies.refocusSheet).toHaveBeenCalledWith('testdata')
    expect(screen.getByTestId('testdata-sheet-stub')).toBe(sheet)
  })

  it('closes the sheet from its own close handler', async () => {
    const user = userEvent.setup()
    await renderWithSavedTest()

    await user.click(screen.getByTestId('breadcrumb-testdata-chip'))
    await screen.findByTestId('testdata-sheet-stub')

    await user.click(screen.getByRole('button', { name: 'Close test data' }))

    expect(screen.queryByTestId('testdata-sheet-stub')).not.toBeInTheDocument()
  })

  it('keeps the Test Data sheet independent of the Session Artifacts sheet', async () => {
    const user = userEvent.setup()
    await renderWithSavedTest()

    await user.click(screen.getByTestId('breadcrumb-testdata-chip'))
    await screen.findByTestId('testdata-sheet-stub')

    await user.click(screen.getByTestId('breadcrumb-artifacts-chip'))

    expect(await screen.findByTestId('session-artifacts-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('testdata-sheet-stub')).toBeInTheDocument()
  })
})
