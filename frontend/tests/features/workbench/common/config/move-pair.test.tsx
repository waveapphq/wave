/**
 * MovePair and RowActionButton - the shared reorder pair and the icon button
 * behind it, used by the branch cards and by the Arguments list.
 *
 * Design Reference:
 * SHRUN-4 (Arguments rows reorder with the branch-row arrow pair).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  MovePair,
  RowActionButton,
} from '@/features/workbench/common/config/move-pair'
import { CanvasReadOnlyProvider } from '@/features/workbench/common/canvas/read-only-context'

function renderPair(overrides: Partial<React.ComponentProps<typeof MovePair>> = {}) {
  const onMove = (overrides.onMove ?? vi.fn()) as ReturnType<typeof vi.fn>
  const onParentClick = vi.fn()
  render(
    <div data-testid="parent-surface" onClick={onParentClick}>
      <MovePair
        canMoveUp
        canMoveDown
        upLabel="Move argument 2 up"
        downLabel="Move argument 2 down"
        upTestId="ordered-arguments-move-up-1"
        downTestId="ordered-arguments-move-down-1"
        {...overrides}
        onMove={onMove}
      />
    </div>,
  )
  return { onMove, onParentClick }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MovePair', () => {
  describe('Rendering', () => {
    it('renders both arrows under the given test ids', () => {
      renderPair()

      expect(screen.getByTestId('ordered-arguments-move-up-1')).toBeInTheDocument()
      expect(screen.getByTestId('ordered-arguments-move-down-1')).toBeInTheDocument()
    })

    it('names each arrow from its label prop', () => {
      renderPair()

      expect(screen.getByTestId('ordered-arguments-move-up-1')).toHaveAttribute(
        'aria-label',
        'Move argument 2 up',
      )
      expect(screen.getByTestId('ordered-arguments-move-down-1')).toHaveAttribute(
        'aria-label',
        'Move argument 2 down',
      )
    })

    it('takes the branch-card labels unchanged', () => {
      renderPair({
        upLabel: 'Move branch up',
        downLabel: 'Move branch down',
        upTestId: 'branch-move-up-branch_0',
        downTestId: 'branch-move-down-branch_0',
      })

      expect(screen.getByTestId('branch-move-up-branch_0')).toHaveAttribute(
        'aria-label',
        'Move branch up',
      )
      expect(screen.getByTestId('branch-move-down-branch_0')).toHaveAttribute(
        'aria-label',
        'Move branch down',
      )
    })
  })

  describe('Move direction', () => {
    it('reports up when the up arrow is clicked', async () => {
      const user = userEvent.setup()
      const { onMove } = renderPair()

      await user.click(screen.getByTestId('ordered-arguments-move-up-1'))

      expect(onMove).toHaveBeenCalledTimes(1)
      expect(onMove).toHaveBeenCalledWith('up')
    })

    it('reports down when the down arrow is clicked', async () => {
      const user = userEvent.setup()
      const { onMove } = renderPair()

      await user.click(screen.getByTestId('ordered-arguments-move-down-1'))

      expect(onMove).toHaveBeenCalledTimes(1)
      expect(onMove).toHaveBeenCalledWith('down')
    })
  })

  describe('Ends of the list', () => {
    it('enables both arrows in the middle of a list', () => {
      renderPair({ canMoveUp: true, canMoveDown: true })

      expect(screen.getByTestId('ordered-arguments-move-up-1')).not.toBeDisabled()
      expect(screen.getByTestId('ordered-arguments-move-down-1')).not.toBeDisabled()
    })

    it('disables the up arrow on the first row', () => {
      renderPair({ canMoveUp: false, canMoveDown: true })

      expect(screen.getByTestId('ordered-arguments-move-up-1')).toBeDisabled()
      expect(screen.getByTestId('ordered-arguments-move-down-1')).not.toBeDisabled()
    })

    it('disables the down arrow on the last row', () => {
      renderPair({ canMoveUp: true, canMoveDown: false })

      expect(screen.getByTestId('ordered-arguments-move-up-1')).not.toBeDisabled()
      expect(screen.getByTestId('ordered-arguments-move-down-1')).toBeDisabled()
    })

    it('marks a disabled arrow with the family disabled look', () => {
      renderPair({ canMoveUp: false, canMoveDown: false })

      const upButton = screen.getByTestId('ordered-arguments-move-up-1')
      const downButton = screen.getByTestId('ordered-arguments-move-down-1')

      expect(upButton).toBeDisabled()
      expect(upButton.className).toContain('opacity-50')
      expect(upButton.className).toContain('cursor-not-allowed')
      expect(downButton).toBeDisabled()
      expect(downButton.className).toContain('opacity-50')
      expect(downButton.className).toContain('cursor-not-allowed')
    })

    it('reports no move from a disabled arrow', async () => {
      const user = userEvent.setup()
      const { onMove } = renderPair({ canMoveUp: false, canMoveDown: false })

      await user.click(screen.getByTestId('ordered-arguments-move-up-1'))
      await user.click(screen.getByTestId('ordered-arguments-move-down-1'))

      expect(onMove).not.toHaveBeenCalled()
    })
  })

  describe('Click containment', () => {
    it('keeps an arrow click off the surface the pair sits in', async () => {
      const user = userEvent.setup()
      const { onMove, onParentClick } = renderPair()

      await user.click(screen.getByTestId('ordered-arguments-move-down-1'))

      expect(onMove).toHaveBeenCalledWith('down')
      expect(onParentClick).not.toHaveBeenCalled()
    })
  })
})

describe('RowActionButton', () => {
  function renderAction(
    overrides: Partial<React.ComponentProps<typeof RowActionButton>> = {},
  ) {
    const onClick = (overrides.onClick ?? vi.fn()) as ReturnType<typeof vi.fn>
    const onParentClick = vi.fn()
    render(
      <div data-testid="parent-surface" onClick={onParentClick}>
        <RowActionButton
          testId="ordered-arguments-remove-0"
          ariaLabel="Remove argument 1"
          {...overrides}
          onClick={onClick}
        >
          <span data-testid="action-glyph">x</span>
        </RowActionButton>
      </div>,
    )
    return { onClick, onParentClick }
  }

  it('renders its children inside the button', () => {
    renderAction()

    const button = screen.getByTestId('ordered-arguments-remove-0')
    expect(button).toContainElement(screen.getByTestId('action-glyph'))
  })

  it('names the button from the label prop', () => {
    renderAction()

    expect(screen.getByTestId('ordered-arguments-remove-0')).toHaveAttribute(
      'aria-label',
      'Remove argument 1',
    )
  })

  it('is a non-submitting button', () => {
    renderAction()

    expect(screen.getByTestId('ordered-arguments-remove-0')).toHaveAttribute('type', 'button')
  })

  it('is enabled when no disabled state is given', () => {
    renderAction()

    const button = screen.getByTestId('ordered-arguments-remove-0')
    expect(button).not.toBeDisabled()
    expect(button.className).not.toContain('cursor-not-allowed')
  })

  it('calls the click handler', async () => {
    const user = userEvent.setup()
    const { onClick } = renderAction()

    await user.click(screen.getByTestId('ordered-arguments-remove-0'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps its click off the surface it sits in', async () => {
    const user = userEvent.setup()
    const { onClick, onParentClick } = renderAction()

    await user.click(screen.getByTestId('ordered-arguments-remove-0'))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('calls nothing while disabled', async () => {
    const user = userEvent.setup()
    const { onClick } = renderAction({ disabled: true })

    await user.click(screen.getByTestId('ordered-arguments-remove-0'))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('takes the disabled look while disabled', () => {
    renderAction({ disabled: true })

    const button = screen.getByTestId('ordered-arguments-remove-0')
    expect(button).toBeDisabled()
    expect(button.className).toContain('opacity-50')
    expect(button.className).toContain('cursor-not-allowed')
  })

  it('keeps the caller class alongside its own', () => {
    renderAction({ className: 'hover:text-destructive' })

    expect(screen.getByTestId('ordered-arguments-remove-0').className).toContain(
      'hover:text-destructive',
    )
  })

  it('takes the disabled look and drops the caller hover on a read-only canvas', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <CanvasReadOnlyProvider value>
        <RowActionButton
          testId="ordered-arguments-remove-0"
          ariaLabel="Remove argument 1"
          onClick={onClick}
          className="hover:text-destructive"
        >
          <span>x</span>
        </RowActionButton>
      </CanvasReadOnlyProvider>,
    )

    const button = screen.getByTestId('ordered-arguments-remove-0')
    expect(button).toBeDisabled()
    expect(button.className).toContain('opacity-50')
    expect(button.className).toContain('cursor-not-allowed')
    expect(button.className).not.toContain('hover:text-destructive')
    expect(button.className).not.toContain('hover:text-foreground')
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('arrow pair takes the disabled look on a read-only canvas', () => {
    render(
      <CanvasReadOnlyProvider value>
        <MovePair
          canMoveUp
          canMoveDown
          onMove={vi.fn()}
          upLabel="Move argument 2 up"
          downLabel="Move argument 2 down"
          upTestId="ordered-arguments-move-up-1"
          downTestId="ordered-arguments-move-down-1"
        />
      </CanvasReadOnlyProvider>,
    )

    for (const testId of ['ordered-arguments-move-up-1', 'ordered-arguments-move-down-1']) {
      const button = screen.getByTestId(testId)
      expect(button).toBeDisabled()
      expect(button.className).toContain('opacity-50')
    }
  })
})
