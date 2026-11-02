/**
 * TestsRowActions Component Tests
 *
 * REQ-5.2.1.35: Test management screen (list, create, edit, delete, duplicate)
 *
 * V-LIST-01: Tests list populated
 *
 * Tests for row-level actions per design specification:
 * - Run button (primary action, always visible)
 * - Overflow menu with: Edit, Duplicate, Delete
 * - Keyboard accessibility for all actions
 *
 * Component: frontend/src/components/tests/tests-row-actions.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, act, waitFor } from '@testing-library/react'
import { TestsRowActions, type TestsRowActionsProps } from '@/features/tests/components/tests-row-actions'

// ============================================================================
// Test Utilities
// ============================================================================

function renderRowActions(props: Partial<TestsRowActionsProps> = {}) {
  const defaultProps: TestsRowActionsProps = {
    testId: 'test-1',
    testName: 'Login Flow Test',
    onRun: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    ...props,
  }
  return render(<TestsRowActions {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('TestsRowActions', () => {
  describe('Run Button', () => {
    it('renders Run button with correct testid', () => {
      renderRowActions()
      expect(screen.getByTestId('action-run')).toBeInTheDocument()
    })

    it('Run button is visible', () => {
      renderRowActions()
      expect(screen.getByTestId('action-run')).toBeVisible()
    })

    it('Run button has play icon', () => {
      renderRowActions()
      const button = screen.getByTestId('action-run')
      expect(button.querySelector('svg')).toBeInTheDocument()
    })

    it('Run button has accessible name', () => {
      renderRowActions({ testName: 'Login Flow Test' })
      expect(screen.getByRole('button', { name: /Run Login Flow Test/i })).toBeInTheDocument()
    })

    it('Run button is enabled by default', () => {
      renderRowActions()
      expect(screen.getByTestId('action-run')).toBeEnabled()
    })

    it('clicking Run button calls onRun with testId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRun = vi.fn()

      renderRowActions({ testId: 'test-123', onRun: handleRun })
      await user.click(screen.getByTestId('action-run'))

      expect(handleRun).toHaveBeenCalledWith('test-123')
    })

    it('Run button can be disabled', () => {
      renderRowActions({ runDisabled: true })
      expect(screen.getByTestId('action-run')).toBeDisabled()
    })

    it('disabled Run button explains why through the shared tooltip', () => {
      renderRowActions({ runDisabled: true, runDisabledReason: 'Test is already running' })
      const button = screen.getByTestId('action-run')
      expect(button).not.toHaveAttribute('title')
      fireEvent.focus(button.parentElement as HTMLElement)
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        'Test is already running',
      )
    })
  })

  describe('Overflow Menu Trigger', () => {
    it('renders menu trigger with correct testid', () => {
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
      expect(trigger.querySelector('svg')).toBeInTheDocument()
    })

    it('menu trigger has accessible name', () => {
      renderRowActions({ testName: 'API Test' })
      expect(
        screen.getByRole('button', { name: /More actions for API Test/i })
      ).toBeInTheDocument()
    })

    it('menu trigger has aria-haspopup', () => {
      renderRowActions()
      expect(screen.getByTestId('action-menu-trigger')).toHaveAttribute(
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
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('trigger has aria-expanded="true" when menu is open', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')

      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      await user.click(trigger)

      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    it('pressing Enter on trigger opens menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')
      trigger.focus()
      await user.keyboard('{Enter}')

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('pressing Space on trigger opens menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')
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
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument()
    })

    it('Edit action has pencil icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const editItem = screen.getByRole('menuitem', { name: /Edit/i })
      expect(editItem.querySelector('svg')).toBeInTheDocument()
    })

    it('clicking Edit calls onEdit with testId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEdit = vi.fn()

      renderRowActions({ testId: 'test-456', onEdit: handleEdit })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Edit/i }))

      expect(handleEdit).toHaveBeenCalledWith('test-456')
    })

    it('clicking Edit closes menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Edit/i }))

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('Duplicate Action', () => {
    it('menu contains Duplicate action', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })

    it('Duplicate action has copy icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const duplicateItem = screen.getByRole('menuitem', { name: /Duplicate/i })
      expect(duplicateItem.querySelector('svg')).toBeInTheDocument()
    })

    it('clicking Duplicate calls onDuplicate with testId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDuplicate = vi.fn()

      renderRowActions({ testId: 'test-789', onDuplicate: handleDuplicate })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(handleDuplicate).toHaveBeenCalledWith('test-789')
    })
  })

  describe('Delete Action', () => {
    it('menu contains Delete action', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })

    it('Delete action has trash icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem.querySelector('svg')).toBeInTheDocument()
    })

    it('Delete action has destructive/red styling', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      expect(deleteItem).toHaveClass('text-error')
    })

    it('clicking Delete calls onDelete with testId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleDelete = vi.fn()

      renderRowActions({ testId: 'test-abc', onDelete: handleDelete })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(handleDelete).toHaveBeenCalledWith('test-abc')
    })

    it('Delete is at the bottom of the menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const menuItems = screen.getAllByRole('menuitem')
      const deleteItem = menuItems[menuItems.length - 1]
      expect(deleteItem).toHaveTextContent(/Delete/i)
    })
  })

  describe('Export Action', () => {
    it('menu contains Export action when onExport is provided', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ onExport: vi.fn() })
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByTestId('action-export')).toBeInTheDocument()
    })

    it('Export action has download icon', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ onExport: vi.fn() })
      await user.click(screen.getByTestId('action-menu-trigger'))

      const exportItem = screen.getByTestId('action-export')
      expect(exportItem.querySelector('svg')).toBeInTheDocument()
    })

    it('clicking Export calls onExport with testId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleExport = vi.fn()

      renderRowActions({ testId: 'test-export-1', onExport: handleExport })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByTestId('action-export'))

      expect(handleExport).toHaveBeenCalledWith('test-export-1')
    })

    it('Export action is not shown when onExport is not provided', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.queryByTestId('action-export')).not.toBeInTheDocument()
    })
  })

  describe('Menu Order', () => {
    it('actions are in correct order: Edit, Duplicate, separator, Delete', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      const menuItems = screen.getAllByRole('menuitem')

      expect(menuItems[0]).toHaveTextContent(/Edit/i)
      expect(menuItems[1]).toHaveTextContent(/Duplicate/i)
      expect(menuItems[2]).toHaveTextContent(/Delete/i)
    })

    it('has separator before Delete', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByRole('separator')).toBeInTheDocument()
    })
  })

  describe('Menu Closing', () => {
    it('pressing Escape closes menu', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('clicking outside menu closes it', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const { container } = renderRowActions()
      await user.click(screen.getByTestId('action-menu-trigger'))
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
      await user.click(screen.getByTestId('action-menu-trigger'))

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
      await user.click(screen.getByTestId('action-menu-trigger'))

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
      await user.click(screen.getByTestId('action-menu-trigger'))

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

      const runButton = screen.getByTestId('action-run')
      const menuTrigger = screen.getByTestId('action-menu-trigger')
      const container = screen.getByTestId('row-actions')

      // Both should be within the row-actions container
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

  describe('Add to Suite', () => {
    const suites = [
      { id: 'suite-1', name: 'Suite One' },
      { id: 'suite-2', name: 'Suite Two' },
      { id: 'suite-3', name: 'Alpha Suite' },
    ]

    it('shows Add to Suite button when suites and onAddToSuite are provided', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ suites, onAddToSuite: vi.fn() })
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.getByTestId('action-add-to-suite')).toBeInTheDocument()
    })

    it('does not show Add to Suite when suites is empty', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ suites: [], onAddToSuite: vi.fn() })
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.queryByTestId('action-add-to-suite')).not.toBeInTheDocument()
    })

    it('does not show Add to Suite when onAddToSuite is not provided', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ suites })
      await user.click(screen.getByTestId('action-menu-trigger'))

      expect(screen.queryByTestId('action-add-to-suite')).not.toBeInTheDocument()
    })

    it('opens popover with suite list when Add to Suite is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions({ suites, onAddToSuite: vi.fn() })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByTestId('action-add-to-suite'))

      expect(screen.getByRole('option', { name: /Suite One/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Suite Two/i })).toBeInTheDocument()
    })

    it('selecting a suite and confirming calls onAddToSuite with testId and suiteId', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleAddToSuite = vi.fn()

      renderRowActions({ testId: 'test-move-1', suites, onAddToSuite: handleAddToSuite })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await waitFor(() => {
        expect(screen.getByTestId('action-add-to-suite')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('action-add-to-suite'))

      // Select a suite
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Suite Two/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('option', { name: /Suite Two/i }))

      // Confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      })
      expect(screen.getByText(/Add "Login Flow Test" to "Suite Two"/i)).toBeInTheDocument()

      // Click confirm
      await user.click(screen.getByRole('button', { name: /^Add$/i }))

      expect(handleAddToSuite).toHaveBeenCalledWith('test-move-1', 'suite-2')
    })

    it('canceling the add dialog does not call onAddToSuite', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleAddToSuite = vi.fn()

      renderRowActions({ suites, onAddToSuite: handleAddToSuite })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await waitFor(() => {
        expect(screen.getByTestId('action-add-to-suite')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('action-add-to-suite'))

      // Select a suite to trigger the dialog
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Suite One/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('option', { name: /Suite One/i }))

      // Confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      })

      // Click cancel
      await user.click(screen.getByRole('button', { name: /Cancel/i }))

      expect(handleAddToSuite).not.toHaveBeenCalled()
    })

    it('filters suites when searching in the popover', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { fireEvent } = await import('@testing-library/react')
      const user = userEvent.setup()

      renderRowActions({ suites, onAddToSuite: vi.fn() })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await waitFor(() => {
        expect(screen.getByTestId('action-add-to-suite')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('action-add-to-suite'))

      // All suites should be visible initially
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Suite One/i })).toBeInTheDocument()
      })
      expect(screen.getByRole('option', { name: /Suite Two/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Alpha Suite/i })).toBeInTheDocument()

      // Use fireEvent to change the search input value (avoids focus changes that close the popover)
      const searchInput = screen.getByTestId('action-add-to-suite-search-input')
      fireEvent.change(searchInput, { target: { value: 'Alpha' } })

      // Only Alpha Suite should be visible
      expect(screen.getByRole('option', { name: /Alpha Suite/i })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /Suite One/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /Suite Two/i })).not.toBeInTheDocument()
    })

    it('handles suite list changing after selection (fallback to empty name)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const onAddToSuite = vi.fn()

      const { rerender } = render(
        <TestsRowActions
          testId="test-1"
          testName="Login Flow Test"
          suites={suites}
          onAddToSuite={onAddToSuite}
          onRun={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDuplicate={vi.fn()}
        />
      )

      // Open menu and select a suite
      await user.click(screen.getByTestId('action-menu-trigger'))
      await user.click(screen.getByTestId('action-add-to-suite'))
      await user.click(screen.getByRole('option', { name: /Suite One/i }))

      // Confirmation dialog should appear
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()

      // Rerender with empty suites (simulates suite list changing)
      rerender(
        <TestsRowActions
          testId="test-1"
          testName="Login Flow Test"
          suites={[]}
          onAddToSuite={onAddToSuite}
          onRun={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDuplicate={vi.fn()}
        />
      )

      // Dialog should still work even with empty suite name fallback
      await user.click(screen.getByRole('button', { name: /^Add$/i }))
      expect(onAddToSuite).toHaveBeenCalledWith('test-1', 'suite-1')
    })
  })

  describe('Remove from Suite', () => {
    const suites = [
      { id: 'suite-1', name: 'Suite One' },
      { id: 'suite-2', name: 'Suite Two' },
      { id: 'suite-3', name: 'Alpha Suite' },
    ]

    it('selecting a suite and confirming calls onRemoveFromSuite', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRemoveFromSuite = vi.fn()

      renderRowActions({ testId: 'test-rm-1', suites, testSuiteIds: ['suite-1', 'suite-2'], onRemoveFromSuite: handleRemoveFromSuite })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await waitFor(() => {
        expect(screen.getByTestId('action-remove-from-suite')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('action-remove-from-suite'))

      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Suite One/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('option', { name: /Suite One/i }))

      await waitFor(() => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      })
      expect(screen.getByText(/Remove "Login Flow Test" from "Suite One"/i)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^Remove$/i }))
      expect(handleRemoveFromSuite).toHaveBeenCalledWith('test-rm-1', 'suite-1')
    })

    it('canceling remove dialog does not call onRemoveFromSuite', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRemoveFromSuite = vi.fn()

      renderRowActions({ suites, testSuiteIds: ['suite-1'], onRemoveFromSuite: handleRemoveFromSuite })
      await user.click(screen.getByTestId('action-menu-trigger'))
      await waitFor(() => {
        expect(screen.getByTestId('action-remove-from-suite')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('action-remove-from-suite'))

      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Suite One/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('option', { name: /Suite One/i }))

      await waitFor(() => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: /Cancel/i }))

      expect(handleRemoveFromSuite).not.toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    it('Run button is focusable', () => {
      renderRowActions()
      const runButton = screen.getByTestId('action-run')
      runButton.focus()
      expect(document.activeElement).toBe(runButton)
    })

    it('menu trigger is focusable', () => {
      renderRowActions()
      const trigger = screen.getByTestId('action-menu-trigger')
      trigger.focus()
      expect(document.activeElement).toBe(trigger)
    })

    it('Tab navigates between Run button and menu trigger', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRowActions()
      const runButton = screen.getByTestId('action-run')
      const trigger = screen.getByTestId('action-menu-trigger')

      runButton.focus()
      await user.tab()

      expect(document.activeElement).toBe(trigger)
    })
  })
})
