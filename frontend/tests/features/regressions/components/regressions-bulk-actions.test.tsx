/**
 * RegressionsBulkActions Component Tests
 *
 * Covers the bulk action dropdown used on the regressions list page.
 * Follows the same pattern as suites-bulk-actions.test.tsx.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegressionsBulkActions } from '@/features/regressions/components/regressions-bulk-actions'

describe('RegressionsBulkActions', () => {
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

  it('renders selection count in trigger button', () => {
    render(<RegressionsBulkActions {...defaultProps} />)
    expect(screen.getByRole('button', { name: /2 selected/i })).toBeInTheDocument()
  })

  it('shows "All X selected" when all items are selected', () => {
    render(
      <RegressionsBulkActions
        {...defaultProps}
        selectedCount={10}
        totalCount={10}
      />
    )
    expect(
      screen.getByRole('button', { name: /All 10 selected/i }),
    ).toBeInTheDocument()
  })

  it('shows Mass Action button when not in selection mode', () => {
    render(
      <RegressionsBulkActions {...defaultProps} selectionModeActive={false} />
    )
    expect(
      screen.getByRole('button', { name: /Mass Action/i }),
    ).toBeInTheDocument()
  })

  it('calls onEnterSelectionMode when the Mass Action button is clicked', async () => {
    const onEnterSelectionMode = vi.fn()
    const user = userEvent.setup()

    render(
      <RegressionsBulkActions
        {...defaultProps}
        selectionModeActive={false}
        onEnterSelectionMode={onEnterSelectionMode}
      />
    )

    await user.click(screen.getByRole('button', { name: /Mass Action/i }))
    expect(onEnterSelectionMode).toHaveBeenCalledTimes(1)
  })

  it('calls onExitSelectionMode when the X button is clicked', async () => {
    const onExitSelectionMode = vi.fn()
    const user = userEvent.setup()

    render(
      <RegressionsBulkActions
        {...defaultProps}
        onExitSelectionMode={onExitSelectionMode}
      />
    )

    await user.click(screen.getByTestId('selection-close'))
    expect(onExitSelectionMode).toHaveBeenCalledTimes(1)
  })

  it('renders the bulk action menu items when the trigger is opened', async () => {
    const user = userEvent.setup()

    render(<RegressionsBulkActions {...defaultProps} />)

    await user.click(screen.getByTestId('selection-counter'))

    // Default menu items wired by BulkActionMenuItems
    expect(screen.getByTestId('bulk-action-run')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-action-duplicate')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument()
  })

  it('disables action items when selectedCount is 0', async () => {
    const user = userEvent.setup()

    render(<RegressionsBulkActions {...defaultProps} selectedCount={0} />)

    await user.click(screen.getByTestId('selection-counter'))

    expect(screen.getByTestId('bulk-action-run')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByTestId('bulk-action-delete')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
