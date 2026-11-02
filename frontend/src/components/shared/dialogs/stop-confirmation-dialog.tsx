/**
 * StopConfirmationDialog
 *
 * Confirmation modal for stopping a tracked execution. The primary area of
 * the split Stop button preselects Immediate mode; the caret's "Stop with
 * Finalization" option preselects Finalize mode. Both modes flow through
 * this single dialog (per the Stop Confirmation Policy).
 */

import { AlertTriangle } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export type StopMode = 'immediate' | 'finalize'

export interface StopConfirmationDialogProps {
  open: boolean
  mode: StopMode
  onCancel: () => void
  onConfirm: (mode: StopMode) => void
}

const MODE_COPY: Record<StopMode, { title: string; description: string }> = {
  immediate: {
    title: 'Stop execution immediately?',
    description:
      'The execution will stop at the next safe point without running finalizers. Partial results will be saved.',
  },
  finalize: {
    title: 'Stop execution with finalization?',
    description:
      'The execution will complete any running finalizers before stopping. This may take a few moments.',
  },
}

export function StopConfirmationDialog({
  open,
  mode,
  onCancel,
  onConfirm,
}: Readonly<StopConfirmationDialogProps>) {
  const copy = MODE_COPY[mode]

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <AlertDialogContent
        data-testid="stop-confirmation-dialog"
        className="max-w-[400px] rounded-xl bg-elevated p-6 text-center shadow-lg"
      >
        <div
          aria-hidden="true"
          className="mb-4 flex items-center justify-center text-error"
        >
          <AlertTriangle className="h-6 w-6" />
        </div>
        <AlertDialogTitle className="mb-2">{copy.title}</AlertDialogTitle>
        <AlertDialogDescription className="mb-6 text-sm text-muted-foreground">
          {copy.description}
        </AlertDialogDescription>
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            data-testid="stop-confirm-cancel"
            onClick={onCancel}
          >
            Cancel
          </Button>
          {mode === 'immediate' ? (
            <Button
              variant="danger"
              data-testid="stop-confirm-immediate"
              onClick={() => onConfirm('immediate')}
            >
              Stop Immediately
            </Button>
          ) : (
            <Button
              variant="danger"
              data-testid="stop-confirm-finalize"
              onClick={() => onConfirm('finalize')}
            >
              Stop with Finalization
            </Button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
