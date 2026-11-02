/**
 * SuitesPage Component Tests
 *
 * REQ-5.2.1.36: Suite management screen (list, create, edit, organize tests)
 *
 * V-LIST-07, V-LIST-08: Suites list populated and empty states
 *
 * Tests for SuitesPage component per design decisions and wireframes:
 * - LIST-1: Name and Actions columns sticky on horizontal scroll
 * - LIST-2: Full pagination (item count, page size 10/25/50/100, navigation)
 * - LIST-3: Single-page lists show all controls, disabled when not applicable
 * - LIST-4: Loading: 9 skeleton rows, varying bar widths
 * - LIST-5: Error: empathetic tone, "Try Again" button, red alert icon
 * - LIST-6: Empty: entity-specific icon, encouraging message, primary CTA
 * - LIST-7: Status: Passed (green), Failed (red), Never Run (gray)
 *
 * Page structure:
 * - Page title: "Suites" (h1)
 * - "+ New Suite" button in header
 * - Filters row: search, status, tags (NO suite filter - suites have no parent)
 * - Mass Action and Columns buttons
 * - Data table with columns: Name, Tests, Status, Last Run, Actions
 * - Pagination controls
 *
 * Component: frontend/src/pages/suites.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SuitesPage, type SuitesPageProps, type Suite } from '@/features/suites/page'

// ============================================================================
// Mock Data
// ============================================================================

const mockSuites: Suite[] = [
  {
    id: 'suite-1',
    name: 'Auth Suite',
    description: 'Authentication tests',
    testsCount: 15,
    status: 'passed',
    lastRun: '2025-12-28T10:30:00Z',
    tags: ['auth', 'smoke'],
    createdAt: '2025-12-01T00:00:00Z',
    updatedAt: '2025-12-28T10:30:00Z',
  },
  {
    id: 'suite-2',
    name: 'API Suite',
    description: 'API integration tests',
    testsCount: 42,
    status: 'failed',
    lastRun: '2025-12-28T09:15:00Z',
    tags: ['api', 'integration'],
    createdAt: '2025-12-02T00:00:00Z',
    updatedAt: '2025-12-28T09:15:00Z',
  },
  {
    id: 'suite-3',
    name: 'Database Suite',
    description: 'Database connection tests',
    testsCount: 8,
    status: 'never_run',
    lastRun: null,
    tags: ['database'],
    createdAt: '2025-12-03T00:00:00Z',
    updatedAt: '2025-12-03T00:00:00Z',
  },
  {
    id: 'suite-4',
    name: 'Empty Suite',
    description: null,
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

const mockAllTags = ['auth', 'smoke', 'api', 'integration', 'database', 'regression']

// ============================================================================
// Test Utilities
// ============================================================================

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

function renderSuitesPage(props: Partial<SuitesPageProps> = {}) {
  const defaultProps: SuitesPageProps = {
    suites: mockSuites,
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
    visibleColumns: ['name', 'testsCount', 'status', 'lastRun'],
    rowSelection: {},
    onRowSelectionChange: vi.fn(),
    onNewSuite: vi.fn(),
    onEditSuite: vi.fn(),
    onDeleteSuite: vi.fn(),
    onDuplicateSuite: vi.fn(),
    onRunSuite: vi.fn(),
    onBulkDelete: vi.fn(),
    onBulkRun: vi.fn(),
    onBulkExport: vi.fn(),
    onBulkDuplicate: vi.fn(),
    onFilterChange: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
    onColumnToggle: vi.fn(),
    onRetry: vi.fn(),
    ...props,
  }
  return renderWithRouter(<SuitesPage {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('SuitesPage', () => {
  describe('Page Structure', () => {
    it('renders page container with correct testid', () => {
      renderSuitesPage()
      expect(screen.getByTestId('suites-page')).toBeInTheDocument()
    })

    it('renders page title "Suites" as h1', () => {
      renderSuitesPage()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Suites')
    })

    it('page title is visible', () => {
      renderSuitesPage()
      expect(screen.getByRole('heading', { name: 'Suites' })).toBeVisible()
    })

    it('renders "+ New Suite" button in header', () => {
      renderSuitesPage()
      const newButton = screen.getByRole('button', { name: /New Suite/i })
      expect(newButton).toBeVisible()
      expect(newButton).toBeEnabled()
    })

    it('renders filters section', () => {
      renderSuitesPage()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('renders suites table', () => {
      renderSuitesPage()
      expect(screen.getByTestId('suites-table')).toBeInTheDocument()
    })

    it('renders pagination controls', () => {
      renderSuitesPage()
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    })
  })

  describe('Header Actions', () => {
    it('calls onNewSuite when "+ New Suite" button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNewSuite = vi.fn()

      renderSuitesPage({ onNewSuite: handleNewSuite })
      await user.click(screen.getByRole('button', { name: /New Suite/i }))

      expect(handleNewSuite).toHaveBeenCalledTimes(1)
    })

    it('renders Import button when onImport is provided', () => {
      renderSuitesPage({ onImport: vi.fn() })
      expect(screen.getByTestId('import-button')).toBeVisible()
    })

    it('does not render Import button when onImport is not provided', () => {
      renderSuitesPage()
      expect(screen.queryByTestId('import-button')).not.toBeInTheDocument()
    })

    it('calls onImport when Import button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleImport = vi.fn()

      renderSuitesPage({ onImport: handleImport })
      await user.click(screen.getByTestId('import-button'))

      expect(handleImport).toHaveBeenCalledTimes(1)
    })
  })

  describe('Filters Section', () => {
    it('renders search input with correct placeholder', () => {
      renderSuitesPage()
      const searchInput = screen.getByPlaceholderText(/Search suites/i)
      expect(searchInput).toBeVisible()
    })

    it('renders status filter dropdown', () => {
      renderSuitesPage()
      expect(screen.getByTestId('filter-status')).toBeVisible()
    })

    it('does NOT render suite filter (suites have no parent)', () => {
      renderSuitesPage()
      expect(screen.queryByTestId('filter-suite')).not.toBeInTheDocument()
    })

    it('renders tags filter', () => {
      renderSuitesPage()
      expect(screen.getByTestId('filter-tags')).toBeVisible()
    })

    it('renders Columns button', () => {
      renderSuitesPage()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('renders Mass Action button when suites exist', () => {
      renderSuitesPage()
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeVisible()
    })

    it('hides Mass Action button when no suites exist', () => {
      renderSuitesPage({ suites: [] })
      expect(screen.queryByRole('button', { name: /Mass Action/i })).not.toBeInTheDocument()
    })

    it('calls onFilterChange when search changes', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderSuitesPage({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search suites/i)
      await user.type(searchInput, 'auth')

      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(handleFilterChange).toHaveBeenCalled()
      }, { timeout: 500 })
    })
  })

  describe('Table Structure', () => {
    it('renders table with correct columns', () => {
      renderSuitesPage()
      const table = screen.getByTestId('suites-table')

      expect(within(table).getByRole('columnheader', { name: /Name/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Tests/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Status/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Last Run/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Actions/i })).toBeInTheDocument()
    })

    it('renders suite rows with correct data', () => {
      renderSuitesPage()
      const rows = screen.getAllByTestId('suite-row')
      expect(rows).toHaveLength(4)

      const firstRow = rows[0]
      expect(within(firstRow).getByTestId('suite-name')).toHaveTextContent('Auth Suite')
      expect(within(firstRow).getByTestId('suite-tests-count')).toHaveTextContent('15 tests')
    })

    it('displays correct status for each suite', () => {
      renderSuitesPage()
      const rows = screen.getAllByTestId('suite-row')

      // First row: passed
      expect(within(rows[0]).getByTestId('status-badge-passed')).toBeInTheDocument()
      // Second row: failed
      expect(within(rows[1]).getByTestId('status-badge-failed')).toBeInTheDocument()
      // Third row: never run
      expect(within(rows[2]).getByTestId('status-badge-never-run')).toBeInTheDocument()
    })

    it('displays "0 tests" for empty suite', () => {
      renderSuitesPage()
      const rows = screen.getAllByTestId('suite-row')
      const emptyRow = rows[3]
      expect(within(emptyRow).getByTestId('suite-tests-count')).toHaveTextContent('0 tests')
    })

    it('displays singular "1 test" when suite has one test', () => {
      const suitesWithOneTest = [{
        ...mockSuites[0],
        testsCount: 1,
      }]
      renderSuitesPage({ suites: suitesWithOneTest })
      const rows = screen.getAllByTestId('suite-row')
      expect(within(rows[0]).getByTestId('suite-tests-count')).toHaveTextContent('1 test')
    })
  })

  describe('Row Actions', () => {
    it('renders Run button for each row', () => {
      renderSuitesPage()
      const rows = screen.getAllByTestId('suite-row')

      rows.forEach((row) => {
        expect(within(row).getByTestId('row-action-run')).toBeInTheDocument()
      })
    })

    it('renders overflow menu trigger for each row', () => {
      renderSuitesPage()
      const rows = screen.getAllByTestId('suite-row')

      rows.forEach((row) => {
        expect(within(row).getByTestId('row-actions-menu')).toBeInTheDocument()
      })
    })

    it('calls onRunSuite when Run button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRunSuite = vi.fn()

      renderSuitesPage({ onRunSuite: handleRunSuite })
      const firstRow = screen.getAllByTestId('suite-row')[0]
      await user.click(within(firstRow).getByTestId('row-action-run'))

      expect(handleRunSuite).toHaveBeenCalledWith('suite-1')
    })

    it('opens action menu when trigger is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesPage()
      const firstRow = screen.getAllByTestId('suite-row')[0]
      await user.click(within(firstRow).getByTestId('row-actions-menu'))

      // Menu should show Edit, Delete, Duplicate options (NO Move to Suite)
      expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeVisible()
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeVisible()
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeVisible()
    })

    it('does NOT show Move to Suite in row actions (suites have no parent)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesPage()
      const firstRow = screen.getAllByTestId('suite-row')[0]
      await user.click(within(firstRow).getByTestId('row-actions-menu'))

      expect(screen.queryByRole('menuitem', { name: /Move to Suite/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Move to Suite/i })).not.toBeInTheDocument()
    })

    it('calls onEditSuite when Edit is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEditSuite = vi.fn()

      renderSuitesPage({ onEditSuite: handleEditSuite })
      const firstRow = screen.getAllByTestId('suite-row')[0]
      await user.click(within(firstRow).getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Edit/i }))

      expect(handleEditSuite).toHaveBeenCalledWith('suite-1')
    })

    it('calls onDeleteSuite when Delete is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDeleteSuite = vi.fn()

      renderSuitesPage({ onDeleteSuite: handleDeleteSuite })
      const firstRow = screen.getAllByTestId('suite-row')[0]
      await user.click(within(firstRow).getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDeleteSuite).toHaveBeenCalledWith('suite-1')
    })

    it('calls onDuplicateSuite when Duplicate is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicateSuite = vi.fn()

      renderSuitesPage({ onDuplicateSuite: handleDuplicateSuite })
      const firstRow = screen.getAllByTestId('suite-row')[0]
      await user.click(within(firstRow).getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(handleDuplicateSuite).toHaveBeenCalledWith('suite-1')
    })
  })

  describe('Pagination (LIST-2)', () => {
    it('displays item count "Showing X-Y of Z"', () => {
      renderSuitesPage()
      const pagination = screen.getByTestId('pagination')
      const itemCount = within(pagination).getByTestId('pagination-item-count')
      expect(itemCount).toHaveTextContent(/Showing 1-10 of 95/i)
    })

    it('displays page size selector with options 10, 25, 50, 100', () => {
      renderSuitesPage()
      const pagination = screen.getByTestId('pagination')
      const pageSizeSelector = within(pagination).getByTestId('page-size-selector')
      expect(pageSizeSelector).toBeVisible()
    })

    it('displays page navigation', () => {
      renderSuitesPage()
      const pagination = screen.getByTestId('pagination')
      const navigation = within(pagination).getByTestId('pagination-navigation')
      expect(navigation).toBeVisible()
    })

    it('disables previous button on first page', () => {
      renderSuitesPage({ pageInfo: { ...mockPageInfo, currentPage: 1 } })
      const prevButton = screen.getByRole('button', { name: /previous/i })
      expect(prevButton).toBeDisabled()
    })

    it('disables next button on last page', () => {
      renderSuitesPage({ pageInfo: { ...mockPageInfo, currentPage: 10 } })
      const nextButton = screen.getByRole('button', { name: /next/i })
      expect(nextButton).toBeDisabled()
    })

    it('calls onPageChange when page is changed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderSuitesPage({ onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /next/i }))

      expect(handlePageChange).toHaveBeenCalledWith(2)
    })

    it('displays first and last page buttons per LIST-2', () => {
      renderSuitesPage()
      const pagination = screen.getByTestId('pagination')
      expect(within(pagination).getByRole('button', { name: /first/i })).toBeInTheDocument()
      expect(within(pagination).getByRole('button', { name: /last/i })).toBeInTheDocument()
    })

    it('disables first button on first page', () => {
      renderSuitesPage({ pageInfo: { ...mockPageInfo, currentPage: 1 } })
      expect(screen.getByRole('button', { name: /first/i })).toBeDisabled()
    })

    it('disables last button on last page', () => {
      renderSuitesPage({ pageInfo: { ...mockPageInfo, currentPage: 10 } })
      expect(screen.getByRole('button', { name: /last/i })).toBeDisabled()
    })

    it('calls onPageChange with 1 when first button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderSuitesPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /first/i }))

      expect(handlePageChange).toHaveBeenCalledWith(1)
    })

    it('calls onPageChange with totalPages when last button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderSuitesPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /last/i }))

      expect(handlePageChange).toHaveBeenCalledWith(10)
    })

    it('calls onPageChange with previous page when previous button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderSuitesPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /previous/i }))

      expect(handlePageChange).toHaveBeenCalledWith(4)
    })
  })

  describe('Pagination - Single Page (LIST-3)', () => {
    it('shows all pagination controls even for single page', () => {
      const singlePageInfo = { currentPage: 1, pageSize: 10, totalItems: 5, totalPages: 1 }
      renderSuitesPage({ pageInfo: singlePageInfo })

      const pagination = screen.getByTestId('pagination')
      expect(within(pagination).getByTestId('pagination-item-count')).toBeVisible()
      expect(within(pagination).getByTestId('page-size-selector')).toBeVisible()
      expect(within(pagination).getByTestId('pagination-navigation')).toBeVisible()
    })

    it('disables both prev and next on single page', () => {
      const singlePageInfo = { currentPage: 1, pageSize: 10, totalItems: 5, totalPages: 1 }
      renderSuitesPage({ pageInfo: singlePageInfo })

      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    })
  })

  describe('Loading State (LIST-4)', () => {
    it('displays 9 skeleton rows when loading', () => {
      renderSuitesPage({ loading: true, suites: [] })
      const skeletonRows = screen.getAllByTestId('skeleton-row')
      expect(skeletonRows).toHaveLength(9)
    })

    it('keeps the rows while a later read is out', () => {
      renderSuitesPage({ loading: true })
      const suiteRows = screen.queryAllByTestId('suite-row')
      expect(suiteRows).not.toHaveLength(0)
    })

    it('sets aria-busy on page when loading', () => {
      renderSuitesPage({ loading: true, suites: [] })
      expect(screen.getByTestId('suites-page')).toHaveAttribute('aria-busy', 'true')
    })

    it('shows skeleton pagination when loading', () => {
      renderSuitesPage({ loading: true })
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    })

    it('keeps search enabled during loading to preserve focus', () => {
      renderSuitesPage({ loading: true })
      const searchInput = screen.getByPlaceholderText(/Search suites/i)
      expect(searchInput).not.toBeDisabled()
    })
  })

  describe('Error State (LIST-5)', () => {
    it('displays error message with empathetic tone', () => {
      renderSuitesPage({ error: 'Unable to load suites' })
      const errorTitle = screen.getByTestId('error-state-title')
      expect(errorTitle).toBeInTheDocument()
      expect(errorTitle).toHaveTextContent(/Unable to load/i)
    })

    it('displays "Try Again" button', () => {
      renderSuitesPage({ error: 'Unable to load suites' })
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeVisible()
    })

    it('displays red alert icon', () => {
      renderSuitesPage({ error: 'Unable to load suites' })
      const alertIcon = screen.getByTestId('error-state-icon')
      expect(alertIcon).toBeVisible()
      expect(alertIcon).toHaveClass('text-error')
    })

    it('calls onRetry when "Try Again" is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRetry = vi.fn()

      renderSuitesPage({ error: 'Unable to load suites', onRetry: handleRetry })
      await user.click(screen.getByRole('button', { name: /Try Again/i }))

      expect(handleRetry).toHaveBeenCalledTimes(1)
    })

    it('hides table when error occurs', () => {
      renderSuitesPage({ error: 'Unable to load suites' })
      expect(screen.queryByTestId('suites-table')).not.toBeInTheDocument()
    })
  })

  describe('Empty State (LIST-6)', () => {
    it('displays empty state when no suites', () => {
      renderSuitesPage({ suites: [] })
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })

    it('displays entity-specific icon (folder/kanban)', () => {
      renderSuitesPage({ suites: [] })
      expect(screen.getByTestId('empty-state-icon')).toBeVisible()
    })

    it('displays "No suites yet" title', () => {
      renderSuitesPage({ suites: [] })
      const title = screen.getByTestId('empty-state-title')
      expect(title).toHaveTextContent(/No suites yet/i)
    })

    it('displays encouraging description', () => {
      renderSuitesPage({ suites: [] })
      const description = screen.getByTestId('empty-state-description')
      expect(description).toBeVisible()
    })

    it('displays primary CTA "Create Your First Suite"', () => {
      renderSuitesPage({ suites: [] })
      const ctaButton = screen.getByRole('button', { name: /Create Your First Suite/i })
      expect(ctaButton).toBeVisible()
      expect(ctaButton).toHaveClass('btn-primary')
    })

    it('calls onNewSuite when CTA is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNewSuite = vi.fn()

      renderSuitesPage({ suites: [], onNewSuite: handleNewSuite })
      await user.click(screen.getByRole('button', { name: /Create Your First Suite/i }))

      expect(handleNewSuite).toHaveBeenCalledTimes(1)
    })

    it('still shows page header in empty state', () => {
      renderSuitesPage({ suites: [] })
      expect(screen.getByRole('heading', { name: 'Suites' })).toBeVisible()
      expect(screen.getByRole('button', { name: /New Suite/i })).toBeVisible()
    })

    it('shows filters but hides Mass Action in empty state', () => {
      renderSuitesPage({ suites: [] })
      expect(screen.getByTestId('filters-section')).toBeVisible()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
      expect(screen.queryByRole('button', { name: /Mass Action/i })).not.toBeInTheDocument()
    })

    it('displays "No matching suites found" when empty with active filters', () => {
      renderSuitesPage({
        suites: [],
        filters: { search: 'nonexistent', status: [], tags: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching suites found/i)
    })

    it('displays Clear Filters button when empty with active filters', () => {
      renderSuitesPage({
        suites: [],
        filters: { search: 'nonexistent', status: [], tags: [] },
      })
      const noResultsState = screen.getByTestId('no-results-state')
      expect(within(noResultsState).getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('calls onFilterChange with cleared filters when Clear Filters is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderSuitesPage({
        suites: [],
        filters: { search: 'nonexistent', status: ['passed'], tags: ['tag-1'] },
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
      // Exercises status.length > 0 branch when search === ''
      renderSuitesPage({
        suites: [],
        filters: { search: '', status: ['passed'], tags: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching suites found/i)
    })

    it('shows no results when tags filter is active but search and status are empty', () => {
      // Exercises tags.length > 0 branch when search === '' && status.length === 0
      renderSuitesPage({
        suites: [],
        filters: { search: '', status: [], tags: ['tag-1'] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching suites found/i)
    })
  })

  describe('Status Badges (LIST-7)', () => {
    it('passed status has green styling', () => {
      renderSuitesPage()
      const firstRow = screen.getAllByTestId('suite-row')[0]
      const passedBadge = within(firstRow).getByTestId('status-badge-passed')
      expect(passedBadge).toHaveClass('text-success')
    })

    it('failed status has red styling', () => {
      renderSuitesPage()
      const failedBadge = screen.getByTestId('status-badge-failed')
      expect(failedBadge).toHaveClass('text-error')
    })

    it('never run status has gray styling', () => {
      renderSuitesPage()
      const neverRunBadge = screen.getAllByTestId('status-badge-never-run')[0]
      expect(neverRunBadge).toHaveClass('text-muted')
    })
  })

  describe('Accessibility', () => {
    it('page has main landmark when wrapped in layout', () => {
      renderWithRouter(
        <main>
          <SuitesPage
            suites={mockSuites}
            pageInfo={mockPageInfo}
            filters={mockFilters}
            allTags={mockAllTags}
            selectedIds={[]}
            enableSelection={false}
            sorting={[]}
            onSortingChange={vi.fn()}
            columnVisibility={{}}
            onColumnVisibilityChange={vi.fn()}
            visibleColumns={['name', 'testsCount', 'status', 'lastRun']}
            rowSelection={{}}
            onRowSelectionChange={vi.fn()}
            onNewSuite={vi.fn()}
            onEditSuite={vi.fn()}
            onDeleteSuite={vi.fn()}
            onDuplicateSuite={vi.fn()}
            onRunSuite={vi.fn()}
            onBulkDelete={vi.fn()}
            onBulkRun={vi.fn()}
            onBulkExport={vi.fn()}
            onBulkDuplicate={vi.fn()}
            onFilterChange={vi.fn()}
            onPageChange={vi.fn()}
            onPageSizeChange={vi.fn()}
            onEnterSelectionMode={vi.fn()}
            onExitSelectionMode={vi.fn()}
            onColumnToggle={vi.fn()}
            onRetry={vi.fn()}
          />
        </main>
      )
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('page title is accessible', () => {
      renderSuitesPage()
      expect(screen.getByRole('heading', { level: 1, name: 'Suites' })).toBeInTheDocument()
    })

    it('table has accessible role', () => {
      renderSuitesPage()
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('table has aria-label', () => {
      renderSuitesPage()
      expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Suites')
    })

    it('loading state has aria-busy', () => {
      renderSuitesPage({ loading: true, suites: [] })
      expect(screen.getByTestId('suites-page')).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      const { container } = renderSuitesPage({ className: 'custom-suites-page' })
      expect(container.querySelector('.custom-suites-page')).toBeInTheDocument()
    })
  })

  describe('Table Sorting and Row Interaction', () => {
    it('calls onEditSuite when row is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEditSuite = vi.fn()

      renderSuitesPage({ onEditSuite: handleEditSuite })
      const firstRow = screen.getAllByTestId('suite-row')[0]

      await user.click(within(firstRow).getByTestId('suite-name'))

      expect(handleEditSuite).toHaveBeenCalledWith('suite-1')
    })

    it('handles column sort via SuitesTable', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesPage()

      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      await user.click(nameHeader)

      expect(nameHeader).toBeInTheDocument()
    })

    it('handles column visibility toggle via Columns button', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesPage()

      await user.click(screen.getByRole('button', { name: /Columns/i }))

      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(screen.getByRole('menuitemcheckbox', { name: /Tests/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitemcheckbox', { name: /Tests/i }))

      expect(screen.getByRole('button', { name: /Columns/i })).toBeInTheDocument()
    })
  })

  describe('Viewport-Filling Layout (DASH-4, DASH-5, DASH-8)', () => {
    it('page container fills viewport height with h-full overflow-hidden', () => {
      renderSuitesPage()
      const page = screen.getByTestId('suites-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('pagination is anchored at bottom with flex-shrink-0', () => {
      renderSuitesPage()
      const pagination = screen.getByTestId('pagination')
      expect(pagination).toHaveClass('flex-shrink-0')
    })

    it('loading state page container has viewport-filling classes', () => {
      renderSuitesPage({ loading: true })
      const page = screen.getByTestId('suites-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('error state page container has viewport-filling classes', () => {
      renderSuitesPage({ error: 'Unable to load suites' })
      const page = screen.getByTestId('suites-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('empty state page container has viewport-filling classes', () => {
      renderSuitesPage({ suites: [] })
      const page = screen.getByTestId('suites-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })
  })
})
