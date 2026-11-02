/**
 * SuitesBulkActions Component Tests
 *
 * REQ-5.2.1.36: Suite management screen (list, create, edit, organize tests)
 *
 * V-LIST-07: Suites list populated
 *
 * Tests for bulk actions component per design decisions:
 * - BULK-1: Selection button 118px, dropdown 155px
 * - BULK-3: Actions grouped with separator before Delete (red)
 * - BULK-4: 0 selected = disabled items, menu still opens
 *
 * Key difference from Tests:
 * - NO "Move to Suite" action (suites have no parent entity)
 *
 * Component: frontend/src/components/suites/suites-bulk-actions.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SuitesBulkActions } from '@/features/suites/components/suites-bulk-actions'

describe('SuitesBulkActions', () => {
  const defaultProps = {
    selectedCount: 2,
    totalCount: 10,
    selectionModeActive: true,
    onRun: vi.fn(),
    onExport: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
  }

  describe('Selection Counter Display', () => {
    it('renders selection count in trigger button', () => {
      render(<SuitesBulkActions {...defaultProps} />)
      expect(screen.getByRole('button', { name: /2 selected/i })).toBeInTheDocument()
    })

    it('renders 0 selected when selectedCount is 0', () => {
      render(<SuitesBulkActions {...defaultProps} selectedCount={0} />)
      expect(screen.getByRole('button', { name: /0 selected/i })).toBeInTheDocument()
    })

    it('shows "All X selected" when all items are selected', () => {
      render(<SuitesBulkActions {...defaultProps} selectedCount={10} totalCount={10} />)
      expect(screen.getByRole('button', { name: /All 10 selected/i })).toBeInTheDocument()
    })

    it('has correct testid for selection counter', () => {
      render(<SuitesBulkActions {...defaultProps} />)
      expect(screen.getByTestId('selection-counter')).toBeInTheDocument()
    })
  })

  describe('Selection Mode Toggle', () => {
    it('shows "Mass Action" button when not in selection mode', () => {
      render(<SuitesBulkActions {...defaultProps} selectionModeActive={false} />)
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    })

    it('calls onEnterSelectionMode when Mass Action is clicked', async () => {
      const onEnterSelectionMode = vi.fn()
      const user = userEvent.setup()
      render(
        <SuitesBulkActions
          {...defaultProps}
          selectionModeActive={false}
          onEnterSelectionMode={onEnterSelectionMode}
        />
      )

      await user.click(screen.getByRole('button', { name: /Mass Action/i }))
      expect(onEnterSelectionMode).toHaveBeenCalled()
    })

    it('shows X button to exit selection mode', () => {
      render(<SuitesBulkActions {...defaultProps} />)
      expect(screen.getByRole('button', { name: /Exit selection mode/i })).toBeInTheDocument()
    })

    it('X button has correct testid', () => {
      render(<SuitesBulkActions {...defaultProps} />)
      expect(screen.getByTestId('selection-close')).toBeInTheDocument()
    })

    it('calls onExitSelectionMode when X button is clicked', async () => {
      const onExitSelectionMode = vi.fn()
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} onExitSelectionMode={onExitSelectionMode} />)

      await user.click(screen.getByRole('button', { name: /Exit selection mode/i }))
      expect(onExitSelectionMode).toHaveBeenCalled()
    })
  })

  describe('Bulk Actions Dropdown', () => {
    it('has correct testid for dropdown', () => {
      render(<SuitesBulkActions {...defaultProps} />)
      expect(screen.getByTestId('bulk-actions-dropdown')).toBeInTheDocument()
    })

    it('opens menu when selection counter is clicked', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })
    })
  })

  describe('Run Action', () => {
    it('menu contains Run action', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Run/i })).toBeInTheDocument()
      })
    })

    it('Run action has correct testid', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-run')).toBeInTheDocument()
      })
    })

    it('calls onRun when Run menu item is clicked', async () => {
      const onRun = vi.fn()
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} onRun={onRun} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Run/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: /Run/i }))

      expect(onRun).toHaveBeenCalled()
    })
  })

  describe('Export Action', () => {
    it('menu contains Export action', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument()
      })
    })

    it('Export action has correct testid', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
      })
    })

    it('calls onExport when Export menu item is clicked', async () => {
      const onExport = vi.fn()
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} onExport={onExport} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      expect(onExport).toHaveBeenCalled()
    })
  })

  describe('Duplicate Action', () => {
    it('menu contains Duplicate action', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
      })
    })

    it('Duplicate action has correct testid', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-duplicate')).toBeInTheDocument()
      })
    })

    it('calls onDuplicate when Duplicate menu item is clicked', async () => {
      const onDuplicate = vi.fn()
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} onDuplicate={onDuplicate} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(onDuplicate).toHaveBeenCalled()
    })
  })

  describe('Move to Suite - NOT Present', () => {
    it('does NOT contain Move to Suite action (suites have no parent)', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Should NOT find Move to Suite
      expect(screen.queryByRole('menuitem', { name: /Move to Suite/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Move to Suite/i })).not.toBeInTheDocument()
      expect(screen.queryByTestId('bulk-action-move')).not.toBeInTheDocument()
    })
  })

  describe('Delete Action', () => {
    it('menu contains Delete action', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
      })
    })

    it('Delete action has correct testid', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument()
      })
    })

    it('Delete action has destructive/red styling', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        const deleteItem = screen.getByTestId('bulk-action-delete')
        expect(deleteItem).toHaveClass('text-error')
      })
    })

    it('calls onDelete when Delete menu item is clicked', async () => {
      const onDelete = vi.fn()
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} onDelete={onDelete} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(onDelete).toHaveBeenCalled()
    })
  })

  describe('Menu Structure (BULK-3)', () => {
    it('has separator before Delete', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByTestId('bulk-actions-separator')).toBeInTheDocument()
      })
    })

    it('actions are in correct order: Run, Export, Duplicate, separator, Delete', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      const menuItems = screen.getAllByRole('menuitem')
      expect(menuItems[0]).toHaveTextContent(/Run/i)
      expect(menuItems[1]).toHaveTextContent(/Export/i)
      expect(menuItems[2]).toHaveTextContent(/Duplicate/i)
      expect(menuItems[3]).toHaveTextContent(/Delete/i)
    })
  })

  describe('Disabled State (BULK-4)', () => {
    it('disables menu items when no items are selected', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} selectedCount={0} />)

      await user.click(screen.getByRole('button', { name: /0 selected/i }))
      await waitFor(() => {
        const runItem = screen.getByRole('menuitem', { name: /Run/i })
        expect(runItem).toHaveAttribute('aria-disabled', 'true')
      })
    })

    it('menu still opens when 0 items selected', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} selectedCount={0} />)

      await user.click(screen.getByRole('button', { name: /0 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })
    })

    it('disabled menu items have muted text color', async () => {
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} selectedCount={0} />)

      await user.click(screen.getByRole('button', { name: /0 selected/i }))
      await waitFor(() => {
        const runItem = screen.getByTestId('bulk-action-run')
        expect(runItem).toHaveClass('text-muted')
      })
    })

    it('disabled Run action does not call handler', async () => {
      const onRun = vi.fn()
      const user = userEvent.setup()
      render(<SuitesBulkActions {...defaultProps} selectedCount={0} onRun={onRun} />)

      await user.click(screen.getByRole('button', { name: /0 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Run/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: /Run/i }))

      expect(onRun).not.toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    it('selection counter has aria-live for screen readers', () => {
      render(<SuitesBulkActions {...defaultProps} />)
      expect(screen.getByTestId('selection-counter')).toHaveAttribute('aria-live', 'polite')
    })

    it('X button has accessible label', () => {
      render(<SuitesBulkActions {...defaultProps} />)
      expect(screen.getByRole('button', { name: /Exit selection mode/i })).toBeInTheDocument()
    })

    it('dropdown trigger has accessible label', () => {
      render(<SuitesBulkActions {...defaultProps} />)
      expect(screen.getByRole('button', { name: /2 selected/i })).toBeInTheDocument()
    })
  })
})
