/**
 * useGeneralSettings (REQ-4.7.16): reads the General page on activation while clean, stages
 * its values, and writes the changed ones in order on Save.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFailureToast } from '@/hooks/use-failure-toast'
import {
  fetchLogLevel,
  fetchMaskingSettings,
  setLogLevel,
  setMaskingSettings,
  type MaskingSettings,
  type MaskingSettingsApiResponse,
  type MaskingSettingsPartial,
} from '@/features/settings/api/admin'
import {
  useActivationRead,
  type PageReadStatus,
} from '@/features/settings/container/use-activation-read'
import type { LogLevel } from '@/lib/log-levels'
import type { TimezoneMode } from '@/lib/timestamp-format'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { useTimezoneStore } from '@/stores/timezone-store'

export interface GeneralStaged {
  logLevel: LogLevel
  timezone: TimezoneMode
  masking: MaskingSettings
}

export interface UseGeneralSettingsResult {
  status: PageReadStatus
  error?: string
  /** The level in force; unknown until the first read answers. */
  logLevel?: LogLevel
  staged: GeneralStaged
  dirty: boolean
  saving: boolean
  stageLogLevel: (level: LogLevel) => void
  stageTimezone: (mode: TimezoneMode) => void
  stageMasking: (key: keyof MaskingSettings, value: boolean) => void
  cancel: () => void
  save: () => void
  retry: () => void
}

type GeneralRead = [LogLevel, MaskingSettingsApiResponse]

// Never shown: the page holds a skeleton until the first read answers.
const UNREAD_LEVEL: LogLevel = 'INFO'
const ALL_MASKED: MaskingSettings = {
  runOutput: false,
  testVariables: false,
  sharedVariables: false,
  credentialInputs: false,
}
const NO_FLAGS: Partial<MaskingSettings> = {}

const API_NAME: Record<keyof MaskingSettings, keyof MaskingSettingsApiResponse> = {
  runOutput: 'run_output',
  testVariables: 'test_variables',
  sharedVariables: 'shared_variables',
  credentialInputs: 'credential_inputs',
}
const FLAG_KEYS = Object.keys(API_NAME) as Array<keyof MaskingSettings>

const loadGeneral = (): Promise<GeneralRead> =>
  Promise.all([fetchLogLevel(), fetchMaskingSettings()])

function fromApi(flags: MaskingSettingsApiResponse): MaskingSettings {
  return {
    runOutput: flags.run_output,
    testVariables: flags.test_variables,
    sharedVariables: flags.shared_variables,
    credentialInputs: flags.credential_inputs,
  }
}

/** Only the flags that differ from the saved ones, under their API names, or undefined when none do. */
function maskingChange(
  saved: MaskingSettings,
  staged: MaskingSettings,
): MaskingSettingsPartial | undefined {
  const change: MaskingSettingsPartial = {}
  for (const key of FLAG_KEYS) {
    if (staged[key] !== saved[key]) change[API_NAME[key]] = staged[key]
  }
  return Object.keys(change).length > 0 ? change : undefined
}

export function useGeneralSettings(active: boolean): UseGeneralSettingsResult {
  const { report } = useFailureToast('Could Not Save General Settings')
  const savedTimezone = useTimezoneStore((s) => s.mode)

  const [savedLevel, setSavedLevel] = useState<LogLevel | undefined>()
  const [savedMasking, setSavedMasking] = useState<MaskingSettings>(ALL_MASKED)
  const [stagedLevel, setStagedLevel] = useState<LogLevel | undefined>()
  const [stagedTimezone, setStagedTimezone] = useState<TimezoneMode | undefined>()
  const [stagedFlags, setStagedFlags] = useState<Partial<MaskingSettings>>(NO_FLAGS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    useTimezoneStore.getState().initializeFromStorage()
  }, [])

  const baseLevel = savedLevel ?? UNREAD_LEVEL
  const level = stagedLevel ?? baseLevel
  const timezone = stagedTimezone ?? savedTimezone
  const masking = useMemo(() => ({ ...savedMasking, ...stagedFlags }), [savedMasking, stagedFlags])
  const changedFlags = useMemo(() => maskingChange(savedMasking, masking), [savedMasking, masking])
  const levelChanged = level !== baseLevel
  const timezoneChanged = timezone !== savedTimezone
  const dirty = levelChanged || timezoneChanged || changedFlags !== undefined

  const applyLoaded = useCallback(([readLevel, readFlags]: GeneralRead) => {
    const flags = fromApi(readFlags)
    setSavedLevel(readLevel)
    setSavedMasking(flags)
    setStagedLevel(undefined)
    setStagedFlags(NO_FLAGS)
    // The rest of the app masks from the store, so a read brings it in line with the server.
    useMaskingSettingsStore.getState().set(flags)
  }, [])

  const { status, error, retry } = useActivationRead(active, dirty, loadGeneral, applyLoaded)

  const stageMasking = useCallback((key: keyof MaskingSettings, value: boolean) => {
    setStagedFlags((prev) => ({ ...prev, [key]: value }))
  }, [])

  const cancel = useCallback(() => {
    setStagedLevel(undefined)
    setStagedTimezone(undefined)
    setStagedFlags(NO_FLAGS)
  }, [])

  const save = useCallback(() => {
    // Each write that succeeds becomes the new baseline, so a later failure leaves it saved.
    const writeChanges = async () => {
      if (levelChanged) {
        const writtenLevel = await setLogLevel(level)
        setSavedLevel(writtenLevel)
        setStagedLevel(undefined)
      }
      if (changedFlags) {
        const writtenFlags = fromApi(await setMaskingSettings(changedFlags))
        setSavedMasking(writtenFlags)
        setStagedFlags(NO_FLAGS)
        useMaskingSettingsStore.getState().set(writtenFlags)
      }
      // The browser takes the zone only once both server writes succeeded.
      if (timezoneChanged) {
        useTimezoneStore.getState().setMode(timezone)
        setStagedTimezone(undefined)
      }
    }
    setSaving(true)
    writeChanges()
      .catch(report)
      .finally(() => setSaving(false))
  }, [levelChanged, level, changedFlags, timezoneChanged, timezone, report])

  return {
    status,
    error,
    logLevel: savedLevel,
    staged: { logLevel: level, timezone, masking },
    dirty,
    saving,
    stageLogLevel: setStagedLevel,
    stageTimezone: setStagedTimezone,
    stageMasking,
    cancel,
    save,
    retry,
  }
}
