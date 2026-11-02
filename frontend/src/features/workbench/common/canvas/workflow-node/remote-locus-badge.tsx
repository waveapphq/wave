/**
 * Execution-locus badge for blocks inside a Remote Execution container (REQ-3.4.1.3).
 *
 * Mirrors the Function lifecycle L / S badge: a small square chip in the node
 * status bar. `R` (cyan) means the block runs on the remote host; `L` (slate)
 * means it runs locally on WAVE. Set automatically from the plugin's remotable
 * flag + body membership, so the user can see at a glance where each block runs.
 */

import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type RemoteLocus = 'R' | 'L'

const COLOR_BY_LOCUS: Record<RemoteLocus, string> = {
  R: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30',
  L: 'bg-slate-500/15 text-slate-700 dark:text-slate-200 border-slate-500/30',
}

const TOOLTIP_BY_LOCUS: Record<RemoteLocus, string> = {
  R: 'Runs on the remote host',
  L: 'Runs on WAVE',
}

export interface RemoteLocusBadgeProps {
  locus: RemoteLocus
  testId?: string
}

export function RemoteLocusBadge({
  locus,
  testId = 'node-remote-locus-badge',
}: Readonly<RemoteLocusBadgeProps>) {
  const tooltip = TOOLTIP_BY_LOCUS[locus]
  return (
    <ConditionalTooltip content={tooltip}>
      <span
        data-testid={testId}
        data-locus={locus}
        aria-label={tooltip}
        className={cn(
          'inline-flex items-center justify-center rounded border font-semibold leading-none cursor-default select-none shrink-0',
          'h-4 w-4 text-[10px]',
          COLOR_BY_LOCUS[locus],
        )}
      >
        {locus}
      </span>
    </ConditionalTooltip>
  )
}
