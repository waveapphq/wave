/**
 * ReportErrorsTable Tests
 *
 * Error cards per RVIEW-8: bordered card per ERROR/FATAL record with a
 * level badge, bold block path, mono timestamp, and the red message
 * line; a success-tinted "No errors recorded" empty state otherwise.
 *
 * Module: frontend/src/features/reports/detail/report-errors-table.tsx
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ReportError } from '@/features/reports/api/types'
import { ReportErrorsTable } from '@/features/reports/detail/report-errors-table'

const ERRORS: ReportError[] = [
  {
    run_id: 'run-3',
    test_id: 'test-3',
    test_name: 'Inventory Sync Validation',
    suite_name: 'Nightly API Suite',
    block_path: 'Validate_Stock_Levels',
    level: 'ERROR',
    message: 'Downstream validation rejected payload: expected 412 rows, got 409',
    timestamp: '2026-06-10T11:07:06.500Z',
  },
  {
    run_id: 'run-3',
    test_id: 'test-3',
    test_name: 'Inventory Sync Validation',
    suite_name: 'Nightly API Suite',
    block_path: 'Reconcile_Totals',
    level: 'FATAL',
    message: 'Reconciliation aborted: settlement total mismatch exceeds tolerance',
    timestamp: '2026-06-10T11:07:06.800Z',
  },
]

describe('ReportErrorsTable - populated', () => {
  it('renders one card per error inside the errors section', () => {
    render(<ReportErrorsTable errors={ERRORS} />)

    const section = screen.getByTestId('report-errors')
    expect(within(section).getAllByTestId('error-card')).toHaveLength(2)
  })

  it('renders the level badge per card, including FATAL', () => {
    render(<ReportErrorsTable errors={ERRORS} />)

    const cards = screen.getAllByTestId('error-card')
    expect(within(cards[0]).getByText('ERROR')).toBeInTheDocument()
    expect(within(cards[1]).getByText('FATAL')).toBeInTheDocument()
  })

  it('renders the block path and the message', () => {
    render(<ReportErrorsTable errors={ERRORS} />)

    const cards = screen.getAllByTestId('error-card')
    expect(cards[0]).toHaveTextContent('Validate_Stock_Levels')
    expect(cards[0]).toHaveTextContent(
      'Downstream validation rejected payload: expected 412 rows, got 409',
    )
  })

  it('renders the test name context for suite-run errors', () => {
    render(<ReportErrorsTable errors={ERRORS} />)

    expect(screen.getAllByTestId('error-card')[0]).toHaveTextContent(
      'Inventory Sync Validation',
    )
  })

  it('handles errors without a block path', () => {
    render(
      <ReportErrorsTable
        errors={[{ ...ERRORS[0], block_path: null }]}
      />,
    )

    expect(screen.getByTestId('error-card')).toHaveTextContent(
      'Downstream validation rejected payload',
    )
  })
})

describe('ReportErrorsTable - empty', () => {
  it('renders the success-tinted empty state', () => {
    render(<ReportErrorsTable errors={[]} />)

    const empty = screen.getByTestId('errors-empty-state')
    expect(empty).toHaveTextContent('No errors recorded')
    expect(screen.queryAllByTestId('error-card')).toHaveLength(0)
  })
})
