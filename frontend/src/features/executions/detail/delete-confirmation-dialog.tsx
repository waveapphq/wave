/**
 * DeleteConfirmationDialog for Execution Detail
 *
 * Simple type-less confirmation modal used only in the terminal-state toolbar.
 * Wraps shadcn AlertDialog with the testids the toolbar tests expect.
 */

import { Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export interface DeleteConfirmationDialogProps {
  open: boolean
  executionName: string
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteConfirmationDialog({
  open,
  executionName,
  onCancel,
  onConfirm,
}: Readonly<DeleteConfirmationDialogProps>) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <AlertDialogContent
        data-testid="delete-confirmation-dialog"
        className="max-w-[400px] rounded-xl bg-elevated p-6 text-center shadow-lg"
      >
        <div
          aria-hidden="true"
          className="mb-4 flex items-center justify-center text-error"
        >
          <Trash2 className="h-6 w-6" />
        </div>
        <AlertDialogTitle className="mb-2">
          Delete execution {executionName}?
        </AlertDialogTitle>
        <AlertDialogDescription className="mb-6 text-sm text-muted-foreground">
          This permanently removes the execution record and all of its artifacts
          and reports. Exported copies are unaffected.
        </AlertDialogDescription>
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            data-testid="delete-confirm-cancel"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            data-testid="delete-confirm"
            onClick={onConfirm}
          >
            Delete
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
