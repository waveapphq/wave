/**
 * CloseConfirmDialog Tests
 *
 * V-SAVE-02: Close confirmation dialog when unsaved changes exist
 * V-CANVAS-04: Close confirmation dialog when execution state is active
 *
 * Test coverage:
 * - Dialog Rendering (4 tests)
 * - Button Actions (6 tests)
 * - State Combinations (4 tests)
 * - Accessibility (4 tests)
 *
 * Radix Dialog handles ESC, focus trap, scroll lock, and portal rendering
 * so those behaviors are NOT tested here (they are Radix's responsibility).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CloseConfirmDialog, type CloseConfirmDialogProps } from '@/features/workbench/common/canvas/dialogs/close-confirm-dialog'

// Default props
const defaultProps: CloseConfirmDialogProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSaveAndClose: vi.fn(),
  onDiscardAndClose: vi.fn(),
}

describe('CloseConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===========================================================================
  // Dialog Rendering (4 tests)
  // ===========================================================================
  describe('Dialog Rendering', () => {
    it('renders nothing when isOpen is false', () => {
      render(<CloseConfirmDialog {...defaultProps} isOpen={false} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders the dialog when isOpen is true', () => {
      render(<CloseConfirmDialog {...defaultProps} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('displays dialog title and message', () => {
      render(<CloseConfirmDialog {...defaultProps} />)
      expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
      expect(screen.getByText(/you have unsaved changes/i)).toBeInTheDocument()
    })

    it('displays both action buttons: Save and Close, Discard and Close', () => {
      render(<CloseConfirmDialog {...defaultProps} />)
      expect(screen.getByRole('button', { name: /save and close/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /discard and close/i })).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Button Actions (6 tests)
  // ===========================================================================
  describe('Button Actions', () => {
    it('calls onSaveAndClose when Save and Close button clicked', async () => {
      const user = userEvent.setup()
      const onSaveAndClose = vi.fn()
      render(<CloseConfirmDialog {...defaultProps} onSaveAndClose={onSaveAndClose} />)

      await user.click(screen.getByRole('button', { name: /save and close/i }))

      expect(onSaveAndClose).toHaveBeenCalledTimes(1)
    })

    it('calls onDiscardAndClose when Discard and Close button clicked', async () => {
      const user = userEvent.setup()
      const onDiscardAndClose = vi.fn()
      render(<CloseConfirmDialog {...defaultProps} onDiscardAndClose={onDiscardAndClose} />)

      await user.click(screen.getByRole('button', { name: /discard and close/i }))

      expect(onDiscardAndClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when Cancel button clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<CloseConfirmDialog {...defaultProps} onClose={onClose} />)

      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('disables buttons while saving', () => {
      render(<CloseConfirmDialog {...defaultProps} isSaving={true} />)

      expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /discard and close/i })).toBeDisabled()
    })

    it('shows spinner in Save and Close button while saving', () => {
      render(<CloseConfirmDialog {...defaultProps} isSaving={true} />)

      expect(screen.getByTestId('save-spinner')).toBeInTheDocument()
    })

    it('does not call callbacks while saving', async () => {
      const user = userEvent.setup()
      const onSaveAndClose = vi.fn()
      const onDiscardAndClose = vi.fn()
      render(
        <CloseConfirmDialog
          {...defaultProps}
          isSaving={true}
          onSaveAndClose={onSaveAndClose}
          onDiscardAndClose={onDiscardAndClose}
        />
      )

      await user.click(screen.getByRole('button', { name: /saving/i }))
      await user.click(screen.getByRole('button', { name: /discard and close/i }))

      expect(onSaveAndClose).not.toHaveBeenCalled()
      expect(onDiscardAndClose).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Discard and Stay
  // ===========================================================================
  describe('Discard and Stay', () => {
    it('does not render the Discard and Stay button when onDiscardAndStay is omitted', () => {
      render(<CloseConfirmDialog {...defaultProps} />)
      expect(screen.queryByRole('button', { name: /discard and stay/i })).not.toBeInTheDocument()
    })

    it('renders and wires the Discard and Stay button when onDiscardAndStay is provided', async () => {
      const user = userEvent.setup()
      const onDiscardAndStay = vi.fn()
      render(<CloseConfirmDialog {...defaultProps} onDiscardAndStay={onDiscardAndStay} />)

      await user.click(screen.getByRole('button', { name: /discard and stay/i }))

      expect(onDiscardAndStay).toHaveBeenCalledTimes(1)
    })

    it('disables Discard and Stay while saving', () => {
      render(
        <CloseConfirmDialog {...defaultProps} onDiscardAndStay={vi.fn()} isSaving={true} />,
      )
      expect(screen.getByRole('button', { name: /discard and stay/i })).toBeDisabled()
    })
  })

  // ===========================================================================
  // V-CANVAS-04: State Combinations (executionActive + isDirty)
  // ===========================================================================
  describe('State Combinations (V-CANVAS-04)', () => {
    it('renders execution-only mode when executionActive=true and isDirty=false', () => {
      // Case 1: Non-idle + clean - shows "Reset and Close" only
      render(
        <CloseConfirmDialog
          {...defaultProps}
          executionActive={true}
          isDirty={false}
        />
      )

      expect(screen.getByText('Active Execution State')).toBeInTheDocument()
      expect(screen.getByText(/reset the execution state/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /reset and close/i })).toBeInTheDocument()
      // Save and Discard buttons should NOT be present
      expect(screen.queryByRole('button', { name: /save and close/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /discard and close/i })).not.toBeInTheDocument()
    })

    it('renders both-mode when executionActive=true and isDirty=true', () => {
      // Case 2: Non-idle + dirty - shows both buttons with combined warning
      render(
        <CloseConfirmDialog
          {...defaultProps}
          executionActive={true}
          isDirty={true}
        />
      )

      expect(screen.getByText('Unsaved Changes & Execution State')).toBeInTheDocument()
      expect(screen.getByText(/unsaved changes and an active execution state/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save and close/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /discard and close/i })).toBeInTheDocument()
    })

    it('renders dirty-only mode when executionActive=false and isDirty=true', () => {
      // Case 3: Idle + dirty - shows both buttons for unsaved changes
      render(
        <CloseConfirmDialog
          {...defaultProps}
          executionActive={false}
          isDirty={true}
        />
      )

      expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
      expect(screen.getByText(/you have unsaved changes/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save and close/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /discard and close/i })).toBeInTheDocument()
    })

    it('calls onDiscardAndClose when Reset and Close clicked in execution-only mode', async () => {
      const user = userEvent.setup()
      const onDiscardAndClose = vi.fn()
      render(
        <CloseConfirmDialog
          {...defaultProps}
          onDiscardAndClose={onDiscardAndClose}
          executionActive={true}
          isDirty={false}
        />
      )

      await user.click(screen.getByRole('button', { name: /reset and close/i }))

      expect(onDiscardAndClose).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // Accessibility (4 tests)
  // ===========================================================================
  describe('Accessibility', () => {
    it('renders with role="dialog"', () => {
      render(<CloseConfirmDialog {...defaultProps} />)
      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
      // Radix Dialog handles modality via aria-hidden on siblings (hideOthers),
      // not via aria-modal attribute on the dialog element itself
      expect(dialog).toHaveAttribute('role', 'dialog')
    })

    it('has aria-labelledby pointing to dialog title', () => {
      render(<CloseConfirmDialog {...defaultProps} />)
      const dialog = screen.getByRole('dialog')
      const titleId = dialog.getAttribute('aria-labelledby')
      expect(titleId).toBeTruthy()
      expect(document.getElementById(titleId!)).toHaveTextContent('Unsaved Changes')
    })

    it('has aria-describedby pointing to dialog description', () => {
      render(<CloseConfirmDialog {...defaultProps} />)
      const dialog = screen.getByRole('dialog')
      const descId = dialog.getAttribute('aria-describedby')
      expect(descId).toBeTruthy()
      expect(document.getElementById(descId!)?.textContent).toContain('unsaved changes')
    })

    it('Discard button has danger variant styling', () => {
      render(<CloseConfirmDialog {...defaultProps} />)
      const discardButton = screen.getByRole('button', { name: /discard and close/i })
      expect(discardButton).toHaveClass('btn-danger')
    })
  })

  // ===========================================================================
  // onOpenChange behavior (2 tests)
  // ===========================================================================
  describe('onOpenChange behavior', () => {
    it('does not call onClose when dialog tries to close while saving', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(
        <CloseConfirmDialog
          {...defaultProps}
          onClose={onClose}
          isSaving={true}
        />
      )

      // ESC key triggers onOpenChange(false), which should be blocked by isSaving
      await user.keyboard('{Escape}')

      expect(onClose).not.toHaveBeenCalled()
    })

    it('calls onClose via onOpenChange when ESC pressed and not saving', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(
        <CloseConfirmDialog
          {...defaultProps}
          onClose={onClose}
          isSaving={false}
        />
      )

      await user.keyboard('{Escape}')

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})

// =============================================================================
// Session artifact loss callout (wireframe session-artifacts-wipe-dialogs)
// =============================================================================
describe('CloseConfirmDialog - session artifact loss callout', () => {
  it('renders the callout in the dirty-only state when the session holds artifacts', () => {
    render(<CloseConfirmDialog {...defaultProps} sessionArtifactCount={3} />)

    expect(
      screen.getByText('3 session artifacts will be permanently deleted.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Download anything you need from the Artifacts panel first.')
    ).toBeInTheDocument()
  })

  it('renders the callout in the execution-only state (Reset and Close)', () => {
    render(
      <CloseConfirmDialog
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

  it('renders the callout in the dirty + execution state', () => {
    render(
      <CloseConfirmDialog {...defaultProps} isDirty executionActive sessionArtifactCount={2} />
    )

    expect(screen.getByText('Unsaved Changes & Execution State')).toBeInTheDocument()
    expect(
      screen.getByText('2 session artifacts will be permanently deleted.')
    ).toBeInTheDocument()
  })

  it('names uploads still going beside the artifact warning (TDATA-14)', () => {
    render(<CloseConfirmDialog {...defaultProps} sessionArtifactCount={2} uploadCount={3} />)

    expect(screen.getByText('3 test data uploads are still going.')).toBeInTheDocument()
    expect(
      screen.getByText('Leaving this test does not stop them; closing the tab does.')
    ).toBeInTheDocument()
  })

  it('says nothing about uploads when none are going', () => {
    render(<CloseConfirmDialog {...defaultProps} sessionArtifactCount={2} />)

    expect(screen.queryByText(/test data upload/)).not.toBeInTheDocument()
  })

  it('uses the singular copy for a single artifact', () => {
    render(<CloseConfirmDialog {...defaultProps} sessionArtifactCount={1} />)

    expect(
      screen.getByText('1 session artifact will be permanently deleted.')
    ).toBeInTheDocument()
  })

  it('shows no callout at count 0', () => {
    render(<CloseConfirmDialog {...defaultProps} sessionArtifactCount={0} />)

    expect(screen.queryByText(/session artifacts? will be permanently deleted/)).not.toBeInTheDocument()
  })

  it('shows no callout when the count is not provided (tracked sessions pass nothing)', () => {
    render(<CloseConfirmDialog {...defaultProps} />)

    expect(screen.queryByText(/session artifacts? will be permanently deleted/)).not.toBeInTheDocument()
  })
})
