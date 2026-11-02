/**
 * Holder-side "N watching" pill: visible only while at least one other
 * viewer mirrors the draft. Enforcement-free, mirrors the ReadOnlyPill idiom.
 */

import { Eye } from 'lucide-react'

export function WatchersIndicator({ count }: Readonly<{ count: number }>) {
  if (count === 0) return null
  const noun = count === 1 ? 'person' : 'people'
  return (
    <span
      aria-label={`${count} ${noun} watching`}
      data-testid="watchers-indicator"
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-muted text-muted-foreground"
    >
      <Eye className="h-3 w-3" aria-hidden="true" />
      {count} watching
    </span>
  )
}
