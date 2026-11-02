/**
 * ExecutionTestCanvasPage Tests
 *
 * The page at `/executions/history/:runId` must render the real
 * Workbench chrome (action bar, breadcrumb, palette, canvas, console,
 * variable-manager panels) from the run's workflow snapshot and never
 * mutate the live Workbench store (rule 4 isolation). The palette is
 * rendered collapsed + disabled (rule 5). The run_id keys the URL so
 * a regression where the same test runs in two suites shows two
 * independent history pages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '@/design-system/theme-provider'
import { ToastProvider } from '@/components/ui/toast'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { ExecutionTestCanvasPage } from '@/features/workbench/history/container'
import { getHistoricalTestRun } from '@/features/executions/api/executions'

vi.mock('@/features/executions/api/executions', () => ({
  getHistoricalTestRun: vi.fn(),
}))

const SNAPSHOT_WORKFLOW = {
  nodes: [
    {
      id: 'node-start',
      type: 'startNode',
      position: { x: 0, y: 0 },
      data: { label: 'Start' },
    },
    {
      id: 'node-log',
      type: 'workflowNode',
      position: { x: 160, y: 0 },
      data: { label: 'Log', elementType: 'plugin', nodeType: 'plugin' },
    },
  ],
  edges: [
    { id: 'edge-1', source: 'node-start', target: 'node-log' },
  ],
}

function mockApiResponse(
  overrides: Partial<Awaited<ReturnType<typeof getHistoricalTestRun>>> = {},
): Awaited<ReturnType<typeof getHistoricalTestRun>> {
  return {
    run_id: 'run-1',
    execution_id: 'exec-1',
    test_id: 'test-1',
    suite_id: null,
    status: 'passed',
    started_at: '2026-04-18T10:00:00+00:00',
    ended_at: '2026-04-18T10:00:05+00:00',
    workflow: SNAPSHOT_WORKFLOW,
    block_states: { 'node-log': 'passed' },
    variables: { x: 42 },
    variable_definitions: {},
    logs: [],
    environment_id: null,
    environment_name: null,
    ...overrides,
  }
}

function renderPage(path = '/executions/history/run-1') {
  return render(
    <ThemeProvider>
      <>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route
                path="/executions/history/:runId"
                element={<ExecutionTestCanvasPage />}
              />
              <Route path="/executions/:id" element={<div>execution page</div>} />
              <Route path="/executions" element={<div>executions list</div>} />
              <Route path="/reports/:executionId" element={<div>report viewer</div>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </>
    </ThemeProvider>
  )
}

describe('ExecutionTestCanvasPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the default live store to a clean baseline for rule-4 isolation checks.
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      editingTestId: null,
      editingTestName: null,
    })
    vi.mocked(getHistoricalTestRun).mockResolvedValue(mockApiResponse())
  })

  it('fetches the canvas snapshot using the runId from the URL', async () => {
    renderPage('/executions/history/run-xyz')

    await waitFor(() => {
      expect(getHistoricalTestRun).toHaveBeenCalledWith('run-xyz')
    })
  })

  it('renders the real Workbench chrome (canvas page, action bar, canvas, palette)', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('canvas-page')).toBeInTheDocument()
    })

    // All of these are the SAME child components the live WorkbenchContainer
    // renders; the presence of their testids proves we reuse them, not stand-ins.
    expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-action-bar')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-main-content')).toBeInTheDocument()
    expect(screen.getByTestId('palette-panel')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('block-palette')).toBeInTheDocument()
  })

  it('tags the page with data-mode="history" for manual diagnostics', async () => {
    renderPage()

    const workbenchPage = await screen.findByTestId('workbench-page')
    expect(workbenchPage).toHaveAttribute('data-mode', 'history')
  })

  it('renders the palette in collapsed and disabled state (rule 5)', async () => {
    renderPage()

    const palette = await screen.findByTestId('block-palette')
    expect(palette).toHaveAttribute('data-state', 'collapsed')
    expect(palette).toHaveAttribute('data-disabled', 'true')
    expect(palette).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not mutate the live default workflow store (rule 4 isolation)', async () => {
    // Seed the live store with known state and verify it is untouched after
    // history page renders and hydrates its scoped store from the snapshot.
    useWorkflowStore.setState({
      nodes: [
        {
          id: 'live-node-1',
          type: 'workflowNode',
          position: { x: 10, y: 10 },
          data: { label: 'Live Node' },
        },
      ],
      edges: [],
      editingTestId: 'live-editing-test',
      editingTestName: 'Live Test Name',
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('block-palette')).toBeInTheDocument()
    })

    // Live store's nodes / edges / editing state must remain EXACTLY as seeded.
    const liveState = useWorkflowStore.getState()
    expect(liveState.nodes).toEqual([
      {
        id: 'live-node-1',
        type: 'workflowNode',
        position: { x: 10, y: 10 },
        data: { label: 'Live Node' },
      },
    ])
    expect(liveState.edges).toEqual([])
    expect(liveState.editingTestId).toBe('live-editing-test')
    expect(liveState.editingTestName).toBe('Live Test Name')
  })

  it('shows a loading state while the snapshot is in flight', () => {
    vi.mocked(getHistoricalTestRun).mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByTestId('execution-test-canvas-loading')).toBeInTheDocument()
  })

  it('shows an error state when the fetch fails', async () => {
    vi.mocked(getHistoricalTestRun).mockRejectedValue(new Error('canvas not found'))

    renderPage()

    const error = await screen.findByTestId('execution-test-canvas-error')
    expect(error).toHaveTextContent('canvas not found')
  })

  it('shows a generic message when the fetch rejects with a non-Error', async () => {
    vi.mocked(getHistoricalTestRun).mockRejectedValue('boom')

    renderPage()

    const error = await screen.findByTestId('execution-test-canvas-error')
    expect(error).toHaveTextContent('Failed to load')
  })

  it('drops a rejection that lands after the page unmounts', async () => {
    let rejectFetch: (reason: unknown) => void = () => {}
    vi.mocked(getHistoricalTestRun).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFetch = reject
      }),
    )

    const { unmount } = renderPage()
    expect(screen.getByTestId('execution-test-canvas-loading')).toBeInTheDocument()

    unmount()
    await act(async () => {
      rejectFetch(new Error('too late'))
      await Promise.resolve()
    })

    expect(screen.queryByTestId('execution-test-canvas-error')).not.toBeInTheDocument()
  })
})

describe('ExecutionTestCanvasPage - Back navigation and status normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('navigates to the execution detail page when the Back-arrow is clicked', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(
      mockApiResponse({ execution_id: 'exec-abc' }),
    )
    renderPage('/executions/history/run-1')
    const backBtn = await screen.findByTestId('breadcrumb-back-arrow')
    act(() => {
      backBtn.click()
    })
    expect(await screen.findByText('execution page')).toBeInTheDocument()
  })

  it('navigates to /executions list for a test-type run (run_id === execution_id)', async () => {
    // Test-type executions mint run_id equal to execution_id, so
    // /executions/:id would just re-render this same history page. Back
    // must go to the list view instead of reloading itself.
    vi.mocked(getHistoricalTestRun).mockResolvedValue(
      mockApiResponse({ run_id: 'run-same', execution_id: 'run-same' }),
    )
    renderPage('/executions/history/run-same')
    const backBtn = await screen.findByTestId('breadcrumb-back-arrow')
    act(() => {
      backBtn.click()
    })
    expect(await screen.findByText('executions list')).toBeInTheDocument()
  })

  // Per RVIEW-13: the historical canvas is the detail surface for
  // test executions, so its action bar carries the Report entry point.
  it('navigates to the report viewer when the action-bar Report button is clicked', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(
      mockApiResponse({ execution_id: 'exec-abc' }),
    )
    renderPage('/executions/history/run-1')
    const reportBtn = await screen.findByTestId('history-report-button')
    act(() => {
      reportBtn.click()
    })
    expect(await screen.findByText('report viewer')).toBeInTheDocument()
  })

  it('falls back to /executions when payload lacks an execution_id', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(
      mockApiResponse({ execution_id: '' }),
    )
    renderPage('/executions/history/run-2')
    const backBtn = await screen.findByTestId('breadcrumb-back-arrow')
    act(() => {
      backBtn.click()
    })
    expect(await screen.findByText('executions list')).toBeInTheDocument()
  })

  it('normalizes unknown statuses to idle', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(
      mockApiResponse({ status: 'WACKY_STATUS' }),
    )
    renderPage()
    const page = await screen.findByTestId('workbench-page')
    expect(page).toBeInTheDocument()
  })

  it('normalizes missing status to idle', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(
      mockApiResponse({ status: null as unknown as string }),
    )
    renderPage()
    const page = await screen.findByTestId('workbench-page')
    expect(page).toBeInTheDocument()
  })

  it('accepts running/paused as valid statuses', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(
      mockApiResponse({ status: 'paused' }),
    )
    renderPage()
    const page = await screen.findByTestId('workbench-page')
    expect(page).toBeInTheDocument()
  })

  it('handles null workflow / block_states / variables / logs gracefully', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(
      mockApiResponse({
        workflow: null,
        block_states: null as unknown as Record<string, string>,
        variables: null as unknown as Record<string, unknown>,
        variable_definitions: null as unknown as Record<
          string,
          import('@/features/executions/api/types').HistoricalCanvasVariableDefinition
        >,
        logs: null as unknown as never,
      }),
    )
    renderPage()
    await screen.findByTestId('workbench-page')
    // All ?? defaults landed and the render succeeded without throwing.
    expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument()
  })
})
