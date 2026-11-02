/**
 * WorkbenchContainer - session-ownership wiring (SESS-1..8).
 *
 * The container composes useSessionOwnership into the workbench chrome:
 * mirror banner below the breadcrumb, read-only canvas + locked toolbar while
 * mirroring, take-over dialogs, the holder-side "N watching" pill, the
 * throttled holder draft stream, the forced-take-over toast, and the
 * See connection deep-link to /settings/mcp.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { WorkbenchContainer } from '@/features/workbench/live'
import { ThemeProvider } from '@/design-system/theme-provider'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { fetchTest } from '@/features/tests/api/crud'
import type { SessionOwnership } from '@/features/workbench/hooks/use-session-ownership'

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
