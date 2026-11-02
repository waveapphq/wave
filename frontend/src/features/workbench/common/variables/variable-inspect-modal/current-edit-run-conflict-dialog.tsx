/** Holds a run / resume while an open Edit window holds an unsaved change (VMGR-64). */

import { useCallback, useRef } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DrillEntry } from '@/features/functions/canvas/inner-workflow'

/** One open window holding an unsaved change; the dialog names it, never its scope. */
export interface CurrentEditRunConflictEntry {
  name: string
  functionPath?: readonly string[] | readonly DrillEntry[] | null
  /** The window holds a definition change, not only a Current value. */
  definitionChanged?: boolean
}

export interface CurrentEditRunConflictDialogProps {
  isOpen: boolean
  entries: readonly CurrentEditRunConflictEntry[]
  onCancel: () => void
  onDrop: () => void
  onSave: () => void
  /** A Save is in flight: Cancel and Drop are locked. */
  isSaving?: boolean
}

export function CurrentEditRunConflictDialog({
  isOpen,
  entries,
  onCancel,
  onDrop,
  onSave,
  isSaving = false,
}: Readonly<CurrentEditRunConflictDialogProps>) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open || isSaving) return
      onCancel()
    },
    [isSaving, onCancel]
  )

  const names = entries.map((entry) => entry.name).join(', ')
  const plural = entries.length > 1
  const currentOnly = !entries.some((entry) => entry.definitionChanged)
  const owners = plural ? 'These variables have' : 'This variable has'
  const currentTitle = plural ? 'Unsaved Current values' : 'Unsaved Current value'

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md"
        hideCloseButton
        preventCloseOnClickOutside
        data-testid="current-edit-run-conflict-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
          </div>
          <DialogTitle>{currentOnly ? currentTitle : 'Unsaved changes'}</DialogTitle>
        </DialogHeader>

        <DialogDescription asChild>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              {owners} {currentOnly ? 'an unsaved Current-value edit' : 'unsaved changes'}:{' '}
              <span className="font-medium text-foreground [overflow-wrap:anywhere]">{names}</span>.
            </p>
            <p>
              {currentOnly
                ? 'Save the override before the run, drop it, or cancel and keep editing.'
                : 'Save the changes before the run, drop them, or cancel and keep editing.'}
            </p>
          </div>
        </DialogDescription>

        <DialogFooter className="gap-3 sm:space-x-0">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            className="whitespace-nowrap"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="whitespace-nowrap"
            onClick={onDrop}
            disabled={isSaving}
          >
            Drop Changes
          </Button>
          <Button
            type="button"
            className="whitespace-nowrap"
            onClick={onSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
