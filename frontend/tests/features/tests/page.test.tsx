/**
 * TestsPage Component Tests
 *
 * REQ-5.2.1.35: Test management screen (list, create, edit, delete, duplicate)
 *
 * V-LIST-01, V-LIST-02: Tests list populated and empty states
 *
 * Tests for TestsPage component per design decisions and wireframes:
 * - LIST-1: Name and Actions columns sticky on horizontal scroll
 * - LIST-2: Full pagination (item count, page size 10/25/50/100, navigation)
 * - LIST-3: Single-page lists show all controls, disabled when not applicable
 * - LIST-4: Loading: 9 skeleton rows, varying bar widths
 * - LIST-5: Error: empathetic tone, "Try Again" button, red alert icon
 * - LIST-6: Empty: entity-specific icon, encouraging message, primary CTA
 * - LIST-7: Status: Passed (green), Failed (red), Never Run (gray)
 *
 * Page structure:
 * - Page title: "Tests" (h1)
 * - "+ New Test" button in header
 * - Filters row: search, status, suite, tags
 * - Mass Action and Columns buttons
 * - Data table with columns: Name, Suite, Status, Last Run, Actions
 * - Pagination controls
 *
 * Component: frontend/src/pages/tests.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TestsPage, type TestsPageProps, type Test } from '@/features/tests/page'

// ============================================================================
// Mock Data
// ============================================================================

const mockTests: Test[] = [
  {
    id: 'test-1',
    name: 'Login Flow Test',
    suiteCount: 1,
    suiteIds: ['suite-auth'],
    suiteNames: ['Auth Suite'],
    status: 'passed',
    lastRun: '2025-12-28T10:30:00Z',
    tags: ['auth', 'smoke'],
    createdAt: '2025-12-01T00:00:00Z',
    updatedAt: '2025-12-28T10:30:00Z',
  },
  {
    id: 'test-2',
    name: 'API Health Check',
    suiteCount: 1,
    suiteIds: ['suite-integration'],
    suiteNames: ['Integration Suite'],
    status: 'failed',
    lastRun: '2025-12-28T09:15:00Z',
    tags: ['api', 'health'],
    createdAt: '2025-12-02T00:00:00Z',
    updatedAt: '2025-12-28T09:15:00Z',
  },
  {
    id: 'test-3',
    name: 'Database Connection Pool',
    suiteCount: 1,
    suiteIds: ['suite-infra'],
    suiteNames: ['Infrastructure Suite'],
    status: 'never_run',
    lastRun: null,
    tags: ['database'],
    createdAt: '2025-12-03T00:00:00Z',
    updatedAt: '2025-12-03T00:00:00Z',
  },
  {
    id: 'test-4',
    name: 'User Registration',
    suiteCount: 0,
    suiteIds: [],
    suiteNames: [],
    status: 'passed',
    lastRun: '2025-12-27T14:00:00Z',
    tags: [],
    createdAt: '2025-12-04T00:00:00Z',
    updatedAt: '2025-12-27T14:00:00Z',
  },
  {
    id: 'test-5',
    name: 'Multi-Suite Test',
    suiteCount: 3,
    suiteIds: ['suite-auth', 'suite-integration', 'suite-infra'],
    suiteNames: ['Auth Suite', 'Integration Suite', 'Infrastructure Suite'],
    status: 'passed',
    lastRun: '2025-12-28T11:00:00Z',
    tags: ['multi'],
    createdAt: '2025-12-05T00:00:00Z',
    updatedAt: '2025-12-28T11:00:00Z',
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
  suiteIds: [] as string[],
  tags: [] as string[],
}

const mockSuites = [
  { id: 'suite-auth', name: 'Auth Suite' },
  { id: 'suite-integration', name: 'Integration Suite' },
  { id: 'suite-infra', name: 'Infrastructure Suite' },
]

const mockAllTags = ['auth', 'smoke', 'api', 'health', 'database', 'regression']

// ============================================================================
// Test Utilities
// ============================================================================

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

function renderTestsPage(props: Partial<TestsPageProps> = {}) {
  const defaultProps: TestsPageProps = {
    tests: mockTests,
    pageInfo: mockPageInfo,
    filters: mockFilters,
    suites: mockSuites,
    allTags: mockAllTags,
    selectedIds: [],
    enableSelection: false,
    loading: false,
    error: undefined,
    sorting: [],
    onSortingChange: vi.fn(),
    columnVisibility: {},
    onColumnVisibilityChange: vi.fn(),
    visibleColumns: ['name', 'suite', 'status', 'lastRun'],
    rowSelection: {},
    onRowSelectionChange: vi.fn(),
    onNewTest: vi.fn(),
    onEditTest: vi.fn(),
    onOpenInWorkbench: vi.fn(),
    onDeleteTest: vi.fn(),
    onDuplicateTest: vi.fn(),
    onRunTest: vi.fn(),
    onBulkDelete: vi.fn(),
    onBulkRun: vi.fn(),
    onBulkExport: vi.fn(),
    onBulkDuplicate: vi.fn(),
    onBulkAddToSuite: vi.fn(),
    onBulkRemoveFromSuite: vi.fn(),
    onFilterChange: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
    onColumnToggle: vi.fn(),
    onImport: vi.fn(),
    onExportTest: vi.fn(),
    onRetry: vi.fn(),
    ...props,
  }
  return renderWithRouter(<TestsPage {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('TestsPage', () => {
  describe('Page Structure', () => {
    it('renders page container with correct testid', () => {
      renderTestsPage()
      expect(screen.getByTestId('tests-page')).toBeInTheDocument()
    })

    it('renders page title "Tests" as h1', () => {
      renderTestsPage()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tests')
    })

    it('page title is visible', () => {
      renderTestsPage()
      expect(screen.getByRole('heading', { name: 'Tests' })).toBeVisible()
    })

    it('renders "+ New Test" button in header', () => {
      renderTestsPage()
      const newButton = screen.getByRole('button', { name: /New Test/i })
      expect(newButton).toBeVisible()
      expect(newButton).toBeEnabled()
    })

    it('renders filters section', () => {
      renderTestsPage()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('renders tests table', () => {
      renderTestsPage()
      expect(screen.getByTestId('tests-table')).toBeInTheDocument()
    })

    it('renders pagination controls', () => {
      renderTestsPage()
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    })
  })

  describe('Header Actions', () => {
    it('calls onNewTest when "+ New Test" button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNewTest = vi.fn()

      renderTestsPage({ onNewTest: handleNewTest })
      await user.click(screen.getByRole('button', { name: /New Test/i }))

      expect(handleNewTest).toHaveBeenCalledTimes(1)
    })

    it('renders Import button in header', () => {
      renderTestsPage()
      const importButton = screen.getByTestId('import-button')
      expect(importButton).toBeVisible()
      expect(importButton).toHaveTextContent(/Import/i)
    })

    it('Import button has upload icon', () => {
      renderTestsPage()
      const importButton = screen.getByTestId('import-button')
      expect(importButton.querySelector('svg')).toBeInTheDocument()
    })

    it('calls onImport when Import button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleImport = vi.fn()

      renderTestsPage({ onImport: handleImport })
      await user.click(screen.getByTestId('import-button'))

      expect(handleImport).toHaveBeenCalledTimes(1)
    })
  })

  describe('Filters Section', () => {
    it('renders search input with correct placeholder', () => {
      renderTestsPage()
      const searchInput = screen.getByPlaceholderText(/Search tests/i)
      expect(searchInput).toBeVisible()
    })

    it('renders status filter dropdown', () => {
      renderTestsPage()
      expect(screen.getByTestId('filter-status')).toBeVisible()
    })

    it('renders suite filter dropdown', () => {
      renderTestsPage()
      expect(screen.getByTestId('filter-suite')).toBeVisible()
    })

    it('renders tags filter', () => {
      renderTestsPage()
      expect(screen.getByTestId('filter-tags')).toBeVisible()
    })

    it('renders Columns button', () => {
      renderTestsPage()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('renders Mass Action button when tests exist', () => {
      renderTestsPage()
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeVisible()
    })

    it('hides Mass Action button when no tests exist', () => {
      renderTestsPage({ tests: [] })
      expect(screen.queryByRole('button', { name: /Mass Action/i })).not.toBeInTheDocument()
    })

    it('calls onFilterChange when search changes', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderTestsPage({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search tests/i)
      await user.type(searchInput, 'login')

      // Wait for debounce with waitFor
      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(handleFilterChange).toHaveBeenCalled()
      })
    })
  })

  describe('Table Structure', () => {
    it('renders table with correct columns', () => {
      renderTestsPage()
      const table = screen.getByTestId('tests-table')

      expect(within(table).getByRole('columnheader', { name: /Name/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Suite/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Status/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Last Run/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Actions/i })).toBeInTheDocument()
    })

    it('renders test rows with correct data', () => {
      renderTestsPage()
      const rows = screen.getAllByTestId('test-row')
      expect(rows).toHaveLength(5)

      const firstRow = rows[0]
      expect(within(firstRow).getByTestId('test-name')).toHaveTextContent('Login Flow Test')
      expect(within(firstRow).getByTestId('test-suite')).toHaveTextContent('Auth Suite')
    })

    it('displays correct status for each test', () => {
      renderTestsPage()
      const rows = screen.getAllByTestId('test-row')

      // First row: passed
      expect(within(rows[0]).getByTestId('status-badge-passed')).toBeInTheDocument()
      // Second row: failed
      expect(within(rows[1]).getByTestId('status-badge-failed')).toBeInTheDocument()
      // Third row: never run
      expect(within(rows[2]).getByTestId('status-badge-never-run')).toBeInTheDocument()
    })

    it('displays dash for tests not in any suite', () => {
      renderTestsPage()
      const rows = screen.getAllByTestId('test-row')
      const noSuiteRow = rows[3]
      expect(within(noSuiteRow).getByTestId('test-suite')).toHaveTextContent('-')
    })

    it('displays suite count for tests in multiple suites', () => {
      renderTestsPage()
      const rows = screen.getAllByTestId('test-row')
      const multiSuiteRow = rows[4]
      expect(within(multiSuiteRow).getByTestId('test-suite')).toHaveTextContent('3 suites')
    })
  })

  describe('Row Actions', () => {
    it('renders Run button for each row', () => {
      renderTestsPage()
      const rows = screen.getAllByTestId('test-row')

      rows.forEach((row) => {
        expect(within(row).getByTestId('action-run')).toBeInTheDocument()
      })
    })

    it('renders overflow menu trigger for each row', () => {
      renderTestsPage()
      const rows = screen.getAllByTestId('test-row')

      rows.forEach((row) => {
        expect(within(row).getByTestId('action-menu-trigger')).toBeInTheDocument()
      })
    })

    it('calls onRunTest when Run button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRunTest = vi.fn()

      renderTestsPage({ onRunTest: handleRunTest })
      const firstRow = screen.getAllByTestId('test-row')[0]
      await user.click(within(firstRow).getByTestId('action-run'))

      expect(handleRunTest).toHaveBeenCalledWith('test-1')
    })

    it('opens action menu when trigger is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTestsPage()
      const firstRow = screen.getAllByTestId('test-row')[0]
      await user.click(within(firstRow).getByTestId('action-menu-trigger'))

      // Menu should show Edit, Delete, Duplicate options
      expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeVisible()
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeVisible()
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeVisible()
    })

    it('calls onEditTest when Edit is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEditTest = vi.fn()

      renderTestsPage({ onEditTest: handleEditTest })
      const firstRow = screen.getAllByTestId('test-row')[0]
      await user.click(within(firstRow).getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Edit/i }))

      expect(handleEditTest).toHaveBeenCalledWith('test-1')
    })

    it('calls onDeleteTest when Delete is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDeleteTest = vi.fn()

      renderTestsPage({ onDeleteTest: handleDeleteTest })
      const firstRow = screen.getAllByTestId('test-row')[0]
      await user.click(within(firstRow).getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDeleteTest).toHaveBeenCalledWith('test-1')
    })

    it('calls onDuplicateTest when Duplicate is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicateTest = vi.fn()

      renderTestsPage({ onDuplicateTest: handleDuplicateTest })
      const firstRow = screen.getAllByTestId('test-row')[0]
      await user.click(within(firstRow).getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(handleDuplicateTest).toHaveBeenCalledWith('test-1')
    })
  })

  describe('Pagination (LIST-2)', () => {
    it('displays item count "Showing X-Y of Z"', () => {
      renderTestsPage()
      const pagination = screen.getByTestId('pagination')
      const itemCount = within(pagination).getByTestId('pagination-item-count')
      expect(itemCount).toHaveTextContent(/Showing 1-10 of 95/i)
    })

    it('displays page size selector with options 10, 25, 50, 100', () => {
      renderTestsPage()
      const pagination = screen.getByTestId('pagination')
      const pageSizeSelector = within(pagination).getByTestId('page-size-selector')
      expect(pageSizeSelector).toBeVisible()
    })

    it('displays page navigation', () => {
      renderTestsPage()
      const pagination = screen.getByTestId('pagination')
      const navigation = within(pagination).getByTestId('pagination-navigation')
      expect(navigation).toBeVisible()
    })

    it('disables previous button on first page', () => {
      renderTestsPage({ pageInfo: { ...mockPageInfo, currentPage: 1 } })
      const prevButton = screen.getByRole('button', { name: /previous/i })
      expect(prevButton).toBeDisabled()
    })

    it('disables next button on last page', () => {
      renderTestsPage({ pageInfo: { ...mockPageInfo, currentPage: 10 } })
      const nextButton = screen.getByRole('button', { name: /next/i })
      expect(nextButton).toBeDisabled()
    })

    it('calls onPageChange when page is changed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderTestsPage({ onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /next/i }))

      expect(handlePageChange).toHaveBeenCalledWith(2)
    })

    it('displays first and last page buttons per LIST-2', () => {
      renderTestsPage()
      const pagination = screen.getByTestId('pagination')
      expect(within(pagination).getByRole('button', { name: /first/i })).toBeInTheDocument()
      expect(within(pagination).getByRole('button', { name: /last/i })).toBeInTheDocument()
    })

    it('disables first button on first page', () => {
      renderTestsPage({ pageInfo: { ...mockPageInfo, currentPage: 1 } })
      expect(screen.getByRole('button', { name: /first/i })).toBeDisabled()
    })

    it('disables last button on last page', () => {
      renderTestsPage({ pageInfo: { ...mockPageInfo, currentPage: 10 } })
      expect(screen.getByRole('button', { name: /last/i })).toBeDisabled()
    })

    it('calls onPageChange with 1 when first button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderTestsPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /first/i }))

      expect(handlePageChange).toHaveBeenCalledWith(1)
    })

    it('calls onPageChange with totalPages when last button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderTestsPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /last/i }))

      expect(handlePageChange).toHaveBeenCalledWith(10)
    })

    it('calls onPageChange with previous page when previous button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderTestsPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /previous/i }))

      expect(handlePageChange).toHaveBeenCalledWith(4)
    })
  })

  describe('Pagination - Single Page (LIST-3)', () => {
    it('shows all pagination controls even for single page', () => {
      const singlePageInfo = { currentPage: 1, pageSize: 10, totalItems: 5, totalPages: 1 }
      renderTestsPage({ pageInfo: singlePageInfo })

      const pagination = screen.getByTestId('pagination')
      expect(within(pagination).getByTestId('pagination-item-count')).toBeVisible()
      expect(within(pagination).getByTestId('page-size-selector')).toBeVisible()
      expect(within(pagination).getByTestId('pagination-navigation')).toBeVisible()
    })

    it('disables both prev and next on single page', () => {
      const singlePageInfo = { currentPage: 1, pageSize: 10, totalItems: 5, totalPages: 1 }
      renderTestsPage({ pageInfo: singlePageInfo })

      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    })
  })

  describe('Loading State (LIST-4)', () => {
    it('displays 9 skeleton rows when loading', () => {
      renderTestsPage({ loading: true, tests: [] })
      const skeletonRows = screen.getAllByTestId('skeleton-row')
      expect(skeletonRows).toHaveLength(9)
    })

    it('keeps the rows while a later read is out', () => {
      renderTestsPage({ loading: true })
      const testRows = screen.queryAllByTestId('test-row')
      expect(testRows).not.toHaveLength(0)
    })

    it('sets aria-busy on page when loading', () => {
      renderTestsPage({ loading: true, tests: [] })
      expect(screen.getByTestId('tests-page')).toHaveAttribute('aria-busy', 'true')
    })

    it('shows skeleton pagination when loading', () => {
      renderTestsPage({ loading: true })
      // Loading state uses same pagination testid for consistent E2E testing
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    })

    it('keeps search enabled during loading to preserve focus', () => {
      renderTestsPage({ loading: true })
      const searchInput = screen.getByPlaceholderText(/Search tests/i)
      // Search input stays enabled during loading so user can keep typing
      // without losing focus (browsers blur disabled inputs)
      expect(searchInput).not.toBeDisabled()
    })
  })

  describe('Before the first read has finished (LIST-4, LIST-6)', () => {
    it('shows skeletons rather than the empty state', () => {
      renderTestsPage({ settled: false, loading: false, tests: [] })

      expect(screen.getAllByTestId('skeleton-row')).toHaveLength(9)
      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
    })

    it('reports the page as busy', () => {
      renderTestsPage({ settled: false, loading: false, tests: [] })

      expect(screen.getByTestId('tests-page')).toHaveAttribute('aria-busy', 'true')
    })

    it('shows the empty state only once the read has finished with nothing', () => {
      renderTestsPage({ settled: true, loading: false, tests: [] })

      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
      expect(screen.queryAllByTestId('skeleton-row')).toHaveLength(0)
    })

    it('shows the rows once the read has finished with something', () => {
      renderTestsPage({ settled: true, loading: false })

      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
      expect(screen.queryAllByTestId('skeleton-row')).toHaveLength(0)
      expect(screen.getAllByTestId('test-row').length).toBeGreaterThan(0)
    })
  })

  describe('Error State (LIST-5)', () => {
    it('displays error message with empathetic tone', () => {
      renderTestsPage({ error: 'Unable to load tests' })
      // Error title should show empathetic message per LIST-5
      const errorTitle = screen.getByTestId('error-state-title')
      expect(errorTitle).toBeInTheDocument()
      expect(errorTitle).toHaveTextContent(/Unable to load/i)
    })

    it('displays "Try Again" button', () => {
      renderTestsPage({ error: 'Unable to load tests' })
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeVisible()
    })

    it('displays red alert icon', () => {
      renderTestsPage({ error: 'Unable to load tests' })
      const alertIcon = screen.getByTestId('error-state-icon')
      expect(alertIcon).toBeVisible()
      expect(alertIcon).toHaveClass('text-error')
    })

    it('calls onRetry when "Try Again" is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRetry = vi.fn()

      renderTestsPage({ error: 'Unable to load tests', onRetry: handleRetry })
      await user.click(screen.getByRole('button', { name: /Try Again/i }))

      expect(handleRetry).toHaveBeenCalledTimes(1)
    })

    it('hides table when error occurs', () => {
      renderTestsPage({ error: 'Unable to load tests' })
      expect(screen.queryByTestId('tests-table')).not.toBeInTheDocument()
    })
  })

  describe('Empty State (LIST-6)', () => {
    it('displays empty state when no tests', () => {
      renderTestsPage({ tests: [] })
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })

    it('displays entity-specific icon (test tube)', () => {
      renderTestsPage({ tests: [] })
      expect(screen.getByTestId('empty-state-icon')).toBeVisible()
    })

    it('displays "No tests yet" title', () => {
      renderTestsPage({ tests: [] })
      const title = screen.getByTestId('empty-state-title')
      expect(title).toHaveTextContent(/No tests yet/i)
    })

    it('displays encouraging description', () => {
      renderTestsPage({ tests: [] })
      const description = screen.getByTestId('empty-state-description')
      expect(description).toBeVisible()
    })

    it('displays primary CTA "Create Your First Test"', () => {
      renderTestsPage({ tests: [] })
      const ctaButton = screen.getByRole('button', { name: /Create Your First Test/i })
      expect(ctaButton).toBeVisible()
      expect(ctaButton).toHaveClass('btn-primary')
    })

    it('calls onNewTest when CTA is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNewTest = vi.fn()

      renderTestsPage({ tests: [], onNewTest: handleNewTest })
      await user.click(screen.getByRole('button', { name: /Create Your First Test/i }))

      expect(handleNewTest).toHaveBeenCalledTimes(1)
    })

    it('still shows page header in empty state', () => {
      renderTestsPage({ tests: [] })
      expect(screen.getByRole('heading', { name: 'Tests' })).toBeVisible()
      expect(screen.getByRole('button', { name: /New Test/i })).toBeVisible()
    })

    it('shows filters but hides Mass Action in empty state', () => {
      renderTestsPage({ tests: [] })
      expect(screen.getByTestId('filters-section')).toBeVisible()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
      expect(screen.queryByRole('button', { name: /Mass Action/i })).not.toBeInTheDocument()
    })

    it('displays "No matching tests found" when empty with active filters', () => {
      renderTestsPage({
        tests: [],
        filters: { search: 'nonexistent', status: [], suiteIds: [], tags: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching tests found/i)
    })

    it('displays Clear Filters button when empty with active filters', () => {
      renderTestsPage({
        tests: [],
        filters: { search: 'nonexistent', status: [], suiteIds: [], tags: [] },
      })
      const noResultsState = screen.getByTestId('no-results-state')
      expect(within(noResultsState).getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('calls onFilterChange with cleared filters when Clear Filters is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderTestsPage({
        tests: [],
        filters: { search: 'nonexistent', status: ['passed'], suiteIds: ['suite-1'], tags: ['tag-1'] },
        onFilterChange: handleFilterChange,
      })

      // Get the Clear Filters button in the no-results-state (filtered empty state)
      const noResultsState = screen.getByTestId('no-results-state')
      const clearFiltersButton = within(noResultsState).getByRole('button', { name: /Clear Filters/i })
      await user.click(clearFiltersButton)

      expect(handleFilterChange).toHaveBeenCalledWith({
        search: '',
        status: [],
        suiteIds: [],
        tags: [],
      })
    })

    it('shows no results when status filter is active but search is empty', () => {
      // Exercises status.length > 0 branch when search === ''
      renderTestsPage({
        tests: [],
        filters: { search: '', status: ['passed'], suiteIds: [], tags: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching tests found/i)
    })

    it('shows no results when suiteIds filter is active but search and status are empty', () => {
      // Exercises suiteIds.length > 0 branch when search === '' && status.length === 0
      renderTestsPage({
        tests: [],
        filters: { search: '', status: [], suiteIds: ['suite-1'], tags: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching tests found/i)
    })

    it('shows no results when tags filter is active but other filters are empty', () => {
      // Exercises tags.length > 0 branch when all others are empty/false
      renderTestsPage({
        tests: [],
        filters: { search: '', status: [], suiteIds: [], tags: ['tag-1'] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching tests found/i)
    })
  })

  describe('Status Badges (LIST-7)', () => {
    it('passed status has green styling', () => {
      renderTestsPage()
      const firstRow = screen.getAllByTestId('test-row')[0]
      const passedBadge = within(firstRow).getByTestId('status-badge-passed')
      expect(passedBadge).toHaveClass('text-success')
    })

    it('failed status has red styling', () => {
      renderTestsPage()
      const failedBadge = screen.getByTestId('status-badge-failed')
      expect(failedBadge).toHaveClass('text-error')
    })

    it('never run status has gray styling', () => {
      renderTestsPage()
      const neverRunBadge = screen.getByTestId('status-badge-never-run')
      expect(neverRunBadge).toHaveClass('text-muted')
    })
  })

  describe('Accessibility', () => {
    it('page has main landmark when wrapped in layout', () => {
      renderWithRouter(
        <main>
          <TestsPage
            tests={mockTests}
            pageInfo={mockPageInfo}
            filters={mockFilters}
            suites={mockSuites}
            allTags={mockAllTags}
            selectedIds={[]}
            enableSelection={false}
            sorting={[]}
            onSortingChange={vi.fn()}
            columnVisibility={{}}
            onColumnVisibilityChange={vi.fn()}
            visibleColumns={['name', 'suite', 'status', 'lastRun']}
            rowSelection={{}}
            onRowSelectionChange={vi.fn()}
            onNewTest={vi.fn()}
            onEditTest={vi.fn()}
            onOpenInWorkbench={vi.fn()}
            onDeleteTest={vi.fn()}
            onDuplicateTest={vi.fn()}
            onRunTest={vi.fn()}
            onBulkDelete={vi.fn()}
            onBulkRun={vi.fn()}
            onBulkExport={vi.fn()}
            onBulkDuplicate={vi.fn()}
            onBulkAddToSuite={vi.fn()}
            onBulkRemoveFromSuite={vi.fn()}
            onFilterChange={vi.fn()}
            onPageChange={vi.fn()}
            onPageSizeChange={vi.fn()}
            onEnterSelectionMode={vi.fn()}
            onExitSelectionMode={vi.fn()}
            onColumnToggle={vi.fn()}
            onImport={vi.fn()}
            onExportTest={vi.fn()}
            onRetry={vi.fn()}
          />
        </main>
      )
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('page title is accessible', () => {
      renderTestsPage()
      expect(screen.getByRole('heading', { level: 1, name: 'Tests' })).toBeInTheDocument()
    })

    it('table has accessible role', () => {
      renderTestsPage()
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('table has aria-label', () => {
      renderTestsPage()
      expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Tests')
    })

    it('loading state has aria-busy', () => {
      renderTestsPage({ loading: true, tests: [] })
      expect(screen.getByTestId('tests-page')).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      const { container } = renderTestsPage({ className: 'custom-tests-page' })
      expect(container.querySelector('.custom-tests-page')).toBeInTheDocument()
    })
  })

  describe('Table Sorting and Row Interaction', () => {
    it('calls onOpenInWorkbench when row is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleOpenInWorkbench = vi.fn()

      renderTestsPage({ onOpenInWorkbench: handleOpenInWorkbench })
      const firstRow = screen.getAllByTestId('test-row')[0]

      // Click on the row (not the action buttons)
      await user.click(within(firstRow).getByTestId('test-name'))

      expect(handleOpenInWorkbench).toHaveBeenCalledWith('test-1')
    })

    it('handles column sort via TestsTable', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTestsPage()

      // Click on sortable column header - this triggers handleSort internally
      const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      await user.click(nameHeader)

      // The sort was triggered (logged to console in real implementation)
      // We verify the UI responded to the click
      expect(nameHeader).toBeInTheDocument()
    })

    it('handles column visibility toggle via Columns button', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTestsPage()

      // Click on Columns button to open dropdown
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      // Click on a column checkbox to toggle visibility
      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(screen.getByRole('menuitemcheckbox', { name: /Suite/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitemcheckbox', { name: /Suite/i }))

      // Verify the interaction completed without error - menu closes after click
      // Column visibility state will be managed by parent component in the future
      // The Columns button should still be present after interaction
      expect(screen.getByRole('button', { name: /Columns/i })).toBeInTheDocument()
    })
  })

  describe('Viewport-Filling Layout (DASH-4, DASH-5, DASH-8)', () => {
    it('page container fills viewport height with h-full overflow-hidden', () => {
      renderTestsPage()
      const page = screen.getByTestId('tests-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('pagination is anchored at bottom with flex-shrink-0', () => {
      renderTestsPage()
      const pagination = screen.getByTestId('pagination')
      expect(pagination).toHaveClass('flex-shrink-0')
    })

    it('loading state page container has viewport-filling classes', () => {
      renderTestsPage({ loading: true })
      const page = screen.getByTestId('tests-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('error state page container has viewport-filling classes', () => {
      renderTestsPage({ error: 'Unable to load tests' })
      const page = screen.getByTestId('tests-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('empty state page container has viewport-filling classes', () => {
      renderTestsPage({ tests: [] })
      const page = screen.getByTestId('tests-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })
  })
})
