/**
 * SwitchTestConfirmDialog Component
 *
 * Dialog shown when the user tries to open a different Test/Function while the
 * workbench has:
 * - Unsaved changes (dirty state)
 * - Active execution state (non-idle: running/passed/failed/stopped/paused)
 * - A test/function currently running or paused (isRunning)
 *
 * The CURRENTLY-OPEN entity may be a Test (or untitled draft) or a library
 * Function in edit mode. `entityKind` selects the wording and whether a Save
 * action is offered: a Function is published through a deliberate versioned
 * flow, so its dialog offers Discard or Cancel only.
 *
 * Scenarios (highest priority first):
 * 0. isRunning: "stop first" message with only a View button - no destructive
 *    option, because killing a live execution silently is unsafe.
 * 1. Non-idle + clean: "Reset & Open New" to clear execution state
 * 2. Non-idle + dirty: both options with a warning about losing results
 * 3. Idle + dirty: save/discard (Test) or discard-only (Function)
 *
 * Built on Radix Dialog (portal, focus trap, scroll lock, ESC to dismiss).
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

export interface SwitchTestDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Name of the entity currently open (with unsaved changes) */
  currentTestName: string | null
  /** Which kind of entity is currently open. Functions get discard-only wording. */
  entityKind?: 'test' | 'function'
  /** Called when user clicks "View Pending Workflow"/"Keep Editing" or ESC */
  onViewPendingWorkflow: () => void
  /** Called when user clicks "Save & Switch". Not used in ``isRunning`` mode or
   *  for Functions (no save button is rendered); callers may omit it. */
  onSaveAndSwitch?: () => void
  /** Called when user clicks "Discard & Switch" or "Reset & Switch". Not
   *  used in ``isRunning`` mode; callers on the running-session path may
   *  omit it. */
  onDiscardAndSwitch?: () => void
  /** Whether a save operation is in progress */
  isSaving?: boolean
  /** Mode: 'switch' for opening another test, 'create' for creating a new test */
  mode?: 'switch' | 'create'
  /** Whether there are unsaved changes (dirty state) */
  isDirty?: boolean
  /** Whether there is active execution state (non-idle) */
  executionActive?: boolean
  /** Whether a test is currently running or paused. When true, the dialog
   *  becomes a "stop first" notice with no destructive option - users must
   *  stop the running test explicitly before opening another one. */
  isRunning?: boolean
  /** Optional cancel handler used in ``isRunning`` mode so callers (e.g. the
   *  tests-list page) can simply dismiss the dialog without navigating. When
   *  omitted, ESC and outside-dismiss fall back to ``onViewPendingWorkflow``. */
  onCancel?: () => void
  /** Ephemeral session artifact count; > 0 renders the loss callout (never in isRunning mode). */
  sessionArtifactCount?: number
  /** Test data files still arriving, named in the warning (TDATA-14). */
  uploadCount?: number
}

interface DialogCopy {
  isRunning: boolean
  executionOnlyMode: boolean
  executionActive: boolean
  noun: string
  displayName: string
  mode: 'switch' | 'create'
  dirtyAction: string
}

// ===========================================================================
// Copy helpers (pure - keep the main component's branching low)
// ===========================================================================

function computeTitle(
  isRunning: boolean,
  isFunction: boolean,
  executionOnlyMode: boolean,
  executionActive: boolean,
): string {
  if (isRunning) return isFunction ? 'Function is Running' : 'Test is Running'
  if (executionOnlyMode) return 'Active Execution State'
  if (executionActive) return 'Unsaved Changes & Execution State'
  return 'Unsaved Changes in Workbench'
}

function computeDirtyAction(
  isFunction: boolean,
  executionActive: boolean,
  mode: 'switch' | 'create',
): string {
  const suffix = executionActive ? ' The execution results will be reset.' : ''
  if (isFunction) {
    return `Discard the pending changes to continue, or cancel to keep editing.${suffix} Publish the function to save your changes.`
  }
  if (mode === 'create') {
    return `To create a new test, you can either save or discard the pending changes.${suffix}`
  }
  return `To open a different workflow, you can either save or discard the pending changes.${suffix}`
}

// ===========================================================================
// Sub-components
// ===========================================================================

function EntityName({ name }: Readonly<{ name: string }>): ReactNode {
  return <span className="font-medium text-foreground">&quot;{name}&quot;</span>
}

function SwitchDialogMessage({ copy }: Readonly<{ copy: DialogCopy }>): ReactNode {
  const { isRunning, executionOnlyMode, executionActive, noun, displayName, mode, dirtyAction } = copy
  if (isRunning) {
    return (
      <>
        <p>
          The {noun} <EntityName name={displayName} /> is currently running in the Workbench.
        </p>
        <p>
          {mode === 'create'
            ? `Stop the running ${noun} before creating a new one.`
            : `Stop the running ${noun} before opening a different one.`}
        </p>
      </>
    )
  }
  if (executionOnlyMode) {
    return (
      <p>
        The {noun} <EntityName name={displayName} /> has an active execution state. Opening something
        else will reset the execution results.
      </p>
    )
  }
  return (
    <>
      <p>
        The {noun} <EntityName name={displayName} /> is currently open in the Workbench with unsaved
        changes{executionActive ? ' and an active execution state' : ''}.
      </p>
      <p>{dirtyAction}</p>
    </>
  )
}

function RunningFooter({
  onViewPendingWorkflow,
  onCancel,
  isSaving,
}: Readonly<{ onViewPendingWorkflow: () => void; onCancel?: () => void; isSaving: boolean }>): ReactNode {
  return (
    <>
      {onCancel && (
        <Button type="button" variant="outline" className="whitespace-nowrap" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      )}
      <Button type="button" className="whitespace-nowrap" onClick={onViewPendingWorkflow} disabled={isSaving}>
        Go to Workbench
      </Button>
    </>
  )
}

function SaveButtonLabel({ isSaving, mode }: Readonly<{ isSaving: boolean; mode: 'switch' | 'create' }>): ReactNode {
  if (isSaving) {
    return (
      <>
        <Loader2 data-testid="save-spinner" className="mr-2 h-4 w-4 animate-spin" />
        Saving…
      </>
    )
  }
  return mode === 'create' ? 'Save & Create Test' : 'Save & Open New'
}

interface ChangeFooterProps {
  executionOnlyMode: boolean
  isFunction: boolean
  mode: 'switch' | 'create'
  isSaving: boolean
  isFunctionLabel: string
  onViewPendingWorkflow: () => void
  onDiscardAndSwitch?: () => void
  onSaveAndSwitch?: () => void
}

function ChangeFooter(props: Readonly<ChangeFooterProps>): ReactNode {
  const { executionOnlyMode, isFunction, mode, isSaving, isFunctionLabel, onViewPendingWorkflow, onDiscardAndSwitch, onSaveAndSwitch } = props
  return (
    <>
      <Button type="button" variant="outline" className="whitespace-nowrap" onClick={onViewPendingWorkflow} disabled={isSaving}>
        {isFunctionLabel}
      </Button>
      {executionOnlyMode ? (
        <Button type="button" className="whitespace-nowrap" onClick={onDiscardAndSwitch} disabled={isSaving}>
          {mode === 'create' ? 'Reset & Create Test' : 'Reset & Open New'}
        </Button>
      ) : (
        <>
          <Button type="button" variant="destructive" className="whitespace-nowrap" onClick={onDiscardAndSwitch} disabled={isSaving}>
            {mode === 'create' ? 'Discard & Create Test' : 'Discard & Open New'}
          </Button>
          {!isFunction && (
            <Button type="button" className="whitespace-nowrap" onClick={onSaveAndSwitch} disabled={isSaving}>
              <SaveButtonLabel isSaving={isSaving} mode={mode} />
            </Button>
          )}
        </>
      )}
    </>
  )
}

// ===========================================================================
// Component
// ===========================================================================

export function SwitchTestConfirmDialog({
  isOpen,
  currentTestName,
  entityKind = 'test',
  onViewPendingWorkflow,
  onSaveAndSwitch,
  onDiscardAndSwitch,
  isSaving = false,
  mode = 'switch',
  isDirty = true,
  executionActive = false,
  isRunning = false,
  onCancel,
  sessionArtifactCount = 0,
  uploadCount = 0,
}: Readonly<SwitchTestDialogProps>): ReactNode {
  // In isRunning mode, ESC/outside-dismiss should simply close the dialog
  // (via onCancel when provided), not navigate the user to the workbench.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open || isSaving) return
      if (isRunning && onCancel) {
        onCancel()
        return
      }
      onViewPendingWorkflow()
    },
    [isSaving, isRunning, onCancel, onViewPendingWorkflow]
  )

  const isFunction = entityKind === 'function'
  const noun = isFunction ? 'function' : 'test'
  const displayName = currentTestName || (isFunction ? 'this function' : 'Draft Workflow')
  const executionOnlyMode = !isRunning && executionActive && !isDirty
  const title = computeTitle(isRunning, isFunction, executionOnlyMode, executionActive)
  const copy: DialogCopy = {
    isRunning,
    executionOnlyMode,
    executionActive,
    noun,
    displayName,
    mode,
    dirtyAction: computeDirtyAction(isFunction, executionActive, mode),
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl" hideCloseButton preventCloseOnClickOutside data-testid="switch-test-dialog">
        <DialogHeader className="flex-row items-center gap-3 space-y-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10">
            <AlertTriangle className="h-5 w-5 text-warning" />
          </div>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <DialogDescription asChild>
          <div className="space-y-3 text-sm text-muted-foreground">
            <SwitchDialogMessage copy={copy} />
          </div>
        </DialogDescription>

        {/* The running notice offers no destructive action - nothing is deleted. */}
        {!isRunning && <SessionArtifactLossCallout count={sessionArtifactCount} />}
        <UploadsInProgressCallout count={uploadCount} />

        <DialogFooter className="gap-3 sm:space-x-0">
          {isRunning ? (
            <RunningFooter onViewPendingWorkflow={onViewPendingWorkflow} onCancel={onCancel} isSaving={isSaving} />
          ) : (
            <ChangeFooter
              executionOnlyMode={executionOnlyMode}
              isFunction={isFunction}
              mode={mode}
              isSaving={isSaving}
              isFunctionLabel={isFunction ? 'Keep Editing' : 'View Pending Workflow'}
              onViewPendingWorkflow={onViewPendingWorkflow}
              onDiscardAndSwitch={onDiscardAndSwitch}
              onSaveAndSwitch={onSaveAndSwitch}
            />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
