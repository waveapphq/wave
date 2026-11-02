/**
 * ReportTimeline Tests
 *
 * Merged gantt per RVIEW-6/RVIEW-7: one labeled row per run (suite and
 * regression executions) or per block (test executions) with a
 * percent-positioned status bar over a shared axis. Run names link to
 * the historical canvas; block names are plain text with a muted parent
 * path prefix. Rows missing ended_at extend to the domain end at
 * reduced opacity.
 *
 * Module: frontend/src/features/reports/detail/report-timeline.tsx
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type {
  ReportTimelineBlock,
  ReportTimelineRun,
} from '@/features/reports/api/types'
import { ReportTimeline } from '@/features/reports/detail/report-timeline'

const RUNS: ReportTimelineRun[] = [
  {
    order: 1,
    run_id: 'run-1',
    test_id: 'test-1',
    test_name: 'Auth Token Refresh',
    suite_id: 'suite-1',
    suite_name: 'Nightly API Suite',
    status: 'passed',
    started_at: '2026-06-10T11:00:00+00:00',
    ended_at: '2026-06-10T11:00:10+00:00',
    duration: 10,
    variables: {},
  },
  {
    order: 2,
    run_id: 'run-2',
    test_id: 'test-2',
    test_name: 'Order Pipeline Smoke',
    suite_id: 'suite-1',
    suite_name: 'Nightly API Suite',
    status: 'failed',
    started_at: '2026-06-10T11:00:10+00:00',
    ended_at: '2026-06-10T11:00:40+00:00',
    duration: 30,
    variables: {},
  },
  {
    order: 3,
    run_id: 'run-3',
    test_id: 'test-3',
    test_name: 'Cluster Failover Recovery',
    suite_id: 'suite-2',
    suite_name: 'Platform Health Suite',
    status: 'stopped',
    started_at: '2026-06-10T11:00:20+00:00',
    ended_at: null,
    duration: null,
    variables: {},
  },
]

const BLOCKS: ReportTimelineBlock[] = [
  {
    order: 1,
    block_id: 'node-init',
    block_path: 'Init_Session',
    status: 'passed',
    started_at: '2026-06-10T11:00:00+00:00',
    ended_at: '2026-06-10T11:00:05+00:00',
    duration: 5,
  },
  {
    order: 2,
    block_id: 'node-fetch',
    block_path: 'Poll_Sync_Status / Fetch_Status',
    status: 'failed',
    started_at: '2026-06-10T11:00:05+00:00',
    ended_at: '2026-06-10T11:00:40+00:00',
    duration: 35,
  },
]

function renderTimeline(props: Partial<Parameters<typeof ReportTimeline>[0]> = {}) {
  return render(
    <MemoryRouter>
      <>
        <ReportTimeline runs={RUNS} blocks={[]} entityType="suite" {...props} />
      </>
    </MemoryRouter>,
  )
}

describe('ReportTimeline - runs mode (suite/regression)', () => {
  it('renders one row per run inside the timeline section', () => {
    renderTimeline()

    const timeline = screen.getByTestId('report-timeline')
    expect(within(timeline).getAllByTestId('timeline-row')).toHaveLength(3)
  })

  it('links each run name to its historical canvas page', () => {
    renderTimeline()

    const link = screen.getByRole('link', { name: /Auth Token Refresh/ })
    expect(link).toHaveAttribute('href', '/executions/history/run-1')
  })

  it('gives row links an accessible name carrying name, status, and duration', () => {
    renderTimeline()

    expect(
      screen.getByRole('link', { name: 'Auth Token Refresh, passed, 10s' }),
    ).toBeInTheDocument()
  })

  it('renders the duration on each row', () => {
    renderTimeline()

    const rows = screen.getAllByTestId('timeline-row')
    expect(rows[1]).toHaveTextContent('30s')
  })

  it('positions bars by percent within the shared domain', () => {
    renderTimeline()

    const bars = screen.getAllByTestId('timeline-bar')
    expect(bars[0].getAttribute('style')).toMatch(/width:\s*25%/)
    expect(bars[1].getAttribute('style')).toMatch(/left:\s*25%/)
    expect(bars[1].getAttribute('style')).toMatch(/width:\s*75%/)
  })

  it('extends a row missing ended_at to the domain end at reduced opacity', () => {
    renderTimeline()

    const bars = screen.getAllByTestId('timeline-bar')
    expect(bars[2].className).toContain('opacity')
    expect(bars[2].getAttribute('style')).toMatch(/left:\s*50%/)
    expect(bars[2].getAttribute('style')).toMatch(/width:\s*50%/)
  })

  it('renders the axis with the domain start and end timestamps', () => {
    renderTimeline()

    expect(screen.getByTestId('timeline-axis')).toBeInTheDocument()
  })
})

describe('ReportTimeline - blocks mode (test)', () => {
  it('renders one row per block without links', () => {
    renderTimeline({ runs: [], blocks: BLOCKS, entityType: 'test' })

    expect(screen.getAllByTestId('timeline-row')).toHaveLength(2)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('renders nested block paths with a muted parent prefix and the leaf name', () => {
    renderTimeline({ runs: [], blocks: BLOCKS, entityType: 'test' })

    const prefix = screen.getByTestId('timeline-path-prefix')
    expect(prefix).toHaveTextContent('Poll_Sync_Status /')
    expect(prefix.className).toContain('muted')
    expect(screen.getByText('Fetch_Status')).toBeInTheDocument()
  })

  it('renders top-level blocks without a path prefix', () => {
    renderTimeline({ runs: [], blocks: BLOCKS, entityType: 'test' })

    const rows = screen.getAllByTestId('timeline-row')
    expect(within(rows[0]).queryByTestId('timeline-path-prefix')).toBeNull()
    expect(rows[0]).toHaveTextContent('Init_Session')
  })
})

const MIXED_BLOCKS: ReportTimelineBlock[] = [
  {
    order: 1,
    block_id: 'node-init',
    block_path: 'Init_Session',
    status: 'passed',
    started_at: '2026-06-10T11:00:00+00:00',
    ended_at: '2026-06-10T11:00:05+00:00',
    duration: 5,
  },
  {
    order: 2,
    block_id: 'node-fetch',
    block_path: 'Fetch_Status',
    status: 'pending',
    started_at: null,
    ended_at: null,
    duration: null,
  },
  {
    order: 3,
    block_id: 'node-cleanup',
    block_path: 'Cleanup_Tmp',
    status: 'skipped',
    started_at: '2026-06-10T11:00:05+00:00',
    ended_at: '2026-06-10T11:00:05+00:00',
    duration: 0,
  },
  {
    order: 4,
    block_id: 'node-notify',
    block_path: 'Notify',
    status: 'pending',
    started_at: null,
    ended_at: null,
    duration: null,
  },
  {
    order: 5,
    block_id: 'node-validate',
    block_path: 'Validate',
    status: 'failed',
    started_at: '2026-06-10T11:00:05+00:00',
    ended_at: '2026-06-10T11:00:40+00:00',
    duration: 35,
  },
]

function renderMixedTest() {
  return renderTimeline({ runs: [], blocks: MIXED_BLOCKS, entityType: 'test' })
}

function rowNumbers(): (string | null)[] {
  return screen
    .getAllByTestId('timeline-row')
    .map((row) => within(row).getAllByRole('cell')[0].textContent)
}

describe('ReportTimeline - steps the run never reached', () => {
  it('lists only the steps that ended with a recorded outcome', () => {
    renderMixedTest()

    const names = screen
      .getAllByTestId('timeline-row')
      .map((row) => within(row).getAllByRole('cell')[1].textContent)
    expect(names).toEqual(['Init_Session', 'Cleanup_Tmp', 'Validate'])
  })

  it('does not list a step the run never reached', () => {
    renderMixedTest()

    expect(screen.queryByText('Notify')).toBeNull()
    expect(screen.queryByText('Fetch_Status')).toBeNull()
  })

  it('keeps a deliberately skipped step in the list', () => {
    renderMixedTest()

    const rows = screen.getAllByTestId('timeline-row')
    expect(rows[1]).toHaveTextContent('Cleanup_Tmp')
    expect(rows[1]).toHaveTextContent('Skipped')
  })

  it('numbers the listed steps contiguously', () => {
    renderMixedTest()

    expect(rowNumbers()).toEqual(['1', '2', '3'])
  })

  it('labels a step that raised a warning, matching the exported document', () => {
    renderTimeline({
      runs: [],
      blocks: [{ ...MIXED_BLOCKS[0], status: 'warning' }],
      entityType: 'test',
    })

    const row = screen.getAllByTestId('timeline-row')[0]
    expect(row).toHaveTextContent('Warning')
    expect(row).not.toHaveTextContent('warning')
  })

  it('charts exactly the steps the table lists', () => {
    renderMixedTest()

    expect(screen.getAllByTestId('timeline-bar')).toHaveLength(
      screen.getAllByTestId('timeline-row').length,
    )
  })

  it('never says Pending in a test report step list', () => {
    renderMixedTest()

    expect(screen.getByTestId('report-timeline')).not.toHaveTextContent('Pending')
  })

  it('drops a step carrying no outcome the report recognizes', () => {
    renderTimeline({
      runs: [],
      blocks: [MIXED_BLOCKS[0], { ...MIXED_BLOCKS[1], status: '' }],
      entityType: 'test',
    })

    expect(screen.getAllByTestId('timeline-row')).toHaveLength(1)
  })

  it('falls back to the empty state when the run reached nothing', () => {
    renderTimeline({
      runs: [],
      blocks: [MIXED_BLOCKS[1], MIXED_BLOCKS[3]],
      entityType: 'test',
    })

    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument()
    expect(screen.queryAllByTestId('timeline-row')).toHaveLength(0)
  })
})

describe('ReportTimeline - suite rows are untouched', () => {
  it('keeps listing a test run that never got to run', () => {
    renderTimeline({
      runs: [
        RUNS[0],
        {
          ...RUNS[1],
          status: 'pending',
          started_at: null,
          ended_at: null,
          duration: null,
        },
      ],
      blocks: [],
      entityType: 'suite',
    })

    const rows = screen.getAllByTestId('timeline-row')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('Pending')
  })
})

describe('ReportTimeline - empty', () => {
  it('renders an empty state when there are no rows', () => {
    renderTimeline({ runs: [], blocks: [], entityType: 'suite' })

    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument()
    expect(screen.queryAllByTestId('timeline-row')).toHaveLength(0)
  })
})
