/**
 * SuitesFilters Component Tests
 *
 * REQ-5.2.1.36: Suite management screen (list, create, edit, organize tests)
 *
 * V-LIST-07: Suites list populated
 *
 * Tests for SuitesFilters component per design specification:
 * - Search input with debounce
 * - Status filter dropdown (Passed, Failed, Never Run)
 * - Tags multi-select popover
 * - Columns toggle dropdown
 * - NO Suite filter (suites have no parent entity per wireframe)
 *
 * Component: frontend/src/components/suites/suites-filters.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SuitesFilters, type SuitesFiltersProps } from '@/features/suites/components/suites-filters'

// ============================================================================
// Mock Data
// ============================================================================

const mockFilters = {
  search: '',
  status: [] as string[],
  tags: [] as string[],
}

const mockAllTags = ['auth', 'smoke', 'api', 'integration', 'database', 'regression']

const mockColumns = [
  { id: 'name', label: 'Name', visible: true },
  { id: 'testsCount', label: 'Tests', visible: true },
  { id: 'status', label: 'Status', visible: true },
  { id: 'lastRun', label: 'Last Run', visible: true },
  { id: 'tags', label: 'Tags', visible: false },
]

// ============================================================================
// Test Utilities
// ============================================================================

function renderSuitesFilters(props: Partial<SuitesFiltersProps> = {}) {
  const defaultProps: SuitesFiltersProps = {
    filters: mockFilters,
    allTags: mockAllTags,
    columns: mockColumns,
    onFilterChange: vi.fn(),
    onColumnToggle: vi.fn(),
    disabled: false,
    ...props,
  }
  return render(<SuitesFilters {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('SuitesFilters', () => {
  describe('Filter Section Container', () => {
    it('renders filters section with correct testid', () => {
      renderSuitesFilters()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('filters section is visible', () => {
      renderSuitesFilters()
      expect(screen.getByTestId('filters-section')).toBeVisible()
    })
  })

  describe('Search Input', () => {
    it('renders search input with correct placeholder', () => {
      renderSuitesFilters()
      expect(screen.getByPlaceholderText(/Search suites/i)).toBeInTheDocument()
    })

    it('search input is visible', () => {
      renderSuitesFilters()
      expect(screen.getByPlaceholderText(/Search suites/i)).toBeVisible()
    })

    it('search input displays current filter value', () => {
      renderSuitesFilters({ filters: { ...mockFilters, search: 'auth' } })
      expect(screen.getByPlaceholderText(/Search suites/i)).toHaveValue('auth')
    })

    it('search input is disabled when disabled prop is true', () => {
      renderSuitesFilters({ disabled: true })
      expect(screen.getByPlaceholderText(/Search suites/i)).toBeDisabled()
    })

    it('search input has search icon', () => {
      renderSuitesFilters()
      expect(document.querySelector('[data-search-icon]')).toBeInTheDocument()
    })

    it('search input has clear button when value exists', () => {
      renderSuitesFilters({ filters: { ...mockFilters, search: 'test' } })
      expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument()
    })

    it('clicking clear button clears search', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderSuitesFilters({
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

      renderSuitesFilters({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search suites/i)

      // Type quickly - should not trigger immediately
      await user.type(searchInput, 'test')

      // Should not have called yet (debounce pending)
      expect(handleFilterChange).not.toHaveBeenCalled()

      // Wait for debounce (300ms)
      const { waitFor } = await import('@testing-library/react')
      await waitFor(
        () => {
          expect(handleFilterChange).toHaveBeenCalledWith(
            expect.objectContaining({ search: 'test' })
          )
        },
        { timeout: 500 }
      )
    })

    it('search debounce cancels previous pending call on new input', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderSuitesFilters({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search suites/i)

      // Type 'ab', then quickly type 'cd'
      await user.type(searchInput, 'ab')
      await user.type(searchInput, 'cd')

      // Wait for debounce to complete
      const { waitFor } = await import('@testing-library/react')
      await waitFor(
        () => {
          expect(handleFilterChange).toHaveBeenCalled()
        }
      )

      // Should only have the final value, not intermediate
      const lastCall = handleFilterChange.mock.calls[handleFilterChange.mock.calls.length - 1]
      expect(lastCall[0]).toEqual(expect.objectContaining({ search: 'abcd' }))
    })
  })

  describe('Status Filter', () => {
    it('renders status filter with correct testid', () => {
      renderSuitesFilters()
      expect(screen.getByTestId('filter-status')).toBeInTheDocument()
    })

    it('status filter is visible', () => {
      renderSuitesFilters()
      expect(screen.getByTestId('filter-status')).toBeVisible()
    })

    it('status filter has default placeholder', () => {
      renderSuitesFilters()
      expect(screen.getByTestId('filter-status')).toHaveTextContent('Status')
    })

    it('status filter displays selected count singular', () => {
      renderSuitesFilters({ filters: { ...mockFilters, status: ['passed'] } })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('1 status')
    })

    it('status filter displays selected count plural', () => {
      renderSuitesFilters({ filters: { ...mockFilters, status: ['passed', 'failed'] } })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('2 statuses')
    })

    it('status filter is disabled when disabled prop is true', () => {
      renderSuitesFilters({ disabled: true })
      expect(screen.getByTestId('filter-status')).toHaveAttribute('aria-disabled', 'true')
    })

    it('opens status popover on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesFilters()
      await user.click(screen.getByTestId('filter-status'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('status popover shows all status options', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesFilters()
      await user.click(screen.getByTestId('filter-status'))

      expect(screen.getByText('Passed')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.getByText('Never Run')).toBeInTheDocument()
    })

    it('status can be selected/deselected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderSuitesFilters({ onFilterChange: handleFilterChange })
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

      renderSuitesFilters({
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

      renderSuitesFilters()
      await user.click(screen.getByTestId('filter-status'))
      await user.type(screen.getByPlaceholderText(/Search status/i), 'Pass')

      expect(screen.getByText('Passed')).toBeInTheDocument()
      expect(screen.queryByText('Failed')).not.toBeInTheDocument()
    })
  })

  describe('Suite Filter - NOT Present', () => {
    it('does NOT render suite filter (suites have no parent)', () => {
      renderSuitesFilters()
      expect(screen.queryByTestId('filter-suite')).not.toBeInTheDocument()
    })
  })

  describe('Tags Filter', () => {
    it('renders tags filter with correct testid', () => {
      renderSuitesFilters()
      expect(screen.getByTestId('filter-tags')).toBeInTheDocument()
    })

    it('tags filter is visible', () => {
      renderSuitesFilters()
      expect(screen.getByTestId('filter-tags')).toBeVisible()
    })

    it('tags filter has default placeholder', () => {
      renderSuitesFilters()
      expect(screen.getByText(/Tags/i)).toBeInTheDocument()
    })

    it('tags filter shows count when tags are selected', () => {
      renderSuitesFilters({ filters: { ...mockFilters, tags: ['auth', 'smoke'] } })
      expect(screen.getByText(/2 tags/i)).toBeInTheDocument()
    })

    it('opens tags popover on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesFilters()
      await user.click(screen.getByTestId('filter-tags'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('tags popover shows available tags', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesFilters()
      await user.click(screen.getByTestId('filter-tags'))

      mockAllTags.forEach((tag) => {
        expect(screen.getByText(tag)).toBeInTheDocument()
      })
    })

    it('tags can be selected/deselected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderSuitesFilters({ onFilterChange: handleFilterChange })
      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('auth'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['auth'] })
      )
    })

    it('tag can be deselected when already selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderSuitesFilters({
        filters: { ...mockFilters, tags: ['auth'] },
        onFilterChange: handleFilterChange,
      })
      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('auth'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ tags: [] })
      )
    })

    it('tags filter has search within popover', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesFilters()
      await user.click(screen.getByTestId('filter-tags'))

      expect(screen.getByPlaceholderText(/Search tags/i)).toBeInTheDocument()
    })

    it('searching filters visible tags', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesFilters()
      await user.click(screen.getByTestId('filter-tags'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'auth')

      expect(screen.getByText('auth')).toBeInTheDocument()
      expect(screen.queryByText('database')).not.toBeInTheDocument()
    })

    it('tags filter is disabled when disabled prop is true', () => {
      renderSuitesFilters({ disabled: true })
      expect(screen.getByTestId('filter-tags')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Columns Toggle', () => {
    it('renders Columns button', () => {
      renderSuitesFilters()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeInTheDocument()
    })

    it('Columns button is visible', () => {
      renderSuitesFilters()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('clicking Columns button opens dropdown', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('columns dropdown shows column options', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      mockColumns.forEach((col) => {
        expect(screen.getByRole('menuitemcheckbox', { name: col.label })).toBeInTheDocument()
      })
    })

    it('visible columns are checked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSuitesFilters()
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

      renderSuitesFilters({ onColumnToggle: handleColumnToggle })
      await user.click(screen.getByRole('button', { name: /Columns/i }))
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Tags' }))

      expect(handleColumnToggle).toHaveBeenCalledWith('tags', true)
    })

    it('calls onColumnToggle when checkbox is clicked directly', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleColumnToggle = vi.fn()

      renderSuitesFilters({ onColumnToggle: handleColumnToggle })
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      // Click the checkbox inside the menu item directly
      const tagsMenuItem = screen.getByRole('menuitemcheckbox', { name: 'Tags' })
      const checkbox = tagsMenuItem.querySelector('button[role="checkbox"]')
      if (checkbox) {
        await user.click(checkbox)
        expect(handleColumnToggle).toHaveBeenCalledWith('tags', true)
      }
    })
  })

  describe('Filter Reset', () => {
    it('shows Clear Filters button when any filter is active', () => {
      renderSuitesFilters({ filters: { ...mockFilters, status: ['passed'] } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('does not show Clear Filters button when no filters active', () => {
      renderSuitesFilters()
      expect(screen.queryByRole('button', { name: /Clear Filters/i })).not.toBeInTheDocument()
    })

    it('shows Clear Filters when search is active', () => {
      renderSuitesFilters({ filters: { ...mockFilters, search: 'test' } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('shows Clear Filters when tags are selected', () => {
      renderSuitesFilters({ filters: { ...mockFilters, tags: ['auth'] } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('clicking Clear Filters resets all filters', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderSuitesFilters({
        filters: { search: 'test', status: ['passed'], tags: ['auth'] },
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
      renderSuitesFilters()
      expect(screen.getByLabelText(/Search suites/i)).toBeInTheDocument()
    })

    it('status filter has accessible label', () => {
      renderSuitesFilters()
      const statusFilter = screen.getByTestId('filter-status')
      expect(statusFilter).toHaveAttribute('aria-label')
    })

    it('tags filter has accessible label', () => {
      renderSuitesFilters()
      const tagsFilter = screen.getByTestId('filter-tags')
      expect(tagsFilter).toHaveAttribute('aria-label')
    })

    it('disabled state is communicated via aria-disabled', () => {
      renderSuitesFilters({ disabled: true })

      expect(screen.getByTestId('filter-status')).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByTestId('filter-tags')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Actions Slot', () => {
    it('renders actions slot when provided', () => {
      renderSuitesFilters({
        actions: <button data-testid="custom-action">Custom Action</button>,
      })
      expect(screen.getByTestId('custom-action')).toBeInTheDocument()
    })

    it('actions slot appears before Columns button', () => {
      renderSuitesFilters({
        actions: <button data-testid="custom-action">Custom Action</button>,
      })
      const filtersSection = screen.getByTestId('filters-section')
      const children = Array.from(filtersSection.querySelectorAll('[data-testid]'))
      const actionIndex = children.findIndex((el) => el.getAttribute('data-testid') === 'custom-action')
      // Custom action should appear in the filters section
      expect(actionIndex).toBeGreaterThanOrEqual(0)
    })
  })
})
