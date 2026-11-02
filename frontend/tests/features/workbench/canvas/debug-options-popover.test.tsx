/**
 * DebugOptionsPopover - REQ-3.2.1.2
 *
 * Contract for the Debug Options gear popover:
 *   - The store's ``debugOptions`` uses ``pauseOnFirstBlock`` and
 *     ``pauseOnErrors`` (matches backend ``pause_on_first_block`` /
 *     ``pause_on_errors``).
 *   - The popover reads/writes through ``onDebugOptionsChange`` with the
 *     same shape.
 *   - Gear icon renders in the primary (blue) color when either option is
 *     enabled, and in default/ghost coloring otherwise (DEBUG-4).
 *   - Both checkboxes default to unchecked.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DebugOptionsPopover } from '@/features/workbench/common/canvas/canvas-action-bar/debug-options-popover'

describe('DebugOptionsPopover', () => {
  it('renders the gear trigger and sr-only label', async () => {
    render(
      <DebugOptionsPopover
        debugOptions={{ pauseOnFirstBlock: false, pauseOnErrors: false }}
      />
    )

    expect(screen.getByTestId('debug-options-gear')).toBeInTheDocument()
    expect(screen.getByText(/Debug Options/i)).toBeInTheDocument()
  })

  it('opens the popover with two checkboxes, both unchecked by default', async () => {
    const user = userEvent.setup()
    render(
      <DebugOptionsPopover
        debugOptions={{ pauseOnFirstBlock: false, pauseOnErrors: false }}
      />
    )

    await user.click(screen.getByTestId('debug-options-gear'))

    const firstBlock = screen.getByTestId('pause-on-first-checkbox')
    const errors = screen.getByTestId('pause-on-errors-checkbox')
    expect(firstBlock).toBeInTheDocument()
    expect(errors).toBeInTheDocument()
    expect(firstBlock).toHaveAttribute('data-state', 'unchecked')
    expect(errors).toHaveAttribute('data-state', 'unchecked')
  })

  it('renders "Pause on first block" and "Pause on errors" labels', async () => {
    const user = userEvent.setup()
    render(
      <DebugOptionsPopover
        debugOptions={{ pauseOnFirstBlock: false, pauseOnErrors: false }}
      />
    )

    await user.click(screen.getByTestId('debug-options-gear'))

    expect(screen.getByText(/^Pause on first block$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Pause on errors$/i)).toBeInTheDocument()
  })

  it('calls onDebugOptionsChange with pauseOnFirstBlock=true when first checkbox is checked', async () => {
    const user = userEvent.setup()
    const onDebugOptionsChange = vi.fn()
    render(
      <DebugOptionsPopover
        debugOptions={{ pauseOnFirstBlock: false, pauseOnErrors: false }}
        onDebugOptionsChange={onDebugOptionsChange}
      />
    )

    await user.click(screen.getByTestId('debug-options-gear'))
    await user.click(screen.getByTestId('pause-on-first-checkbox'))

    expect(onDebugOptionsChange).toHaveBeenCalledWith({
      pauseOnFirstBlock: true,
      pauseOnErrors: false,
    })
  })

  it('calls onDebugOptionsChange with pauseOnErrors=true when errors checkbox is checked', async () => {
    const user = userEvent.setup()
    const onDebugOptionsChange = vi.fn()
    render(
      <DebugOptionsPopover
        debugOptions={{ pauseOnFirstBlock: false, pauseOnErrors: false }}
        onDebugOptionsChange={onDebugOptionsChange}
      />
    )

    await user.click(screen.getByTestId('debug-options-gear'))
    await user.click(screen.getByTestId('pause-on-errors-checkbox'))

    expect(onDebugOptionsChange).toHaveBeenCalledWith({
      pauseOnFirstBlock: false,
      pauseOnErrors: true,
    })
  })

  it('reflects pauseOnFirstBlock=true in the checked state', async () => {
    const user = userEvent.setup()
    render(
      <DebugOptionsPopover
        debugOptions={{ pauseOnFirstBlock: true, pauseOnErrors: false }}
      />
    )

    await user.click(screen.getByTestId('debug-options-gear'))

    expect(screen.getByTestId('pause-on-first-checkbox')).toHaveAttribute(
      'data-state',
      'checked'
    )
    expect(screen.getByTestId('pause-on-errors-checkbox')).toHaveAttribute(
      'data-state',
      'unchecked'
    )
  })

  it('reflects pauseOnErrors=true in the checked state', async () => {
    const user = userEvent.setup()
    render(
      <DebugOptionsPopover
        debugOptions={{ pauseOnFirstBlock: false, pauseOnErrors: true }}
      />
    )

    await user.click(screen.getByTestId('debug-options-gear'))

    expect(screen.getByTestId('pause-on-errors-checkbox')).toHaveAttribute(
      'data-state',
      'checked'
    )
  })

  it('gear icon renders in the primary (blue accent) color when any option is active', async () => {
    render(
      <DebugOptionsPopover
        debugOptions={{ pauseOnFirstBlock: true, pauseOnErrors: false }}
      />
    )

    expect(screen.getByTestId('debug-options-gear').className).toContain(
      'text-primary'
    )
  })

  it('gear icon is NOT blue when both options are false', async () => {
    render(
      <DebugOptionsPopover
        debugOptions={{ pauseOnFirstBlock: false, pauseOnErrors: false }}
      />
    )

    expect(screen.getByTestId('debug-options-gear').className).not.toContain(
      'text-primary'
    )
  })

  it('un-checking a checkbox fires onDebugOptionsChange with that field=false', async () => {
    const user = userEvent.setup()
    const onDebugOptionsChange = vi.fn()
    render(
      <DebugOptionsPopover
        debugOptions={{ pauseOnFirstBlock: true, pauseOnErrors: true }}
        onDebugOptionsChange={onDebugOptionsChange}
      />
    )

    await user.click(screen.getByTestId('debug-options-gear'))
    await user.click(screen.getByTestId('pause-on-first-checkbox'))

    expect(onDebugOptionsChange).toHaveBeenCalledWith({
      pauseOnFirstBlock: false,
      pauseOnErrors: true,
    })
  })
})
