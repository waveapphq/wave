/**
 * ProfilesFilters Component Tests
 *
 * REQ-4.7.4: Profile management UI
 *
 * V-PROF-01: Profiles list with filters
 *
 * Tests for ProfilesFilters component per design specification:
 * - Search input with debounce
 * - Type filter dropdown (database, ssh, http, kubernetes, opensearch, custom)
 * - Tags multi-select popover
 * - Columns toggle dropdown
 * - NO Status filter (profiles do not execute)
 * - NO Mass Action (not applicable to profiles)
 *
 * Component: frontend/src/components/profiles/profiles-filters.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProfilesFilters, type ProfilesFiltersProps } from '@/features/profiles/components/profiles-filters'

// ============================================================================
// Mock Data
// ============================================================================

const mockFilters = {
  search: '',
  type: '',
  tags: [] as string[],
}

const mockProfileTypes = ['database', 'ssh', 'http', 'kubernetes', 'opensearch', 'custom']

const mockAllTags = ['production', 'staging', 'dev', 'qa', 'critical', 'backup']

const mockColumns = [
  { id: 'name', label: 'Name', visible: true },
  { id: 'type', label: 'Type', visible: true },
  { id: 'tags', label: 'Tags', visible: true },
  { id: 'usage', label: 'Usage', visible: true },
  { id: 'description', label: 'Description', visible: false },
]

// ============================================================================
// Test Utilities
// ============================================================================

function renderProfilesFilters(props: Partial<ProfilesFiltersProps> = {}) {
  const defaultProps: ProfilesFiltersProps = {
    filters: mockFilters,
    profileTypes: mockProfileTypes,
    allTags: mockAllTags,
    columns: mockColumns,
    onFilterChange: vi.fn(),
    onColumnToggle: vi.fn(),
    disabled: false,
    ...props,
  }
  return render(<ProfilesFilters {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('ProfilesFilters', () => {
  describe('Filter Section Container', () => {
    it('renders filters section with correct testid', () => {
      renderProfilesFilters()
      expect(screen.getByTestId('filters-section')).toBeInTheDocument()
    })

    it('filters section is visible', () => {
      renderProfilesFilters()
      expect(screen.getByTestId('filters-section')).toBeVisible()
    })
  })

  describe('Search Input', () => {
    it('renders search input with correct placeholder', () => {
      renderProfilesFilters()
      expect(screen.getByPlaceholderText(/Search profiles/i)).toBeInTheDocument()
    })

    it('search input is visible', () => {
      renderProfilesFilters()
      expect(screen.getByPlaceholderText(/Search profiles/i)).toBeVisible()
    })

    it('search input displays initial filter value via defaultValue', () => {
      renderProfilesFilters({ filters: { ...mockFilters, search: 'production' } })
      expect(screen.getByPlaceholderText(/Search profiles/i)).toHaveValue('production')
    })

    it('search input is disabled when disabled prop is true', () => {
      renderProfilesFilters({ disabled: true })
      expect(screen.getByPlaceholderText(/Search profiles/i)).toBeDisabled()
    })

    it('search input debounces input by 300ms', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search profiles/i)

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

      renderProfilesFilters({ onFilterChange: handleFilterChange })
      const searchInput = screen.getByPlaceholderText(/Search profiles/i)

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

  describe('Type Filter', () => {
    it('renders type filter with correct testid', () => {
      renderProfilesFilters()
      expect(screen.getByTestId('filter-type')).toBeInTheDocument()
    })

    it('type filter is visible', () => {
      renderProfilesFilters()
      expect(screen.getByTestId('filter-type')).toBeVisible()
    })

    it('type filter has default placeholder', () => {
      renderProfilesFilters()
      expect(screen.getByTestId('filter-type')).toHaveTextContent('Type')
    })

    it('type filter displays selected type', () => {
      renderProfilesFilters({ filters: { ...mockFilters, type: 'database' } })
      expect(screen.getByTestId('filter-type')).toHaveTextContent('database')
    })

    it('type filter is disabled when disabled prop is true', () => {
      renderProfilesFilters({ disabled: true })
      expect(screen.getByTestId('filter-type')).toHaveAttribute('aria-disabled', 'true')
    })

    it('opens type popover on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByTestId('filter-type'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('type popover shows all profile types', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByTestId('filter-type'))

      mockProfileTypes.forEach((type) => {
        expect(screen.getByText(type)).toBeInTheDocument()
      })
    })

    it('type can be selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({ onFilterChange: handleFilterChange })
      await user.click(screen.getByTestId('filter-type'))
      await user.click(screen.getByText('database'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'database' })
      )
    })

    it('type can be cleared when already selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { within } = await import('@testing-library/react')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({
        filters: { ...mockFilters, type: 'database' },
        onFilterChange: handleFilterChange,
      })
      await user.click(screen.getByTestId('filter-type'))
      // Use within dialog to be specific
      const dialog = screen.getByRole('dialog')
      await user.click(within(dialog).getByText('database'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: '' })
      )
    })

    it('searching filters visible types', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByTestId('filter-type'))
      await user.type(screen.getByPlaceholderText(/Search type/i), 'data')

      expect(screen.getByText('database')).toBeInTheDocument()
      expect(screen.queryByText('ssh')).not.toBeInTheDocument()
    })
  })

  describe('Status Filter - NOT Present', () => {
    it('does NOT render status filter (profiles do not execute)', () => {
      renderProfilesFilters()
      expect(screen.queryByTestId('filter-status')).not.toBeInTheDocument()
    })
  })

  describe('Tags Filter', () => {
    it('renders tags filter with correct testid', () => {
      renderProfilesFilters()
      expect(screen.getByTestId('filter-tags')).toBeInTheDocument()
    })

    it('tags filter is visible', () => {
      renderProfilesFilters()
      expect(screen.getByTestId('filter-tags')).toBeVisible()
    })

    it('tags filter has default placeholder', () => {
      renderProfilesFilters()
      expect(screen.getByText(/Tags/i)).toBeInTheDocument()
    })

    it('tags filter shows count when tags are selected', () => {
      renderProfilesFilters({ filters: { ...mockFilters, tags: ['production', 'database'] } })
      expect(screen.getByText(/2 tags/i)).toBeInTheDocument()
    })

    it('opens tags popover on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByTestId('filter-tags'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('tags popover shows available tags', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByTestId('filter-tags'))

      mockAllTags.forEach((tag) => {
        expect(screen.getByText(tag)).toBeInTheDocument()
      })
    })

    it('tags can be selected/deselected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({ onFilterChange: handleFilterChange })
      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('production'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['production'] })
      )
    })

    it('tag can be deselected when already selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({
        filters: { ...mockFilters, tags: ['production'] },
        onFilterChange: handleFilterChange,
      })
      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('production'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ tags: [] })
      )
    })

    it('tags filter has search within popover', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByTestId('filter-tags'))

      expect(screen.getByPlaceholderText(/Search tags/i)).toBeInTheDocument()
    })

    it('searching filters visible tags', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByTestId('filter-tags'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'prod')

      expect(screen.getByText('production')).toBeInTheDocument()
      expect(screen.queryByText('staging')).not.toBeInTheDocument()
    })

    it('tags filter is disabled when disabled prop is true', () => {
      renderProfilesFilters({ disabled: true })
      expect(screen.getByTestId('filter-tags')).toHaveAttribute('aria-disabled', 'true')
    })

    it('multiple tags can be selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      // Start with production already selected to test adding more
      renderProfilesFilters({
        filters: { ...mockFilters, tags: ['production'] },
        onFilterChange: handleFilterChange,
      })
      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('staging'))

      // Check that new tag was added to existing
      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['production', 'staging']),
        })
      )
    })
  })

  describe('Columns Toggle', () => {
    it('renders Columns button', () => {
      renderProfilesFilters()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeInTheDocument()
    })

    it('Columns button is visible', () => {
      renderProfilesFilters()
      expect(screen.getByRole('button', { name: /Columns/i })).toBeVisible()
    })

    it('clicking Columns button opens dropdown', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('columns dropdown shows column options', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      mockColumns.forEach((col) => {
        expect(screen.getByRole('menuitemcheckbox', { name: col.label })).toBeInTheDocument()
      })
    })

    it('visible columns are checked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByRole('button', { name: /Columns/i }))

      const nameCheckbox = screen.getByRole('menuitemcheckbox', { name: 'Name' })
      expect(nameCheckbox).toHaveAttribute('aria-checked', 'true')

      const descriptionCheckbox = screen.getByRole('menuitemcheckbox', { name: 'Description' })
      expect(descriptionCheckbox).toHaveAttribute('aria-checked', 'false')
    })

    it('calls onColumnToggle when column visibility is changed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleColumnToggle = vi.fn()

      renderProfilesFilters({ onColumnToggle: handleColumnToggle })
      await user.click(screen.getByRole('button', { name: /Columns/i }))
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Description' }))

      expect(handleColumnToggle).toHaveBeenCalledWith('description', true)
    })

    it('calls onColumnToggle to hide when visible column is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleColumnToggle = vi.fn()

      renderProfilesFilters({ onColumnToggle: handleColumnToggle })
      await user.click(screen.getByRole('button', { name: /Columns/i }))
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Type' }))

      expect(handleColumnToggle).toHaveBeenCalledWith('type', false)
    })
  })

  describe('Filter Reset', () => {
    it('shows Clear Filters button when any filter is active', () => {
      renderProfilesFilters({ filters: { ...mockFilters, type: 'database' } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('does not show Clear Filters button when no filters active', () => {
      renderProfilesFilters()
      expect(screen.queryByRole('button', { name: /Clear Filters/i })).not.toBeInTheDocument()
    })

    it('shows Clear Filters when search is active', () => {
      renderProfilesFilters({ filters: { ...mockFilters, search: 'test' } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('shows Clear Filters when tags are selected', () => {
      renderProfilesFilters({ filters: { ...mockFilters, tags: ['production'] } })
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument()
    })

    it('clicking Clear Filters resets all filters', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({
        filters: { search: 'test', type: 'database', tags: ['production'] },
        onFilterChange: handleFilterChange,
      })

      await user.click(screen.getByRole('button', { name: /Clear Filters/i }))

      expect(handleFilterChange).toHaveBeenCalledWith({
        search: '',
        type: '',
        tags: [],
      })
    })
  })

  describe('Accessibility', () => {
    it('search input has accessible label', () => {
      renderProfilesFilters()
      expect(screen.getByLabelText(/Search profiles/i)).toBeInTheDocument()
    })

    it('type filter has accessible label', () => {
      renderProfilesFilters()
      const typeFilter = screen.getByTestId('filter-type')
      expect(typeFilter).toHaveAttribute('aria-label')
    })

    it('tags filter has accessible label', () => {
      renderProfilesFilters()
      const tagsFilter = screen.getByTestId('filter-tags')
      expect(tagsFilter).toHaveAttribute('aria-label')
    })

    it('disabled state is communicated via aria-disabled', () => {
      renderProfilesFilters({ disabled: true })

      expect(screen.getByTestId('filter-type')).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByTestId('filter-tags')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Actions Slot - NOT Present', () => {
    it('does NOT render actions slot (no Mass Action for profiles)', () => {
      // Profiles page does not have Mass Action button per PROFILE-9
      // The filters component should not have an actions slot for bulk actions
      renderProfilesFilters()
      expect(screen.queryByTestId('bulk-actions')).not.toBeInTheDocument()
    })
  })

  describe('Filter Combinations', () => {
    it('applies type and tags filter together', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({
        filters: { search: '', type: 'ssh', tags: [] },
        onFilterChange: handleFilterChange,
      })

      // Add a tag filter on top of existing type filter
      await user.click(screen.getByTestId('filter-tags'))
      await user.click(screen.getByText('production'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ssh',
          tags: ['production'],
        })
      )
    })

    it('applies search and type filter together', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { within } = await import('@testing-library/react')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({
        filters: { search: 'prod', type: '', tags: [] },
        onFilterChange: handleFilterChange,
      })

      // Add type filter on top of existing search
      await user.click(screen.getByTestId('filter-type'))
      // Use within dialog to be specific
      const dialog = screen.getByRole('dialog')
      await user.click(within(dialog).getByText('database'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'prod',
          type: 'database',
        })
      )
    })

    it('preserves other filters when clearing one', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { within } = await import('@testing-library/react')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({
        filters: { search: 'test', type: 'ssh', tags: ['production'] },
        onFilterChange: handleFilterChange,
      })

      // Clear type filter
      await user.click(screen.getByTestId('filter-type'))
      const dialog = screen.getByRole('dialog')
      await user.click(within(dialog).getByText('ssh'))

      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'test',
          type: '',
          tags: ['production'],
        })
      )
    })
  })

  describe('Empty Profile Types', () => {
    it('shows "No types available" when profileTypes is empty', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters({ profileTypes: [] })
      await user.click(screen.getByTestId('filter-type'))

      expect(screen.getByText(/No types available/i)).toBeInTheDocument()
    })

    it('shows "No types found" when search yields no results', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderProfilesFilters()
      await user.click(screen.getByTestId('filter-type'))
      // Search for something that doesn't exist
      await user.type(screen.getByPlaceholderText(/Search type/i), 'nonexistent')

      // Should show CommandEmpty message
      expect(screen.getByText(/No types found/i)).toBeInTheDocument()
    })
  })

  describe('Search Clear Button', () => {
    it('clears search when clear button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({
        filters: { search: 'initial', type: '', tags: [] },
        onFilterChange: handleFilterChange,
      })

      // The search input should have value 'initial'
      const searchInput = screen.getByPlaceholderText(/Search profiles/i)
      expect(searchInput).toHaveValue('initial')

      // Click the clear button (aria-label="Clear search")
      const clearButton = screen.getByRole('button', { name: /clear search/i })
      await user.click(clearButton)

      // Should call onFilterChange with empty search
      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: '' })
      )
    })

    it('clears search using keyboard Escape key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleFilterChange = vi.fn()

      renderProfilesFilters({
        filters: { search: 'test', type: '', tags: [] },
        onFilterChange: handleFilterChange,
      })

      const searchInput = screen.getByPlaceholderText(/Search profiles/i)

      // Focus and press Escape
      await user.click(searchInput)
      await user.keyboard('{Escape}')

      // Should call onFilterChange with empty search
      expect(handleFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: '' })
      )
    })
  })
})
