/**
 * EntityRowActions Component Tests
 *
 * Tests for the shared row-level actions component used across entity tables.
 * Covers: Run button (optional), overflow menu with Edit, Duplicate, Delete,
 * optional children for entity-specific menu items, accessibility, and keyboard nav.
 *
 * Component: frontend/src/components/shared/actions/entity-row-actions.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, act } from '@testing-library/react'
import {
  EntityRowActions,
  type EntityRowActionsProps,
} from '@/components/shared/actions/entity-row-actions'
import { DropdownItem } from '@/components/ui/dropdown'
import { Icon } from '@/components/ui/icon'
import { Download } from 'lucide-react'

// ============================================================================
// Test Utilities
// ============================================================================

function renderRowActions(props: Partial<EntityRowActionsProps> = {}) {
  const defaultProps: EntityRowActionsProps = {
    entityId: 'entity-1',
    entityName: 'Test Entity',
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    ...props,
  }
  return render(<EntityRowActions {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('EntityRowActions', () => {
  describe('Run Button', () => {
    it('renders Run button when onRun is provided', () => {
      renderRowActions({ onRun: vi.fn() })
      expect(screen.getByTestId('row-action-run')).toBeInTheDocument()
    })

    it('does not render Run button when onRun is not provided', () => {
      renderRowActions()
      expect(screen.queryByTestId('row-action-run')).not.toBeInTheDocument()
    })

    it('Run button is visible', () => {
      renderRowActions({ onRun: vi.fn() })
      expect(screen.getByTestId('row-action-run')).toBeVisible()
    })

    it('Run button has play icon', () => {
      renderRowActions({ onRun: vi.fn() })
      const button = screen.getByTestId('row-action-run')
      expect(button.querySelector('svg')).toBeInTheDocument()
    })

    it('Run button has accessible name using entity name', () => {
      renderRowActions({ entityName: 'My Entity', onRun: vi.fn() })
      expect(screen.getByRole('button', { name: /Run My Entity/i })).toBeInTheDocument()
    })

    it('Run button is enabled by default', () => {
      renderRowActions({ onRun: vi.fn() })
      expect(screen.getByTestId('row-action-run')).toBeEnabled()
    })

    it('clicking Run button calls onRun with entityId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRun = vi.fn()

      renderRowActions({ entityId: 'entity-123', onRun: handleRun })
      await user.click(screen.getByTestId('row-action-run'))

      expect(handleRun).toHaveBeenCalledWith('entity-123')
    })

    it('Run button can be disabled', () => {
      renderRowActions({ onRun: vi.fn(), runDisabled: true })
      expect(screen.getByTestId('row-action-run')).toBeDisabled()
    })

    it('disabled Run button explains why through the shared tooltip', () => {
      renderRowActions({
        onRun: vi.fn(),
        runDisabled: true,
        runDisabledReason: 'Entity is already running',
      })
      const button = screen.getByTestId('row-action-run')
      expect(button).not.toHaveAttribute('title')
      // A disabled button emits no pointer events, so the hint hangs off the
      // wrapper the shared tooltip triggers from.
      fireEvent.focus(button.parentElement as HTMLElement)
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        'Entity is already running',
      )
    })

    it('enabled Run button has no title attribute', () => {
      renderRowActions({ onRun: vi.fn(), runDisabled: false, runDisabledReason: 'Some reason' })
      expect(screen.getByTestId('row-action-run')).not.toHaveAttribute('title')
    })
  })

  describe('Overflow Menu Trigger', () => {
    it('renders menu trigger with correct testid', () => {
      renderRowActions()
      expect(screen.getByTestId('row-actions-menu')).toBeInTheDocument()
    })

    it('menu trigger is visible', () => {
      renderRowActions()
      expect(screen.getByTestId('row-actions-menu')).toBeVisible()
    })

    it('menu trigger has kebab/more icon', () => {
      renderRowActions()
      const trigger = screen.getByTestId('row-actions-menu')
      expect(trigger.querySelector('svg')).toBeInTheDocument()
    })

    it('menu trigger has accessible name using entity name', () => {
      renderRowActions({ entityName: 'My Entity' })
      expect(
        screen.getByRole('button', { name: /More actions for My Entity/i })
      ).toBeInTheDocument()
    })

    it('menu trigger has aria-haspopup', () => {
      renderRowActions()
      expect(screen.getByTestId('row-actions-menu')).toHaveAttribute(
        'aria-haspopup',
        'menu'
      )
    })
  })

  describe('Menu Opening', () => {
    it('clicking trigger opens menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('trigger has aria-expanded="true" when menu is open', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      const trigger = screen.getByTestId('row-actions-menu')

      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      await user.click(trigger)

      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    it('pressing Enter on trigger opens menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      const trigger = screen.getByTestId('row-actions-menu')
      trigger.focus()
      await user.keyboard('{Enter}')

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('pressing Space on trigger opens menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      const trigger = screen.getByTestId('row-actions-menu')
      trigger.focus()
      await user.keyboard(' ')

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
  })

  describe('Edit Action', () => {
    it('menu contains Edit action', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument()
    })

    it('Edit action has icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const editItem = screen.getByRole('menuitem', { name: /Edit/i })
      expect(editItem.querySelector('svg')).toBeInTheDocument()
    })

    it('clicking Edit calls onEdit with entityId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEdit = vi.fn()

      renderRowActions({ entityId: 'entity-456', onEdit: handleEdit })
      await user.click(screen.getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Edit/i }))

      expect(handleEdit).toHaveBeenCalledWith('entity-456')
    })

    it('clicking Edit closes menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Edit/i }))

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('Duplicate Action', () => {
    it('menu contains Duplicate action', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })

    it('Duplicate action has icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const duplicateItem = screen.getByRole('menuitem', { name: /Duplicate/i })
      expect(duplicateItem.querySelector('svg')).toBeInTheDocument()
    })

    it('clicking Duplicate calls onDuplicate with entityId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicate = vi.fn()

      renderRowActions({ entityId: 'entity-789', onDuplicate: handleDuplicate })
      await user.click(screen.getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(handleDuplicate).toHaveBeenCalledWith('entity-789')
    })

    it('clicking Duplicate closes menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('Delete Action', () => {
    it('menu contains Delete action', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })

    it('Delete action has icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem.querySelector('svg')).toBeInTheDocument()
    })

    it('Delete action has destructive/red styling', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem).toHaveClass('text-error')
    })

    it('clicking Delete calls onDelete with entityId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDelete = vi.fn()

      renderRowActions({ entityId: 'entity-abc', onDelete: handleDelete })
      await user.click(screen.getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDelete).toHaveBeenCalledWith('entity-abc')
    })

    it('clicking Delete closes menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('Delete is at the bottom of the menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const menuItems = screen.getAllByRole('menuitem')
      const deleteItem = menuItems[menuItems.length - 1]
      expect(deleteItem).toHaveTextContent(/Delete/i)
    })
  })

  describe('Menu Order', () => {
    it('actions are in correct order: Edit, Duplicate, separator, Delete', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const menuItems = screen.getAllByRole('menuitem')

      expect(menuItems[0]).toHaveTextContent(/Edit/i)
      expect(menuItems[1]).toHaveTextContent(/Duplicate/i)
      expect(menuItems[2]).toHaveTextContent(/Delete/i)
    })

    it('has separator before Delete', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      expect(screen.getByRole('separator')).toBeInTheDocument()
    })
  })

  describe('Children (Entity-Specific Menu Items)', () => {
    it('renders children between Duplicate and separator', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      render(
        <EntityRowActions
          entityId="e-1"
          entityName="Entity"
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDuplicate={vi.fn()}
        >
          <DropdownItem>
            <Icon icon={Download} size="sm" className="mr-2" />
            Export
          </DropdownItem>
        </EntityRowActions>
      )

      await user.click(screen.getByTestId('row-actions-menu'))

      const menuItems = screen.getAllByRole('menuitem')
      expect(menuItems).toHaveLength(4)
      expect(menuItems[0]).toHaveTextContent(/Edit/i)
      expect(menuItems[1]).toHaveTextContent(/Duplicate/i)
      expect(menuItems[2]).toHaveTextContent(/Export/i)
      expect(menuItems[3]).toHaveTextContent(/Delete/i)
    })

    it('children menu items are clickable', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleExport = vi.fn()

      render(
        <EntityRowActions
          entityId="e-1"
          entityName="Entity"
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDuplicate={vi.fn()}
        >
          <DropdownItem onSelect={handleExport}>Export</DropdownItem>
        </EntityRowActions>
      )

      await user.click(screen.getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      expect(handleExport).toHaveBeenCalled()
    })

    it('renders correctly without children', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const menuItems = screen.getAllByRole('menuitem')
      expect(menuItems).toHaveLength(3)
    })
  })

  describe('Menu Closing', () => {
    it('pressing Escape closes menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('clicking outside menu closes it', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const { container } = renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.click(container)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('Keyboard Navigation', () => {
    it('Arrow Down navigates to next menu item', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const editItem = screen.getByRole('menuitem', { name: /Edit/i })
      act(() => {
        editItem.focus()
      })

      await user.keyboard('{ArrowDown}')

      const duplicateItem = screen.getByRole('menuitem', { name: /Duplicate/i })
      expect(document.activeElement).toBe(duplicateItem)
    })

    it('Arrow Up navigates to previous menu item', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const duplicateItem = screen.getByRole('menuitem', { name: /Duplicate/i })
      act(() => {
        duplicateItem.focus()
      })

      await user.keyboard('{ArrowUp}')

      const editItem = screen.getByRole('menuitem', { name: /Edit/i })
      expect(document.activeElement).toBe(editItem)
    })

    it('Enter activates focused menu item', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEdit = vi.fn()

      renderRowActions({ onEdit: handleEdit })
      await user.click(screen.getByTestId('row-actions-menu'))

      const editItem = screen.getByRole('menuitem', { name: /Edit/i })
      act(() => {
        editItem.focus()
      })
      await user.keyboard('{Enter}')

      expect(handleEdit).toHaveBeenCalled()
    })
  })

  describe('Layout', () => {
    it('Run button and menu trigger are within the same actions container', () => {
      renderRowActions({ onRun: vi.fn() })

      const runButton = screen.getByTestId('row-action-run')
      const menuTrigger = screen.getByTestId('row-actions-menu')
      const container = screen.getByTestId('row-actions')

      expect(container).toContainElement(runButton)
      expect(container).toContainElement(menuTrigger)
    })

    it('menu trigger is within actions container even without Run button', () => {
      renderRowActions()

      const menuTrigger = screen.getByTestId('row-actions-menu')
      const container = screen.getByTestId('row-actions')

      expect(container).toContainElement(menuTrigger)
    })

    it('container has correct testid', () => {
      renderRowActions()
      expect(screen.getByTestId('row-actions')).toBeInTheDocument()
    })

    it('container has flex layout', () => {
      renderRowActions()
      expect(screen.getByTestId('row-actions')).toHaveClass('flex')
    })
  })

  describe('Accessibility', () => {
    it('Run button is focusable', () => {
      renderRowActions({ onRun: vi.fn() })
      const runButton = screen.getByTestId('row-action-run')
      runButton.focus()
      expect(document.activeElement).toBe(runButton)
    })

    it('menu trigger is focusable', () => {
      renderRowActions()
      const trigger = screen.getByTestId('row-actions-menu')
      trigger.focus()
      expect(document.activeElement).toBe(trigger)
    })

    it('Tab navigates between Run button and menu trigger', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ onRun: vi.fn() })
      const runButton = screen.getByTestId('row-action-run')
      const trigger = screen.getByTestId('row-actions-menu')

      runButton.focus()
      await user.tab()

      expect(document.activeElement).toBe(trigger)
    })
  })
})
