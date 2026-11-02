/**
 * Settings > Network > Proxy > Setup (REQ-4.7.14, REQ-4.7.16, NET-10): the proxy for web requests
 * made from the WAVE host, every edit staged until Save and checked while the user types.
 */

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/shared/segmented-control'
import { cn } from '@/lib/utils'
import { acceptsNumericInput, plainNumberText, wireNumber } from '@/lib/number-rule'
import type { ProxyProblem, ProxySettings } from '@/features/settings/api/proxy'
import { ProxyAddressList } from '@/features/settings/components/network/proxy-address-list'
import { ProxyHostValues } from '@/features/settings/components/network/proxy-host-values'
import { SectionError } from '@/features/settings/components/section-error'
import { SettingsRowGroup } from '@/features/settings/components/settings-row-group'
import { SettingsSectionHeader } from '@/features/settings/components/settings-section-header'
import { StoredPasswordField } from '@/features/settings/components/stored-password-field'
import type {
  ProxyStaged,
  UseProxySettingsResult,
} from '@/features/settings/container/use-proxy-settings'

const PAGE_CLASS = 'space-y-4'
const TITLE = 'Proxy Setup'
const SUBTITLE =
  'For web requests (HTTP and HTTPS) made from the WAVE host. Your browser and blocks on a remote host do not use it.'
const USE_PROXY_LABEL = 'Use a proxy'
const LOCAL_ADDRESSES_LABEL = 'Use the proxy for local addresses too'
const LIST_MODE_LABEL = 'Use the proxy for'

const SKELETON_ROWS = ['use-a-proxy'] as const

const SOURCE_OPTIONS: ReadonlyArray<SegmentedControlOption<ProxyStaged['source']>> = [
  { value: 'host', label: "WAVE host's settings" },
  { value: 'custom', label: 'Custom' },
]

const LIST_MODE_OPTIONS: ReadonlyArray<SegmentedControlOption<ProxyStaged['list_mode']>> = [
  { value: 'except', label: 'All addresses except the list' },
  { value: 'only', label: 'Only the addresses in the list' },
]

// A field its row marks invalid draws the error border itself.
const INVALID_CLASS = 'aria-invalid:border-error'

// The longest port number, 65535, has five digits.
const PORT_DIGITS = 5

/** The message of a field as a whole; a problem of one list entry is not one. */
function fieldMessage(problems: ProxyProblem[], field: ProxyProblem['field']): string | undefined {
  return problems.find((problem) => problem.field === field && problem.row === null)?.message
}

/** The messages of single list entries, by entry number. */
function entryMessages(problems: ProxyProblem[]): Record<number, string> {
  const messages: Record<number, string> = {}
  for (const problem of problems) {
    if (problem.row !== null) messages[problem.row] = problem.message
  }
  return messages
}

const PORT_RULE = { negative: false } as const

/** Whether the Port box takes the text: whole-number keys only, as many digits as a port can hold. */
function takesPortText(text: string): boolean {
  return text.length <= PORT_DIGITS && acceptsNumericInput(text, 'integer', PORT_RULE)
}

/** The port the text stands for in its wire form; an emptied field is no port. */
function portOf(text: string): number | string | null {
  return text === '' ? null : wireNumber(text, 'integer')
}

interface CustomRowsProps {
  proxy: UseProxySettingsResult
  passwordStored: boolean
}

function CustomRows({ proxy, passwordStored }: Readonly<CustomRowsProps>) {
  const { staged, saving, problems, stage } = proxy
  return (
    <>
      <SettingsRowGroup.Row
        label="IP or Hostname"
        message={fieldMessage(problems, 'host')}
        control={
          <Input
            name="proxy-host"
            autoComplete="off"
            spellCheck={false}
            wrapperClassName="w-64"
            className={INVALID_CLASS}
            value={staged.host}
            disabled={saving}
            onChange={(event) => stage('host', event.target.value)}
          />
        }
      />
      <SettingsRowGroup.Row
        label="Port"
        message={fieldMessage(problems, 'port')}
        control={
          <Input
            name="proxy-port"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            wrapperClassName="w-28"
            className={cn('text-right font-mono', INVALID_CLASS)}
            value={staged.port === null ? '' : plainNumberText(staged.port)}
            disabled={saving}
            onChange={(event) => {
              if (takesPortText(event.target.value)) stage('port', portOf(event.target.value))
            }}
          />
        }
      />
      <SettingsRowGroup.Row
        label="Username"
        message={fieldMessage(problems, 'username')}
        control={
          <Input
            name="proxy-username"
            autoComplete="off"
            spellCheck={false}
            wrapperClassName="w-64"
            className={INVALID_CLASS}
            value={staged.username}
            disabled={saving}
            onChange={(event) => stage('username', event.target.value)}
          />
        }
      />
      <SettingsRowGroup.Row
        label="Password"
        help="Stored sealed; shown write-only like other credentials."
        message={fieldMessage(problems, 'password')}
        control={
          <StoredPasswordField
            className="w-64"
            fieldName="Password"
            stored={passwordStored}
            value={staged.password}
            disabled={saving}
            onChange={(password) => stage('password', password)}
          />
        }
      />
      <SettingsRowGroup.Row
        label={LIST_MODE_LABEL}
        message={fieldMessage(problems, 'entries')}
        control={
          <SegmentedControl
            aria-label={LIST_MODE_LABEL}
            options={LIST_MODE_OPTIONS}
            value={staged.list_mode}
            disabled={saving}
            onChange={(mode) => stage('list_mode', mode)}
          />
        }
        below={
          <ProxyAddressList
            entries={staged.entries}
            problems={entryMessages(problems)}
            disabled={saving}
            onChange={(entries) => stage('entries', entries)}
          />
        }
      />
      <SettingsRowGroup.Row
        label={LOCAL_ADDRESSES_LABEL}
        control={
          <Switch
            aria-label={LOCAL_ADDRESSES_LABEL}
            checked={staged.proxy_local_addresses}
            disabled={saving}
            onCheckedChange={(on) => stage('proxy_local_addresses', on)}
          />
        }
      />
    </>
  )
}

interface ProxyRowsProps {
  proxy: UseProxySettingsResult
  settings: ProxySettings
}

function ProxyRows({ proxy, settings }: Readonly<ProxyRowsProps>) {
  const { staged, saving, problems, stage } = proxy
  return (
    <SettingsRowGroup>
      <SettingsRowGroup.Row
        label={USE_PROXY_LABEL}
        control={
          <Switch
            aria-label={USE_PROXY_LABEL}
            checked={staged.enabled}
            disabled={saving}
            onCheckedChange={(on) => stage('enabled', on)}
          />
        }
      />
      {staged.enabled ? (
        <>
          <SettingsRowGroup.Row
            label="Source"
            message={fieldMessage(problems, 'source')}
            control={
              <SegmentedControl
                aria-label="Source"
                options={SOURCE_OPTIONS}
                value={staged.source}
                disabled={saving}
                onChange={(source) => stage('source', source)}
              />
            }
          />
          {staged.source === 'host' ? (
            <SettingsRowGroup.FullWidthRow>
              <ProxyHostValues values={settings.host_values} />
            </SettingsRowGroup.FullWidthRow>
          ) : (
            <CustomRows proxy={proxy} passwordStored={settings.password_set} />
          )}
        </>
      ) : null}
    </SettingsRowGroup>
  )
}

export interface NetworkProxySetupTabProps {
  proxy: UseProxySettingsResult
}

export function NetworkProxySetupTab({ proxy }: Readonly<NetworkProxySetupTabProps>) {
  if (proxy.status === 'failed') {
    return (
      <div data-testid="network-proxy-setup-tab" className={PAGE_CLASS}>
        <SettingsSectionHeader title={TITLE} />
        <SectionError message={proxy.error ?? ''} onRetry={proxy.retry} />
      </div>
    )
  }

  const { settings } = proxy
  const loaded = proxy.status === 'loaded' && settings !== undefined
  return (
    <div data-testid="network-proxy-setup-tab" className={PAGE_CLASS}>
      <div className="space-y-1">
        {/* Cancel and Save appear once the first read has loaded. */}
        <SettingsSectionHeader
          title={TITLE}
          dirty={proxy.dirty}
          saving={proxy.saving}
          saveDisabled={proxy.checking || proxy.problems.length > 0}
          onCancel={loaded ? proxy.cancel : undefined}
          onSave={loaded ? proxy.save : undefined}
        />
        <p className="text-sm text-muted-foreground">{SUBTITLE}</p>
      </div>
      {loaded ? (
        <ProxyRows proxy={proxy} settings={settings} />
      ) : (
        <SettingsRowGroup.Skeleton
          data-testid="proxy-setup-skeleton"
          rows={SKELETON_ROWS}
          help={false}
          controlClassName="h-5 w-9"
        />
      )}
    </div>
  )
}
