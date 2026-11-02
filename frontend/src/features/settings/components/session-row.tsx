/**
 * Shared session row consumed by the MCP Sessions list (tone 'violet') and the
 * WAVE Server roster (tone 'indigo'). Pure presentation - identity, address,
 * connected/active meta, Disconnect, an optional deep-link highlight (ring +
 * optional chip + scroll), an optional Active/Watching role pill, and an
 * optional "You" self marker.
 */

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatClock, formatTimestamp, type TimezoneMode } from '@/lib/timestamp-format'

export type SessionRowTone = 'violet' | 'indigo'
export type SessionRole = 'active' | 'watching'

export interface SessionRowProps {
  sessionId: string
  client: string
  ip: string
  connectedAt: string
  lastActivity: string
  mode: TimezoneMode
  onDisconnect: (sessionId: string) => void
  testidPrefix: string
  /** Deep-link target: ring + scroll into view (+ chip when highlightLabel is set). */
  highlighted?: boolean
  /** Chip text shown on the highlighted row; omit for no chip. */
  highlightLabel?: string
  /** Workbench role: 'active' (editing) or 'watching' (mirroring), or none. */
  role?: SessionRole
  /** The viewer's own session: a "You" marker + accent tint + left bar. */
  isSelf?: boolean
  tone?: SessionRowTone
}

const ROLE_PILL: Record<SessionRole, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  watching: { label: 'Watching', className: 'bg-muted text-muted-foreground' },
}

function scrollSessionRowIntoView(element: HTMLDivElement | null): void {
  element?.scrollIntoView({ block: 'center' })
}

const HIGHLIGHT_RING: Record<SessionRowTone, string> = {
  violet: 'rounded-md bg-violet-500/5 ring-2 ring-inset ring-violet-500',
  indigo: 'rounded-md bg-indigo-500/5 ring-2 ring-inset ring-indigo-500',
}

const HIGHLIGHT_CHIP: Record<SessionRowTone, string> = {
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  indigo: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
}

export function SessionRow({
  sessionId,
  client,
  ip,
  connectedAt,
  lastActivity,
  mode,
  onDisconnect,
  testidPrefix,
  highlighted = false,
  highlightLabel,
  role,
  isSelf = false,
  tone = 'violet',
}: Readonly<SessionRowProps>) {
  const clientLabelId = `${testidPrefix}-${sessionId}-client`
  return (
    <div
      data-testid={`${testidPrefix}-${sessionId}`}
      data-highlighted={highlighted ? 'true' : undefined}
      ref={highlighted ? scrollSessionRowIntoView : undefined}
      className={cn(
        'flex items-center gap-4 p-3',
        isSelf && !highlighted && 'border-l-2 border-primary bg-primary/5',
        highlighted && HIGHLIGHT_RING[tone],
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
        <span id={clientLabelId} translate="no" className="min-w-0 truncate text-sm font-medium">
          {client}
        </span>
        {isSelf && (
          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            You
          </span>
        )}
        {role && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              ROLE_PILL[role].className,
            )}
          >
            {ROLE_PILL[role].label}
          </span>
        )}
        {highlighted && highlightLabel && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              HIGHLIGHT_CHIP[tone],
            )}
          >
            {highlightLabel}
          </span>
        )}
      </span>
      <span translate="no" className="w-40 shrink-0 truncate font-mono text-xs text-muted-foreground">
        {ip}
      </span>
      <span className="w-64 shrink-0 truncate text-xs text-muted-foreground tabular-nums">
        Connected {formatClock(connectedAt, mode)} - active{' '}
        {formatTimestamp(lastActivity, 'relative', mode)}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 !text-error hover:!text-error"
        aria-describedby={clientLabelId}
        onClick={() => onDisconnect(sessionId)}
      >
        Disconnect
      </Button>
    </div>
  )
}
