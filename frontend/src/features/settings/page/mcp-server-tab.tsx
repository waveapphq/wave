/**
 * McpServerTab Component (REQ-5.2.7.1, MCP-1..MCP-9)
 *
 * Settings > MCP Server: status readout, staged enablement and endpoint settings saved from the
 * page header, the Save confirmation, connected sessions and the recent-activity feed.
 */

import { useCallback, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { getApiBaseUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { acceptsNumericInput, compareNumbers, numberTextProblem } from '@/lib/number-rule'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatClock, formatTimestamp } from '@/lib/timestamp-format'
import { useTimezoneStore } from '@/stores/timezone-store'
import { AddressChips } from '@/features/settings/components/address-chips'
import { PasswordStrength } from '@/features/settings/components/password-strength'
import { SectionError } from '@/features/settings/components/section-error'
import { SessionRow } from '@/features/settings/components/session-row'
import { SettingsRowGroup } from '@/features/settings/components/settings-row-group'
import {
  SettingsRowSelect,
  type SettingsRowSelectOption,
} from '@/features/settings/components/settings-row-select'
import { SettingsSectionHeader } from '@/features/settings/components/settings-section-header'
import { StoredPasswordField } from '@/features/settings/components/stored-password-field'
import type { PageReadStatus } from '@/features/settings/container/use-activation-read'
import { useDebouncedParse } from '@/features/settings/container/use-debounced-parse'
import type {
  McpBindScope,
  McpSession,
  McpSettings,
  McpStatus,
} from '@/features/settings/api/mcp'
import { scorePassword } from '@/features/settings/api/password-strength'

// ============================================================================
// Types
// ============================================================================

/** The staged page values: the port as text, the password undefined until it is emptied or typed. */
export interface McpStagedSettings {
  enabled: boolean
  until_restart: boolean
  port: string
  bind: McpBindScope
  auth_enabled: boolean
  auth_username: string
  auth_password: string | undefined
}

/** What the Save confirmation states before it saves (MCP-5, MCP-6). */
export interface McpSaveConfirmation {
  restart: boolean
  exposure: boolean
}

type McpStageChange = (field: keyof McpStagedSettings, value: string | boolean) => void

export interface McpServerTabProps {
  settings?: McpSettings
  status?: McpStatus
  readStatus: PageReadStatus
  /** The API's reason when the first read failed. */
  error?: string
  /** The reason of the last failed status poll. */
  statusError?: string
  staged: McpStagedSettings
  dirty: boolean
  saving: boolean
  confirmation?: McpSaveConfirmation
  onStageChange: McpStageChange
  onCancel: () => void
  onSave: () => void
  onConfirmSave: () => void
  onDismissConfirmation: () => void
  onDisconnectSession: (sessionId: string) => void
  onRetry: () => void
  /** Session to highlight + scroll to (the workbench "See connection" deep-link). */
  targetSessionId?: string
}

const RESTART_SENTENCE =
  'The MCP server restarts with the new configuration. Connected assistants are ' +
  'disconnected and must reconnect. The main WAVE server and running executions ' +
  'are not affected.'

const BIND_OPTIONS: ReadonlyArray<SettingsRowSelectOption<McpBindScope>> = [
  { value: 'local', label: 'Local only (127.0.0.1)' },
  { value: 'network', label: 'Network' },
]

const PORT_RANGE_MESSAGE = 'Port must be between 1024 and 65535'
const STRENGTH_SCORE_ID = 'mcp-password-strength'

const PORT_RULE = { negative: false } as const

/** Immediate port validation: digits, service range, and not WAVE's own ports. */
function stagedPortError(port: string, serverPort: number): string | undefined {
  if (numberTextProblem(port, 'integer') !== null) return PORT_RANGE_MESSAGE
  if (compareNumbers(port, 1024) < 0 || compareNumbers(port, 65535) > 0) return PORT_RANGE_MESSAGE
  const value = Number(port)
  const uiPort = Number(globalThis.location.port)
  const apiPort = Number(new URL(getApiBaseUrl()).port)
  if (value === uiPort || value === apiPort || value === serverPort) {
    return `Port ${value} is used by WAVE itself`
  }
  return undefined
}

// ============================================================================
// Status bar
// ============================================================================

function McpStatusBar({ status }: Readonly<{ status: McpStatus }>) {
  const mode = useTimezoneStore((s) => s.mode)

  const lastActivity = status.recent_activity[0]?.timestamp

  return (
    <div data-testid="mcp-status-bar" className="rounded-md border border-border px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              status.running
                ? 'bg-emerald-500 shadow-[0_0_6px_2px_rgba(16,185,129,0.4)]'
                : 'bg-muted-foreground/40',
            )}
          />
          <span className="text-sm font-semibold">{status.running ? 'Running' : 'Stopped'}</span>
          {!status.running &&
            (status.last_error ? (
              <span className="min-w-0 break-words text-sm text-error/80">
                {status.last_error}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                The MCP endpoint is disabled.
              </span>
            ))}
        </div>
        {status.running && (
          <div className="flex shrink-0 items-center gap-4 text-sm text-muted-foreground">
            <span>
              {status.connected_clients} {status.connected_clients === 1 ? 'client' : 'clients'}{' '}
              connected
            </span>
            {lastActivity && (
              <span>Last activity {formatTimestamp(lastActivity, 'relative', mode)}</span>
            )}
          </div>
        )}
      </div>
      <AddressChips urls={status.urls} copyTestId="mcp-copy-success" />
    </div>
  )
}

// ============================================================================
// Enablement
// ============================================================================

function ActiveCue({ testId }: Readonly<{ testId: string }>) {
  return (
    <span
      data-testid={testId}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      <span>Active</span>
    </span>
  )
}

interface EnablementRow {
  field: 'enabled' | 'until_restart'
  title: string
  description: string
  activeTestId: string
}

const ENABLEMENT_ROWS: readonly EnablementRow[] = [
  {
    field: 'enabled',
    title: 'Enable MCP server',
    description: 'Persistent: the endpoint stays enabled across WAVE restarts.',
    activeTestId: 'mcp-persistent-active',
  },
  {
    field: 'until_restart',
    title: 'Enable until restart',
    description: 'Turns off automatically the next time the WAVE server restarts.',
    activeTestId: 'mcp-until-restart-active',
  },
]

function McpEnablementSection({
  settings,
  staged,
  onChange,
  disabled,
}: Readonly<{
  settings: McpSettings
  staged: McpStagedSettings
  onChange: McpStageChange
  disabled: boolean
}>) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-1">Enablement</h3>
      <p className="text-muted-foreground text-sm mb-4">
        Turn the MCP endpoint on or off without restarting the WAVE server.
      </p>
      <SettingsRowGroup>
        {ENABLEMENT_ROWS.map((row) => {
          // The Active cue follows the saved mode; the switch shows the staged one.
          const savedOn =
            row.field === 'enabled' ? settings.enabled : settings.until_restart_active
          return (
            <SettingsRowGroup.Row
              key={row.field}
              label={row.title}
              help={row.description}
              adornment={savedOn ? <ActiveCue testId={row.activeTestId} /> : undefined}
              control={
                <Switch
                  checked={staged[row.field]}
                  disabled={disabled}
                  onCheckedChange={(value) => onChange(row.field, value)}
                />
              }
            />
          )
        })}
      </SettingsRowGroup>
    </div>
  )
}

// ============================================================================
// Endpoint
// ============================================================================

/** The Password field with the strength score of a typed password under it (MCP-7). */
function McpPasswordControl({
  id,
  'aria-describedby': describedBy,
  stored,
  value,
  username,
  disabled,
  onChange,
}: Readonly<{
  id: string
  'aria-describedby'?: string
  stored: boolean
  value: string | undefined
  username: string
  disabled: boolean
  onChange: (value: string) => void
}>) {
  const scoreWithUsername = useCallback(
    (password: string) => scorePassword(password, [username]),
    [username],
  )
  const { result: strength } = useDebouncedParse(value ?? '', scoreWithUsername)

  return (
    <div>
      <StoredPasswordField
        id={id}
        aria-describedby={describedBy}
        fieldName="Password"
        stored={stored}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
      <div id={STRENGTH_SCORE_ID}>
        <PasswordStrength strength={strength} />
      </div>
    </div>
  )
}

function McpEndpointSection({
  staged,
  passwordSet,
  portError,
  onChange,
  disabled,
}: Readonly<{
  staged: McpStagedSettings
  passwordSet: boolean
  portError?: string
  onChange: McpStageChange
  disabled: boolean
}>) {
  const authOff = !staged.auth_enabled

  return (
    <div>
      <h3 className="text-lg font-semibold mb-1">Endpoint</h3>
      <p className="text-muted-foreground text-sm mb-4">
        Where the MCP server listens and how clients must authenticate.
      </p>
      <SettingsRowGroup>
        <SettingsRowGroup.Row
          label="Port"
          help="The port the MCP endpoint listens on."
          message={portError}
          messageTestId="mcp-port-error"
          control={
            <Input
              id="mcp-port-input"
              name="port"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'w-28 shrink-0 text-right font-mono',
                portError && 'border-error focus-visible:ring-error',
              )}
              value={staged.port}
              disabled={disabled}
              onChange={(e) => {
                if (acceptsNumericInput(e.target.value, 'integer', PORT_RULE)) onChange('port', e.target.value)
              }}
            />
          }
        />
        <SettingsRowGroup.Row
          label="Bind scope"
          help="Local only keeps the endpoint reachable solely from this machine."
          control={
            <SettingsRowSelect
              data-testid="mcp-bind-select"
              className="w-52"
              value={staged.bind}
              options={BIND_OPTIONS}
              disabled={disabled}
              onChange={(value) => onChange('bind', value)}
            />
          }
        />
        <SettingsRowGroup.Row
          label="Require authentication"
          help="Clients must send HTTP Basic credentials with every request."
          control={
            <Switch
              checked={staged.auth_enabled}
              disabled={disabled}
              onCheckedChange={(value) => onChange('auth_enabled', value)}
            />
          }
        />
        <SettingsRowGroup.Row
          data-testid="mcp-auth-username-row"
          label="Username"
          muted={authOff}
          control={
            <Input
              id="mcp-username-input"
              name="auth_username"
              type="text"
              autoComplete="off"
              spellCheck={false}
              wrapperClassName="w-52"
              value={staged.auth_username}
              disabled={authOff || disabled}
              onChange={(e) => onChange('auth_username', e.target.value)}
            />
          }
        />
        <SettingsRowGroup.Row
          data-testid="mcp-auth-password-row"
          label="Password"
          help="Stored sealed; shown write-only like other credentials."
          muted={authOff}
          align="top"
          control={
            <McpPasswordControl
              id="mcp-password-input"
              aria-describedby={STRENGTH_SCORE_ID}
              stored={passwordSet}
              value={staged.auth_password}
              username={staged.auth_username}
              disabled={authOff || disabled}
              onChange={(value) => onChange('auth_password', value)}
            />
          }
        />
      </SettingsRowGroup>
    </div>
  )
}

// ============================================================================
// Sessions
// ============================================================================

function McpSessionsSection({
  sessions,
  onDisconnect,
  targetSessionId,
}: Readonly<{
  sessions: McpSession[]
  onDisconnect: (sessionId: string) => void
  targetSessionId?: string
}>) {
  const mode = useTimezoneStore((s) => s.mode)
  return (
    <div data-testid="mcp-sessions-section">
      <h3 className="text-lg font-semibold mb-1">Sessions</h3>
      <p className="text-muted-foreground text-sm mb-4">
        Assistant clients currently connected to the endpoint.
      </p>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No connected clients.</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {sessions.map((session) => (
            <SessionRow
              key={session.session_id}
              sessionId={session.session_id}
              client={session.client}
              ip={session.ip}
              connectedAt={session.connected_at}
              lastActivity={session.last_activity}
              mode={mode}
              onDisconnect={onDisconnect}
              testidPrefix="mcp-session-row"
              highlighted={session.session_id === targetSessionId}
              highlightLabel="From your workbench"
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Recent Activity
// ============================================================================

function McpActivitySection({
  activity,
}: Readonly<{ activity: McpStatus['recent_activity'] }>) {
  const mode = useTimezoneStore((s) => s.mode)
  return (
    <div>
      <h3 className="text-lg font-semibold mb-1">Recent Activity</h3>
      <p className="text-muted-foreground text-sm mb-4">
        The latest tool calls made by connected assistants. Scrolls; newest first.
      </p>
      {activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <div
          data-testid="mcp-activity-feed"
          className="max-h-[200px] overflow-y-auto rounded-md border border-border"
        >
          <div className="divide-y divide-border">
            {activity.map((entry) => (
              <div
                key={`${entry.timestamp}-${entry.tool}`}
                className="flex items-center gap-6 px-3 py-2"
              >
                <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                  {formatClock(entry.timestamp, mode)}
                </span>
                <span translate="no" className="w-40 shrink-0 truncate text-sm font-medium">
                  {entry.client}
                </span>
                <span translate="no" className="min-w-0 truncate font-mono text-xs">
                  {entry.tool}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Page states
// ============================================================================

function McpLoadingSkeleton() {
  return (
    <div data-testid="mcp-loading" aria-busy="true" className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

// ============================================================================
// Save confirmation
// ============================================================================

function McpSaveConfirmationDialog({
  confirmation,
  onConfirm,
  onDismiss,
}: Readonly<{
  confirmation?: McpSaveConfirmation
  onConfirm: () => void
  onDismiss: () => void
}>) {
  return (
    <ConfirmationDialog
      isOpen={confirmation !== undefined}
      variant="overwrite"
      title="Save MCP server changes?"
      description={confirmation?.restart ? RESTART_SENTENCE : undefined}
      confirmLabel={confirmation?.restart ? 'Save and restart' : 'Save'}
      onClose={onDismiss}
      onConfirm={onConfirm}
    >
      {confirmation?.exposure && (
        <div
          data-testid="mcp-exposure-warning"
          className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-100 mb-4 text-left text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Bind scope changes to <strong>Network</strong>: any machine that can reach this
            server can contact the endpoint. Require authentication to control who may act
            through WAVE.
          </span>
        </div>
      )}
    </ConfirmationDialog>
  )
}

// ============================================================================
// Tab
// ============================================================================

export function McpServerTab({
  settings,
  status,
  readStatus,
  error,
  statusError,
  staged,
  dirty,
  saving,
  confirmation,
  onStageChange,
  onCancel,
  onSave,
  onConfirmSave,
  onDismissConfirmation,
  onDisconnectSession,
  onRetry,
  targetSessionId,
}: Readonly<McpServerTabProps>) {
  const loaded = readStatus === 'loaded'
  const portError = settings ? stagedPortError(staged.port, settings.server_port) : undefined

  let body: ReactNode
  if (readStatus === 'failed') {
    body = <SectionError message={error ?? ''} onRetry={onRetry} />
  } else if (readStatus === 'pending' || !settings || !status) {
    body = <McpLoadingSkeleton />
  } else {
    body = (
      <>
        {statusError && (
          <p data-testid="mcp-status-stale" role="alert" className="text-sm text-error">
            {statusError} (showing the last known state)
          </p>
        )}
        <McpStatusBar status={status} />
        <Separator />
        <McpEnablementSection
          settings={settings}
          staged={staged}
          onChange={onStageChange}
          disabled={saving}
        />
        <Separator />
        <McpEndpointSection
          staged={staged}
          passwordSet={settings.auth_password_set}
          portError={portError}
          onChange={onStageChange}
          disabled={saving}
        />
        <Separator />
        <McpSessionsSection
          sessions={status.sessions}
          onDisconnect={onDisconnectSession}
          targetSessionId={targetSessionId}
        />
        <Separator />
        <McpActivitySection activity={status.recent_activity} />
        <McpSaveConfirmationDialog
          confirmation={confirmation}
          onConfirm={onConfirmSave}
          onDismiss={onDismissConfirmation}
        />
      </>
    )
  }

  return (
    <div data-testid="mcp-server-tab" className="space-y-6">
      <div className="space-y-1">
        {/* Cancel and Save appear once the first read has loaded. */}
        <SettingsSectionHeader
          title="MCP Server"
          dirty={dirty}
          saving={saving}
          saveDisabled={portError !== undefined}
          onCancel={loaded ? onCancel : undefined}
          onSave={loaded ? onSave : undefined}
        />
        <p className="text-muted-foreground text-sm">
          Let AI assistants connect to WAVE as ordinary clients over the Model Context Protocol.
          Assistants use the same services, validation, and secret masking as the web UI; their
          runs are tracked in Executions.
        </p>
      </div>
      {body}
    </div>
  )
}
