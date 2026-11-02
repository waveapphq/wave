/**
 * WAVE Server Sessions API Client Tests
 *
 * REQ-5.2.7.15: server status facts and browser-session roster / disconnect
 * endpoints. The client returns plain endpoint payloads (rawResponse) and
 * propagates apiClient errors unchanged (these endpoints are not admin-gated).
 *
 * Module under test: frontend/src/features/settings/api/sessions.ts
 */

import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest'

import type { ServerStatus } from '@/features/settings/api/sessions'
import {
  fetchServerStatus,
  disconnectSession,
  disconnectOthers,
  disconnectAll,
} from '@/features/settings/api/sessions'
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
// Mock Data
// ============================================================================

const mockStatus: ServerStatus = {
  frontend: { running: true, urls: ['http://localhost:3000'], port: 3000, bind: 'local' },
  backend: { running: true, urls: ['http://localhost:8000'], port: 8000, bind: 'local' },
  session_count: 1,
  sessions: [
    {
      session_id: 'sess-1',
      client: 'Chrome (macOS)',
      ip: '127.0.0.1',
      connected_at: '2026-07-16T14:00:02Z',
      last_activity: '2026-07-16T14:02:31Z',
    },
  ],
  active_session_id: null,
  watching_session_ids: [],
  data_folder: '/srv/wave/data',
  config_file: '/srv/wave/config/config.yaml',
}

function createMockApiError(status: number, message: string) {
  return Object.assign(new Error(message), {
    type: 'server',
    status,
    isRetryable: false,
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('WAVE Server Sessions API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchServerStatus', () => {
    it('fetches status from GET /server/status', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockStatus,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchServerStatus()

      expect(apiClient.get).toHaveBeenCalledWith('/server/status', { rawResponse: true })
      expect(result).toEqual(mockStatus)
      expect(result.sessions[0].session_id).toBe('sess-1')
      expect(result.backend.running).toBe(true)
    })

    it('carries the absolute data folder path (REQ-5.2.1.42)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockStatus,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchServerStatus()

      expectTypeOf(result.data_folder).toEqualTypeOf<string>()
      expect(result.data_folder).toBe('/srv/wave/data')
    })

    it('carries the absolute config file path (REQ-4.7.15)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockStatus,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchServerStatus()

      expectTypeOf<ServerStatus>().toHaveProperty('config_file').toEqualTypeOf<string>()
      expectTypeOf(result.config_file).toEqualTypeOf<string>()
      expect(result.config_file).toBe('/srv/wave/config/config.yaml')
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = createMockApiError(503, 'Service Unavailable')
      vi.mocked(apiClient.get).mockRejectedValue(apiError)

      await expect(fetchServerStatus()).rejects.toBe(apiError)
    })
  })

  describe('disconnectSession', () => {
    it('sends DELETE for the session by id', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 204,
      })

      await expect(disconnectSession('sess-1')).resolves.toBeUndefined()

      expect(apiClient.delete).toHaveBeenCalledWith('/server/sessions/sess-1', undefined, {
        rawResponse: true,
      })
    })
  })

  describe('disconnectOthers', () => {
    it('POSTs the requester session id to disconnect-others', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { disconnected: 2 },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await disconnectOthers('me')

      expect(apiClient.post).toHaveBeenCalledWith(
        '/server/sessions/disconnect-others',
        { requester_session_id: 'me' },
        { rawResponse: true },
      )
      expect(result).toEqual({ disconnected: 2 })
    })
  })

  describe('disconnectAll', () => {
    it('POSTs an empty body to disconnect-all', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { disconnected: 3 },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await disconnectAll()

      expect(apiClient.post).toHaveBeenCalledWith(
        '/server/sessions/disconnect-all',
        {},
        { rawResponse: true },
      )
      expect(result).toEqual({ disconnected: 3 })
    })
  })
})
