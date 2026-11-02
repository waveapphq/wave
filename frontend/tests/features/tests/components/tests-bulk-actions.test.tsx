/**
 * TestsBulkActions Component Tests
 *
 * Direct unit tests for the bulk actions component to test handler callbacks
 * that are difficult to trigger through UI interactions due to nested dropdown
 * limitations in JSDOM.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TestsBulkActions } from '@/features/tests/components/tests-bulk-actions'

describe('TestsBulkActions', () => {
  const defaultProps = {
    selectedCount: 2,
    totalCount: 10,
    selectionModeActive: true,
    onRun: vi.fn(),
    onExport: vi.fn(),
    onDuplicate: vi.fn(),
    onAddToSuite: vi.fn(),
    onRemoveFromSuite: vi.fn(),
    onDelete: vi.fn(),
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
    suites: [
      { id: 'suite-1', name: 'Suite One' },
      { id: 'suite-2', name: 'Suite Two' },
    ],
  }

  it('renders selection count in trigger button', () => {
    render(<TestsBulkActions {...defaultProps} />)
    expect(screen.getByRole('button', { name: /2 selected/i })).toBeInTheDocument()
  })

  it('calls onExitSelectionMode when X button is clicked', async () => {
    const onExitSelectionMode = vi.fn()
    const user = userEvent.setup()
    render(<TestsBulkActions {...defaultProps} onExitSelectionMode={onExitSelectionMode} />)

    await user.click(screen.getByRole('button', { name: /Exit selection mode/i }))
    expect(onExitSelectionMode).toHaveBeenCalled()
  })

  it('calls onRun when Run menu item is clicked', async () => {
    const onRun = vi.fn()
    const user = userEvent.setup()
    render(<TestsBulkActions {...defaultProps} onRun={onRun} />)

    // Open menu
    await user.click(screen.getByRole('button', { name: /2 selected/i }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Run/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Run/i }))

    expect(onRun).toHaveBeenCalled()
  })

  it('calls onExport when Export menu item is clicked', async () => {
    const onExport = vi.fn()
    const user = userEvent.setup()
    render(<TestsBulkActions {...defaultProps} onExport={onExport} />)

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
    render(<TestsBulkActions {...defaultProps} onDuplicate={onDuplicate} />)

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
    render(<TestsBulkActions {...defaultProps} onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: /2 selected/i }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    expect(onDelete).toHaveBeenCalled()
  })

  it('calls onAddToSuite when suite is selected and confirmed', async () => {
    const onAddToSuite = vi.fn()
    const user = userEvent.setup()
    render(<TestsBulkActions {...defaultProps} onAddToSuite={onAddToSuite} />)

    // Open main menu
    await user.click(screen.getByRole('button', { name: /2 selected/i }))

    // Click "Add to Suite" to open popover
    await waitFor(() => {
      expect(screen.getByTestId('bulk-action-add-to-suite')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('bulk-action-add-to-suite'))

    // Click on a suite in the Command list (uses 'option' role)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Suite One/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: /Suite One/i }))

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    expect(screen.getByText(/Add 2 tests to "Suite One"/i)).toBeInTheDocument()

    // Click confirm button
    await user.click(screen.getByRole('button', { name: /^Add$/i }))

    expect(onAddToSuite).toHaveBeenCalledWith('suite-1')
  })

  it('calls onRemoveFromSuite when suite is selected and confirmed', async () => {
    const onRemoveFromSuite = vi.fn()
    const user = userEvent.setup()
    render(<TestsBulkActions {...defaultProps} selectedTestSuiteIds={['suite-1', 'suite-2']} onRemoveFromSuite={onRemoveFromSuite} />)

    await user.click(screen.getByRole('button', { name: /2 selected/i }))
    await waitFor(() => {
      expect(screen.getByTestId('bulk-action-remove-from-suite')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('bulk-action-remove-from-suite'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Suite One/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: /Suite One/i }))

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    expect(screen.getByText(/Remove 2 tests from "Suite One"/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Remove$/i }))
    expect(onRemoveFromSuite).toHaveBeenCalledWith('suite-1')
  })

  it('disables menu items when no items are selected', async () => {
    const user = userEvent.setup()
    render(<TestsBulkActions {...defaultProps} selectedCount={0} />)

    await user.click(screen.getByRole('button', { name: /0 selected/i }))
    await waitFor(() => {
      const runItem = screen.getByRole('menuitem', { name: /Run/i })
      expect(runItem).toHaveAttribute('aria-disabled', 'true')
    })
  })

  it('renders 0 selected when selectedCount is 0', () => {
    render(<TestsBulkActions {...defaultProps} selectedCount={0} />)
    expect(screen.getByRole('button', { name: /0 selected/i })).toBeInTheDocument()
  })

  it('filters suites by search text in Add to Suite popover', async () => {
    const user = userEvent.setup()
    const suites = [
      { id: 'suite-1', name: 'Suite One' },
      { id: 'suite-2', name: 'Suite Two' },
      { id: 'suite-3', name: 'Alpha Suite' },
    ]
    render(<TestsBulkActions {...defaultProps} suites={suites} />)

    // Open main menu
    await user.click(screen.getByRole('button', { name: /2 selected/i }))

    // Click "Add to Suite" to open popover
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add to Suite/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /Add to Suite/i }))

    // All suites should be visible initially
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Suite One/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('option', { name: /Suite Two/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Alpha Suite/i })).toBeInTheDocument()

    // Use fireEvent to change the search input value (avoids focus changes that close the popover)
    const { fireEvent } = await import('@testing-library/react')
    const searchInput = screen.getByTestId('bulk-action-add-to-suite-search-input')
    fireEvent.change(searchInput, { target: { value: 'Alpha' } })

    // Only matching suite should be visible
    expect(screen.getByRole('option', { name: /Alpha Suite/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Suite One/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Suite Two/i })).not.toBeInTheDocument()
  })

  it('handles suite list changing after selection (fallback to empty name)', async () => {
    const onAddToSuite = vi.fn()
    const user = userEvent.setup()

    const { rerender } = render(
      <TestsBulkActions {...defaultProps} onAddToSuite={onAddToSuite} />
    )

    // Open menu and click Add to Suite
    await user.click(screen.getByRole('button', { name: /2 selected/i }))
    await waitFor(() => {
      expect(screen.getByTestId('bulk-action-add-to-suite')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('bulk-action-add-to-suite'))

    // Select a suite
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Suite One/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: /Suite One/i }))

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    // Rerender with empty suites (simulates suite list changing)
    rerender(
      <TestsBulkActions {...defaultProps} suites={[]} onAddToSuite={onAddToSuite} />
    )

    // Confirm - should still work even with empty suite name fallback
    await user.click(screen.getByRole('button', { name: /^Add$/i }))
    expect(onAddToSuite).toHaveBeenCalledWith('suite-1')
  })
})
