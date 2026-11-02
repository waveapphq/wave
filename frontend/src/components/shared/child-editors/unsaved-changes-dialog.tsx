/**
 * The question a parent asks when it closes with unsaved changes: Keep Editing, Close or Save.
 */

import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SaveBlockedNote } from './save-blocked-note'

export interface UnsavedChangesDialogTestIds {
  dialog: string
  keepEditing: string
  close: string
  save: string
}

const DEFAULT_TEST_IDS: UnsavedChangesDialogTestIds = {
  dialog: 'unsaved-changes-dialog',
  keepEditing: 'unsaved-keep-editing',
  close: 'unsaved-close',
  save: 'unsaved-save',
}

export interface UnsavedChangesDialogProps {
  open: boolean
  onKeepEditing: () => void
  /** Discards every unsaved change and closes. */
  onClose: () => void
  /** The parent's own Save; left out where the parent cannot save. */
  onSave?: () => void
  /** Save is unavailable for a reason its host does not name. */
  saveDisabled?: boolean
  saveBlockedNote?: string | null
  /** A save is in flight: every button waits for it. */
  busy?: boolean
  testIds?: UnsavedChangesDialogTestIds
  keepEditingLabel?: string
  closeLabel?: string
}

export function UnsavedChangesDialog({
  open,
  onKeepEditing,
  onClose,
  onSave,
  saveDisabled = false,
  saveBlockedNote = null,
  busy = false,
  testIds = DEFAULT_TEST_IDS,
  keepEditingLabel = 'Keep Editing',
  closeLabel = 'Close',
}: Readonly<UnsavedChangesDialogProps>) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeepEditing()
      }}
    >
      <DialogContent className="max-w-md" data-testid={testIds.dialog}>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>You have unsaved changes. What would you like to do?</DialogDescription>
        </DialogHeader>
        {onSave && <SaveBlockedNote note={saveBlockedNote} className="text-right" />}
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            disabled={busy}
            data-testid={testIds.keepEditing}
            onClick={onKeepEditing}
          >
            {keepEditingLabel}
          </Button>
          <Button variant="destructive" disabled={busy} data-testid={testIds.close} onClick={onClose}>
            {closeLabel}
          </Button>
          {onSave && (
            <Button
              disabled={busy || saveDisabled || saveBlockedNote !== null}
              data-testid={testIds.save}
              onClick={onSave}
            >
              {busy && (
                <Loader2
                  data-testid="unsaved-save-spinner"
                  className="mr-1.5 h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
              )}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
