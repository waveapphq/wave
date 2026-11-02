/**
 * EnvironmentRowActions Component Tests
 *
 * REQ-5.2.1.42: Settings and preferences screen - Environment row actions
 *
 * Tests for EnvironmentRowActions component per design decisions:
 * - SETTINGS-11: Actions: Edit (✎) + kebab (Duplicate, Delete)
 * - SETTINGS-12: Delete of an in-use environment asks to type its name
 *
 * Component: frontend/src/components/settings/environment-row-actions.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  EnvironmentRowActions,
  type EnvironmentRowActionsProps,
} from '@/features/settings/components/environment-row-actions'

// ============================================================================
// Test Utilities
// ============================================================================

function renderEnvironmentRowActions(props: Partial<EnvironmentRowActionsProps> = {}) {
  const defaultProps: EnvironmentRowActionsProps = {
    environmentId: 'env-1',
    environmentName: 'Production',
    usage: 5,
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    ...props,
  }
  return render(<EnvironmentRowActions {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('EnvironmentRowActions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('Structure', () => {
    it('renders actions container with correct testid', () => {
      renderEnvironmentRowActions()
      expect(screen.getByTestId('environment-row-actions')).toBeInTheDocument()
    })

    it('renders Edit button', () => {
      renderEnvironmentRowActions()
      expect(screen.getByTestId('action-edit')).toBeInTheDocument()
    })

    it('renders kebab menu trigger', () => {
      renderEnvironmentRowActions()
      expect(screen.getByTestId('action-menu-trigger')).toBeInTheDocument()
    })

    it('Edit button has pencil icon', () => {
      renderEnvironmentRowActions()
      const editButton = screen.getByTestId('action-edit')
      expect(editButton.querySelector('[data-testid="icon-pencil"]')).toBeInTheDocument()
    })

    it('kebab menu has more-vertical icon', () => {
      renderEnvironmentRowActions()
      const menuTrigger = screen.getByTestId('action-menu-trigger')
      expect(menuTrigger.querySelector('[data-testid="icon-more-vertical"]')).toBeInTheDocument()
    })
  })

  describe('Edit Action (SETTINGS-11)', () => {
    it('Edit button is always visible', () => {
      renderEnvironmentRowActions()
      expect(screen.getByTestId('action-edit')).toBeVisible()
    })

    it('Edit button is always enabled', () => {
      renderEnvironmentRowActions()
      expect(screen.getByTestId('action-edit')).toBeEnabled()
    })

    it('calls onEdit with environment ID when clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEdit = vi.fn()

      renderEnvironmentRowActions({ environmentId: 'env-123', onEdit: handleEdit })
      await user.click(screen.getByTestId('action-edit'))

      expect(handleEdit).toHaveBeenCalledWith('env-123')
    })

    it('Edit button has accessible aria-label', () => {
      renderEnvironmentRowActions({ environmentName: 'Production' })
      const editButton = screen.getByTestId('action-edit')
      expect(editButton).toHaveAttribute('aria-label', 'Edit Production')
    })

    it('Edit button has type="button"', () => {
      renderEnvironmentRowActions()
      expect(screen.getByTestId('action-edit')).toHaveAttribute('type', 'button')
    })
  })

  describe('Kebab Menu', () => {
    it('menu is closed by default', () => {
      renderEnvironmentRowActions()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('opens menu when trigger is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menu')).toBeVisible()
    })

    it('menu contains Duplicate option', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeVisible()
    })

    it('menu contains Delete option', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeVisible()
    })

    it('menu items are in correct order', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const menuItems = screen.getAllByRole('menuitem')
      expect(menuItems[0]).toHaveTextContent(/Duplicate/i)
      expect(menuItems[1]).toHaveTextContent(/Delete/i)
    })

    it('closes menu when clicking outside', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))
      expect(screen.getByRole('menu')).toBeVisible()

      await user.click(document.body)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes menu when pressing Escape', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))
      expect(screen.getByRole('menu')).toBeVisible()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes menu after selecting an option', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('Duplicate Action', () => {
    it('Duplicate is always enabled', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions({ usage: 10 })
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).not.toHaveAttribute(
        'aria-disabled'
      )
    })

    it('calls onDuplicate with environment ID when clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicate = vi.fn()

      renderEnvironmentRowActions({ environmentId: 'env-456', onDuplicate: handleDuplicate })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(handleDuplicate).toHaveBeenCalledWith('env-456')
    })

    it('Duplicate has copy icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const duplicateItem = screen.getByRole('menuitem', { name: /Duplicate/i })
      expect(duplicateItem.querySelector('[data-testid="icon-copy"]')).toBeInTheDocument()
    })
  })

  describe('Delete Action (SETTINGS-11)', () => {
    it('Delete is enabled regardless of Usage (caller surfaces confirmation)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions({ usage: 5 })
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Delete/i })).not.toHaveAttribute('aria-disabled')
    })

    it('calls onDelete when clicked with Usage = 0', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDelete = vi.fn()

      renderEnvironmentRowActions({ environmentId: 'env-789', usage: 0, onDelete: handleDelete })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDelete).toHaveBeenCalledWith('env-789')
    })

    it('calls onDelete when clicked with Usage > 0 (caller shows confirmation modal)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDelete = vi.fn()

      renderEnvironmentRowActions({ environmentId: 'env-789', usage: 3, onDelete: handleDelete })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDelete).toHaveBeenCalledWith('env-789')
    })

    it('Delete has trash icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem.querySelector('[data-testid="icon-trash"]')).toBeInTheDocument()
    })

    it('Delete has destructive/red styling', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions({ usage: 0 })
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem).toHaveClass('text-error')
    })
  })

  describe('Export Action', () => {
    it('shows Export option when onExport is provided', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions({ onExport: vi.fn() })
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument()
    })

    it('does not show Export option when onExport is not provided', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.queryByRole('menuitem', { name: /Export/i })).not.toBeInTheDocument()
    })

    it('calls onExport with environment ID when clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleExport = vi.fn()

      renderEnvironmentRowActions({ environmentId: 'env-export', onExport: handleExport })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      expect(handleExport).toHaveBeenCalledWith('env-export')
    })
  })

  describe('Keyboard Navigation', () => {
    it('Edit button is focusable', () => {
      renderEnvironmentRowActions()
      const editButton = screen.getByTestId('action-edit')
      editButton.focus()
      expect(editButton).toHaveFocus()
    })

    it('kebab trigger is focusable', () => {
      renderEnvironmentRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')
      trigger.focus()
      expect(trigger).toHaveFocus()
    })

    it('Enter opens kebab menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      screen.getByTestId('action-menu-trigger').focus()
      await user.keyboard('{Enter}')

      expect(screen.getByRole('menu')).toBeVisible()
    })

    it('Space opens kebab menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      screen.getByTestId('action-menu-trigger').focus()
      await user.keyboard(' ')

      expect(screen.getByRole('menu')).toBeVisible()
    })

    it('Arrow keys navigate menu items', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toHaveFocus()

      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toHaveFocus()
    })

    it('Enter activates focused menu item', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicate = vi.fn()

      renderEnvironmentRowActions({ onDuplicate: handleDuplicate })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.keyboard('{ArrowDown}{Enter}')

      expect(handleDuplicate).toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    it('kebab trigger has aria-haspopup', () => {
      renderEnvironmentRowActions()
      expect(screen.getByTestId('action-menu-trigger')).toHaveAttribute('aria-haspopup', 'menu')
    })

    it('kebab trigger has aria-expanded when menu is open', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      await user.click(trigger)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    it('menu has correct role', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('menu items have correct role', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    })

    it('Delete menu item is enabled (caller surfaces the confirmation flow)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentRowActions({ usage: 3 })
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Delete/i })).not.toHaveAttribute('aria-disabled')
    })
  })

  describe('Event Propagation', () => {
    it('Edit click does not propagate to row', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRowClick = vi.fn()
      const handleEdit = vi.fn()

      render(
        <div onClick={handleRowClick} data-testid="row-container">
          <EnvironmentRowActions
            environmentId="env-1"
            environmentName="Test"
            usage={0}
            onEdit={handleEdit}
            onDuplicate={vi.fn()}
            onDelete={vi.fn()}
          />
        </div>
      )

      await user.click(screen.getByTestId('action-edit'))

      expect(handleEdit).toHaveBeenCalled()
      expect(handleRowClick).not.toHaveBeenCalled()
    })

    it('menu trigger click does not propagate to row', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRowClick = vi.fn()

      render(
        <div onClick={handleRowClick} data-testid="row-container">
          <EnvironmentRowActions
            environmentId="env-1"
            environmentName="Test"
            usage={0}
            onEdit={vi.fn()}
            onDuplicate={vi.fn()}
            onDelete={vi.fn()}
          />
        </div>
      )

      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(handleRowClick).not.toHaveBeenCalled()
    })
  })

  describe('Layout', () => {
    it('actions are arranged horizontally', () => {
      renderEnvironmentRowActions()
      const container = screen.getByTestId('environment-row-actions')
      expect(container).toHaveClass('flex')
    })

    it('actions have consistent spacing', () => {
      renderEnvironmentRowActions()
      const container = screen.getByTestId('environment-row-actions')
      expect(container).toHaveClass('gap-1')
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      const { container } = renderEnvironmentRowActions({ className: 'custom-actions' })
      expect(container.querySelector('.custom-actions')).toBeInTheDocument()
    })
  })
})
