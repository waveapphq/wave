/**
 * EntityFilters Component Tests
 *
 * Tests for the shared filter bar component used by all entity list pages.
 * Covers: search input, filter popovers (single/multi-select), tags filter,
 * columns toggle, clear filters, disabled state, and actions slot.
 *
 * Component: frontend/src/components/shared/filters/entity-filters.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  EntityFilters,
  type EntityFiltersProps,
  type FilterField,
  type Column,
} from '@/components/shared/filters/entity-filters'

// ============================================================================
// Mock Data
// ============================================================================

const mockColumns: Column[] = [
  { id: 'name', label: 'Name', visible: true },
  { id: 'status', label: 'Status', visible: true },
  { id: 'tags', label: 'Tags', visible: false },
  { id: 'lastRun', label: 'Last Run', visible: true },
]

const mockMultiSelectField: FilterField = {
  key: 'status',
  placeholder: 'Status',
  countLabel: 'statuses',
  countLabelSingular: 'status',
  testId: 'filter-status',
  ariaLabel: 'Filter by status',
  buttonWidth: 'w-[140px]',
  searchPlaceholder: 'Search status…',
  emptyMessage: 'No status found.',
  options: [
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'never_run', label: 'Never Run' },
  ],
  mode: 'multi',
  selectedValues: [],
}

const mockSingleSelectField: FilterField = {
  key: 'suite',
  placeholder: 'Suite',
  countLabel: 'suites',
  testId: 'filter-suite',
  ariaLabel: 'Filter by suite',
  buttonWidth: 'w-[160px]',
  searchPlaceholder: 'Search suites…',
  emptyMessage: 'No suite found.',
  options: [
    { value: 'suite-1', label: 'Login Suite' },
    { value: 'suite-2', label: 'API Suite' },
    { value: 'suite-3', label: 'E2E Suite' },
  ],
  mode: 'single',
  selectedValue: '',
}

const mockAllTags = ['auth', 'smoke', 'api', 'regression', 'database']

// ============================================================================
// Test Utilities
// ============================================================================

function createDefaultProps(overrides: Partial<EntityFiltersProps> = {}): EntityFiltersProps {
  return {
    search: {
      id: 'test-search',
      name: 'test-search',
      placeholder: 'Search tests…',
      ariaLabel: 'Search tests',
      defaultValue: '',
    },
    fields: [mockMultiSelectField],
    allTags: mockAllTags,
    selectedTags: [],
    columns: mockColumns,
    hasActiveFilters: false,
    disabled: false,
    onSearchChange: vi.fn(),
    onFieldChange: vi.fn(),
    onTagsChange: vi.fn(),
    onColumnToggle: vi.fn(),
    onClearAll: vi.fn(),
    ...overrides,
  }
}

function renderEntityFilters(overrides: Partial<EntityFiltersProps> = {}) {
  const props = createDefaultProps(overrides)
  const result = render(<EntityFilters {...props} />)
  return { ...result, props }
}

// ============================================================================
// Tests
// ============================================================================

describe('EntityFilters', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
  })

  // --------------------------------------------------------------------------
  // 1. Search Input Rendering
  // --------------------------------------------------------------------------
  describe('Search Input', () => {
    it('renders search input with correct placeholder', () => {
      renderEntityFilters()
      expect(screen.getByPlaceholderText('Search tests…')).toBeInTheDocument()
    })

    it('renders search input with correct aria-label', () => {
      renderEntityFilters()
      expect(screen.getByLabelText('Search tests')).toBeInTheDocument()
    })

    it('renders search input with default value', () => {
      renderEntityFilters({
        search: {
          id: 'test-search',
          name: 'test-search',
          placeholder: 'Search tests…',
          ariaLabel: 'Search tests',
          defaultValue: 'existing query',
        },
      })
      expect(screen.getByPlaceholderText('Search tests…')).toHaveValue('existing query')
    })

    it('search input is disabled when disabled prop is true', () => {
      renderEntityFilters({ disabled: true })
      expect(screen.getByPlaceholderText('Search tests…')).toBeDisabled()
    })
  })

  // --------------------------------------------------------------------------
  // 2. Search onChange Callback
  // --------------------------------------------------------------------------
  describe('Search onChange Callback', () => {
    it('triggers onSearchChange callback with debounce', async () => {
      const onSearchChange = vi.fn()
      renderEntityFilters({ onSearchChange })
      const searchInput = screen.getByPlaceholderText('Search tests…')

      await user.type(searchInput, 'hello')

      // Should not have fired yet (debounced at 300ms)
      expect(onSearchChange).not.toHaveBeenCalled()

      // Wait for debounce
      await waitFor(
        () => {
          expect(onSearchChange).toHaveBeenCalledWith('hello')
        },
        { timeout: 500 }
      )
    })

    it('clears search input and calls onSearchChange when clear button clicked', async () => {
      const onSearchChange = vi.fn()
      renderEntityFilters({
        search: {
          id: 'test-search',
          name: 'test-search',
          placeholder: 'Search tests…',
          ariaLabel: 'Search tests',
          defaultValue: 'existing',
        },
        onSearchChange,
      })

      const clearButton = screen.getByRole('button', { name: /clear search/i })
      await user.click(clearButton)

      expect(onSearchChange).toHaveBeenCalledWith('')
    })
  })

  // --------------------------------------------------------------------------
  // 3. Filter Popovers Rendering
  // --------------------------------------------------------------------------
  describe('Filter Popovers', () => {
    it('renders a filter popover trigger for each field', () => {
      renderEntityFilters({
        fields: [mockMultiSelectField, mockSingleSelectField],
      })
      expect(screen.getByTestId('filter-status')).toBeInTheDocument()
      expect(screen.getByTestId('filter-suite')).toBeInTheDocument()
    })

    it('filter trigger shows placeholder when nothing selected', () => {
      renderEntityFilters({
        fields: [mockMultiSelectField],
      })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('Status')
    })

    it('opens filter popover on click', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('filter-status'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('filter popover shows all options', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('filter-status'))

      expect(screen.getByText('Passed')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.getByText('Never Run')).toBeInTheDocument()
    })

    it('filter popover has search input with correct placeholder', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('filter-status'))

      expect(screen.getByPlaceholderText('Search status…')).toBeInTheDocument()
    })

    it('searching in filter popover filters visible options', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('filter-status'))
      await user.type(screen.getByPlaceholderText('Search status…'), 'Pass')

      expect(screen.getByText('Passed')).toBeInTheDocument()
      expect(screen.queryByText('Failed')).not.toBeInTheDocument()
      expect(screen.queryByText('Never Run')).not.toBeInTheDocument()
    })

    it('filter trigger is disabled when disabled prop is true', () => {
      renderEntityFilters({ disabled: true })
      expect(screen.getByTestId('filter-status')).toBeDisabled()
    })

    it('filter trigger has correct aria-label', () => {
      renderEntityFilters()
      expect(screen.getByTestId('filter-status')).toHaveAttribute(
        'aria-label',
        'Filter by status'
      )
    })
  })

  // --------------------------------------------------------------------------
  // 4. Single-select Filter Mode
  // --------------------------------------------------------------------------
  describe('Single-select Filter Mode', () => {
    it('shows placeholder when no value selected', () => {
      renderEntityFilters({
        fields: [{ ...mockSingleSelectField, selectedValue: '' }],
      })
      expect(screen.getByTestId('filter-suite')).toHaveTextContent('Suite')
    })

    it('shows selected option label when value is selected', () => {
      renderEntityFilters({
        fields: [{ ...mockSingleSelectField, selectedValue: 'suite-1' }],
      })
      expect(screen.getByTestId('filter-suite')).toHaveTextContent('Login Suite')
    })

    it('shows raw value when selectedValue does not match any option', () => {
      renderEntityFilters({
        fields: [{ ...mockSingleSelectField, selectedValue: 'unknown-id' }],
      })
      expect(screen.getByTestId('filter-suite')).toHaveTextContent('unknown-id')
    })

    it('selecting an option calls onFieldChange with the value', async () => {
      const onFieldChange = vi.fn()
      renderEntityFilters({
        fields: [{ ...mockSingleSelectField, selectedValue: '' }],
        onFieldChange,
      })

      await user.click(screen.getByTestId('filter-suite'))
      await user.click(screen.getByText('API Suite'))

      expect(onFieldChange).toHaveBeenCalledWith('suite', 'suite-2')
    })

    it('selecting the same value deselects it (toggles to empty)', async () => {
      const onFieldChange = vi.fn()
      renderEntityFilters({
        fields: [{ ...mockSingleSelectField, selectedValue: 'suite-2' }],
        onFieldChange,
      })

      await user.click(screen.getByTestId('filter-suite'))
      // Trigger button and popover item both show "API Suite", so target
      // the one inside the popover (second match) rather than the trigger label
      const allItems = screen.getAllByText('API Suite')
      await user.click(allItems[1])

      expect(onFieldChange).toHaveBeenCalledWith('suite', '')
    })
  })

  // --------------------------------------------------------------------------
  // 5. Multi-select Filter Mode
  // --------------------------------------------------------------------------
  describe('Multi-select Filter Mode', () => {
    it('shows placeholder when no values selected', () => {
      renderEntityFilters({
        fields: [{ ...mockMultiSelectField, selectedValues: [] }],
      })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('Status')
    })

    it('shows singular count label when one value selected', () => {
      renderEntityFilters({
        fields: [{ ...mockMultiSelectField, selectedValues: ['passed'] }],
      })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('1 status')
    })

    it('shows plural count label when multiple values selected', () => {
      renderEntityFilters({
        fields: [
          { ...mockMultiSelectField, selectedValues: ['passed', 'failed'] },
        ],
      })
      expect(screen.getByTestId('filter-status')).toHaveTextContent('2 statuses')
    })

    it('uses countLabel as fallback when countLabelSingular is not provided', () => {
      renderEntityFilters({
        fields: [
          {
            ...mockMultiSelectField,
            countLabelSingular: undefined,
            selectedValues: ['passed'],
          },
        ],
      })
      // Falls back to countLabel ("statuses") even for count === 1
      expect(screen.getByTestId('filter-status')).toHaveTextContent('1 statuses')
    })

    it('toggling an option on calls onFieldChange with new array', async () => {
      const onFieldChange = vi.fn()
      renderEntityFilters({
        fields: [{ ...mockMultiSelectField, selectedValues: [] }],
        onFieldChange,
      })

      await user.click(screen.getByTestId('filter-status'))
      await user.click(screen.getByText('Passed'))

      expect(onFieldChange).toHaveBeenCalledWith('status', ['passed'])
    })

    it('toggling an option off calls onFieldChange without that value', async () => {
      const onFieldChange = vi.fn()
      renderEntityFilters({
        fields: [
          { ...mockMultiSelectField, selectedValues: ['passed', 'failed'] },
        ],
        onFieldChange,
      })

      await user.click(screen.getByTestId('filter-status'))
      await user.click(screen.getByText('Passed'))

      expect(onFieldChange).toHaveBeenCalledWith('status', ['failed'])
    })

    it('multi-select with undefined selectedValues treats as empty', async () => {
      const onFieldChange = vi.fn()
      renderEntityFilters({
        fields: [
          { ...mockMultiSelectField, selectedValues: undefined },
        ],
        onFieldChange,
      })

      // Should show placeholder
      expect(screen.getByTestId('filter-status')).toHaveTextContent('Status')

      // Selecting should produce single-item array
      await user.click(screen.getByTestId('filter-status'))
      await user.click(screen.getByText('Failed'))

      expect(onFieldChange).toHaveBeenCalledWith('status', ['failed'])
    })
  })

  // --------------------------------------------------------------------------
  // 6. Tags Filter
  // --------------------------------------------------------------------------
  describe('Tags Filter', () => {
    it('renders tags filter trigger', () => {
      renderEntityFilters()
      expect(screen.getByTestId('filter-tags')).toBeInTheDocument()
    })

    it('tags trigger shows "Tags" when no tags selected', () => {
      renderEntityFilters({ selectedTags: [] })
      expect(screen.getByTestId('filter-tags')).toHaveTextContent('Tags')
    })

    it('tags trigger shows count when tags are selected', () => {
      renderEntityFilters({ selectedTags: ['auth', 'smoke'] })
      expect(screen.getByTestId('filter-tags')).toHaveTextContent('2 tags')
    })

    it('tags trigger reads "1 tag" for a single selected tag', () => {
      renderEntityFilters({ selectedTags: ['auth'] })
      expect(screen.getByTestId('filter-tags')).toHaveTextContent(/^1 tag$/)
    })

    it('opens tags popover on click', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('filter-tags'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('tags popover shows all available tags from allTags', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('filter-tags'))

      for (const tag of mockAllTags) {
        expect(screen.getByText(tag)).toBeInTheDocument()
      }
    })

    it('tags popover has search input', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('filter-tags'))

      expect(screen.getByPlaceholderText('Search tags…')).toBeInTheDocument()
    })

    it('searching filters visible tags', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('filter-tags'))
      await user.type(screen.getByPlaceholderText('Search tags…'), 'auth')

      expect(screen.getByText('auth')).toBeInTheDocument()
      expect(screen.queryByText('smoke')).not.toBeInTheDocument()
      expect(screen.queryByText('database')).not.toBeInTheDocument()
    })

    it('tags filter is disabled when disabled prop is true', () => {
      renderEntityFilters({ disabled: true })
      expect(screen.getByTestId('filter-tags')).toBeDisabled()
    })

    it('tags filter has correct aria-label', () => {
      renderEntityFilters()
      expect(screen.getByTestId('filter-tags')).toHaveAttribute(
        'aria-label',
        'Filter by tags'
      )
    })
  })

  // --------------------------------------------------------------------------
  // 7. Tag Toggling
  // --------------------------------------------------------------------------
  describe('Tag Toggling', () => {
    it('selecting a tag calls onTagsChange with the tag added', async () => {
      const onTagsChange = vi.fn()
      renderEntityFilters({ selectedTags: [], onTagsChange })

      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('auth'))

      expect(onTagsChange).toHaveBeenCalledWith(['auth'])
    })

    it('deselecting a tag calls onTagsChange without that tag', async () => {
      const onTagsChange = vi.fn()
      renderEntityFilters({ selectedTags: ['auth', 'smoke'], onTagsChange })

      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('auth'))

      expect(onTagsChange).toHaveBeenCalledWith(['smoke'])
    })

    it('adding a tag to existing selection preserves other tags', async () => {
      const onTagsChange = vi.fn()
      renderEntityFilters({ selectedTags: ['auth'], onTagsChange })

      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('smoke'))

      expect(onTagsChange).toHaveBeenCalledWith(['auth', 'smoke'])
    })
  })

  // --------------------------------------------------------------------------
  // 8. Column Visibility Toggle
  // --------------------------------------------------------------------------
  describe('Column Visibility Toggle', () => {
    it('renders Columns button', () => {
      renderEntityFilters()
      expect(screen.getByTestId('columns-button')).toBeInTheDocument()
    })

    it('clicking Columns button opens dropdown menu', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('columns-button'))

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('columns dropdown shows all column options', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('columns-button'))

      for (const col of mockColumns) {
        expect(screen.getByRole('menuitemcheckbox', { name: col.label })).toBeInTheDocument()
      }
    })

    it('visible columns are marked as checked', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('columns-button'))

      const nameItem = screen.getByRole('menuitemcheckbox', { name: 'Name' })
      expect(nameItem).toHaveAttribute('aria-checked', 'true')

      const tagsItem = screen.getByRole('menuitemcheckbox', { name: 'Tags' })
      expect(tagsItem).toHaveAttribute('aria-checked', 'false')
    })

    it('clicking a column menu item calls onColumnToggle', async () => {
      const onColumnToggle = vi.fn()
      renderEntityFilters({ onColumnToggle })

      await user.click(screen.getByTestId('columns-button'))
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Tags' }))

      expect(onColumnToggle).toHaveBeenCalledWith('tags', true)
    })

    it('clicking a visible column item calls onColumnToggle to hide it', async () => {
      const onColumnToggle = vi.fn()
      renderEntityFilters({ onColumnToggle })

      await user.click(screen.getByTestId('columns-button'))
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Name' }))

      expect(onColumnToggle).toHaveBeenCalledWith('name', false)
    })

    it('Columns button is disabled when disabled prop is true', () => {
      renderEntityFilters({ disabled: true })
      expect(screen.getByTestId('columns-button')).toBeDisabled()
    })
  })

  // --------------------------------------------------------------------------
  // 9. Empty Filter Source
  // --------------------------------------------------------------------------
  describe('Empty Filter Source', () => {
    it('shows emptySourceMessage when filter options are empty', async () => {
      const emptyField: FilterField = {
        ...mockMultiSelectField,
        options: [],
        emptySourceMessage: 'No statuses available.',
      }
      renderEntityFilters({ fields: [emptyField] })

      await user.click(screen.getByTestId('filter-status'))

      expect(screen.getByText('No statuses available.')).toBeInTheDocument()
    })

    it('does not show emptySourceMessage when emptySourceMessage is not set', async () => {
      const emptyField: FilterField = {
        ...mockMultiSelectField,
        options: [],
        emptySourceMessage: undefined,
      }
      renderEntityFilters({ fields: [emptyField] })

      await user.click(screen.getByTestId('filter-status'))

      // Should not crash and should not show any message
      expect(screen.queryByText('No statuses available.')).not.toBeInTheDocument()
    })

    it('shows emptyMessage when search yields no results but options exist', async () => {
      renderEntityFilters()
      await user.click(screen.getByTestId('filter-status'))
      await user.type(
        screen.getByPlaceholderText('Search status…'),
        'zzzznonexistent'
      )

      expect(screen.getByText('No status found.')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // 10. Clear Filters & Active Filter State
  // --------------------------------------------------------------------------
  describe('Clear Filters', () => {
    it('shows Clear Filters button when hasActiveFilters is true', () => {
      renderEntityFilters({ hasActiveFilters: true })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('does not show Clear Filters button when hasActiveFilters is false', () => {
      renderEntityFilters({ hasActiveFilters: false })
      expect(screen.queryByRole('button', { name: /Clear Filters/i })).not.toBeInTheDocument()
    })

    it('clicking Clear Filters calls onClearAll', async () => {
      const onClearAll = vi.fn()
      renderEntityFilters({ hasActiveFilters: true, onClearAll })

      await user.click(screen.getByRole('button', { name: /Clear Filters/i }))
      expect(onClearAll).toHaveBeenCalledTimes(1)
    })

    it('clicking Clear Filters also clears the search input value', async () => {
      const onClearAll = vi.fn()
      renderEntityFilters({
        search: {
          id: 'test-search',
          name: 'test-search',
          placeholder: 'Search tests…',
          ariaLabel: 'Search tests',
          defaultValue: 'some text',
        },
        hasActiveFilters: true,
        onClearAll,
      })

      await user.click(screen.getByRole('button', { name: /Clear Filters/i }))

      // onClearAll was called
      expect(onClearAll).toHaveBeenCalled()
      // The search input should be cleared
      expect(screen.getByPlaceholderText('Search tests…')).toHaveValue('')
    })
  })

  // --------------------------------------------------------------------------
  // Actions Slot
  // --------------------------------------------------------------------------
  describe('Actions Slot', () => {
    it('renders actions slot when provided', () => {
      renderEntityFilters({
        actions: <button data-testid="mass-action">Mass Action</button>,
      })
      expect(screen.getByTestId('mass-action')).toBeInTheDocument()
    })

    it('does not render extra content when actions is undefined', () => {
      renderEntityFilters({ actions: undefined })
      expect(screen.queryByTestId('mass-action')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Filters Section Container
  // --------------------------------------------------------------------------
  describe('Filters Section Container', () => {
    it('renders filters section with correct testid', () => {
      renderEntityFilters()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('renders with no fields', () => {
      renderEntityFilters({ fields: [] })
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
      // Search and tags should still render
      expect(screen.getByPlaceholderText('Search tests…')).toBeInTheDocument()
      expect(screen.getByTestId('filter-tags')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Multiple Filter Fields
  // --------------------------------------------------------------------------
  describe('Multiple Filter Fields', () => {
    it('renders both single-select and multi-select fields together', () => {
      renderEntityFilters({
        fields: [mockMultiSelectField, mockSingleSelectField],
      })
      expect(screen.getByTestId('filter-status')).toBeInTheDocument()
      expect(screen.getByTestId('filter-suite')).toBeInTheDocument()
    })

    it('each field operates independently', async () => {
      const onFieldChange = vi.fn()
      renderEntityFilters({
        fields: [
          { ...mockMultiSelectField, selectedValues: [] },
          { ...mockSingleSelectField, selectedValue: '' },
        ],
        onFieldChange,
      })

      // Interact with multi-select field
      await user.click(screen.getByTestId('filter-status'))
      await user.click(screen.getByText('Failed'))
      expect(onFieldChange).toHaveBeenCalledWith('status', ['failed'])
    })
  })

  // --------------------------------------------------------------------------
  // Empty tags list
  // --------------------------------------------------------------------------
  describe('Empty Tags', () => {
    it('renders tags popover when allTags is an empty array (still a tag-aware entity)', async () => {
      renderEntityFilters({ allTags: [] })

      // Tags filter is still rendered (just empty) for entities that have tags.
      // Hiding only happens when allTags is undefined (entities without tags).
      expect(screen.getByTestId('filter-tags')).toBeInTheDocument()
    })

    it('hides tags popover when allTags is undefined', () => {
      renderEntityFilters({ allTags: undefined })

      expect(screen.queryByTestId('filter-tags')).not.toBeInTheDocument()
    })
  })
})
