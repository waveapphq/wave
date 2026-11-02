/**
 * MakeLocalDialog - confirmation dialog for the published->local detach.
 *
 * Built on the shared ``ConfirmationDialog`` wrapper (variant="disconnect")
 * so destructive-dialog policy (no ESC / backdrop dismiss, alertdialog role,
 * danger button styling) is enforced consistently with the rest of the
 * canvas lifecycle dialogs.
 *
 * Contract:
 *   - Title: "Make Local"
 *   - Body: prose + amber callout warning about cutting the library link
 *   - Footer: Cancel + Make Local (primary)
 *   - On API failure the dialog stays open and surfaces the inline error
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, Unlink } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { DetachFunctionResult } from '@/features/functions/api/types'

export interface MakeLocalDialogPublishedRef {
  /** Empty string when the canvas is a draft (Test not saved yet). */
  testId: string
  nodeId: string
  functionId: string
  functionName: string
  etag?: string
}

interface MakeLocalDialogProps {
  isOpen: boolean
  onClose: () => void
  onDetached: (node: DetachFunctionResult['node']) => void
  publishedRef: MakeLocalDialogPublishedRef
  /**
   * Performs the actual detach. Parent picks the path: the saved-Test path
   * (POST /tests/{id}/functions/detach) for a real Test, or the in-memory
   * deep-copy for a draft canvas.
   */
  onConfirm: () => Promise<DetachFunctionResult['node']>
}

export function MakeLocalDialog({
  isOpen,
  onClose,
  onDetached,
  publishedRef,
  onConfirm,
}: Readonly<MakeLocalDialogProps>) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setPending(false)
  }, [isOpen])

  /** A detach that failed is named on the dialog's own error line. */
  const reportFailure = (err: unknown): void => {
    setError((err as { message?: string })?.message ?? 'Detach failed')
    setPending(false)
  }

  const handleConfirm = async () => {
    setPending(true)
    setError(null)
    try {
      const node = await onConfirm()
      onDetached(node)
      onClose()
    } catch (err) {
      reportFailure(err)
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open && !pending) onClose() }}>
      <AlertDialogContent
        className={cn('max-w-[480px] p-6 rounded-xl shadow-lg bg-elevated gap-0')}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="icon-xl mb-4 text-error" aria-hidden="true">
          <Unlink size={24} />
        </div>
        <AlertDialogTitle className="text-primary mb-2">Make Local</AlertDialogTitle>
        <AlertDialogDescription className="font-normal text-secondary leading-normal mb-3">
          Making <span className="font-semibold">{publishedRef.functionName}</span>{' '}
          local copies this published Function&apos;s body into this Test as its
          own editable copy. The library entry is untouched and future updates to
          it will no longer flow into this instance.
        </AlertDialogDescription>
        <div
          data-testid="make-local-callout"
          className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-100 mb-4 text-left text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Once detached, this instance evolves independently from the library.
          </span>
        </div>
        {error ? (
          <div
            data-testid="make-local-error"
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm mb-4 text-left"
          >
            {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-3">
          <AlertDialogCancel asChild>
            <Button variant="secondary" size="md" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
          </AlertDialogCancel>
          <Button
            variant="danger"
            size="md"
            onClick={() => { handleConfirm().catch(reportFailure) }}
            disabled={pending}
            loading={pending}
            aria-busy={pending || undefined}
          >
            Make Local
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
