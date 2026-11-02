/**
 * Read-only mirror banner (SESS-1..4): names the current holder while this
 * viewer mirrors the workbench draft live. Person holders render indigo,
 * assistant (MCP) holders violet with a See connection affordance. A detached
 * viewer renders amber, and amber with no holder at all once the slot is free.
 */

import { Bot, Crosshair, Eye, EyeOff, Link2, Lock, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface MirrorBannerProps {
  holderLabel: string
  /** null once nobody holds the workbench. */
  holderKind: 'person' | 'mcp' | null
  /** True while the holder has a run in flight (mirrored or browsed past). */
  runActive?: boolean
  /** True while this watcher browses freely instead of tracking the holder. */
  browsing?: boolean
  /** Switch back to watching the holder's session; shown while browsing. */
  onWatchSession?: () => void
  onTakeOver: () => void
  onSeeConnection?: () => void
  /** Whether the watcher is currently following live build changes (MCP watch). */
  isFollowing?: boolean
  /** Toggle following the live build; when set, an MCP watch shows the toggle. */
  onToggleFollow?: () => void
}

function trailingPhrase(isMcp: boolean, runActive: boolean): string {
  if (runActive) return 'running live'
  return isMcp ? 'building live' : 'updates as they edit'
}

// Person: "another session on {connection}" (bare until known); assistant keeps its client name.
function holderDisplayName(isMcp: boolean, holderLabel: string): string {
  if (isMcp) return holderLabel
  return holderLabel ? `another session on ${holderLabel}` : 'another session'
}

function surfaceTone(browsing: boolean, isMcp: boolean): string {
  if (browsing) return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
  if (isMcp) return 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
  return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
}

function pillTone(browsing: boolean, isMcp: boolean): string {
  if (browsing) return 'border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'
  if (isMcp) return 'border-violet-500/40 text-violet-600 hover:bg-violet-500/10 dark:text-violet-300'
  return 'border-indigo-500/40 text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-300'
}

function bannerIcon(noHolder: boolean, isMcp: boolean): LucideIcon {
  if (noHolder) return EyeOff
  if (isMcp) return Bot
  return Eye
}

function holderKindAttribute(noHolder: boolean, holderKind: 'person' | 'mcp' | null): string {
  if (noHolder) return 'none'
  return holderKind ?? 'person'
}

function BannerMessage({
  browsing,
  noHolder,
  runActive,
  isMcp,
  displayName,
}: Readonly<{
  browsing: boolean
  noHolder: boolean
  runActive: boolean
  isMcp: boolean
  displayName: string
}>) {
  const nameClass = cn(
    'font-semibold',
    isMcp ? 'text-violet-600 dark:text-violet-300' : 'text-indigo-600 dark:text-indigo-300',
  )
  if (noHolder) {
    return (
      <span className="truncate text-foreground">
        Read-only <span className="text-muted-foreground">&middot;</span>{' '}
        <span className="text-muted-foreground">nobody holds the workbench</span>
      </span>
    )
  }
  if (browsing) {
    return (
      <span className="truncate text-foreground">
        Read-only <span className="text-muted-foreground">&middot;</span>{' '}
        <span className={nameClass}>{displayName}</span>
        <span className="text-muted-foreground">
          {' '}
          {runActive ? 'is running a test in the workbench' : 'holds the workbench'}
        </span>
      </span>
    )
  }
  return (
    <span className="truncate text-foreground">
      You&apos;re watching <span className={nameClass}>{displayName}</span>
      <span className="text-muted-foreground">
        {' '}
        &middot; read-only, {trailingPhrase(isMcp, runActive)}
      </span>
    </span>
  )
}

/** One banner pill; a `hint` renders it inert and explains why on hover. */
function BannerPill({
  testId,
  tone,
  icon: Icon,
  label,
  hint,
  onClick,
}: Readonly<{
  testId: string
  tone: string
  icon: LucideIcon
  label: string
  hint?: string
  onClick?: () => void
}>) {
  if (hint) {
    return (
      <ConditionalTooltip content={hint} disabled>
        <Button
          data-testid={testId}
          variant="outline"
          size="sm"
          aria-disabled
          className={cn('rounded-full opacity-50 cursor-not-allowed', tone)}
          onClick={(event) => event.preventDefault()}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </Button>
      </ConditionalTooltip>
    )
  }
  return (
    <Button
      data-testid={testId}
      variant="outline"
      size="sm"
      className={cn('rounded-full', tone)}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Button>
  )
}

function BannerModePill({
  browsing,
  noHolder,
  tone,
  followTone,
  isFollowing,
  onWatchSession,
  onToggleFollow,
}: Readonly<{
  browsing: boolean
  noHolder: boolean
  tone: string
  followTone: string
  isFollowing: boolean
  onWatchSession?: () => void
  onToggleFollow?: () => void
}>) {
  if (browsing) {
    if (!onWatchSession) return null
    return (
      <BannerPill
        testId="mirror-watch-session-button"
        tone={tone}
        icon={Eye}
        label="Watch Session"
        hint={noHolder ? 'No active session to watch' : undefined}
        onClick={onWatchSession}
      />
    )
  }
  if (!onToggleFollow) return null
  return (
    <Button
      data-testid="mirror-follow-changes-button"
      variant="outline"
      size="sm"
      aria-pressed={isFollowing}
      className={cn('rounded-full', tone, isFollowing && followTone)}
      onClick={onToggleFollow}
    >
      <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
      {isFollowing ? 'Stop Following' : 'Follow Changes'}
    </Button>
  )
}

export function MirrorBanner({
  holderLabel,
  holderKind,
  runActive = false,
  browsing = false,
  onWatchSession,
  onTakeOver,
  onSeeConnection,
  isFollowing = false,
  onToggleFollow,
}: Readonly<MirrorBannerProps>) {
  const isMcp = holderKind === 'mcp'
  const noHolder = browsing && holderKind === null
  const tone = surfaceTone(browsing, isMcp)
  const buttonTone = pillTone(browsing, isMcp)
  const followTone = isMcp ? 'bg-violet-500/15' : 'bg-indigo-500/15'
  const HolderIcon = bannerIcon(noHolder, isMcp)

  return (
    <output
      data-testid="mirror-banner"
      data-holder-kind={holderKindAttribute(noHolder, holderKind)}
      className={cn(
        'flex h-11 shrink-0 items-center justify-between gap-2 border-b border-default px-4',
        tone,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <HolderIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <BannerMessage
          browsing={browsing}
          noHolder={noHolder}
          runActive={runActive}
          isMcp={isMcp}
          displayName={holderDisplayName(isMcp, holderLabel)}
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <BannerModePill
          browsing={browsing}
          noHolder={noHolder}
          tone={buttonTone}
          followTone={followTone}
          isFollowing={isFollowing}
          onWatchSession={onWatchSession}
          onToggleFollow={onToggleFollow}
        />
        <BannerPill
          testId="mirror-see-connection-button"
          tone={buttonTone}
          icon={Link2}
          label="See Connection"
          hint={noHolder ? 'No active session to show' : undefined}
          onClick={onSeeConnection}
        />
        <BannerPill
          testId="mirror-take-over-button"
          tone={buttonTone}
          icon={Lock}
          label={noHolder ? 'Take Session' : 'Take Over'}
          onClick={onTakeOver}
        />
      </div>
    </output>
  )
}
