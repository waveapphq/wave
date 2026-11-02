/**
 * Requester-side waiting modal (SESS-5..8): the take-over request never
 * yanks - it waits for the holder to hand over, with Force Take Over as
 * the escape hatch.
 */

import { Loader2, Zap } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export interface TakeOverWaitingDialogProps {
  open: boolean
  holderLabel: string
  holderKind: 'person' | 'mcp'
  onCancel: () => void
  onForce: () => void
}

export function TakeOverWaitingDialog({
  open,
  holderLabel,
  holderKind,
  onCancel,
  onForce,
}: Readonly<TakeOverWaitingDialogProps>) {
  const isMcp = holderKind === 'mcp'
  // A person holder has no stable identity yet, so it reads generically.
  const subject = isMcp ? holderLabel : 'Another session'
  const body = isMcp
    ? 'is finishing its current step, then it hands the session to you.'
    : 'is being asked to hand over. You take over when they approve.'

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <div className="flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/15">
            <Loader2
              className="h-6 w-6 animate-spin motion-reduce:animate-none text-violet-600 dark:text-violet-300"
              aria-hidden="true"
            />
          </span>
        </div>
        <AlertDialogTitle className="text-center">Waiting to take over</AlertDialogTitle>
        <AlertDialogDescription className="text-center">
          <span className="font-semibold text-foreground">{subject}</span> {body}
        </AlertDialogDescription>
        <div className="flex items-center justify-between pt-2">
          <AlertDialogCancel asChild>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </AlertDialogCancel>
          <Button
            variant="outline"
            className="border-amber-500/60 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
            onClick={onForce}
          >
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            Force Take Over
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
