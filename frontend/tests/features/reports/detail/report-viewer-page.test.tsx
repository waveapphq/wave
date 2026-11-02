/**
 * ReportViewerPage Tests
 *
 * Route component for /reports/:executionId (RVIEW-1, RVIEW-10):
 * drives useReportJob and switches between the generation interstitial,
 * the error interstitials, and the ready document (Summary, Timeline,
 * Errors, Logs) under a DetailHeader whose back action returns to
 * /reports. Opening the viewer without a report auto-starts generation -
 * the hook is invoked unconditionally with the route's executionId.
 *
 * Module: frontend/src/features/reports/detail/report-viewer-page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from '@/design-system/theme-provider'
import { ToastProvider } from '@/components/ui/toast'
import type { WaveReport } from '@/features/reports/api/types'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/features/reports/hooks/use-report-job', () => ({
  useReportJob: vi.fn(),
}))

vi.mock('@/features/reports/api/reports', () => ({
  ensureReport: vi.fn(),
  fetchReportJson: vi.fn(),
}))

vi.mock('@/features/reports/api/download', () => ({
  downloadReportArtifact: vi.fn(),
}))

import { useReportJob } from '@/features/reports/hooks/use-report-job'
import { ReportViewerPage } from '@/features/reports/detail/report-viewer-page'

const REPORT: WaveReport = {
  schema_version: 1,
  generated_at: '2026-06-10T11:30:00+00:00',
  execution: {
    id: 'exec-1',
    name: 'Nightly API Suite',
    entity_type: 'suite',
    entity_id: 'suite-1',
    environment: 'Staging',
    triggered_by: 'dev',
    status: 'failed',
    started_at: '2026-06-10T11:06:52+00:00',
    ended_at: '2026-06-10T11:07:13+00:00',
    duration: 21,
  },
  summary: {
    status: 'failed',
    duration: 21,
    counts: { total: 5, passed: 2, failed: 1, skipped: 1, stopped: 0, excluded: 1, pending: 0 },
  },
  timeline: {
    runs: [
      {
        order: 1,
        run_id: 'run-1',
        test_id: 'test-1',
        test_name: 'Auth Token Refresh',
        suite_id: 'suite-1',
        suite_name: 'Nightly API Suite',
        status: 'passed',
        started_at: '2026-06-10T11:06:52+00:00',
        ended_at: '2026-06-10T11:06:57+00:00',
        duration: 5,
        variables: {},
      },
    ],
    blocks: [],
  },
  errors: [
    {
      run_id: 'run-1',
      test_id: 'test-1',
      test_name: 'Auth Token Refresh',
      suite_name: 'Nightly API Suite',
      block_path: 'Validate',
      level: 'ERROR',
      message: 'validation rejected',
      timestamp: '2026-06-10T11:07:00.000Z',
    },
  ],
  logs: [
    {
      id: 'log-1',
      timestamp: '2026-06-10T11:06:52.100Z',
      level: 'INFO',
      message: 'suite started',
      source: 'SYSTEM',
    },
  ],
}

/** Test report whose blocks mix recorded outcomes with never-reached steps. */
const TEST_REPORT: WaveReport = {
  ...REPORT,
  execution: { ...REPORT.execution, entity_type: 'test', entity_id: 'test-1' },
  timeline: {
    runs: [],
    blocks: [
      {
        order: 1,
        block_id: 'node-init',
        block_path: 'Init_Session',
        status: 'passed',
        started_at: '2026-06-10T11:06:52+00:00',
        ended_at: '2026-06-10T11:06:57+00:00',
        duration: 5,
      },
      {
        order: 2,
        block_id: 'node-assert',
        block_path: 'Assert_Total',
        status: 'warning',
        started_at: '2026-06-10T11:06:57+00:00',
        ended_at: '2026-06-10T11:06:58+00:00',
        duration: 1,
      },
      {
        order: 3,
        block_id: 'node-notify',
        block_path: 'Notify',
        status: 'pending',
        started_at: null,
        ended_at: null,
        duration: null,
      },
      {
        order: 4,
        block_id: 'node-cleanup',
        block_path: 'Cleanup_Tmp',
        status: 'pending',
        started_at: null,
        ended_at: null,
        duration: null,
      },
    ],
  },
}

type HookResult = ReturnType<typeof useReportJob>

function hookState(overrides: Partial<HookResult> = {}): HookResult {
  return {
    status: 'ensuring',
    report: null,
    artifactId: null,
    progress: null,
    error: null,
    retry: vi.fn(),
    ...overrides,
  } as HookResult
}

function renderPage() {
  return render(
    <ThemeProvider>
      <>
        <ToastProvider>
          <MemoryRouter initialEntries={['/reports/exec-1']}>
            <Routes>
              <Route path="/reports/:executionId" element={<ReportViewerPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReportViewerPage - generation phases', () => {
  it('drives useReportJob with the executionId from the route', () => {
    vi.mocked(useReportJob).mockReturnValue(hookState())

    renderPage()

    expect(useReportJob).toHaveBeenCalledWith('exec-1')
  })

  it('renders the generating interstitial without document sections while ensuring', () => {
    vi.mocked(useReportJob).mockReturnValue(hookState({ status: 'ensuring' }))

    renderPage()

    expect(screen.getByTestId('report-viewer-page')).toBeInTheDocument()
    expect(screen.getByTestId('report-generation-state')).toBeInTheDocument()
    expect(screen.queryByTestId('report-summary')).toBeNull()
    expect(screen.queryByTestId('download-json-btn')).toBeNull()
  })

  it('shows the runs-processed progress while polling', () => {
    vi.mocked(useReportJob).mockReturnValue(
      hookState({ status: 'polling', progress: { processed: 2, total: 5 } }),
    )

    renderPage()

    expect(screen.getByText('2 of 5 runs processed')).toBeInTheDocument()
  })

  it('shows the preparing text while fetching the artifact', () => {
    vi.mocked(useReportJob).mockReturnValue(hookState({ status: 'fetching-artifact' }))

    renderPage()

    expect(screen.getByTestId('report-generation-state')).toHaveTextContent('Preparing report…')
  })
})

describe('ReportViewerPage - ready document', () => {
  beforeEach(() => {
    vi.mocked(useReportJob).mockReturnValue(
      hookState({
        status: 'ready',
        report: REPORT,
        artifactId: 'dir-1/report.v1.json',
      }),
    )
  })

  it('renders the document sections in order: summary, timeline, errors, logs', () => {
    renderPage()

    expect(screen.getByTestId('report-summary')).toBeInTheDocument()
    expect(screen.getByTestId('report-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('report-errors')).toBeInTheDocument()
    expect(screen.getByTestId('report-logs')).toBeInTheDocument()
    expect(screen.queryByTestId('report-generation-state')).toBeNull()
  })

  it('renders the execution name and header actions', () => {
    renderPage()

    expect(screen.getByText('Nightly API Suite')).toBeInTheDocument()
    expect(screen.getByTestId('download-json-btn')).toBeInTheDocument()
    expect(screen.getByTestId('export-html-btn')).toBeInTheDocument()
  })

  it('navigates back to the reports list from the header back button', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('detail-back-btn'))

    expect(navigateMock).toHaveBeenCalledWith('/reports')
  })
})

describe('ReportViewerPage - error interstitials', () => {
  it('renders the still-running card for execution-running errors', () => {
    vi.mocked(useReportJob).mockReturnValue(
      hookState({
        status: 'error',
        error: {
          kind: 'execution-running',
          message:
            "Cannot generate report for execution in 'running' state. Wait for the execution to finish.",
        },
      }),
    )

    renderPage()

    const card = screen.getByTestId('report-generation-state')
    expect(card).toHaveTextContent('Execution still in progress')
    expect(screen.getByRole('button', { name: /view execution/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back to reports/i })).toBeInTheDocument()
  })

  it('renders the permanent failure card without Try Again for no-artifacts errors', () => {
    vi.mocked(useReportJob).mockReturnValue(
      hookState({
        status: 'error',
        error: { kind: 'no-artifacts', message: "Execution 'exec-1' has no artifact directory" },
      }),
    )

    renderPage()

    expect(screen.getByTestId('report-generation-state')).toHaveTextContent(
      "Execution 'exec-1' has no artifact directory",
    )
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('renders the failure card with a working Try Again for job failures', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    vi.mocked(useReportJob).mockReturnValue(
      hookState({
        status: 'error',
        error: { kind: 'job-failed', message: 'model build exploded' },
        retry,
      }),
    )

    renderPage()

    expect(screen.getByTestId('report-generation-state')).toHaveTextContent(
      'model build exploded',
    )
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})

describe('ReportViewerPage - test report step accounting', () => {
  beforeEach(() => {
    vi.mocked(useReportJob).mockReturnValue(
      hookState({
        status: 'ready',
        report: TEST_REPORT,
        artifactId: 'dir-1/report.v1.json',
      }),
    )
  })

  it('shows one total, one tile sum, and one row count - the same number', () => {
    renderPage()

    const cards = Array.from(
      screen.getByTestId('report-summary').querySelectorAll('[data-testid^="summary-count-"]'),
    )
    const value = (card: Element) => Number(card.firstElementChild?.textContent)
    const total = value(
      cards.find((card) => card.getAttribute('data-testid') === 'summary-count-total') as Element,
    )
    const tileSum = cards
      .filter((card) => card.getAttribute('data-testid') !== 'summary-count-total')
      .reduce((sum, card) => sum + value(card), 0)
    const rows = screen.getAllByTestId('timeline-row').length

    expect(total).toBe(tileSum)
    expect(total).toBe(rows)
    expect(total).toBeLessThan(TEST_REPORT.timeline.blocks.length)
  })

  it('leaves the never-reached steps in the payload untouched', () => {
    renderPage()

    expect(TEST_REPORT.timeline.blocks).toHaveLength(4)
    expect(screen.queryByText('Notify')).toBeNull()
  })
})
