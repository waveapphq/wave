/**
 * FunctionsPage Component.
 *
 * Presentational Function library list, mirroring the canonical `tests/page.tsx`.
 * Differences from Tests (per FNLIST-*):
 *   - Columns: Name(+desc) / Tags / Version pill / Updated / Actions.
 *   - Actions are view / export / delete (NO run, NO duplicate).
 *   - NO "New" affordance (Functions are born local in a Test).
 *   - No Status / Suite filters; Search + Tags only.
 *   - Bulk actions are export + delete only.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FunctionsPage, type FunctionsPageProps, type FunctionRow } from '@/features/functions/page'

const mockFunctions: FunctionRow[] = [
  {
    id: 'fn-1',
    name: 'send_email',
    description: 'Send an email via SMTP',
    tags: ['mail', 'demo'],
    latestVersion: '2.1.0',
    updatedAt: '2026-05-01T10:30:00Z',
  },
  {
    id: 'fn-2',
    name: 'charge_card',
    description: 'Charge a payment card',
    tags: ['payment'],
    latestVersion: '1.0.0',
    updatedAt: '2026-04-20T09:15:00Z',
  },
]

const mockPageInfo = { currentPage: 1, pageSize: 10, totalItems: 42, totalPages: 5 }
const mockFilters = { search: '', tags: [] as string[] }
const mockAllTags = ['mail', 'demo', 'payment', 'k8s']

function renderFunctionsPage(props: Partial<FunctionsPageProps> = {}) {
  const defaultProps: FunctionsPageProps = {
    functions: mockFunctions,
    pageInfo: mockPageInfo,
    filters: mockFilters,
    allTags: mockAllTags,
    selectedIds: [],
    enableSelection: false,
    loading: false,
    error: undefined,
    sorting: [],
    onSortingChange: vi.fn(),
    columnVisibility: {},
    onColumnVisibilityChange: vi.fn(),
    visibleColumns: ['name', 'tags', 'version', 'updated'],
    rowSelection: {},
    onRowSelectionChange: vi.fn(),
    onViewFunction: vi.fn(),
    onExportFunction: vi.fn(),
    onDeleteFunction: vi.fn(),
    onBulkDelete: vi.fn(),
    onBulkExport: vi.fn(),
    onFilterChange: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
    onColumnToggle: vi.fn(),
    onImport: vi.fn(),
    onRetry: vi.fn(),
    ...props,
  }
  return render(
    <MemoryRouter>
      <FunctionsPage {...defaultProps} />
    </MemoryRouter>,
  )
}

describe('FunctionsPage - structure', () => {
  it('renders the page container and "Functions" h1', () => {
    renderFunctionsPage()
    expect(screen.getByTestId('functions-page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Functions')
  })

  it('renders the functions table and pagination', () => {
    renderFunctionsPage()
    expect(screen.getByTestId('functions-table')).toBeInTheDocument()
    expect(screen.getByTestId('pagination')).toBeInTheDocument()
  })

  it('does NOT render a "New" affordance (Functions are born in a Test)', () => {
    renderFunctionsPage()
    expect(screen.queryByRole('button', { name: /New Function/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create Your First Function/i })).not.toBeInTheDocument()
  })

  it('renders the Import button', () => {
    renderFunctionsPage()
    expect(screen.getByTestId('import-button')).toBeVisible()
  })
})

describe('FunctionsPage - columns (FNLIST)', () => {
  it('renders Name / Tags / Version / Updated / Actions headers (no Status, no Suite)', () => {
    renderFunctionsPage()
    const table = screen.getByTestId('functions-table')
    expect(within(table).getByRole('columnheader', { name: /Name/i })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Tags/i })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Version/i })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Updated/i })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Actions/i })).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: /^Status$/i })).not.toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: /^Suite$/i })).not.toBeInTheDocument()
  })

  it('renders one row per function with its name and version pill', () => {
    renderFunctionsPage()
    const rows = screen.getAllByTestId('function-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByTestId('function-name')).toHaveTextContent('send_email')
    expect(within(rows[0]).getByTestId('function-version')).toHaveTextContent('2.1.0')
  })
})

describe('FunctionsPage - row actions (view/export/delete only)', () => {
  it('calls onViewFunction when the view action is used', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const onViewFunction = vi.fn()
    renderFunctionsPage({ onViewFunction })
    const row = screen.getAllByTestId('function-row')[0]
    await user.click(within(row).getByTestId('action-view'))
    expect(onViewFunction).toHaveBeenCalledWith('fn-1')
  })

  it('exposes export and delete row actions but NOT run or duplicate', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderFunctionsPage()
    const row = screen.getAllByTestId('function-row')[0]
    await user.click(within(row).getByTestId('action-menu-trigger'))
    expect(screen.getByRole('menuitem', { name: /Export/i })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: /Run/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Duplicate/i })).not.toBeInTheDocument()
  })

  it('calls onDeleteFunction when Delete is selected', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const onDeleteFunction = vi.fn()
    renderFunctionsPage({ onDeleteFunction })
    const row = screen.getAllByTestId('function-row')[0]
    await user.click(within(row).getByTestId('action-menu-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))
    expect(onDeleteFunction).toHaveBeenCalledWith('fn-1')
  })
})

describe('FunctionsPage - states', () => {
  it('renders the empty state pointing at the workbench palette (no create CTA)', () => {
    renderFunctionsPage({ functions: [] })
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create Your First Function/i })).not.toBeInTheDocument()
  })

  it('renders the error state with a retry handler', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderFunctionsPage({ error: 'Unable to load functions', onRetry })
    expect(screen.getByTestId('error-state-title')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try Again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders skeleton rows and aria-busy while loading', () => {
    renderFunctionsPage({ loading: true, functions: [] })
    expect(screen.getByTestId('functions-page')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryAllByTestId('function-row')).toHaveLength(0)
  })
})

describe('FunctionsPage - bulk actions (export + delete only)', () => {
  it('invokes onBulkExport and onBulkDelete from the bulk bar', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const onBulkExport = vi.fn()
    const onBulkDelete = vi.fn()
    renderFunctionsPage({
      enableSelection: true,
      selectedIds: ['fn-1', 'fn-2'],
      onBulkExport,
      onBulkDelete,
    })
    await user.click(screen.getByTestId('bulk-export'))
    expect(onBulkExport).toHaveBeenCalled()
    await user.click(screen.getByTestId('bulk-delete'))
    expect(onBulkDelete).toHaveBeenCalled()
  })

  it('does not offer bulk run / add-to-suite (Functions have no such ops)', () => {
    renderFunctionsPage({ enableSelection: true, selectedIds: ['fn-1'] })
    expect(screen.queryByTestId('bulk-run')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bulk-add-to-suite')).not.toBeInTheDocument()
  })
})

describe('FunctionsPage - pagination', () => {
  it('shows the item count and calls onPageChange', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    renderFunctionsPage({ onPageChange })
    expect(within(screen.getByTestId('pagination')).getByTestId('pagination-item-count')).toHaveTextContent(
      /Showing 1-10 of 42/i,
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })
})
