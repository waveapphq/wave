/**
 * WaveServerTab Component
 *
 * The WAVE Server section in System Config: two read-only server fact cards
 * (Frontend + Backend, addresses/port/bind fixed at launch, plus the Backend's
 * data folder and config file) and the live
 * browser-session roster with a "You" self marker and confirmation-gated
 * per-row Disconnect plus Disconnect Others / All.
 */

import { useState } from 'react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useTimezoneStore } from '@/stores/timezone-store'
import { getOwnSessionIds } from '@/lib/session-identity'
import { AddressChips } from '@/features/settings/components/address-chips'
import { ReadOnlyFact } from '@/features/settings/components/read-only-fact'
import { SectionError } from '@/features/settings/components/section-error'
import { SessionRow, type SessionRole } from '@/features/settings/components/session-row'
import type { BrowserSession, ServerFacts, ServerStatus } from '@/features/settings/api/sessions'

export interface WaveServerTabProps {
  status?: ServerStatus
  loading: boolean
  error?: string
  onDisconnect: (sessionId: string) => void
  onDisconnectOthers: () => void
  onDisconnectAll: () => void
  onRetry: () => void
  /** Session to highlight + scroll to (the workbench "See connection" deep-link). */
  targetSessionId?: string
}

const BIND_LABELS: Record<string, string> = {
  local: 'Local',
  network: 'Network',
}

function PathFactRow({
  label,
  value,
  testid,
}: Readonly<{ label: string; value: string; testid: string }>) {
  return (
    <div className="mt-2 flex items-center pl-[22px] text-xs text-muted-foreground">
      <ReadOnlyFact label={label} value={value} copyable data-testid={testid} />
    </div>
  )
}

function ServerFactCard({
  testid,
  name,
  purpose,
  facts,
  sessionCount,
  dataFolder,
  configFile,
}: Readonly<{
  testid: string
  name: string
  purpose: string
  facts: ServerFacts
  sessionCount?: number
  /** WSRV-10: only the Backend Server card names the data folder. */
  dataFolder?: string
  /** WSRV-11: only the Backend Server card names the config file. */
  configFile?: string
}>) {
  let statusText = facts.running ? 'Running' : 'Stopped'
  if (sessionCount !== undefined) {
    statusText += ` · ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}`
  }
  return (
    <div data-testid={testid} className="rounded-md border border-border px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              facts.running
                ? 'bg-emerald-500 shadow-[0_0_6px_2px_rgba(16,185,129,0.4)]'
                : 'bg-muted-foreground/40',
            )}
          />
          <span className="text-sm font-semibold">{name}</span>
          <span className="min-w-0 truncate text-sm text-muted-foreground">{purpose}</span>
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">{statusText}</span>
      </div>
      <AddressChips urls={facts.urls} />
      <div className="mt-3 flex items-center gap-6 pl-[22px] text-xs text-muted-foreground">
        <ReadOnlyFact label="Port" value={String(facts.port)} />
        <ReadOnlyFact label="Bind scope" value={BIND_LABELS[facts.bind] ?? facts.bind} />
      </div>
      {dataFolder !== undefined && (
        <PathFactRow label="Data folder" value={dataFolder} testid="server-data-folder" />
      )}
      {configFile !== undefined && (
        <PathFactRow label="Config file" value={configFile} testid="server-config-file" />
      )}
    </div>
  )
}

export function WaveServerTab({
  status,
  loading,
  error,
  onDisconnect,
  onDisconnectOthers,
  onDisconnectAll,
  onRetry,
  targetSessionId,
}: Readonly<WaveServerTabProps>) {
  const mode = useTimezoneStore((s) => s.mode)
  // Every session this browser opened (across its tabs), so all of them read as "You".
  const ownSessionIds = getOwnSessionIds()
  const [othersConfirmOpen, setOthersConfirmOpen] = useState(false)
  const [allConfirmOpen, setAllConfirmOpen] = useState(false)
  const [pendingDisconnect, setPendingDisconnect] = useState<BrowserSession | null>(null)

  const header = (
    <div>
      <h2 className="text-lg font-semibold mb-1">WAVE Server</h2>
      <p className="text-muted-foreground text-sm">
        The servers behind WAVE - the web interface this browser loads, and the API that carries
        every live session. Their addresses and configuration are fixed when WAVE starts and shown
        read-only; the live part is the Workbench session roster below.
      </p>
    </div>
  )

  if (!status) {
    return (
      <div data-testid="wave-server-tab" className="space-y-6">
        {header}
        {error ? (
          <SectionError data-testid="wave-server-error" message={error} onRetry={onRetry} />
        ) : (
          <div data-testid="wave-server-loading" aria-busy={loading} className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}
      </div>
    )
  }

  const watchingIds = new Set(status.watching_session_ids)
  const roleFor = (id: string): SessionRole | undefined => {
    if (id === status.active_session_id) return 'active'
    if (watchingIds.has(id)) return 'watching'
    return undefined
  }

  return (
    <div data-testid="wave-server-tab" className="space-y-6">
      {header}
      {error && (
        <p data-testid="wave-server-stale" role="alert" className="text-sm text-error">
          {error} (showing the last known state)
        </p>
      )}
      <ServerFactCard
        testid="server-card-frontend"
        name="Frontend Server"
        purpose="serves the WAVE interface"
        facts={status.frontend}
      />
      <ServerFactCard
        testid="server-card-backend"
        name="Backend Server"
        purpose="handles the API and live sessions"
        facts={status.backend}
        sessionCount={status.session_count}
        dataFolder={status.data_folder}
        configFile={status.config_file}
      />
      <Separator />
      <div data-testid="server-sessions-section">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold mb-1">Workbench Sessions</h3>
            <p className="text-muted-foreground text-sm">
              Each active browser connection to this WAVE backend&apos;s Workbench - one person may
              have several.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              data-testid="server-disconnect-others"
              variant="outline"
              size="sm"
              onClick={() => setOthersConfirmOpen(true)}
            >
              Disconnect Others
            </Button>
            <Button
              data-testid="server-disconnect-all"
              variant="outline"
              size="sm"
              className="!text-error hover:!text-error"
              onClick={() => setAllConfirmOpen(true)}
            >
              Disconnect All
            </Button>
          </div>
        </div>
        {status.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No connected sessions.</p>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {status.sessions.map((session) => (
              <SessionRow
                key={session.session_id}
                sessionId={session.session_id}
                client={session.client}
                ip={session.ip}
                connectedAt={session.connected_at}
                lastActivity={session.last_activity}
                mode={mode}
                onDisconnect={() => setPendingDisconnect(session)}
                testidPrefix="server-session-row"
                tone="indigo"
                role={roleFor(session.session_id)}
                isSelf={ownSessionIds.has(session.session_id)}
                highlighted={session.session_id === targetSessionId}
              />
            ))}
          </div>
        )}
      </div>
      <ConfirmationDialog
        isOpen={othersConfirmOpen}
        variant="delete"
        title="Disconnect other sessions?"
        description="End every other connected session. Each affected browser drops to a disconnected state and must reconnect. Your session stays connected."
        confirmLabel="Disconnect Others"
        cancelLabel="Cancel"
        onClose={() => setOthersConfirmOpen(false)}
        onConfirm={onDisconnectOthers}
      />
      <ConfirmationDialog
        isOpen={allConfirmOpen}
        variant="delete"
        title="Disconnect all sessions?"
        description="End every connected session, including your own. Every browser drops to a disconnected state and must reconnect."
        confirmLabel="Disconnect All"
        cancelLabel="Cancel"
        onClose={() => setAllConfirmOpen(false)}
        onConfirm={onDisconnectAll}
      />
      <ConfirmationDialog
        isOpen={pendingDisconnect !== null}
        variant="disconnect"
        itemName={pendingDisconnect?.client}
        description={
          pendingDisconnect && ownSessionIds.has(pendingDisconnect.session_id)
            ? 'This ends your own session. Your Workbench will close and you will return to the dashboard.'
            : 'This ends the session. Their Workbench closes and they must reconnect.'
        }
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
        onClose={() => setPendingDisconnect(null)}
        onConfirm={() => {
          if (pendingDisconnect) onDisconnect(pendingDisconnect.session_id)
        }}
      />
    </div>
  )
}
