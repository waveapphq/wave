/**
 * Proxy API client (REQ-4.7.14, REQ-3.4.2.10).
 *
 * Module: frontend/src/features/settings/api/proxy.ts
 *
 * Plain payloads (rawResponse) and apiClient errors propagate unchanged, like
 * the SSH Hosts client. A save is one PATCH; the check writes nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import type {
  BlockRef,
  ProxyBlocks,
  ProxyEntry,
  ProxyProblem,
  ProxyProblems,
  ProxySettings,
  ProxySettingsUpdate,
} from '@/features/settings/api/proxy'
import {
  fetchProxyBlocks,
  fetchProxySettings,
  updateProxySettings,
  validateProxySettings,
} from '@/features/settings/api/proxy'
import { apiClient } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getConfig: vi.fn(() => ({ baseUrl: 'http://localhost:8000' })),
  },
  getApiBaseUrl: vi.fn(() => 'http://localhost:8000'),
}))

// ============================================================================
// Fixtures
// ============================================================================

const ENTRIES: ProxyEntry[] = [
  { kind: 'exact', address: 'https://registry.lab.internal' },
  { kind: 'regex', address: '\\.svc\\.cluster\\.local$' },
]

const SETTINGS: ProxySettings = {
  enabled: true,
  source: 'custom',
  host: 'proxy.lab.internal',
  port: 3128,
  username: 'wave',
  password_set: true,
  list_mode: 'except',
  entries: ENTRIES,
  proxy_local_addresses: false,
  host_values: {
    https_proxy: 'http://wave:********@proxy.corp.example:3128',
    http_proxy: null,
    no_proxy: 'localhost,.lab.internal',
  },
}

/** What a fresh install answers: off, with the defaults. */
const FRESH_SETTINGS: ProxySettings = {
  enabled: false,
  source: 'host',
  host: '',
  port: null,
  username: '',
  password_set: false,
  list_mode: 'except',
  entries: [],
  proxy_local_addresses: false,
  host_values: { https_proxy: null, http_proxy: null, no_proxy: null },
}

const PORT_PROBLEM: ProxyProblem = {
  field: 'port',
  row: null,
  message: 'Port must be a whole number from 1 to 65535',
}

const ROW_PROBLEM: ProxyProblem = {
  field: 'entries',
  row: 3,
  message: 'The same address as entry 1',
}

const LIST_PROBLEM: ProxyProblem = {
  field: 'entries',
  row: null,
  message: 'Add at least one address, or choose "All addresses except the list"',
}

const HTTP_BLOCK: BlockRef = { id: 'http-client', name: 'HTTP Client', category: 'network' }
const HELM_INSTALL_BLOCK: BlockRef = { id: 'helm-install', name: 'Helm Install', category: 'helm' }
const SHELL_EXEC_BLOCK: BlockRef = { id: 'shell-exec', name: 'Shell Exec', category: 'system' }
const PING_BLOCK: BlockRef = { id: 'ping', name: 'Ping', category: 'network' }

const BLOCKS: ProxyBlocks = {
  supported: [HTTP_BLOCK, HELM_INSTALL_BLOCK],
  unsupported: [SHELL_EXEC_BLOCK],
  not_applicable: [PING_BLOCK],
}

const READ_ONLY_CONFIG =
  'Settings cannot be saved: the config file /srv/wave/config/config.yaml is read-only'

function envelope<T>(data: T) {
  return { data, meta: { requestId: '' }, status: 200 }
}

function createMockApiError(status: number, message: string) {
  return Object.assign(new Error(message), {
    type: 'server',
    status,
    isRetryable: false,
  })
}

function patchedBody(): Record<string, unknown> {
  return vi.mocked(apiClient.patch).mock.calls[0][1] as Record<string, unknown>
}

function postedBody(): Record<string, unknown> {
  return vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>
}

// ============================================================================
// Tests
// ============================================================================

describe('Proxy API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchProxySettings', () => {
    it('reads the settings from GET /network/proxy', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(envelope(SETTINGS))

      const result: ProxySettings = await fetchProxySettings()

      expect(apiClient.get).toHaveBeenCalledTimes(1)
      expect(apiClient.get).toHaveBeenCalledWith('/network/proxy', { rawResponse: true })
      expect(result).toEqual(SETTINGS)
    })

    it('resolves the fresh-install answer as it is, with the empty port as null', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(envelope(FRESH_SETTINGS))

      const result = await fetchProxySettings()

      expect(result).toStrictEqual(FRESH_SETTINGS)
      expect(result.port).toBeNull()
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = createMockApiError(503, 'Service Unavailable')
      vi.mocked(apiClient.get).mockRejectedValue(apiError)

      await expect(fetchProxySettings()).rejects.toBe(apiError)
    })
  })

  describe('updateProxySettings', () => {
    it('PATCHes the given change to /network/proxy and resolves the saved settings', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue(envelope(SETTINGS))
      const update: ProxySettingsUpdate = {
        enabled: true,
        source: 'custom',
        host: 'proxy.lab.internal',
        port: 3128,
        username: 'wave',
        password: 's3cret-pass',
        list_mode: 'except',
        entries: ENTRIES,
        proxy_local_addresses: false,
      }

      const result: ProxySettings = await updateProxySettings(update)

      expect(apiClient.patch).toHaveBeenCalledTimes(1)
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/network/proxy',
        {
          enabled: true,
          source: 'custom',
          host: 'proxy.lab.internal',
          port: 3128,
          username: 'wave',
          password: 's3cret-pass',
          list_mode: 'except',
          entries: ENTRIES,
          proxy_local_addresses: false,
        },
        { rawResponse: true },
      )
      expect(result).toEqual(SETTINGS)
    })

    it('writes with PATCH only, never PUT or POST', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue(envelope(SETTINGS))

      await updateProxySettings({ enabled: false })

      expect(apiClient.patch).toHaveBeenCalledTimes(1)
      expect(apiClient.put).not.toHaveBeenCalled()
      expect(apiClient.post).not.toHaveBeenCalled()
      expect(apiClient.get).not.toHaveBeenCalled()
    })

    it('sends a one-field change with that key alone', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue(envelope(SETTINGS))

      await updateProxySettings({ host: 'proxy-b.lab.internal' })

      expect(patchedBody()).toStrictEqual({ host: 'proxy-b.lab.internal' })
      expect('password' in patchedBody()).toBe(false)
    })

    it('passes an empty password through as given, so the stored one is removed', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue(envelope({ ...SETTINGS, password_set: false }))

      const result = await updateProxySettings({ password: '' })

      expect(patchedBody()).toStrictEqual({ password: '' })
      expect(result.password_set).toBe(false)
    })

    it('passes an emptied port through as null', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue(envelope({ ...SETTINGS, port: null }))

      await updateProxySettings({ port: null })

      expect(patchedBody()).toStrictEqual({ port: null })
    })

    it('passes the whole entry list through as given, an empty list included', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue(envelope({ ...SETTINGS, entries: [] }))

      await updateProxySettings({ entries: [] })

      expect(patchedBody()).toStrictEqual({ entries: [] })
    })

    it('propagates the refused value (400) unchanged', async () => {
      const apiError = createMockApiError(400, 'Port must be a whole number from 1 to 65535')
      vi.mocked(apiClient.patch).mockRejectedValue(apiError)

      await expect(updateProxySettings({ port: 70000 })).rejects.toBe(apiError)
      await expect(updateProxySettings({ port: 70000 })).rejects.toThrow(
        /^Port must be a whole number from 1 to 65535$/,
      )
    })

    it('propagates the refused list entry (400) unchanged', async () => {
      const apiError = createMockApiError(400, 'Entry 3: The same address as entry 1')
      vi.mocked(apiClient.patch).mockRejectedValue(apiError)

      await expect(
        updateProxySettings({ entries: [...ENTRIES, { kind: 'exact', address: ENTRIES[0].address }] }),
      ).rejects.toBe(apiError)
    })

    it('propagates the config write refusal (500) unchanged', async () => {
      const apiError = createMockApiError(500, READ_ONLY_CONFIG)
      vi.mocked(apiClient.patch).mockRejectedValue(apiError)

      await expect(updateProxySettings({ enabled: true })).rejects.toBe(apiError)
    })
  })

  describe('validateProxySettings', () => {
    it('POSTs the staged change to /network/proxy/validate and resolves every problem', async () => {
      const answer: ProxyProblems = { problems: [PORT_PROBLEM, ROW_PROBLEM] }
      vi.mocked(apiClient.post).mockResolvedValue(envelope(answer))
      const update: ProxySettingsUpdate = {
        port: 70000,
        entries: [...ENTRIES, { kind: 'exact', address: ENTRIES[0].address }],
      }

      const result: ProxyProblems = await validateProxySettings(update)

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      expect(apiClient.post).toHaveBeenCalledWith(
        '/network/proxy/validate',
        {
          port: 70000,
          entries: [...ENTRIES, { kind: 'exact', address: ENTRIES[0].address }],
        },
        { rawResponse: true },
      )
      expect(result).toEqual(answer)
      expect(result.problems).toEqual([PORT_PROBLEM, ROW_PROBLEM])
    })

    it('asks with POST only and writes nothing', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(envelope({ problems: [] }))

      await validateProxySettings({ host: 'proxy-b.lab.internal' })

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      expect(apiClient.patch).not.toHaveBeenCalled()
      expect(apiClient.put).not.toHaveBeenCalled()
    })

    it('sends the body exactly as given: the changed keys alone', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(envelope({ problems: [] }))

      await validateProxySettings({ password: '' })

      expect(postedBody()).toStrictEqual({ password: '' })
    })

    it('resolves an answer with no problems', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(envelope({ problems: [] }))

      const result = await validateProxySettings({ host: 'proxy-b.lab.internal' })

      expect(result).toStrictEqual({ problems: [] })
    })

    it('resolves a problem of the whole list with its null row', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(envelope({ problems: [LIST_PROBLEM] }))

      const result = await validateProxySettings({ list_mode: 'only', entries: [] })

      expect(result.problems).toStrictEqual([
        {
          field: 'entries',
          row: null,
          message: 'Add at least one address, or choose "All addresses except the list"',
        },
      ])
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = new TypeError('Failed to fetch')
      vi.mocked(apiClient.post).mockRejectedValue(apiError)

      await expect(validateProxySettings({ port: 8080 })).rejects.toBe(apiError)
    })
  })

  describe('fetchProxyBlocks', () => {
    it('reads the three block lists from GET /network/proxy/blocks', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(envelope(BLOCKS))

      const result: ProxyBlocks = await fetchProxyBlocks()

      expect(apiClient.get).toHaveBeenCalledTimes(1)
      expect(apiClient.get).toHaveBeenCalledWith('/network/proxy/blocks', { rawResponse: true })
      expect(result).toEqual(BLOCKS)
      expect(result.supported).toEqual([HTTP_BLOCK, HELM_INSTALL_BLOCK])
      expect(result.unsupported).toEqual([SHELL_EXEC_BLOCK])
      expect(result.not_applicable).toEqual([PING_BLOCK])
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = createMockApiError(503, 'Service Unavailable')
      vi.mocked(apiClient.get).mockRejectedValue(apiError)

      await expect(fetchProxyBlocks()).rejects.toBe(apiError)
    })
  })
})
