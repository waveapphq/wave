/**
 * useMcpSettings Hook (REQ-5.2.7.1, REQ-4.7.16)
 *
 * Drives the MCP Server page: reads on activation while clean, stages enablement and endpoint
 * edits, asks before a Save that restarts or exposes the endpoint, and polls the status.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFailureToast } from '@/hooks/use-failure-toast'
import { wireNumber } from '@/lib/number-rule'
import {
  disconnectMcpSession,
  fetchMcpSettings,
  fetchMcpStatus,
  updateMcpSettings,
  type McpSettings,
  type McpSettingsUpdate,
  type McpStatus,
} from '@/features/settings/api/mcp'
import {
  useActivationRead,
  type PageReadStatus,
} from '@/features/settings/container/use-activation-read'
import { stagedPassword, useStagedFields } from '@/features/settings/container/use-staged-fields'
import type {
  McpSaveConfirmation,
  McpStagedSettings,
} from '@/features/settings/page/mcp-server-tab'

export interface UseMcpSettingsResult {
  readStatus: PageReadStatus
  /** The API's reason when the first read failed. */
  error?: string
  retry: () => void
  settings?: McpSettings
  status?: McpStatus
  /** The reason of the last failed status poll; the last known status stays. */
  statusError?: string
  staged: McpStagedSettings
  dirty: boolean
  saving: boolean
  /** Set while a requested Save waits for the user's answer. */
  confirmation?: McpSaveConfirmation
  stageChange: (field: keyof McpStagedSettings, value: string | boolean) => void
  cancel: () => void
  requestSave: () => void
  confirmSave: () => void
  dismissConfirmation: () => void
  disconnectSession: (sessionId: string) => void
}

type EnablementField = 'enabled' | 'until_restart'

const POLL_INTERVAL_MS = 5000
const STATUS_ERROR_FALLBACK = 'Failed to read the MCP status'
const SAVE_FAILURE_TITLE = 'Could Not Save MCP Server'

// Stands in until the first read answers; the page shows a skeleton and never draws it.
const UNREAD_STAGED: McpStagedSettings = {
  enabled: false,
  until_restart: false,
  port: '8765',
  bind: 'local',
  auth_enabled: false,
  auth_username: '',
  auth_password: undefined,
}

const ENDPOINT_FIELDS = ['port', 'bind', 'auth_enabled', 'auth_username', 'auth_password'] as const

// The two enablement modes are exclusive: turning one on turns the other off.
const OTHER_MODE: Partial<Record<keyof McpStagedSettings, EnablementField>> = {
  enabled: 'until_restart',
  until_restart: 'enabled',
}

function loadMcp(): Promise<[McpSettings, McpStatus]> {
  return Promise.all([fetchMcpSettings(), fetchMcpStatus()])
}

/** The saved values as the page stages them; the password is undefined until it is emptied or typed (MCP-7). */
function stagedFrom(settings: McpSettings): McpStagedSettings {
  return {
    enabled: settings.enabled,
    until_restart: settings.until_restart_active,
    port: String(settings.port),
    bind: settings.bind,
    auth_enabled: settings.auth_enabled,
    auth_username: settings.auth_username,
    auth_password: undefined,
  }
}

/** Only the fields that differ from the saved ones; an emptied password is sent empty, so the server removes it. */
function changedFields(saved: McpStagedSettings, staged: McpStagedSettings): McpSettingsUpdate {
  const change: McpSettingsUpdate = {}
  if (staged.enabled !== saved.enabled) change.enabled = staged.enabled
  if (staged.until_restart !== saved.until_restart) change.until_restart = staged.until_restart
  if (staged.port !== saved.port) change.port = wireNumber(staged.port, 'integer')
  if (staged.bind !== saved.bind) change.bind = staged.bind
  if (staged.auth_enabled !== saved.auth_enabled) change.auth_enabled = staged.auth_enabled
  if (staged.auth_username !== saved.auth_username) change.auth_username = staged.auth_username
  if (staged.auth_password !== saved.auth_password) change.auth_password = staged.auth_password
  return change
}

/** What a Save must ask first, or undefined when it can go ahead (MCP-5, MCP-6). */
function confirmationFor(
  running: boolean,
  saved: McpStagedSettings,
  staged: McpStagedSettings,
): McpSaveConfirmation | undefined {
  const staysEnabled = staged.enabled || staged.until_restart
  const restart =
    running && staysEnabled && ENDPOINT_FIELDS.some((field) => staged[field] !== saved[field])
  const exposure = staged.bind === 'network' && saved.bind !== 'network'
  return restart || exposure ? { restart, exposure } : undefined
}

export function useMcpSettings(active: boolean): UseMcpSettingsResult {
  const { report: reportSaveFailure } = useFailureToast(SAVE_FAILURE_TITLE)
  const { report: reportDisconnectFailure } = useFailureToast('Could Not Disconnect Session')

  const [settings, setSettings] = useState<McpSettings | undefined>()
  const [status, setStatus] = useState<McpStatus | undefined>()
  const [statusError, setStatusError] = useState<string | undefined>()
  const [confirmation, setConfirmation] = useState<McpSaveConfirmation | undefined>()

  const saved = useMemo(() => settings && stagedFrom(settings), [settings])
  const running = status?.running ?? false

  const refreshStatus = useCallback(() => {
    fetchMcpStatus().then(
      (next) => {
        setStatus(next)
        setStatusError(undefined)
      },
      (err: unknown) => {
        setStatusError(err instanceof Error ? err.message : STATUS_ERROR_FALLBACK)
      },
    )
  }, [])

  useEffect(() => {
    if (!active) return undefined
    const interval = setInterval(refreshStatus, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [active, refreshStatus])

  const send = useCallback(
    (update: McpSettingsUpdate) =>
      updateMcpSettings(update).then((updated) => {
        setSettings(updated)
        refreshStatus()
      }),
    [refreshStatus],
  )

  const {
    staged = UNREAD_STAGED,
    dirty,
    saving,
    stage,
    cancel,
    save: saveFields,
  } = useStagedFields({ saved, toUpdate: changedFields, send, failureTitle: SAVE_FAILURE_TITLE })
  const baseline = saved ?? UNREAD_STAGED

  const applyLoaded = useCallback(
    ([loadedSettings, loadedStatus]: [McpSettings, McpStatus]) => {
      setSettings(loadedSettings)
      setStatus(loadedStatus)
      setStatusError(undefined)
      cancel()
    },
    [cancel],
  )

  const { status: readStatus, error, retry } = useActivationRead(active, dirty, loadMcp, applyLoaded)

  const passwordStored = settings?.auth_password_set ?? false

  const stageChange = useCallback(
    (field: keyof McpStagedSettings, value: string | boolean) => {
      stage(field, field === 'auth_password' ? stagedPassword(passwordStored, value) : value)
      const otherMode = OTHER_MODE[field]
      if (otherMode && value === true) stage(otherMode, false)
    },
    [stage, passwordStored],
  )

  const save = useCallback(() => {
    saveFields().catch(reportSaveFailure)
  }, [saveFields, reportSaveFailure])

  const requestSave = useCallback(() => {
    const needed = confirmationFor(running, baseline, staged)
    if (needed) setConfirmation(needed)
    else save()
  }, [running, baseline, staged, save])

  const confirmSave = useCallback(() => {
    setConfirmation(undefined)
    save()
  }, [save])

  const dismissConfirmation = useCallback(() => {
    setConfirmation(undefined)
  }, [])

  const disconnectSession = useCallback(
    (sessionId: string) => {
      disconnectMcpSession(sessionId).then(refreshStatus, reportDisconnectFailure)
    },
    [refreshStatus, reportDisconnectFailure],
  )

  return {
    readStatus,
    error,
    retry,
    settings,
    status,
    statusError,
    staged,
    dirty,
    saving,
    confirmation,
    stageChange,
    cancel,
    requestSave,
    confirmSave,
    dismissConfirmation,
    disconnectSession,
  }
}
