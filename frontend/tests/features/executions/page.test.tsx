/**
 * ExecutionsPage Component Tests
 *
 * REQ-5.2.1.40: Execution history screen (list executions, filter by status/date, compare runs, re-run)
 *
 * V-LIST-11: Executions list populated
 *
 * Tests for ExecutionsPage component per design decisions and wireframes:
 * - LIST-1: Name and Actions columns sticky
 * - LIST-2: Full pagination (item count, page size 10/25/50/100, navigation)
 * - LIST-3: Single-page lists show all controls, disabled when not applicable
 * - LIST-4: Loading: 9 skeleton rows, varying bar widths
 * - LIST-5: Error: empathetic tone, "Try Again" button, red alert icon
 * - LIST-6: Empty: entity-specific icon (play icon), encouraging message, "Go to Tests" CTA
 * - LIST-8: Executions list has NO "New" button
 *
 * Page structure:
 * - Page title: "Executions" (h1)
 * - NO "+ New" button (executions created by running entities)
 * - Filters row: search, status (Running/Passed/Failed/Stopped), type (Test/Suite/Regression)
 * - Columns button
 * - DataTable with columns: Name, Type, Triggered By, Started, Duration, Status, Actions
 * - Pagination controls (built into DataTable)
 * - Selection mode with Mass Action button (Export, Delete)
 *
 * Component: frontend/src/features/executions/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ExecutionsPage, type ExecutionsPageProps, type Execution } from '@/features/executions/page'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'

vi.mock('@/features/executions/api/export', () => ({
  downloadExecutionExport: vi.fn(),
  exportExecutions: vi.fn(),
}))

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

import { downloadExecutionExport, exportExecutions } from '@/features/executions/api/export'
import { downloadBlob } from '@/lib/download-blob'

// ============================================================================
// Mock Data
// ============================================================================

const mockExecutions: Execution[] = [
  {
    id: 'exec-1',
    name: 'Login Test',
    type: 'test',
    triggeredBy: 'John Doe',
    startedAt: '2025-01-15T10:30:00Z',
    completedAt: '2025-01-15T10:32:34Z',
    duration: 154,
    durationFormatted: '2m 34s',
    status: 'passed',
    entityId: 'test-123',
  },
  {
    id: 'exec-2',
    name: 'Auth Suite',
    type: 'suite',
    triggeredBy: 'CI Pipeline',
    startedAt: '2025-01-15T10:00:00Z',
    completedAt: null,
    duration: null,
    durationFormatted: '-',
    status: 'running',
    entityId: 'suite-456',
  },
  {
    id: 'exec-3',
    name: 'Full Regression',
    type: 'regression',
    triggeredBy: 'Scheduled',
    startedAt: '2025-01-15T09:00:00Z',
    completedAt: '2025-01-15T09:30:00Z',
    duration: 1800,
    durationFormatted: '30m',
    status: 'failed',
    entityId: 'reg-789',
  },
  {
    id: 'exec-4',
    name: 'Smoke Test',
    type: 'test',
    triggeredBy: 'Jane Doe',
    startedAt: '2025-01-15T08:00:00Z',
    completedAt: '2025-01-15T08:00:05Z',
    duration: 5,
    durationFormatted: '5s',
    status: 'stopped',
    entityId: 'test-101',
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
  type: [] as string[],
  user: [] as string[],
}

// ============================================================================
// Test Utilities
// ============================================================================

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <MemoryRouter>{ui}</MemoryRouter>
      <ToastContainer />
    </ToastProvider>
  )
}

function renderExecutionsPage(props: Partial<ExecutionsPageProps> = {}) {
  const defaultProps: ExecutionsPageProps = {
    executions: mockExecutions,
    allUsers: [] as string[],
    pageInfo: mockPageInfo,
    filters: mockFilters,
    loading: false,
    error: undefined,
    sorting: [{ id: 'startedAt', desc: true }],
    onSortingChange: vi.fn(),
    columnVisibility: {},
    onColumnVisibilityChange: vi.fn(),
    visibleColumns: ['name', 'type', 'triggeredBy', 'startedAt', 'duration', 'status'],
    enableSelection: false,
    selectedIds: [],
    rowSelection: {},
    onRowSelectionChange: vi.fn(),
    onViewExecution: vi.fn(),
    onRerunExecution: vi.fn(),
    onStopExecution: vi.fn(),
    onDeleteExecution: vi.fn(),
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
  return renderWithRouter(<ExecutionsPage {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('ExecutionsPage', () => {
  describe('Page Structure', () => {
    it('renders page container with correct testid', () => {
      renderExecutionsPage()
      expect(screen.getByTestId('executions-page')).toBeInTheDocument()
    })

    it('renders page title "Executions" as h1', () => {
      renderExecutionsPage()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Executions')
    })

    it('page title is visible', () => {
      renderExecutionsPage()
      expect(screen.getByRole('heading', { name: 'Executions' })).toBeVisible()
    })

    it('does NOT render "+ New" button (LIST-8: executions created by running entities)', () => {
      renderExecutionsPage()
      expect(screen.queryByRole('button', { name: /New/i })).not.toBeInTheDocument()
    })

    it('renders filters section', () => {
      renderExecutionsPage()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('renders executions table', () => {
      renderExecutionsPage()
      expect(screen.getByTestId('executions-table')).toBeInTheDocument()
    })

    it('renders pagination controls', () => {
      renderExecutionsPage()
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    })
  })

  describe('Filters Section', () => {
    it('renders search input with correct placeholder', () => {
      renderExecutionsPage()
      const searchInput = screen.getByPlaceholderText(/Search executions/i)
      expect(searchInput).toBeVisible()
    })

    it('renders status filter dropdown', () => {
      renderExecutionsPage()
      expect(screen.getByTestId('filter-status')).toBeVisible()
    })

    it('renders type filter dropdown', () => {
      renderExecutionsPage()
      expect(screen.getByTestId('filter-type')).toBeVisible()
    })

    it('renders Columns button', () => {
      renderExecutionsPage()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('renders Columns button with correct testid', () => {
      renderExecutionsPage()
      expect(screen.getByTestId('columns-button')).toBeInTheDocument()
    })

    it('renders Mass Action button (selection mode toggle)', () => {
      renderExecutionsPage()
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    })

    it('calls onFilterChange when search changes', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderExecutionsPage({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search executions/i)
      await user.type(searchInput, 'Login')

      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(handleFilterChange).toHaveBeenCalled()
      })
    })
  })

  describe('Table Structure', () => {
    it('renders table with correct columns', () => {
      renderExecutionsPage()
      const table = screen.getByTestId('executions-table')

      expect(within(table).getByRole('columnheader', { name: /Name/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Type/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Triggered By/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Started/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Duration/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Status/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /Actions/i })).toBeInTheDocument()
    })

    it('does NOT render checkbox column when selection is disabled', () => {
      renderExecutionsPage({ enableSelection: false })
      const table = screen.getByTestId('executions-table')
      expect(within(table).queryByRole('checkbox', { name: /select all/i })).not.toBeInTheDocument()
    })

    it('renders execution rows with correct data', () => {
      renderExecutionsPage()
      const rows = screen.getAllByTestId('execution-row')
      expect(rows).toHaveLength(4)

      const firstRow = rows[0]
      expect(within(firstRow).getByTestId('execution-name')).toHaveTextContent('Login Test')
      expect(within(firstRow).getByTestId('execution-type')).toHaveTextContent('Test')
      expect(within(firstRow).getByTestId('execution-triggered-by')).toHaveTextContent('John Doe')
    })

    it('displays correct status for each execution', () => {
      renderExecutionsPage()
      const rows = screen.getAllByTestId('execution-row')

      expect(within(rows[0]).getByTestId('status-badge-passed')).toBeInTheDocument()
      expect(within(rows[1]).getByTestId('status-badge-running')).toBeInTheDocument()
      expect(within(rows[2]).getByTestId('status-badge-failed')).toBeInTheDocument()
      expect(within(rows[3]).getByTestId('status-badge-stopped')).toBeInTheDocument()
    })

    it('displays correct type for each execution', () => {
      renderExecutionsPage()
      const rows = screen.getAllByTestId('execution-row')

      expect(within(rows[0]).getByTestId('execution-type')).toHaveTextContent('Test')
      expect(within(rows[1]).getByTestId('execution-type')).toHaveTextContent('Suite')
      expect(within(rows[2]).getByTestId('execution-type')).toHaveTextContent('Regression')
    })
  })

  describe('Row Actions', () => {
    it('renders View button for each row', () => {
      renderExecutionsPage()
      const rows = screen.getAllByTestId('execution-row')

      rows.forEach((row) => {
        expect(within(row).getByTestId('row-action-view')).toBeInTheDocument()
      })
    })

    it('renders Stop button only for running executions', () => {
      renderExecutionsPage()
      const rows = screen.getAllByTestId('execution-row')

      // Running execution has Stop button
      expect(within(rows[1]).getByTestId('row-action-stop')).toBeInTheDocument()

      // Non-running executions don't have Stop button
      expect(within(rows[0]).queryByTestId('row-action-stop')).not.toBeInTheDocument()
      expect(within(rows[2]).queryByTestId('row-action-stop')).not.toBeInTheDocument()
      expect(within(rows[3]).queryByTestId('row-action-stop')).not.toBeInTheDocument()
    })

    it('renders Delete button for non-running executions', () => {
      renderExecutionsPage()
      const rows = screen.getAllByTestId('execution-row')

      // Non-running rows should have delete button
      expect(within(rows[0]).getByTestId('row-action-delete')).toBeInTheDocument() // passed
      expect(within(rows[2]).getByTestId('row-action-delete')).toBeInTheDocument() // failed
      expect(within(rows[3]).getByTestId('row-action-delete')).toBeInTheDocument() // canceled

      // Running row should not have delete button
      expect(within(rows[1]).queryByTestId('row-action-delete')).not.toBeInTheDocument()
    })

    it('calls onViewExecution when View button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleViewExecution = vi.fn()

      renderExecutionsPage({ onViewExecution: handleViewExecution })
      const firstRow = screen.getAllByTestId('execution-row')[0]
      await user.click(within(firstRow).getByTestId('row-action-view'))

      expect(handleViewExecution).toHaveBeenCalledWith('exec-1')
    })

    it('calls onRerunExecution when Re-run button is clicked on a terminal execution', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRerun = vi.fn()

      renderExecutionsPage({ onRerunExecution: handleRerun })
      const terminalRow = screen.getAllByTestId('execution-row')[0]
      await user.click(within(terminalRow).getByTestId('row-action-rerun'))

      expect(handleRerun).toHaveBeenCalledWith('exec-1')
    })

    it('calls onStopExecution when Stop button is clicked and confirmed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleStopExecution = vi.fn()

      renderExecutionsPage({ onStopExecution: handleStopExecution })
      const runningRow = screen.getAllByTestId('execution-row')[1]

      // Click Stop button to open confirmation dialog
      await user.click(within(runningRow).getByTestId('row-action-stop'))

      // Confirm the action in the dialog
      const dialog = screen.getByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: /^stop$/i }))

      expect(handleStopExecution).toHaveBeenCalledWith('exec-2')
    })
  })

  describe('Export Flow (row + bulk via shared ExportDialog)', () => {
    beforeEach(() => {
      vi.mocked(downloadExecutionExport).mockReset()
      vi.mocked(exportExecutions).mockReset()
      vi.mocked(downloadBlob).mockReset()
    })

    it('renders an Export action on every row', () => {
      renderExecutionsPage()
      const rows = screen.getAllByTestId('execution-row')

      rows.forEach((row) => {
        expect(within(row).getByTestId('row-action-export')).toBeInTheDocument()
      })
    })

    it('row Export opens the shared dialog with JSON preselected and no secrets checkbox', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsPage()
      const firstRow = screen.getAllByTestId('execution-row')[0]
      await user.click(within(firstRow).getByTestId('row-action-export'))

      const dialog = await screen.findByTestId('export-dialog')
      expect(dialog).toBeInTheDocument()
      expect(within(dialog).getByText('Login Test')).toBeInTheDocument()
      expect(within(dialog).getByTestId('format-json')).toHaveAttribute('data-state', 'checked')
      expect(within(dialog).queryByTestId('secrets-mode-picker')).not.toBeInTheDocument()
    })

    it('confirming a row export downloads the single execution in the chosen format', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      vi.mocked(downloadExecutionExport).mockResolvedValue(undefined)

      renderExecutionsPage()
      const firstRow = screen.getAllByTestId('execution-row')[0]
      await user.click(within(firstRow).getByTestId('row-action-export'))

      const dialog = await screen.findByTestId('export-dialog')
      await user.click(within(dialog).getByTestId('format-yaml'))
      await user.click(within(dialog).getByTestId('export-button'))

      await waitFor(() => {
        expect(downloadExecutionExport).toHaveBeenCalledWith('exec-1', { format: 'yaml' })
      })
      expect(exportExecutions).not.toHaveBeenCalled()
    })

    it('bulk Export opens the dialog and downloads the ZIP for the selection', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const zipBlob = new Blob(['zip'], { type: 'application/zip' })
      vi.mocked(exportExecutions).mockResolvedValue(zipBlob)

      renderExecutionsPage({ enableSelection: true, selectedIds: ['exec-1', 'exec-3'] })
      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await user.click(await screen.findByTestId('bulk-action-export'))

      const dialog = await screen.findByTestId('export-dialog')
      expect(within(dialog).getByText(/Export 2 executions/i)).toBeInTheDocument()
      await user.click(within(dialog).getByTestId('export-button'))

      await waitFor(() => {
        expect(exportExecutions).toHaveBeenCalledWith(['exec-1', 'exec-3'], 'json')
      })
      expect(downloadBlob).toHaveBeenCalledWith(zipBlob, 'executions-export.zip')
      expect(downloadExecutionExport).not.toHaveBeenCalled()
    })
  })

  describe('Pagination (LIST-2)', () => {
    it('displays item count "Showing X-Y of Z"', () => {
      renderExecutionsPage()
      const pagination = screen.getByTestId('pagination')
      const itemCount = within(pagination).getByTestId('pagination-item-count')
      expect(itemCount).toHaveTextContent(/Showing 1-10 of 95/i)
    })

    it('displays page size selector with options 10, 25, 50, 100', () => {
      renderExecutionsPage()
      const pagination = screen.getByTestId('pagination')
      const pageSizeSelector = within(pagination).getByTestId('page-size-selector')
      expect(pageSizeSelector).toBeVisible()
    })

    it('displays page navigation', () => {
      renderExecutionsPage()
      const pagination = screen.getByTestId('pagination')
      const navigation = within(pagination).getByTestId('pagination-navigation')
      expect(navigation).toBeVisible()
    })

    it('disables previous button on first page', () => {
      renderExecutionsPage({ pageInfo: { ...mockPageInfo, currentPage: 1 } })
      const prevButton = screen.getByRole('button', { name: /previous/i })
      expect(prevButton).toBeDisabled()
    })

    it('disables next button on last page', () => {
      renderExecutionsPage({ pageInfo: { ...mockPageInfo, currentPage: 10 } })
      const nextButton = screen.getByRole('button', { name: /next/i })
      expect(nextButton).toBeDisabled()
    })

    it('calls onPageChange when page is changed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderExecutionsPage({ onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /next/i }))

      expect(handlePageChange).toHaveBeenCalledWith(2)
    })

    it('calls onPageChange with previous page when previous button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderExecutionsPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /previous/i }))

      expect(handlePageChange).toHaveBeenCalledWith(4)
    })

    it('displays first and last page buttons per LIST-2', () => {
      renderExecutionsPage()
      const pagination = screen.getByTestId('pagination')
      expect(within(pagination).getByRole('button', { name: /first/i })).toBeInTheDocument()
      expect(within(pagination).getByRole('button', { name: /last/i })).toBeInTheDocument()
    })

    it('disables first button on first page', () => {
      renderExecutionsPage({ pageInfo: { ...mockPageInfo, currentPage: 1 } })
      expect(screen.getByRole('button', { name: /first/i })).toBeDisabled()
    })

    it('disables last button on last page', () => {
      renderExecutionsPage({ pageInfo: { ...mockPageInfo, currentPage: 10 } })
      expect(screen.getByRole('button', { name: /last/i })).toBeDisabled()
    })

    it('calls onPageChange with 1 when first button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderExecutionsPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /first/i }))

      expect(handlePageChange).toHaveBeenCalledWith(1)
    })

    it('calls onPageChange with totalPages when last button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handlePageChange = vi.fn()

      renderExecutionsPage({ pageInfo: { ...mockPageInfo, currentPage: 5 }, onPageChange: handlePageChange })
      await user.click(screen.getByRole('button', { name: /last/i }))

      expect(handlePageChange).toHaveBeenCalledWith(10)
    })

    it('page size selector shows current value', () => {
      renderExecutionsPage({ pageInfo: { ...mockPageInfo, pageSize: 25 } })
      const pagination = screen.getByTestId('pagination')
      const pageSizeSelector = within(pagination).getByTestId('page-size-selector')

      expect(pageSizeSelector).toHaveTextContent('25')
    })
  })

  describe('Pagination - Single Page (LIST-3)', () => {
    it('shows all pagination controls even for single page', () => {
      const singlePageInfo = { currentPage: 1, pageSize: 10, totalItems: 5, totalPages: 1 }
      renderExecutionsPage({ pageInfo: singlePageInfo })

      const pagination = screen.getByTestId('pagination')
      expect(within(pagination).getByTestId('pagination-item-count')).toBeVisible()
      expect(within(pagination).getByTestId('page-size-selector')).toBeVisible()
      expect(within(pagination).getByTestId('pagination-navigation')).toBeVisible()
    })

    it('disables both prev and next on single page', () => {
      const singlePageInfo = { currentPage: 1, pageSize: 10, totalItems: 5, totalPages: 1 }
      renderExecutionsPage({ pageInfo: singlePageInfo })

      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    })
  })

  describe('Loading State (LIST-4)', () => {
    it('displays 9 skeleton rows when loading', () => {
      renderExecutionsPage({ loading: true, executions: [] })
      const skeletonRows = screen.getAllByTestId('skeleton-row')
      expect(skeletonRows).toHaveLength(9)
    })

    it('hides actual table content when loading', () => {
      renderExecutionsPage({ loading: true })
      const executionRows = screen.queryAllByTestId('execution-row')
      expect(executionRows).toHaveLength(0)
    })

    it('sets aria-busy on page when loading', () => {
      renderExecutionsPage({ loading: true })
      expect(screen.getByTestId('executions-page')).toHaveAttribute('aria-busy', 'true')
    })

    it('shows skeleton pagination when loading', () => {
      renderExecutionsPage({ loading: true })
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    })

    it('keeps search enabled during loading to preserve focus', () => {
      renderExecutionsPage({ loading: true })
      const searchInput = screen.getByPlaceholderText(/Search executions/i)
      expect(searchInput).not.toBeDisabled()
    })
  })

  describe('Error State (LIST-5)', () => {
    it('displays error message with empathetic tone', () => {
      renderExecutionsPage({ error: 'Unable to load executions' })
      const errorTitle = screen.getByTestId('error-state-title')
      expect(errorTitle).toBeInTheDocument()
      expect(errorTitle).toHaveTextContent(/Unable to load/i)
    })

    it('displays "Try Again" button', () => {
      renderExecutionsPage({ error: 'Unable to load executions' })
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeVisible()
    })

    it('displays red alert icon', () => {
      renderExecutionsPage({ error: 'Unable to load executions' })
      const alertIcon = screen.getByTestId('error-state-icon')
      expect(alertIcon).toBeVisible()
      expect(alertIcon).toHaveClass('text-error')
    })

    it('calls onRetry when "Try Again" is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRetry = vi.fn()

      renderExecutionsPage({ error: 'Unable to load executions', onRetry: handleRetry })
      await user.click(screen.getByRole('button', { name: /Try Again/i }))

      expect(handleRetry).toHaveBeenCalledTimes(1)
    })

    it('hides table when error occurs', () => {
      renderExecutionsPage({ error: 'Unable to load executions' })
      expect(screen.queryByTestId('executions-table')).not.toBeInTheDocument()
    })
  })

  describe('Empty State (LIST-6)', () => {
    it('displays empty state when no executions', () => {
      renderExecutionsPage({ executions: [] })
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })

    it('displays entity-specific icon (play icon)', () => {
      renderExecutionsPage({ executions: [] })
      expect(screen.getByTestId('empty-state-icon')).toBeVisible()
    })

    it('displays "No executions yet" title', () => {
      renderExecutionsPage({ executions: [] })
      const title = screen.getByTestId('empty-state-title')
      expect(title).toHaveTextContent(/No executions yet/i)
    })

    it('displays encouraging description', () => {
      renderExecutionsPage({ executions: [] })
      const description = screen.getByTestId('empty-state-description')
      expect(description).toBeVisible()
      expect(description).toHaveTextContent(/Run a test, suite, or regression/i)
    })

    it('displays primary CTA "Go to Tests" styled as button', () => {
      renderExecutionsPage({ executions: [] })
      const ctaLink = screen.getByRole('link', { name: /Go to Tests/i })
      expect(ctaLink).toBeVisible()
      expect(ctaLink).toHaveClass('btn-primary')
    })

    it('still shows page header in empty state', () => {
      renderExecutionsPage({ executions: [] })
      expect(screen.getByRole('heading', { name: 'Executions' })).toBeVisible()
    })

    it('does NOT show "+ New" button in empty state', () => {
      renderExecutionsPage({ executions: [] })
      expect(screen.queryByRole('button', { name: /New/i })).not.toBeInTheDocument()
    })

    it('shows filters in empty state', () => {
      renderExecutionsPage({ executions: [] })
      expect(screen.getByTestId('filters-section')).toBeVisible()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('disables filters in empty state (no data)', () => {
      renderExecutionsPage({ executions: [], filters: mockFilters })
      expect(screen.getByTestId('filter-status')).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByTestId('filter-type')).toHaveAttribute('aria-disabled', 'true')
    })

    it('"Go to Tests" CTA navigates to /tests', () => {
      renderExecutionsPage({ executions: [] })
      const link = screen.getByRole('link', { name: /Go to Tests/i })
      expect(link).toBeVisible()
      expect(link).toHaveAttribute('href', '/tests')
    })

    it('displays "No matching executions found" when empty with active filters', () => {
      renderExecutionsPage({
        executions: [],
        filters: { search: 'nonexistent', status: [], type: [], user: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching executions found/i)
    })

    it('displays Clear Filters button when empty with active filters', () => {
      renderExecutionsPage({
        executions: [],
        filters: { search: 'nonexistent', status: [], type: [], user: [] },
      })
      const noResultsState = screen.getByTestId('no-results-state')
      expect(within(noResultsState).getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('calls onFilterChange with cleared filters when Clear Filters is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderExecutionsPage({
        executions: [],
        filters: { search: 'nonexistent', status: ['running'], type: ['test'], user: [] },
        onFilterChange: handleFilterChange,
      })

      const noResultsState = screen.getByTestId('no-results-state')
      const clearFiltersButton = within(noResultsState).getByRole('button', { name: /Clear Filters/i })
      await user.click(clearFiltersButton)

      expect(handleFilterChange).toHaveBeenCalledWith({
        search: '',
        status: [],
        type: [],
        user: [],
        dateRange: { kind: 'all-time' },
      })
    })

    it('shows no results when status filter is active but search is empty', () => {
      renderExecutionsPage({
        executions: [],
        filters: { search: '', status: ['running'], type: [], user: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching executions found/i)
    })

    it('shows no results when type filter is active but search and status are empty', () => {
      renderExecutionsPage({
        executions: [],
        filters: { search: '', status: [], type: ['test'], user: [] },
      })
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(/No matching executions found/i)
    })
  })

  describe('Status Badges', () => {
    it('running status has blue styling', () => {
      renderExecutionsPage()
      const runningBadge = screen.getByTestId('status-badge-running')
      expect(runningBadge).toHaveClass('text-info')
    })

    it('passed status has green styling', () => {
      renderExecutionsPage()
      const passedBadge = screen.getByTestId('status-badge-passed')
      expect(passedBadge).toHaveClass('text-success')
    })

    it('failed status has red styling', () => {
      renderExecutionsPage()
      const failedBadge = screen.getByTestId('status-badge-failed')
      expect(failedBadge).toHaveClass('text-error')
    })

    it('stopped status has muted styling', () => {
      renderExecutionsPage()
      const stoppedBadge = screen.getByTestId('status-badge-stopped')
      expect(stoppedBadge).toHaveClass('text-muted')
    })
  })

  describe('Selection Mode', () => {
    it('renders checkbox column when selection mode is enabled', () => {
      renderExecutionsPage({ enableSelection: true })
      const table = screen.getByTestId('executions-table')
      expect(within(table).getByRole('checkbox', { name: /select all/i })).toBeInTheDocument()
    })

    it('does NOT render checkbox column when selection is disabled', () => {
      renderExecutionsPage({ enableSelection: false })
      const table = screen.getByTestId('executions-table')
      expect(within(table).queryByRole('checkbox', { name: /select all/i })).not.toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('page has main landmark when wrapped in layout', () => {
      renderWithRouter(
        <main>
          <ExecutionsPage
            executions={mockExecutions}
            allUsers={[]}
            pageInfo={mockPageInfo}
            filters={mockFilters}
            sorting={[]}
            onSortingChange={vi.fn()}
            columnVisibility={{}}
            onColumnVisibilityChange={vi.fn()}
            visibleColumns={['name', 'type', 'triggeredBy', 'startedAt', 'duration', 'status']}
            enableSelection={false}
            selectedIds={[]}
            rowSelection={{}}
            onRowSelectionChange={vi.fn()}
            onViewExecution={vi.fn()}
            onRerunExecution={vi.fn()}
            onStopExecution={vi.fn()}
            onDeleteExecution={vi.fn()}
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
      renderExecutionsPage()
      expect(screen.getByRole('heading', { level: 1, name: 'Executions' })).toBeInTheDocument()
    })

    it('table has accessible role', () => {
      renderExecutionsPage()
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('table has aria-label', () => {
      renderExecutionsPage()
      expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Executions')
    })

    it('loading state has aria-busy', () => {
      renderExecutionsPage({ loading: true })
      expect(screen.getByTestId('executions-page')).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      const { container } = renderExecutionsPage({ className: 'custom-executions-page' })
      expect(container.querySelector('.custom-executions-page')).toBeInTheDocument()
    })
  })

  describe('Table Sorting and Row Interaction', () => {
    it('calls onViewExecution when row is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleViewExecution = vi.fn()

      renderExecutionsPage({ onViewExecution: handleViewExecution })
      const firstRow = screen.getAllByTestId('execution-row')[0]

      await user.click(within(firstRow).getByTestId('execution-name'))

      expect(handleViewExecution).toHaveBeenCalledWith('exec-1')
    })

    it('calls onColumnToggle when column visibility is changed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleColumnToggle = vi.fn()

      renderExecutionsPage({ onColumnToggle: handleColumnToggle })

      await user.click(screen.getByRole('button', { name: /Columns/i }))

      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(screen.getByRole('menuitemcheckbox', { name: /Type/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitemcheckbox', { name: /Type/i }))

      expect(handleColumnToggle).toHaveBeenCalledWith('type', false)
    })
  })

  describe('Viewport-Filling Layout (DASH-4, DASH-5, DASH-8)', () => {
    it('page container fills viewport height with h-full overflow-hidden', () => {
      renderExecutionsPage()
      const page = screen.getByTestId('executions-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('pagination is anchored at bottom with flex-shrink-0', () => {
      renderExecutionsPage()
      const pagination = screen.getByTestId('pagination')
      expect(pagination).toHaveClass('flex-shrink-0')
    })

    it('loading state page container has viewport-filling classes', () => {
      renderExecutionsPage({ loading: true })
      const page = screen.getByTestId('executions-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('error state page container has viewport-filling classes', () => {
      renderExecutionsPage({ error: 'Unable to load executions' })
      const page = screen.getByTestId('executions-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('empty state page container has viewport-filling classes', () => {
      renderExecutionsPage({ executions: [] })
      const page = screen.getByTestId('executions-page')
      expect(page).toHaveClass('h-full')
      expect(page).toHaveClass('overflow-hidden')
    })
  })
})
