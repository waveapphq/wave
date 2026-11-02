/**
 * Admin API Client Tests
 *
 * REQ-3.7.2.6: Log levels (DEBUG, INFO, WARN, ERROR, FATAL)
 * REQ-5.2.1.42: Settings and preferences screen
 *
 * Tests for admin API fetch and update functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import type { LogLevelApiResponse } from '@/features/settings/api/admin'
import {
  fetchLogLevel,
  setLogLevel,
  fetchMaskingSettings,
  setMaskingSettings,
} from '@/features/settings/api/admin'
import { LOG_LEVELS, type LogLevel } from '@/lib/log-levels'
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

const mockLogLevelResponse: LogLevelApiResponse = {
  level: 'INFO',
}

// ============================================================================
// Helper to create ApiError-like objects
// ============================================================================

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

describe('Admin API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchLogLevel', () => {
    it('fetches current log level successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockLogLevelResponse,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchLogLevel()

      expect(apiClient.get).toHaveBeenCalledWith('/admin/log-level', {
        rawResponse: true,
      })
      expect(result).toBe('INFO')
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        createMockApiError(500, 'Internal Server Error')
      )

      await expect(fetchLogLevel()).rejects.toThrow(
        'Failed to fetch log level: Internal Server Error'
      )
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        createMockApiError(503, 'Service Unavailable')
      )

      await expect(fetchLogLevel()).rejects.toThrow('Admin API service unavailable')
    })

    it('throws error on 403 forbidden (admin not allowed)', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        createMockApiError(403, 'Forbidden')
      )

      await expect(fetchLogLevel()).rejects.toThrow('Admin API is not enabled on this server')
    })

    it('calls the correct API endpoint', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockLogLevelResponse,
        meta: { requestId: '' },
        status: 200,
      })

      await fetchLogLevel()

      expect(apiClient.get).toHaveBeenCalledWith(
        '/admin/log-level',
        expect.any(Object)
      )
    })

    it('returns log level from response', async () => {
      const response: LogLevelApiResponse = { level: 'DEBUG' }
      vi.mocked(apiClient.get).mockResolvedValue({
        data: response,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchLogLevel()

      expect(result).toBe('DEBUG')
    })

    it('handles all valid log levels', async () => {
      for (const level of LOG_LEVELS) {
        const response: LogLevelApiResponse = { level }
        vi.mocked(apiClient.get).mockResolvedValue({
          data: response,
          meta: { requestId: '' },
          status: 200,
        })

        const result = await fetchLogLevel()
        expect(result).toBe(level)
      }
    })
  })

  describe('setLogLevel', () => {
    it('sets log level successfully', async () => {
      const newLevel: LogLevel = 'WARN'
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { level: newLevel },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await setLogLevel(newLevel)

      expect(apiClient.put).toHaveBeenCalledWith(
        '/admin/log-level',
        { level: newLevel },
        { rawResponse: true }
      )
      expect(result).toBe('WARN')
    })

    it('sends level in request body', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { level: 'ERROR' },
        meta: { requestId: '' },
        status: 200,
      })

      await setLogLevel('ERROR')

      expect(apiClient.put).toHaveBeenCalledWith(
        '/admin/log-level',
        { level: 'ERROR' },
        expect.any(Object)
      )
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        createMockApiError(500, 'Internal Server Error')
      )

      await expect(setLogLevel('DEBUG')).rejects.toThrow(
        'Failed to set log level: Internal Server Error'
      )
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        createMockApiError(503, 'Service Unavailable')
      )

      await expect(setLogLevel('INFO')).rejects.toThrow('Admin API service unavailable')
    })

    it('throws error on 403 forbidden (admin not allowed)', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        createMockApiError(403, 'Forbidden')
      )

      await expect(setLogLevel('WARN')).rejects.toThrow('Admin API is not enabled on this server')
    })

    it('throws error on 400 bad request (invalid level)', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        createMockApiError(400, 'Invalid log level: INVALID')
      )

      await expect(setLogLevel('INVALID' as LogLevel)).rejects.toThrow('Invalid log level: INVALID')
    })

    it('handles error response without detail field', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        createMockApiError(400, 'Bad Request')
      )

      await expect(setLogLevel('INVALID' as LogLevel)).rejects.toThrow(
        'Failed to set log level: Bad Request'
      )
    })

    it('propagates server error messages from backend detail', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        createMockApiError(500, 'Custom server error message')
      )

      await expect(setLogLevel('INFO')).rejects.toThrow('Custom server error message')
    })

    it('uses default message when 500 error has no detail', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        createMockApiError(500, 'Internal Server Error')
      )

      await expect(setLogLevel('INFO')).rejects.toThrow('Failed to set log level: Internal Server Error')
    })

    it('returns updated log level from response', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { level: 'FATAL' },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await setLogLevel('FATAL')

      expect(result).toBe('FATAL')
    })

    it('sets each valid log level', async () => {
      for (const level of LOG_LEVELS) {
        vi.mocked(apiClient.put).mockResolvedValue({
          data: { level },
          meta: { requestId: '' },
          status: 200,
        })

        const result = await setLogLevel(level)
        expect(result).toBe(level)

        expect(apiClient.put).toHaveBeenCalledWith(
          '/admin/log-level',
          { level },
          expect.any(Object)
        )
      }
    })
  })

  describe('Error Handling', () => {
    it('handles network errors on fetch', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'))

      await expect(fetchLogLevel()).rejects.toThrow('Network error')
    })

    it('handles network errors on set', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('Network error'))

      await expect(setLogLevel('INFO')).rejects.toThrow('Network error')
    })

    it('handles JSON parse errors on fetch', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Invalid JSON'))

      await expect(fetchLogLevel()).rejects.toThrow('Invalid JSON')
    })

    it('handles JSON parse errors on set', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('Invalid JSON'))

      await expect(setLogLevel('DEBUG')).rejects.toThrow('Invalid JSON')
    })

    it('handles 500 error with error message from backend detail', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        createMockApiError(500, 'Internal server error')
      )

      await expect(fetchLogLevel()).rejects.toThrow('Internal server error')
    })

    it('uses default message when error response has no detail', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        createMockApiError(500, 'Internal Server Error')
      )

      await expect(fetchLogLevel()).rejects.toThrow('Failed to fetch log level')
    })

    it('handles error with status but empty message', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error(''), { type: 'server', status: 500, isRetryable: false })
      )

      await expect(fetchLogLevel()).rejects.toThrow('Failed to fetch log level: Unknown error')
    })

    it('handles non-Error thrown values', async () => {
      vi.mocked(apiClient.get).mockRejectedValue('string error')

      await expect(fetchLogLevel()).rejects.toThrow('string error')
    })
  })

  describe('fetchMaskingSettings', () => {
    const mockMasking = {
      run_output: false,
      test_variables: true,
      shared_variables: false,
    }

    it('fetches the reveal flags successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockMasking,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchMaskingSettings()

      expect(apiClient.get).toHaveBeenCalledWith('/admin/secret-masking', {
        rawResponse: true,
      })
      expect(result).toEqual(mockMasking)
    })

    it('throws a mapped error on failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(createMockApiError(500, 'Internal Server Error'))

      await expect(fetchMaskingSettings()).rejects.toThrow(
        'Failed to fetch secret masking settings: Internal Server Error'
      )
    })
  })

  describe('setMaskingSettings', () => {
    const mockMasking = {
      run_output: true,
      test_variables: false,
      shared_variables: false,
    }

    it('sets a subset of the reveal flags successfully', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: mockMasking,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await setMaskingSettings({ run_output: true })

      expect(apiClient.put).toHaveBeenCalledWith(
        '/admin/secret-masking',
        { run_output: true },
        { rawResponse: true }
      )
      expect(result).toEqual(mockMasking)
    })

    it('throws a mapped error on failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(createMockApiError(500, 'Internal Server Error'))

      await expect(setMaskingSettings({ run_output: true })).rejects.toThrow(
        'Failed to set secret masking settings: Internal Server Error'
      )
    })
  })
})
