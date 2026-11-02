/**
 * useMcpSettings Hook Tests
 *
 * REQ-5.2.7.1, REQ-4.7.16: the MCP Server page state - the first read on
 * activation, staged enablement and endpoint edits, the Save confirmation
 * decision (MCP-5, MCP-6), one PUT with the changed fields, the password left
 * untouched, removed or typed (MCP-7), 5s status polling while active and
 * session disconnect.
 *
 * Module under test: frontend/src/features/settings/container/use-mcp-settings.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

vi.mock('@/features/settings/api/mcp', () => ({
  fetchMcpSettings: vi.fn(),
  updateMcpSettings: vi.fn(),
  fetchMcpStatus: vi.fn(),
  disconnectMcpSession: vi.fn(),
}))

import {
  fetchMcpSettings,
  updateMcpSettings,
  fetchMcpStatus,
  disconnectMcpSession,
  type McpSettings,
  type McpStatus,
} from '@/features/settings/api/mcp'
import { useMcpSettings } from '@/features/settings/container/use-mcp-settings'

const mockFetchMcpSettings = vi.mocked(fetchMcpSettings)
const mockUpdateMcpSettings = vi.mocked(updateMcpSettings)
const mockFetchMcpStatus = vi.mocked(fetchMcpStatus)
const mockDisconnectMcpSession = vi.mocked(disconnectMcpSession)

// ============================================================================
// Mock Data
// ============================================================================

const DEFAULT_SETTINGS: McpSettings = {
  enabled: false,
  until_restart_active: false,
  port: 8765,
  bind: 'local',
  auth_enabled: false,
  auth_username: '',
  auth_password_set: false,
  running: false,
  server_port: 8000,
}

const DEFAULT_STATUS: McpStatus = {
  running: false,
  enabled: false,
  until_restart_active: false,
  port: 8765,
  bind: 'local',
  urls: [],
  connected_clients: 0,
  sessions: [],
  recent_activity: [],
  last_error: null,
}

const RUNNING_SETTINGS: McpSettings = { ...DEFAULT_SETTINGS, enabled: true, running: true }

const RUNNING_STATUS: McpStatus = {
  ...DEFAULT_STATUS,
  running: true,
  enabled: true,
  urls: ['http://127.0.0.1:8765/mcp'],
}

const UNTIL_RESTART_SETTINGS: McpSettings = {
  ...DEFAULT_SETTINGS,
  until_restart_active: true,
  running: true,
}

const UNTIL_RESTART_STATUS: McpStatus = {
  ...DEFAULT_STATUS,
  running: true,
  until_restart_active: true,
  urls: ['http://127.0.0.1:8765/mcp'],
}

/** A stopped endpoint that holds a stored password, authentication off. */
const STORED_SECRET_SETTINGS: McpSettings = {
  ...DEFAULT_SETTINGS,
  auth_username: 'ops',
  auth_password_set: true,
}

/** The same endpoint after the server removed its password. */
const REMOVED_SECRET_SETTINGS: McpSettings = { ...STORED_SECRET_SETTINGS, auth_password_set: false }

/** A stopped endpoint that requires authentication and holds a stored password. */
const AUTH_ON_SETTINGS: McpSettings = { ...STORED_SECRET_SETTINGS, auth_enabled: true }

/** A running endpoint that holds a stored password. */
const RUNNING_STORED_SECRET_SETTINGS: McpSettings = {
  ...RUNNING_SETTINGS,
  auth_username: 'ops',
  auth_password_set: true,
}

// An untouched password is staged as undefined: it is neither shown nor sent.
const DEFAULT_STAGED = {
  enabled: false,
  until_restart: false,
  port: '8765',
  bind: 'local',
  auth_enabled: false,
  auth_username: '',
  auth_password: undefined,
}

const SAVE_TITLE = 'Could Not Save MCP Server'
const DISCONNECT_TITLE = 'Could Not Disconnect Session'
const READ_ONLY_MESSAGE =
  'Settings cannot be saved: the config file /srv/wave/config/config.yaml is read-only'
const SECRET_REQUIRED_MESSAGE = 'Password is required when authentication is enabled'
const TYPED_SECRET = 'Wavekeeper!9'
const REMOVED_NAMES = ['toggleEnabled', 'applyStaged', 'cancelStaged', 'load', 'loading'] as const

// ============================================================================
// Utilities
// ============================================================================

function apiError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Microtasks only, so it also settles under fake timers.
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
    }
  })
}

function renderMcp(active: boolean) {
  return renderHook(({ active: isActive }: { active: boolean }) => useMcpSettings(isActive), {
    initialProps: { active },
  })
}

async function renderActiveHook() {
  const view = renderMcp(true)
  await flush()
  return view
}

function serveRunning() {
  mockFetchMcpSettings.mockResolvedValue(RUNNING_SETTINGS)
  mockFetchMcpStatus.mockResolvedValue(RUNNING_STATUS)
  mockUpdateMcpSettings.mockResolvedValue(RUNNING_SETTINGS)
}

function serveUntilRestart() {
  mockFetchMcpSettings.mockResolvedValue(UNTIL_RESTART_SETTINGS)
  mockFetchMcpStatus.mockResolvedValue(UNTIL_RESTART_STATUS)
  mockUpdateMcpSettings.mockResolvedValue(UNTIL_RESTART_SETTINGS)
}

function serveStoredSecret() {
  mockFetchMcpSettings.mockResolvedValue(STORED_SECRET_SETTINGS)
  mockUpdateMcpSettings.mockResolvedValue(STORED_SECRET_SETTINGS)
}

function serveRunningStoredSecret() {
  mockFetchMcpSettings.mockResolvedValue(RUNNING_STORED_SECRET_SETTINGS)
  mockFetchMcpStatus.mockResolvedValue(RUNNING_STATUS)
  mockUpdateMcpSettings.mockResolvedValue(RUNNING_STORED_SECRET_SETTINGS)
}

type McpHook = Awaited<ReturnType<typeof renderActiveHook>>['result']

function stage(result: McpHook, field: string, value: string | boolean) {
  act(() => {
    result.current.stageChange(field as Parameters<typeof result.current.stageChange>[0], value)
  })
}

async function requestSave(result: McpHook) {
  await act(async () => {
    result.current.requestSave()
  })
  await flush()
}

async function confirmSave(result: McpHook) {
  await act(async () => {
    result.current.confirmSave()
  })
  await flush()
}

function sentChange(call = 0) {
  return mockUpdateMcpSettings.mock.calls[call][0]
}

// ============================================================================
// Tests
// ============================================================================

describe('useMcpSettings', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockFetchMcpSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockFetchMcpStatus.mockResolvedValue(DEFAULT_STATUS)
    mockUpdateMcpSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockDisconnectMcpSession.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('First read', () => {
    it('does not load while the section is inactive', async () => {
      renderMcp(false)
      await flush()

      expect(mockFetchMcpSettings).not.toHaveBeenCalled()
      expect(mockFetchMcpStatus).not.toHaveBeenCalled()
    })

    it('is pending while the page is inactive', async () => {
      const { result } = renderMcp(false)
      await flush()

      expect(result.current.readStatus).toBe('pending')
      expect(result.current.settings).toBeUndefined()
      expect(result.current.status).toBeUndefined()
    })

    it('a Save asked before the first read has answered asks nothing and sends nothing', async () => {
      const { result } = renderMcp(false)
      await flush()

      await requestSave(result)

      expect(result.current.confirmation).toBeUndefined()
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(false)
      expect(toastError).not.toHaveBeenCalled()
    })

    it('reads settings and status together when the page is active, then is loaded', async () => {
      const { result } = await renderActiveHook()

      expect(mockFetchMcpSettings).toHaveBeenCalledTimes(1)
      expect(mockFetchMcpStatus).toHaveBeenCalledTimes(1)
      expect(result.current.readStatus).toBe('loaded')
      expect(result.current.settings).toEqual(DEFAULT_SETTINGS)
      expect(result.current.status).toEqual(DEFAULT_STATUS)
      expect(result.current.error).toBeUndefined()
      expect(result.current.statusError).toBeUndefined()
      expect(result.current.saving).toBe(false)
      expect(result.current.confirmation).toBeUndefined()
    })

    it('is pending while the settings read is in flight', async () => {
      const read = deferred<McpSettings>()
      mockFetchMcpSettings.mockReturnValueOnce(read.promise)

      const { result } = await renderActiveHook()
      expect(result.current.readStatus).toBe('pending')

      await act(async () => {
        read.resolve(DEFAULT_SETTINGS)
      })
      await flush()

      expect(result.current.readStatus).toBe('loaded')
      expect(result.current.settings).toEqual(DEFAULT_SETTINGS)
    })

    it('stays pending until the status read has answered too', async () => {
      const read = deferred<McpStatus>()
      mockFetchMcpStatus.mockReturnValueOnce(read.promise)

      const { result } = await renderActiveHook()
      expect(result.current.readStatus).toBe('pending')

      await act(async () => {
        read.resolve(RUNNING_STATUS)
      })
      await flush()

      expect(result.current.readStatus).toBe('loaded')
      expect(result.current.status).toEqual(RUNNING_STATUS)
    })

    it('loads once the section transitions from inactive to active', async () => {
      const view = renderMcp(false)
      await flush()
      expect(mockFetchMcpSettings).not.toHaveBeenCalled()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchMcpSettings).toHaveBeenCalledTimes(1)
      expect(mockFetchMcpStatus).toHaveBeenCalledTimes(1)
    })

    it('does not read again while the page stays active', async () => {
      const view = await renderActiveHook()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchMcpSettings).toHaveBeenCalledTimes(1)
      expect(mockFetchMcpStatus).toHaveBeenCalledTimes(1)
    })

    it('is failed with the API reason when the settings read fails', async () => {
      mockFetchMcpSettings.mockRejectedValue(apiError('Network error', 500))

      const { result } = await renderActiveHook()

      expect(result.current.readStatus).toBe('failed')
      expect(result.current.error).toBe('Network error')
      expect(result.current.settings).toBeUndefined()
    })

    it('is failed with the API reason when the status read fails', async () => {
      mockFetchMcpStatus.mockRejectedValue(apiError('Status read failed', 500))

      const { result } = await renderActiveHook()

      expect(result.current.readStatus).toBe('failed')
      expect(result.current.error).toBe('Status read failed')
    })

    it('is failed with "Request failed" when the rejection carries no reason', async () => {
      mockFetchMcpSettings.mockRejectedValue({ code: 500 })

      const { result } = await renderActiveHook()

      expect(result.current.readStatus).toBe('failed')
      expect(result.current.error).toBe('Request failed')
    })

    it('retry reads settings and status again: pending, then loaded', async () => {
      mockFetchMcpSettings.mockRejectedValueOnce(apiError('Network error', 500))
      const { result } = await renderActiveHook()
      expect(result.current.readStatus).toBe('failed')

      const read = deferred<McpSettings>()
      mockFetchMcpSettings.mockReturnValueOnce(read.promise)
      act(() => {
        result.current.retry()
      })
      await flush()
      expect(mockFetchMcpSettings).toHaveBeenCalledTimes(2)
      expect(mockFetchMcpStatus).toHaveBeenCalledTimes(2)
      expect(result.current.readStatus).toBe('pending')
      expect(result.current.error).toBeUndefined()

      await act(async () => {
        read.resolve(DEFAULT_SETTINGS)
      })
      await flush()

      expect(result.current.readStatus).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.settings).toEqual(DEFAULT_SETTINGS)
      expect(result.current.staged).toEqual(DEFAULT_STAGED)
    })

    it('reads again when a clean page turns active again', async () => {
      const view = await renderActiveHook()
      mockFetchMcpSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, port: 9100 })

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchMcpSettings).toHaveBeenCalledTimes(2)
      expect(view.result.current.settings?.port).toBe(9100)
      expect(view.result.current.staged.port).toBe('9100')
      expect(view.result.current.dirty).toBe(false)
    })

    it('never reads a dirty page again when it turns active again, and keeps its staged values', async () => {
      const view = await renderActiveHook()
      expect(view.result.current.readStatus).toBe('loaded')
      stage(view.result, 'port', '9001')
      stage(view.result, 'enabled', true)
      mockFetchMcpSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, port: 9100 })

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchMcpSettings).toHaveBeenCalledTimes(1)
      expect(mockFetchMcpStatus).toHaveBeenCalledTimes(1)
      expect(view.result.current.dirty).toBe(true)
      expect(view.result.current.staged).toEqual({ ...DEFAULT_STAGED, port: '9001', enabled: true })
    })

    it('no longer exposes load, loading or the old action names', async () => {
      const { result } = await renderActiveHook()

      for (const name of REMOVED_NAMES) {
        expect(result.current).not.toHaveProperty(name)
      }
    })
  })

  describe('Staged edits', () => {
    it('starts from the saved values, enablement included, and is clean', async () => {
      const { result } = await renderActiveHook()

      expect(result.current.staged).toEqual(DEFAULT_STAGED)
      expect(result.current.dirty).toBe(false)
    })

    it('stages "Enable MCP server" from the saved persistent mode', async () => {
      serveRunning()

      const { result } = await renderActiveHook()

      expect(result.current.staged).toEqual({ ...DEFAULT_STAGED, enabled: true })
      expect(result.current.dirty).toBe(false)
    })

    it('stages "Enable until restart" from the active until-restart mode', async () => {
      serveUntilRestart()

      const { result } = await renderActiveHook()

      expect(result.current.staged).toEqual({ ...DEFAULT_STAGED, until_restart: true })
      expect(result.current.dirty).toBe(false)
    })

    it('stageChange marks the state dirty', async () => {
      const { result } = await renderActiveHook()

      act(() => {
        result.current.stageChange('port', '9001')
      })

      expect(result.current.staged.port).toBe('9001')
      expect(result.current.dirty).toBe(true)
    })

    it('staging back to the server value clears dirty', async () => {
      const { result } = await renderActiveHook()

      act(() => {
        result.current.stageChange('port', '9001')
      })
      act(() => {
        result.current.stageChange('port', '8765')
      })

      expect(result.current.dirty).toBe(false)
    })

    it('a staged password counts as dirty', async () => {
      const { result } = await renderActiveHook()

      act(() => {
        result.current.stageChange('auth_password', 'new-secret')
      })

      expect(result.current.dirty).toBe(true)
    })

    it('staging an enablement mode marks the page dirty and sends nothing', async () => {
      const { result } = await renderActiveHook()

      stage(result, 'enabled', true)
      await flush()

      expect(result.current.staged.enabled).toBe(true)
      expect(result.current.dirty).toBe(true)
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
      expect(toastSuccess).not.toHaveBeenCalled()
    })

    it('staging "Enable until restart" marks the page dirty', async () => {
      const { result } = await renderActiveHook()

      stage(result, 'until_restart', true)

      expect(result.current.staged.until_restart).toBe(true)
      expect(result.current.dirty).toBe(true)
    })

    it('is clean again when the staged mode returns to the saved one', async () => {
      const { result } = await renderActiveHook()

      stage(result, 'enabled', true)
      stage(result, 'enabled', false)

      expect(result.current.staged).toEqual(DEFAULT_STAGED)
      expect(result.current.dirty).toBe(false)
    })

    it('keeps the saved settings untouched while a mode is staged', async () => {
      const { result } = await renderActiveHook()

      stage(result, 'enabled', true)

      expect(result.current.settings).toEqual(DEFAULT_SETTINGS)
    })

    it('staging "Enable MCP server" on turns "Enable until restart" off', async () => {
      serveUntilRestart()
      const { result } = await renderActiveHook()

      stage(result, 'enabled', true)

      expect(result.current.staged.enabled).toBe(true)
      expect(result.current.staged.until_restart).toBe(false)
    })

    it('staging "Enable until restart" on turns "Enable MCP server" off', async () => {
      serveRunning()
      const { result } = await renderActiveHook()

      stage(result, 'until_restart', true)

      expect(result.current.staged.until_restart).toBe(true)
      expect(result.current.staged.enabled).toBe(false)
    })

    it('staging a mode off leaves the other mode as it is', async () => {
      serveUntilRestart()
      const { result } = await renderActiveHook()

      stage(result, 'enabled', false)

      expect(result.current.staged.enabled).toBe(false)
      expect(result.current.staged.until_restart).toBe(true)
      expect(result.current.dirty).toBe(false)
    })

    it('cancel restores every staged value, enablement included', async () => {
      const { result } = await renderActiveHook()

      stage(result, 'enabled', true)
      stage(result, 'port', '9001')
      stage(result, 'bind', 'network')
      stage(result, 'auth_password', 'typed-secret')
      act(() => {
        result.current.cancel()
      })

      expect(result.current.staged).toEqual(DEFAULT_STAGED)
      expect(result.current.dirty).toBe(false)
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })

    it('cancel restores a saved mode that staging the other mode had turned off', async () => {
      serveRunning()
      const { result } = await renderActiveHook()

      stage(result, 'until_restart', true)
      act(() => {
        result.current.cancel()
      })

      expect(result.current.staged).toEqual({ ...DEFAULT_STAGED, enabled: true })
      expect(result.current.dirty).toBe(false)
    })
  })

  describe('requestSave saves at once (MCP-5)', () => {
    it('on a stopped endpoint whose endpoint fields changed', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ port: 9001 })
      expect(result.current.confirmation).toBeUndefined()
    })

    it('sends a port in the number wire form: digits a JS number would change go as typed (REQ-3.1.3.14)', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'port', '09001')

      await requestSave(result)

      expect(sentChange()).toStrictEqual({ port: '09001' })
    })

    it('when the Save only starts the endpoint', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'enabled', true)

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ enabled: true })
      expect(result.current.confirmation).toBeUndefined()
    })

    it('when the Save only stops a running endpoint', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'enabled', false)

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ enabled: false })
      expect(result.current.confirmation).toBeUndefined()
    })

    it('when a running endpoint is stopped together with an endpoint change', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'enabled', false)
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ enabled: false, port: 9001 })
      expect(result.current.confirmation).toBeUndefined()
    })

    it('when a running endpoint only switches its enablement mode', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'until_restart', true)

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ enabled: false, until_restart: true })
      expect(result.current.confirmation).toBeUndefined()
    })

    it('when an enabled endpoint that is not running changes its port', async () => {
      mockFetchMcpSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, enabled: true, running: false })
      mockFetchMcpStatus.mockResolvedValue({
        ...DEFAULT_STATUS,
        enabled: true,
        last_error: 'Port 8765 is already in use',
      })
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ port: 9001 })
      expect(result.current.confirmation).toBeUndefined()
    })

    it('when the bind narrows to Local on a stopped endpoint', async () => {
      mockFetchMcpSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, bind: 'network' })
      mockFetchMcpStatus.mockResolvedValue({ ...DEFAULT_STATUS, bind: 'network' })
      const { result } = await renderActiveHook()
      stage(result, 'bind', 'local')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ bind: 'local' })
      expect(result.current.confirmation).toBeUndefined()
    })

    it('when the bind already was Network on a stopped endpoint', async () => {
      mockFetchMcpSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, bind: 'network' })
      mockFetchMcpStatus.mockResolvedValue({ ...DEFAULT_STATUS, bind: 'network' })
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ port: 9001 })
      expect(result.current.confirmation).toBeUndefined()
    })
  })

  describe('requestSave asks first (MCP-5, MCP-6)', () => {
    it('restart: a running endpoint whose port changed and that stays enabled', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: true, exposure: false })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
      expect(result.current.staged.port).toBe('9001')
      expect(result.current.dirty).toBe(true)
    })

    it.each([
      ['auth_enabled', true],
      ['auth_username', 'ops'],
      ['auth_password', 'Wavekeeper!9'],
    ] as const)('restart: a running endpoint whose %s changed', async (field, value) => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, field, value)

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: true, exposure: false })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })

    it('restart: an endpoint running until restart whose port changed', async () => {
      serveUntilRestart()
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: true, exposure: false })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })

    it('restart only: a running endpoint whose bind narrows to Local', async () => {
      mockFetchMcpSettings.mockResolvedValue({ ...RUNNING_SETTINGS, bind: 'network' })
      mockFetchMcpStatus.mockResolvedValue({ ...RUNNING_STATUS, bind: 'network' })
      const { result } = await renderActiveHook()
      stage(result, 'bind', 'local')

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: true, exposure: false })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })

    it('exposure: a stopped endpoint whose bind widens to Network', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'bind', 'network')

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: false, exposure: true })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
    })

    it('exposure: an endpoint started by the same Save that widens its bind to Network', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'enabled', true)
      stage(result, 'bind', 'network')

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: false, exposure: true })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })

    it('restart and exposure: a running endpoint whose bind widens to Network', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'bind', 'network')

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: true, exposure: true })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })

    it('exposure alone: a running endpoint turned off by the same Save that widens its bind', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'enabled', false)
      stage(result, 'bind', 'network')

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: false, exposure: true })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
    })

    it('exposure alone: an endpoint running until restart turned off while its bind widens', async () => {
      serveUntilRestart()
      const { result } = await renderActiveHook()
      stage(result, 'until_restart', false)
      stage(result, 'bind', 'network')
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: false, exposure: true })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })
  })

  describe('confirmSave and dismissConfirmation', () => {
    it('confirmSave clears the confirmation and sends the staged change', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')
      await requestSave(result)
      expect(result.current.confirmation).toEqual({ restart: true, exposure: false })

      await confirmSave(result)

      expect(result.current.confirmation).toBeUndefined()
      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ port: 9001 })
    })

    it('confirmSave after the exposure warning sends the widened bind', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')
      stage(result, 'bind', 'network')
      await requestSave(result)

      await confirmSave(result)

      expect(result.current.confirmation).toBeUndefined()
      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ port: 9001, bind: 'network' })
    })

    it('dismissConfirmation clears the confirmation, sends nothing and keeps the staged values', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')
      stage(result, 'auth_password', 'Wavekeeper!9')
      await requestSave(result)

      act(() => {
        result.current.dismissConfirmation()
      })
      await flush()

      expect(result.current.confirmation).toBeUndefined()
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(true)
      expect(result.current.staged).toEqual({
        ...DEFAULT_STAGED,
        enabled: true,
        port: '9001',
        auth_password: 'Wavekeeper!9',
      })
      expect(toastError).not.toHaveBeenCalled()
    })

    it('confirmSave after the exposure warning turns the endpoint off and widens the bind in one PUT', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'enabled', false)
      stage(result, 'bind', 'network')
      await requestSave(result)

      await confirmSave(result)

      expect(result.current.confirmation).toBeUndefined()
      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ enabled: false, bind: 'network' })
    })

    it('a dismissal right after confirmSave still sends one PUT and leaves the staged values until it resolves', async () => {
      serveRunning()
      const write = deferred<McpSettings>()
      mockUpdateMcpSettings.mockReturnValueOnce(write.promise)
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')
      stage(result, 'auth_password', 'Wavekeeper!9')
      await requestSave(result)
      const stagedBefore = result.current.staged

      await act(async () => {
        result.current.confirmSave()
        result.current.dismissConfirmation()
      })
      await flush()

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ port: 9001, auth_password: 'Wavekeeper!9' })
      expect(result.current.confirmation).toBeUndefined()
      expect(result.current.saving).toBe(true)
      expect(result.current.dirty).toBe(true)
      expect(result.current.staged).toEqual(stagedBefore)
      expect(result.current.staged).toEqual({
        ...DEFAULT_STAGED,
        enabled: true,
        port: '9001',
        auth_password: 'Wavekeeper!9',
      })

      await act(async () => {
        write.resolve({ ...RUNNING_SETTINGS, port: 9001 })
      })
      await flush()

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(result.current.saving).toBe(false)
      expect(result.current.confirmation).toBeUndefined()
      expect(result.current.dirty).toBe(false)
      expect(result.current.staged).toEqual({ ...DEFAULT_STAGED, enabled: true, port: '9001' })
      expect(toastError).not.toHaveBeenCalled()
    })

    it('a dismissal right after confirmSave still reports a failed save once and keeps the staged values', async () => {
      serveRunning()
      mockUpdateMcpSettings.mockRejectedValue(apiError(READ_ONLY_MESSAGE, 500))
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')
      await requestSave(result)

      await act(async () => {
        result.current.confirmSave()
        result.current.dismissConfirmation()
      })
      await flush()

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith(READ_ONLY_MESSAGE, SAVE_TITLE)
      expect(result.current.confirmation).toBeUndefined()
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(true)
      expect(result.current.staged.port).toBe('9001')
    })

    it('asks again on the next requestSave after a dismissal', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')
      await requestSave(result)
      act(() => {
        result.current.dismissConfirmation()
      })

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: true, exposure: false })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })
  })

  describe('Save', () => {
    it('sends enablement and endpoint changes together in one PUT, the port as a number', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'enabled', true)
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ enabled: true, port: 9001 })
    })

    it('includes auth fields only when they changed', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'auth_enabled', true)
      stage(result, 'auth_username', 'ops')
      stage(result, 'auth_password', 'hunter2-secret')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({
        auth_enabled: true,
        auth_username: 'ops',
        auth_password: 'hunter2-secret',
      })
    })

    it('sends until_restart alone when only that mode changed', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'until_restart', true)

      await requestSave(result)

      expect(sentChange()).toStrictEqual({ until_restart: true })
    })

    it('sends both modes when staging one on turned the saved one off', async () => {
      serveUntilRestart()
      const { result } = await renderActiveHook()
      stage(result, 'enabled', true)

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ enabled: true, until_restart: false })
    })

    it('is saving while the request is in flight', async () => {
      const write = deferred<McpSettings>()
      mockUpdateMcpSettings.mockReturnValueOnce(write.promise)
      const { result } = await renderActiveHook()
      expect(result.current.saving).toBe(false)
      stage(result, 'port', '9001')

      await requestSave(result)
      expect(result.current.saving).toBe(true)

      await act(async () => {
        write.resolve({ ...DEFAULT_SETTINGS, port: 9001 })
      })
      await flush()

      expect(result.current.saving).toBe(false)
    })

    it('makes the response the new baseline, resets the staged values and clears the typed password', async () => {
      const saved: McpSettings = {
        ...DEFAULT_SETTINGS,
        enabled: true,
        running: true,
        port: 9001,
        auth_enabled: true,
        auth_username: 'ops',
        auth_password_set: true,
      }
      mockUpdateMcpSettings.mockResolvedValue(saved)
      const { result } = await renderActiveHook()
      stage(result, 'enabled', true)
      stage(result, 'port', '9001')
      stage(result, 'auth_enabled', true)
      stage(result, 'auth_username', 'ops')
      stage(result, 'auth_password', 'hunter2-secret')

      await requestSave(result)

      const savedStaged = {
        ...DEFAULT_STAGED,
        enabled: true,
        port: '9001',
        auth_enabled: true,
        auth_username: 'ops',
      }
      expect(result.current.settings).toEqual(saved)
      expect(result.current.staged).toEqual(savedStaged)
      expect(result.current.staged.auth_password).toBeUndefined()
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)

      stage(result, 'port', '9002')
      act(() => {
        result.current.cancel()
      })
      expect(result.current.staged).toEqual(savedStaged)
    })

    it('refreshes the status after a successful save', async () => {
      mockUpdateMcpSettings.mockResolvedValue(RUNNING_SETTINGS)
      const { result } = await renderActiveHook()
      const statusCallsAfterLoad = mockFetchMcpStatus.mock.calls.length
      mockFetchMcpStatus.mockResolvedValue(RUNNING_STATUS)
      stage(result, 'enabled', true)

      await requestSave(result)

      // >= rather than exact: the live 5s poll may tick during a slow CI run
      expect(mockFetchMcpStatus.mock.calls.length).toBeGreaterThanOrEqual(
        statusCallsAfterLoad + 1,
      )
      expect(result.current.status).toEqual(RUNNING_STATUS)
    })

    it('shows no toast on a successful save', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'enabled', true)
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    })

    it('on a failure shows "Could Not Save MCP Server" with the exact message and keeps the staged values', async () => {
      mockUpdateMcpSettings.mockRejectedValue(apiError(READ_ONLY_MESSAGE, 500))
      const { result } = await renderActiveHook()
      stage(result, 'enabled', true)
      stage(result, 'port', '9001')
      stage(result, 'auth_password', 'Wavekeeper!9')

      await requestSave(result)

      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith(READ_ONLY_MESSAGE, SAVE_TITLE)
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(true)
      expect(result.current.settings).toEqual(DEFAULT_SETTINGS)
      expect(result.current.staged).toEqual({
        ...DEFAULT_STAGED,
        enabled: true,
        port: '9001',
        auth_password: 'Wavekeeper!9',
      })
    })

    it('on a failure after confirming keeps the staged values and asks nothing more', async () => {
      serveRunning()
      mockUpdateMcpSettings.mockRejectedValue(apiError('Port 9001 is already in use', 400))
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')
      await requestSave(result)

      await confirmSave(result)

      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith('Port 9001 is already in use', SAVE_TITLE)
      expect(result.current.confirmation).toBeUndefined()
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(true)
      expect(result.current.staged.port).toBe('9001')
    })

    it('reports "Request failed" when the save rejection carries no reason', async () => {
      mockUpdateMcpSettings.mockRejectedValue({ code: 500 })
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith('Request failed', SAVE_TITLE)
    })

    it('sends the same change again on the next Save after a failure', async () => {
      mockUpdateMcpSettings.mockRejectedValueOnce(apiError(READ_ONLY_MESSAGE, 500))
      mockUpdateMcpSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, enabled: true, port: 9001 })
      const { result } = await renderActiveHook()
      stage(result, 'enabled', true)
      stage(result, 'port', '9001')
      await requestSave(result)

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(2)
      expect(sentChange(1)).toStrictEqual(sentChange(0))
      expect(result.current.dirty).toBe(false)
    })
  })

  describe('Password: untouched, removed or typed (MCP-7)', () => {
    it('leaves an untouched password undefined and out of the request', async () => {
      serveStoredSecret()
      const { result } = await renderActiveHook()
      expect(result.current.staged.auth_password).toBeUndefined()
      expect(result.current.dirty).toBe(false)
      stage(result, 'port', '9001')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ port: 9001 })
    })

    it('stages an emptied password as the empty string, marks the page dirty and sends nothing', async () => {
      serveStoredSecret()
      const { result } = await renderActiveHook()

      stage(result, 'auth_password', '')

      expect(result.current.staged.auth_password).toBe('')
      expect(result.current.dirty).toBe(true)
      expect(result.current.settings).toEqual(STORED_SECRET_SETTINGS)
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })

    it('on a stopped endpoint saves an emptied password at once, as the empty string, so the server removes it', async () => {
      serveStoredSecret()
      mockUpdateMcpSettings.mockResolvedValue(REMOVED_SECRET_SETTINGS)
      const { result } = await renderActiveHook()
      stage(result, 'auth_password', '')

      await requestSave(result)

      expect(result.current.confirmation).toBeUndefined()
      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ auth_password: '' })
      expect(result.current.settings).toEqual(REMOVED_SECRET_SETTINGS)
      expect(toastError).not.toHaveBeenCalled()
    })

    it('restart: a running endpoint whose password was emptied asks first, as a typed one does', async () => {
      serveRunningStoredSecret()
      const { result } = await renderActiveHook()
      stage(result, 'auth_password', '')

      await requestSave(result)

      expect(result.current.confirmation).toEqual({ restart: true, exposure: false })
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
      expect(result.current.staged.auth_password).toBe('')
      expect(result.current.dirty).toBe(true)
    })

    it('confirmSave after the restart question sends the emptied password as the empty string', async () => {
      serveRunningStoredSecret()
      const { result } = await renderActiveHook()
      stage(result, 'auth_password', '')
      await requestSave(result)
      expect(result.current.confirmation).toEqual({ restart: true, exposure: false })

      await confirmSave(result)

      expect(result.current.confirmation).toBeUndefined()
      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ auth_password: '' })
    })

    it('stages and sends a password typed into the emptied field as typed', async () => {
      serveStoredSecret()
      const { result } = await renderActiveHook()
      stage(result, 'auth_password', '')
      expect(result.current.dirty).toBe(true)

      stage(result, 'auth_password', TYPED_SECRET)
      expect(result.current.staged.auth_password).toBe(TYPED_SECRET)
      expect(result.current.dirty).toBe(true)

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ auth_password: TYPED_SECRET })
    })

    it.each([
      ['an emptied', ''],
      ['a typed', TYPED_SECRET],
    ])('Cancel brings %s password back to undefined', async (_case, value) => {
      serveStoredSecret()
      const { result } = await renderActiveHook()
      stage(result, 'auth_password', value)
      expect(result.current.dirty).toBe(true)

      act(() => {
        result.current.cancel()
      })

      expect(result.current.staged.auth_password).toBeUndefined()
      expect(result.current.dirty).toBe(false)
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })

    it.each([
      ['an emptied', '', REMOVED_SECRET_SETTINGS],
      ['a typed', TYPED_SECRET, STORED_SECRET_SETTINGS],
    ])('is undefined again after a successful Save of %s password', async (_case, value, answer) => {
      serveStoredSecret()
      mockUpdateMcpSettings.mockResolvedValue(answer)
      const { result } = await renderActiveHook()
      stage(result, 'auth_password', value)
      expect(result.current.dirty).toBe(true)

      await requestSave(result)

      expect(sentChange()).toStrictEqual({ auth_password: value })
      expect(result.current.settings).toEqual(answer)
      expect(result.current.staged.auth_password).toBeUndefined()
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)
    })

    it('keeps the emptied password staged when the server refuses the Save while authentication is on', async () => {
      mockFetchMcpSettings.mockResolvedValue(AUTH_ON_SETTINGS)
      mockUpdateMcpSettings.mockRejectedValue(apiError(SECRET_REQUIRED_MESSAGE, 400))
      const { result } = await renderActiveHook()
      stage(result, 'auth_password', '')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ auth_password: '' })
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith(SECRET_REQUIRED_MESSAGE, SAVE_TITLE)
      expect(result.current.settings).toEqual(AUTH_ON_SETTINGS)
      expect(result.current.staged.auth_password).toBe('')
      expect(result.current.dirty).toBe(true)
      expect(result.current.saving).toBe(false)
    })

    it('with no stored password, a password typed and erased again is undefined and the page is clean', async () => {
      const { result } = await renderActiveHook()
      expect(result.current.settings?.auth_password_set).toBe(false)
      stage(result, 'auth_password', TYPED_SECRET)
      expect(result.current.dirty).toBe(true)

      stage(result, 'auth_password', '')

      expect(result.current.staged.auth_password).toBeUndefined()
      expect(result.current.staged).toEqual(DEFAULT_STAGED)
      expect(result.current.dirty).toBe(false)
      expect(mockUpdateMcpSettings).not.toHaveBeenCalled()
    })

    it('with no stored password, an empty password staged over the untouched one leaves the page clean', async () => {
      const { result } = await renderActiveHook()

      stage(result, 'auth_password', '')

      expect(result.current.staged.auth_password).toBeUndefined()
      expect(result.current.dirty).toBe(false)
    })

    it('with no stored password, a Save sends no password after one was typed and erased again', async () => {
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')
      stage(result, 'auth_password', TYPED_SECRET)
      stage(result, 'auth_password', '')

      await requestSave(result)

      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ port: 9001 })
      expect('auth_password' in sentChange()).toBe(false)
    })

    it('with no stored password, a running endpoint asks no restart after a password was typed and erased again', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'until_restart', true)
      stage(result, 'auth_password', TYPED_SECRET)
      stage(result, 'auth_password', '')

      await requestSave(result)

      expect(result.current.confirmation).toBeUndefined()
      expect(mockUpdateMcpSettings).toHaveBeenCalledTimes(1)
      expect(sentChange()).toStrictEqual({ enabled: false, until_restart: true })
    })

    it('with no stored password, a typed password is still staged, asks the restart and is sent as typed', async () => {
      serveRunning()
      const { result } = await renderActiveHook()
      stage(result, 'auth_password', TYPED_SECRET)
      expect(result.current.staged.auth_password).toBe(TYPED_SECRET)

      await requestSave(result)
      expect(result.current.confirmation).toEqual({ restart: true, exposure: false })
      await confirmSave(result)

      expect(sentChange()).toStrictEqual({ auth_password: TYPED_SECRET })
    })

    it('once the stored password was removed by a Save, a password typed and erased again leaves the page clean', async () => {
      serveStoredSecret()
      mockUpdateMcpSettings.mockResolvedValue(REMOVED_SECRET_SETTINGS)
      const { result } = await renderActiveHook()
      stage(result, 'auth_password', '')
      await requestSave(result)
      expect(result.current.settings).toEqual(REMOVED_SECRET_SETTINGS)

      stage(result, 'auth_password', TYPED_SECRET)
      stage(result, 'auth_password', '')

      expect(result.current.staged.auth_password).toBeUndefined()
      expect(result.current.dirty).toBe(false)
    })
  })

  describe('Status polling', () => {
    it('polls status every 5 seconds while active', async () => {
      vi.useFakeTimers()

      const view = renderMcp(true)
      await flush()
      const statusCallsAfterLoad = mockFetchMcpStatus.mock.calls.length

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()
      expect(mockFetchMcpStatus.mock.calls.length).toBe(statusCallsAfterLoad + 1)

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()
      expect(mockFetchMcpStatus.mock.calls.length).toBe(statusCallsAfterLoad + 2)

      view.unmount()
    })

    it('a poll reads the status only, never the settings', async () => {
      vi.useFakeTimers()

      const view = renderMcp(true)
      await flush()

      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      await flush()

      expect(mockFetchMcpSettings).toHaveBeenCalledTimes(1)
      view.unmount()
    })

    it('keeps polling a dirty page and leaves its staged values alone', async () => {
      vi.useFakeTimers()

      const view = renderMcp(true)
      await flush()
      stage(view.result, 'port', '9001')
      const statusCallsAfterLoad = mockFetchMcpStatus.mock.calls.length
      mockFetchMcpStatus.mockResolvedValue(RUNNING_STATUS)

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()

      expect(mockFetchMcpStatus.mock.calls.length).toBe(statusCallsAfterLoad + 1)
      expect(view.result.current.status).toEqual(RUNNING_STATUS)
      expect(view.result.current.staged.port).toBe('9001')
      expect(view.result.current.dirty).toBe(true)
      view.unmount()
    })

    it('stops polling when the section deactivates', async () => {
      vi.useFakeTimers()

      const view = renderMcp(true)
      await flush()

      view.rerender({ active: false })
      const callsAtDeactivation = mockFetchMcpStatus.mock.calls.length

      await act(async () => {
        vi.advanceTimersByTime(20_000)
      })
      await flush()

      expect(mockFetchMcpStatus.mock.calls.length).toBe(callsAtDeactivation)
      view.unmount()
    })

    it('stops polling on unmount', async () => {
      vi.useFakeTimers()

      const view = renderMcp(true)
      await flush()

      view.unmount()
      const callsAtUnmount = mockFetchMcpStatus.mock.calls.length

      await act(async () => {
        vi.advanceTimersByTime(20_000)
      })

      expect(mockFetchMcpStatus.mock.calls.length).toBe(callsAtUnmount)
    })

    it('keeps the last known status when a poll fails and names the failure in statusError', async () => {
      vi.useFakeTimers()
      mockFetchMcpStatus.mockResolvedValueOnce(RUNNING_STATUS)
      mockFetchMcpStatus.mockRejectedValueOnce(new Error('poll failed'))

      const view = renderMcp(true)
      await flush()
      expect(view.result.current.status).toEqual(RUNNING_STATUS)

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()

      expect(view.result.current.status).toEqual(RUNNING_STATUS)
      expect(view.result.current.statusError).toBe('poll failed')
      expect(view.result.current.error).toBeUndefined()
      expect(view.result.current.readStatus).toBe('loaded')
      view.unmount()
    })

    it('falls back to the default message when a poll tick rejects with a non-Error', async () => {
      vi.useFakeTimers()
      mockFetchMcpStatus.mockResolvedValueOnce(DEFAULT_STATUS)
      mockFetchMcpStatus.mockRejectedValueOnce('boom')

      const view = renderMcp(true)
      await flush()

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()

      expect(view.result.current.statusError).toBe('Failed to read the MCP status')
      view.unmount()
    })

    it('drops the reported poll failure once a later tick succeeds', async () => {
      vi.useFakeTimers()
      mockFetchMcpStatus.mockResolvedValueOnce(DEFAULT_STATUS)
      mockFetchMcpStatus.mockRejectedValueOnce(new Error('poll failed'))
      mockFetchMcpStatus.mockResolvedValueOnce(DEFAULT_STATUS)

      const view = renderMcp(true)
      await flush()

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()
      expect(view.result.current.statusError).toBe('poll failed')

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()

      expect(view.result.current.statusError).toBeUndefined()
      view.unmount()
    })

    it('keeps a failed load reported even when a later poll tick succeeds', async () => {
      vi.useFakeTimers()
      mockFetchMcpSettings.mockRejectedValue(new Error('Network error'))

      const view = renderMcp(true)
      await flush()
      expect(view.result.current.error).toBe('Network error')

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()

      // A healthy status tick must not turn the failed load into a blank screen.
      expect(view.result.current.settings).toBeUndefined()
      expect(view.result.current.error).toBe('Network error')
      view.unmount()
    })

    it('stays failed after a healthy poll tick', async () => {
      vi.useFakeTimers()
      mockFetchMcpSettings.mockRejectedValue(new Error('Network error'))

      const view = renderMcp(true)
      await flush()

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()

      expect(view.result.current.readStatus).toBe('failed')
      view.unmount()
    })
  })

  describe('disconnectSession', () => {
    it('disconnects and refetches status immediately', async () => {
      const { result } = await renderActiveHook()
      const statusCallsAfterLoad = mockFetchMcpStatus.mock.calls.length

      await act(async () => {
        await result.current.disconnectSession('sess-1')
      })
      await flush()

      expect(mockDisconnectMcpSession).toHaveBeenCalledWith('sess-1')
      expect(mockFetchMcpStatus.mock.calls.length).toBeGreaterThanOrEqual(
        statusCallsAfterLoad + 1,
      )
      expect(toastError).not.toHaveBeenCalled()
    })

    it('on a failure shows "Could Not Disconnect Session" with the exact message', async () => {
      mockDisconnectMcpSession.mockRejectedValue(
        apiError("MCP session with ID 'ghost' not found", 404),
      )
      const { result } = await renderActiveHook()

      await act(async () => {
        await result.current.disconnectSession('ghost')
      })
      await flush()

      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith(
        "MCP session with ID 'ghost' not found",
        DISCONNECT_TITLE,
      )
    })

    it('reports "Request failed" when the disconnect rejection carries no reason', async () => {
      mockDisconnectMcpSession.mockRejectedValue({ code: 500 })
      const { result } = await renderActiveHook()

      await act(async () => {
        await result.current.disconnectSession('sess-1')
      })
      await flush()

      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith('Request failed', DISCONNECT_TITLE)
    })

    it('leaves the staged values alone when a disconnect fails', async () => {
      mockDisconnectMcpSession.mockRejectedValue(apiError('Disconnect failed', 500))
      const { result } = await renderActiveHook()
      stage(result, 'port', '9001')

      await act(async () => {
        await result.current.disconnectSession('sess-1')
      })
      await flush()

      expect(result.current.staged.port).toBe('9001')
      expect(result.current.dirty).toBe(true)
    })
  })
})
