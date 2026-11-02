/**
 * The red note that names what keeps a parent's Save disabled.
 */

import { cn } from '@/lib/utils'

export function SaveBlockedNote({
  note,
  className,
}: Readonly<{ note: string | null; className?: string }>) {
  if (note === null) return null
  return (
    <p
      data-testid="save-blocked-note"
      aria-live="polite"
      className={cn('text-xs text-destructive', className)}
    >
      {note}
    </p>
  )
}
