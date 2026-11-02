/**
 * SwitchTestConfirmDialog Tests
 *
 * Dialog shown when user tries to open a different test while having unsaved changes.
 *
 * Test coverage:
 * - Dialog Rendering (6 tests)
 * - Mode-specific Text (4 tests)
 * - Button Actions (4 tests)
 * - Loading State (3 tests)
 * - State Combinations (7 tests)
 * - Accessibility (4 tests)
 * - onOpenChange behavior (2 tests)
 *
 * Radix Dialog handles ESC, focus trap, scroll lock, and portal rendering
 * so those behaviors are NOT tested here (they are Radix's responsibility).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SwitchTestConfirmDialog,
  type SwitchTestDialogProps,
} from '@/features/workbench/common/canvas/dialogs/switch-test-dialog'

// Default props for tests
const defaultProps: SwitchTestDialogProps = {
  isOpen: true,
  currentTestName: 'My Test',
  onViewPendingWorkflow: vi.fn(),
  onSaveAndSwitch: vi.fn(),
  onDiscardAndSwitch: vi.fn(),
}

describe('SwitchTestConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===========================================================================
  // Dialog Rendering (6 tests)
  // ===========================================================================
  describe('Dialog Rendering', () => {
    it('renders nothing when isOpen is false', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} isOpen={false} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders the dialog when isOpen is true', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('displays dialog title', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} />)
      expect(screen.getByText('Unsaved Changes in Workbench')).toBeInTheDocument()
    })

    it('displays current test name in message', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} currentTestName="My Custom Test" />)
      expect(screen.getByText(/My Custom Test/)).toBeInTheDocument()
    })

    it('displays "Draft Workflow" when currentTestName is null', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} currentTestName={null} />)
      expect(screen.getByText(/Draft Workflow/)).toBeInTheDocument()
    })

    it('displays warning icon', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} />)
      const dialog = screen.getByRole('dialog')
      // AlertTriangle icon should be present
      expect(dialog.querySelector('svg')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Mode-specific Text (4 tests)
  // ===========================================================================
  describe('Mode-specific Text', () => {
    it('displays switch mode message when mode is switch (default)', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} mode="switch" />)
      expect(
        screen.getByText(/To open a different workflow, you can either save or discard/)
      ).toBeInTheDocument()
    })

    it('displays create mode message when mode is create', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} mode="create" />)
      expect(
        screen.getByText(/To create a new test, you can either save or discard/)
      ).toBeInTheDocument()
    })

    it('displays switch mode button labels', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} mode="switch" />)
      expect(screen.getByRole('button', { name: /Discard & Open New/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Save & Open New/i })).toBeInTheDocument()
    })

    it('displays create mode button labels', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} mode="create" />)
      expect(screen.getByRole('button', { name: /Discard & Create Test/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Save & Create Test/i })).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Button Actions (4 tests)
  // ===========================================================================
  describe('Button Actions', () => {
    it('calls onViewPendingWorkflow when View Pending Workflow clicked', async () => {
      const user = userEvent.setup()
      const onViewPendingWorkflow = vi.fn()
      render(<SwitchTestConfirmDialog {...defaultProps} onViewPendingWorkflow={onViewPendingWorkflow} />)

      await user.click(screen.getByRole('button', { name: /View Pending Workflow/i }))

      expect(onViewPendingWorkflow).toHaveBeenCalledTimes(1)
    })

    it('calls onSaveAndSwitch when Save button clicked', async () => {
      const user = userEvent.setup()
      const onSaveAndSwitch = vi.fn()
      render(<SwitchTestConfirmDialog {...defaultProps} onSaveAndSwitch={onSaveAndSwitch} />)

      await user.click(screen.getByRole('button', { name: /Save & Open New/i }))

      expect(onSaveAndSwitch).toHaveBeenCalledTimes(1)
    })

    it('calls onDiscardAndSwitch when Discard button clicked', async () => {
      const user = userEvent.setup()
      const onDiscardAndSwitch = vi.fn()
      render(<SwitchTestConfirmDialog {...defaultProps} onDiscardAndSwitch={onDiscardAndSwitch} />)

      await user.click(screen.getByRole('button', { name: /Discard & Open New/i }))

      expect(onDiscardAndSwitch).toHaveBeenCalledTimes(1)
    })

    it('does not call callbacks when buttons are disabled during save', async () => {
      const user = userEvent.setup()
      const onSaveAndSwitch = vi.fn()
      const onDiscardAndSwitch = vi.fn()
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          isSaving={true}
          onSaveAndSwitch={onSaveAndSwitch}
          onDiscardAndSwitch={onDiscardAndSwitch}
        />
      )

      await user.click(screen.getByRole('button', { name: /Saving/i }))
      await user.click(screen.getByRole('button', { name: /Discard & Open New/i }))

      expect(onSaveAndSwitch).not.toHaveBeenCalled()
      expect(onDiscardAndSwitch).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Loading State (3 tests)
  // ===========================================================================
  describe('Loading State', () => {
    it('disables all buttons while saving', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} isSaving={true} />)

      // View Pending Workflow button
      expect(screen.getByRole('button', { name: /View Pending Workflow/i })).toBeDisabled()
      // Discard button
      expect(screen.getByRole('button', { name: /Discard & Open New/i })).toBeDisabled()
      // Save button (shows "Saving…" when isSaving)
      expect(screen.getByRole('button', { name: /Saving/i })).toBeDisabled()
    })

    it('shows spinner in save button while saving', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} isSaving={true} />)

      expect(screen.getByTestId('save-spinner')).toBeInTheDocument()
    })

    it('shows "Saving…" text while saving', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} isSaving={true} />)

      expect(screen.getByText('Saving…')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // V-CANVAS-04: State Combinations (executionActive + isDirty)
  // ===========================================================================
  describe('State Combinations (V-CANVAS-04)', () => {
    it('renders execution-only mode when executionActive=true and isDirty=false', () => {
      // Case 1: Non-idle + clean - shows "Reset & Open New" only
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          executionActive={true}
          isDirty={false}
        />
      )

      expect(screen.getByText('Active Execution State')).toBeInTheDocument()
      expect(screen.getByText(/has an active execution state/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /reset & open new/i })).toBeInTheDocument()
      // Save and Discard buttons should NOT be present
      expect(screen.queryByRole('button', { name: /save & open new/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /discard & open new/i })).not.toBeInTheDocument()
    })

    it('renders both-mode when executionActive=true and isDirty=true', () => {
      // Case 2: Non-idle + dirty - shows both buttons with combined warning
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          executionActive={true}
          isDirty={true}
        />
      )

      expect(screen.getByText('Unsaved Changes & Execution State')).toBeInTheDocument()
      expect(screen.getByText(/unsaved changes and an active execution state/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save & open new/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /discard & open new/i })).toBeInTheDocument()
    })

    it('renders both-mode with create-specific text when mode=create, executionActive=true, isDirty=true (V-CANVAS-04)', () => {
      // Case 2 with create mode: shows create-specific warning text
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          mode="create"
          executionActive={true}
          isDirty={true}
        />
      )

      expect(screen.getByText('Unsaved Changes & Execution State')).toBeInTheDocument()
      // Create mode shows "To create a new test" text
      expect(screen.getByText(/to create a new test, you can either save or discard/i)).toBeInTheDocument()
      expect(screen.getByText(/execution results will be reset/i)).toBeInTheDocument()
    })

    it('renders dirty-only mode when executionActive=false and isDirty=true', () => {
      // Case 3: Idle + dirty - shows both buttons for unsaved changes
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          executionActive={false}
          isDirty={true}
        />
      )

      expect(screen.getByText('Unsaved Changes in Workbench')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save & open new/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /discard & open new/i })).toBeInTheDocument()
    })

    it('calls onDiscardAndSwitch when Reset & Open New clicked in execution-only mode', async () => {
      const user = userEvent.setup()
      const onDiscardAndSwitch = vi.fn()
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          onDiscardAndSwitch={onDiscardAndSwitch}
          executionActive={true}
          isDirty={false}
        />
      )

      await user.click(screen.getByRole('button', { name: /reset & open new/i }))

      expect(onDiscardAndSwitch).toHaveBeenCalledTimes(1)
    })

    it('shows create mode buttons when mode=create and executionActive=true, isDirty=false', () => {
      // Execution-only mode in create context
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          mode="create"
          executionActive={true}
          isDirty={false}
        />
      )

      expect(screen.getByRole('button', { name: /reset & create test/i })).toBeInTheDocument()
    })

    it('shows switch mode description text for executionActive + dirty', () => {
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          mode="switch"
          executionActive={true}
          isDirty={true}
        />
      )

      expect(screen.getByText(/to open a different workflow, you can either save or discard/i)).toBeInTheDocument()
      expect(screen.getByText(/execution results will be reset/i)).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Accessibility (4 tests)
  // ===========================================================================
  describe('Accessibility', () => {
    it('renders with role="dialog"', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} />)
      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
      // Radix Dialog handles modality via aria-hidden on siblings (hideOthers),
      // not via aria-modal attribute on the dialog element itself
      expect(dialog).toHaveAttribute('role', 'dialog')
    })

    it('has aria-labelledby pointing to dialog title', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} />)
      const dialog = screen.getByRole('dialog')
      const titleId = dialog.getAttribute('aria-labelledby')
      expect(titleId).toBeTruthy()
      expect(document.getElementById(titleId!)).toHaveTextContent('Unsaved Changes in Workbench')
    })

    it('has aria-describedby pointing to dialog description', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} />)
      const dialog = screen.getByRole('dialog')
      const descId = dialog.getAttribute('aria-describedby')
      expect(descId).toBeTruthy()
      expect(document.getElementById(descId!)?.textContent).toContain('unsaved changes')
    })

    it('View Pending Workflow button is present', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} />)
      expect(screen.getByRole('button', { name: /View Pending Workflow/i })).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // isRunning behavior - blocks destructive actions while a test is running
  // ===========================================================================
  describe('isRunning mode', () => {
    it('shows the "Test is Running" title and a stop-first message', () => {
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          isRunning
          currentTestName="Live Test"
        />
      )

      expect(screen.getByText('Test is Running')).toBeInTheDocument()
      expect(screen.getByText(/Live Test/)).toBeInTheDocument()
      expect(
        screen.getByText(/currently running in the Workbench/i)
      ).toBeInTheDocument()
    })

    it('renders only the "Go to Workbench" button - no destructive options', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} isRunning />)

      expect(screen.getByRole('button', { name: /Go to Workbench/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Discard/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Reset/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Save & /i })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /View Pending Workflow/i })
      ).not.toBeInTheDocument()
    })

    it('renders a Cancel button when onCancel is provided', () => {
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          isRunning
          onCancel={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Go to Workbench/i })).toBeInTheDocument()
    })

    it('omits the Cancel button when onCancel is not provided', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} isRunning />)

      expect(screen.queryByRole('button', { name: /^Cancel$/i })).not.toBeInTheDocument()
    })

    it('Cancel calls onCancel and not onViewPendingWorkflow', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      const onViewPendingWorkflow = vi.fn()
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          isRunning
          onCancel={onCancel}
          onViewPendingWorkflow={onViewPendingWorkflow}
        />
      )

      await user.click(screen.getByRole('button', { name: /^Cancel$/i }))

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onViewPendingWorkflow).not.toHaveBeenCalled()
    })

    it('ESC calls onCancel when isRunning and onCancel is provided', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      const onViewPendingWorkflow = vi.fn()
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          isRunning
          onCancel={onCancel}
          onViewPendingWorkflow={onViewPendingWorkflow}
        />
      )

      await user.keyboard('{Escape}')

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onViewPendingWorkflow).not.toHaveBeenCalled()
    })

    it('"Go to Workbench" calls onViewPendingWorkflow', async () => {
      const user = userEvent.setup()
      const onViewPendingWorkflow = vi.fn()
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          isRunning
          onViewPendingWorkflow={onViewPendingWorkflow}
        />
      )

      await user.click(screen.getByRole('button', { name: /Go to Workbench/i }))

      expect(onViewPendingWorkflow).toHaveBeenCalledTimes(1)
    })

    it('uses the "create" mode wording when mode is create', () => {
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          isRunning
          mode="create"
          currentTestName="Live Test"
        />
      )

      expect(screen.getByText(/before creating a new one/i)).toBeInTheDocument()
    })

    it('takes priority over executionActive + isDirty (no destructive options exposed)', () => {
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          isRunning
          executionActive
          isDirty
        />
      )

      expect(screen.getByText('Test is Running')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Discard/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Save & /i })).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // onOpenChange behavior (2 tests)
  // ===========================================================================
  describe('onOpenChange behavior', () => {
    it('does not call onViewPendingWorkflow when dialog tries to close while saving', async () => {
      const user = userEvent.setup()
      const onViewPendingWorkflow = vi.fn()
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          onViewPendingWorkflow={onViewPendingWorkflow}
          isSaving={true}
        />
      )

      // ESC key triggers onOpenChange(false), which should be blocked by isSaving
      await user.keyboard('{Escape}')

      expect(onViewPendingWorkflow).not.toHaveBeenCalled()
    })

    it('calls onViewPendingWorkflow via onOpenChange when ESC pressed and not saving', async () => {
      const user = userEvent.setup()
      const onViewPendingWorkflow = vi.fn()
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          onViewPendingWorkflow={onViewPendingWorkflow}
          isSaving={false}
        />
      )

      await user.keyboard('{Escape}')

      expect(onViewPendingWorkflow).toHaveBeenCalledTimes(1)
    })
  })

  describe('Function entity', () => {
    it('names the open Function and offers no inline Save', () => {
      render(
        <SwitchTestConfirmDialog {...defaultProps} entityKind="function" currentTestName="Greet User" />,
      )
      expect(screen.getByTestId('switch-test-dialog')).toHaveTextContent(/the function "Greet User"/i)
      // Publishing a Function is deliberate - no quick-save in the dialog.
      expect(screen.queryByRole('button', { name: /Save & Open/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Discard & Open New/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Keep Editing/i })).toBeInTheDocument()
    })

    it('falls back to "this function" when the Function name is unknown', () => {
      render(<SwitchTestConfirmDialog {...defaultProps} entityKind="function" currentTestName={null} />)
      expect(screen.getByTestId('switch-test-dialog')).toHaveTextContent(/the function "this function"/i)
    })

    it('uses Function wording in the running-state notice', () => {
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          entityKind="function"
          currentTestName="Greet User"
          isRunning
        />,
      )
      expect(screen.getByRole('heading', { name: /Function is Running/i })).toBeInTheDocument()
      expect(screen.getByTestId('switch-test-dialog')).toHaveTextContent(/stop the running function/i)
    })

    it('uses Function wording for an execution-only state', () => {
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          entityKind="function"
          currentTestName="Greet User"
          isDirty={false}
          executionActive
        />,
      )
      expect(screen.getByTestId('switch-test-dialog')).toHaveTextContent(/the function "Greet User" has an active execution state/i)
    })

    it('still hides Save for a Function with an active execution', () => {
      render(
        <SwitchTestConfirmDialog
          {...defaultProps}
          entityKind="function"
          currentTestName="Greet User"
          executionActive
        />,
      )
      expect(screen.queryByRole('button', { name: /Save & Open/i })).not.toBeInTheDocument()
      expect(screen.getByTestId('switch-test-dialog')).toHaveTextContent(/execution results will be reset/i)
    })
  })
})

// =============================================================================
// Session artifact loss callout (wireframe session-artifacts-wipe-dialogs)
// =============================================================================
describe('SwitchTestConfirmDialog - session artifact loss callout', () => {
  it('renders the callout for a dirty Test in switch mode', () => {
    render(<SwitchTestConfirmDialog {...defaultProps} sessionArtifactCount={3} />)

    expect(
      screen.getByText('3 session artifacts will be permanently deleted.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Download anything you need from the Artifacts panel first.')
    ).toBeInTheDocument()
  })

  it('renders the callout in create mode (tests-page New Test)', () => {
    render(<SwitchTestConfirmDialog {...defaultProps} mode="create" sessionArtifactCount={2} />)

    expect(
      screen.getByText('2 session artifacts will be permanently deleted.')
    ).toBeInTheDocument()
  })

  it('renders the callout in the execution-only state (Reset & Open New)', () => {
    render(
      <SwitchTestConfirmDialog
        {...defaultProps}
        isDirty={false}
        executionActive
        sessionArtifactCount={2}
      />
    )

    expect(screen.getByText('Active Execution State')).toBeInTheDocument()
    expect(
      screen.getByText('2 session artifacts will be permanently deleted.')
    ).toBeInTheDocument()
  })

  it('renders the callout with Function wording', () => {
    render(
      <SwitchTestConfirmDialog
        {...defaultProps}
        entityKind="function"
        currentTestName="Greet User"
        sessionArtifactCount={1}
      />
    )

    expect(
      screen.getByText('1 session artifact will be permanently deleted.')
    ).toBeInTheDocument()
  })

  it('shows no callout in isRunning mode (nothing is destroyed by the stop-first notice)', () => {
    render(<SwitchTestConfirmDialog {...defaultProps} isRunning sessionArtifactCount={3} />)

    expect(screen.getByText('Test is Running')).toBeInTheDocument()
    expect(screen.queryByText(/session artifacts? will be permanently deleted/)).not.toBeInTheDocument()
  })

  it('shows no callout at count 0', () => {
    render(<SwitchTestConfirmDialog {...defaultProps} sessionArtifactCount={0} />)

    expect(screen.queryByText(/session artifacts? will be permanently deleted/)).not.toBeInTheDocument()
  })

  it('shows no callout when the count is not provided (tracked sessions pass nothing)', () => {
    render(<SwitchTestConfirmDialog {...defaultProps} />)

    expect(screen.queryByText(/session artifacts? will be permanently deleted/)).not.toBeInTheDocument()
  })
})

describe('SwitchTestConfirmDialog - uploads in progress callout (TDATA-14)', () => {
  it('names uploads still going', () => {
    render(<SwitchTestConfirmDialog {...defaultProps} isDirty uploadCount={1} />)

    expect(screen.getByText('1 test data upload is still going.')).toBeInTheDocument()
    expect(
      screen.getByText('Leaving this test does not stop it; closing the tab does.')
    ).toBeInTheDocument()
  })

  it('says it in the running-blocker state too, where the artifact warning is hidden', () => {
    render(<SwitchTestConfirmDialog {...defaultProps} isRunning uploadCount={2} />)

    expect(screen.getByText('2 test data uploads are still going.')).toBeInTheDocument()
  })

  it('says nothing about uploads when none are going', () => {
    render(<SwitchTestConfirmDialog {...defaultProps} isDirty />)

    expect(screen.queryByText(/test data upload/)).not.toBeInTheDocument()
  })
})
