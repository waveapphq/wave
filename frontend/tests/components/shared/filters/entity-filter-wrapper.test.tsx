/**
 * EntityFilterWrapper Component Tests
 *
 * Tests for the shared wrapper that wires up useEntityFilterHandlers
 * and EntityFilters for all entity list pages.
 *
 * Component: frontend/src/components/shared/filters/entity-filter-wrapper.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntityFilterWrapper, type EntityFilterWrapperProps } from '@/components/shared/filters/entity-filter-wrapper'
import { type FilterField } from '@/components/shared/filters/entity-filters'

// ============================================================================
// Test types and data
// ============================================================================

interface TestFilters {
  search: string
  status: string[]
  tags: string[]
}

const STATUS_OPTIONS = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
]

const DEFAULT_FILTERS: TestFilters = { search: '', status: [], tags: [] }

const mockColumns = [
  { id: 'name', label: 'Name', visible: true },
  { id: 'status', label: 'Status', visible: true },
  { id: 'tags', label: 'Tags', visible: false },
]

const mockAllTags = ['alpha', 'beta', 'gamma']

function makeFields(filters: TestFilters): FilterField[] {
  return [
    {
      key: 'status',
      placeholder: 'Status',
      countLabel: 'statuses',
      countLabelSingular: 'status',
      testId: 'filter-status',
      ariaLabel: 'Filter by status',
      buttonWidth: 'w-[140px]',
      searchPlaceholder: 'Search status…',
      emptyMessage: 'No status found.',
      options: STATUS_OPTIONS,
      mode: 'multi',
      selectedValues: filters.status,
    },
  ]
}

function renderWrapper(
  props: Partial<EntityFilterWrapperProps<TestFilters>> = {},
  filters: TestFilters = { ...DEFAULT_FILTERS },
) {
  const defaultProps: EntityFilterWrapperProps<TestFilters> = {
    entityName: 'items',
    filters,
    defaultFilters: DEFAULT_FILTERS,
    allTags: mockAllTags,
    columns: mockColumns,
    fields: makeFields(filters),
    onFilterChange: vi.fn(),
    onColumnToggle: vi.fn(),
    ...props,
  }
  return render(<EntityFilterWrapper {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('EntityFilterWrapper', () => {
  describe('Renders entity-specific search config', () => {
    it('renders search input with entity name in placeholder', () => {
      renderWrapper({ entityName: 'widgets' })
      expect(screen.getByPlaceholderText(/Search widgets/i)).toBeInTheDocument()
    })

    it('renders search input with entity name in aria label', () => {
      renderWrapper({ entityName: 'widgets' })
      expect(screen.getByLabelText(/Search widgets/i)).toBeInTheDocument()
    })
  })

  describe('Filter fields', () => {
    it('renders provided filter fields', () => {
      renderWrapper()
      expect(screen.getByTestId('filter-status')).toBeInTheDocument()
    })

    it('shows status filter placeholder', () => {
      renderWrapper()
      expect(screen.getByTestId('filter-status')).toHaveTextContent('Status')
    })
  })

  describe('Tags', () => {
    it('renders tags filter', () => {
      renderWrapper()
      expect(screen.getByTestId('filter-tags')).toBeInTheDocument()
    })

    it('tags popover shows available tags', async () => {
      const user = userEvent.setup()
      renderWrapper()
      await user.click(screen.getByTestId('filter-tags'))

      mockAllTags.forEach((tag) => {
        expect(screen.getByText(tag)).toBeInTheDocument()
      })
    })

    it('selecting a tag calls onFilterChange', async () => {
      const user = userEvent.setup()
      const onFilterChange = vi.fn()
      renderWrapper({ onFilterChange })
      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('alpha'))

      expect(onFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['alpha'] })
      )
    })
  })

  describe('Columns toggle', () => {
    it('renders Columns button', () => {
      renderWrapper()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeInTheDocument()
    })

    it('calls onColumnToggle when column visibility is changed', async () => {
      const user = userEvent.setup()
      const onColumnToggle = vi.fn()
      renderWrapper({ onColumnToggle })
      await user.click(screen.getByRole('button', { name: /Columns/i }))
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Tags' }))

      expect(onColumnToggle).toHaveBeenCalledWith('tags', true)
    })
  })

  describe('Search behavior', () => {
    it('search input shows current filter value', () => {
      renderWrapper({}, { search: 'hello', status: [], tags: [] })
      expect(screen.getByPlaceholderText(/Search items/i)).toHaveValue('hello')
    })

    it('debounces search input', async () => {
      const user = userEvent.setup()
      const onFilterChange = vi.fn()
      renderWrapper({ onFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search items/i)

      await user.type(searchInput, 'test')
      expect(onFilterChange).not.toHaveBeenCalled()

      await waitFor(
        () => {
          expect(onFilterChange).toHaveBeenCalledWith(
            expect.objectContaining({ search: 'test' })
          )
        },
        { timeout: 500 }
      )
    })
  })

  describe('Clear filters', () => {
    it('shows Clear Filters button when filters are active', () => {
      renderWrapper(
        {},
        { search: 'test', status: [], tags: [] }
      )
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('does not show Clear Filters when no filters are active', () => {
      renderWrapper()
      expect(screen.queryByRole('button', { name: /Clear Filters/i })).not.toBeInTheDocument()
    })

    it('clicking Clear Filters resets all filters', async () => {
      const user = userEvent.setup()
      const onFilterChange = vi.fn()
      const filters = { search: 'test', status: ['passed'], tags: ['alpha'] }
      renderWrapper(
        { onFilterChange, fields: makeFields(filters) },
        filters,
      )

      await user.click(screen.getByRole('button', { name: /Clear Filters/i }))
      expect(onFilterChange).toHaveBeenCalledWith(DEFAULT_FILTERS)
    })
  })

  describe('Disabled state', () => {
    it('disables search input when disabled', () => {
      renderWrapper({ disabled: true })
      expect(screen.getByPlaceholderText(/Search items/i)).toBeDisabled()
    })

    it('disables filter fields when disabled', () => {
      renderWrapper({ disabled: true })
      expect(screen.getByTestId('filter-status')).toHaveAttribute('aria-disabled', 'true')
    })

    it('disables tags filter when disabled', () => {
      renderWrapper({ disabled: true })
      expect(screen.getByTestId('filter-tags')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Actions slot', () => {
    it('renders actions slot when provided', () => {
      renderWrapper({
        actions: <button data-testid="custom-action">Custom Action</button>,
      })
      expect(screen.getByTestId('custom-action')).toBeInTheDocument()
    })

    it('does not render actions slot when not provided', () => {
      renderWrapper()
      expect(screen.queryByTestId('custom-action')).not.toBeInTheDocument()
    })
  })
})
