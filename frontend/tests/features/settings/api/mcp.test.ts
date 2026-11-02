/**
 * MCP API Client Tests
 *
 * REQ-5.2.7.1, REQ-5.2.7.14: MCP server settings, status, and session
 * management endpoints.
 *
 * The client returns the plain endpoint payloads (rawResponse) and
 * propagates apiClient errors unchanged (no admin-style error mapping -
 * these endpoints are not admin-gated).
 *
 * Module under test: frontend/src/features/settings/api/mcp.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import type { McpSettings, McpStatus } from '@/features/settings/api/mcp'
import {
  fetchMcpSettings,
  updateMcpSettings,
  fetchMcpStatus,
  disconnectMcpSession,
} from '@/features/settings/api/mcp'
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

const mockSettings: McpSettings = {
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

const mockStatus: McpStatus = {
  running: true,
  enabled: true,
  until_restart_active: false,
  port: 8765,
  bind: 'local',
  urls: ['http://127.0.0.1:8765/mcp'],
  connected_clients: 1,
  sessions: [
    {
      session_id: 'sess-1',
      client: 'claude-code',
      client_version: '2.1.0',
      ip: '127.0.0.1',
      connected_at: '2026-07-16T14:00:02Z',
      last_activity: '2026-07-16T14:02:31Z',
    },
  ],
  recent_activity: [
    { timestamp: '2026-07-16T14:02:31Z', client: 'claude-code', tool: 'start_execution' },
  ],
  last_error: null,
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

describe('MCP API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchMcpSettings', () => {
    it('fetches settings from GET /mcp/settings', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockSettings,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchMcpSettings()

      expect(apiClient.get).toHaveBeenCalledWith('/mcp/settings', { rawResponse: true })
      expect(result).toEqual(mockSettings)
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = createMockApiError(500, 'Internal Server Error')
      vi.mocked(apiClient.get).mockRejectedValue(apiError)

      await expect(fetchMcpSettings()).rejects.toBe(apiError)
    })
  })

  describe('updateMcpSettings', () => {
    it('PUTs the partial update to /mcp/settings', async () => {
      const updated = { ...mockSettings, port: 9001 }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: updated,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateMcpSettings({ port: 9001 })

      expect(apiClient.put).toHaveBeenCalledWith(
        '/mcp/settings',
        { port: 9001 },
        { rawResponse: true },
      )
      expect(result).toEqual(updated)
    })

    it('sends the write-only password only when provided', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { ...mockSettings, auth_enabled: true, auth_password_set: true },
        meta: { requestId: '' },
        status: 200,
      })

      await updateMcpSettings({
        auth_enabled: true,
        auth_username: 'ops',
        auth_password: 'hunter2-secret',
      })

      expect(apiClient.put).toHaveBeenCalledWith(
        '/mcp/settings',
        { auth_enabled: true, auth_username: 'ops', auth_password: 'hunter2-secret' },
        { rawResponse: true },
      )
    })

    it('supports the until_restart runtime flag', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { ...mockSettings, until_restart_active: true, running: true },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateMcpSettings({ until_restart: true })

      expect(apiClient.put).toHaveBeenCalledWith(
        '/mcp/settings',
        { until_restart: true },
        { rawResponse: true },
      )
      expect(result.until_restart_active).toBe(true)
    })

    it('propagates validation errors unchanged (exact backend message)', async () => {
      const apiError = createMockApiError(
        400,
        'Port must be an integer between 1024 and 65535',
      )
      vi.mocked(apiClient.put).mockRejectedValue(apiError)

      await expect(updateMcpSettings({ port: 80 })).rejects.toBe(apiError)
      await expect(updateMcpSettings({ port: 80 })).rejects.toThrow(
        'Port must be an integer between 1024 and 65535',
      )
    })
  })

  describe('fetchMcpStatus', () => {
    it('fetches status from GET /mcp/status', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockStatus,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchMcpStatus()

      expect(apiClient.get).toHaveBeenCalledWith('/mcp/status', { rawResponse: true })
      expect(result).toEqual(mockStatus)
      expect(result.sessions[0].session_id).toBe('sess-1')
      expect(result.recent_activity[0].tool).toBe('start_execution')
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = createMockApiError(503, 'Service Unavailable')
      vi.mocked(apiClient.get).mockRejectedValue(apiError)

      await expect(fetchMcpStatus()).rejects.toBe(apiError)
    })
  })

  describe('disconnectMcpSession', () => {
    it('sends DELETE for the session by id', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 204,
      })

      await expect(disconnectMcpSession('sess-1')).resolves.toBeUndefined()

      expect(apiClient.delete).toHaveBeenCalledWith('/mcp/sessions/sess-1', undefined, {
        rawResponse: true,
      })
    })

    it('propagates the 404 unknown-session error unchanged', async () => {
      const apiError = createMockApiError(404, "MCP session with ID 'ghost' not found")
      vi.mocked(apiClient.delete).mockRejectedValue(apiError)

      await expect(disconnectMcpSession('ghost')).rejects.toBe(apiError)
      await expect(disconnectMcpSession('ghost')).rejects.toThrow(
        "MCP session with ID 'ghost' not found",
      )
    })
  })
})
