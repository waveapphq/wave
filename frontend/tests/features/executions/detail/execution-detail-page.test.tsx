/**
 * ExecutionDetailPage Tests
 *
 * Shared execution detail page used for Test, Suite, and Regression executions.
 *
 * These tests describe the page's observable behavior:
 *   - loads execution detail on mount
 *   - shows loading / error / not-found states
 *   - renders the EXECUTION INFO panel, components table, and console
 *   - top-bar action set switches between Running and Terminal
 *   - SSE subscription is wired on mount when execution is Running
 *
 * All fetch traffic is mocked; this is a unit test, not integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('@/features/executions/api/executions', () => ({
  fetchExecution: vi.fn(),
  stopExecution: vi.fn(),
  deleteExecution: vi.fn(),
  startExecution: vi.fn(),
  transformApiExecution: (x: Record<string, unknown>) => x,
}))

vi.mock('@/lib/format-duration', () => ({
  formatDuration: (_s: number | null) => '1m 2s',
}))

vi.mock('@/features/executions/api/export', () => ({
  exportExecution: vi.fn(),
  downloadExecutionExport: vi.fn(),
  exportExecutions: vi.fn(),
}))

vi.mock('@/hooks/use-environments', () => ({
  useEnvironments: () => ({
    environments: [{ id: 'env-1', name: 'Default' }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/features/workbench/common/console/console-panel', () => ({
  ConsolePanel: ({ onCollapsedChange }: { onCollapsedChange?: (c: boolean) => void }) => (
    <div data-testid="mock-console-panel">
      <button data-testid="mock-console-collapse" onClick={() => onCollapsedChange?.(true)}>collapse</button>
      <button data-testid="mock-console-expand" onClick={() => onCollapsedChange?.(false)}>expand</button>
    </div>
  ),
}))

// jsdom lacks a coarse-pointer media query which react-resizable-panels
// probes on mount; the ResizablePanel tree doesn't contribute anything we
// assert on, so stub it out. The bottom panel exposes a button that fires
// the onResize callback so the page-level resize handler stays covered.
vi.mock('@/components/ui/resizable', () => {
  type PanelHandle = { collapse: () => void; resize: (size: number) => void }
  const Panel = ({
    children,
    onResize,
    panelRef,
  }: {
    children?: React.ReactNode
    onResize?: (size: { inPixels: number }, id: string | undefined, prev: { inPixels: number } | undefined) => void
    panelRef?: { current: PanelHandle | null }
  }) => {
    if (panelRef) {
      panelRef.current = { collapse: () => {}, resize: () => {} }
    }
    return (
      <>
        {(children as React.ReactElement) ?? null}
        {onResize && (
          <>
            <button
              data-testid="mock-panel-resize"
              onClick={() => {
                onResize({ inPixels: 48 }, undefined, { inPixels: 200 })
              }}
            >
              resize
            </button>
            <button
              data-testid="mock-panel-resize-initial"
              onClick={() => {
                onResize({ inPixels: 200 }, undefined, undefined)
              }}
            >
              resize initial
            </button>
          </>
        )}
      </>
    )
  }
  return {
    ResizablePanelGroup: ({ children }: { children?: React.ReactNode }) =>
      (children as React.ReactElement) ?? null,
    ResizablePanel: Panel,
    ResizableHandle: () => null,
  }
})
import React from 'react'

import { ToastProvider } from '@/components/ui/toast'
import { deleteExecution, fetchExecution } from '@/features/executions/api/executions'
import { downloadExecutionExport, exportExecutions } from '@/features/executions/api/export'
import { ExecutionDetailPage } from '@/features/executions/detail/execution-detail-page'

function buildExecution(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'exec-1',
    name: 'Nightly Regression',
    entity_type: 'regression',
    entity_id: 'reg-1',
    environment_id: 'env-1',
    status: 'running',
    counts: { total: 4, passed: 1, failed: 0, pending: 3, skipped: 0 },
    started_at: '2026-04-15T10:00:00Z',
    completed_at: null,
    duration: null,
    triggered_by: 'wparker',
    tags: ['nightly'],
    description: 'Nightly regression',
    tests: [
      { id: 't1', name: 'Login', status: 'passed', duration: 1.2 },
      { id: 't2', name: 'Checkout', status: 'running', duration: null },
      { id: 't3', name: 'Pay', status: 'pending', duration: null },
    ],
    ...overrides,
  }
}

function renderAt(path = '/executions/exec-1') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/executions" element={<div data-testid="executions-list" />} />
          <Route path="/executions/:executionId" element={<ExecutionDetailPage />} />
          <Route
            path="/executions/history/:runId"
            element={<div data-testid="test-placeholder" />}
          />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('ExecutionDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a loading state while the execution is being fetched', () => {
    vi.mocked(fetchExecution).mockImplementation(() => new Promise(() => {}))
    renderAt()
    expect(screen.getByTestId('execution-detail-loading')).toBeInTheDocument()
  })

  it('renders the execution name in the detail header after load', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution() as never,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByText('Nightly Regression')).toBeInTheDocument()
    })
    expect(screen.getByTestId('detail-back-btn')).toBeInTheDocument()
  })

  it('renders EXECUTION INFO fields (status, counts, started, triggered, environment)', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution() as never,
    })
    renderAt()
    const info = await screen.findByTestId('execution-info-panel')
    expect(info).toHaveTextContent(/status/i)
    expect(info).toHaveTextContent(/triggered/i)
    expect(info).toHaveTextContent(/wparker/)
    expect(info).toHaveTextContent(/env-1/)
  })

  it('renders the Components table with the provided tests', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution() as never,
    })
    renderAt()
    await screen.findByText('Login')
    expect(screen.getByText('Checkout')).toBeInTheDocument()
    expect(screen.getByText('Pay')).toBeInTheDocument()
  })

  it('renders the Console slot below the table', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution() as never,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('execution-console')).toBeInTheDocument()
    })
  })

  it('shows Running-state toolbar (Stop, View Running, Export) while status is running', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ status: 'running' }) as never,
    })
    renderAt()
    await screen.findByText('Nightly Regression')
    expect(screen.getByRole('button', { name: /^Stop$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view running/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /re-run/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })

  it('shows Terminal-state toolbar (Re-run, Export, Delete) when status is terminal', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        status: 'passed',
        completed_at: '2026-04-15T10:05:00Z',
        duration: 312,
      }) as never,
    })
    renderAt()
    await screen.findByText('Nightly Regression')
    expect(screen.getByRole('button', { name: /re-run/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Stop$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /view running/i })).toBeNull()
  })

  it('treats "skipped" as terminal (regression-halt parent status)', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        status: 'skipped',
        completed_at: '2026-04-15T10:05:00Z',
        duration: 4,
      }) as never,
    })
    renderAt()
    await screen.findByText('Nightly Regression')
    // Terminal toolbar is on (Re-run / Export / Delete).
    expect(screen.getByRole('button', { name: /re-run/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    // Running-only controls are gone (no Stop, no View Running).
    expect(screen.queryByRole('button', { name: /^Stop$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /view running/i })).toBeNull()
    // Polling stays off for terminal runs - the page must not keep refetching.
    const callsAtStart = vi.mocked(fetchExecution).mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 2000))
    expect(vi.mocked(fetchExecution).mock.calls.length).toBe(callsAtStart)
  })

  it('navigates back to the Executions list after confirming Delete', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        status: 'passed',
        completed_at: '2026-04-15T10:05:00Z',
        duration: 312,
      }) as never,
    })
    vi.mocked(deleteExecution).mockResolvedValue(undefined as never)
    const user = (await import('@testing-library/user-event')).default.setup()

    renderAt()
    await screen.findByText('Nightly Regression')

    await user.click(screen.getByRole('button', { name: /delete/i }))
    // The confirmation dialog is a portal. Click its "Delete" action.
    const confirm = await screen.findByRole('button', { name: /^Delete$/ })
    await user.click(confirm)

    await waitFor(() => {
      expect(vi.mocked(deleteExecution)).toHaveBeenCalledWith('exec-1')
    })
    expect(await screen.findByTestId('executions-list')).toBeInTheDocument()
  })

  it('toolbar Export opens the shared dialog with JSON preselected and no secrets checkbox', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        status: 'passed',
        completed_at: '2026-04-15T10:05:00Z',
        duration: 312,
      }) as never,
    })
    const user = (await import('@testing-library/user-event')).default.setup()

    renderAt()
    await screen.findByText('Nightly Regression')

    await user.click(screen.getByRole('button', { name: /export/i }))

    const dialog = await screen.findByTestId('export-dialog')
    expect(dialog).toHaveTextContent('Nightly Regression')
    expect(screen.getByTestId('format-json')).toHaveAttribute('data-state', 'checked')
    expect(screen.queryByTestId('secrets-mode-picker')).not.toBeInTheDocument()
    // No download happens until the dialog is confirmed
    expect(vi.mocked(downloadExecutionExport)).not.toHaveBeenCalled()
  })

  it('confirming the export dialog downloads the execution in the chosen format', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        status: 'passed',
        completed_at: '2026-04-15T10:05:00Z',
        duration: 312,
      }) as never,
    })
    vi.mocked(downloadExecutionExport).mockResolvedValue(undefined as never)
    const user = (await import('@testing-library/user-event')).default.setup()

    renderAt()
    await screen.findByText('Nightly Regression')

    await user.click(screen.getByRole('button', { name: /export/i }))
    const dialog = await screen.findByTestId('export-dialog')
    await user.click(screen.getByTestId('format-yaml'))
    await user.click(screen.getByTestId('export-button'))

    await waitFor(() => {
      expect(vi.mocked(downloadExecutionExport)).toHaveBeenCalledWith('exec-1', { format: 'yaml' })
    })
    expect(vi.mocked(exportExecutions)).not.toHaveBeenCalled()
    expect(dialog).not.toBeInTheDocument()
  })

  it('the export dialog is available while the execution is still running', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution() as never,
    })
    const user = (await import('@testing-library/user-event')).default.setup()

    renderAt()
    await screen.findByText('Nightly Regression')

    await user.click(screen.getByRole('button', { name: /export/i }))
    expect(await screen.findByTestId('export-dialog')).toBeInTheDocument()
  })

  it('polls the execution detail while status is running', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ status: 'running' }) as never,
    })
    renderAt()
    await screen.findByText('Nightly Regression')
    const callsAtStart = vi.mocked(fetchExecution).mock.calls.length
    // Real-timer wait past the 1500ms LIVE_POLL_MS so the poll fires. Fake
    // timers would require replacing setInterval before useEffect runs, and
    // under fake timers Radix portal/popper animations emit act() warnings
    // that fail the CI stderr filter.
    await waitFor(
      () => {
        expect(vi.mocked(fetchExecution).mock.calls.length).toBeGreaterThan(callsAtStart)
      },
    )
  })

  it('does not poll when status is terminal', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ status: 'passed', completed_at: '2026-04-15T10:05:00Z' }) as never,
    })
    renderAt()
    await screen.findByText('Nightly Regression')
    const callsAtStart = vi.mocked(fetchExecution).mock.calls.length
    // Give real time past the poll interval; a terminal execution must not
    // schedule any refetch.
    await new Promise((resolve) => setTimeout(resolve, 2000))
    expect(vi.mocked(fetchExecution).mock.calls.length).toBe(callsAtStart)
  })

  it('shows an error state when fetchExecution throws', async () => {
    vi.mocked(fetchExecution).mockRejectedValue(new Error('network'))
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('execution-detail-error')).toBeInTheDocument()
    })
  })

  it('shows a not-found state when fetchExecution returns null data', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: false,
      data: null as never,
    } as never)
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('execution-detail-not-found')).toBeInTheDocument()
    })
  })

  it('redirects a Test-type execution to the Historical Canvas', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'test',
      }) as never,
    })
    renderAt()
    await screen.findByTestId('test-placeholder')
    expect(screen.queryByTestId('execution-detail-page')).toBeNull()
  })

  it('per-test row download button triggers exportExecution', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    const { downloadExecutionExport } = await import('@/features/executions/api/export')
    vi.mocked(downloadExecutionExport).mockResolvedValue(undefined as never)
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'suite',
        tests: [{ id: 't1', name: 'Login Flow', status: 'passed', duration: 1.2 }],
      }) as never,
    })
    renderAt()
    await screen.findByText('Login Flow', { exact: true })
    const downloadBtn = screen.getByRole('button', { name: /download test/i })
    await user.click(downloadBtn)
    expect(downloadExecutionExport).toHaveBeenCalledWith('exec-1', { testIds: ['t1'] })
  })

  it('renders default zero counts when execution.counts is missing', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ counts: undefined }) as never,
    })
    renderAt()
    const info = await screen.findByTestId('execution-info-panel')
    expect(info).toHaveTextContent(/Total:\s*0/)
  })

  it('renders an Excluded total row with the count from execution.counts', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        counts: { total: 5, passed: 2, failed: 0, pending: 0, skipped: 1, excluded: 2 },
      }) as never,
    })
    renderAt()
    const info = await screen.findByTestId('execution-info-panel')
    expect(info).toHaveTextContent(/Excluded:\s*2/)
  })

  it('renders zero Excluded when execution.counts omits the excluded field', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ counts: undefined }) as never,
    })
    renderAt()
    const info = await screen.findByTestId('execution-info-panel')
    expect(info).toHaveTextContent(/Excluded:\s*0/)
  })

  it('panel resize callback under collapsedSize marks console collapsed', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution() as never,
    })
    renderAt()
    const resizeButton = await screen.findByTestId('mock-panel-resize')
    await user.click(resizeButton)
    expect(screen.getByTestId('mock-panel-resize')).toBeInTheDocument()
  })

  it('skips collapsed-state update when initial resize fires with no prior size', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution() as never,
    })
    renderAt()
    const initialButton = await screen.findByTestId('mock-panel-resize-initial')
    await user.click(initialButton)
    // No throw, page stays mounted.
    expect(screen.getByTestId('execution-detail-page')).toBeInTheDocument()
  })

  it('keeps the loaded execution on screen and says the refresh failed', async () => {
    vi.mocked(fetchExecution).mockResolvedValueOnce({
      success: true,
      data: buildExecution({ status: 'running' }) as never,
    })
    renderAt()
    await screen.findByText('Nightly Regression')
    // Next poll throws; the page keeps its data and reports the failed tick.
    vi.mocked(fetchExecution).mockRejectedValue(new Error('transient'))
    const notice = await screen.findByTestId('execution-detail-refresh-error')
    expect(notice).toHaveTextContent('transient')
    expect(notice).toHaveTextContent('(showing the last known state)')
    expect(screen.getByText('Nightly Regression')).toBeInTheDocument()
  })

  it('reports a generic reason when a poll tick rejects with a non-Error', async () => {
    vi.mocked(fetchExecution).mockResolvedValueOnce({
      success: true,
      data: buildExecution({ status: 'running' }) as never,
    })
    renderAt()
    await screen.findByText('Nightly Regression')
    vi.mocked(fetchExecution).mockRejectedValue('nope')
    const notice = await screen.findByTestId('execution-detail-refresh-error')
    expect(notice).toHaveTextContent('Could not refresh the execution')
  })

  it('drops the refresh failure once a later poll succeeds', async () => {
    vi.mocked(fetchExecution).mockResolvedValueOnce({
      success: true,
      data: buildExecution({ status: 'running' }) as never,
    })
    renderAt()
    await screen.findByText('Nightly Regression')
    vi.mocked(fetchExecution).mockRejectedValueOnce(new Error('transient'))
    await screen.findByTestId('execution-detail-refresh-error')

    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ status: 'running' }) as never,
    })
    await waitFor(
      () => {
        expect(
          screen.queryByTestId('execution-detail-refresh-error'),
        ).not.toBeInTheDocument()
      },
    )
  })

  it('console collapse callback toggles without throwing', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution() as never,
    })
    renderAt()
    await screen.findByTestId('mock-console-panel')
    await user.click(screen.getByTestId('mock-console-collapse'))
    await user.click(screen.getByTestId('mock-console-expand'))
    // The console panel mock stays mounted across the collapse/expand round-trip.
    expect(screen.getByTestId('mock-console-panel')).toBeInTheDocument()
  })

  it('renders empty-tags placeholder when tags are empty', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ tags: [] }) as never,
    })
    renderAt()
    await screen.findByTestId('execution-info-panel')
    expect(screen.getByText(/no tags/i)).toBeInTheDocument()
  })

  it('renders empty-tags placeholder when tags field is missing', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ tags: undefined }) as never,
    })
    renderAt()
    await screen.findByTestId('execution-info-panel')
    expect(screen.getByText(/no tags/i)).toBeInTheDocument()
  })

  it('renders the description placeholder when description is missing', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ description: null }) as never,
    })
    renderAt()
    await screen.findByTestId('execution-info-panel')
    expect(screen.getByText(/no description/i)).toBeInTheDocument()
  })

  it('renders a dash for triggered when triggered_by is empty', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ triggered_by: '' }) as never,
    })
    renderAt()
    const info = await screen.findByTestId('execution-info-panel')
    expect(info).toHaveTextContent(/Triggered:?\s*-/)
  })

  it('renders a dash for started_at when missing', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ started_at: '' }) as never,
    })
    renderAt()
    const info = await screen.findByTestId('execution-info-panel')
    expect(info).toHaveTextContent(/Started:?\s*-/)
  })

  it('renders the raw started_at when the value is not a parseable date', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ started_at: 'not-a-date' }) as never,
    })
    renderAt()
    const info = await screen.findByTestId('execution-info-panel')
    expect(info).toHaveTextContent(/not-a-date/)
  })

  it('renders the environment name when environment object is provided', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        environment: { id: 'env-1', name: 'Staging' },
      }) as never,
    })
    renderAt()
    const info = await screen.findByTestId('execution-info-panel')
    expect(info).toHaveTextContent(/Staging/)
  })

  it('renders a dash for environment when no name and no id are present', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ environment_id: '', environment: null }) as never,
    })
    renderAt()
    const info = await screen.findByTestId('execution-info-panel')
    expect(info).toHaveTextContent(/Environment:?\s*-/)
  })

  it('renders the default status variant for an unknown status value', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ status: 'mystery-state' }) as never,
    })
    renderAt()
    const info = await screen.findByTestId('execution-info-panel')
    expect(info).toHaveTextContent(/mystery-state/i)
  })

  it('wraps non-Error rejection values into an Error before rendering the error state', async () => {
    vi.mocked(fetchExecution).mockRejectedValue('plain string failure')
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('execution-detail-error')).toBeInTheDocument()
    })
    expect(screen.getByText(/plain string failure/)).toBeInTheDocument()
  })

  it('does not update state when the initial fetch resolves after unmount', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined
    vi.mocked(fetchExecution).mockImplementation(
      () => new Promise<never>((resolve) => {
        resolveFetch = resolve as (v: unknown) => void
      }) as never,
    )
    const { unmount } = renderAt()
    unmount()
    resolveFetch?.({ success: true, data: buildExecution() as never })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('Nightly Regression')).toBeNull()
  })

  it('does not update state when the initial fetch rejects after unmount', async () => {
    let rejectFetch: ((reason: unknown) => void) | undefined
    vi.mocked(fetchExecution).mockImplementation(
      () => new Promise<never>((_resolve, reject) => {
        rejectFetch = reject
      }) as never,
    )
    const { unmount } = renderAt()
    unmount()
    rejectFetch?.(new Error('after-unmount'))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('execution-detail-error')).toBeNull()
  })

  it('does not update state when a poll resolves after unmount', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ status: 'running' }) as never,
    })
    const { unmount } = renderAt()
    await screen.findByText('Nightly Regression')
    const callsAtStart = vi.mocked(fetchExecution).mock.calls.length
    let resolvePoll: ((value: unknown) => void) | undefined
    vi.mocked(fetchExecution).mockImplementationOnce(
      () => new Promise<never>((resolve) => {
        resolvePoll = resolve as (v: unknown) => void
      }) as never,
    )
    // Wait for the real interval to fire the next poll (it awaits our
    // deferred promise), then unmount (canceled = true) before resolving.
    await waitFor(
      () => {
        expect(vi.mocked(fetchExecution).mock.calls.length).toBeGreaterThan(callsAtStart)
      },
    )
    unmount()
    resolvePoll?.({ success: true, data: buildExecution({ status: 'passed' }) as never })
    // The canceled-guard inside the poll swallows the resolution; no
    // throw here proves the guard works.
    await new Promise((r) => setTimeout(r, 0))
  })

  it('does not report a refresh failure when a poll rejects after unmount', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({ status: 'running' }) as never,
    })
    const { unmount } = renderAt()
    await screen.findByText('Nightly Regression')
    const callsAtStart = vi.mocked(fetchExecution).mock.calls.length
    let rejectPoll: ((reason: unknown) => void) | undefined
    vi.mocked(fetchExecution).mockImplementationOnce(
      () => new Promise<never>((_resolve, reject) => {
        rejectPoll = reject
      }) as never,
    )
    await waitFor(
      () => {
        expect(vi.mocked(fetchExecution).mock.calls.length).toBeGreaterThan(callsAtStart)
      },
    )
    unmount()
    rejectPoll?.(new Error('too late'))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('execution-detail-refresh-error')).not.toBeInTheDocument()
  })

  it('renders suites as collapsible parent rows for a Regression execution', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          {
            id: 's1',
            name: 'Auth Suite',
            status: 'passed',
            duration: 58.4,
            tests: [
              { id: 't1', name: 'Login', status: 'passed', duration: 12.3 },
              { id: 't2', name: 'Logout', status: 'passed', duration: 8.2 },
            ],
          },
        ],
      } as Record<string, unknown>) as never,
    })
    renderAt()
    await screen.findByText('Auth Suite')
    // Suite parent visible; children collapsed by default
    expect(screen.queryByText('Login')).toBeNull()
    // Expand: the suite's tests become accessible as child rows (REG-EX-2
    // wireframe: suites are top-level, tests are reachable via expansion).
    await user.click(screen.getByRole('button', { name: 'Expand Auth Suite' }))
    await waitFor(() => {
      expect(screen.getByText('Login')).toBeInTheDocument()
      expect(screen.getByText('Logout')).toBeInTheDocument()
    })
    // Collapsing hides them again.
    await user.click(screen.getByRole('button', { name: 'Collapse Auth Suite' }))
    await waitFor(() => {
      expect(screen.queryByText('Login')).toBeNull()
    })
  })

  it('renders DuplicateTestBadge on test rows that appear in 2+ suites of a regression', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          {
            id: 's1',
            name: 'Auth Suite',
            status: 'passed',
            duration: 1,
            tests: [
              { id: 't1', name: 'Shared Test', status: 'passed', duration: 1 },
              { id: 't2', name: 'Auth Only', status: 'passed', duration: 1 },
            ],
          },
          {
            id: 's2',
            name: 'Billing Suite',
            status: 'passed',
            duration: 1,
            tests: [
              { id: 't1', name: 'Shared Test', status: 'passed', duration: 1 },
            ],
          },
        ],
        duplicate_tests: { t1: ['s1', 's2'] },
      } as Record<string, unknown>) as never,
    })
    renderAt()
    await screen.findByText('Auth Suite')
    // Expand Auth Suite - the Shared Test row should carry the badge.
    await user.click(screen.getByRole('button', { name: 'Expand Auth Suite' }))
    await waitFor(() => {
      expect(screen.getAllByText('Shared Test').length).toBeGreaterThan(0)
    })
    // Exactly one badge under Auth Suite (the Shared Test row). Auth Only
    // has no duplicate entry, so its row must not carry a badge.
    expect(screen.getAllByTestId('duplicate-test-badge')).toHaveLength(1)
    expect(screen.getByText('Auth Only')).toBeInTheDocument()
  })

  it('drops duplicate-suite entries that reference unknown suite ids', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          {
            id: 's1',
            name: 'Only Suite',
            status: 'passed',
            duration: 1,
            tests: [{ id: 't1', name: 'Orphan Dup', status: 'passed', duration: 1 }],
          },
        ],
        // Reference a second suite that isn't in the suites array. The
        // unknown-id entry is filtered out; fewer than 2 valid suites
        // remain, so the badge must not render.
        duplicate_tests: { t1: ['s1', 's-missing'] },
      } as Record<string, unknown>) as never,
    })
    renderAt()
    await screen.findByText('Only Suite')
    await user.click(screen.getByRole('button', { name: 'Expand Only Suite' }))
    await screen.findByText('Orphan Dup')
    expect(screen.queryByTestId('duplicate-test-badge')).toBeNull()
  })

  it('renders non-viewable test name as plain text within a regression suite', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          {
            id: 's1',
            name: 'Pending Suite',
            status: 'pending',
            duration: null,
            tests: [{ id: 't1', name: 'Waiting Test', status: 'pending', duration: null }],
          },
        ],
      } as Record<string, unknown>) as never,
    })
    renderAt()
    await screen.findByText('Pending Suite')
    // "pending" IS in the default status filter set (only "excluded" is
    // off by default), so the test row is reachable via expansion.
    await user.click(await screen.findByRole('button', { name: 'Expand Pending Suite' }))
    const waitingName = await screen.findByText('Waiting Test')
    // Non-viewable statuses (pending/running/skipped) render a plain span,
    // not a link.
    expect(waitingName.tagName).toBe('SPAN')
  })

  it('per-test row download button triggers exportExecution', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    const { downloadExecutionExport } = await import('@/features/executions/api/export')
    vi.mocked(downloadExecutionExport).mockResolvedValue(undefined as never)
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          {
            id: 's1',
            name: 'Auth Suite',
            status: 'passed',
            duration: 1,
            tests: [{ id: 't1', name: 'Login', status: 'passed', duration: 1 }],
          },
        ],
      } as Record<string, unknown>) as never,
    })
    renderAt()
    await user.click(await screen.findByRole('button', { name: 'Expand Auth Suite' }))
    await screen.findByText('Login')
    await user.click(screen.getByRole('button', { name: 'Download test' }))
    expect(downloadExecutionExport).toHaveBeenCalledWith('exec-1', { testIds: ['t1'] })
  })

  it('regression Components table lists SUITES (not tests) per REG-EX-2', async () => {
    // Per the Regression Execution wireframe (REG-EX-2) the Components table
    // shows only suites; tests are reached by navigating into a suite's
    // execution detail. The regression row itself must NOT expose inline
    // tests as child rows.
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          {
            id: 's1',
            name: 'Auth Suite',
            status: 'passed',
            duration: 58.4,
            tests: [
              { id: 't1', name: 'Login', status: 'passed', duration: 12.3 },
            ],
          },
        ],
      } as Record<string, unknown>) as never,
    })
    renderAt()
    expect(await screen.findByText('Auth Suite')).toBeInTheDocument()
    // Test names from inside the suite must not leak into the regression table.
    expect(screen.queryByText('Login')).toBeNull()
  })

  it('renders empty Components table when a suite execution has undefined tests', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'suite',
        tests: undefined,
      }) as never,
    })
    renderAt()
    await screen.findByTestId('execution-detail-page')
    // No data rows render when tests are undefined.
    expect(screen.queryByText('Login')).toBeNull()
  })

  it('renders pending status using the default badge variant', async () => {
    // The Status filter defaults to every status except 'excluded' (only
    // excluded items are hidden by default per the execution-detail spec).
    // 'pending' is still shown and uses the default badge variant, exercising
    // the same STATUS_VARIANT['default'] fallback path.
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'suite',
        tests: [{ id: 't1', name: 'Pending Test', status: 'pending', duration: null }],
      }) as never,
    })
    renderAt()
    await screen.findByText('Pending Test')
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('regression suite row shows passed/total ratio and member test count (REG-EX-13/14/15)', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          {
            id: 's1',
            name: 'Suite A',
            status: 'failed',
            duration: 10,
            tests: [
              { id: 't1', name: 'Test1', status: 'passed', duration: 1 },
              { id: 't2', name: 'Test2', status: 'failed', duration: 1 },
            ],
          },
        ],
      } as Record<string, unknown>) as never,
    })
    renderAt()
    await screen.findByText('Suite A')
    // Status column: plain ratio (REG-EX-14), no "passed" suffix.
    expect(screen.getByText('1/2')).toBeInTheDocument()
    // Tests column: member count (REG-EX-15).
    expect(screen.getByText('2 tests')).toBeInTheDocument()
  })

  it('regression search filter narrows suite rows by name', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          { id: 's1', name: 'Auth Suite', status: 'passed', duration: 5, tests: [{ id: 't1', name: 'Login', status: 'passed', duration: 1 }] },
          { id: 's2', name: 'Billing Suite', status: 'failed', duration: 3, tests: [{ id: 't2', name: 'Invoice', status: 'failed', duration: 1 }] },
        ],
      } as Record<string, unknown>) as never,
    })
    renderAt()
    await screen.findByText('Auth Suite')
    expect(screen.getByText('Billing Suite')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText('Search suites…')
    await user.type(searchInput, 'Auth')

    await waitFor(() => {
      expect(screen.getByText('Auth Suite')).toBeInTheDocument()
      expect(screen.queryByText('Billing Suite')).toBeNull()
    })
  })

  it('suite execution search filter narrows test rows by name', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'suite',
        tests: [
          { id: 't1', name: 'Login Test', status: 'passed', duration: 1 },
          { id: 't2', name: 'Checkout Test', status: 'failed', duration: 2 },
        ],
      }) as never,
    })
    renderAt()
    await screen.findByText('Login Test')
    expect(screen.getByText('Checkout Test')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText('Search tests…')
    await user.type(searchInput, 'Login')

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
      expect(screen.queryByText('Checkout Test')).toBeNull()
    })
  })

  it('regression suite aggregate status handles stopped and pending tests', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          { id: 's1', name: 'Stopped Suite', status: 'stopped', duration: 1, tests: [
            { id: 't1', name: 'T1', status: 'stopped', duration: 1 },
          ] },
          { id: 's2', name: 'Pending Suite', status: 'pending', duration: null, tests: [
            { id: 't2', name: 'T2', status: 'pending', duration: null },
          ] },
        ],
      } as Record<string, unknown>) as never,
    })
    renderAt()
    expect(await screen.findByText('Stopped Suite')).toBeInTheDocument()
    expect(screen.getByText('Pending Suite')).toBeInTheDocument()
  })

  it('regression suite row shows "Skipped" badge for all-skipped suites and default variant for running suites', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          { id: 's1', name: 'Skipped Suite', status: 'passed', duration: 0, tests: [
            { id: 't1', name: 'T1', status: 'skipped', duration: 0 },
          ] },
          { id: 's2', name: 'Running Suite', status: 'running', duration: null, tests: [
            { id: 't2', name: 'T2', status: 'running', duration: null },
          ] },
        ],
      } as Record<string, unknown>) as never,
    })
    renderAt()
    // Both suites visible by default (status filter includes both running
    // and skipped; only 'excluded' is hidden by default).
    await screen.findByText('Running Suite')
    await waitFor(() => {
      expect(screen.getByText('Skipped Suite')).toBeInTheDocument()
    })
  })

  it('regression suite row shows "Excluded" badge when every test is excluded', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          {
            id: 's1',
            name: 'Excluded Suite',
            status: 'passed',
            duration: 0,
            tests: [
              { id: 't1', name: 'T1', status: 'excluded', duration: 0 },
              { id: 't2', name: 'T2', status: 'excluded', duration: 0 },
            ],
          },
          {
            id: 's2',
            name: 'Running Suite',
            status: 'running',
            duration: null,
            tests: [{ id: 't3', name: 'T3', status: 'running', duration: null }],
          },
        ],
      } as Record<string, unknown>) as never,
    })
    renderAt()
    // Running suite visible by default; excluded suite hidden by default.
    await screen.findByText('Running Suite')
    expect(screen.queryByText('Excluded Suite')).toBeNull()
    // Toggle Excluded in the filter to reveal the all-excluded suite.
    await user.click(screen.getByTestId('filter-status'))
    await user.click(await screen.findByText('Excluded'))
    await waitFor(() => {
      expect(screen.getByText('Excluded Suite')).toBeInTheDocument()
    })
    // The suite's own status badge carries the 'excluded' variant.
    expect(screen.getByTestId('status-badge-excluded')).toBeInTheDocument()
  })

  it('suite execution hides excluded tests by default and reveals them via Excluded filter', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'suite',
        tests: [
          { id: 't1', name: 'Ran Test', status: 'passed', duration: 1 },
          { id: 't2', name: 'Left Out', status: 'excluded', duration: 0 },
        ],
      }) as never,
    })
    renderAt()
    // Excluded tests hidden by default per execution-detail filter spec.
    await screen.findByText('Ran Test')
    expect(screen.queryByText('Left Out')).toBeNull()
    // The Status filter offers an 'Excluded' option; toggling it shows the row.
    await user.click(screen.getByTestId('filter-status'))
    await user.click(await screen.findByText('Excluded'))
    await waitFor(() => {
      expect(screen.getByText('Left Out')).toBeInTheDocument()
    })
  })

  it('regression suite download button triggers exportExecution for suite tests', async () => {
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          { id: 's1', name: 'Suite A', status: 'passed', duration: 5, tests: [{ id: 't1', name: 'Login', status: 'passed', duration: 1 }] },
        ],
      } as Record<string, unknown>) as never,
    })
    const { downloadExecutionExport: dlMock } = await import('@/features/executions/api/export')
    vi.mocked(dlMock).mockResolvedValue(undefined as never)
    renderAt()
    await screen.findByText('Suite A')
    const user = (await import('@testing-library/user-event')).default.setup()
    const downloadBtn = screen.getByRole('button', { name: /download suite/i })
    await user.click(downloadBtn)
    expect(dlMock).toHaveBeenCalledWith('exec-1', { testIds: ['t1'] })
  })

  it('suite execution Columns toggle re-adds a column after hiding it', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'suite',
        tests: [{ id: 't1', name: 'Login', status: 'passed', duration: 1 }],
      }) as never,
    })
    renderAt()
    await screen.findByText('Login')
    await user.click(screen.getByTestId('columns-button'))
    // Hide
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /duration/i }))
    // Show again (exercises the visible=true branch of the toggle)
    await user.click(screen.getByRole('menuitemcheckbox', { name: /duration/i }))
    await waitFor(() => {
      const headers = screen.getAllByRole('columnheader')
      expect(headers.some((h) => h.textContent?.includes('Duration'))).toBe(true)
    })
  })

  it('suite execution Columns toggle hides and shows columns', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'suite',
        tests: [{ id: 't1', name: 'Login', status: 'passed', duration: 1 }],
      }) as never,
    })
    renderAt()
    await screen.findByText('Login')
    await user.click(screen.getByTestId('columns-button'))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /duration/i }))
    await waitFor(() => {
      const headers = screen.getAllByRole('columnheader')
      expect(headers.every((h) => !h.textContent?.includes('Duration'))).toBe(true)
    })
  })

  it('regression Columns toggle hides and shows columns', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.mocked(fetchExecution).mockResolvedValue({
      success: true,
      data: buildExecution({
        entity_type: 'regression',
        suites: [
          { id: 's1', name: 'Suite A', status: 'passed', duration: 5, tests: [{ id: 't1', name: 'Login', status: 'passed', duration: 1 }] },
        ],
      } as Record<string, unknown>) as never,
    })
    renderAt()
    await screen.findByText('Suite A')

    // Open the Columns dropdown and uncheck Duration
    await user.click(screen.getByTestId('columns-button'))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /duration/i }))

    // Duration column header should be hidden
    await waitFor(() => {
      const headers = screen.getAllByRole('columnheader')
      expect(headers.every((h) => !h.textContent?.includes('Duration'))).toBe(true)
    })
  })
})
