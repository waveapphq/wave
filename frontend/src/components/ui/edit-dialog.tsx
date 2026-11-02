/**
 * EditDialog - Generic edit dialog with unsaved-changes protection.
 *
 * Wraps Dialog with consistent behavior:
 * - Prevents click-away from closing; ESC is ignored unless closeOnEscape, then it acts as Cancel
 * - Shows "Unsaved changes" confirmation when dirty
 * - Three options: Keep Editing, Close, Save
 * - Async save with spinner
 */

import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Save } from 'lucide-react'
import {
  ChildEditorsProvider,
  type ChildEditorScope,
} from '@/components/shared/child-editors/child-editor-scope'
import { SaveBlockedNote } from '@/components/shared/child-editors/save-blocked-note'
import { UnsavedChangesDialog } from '@/components/shared/child-editors/unsaved-changes-dialog'
import { saveBlockedNote } from '@/lib/child-editors'

// The test ids end-to-end flows address this dialog's answers by.
const UNSAVED_DIALOG_TEST_IDS = {
  dialog: 'unsaved-changes-dialog',
  keepEditing: 'unsaved-keep-editing',
  close: 'unsaved-discard',
  save: 'unsaved-save-close',
}

export interface EditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  /** Async save handler - dialog shows spinner until resolved */
  onSave: () => Promise<void>
  /** Cleanup callback on discard */
  onDiscard?: () => void
  /** Whether the form has unsaved changes */
  isDirty: boolean
  /** Whether the save button should be disabled (e.g. form invalid) */
  saveDisabled?: boolean
  /** Names why the form is invalid while saveDisabled holds, under Save. */
  invalidNote?: string
  /** The floating editors this dialog opens: Save waits on them and writes them, closing counts them. */
  childEditors?: ChildEditorScope
  /** Custom save button label (default: "Save") */
  saveLabel?: string
  /** CSS class for DialogContent */
  className?: string
  /** Custom error formatter - receives caught error, returns ReactNode */
  formatError?: (error: unknown) => ReactNode
  /** Flex-center the dialog so a non-portaled floating value-editor sheet floats
   *  over it correctly (the entity variable tables host the shared cell + sheet). */
  allowFloatingSheet?: boolean
  /** Esc closes the dialog the way Cancel does (asks first when there are unsaved changes). */
  closeOnEscape?: boolean
  'data-testid'?: string
}

export function EditDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSave,
  onDiscard,
  isDirty,
  saveDisabled = false,
  invalidNote,
  childEditors,
  saveLabel = 'Save',
  className,
  formatError,
  allowFloatingSheet,
  closeOnEscape = false,
  'data-testid': testId,
}: Readonly<EditDialogProps>): ReactNode {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<ReactNode | null>(null)

  const renderError = useCallback((err: unknown): ReactNode => {
    if (formatError) return formatError(err)
    return err instanceof Error ? err.message : 'Failed to save'
  }, [formatError])

  const childChanges = childEditors?.hasChanges ?? false
  const hasChanges = isDirty || childChanges
  const formNote = saveDisabled ? (invalidNote ?? null) : null
  const blockedNote = childEditors ? saveBlockedNote(formNote, childEditors.children) : null
  // A parent of floating editors has nothing to save until something changed.
  const nothingToSave = childEditors !== undefined && !hasChanges
  const saveBlocked = saveDisabled || blockedNote !== null

  const tryClose = useCallback(() => {
    if (hasChanges) {
      setShowConfirm(true)
    } else {
      onOpenChange(false)
    }
  }, [hasChanges, onOpenChange])

  const handleKeepEditing = useCallback(() => {
    setShowConfirm(false)
  }, [])

  const handleDiscardAndClose = useCallback(() => {
    setShowConfirm(false)
    setSaveError(null)
    onDiscard?.()
    onOpenChange(false)
  }, [onDiscard, onOpenChange])

  // Editors write through the host's state first, so the save must read the host after them.
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  // The buttons cannot await, so the save runs here and its failure lands on
  // the dialog's own error line.
  const runSave = useCallback(async (): Promise<void> => {
    childEditors?.applyAll()
    setIsSaving(true)
    setSaveError(null)
    try {
      await onSaveRef.current()
    } finally {
      setIsSaving(false)
    }
  }, [childEditors])

  const handleSaveAndClose = useCallback((): void => {
    runSave()
      .then(() => {
        setShowConfirm(false)
        onOpenChange(false)
      })
      .catch((err: unknown) => setSaveError(renderError(err)))
  }, [runSave, onOpenChange, renderError])

  const handleSave = useCallback((): void => {
    runSave()
      .then(() => onOpenChange(false))
      .catch((err: unknown) => setSaveError(renderError(err)))
  }, [runSave, onOpenChange, renderError])

  // Radix warns unless a dialog without a description says so explicitly.
  const described = description ? {} : { 'aria-describedby': undefined }

  return (
    <>
      <Dialog open={open} onOpenChange={() => tryClose()}>
        <DialogContent
          {...described}
          className={className}
          data-testid={testId}
          preventCloseOnClickOutside
          preventCloseOnEscape={!closeOnEscape}
          hideCloseButton
          floatingSheet={allowFloatingSheet}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          <div className="py-2">
            {childEditors ? (
              <ChildEditorsProvider scope={childEditors}>{children}</ChildEditorsProvider>
            ) : (
              children
            )}
          </div>

          {saveError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {saveError}
            </div>
          )}

          <SaveBlockedNote note={blockedNote} className="text-right" />

          <DialogFooter>
            <Button
              variant="outline"
              onClick={tryClose}
              disabled={isSaving}
              data-testid="edit-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || saveBlocked || nothingToSave}
              data-testid="edit-dialog-save"
            >
              {isSaving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              {saveLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsavedChangesDialog
        open={showConfirm}
        onKeepEditing={handleKeepEditing}
        onClose={handleDiscardAndClose}
        onSave={handleSaveAndClose}
        saveDisabled={saveDisabled}
        saveBlockedNote={blockedNote}
        busy={isSaving}
        testIds={UNSAVED_DIALOG_TEST_IDS}
      />
    </>
  )
}
