/**
 * ReportSummaryHeader Tests
 *
 * Summary card per RVIEW-4/RVIEW-5: meta grid (Environment, Triggered By,
 * Started, Duration, Execution ID untruncated mono, Ended), "Report
 * generated" aside, and count cards - 7 run-count cards for suite or
 * regression executions, 6 block-derived cards for test executions where
 * pending blocks surface as "Not Run".
 *
 * Module: frontend/src/features/reports/detail/report-summary-header.tsx
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type {
  ReportExecutionInfo,
  ReportSummary,
  ReportTimelineBlock,
} from '@/features/reports/api/types'
import { listedBlocks } from '@/features/reports/lib/report-block-rows'
import { ReportSummaryHeader } from '@/features/reports/detail/report-summary-header'

const SUITE_EXECUTION: ReportExecutionInfo = {
  id: '3f2a6c1e-58f4-4f2e-9a3b-1c2d3e4f5a6b',
  name: 'Nightly API Suite',
  entity_type: 'suite',
  entity_id: 'suite-1',
  environment: 'Staging',
  triggered_by: 'dev',
  status: 'failed',
  started_at: '2026-06-10T11:06:52+00:00',
  ended_at: '2026-06-10T11:07:13+00:00',
  duration: 21,
}

const SUITE_SUMMARY: ReportSummary = {
  status: 'failed',
  duration: 21,
  counts: {
    total: 5,
    passed: 2,
    failed: 1,
    skipped: 1,
    stopped: 0,
    excluded: 1,
    pending: 0,
  },
}

const TEST_BLOCKS: ReportTimelineBlock[] = [
  { order: 1, block_id: 'b1', block_path: 'Init_Session', status: 'passed', started_at: null, ended_at: null, duration: null },
  { order: 2, block_id: 'b2', block_path: 'Poll_Sync_Status', status: 'passed', started_at: null, ended_at: null, duration: null },
  { order: 3, block_id: 'b3', block_path: 'Validate', status: 'failed', started_at: null, ended_at: null, duration: null },
  { order: 4, block_id: 'b4', block_path: 'Cleanup_Tmp', status: 'pending', started_at: null, ended_at: null, duration: null },
  { order: 5, block_id: 'b5', block_path: 'Notify', status: 'pending', started_at: null, ended_at: null, duration: null },
]

function renderHeader(overrides: Partial<Parameters<typeof ReportSummaryHeader>[0]> = {}) {
  return render(
    <ReportSummaryHeader
      summary={SUITE_SUMMARY}
      execution={SUITE_EXECUTION}
      blocks={[]}
      generatedAt="2026-06-10T11:30:00+00:00"
      {...overrides}
    />,
  )
}

/** Every recorded outcome plus two steps the run never reached. */
const MIXED_OUTCOME_BLOCKS: ReportTimelineBlock[] = [
  ...TEST_BLOCKS,
  { order: 6, block_id: 'b6', block_path: 'Assert_Total', status: 'warning', started_at: null, ended_at: null, duration: null },
  { order: 7, block_id: 'b7', block_path: 'Teardown', status: 'skipped', started_at: null, ended_at: null, duration: null },
  { order: 8, block_id: 'b8', block_path: 'Archive', status: 'stopped', started_at: null, ended_at: null, duration: null },
]

function cardValue(key: string): number {
  return Number(screen.getByTestId(`summary-count-${key}`).firstElementChild?.textContent)
}

function cards(): Element[] {
  return Array.from(
    screen.getByTestId('report-summary').querySelectorAll('[data-testid^="summary-count-"]'),
  )
}

function cardLabels(): (string | null)[] {
  return cards().map((card) => card.lastElementChild?.textContent ?? null)
}

/** Every count card except the total, which the tiles must sum to. */
function tileValues(): number[] {
  return cards()
    .filter((card) => card.getAttribute('data-testid') !== 'summary-count-total')
    .map((card) => Number(card.firstElementChild?.textContent))
}

function tileSum(): number {
  return tileValues().reduce((sum, value) => sum + value, 0)
}

describe('ReportSummaryHeader - meta grid', () => {
  it('renders environment, triggered by, started, duration, execution id, and ended', () => {
    renderHeader()

    const summary = screen.getByTestId('report-summary')
    expect(summary).toHaveTextContent('Environment')
    expect(summary).toHaveTextContent('Staging')
    expect(summary).toHaveTextContent('Triggered By')
    expect(summary).toHaveTextContent('dev')
    expect(summary).toHaveTextContent('Started')
    expect(summary).toHaveTextContent('Duration')
    expect(summary).toHaveTextContent('Ended')
    expect(summary).toHaveTextContent('Execution ID')
  })

  it('renders the full execution id untruncated in a mono span', () => {
    renderHeader()

    const id = screen.getByText('3f2a6c1e-58f4-4f2e-9a3b-1c2d3e4f5a6b')
    expect(id.className).toContain('font-mono')
  })

  it('renders the "Report generated" aside', () => {
    renderHeader()

    expect(screen.getByTestId('report-generated-at')).toHaveTextContent(/Report generated/)
  })

  it('renders a dash for a missing environment', () => {
    renderHeader({ execution: { ...SUITE_EXECUTION, environment: null } })

    expect(screen.getByTestId('report-summary')).toHaveTextContent('Environment')
  })
})

describe('ReportSummaryHeader - suite/regression count cards', () => {
  it('renders the 7 run-count cards with values from summary.counts', () => {
    renderHeader()

    expect(screen.getByTestId('summary-count-total')).toHaveTextContent('5')
    expect(screen.getByTestId('summary-count-total')).toHaveTextContent('Tests')
    expect(screen.getByTestId('summary-count-passed')).toHaveTextContent('2')
    expect(screen.getByTestId('summary-count-failed')).toHaveTextContent('1')
    expect(screen.getByTestId('summary-count-skipped')).toHaveTextContent('1')
    expect(screen.getByTestId('summary-count-stopped')).toHaveTextContent('0')
    expect(screen.getByTestId('summary-count-excluded')).toHaveTextContent('1')
    expect(screen.getByTestId('summary-count-pending')).toHaveTextContent('0')
  })

  it('mutes zero-value cards', () => {
    renderHeader()

    const stopped = screen.getByTestId('summary-count-stopped')
    expect(within(stopped).getByText('0').className).toContain('muted')
  })
})

describe('ReportSummaryHeader - test count cards', () => {
  it('derives 6 block-count cards from the timeline blocks for test executions', () => {
    renderHeader({
      execution: { ...SUITE_EXECUTION, entity_type: 'test' },
      blocks: TEST_BLOCKS,
    })

    expect(screen.getByTestId('summary-count-total')).toHaveTextContent('Total')
    expect(screen.getByTestId('summary-count-total')).not.toHaveTextContent('Blocks')
    expect(cardValue('total')).toBe(3)
    expect(screen.getByTestId('summary-count-passed')).toHaveTextContent('2')
    expect(screen.getByTestId('summary-count-failed')).toHaveTextContent('1')
    expect(screen.getByTestId('summary-count-warning')).toHaveTextContent('0')
    expect(screen.getByTestId('summary-count-skipped')).toHaveTextContent('0')
    expect(screen.getByTestId('summary-count-stopped')).toHaveTextContent('0')
    expect(screen.queryByTestId('summary-count-excluded')).toBeNull()
    expect(screen.queryByTestId('summary-count-pending')).toBeNull()
    expect(screen.queryByTestId('summary-count-not-run')).toBeNull()
  })

  it('orders the block tiles by severity, with Warning beside Failed', () => {
    renderHeader({
      execution: { ...SUITE_EXECUTION, entity_type: 'test' },
      blocks: MIXED_OUTCOME_BLOCKS,
    })

    expect(cardLabels()).toEqual(['Total', 'Passed', 'Failed', 'Warning', 'Skipped', 'Stopped'])
  })

  it('counts a step that ended with a warning under Warning', () => {
    renderHeader({
      execution: { ...SUITE_EXECUTION, entity_type: 'test' },
      blocks: MIXED_OUTCOME_BLOCKS,
    })

    expect(cardValue('warning')).toBe(1)
  })

  it('excludes never-reached steps from the total', () => {
    renderHeader({
      execution: { ...SUITE_EXECUTION, entity_type: 'test' },
      blocks: TEST_BLOCKS,
    })

    expect(cardValue('total')).toBe(listedBlocks(TEST_BLOCKS).length)
    expect(cardValue('total')).toBeLessThan(TEST_BLOCKS.length)
    expect(cardLabels()).not.toContain('Not Run')
  })

  it('leaves a step with no recorded outcome out of both the tiles and the total', () => {
    renderHeader({
      execution: { ...SUITE_EXECUTION, entity_type: 'test' },
      blocks: [TEST_BLOCKS[0], { ...TEST_BLOCKS[3], status: '' }],
    })

    expect(tileSum()).toBe(1)
    expect(cardValue('total')).toBe(1)
  })

  it('makes the total the sum of the outcome tiles, once each', () => {
    renderHeader({
      execution: { ...SUITE_EXECUTION, entity_type: 'test' },
      blocks: MIXED_OUTCOME_BLOCKS,
    })

    expect(tileSum()).toBe(cardValue('total'))
    expect(tileSum()).toBe(listedBlocks(MIXED_OUTCOME_BLOCKS).length)
    expect(cardValue('total')).toBeLessThan(MIXED_OUTCOME_BLOCKS.length)
  })
})
