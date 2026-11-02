/**
 * Settings > General (REQ-4.7.16, SETTINGS-14, SETTINGS-18): Logging, Time Zone and
 * Secret Masking, every edit staged until Save.
 */

import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { LOG_LEVELS, type LogLevel } from '@/lib/log-levels'
import type { TimezoneMode } from '@/lib/timestamp-format'
import type { MaskingSettings } from '@/features/settings/api/admin'
import { SectionError } from '@/features/settings/components/section-error'
import { SettingsRowGroup } from '@/features/settings/components/settings-row-group'
import {
  SettingsRowSelect,
  type SettingsRowSelectOption,
} from '@/features/settings/components/settings-row-select'
import { SettingsSectionHeader } from '@/features/settings/components/settings-section-header'
import type { UseGeneralSettingsResult } from '@/features/settings/container/use-general-settings'

const PAGE_CLASS = 'space-y-6'
const SUBTITLE_CLASS = 'mb-4 mt-1 text-sm text-muted-foreground'

const LOGGING_TITLE = 'Logging'
const LOGGING_SUBTITLE =
  "Verbosity of the WAVE server's own log. Block output in runs is not affected."
const TIME_ZONE_SUBTITLE = 'How timestamps are shown in this browser.'
const MASKING_SUBTITLE =
  'Secrets are masked everywhere by default. Reveal them system-wide per surface:'

const LOG_LEVEL_OPTIONS: ReadonlyArray<SettingsRowSelectOption<LogLevel>> = LOG_LEVELS.map(
  (level) => ({ value: level, label: level }),
)

const TIMEZONE_OPTIONS: ReadonlyArray<SettingsRowSelectOption<TimezoneMode>> = [
  { value: 'local', label: 'Browser local' },
  { value: 'utc', label: 'UTC' },
]

const MASKING_ROWS: ReadonlyArray<{
  key: keyof MaskingSettings
  testKey: string
  title: string
  description: string
}> = [
  {
    key: 'runOutput',
    testKey: 'run-output',
    title: 'Reveal secrets in run output',
    description:
      'Show secret values in run logs, console, and reports. Individual blocks can override this (Always reveal / Always mask).',
  },
  {
    key: 'testVariables',
    testKey: 'test-variables',
    title: 'Reveal test variables',
    description:
      "Show a test's secret variable values in the workbench Variable Manager panel and its watchers.",
  },
  {
    key: 'sharedVariables',
    testKey: 'shared-variables',
    title: 'Reveal global, regression, and suite variables',
    description: 'Show secret values in the global, regression, and suite variable editors.',
  },
  {
    key: 'credentialInputs',
    testKey: 'credential-inputs',
    title: 'Unmask plugin credential input fields',
    description:
      'Show the stored value of a plugin credential input field (e.g. an SSH password or ' +
      'private key) in the block config, instead of masking it write-only.',
  },
]

const LOG_LEVEL_SKELETON_ROWS = ['log-level'] as const
const MASKING_SKELETON_ROWS = MASKING_ROWS.map((row) => row.testKey)

function RevealingCue({ testKey }: Readonly<{ testKey: string }>) {
  return (
    <span
      data-testid={`masking-${testKey}-revealing`}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      <span>Revealing</span>
    </span>
  )
}

interface MaskingRowsProps {
  masking: MaskingSettings
  disabled: boolean
  onToggle: (key: keyof MaskingSettings, value: boolean) => void
}

function MaskingRows({ masking, disabled, onToggle }: Readonly<MaskingRowsProps>) {
  return (
    <SettingsRowGroup>
      {MASKING_ROWS.map((row) => {
        const on = masking[row.key]
        return (
          <SettingsRowGroup.Row
            key={row.key}
            data-testid={`masking-${row.testKey}-row`}
            label={row.title}
            help={row.description}
            adornment={on ? <RevealingCue testKey={row.testKey} /> : undefined}
            control={
              <Switch
                data-testid={`masking-${row.testKey}-toggle`}
                aria-label={row.title}
                checked={on}
                disabled={disabled}
                onCheckedChange={(value) => onToggle(row.key, value)}
              />
            }
          />
        )
      })}
    </SettingsRowGroup>
  )
}

export interface GeneralTabProps {
  general: UseGeneralSettingsResult
}

export function GeneralTab({ general }: Readonly<GeneralTabProps>) {
  if (general.status === 'failed') {
    return (
      <div data-testid="general-tab" className={PAGE_CLASS}>
        <SettingsSectionHeader title={LOGGING_TITLE} />
        <SectionError message={general.error ?? ''} onRetry={general.retry} />
      </div>
    )
  }

  const loaded = general.status === 'loaded'
  const { staged, saving } = general
  return (
    <div data-testid="general-tab" className={PAGE_CLASS}>
      <section data-testid="log-level-section">
        {/* Cancel and Save appear once the first read has loaded. */}
        <SettingsSectionHeader
          title={LOGGING_TITLE}
          dirty={general.dirty}
          saving={saving}
          onCancel={loaded ? general.cancel : undefined}
          onSave={loaded ? general.save : undefined}
        />
        <p className={SUBTITLE_CLASS}>{LOGGING_SUBTITLE}</p>
        {loaded ? (
          <SettingsRowGroup>
            <SettingsRowGroup.Row
              label="Log Level"
              control={
                <SettingsRowSelect
                  data-testid="log-level-select"
                  className="w-32"
                  translate="no"
                  value={staged.logLevel}
                  options={LOG_LEVEL_OPTIONS}
                  disabled={saving}
                  onChange={general.stageLogLevel}
                />
              }
            />
          </SettingsRowGroup>
        ) : (
          <SettingsRowGroup.Skeleton
            rows={LOG_LEVEL_SKELETON_ROWS}
            help={false}
            controlClassName="h-9 w-32"
          />
        )}
      </section>
      <Separator />
      <section data-testid="timezone-section">
        <SettingsSectionHeader title="Time Zone" />
        <p className={SUBTITLE_CLASS}>{TIME_ZONE_SUBTITLE}</p>
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label="Time Zone"
            control={
              <SettingsRowSelect
                data-testid="timezone-select"
                className="w-44"
                value={staged.timezone}
                options={TIMEZONE_OPTIONS}
                disabled={!loaded || saving}
                onChange={general.stageTimezone}
              />
            }
          />
        </SettingsRowGroup>
      </section>
      <Separator />
      <section data-testid="secret-masking-section">
        <SettingsSectionHeader title="Secret Masking" />
        <p className={SUBTITLE_CLASS}>{MASKING_SUBTITLE}</p>
        {loaded ? (
          <MaskingRows masking={staged.masking} disabled={saving} onToggle={general.stageMasking} />
        ) : (
          <SettingsRowGroup.Skeleton rows={MASKING_SKELETON_ROWS} help controlClassName="h-5 w-9" />
        )}
        <SettingsRowGroup.Footer data-testid="masking-carveout-footnote">
          Exports (per-export choice) and encryption at rest are governed separately and are
          unaffected.
        </SettingsRowGroup.Footer>
      </section>
    </div>
  )
}
