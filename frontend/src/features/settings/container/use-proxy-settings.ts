/**
 * useProxySettings (REQ-4.7.14, REQ-4.7.16, NET-10): reads the proxy setting on activation while
 * clean, stages every edit, asks the backend to check the staged change while the user types and
 * writes the changed fields as one PATCH on Save.
 */

import { useCallback, useMemo, useState } from 'react'
import { useFailureToast } from '@/hooks/use-failure-toast'
import {
  fetchProxySettings,
  updateProxySettings,
  validateProxySettings,
  type ProxyEntry,
  type ProxyProblem,
  type ProxyProblems,
  type ProxySettings,
  type ProxySettingsUpdate,
} from '@/features/settings/api/proxy'
import {
  useActivationRead,
  type PageReadStatus,
} from '@/features/settings/container/use-activation-read'
import { useDebouncedParse } from '@/features/settings/container/use-debounced-parse'
import { stagedPassword, useStagedFields } from '@/features/settings/container/use-staged-fields'

/** The fields the page edits; the password is undefined while untouched and empty once removed. */
export interface ProxyStaged {
  enabled: boolean
  source: ProxySettings['source']
  host: string
  port: number | string | null
  username: string
  password: string | undefined
  list_mode: ProxySettings['list_mode']
  entries: ProxyEntry[]
  proxy_local_addresses: boolean
}

export interface UseProxySettingsResult {
  status: PageReadStatus
  error?: string
  settings?: ProxySettings
  staged: ProxyStaged
  dirty: boolean
  saving: boolean
  /** What the backend refuses in the staged change, as of its last answer. */
  problems: ProxyProblem[]
  /** A check for the current staged change is waiting or in flight. */
  checking: boolean
  stage: <K extends keyof ProxyStaged>(field: K, value: ProxyStaged[K]) => void
  cancel: () => void
  save: () => void
  retry: () => void
}

const SAVE_FAILURE_TITLE = 'Could Not Save Proxy'

// Stands in until the first read answers; the page shows a skeleton and never draws it.
const UNREAD_STAGED: ProxyStaged = {
  enabled: false,
  source: 'host',
  host: '',
  port: null,
  username: '',
  password: undefined,
  list_mode: 'except',
  entries: [],
  proxy_local_addresses: false,
}

// In one fixed order, so the same staged change always reads as the same check text.
const STAGED_FIELDS = Object.keys(UNREAD_STAGED) as (keyof ProxyStaged)[]

const NO_PROBLEMS: ProxyProblem[] = []

function stagedOf(settings: ProxySettings): ProxyStaged {
  return {
    enabled: settings.enabled,
    source: settings.source,
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: undefined,
    list_mode: settings.list_mode,
    entries: settings.entries,
    proxy_local_addresses: settings.proxy_local_addresses,
  }
}

/** Same kinds and addresses in the same order. */
function sameEntries(a: ProxyEntry[], b: ProxyEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => entry.kind === b[index].kind && entry.address === b[index].address)
  )
}

/** The entry list compares by value, so the saved rows put back never make the page dirty. */
function differs(field: keyof ProxyStaged, saved: ProxyStaged, staged: ProxyStaged): boolean {
  if (field === 'entries') return !sameEntries(staged.entries, saved.entries)
  return staged[field] !== saved[field]
}

/** Only the fields that differ from the saved ones: what a check asks about and a Save sends. */
function changedFields(saved: ProxyStaged, staged: ProxyStaged): ProxySettingsUpdate {
  const change: ProxySettingsUpdate = {}
  const take = <K extends keyof ProxyStaged>(field: K): void => {
    if (differs(field, saved, staged)) change[field] = staged[field]
  }
  STAGED_FIELDS.forEach((field) => take(field))
  return change
}

function checkChange(text: string): Promise<ProxyProblems> {
  return validateProxySettings(JSON.parse(text) as ProxySettingsUpdate)
}

export function useProxySettings(active: boolean): UseProxySettingsResult {
  const { report } = useFailureToast(SAVE_FAILURE_TITLE)

  const [settings, setSettings] = useState<ProxySettings | undefined>()
  const saved = useMemo(() => settings && stagedOf(settings), [settings])

  const send = useCallback(
    (update: ProxySettingsUpdate) => updateProxySettings(update).then(setSettings),
    [],
  )

  const {
    staged = UNREAD_STAGED,
    dirty,
    saving,
    stage: stageField,
    cancel,
    save: saveFields,
  } = useStagedFields({
    saved,
    differs,
    toUpdate: changedFields,
    send,
    failureTitle: SAVE_FAILURE_TITLE,
  })

  const passwordStored = settings?.password_set ?? false

  const stage = useCallback(
    <K extends keyof ProxyStaged>(field: K, value: ProxyStaged[K]) => {
      stageField<keyof ProxyStaged>(
        field,
        field === 'password' ? stagedPassword(passwordStored, value) : value,
      )
    },
    [stageField, passwordStored],
  )

  const applyLoaded = useCallback(
    (loaded: ProxySettings) => {
      setSettings(loaded)
      cancel()
    },
    [cancel],
  )

  const { status, error, retry } = useActivationRead(active, dirty, fetchProxySettings, applyLoaded)

  // The check is keyed by the staged change as text; a clean page asks nothing.
  const checkText = saved && dirty ? JSON.stringify(changedFields(saved, staged)) : ''
  const check = useDebouncedParse(checkText, checkChange)

  const save = useCallback(() => {
    saveFields().catch(report)
  }, [saveFields, report])

  return {
    status,
    error,
    settings,
    staged,
    dirty,
    saving,
    problems: check.result?.problems ?? NO_PROBLEMS,
    checking: check.status === 'pending',
    stage,
    cancel,
    save,
    retry,
  }
}
