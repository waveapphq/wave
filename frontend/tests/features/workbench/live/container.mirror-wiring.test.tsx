/**
 * WorkbenchContainer - session-ownership wiring (SESS-1..8).
 *
 * The container composes useSessionOwnership into the workbench chrome:
 * mirror banner below the breadcrumb, read-only canvas + locked toolbar while
 * mirroring, take-over dialogs, the holder-side "N watching" pill, the
 * throttled holder draft stream, the forced-take-over toast, the
 * See connection deep-link to /settings/mcp, and the environment an
 * assistant's run leaves in the picker.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { WorkbenchContainer } from '@/features/workbench/live'
import { ThemeProvider } from '@/design-system/theme-provider'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { fetchTest, fetchTestWorkflow } from '@/features/tests/api/crud'
import type { SessionOwnership } from '@/features/workbench/hooks/use-session-ownership'
import type { MirroredRun } from '@/features/workbench/api/ownership'
import { usePageBlockStore } from '@/stores/page-block-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'
import { workbenchApi } from '@/features/workbench/api/workbench'
import { fetchEnvironmentNames } from '@/features/settings/api/environments/crud'
import { STORAGE_KEYS } from '@/hooks/use-canvas-state'

// Lightweight apiClient over the global fetch mock - mirrors the
// container.reset-guard harness.
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
  updateTestMetadata: vi.fn(),
  updateTest: vi.fn(),
  createTest: vi.fn(),
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
    { id: 'b2c3d4e5-f6a7-4b5c-9d8e-0f1a2b3c4d5e', name: 'Lab', tags: [] },
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

// Controllable session-ownership state per test.
const { ownershipState } = vi.hoisted(() => ({
  ownershipState: { current: {} as Record<string, unknown> },
}))
vi.mock('@/features/workbench/hooks/use-session-ownership', () => ({
  useSessionOwnership: () => ownershipState.current,
}))

// react-resizable-panels does not work in jsdom.
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}))

function idleOwnership(): SessionOwnership {
  return {
    isHolder: false,
    isMirroring: false,
    holderLabel: null,
    holderKind: null,
    mcpSessionId: null,
    browserSessionId: null,
    mirroredRun: null,
    watchKind: null,
    browsingAway: false,
    browseAway: vi.fn(),
    rejoinMirror: vi.fn(),
    inheritRefreshTick: 0,
    watchers: 0,
    pendingTakeover: null,
    isRequestingTakeover: false,
    takeoverResult: null,
    dismissTakeoverResult: vi.fn(),
    takeOver: vi.fn(),
    forceTakeOver: vi.fn(),
    approve: vi.fn(),
    deny: vi.fn(),
    cancelRequest: vi.fn(),
    pushDraft: vi.fn(),
  }
}

function setOwnership(overrides: Partial<SessionOwnership>): SessionOwnership {
  const state = { ...idleOwnership(), ...overrides }
  ownershipState.current = state as unknown as Record<string, unknown>
  return state
}

function renderContainer(initialEntry = '/workbench') {
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
      { path: '/settings/mcp', element: <div data-testid="settings-mcp-route" /> },
      { path: '/settings/server', element: <div data-testid="settings-server-route" /> },
    ],
    { initialEntries: [initialEntry] }
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('WorkbenchContainer - session ownership wiring', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkflowStore.getState().reset()
    vi.clearAllMocks()
    setOwnership({})
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

  describe('mirroring', () => {
    it('shows the indigo person banner, locks the toolbar, and makes the canvas read-only', async () => {
      setOwnership({ isMirroring: true, holderLabel: 'Chrome (macOS)', holderKind: 'person' })
      renderContainer()

      const banner = await screen.findByTestId('mirror-banner')
      expect(banner).toHaveAttribute('data-holder-kind', 'person')
      expect(banner).toHaveTextContent('another session on Chrome (macOS)')
      expect(screen.getByRole('button', { name: 'See Connection' })).toBeInTheDocument()

      expect(screen.getByTestId('workflow-canvas')).toHaveAttribute('data-readonly', 'true')
      expect(screen.getByTestId('toolbar-save-button')).toBeDisabled()
      expect(screen.getByTestId('toolbar-undo-button')).toBeDisabled()
      expect(screen.getByTestId('toolbar-redo-button')).toBeDisabled()
      expect(screen.getByTestId('run-button')).toBeDisabled()
    })

    it('defaults an unknown holder kind to the generic person banner', async () => {
      setOwnership({ isMirroring: true, holderLabel: null, holderKind: null })
      renderContainer()

      const banner = await screen.findByTestId('mirror-banner')
      expect(banner).toHaveAttribute('data-holder-kind', 'person')
      expect(banner).toHaveTextContent('another session')
    })

    it('wires Take Over on the banner to the ownership action', async () => {
      const user = userEvent.setup()
      const state = setOwnership({ isMirroring: true, holderLabel: 'Ashley', holderKind: 'person' })
      renderContainer()

      await user.click(await screen.findByRole('button', { name: 'Take Over' }))

      expect(state.takeOver).toHaveBeenCalledTimes(1)
    })

    it('See Connection on an MCP banner deep-links to the session in settings', async () => {
      const user = userEvent.setup()
      setOwnership({
        isMirroring: true,
        holderLabel: 'Claude Code (MCP)',
        holderKind: 'mcp',
        mcpSessionId: 'sess-9',
      })
      const router = renderContainer()

      const banner = await screen.findByTestId('mirror-banner')
      expect(banner).toHaveAttribute('data-holder-kind', 'mcp')
      await user.click(screen.getByRole('button', { name: 'See Connection' }))

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/settings/mcp')
      })
      expect(router.state.location.search).toBe('?session=sess-9')
    })

    it('See Connection falls back to an empty session param when the id is unknown', async () => {
      const user = userEvent.setup()
      setOwnership({
        isMirroring: true,
        holderLabel: 'Claude Code (MCP)',
        holderKind: 'mcp',
        mcpSessionId: null,
      })
      const router = renderContainer()

      await screen.findByTestId('mirror-banner')
      await user.click(screen.getByRole('button', { name: 'See Connection' }))

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/settings/mcp')
      })
      expect(router.state.location.search).toBe('?session=')
    })

    it('See Connection on a person banner deep-links to the browser session in server settings', async () => {
      const user = userEvent.setup()
      setOwnership({
        isMirroring: true,
        holderLabel: 'Chrome (macOS)',
        holderKind: 'person',
        browserSessionId: 'sess-p',
      })
      const router = renderContainer()

      const banner = await screen.findByTestId('mirror-banner')
      expect(banner).toHaveAttribute('data-holder-kind', 'person')
      await user.click(screen.getByRole('button', { name: 'See Connection' }))

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/settings/server')
      })
      expect(router.state.location.search).toContain('session=sess-p')
    })

    it('See Connection on a person banner falls back to an empty session param when the id is unknown', async () => {
      const user = userEvent.setup()
      setOwnership({
        isMirroring: true,
        holderLabel: 'Chrome (macOS)',
        holderKind: 'person',
        browserSessionId: null,
      })
      const router = renderContainer()

      await screen.findByTestId('mirror-banner')
      await user.click(screen.getByRole('button', { name: 'See Connection' }))

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/settings/server')
      })
      expect(router.state.location.search).toBe('?session=')
    })

    it('shows Follow Changes on an MCP watch banner and toggles it', async () => {
      const user = userEvent.setup()
      setOwnership({
        isMirroring: true,
        holderLabel: 'Claude Code (MCP)',
        holderKind: 'mcp',
        mcpSessionId: 'sess-1',
      })
      renderContainer()

      const follow = await screen.findByTestId('mirror-follow-changes-button')
      expect(follow).toHaveTextContent('Follow Changes')

      await user.click(follow)
      expect(screen.getByTestId('mirror-follow-changes-button')).toHaveTextContent('Stop Following')

      await user.click(screen.getByTestId('mirror-follow-changes-button'))
      expect(screen.getByTestId('mirror-follow-changes-button')).toHaveTextContent('Follow Changes')
    })

    it("names an assistant's watched change on the banner", async () => {
      setOwnership({
        isMirroring: true,
        holderLabel: 'Claude Code (MCP)',
        holderKind: 'mcp',
        mcpSessionId: 'sess-1',
        watchKind: 'change',
      })
      renderContainer()

      expect(await screen.findByTestId('mirror-banner')).toHaveTextContent('read-only, changing live')
    })

    it('also shows Follow Changes on a person watch banner (two-tab mirroring)', async () => {
      const user = userEvent.setup()
      setOwnership({ isMirroring: true, holderLabel: 'Ashley', holderKind: 'person' })
      renderContainer()

      const follow = await screen.findByTestId('mirror-follow-changes-button')
      expect(follow).toHaveTextContent('Follow Changes')

      await user.click(follow)
      expect(screen.getByTestId('mirror-follow-changes-button')).toHaveTextContent('Stop Following')
    })

    it('renders no banner and an editable canvas when nobody mirrors', async () => {
      setOwnership({})
      renderContainer()

      await screen.findByTestId('workflow-canvas')
      expect(screen.queryByTestId('mirror-banner')).not.toBeInTheDocument()
      expect(screen.getByTestId('workflow-canvas')).not.toHaveAttribute('data-readonly')
    })
  })

  describe('free browsing', () => {
    it('renders the browsing banner with Watch Session and without Follow Changes', async () => {
      setOwnership({
        isMirroring: true,
        holderLabel: 'Chrome (macOS)',
        holderKind: 'person',
        browsingAway: true,
      })
      renderContainer()

      const banner = await screen.findByTestId('mirror-banner')
      expect(banner).toHaveTextContent('Read-only')
      expect(banner).toHaveTextContent('another session on Chrome (macOS) holds the workbench')
      expect(screen.getByTestId('mirror-watch-session-button')).toBeInTheDocument()
      expect(screen.queryByTestId('mirror-follow-changes-button')).not.toBeInTheDocument()
    })

    it('a watching tab renders the mirrored-run toolbar state', async () => {
      setOwnership({
        isMirroring: true,
        holderLabel: 'Claude Code (MCP)',
        holderKind: 'mcp',
        mirroredRun: {
          sessionId: 'run-1',
          testId: 'test-1',
          testName: 'Nightly Smoke',
          environmentId: 'env-1',
          environmentName: 'Staging',
          status: 'running',
        },
      })
      renderContainer()

      const readout = await screen.findByTestId('environment-selector')
      expect(readout).toHaveTextContent('Staging')
      expect(readout).toBeDisabled()
      expect(screen.getByTestId('action-focus-current-button')).toBeInTheDocument()
      expect(screen.queryByTestId('run-button')).not.toBeInTheDocument()
    })

    describe('an announced run starting in this tab (RUNM-11)', () => {
      const RUN = {
        sessionId: 'run-1',
        testId: 'test-1',
        testName: 'Nightly Smoke',
        environmentId: 'env-1',
        environmentName: 'Staging',
        status: 'running' as const,
      }
      const realRequestFitView = useWorkflowStore.getState().requestFitView
      const requestFitView = vi.fn()

      beforeEach(() => {
        useWorkflowStore.setState({ requestFitView })
      })

      afterEach(() => {
        // The container is still mounted here: the store change re-renders it.
        act(() => {
          useWorkflowStore.setState({ requestFitView: realRequestFitView })
        })
      })

      it("fits the whole test for the assistant's run, as the canvas's own Fit View does", async () => {
        setOwnership({ isMirroring: true, holderLabel: 'Claude Code (MCP)', holderKind: 'mcp', mirroredRun: RUN })
        renderContainer()

        await screen.findByTestId('environment-selector')
        expect(requestFitView).toHaveBeenCalledWith()
      })

      it("leaves the view alone for a person's run", async () => {
        setOwnership({ isMirroring: true, holderLabel: 'Ashley', holderKind: 'person', mirroredRun: RUN })
        renderContainer()

        await screen.findByTestId('environment-selector')
        expect(requestFitView).not.toHaveBeenCalledWith()
      })
    })

    it('hints at the announced run while browsing', async () => {
      setOwnership({
        isMirroring: true,
        holderLabel: 'Claude Code (MCP)',
        holderKind: 'mcp',
        browsingAway: true,
        mirroredRun: {
          sessionId: 'run-1',
          testId: 'test-1',
          testName: 'Nightly Smoke',
          environmentId: null,
          environmentName: null,
          status: 'running',
        },
      })
      renderContainer()

      const banner = await screen.findByTestId('mirror-banner')
      expect(banner).toHaveTextContent('Claude Code (MCP) is running a test in the workbench')
    })

    it('Watch Session rejoins the mirror', async () => {
      const user = userEvent.setup()
      const state = setOwnership({
        isMirroring: true,
        holderLabel: 'Ashley',
        holderKind: 'person',
        browsingAway: true,
      })
      renderContainer()

      await user.click(await screen.findByTestId('mirror-watch-session-button'))

      expect(state.rejoinMirror).toHaveBeenCalledTimes(1)
    })

    it('Watch Session from a browsed Library View drops back to the plain workbench URL', async () => {
      const user = userEvent.setup()
      const state = setOwnership({
        isMirroring: true,
        holderLabel: 'Ashley',
        holderKind: 'person',
        browsingAway: true,
      })
      act(() => {
        useWorkflowStore
          .getState()
          .enterFunctionView({ functionId: 'fn-1', version: '1.0.0', editable: false })
      })
      const router = renderContainer()

      await user.click(await screen.findByTestId('mirror-watch-session-button'))

      expect(state.rejoinMirror).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/workbench')
        expect(router.state.location.search).toBe('')
      })
    })

    it('an explicit ?editTest navigation browses away', async () => {
      const state = setOwnership({
        isMirroring: true,
        holderLabel: 'Ashley',
        holderKind: 'person',
      })
      renderContainer('/workbench?editTest=test-456')

      await waitFor(() => {
        expect(state.browseAway).toHaveBeenCalled()
      })
    })

    it('never browses away without an explicit navigation', async () => {
      const state = setOwnership({
        isMirroring: true,
        holderLabel: 'Ashley',
        holderKind: 'person',
      })
      renderContainer()

      await screen.findByTestId('mirror-banner')
      expect(state.browseAway).not.toHaveBeenCalled()
    })

    it('closing the open test while mirroring browses away', async () => {
      const user = userEvent.setup()
      const state = setOwnership({
        isMirroring: true,
        holderLabel: 'Ashley',
        holderKind: 'person',
      })
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-456', 'Recovered Test')
      })
      renderContainer()

      const close = await screen.findByTestId('toolbar-close-button')
      await waitFor(() => {
        expect(close).toBeEnabled()
      })
      await user.click(close)

      await waitFor(() => {
        expect(state.browseAway).toHaveBeenCalled()
      })
    })

    it('a holder closing its test never browses away', async () => {
      const user = userEvent.setup()
      const state = setOwnership({ isHolder: true })
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-456', 'Recovered Test')
      })
      renderContainer()

      const close = await screen.findByTestId('toolbar-close-button')
      await waitFor(() => {
        expect(close).toBeEnabled()
      })
      await user.click(close)

      expect(state.browseAway).not.toHaveBeenCalled()
    })
  })

  describe('the suites of the test a watching tab is shown', () => {
    const RECOVERED_TEST = {
      id: 'test-456',
      name: 'Recovered Test',
      description: '',
      tags: [],
      suite: null,
      workflow: { nodes: [], edges: [] },
    }
    const CHECKOUT = {
      ...RECOVERED_TEST,
      id: 'test-7',
      name: 'Checkout Flow',
      suite_ids: ['suite-1'],
      suite_variables: [{ name: 'base_url', type: 'string' }],
      regression_variables: [{ name: 'region', type: 'string' }],
    }
    const SIGNUP = {
      ...RECOVERED_TEST,
      id: 'test-8',
      name: 'Signup',
      suite_ids: ['suite-2'],
      suite_variables: [{ name: 'signup_url', type: 'string' }],
      regression_variables: [],
    }
    const WATCHING_ASSISTANT = { isMirroring: true, holderLabel: 'Claude Code (MCP)', holderKind: 'mcp' as const }

    afterEach(() => {
      vi.mocked(fetchTest).mockReset().mockResolvedValue(RECOVERED_TEST as never)
      act(() => {
        usePageBlockStore.getState().clearBlock()
      })
    })

    const MIRRORED_BLOCK = { id: 'mirrored-1', type: 'log', position: { x: 0, y: 0 }, data: { label: 'Log' } }

    /** What a frame does to the store: its Blocks land, then the canvas takes its test. */
    function showTest(testId: string | null, testName: string | null) {
      act(() => {
        const store = useWorkflowStore.getState()
        store.applyMirroredGraph({ nodes: [MIRRORED_BLOCK] as never, edges: [], variables: [] })
        store.setEditingTest(testId, testName)
      })
    }

    function readsOf(testId: string): number {
      return vi.mocked(fetchTest).mock.calls.filter(([id]) => id === testId).length
    }

    it('reads the suites and suite variables of a test a frame switches it to, as opening the test does', async () => {
      vi.mocked(fetchTest).mockResolvedValue(CHECKOUT as never)
      setOwnership(WATCHING_ASSISTANT)
      renderContainer()
      await screen.findByTestId('mirror-banner')

      showTest('test-7', 'Checkout Flow')

      await waitFor(() => {
        expect(useWorkflowStore.getState().editingTestSuiteIds).toEqual(['suite-1'])
      })
      const { namespaceVariables } = useWorkflowStore.getState()
      expect(namespaceVariables.suite).toEqual([{ name: 'base_url', type: 'string' }])
      expect(namespaceVariables.regression).toEqual([{ name: 'region', type: 'string' }])
      expect(readsOf('test-7')).toBe(1)
    })

    it('clears the suites when a frame switches it to an unsaved draft', async () => {
      showTest('test-x', 'Login')
      act(() => {
        const store = useWorkflowStore.getState()
        store.setEditingTestSuiteIds(['suite-x'])
        store.setNamespaceVariables('suite', [{ name: 'login_url', type: 'string' }])
        store.setNamespaceVariables('regression', [{ name: 'tenant', type: 'string' }])
      })
      setOwnership(WATCHING_ASSISTANT)
      renderContainer()
      await screen.findByTestId('mirror-banner')

      showTest(null, null)

      await waitFor(() => {
        expect(useWorkflowStore.getState().editingTestSuiteIds).toEqual([])
      })
      const { namespaceVariables } = useWorkflowStore.getState()
      expect(namespaceVariables.suite).toEqual([])
      expect(namespaceVariables.regression).toEqual([])
    })

    it('blocks the workbench with the retry card when the read fails, and the retry applies the suites', async () => {
      vi.mocked(fetchTest).mockRejectedValueOnce(new Error('Service Unavailable'))
      vi.mocked(fetchTest).mockResolvedValue(CHECKOUT as never)
      setOwnership(WATCHING_ASSISTANT)
      renderContainer()
      await screen.findByTestId('mirror-banner')

      showTest('test-7', 'Checkout Flow')

      await waitFor(() => {
        expect(usePageBlockStore.getState().block?.title).toBe('Could not load suite variables')
      })
      expect(useWorkflowStore.getState().editingTestSuiteIds).toEqual([])

      await act(async () => {
        await usePageBlockStore.getState().block?.retry()
      })

      expect(useWorkflowStore.getState().editingTestSuiteIds).toEqual(['suite-1'])
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('keeps the suites of the latest test when an earlier read answers last', async () => {
      let answerCheckout: (value: unknown) => void = () => {}
      vi.mocked(fetchTest).mockImplementation((testId: string) => {
        if (testId === 'test-7') {
          return new Promise((resolve) => {
            answerCheckout = resolve
          }) as never
        }
        return Promise.resolve(SIGNUP as never)
      })
      setOwnership(WATCHING_ASSISTANT)
      renderContainer()
      await screen.findByTestId('mirror-banner')

      showTest('test-7', 'Checkout Flow')
      showTest('test-8', 'Signup')
      await waitFor(() => {
        expect(useWorkflowStore.getState().editingTestSuiteIds).toEqual(['suite-2'])
      })
      await act(async () => {
        answerCheckout(CHECKOUT)
        await Promise.resolve()
      })

      expect(useWorkflowStore.getState().editingTestSuiteIds).toEqual(['suite-2'])
      expect(useWorkflowStore.getState().namespaceVariables.suite).toEqual([
        { name: 'signup_url', type: 'string' },
      ])
    })

    function notFound() {
      return Object.assign(new Error('Test not found'), { status: 404 })
    }

    /** A watching tab that showed Login, with its suites, before a frame switches it to Checkout. */
    async function watchLoginThenCheckout() {
      showTest('test-x', 'Login')
      act(() => {
        const store = useWorkflowStore.getState()
        store.setEditingTestSuiteIds(['suite-x'])
        store.setNamespaceVariables('suite', [{ name: 'login_url', type: 'string' }])
        store.setNamespaceVariables('regression', [{ name: 'tenant', type: 'string' }])
      })
      setOwnership(WATCHING_ASSISTANT)
      renderContainer()
      await screen.findByTestId('mirror-banner')
      showTest('test-7', 'Checkout Flow')
    }

    function expectSuitesDropped() {
      const { editingTestSuiteIds, namespaceVariables } = useWorkflowStore.getState()
      expect(editingTestSuiteIds).toEqual([])
      expect(namespaceVariables.suite).toEqual([])
      expect(namespaceVariables.regression).toEqual([])
    }

    it('drops the suites of a watched test that is gone, shows no dialog, and keeps mirroring', async () => {
      vi.mocked(fetchTest).mockRejectedValue(notFound())

      await watchLoginThenCheckout()

      await waitFor(() => {
        expect(useWorkflowStore.getState().editingTestSuiteIds).toEqual([])
      })
      expectSuitesDropped()
      expect(useDeletedTestStore.getState().info).toBeNull()
      expect(screen.queryByTestId('deleted-test-modal')).not.toBeInTheDocument()
      expect(usePageBlockStore.getState().block).toBeNull()

      // The next frames still land on the watched test, with no new read.
      showTest('test-7', 'Checkout Flow')
      showTest('test-7', 'Checkout Flow')
      expect(useWorkflowStore.getState().editingTestId).toBe('test-7')
      expect(useWorkflowStore.getState().nodes.map((node) => node.id)).toEqual(['mirrored-1'])
      expect(screen.getByTestId('mirror-banner')).toBeInTheDocument()
      expect(screen.queryByTestId('deleted-test-modal')).not.toBeInTheDocument()
      expect(readsOf('test-7')).toBe(1)
    })

    it('closes the retry card when the retry finds the watched test gone, and never clears the run session', async () => {
      vi.mocked(fetchTest).mockRejectedValueOnce(new Error('Service Unavailable'))
      vi.mocked(fetchTest).mockRejectedValue(notFound())
      await watchLoginThenCheckout()
      await waitFor(() => {
        expect(usePageBlockStore.getState().block?.title).toBe('Could not load suite variables')
      })

      let retryFailure: unknown = null
      await act(async () => {
        await usePageBlockStore.getState().block?.retry().catch((error: unknown) => { retryFailure = error })
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })

      expect(retryFailure).toBeNull()
      expect(usePageBlockStore.getState().block).toBeNull()
      expectSuitesDropped()
      expect(screen.queryByTestId('deleted-test-modal')).not.toBeInTheDocument()
      expect(vi.mocked(workbenchApi.clearSession)).not.toHaveBeenCalled()
      expect(vi.mocked(workbenchApi.stopRun)).not.toHaveBeenCalled()
    })

    it('a holder whose open test is gone gets the deleted-test dialog once', async () => {
      vi.mocked(fetchTest).mockRejectedValue(notFound())
      setOwnership({ isHolder: true })
      act(() => {
        const store = useWorkflowStore.getState()
        store.setNodes([MIRRORED_BLOCK] as never, { skipDirty: true })
        store.setEditingTest('test-7', 'Checkout Flow')
      })
      const router = renderContainer()
      await screen.findByTestId('workflow-canvas')

      await act(async () => {
        await router.navigate('/workbench?from=suite')
      })

      expect(await screen.findByTestId('deleted-test-modal')).toHaveTextContent('"Checkout Flow"')
      await userEvent.click(screen.getByRole('button', { name: 'Close' }))
      await waitFor(() => {
        expect(screen.queryByTestId('deleted-test-modal')).not.toBeInTheDocument()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(screen.queryByTestId('deleted-test-modal')).not.toBeInTheDocument()
      expect(readsOf('test-7')).toBe(1)
      expect(vi.mocked(workbenchApi.clearSession)).toHaveBeenCalled()
    })

    it("a browsing tab's Close on the deleted-test dialog never clears the run session on the server", async () => {
      vi.mocked(fetchTest).mockRejectedValue(notFound())
      setOwnership({ ...WATCHING_ASSISTANT, browsingAway: true })
      act(() => {
        const store = useWorkflowStore.getState()
        store.setNodes([MIRRORED_BLOCK] as never, { skipDirty: true })
        store.setEditingTest('test-7', 'Checkout Flow')
      })
      const router = renderContainer()
      await screen.findByTestId('mirror-banner')
      await act(async () => {
        await router.navigate('/workbench?from=suite')
      })
      expect(await screen.findByTestId('deleted-test-modal')).toHaveTextContent('"Checkout Flow"')

      await userEvent.click(screen.getByRole('button', { name: 'Close' }))
      await waitFor(() => {
        expect(screen.queryByTestId('deleted-test-modal')).not.toBeInTheDocument()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })

      expect(vi.mocked(workbenchApi.clearSession)).not.toHaveBeenCalled()
      expect(vi.mocked(workbenchApi.stopRun)).not.toHaveBeenCalled()
    })

    it('raises nothing when a test it has already moved past turns out to be gone', async () => {
      let failCheckout: (reason: unknown) => void = () => {}
      vi.mocked(fetchTest).mockImplementation((testId: string) => {
        if (testId === 'test-7') {
          return new Promise((_, reject) => {
            failCheckout = reject
          }) as never
        }
        return Promise.resolve(SIGNUP as never)
      })
      setOwnership(WATCHING_ASSISTANT)
      renderContainer()
      await screen.findByTestId('mirror-banner')

      showTest('test-7', 'Checkout Flow')
      showTest('test-8', 'Signup')
      await waitFor(() => {
        expect(useWorkflowStore.getState().editingTestSuiteIds).toEqual(['suite-2'])
      })
      await act(async () => {
        failCheckout(notFound())
        await Promise.resolve()
      })

      expect(useDeletedTestStore.getState().info).toBeNull()
      expect(screen.queryByTestId('deleted-test-modal')).not.toBeInTheDocument()
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('reads nothing for the test it already shows when it starts watching', async () => {
      showTest('test-x', 'Login')
      setOwnership(WATCHING_ASSISTANT)
      renderContainer()
      await screen.findByTestId('mirror-banner')

      expect(readsOf('test-x')).toBe(0)
    })

    it('reads nothing while the watcher browses: opening a test reads its own suites', async () => {
      setOwnership({ ...WATCHING_ASSISTANT, browsingAway: true })
      renderContainer()
      await screen.findByTestId('mirror-banner')

      showTest('test-7', 'Checkout Flow')

      expect(readsOf('test-7')).toBe(0)
    })

    it('reads nothing for the holder, whose own open and save set its suites', async () => {
      setOwnership({ isHolder: true })
      renderContainer()
      await screen.findByTestId('workflow-canvas')

      showTest('test-7', 'Checkout Flow')

      expect(readsOf('test-7')).toBe(0)
    })
  })

  describe('write-borrow refresh', () => {
    it('re-converges the open test on storage when the slot returns from a write-only borrow', async () => {
      setOwnership({ isHolder: true })
      act(() => {
        useWorkflowStore.getState().setEditingTest('test-456', 'Stale Name')
      })
      renderContainer()
      await screen.findByTestId('workflow-canvas')
      vi.mocked(fetchTest).mockClear()

      act(() => {
        setOwnership({ isHolder: true, inheritRefreshTick: 1 })
        useWorkflowStore.getState().setEditingTest('test-456', 'Stale Name 2')
      })

      await waitFor(() => {
        expect(vi.mocked(fetchTest)).toHaveBeenCalledWith('test-456')
      })
    })

    it('a tab browsing the changed test ends on the test as stored, saved, once the session is handed back', async () => {
      setOwnership({ isMirroring: true, browsingAway: true, holderLabel: 'Claude Code (MCP)', holderKind: 'mcp' })
      act(() => {
        const store = useWorkflowStore.getState()
        store.setNodes([{ id: 'before-1', type: 'log', position: { x: 0, y: 0 }, data: { label: 'Log' } }] as never, {
          skipDirty: true,
        })
        store.setEditingTest('test-456', 'Recovered Test')
        store.markSaved()
      })
      renderContainer()
      await screen.findByTestId('mirror-banner')
      vi.mocked(fetchTestWorkflow).mockResolvedValueOnce({
        nodes: [{ id: 'after-1', type: 'log', position: { x: 0, y: 0 }, data: { label: 'Log' } }],
        edges: [],
      } as never)

      act(() => {
        setOwnership({ isHolder: true, inheritRefreshTick: 1 })
        useWorkflowStore.getState().setEditingTest('test-456', 'Stale Name')
      })

      await waitFor(() => {
        expect(useWorkflowStore.getState().nodes.map((node) => node.id)).toEqual(['after-1'])
      })
      expect(useWorkflowStore.getState().editingTestName).toBe('Recovered Test')
      expect(useWorkflowStore.getState().isDirty).toBe(false)
      expect(useWorkflowStore.getState().getSavedNodes().map((node) => node.id)).toEqual(['after-1'])
    })

    it('does nothing on a write-borrow return with no open test', async () => {
      setOwnership({ isHolder: true })
      renderContainer()
      await screen.findByTestId('workflow-canvas')
      vi.mocked(fetchTest).mockClear()

      act(() => {
        setOwnership({ isHolder: true, inheritRefreshTick: 1 })
        // Forces a rerender so the effect observes the new tick with no open test.
        useWorkflowStore.getState().setDirty(true)
      })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(vi.mocked(fetchTest)).not.toHaveBeenCalled()
    })
  })

  describe("the environment picker after an assistant's run", () => {
    const DEV_ID = 'a1b2c3d4-e5f6-4a5b-8c7d-9e0f1a2b3c4d'
    const LAB_ID = 'b2c3d4e5-f6a7-4b5c-9d8e-0f1a2b3c4d5e'
    const DEV_ENV = { id: DEV_ID, name: 'Development', tags: [] }
    const LAB_ENV = { id: LAB_ID, name: 'Lab', tags: [] }
    const HOLDER ={ isHolder: true, holderLabel: 'This tab', holderKind: 'person' } as const
    const ASSISTANT = { isMirroring: true, holderLabel: 'Claude Code (MCP)', holderKind: 'mcp' } as const
    const PERSON = { isMirroring: true, holderLabel: 'Ashley', holderKind: 'person' } as const
    const LAB_RUN: MirroredRun = {
      sessionId: 'run-1',
      testId: 'test-1',
      testName: 'Nightly Smoke',
      environmentId: LAB_ID,
      environmentName: 'Lab',
      status: 'running',
    }

    const picker = () => screen.getByTestId('environment-selector')

    // A queued answer a test never read must not answer the next test's page load.
    afterEach(() => {
      vi.mocked(fetchEnvironmentNames).mockReset().mockResolvedValue([DEV_ENV, LAB_ENV])
    })

    async function settle(): Promise<void> {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }

    // The ownership mock is not reactive: a store write re-renders the container on the new state.
    function moveTo(overrides: Partial<SessionOwnership>): void {
      act(() => {
        setOwnership(overrides)
        useWorkflowStore.setState({ edges: [] })
      })
    }

    async function openTab(ownership: Partial<SessionOwnership>): Promise<void> {
      setOwnership(ownership)
      renderContainer()
      await screen.findByTestId('environment-selector')
      await waitFor(() => expect(vi.mocked(fetchEnvironmentNames)).toHaveBeenCalled())
      await settle()
    }

    async function pick(user: ReturnType<typeof userEvent.setup>, envId: string): Promise<void> {
      await user.click(picker())
      await user.click(await screen.findByTestId(`env-${envId}`))
    }

    function runAndHandBack(run: MirroredRun): void {
      moveTo({ ...ASSISTANT })
      moveTo({ ...ASSISTANT, mirroredRun: run })
      // A reconnect announces the same run again, as a fresh object.
      moveTo({ ...ASSISTANT, mirroredRun: { ...run } })
      moveTo({ ...ASSISTANT, mirroredRun: null })
      moveTo({ ...HOLDER })
    }

    it("shows the run's environment in a picker that was empty before the run", async () => {
      await openTab(HOLDER)
      expect(picker()).toHaveTextContent(/^Select Environment$/)

      runAndHandBack(LAB_RUN)

      await waitFor(() => expect(picker()).toHaveTextContent(/^Lab$/))
      expect(picker()).toBeEnabled()
    })

    it('replaces another environment the picker held before the run', async () => {
      const user = userEvent.setup()
      await openTab(HOLDER)
      await pick(user, DEV_ID)
      expect(picker()).toHaveTextContent(/^Development$/)

      runAndHandBack(LAB_RUN)

      await waitFor(() => expect(picker()).toHaveTextContent(/^Lab$/))
    })

    it("takes the run's environment as a pick: remembered, and first under Recent", async () => {
      const user = userEvent.setup()
      localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
      await openTab(HOLDER)
      await pick(user, DEV_ID)

      runAndHandBack(LAB_RUN)

      await waitFor(() => expect(localStorage.getItem(STORAGE_KEYS.SELECTED_ENV)).toBe(LAB_ID))
      await user.click(picker())
      const recent = await screen.findAllByTestId(/^env-recent-/)
      expect(recent.map((row) => row.dataset.testid)).toEqual([`env-recent-${LAB_ID}`, `env-recent-${DEV_ID}`])
    })

    it("stays as it was when the run's environment no longer exists", async () => {
      const user = userEvent.setup()
      await openTab(HOLDER)
      await pick(user, DEV_ID)

      runAndHandBack({ ...LAB_RUN, environmentId: 'c3d4e5f6-a7b8-4c5d-8e9f-1a2b3c4d5e6f', environmentName: 'Retired' })
      await settle()

      expect(picker()).toHaveTextContent(/^Development$/)
    })

    it("stays as it was when the run's environment was deleted on the server during the run", async () => {
      const user = userEvent.setup()
      await openTab(HOLDER)
      await pick(user, DEV_ID)
      // The tab's list still has Lab; the server no longer does.
      vi.mocked(fetchEnvironmentNames).mockResolvedValueOnce([DEV_ENV])

      runAndHandBack(LAB_RUN)
      await settle()

      expect(picker()).toHaveTextContent(/^Development$/)
      expect(vi.mocked(fetchEnvironmentNames)).toHaveBeenCalledTimes(2)
    })

    it('takes an environment the server has although the tab loaded before it was made', async () => {
      const user = userEvent.setup()
      vi.mocked(fetchEnvironmentNames).mockResolvedValueOnce([DEV_ENV])
      await openTab(HOLDER)

      runAndHandBack(LAB_RUN)

      await waitFor(() => expect(picker()).toHaveTextContent(/^Lab$/))
      await user.click(picker())
      const recent = await screen.findAllByTestId(/^env-recent-/)
      expect(recent.map((row) => row.dataset.testid)).toEqual([`env-recent-${LAB_ID}`])
    })

    it('stays as it was, with no new error, when the server list cannot be read at the end of the run', async () => {
      const user = userEvent.setup()
      await openTab(HOLDER)
      await pick(user, DEV_ID)
      vi.mocked(fetchEnvironmentNames).mockRejectedValueOnce(new Error('Service Unavailable'))

      runAndHandBack(LAB_RUN)
      await settle()

      expect(picker()).toHaveTextContent(/^Development$/)
      expect(vi.mocked(fetchEnvironmentNames)).toHaveBeenCalledTimes(2)
      expect(usePageBlockStore.getState().block).toBeNull()
      expect(document.querySelectorAll('[data-toast]')).toHaveLength(0)
    })

    it('stays as it was after a run that names no environment', async () => {
      const user = userEvent.setup()
      await openTab(HOLDER)
      await pick(user, DEV_ID)

      runAndHandBack({ ...LAB_RUN, environmentId: null, environmentName: null })
      await settle()

      expect(picker()).toHaveTextContent(/^Development$/)
    })

    it('a tab that takes the session over during the run keeps its environment, and a later pick stands', async () => {
      const user = userEvent.setup()
      await openTab(HOLDER)
      moveTo({ ...ASSISTANT, mirroredRun: LAB_RUN })

      // The run is still announced: it goes on after the take-over.
      moveTo({ ...HOLDER, mirroredRun: LAB_RUN })

      await waitFor(() => expect(picker()).toHaveTextContent(/^Lab$/))
      await pick(user, DEV_ID)
      moveTo({ ...HOLDER, mirroredRun: null })
      await settle()
      expect(picker()).toHaveTextContent(/^Development$/)
    })

    it("a third tab takes the run's environment when another tab takes over during the run", async () => {
      await openTab(PERSON)
      moveTo({ ...ASSISTANT })
      moveTo({ ...ASSISTANT, mirroredRun: LAB_RUN })

      // Ashley takes over: the run goes on, but no longer plays here.
      moveTo({ ...PERSON })

      await waitFor(() => expect(picker()).toHaveTextContent(/^Lab$/))
      expect(vi.mocked(fetchEnvironmentNames)).toHaveBeenCalledTimes(2)
    })

    it('a run that plays while this tab holds the session leaves the picker alone', async () => {
      const user = userEvent.setup()
      await openTab(HOLDER)
      await pick(user, DEV_ID)

      moveTo({ ...HOLDER, mirroredRun: LAB_RUN })
      moveTo({ ...HOLDER, mirroredRun: null })
      await settle()

      expect(picker()).toHaveTextContent(/^Development$/)
    })

    it("a tab that watched another person's run keeps its own selection", async () => {
      localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
      localStorage.setItem(STORAGE_KEYS.SELECTED_ENV, DEV_ID)
      await openTab(PERSON)
      expect(picker()).toHaveTextContent(/^Development$/)

      moveTo({ ...PERSON, mirroredRun: LAB_RUN })
      moveTo({ ...PERSON, mirroredRun: null })
      await settle()

      expect(picker()).toHaveTextContent(/^Development$/)
    })

    it('a tab that browsed away before the run ended keeps its own selection', async () => {
      const user = userEvent.setup()
      await openTab(HOLDER)
      await pick(user, DEV_ID)
      moveTo({ ...ASSISTANT, mirroredRun: LAB_RUN })

      moveTo({ ...ASSISTANT, browsingAway: true, mirroredRun: LAB_RUN })
      moveTo({ ...ASSISTANT, browsingAway: true, mirroredRun: null })
      moveTo({ ...HOLDER })
      await settle()

      expect(picker()).toHaveTextContent(/^Development$/)
    })
  })

  describe("the run controls after a take-over during an assistant's run", () => {
    const ASSISTANT = { isMirroring: true, holderLabel: 'Claude Code (MCP)', holderKind: 'mcp' } as const
    const RUN: MirroredRun = {
      sessionId: 'run-1',
      testId: 'test-1',
      testName: 'Nightly Smoke',
      environmentId: null,
      environmentName: null,
      status: 'running',
    }

    function moveTo(overrides: Partial<SessionOwnership>): void {
      act(() => {
        setOwnership(overrides)
        useWorkflowStore.setState({ edges: [] })
      })
    }

    // The tab opens, then the assistant's run starts playing in it.
    async function watchTheRun(): Promise<void> {
      setOwnership({ isMirroring: true, holderLabel: 'Ashley', holderKind: 'person' })
      renderContainer()
      await screen.findByTestId('environment-selector')
      vi.mocked(workbenchApi.getCurrentSession).mockResolvedValueOnce({
        session_id: 'run-1',
        test_id: 'test-1',
        websocket_topic: 'workbench:run-1',
        status: 'running',
        test_name: 'Nightly Smoke',
      } as Awaited<ReturnType<typeof workbenchApi.getCurrentSession>>)
      moveTo({ ...ASSISTANT })
      moveTo({ ...ASSISTANT, mirroredRun: RUN })
      await waitFor(() => expect(screen.getByTestId('workflow-status')).toHaveAttribute('data-status', 'running'))
      expect(screen.getByTestId('environment-selector')).toHaveTextContent('Env:')
    }

    it('a third tab whose mirror of the run ended offers no run control for it', async () => {
      await watchTheRun()

      moveTo({ isMirroring: true, holderLabel: 'Ashley', holderKind: 'person' })

      await waitFor(() => expect(screen.getByTestId('workflow-status')).not.toHaveAttribute('data-status', 'running'))
      expect(screen.queryByTestId('action-stop-button')).not.toBeInTheDocument()
      expect(screen.getByTestId('run-button')).toBeDisabled()
      expect(screen.getByTestId('environment-selector')).not.toHaveTextContent('Env:')
    })

    it('the tab that takes the session over holds its draft with Run, not the run with Stop', async () => {
      await watchTheRun()

      moveTo({ isHolder: true, holderLabel: 'This tab', holderKind: 'person' })

      await waitFor(() => expect(screen.getByTestId('workflow-status')).not.toHaveAttribute('data-status', 'running'))
      expect(screen.queryByTestId('action-stop-button')).not.toBeInTheDocument()
      expect(screen.getByTestId('run-button')).toBeEnabled()
    })
  })

  describe('take-over dialogs', () => {
    it('opens the waiting dialog while requesting and wires Cancel + Force', async () => {
      const user = userEvent.setup()
      const state = setOwnership({
        isMirroring: true,
        holderLabel: 'Ashley',
        holderKind: 'person',
        isRequestingTakeover: true,
      })
      renderContainer()

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('Waiting to take over')
      expect(dialog).toHaveTextContent('Another session')
      expect(dialog).not.toHaveTextContent('Ashley')

      await user.click(screen.getByRole('button', { name: 'Force Take Over' }))
      expect(state.forceTakeOver).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(state.cancelRequest).toHaveBeenCalledTimes(1)
    })

    it('labels the waiting dialog generically when the holder is unknown', async () => {
      setOwnership({ isMirroring: true, isRequestingTakeover: true })
      renderContainer()

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('Another session is being asked to hand over')
    })

    it('opens the approval dialog for a pending request and wires Hand over + Deny', async () => {
      const user = userEvent.setup()
      const state = setOwnership({
        isHolder: true,
        pendingTakeover: { requesterLabel: 'Ashley' },
      })
      renderContainer()

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('Another session wants to take over')

      await user.click(screen.getByRole('button', { name: 'Hand over' }))
      expect(state.approve).toHaveBeenCalledTimes(1)
      expect(state.deny).not.toHaveBeenCalled()
    })

    it('Deny in the approval dialog calls the deny action', async () => {
      const user = userEvent.setup()
      const state = setOwnership({
        isHolder: true,
        pendingTakeover: { requesterLabel: 'Ashley' },
      })
      renderContainer()

      await screen.findByRole('alertdialog')
      await user.click(screen.getByRole('button', { name: 'Deny' }))

      expect(state.deny).toHaveBeenCalledTimes(1)
      expect(state.approve).not.toHaveBeenCalled()
    })

    it('shows the outcome dialog when a take-over resolves and wires dismiss', async () => {
      const user = userEvent.setup()
      const state = setOwnership({ takeoverResult: 'granted' })
      renderContainer()

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('You now hold the session')

      await user.click(screen.getByRole('button', { name: 'Start editing' }))
      expect(state.dismissTakeoverResult).toHaveBeenCalledTimes(1)
    })
  })

  describe('holder chrome', () => {
    it('shows the watchers pill to a watched holder', async () => {
      setOwnership({ isHolder: true, watchers: 3 })
      renderContainer()

      const pill = await screen.findByTestId('watchers-indicator')
      expect(pill).toHaveTextContent('3 watching')
      expect(pill).toHaveAttribute('aria-label', '3 people watching')
    })

    it('uses the singular noun for one watcher', async () => {
      setOwnership({ isHolder: true, watchers: 1 })
      renderContainer()

      const pill = await screen.findByTestId('watchers-indicator')
      expect(pill).toHaveTextContent('1 watching')
      expect(pill).toHaveAttribute('aria-label', '1 person watching')
    })

    it('hides the pill when the holder edits alone', async () => {
      setOwnership({ isHolder: true, watchers: 0 })
      renderContainer()

      await screen.findByTestId('workflow-canvas')
      expect(screen.queryByTestId('watchers-indicator')).not.toBeInTheDocument()
    })

    it('shows the forced-out modal to the former holder after a forced take-over', async () => {
      const state = setOwnership({ isMirroring: true, holderKind: 'person', takeoverResult: 'forced' })
      renderContainer()

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('Session taken over')
      expect(dialog).toHaveTextContent('Another session forced a take-over')

      await userEvent.setup().click(screen.getByRole('button', { name: 'OK' }))
      expect(state.dismissTakeoverResult).toHaveBeenCalledTimes(1)
    })
  })

  describe('holder draft stream', () => {
    it('pushes an initial snapshot and throttles rapid store changes into a trailing push', async () => {
      const state = setOwnership({ isHolder: true })
      renderContainer()

      await waitFor(() => {
        expect(state.pushDraft).toHaveBeenCalledTimes(1)
      })
      expect(state.pushDraft).toHaveBeenCalledWith({
        nodes: [],
        edges: [],
        variables: [],
        test_id: null,
        test_name: null,
        dirty: false,
      })

      const node = {
        id: 'n1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: { label: 'One' },
      }
      act(() => {
        useWorkflowStore.setState({ nodes: [node] } as never)
        useWorkflowStore.setState({ nodes: [node, { ...node, id: 'n2' }] } as never)
      })
      expect(state.pushDraft).toHaveBeenCalledTimes(1)

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350))
      })
      expect(state.pushDraft).toHaveBeenCalledTimes(2)
      expect(state.pushDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({ nodes: [node, expect.objectContaining({ id: 'n2' })] })
      )

      // Let the trailing window drain so unmount hits the no-timer path.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350))
      })
    })

    it('stamps the open test identity and saved-state onto the frame', async () => {
      const state = setOwnership({ isHolder: true })
      const node = {
        id: 'n1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: { label: 'One' },
      }
      act(() => {
        useWorkflowStore.setState({ nodes: [node] } as never)
        useWorkflowStore.getState().setEditingTest('test-456', 'Recovered Test')
        useWorkflowStore.getState().setDirty(true)
      })
      renderContainer()

      await waitFor(() => {
        expect(state.pushDraft).toHaveBeenCalled()
      })
      expect(state.pushDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          test_id: 'test-456',
          test_name: 'Recovered Test',
          dirty: true,
        }),
      )
    })

    it('streams nothing while not the holder', async () => {
      const state = setOwnership({ isMirroring: true, holderLabel: 'Ashley', holderKind: 'person' })
      renderContainer()

      await screen.findByTestId('mirror-banner')
      expect(state.pushDraft).not.toHaveBeenCalled()
    })
  })
})
