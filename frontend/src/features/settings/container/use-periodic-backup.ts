/**
 * usePeriodicBackup (REQ-4.7.20, SETTINGS-21): reads the schedule on activation while clean,
 * stages every edit and writes it as one PUT on Save.
 */

import { useCallback, useMemo, useState } from 'react'
import { useFailureToast } from '@/hooks/use-failure-toast'
import {
  getSchedule,
  updateSchedule,
  type BackupSchedule,
  type BackupScheduleUpdate,
} from '@/features/settings/api/backup'
import {
  useActivationRead,
  type PageReadStatus,
} from '@/features/settings/container/use-activation-read'
import { useStagedFields } from '@/features/settings/container/use-staged-fields'

/** The schedule fields the page edits: every field a Save sends while the schedule is on. */
export type ScheduleStaged = Required<BackupScheduleUpdate>

export interface UsePeriodicBackupResult {
  status: PageReadStatus
  error?: string
  saved?: BackupSchedule
  staged: ScheduleStaged
  dirty: boolean
  saving: boolean
  stage: <K extends keyof ScheduleStaged>(field: K, value: ScheduleStaged[K]) => void
  cancel: () => void
  save: () => void
  retry: () => void
}

const SAVE_FAILURE_TITLE = 'Could Not Save Backup Schedule'

// Stands in until the first read answers; the page shows a skeleton and never draws it.
const UNREAD_SCHEDULE: ScheduleStaged = {
  enabled: false,
  cron: '',
  entity_types: [],
  max_backups: 0,
  save_directory: '',
  format: '',
  compression_method: '',
  compression_level: 0,
  secrets: 'mask',
}

function stagedOf(schedule: BackupSchedule): ScheduleStaged {
  return {
    enabled: schedule.enabled,
    cron: schedule.cron,
    entity_types: schedule.entity_types,
    max_backups: schedule.max_backups,
    save_directory: schedule.save_directory,
    format: schedule.format,
    compression_method: schedule.compression_method,
    compression_level: schedule.compression_level,
    secrets: schedule.secrets,
  }
}

/** Same members in any order. */
function sameMembers(a: string[], b: string[]): boolean {
  const members = new Set(b)
  return new Set(a).size === members.size && a.every((item) => members.has(item))
}

/** Entity types compare as a set, so their order never makes the page dirty. */
function differs(field: keyof ScheduleStaged, saved: ScheduleStaged, staged: ScheduleStaged): boolean {
  if (field === 'entity_types') return !sameMembers(staged.entity_types, saved.entity_types)
  return staged[field] !== saved[field]
}

/** A schedule that is off sends the switch alone. */
function toUpdate(_saved: ScheduleStaged, staged: ScheduleStaged): BackupScheduleUpdate {
  return staged.enabled ? staged : { enabled: false }
}

export function usePeriodicBackup(active: boolean): UsePeriodicBackupResult {
  const { report } = useFailureToast(SAVE_FAILURE_TITLE)

  const [saved, setSaved] = useState<BackupSchedule | undefined>()
  const baseline = useMemo(() => saved && stagedOf(saved), [saved])

  const send = useCallback(
    (update: BackupScheduleUpdate) => updateSchedule(update).then(setSaved),
    [],
  )

  const {
    staged = UNREAD_SCHEDULE,
    dirty,
    saving,
    stage,
    cancel,
    save: saveFields,
  } = useStagedFields({ saved: baseline, differs, toUpdate, send, failureTitle: SAVE_FAILURE_TITLE })

  const applySchedule = useCallback(
    (schedule: BackupSchedule) => {
      setSaved(schedule)
      cancel()
    },
    [cancel],
  )

  const { status, error, retry } = useActivationRead(active, dirty, getSchedule, applySchedule)

  const save = useCallback(() => {
    saveFields().catch(report)
  }, [saveFields, report])

  return { status, error, saved, staged, dirty, saving, stage, cancel, save, retry }
}
