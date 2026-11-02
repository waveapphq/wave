/**
 * PeriodicBackupSection (REQ-4.7.20, SETTINGS-21): the backup schedule, every edit staged until Save.
 */

import { useId, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EntitySelector } from '../entity-selector'
import { CronInput } from '../cron-input'
import { SecretsModePicker } from '@/components/shared/secrets-mode-picker'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import { SectionError } from '@/features/settings/components/section-error'
import { SettingsSectionHeader } from '@/features/settings/components/settings-section-header'
import type { UsePeriodicBackupResult } from '@/features/settings/container/use-periodic-backup'
import { formatLocalTime, formatUtcTime } from './utils'
import {
  acceptsNumericInput,
  compareNumbers,
  MAX_INTEGER_DIGITS,
  numberTextProblem,
  plainNumberText,
  wireNumber,
} from '@/lib/number-rule'
import {
  BACKUP_SECRETS_DESCRIPTIONS,
  BACKUP_SECRETS_WARNING,
} from './backup-secrets-copy'

const COUNT_RULE = { negative: false } as const

export interface PeriodicBackupSectionProps {
  schedule: UsePeriodicBackupResult
}

function ScheduleSkeleton() {
  return (
    <div aria-busy="true" className="flex items-center gap-3">
      <Skeleton width={36} height={20} radius="full" />
      <Skeleton width={176} height={16} />
    </div>
  )
}

function NextRun({ nextRun }: Readonly<{ nextRun: string }>) {
  const local = formatLocalTime(nextRun)
  const zone = local.split(' ').pop() || 'Local'
  return (
    <div data-testid="next-run-info" className="text-xs text-muted-foreground space-y-0.5">
      <div data-testid="next-run-utc">Next Run (UTC): {formatUtcTime(nextRun)}</div>
      <div data-testid="next-run-local">Next Run ({zone}): {local}</div>
    </div>
  )
}

function ScheduleFields({ schedule }: Readonly<PeriodicBackupSectionProps>) {
  const fieldId = useId()
  const formatId = `${fieldId}-format`
  const compressionId = `${fieldId}-compression`
  const maxBackupsId = `${fieldId}-max-backups`
  const saveDirectoryId = `${fieldId}-save-directory`
  const { staged, saved, saving, stage } = schedule
  const [maxBackupsDraft, setMaxBackupsDraft] = useState<string>()
  const levelUnused = staged.compression_method === 'stored' || staged.compression_method === 'lzma'

  return (
    <div className="space-y-4 pl-1">
      <CronInput value={staged.cron} onChange={(cron) => stage('cron', cron)} disabled={saving} />

      {/* The run lines follow the saved schedule, not the staged edits. */}
      {saved?.next_run ? <NextRun nextRun={saved.next_run} /> : null}

      {saved?.last_run_status ? (
        <div data-testid="last-run-status" className="text-xs text-muted-foreground">
          Last run: {saved.last_run_status}
          {saved.last_run ? (
            <>
              {' at '}
              <Timestamp value={saved.last_run} style="full" />
            </>
          ) : null}
        </div>
      ) : null}

      <EntitySelector
        selected={staged.entity_types}
        onChange={(entityTypes) => stage('entity_types', entityTypes)}
        disabled={saving}
      />

      <div className="flex items-start gap-4 max-w-md">
        <div className="flex-1">
          <Label htmlFor={formatId} className="text-sm font-medium mb-1.5 block">
            Format
          </Label>
          <Select
            value={staged.format}
            onValueChange={(format) => stage('format', format)}
            disabled={saving}
          >
            <SelectTrigger id={formatId} data-testid="periodic-format-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yaml">YAML</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1">
          <Label htmlFor={compressionId} className="text-sm font-medium mb-1.5 block">
            Compression
          </Label>
          <Select
            value={staged.compression_method}
            onValueChange={(method) => stage('compression_method', method)}
            disabled={saving}
          >
            <SelectTrigger id={compressionId} data-testid="periodic-compression-method-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stored">None (Stored)</SelectItem>
              <SelectItem value="deflate">Deflate</SelectItem>
              <SelectItem value="bzip2">Bzip2</SelectItem>
              <SelectItem value="lzma">LZMA</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-xs">
        <Label className="text-sm font-medium mb-1.5 block">
          Compression Level: {staged.compression_level}
        </Label>
        <Slider
          data-testid="periodic-compression-level-slider"
          value={[staged.compression_level]}
          onValueChange={([level]) => stage('compression_level', level)}
          min={1}
          max={9}
          step={1}
          disabled={saving || levelUnused}
        />
      </div>

      <div className="max-w-lg">
        <SecretsModePicker
          value={staged.secrets}
          onChange={(mode) => stage('secrets', mode)}
          disabled={saving}
          warningText={BACKUP_SECRETS_WARNING}
          descriptions={BACKUP_SECRETS_DESCRIPTIONS}
        />
      </div>

      <div className="flex items-start gap-4 max-w-md">
        <div className="flex-1">
          <Label htmlFor={maxBackupsId} className="text-sm font-medium mb-1.5 block">
            Max Backups to Keep
          </Label>
          <Input
            id={maxBackupsId}
            name="max_backups"
            data-testid="max-backups-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_INTEGER_DIGITS + 1}
            value={maxBackupsDraft ?? plainNumberText(staged.max_backups)}
            onChange={(event) => {
              const typed = event.target.value
              if (!acceptsNumericInput(typed, 'integer', COUNT_RULE)) return
              setMaxBackupsDraft(typed)
              // Below 1 or empty is shown while typed and never staged; leaving the box shows the staged count.
              if (numberTextProblem(typed, 'integer') === null && compareNumbers(typed, 1) >= 0) {
                stage('max_backups', wireNumber(typed, 'integer'))
              }
            }}
            onBlur={() => setMaxBackupsDraft(undefined)}
            disabled={saving}
          />
        </div>
        <div className="flex-1">
          <Label htmlFor={saveDirectoryId} className="text-sm font-medium mb-1.5 block">
            Save Directory
          </Label>
          <Input
            id={saveDirectoryId}
            name="save_directory"
            data-testid="save-directory-input"
            autoComplete="off"
            spellCheck={false}
            value={staged.save_directory}
            onChange={(event) => stage('save_directory', event.target.value)}
            disabled={saving}
          />
        </div>
      </div>
    </div>
  )
}

function ScheduleForm({ schedule }: Readonly<PeriodicBackupSectionProps>) {
  const switchId = useId()
  const { staged, saving, stage } = schedule

  return (
    <>
      <div className="flex items-center gap-3">
        <Switch
          id={switchId}
          data-testid="periodic-enable-toggle"
          checked={staged.enabled}
          onCheckedChange={(enabled) => stage('enabled', enabled)}
          disabled={saving}
        />
        <Label htmlFor={switchId} className="text-sm">
          Enable periodic backups
        </Label>
      </div>

      {staged.enabled ? <ScheduleFields schedule={schedule} /> : null}
    </>
  )
}

function ScheduleBody({ schedule }: Readonly<PeriodicBackupSectionProps>) {
  // A failed first read always carries the API's reason.
  if (schedule.error !== undefined) {
    return <SectionError message={schedule.error} onRetry={schedule.retry} />
  }
  if (schedule.status !== 'loaded') return <ScheduleSkeleton />
  return <ScheduleForm schedule={schedule} />
}

export function PeriodicBackupSection({ schedule }: Readonly<PeriodicBackupSectionProps>) {
  const loaded = schedule.status === 'loaded'

  return (
    <div data-testid="periodic-backup-section" className="space-y-4">
      {/* Cancel and Save appear once the first read has loaded. */}
      <SettingsSectionHeader
        title="Periodic Backup"
        dirty={schedule.dirty}
        saving={schedule.saving}
        onCancel={loaded ? schedule.cancel : undefined}
        onSave={loaded ? schedule.save : undefined}
      />
      <p className="text-sm text-muted-foreground">
        Schedule automatic backups at regular intervals.
      </p>
      <ScheduleBody schedule={schedule} />
    </div>
  )
}
