/**
 * TestsFilters Component Tests
 *
 * REQ-5.2.1.35: Test management screen (list, create, edit, delete, duplicate)
 *
 * V-LIST-01: Tests list populated
 *
 * Tests for TestsFilters component per design specification:
 * - Search input with debounce
 * - Status filter dropdown (Passed, Failed, Never Run)
 * - Suite filter dropdown
 * - Tags multi-select popover
 * - Columns toggle dropdown
 *
 * Component: frontend/src/components/tests/tests-filters.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestsFilters, type TestsFiltersProps } from '@/features/tests/components/tests-filters'

// ============================================================================
// Mock Data
// ============================================================================

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

const mockColumns = [
  { id: 'name', label: 'Name', visible: true },
  { id: 'suite', label: 'Suite', visible: true },
  { id: 'status', label: 'Status', visible: true },
  { id: 'lastRun', label: 'Last Run', visible: true },
  { id: 'tags', label: 'Tags', visible: false },
]

// ============================================================================
// Test Utilities
// ============================================================================

function renderTestsFilters(props: Partial<TestsFiltersProps> = {}) {
  const defaultProps: TestsFiltersProps = {
    filters: mockFilters,
    suites: mockSuites,
    allTags: mockAllTags,
    columns: mockColumns,
    onFilterChange: vi.fn(),
    onColumnToggle: vi.fn(),
    disabled: false,
    ...props,
  }
  return render(<TestsFilters {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('TestsFilters', () => {
  // Note: Fake timers only used in debounce tests to avoid interfering with UI interactions

  describe('Filter Section Container', () => {
    it('renders filters section with correct testid', () => {
      renderTestsFilters()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('filters section is visible', () => {
      renderTestsFilters()
      expect(screen.getByTestId('filters-section')).toBeVisible()
    })
  })

  describe('Search Input', () => {
    it('renders search input with correct placeholder', () => {
      renderTestsFilters()
      expect(screen.getByPlaceholderText(/Search tests/i)).toBeInTheDocument()
    })

    it('search input is visible', () => {
      renderTestsFilters()
      expect(screen.getByPlaceholderText(/Search tests/i)).toBeVisible()
    })

    it('search input displays current filter value', () => {
      renderTestsFilters({ filters: { ...mockFilters, search: 'login' } })
      expect(screen.getByPlaceholderText(/Search tests/i)).toHaveValue('login')
    })

    it('search input is disabled when disabled prop is true', () => {
      renderTestsFilters({ disabled: true })
      expect(screen.getByPlaceholderText(/Search tests/i)).toBeDisabled()
    })

    it('search input has search icon', () => {
      renderTestsFilters()
      // SearchInput component uses data-search-icon attribute
      expect(document.querySelector('[data-search-icon]')).toBeInTheDocument()
    })

    it('search input has clear button when value exists', () => {
      renderTestsFilters({ filters: { ...mockFilters, search: 'test' } })
      expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument()
    })

    it('clicking clear button clears search', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderTestsFilters({
        filters: { ...mockFilters, search: 'test' },
        onFilterChange: handleFilterChange,
      })

      await user.click(screen.getByRole('button', { name: /clear search/i }))
      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: '' })
      )
    })
  })

  describe('Status Filter', () => {
    it('renders status filter with correct testid', () => {
      renderTestsFilters()
      expect(screen.getByTestId('filter-status')).toBeInTheDocument()
    })

    it('status filter is visible', () => {
      renderTestsFilters()
      expect(screen.getByTestId('filter-status')).toBeVisible()
    })

    it('status filter has default placeholder', () => {
      renderTestsFilters()
      // Multi-select shows "Status" when empty
      expect(screen.getByTestId('filter-status')).toHaveTextContent('Status')
    })

    it('status filter displays selected count', () => {
      renderTestsFilters({ filters: { ...mockFilters, status: ['passed'] } })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('1 status')
    })

    it('status filter is disabled when disabled prop is true', () => {
      renderTestsFilters({ disabled: true })
      expect(screen.getByTestId('filter-status')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Suite Filter', () => {
    it('renders suite filter with correct testid', () => {
      renderTestsFilters()
      expect(screen.getByTestId('filter-suite')).toBeInTheDocument()
    })

    it('suite filter is visible', () => {
      renderTestsFilters()
      expect(screen.getByTestId('filter-suite')).toBeVisible()
    })

    it('suite filter has default placeholder', () => {
      renderTestsFilters()
      // Multi-select shows "Suite" when empty
      expect(screen.getByTestId('filter-suite')).toHaveTextContent('Suite')
    })

    it('suite filter displays selected count', () => {
      renderTestsFilters({ filters: { ...mockFilters, suiteIds: ['suite-auth'] } })
      expect(screen.getByTestId('filter-suite')).toHaveTextContent('1 suite')
    })

    it('suite filter is disabled when disabled prop is true', () => {
      renderTestsFilters({ disabled: true })
      expect(screen.getByTestId('filter-suite')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Tags Filter', () => {
    it('renders tags filter with correct testid', () => {
      renderTestsFilters()
      expect(screen.getByTestId('filter-tags')).toBeInTheDocument()
    })

    it('tags filter is visible', () => {
      renderTestsFilters()
      expect(screen.getByTestId('filter-tags')).toBeVisible()
    })

    it('tags filter has default placeholder', () => {
      renderTestsFilters()
      expect(screen.getByText(/Tags/i)).toBeInTheDocument()
    })

    it('tags filter shows count when tags are selected', () => {
      renderTestsFilters({ filters: { ...mockFilters, tags: ['auth', 'smoke'] } })
      expect(screen.getByText(/2 tags/i)).toBeInTheDocument()
    })

    it('opens tags popover on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTestsFilters()
      await user.click(screen.getByTestId('filter-tags'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('tags popover shows available tags', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTestsFilters()
      await user.click(screen.getByTestId('filter-tags'))

      mockAllTags.forEach((tag) => {
        expect(screen.getByText(tag)).toBeInTheDocument()
      })
    })

    it('tags can be selected/deselected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderTestsFilters({ onFilterChange: handleFilterChange })
      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('auth'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['auth'] })
      )
    })

    it('tags filter has search within popover', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTestsFilters()
      await user.click(screen.getByTestId('filter-tags'))

      expect(screen.getByPlaceholderText(/Search tags/i)).toBeInTheDocument()
    })

    it('searching filters visible tags', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTestsFilters()
      await user.click(screen.getByTestId('filter-tags'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'auth')

      expect(screen.getByText('auth')).toBeInTheDocument()
      expect(screen.queryByText('database')).not.toBeInTheDocument()
    })

    it('tags filter is disabled when disabled prop is true', () => {
      renderTestsFilters({ disabled: true })
      expect(screen.getByTestId('filter-tags')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Columns Toggle', () => {
    it('renders Columns button', () => {
      renderTestsFilters()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeInTheDocument()
    })

    it('Columns button is visible', () => {
      renderTestsFilters()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('clicking Columns button opens dropdown', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTestsFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('columns dropdown shows column options', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTestsFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      mockColumns.forEach((col) => {
        expect(screen.getByRole('menuitemcheckbox', { name: col.label })).toBeInTheDocument()
      })
    })

    it('visible columns are checked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTestsFilters()
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

      renderTestsFilters({ onColumnToggle: handleColumnToggle })
      await user.click(screen.getByRole('button', { name: /Columns/i }))
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Tags' }))

      expect(handleColumnToggle).toHaveBeenCalledWith('tags', true)
    })
  })

  describe('Filter Reset', () => {
    it('shows Clear Filters button when any filter is active', () => {
      renderTestsFilters({ filters: { ...mockFilters, status: ['passed'] } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('does not show Clear Filters button when no filters active', () => {
      renderTestsFilters()
      expect(screen.queryByRole('button', { name: /Clear Filters/i })).not.toBeInTheDocument()
    })

    it('clicking Clear Filters resets all filters', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderTestsFilters({
        filters: { search: 'test', status: ['passed'], suiteIds: ['suite-auth'], tags: ['auth'] },
        onFilterChange: handleFilterChange,
      })

      await user.click(screen.getByRole('button', { name: /Clear Filters/i }))

      expect(handleFilterChange).toHaveBeenCalledWith({
        search: '',
        status: [],
        suiteIds: [],
        tags: [],
      })
    })
  })

  describe('Accessibility', () => {
    it('search input has accessible label', () => {
      renderTestsFilters()
      expect(screen.getByLabelText(/Search tests/i)).toBeInTheDocument()
    })

    it('status filter has accessible label', () => {
      renderTestsFilters()
      const statusFilter = screen.getByTestId('filter-status')
      expect(statusFilter).toHaveAttribute('aria-label')
    })

    it('suite filter has accessible label', () => {
      renderTestsFilters()
      const suiteFilter = screen.getByTestId('filter-suite')
      expect(suiteFilter).toHaveAttribute('aria-label')
    })

    it('tags filter has accessible label', () => {
      renderTestsFilters()
      const tagsFilter = screen.getByTestId('filter-tags')
      expect(tagsFilter).toHaveAttribute('aria-label')
    })

    it('disabled state is communicated via aria-disabled', () => {
      renderTestsFilters({ disabled: true })

      expect(screen.getByTestId('filter-status')).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByTestId('filter-suite')).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByTestId('filter-tags')).toHaveAttribute('aria-disabled', 'true')
    })
  })
})
