/**
 * Workbench API Client Tests - V-CANVAS-14 / REQ-3.2.1.1
 *
 * Tests for the Workbench ephemeral execution API client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost:8000'),
}))

vi.mock('@/lib/download-file', () => ({
  downloadFromUrl: vi.fn(),
}))

import { apiClient, getApiBaseUrl } from '@/lib/api'
import { downloadFromUrl } from '@/lib/download-file'
import { workbenchApi } from '@/features/workbench/api/workbench'

describe('Workbench API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('startRun', () => {
    it('sends POST request with correct parameters', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-123',
          status: 'running',
          websocket_topic: 'workbench:session-123',
          warnings: [],
        },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.startRun({
        test_id: 'test-123',
        environment_id: 'env-456',
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/workbench/run',
        {
          test_id: 'test-123',
          environment_id: 'env-456',
        }
      )
      expect(result.session_id).toBe('session-123')
    })

    it('throws error on non-ok response', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error("Test 'test-123' not found"), {
          type: 'not_found',
          status: 404,
          code: 'NOT_FOUND',
          isRetryable: false,
        })
      )

      await expect(
        workbenchApi.startRun({
          test_id: 'test-123',
          environment_id: 'env-456',
        })
      ).rejects.toThrow("Test 'test-123' not found")
    })

    it('propagates apiClient errors with status and code', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(
        workbenchApi.startRun({
          test_id: 'test-123',
          environment_id: 'env-456',
        })
      ).rejects.toThrow('Internal Server Error')
    })
  })

  describe('stopRun', () => {
    it('sends POST request to stop endpoint', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-123',
          status: 'stopped',
        },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.stopRun('session-123')

      expect(apiClient.post).toHaveBeenCalledWith(
        '/workbench/session-123/stop'
      )
      expect(result.status).toBe('stopped')
    })

    it('throws error on failure', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Session not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(workbenchApi.stopRun('invalid-session')).rejects.toThrow(
        'Session not found'
      )
    })

    it('propagates server errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(workbenchApi.stopRun('session-123')).rejects.toThrow(
        'Internal Server Error'
      )
    })
  })

  describe('getStatus', () => {
    it('returns status for existing session', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          session_id: 'session-123',
          status: 'running',
          current_block: { block_id: 'b1', block_name: 'Test Block' },
          progress: { current: 5, total: 10, percentage: 50 },
        },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.getStatus('session-123')

      expect(apiClient.get).toHaveBeenCalledWith(
        '/workbench/session-123/status'
      )
      expect(result?.status).toBe('running')
      expect(result?.progress?.percentage).toBe(50)
    })

    it('returns null for 404 response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Session not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      const result = await workbenchApi.getStatus('expired-session')

      expect(result).toBeNull()
    })

    it('throws error on non-404 failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Database error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(workbenchApi.getStatus('session-123')).rejects.toThrow(
        'Database error'
      )
    })

    it('throws error on non-404 client error', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(workbenchApi.getStatus('session-123')).rejects.toThrow(
        'Internal Server Error'
      )
    })
  })

  describe('getCurrentSession', () => {
    it('returns session data when session exists', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          session_id: 'recovered-session',
          status: 'running',
          test_id: 'test-123',
          websocket_topic: 'workbench:recovered-session',
          current_block: { block_id: 'b1', block_name: 'Block 1' },
          progress: { current: 3, total: 10, percentage: 30 },
        },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.getCurrentSession()

      expect(apiClient.get).toHaveBeenCalledWith('/workbench/session')
      expect(result?.session_id).toBe('recovered-session')
      expect(result?.status).toBe('running')
      expect(result?.test_id).toBe('test-123')
    })

    it('returns null when no session exists for user', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: null,
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.getCurrentSession()

      expect(result).toBeNull()
    })

    it('returns session data for terminal states (passed, failed, stopped)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          session_id: 'terminal-session',
          status: 'failed',
          test_id: 'test-123',
          websocket_topic: 'workbench:terminal-session',
          error: 'Connection timeout',
          current_block: { block_id: 'b2', block_name: 'SSH Connect' },
          progress: { current: 2, total: 5, percentage: 40 },
        },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.getCurrentSession()

      expect(result?.status).toBe('failed')
      expect(result?.error).toBe('Connection timeout')
    })

    it('throws error on non-ok response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Database connection failed'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(workbenchApi.getCurrentSession()).rejects.toThrow(
        'Database connection failed'
      )
    })

    it('propagates server errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(workbenchApi.getCurrentSession()).rejects.toThrow(
        'Internal Server Error'
      )
    })
  })

  describe('updateSkippedNodes', () => {
    it('sends POST request to skip endpoint with node IDs', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-123',
          skipped_node_ids: ['node-a', 'node-b'],
        },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.updateSkippedNodes('session-123', {
        skipped_node_ids: ['node-a', 'node-b'],
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/workbench/session-123/skip',
        { skipped_node_ids: ['node-a', 'node-b'] }
      )
      expect(result.session_id).toBe('session-123')
      expect(result.skipped_node_ids).toEqual(['node-a', 'node-b'])
    })

    it('throws error when session not found', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Session not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(
        workbenchApi.updateSkippedNodes('invalid-session', {
          skipped_node_ids: ['node-a'],
        })
      ).rejects.toThrow('Session not found')
    })
  })

  describe('clearSession', () => {
    it('sends DELETE request to session endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: { cleared: true },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.clearSession()

      expect(apiClient.delete).toHaveBeenCalledWith('/workbench/session')
      expect(result.cleared).toBe(true)
    })

    it('succeeds when no session exists (idempotent)', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: { cleared: false },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.clearSession()

      expect(result.cleared).toBe(false)
    })

    it('throws error on non-ok response', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Server error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(workbenchApi.clearSession()).rejects.toThrow('Server error')
    })

    it('propagates server errors', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(workbenchApi.clearSession()).rejects.toThrow(
        'Internal Server Error'
      )
    })
  })

  describe('getRunningSession', () => {
    it('returns { testName } when the current session is running', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          session_id: 's-1',
          status: 'running',
          test_name: 'Live Test',
        },
        meta: { requestId: '' },
        status: 200,
      })
      const result = await workbenchApi.getRunningSession()
      expect(result).toEqual({ testName: 'Live Test' })
    })

    it('returns { testName: null } when the running session has no test_name', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { session_id: 's-2', status: 'paused' },
        meta: { requestId: '' },
        status: 200,
      })
      const result = await workbenchApi.getRunningSession()
      expect(result).toEqual({ testName: null })
    })

    it('returns null for terminal status', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { session_id: 's-3', status: 'passed', test_name: 'Done' },
        meta: { requestId: '' },
        status: 200,
      })
      expect(await workbenchApi.getRunningSession()).toBeNull()
    })

    it('returns null when there is no session at all', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 200,
      })
      expect(await workbenchApi.getRunningSession()).toBeNull()
    })

    it('propagates a failed session read to the caller', async () => {
      const boom = new Error('boom')
      vi.mocked(apiClient.get).mockRejectedValue(boom)
      await expect(workbenchApi.getRunningSession()).rejects.toBe(boom)
    })
  })

  describe('getSessionVariables', () => {
    it('sends GET request without a names filter and unwraps variables', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          variables: {
            items: { value: ['a', 'b'], type: 'array' },
          },
        },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.getSessionVariables('session-123')

      expect(apiClient.get).toHaveBeenCalledWith('/workbench/session-123/variables')
      expect(result).toEqual({ items: { value: ['a', 'b'], type: 'array' } })
    })

    it('sends the names CSV query, URI-encoding each name', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { variables: {} },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      await workbenchApi.getSessionVariables('session-123', ['alpha', 'b&c'])

      expect(apiClient.get).toHaveBeenCalledWith(
        '/workbench/session-123/variables?names=alpha,b%26c'
      )
    })

    it('omits the query for an empty names array', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { variables: {} },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      await workbenchApi.getSessionVariables('session-123', [])

      expect(apiClient.get).toHaveBeenCalledWith('/workbench/session-123/variables')
    })

    it('throws error on failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error("Workbench session 'session-123' not found"), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(workbenchApi.getSessionVariables('session-123')).rejects.toThrow(
        "Workbench session 'session-123' not found"
      )
    })
  })

  describe('listSessionArtifacts', () => {
    it('fetches the bare items body via rawResponse', async () => {
      const items = [
        { path: 'output/data.json', size_bytes: 2048, created_at: '2026-07-02T10:00:00+00:00' },
      ]
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { items },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.listSessionArtifacts()

      expect(apiClient.get).toHaveBeenCalledWith('/workbench/session/artifacts', {
        rawResponse: true,
      })
      expect(result.items).toEqual(items)
    })

    it('propagates the 404 no-active-session error', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('No active workbench session'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(workbenchApi.listSessionArtifacts()).rejects.toThrow(
        'No active workbench session'
      )
    })
  })

  describe('deleteSessionArtifact', () => {
    it('sends DELETE with the nested path segments preserved', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: null,
        meta: { requestId: 'test-req-id' },
        status: 204,
      })

      await workbenchApi.deleteSessionArtifact('output/data.json')

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/workbench/session/artifacts/output/data.json'
      )
    })

    it('percent-encodes each path segment', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: null,
        meta: { requestId: 'test-req-id' },
        status: 204,
      })

      await workbenchApi.deleteSessionArtifact('out put/da ta.json')

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/workbench/session/artifacts/out%20put/da%20ta.json'
      )
    })

    it('propagates delete errors', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Session artifact missing.txt not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(workbenchApi.deleteSessionArtifact('missing.txt')).rejects.toThrow(
        'Session artifact missing.txt not found'
      )
    })
  })

  describe('downloadSessionArtifact', () => {
    beforeEach(() => {
      vi.mocked(getApiBaseUrl).mockReturnValue('http://localhost:8000')
    })

    it('downloads a nested artifact under its own filename', async () => {
      vi.mocked(downloadFromUrl).mockResolvedValue(undefined)

      await workbenchApi.downloadSessionArtifact('output/data.json')

      expect(downloadFromUrl).toHaveBeenCalledWith(
        'http://localhost:8000/workbench/session/artifacts/content/output/data.json',
        'data.json'
      )
    })

    it('downloads a root-level artifact under its full name', async () => {
      vi.mocked(downloadFromUrl).mockResolvedValue(undefined)

      await workbenchApi.downloadSessionArtifact('report.json')

      expect(downloadFromUrl).toHaveBeenCalledWith(
        'http://localhost:8000/workbench/session/artifacts/content/report.json',
        'report.json'
      )
    })
  })

  describe('repeatStep', () => {
    it('POSTs the repeat-step path with no body when nothing is substituted', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-plain',
          status: 'paused',
          repeated_node_id: 'python-1',
        },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      await workbenchApi.repeatStep('session-plain')

      expect(apiClient.post).toHaveBeenCalledWith('/workbench/session-plain/repeat-step')
      expect(vi.mocked(apiClient.post).mock.calls[0]).toHaveLength(1)
    })

    it('POSTs an override body when one parameter value is substituted', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-override',
          status: 'paused',
          repeated_node_id: 'python-1',
        },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await workbenchApi.repeatStep('session-override', {
        override: { node_id: 'python-1', parameter: 'script', value: 'print("draft")' },
      })

      expect(apiClient.post).toHaveBeenCalledWith('/workbench/session-override/repeat-step', {
        override: { node_id: 'python-1', parameter: 'script', value: 'print("draft")' },
      })
      expect(result.repeated_node_id).toBe('python-1')
    })

    it('carries a non-string override value verbatim', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-typed',
          status: 'paused',
          repeated_node_id: 'shell-2',
        },
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      await workbenchApi.repeatStep('session-typed', {
        override: { node_id: 'shell-2', parameter: 'timeout', value: 45 },
      })

      const [, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(body).toEqual({
        override: { node_id: 'shell-2', parameter: 'timeout', value: 45 },
      })
    })

    it('propagates a rejected repeat-step request', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Session is not paused'), {
          type: 'client',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(
        workbenchApi.repeatStep('session-idle', {
          override: { node_id: 'python-1', parameter: 'script', value: 'print(1)' },
        })
      ).rejects.toThrow('Session is not paused')
    })
  })
})
