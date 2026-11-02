/** Icon, color token and outcome words per backup status, read by the preview table and the item list. */

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  SkipForward,
  XCircle,
  type LucideIcon,
} from 'lucide-react'

type BackupStatus = 'ok' | 'conflict' | 'fixable' | 'fatal' | 'skipped'

export type RestoreStage = 'preview' | 'result'

export const STATUS_ICONS: Record<BackupStatus, { Icon: LucideIcon; className: string }> = {
  ok: { Icon: CheckCircle, className: 'text-success' },
  conflict: { Icon: AlertTriangle, className: 'text-warning' },
  fixable: { Icon: AlertCircle, className: 'text-info' },
  fatal: { Icon: XCircle, className: 'text-destructive' },
  skipped: { Icon: SkipForward, className: 'text-muted-foreground' },
}

export const STATUS_OUTCOMES: Record<RestoreStage, Partial<Record<BackupStatus, string>>> = {
  preview: { fatal: 'Cannot be restored' },
  result: { fatal: 'Not restored' },
}
