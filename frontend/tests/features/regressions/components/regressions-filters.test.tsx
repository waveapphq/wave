/**
 * RegressionsFilters Component Tests
 *
 * REQ-5.2.1.37: Regression management screen (list, create, edit, version control)
 *
 * V-LIST-09: Regressions list populated
 *
 * Tests for RegressionsFilters component per design specification:
 * - Search input with debounce
 * - Status filter dropdown (Passed, Failed, Never Run)
 * - Tags multi-select popover
 * - Columns toggle dropdown
 * - NO Mass Action button (regressions are top of hierarchy, per wireframe)
 *
 * Component: frontend/src/components/regressions/regressions-filters.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RegressionsFilters, type RegressionsFiltersProps } from '@/features/regressions/components/regressions-filters'

// ============================================================================
// Mock Data
// ============================================================================

const mockFilters = {
  search: '',
  status: [] as string[],
  tags: [] as string[],
}

const mockAllTags = ['release', 'smoke', 'regression', 'nightly', 'weekly', 'full']

const mockColumns = [
  { id: 'name', label: 'Name', visible: true },
  { id: 'version', label: 'Version', visible: true },
  { id: 'suitesCount', label: 'Suites', visible: true },
  { id: 'testsCount', label: 'Tests', visible: true },
  { id: 'status', label: 'Status', visible: true },
  { id: 'lastRun', label: 'Last Run', visible: true },
  { id: 'tags', label: 'Tags', visible: false },
]

// ============================================================================
// Test Utilities
// ============================================================================

function renderRegressionsFilters(props: Partial<RegressionsFiltersProps> = {}) {
  const defaultProps: RegressionsFiltersProps = {
    filters: mockFilters,
    allTags: mockAllTags,
    columns: mockColumns,
    onFilterChange: vi.fn(),
    onColumnToggle: vi.fn(),
    disabled: false,
    ...props,
  }
  return render(<RegressionsFilters {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('RegressionsFilters', () => {
  describe('Filter Section Container', () => {
    it('renders filters section with correct testid', () => {
      renderRegressionsFilters()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('filters section is visible', () => {
      renderRegressionsFilters()
      expect(screen.getByTestId('filters-section')).toBeVisible()
    })
  })

  describe('Search Input', () => {
    it('renders search input with correct placeholder', () => {
      renderRegressionsFilters()
      expect(screen.getByPlaceholderText(/Search regressions/i)).toBeInTheDocument()
    })

    it('search input is visible', () => {
      renderRegressionsFilters()
      expect(screen.getByPlaceholderText(/Search regressions/i)).toBeVisible()
    })

    it('search input displays current filter value', () => {
      renderRegressionsFilters({ filters: { ...mockFilters, search: 'WAVE' } })
      expect(screen.getByPlaceholderText(/Search regressions/i)).toHaveValue('WAVE')
    })

    it('search input is disabled when disabled prop is true', () => {
      renderRegressionsFilters({ disabled: true })
      expect(screen.getByPlaceholderText(/Search regressions/i)).toBeDisabled()
    })

    it('search input has search icon', () => {
      renderRegressionsFilters()
      expect(document.querySelector('[data-search-icon]')).toBeInTheDocument()
    })

    it('search input has clear button when value exists', () => {
      renderRegressionsFilters({ filters: { ...mockFilters, search: 'test' } })
      expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument()
    })

    it('clicking clear button clears search', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderRegressionsFilters({
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

      renderRegressionsFilters({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search regressions/i)

      // Type quickly - should not trigger immediately
      await user.type(searchInput, 'WAVE')

      // Should not have called yet (debounce pending)
      expect(handleFilterChange).not.toHaveBeenCalled()

      // Wait for debounce (300ms)
      const { waitFor } = await import('@testing-library/react')
      await waitFor(
        () => {
          expect(handleFilterChange).toHaveBeenCalledWith(
            expect.objectContaining({ search: 'WAVE' })
          )
        },
        { timeout: 500 }
      )
    })

    it('search debounce cancels previous pending call on new input', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderRegressionsFilters({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search regressions/i)

      // Type 'WA', then quickly type 'VE'
      await user.type(searchInput, 'WA')
      await user.type(searchInput, 'VE')

      // Wait for debounce to complete
      const { waitFor } = await import('@testing-library/react')
      await waitFor(
        () => {
          expect(handleFilterChange).toHaveBeenCalled()
        },
        { timeout: 500 }
      )

      // Should only have the final value, not intermediate
      const lastCall = handleFilterChange.mock.calls[handleFilterChange.mock.calls.length - 1]
      expect(lastCall[0]).toEqual(expect.objectContaining({ search: 'WAVE' }))
    })
  })

  describe('Status Filter', () => {
    it('renders status filter with correct testid', () => {
      renderRegressionsFilters()
      expect(screen.getByTestId('filter-status')).toBeInTheDocument()
    })

    it('status filter is visible', () => {
      renderRegressionsFilters()
      expect(screen.getByTestId('filter-status')).toBeVisible()
    })

    it('status filter has default placeholder', () => {
      renderRegressionsFilters()
      expect(screen.getByTestId('filter-status')).toHaveTextContent('Status')
    })

    it('status filter displays selected count singular', () => {
      renderRegressionsFilters({ filters: { ...mockFilters, status: ['passed'] } })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('1 status')
    })

    it('status filter displays selected count plural', () => {
      renderRegressionsFilters({ filters: { ...mockFilters, status: ['passed', 'failed'] } })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('2 statuses')
    })

    it('status filter is disabled when disabled prop is true', () => {
      renderRegressionsFilters({ disabled: true })
      expect(screen.getByTestId('filter-status')).toHaveAttribute('aria-disabled', 'true')
    })

    it('opens status popover on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsFilters()
      await user.click(screen.getByTestId('filter-status'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('status popover shows all status options', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsFilters()
      await user.click(screen.getByTestId('filter-status'))

      expect(screen.getByText('Passed')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.getByText('Never Run')).toBeInTheDocument()
    })

    it('status can be selected/deselected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderRegressionsFilters({ onFilterChange: handleFilterChange })
      await user.click(screen.getByTestId('filter-status'))
      await user.click(screen.getByText('Passed'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: ['passed'] })
      )
    })

    it('status can be deselected when already selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderRegressionsFilters({
        filters: { ...mockFilters, status: ['passed'] },
        onFilterChange: handleFilterChange,
      })
      await user.click(screen.getByTestId('filter-status'))
      await user.click(screen.getByText('Passed'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: [] })
      )
    })

    it('searching filters visible statuses', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsFilters()
      await user.click(screen.getByTestId('filter-status'))
      await user.type(screen.getByPlaceholderText(/Search status/i), 'Pass')

      expect(screen.getByText('Passed')).toBeInTheDocument()
      expect(screen.queryByText('Failed')).not.toBeInTheDocument()
    })
  })

  describe('Tags Filter', () => {
    it('renders tags filter with correct testid', () => {
      renderRegressionsFilters()
      expect(screen.getByTestId('filter-tags')).toBeInTheDocument()
    })

    it('tags filter is visible', () => {
      renderRegressionsFilters()
      expect(screen.getByTestId('filter-tags')).toBeVisible()
    })

    it('tags filter has default placeholder', () => {
      renderRegressionsFilters()
      expect(screen.getByText(/Tags/i)).toBeInTheDocument()
    })

    it('tags filter shows count when tags are selected', () => {
      renderRegressionsFilters({ filters: { ...mockFilters, tags: ['release', 'smoke'] } })
      expect(screen.getByText(/2 tags/i)).toBeInTheDocument()
    })

    it('opens tags popover on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsFilters()
      await user.click(screen.getByTestId('filter-tags'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('tags popover shows available tags', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsFilters()
      await user.click(screen.getByTestId('filter-tags'))

      mockAllTags.forEach((tag) => {
        expect(screen.getByText(tag)).toBeInTheDocument()
      })
    })

    it('tags can be selected/deselected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderRegressionsFilters({ onFilterChange: handleFilterChange })
      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('release'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['release'] })
      )
    })

    it('tag can be deselected when already selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderRegressionsFilters({
        filters: { ...mockFilters, tags: ['release'] },
        onFilterChange: handleFilterChange,
      })
      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('release'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ tags: [] })
      )
    })

    it('tags filter has search within popover', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsFilters()
      await user.click(screen.getByTestId('filter-tags'))

      expect(screen.getByPlaceholderText(/Search tags/i)).toBeInTheDocument()
    })

    it('searching filters visible tags', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsFilters()
      await user.click(screen.getByTestId('filter-tags'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'release')

      expect(screen.getByText('release')).toBeInTheDocument()
      expect(screen.queryByText('nightly')).not.toBeInTheDocument()
    })

    it('tags filter is disabled when disabled prop is true', () => {
      renderRegressionsFilters({ disabled: true })
      expect(screen.getByTestId('filter-tags')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Columns Toggle', () => {
    it('renders Columns button', () => {
      renderRegressionsFilters()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeInTheDocument()
    })

    it('Columns button is visible', () => {
      renderRegressionsFilters()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('clicking Columns button opens dropdown', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('columns dropdown shows column options', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      mockColumns.forEach((col) => {
        expect(screen.getByRole('menuitemcheckbox', { name: col.label })).toBeInTheDocument()
      })
    })

    it('visible columns are checked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRegressionsFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      const nameCheckbox = screen.getByRole('menuitemcheckbox', { name: 'Name' })
      expect(nameCheckbox).toHaveAttribute('aria-checked', 'true')

      const tagsCheckbox = screen.getByRole('menuitemcheckbox', { name: 'Tags' })
      expect(tagsCheckbox).toHaveAttribute('aria-checked', 'false')
    })

    it('calls onColumnToggle when column visibility is changed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleColumnToggle = vi.fn()

      renderRegressionsFilters({ onColumnToggle: handleColumnToggle })
      await user.click(screen.getByRole('button', { name: /Columns/i }))
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Tags' }))

      expect(handleColumnToggle).toHaveBeenCalledWith('tags', true)
    })

    it('Columns button is disabled when disabled prop is true', () => {
      renderRegressionsFilters({ disabled: true })
      expect(screen.getByRole('button', { name: /Columns/i })).toBeDisabled()
    })
  })

  describe('Mass Action Button - NOT Present (Regressions are top of hierarchy)', () => {
    it('does NOT render Mass Action button', () => {
      renderRegressionsFilters()
      expect(screen.queryByRole('button', { name: /Mass Action/i })).not.toBeInTheDocument()
    })

    it('does NOT render Mass Action button even with regressions data', () => {
      // Regressions page never has Mass Action per wireframe
      renderRegressionsFilters()
      expect(screen.queryByTestId('mass-action-button')).not.toBeInTheDocument()
    })
  })

  describe('Filter Reset', () => {
    it('shows Clear Filters button when any filter is active', () => {
      renderRegressionsFilters({ filters: { ...mockFilters, status: ['passed'] } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('does not show Clear Filters button when no filters active', () => {
      renderRegressionsFilters()
      expect(screen.queryByRole('button', { name: /Clear Filters/i })).not.toBeInTheDocument()
    })

    it('shows Clear Filters when search is active', () => {
      renderRegressionsFilters({ filters: { ...mockFilters, search: 'test' } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('shows Clear Filters when tags are selected', () => {
      renderRegressionsFilters({ filters: { ...mockFilters, tags: ['release'] } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('clicking Clear Filters resets all filters', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderRegressionsFilters({
        filters: { search: 'test', status: ['passed'], tags: ['release'] },
        onFilterChange: handleFilterChange,
      })

      await user.click(screen.getByRole('button', { name: /Clear Filters/i }))

      expect(handleFilterChange).toHaveBeenCalledWith({
        search: '',
        status: [],
        tags: [],
      })
    })
  })

  describe('Accessibility', () => {
    it('search input has accessible label', () => {
      renderRegressionsFilters()
      expect(screen.getByLabelText(/Search regressions/i)).toBeInTheDocument()
    })

    it('status filter has accessible label', () => {
      renderRegressionsFilters()
      const statusFilter = screen.getByTestId('filter-status')
      expect(statusFilter).toHaveAttribute('aria-label')
    })

    it('tags filter has accessible label', () => {
      renderRegressionsFilters()
      const tagsFilter = screen.getByTestId('filter-tags')
      expect(tagsFilter).toHaveAttribute('aria-label')
    })

    it('disabled state is communicated via aria-disabled', () => {
      renderRegressionsFilters({ disabled: true })

      expect(screen.getByTestId('filter-status')).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByTestId('filter-tags')).toHaveAttribute('aria-disabled', 'true')
    })
  })
})
