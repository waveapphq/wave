/**
 * ReportsPage Tests
 *
 * Presentational reports list per RVIEW-11/RVIEW-12: Executions-list
 * chrome (filters, DataTable, pagination) with columns Name, Type,
 * Status, Finished, Duration, Report, Actions. One row per finished
 * execution; no selection mode, no bulk actions, no "+ New" button.
 *
 * Module: frontend/src/features/reports/page.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReportListRow } from '@/features/reports/api/types'
import { ReportsPage, type ReportsPageProps } from '@/features/reports/page'

const ROWS: ReportListRow[] = [
  {
    execution: {
      id: 'exec-1',
      name: 'Nightly API Suite',
      entity_type: 'suite',
      entity_id: 'suite-1',
      status: 'failed',
      triggered_by: 'dev',
      started_at: '2026-06-10T11:06:52+00:00',
      ended_at: '2026-06-10T11:07:13+00:00',
      duration: 21,
    },
    reports: {
      json: {
        artifact_id: 'dir-1/report.v1.json',
        version: 1,
        size_bytes: 14541,
        generated_at: '2026-06-10T11:30:00+00:00',
      },
      html: null,
    },
  },
  {
    execution: {
      id: 'exec-2',
      name: 'Inventory Sync Validation',
      entity_type: 'test',
      entity_id: 'test-1',
      status: 'passed',
      triggered_by: 'qa-bot',
      started_at: '2026-06-10T10:00:00+00:00',
      ended_at: '2026-06-10T10:00:04+00:00',
      duration: 4,
    },
    reports: { json: null, html: null },
  },
]

const PAGE_INFO = {
  currentPage: 1,
  pageSize: 10,
  totalItems: 2,
  totalPages: 1,
}

const FILTERS = {
  search: '',
  status: [] as string[],
  type: [] as string[],
  user: [] as string[],
}

function renderPage(props: Partial<ReportsPageProps> = {}) {
  const defaultProps: ReportsPageProps = {
    rows: ROWS,
    allUsers: [],
    pageInfo: PAGE_INFO,
    filters: FILTERS,
    loading: false,
    error: undefined,
    sorting: [{ id: 'finishedAt', desc: true }],
    onSortingChange: vi.fn(),
    columnVisibility: {},
    onColumnVisibilityChange: vi.fn(),
    visibleColumns: ['name', 'type', 'status', 'finishedAt', 'duration', 'report'],
    onColumnToggle: vi.fn(),
    onViewReport: vi.fn(),
    onFilterChange: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onRetry: vi.fn(),
    ...props,
  }
  return {
    props: defaultProps,
    ...render(
      <MemoryRouter>
        <ReportsPage {...defaultProps} />
      </MemoryRouter>,
    ),
  }
}

describe('ReportsPage - chrome', () => {
  it('renders the page shell with the Reports title', () => {
    renderPage()

    expect(screen.getByTestId('reports-page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument()
  })

  it('has no New button (reports come from executions)', () => {
    renderPage()

    expect(screen.queryByRole('button', { name: /new/i })).toBeNull()
  })

  it('renders the column headers Name, Type, Status, Finished, Duration, Report', () => {
    renderPage()

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.join(' ')).toMatch(/Name/)
    expect(headers.join(' ')).toMatch(/Type/)
    expect(headers.join(' ')).toMatch(/Status/)
    expect(headers.join(' ')).toMatch(/Finished/)
    expect(headers.join(' ')).toMatch(/Duration/)
    expect(headers.join(' ')).toMatch(/Report/)
  })

  it('renders one row per execution', () => {
    renderPage()

    const rows = screen.getAllByTestId('report-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Nightly API Suite')
    expect(rows[1]).toHaveTextContent('Inventory Sync Validation')
  })

  it('renders the search input and pagination', () => {
    renderPage()

    expect(screen.getByRole('searchbox')).toBeInTheDocument()
    expect(screen.getByTestId('pagination')).toBeInTheDocument()
  })
})

describe('ReportsPage - report column', () => {
  it('shows Generated with the artifact size for rows with a JSON report', () => {
    renderPage()

    const row = screen.getAllByTestId('report-row')[0]
    expect(within(row).getByTestId('report-cell')).toHaveTextContent(/Generated/)
    expect(within(row).getByTestId('report-cell')).toHaveTextContent('14.2 KB')
  })

  it('shows Not generated for rows without a JSON report', () => {
    renderPage()

    const row = screen.getAllByTestId('report-row')[1]
    expect(within(row).getByTestId('report-cell')).toHaveTextContent('Not generated')
  })

  it('routes both the View and Generate actions to onViewReport', async () => {
    const user = userEvent.setup()
    const { props } = renderPage()

    const rows = screen.getAllByTestId('report-row')
    await user.click(within(rows[0]).getByTestId('row-action-view'))
    expect(props.onViewReport).toHaveBeenCalledWith('exec-1')

    await user.click(within(rows[1]).getByTestId('row-action-generate'))
    expect(props.onViewReport).toHaveBeenCalledWith('exec-2')
  })
})

describe('ReportsPage - states', () => {
  it('renders skeleton rows while loading', () => {
    renderPage({ loading: true, rows: [] })

    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
  })

  it('renders the error state with a working Try Again', async () => {
    const user = userEvent.setup()
    const { props } = renderPage({ error: 'Failed to load reports', rows: [] })

    expect(screen.getByTestId('error-state')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders the empty state when there are no finished executions', () => {
    renderPage({ rows: [], pageInfo: { ...PAGE_INFO, totalItems: 0, totalPages: 0 } })

    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('empty-state')).toHaveTextContent(/No reports yet/i)
  })

  it('renders the no-results state when filters match nothing', () => {
    renderPage({
      rows: [],
      filters: { ...FILTERS, search: 'zzz' },
      pageInfo: { ...PAGE_INFO, totalItems: 0, totalPages: 0 },
    })

    expect(screen.getByTestId('no-results-state')).toBeInTheDocument()
  })

  it('clears all filters from the no-results state', async () => {
    const user = userEvent.setup()
    const { props } = renderPage({
      rows: [],
      filters: { ...FILTERS, search: 'zzz' },
      pageInfo: { ...PAGE_INFO, totalItems: 0, totalPages: 0 },
    })

    await user.click(
      within(screen.getByTestId('no-results-state')).getByRole('button', {
        name: /clear filters/i,
      }),
    )

    expect(props.onFilterChange).toHaveBeenCalledWith({
      search: '',
      status: [],
      type: [],
      user: [],
      dateRange: { kind: 'all-time' },
    })
  })
})
