/**
 * ExecutionsFilters Component Tests
 *
 * REQ-5.2.1.40: Execution history screen (list executions, filter by status/date, compare runs, re-run)
 *
 * V-LIST-11: Executions list populated
 *
 * Tests for ExecutionsFilters component per design specification:
 * - Search input with debounce
 * - Status filter dropdown (Running, Passed, Failed, Stopped)
 * - Type filter dropdown (Test, Suite, Regression)
 * - Columns toggle dropdown
 * - NO Mass Action button (executions are read-only, per LIST-8)
 *
 * Component: frontend/src/components/executions/executions-filters.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExecutionsFilters, type ExecutionsFiltersProps } from '@/features/executions/components/executions-filters'

// ============================================================================
// Mock Data
// ============================================================================

const mockFilters = {
  search: '',
  status: [] as string[],
  type: [] as string[],
  user: [] as string[],
}

const mockColumns = [
  { id: 'name', label: 'Name', visible: true },
  { id: 'type', label: 'Type', visible: true },
  { id: 'triggeredBy', label: 'Triggered By', visible: true },
  { id: 'startedAt', label: 'Started', visible: true },
  { id: 'duration', label: 'Duration', visible: true },
  { id: 'status', label: 'Status', visible: true },
]

// ============================================================================
// Test Utilities
// ============================================================================

function renderExecutionsFilters(props: Partial<ExecutionsFiltersProps> = {}) {
  const defaultProps: ExecutionsFiltersProps = {
    filters: mockFilters,
    allUsers: [] as string[],
    columns: mockColumns,
    onFilterChange: vi.fn(),
    onColumnToggle: vi.fn(),
    disabled: false,
  }
  return render(<ExecutionsFilters {...defaultProps} {...props} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('ExecutionsFilters', () => {
  describe('Filter Section Container', () => {
    it('renders filters section with correct testid', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('filters section is visible', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('filters-section')).toBeVisible()
    })
  })

  describe('Search Input', () => {
    it('renders search input with correct placeholder', () => {
      renderExecutionsFilters()
      expect(screen.getByPlaceholderText(/Search executions/i)).toBeInTheDocument()
    })

    it('search input is visible', () => {
      renderExecutionsFilters()
      expect(screen.getByPlaceholderText(/Search executions/i)).toBeVisible()
    })

    it('search input displays current filter value', () => {
      renderExecutionsFilters({ filters: { ...mockFilters, search: 'Login' } })
      expect(screen.getByPlaceholderText(/Search executions/i)).toHaveValue('Login')
    })

    it('search input is disabled when disabled prop is true', () => {
      renderExecutionsFilters({ disabled: true })
      expect(screen.getByPlaceholderText(/Search executions/i)).toBeDisabled()
    })

    it('search input has search icon', () => {
      renderExecutionsFilters()
      expect(document.querySelector('[data-search-icon]')).toBeInTheDocument()
    })

    it('search input has clear button when value exists', () => {
      renderExecutionsFilters({ filters: { ...mockFilters, search: 'test' } })
      expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument()
    })

    it('clicking clear button clears search', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderExecutionsFilters({
        filters: { ...mockFilters, search: 'test' },
        onFilterChange: handleFilterChange,
      })

      await user.click(screen.getByRole('button', { name: /clear search/i }))
      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: '' })
      )
    })

    it('search input debounces input by 300ms', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderExecutionsFilters({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search executions/i)

      await user.type(searchInput, 'Login')

      expect(handleFilterChange).not.toHaveBeenCalled()

      const { waitFor } = await import('@testing-library/react')
      await waitFor(
        () => {
          expect(handleFilterChange).toHaveBeenCalledWith(
            expect.objectContaining({ search: 'Login' })
          )
        },
        { timeout: 500 }
      )
    })

    it('search debounce cancels previous pending call on new input', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderExecutionsFilters({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search executions/i)

      await user.type(searchInput, 'Lo')
      await user.type(searchInput, 'gin')

      const { waitFor } = await import('@testing-library/react')
      await waitFor(
        () => {
          expect(handleFilterChange).toHaveBeenCalled()
        },
        { timeout: 500 }
      )

      const lastCall = handleFilterChange.mock.calls[handleFilterChange.mock.calls.length - 1]
      expect(lastCall[0]).toEqual(expect.objectContaining({ search: 'Login' }))
    })
  })

  describe('Status Filter', () => {
    it('renders status filter with correct testid', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('filter-status')).toBeInTheDocument()
    })

    it('status filter is visible', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('filter-status')).toBeVisible()
    })

    it('status filter has default placeholder', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('filter-status')).toHaveTextContent('Status')
    })

    it('status filter displays selected count singular', () => {
      renderExecutionsFilters({ filters: { ...mockFilters, status: ['running'] } })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('1 status')
    })

    it('status filter displays selected count plural', () => {
      renderExecutionsFilters({ filters: { ...mockFilters, status: ['running', 'passed'] } })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('2 statuses')
    })

    it('status filter is disabled when disabled prop is true', () => {
      renderExecutionsFilters({ disabled: true })
      expect(screen.getByTestId('filter-status')).toHaveAttribute('aria-disabled', 'true')
    })

    it('opens status popover on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters()
      await user.click(screen.getByTestId('filter-status'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('status popover shows execution status options (not Never Run)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters()
      await user.click(screen.getByTestId('filter-status'))

      expect(screen.getByText('Running')).toBeInTheDocument()
      expect(screen.getByText('Passed')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.getByText('Stopped')).toBeInTheDocument()
      expect(screen.queryByText('Never Run')).not.toBeInTheDocument()
    })

    it('status can be selected/deselected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderExecutionsFilters({ onFilterChange: handleFilterChange })
      await user.click(screen.getByTestId('filter-status'))
      await user.click(screen.getByText('Running'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: ['running'] })
      )
    })

    it('status can be deselected when already selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderExecutionsFilters({
        filters: { ...mockFilters, status: ['running'] },
        onFilterChange: handleFilterChange,
      })
      await user.click(screen.getByTestId('filter-status'))
      await user.click(screen.getByText('Running'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: [] })
      )
    })

    it('searching filters visible statuses', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters()
      await user.click(screen.getByTestId('filter-status'))
      await user.type(screen.getByPlaceholderText(/Search status/i), 'Run')

      expect(screen.getByText('Running')).toBeInTheDocument()
      expect(screen.queryByText('Passed')).not.toBeInTheDocument()
    })
  })

  describe('Type Filter (Execution-Specific)', () => {
    it('renders type filter with correct testid', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('filter-type')).toBeInTheDocument()
    })

    it('type filter is visible', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('filter-type')).toBeVisible()
    })

    it('type filter has default placeholder', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('filter-type')).toHaveTextContent('Type')
    })

    it('type filter displays selected count singular', () => {
      renderExecutionsFilters({ filters: { ...mockFilters, type: ['test'] } })
      expect(screen.getByTestId('filter-type')).toHaveTextContent('1 type')
    })

    it('type filter displays selected count plural', () => {
      renderExecutionsFilters({ filters: { ...mockFilters, type: ['test', 'suite'] } })
      expect(screen.getByTestId('filter-type')).toHaveTextContent('2 types')
    })

    it('type filter is disabled when disabled prop is true', () => {
      renderExecutionsFilters({ disabled: true })
      expect(screen.getByTestId('filter-type')).toHaveAttribute('aria-disabled', 'true')
    })

    it('opens type popover on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters()
      await user.click(screen.getByTestId('filter-type'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('type popover shows entity type options', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters()
      await user.click(screen.getByTestId('filter-type'))

      expect(screen.getByText('Test')).toBeInTheDocument()
      expect(screen.getByText('Suite')).toBeInTheDocument()
      expect(screen.getByText('Regression')).toBeInTheDocument()
    })

    it('type can be selected/deselected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderExecutionsFilters({ onFilterChange: handleFilterChange })
      await user.click(screen.getByTestId('filter-type'))
      await user.click(screen.getByText('Suite'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: ['suite'] })
      )
    })

    it('type can be deselected when already selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderExecutionsFilters({
        filters: { ...mockFilters, type: ['suite'] },
        onFilterChange: handleFilterChange,
      })
      await user.click(screen.getByTestId('filter-type'))
      await user.click(screen.getByText('Suite'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: [] })
      )
    })

    it('searching filters visible types', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters()
      await user.click(screen.getByTestId('filter-type'))
      await user.type(screen.getByPlaceholderText(/Search type/i), 'Reg')

      expect(screen.getByText('Regression')).toBeInTheDocument()
      expect(screen.queryByText('Test')).not.toBeInTheDocument()
    })
  })

  describe('Columns Toggle', () => {
    it('renders Columns button', () => {
      renderExecutionsFilters()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeInTheDocument()
    })

    it('Columns button is visible', () => {
      renderExecutionsFilters()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('renders Columns button with correct testid', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('columns-button')).toBeInTheDocument()
    })

    it('clicking Columns button opens dropdown', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('columns dropdown shows column options', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      mockColumns.forEach((col) => {
        expect(screen.getByRole('menuitemcheckbox', { name: col.label })).toBeInTheDocument()
      })
    })

    it('visible columns are checked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      const nameCheckbox = screen.getByRole('menuitemcheckbox', { name: 'Name' })
      expect(nameCheckbox).toHaveAttribute('aria-checked', 'true')
    })

    it('calls onColumnToggle when column visibility is changed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleColumnToggle = vi.fn()

      renderExecutionsFilters({ onColumnToggle: handleColumnToggle })
      await user.click(screen.getByRole('button', { name: /Columns/i }))
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Type' }))

      expect(handleColumnToggle).toHaveBeenCalledWith('type', false)
    })

    it('Columns button is disabled when disabled prop is true', () => {
      renderExecutionsFilters({ disabled: true })
      expect(screen.getByRole('button', { name: /Columns/i })).toBeDisabled()
    })
  })

  describe('Mass Action Button - NOT Present (Executions are read-only)', () => {
    it('does NOT render Mass Action button', () => {
      renderExecutionsFilters()
      expect(screen.queryByRole('button', { name: /Mass Action/i })).not.toBeInTheDocument()
    })

    it('does NOT render Mass Action button even when executions exist', () => {
      renderExecutionsFilters()
      expect(screen.queryByTestId('mass-action-button')).not.toBeInTheDocument()
    })
  })

  describe('Filter Reset', () => {
    it('shows Clear Filters button when any filter is active', () => {
      renderExecutionsFilters({ filters: { ...mockFilters, status: ['running'] } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('does not show Clear Filters button when no filters active', () => {
      renderExecutionsFilters()
      expect(screen.queryByRole('button', { name: /Clear Filters/i })).not.toBeInTheDocument()
    })

    it('shows Clear Filters when search is active', () => {
      renderExecutionsFilters({ filters: { ...mockFilters, search: 'test' } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('shows Clear Filters when type filter is active', () => {
      renderExecutionsFilters({ filters: { ...mockFilters, type: ['test'] } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('clicking Clear Filters resets all filters', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderExecutionsFilters({
        filters: { search: 'test', status: ['running'], type: ['suite'], user: [] },
        onFilterChange: handleFilterChange,
      })

      await user.click(screen.getByRole('button', { name: /Clear Filters/i }))

      expect(handleFilterChange).toHaveBeenCalledWith({
        search: '',
        status: [],
        type: [],
        user: [],
        dateRange: { kind: 'all-time' },
      })
    })
  })

  describe('Accessibility', () => {
    it('search input has accessible label', () => {
      renderExecutionsFilters()
      expect(screen.getByLabelText(/Search executions/i)).toBeInTheDocument()
    })

    it('status filter has accessible label', () => {
      renderExecutionsFilters()
      const statusFilter = screen.getByTestId('filter-status')
      expect(statusFilter).toHaveAttribute('aria-label')
    })

    it('type filter has accessible label', () => {
      renderExecutionsFilters()
      const typeFilter = screen.getByTestId('filter-type')
      expect(typeFilter).toHaveAttribute('aria-label')
    })

    it('disabled state is communicated via aria-disabled', () => {
      renderExecutionsFilters({ disabled: true })

      expect(screen.getByTestId('filter-status')).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByTestId('filter-type')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Date Range Filter', () => {
    it('renders the date range filter pill in the filter row', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('filter-date')).toBeInTheDocument()
    })

    it('date filter is visible', () => {
      renderExecutionsFilters()
      expect(screen.getByTestId('filter-date')).toBeVisible()
    })

    it('date filter is disabled when the disabled prop is true', () => {
      renderExecutionsFilters({ disabled: true })
      expect(screen.getByTestId('filter-date')).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    })

    it('emits dateRange in the filters object when a preset is picked', async () => {
      const handleFilterChange = vi.fn()
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters({ onFilterChange: handleFilterChange })

      await user.click(screen.getByTestId('filter-date'))
      await user.click(screen.getByRole('radio', { name: /Last 7 days/i }))

      const lastCall =
        handleFilterChange.mock.calls[handleFilterChange.mock.calls.length - 1]
      expect(lastCall[0]).toEqual(
        expect.objectContaining({
          dateRange: { kind: 'preset', preset: 'last-7' },
        }),
      )
    })

    it('emits dateRange as { kind: "all-time" } when the reset preset is picked', async () => {
      const handleFilterChange = vi.fn()
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderExecutionsFilters({
        filters: {
          ...mockFilters,
          dateRange: { kind: 'preset', preset: 'last-7' },
        } as ExecutionsFiltersProps['filters'],
        onFilterChange: handleFilterChange,
      })

      await user.click(screen.getByTestId('filter-date'))
      await user.click(screen.getByRole('radio', { name: /All time/i }))

      const lastCall =
        handleFilterChange.mock.calls[handleFilterChange.mock.calls.length - 1]
      expect(lastCall[0]).toEqual(
        expect.objectContaining({
          dateRange: { kind: 'all-time' },
        }),
      )
    })
  })
})
