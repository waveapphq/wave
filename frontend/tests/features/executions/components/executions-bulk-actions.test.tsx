/**
 * ExecutionsBulkActions Component Tests
 *
 * Tests for the executions bulk actions dropdown.
 * Executions are read-only historical records so only Delete is offered.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExecutionsBulkActions } from '@/features/executions/components/executions-bulk-actions'

describe('ExecutionsBulkActions', () => {
  const defaultProps = {
    selectedCount: 2,
    totalCount: 10,
    selectionModeActive: true,
    onDelete: vi.fn(),
    onExport: vi.fn(),
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
  }

  describe('Selection Mode Inactive', () => {
    it('shows Mass Action entry button when selection mode is inactive', () => {
      render(<ExecutionsBulkActions {...defaultProps} selectionModeActive={false} />)
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    })

    it('calls onEnterSelectionMode when the entry button is clicked', async () => {
      const onEnterSelectionMode = vi.fn()
      const user = userEvent.setup()
      render(
        <ExecutionsBulkActions
          {...defaultProps}
          selectionModeActive={false}
          onEnterSelectionMode={onEnterSelectionMode}
        />,
      )
      await user.click(screen.getByRole('button', { name: /Mass Action/i }))
      expect(onEnterSelectionMode).toHaveBeenCalled()
    })
  })

  describe('Selection Mode Active', () => {
    it('shows "N selected" label when some rows are selected', () => {
      render(<ExecutionsBulkActions {...defaultProps} selectedCount={3} totalCount={10} />)
      expect(screen.getByRole('button', { name: /3 selected/i })).toBeInTheDocument()
    })

    it('shows "All N selected" when every row is selected', () => {
      render(<ExecutionsBulkActions {...defaultProps} selectedCount={10} totalCount={10} />)
      expect(screen.getByRole('button', { name: /All 10 selected/i })).toBeInTheDocument()
    })

    it('shows "0 selected" when nothing is selected yet', () => {
      render(<ExecutionsBulkActions {...defaultProps} selectedCount={0} totalCount={10} />)
      expect(screen.getByRole('button', { name: /0 selected/i })).toBeInTheDocument()
    })

    it('exits selection mode when the close button is clicked', async () => {
      const onExitSelectionMode = vi.fn()
      const user = userEvent.setup()
      render(
        <ExecutionsBulkActions {...defaultProps} onExitSelectionMode={onExitSelectionMode} />,
      )
      await user.click(screen.getByRole('button', { name: /Exit selection mode/i }))
      expect(onExitSelectionMode).toHaveBeenCalled()
    })
  })

  describe('Dropdown Menu Items', () => {
    it('renders Export and Delete items', async () => {
      const user = userEvent.setup()
      render(<ExecutionsBulkActions {...defaultProps} />)
      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
      })
      expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
      expect(screen.getByTestId('bulk-action-export')).toHaveTextContent('Export')
    })

    it('calls onExport when the Export item is selected', async () => {
      const onExport = vi.fn()
      const user = userEvent.setup()
      render(<ExecutionsBulkActions {...defaultProps} onExport={onExport} />)
      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('bulk-action-export'))
      expect(onExport).toHaveBeenCalledTimes(1)
    })

    it('does not call onExport when disabled (no selection)', async () => {
      const onExport = vi.fn()
      const user = userEvent.setup()
      render(<ExecutionsBulkActions {...defaultProps} selectedCount={0} onExport={onExport} />)
      await user.click(screen.getByRole('button', { name: /0 selected/i }))
      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('bulk-action-export'))
      expect(onExport).not.toHaveBeenCalled()
    })

    it('confirms with an artifacts + reports warning before calling onDelete', async () => {
      const onDelete = vi.fn()
      const user = userEvent.setup()
      render(<ExecutionsBulkActions {...defaultProps} onDelete={onDelete} />)
      await user.click(screen.getByRole('button', { name: /2 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      // Deleting cascades to the executions' artifacts + reports; the bulk confirmation must warn.
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent(/artifacts and reports/i)
      expect(onDelete).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: /^delete/i }))
      expect(onDelete).toHaveBeenCalled()
    })

    it('does not call onDelete when disabled (no selection)', async () => {
      const onDelete = vi.fn()
      const user = userEvent.setup()
      render(<ExecutionsBulkActions {...defaultProps} selectedCount={0} onDelete={onDelete} />)
      await user.click(screen.getByRole('button', { name: /0 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
      })
      const deleteItem = screen.getByRole('menuitem', { name: /Delete/i })
      await user.click(deleteItem)
      expect(onDelete).not.toHaveBeenCalled()
    })

    it('uses the singular noun when a single execution is selected', async () => {
      const user = userEvent.setup()
      render(<ExecutionsBulkActions {...defaultProps} selectedCount={1} />)
      await user.click(screen.getByRole('button', { name: /1 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent(/delete 1 execution\?/i)
    })
  })
})
