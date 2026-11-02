/**
 * Indigo READ-ONLY pill (FN-LC-13 palette): lock glyph + uppercase copy.
 * Decorative - enforcement happens in the canvas store / read-only context.
 */

import { Lock } from 'lucide-react'

import { cn } from '@/lib/utils'

export function ReadOnlyPill({
  ariaLabel = 'Read-only',
  className,
  'data-testid': testId,
}: Readonly<{
  ariaLabel?: string
  className?: string
  'data-testid'?: string
}>) {
  return (
    <span
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5',
        'text-[10px] font-semibold uppercase tracking-wider',
        'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
        className,
      )}
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      Read-only
    </span>
  )
}
