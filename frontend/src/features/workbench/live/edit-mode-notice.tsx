import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface EditModeNoticeProps {
  open: boolean
  testId: string
  title: string
  children: ReactNode
  /** OK; Escape and the backdrop too unless onDismiss is given, so the notice never traps the user. */
  onAcknowledge: () => void
  /** Escape and the backdrop. */
  onDismiss?: () => void
}

/** OK-only notice about Functions left in edit mode. */
export function EditModeNotice({
  open,
  testId,
  title,
  children,
  onAcknowledge,
  onDismiss = onAcknowledge,
}: Readonly<EditModeNoticeProps>) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss()
      }}
    >
      <DialogContent data-testid={testId} hideCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
            {title}
          </DialogTitle>
          <DialogDescription>{children}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="default" onClick={onAcknowledge}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface FunctionViewLeaveNoticeProps {
  open: boolean
  onAcknowledge: () => void
  /** Escape and the backdrop keep the View, so a stray key never drops the draft. */
  onCancel: () => void
}

/** Leaving the library View drops its edit-mode draft (VIEW-10). */
export function FunctionViewLeaveNotice({ open, onAcknowledge, onCancel }: Readonly<FunctionViewLeaveNoticeProps>) {
  return (
    <EditModeNotice
      open={open}
      testId="function-view-leave-notice"
      title="Function still in edit mode"
      onAcknowledge={onAcknowledge}
      onDismiss={onCancel}
    >
      Leaving the View drops this Function&apos;s unpublished draft.
    </EditModeNotice>
  )
}
