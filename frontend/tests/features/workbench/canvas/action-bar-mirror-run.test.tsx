/**
 * CanvasActionBar - watcher toolbar during a mirrored run (RUNM-4).
 *
 * A watcher holds no run control. While the holder's run is in flight the
 * right-hand side collapses to two things: the RUN's environment as a read-only
 * readout (never the watcher's own local selection) and Focus Current, which only
 * moves the viewport. The left editing group stays visible and disabled, exactly
 * as it is in any mirror.
 *
 * Components under test:
 * frontend/src/features/workbench/common/canvas/canvas-action-bar/action-bar.tsx
 * frontend/src/features/workbench/common/canvas/canvas-action-bar/focus-current-button.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CanvasActionBar } from '@/features/workbench/common/canvas/canvas-action-bar/action-bar'
import { FocusCurrentButton } from '@/features/workbench/common/canvas/canvas-action-bar/focus-current-button'

const RUN_CONTROL_TESTIDS = [
  'run-button',
  'debug-button',
  'action-stop-button',
  'action-step-over-button',
  'action-step-into-button',
  'action-continue-button',
  'action-skip-block-button',
  'action-repeat-step-button',
]

function renderBar(props: Record<string, unknown> = {}) {
  return render(
    <>
      <CanvasActionBar
        status="idle"
        isDirty
        canUndo
        canRedo
        isEditingTest
        selectedEnvironment="env-local"
        availableEnvironments={[
          { id: 'env-local', name: 'My Local Pick' },
          { id: 'env-run', name: 'Staging' },
        ]}
        {...props}
      />
    </>,
  )
}

const MIRRORED_RUN = { environmentName: 'Staging', hasCurrentBlock: true }

describe('CanvasActionBar - mirrored run state', () => {
  it('shows the run environment as a read-only readout', () => {
    renderBar({ editingLocked: true, mirroredRun: MIRRORED_RUN })

    const readout = screen.getByTestId('environment-selector')
    expect(readout).toHaveTextContent('Env:')
    expect(readout).toHaveTextContent('Staging')
    expect(readout).toBeDisabled()
  })

  it("shows the run's environment, not the watcher's own local selection", () => {
    renderBar({ editingLocked: true, mirroredRun: MIRRORED_RUN })

    expect(screen.getByTestId('environment-selector')).not.toHaveTextContent('My Local Pick')
  })

  it('falls back to None when the run recorded no environment', () => {
    renderBar({
      editingLocked: true,
      mirroredRun: { environmentName: null, hasCurrentBlock: true },
    })

    expect(screen.getByTestId('environment-selector')).toHaveTextContent('None')
  })

  it('renders Focus Current as the only enabled right-side control', () => {
    renderBar({ editingLocked: true, mirroredRun: MIRRORED_RUN })

    expect(screen.getByTestId('action-focus-current-button')).toBeEnabled()
  })

  it('disables Focus Current until a current block is known', () => {
    renderBar({
      editingLocked: true,
      mirroredRun: { environmentName: 'Staging', hasCurrentBlock: false },
    })

    expect(screen.getByTestId('action-focus-current-button')).toBeDisabled()
  })

  it('calls onFocusCurrent when the watcher recenters', async () => {
    const user = userEvent.setup()
    const onFocusCurrent = vi.fn()
    renderBar({ editingLocked: true, mirroredRun: MIRRORED_RUN, onFocusCurrent })

    await user.click(screen.getByTestId('action-focus-current-button'))

    expect(onFocusCurrent).toHaveBeenCalledTimes(1)
  })

  it.each(RUN_CONTROL_TESTIDS)('never renders %s for a watcher', (testId) => {
    renderBar({ editingLocked: true, mirroredRun: MIRRORED_RUN })

    expect(screen.queryByTestId(testId)).not.toBeInTheDocument()
  })

  it('never renders the debug options gear for a watcher', () => {
    renderBar({ editingLocked: true, mirroredRun: MIRRORED_RUN })

    expect(screen.queryByTestId('debug-options-gear')).not.toBeInTheDocument()
  })

  it('keeps the left editing group visible and disabled', () => {
    renderBar({ editingLocked: true, mirroredRun: MIRRORED_RUN })

    expect(screen.getByTestId('toolbar-save-button')).toBeDisabled()
    expect(screen.getByTestId('toolbar-edit-button')).toBeDisabled()
    expect(screen.getByTestId('toolbar-undo-button')).toBeDisabled()
    expect(screen.getByTestId('toolbar-redo-button')).toBeDisabled()
  })

  it('ignores the watcher tab local status - the run state drives the branch', () => {
    renderBar({ status: 'passed', editingLocked: true, mirroredRun: MIRRORED_RUN })

    expect(screen.getByTestId('action-focus-current-button')).toBeInTheDocument()
    expect(screen.queryByTestId('run-button')).not.toBeInTheDocument()
  })
})

describe('CanvasActionBar - states the mirrored run does not change', () => {
  it('keeps the draft-mirror rendering when no run is announced', () => {
    renderBar({ editingLocked: true, mirroredRun: null })

    expect(screen.getByTestId('run-button')).toBeDisabled()
    expect(screen.getByTestId('debug-button')).toBeDisabled()
    expect(screen.getByTestId('environment-selector')).toBeDisabled()
    expect(screen.getByTestId('debug-options-gear')).toBeDisabled()
    expect(screen.getByTestId('environment-selector')).not.toHaveTextContent('Env:')
  })

  it('never strips an unlocked tab of its own controls', () => {
    renderBar({ editingLocked: false, mirroredRun: MIRRORED_RUN })

    expect(screen.getByTestId('run-button')).toBeEnabled()
    expect(screen.getByTestId('debug-button')).toBeEnabled()
  })

  it('keeps Focus Current enabled in the holder running state', () => {
    renderBar({ status: 'running' })

    expect(screen.getByTestId('action-focus-current-button')).toBeEnabled()
    expect(screen.getByTestId('action-stop-button')).toBeInTheDocument()
  })

  it('keeps Focus Current enabled in the holder paused state', () => {
    renderBar({ status: 'paused' })

    expect(screen.getByTestId('action-focus-current-button')).toBeEnabled()
    expect(screen.getByTestId('action-step-over-button')).toBeInTheDocument()
  })
})

describe('FocusCurrentButton', () => {
  it('renders the promoted control with its established test id', () => {
    render(<FocusCurrentButton />)

    expect(screen.getByTestId('action-focus-current-button')).toHaveTextContent('Focus Current')
  })

  it('is enabled by default', () => {
    render(<FocusCurrentButton />)

    expect(screen.getByTestId('action-focus-current-button')).toBeEnabled()
  })

  it('fires its handler on click', async () => {
    const user = userEvent.setup()
    const onFocusCurrent = vi.fn()
    render(<FocusCurrentButton onFocusCurrent={onFocusCurrent} />)

    await user.click(screen.getByTestId('action-focus-current-button'))

    expect(onFocusCurrent).toHaveBeenCalledTimes(1)
  })

  it('renders without a handler and does not throw on click', async () => {
    const user = userEvent.setup()
    render(<FocusCurrentButton />)

    await user.click(screen.getByTestId('action-focus-current-button'))

    expect(screen.getByTestId('action-focus-current-button')).toBeInTheDocument()
  })

  it('uses the native disabled state so it inherits app-wide disabled styling', () => {
    render(<FocusCurrentButton disabled />)

    const button = screen.getByTestId('action-focus-current-button')
    expect(button).toBeDisabled()
    expect(button).not.toHaveAttribute('aria-disabled')
  })
})
