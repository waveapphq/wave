/**
 * TagsInput Component Tests
 *
 * REQ-4.7.4: Profile management UI
 *
 * Tests for TagsInput component - a multi-select combobox for tags.
 *
 * Features tested:
 * - Display selected tags as badges
 * - Remove tags via badge X button
 * - Search/filter available tags
 * - Add new tags from dropdown
 * - Add new custom tags inline
 * - Keyboard navigation
 *
 * Pattern: Combobox with multi-select using Command + Popover + Badge
 *
 * Component: frontend/src/components/ui/tags-input.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { TagsInput, type TagsInputProps } from '@/components/ui/tags-input'

// ============================================================================
// Mock Data
// ============================================================================

const mockAvailableTags = ['production', 'staging', 'development', 'database', 'http', 'ssh', 'kubernetes']

const mockSelectedTags = ['production', 'database']

// ============================================================================
// Test Utilities
// ============================================================================

/** cmdk parks its only keyboard cursor on the first row once the list renders. */
async function expectCursorOnFirstOption() {
  await waitFor(() =>
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  )
}

function renderTagsInput(props: Partial<TagsInputProps> = {}) {
  const defaultProps: TagsInputProps = {
    value: [],
    availableTags: mockAvailableTags,
    onChange: vi.fn(),
    placeholder: 'Add tags…',
    disabled: false,
    ...props,
  }
  return render(<TagsInput {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('TagsInput', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders tags input container', () => {
      renderTagsInput()
      expect(screen.getByTestId('tags-input')).toBeInTheDocument()
    })

    it('renders with correct testid', () => {
      renderTagsInput()
      expect(screen.getByTestId('tags-input')).toBeVisible()
    })

    it('renders placeholder when no tags selected', () => {
      renderTagsInput({ value: [] })
      expect(screen.getByText(/Add tags/i)).toBeInTheDocument()
    })

    it('renders trigger button', () => {
      renderTagsInput()
      expect(screen.getByTestId('tags-trigger')).toBeInTheDocument()
    })
  })

  describe('Selected Tags Display', () => {
    it('displays selected tags as badges', () => {
      renderTagsInput({ value: mockSelectedTags })

      expect(screen.getByText('production')).toBeInTheDocument()
      expect(screen.getByText('database')).toBeInTheDocument()
    })

    it('each tag badge has a remove button', () => {
      renderTagsInput({ value: mockSelectedTags })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      expect(productionBadge?.querySelector('[data-remove-tag]')).toBeInTheDocument()
    })

    it('tag badges have correct styling', () => {
      renderTagsInput({ value: mockSelectedTags })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      expect(productionBadge).toHaveClass('badge')
    })

    it('displays correct number of tags', () => {
      renderTagsInput({ value: mockSelectedTags })

      const tags = screen.getAllByTestId('tag-badge')
      expect(tags).toHaveLength(2)
    })

    it('displays no badges when no tags selected', () => {
      renderTagsInput({ value: [] })

      const tags = screen.queryAllByTestId('tag-badge')
      expect(tags).toHaveLength(0)
    })
  })

  describe('Tag Removal', () => {
    it('calls onChange without removed tag when X is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: mockSelectedTags, onChange: handleChange })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      const removeButton = productionBadge?.querySelector('[data-remove-tag]') as HTMLElement

      await user.click(removeButton)

      expect(handleChange).toHaveBeenCalledWith(['database'])
    })

    it('remove button has accessible label', () => {
      renderTagsInput({ value: mockSelectedTags })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      const removeButton = productionBadge?.querySelector('[data-remove-tag]')

      expect(removeButton).toHaveAttribute('aria-label', expect.stringMatching(/remove.*production/i))
    })

    it('remove button has X icon', () => {
      renderTagsInput({ value: mockSelectedTags })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      const removeButton = productionBadge?.querySelector('[data-remove-tag]')

      expect(removeButton?.querySelector('[data-lucide="x"]')).toBeInTheDocument()
    })

    it('prevents event propagation when removing tag', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: mockSelectedTags, onChange: handleChange })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      const removeButton = productionBadge?.querySelector('[data-remove-tag]') as HTMLElement

      await user.click(removeButton)

      // Should not open the popover
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('removes tag when Enter key is pressed on remove button', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: mockSelectedTags, onChange: handleChange })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      const removeButton = productionBadge?.querySelector('[data-remove-tag]') as HTMLElement

      removeButton.focus()
      await user.keyboard('{Enter}')

      expect(handleChange).toHaveBeenCalledWith(['database'])
    })

    it('removes tag when Space key is pressed on remove button', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: mockSelectedTags, onChange: handleChange })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      const removeButton = productionBadge?.querySelector('[data-remove-tag]') as HTMLElement

      removeButton.focus()
      await user.keyboard(' ')

      expect(handleChange).toHaveBeenCalledWith(['database'])
    })
  })

  describe('Dropdown/Popover', () => {
    it('opens popover on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('popover shows available tags', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))

      mockAvailableTags.forEach((tag) => {
        expect(screen.getByRole('option', { name: tag })).toBeInTheDocument()
      })
    })

    it('popover has search input', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))

      expect(screen.getByPlaceholderText(/Search tags/i)).toBeInTheDocument()
    })

    it('selected tags are marked in popover', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // 'database' is chosen and is not the first row, where cmdk parks its cursor.
      renderTagsInput({ value: ['database'] })
      await user.click(screen.getByTestId('tags-trigger'))

      const databaseOption = screen.getByRole('option', { name: 'database' })
      expect(databaseOption).toHaveAttribute('aria-checked', 'true')
      expect(databaseOption).toHaveAttribute('data-state', 'checked')

      const stagingOption = screen.getByRole('option', { name: 'staging' })
      expect(stagingOption).toHaveAttribute('aria-checked', 'false')
      expect(stagingOption).toHaveAttribute('data-state', 'unchecked')
    })

    it('closes popover on outside click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const { container } = renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      await user.click(container)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('closes popover on Escape', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('Tag Selection', () => {
    it('adds tag when clicked in dropdown', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: [], onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.click(screen.getByRole('option', { name: 'production' }))

      expect(handleChange).toHaveBeenCalledWith(['production'])
    })

    it('removes tag when clicking already selected tag', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: mockSelectedTags, onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.click(screen.getByRole('option', { name: 'production' }))

      expect(handleChange).toHaveBeenCalledWith(['database'])
    })

    it('can select multiple tags', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: ['production'], onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.click(screen.getByRole('option', { name: 'staging' }))

      expect(handleChange).toHaveBeenCalledWith(['production', 'staging'])
    })

    it('selected tags show checkmark', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput({ value: mockSelectedTags })
      await user.click(screen.getByTestId('tags-trigger'))

      const productionOption = screen.getByRole('option', { name: 'production' })
      expect(within(productionOption).getByTestId('check-icon')).toBeInTheDocument()
    })
  })

  describe('Search/Filter', () => {
    it('filters available tags based on search input', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'prod')

      expect(screen.getByRole('option', { name: 'production' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'staging' })).not.toBeInTheDocument()
    })

    it('search is case-insensitive', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'PROD')

      expect(screen.getByRole('option', { name: 'production' })).toBeInTheDocument()
    })

    it('shows the type-to-create empty-state when search has no results', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'nonexistent')

      expect(
        screen.getByText(/type a tag name to search or create a new one/i),
      ).toBeInTheDocument()
    })

    it('clears search when popover closes', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'prod')
      await user.keyboard('{Escape}')

      // Reopen popover
      await user.click(screen.getByTestId('tags-trigger'))

      expect(screen.getByPlaceholderText(/Search tags/i)).toHaveValue('')
      expect(screen.getByRole('option', { name: 'staging' })).toBeInTheDocument()
    })
  })

  describe('Create New Tag', () => {
    it('shows "Create tag" option when search does not match existing tag', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'newtag')

      expect(screen.getByText(/Create "newtag"/i)).toBeInTheDocument()
    })

    it('does not show "Create tag" when search matches existing tag', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'production')

      expect(screen.queryByText(/Create "production"/i)).not.toBeInTheDocument()
    })

    it('creates new tag when "Create" option is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: [], onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'newtag')
      await user.click(screen.getByText(/Create "newtag"/i))

      expect(handleChange).toHaveBeenCalledWith(['newtag'])
    })

    it('creates new tag with Enter key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: [], onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'newtag{Enter}')

      expect(handleChange).toHaveBeenCalledWith(['newtag'])
    })

    it('trims whitespace from new tag', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: [], onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), '  newtag  {Enter}')

      expect(handleChange).toHaveBeenCalledWith(['newtag'])
    })

    it('does not create empty tag', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: [], onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), '   {Enter}')

      expect(handleChange).not.toHaveBeenCalled()
    })

    it('does not create duplicate tag', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: ['existing'], onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'existing{Enter}')

      // Should toggle off instead of adding duplicate
      expect(handleChange).toHaveBeenCalledWith([])
    })
  })

  describe('Keyboard Navigation', () => {
    it('opens popover with Enter key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      const combobox = screen.getByTestId('tags-trigger')
      combobox.focus()
      await user.keyboard('{Enter}')

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('opens popover with Space key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      const combobox = screen.getByTestId('tags-trigger')
      combobox.focus()
      await user.keyboard(' ')

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('navigates options with arrow keys', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      await expectCursorOnFirstOption()
      await user.keyboard('{ArrowDown}')

      const options = screen.getAllByRole('option')
      expect(options[1]).toHaveAttribute('aria-selected', 'true')
      expect(options[0]).toHaveAttribute('aria-selected', 'false')
    })

    it('navigates up with ArrowUp key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      await expectCursorOnFirstOption()
      // Move down twice, then up once
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')

      // Second option after going down 2, up 1 from the first
      const options = screen.getAllByRole('option')
      expect(options[1]).toHaveAttribute('aria-selected', 'true')
      expect(options[2]).toHaveAttribute('aria-selected', 'false')
    })

    it('does not navigate above first option with ArrowUp', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      await expectCursorOnFirstOption()
      await user.keyboard('{ArrowDown}')
      expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

      // Up twice from the second option: the first one is the floor
      await user.keyboard('{ArrowUp}{ArrowUp}')

      const options = screen.getAllByRole('option')
      expect(options[0]).toHaveAttribute('aria-selected', 'true')
      expect(options[1]).toHaveAttribute('aria-selected', 'false')
    })

    it('does not navigate below last option with ArrowDown', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // Use a filtered list with only 2 tags for easier testing
      renderTagsInput({ availableTags: ['tag1', 'tag2'] })
      await user.click(screen.getByTestId('tags-trigger'))
      await expectCursorOnFirstOption()
      // Move down 3 times (only 2 items, should stop at last)
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')

      // Should stay on last option (index 1)
      const options = screen.getAllByRole('option')
      expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true')
      expect(options[0]).toHaveAttribute('aria-selected', 'false')
    })

    it('selects highlighted option with Enter', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: [], onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.keyboard('{ArrowDown}{Enter}')

      expect(handleChange).toHaveBeenCalled()
    })

    it('removes last tag with Backspace when search is empty', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: mockSelectedTags, onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.keyboard('{Backspace}')

      expect(handleChange).toHaveBeenCalledWith(['production'])
    })

    it('does not remove tag with Backspace when search has content', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: mockSelectedTags, onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'test')
      await user.keyboard('{Backspace}')

      // Should only modify search, not remove tag
      expect(handleChange).not.toHaveBeenCalled()
    })
  })

  describe('Disabled State', () => {
    it('combobox is disabled when disabled prop is true', () => {
      renderTagsInput({ disabled: true })
      expect(screen.getByTestId('tags-trigger')).toHaveAttribute('aria-disabled', 'true')
    })

    it('remove buttons are disabled when disabled', () => {
      renderTagsInput({ value: mockSelectedTags, disabled: true })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      const removeButton = productionBadge?.querySelector('[data-remove-tag]')

      // span with role="button" uses aria-disabled instead of disabled attribute
      expect(removeButton).toHaveAttribute('aria-disabled', 'true')
    })

    it('popover does not open when disabled', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput({ disabled: true })
      await user.click(screen.getByTestId('tags-trigger'))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('has visual disabled styling', () => {
      renderTagsInput({ disabled: true })
      const container = screen.getByTestId('tags-input')
      expect(container).toHaveClass('opacity-50')
    })
  })

  describe('Empty Available Tags', () => {
    it('shows the type-to-create empty-state when availableTags is empty', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput({ availableTags: [] })
      await user.click(screen.getByTestId('tags-trigger'))

      expect(
        screen.getByText(/type a tag name to search or create a new one/i),
      ).toBeInTheDocument()
    })

    it('still allows creating new tags when availableTags is empty', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ availableTags: [], value: [], onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.type(screen.getByPlaceholderText(/Search tags/i), 'newtag{Enter}')

      expect(handleChange).toHaveBeenCalledWith(['newtag'])
    })
  })

  describe('Accessibility', () => {
    it('trigger has aria-haspopup', () => {
      renderTagsInput()
      expect(screen.getByTestId('tags-trigger')).toHaveAttribute('aria-haspopup', 'listbox')
    })

    it('trigger has aria-expanded when open', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      const trigger = screen.getByTestId('tags-trigger')

      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      await user.click(trigger)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    it('options have role="option"', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))

      const options = screen.getAllByRole('option')
      expect(options.length).toBeGreaterThan(0)
    })

    it('cmdk supplies the listbox role and the list declares no aria-multiselectable', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))

      const list = screen.getByRole('listbox')
      expect(list).toHaveAttribute('role', 'listbox')
      expect(list).not.toHaveAttribute('aria-multiselectable')
    })

    it('tag badges are rendered as badges', () => {
      renderTagsInput({ value: mockSelectedTags })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      expect(productionBadge).toHaveAttribute('data-testid', 'tag-badge')
    })

    it('has accessible label', () => {
      renderTagsInput()
      expect(screen.getByTestId('tags-trigger')).toHaveAccessibleName()
    })

    it('disabled state is announced', () => {
      renderTagsInput({ disabled: true })
      expect(screen.getByTestId('tags-trigger')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      const { container } = renderTagsInput({ className: 'custom-tags' })
      expect(container.querySelector('.custom-tags')).toBeInTheDocument()
    })
  })

  describe('Read Only State', () => {
    it('combobox is not interactive when readOnly', () => {
      renderTagsInput({ value: mockSelectedTags, readOnly: true })
      // readOnly state is handled by the handleOpenChange guard, not via aria-readonly
      // (aria-readonly is not supported on div elements without button role)
      const container = screen.getByTestId('tags-input')
      expect(container).toHaveClass('cursor-default')
    })

    it('shows selected tags but cannot open popover when readOnly', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput({ value: mockSelectedTags, readOnly: true })

      // Tags should be visible
      expect(screen.getByText('production')).toBeInTheDocument()

      // Popover should not open
      await user.click(screen.getByTestId('tags-trigger'))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('remove buttons are hidden when readOnly', () => {
      renderTagsInput({ value: mockSelectedTags, readOnly: true })

      const productionBadge = screen.getByText('production').closest('[data-tag]')
      expect(productionBadge?.querySelector('[data-remove-tag]')).not.toBeInTheDocument()
    })

    it('has different visual styling when readOnly', () => {
      renderTagsInput({ value: mockSelectedTags, readOnly: true })
      const container = screen.getByTestId('tags-input')
      expect(container).toHaveClass('cursor-default')
    })
  })

  describe('Error State', () => {
    it('shows error styling when error prop is true', () => {
      renderTagsInput({ error: true })
      const container = screen.getByTestId('tags-input')
      expect(container).toHaveClass('border-error')
    })

    it('combobox shows error styling when error', () => {
      renderTagsInput({ error: true })
      // aria-invalid is not supported on div elements without button role;
      // error state is conveyed through visual styling (border-destructive class)
      expect(screen.getByTestId('tags-trigger')).toHaveClass('border-destructive')
    })

    it('shows error message when provided', () => {
      renderTagsInput({ error: true, errorMessage: 'At least one tag is required' })
      expect(screen.getByText('At least one tag is required')).toBeInTheDocument()
    })

    it('error message has error styling', () => {
      renderTagsInput({ error: true, errorMessage: 'Error' })
      const errorMessage = screen.getByTestId('error-message')
      expect(errorMessage).toHaveClass('text-error')
    })

    it('clears error styling when error is false', () => {
      const { rerender } = render(
        <TagsInput
          value={[]}
          availableTags={mockAvailableTags}
          onChange={vi.fn()}
          error={true}
        />
      )

      expect(screen.getByTestId('tags-input')).toHaveClass('border-error')

      rerender(
        <TagsInput
          value={[]}
          availableTags={mockAvailableTags}
          onChange={vi.fn()}
          error={false}
        />
      )

      expect(screen.getByTestId('tags-input')).not.toHaveClass('border-error')
    })
  })

  describe('Tag Validation', () => {
    it('shows error for tag exceeding max length', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput({ maxTagLength: 20 })
      await user.click(screen.getByTestId('tags-trigger'))

      const longTag = 'a'.repeat(25)
      await user.type(screen.getByPlaceholderText(/Search tags/i), longTag)

      expect(screen.getByText(/Tag must not exceed 20 characters/i)).toBeInTheDocument()
    })

    it('does not allow creating tag exceeding max length', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: [], onChange: handleChange, maxTagLength: 20 })
      await user.click(screen.getByTestId('tags-trigger'))

      const longTag = 'a'.repeat(25)
      await user.type(screen.getByPlaceholderText(/Search tags/i), `${longTag}{Enter}`)

      expect(handleChange).not.toHaveBeenCalled()
    })

    it('allows creating tag within max length', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: [], onChange: handleChange, maxTagLength: 20 })
      await user.click(screen.getByTestId('tags-trigger'))

      const validTag = 'validtag'
      await user.type(screen.getByPlaceholderText(/Search tags/i), `${validTag}{Enter}`)

      expect(handleChange).toHaveBeenCalledWith(['validtag'])
    })
  })

  describe('Max Tags Limit', () => {
    it('disables adding more tags when maxTags is reached', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput({ value: ['tag1', 'tag2', 'tag3'], maxTags: 3 })
      await user.click(screen.getByTestId('tags-trigger'))

      expect(screen.getByText(/Maximum 3 tags reached/i)).toBeInTheDocument()
    })

    it('does not call onChange when maxTags is reached', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: ['tag1', 'tag2', 'tag3'], maxTags: 3, onChange: handleChange })
      await user.click(screen.getByTestId('tags-trigger'))
      await user.click(screen.getByRole('option', { name: 'production' }))

      // Should not add new tag, but clicking existing can still toggle
      // Actually, since all slots are used, new tags should not be addable
      expect(handleChange).not.toHaveBeenCalledWith(expect.arrayContaining(['production']))
    })

    it('allows removing tags when at maxTags limit', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleChange = vi.fn()

      renderTagsInput({ value: ['tag1', 'tag2', 'tag3'], maxTags: 3, onChange: handleChange })

      const tag1Badge = screen.getByText('tag1').closest('[data-tag]')
      const removeButton = tag1Badge?.querySelector('[data-remove-tag]') as HTMLElement

      await user.click(removeButton)

      expect(handleChange).toHaveBeenCalledWith(['tag2', 'tag3'])
    })
  })

  describe('Chosen State ARIA', () => {
    it('chosen tags are exposed as checked and unchosen as unchecked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // 'database' is deliberately not the first row: the first row is where
      // cmdk parks its cursor, so a first-row fixture cannot tell them apart.
      renderTagsInput({ value: ['database'] })
      await user.click(screen.getByTestId('tags-trigger'))

      expect(screen.getByRole('option', { name: 'database' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('option', { name: 'database' })).toHaveAttribute('data-state', 'checked')
      expect(screen.getByRole('option', { name: 'production' })).toHaveAttribute('aria-checked', 'false')
      expect(screen.getByRole('option', { name: 'production' })).toHaveAttribute('data-state', 'unchecked')
      expect(screen.getByRole('option', { name: 'staging' })).toHaveAttribute('aria-checked', 'false')
    })

    it('every chosen tag is checked when several are chosen', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput({ value: mockSelectedTags })
      await user.click(screen.getByTestId('tags-trigger'))

      expect(screen.getByRole('option', { name: 'production' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('option', { name: 'database' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('option', { name: 'staging' })).toHaveAttribute('aria-checked', 'false')
    })

    it('the checked marker follows the chosen tag, not the keyboard cursor', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput({ value: ['database'] })
      await user.click(screen.getByTestId('tags-trigger'))

      const cursorRows = () =>
        screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')

      await waitFor(() => expect(cursorRows()).toHaveLength(1))
      await user.keyboard('{ArrowDown}')

      expect(cursorRows()).toHaveLength(1)
      expect(cursorRows()[0]).not.toHaveAccessibleName('database')
      expect(cursorRows()[0]).toHaveAttribute('aria-checked', 'false')

      expect(screen.getByRole('option', { name: 'database' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('option', { name: 'database' })).toHaveAttribute('data-state', 'checked')
    })

    it('the visible check and aria-checked always agree', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput({ value: ['database'] })
      await user.click(screen.getByTestId('tags-trigger'))

      const pairs = screen
        .getAllByRole('option')
        .map((o) => [
          o.getAttribute('aria-checked'),
          within(o).queryByTestId('check-icon') !== null ? 'true' : 'false',
        ])

      expect(pairs.length).toBeGreaterThan(1)
      for (const [ariaChecked, hasCheck] of pairs) {
        expect(ariaChecked).toBe(hasCheck)
      }
    })

    it('the check icon still marks the chosen tag and no other', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput({ value: ['database'] })
      await user.click(screen.getByTestId('tags-trigger'))

      expect(
        within(screen.getByRole('option', { name: 'database' })).getByTestId('check-icon')
      ).toBeInTheDocument()
      expect(
        within(screen.getByRole('option', { name: 'production' })).queryByTestId('check-icon')
      ).not.toBeInTheDocument()
    })

    it('the trigger never points aria-controls at a missing element', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderTagsInput()
      await user.click(screen.getByTestId('tags-trigger'))
      expect(screen.getByRole('listbox')).toBeInTheDocument()

      const controls = screen.getByTestId('tags-trigger').getAttribute('aria-controls')
      const target = controls === null ? null : document.getElementById(controls)
      const reference = controls === null ? 'absent' : target === null ? 'dangling' : 'resolves'

      expect(reference).not.toBe('dangling')
    })
  })
})
