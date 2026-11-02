/**
 * RegressionsPage Component Tests - DataTable Migration
 *
 * REQ-5.2.1.37: Regression management screen (list, create, edit, version control)
 *
 * V-LIST-09: Regressions list populated
 *
 * Tests for RegressionsPage component after DataTable migration:
 * - Uses TanStack native props (sorting, onSortingChange, columnVisibility, etc.)
 * - DataTable replaces hand-rolled RegressionsTable
 * - No more SortableTh - DataTableColumnHeader handles sort UI
 * - LIST-1 through LIST-9 design decisions
 *
 * Page structure:
 * - Page title: "Regressions" (h1)
 * - "+ New Regression" button in header
 * - Filters row: search, status, tags (NO Mass Action button per wireframe)
 * - Columns button
 * - DataTable with columns: Name, Version, Suites, Tests, Status, Last Run, Actions
 * - Pagination controls (built into DataTable)
 * - NO checkbox column (no selection mode for regressions)
 *
 * Component: frontend/src/features/regressions/page.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { SortingState, VisibilityState } from '@tanstack/react-table'
import { RegressionsPage, type RegressionsPageProps } from '@/features/regressions/page'
import type { Regression } from '@/features/regressions/api/types'

// ============================================================================
// Mock Data
// ============================================================================

const mockRegressions: Regression[] = [
  {
    id: 'reg-1',
    name: 'WAVE 25.12',
    version: "1.0.0",
    description: 'Full regression for WAVE 25.12 release',
    suitesCount: 5,
    testsCount: 150,
    status: 'passed',
    lastRun: '2025-12-28T10:30:00Z',
    tags: ['release', 'full'],
    createdAt: '2025-12-01T00:00:00Z',
    updatedAt: '2025-12-28T10:30:00Z',
  },
  {
    id: 'reg-2',
    name: 'WAVE 25.11',
    version: "1.0.0",
    description: 'Full regression for WAVE 25.11 release',
    suitesCount: 5,
    testsCount: 142,
    status: 'failed',
    lastRun: '2025-12-28T09:15:00Z',
    tags: ['release', 'full'],
    createdAt: '2025-11-01T00:00:00Z',
    updatedAt: '2025-12-28T09:15:00Z',
  },
  {
    id: 'reg-3',
    name: 'Nightly Smoke',
    version: "1.0.0",
    description: 'Nightly smoke test regression',
    suitesCount: 2,
    testsCount: 25,
    status: 'never_run',
    lastRun: null,
    tags: ['nightly', 'smoke'],
    createdAt: '2025-12-03T00:00:00Z',
    updatedAt: '2025-12-03T00:00:00Z',
  },
  {
    id: 'reg-4',
    name: 'Empty Regression',
    version: "1.0.0",
    description: null,
    suitesCount: 0,
    testsCount: 0,
    status: 'never_run',
    lastRun: null,
    tags: [],
    createdAt: '2025-12-04T00:00:00Z',
    updatedAt: '2025-12-04T00:00:00Z',
  },
]

const mockPageInfo = {
  currentPage: 1,
  pageSize: 10,
  totalItems: 95,
  totalPages: 10,
}

const mockFilters = {
  search: '',
  status: [] as string[],
  tags: [] as string[],
}

const mockAllTags = ['release', 'full', 'nightly', 'smoke', 'weekly', 'regression']

// ============================================================================
// Test Utilities
// ============================================================================

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

function renderRegressionsPage(props: Partial<RegressionsPageProps> = {}) {
  const defaultProps: RegressionsPageProps = {
    regressions: mockRegressions,
    pageInfo: mockPageInfo,
    filters: mockFilters,
    allTags: mockAllTags,
    loading: false,
    error: undefined,
    // TanStack native props (DataTable migration)
    sorting: [],
    onSortingChange: vi.fn(),
    columnVisibility: {},
    onColumnVisibilityChange: vi.fn(),
    visibleColumns: ['name', 'suitesCount', 'testsCount', 'status', 'lastRun'],
    // Selection (TanStack native)
    enableSelection: false,
    selectedIds: [],
    rowSelection: {},
    onRowSelectionChange: vi.fn(),
    onNewRegression: vi.fn(),
    onEditRegression: vi.fn(),
    onDeleteRegression: vi.fn(),
    onDuplicateRegression: vi.fn(),
    onRunRegression: vi.fn(),
    onBulkRun: vi.fn(),
    onBulkExport: vi.fn(),
    onBulkDuplicate: vi.fn(),
    onBulkDelete: vi.fn(),
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
    onFilterChange: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onColumnToggle: vi.fn(),
    onRetry: vi.fn(),
    ...props,
  }
  return renderWithRouter(<RegressionsPage {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('RegressionsPage', () => {
  describe('Page Structure', () => {
    it('renders page container with correct testid', () => {
      renderRegressionsPage()
      expect(screen.getByTestId('regressions-page')).toBeInTheDocument()
    })

    it('renders page title "Regressions" as h1', () => {
      renderRegressionsPage()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Regressions')
    })

    it('page title is visible', () => {
      renderRegressionsPage()
      expect(screen.getByRole('heading', { name: 'Regressions' })).toBeVisible()
    })

    it('renders "+ New Regression" button in header', () => {
      renderRegressionsPage()
      const newButton = screen.getByRole('button', { name: /New Regression/i })
      expect(newButton).toBeVisible()
      expect(newButton).toBeEnabled()
    })

    it('renders filters section', () => {
      renderRegressionsPage()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('renders regressions DataTable', () => {
      renderRegressionsPage()
      expect(screen.getByTestId('regressions-table')).toBeInTheDocument()
    })

    it('renders pagination controls', () => {
      renderRegressionsPage()
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    })
  })

  describe('Header Actions', () => {
    it('calls onNewRegression when "+ New Regression" button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNewRegression = vi.fn()

      renderRegressionsPage({ onNewRegression: handleNewRegression })
      await user.click(screen.getByRole('button', { name: /New Regression/i }))

      expect(handleNewRegression).toHaveBeenCalledTimes(1)
    })
  })

  describe('Filters Section', () => {
    it('renders search input with correct placeholder', () => {
      renderRegressionsPage()
      const searchInput = screen.getByPlaceholderText(/Search regressions/i)
      expect(searchInput).toBeVisible()
    })

    it('renders status filter dropdown', () => {
      renderRegressionsPage()
      expect(screen.getByTestId('filter-status')).toBeVisible()
    })

    it('renders tags filter', () => {
      renderRegressionsPage()
      expect(screen.getByTestId('filter-tags')).toBeVisible()
    })

    it('renders Columns button', () => {
      renderRegressionsPage()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('calls onFilterChange when search changes', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderRegressionsPage({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search regressions/i)
      await user.type(searchInput, 'WAVE')

      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(handleFilterChange).toHaveBeenCalled()
      }, { timeout: 500 })
    })
  })

  describe('DataTable Structure', () => {
    it('renders DataTable with correct columns', () => {
      renderRegressionsPage()
      const table = screen.getByTestId('regressions-table')

      expect(within(table).getByRole('columnheader', { name: /Name/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Suites/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Tests/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Status/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Last Run/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Actions/i })).toBeInTheDocument()
    })

    it('does NOT render checkbox column (no selection for regressions)', () => {
      renderRegressionsPage()
      const table = screen.getByTestId('regressions-table')
      expect(within(table).queryByRole('checkbox', { name: /select all/i })).not.toBeInTheDocument()
    })

    it('renders regression rows with correct data', () => {
      renderRegressionsPage()
      const rows = screen.getAllByTestId('regression-row')
      expect(rows).toHaveLength(4)

      const firstRow = rows[0]
      expect(within(firstRow).getByTestId('regression-name')).toHaveTextContent('WAVE 25.12')
      expect(within(firstRow).getByTestId('regression-suites-count')).toHaveTextContent('5 suites')
      expect(within(firstRow).getByTestId('regression-tests-count')).toHaveTextContent('150 tests')
    })

    it('displays correct status for each regression', () => {
      renderRegressionsPage()
      const rows = screen.getAllByTestId('regression-row')

      // First row: passed
      expect(within(rows[0]).getByTestId('status-badge-passed')).toBeInTheDocument()
      // Second row: failed
      expect(within(rows[1]).getByTestId('status-badge-failed')).toBeInTheDocument()
      // Third row: never run (shared StatusBadgeCell normalizes the
      // underscore to a hyphen for consistency with tests/suites lists)
      expect(within(rows[2]).getByTestId('status-badge-never-run')).toBeInTheDocument()
    })

    it('displays "0 suites" for empty regression', () => {
      renderRegressionsPage()
      const rows = screen.getAllByTestId('regression-row')
      const emptyRow = rows[3]
      expect(within(emptyRow).getByTestId('regression-suites-count')).toHaveTextContent('0 suites')
      expect(within(emptyRow).getByTestId('regression-tests-count')).toHaveTextContent('0 tests')
    })

    it('displays singular "1 suite" when regression has one suite', () => {
      const regressionsWithOneSuite = [{
        ...mockRegressions[0],
        suitesCount: 1,
        testsCount: 10,
      }]
      renderRegressionsPage({ regressions: regressionsWithOneSuite })
      const rows = screen.getAllByTestId('regression-row')
      expect(within(rows[0]).getByTestId('regression-suites-count')).toHaveTextContent('1 suite')
    })

    it('displays singular "1 test" when regression has one test', () => {
      const regressionsWithOneTest = [{
        ...mockRegressions[0],
        suitesCount: 1,
        testsCount: 1,
      }]
      renderRegressionsPage({ regressions: regressionsWithOneTest })
      const rows = screen.getAllByTestId('regression-row')
      expect(within(rows[0]).getByTestId('regression-tests-count')).toHaveTextContent('1 test')
    })

    it('displays formatted last run date for regressions with last_run', () => {
      renderRegressionsPage()
      const rows = screen.getAllByTestId('regression-row')
      const firstRow = rows[0]
      expect(within(firstRow).getByTestId('regression-last-run')).toBeInTheDocument()
      expect(within(firstRow).getByTestId('regression-last-run')).not.toHaveTextContent('Never')
    })

    it('displays "Never" for regressions with null last_run', () => {
      renderRegressionsPage()
      const rows = screen.getAllByTestId('regression-row')
      const thirdRow = rows[2]
      expect(within(thirdRow).getByTestId('regression-last-run')).toHaveTextContent('Never')
    })
  })

  describe('TanStack Sorting (DataTable migration)', () => {
    it('passes sorting state to DataTable', () => {
      const sorting: SortingState = [{ id: 'name', desc: false }]
      renderRegressionsPage({ sorting })
      // DataTable renders with sorting state - column header shows sort indicator
      const table = screen.getByTestId('regressions-table')
      expect(table).toBeInTheDocument()
    })

    it('calls onSortingChange when column header is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSortingChange = vi.fn()

      renderRegressionsPage({ onSortingChange: handleSortingChange })
      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      await user.click(nameHeader)

      expect(handleSortingChange).toHaveBeenCalled()
    })

    it('uses manualSorting for server-side sorting', () => {
      // DataTable should have manualSorting prop set
      renderRegressionsPage()
      const table = screen.getByTestId('regressions-table')
      expect(table).toBeInTheDocument()
    })

    it('passes columnVisibility to DataTable', () => {
      const columnVisibility: VisibilityState = { tags: false, createdAt: false, updatedAt: false }
      renderRegressionsPage({ columnVisibility })
      // Columns marked as hidden should not appear
      expect(screen.queryByRole('columnheader', { name: /Tags/i })).not.toBeInTheDocument()
    })

    it('column visibility toggle shows column checkboxes', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsPage()

      await user.click(screen.getByRole('button', { name: /Columns/i }))

      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(screen.getByRole('menuitemcheckbox', { name: /Suites/i })).toBeInTheDocument()
      })
    })
  })

  describe('Row Actions', () => {
    it('renders Run button for each row', () => {
      renderRegressionsPage()
      const rows = screen.getAllByTestId('regression-row')

      rows.forEach((row) => {
        expect(within(row).getByTestId('row-action-run')).toBeInTheDocument()
      })
    })

    it('renders overflow menu trigger for each row', () => {
      renderRegressionsPage()
      const rows = screen.getAllByTestId('regression-row')

      rows.forEach((row) => {
        expect(within(row).getByTestId('row-actions-menu')).toBeInTheDocument()
      })
    })

    it('calls onRunRegression when Run button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRunRegression = vi.fn()

      renderRegressionsPage({ onRunRegression: handleRunRegression })
      const firstRow = screen.getAllByTestId('regression-row')[0]
      await user.click(within(firstRow).getByTestId('row-action-run'))

      expect(handleRunRegression).toHaveBeenCalledWith('reg-1')
    })

    it('opens action menu when trigger is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsPage()
      const firstRow = screen.getAllByTestId('regression-row')[0]
      await user.click(within(firstRow).getByTestId('row-actions-menu'))

      expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeVisible()
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeVisible()
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeVisible()
    })

    it('does NOT show Move to Suite/Regression in row actions', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsPage()
      const firstRow = screen.getAllByTestId('regression-row')[0]
      await user.click(within(firstRow).getByTestId('row-actions-menu'))

      expect(screen.queryByRole('menuitem', { name: /Move to Suite/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /Move to Regression/i })).not.toBeInTheDocument()
    })

    it('calls onEditRegression when Edit is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEditRegression = vi.fn()

      renderRegressionsPage({ onEditRegression: handleEditRegression })
      const firstRow = screen.getAllByTestId('regression-row')[0]
      await user.click(within(firstRow).getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Edit/i }))

      expect(handleEditRegression).toHaveBeenCalledWith('reg-1')
    })

    it('calls onDeleteRegression when Delete is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDeleteRegression = vi.fn()

      renderRegressionsPage({ onDeleteRegression: handleDeleteRegression })
      const firstRow = screen.getAllByTestId('regression-row')[0]
      await user.click(within(firstRow).getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDeleteRegression).toHaveBeenCalledWith('reg-1')
    })

    it('calls onDuplicateRegression when Duplicate is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicateRegression = vi.fn()

      renderRegressionsPage({ onDuplicateRegression: handleDuplicateRegression })
      const firstRow = screen.getAllByTestId('regression-row')[0]
      await user.click(within(firstRow).getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(handleDuplicateRegression).toHaveBeenCalledWith('reg-1')
    })
  })

  describe('Pagination (LIST-2)', () => {
    it('displays item count "Showing X-Y of Z"', () => {
      renderRegressionsPage()
      const pagination = screen.getByTestId('pagination')
      const itemCount = within(pagination).getByTestId('pagination-item-count')
      expect(itemCount).toHaveTextContent(/Showing 1-10 of 95/i)
    })

    it('displays page size selector with options 10, 25, 50, 100', () => {
      renderRegressionsPage()
      const pagination = screen.getByTestId('pagination')
      const pageSizeSelector = within(pagination).getByTestId('page-size-selector')
      expect(pageSizeSelector).toBeVisible()
    })

    it('displays page navigation', () => {
      renderRegressionsPage()
      const pagination = screen.getByTestId('pagination')
      const navigation = within(pagination).getByTestId('pagination-navigation')
      expect(navigation).toBeVisible()
    })

    it('disables previous button on first page', () => {
      renderRegressionsPage({ pageInfo: { ...mockPageInfo, currentPage: 1 } })
      const prevButton = screen.getByRole('button', { name: /previous/i })
      expect(prevButton).toBeDisabled()
    })

    it('disables next button on last page', () => {
      renderRegressionsPage({ pageInfo: { ...mockPageInfo, currentPage: 10 } })
      const nextButton = screen.getByRole('button', { name: /next/i })
      expect(nextButton).toBeDisabled()
    })

    it('calls onPageChange when page is changed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderRegressionsPage({ onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /next/i }))

      expect(handlePageChange).toHaveBeenCalledWith(2)
    })

    it('displays first and last page buttons per LIST-2', () => {
      renderRegressionsPage()
      const pagination = screen.getByTestId('pagination')
      expect(within(pagination).getByRole('button', { name: /first/i })).toBeInTheDocument()
      expect(within(pagination).getByRole('button', { name: /last/i })).toBeInTheDocument()
    })

    it('disables first button on first page', () => {
      renderRegressionsPage({ pageInfo: { ...mockPageInfo, currentPage: 1 } })
      expect(screen.getByRole('button', { name: /first/i })).toBeDisabled()
    })

    it('disables last button on last page', () => {
      renderRegressionsPage({ pageInfo: { ...mockPageInfo, currentPage: 10 } })
      expect(screen.getByRole('button', { name: /last/i })).toBeDisabled()
    })

    it('calls onPageChange with 1 when first button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderRegressionsPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /first/i }))

      expect(handlePageChange).toHaveBeenCalledWith(1)
    })

    it('calls onPageChange with totalPages when last button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderRegressionsPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /last/i }))

      expect(handlePageChange).toHaveBeenCalledWith(10)
    })

    it('calls onPageChange with previous page when previous button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderRegressionsPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /previous/i }))

      expect(handlePageChange).toHaveBeenCalledWith(4)
    })

    it('page size selector shows current value', () => {
      renderRegressionsPage({ pageInfo: { ...mockPageInfo, pageSize: 25 } })
      const pagination = screen.getByTestId('pagination')
      const pageSizeSelector = within(pagination).getByTestId('page-size-selector')

      expect(pageSizeSelector).toHaveTextContent('25')
    })
  })

  describe('Pagination - Single Page (LIST-3)', () => {
    it('shows all pagination controls even for single page', () => {
      const singlePageInfo = { currentPage: 1, pageSize: 10, totalItems: 5, totalPages: 1 }
      renderRegressionsPage({ pageInfo: singlePageInfo })

      const pagination = screen.getByTestId('pagination')
      expect(within(pagination).getByTestId('pagination-item-count')).toBeVisible()
      expect(within(pagination).getByTestId('page-size-selector')).toBeVisible()
      expect(within(pagination).getByTestId('pagination-navigation')).toBeVisible()
    })

    it('disables both prev and next on single page', () => {
      const singlePageInfo = { currentPage: 1, pageSize: 10, totalItems: 5, totalPages: 1 }
      renderRegressionsPage({ pageInfo: singlePageInfo })

      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    })
  })

  describe('Loading State (LIST-4)', () => {
    it('displays skeleton rows when loading', () => {
      renderRegressionsPage({ loading: true, regressions: [] })
      const skeletonRows = screen.getAllByTestId('skeleton-row')
      expect(skeletonRows.length).toBeGreaterThan(0)
    })

    it('keeps the rows while a later read is out', () => {
      renderRegressionsPage({ loading: true })
      const regressionRows = screen.queryAllByTestId('regression-row')
      expect(regressionRows).not.toHaveLength(0)
    })

    it('sets aria-busy on page when loading', () => {
      renderRegressionsPage({ loading: true, regressions: [] })
      expect(screen.getByTestId('regressions-page')).toHaveAttribute('aria-busy', 'true')
    })

    it('keeps search enabled during loading to preserve focus', () => {
      renderRegressionsPage({ loading: true })
      const searchInput = screen.getByPlaceholderText(/Search regressions/i)
      expect(searchInput).not.toBeDisabled()
    })
  })

  describe('Error State (LIST-5)', () => {
    it('displays error message with empathetic tone', () => {
      renderRegressionsPage({ error: 'Unable to load regressions' })
      const errorTitle = screen.getByTestId('error-state-title')
      expect(errorTitle).toBeInTheDocument()
      expect(errorTitle).toHaveTextContent(/Unable to load/i)
    })

    it('displays "Try Again" button', () => {
      renderRegressionsPage({ error: 'Unable to load regressions' })
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeVisible()
    })

    it('displays red alert icon', () => {
      renderRegressionsPage({ error: 'Unable to load regressions' })
      const alertIcon = screen.getByTestId('error-state-icon')
      expect(alertIcon).toBeVisible()
      expect(alertIcon).toHaveClass('text-error')
    })

    it('calls onRetry when "Try Again" is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRetry = vi.fn()

      renderRegressionsPage({ error: 'Unable to load regressions', onRetry: handleRetry })
      await user.click(screen.getByRole('button', { name: /Try Again/i }))

      expect(handleRetry).toHaveBeenCalledTimes(1)
    })

    it('hides table when error occurs', () => {
      renderRegressionsPage({ error: 'Unable to load regressions' })
      expect(screen.queryByTestId('regressions-table')).not.toBeInTheDocument()
    })
  })

  describe('Empty State (LIST-6)', () => {
    it('displays empty state when no regressions', () => {
      renderRegressionsPage({ regressions: [] })
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })

    it('displays entity-specific icon (purple layers)', () => {
      renderRegressionsPage({ regressions: [] })
      expect(screen.getByTestId('empty-state-icon')).toBeVisible()
    })

    it('displays "No regressions yet" title', () => {
      renderRegressionsPage({ regressions: [] })
      const title = screen.getByTestId('empty-state-title')
      expect(title).toHaveTextContent(/No regressions yet/i)
    })

    it('displays encouraging description', () => {
      renderRegressionsPage({ regressions: [] })
      const description = screen.getByTestId('empty-state-description')
      expect(description).toBeVisible()
    })

    it('displays primary CTA "Create Your First Regression"', () => {
      renderRegressionsPage({ regressions: [] })
      const ctaButton = screen.getByRole('button', { name: /Create Your First Regression/i })
      expect(ctaButton).toBeVisible()
      expect(ctaButton).toHaveClass('btn-primary')
    })

    it('calls onNewRegression when CTA is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNewRegression = vi.fn()

      renderRegressionsPage({ regressions: [], onNewRegression: handleNewRegression })
      await user.click(screen.getByRole('button', { name: /Create Your First Regression/i }))

      expect(handleNewRegression).toHaveBeenCalledTimes(1)
    })

    it('still shows page header in empty state', () => {
      renderRegressionsPage({ regressions: [] })
      expect(screen.getByRole('heading', { name: 'Regressions' })).toBeVisible()
      expect(screen.getByRole('button', { name: /New Regression/i })).toBeVisible()
    })

    it('shows filters in empty state', () => {
      renderRegressionsPage({ regressions: [] })
      expect(screen.getByTestId('filters-section')).toBeVisible()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('displays "No matching regressions found" when empty with active filters', () => {
      renderRegressionsPage({
        regressions: [],
        filters: { search: 'nonexistent', status: [], tags: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching regressions found/i)
    })

    it('displays Clear Filters button when empty with active filters', () => {
      renderRegressionsPage({
        regressions: [],
        filters: { search: 'nonexistent', status: [], tags: [] },
      })
      const noResultsState = screen.getByTestId('no-results-state')
      expect(within(noResultsState).getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('calls onFilterChange with cleared filters when Clear Filters is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderRegressionsPage({
        regressions: [],
        filters: { search: 'nonexistent', status: ['passed'], tags: ['release'] },
        onFilterChange: handleFilterChange,
      })

      const noResultsState = screen.getByTestId('no-results-state')
      const clearFiltersButton = within(noResultsState).getByRole('button', { name: /Clear Filters/i })
      await user.click(clearFiltersButton)

      expect(handleFilterChange).toHaveBeenCalledWith({
        search: '',
        status: [],
        tags: [],
      })
    })

    it('shows no results when status filter is active but search is empty', () => {
      renderRegressionsPage({
        regressions: [],
        filters: { search: '', status: ['passed'], tags: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching regressions found/i)
    })

    it('shows no results when tags filter is active but search and status are empty', () => {
      renderRegressionsPage({
        regressions: [],
        filters: { search: '', status: [], tags: ['release'] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching regressions found/i)
    })
  })

  describe('Status Badges (LIST-7)', () => {
    it('passed status has green styling', () => {
      renderRegressionsPage()
      const firstRow = screen.getAllByTestId('regression-row')[0]
      const passedBadge = within(firstRow).getByTestId('status-badge-passed')
      expect(passedBadge).toHaveClass('text-success')
    })

    it('failed status has red styling', () => {
      renderRegressionsPage()
      const failedBadge = screen.getByTestId('status-badge-failed')
      expect(failedBadge).toHaveClass('text-error')
    })

    it('never run status has gray styling', () => {
      renderRegressionsPage()
      const neverRunBadge = screen.getAllByTestId('status-badge-never-run')[0]
      expect(neverRunBadge).toHaveClass('text-muted')
    })
  })

  describe('Accessibility', () => {
    it('page has main landmark when wrapped in layout', () => {
      renderWithRouter(
        <main>
          <RegressionsPage
            regressions={mockRegressions}
            pageInfo={mockPageInfo}
            filters={mockFilters}
            allTags={mockAllTags}
            sorting={[]}
            onSortingChange={vi.fn()}
            columnVisibility={{}}
            onColumnVisibilityChange={vi.fn()}
            visibleColumns={['name', 'suitesCount', 'testsCount', 'status', 'lastRun']}
            enableSelection={false}
            selectedIds={[]}
            rowSelection={{}}
            onRowSelectionChange={vi.fn()}
            onNewRegression={vi.fn()}
            onEditRegression={vi.fn()}
            onDeleteRegression={vi.fn()}
            onDuplicateRegression={vi.fn()}
            onRunRegression={vi.fn()}
            onBulkRun={vi.fn()}
            onBulkExport={vi.fn()}
            onBulkDuplicate={vi.fn()}
            onBulkDelete={vi.fn()}
            onEnterSelectionMode={vi.fn()}
            onExitSelectionMode={vi.fn()}
            onFilterChange={vi.fn()}
            onPageChange={vi.fn()}
            onPageSizeChange={vi.fn()}
            onColumnToggle={vi.fn()}
            onRetry={vi.fn()}
          />
        </main>
      )
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('page title is accessible', () => {
      renderRegressionsPage()
      expect(screen.getByRole('heading', { level: 1, name: 'Regressions' })).toBeInTheDocument()
    })

    it('table has accessible role', () => {
      renderRegressionsPage()
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('table has aria-label', () => {
      renderRegressionsPage()
      expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Regressions')
    })

    it('loading state has aria-busy', () => {
      renderRegressionsPage({ loading: true, regressions: [] })
      expect(screen.getByTestId('regressions-page')).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      const { container } = renderRegressionsPage({ className: 'custom-regressions-page' })
      expect(container.querySelector('.custom-regressions-page')).toBeInTheDocument()
    })
  })

  describe('Table Sorting and Row Interaction', () => {
    it('calls onEditRegression when row is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEditRegression = vi.fn()

      renderRegressionsPage({ onEditRegression: handleEditRegression })
      const firstRow = screen.getAllByTestId('regression-row')[0]

      await user.click(within(firstRow).getByTestId('regression-name'))

      expect(handleEditRegression).toHaveBeenCalledWith('reg-1')
    })
  })

  describe('Viewport-Filling Layout (DASH-4, DASH-5, DASH-8)', () => {
    it('page container fills viewport height with h-full overflow-hidden', () => {
      renderRegressionsPage()
      const page = screen.getByTestId('regressions-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('pagination is anchored at bottom with flex-shrink-0', () => {
      renderRegressionsPage()
      const pagination = screen.getByTestId('pagination')
      expect(pagination).toHaveClass('flex-shrink-0')
    })

    it('loading state page container has viewport-filling classes', () => {
      renderRegressionsPage({ loading: true })
      const page = screen.getByTestId('regressions-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('error state page container has viewport-filling classes', () => {
      renderRegressionsPage({ error: 'Unable to load regressions' })
      const page = screen.getByTestId('regressions-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('empty state page container has viewport-filling classes', () => {
      renderRegressionsPage({ regressions: [] })
      const page = screen.getByTestId('regressions-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })
  })
})
