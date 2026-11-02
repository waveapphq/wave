/**
 * Workbench Dialogs - All dialog components rendered by the WorkbenchContainer
 *
 * Extracted to keep the main container file focused on layout and hook wiring.
 */

import { type ReactNode } from 'react'
import { CloseConfirmDialog } from '@/features/workbench/common/canvas/dialogs/close-confirm-dialog'
import { SwitchTestConfirmDialog } from '@/features/workbench/common/canvas/dialogs/switch-test-dialog'
import { TestFormDialog } from '@/features/workbench/common/test-form'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { SessionArtifactLossCallout } from '@/components/shared/session-artifact-loss-callout'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import type { DeletedTestInfo } from '@/features/workbench/stores/deleted-test-store'
import {
  ValidationErrorDialog,
  type ValidationError,
  type ValidationDialogMode,
} from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import type { TestFormPayload, WorkflowData } from '@/features/workbench/common/test-form'
import { alreadyReported } from '@/features/workbench/lib/already-reported'
import { keepDeletedTestOnCanvas } from '@/features/workbench/live/deleted-test-dismiss'
import { EditModeNotice, FunctionViewLeaveNotice } from '@/features/workbench/live/edit-mode-notice'

interface WorkbenchDialogsProps {
  // Save Test Dialog
  showSaveDialog: boolean
  onCloseSaveDialog: () => void
  onSaveTest: (payload: TestFormPayload) => Promise<void>
  saveMode: 'create' | 'edit' | 'edit-metadata'
  saveWorkflowData?: WorkflowData
  saveTestId?: string
  saveInitialValues?: { name: string }

  // Close Confirm Dialog
  showCloseConfirmDialog: boolean
  onCloseConfirmDialog: () => void
  onSaveAndClose: () => Promise<void>
  onDiscardAndClose: () => void
  /** Revert to saved + keep the test open. */
  onDiscardAndStay: () => Promise<void>
  isSaving: boolean
  isDirty: boolean
  executionActive: boolean

  // Session artifact warn-on-wipe (0 for tracked sessions)
  sessionArtifactCount: number
  /** Test data files still arriving; the close and switch warnings name them. */
  uploadCount: number

  // Artifact-guarded Reset confirmation
  showResetConfirmDialog: boolean
  onCancelResetConfirm: () => void
  onConfirmReset: () => void

  // Edit-mode close nag (OK-only)
  showEditModeNag: boolean
  onCloseEditModeNag: () => void

  // Leaving a library View that holds an edit-mode draft (OK-only)
  showFunctionViewLeaveNotice: boolean
  onAcknowledgeFunctionViewLeave: () => void
  onCancelFunctionViewLeave: () => void

  // Switch Test Dialog
  showSwitchTestDialog: boolean
  switchEntityKind?: 'test' | 'function'
  currentTestName: string | null
  onViewPendingWorkflow: () => void
  onSaveAndSwitch: () => Promise<void>
  onDiscardAndSwitch: () => void
  isRunning: boolean

  // Variable Delete Confirm
  pendingDeleteVarId: string | null
  pendingDeleteVarName: string
  pendingDeleteDescription: string
  onCloseDeleteVar: () => void
  onConfirmDeleteVar: () => void

  // Edit Metadata Dialog
  editingTestId: string | null
  editingTestName: string | null
  showEditMetadataDialog: boolean
  onCloseEditMetadata: () => void
  onSaveMetadata: (payload: TestFormPayload) => Promise<void>

  // Deleted Test Detection
  deletedTestInfo: DeletedTestInfo | null
  onDismissDeletedTest: () => void

  // Validation Error Dialog
  showValidationErrorDialog: boolean
  validationFatal: boolean
  validationErrors: ValidationError[]
  validationMode: ValidationDialogMode
  isFixingTest: boolean
  onValidationClose: () => void
  onFixAll?: () => Promise<void>
  onDeleteFatalTest?: () => Promise<void>
  onNavigateToIssue?: (error: ValidationError, depthIndex?: number) => void
}

export function WorkbenchDialogs(props: Readonly<WorkbenchDialogsProps>): ReactNode {
  // Each dialog action reports its own failure; these start it from a prop the
  // dialogs declare as returning nothing.
  const { onFixAll, onDeleteFatalTest } = props
  const deletedTestName = props.deletedTestInfo?.testName ? ` "${props.deletedTestInfo.testName}"` : ''
  return (
    <>
      {/* Save Test Dialog */}
      {/* v8 ignore next - COV-BRANCH-030: TestFormDialog component render */}
      <TestFormDialog
        isOpen={props.showSaveDialog}
        onClose={props.onCloseSaveDialog}
        onSave={props.onSaveTest}
        /* v8 ignore next - COV-BRANCH-030 */
        mode={props.saveMode}
        /* v8 ignore next - COV-BRANCH-030 */
        workflowData={props.saveWorkflowData}
        /* v8 ignore start - COV-BRANCH-030 */
        testId={props.saveTestId}
        initialValues={props.saveInitialValues}
        /* v8 ignore stop */
      />

      {/* Close Confirmation Dialog */}
      <CloseConfirmDialog
        isOpen={props.showCloseConfirmDialog}
        onClose={props.onCloseConfirmDialog}
        onSaveAndClose={() => { props.onSaveAndClose().catch(alreadyReported) }}
        onDiscardAndClose={props.onDiscardAndClose}
        onDiscardAndStay={() => { props.onDiscardAndStay().catch(alreadyReported) }}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        executionActive={props.executionActive}
        sessionArtifactCount={props.sessionArtifactCount}
        uploadCount={props.uploadCount}
      />

      {/* Switch Test Confirmation Dialog */}
      <SwitchTestConfirmDialog
        isOpen={props.showSwitchTestDialog}
        entityKind={props.switchEntityKind}
        currentTestName={props.currentTestName}
        onViewPendingWorkflow={props.onViewPendingWorkflow}
        onSaveAndSwitch={() => { props.onSaveAndSwitch().catch(alreadyReported) }}
        onDiscardAndSwitch={props.onDiscardAndSwitch}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        executionActive={props.executionActive}
        isRunning={props.isRunning}
        sessionArtifactCount={props.sessionArtifactCount}
        uploadCount={props.uploadCount}
      />

      {/* Artifact-guarded Reset confirmation (only opens when artifacts exist) */}
      <ConfirmationDialog
        isOpen={props.showResetConfirmDialog}
        onClose={props.onCancelResetConfirm}
        onConfirm={props.onConfirmReset}
        variant="reset"
        title="Reset Session?"
        description="Resetting clears the run state from the canvas and empties the console."
        confirmLabel="Reset"
      >
        <div className="mb-6">
          <SessionArtifactLossCallout count={props.sessionArtifactCount} />
        </div>
      </ConfirmationDialog>

      {/* Variable / input / output delete confirmation. Always fires - the
          description carries the "permanently removed" / "references will
          become unresolved" copy and `itemName` drives the dialog title
          (`Delete "<name>"?`) to match suite / profile delete UX. */}
      <ConfirmationDialog
        isOpen={props.pendingDeleteVarId !== null}
        onClose={props.onCloseDeleteVar}
        onConfirm={props.onConfirmDeleteVar}
        variant="delete"
        itemName={props.pendingDeleteVarName || undefined}
        description={props.pendingDeleteDescription}
        confirmLabel="Delete"
      />

      {/* Edit Test Metadata Dialog */}
      {props.editingTestId && props.editingTestName && (
        <TestFormDialog
          isOpen={props.showEditMetadataDialog}
          onClose={props.onCloseEditMetadata}
          onSave={props.onSaveMetadata}
          mode="edit-metadata"
          testId={props.editingTestId}
          initialValues={{ name: props.editingTestName }}
        />
      )}

      {/* Deleted Test Modal */}
      <Dialog
        open={props.deletedTestInfo !== null}
        onOpenChange={(open) => {
          // Escape and the backdrop take the non-destructive choice; on a clean
          // canvas there is none, so they leave the dialog up.
          if (!open && props.isDirty) keepDeletedTestOnCanvas()
        }}
      >
        <DialogContent data-testid="deleted-test-modal" hideCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
              Test not found
            </DialogTitle>
            <DialogDescription className="break-words [overflow-wrap:anywhere]">
              {props.isDirty
                ? `The test${deletedTestName} is no longer on the server, so your changes cannot be saved to it. Discarding them clears the canvas and starts a new draft; they cannot be recovered.`
                : `The test${deletedTestName} is no longer on the server. Close clears the canvas and starts a new draft.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {props.isDirty && (
              <Button variant="secondary" onClick={keepDeletedTestOnCanvas}>
                Keep on canvas
              </Button>
            )}
            <Button
              variant={props.isDirty ? 'destructive' : 'default'}
              onClick={props.onDismissDeletedTest}
            >
              {props.isDirty ? 'Discard changes' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit-mode close nag: OK-only, non-blocking. */}
      <EditModeNotice
        open={props.showEditModeNag}
        testId="edit-mode-nag-modal"
        title="Functions still in edit mode"
        onAcknowledge={props.onCloseEditModeNag}
      >
        One or more Shared Functions were left in edit mode. Their changes are
        not published, and those instances stay unlinked from the shared library
        until you publish or drop the changes.
      </EditModeNotice>

      <FunctionViewLeaveNotice
        open={props.showFunctionViewLeaveNotice}
        onAcknowledge={props.onAcknowledgeFunctionViewLeave}
        onCancel={props.onCancelFunctionViewLeave}
      />

      {/* Validation Error Dialog */}
      <ValidationErrorDialog
        isOpen={props.showValidationErrorDialog}
        fatal={props.validationFatal}
        errors={props.validationErrors}
        onClose={props.onValidationClose}
        onFixAll={onFixAll && (() => { onFixAll().catch(alreadyReported) })}
        onDeleteTest={onDeleteFatalTest && (() => { onDeleteFatalTest().catch(alreadyReported) })}
        isFixing={props.isFixingTest}
        mode={props.validationMode}
        onNavigateToIssue={props.onNavigateToIssue}
      />
    </>
  )
}
