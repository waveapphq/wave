/**
 * CanvasActionBar - Paused + Running toolbar state
 *
 *   Paused toolbar: must render, in order,
 *       Step Over | Step Into | Repeat Step | Continue |
 *       Skip Block | Stop | Focus Current
 *
 *   Running toolbar: the Pause button is HIDDEN.
 *     Only Stop and Focus Current remain.
 *
 * Also covers this ``CanvasActionBarProps`` surface:
 *   - ``onSkipBlock?: () => void`` fires when the Skip Block button in the
 *     Paused toolbar is clicked.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CanvasActionBar } from '@/features/workbench/common/canvas/canvas-action-bar/index'

describe('CanvasActionBar - Paused state', () => {
  it('renders Skip Block button in the Paused toolbar', () => {
    render(<CanvasActionBar status="paused" />)

    expect(screen.getByTestId('action-skip-block-button')).toBeInTheDocument()
  })

  it('renders Step Over enabled in Paused state', () => {
    render(<CanvasActionBar status="paused" />)

    const stepOver = screen.getByTestId('action-step-over-button')
    expect(stepOver).toBeInTheDocument()
    expect(stepOver).not.toBeDisabled()
  })

  it('renders Step Into enabled in Paused state', () => {
    render(<CanvasActionBar status="paused" />)

    const stepInto = screen.getByTestId('action-step-into-button')
    expect(stepInto).toBeInTheDocument()
    expect(stepInto).not.toBeDisabled()
  })

  it('renders Continue enabled in Paused state', () => {
    render(<CanvasActionBar status="paused" />)

    const continueBtn = screen.getByTestId('action-continue-button')
    expect(continueBtn).toBeInTheDocument()
    expect(continueBtn).not.toBeDisabled()
  })

  it('renders Stop and Focus Current in Paused state', () => {
    render(<CanvasActionBar status="paused" />)

    expect(screen.getByTestId('action-stop-button')).toBeInTheDocument()
    expect(screen.getByTestId('action-focus-current-button')).toBeInTheDocument()
  })

  it('calls onSkipBlock when Skip Block button clicked in Paused state', async () => {
    const user = userEvent.setup()
    const onSkipBlock = vi.fn()
    render(<CanvasActionBar status="paused" onSkipBlock={onSkipBlock} />)

    await user.click(screen.getByTestId('action-skip-block-button'))

    expect(onSkipBlock).toHaveBeenCalledOnce()
  })

  it('calls onContinue when Continue button clicked in Paused state', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    render(<CanvasActionBar status="paused" onContinue={onContinue} />)

    await user.click(screen.getByTestId('action-continue-button'))

    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('Step Over click dispatches onStepOver', async () => {
    const user = userEvent.setup()
    const onStepOver = vi.fn()
    render(<CanvasActionBar status="paused" onStepOver={onStepOver} />)

    await user.click(screen.getByTestId('action-step-over-button'))

    expect(onStepOver).toHaveBeenCalledOnce()
  })

  it('Step Into click dispatches onStepInto', async () => {
    const user = userEvent.setup()
    const onStepInto = vi.fn()
    render(<CanvasActionBar status="paused" onStepInto={onStepInto} />)

    await user.click(screen.getByTestId('action-step-into-button'))

    expect(onStepInto).toHaveBeenCalledOnce()
  })

  it('Stop can be triggered from Paused state with Immediate mode', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    render(<CanvasActionBar status="paused" onStop={onStop} />)

    await user.click(screen.getByTestId('action-stop-button'))

    expect(onStop).toHaveBeenCalledExactlyOnceWith('immediate')
  })

  it('Stop dropdown offers Finalization from Paused state', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    render(<CanvasActionBar status="paused" onStop={onStop} />)

    await user.click(screen.getByTestId('action-stop-button-dropdown'))
    await user.click(screen.getByTestId('action-stop-finalize-option'))

    expect(onStop).toHaveBeenLastCalledWith('finalize')
  })

  it('does NOT render the Pause button in Paused state', () => {
    render(<CanvasActionBar status="paused" />)

    expect(screen.queryByTestId('action-pause-button')).not.toBeInTheDocument()
  })
})

describe('CanvasActionBar - Running state', () => {
  it('does NOT render the Pause button in Running state', () => {
    render(<CanvasActionBar status="running" />)

    expect(screen.queryByTestId('action-pause-button')).not.toBeInTheDocument()
  })

  it('still renders Stop in Running state', () => {
    render(<CanvasActionBar status="running" />)

    expect(screen.getByTestId('action-stop-button')).toBeInTheDocument()
  })

  it('still renders Focus Current in Running state', () => {
    render(<CanvasActionBar status="running" />)

    expect(screen.getByTestId('action-focus-current-button')).toBeInTheDocument()
  })

  it('does not render the Paused-state toolbar while Running', () => {
    render(<CanvasActionBar status="running" />)

    expect(screen.queryByTestId('action-step-over-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('action-step-into-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('action-continue-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('action-skip-block-button')).not.toBeInTheDocument()
  })
})

describe('CanvasActionBar - Paused controls tab order', () => {
  it('places buttons in the tab order: Step Over -> Step Into -> Repeat Step -> Continue -> Skip Block -> Stop -> Focus Current', () => {
    render(<CanvasActionBar status="paused" />)

    const ids = [
      'action-step-over-button',
      'action-step-into-button',
      'action-repeat-step-button',
      'action-continue-button',
      'action-skip-block-button',
      'action-stop-button',
      'action-focus-current-button',
    ]
    const elements = ids.map((id) => screen.getByTestId(id))

    // DOM order should match tab order
    for (let i = 0; i < elements.length - 1; i++) {
      const current = elements[i]
      const next = elements[i + 1]
      expect(
        current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
  })
})
