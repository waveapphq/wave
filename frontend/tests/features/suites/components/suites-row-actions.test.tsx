/**
 * SuitesRowActions Component Tests
 *
 * REQ-5.2.1.36: Suite management screen (list, create, edit, organize tests)
 *
 * V-LIST-07: Suites list populated
 *
 * Tests for row-level actions per design specification:
 * - Run button (primary action, always visible)
 * - Overflow menu with: Edit, Duplicate, Delete
 * - NO Move to Suite action (suites have no parent entity)
 * - Keyboard accessibility for all actions
 *
 * Component: frontend/src/components/suites/suites-row-actions.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, act } from '@testing-library/react'
import { SuitesRowActions, type SuitesRowActionsProps } from '@/features/suites/components/suites-row-actions'

// ============================================================================
// Test Utilities
// ============================================================================

function renderRowActions(props: Partial<SuitesRowActionsProps> = {}) {
  const defaultProps: SuitesRowActionsProps = {
    suiteId: 'suite-1',
    suiteName: 'Auth Suite',
    onRun: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    ...props,
  }
  return render(<SuitesRowActions {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('SuitesRowActions', () => {
  describe('Run Button', () => {
    it('renders Run button with correct testid', () => {
      renderRowActions()
      expect(screen.getByTestId('row-action-run')).toBeInTheDocument()
    })

    it('Run button is visible', () => {
      renderRowActions()
      expect(screen.getByTestId('row-action-run')).toBeVisible()
    })

    it('Run button has play icon', () => {
      renderRowActions()
      const button = screen.getByTestId('row-action-run')
      expect(button.querySelector('svg')).toBeInTheDocument()
    })

    it('Run button has accessible name', () => {
      renderRowActions({ suiteName: 'Auth Suite' })
      expect(screen.getByRole('button', { name: /Run Auth Suite/i })).toBeInTheDocument()
    })

    it('Run button is enabled by default', () => {
      renderRowActions()
      expect(screen.getByTestId('row-action-run')).toBeEnabled()
    })

    it('clicking Run button calls onRun with suiteId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRun = vi.fn()

      renderRowActions({ suiteId: 'suite-123', onRun: handleRun })
      await user.click(screen.getByTestId('row-action-run'))

      expect(handleRun).toHaveBeenCalledWith('suite-123')
    })

    it('Run button can be disabled', () => {
      renderRowActions({ runDisabled: true })
      expect(screen.getByTestId('row-action-run')).toBeDisabled()
    })

    it('disabled Run button explains why through the shared tooltip', () => {
      renderRowActions({ runDisabled: true, runDisabledReason: 'Suite is already running' })
      const button = screen.getByTestId('row-action-run')
      expect(button).not.toHaveAttribute('title')
      fireEvent.focus(button.parentElement as HTMLElement)
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        'Suite is already running',
      )
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

    it('menu trigger has accessible name', () => {
      renderRowActions({ suiteName: 'API Suite' })
      expect(
        screen.getByRole('button', { name: /More actions for API Suite/i })
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

    it('Edit action has pencil icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const editItem = screen.getByRole('menuitem', { name: /Edit/i })
      expect(editItem.querySelector('svg')).toBeInTheDocument()
    })

    it('clicking Edit calls onEdit with suiteId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEdit = vi.fn()

      renderRowActions({ suiteId: 'suite-456', onEdit: handleEdit })
      await user.click(screen.getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Edit/i }))

      expect(handleEdit).toHaveBeenCalledWith('suite-456')
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

    it('Duplicate action has copy icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      const duplicateItem = screen.getByRole('menuitem', { name: /Duplicate/i })
      expect(duplicateItem.querySelector('svg')).toBeInTheDocument()
    })

    it('clicking Duplicate calls onDuplicate with suiteId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicate = vi.fn()

      renderRowActions({ suiteId: 'suite-789', onDuplicate: handleDuplicate })
      await user.click(screen.getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(handleDuplicate).toHaveBeenCalledWith('suite-789')
    })
  })

  describe('Move to Suite - NOT Present', () => {
    it('does NOT contain Move to Suite action (suites have no parent)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('row-actions-menu'))

      expect(screen.queryByRole('menuitem', { name: /Move to Suite/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Move to Suite/i })).not.toBeInTheDocument()
      expect(screen.queryByTestId('action-move-to-suite')).not.toBeInTheDocument()
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

    it('Delete action has trash icon', async () => {
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

    it('clicking Delete calls onDelete with suiteId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDelete = vi.fn()

      renderRowActions({ suiteId: 'suite-abc', onDelete: handleDelete })
      await user.click(screen.getByTestId('row-actions-menu'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDelete).toHaveBeenCalledWith('suite-abc')
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
      renderRowActions()

      const runButton = screen.getByTestId('row-action-run')
      const menuTrigger = screen.getByTestId('row-actions-menu')
      const container = screen.getByTestId('row-actions')

      expect(container).toContainElement(runButton)
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
      renderRowActions()
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

      renderRowActions()
      const runButton = screen.getByTestId('row-action-run')
      const trigger = screen.getByTestId('row-actions-menu')

      runButton.focus()
      await user.tab()

      expect(document.activeElement).toBe(trigger)
    })
  })
})
