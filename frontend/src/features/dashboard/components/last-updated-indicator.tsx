/**
 * LastUpdatedIndicator
 *
 * Dashboard header pill that replaces the manual Refresh button. Communicates
 * auto-refresh health with a single short label + status dot. State-only by
 * design - no relative-time readout, because at a 5 s poll a ticking label
 * provides no signal on the healthy path.
 */

import { type ReactNode } from 'react'

export type LiveStatus = 'live' | 'paused' | 'reconnecting'

interface LastUpdatedIndicatorProps {
  status: LiveStatus
}

const STATUS_LABEL: Record<LiveStatus, string> = {
  live: 'Live',
  paused: 'Paused',
  reconnecting: 'Connection issue - retrying',
}

const DOT_COLOR: Record<LiveStatus, string> = {
  live: 'bg-info',
  paused: 'bg-muted',
  reconnecting: 'bg-warning',
}

export function LastUpdatedIndicator({
  status,
}: Readonly<LastUpdatedIndicatorProps>): ReactNode {
  const dotClasses = [
    'w-1.5',
    'h-1.5',
    'rounded-full',
    DOT_COLOR[status],
    status === 'live' ? 'animate-pulse' : null,
  ]
    .filter((c): c is string => Boolean(c))
    .join(' ')

  return (
    <span
      data-testid="dashboard-live-status"
      data-status={status}
      className="inline-flex items-center gap-1.5 rounded-full py-1 px-2.5 text-xs font-medium bg-subtle text-muted-foreground"
    >
      <span data-badge-dot className={dotClasses} />
      <span>{STATUS_LABEL[status]}</span>
    </span>
  )
}
