/**
 * Take-over outcome modal (SESS-5..8): when a pending take-over resolves the
 * waiting/approval modal switches to this so the affected tab is told what
 * happened - the requester was granted or denied, or this holder was forced out.
 */

import { CheckCircle2, XCircle, Zap } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type TakeOverOutcome = 'granted' | 'denied' | 'forced'

export interface TakeOverResultDialogProps {
  open: boolean
  outcome: TakeOverOutcome
  onClose: () => void
}

interface OutcomeConfig {
  Icon: typeof CheckCircle2
  iconWrap: string
  iconColor: string
  title: string
  body: string
  action: string
  actionVariant: 'default' | 'secondary'
}

const OUTCOMES: Record<TakeOverOutcome, OutcomeConfig> = {
  granted: {
    Icon: CheckCircle2,
    iconWrap: 'bg-emerald-500/15',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    title: 'You now hold the session',
    body: 'You are now editing this draft; the previous holder is watching.',
    action: 'Start editing',
    actionVariant: 'default',
  },
  denied: {
    Icon: XCircle,
    iconWrap: 'bg-muted',
    iconColor: 'text-muted-foreground',
    title: 'Take-over denied',
    body: 'The session holder denied your take-over. You are still watching, read-only.',
    action: 'OK',
    actionVariant: 'secondary',
  },
  forced: {
    Icon: Zap,
    iconWrap: 'bg-amber-500/15',
    iconColor: 'text-amber-600 dark:text-amber-400',
    title: 'Session taken over',
    body: 'Another session forced a take-over. You are now watching, read-only.',
    action: 'OK',
    actionVariant: 'secondary',
  },
}

export function TakeOverResultDialog({
  open,
  outcome,
  onClose,
}: Readonly<TakeOverResultDialogProps>) {
  const cfg = OUTCOMES[outcome]
  const { Icon } = cfg

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <div className="flex justify-center">
          <span
            className={cn('flex h-12 w-12 items-center justify-center rounded-full', cfg.iconWrap)}
          >
            <Icon className={cn('h-6 w-6', cfg.iconColor)} aria-hidden="true" />
          </span>
        </div>
        <AlertDialogTitle className="text-center">{cfg.title}</AlertDialogTitle>
        <AlertDialogDescription className="text-center">{cfg.body}</AlertDialogDescription>
        <div className="flex justify-center pt-2">
          <Button variant={cfg.actionVariant} onClick={onClose}>
            {cfg.action}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
