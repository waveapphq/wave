/**
 * WorkbenchContainer - artifact-guarded Reset + Session Artifacts wiring
 * (ARTIF-17, wireframe session-artifacts-wipe-dialogs).
 *
 * The container wraps resetWorkbenchRun in a single artifact-guarded handler
 * covering every Reset entry point:
 *   - count = 0: Reset is INSTANT - no dialog of any kind, the run state
 *     clears immediately.
 *   - count > 0: ONE destructive "Reset Session?" ConfirmationDialog appears
 *     with the artifact-loss callout; Cancel aborts (nothing cleared),
 *     Reset proceeds.
 * It also mounts the Session Artifacts chip + sheet (ARTIF-14/15).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { WorkbenchContainer } from '@/features/workbench/live'
import { ThemeProvider } from '@/design-system/theme-provider'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { workbenchApi } from '@/features/workbench/api/workbench'

// Lightweight apiClient over the global fetch mock (full Response objects are
// not needed) - mirrors the workbench-page test harness.
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
  session_id: 'sess-artifacts-1',
  status: 'passed',
  test_id: 'test-456',
  websocket_topic: 'workbench:sess-artifacts-1',
  block_states: {},
}

const TWO_ITEMS = {
  items: [
    { path: 'output/data.json', size_bytes: 2048, created_at: '2026-07-02T10:00:00+00:00' },
    { path: 'report.json', size_bytes: 1024, created_at: '2026-07-02T10:00:01+00:00' },
  ],
}

const RESET_CALLOUT_RE = /session artifacts? will be permanently deleted/

function renderContainer() {
  const router = createMemoryRouter(
    [
      {
        path: '/workbench',
        element: (
          <ToastProvider>
            <ToastContainer />
            <ThemeProvider defaultTheme="light" storageKey="test-theme">
              <>
                <WorkbenchContainer />
              </>
            </ThemeProvider>
          </ToastProvider>
        ),
      },
      { path: '/executions/:executionId', element: <div>Execution detail</div> },
    ],
    { initialEntries: ['/workbench'] }
  )
  return { ...render(<RouterProvider router={router} />), router }
}

async function renderWithPassedSession() {
  act(() => {
    useWorkflowStore.getState().setEditingTest('test-456', 'Recovered Test')
  })
  renderContainer()
  await waitFor(() => {
    expect(screen.getByTestId('workflow-status')).toHaveAttribute('data-status', 'passed')
  })
  await waitFor(() => {
    expect(workbenchApi.listSessionArtifacts).toHaveBeenCalled()
  })
}

describe('WorkbenchContainer - artifact-guarded Reset', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkflowStore.getState().reset()
    vi.clearAllMocks()
    vi.mocked(workbenchApi.getCurrentSession).mockResolvedValue(
      PASSED_SESSION as never
    )
    vi.mocked(workbenchApi.clearSession).mockResolvedValue({ cleared: true })
    vi.mocked(workbenchApi.getSessionVariables).mockResolvedValue({})
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

  it('resets instantly with no dialog when the session holds no artifacts', async () => {
    const user = userEvent.setup()
    vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue({ items: [] })
    await renderWithPassedSession()

    await user.click(screen.getByTestId('breadcrumb-reset-link'))

    await waitFor(() => {
      expect(screen.getByTestId('workflow-status')).toHaveAttribute('data-status', 'idle')
    })
    expect(workbenchApi.clearSession).toHaveBeenCalled()
    // Instant means instant: no Reset Session confirm and no Reset Workflow dialog.
    expect(screen.queryByText('Reset Session?')).not.toBeInTheDocument()
    expect(screen.queryByText('Reset Workflow?')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('opens a single Reset Session confirmation with the callout when artifacts exist', async () => {
    const user = userEvent.setup()
    vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue(TWO_ITEMS)
    await renderWithPassedSession()

    await user.click(screen.getByTestId('breadcrumb-reset-link'))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Reset Session?')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Resetting clears the run state from the canvas and empties the console.'
      )
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('2 session artifacts will be permanently deleted.')
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('Download anything you need from the Artifacts panel first.')
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    // ONE dialog: no Reset Workflow confirm stacks before it.
    expect(screen.queryByText('Reset Workflow?')).not.toBeInTheDocument()
  })

  it('cancel aborts the reset - run state and session are kept', async () => {
    const user = userEvent.setup()
    vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue(TWO_ITEMS)
    await renderWithPassedSession()

    await user.click(screen.getByTestId('breadcrumb-reset-link'))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('workflow-status')).toHaveAttribute('data-status', 'passed')
    expect(workbenchApi.clearSession).not.toHaveBeenCalled()
  })

  it('confirming Reset proceeds with the reset', async () => {
    const user = userEvent.setup()
    vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue(TWO_ITEMS)
    await renderWithPassedSession()

    await user.click(screen.getByTestId('breadcrumb-reset-link'))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Reset' }))

    await waitFor(() => {
      expect(screen.getByTestId('workflow-status')).toHaveAttribute('data-status', 'idle')
    })
    expect(workbenchApi.clearSession).toHaveBeenCalled()
    expect(screen.queryByText(RESET_CALLOUT_RE)).not.toBeInTheDocument()
  })
})

describe('WorkbenchContainer - Session Artifacts chip + sheet wiring (ARTIF-14/15)', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkflowStore.getState().reset()
    vi.clearAllMocks()
    vi.mocked(workbenchApi.getCurrentSession).mockResolvedValue(PASSED_SESSION as never)
    vi.mocked(workbenchApi.clearSession).mockResolvedValue({ cleared: true })
    vi.mocked(workbenchApi.getSessionVariables).mockResolvedValue({})
    vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue(TWO_ITEMS)
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

  it('shows the chip with the fetched count and opens the sheet on click', async () => {
    const user = userEvent.setup()
    await renderWithPassedSession()

    const chip = screen.getByRole('button', { name: 'Session artifacts' })
    await waitFor(() => {
      expect(within(chip).getByText('2')).toBeInTheDocument()
    })

    await user.click(chip)

    const sheet = await screen.findByTestId('session-artifacts-sheet')
    expect(within(sheet).getByText('report.json')).toBeInTheDocument()
    expect(within(sheet).getByText('data.json')).toBeInTheDocument()
  })

  it('re-clicking the chip while the sheet is open pulses it instead of a no-op (refocusSheet)', async () => {
    const user = userEvent.setup()
    await renderWithPassedSession()

    const chip = screen.getByRole('button', { name: 'Session artifacts' })
    await user.click(chip)
    const sheet = await screen.findByTestId('session-artifacts-sheet')
    expect(sheet.className).not.toMatch(/animate-sheet-select-pulse/)

    await user.click(chip)

    expect(screen.getByTestId('session-artifacts-sheet')).toBe(sheet)
    expect(sheet.className).toMatch(/animate-sheet-select-pulse/)
  })

  it('wires sheet refresh / download / delete to the api and closes via the header button', async () => {
    const user = userEvent.setup()
    await renderWithPassedSession()

    await user.click(screen.getByRole('button', { name: 'Session artifacts' }))
    const sheet = await screen.findByTestId('session-artifacts-sheet')
    const callsAfterOpen = vi.mocked(workbenchApi.listSessionArtifacts).mock.calls.length

    await user.click(within(sheet).getByRole('button', { name: 'Refresh artifacts' }))
    await waitFor(() => {
      expect(vi.mocked(workbenchApi.listSessionArtifacts).mock.calls.length).toBe(
        callsAfterOpen + 1
      )
    })

    await user.click(within(sheet).getByRole('button', { name: 'Download data.json' }))
    expect(workbenchApi.downloadSessionArtifact).toHaveBeenCalledWith('output/data.json')

    await user.click(within(sheet).getByRole('button', { name: 'Delete report.json' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    )
    await waitFor(() => {
      expect(workbenchApi.deleteSessionArtifact).toHaveBeenCalledWith('report.json')
    })

    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('session-artifacts-sheet')).not.toBeInTheDocument()
  })

  it('reports a download that failed', async () => {
    const user = userEvent.setup()
    vi.mocked(workbenchApi.downloadSessionArtifact).mockRejectedValueOnce(
      new Error('File is gone')
    )
    await renderWithPassedSession()

    await user.click(screen.getByRole('button', { name: 'Session artifacts' }))
    const sheet = await screen.findByTestId('session-artifacts-sheet')
    await user.click(within(sheet).getByRole('button', { name: 'Download data.json' }))

    expect(await screen.findByText('Download Failed')).toBeInTheDocument()
    expect(screen.getByText('File is gone')).toBeInTheDocument()
  })

  it('reports a delete that failed and leaves the file on the list', async () => {
    const user = userEvent.setup()
    vi.mocked(workbenchApi.deleteSessionArtifact).mockRejectedValueOnce(
      new Error('Artifact is locked')
    )
    await renderWithPassedSession()

    await user.click(screen.getByRole('button', { name: 'Session artifacts' }))
    const sheet = await screen.findByTestId('session-artifacts-sheet')
    const callsAfterOpen = vi.mocked(workbenchApi.listSessionArtifacts).mock.calls.length

    await user.click(within(sheet).getByRole('button', { name: 'Delete report.json' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    )

    expect(await screen.findByText('Delete Failed')).toBeInTheDocument()
    expect(
      screen.getByText('The file is still in the session: Artifact is locked')
    ).toBeInTheDocument()
    // The list is read again, so the row the delete did not remove is still there.
    expect(vi.mocked(workbenchApi.listSessionArtifacts).mock.calls.length).toBe(
      callsAfterOpen + 1
    )
    expect(within(sheet).getByText('report.json')).toBeInTheDocument()
  })
})

describe('WorkbenchContainer - tracked session gating', () => {
  const TRACKED_RUNNING_SESSION = {
    session_id: 'sess-tracked-1',
    status: 'running',
    test_id: 'test-456',
    websocket_topic: 'workbench:sess-tracked-1',
    execution_id: 'exec-tracked-1',
    block_states: {},
  }

  beforeEach(() => {
    localStorage.clear()
    useWorkflowStore.getState().reset()
    vi.clearAllMocks()
    vi.mocked(workbenchApi.getCurrentSession).mockResolvedValue(
      TRACKED_RUNNING_SESSION as never
    )
    vi.mocked(workbenchApi.getSessionVariables).mockResolvedValue({})
    vi.mocked(workbenchApi.listSessionArtifacts).mockResolvedValue(TWO_ITEMS)
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

  it('keeps the chip badge but hides per-row delete in the sheet', async () => {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.getState().setEditingTest('test-456', 'Recovered Test')
    })
    renderContainer()
    await waitFor(() => {
      expect(screen.getByTestId('workflow-status')).toHaveAttribute('data-status', 'running')
    })
    await waitFor(() => {
      expect(workbenchApi.listSessionArtifacts).toHaveBeenCalled()
    })

    const chip = screen.getByRole('button', { name: 'Session artifacts' })
    await waitFor(() => {
      expect(within(chip).getByText('2')).toBeInTheDocument()
    })

    await user.click(chip)
    const sheet = await screen.findByTestId('session-artifacts-sheet')
    expect(within(sheet).getByRole('button', { name: 'Download report.json' })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument()
  })

  it('closes the test, clears the session and opens the execution when a tracked run has finished', async () => {
    vi.mocked(workbenchApi.getCurrentSession).mockResolvedValue({
      ...TRACKED_RUNNING_SESSION,
      status: 'passed',
      execution_id: 'exec-tracked-done',
    } as never)
    vi.mocked(workbenchApi.clearSession).mockResolvedValue({ cleared: true })
    act(() => {
      useWorkflowStore.getState().setEditingTest('test-456', 'Recovered Test')
    })

    const { router } = renderContainer()

    expect(await screen.findByText('Execution detail')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/executions/exec-tracked-done')
    expect(workbenchApi.clearSession).toHaveBeenCalledTimes(1)
    expect(useWorkflowStore.getState().editingTestId).toBeNull()
  })
})
