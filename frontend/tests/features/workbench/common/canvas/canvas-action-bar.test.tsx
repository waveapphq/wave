/**
 * Canvas Action Bar Tests
 *
 * Tests for the canvas action bar component that provides workflow controls.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CanvasActionBar } from '@/features/workbench/common/canvas/canvas-action-bar/index'

// The read-only chrome renders via the store-gated DrilledSharedChrome;
// simulate "drilled into a Shared instance" so the chrome variant renders.
// Canvas nodes report a failed Function-body read through the toast; these
// specs render nodes without the app shell that provides one.
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  const { use } = await import('react')
  const fallback = { error: vi.fn() }
  return { ...actual, useToast: () => use(actual.ToastContext) ?? fallback }
})

vi.mock('@/features/workbench/common/canvas/use-readonly-canvas', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/features/workbench/common/canvas/use-readonly-canvas')
  >()
  return {
    ...actual,
    useDrilledSharedInfo: () => ({ nodeId: 'fn-1', editMode: false }),
  }
})

// Valid UUIDs for test environments
const TEST_ENV_IDS = {
  development: 'a1b2c3d4-e5f6-4a5b-8c7d-9e0f1a2b3c4d',
  staging: 'b2c3d4e5-f6a7-4b5c-9d8e-0f1a2b3c4d5e',
  production: 'c3d4e5f6-a7b8-4c5d-0e9f-1a2b3c4d5e6f',
}

// Test environments - used for tests that require environment selection
const TEST_ENVIRONMENTS = [
  { id: TEST_ENV_IDS.development, name: 'Development' },
  { id: TEST_ENV_IDS.staging, name: 'Staging' },
  { id: TEST_ENV_IDS.production, name: 'Production' },
]

describe('CanvasActionBar', () => {
  describe('Left group controls (always visible)', () => {
    it('renders close, save, undo, redo buttons by default', () => {
      render(<CanvasActionBar />)

      expect(screen.getByTestId('toolbar-close-button')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-save-button')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-undo-button')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-redo-button')).toBeInTheDocument()
    })

    it('hides close button when showCloseButton is false', () => {
      render(<CanvasActionBar showCloseButton={false} />)

      expect(screen.queryByTestId('toolbar-close-button')).not.toBeInTheDocument()
      expect(screen.getByTestId('toolbar-save-button')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-undo-button')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-redo-button')).toBeInTheDocument()
    })

    it('hides the Test-only Save/Edit in the library Function View but keeps Close enabled', () => {
      // showTestControls=false: the read-only Function View has no parent Test,
      // so Save/Edit must not render. Close stays (it closes the workflow back to
      // a draft) and is enabled even when not dirty; Undo/Redo remain.
      render(<CanvasActionBar showTestControls={false} />)

      expect(screen.queryByTestId('toolbar-save-button')).not.toBeInTheDocument()
      expect(screen.queryByTestId('toolbar-edit-button')).not.toBeInTheDocument()
      const close = screen.getByTestId('toolbar-close-button')
      expect(close).toBeInTheDocument()
      expect(close).not.toBeDisabled()
      expect(screen.getByTestId('toolbar-undo-button')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-redo-button')).toBeInTheDocument()
    })

    it('calls onClose when close button clicked (dirty state)', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<CanvasActionBar isDirty={true} onClose={onClose} />)

      await user.click(screen.getByTestId('toolbar-close-button'))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('disables close button when not dirty', () => {
      render(<CanvasActionBar isDirty={false} />)
      expect(screen.getByTestId('toolbar-close-button')).toBeDisabled()
    })

    it('enables close button when dirty', () => {
      render(<CanvasActionBar isDirty={true} />)
      expect(screen.getByTestId('toolbar-close-button')).not.toBeDisabled()
    })

    it('disables close button during execution', () => {
      render(<CanvasActionBar status="running" isDirty={true} />)
      expect(screen.getByTestId('toolbar-close-button')).toBeDisabled()
    })

    it('calls onSave when save button clicked (dirty state)', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(<CanvasActionBar isDirty={true} onSave={onSave} />)

      await user.click(screen.getByTestId('toolbar-save-button'))
      expect(onSave).toHaveBeenCalledOnce()
    })

    it('disables save when not dirty', () => {
      render(<CanvasActionBar isDirty={false} />)
      expect(screen.getByTestId('toolbar-save-button')).toBeDisabled()
    })

    it('renders edit button', () => {
      render(<CanvasActionBar />)
      expect(screen.getByTestId('toolbar-edit-button')).toBeInTheDocument()
    })

    it('calls onEdit when edit button clicked (isEditingTest)', async () => {
      const user = userEvent.setup()
      const onEdit = vi.fn()
      render(<CanvasActionBar isEditingTest={true} onEdit={onEdit} />)

      await user.click(screen.getByTestId('toolbar-edit-button'))
      expect(onEdit).toHaveBeenCalledOnce()
    })

    it('disables edit button when not editing test (draft mode)', () => {
      render(<CanvasActionBar isEditingTest={false} />)
      expect(screen.getByTestId('toolbar-edit-button')).toBeDisabled()
    })

    it('enables edit button when editing test', () => {
      render(<CanvasActionBar isEditingTest={true} />)
      expect(screen.getByTestId('toolbar-edit-button')).not.toBeDisabled()
    })

    it('disables edit button during execution', () => {
      render(<CanvasActionBar status="running" isEditingTest={true} />)
      expect(screen.getByTestId('toolbar-edit-button')).toBeDisabled()
    })

    it('calls onUndo when undo button clicked (canUndo)', async () => {
      const user = userEvent.setup()
      const onUndo = vi.fn()
      render(<CanvasActionBar canUndo={true} onUndo={onUndo} />)

      await user.click(screen.getByTestId('toolbar-undo-button'))
      expect(onUndo).toHaveBeenCalledOnce()
    })

    it('calls onRedo when redo button clicked (canRedo)', async () => {
      const user = userEvent.setup()
      const onRedo = vi.fn()
      render(<CanvasActionBar canRedo={true} onRedo={onRedo} />)

      await user.click(screen.getByTestId('toolbar-redo-button'))
      expect(onRedo).toHaveBeenCalledOnce()
    })

    it('follows the execution-aware canUndo/canRedo guards while running', () => {
      // The store guards (canUndo/canRedo) are execution-aware; the toolbar
      // has no local isExecuting OR so keyboard and buttons cannot diverge.
      render(<CanvasActionBar status="running" canUndo={false} canRedo={false} />)

      expect(screen.getByTestId('toolbar-undo-button')).toBeDisabled()
      expect(screen.getByTestId('toolbar-redo-button')).toBeDisabled()
    })
  })

  describe('Idle state controls', () => {
    it('renders environment selector and run/debug buttons', () => {
      render(<CanvasActionBar status="idle" />)

      expect(screen.getByTestId('environment-selector')).toBeInTheDocument()
      expect(screen.getByTestId('debug-options-gear')).toBeInTheDocument()
      expect(screen.getByTestId('debug-button')).toBeInTheDocument()
      expect(screen.getByTestId('run-button')).toBeInTheDocument()
    })

    it('opens environment popover on selector click', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" />)

      await user.click(screen.getByTestId('environment-selector'))
      await waitFor(() => {
        expect(screen.getByTestId('environment-popover')).toBeInTheDocument()
      })
    })

    it('calls onEnvironmentChange when environment selected', async () => {
      const user = userEvent.setup()
      const onEnvironmentChange = vi.fn()
      render(<CanvasActionBar status="idle" availableEnvironments={TEST_ENVIRONMENTS} onEnvironmentChange={onEnvironmentChange} />)

      await user.click(screen.getByTestId('environment-selector'))
      await waitFor(() => {
        expect(screen.getByTestId(`env-${TEST_ENV_IDS.development}`)).toBeInTheDocument()
      })
      await user.click(screen.getByTestId(`env-${TEST_ENV_IDS.development}`))

      expect(onEnvironmentChange).toHaveBeenCalledWith(TEST_ENV_IDS.development)
    })

    it('filters environments by search', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" availableEnvironments={TEST_ENVIRONMENTS} />)

      await user.click(screen.getByTestId('environment-selector'))
      await waitFor(() => {
        expect(screen.getByTestId('environment-search')).toBeInTheDocument()
      })

      await user.type(screen.getByTestId('environment-search'), 'prod')

      expect(screen.getByTestId(`env-${TEST_ENV_IDS.production}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`env-${TEST_ENV_IDS.development}`)).not.toBeInTheDocument()
    })

    it('clears search when clear button clicked', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" availableEnvironments={TEST_ENVIRONMENTS} />)

      await user.click(screen.getByTestId('environment-selector'))
      await user.type(screen.getByTestId('environment-search'), 'xyz')

      // Click clear button
      const clearButton = screen.getByRole('button', { name: /clear search/i })
      await user.click(clearButton)

      expect(screen.getByTestId('environment-search')).toHaveValue('')
    })

    it('shows recent environments when available', async () => {
      const user = userEvent.setup()
      const recentEnvs = [{ id: TEST_ENV_IDS.staging, name: 'Staging' }]
      render(<CanvasActionBar status="idle" recentEnvironments={recentEnvs} />)

      await user.click(screen.getByTestId('environment-selector'))
      await waitFor(() => {
        expect(screen.getByTestId(`env-recent-${TEST_ENV_IDS.staging}`)).toBeInTheDocument()
      })
    })

    it('calls onRememberSelectionChange when checkbox toggled', async () => {
      const user = userEvent.setup()
      const onRememberSelectionChange = vi.fn()
      render(
        <CanvasActionBar
          status="idle"
          onRememberSelectionChange={onRememberSelectionChange}
        />
      )

      await user.click(screen.getByTestId('environment-selector'))
      await waitFor(() => {
        expect(screen.getByTestId('remember-selection-checkbox')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('remember-selection-checkbox'))

      expect(onRememberSelectionChange).toHaveBeenCalledWith(true)
    })

    it('calls onDebugOptionsChange when debug option toggled', async () => {
      const user = userEvent.setup()
      const onDebugOptionsChange = vi.fn()
      render(
        <CanvasActionBar
          status="idle"
          onDebugOptionsChange={onDebugOptionsChange}
        />
      )

      await user.click(screen.getByTestId('debug-options-gear'))
      await waitFor(() => {
        expect(screen.getByTestId('pause-on-first-checkbox')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('pause-on-first-checkbox'))

      expect(onDebugOptionsChange).toHaveBeenCalledWith({
        pauseOnFirstBlock: true,
        pauseOnErrors: false,
      })
    })

    it('calls onDebugOptionsChange for pause on errors', async () => {
      const user = userEvent.setup()
      const onDebugOptionsChange = vi.fn()
      render(
        <CanvasActionBar
          status="idle"
          onDebugOptionsChange={onDebugOptionsChange}
        />
      )

      await user.click(screen.getByTestId('debug-options-gear'))
      await waitFor(() => {
        expect(screen.getByTestId('pause-on-errors-checkbox')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('pause-on-errors-checkbox'))

      expect(onDebugOptionsChange).toHaveBeenCalledWith({
        pauseOnFirstBlock: false,
        pauseOnErrors: true,
      })
    })

    it('calls onDebug with "current" when debug button clicked', async () => {
      const user = userEvent.setup()
      const onDebug = vi.fn()
      render(<CanvasActionBar status="idle" selectedEnvironment="dev" onDebug={onDebug} />)

      await user.click(screen.getByTestId('debug-button'))
      expect(onDebug).toHaveBeenCalledWith('current')
    })

    it('calls onDebug with "all" from dropdown', async () => {
      const user = userEvent.setup()
      const onDebug = vi.fn()
      render(<CanvasActionBar status="idle" selectedEnvironment="dev" onDebug={onDebug} />)

      await user.click(screen.getByTestId('debug-button-dropdown'))
      await waitFor(() => {
        expect(screen.getByTestId('debug-all-option')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('debug-all-option'))

      expect(onDebug).toHaveBeenCalledWith('all')
    })

    it('calls onRun with "current" when run button clicked', async () => {
      const user = userEvent.setup()
      const onRun = vi.fn()
      render(<CanvasActionBar status="idle" selectedEnvironment="dev" onRun={onRun} />)

      await user.click(screen.getByTestId('run-button'))
      expect(onRun).toHaveBeenCalledWith('current')
    })

    it('calls onRun with "all" from dropdown', async () => {
      const user = userEvent.setup()
      const onRun = vi.fn()
      render(<CanvasActionBar status="idle" selectedEnvironment="dev" onRun={onRun} />)

      await user.click(screen.getByTestId('run-button-dropdown'))
      await waitFor(() => {
        expect(screen.getByTestId('run-all-option')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('run-all-option'))

      expect(onRun).toHaveBeenCalledWith('all')
    })

    it('displays selected environment name', () => {
      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment={TEST_ENV_IDS.production}
          availableEnvironments={[
            { id: TEST_ENV_IDS.development, name: 'Development' },
            { id: TEST_ENV_IDS.production, name: 'Production' },
          ]}
        />
      )

      expect(screen.getByTestId('environment-selector')).toHaveTextContent('Production')
    })

    it('highlights debug gear when options are active', () => {
      render(
        <CanvasActionBar
          status="idle"
          debugOptions={{ pauseOnFirstBlock: true, pauseOnErrors: false }}
        />
      )

      expect(screen.getByTestId('debug-options-gear')).toHaveClass('text-primary')
    })

    it('opens env selection dialog when run clicked without environment', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" selectedEnvironment={null} availableEnvironments={TEST_ENVIRONMENTS} />)

      // Main buttons are enabled so users can click them to open env dialog
      expect(screen.getByTestId('run-button')).not.toBeDisabled()
      expect(screen.getByTestId('debug-button')).not.toBeDisabled()

      // Dropdown buttons are still disabled until env is selected
      expect(screen.getByTestId('run-button-dropdown')).toBeDisabled()
      expect(screen.getByTestId('debug-button-dropdown')).toBeDisabled()

      // Clicking run button opens env selection dialog
      await user.click(screen.getByTestId('run-button'))
      await waitFor(() => {
        expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
      })
      expect(screen.getByText('Run Test')).toBeInTheDocument()
    })

    it('opens env selection dialog when debug clicked without environment', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" selectedEnvironment={null} availableEnvironments={TEST_ENVIRONMENTS} />)

      await user.click(screen.getByTestId('debug-button'))
      await waitFor(() => {
        expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
      })
      expect(screen.getByText('Debug Test')).toBeInTheDocument()
    })

    it('runs test after selecting env in dialog and clicking confirm', async () => {
      const user = userEvent.setup()
      const onRun = vi.fn()
      const onEnvironmentChange = vi.fn()
      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment={null}
          availableEnvironments={TEST_ENVIRONMENTS}
          onRun={onRun}
          onEnvironmentChange={onEnvironmentChange}
        />
      )

      // Open dialog
      await user.click(screen.getByTestId('run-button'))
      await waitFor(() => {
        expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
      })

      // Confirm button should be disabled initially
      expect(screen.getByTestId('env-dialog-confirm')).toBeDisabled()

      // Select an environment
      await user.click(screen.getByTestId(`env-dialog-${TEST_ENV_IDS.development}`))

      // Confirm button should now be enabled
      expect(screen.getByTestId('env-dialog-confirm')).not.toBeDisabled()

      // Click confirm
      await user.click(screen.getByTestId('env-dialog-confirm'))

      // Environment should be set and run should be called with the environment override
      expect(onEnvironmentChange).toHaveBeenCalledWith(TEST_ENV_IDS.development)
      expect(onRun).toHaveBeenCalledWith('current', TEST_ENV_IDS.development)
    })

    it('cancels env dialog without running', async () => {
      const user = userEvent.setup()
      const onRun = vi.fn()
      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment={null}
          availableEnvironments={TEST_ENVIRONMENTS}
          onRun={onRun}
        />
      )

      // Open and then cancel dialog
      await user.click(screen.getByTestId('run-button'))
      await waitFor(() => {
        expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('env-dialog-cancel'))

      // Dialog should close and run should not be called
      await waitFor(() => {
        expect(screen.queryByTestId('env-selection-dialog')).not.toBeInTheDocument()
      })
      expect(onRun).not.toHaveBeenCalled()
    })

    it('debugs test after selecting env in dialog and clicking confirm', async () => {
      const user = userEvent.setup()
      const onDebug = vi.fn()
      const onEnvironmentChange = vi.fn()
      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment={null}
          availableEnvironments={TEST_ENVIRONMENTS}
          onDebug={onDebug}
          onEnvironmentChange={onEnvironmentChange}
        />
      )

      // Open dialog via debug button
      await user.click(screen.getByTestId('debug-button'))
      await waitFor(() => {
        expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
      })
      expect(screen.getByText('Debug Test')).toBeInTheDocument()

      // Select an environment
      await user.click(screen.getByTestId(`env-dialog-${TEST_ENV_IDS.staging}`))

      // Click confirm
      await user.click(screen.getByTestId('env-dialog-confirm'))

      // Environment should be set and debug should be called with the environment override
      expect(onEnvironmentChange).toHaveBeenCalledWith(TEST_ENV_IDS.staging)
      expect(onDebug).toHaveBeenCalledWith('current', TEST_ENV_IDS.staging)
    })

    it('clears search text in env dialog when clear button clicked', async () => {
      const user = userEvent.setup()
      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment={null}
          availableEnvironments={TEST_ENVIRONMENTS}
        />
      )

      // Open dialog
      await user.click(screen.getByTestId('run-button'))
      await waitFor(() => {
        expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
      })

      // Type in search
      const searchInput = screen.getByTestId('env-dialog-search')
      await user.type(searchInput, 'Dev')
      expect(searchInput).toHaveValue('Dev')

      // Clear button should now be visible - click it
      const clearButton = screen.getByRole('button', { name: 'Clear search' })
      await user.click(clearButton)

      // Search should be cleared
      expect(searchInput).toHaveValue('')
    })

    it('enables run and debug buttons when environment is selected', () => {
      render(<CanvasActionBar status="idle" selectedEnvironment={TEST_ENV_IDS.development} />)

      expect(screen.getByTestId('run-button')).not.toBeDisabled()
      expect(screen.getByTestId('run-button-dropdown')).not.toBeDisabled()
      expect(screen.getByTestId('debug-button')).not.toBeDisabled()
      expect(screen.getByTestId('debug-button-dropdown')).not.toBeDisabled()
    })
  })

  describe('Terminal state controls (stopped/passed/failed)', () => {
    it('renders idle controls when status is stopped', () => {
      render(<CanvasActionBar status="stopped" />)

      // Should show all idle controls
      expect(screen.getByTestId('environment-selector')).toBeInTheDocument()
      expect(screen.getByTestId('debug-options-gear')).toBeInTheDocument()
      expect(screen.getByTestId('debug-button')).toBeInTheDocument()
      expect(screen.getByTestId('run-button')).toBeInTheDocument()

      // Should NOT show running controls
      expect(screen.queryByTestId('action-pause-button')).not.toBeInTheDocument()
      expect(screen.queryByTestId('action-stop-button')).not.toBeInTheDocument()
    })

    it('renders idle controls when status is passed', () => {
      render(<CanvasActionBar status="passed" />)

      expect(screen.getByTestId('environment-selector')).toBeInTheDocument()
      expect(screen.getByTestId('debug-options-gear')).toBeInTheDocument()
      expect(screen.getByTestId('debug-button')).toBeInTheDocument()
      expect(screen.getByTestId('run-button')).toBeInTheDocument()
    })

    it('renders idle controls when status is failed', () => {
      render(<CanvasActionBar status="failed" />)

      expect(screen.getByTestId('environment-selector')).toBeInTheDocument()
      expect(screen.getByTestId('debug-options-gear')).toBeInTheDocument()
      expect(screen.getByTestId('debug-button')).toBeInTheDocument()
      expect(screen.getByTestId('run-button')).toBeInTheDocument()
    })

    it('allows running test again after terminal state', async () => {
      const user = userEvent.setup()
      const onRun = vi.fn()
      render(<CanvasActionBar status="stopped" selectedEnvironment="dev" onRun={onRun} />)

      await user.click(screen.getByTestId('run-button'))
      expect(onRun).toHaveBeenCalledWith('current')
    })
  })

  describe('Running state controls', () => {
    it('renders stop and focus current buttons (pause hidden)', () => {
      render(<CanvasActionBar status="running" />)

      expect(screen.queryByTestId('action-pause-button')).not.toBeInTheDocument()
      expect(screen.getByTestId('action-stop-button')).toBeInTheDocument()
      expect(screen.getByTestId('action-focus-current-button')).toBeInTheDocument()
    })

    it('calls onStop with immediate when primary stop button clicked', async () => {
      const user = userEvent.setup()
      const onStop = vi.fn()
      render(<CanvasActionBar status="running" onStop={onStop} />)

      await user.click(screen.getByTestId('action-stop-button'))
      expect(onStop).toHaveBeenCalledExactlyOnceWith('immediate')
    })

    it('dropdown exposes Immediate Stop and Stop with Finalization options', async () => {
      const user = userEvent.setup()
      const onStop = vi.fn()
      render(<CanvasActionBar status="running" onStop={onStop} />)

      await user.click(screen.getByTestId('action-stop-button-dropdown'))

      await user.click(screen.getByTestId('action-stop-immediate-option'))
      expect(onStop).toHaveBeenLastCalledWith('immediate')

      await user.click(screen.getByTestId('action-stop-button-dropdown'))
      await user.click(screen.getByTestId('action-stop-finalize-option'))
      expect(onStop).toHaveBeenLastCalledWith('finalize')

      expect(onStop).toHaveBeenCalledTimes(2)
    })

    it('calls onFocusCurrent when focus current button clicked', async () => {
      const user = userEvent.setup()
      const onFocusCurrent = vi.fn()
      render(<CanvasActionBar status="running" onFocusCurrent={onFocusCurrent} />)

      await user.click(screen.getByTestId('action-focus-current-button'))
      expect(onFocusCurrent).toHaveBeenCalledOnce()
    })

    it('does not render idle controls in running state', () => {
      render(<CanvasActionBar status="running" />)

      expect(screen.queryByTestId('environment-selector')).not.toBeInTheDocument()
      expect(screen.queryByTestId('run-button')).not.toBeInTheDocument()
    })
  })

  describe('Paused state controls', () => {
    it('renders step, continue, stop, focus current buttons', () => {
      render(<CanvasActionBar status="paused" />)

      expect(screen.getByTestId('action-step-over-button')).toBeInTheDocument()
      expect(screen.getByTestId('action-step-into-button')).toBeInTheDocument()
      expect(screen.getByTestId('action-continue-button')).toBeInTheDocument()
      expect(screen.getByTestId('action-stop-button')).toBeInTheDocument()
      expect(screen.getByTestId('action-focus-current-button')).toBeInTheDocument()
    })

    it('Step Over is enabled while paused and dispatches onStepOver', async () => {
      const user = userEvent.setup()
      const onStepOver = vi.fn()
      render(<CanvasActionBar status="paused" onStepOver={onStepOver} />)

      const button = screen.getByTestId('action-step-over-button')
      expect(button).not.toBeDisabled()
      await user.click(button)
      expect(onStepOver).toHaveBeenCalledOnce()
    })

    it('Step Into is enabled while paused and dispatches onStepInto', async () => {
      const user = userEvent.setup()
      const onStepInto = vi.fn()
      render(<CanvasActionBar status="paused" onStepInto={onStepInto} />)

      const button = screen.getByTestId('action-step-into-button')
      expect(button).not.toBeDisabled()
      await user.click(button)
      expect(onStepInto).toHaveBeenCalledOnce()
    })

    it('calls onContinue when continue button clicked', async () => {
      const user = userEvent.setup()
      const onContinue = vi.fn()
      render(<CanvasActionBar status="paused" onContinue={onContinue} />)

      await user.click(screen.getByTestId('action-continue-button'))
      expect(onContinue).toHaveBeenCalledOnce()
    })

    it('calls onStop with immediate when stop button clicked in paused state', async () => {
      const user = userEvent.setup()
      const onStop = vi.fn()
      render(<CanvasActionBar status="paused" onStop={onStop} />)

      await user.click(screen.getByTestId('action-stop-button'))
      expect(onStop).toHaveBeenCalledExactlyOnceWith('immediate')
    })

    it('calls onFocusCurrent when focus current button clicked in paused state', async () => {
      const user = userEvent.setup()
      const onFocusCurrent = vi.fn()
      render(<CanvasActionBar status="paused" onFocusCurrent={onFocusCurrent} />)

      await user.click(screen.getByTestId('action-focus-current-button'))
      expect(onFocusCurrent).toHaveBeenCalledOnce()
    })
  })

  describe('Environment selector edge cases', () => {
    it('shows "Select Environment" when no environment selected', () => {
      render(<CanvasActionBar status="idle" selectedEnvironment={null} />)

      expect(screen.getByTestId('environment-selector')).toHaveTextContent('Select Environment')
    })

    it('shows environment id when name not found', () => {
      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment="unknown-env"
          availableEnvironments={[]}
        />
      )

      expect(screen.getByTestId('environment-selector')).toHaveTextContent('unknown-env')
    })

    it('shows no environments found when search has no matches', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" />)

      await user.click(screen.getByTestId('environment-selector'))
      await user.type(screen.getByTestId('environment-search'), 'nonexistent')

      expect(screen.getByText('No environments found')).toBeInTheDocument()
    })

    it('selects recent environment', async () => {
      const user = userEvent.setup()
      const onEnvironmentChange = vi.fn()
      const recentEnvs = [{ id: 'recent-env', name: 'Recent Environment' }]

      render(
        <CanvasActionBar
          status="idle"
          recentEnvironments={recentEnvs}
          onEnvironmentChange={onEnvironmentChange}
        />
      )

      await user.click(screen.getByTestId('environment-selector'))
      await waitFor(() => {
        expect(screen.getByTestId('env-recent-recent-env')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('env-recent-recent-env'))

      expect(onEnvironmentChange).toHaveBeenCalledWith('recent-env')
    })

    it('shows check mark on selected environment', async () => {
      const user = userEvent.setup()
      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment={TEST_ENV_IDS.development}
          availableEnvironments={TEST_ENVIRONMENTS}
        />
      )

      await user.click(screen.getByTestId('environment-selector'))
      await waitFor(() => {
        expect(screen.getByTestId(`env-${TEST_ENV_IDS.development}`)).toBeInTheDocument()
      })

      const envButton = screen.getByTestId(`env-${TEST_ENV_IDS.development}`)
      // Check mark should be inside the button
      expect(envButton.querySelector('svg')).toBeInTheDocument()
    })

    it('shows check mark on selected recent environment', async () => {
      const user = userEvent.setup()
      const recentEnvs = [{ id: TEST_ENV_IDS.staging, name: 'Staging' }]

      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment={TEST_ENV_IDS.staging}
          recentEnvironments={recentEnvs}
        />
      )

      await user.click(screen.getByTestId('environment-selector'))
      await waitFor(() => {
        expect(screen.getByTestId(`env-recent-${TEST_ENV_IDS.staging}`)).toBeInTheDocument()
      })

      const recentButton = screen.getByTestId(`env-recent-${TEST_ENV_IDS.staging}`)
      expect(recentButton.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('Debug dropdown options', () => {
    it('calls onDebug with "current" from dropdown', async () => {
      const user = userEvent.setup()
      const onDebug = vi.fn()
      render(<CanvasActionBar status="idle" selectedEnvironment="dev" onDebug={onDebug} />)

      await user.click(screen.getByTestId('debug-button-dropdown'))
      await waitFor(() => {
        expect(screen.getByTestId('debug-current-option')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('debug-current-option'))

      expect(onDebug).toHaveBeenCalledWith('current')
    })
  })

  describe('Run dropdown options', () => {
    it('calls onRun with "current" from dropdown', async () => {
      const user = userEvent.setup()
      const onRun = vi.fn()
      render(<CanvasActionBar status="idle" selectedEnvironment="dev" onRun={onRun} />)

      await user.click(screen.getByTestId('run-button-dropdown'))
      await waitFor(() => {
        expect(screen.getByTestId('run-current-option')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('run-current-option'))

      expect(onRun).toHaveBeenCalledWith('current')
    })
  })

  describe('Optional callback undefined branches', () => {
    it('handles env dialog confirm when onRun is not provided (run action)', async () => {
      const user = userEvent.setup()
      const onEnvironmentChange = vi.fn()
      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment={null}
          availableEnvironments={TEST_ENVIRONMENTS}
          onEnvironmentChange={onEnvironmentChange}
          // No onRun provided - testing undefined branch
        />
      )

      // Open dialog via run button
      await user.click(screen.getByTestId('run-button'))
      await waitFor(() => {
        expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
      })

      // Select an environment
      await user.click(screen.getByTestId(`env-dialog-${TEST_ENV_IDS.development}`))

      // Click confirm - should not throw even without onRun
      await user.click(screen.getByTestId('env-dialog-confirm'))

      // Environment change should still be called
      expect(onEnvironmentChange).toHaveBeenCalledWith(TEST_ENV_IDS.development)
    })

    it('handles env dialog confirm when onDebug is not provided (debug action)', async () => {
      const user = userEvent.setup()
      const onEnvironmentChange = vi.fn()
      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment={null}
          availableEnvironments={TEST_ENVIRONMENTS}
          onEnvironmentChange={onEnvironmentChange}
          // No onDebug provided - testing undefined branch
        />
      )

      // Open dialog via debug button
      await user.click(screen.getByTestId('debug-button'))
      await waitFor(() => {
        expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
      })

      // Select an environment
      await user.click(screen.getByTestId(`env-dialog-${TEST_ENV_IDS.staging}`))

      // Click confirm - should not throw even without onDebug
      await user.click(screen.getByTestId('env-dialog-confirm'))

      // Environment change should still be called
      expect(onEnvironmentChange).toHaveBeenCalledWith(TEST_ENV_IDS.staging)
    })

    it('handles env dialog confirm when onEnvironmentChange is not provided', async () => {
      const user = userEvent.setup()
      const onRun = vi.fn()
      render(
        <CanvasActionBar
          status="idle"
          selectedEnvironment={null}
          availableEnvironments={TEST_ENVIRONMENTS}
          onRun={onRun}
          // No onEnvironmentChange provided - testing undefined branch
        />
      )

      // Open dialog via run button
      await user.click(screen.getByTestId('run-button'))
      await waitFor(() => {
        expect(screen.getByTestId('env-selection-dialog')).toBeInTheDocument()
      })

      // Select an environment
      await user.click(screen.getByTestId(`env-dialog-${TEST_ENV_IDS.production}`))

      // Click confirm - should not throw even without onEnvironmentChange
      await user.click(screen.getByTestId('env-dialog-confirm'))

      // onRun should still be called with the environment override
      expect(onRun).toHaveBeenCalledWith('current', TEST_ENV_IDS.production)
    })
  })

  describe('Read-only chrome', () => {
    it('renders the read-only chrome when showReadOnlyChrome is true', () => {
      render(<CanvasActionBar showReadOnlyChrome={true} />)
      expect(screen.getByLabelText('Read-only inspect mode')).toBeInTheDocument()
      expect(screen.getByLabelText('Edit Function')).toBeInTheDocument()
    })

    it('omits the read-only chrome when showReadOnlyChrome is false (default)', () => {
      render(<CanvasActionBar />)
      expect(screen.queryByLabelText('Read-only inspect mode')).not.toBeInTheDocument()
    })
  })
})
