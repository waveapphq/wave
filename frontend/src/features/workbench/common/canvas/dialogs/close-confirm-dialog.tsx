/**
 * CloseConfirmDialog Component
 *
 * V-SAVE-02: Close confirmation dialog when unsaved changes exist
 * V-CANVAS-04: Close confirmation dialog when execution state is active
 *
 * Modal dialog shown when user tries to close with:
 * - Unsaved changes (dirty state)
 * - Active execution state (non-idle: running/passed/failed/stopped/paused)
 *
 * Scenarios:
 * 1. Non-idle + clean: Shows "Reset and Close" to clear execution state
 * 2. Non-idle + dirty: Shows both "Save and Close" and "Discard and Close"
 * 3. Idle + dirty: Shows both "Save and Close" and "Discard and Close"
 *
 * Built on Radix Dialog which provides:
 * - Portal rendering (no manual createPortal)
 * - Focus trapping (no manual Tab/Shift+Tab handling)
 * - Scroll lock (no manual body overflow manipulation)
 * - ESC to dismiss (handled by onOpenChange)
 */

import { useCallback, type ReactNode } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SessionArtifactLossCallout } from '@/components/shared/session-artifact-loss-callout'
import { UploadsInProgressCallout } from '@/components/shared/uploads-in-progress-callout'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

// ===========================================================================
// Types
// ===========================================================================

export interface CloseConfirmDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Called when dialog should close (X button, Escape, backdrop) */
  onClose: () => void
  /** Called when user clicks "Save and Close" */
  onSaveAndClose: () => void
  /** Called when user clicks "Discard and Close" or "Reset and Close" */
  onDiscardAndClose: () => void
  /** Called when user clicks "Discard and Stay" (revert, keep test open).
   *  When omitted the button is not rendered. */
  onDiscardAndStay?: () => void
  /** Whether a save operation is in progress */
  isSaving?: boolean
  /** Whether there are unsaved changes (dirty state) */
  isDirty?: boolean
  /** Whether there is active execution state (non-idle) */
  executionActive?: boolean
  /** Ephemeral session artifact count; > 0 renders the loss callout. */
  sessionArtifactCount?: number
  /** Test data files still arriving, named in the warning (TDATA-14). */
  uploadCount?: number
}

// ===========================================================================
// Component
// ===========================================================================

export function CloseConfirmDialog({
  isOpen,
  onClose,
  onSaveAndClose,
  onDiscardAndClose,
  onDiscardAndStay,
  isSaving = false,
  isDirty = true,
  executionActive = false,
  sessionArtifactCount = 0,
  uploadCount = 0,
}: Readonly<CloseConfirmDialogProps>): ReactNode {
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !isSaving) {
        onClose()
      }
    },
    [isSaving, onClose]
  )

  // Determine dialog content based on state combination
  const executionOnlyMode = executionActive && !isDirty
  // The 4-button footer (Cancel / Discard and Stay / Discard and Close /
  // Save and Close) needs a wider shell so Cancel does not overflow the edge.
  const wideFooter = !executionOnlyMode && Boolean(onDiscardAndStay)

  let title: string
  if (executionOnlyMode) {
    title = 'Active Execution State'
  } else if (executionActive) {
    title = 'Unsaved Changes & Execution State'
  } else {
    title = 'Unsaved Changes'
  }

  let description: string
  if (executionOnlyMode) {
    description = 'Closing will reset the execution state and clear the test results from the canvas.'
  } else if (executionActive) {
    description = 'You have unsaved changes and an active execution state. Closing will reset the test results. Would you like to save your work before closing?'
  } else {
    description = 'You have unsaved changes. Would you like to save your work before closing?'
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className={wideFooter ? 'max-w-2xl' : 'max-w-xl'}
        hideCloseButton
        preventCloseOnClickOutside
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
          </div>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <DialogDescription>{description}</DialogDescription>

        <SessionArtifactLossCallout count={sessionArtifactCount} />
        <UploadsInProgressCallout count={uploadCount} />

        <DialogFooter className="gap-3 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            className="whitespace-nowrap"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          {executionOnlyMode ? (
            <Button
              type="button"
              className="whitespace-nowrap"
              onClick={onDiscardAndClose}
              disabled={isSaving}
            >
              Reset and Close
            </Button>
          ) : (
            <>
              {onDiscardAndStay ? (
                <Button
                  type="button"
                  variant="outline"
                  className="whitespace-nowrap"
                  onClick={onDiscardAndStay}
                  disabled={isSaving}
                >
                  Discard and Stay
                </Button>
              ) : null}
              <Button
                type="button"
                variant="destructive"
                className="whitespace-nowrap"
                onClick={onDiscardAndClose}
                disabled={isSaving}
              >
                Discard and Close
              </Button>
              <Button
                type="button"
                className="whitespace-nowrap"
                onClick={onSaveAndClose}
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 data-testid="save-spinner" className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Saving…
                  </>
                ) : (
                  'Save and Close'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
