/**
 * ProfilesRowActions Component Tests
 *
 * REQ-4.7.4: Profile management UI
 *
 * V-PROF-01: Profiles list with row actions
 *
 * Tests for ProfilesRowActions component per design specification:
 * - Edit button (pencil icon) as primary action
 * - Kebab menu with Duplicate and Delete options
 * - Delete disabled when profile is in use (usage > 0)
 * - No Run action (profiles are configuration, not executable)
 *
 * Component: frontend/src/components/profiles/profiles-row-actions.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProfilesRowActions, type ProfilesRowActionsProps } from '@/features/profiles/components/profiles-row-actions'

// ============================================================================
// Mock Data
// ============================================================================

const mockProfileNoUsage = {
  id: 'profile-1',
  name: 'Development HTTP',
  type: 'http',
  usage: 0,
}

const mockProfileWithUsage = {
  id: 'profile-2',
  name: 'Production Database',
  type: 'database',
  usage: 5,
}

// ============================================================================
// Test Utilities
// ============================================================================

function renderRowActions(props: Partial<ProfilesRowActionsProps> = {}) {
  const defaultProps: ProfilesRowActionsProps = {
    profile: mockProfileNoUsage,
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    ...props,
  }
  return render(<ProfilesRowActions {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('ProfilesRowActions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('Edit Action', () => {
    it('renders edit button', () => {
      renderRowActions()
      expect(screen.getByTestId('action-edit')).toBeInTheDocument()
    })

    it('edit button is visible', () => {
      renderRowActions()
      expect(screen.getByTestId('action-edit')).toBeVisible()
    })

    it('edit button has pencil icon', () => {
      renderRowActions()
      const editButton = screen.getByTestId('action-edit')
      expect(editButton.querySelector('[data-lucide="pencil"]')).toBeInTheDocument()
    })

    it('edit button has accessible label', () => {
      renderRowActions()
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })

    it('calls onEdit with profile id when clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEdit = vi.fn()

      renderRowActions({ onEdit: handleEdit })
      await user.click(screen.getByTestId('action-edit'))

      expect(handleEdit).toHaveBeenCalledWith('profile-1')
    })

    it('edit button is always enabled (regardless of usage)', () => {
      renderRowActions({ profile: mockProfileWithUsage })
      expect(screen.getByTestId('action-edit')).toBeEnabled()
    })
  })

  describe('Run Action - NOT Present', () => {
    it('does NOT render run button (profiles are not executable)', () => {
      renderRowActions()
      expect(screen.queryByTestId('action-run')).not.toBeInTheDocument()
    })
  })

  describe('Menu Trigger', () => {
    it('renders menu trigger button', () => {
      renderRowActions()
      expect(screen.getByTestId('action-menu-trigger')).toBeInTheDocument()
    })

    it('menu trigger is visible', () => {
      renderRowActions()
      expect(screen.getByTestId('action-menu-trigger')).toBeVisible()
    })

    it('menu trigger has kebab/more icon', () => {
      renderRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')
      expect(trigger.querySelector('[data-lucide="more-vertical"]')).toBeInTheDocument()
    })

    it('menu trigger has accessible label', () => {
      renderRowActions()
      expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument()
    })

    it('opens menu on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menu')).toBeVisible()
    })
  })

  describe('Menu Items', () => {
    it('menu contains Duplicate option', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })

    it('menu contains Delete option', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })

    it('menu does NOT contain Edit option (Edit is separate button)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.queryByRole('menuitem', { name: /^Edit$/i })).not.toBeInTheDocument()
    })

    it('menu does NOT contain Run option (profiles are not executable)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.queryByRole('menuitem', { name: /Run/i })).not.toBeInTheDocument()
    })
  })

  describe('Duplicate Action', () => {
    it('Duplicate is always enabled', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ profile: mockProfileWithUsage })
      await user.click(screen.getByTestId('action-menu-trigger'))

      const duplicateItem = screen.getByRole('menuitem', { name: /Duplicate/i })
      expect(duplicateItem).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('calls onDuplicate with profile id when clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicate = vi.fn()

      renderRowActions({ onDuplicate: handleDuplicate })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(handleDuplicate).toHaveBeenCalledWith('profile-1')
    })

    it('Duplicate has copy icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const duplicateItem = screen.getByRole('menuitem', { name: /Duplicate/i })
      expect(duplicateItem.querySelector('[data-lucide="copy"]')).toBeInTheDocument()
    })
  })

  describe('Delete Action - Enabled (usage = 0)', () => {
    it('Delete is enabled when profile has no usage', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ profile: mockProfileNoUsage })
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('calls onDelete with profile id when clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDelete = vi.fn()

      renderRowActions({ profile: mockProfileNoUsage, onDelete: handleDelete })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDelete).toHaveBeenCalledWith('profile-1')
    })

    it('Delete has trash icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem.querySelector('[data-lucide="trash-2"]')).toBeInTheDocument()
    })

    it('Delete has destructive styling', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem).toHaveClass('text-error')
    })
  })

  describe('Delete Action - Disabled (usage > 0)', () => {
    it('Delete is disabled when profile has usage > 0', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ profile: mockProfileWithUsage })
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem).toHaveAttribute('aria-disabled', 'true')
    })

    it('does NOT call onDelete when disabled Delete is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDelete = vi.fn()

      renderRowActions({ profile: mockProfileWithUsage, onDelete: handleDelete })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDelete).not.toHaveBeenCalled()
    })

    it('disabled Delete has tooltip explaining why', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ profile: mockProfileWithUsage })
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      // SHELL-7a: the reason comes from the shared tooltip, not a browser popup.
      expect(deleteItem).not.toHaveAttribute('title')
      fireEvent.focus(deleteItem.querySelector('.inline-flex') as HTMLElement)
      expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toMatch(
        /in use|referenced|cannot delete/i,
      )
    })

    it('disabled Delete shows usage count in tooltip', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ profile: mockProfileWithUsage }) // usage = 5
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      // SHELL-7a: the reason comes from the shared tooltip, not a browser popup.
      expect(deleteItem).not.toHaveAttribute('title')
      fireEvent.focus(deleteItem.querySelector('.inline-flex') as HTMLElement)
      expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toMatch(
        /5 test/i,
      )
    })

    it('disabled Delete has different visual styling', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ profile: mockProfileWithUsage })
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem).toHaveClass('opacity-50')
    })
  })

  describe('Keyboard Navigation', () => {
    it('menu can be opened with Enter key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')
      trigger.focus()
      await user.keyboard('{Enter}')

      expect(screen.getByRole('menu')).toBeVisible()
    })

    it('menu can be opened with Space key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')
      trigger.focus()
      await user.keyboard(' ')

      expect(screen.getByRole('menu')).toBeVisible()
    })

    it('menu can be closed with Escape key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))
      expect(screen.getByRole('menu')).toBeVisible()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('menu items can be navigated with arrow keys', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toHaveFocus()

      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toHaveFocus()
    })

    it('menu item can be selected with Enter key', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicate = vi.fn()

      renderRowActions({ onDuplicate: handleDuplicate })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.keyboard('{ArrowDown}') // Focus Duplicate
      await user.keyboard('{Enter}')

      expect(handleDuplicate).toHaveBeenCalledWith('profile-1')
    })
  })

  describe('Menu Closure', () => {
    it('menu closes after selecting an action', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('menu closes when clicking outside', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const { container } = renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))
      expect(screen.getByRole('menu')).toBeVisible()

      await user.click(container)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('edit button has aria-label', () => {
      renderRowActions()
      const editButton = screen.getByTestId('action-edit')
      expect(editButton).toHaveAttribute('aria-label')
    })

    it('menu trigger has aria-haspopup', () => {
      renderRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    })

    it('menu trigger has aria-expanded when menu is open', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')

      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      await user.click(trigger)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    it('menu items have role="menuitem"', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const menuItems = screen.getAllByRole('menuitem')
      expect(menuItems).toHaveLength(2) // Duplicate, Delete
    })

    it('disabled menu item has aria-disabled', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ profile: mockProfileWithUsage })
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Export Action', () => {
    it('shows Export option when onExport is provided', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ onExport: vi.fn() })
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument()
    })

    it('does not show Export option when onExport is not provided', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.queryByRole('menuitem', { name: /Export/i })).not.toBeInTheDocument()
    })

    it('calls onExport with profile id when clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleExport = vi.fn()

      renderRowActions({ onExport: handleExport })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      expect(handleExport).toHaveBeenCalledWith('profile-1')
    })
  })

  describe('Loading State', () => {
    it('edit button can be disabled during loading', () => {
      renderRowActions({ loading: true })
      expect(screen.getByTestId('action-edit')).toBeDisabled()
    })

    it('menu trigger can be disabled during loading', () => {
      renderRowActions({ loading: true })
      expect(screen.getByTestId('action-menu-trigger')).toBeDisabled()
    })
  })
})
