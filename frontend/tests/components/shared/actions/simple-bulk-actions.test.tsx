/**
 * SimpleBulkActions Component Tests
 *
 * Tests for the shared bulk actions component that provides
 * Export, Duplicate, and Delete actions via a dropdown menu.
 * Used by EnvironmentsBulkActions and ProfilesBulkActions.
 *
 * Component: frontend/src/components/shared/actions/simple-bulk-actions.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SimpleBulkActions } from '@/components/shared/actions/simple-bulk-actions'

describe('SimpleBulkActions', () => {
  const defaultProps = {
    selectedCount: 2,
    selectionModeActive: true,
    onExport: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
  }

  describe('Selection Mode Inactive', () => {
    it('shows "Mass Action" button when selection mode is inactive', () => {
      render(<SimpleBulkActions {...defaultProps} selectionModeActive={false} />)
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    })

    it('calls onEnterSelectionMode when Mass Action is clicked', async () => {
      const onEnterSelectionMode = vi.fn()
      const user = userEvent.setup()
      render(
        <SimpleBulkActions
          {...defaultProps}
          selectionModeActive={false}
          onEnterSelectionMode={onEnterSelectionMode}
        />
      )

      await user.click(screen.getByRole('button', { name: /Mass Action/i }))
      expect(onEnterSelectionMode).toHaveBeenCalled()
    })
  })

  describe('Selection Mode Active', () => {
    it('shows selection count when selection mode is active', () => {
      render(<SimpleBulkActions {...defaultProps} />)
      expect(screen.getByRole('button', { name: /2 selected/i })).toBeInTheDocument()
    })

    it('shows 0 selected when selectedCount is 0', () => {
      render(<SimpleBulkActions {...defaultProps} selectedCount={0} />)
      expect(screen.getByRole('button', { name: /0 selected/i })).toBeInTheDocument()
    })

    it('calls onExitSelectionMode when X button is clicked', async () => {
      const onExitSelectionMode = vi.fn()
      const user = userEvent.setup()
      render(
        <SimpleBulkActions {...defaultProps} onExitSelectionMode={onExitSelectionMode} />
      )

      await user.click(screen.getByRole('button', { name: /Exit selection mode/i }))
      expect(onExitSelectionMode).toHaveBeenCalled()
    })
  })

  describe('Dropdown Menu Items', () => {
    it('shows Export menu item', async () => {
      const user = userEvent.setup()
      render(<SimpleBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument()
      })
    })

    it('shows Duplicate menu item', async () => {
      const user = userEvent.setup()
      render(<SimpleBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
      })
    })

    it('shows Delete menu item', async () => {
      const user = userEvent.setup()
      render(<SimpleBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
      })
    })

    it('does not show Run menu item', async () => {
      const user = userEvent.setup()
      render(<SimpleBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument()
      })
      expect(screen.queryByRole('menuitem', { name: /^Run$/i })).not.toBeInTheDocument()
    })

    it('does not show Move to Suite menu item', async () => {
      const user = userEvent.setup()
      render(<SimpleBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument()
      })
      expect(screen.queryByRole('button', { name: /Move to Suite/i })).not.toBeInTheDocument()
    })

    it('disables menu items when selectedCount is 0', async () => {
      const user = userEvent.setup()
      render(<SimpleBulkActions {...defaultProps} selectedCount={0} />)

      await user.click(screen.getByRole('button', { name: /0 selected/i }))
      await waitFor(() => {
        const exportItem = screen.getByRole('menuitem', { name: /Export/i })
        expect(exportItem).toHaveAttribute('aria-disabled', 'true')
      })
    })
  })

  describe('Callbacks', () => {
    it('calls onExport when Export menu item is clicked', async () => {
      const onExport = vi.fn()
      const user = userEvent.setup()
      render(<SimpleBulkActions {...defaultProps} onExport={onExport} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      expect(onExport).toHaveBeenCalled()
    })

    it('calls onDuplicate when Duplicate menu item is clicked', async () => {
      const onDuplicate = vi.fn()
      const user = userEvent.setup()
      render(<SimpleBulkActions {...defaultProps} onDuplicate={onDuplicate} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

      expect(onDuplicate).toHaveBeenCalled()
    })

    it('calls onDelete when Delete menu item is clicked', async () => {
      const onDelete = vi.fn()
      const user = userEvent.setup()
      render(<SimpleBulkActions {...defaultProps} onDelete={onDelete} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      expect(onDelete).toHaveBeenCalled()
    })
  })

  describe('Optional totalCount prop', () => {
    it('accepts totalCount without error', () => {
      render(<SimpleBulkActions {...defaultProps} totalCount={10} />)
      expect(screen.getByRole('button', { name: /2 selected/i })).toBeInTheDocument()
    })
  })

  describe('Delete-only Mass Action (BULK-3)', () => {
    const deleteOnlyProps = {
      selectedCount: 2,
      selectionModeActive: true,
      onDelete: vi.fn(),
      onEnterSelectionMode: vi.fn(),
      onExitSelectionMode: vi.fn(),
    }

    async function openMenu(props: Partial<typeof deleteOnlyProps> = {}) {
      const merged = { ...deleteOnlyProps, ...props }
      const user = userEvent.setup()
      render(<SimpleBulkActions {...merged} />)
      await user.click(screen.getByRole('button', { name: `${merged.selectedCount} selected` }))
      const menu = await screen.findByRole('menu')
      return { user, menu }
    }

    it('offers only the red Delete item and no separator', async () => {
      const { menu } = await openMenu()

      const items = within(menu).getAllByRole('menuitem')
      expect(items).toHaveLength(1)
      expect(items[0]).toHaveTextContent('Delete')
      expect(items[0]).toHaveClass('text-error')
      expect(within(menu).queryByRole('separator')).not.toBeInTheDocument()
      expect(screen.queryByTestId('bulk-actions-separator')).not.toBeInTheDocument()
    })

    it('calls onDelete when Delete is chosen', async () => {
      const onDelete = vi.fn()
      const { user } = await openMenu({ onDelete })

      await user.click(screen.getByRole('menuitem', { name: /Delete/ }))

      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('still opens with Delete disabled when nothing is selected (BULK-4)', async () => {
      const onDelete = vi.fn()
      const { user, menu } = await openMenu({ selectedCount: 0, onDelete })

      const deleteItem = within(menu).getByRole('menuitem', { name: /Delete/ })
      expect(deleteItem).toHaveAttribute('aria-disabled', 'true')
      await user.click(deleteItem)
      expect(onDelete).not.toHaveBeenCalled()
    })

    it('keeps the Mass Action entry button outside selection mode', () => {
      render(<SimpleBulkActions {...deleteOnlyProps} selectionModeActive={false} />)

      expect(
        screen.getByRole('button', { name: 'Mass Action - click to enter selection mode' })
      ).toBeInTheDocument()
    })
  })

  describe('Disabled', () => {
    const massAction = () =>
      screen.getByRole('button', { name: 'Mass Action - click to enter selection mode' })

    it('disables the Mass Action button so it cannot enter selection mode', async () => {
      const onEnterSelectionMode = vi.fn()
      const user = userEvent.setup()
      render(
        <SimpleBulkActions
          {...defaultProps}
          selectionModeActive={false}
          onEnterSelectionMode={onEnterSelectionMode}
          disabled
        />
      )

      expect(massAction()).toBeDisabled()
      await user.click(massAction())
      expect(onEnterSelectionMode).not.toHaveBeenCalled()
    })

    it('keeps the Mass Action button enabled when disabled is omitted', () => {
      render(<SimpleBulkActions {...defaultProps} selectionModeActive={false} />)

      expect(massAction()).toBeEnabled()
    })

    it('keeps the Mass Action button enabled when disabled is false', () => {
      render(<SimpleBulkActions {...defaultProps} selectionModeActive={false} disabled={false} />)

      expect(massAction()).toBeEnabled()
    })
  })

  describe('Existing callers with every handler', () => {
    it('keeps Export, Duplicate, the separator and Delete in that order', async () => {
      const user = userEvent.setup()
      render(<SimpleBulkActions {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      const menu = await screen.findByRole('menu')

      const names = within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())
      expect(names).toEqual(['Export', 'Duplicate', 'Delete'])
      expect(screen.getByTestId('bulk-actions-separator').nextElementSibling).toBe(
        screen.getByTestId('bulk-action-delete')
      )
    })
  })
})
