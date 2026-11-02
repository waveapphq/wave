/**
 * Paused Toolbar Tests - Debug Step/Repeat + Context-Aware Skip
 *
 * Contract:
 *  - Button order while paused: [Step Over] [Step Into] [Repeat Step]
 *    [Continue] [Skip Block] [Stop ▾] [Focus Current].
 *  - Step Over / Step Into / Repeat Step are enabled in paused state and
 *    dispatch their respective handlers when clicked.
 *  - Repeat Step stays enabled regardless of pause reason (breakpoint,
 *    first_block, error, step, step_complete).
 *  - Skip Block is context-aware disabled when ``pausedElementType ∈
 *    {'if-else', 'assert-split'}`` and its ``title`` attribute
 *    carries the exact copy "Cannot skip branching block; step into a branch
 *    and skip a leaf inside". Disabled Skip Block uses ``aria-disabled="true"``
 *    (not the HTML ``disabled`` attribute) so screen readers keep focus on it.
 *  - Switch is a container with a guaranteed ``then`` egress, so it is
 *    NOT diverging: Skip Block stays enabled, untooltipped and dispatching.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CanvasActionBar } from '@/features/workbench/common/canvas/canvas-action-bar/action-bar'

const SKIP_BLOCK_DISABLED_TOOLTIP =
  'Cannot skip branching block; step into a branch and skip a leaf inside'

describe('Paused Toolbar - button order', () => {
  it('renders the seven paused-state buttons left-to-right in order', () => {
    render(<CanvasActionBar status="paused" />)

    const toolbar = screen.getByTestId('toolbar-right-group')
    const expectedOrder = [
      'action-step-over-button',
      'action-step-into-button',
      'action-repeat-step-button',
      'action-continue-button',
      'action-skip-block-button',
      'action-stop-button',
      'action-focus-current-button',
    ]

    const renderedOrder = Array.from(
      toolbar.querySelectorAll<HTMLElement>('[data-testid^="action-"]')
    )
      .map((el) => el.getAttribute('data-testid'))
      .filter((id): id is string => !!id && expectedOrder.includes(id))

    expect(renderedOrder).toEqual(expectedOrder)
  })

  it('renders the Repeat Step button in the paused state', () => {
    render(<CanvasActionBar status="paused" />)
    expect(screen.getByTestId('action-repeat-step-button')).toBeInTheDocument()
  })

  it('does not render the Repeat Step button in running state', () => {
    render(<CanvasActionBar status="running" />)
    expect(screen.queryByTestId('action-repeat-step-button')).not.toBeInTheDocument()
  })

  it('does not render the Repeat Step button in idle state', () => {
    render(<CanvasActionBar status="idle" />)
    expect(screen.queryByTestId('action-repeat-step-button')).not.toBeInTheDocument()
  })
})

describe('Paused Toolbar - Step Over dispatch', () => {
  it('Step Over is enabled while paused', () => {
    render(<CanvasActionBar status="paused" />)
    expect(screen.getByTestId('action-step-over-button')).not.toBeDisabled()
  })

  it('calls onStepOver exactly once when clicked', async () => {
    const user = userEvent.setup()
    const onStepOver = vi.fn()
    render(<CanvasActionBar status="paused" onStepOver={onStepOver} />)

    await user.click(screen.getByTestId('action-step-over-button'))
    expect(onStepOver).toHaveBeenCalledExactlyOnceWith()
  })
})

describe('Paused Toolbar - Step Into dispatch', () => {
  it('Step Into is enabled while paused', () => {
    render(<CanvasActionBar status="paused" />)
    expect(screen.getByTestId('action-step-into-button')).not.toBeDisabled()
  })

  it('calls onStepInto exactly once when clicked', async () => {
    const user = userEvent.setup()
    const onStepInto = vi.fn()
    render(<CanvasActionBar status="paused" onStepInto={onStepInto} />)

    await user.click(screen.getByTestId('action-step-into-button'))
    expect(onStepInto).toHaveBeenCalledExactlyOnceWith()
  })
})

describe('Paused Toolbar - Repeat Step dispatch', () => {
  it('Repeat Step is enabled while paused (regardless of pause reason)', () => {
    render(<CanvasActionBar status="paused" />)
    expect(screen.getByTestId('action-repeat-step-button')).not.toBeDisabled()
  })

  it('calls onRepeatStep exactly once when clicked', async () => {
    const user = userEvent.setup()
    const onRepeatStep = vi.fn()
    render(<CanvasActionBar status="paused" onRepeatStep={onRepeatStep} />)

    await user.click(screen.getByTestId('action-repeat-step-button'))
    expect(onRepeatStep).toHaveBeenCalledExactlyOnceWith()
  })

  it('remains enabled after Repeat on a diverging parent (if-else)', () => {
    render(<CanvasActionBar status="paused" pausedElementType="if-else" />)
    expect(screen.getByTestId('action-repeat-step-button')).not.toBeDisabled()
  })
})

describe('Paused Toolbar - Skip Block context-aware disable', () => {
  it('Skip Block is enabled for a leaf plugin paused state', () => {
    render(<CanvasActionBar status="paused" pausedElementType="log" />)
    const btn = screen.getByTestId('action-skip-block-button')
    expect(btn).not.toBeDisabled()
    expect(btn.getAttribute('aria-disabled')).not.toBe('true')
  })

  it('Skip Block is enabled for a For-loop paused-BEFORE', () => {
    render(<CanvasActionBar status="paused" pausedElementType="for" />)
    const btn = screen.getByTestId('action-skip-block-button')
    expect(btn).not.toBeDisabled()
    expect(btn.getAttribute('aria-disabled')).not.toBe('true')
  })

  it('Skip Block is aria-disabled and has the exact tooltip text for if-else', () => {
    render(<CanvasActionBar status="paused" pausedElementType="if-else" />)

    const btn = screen.getByTestId('action-skip-block-button')
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn).not.toHaveAttribute('title')
    fireEvent.focus(btn)
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
      SKIP_BLOCK_DISABLED_TOOLTIP,
    )
  })

  it('Skip Block is aria-disabled and has the exact tooltip text for assert-split', () => {
    render(<CanvasActionBar status="paused" pausedElementType="assert-split" />)

    const btn = screen.getByTestId('action-skip-block-button')
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn).not.toHaveAttribute('title')
    fireEvent.focus(btn)
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
      SKIP_BLOCK_DISABLED_TOOLTIP,
    )
  })

  // Guard: Switch sat in the diverging set, so Skip was refused on it.
  it('Skip Block is enabled and untooltipped for a paused Switch container', () => {
    render(<CanvasActionBar status="paused" pausedElementType="switch" />)

    const btn = screen.getByTestId('action-skip-block-button')
    expect(btn).not.toBeDisabled()
    expect(btn).not.toHaveAttribute('aria-disabled')
    expect(btn).not.toHaveAttribute('title')
    expect(btn.className).not.toContain('cursor-not-allowed')
    expect(btn.className).not.toContain('opacity-50')
    expect(btn.className).not.toContain('hover:bg-transparent')
  })

  it('Skip Block dispatches onSkipBlock for a paused Switch', async () => {
    const user = userEvent.setup()
    const onSkipBlock = vi.fn()
    render(
      <CanvasActionBar
        status="paused"
        pausedElementType="switch"
        onSkipBlock={onSkipBlock}
      />
    )

    await user.click(screen.getByTestId('action-skip-block-button'))
    expect(onSkipBlock).toHaveBeenCalledExactlyOnceWith()
  })

  it('Skip Block does not dispatch onSkipBlock when aria-disabled (if-else)', async () => {
    const user = userEvent.setup()
    const onSkipBlock = vi.fn()
    render(
      <CanvasActionBar
        status="paused"
        pausedElementType="if-else"
        onSkipBlock={onSkipBlock}
      />
    )

    await user.click(screen.getByTestId('action-skip-block-button'))
    expect(onSkipBlock).not.toHaveBeenCalled()
  })

  it('Skip Block remains focusable with aria-disabled="true" (not HTML disabled)', () => {
    render(<CanvasActionBar status="paused" pausedElementType="if-else" />)

    const btn = screen.getByTestId('action-skip-block-button')
    expect(btn).not.toHaveAttribute('disabled')
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0)
  })
})

describe('Paused Toolbar - labels stay whole, buttons move to a second row', () => {
  const PAUSED_LABELS = ['Step Over', 'Step Into', 'Repeat Step', 'Continue', 'Skip Block', 'Stop', 'Focus Current']

  it('keeps every button label on one line', () => {
    render(<CanvasActionBar status="paused" />)
    const toolbar = screen.getByTestId('canvas-toolbar')
    expect(toolbar).toHaveClass('whitespace-nowrap')
    for (const label of PAUSED_LABELS) {
      expect(toolbar).toContainElement(screen.getByText(label))
    }
  })

  it('wraps the button group as whole buttons, right-aligned, with the same 8px gap', () => {
    render(<CanvasActionBar status="paused" />)
    expect(screen.getByTestId('toolbar-right-group')).toHaveClass('flex', 'flex-wrap', 'justify-end', 'gap-2')
  })

  it('stays one 48px row when the buttons fit and grows only when they wrap', () => {
    render(<CanvasActionBar status="paused" />)
    const toolbar = screen.getByTestId('canvas-toolbar')
    expect(toolbar).toHaveClass('min-h-12', 'py-1.5', 'shrink-0')
    expect(toolbar).not.toHaveClass('h-12')
  })
})
