/**
 * System Info API Client Tests
 *
 * REQ-5.2.1.42: Settings and preferences screen - About section
 * SETTINGS-16: About: version, build, support links
 *
 * Tests for system info API fetch and transformation functions.
 */

import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest'

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

import { apiClient } from '@/lib/api'

import type { SystemInfo, SystemInfoApiResponse } from '@/features/settings/api/system-info'

import {
  fetchSystemInfo,
  transformSystemInfoResponse,
} from '@/features/settings/api/system-info'

// ============================================================================
// Mock Data
// ============================================================================

const mockSystemInfoApiResponse: SystemInfoApiResponse = {
  version: '1.2.3',
  build: 'a1b2c3d4',
  build_date: '2025-01-15T10:00:00Z',
  support: {
    documentation_url: 'https://docs.example.com',
    issues_url: 'https://github.com/example/wave/issues',
    contact_email: 'support@example.com',
  },
  runtime: {
    python_version: '3.12.1',
    os: 'Linux',
    os_version: '5.15.0-160-generic',
  },
}

/** Carries a key the type does not declare, to prove the transform drops it. */
const withStrayEnvironment = {
  ...mockSystemInfoApiResponse,
  environment: 'production',
} as SystemInfoApiResponse

function mockSuccessResponse(data: SystemInfoApiResponse = mockSystemInfoApiResponse) {
  vi.mocked(apiClient.get).mockResolvedValue({
    data,
    meta: { requestId: 'test-req-id' },
    status: 200,
  })
}

function mockErrorResponse(status: number, message: string, type: string = 'server') {
  vi.mocked(apiClient.get).mockRejectedValue(
    Object.assign(new Error(message), {
      type,
      status,
      isRetryable: status >= 500,
    })
  )
}

// ============================================================================
// Tests
// ============================================================================

describe('System Info API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('transformSystemInfoResponse', () => {
    it('transforms API response to frontend model', () => {
      const result = transformSystemInfoResponse(mockSystemInfoApiResponse)

      expect(result.version).toBe('1.2.3')
      expect(result.build).toBe('a1b2c3d4')
      expect(result.buildDate).toBe('2025-01-15T10:00:00Z')
    })

    it('transforms support links correctly', () => {
      const result = transformSystemInfoResponse(mockSystemInfoApiResponse)

      expect(result.support.documentationUrl).toBe('https://docs.example.com')
      expect(result.support.issuesUrl).toBe('https://github.com/example/wave/issues')
      expect(result.support.contactEmail).toBe('support@example.com')
    })

    it('transforms runtime info correctly', () => {
      const result = transformSystemInfoResponse(mockSystemInfoApiResponse)

      expect(result.runtime.pythonVersion).toBe('3.12.1')
      expect(result.runtime.os).toBe('Linux')
      expect(result.runtime.osVersion).toBe('5.15.0-160-generic')
    })

    it('handles missing support object', () => {
      const apiResponse: SystemInfoApiResponse = {
        ...mockSystemInfoApiResponse,
        support: undefined,
      } as SystemInfoApiResponse

      const result = transformSystemInfoResponse(apiResponse)

      expect(result.support.documentationUrl).toBeNull()
      expect(result.support.issuesUrl).toBeNull()
      expect(result.support.contactEmail).toBeNull()
    })

    it('handles missing runtime object', () => {
      const apiResponse: SystemInfoApiResponse = {
        ...mockSystemInfoApiResponse,
        runtime: undefined,
      } as SystemInfoApiResponse

      const result = transformSystemInfoResponse(apiResponse)

      expect(result.runtime.pythonVersion).toBeNull()
      expect(result.runtime.os).toBeNull()
      expect(result.runtime.osVersion).toBeNull()
    })

    it('handles partial support links', () => {
      const apiResponse: SystemInfoApiResponse = {
        ...mockSystemInfoApiResponse,
        support: {
          documentation_url: 'https://docs.example.com',
        },
      } as SystemInfoApiResponse

      const result = transformSystemInfoResponse(apiResponse)

      expect(result.support.documentationUrl).toBe('https://docs.example.com')
      expect(result.support.issuesUrl).toBeNull()
      expect(result.support.contactEmail).toBeNull()
    })

    it('handles null build_date', () => {
      const apiResponse: SystemInfoApiResponse = {
        ...mockSystemInfoApiResponse,
        build_date: null,
      } as unknown as SystemInfoApiResponse

      const result = transformSystemInfoResponse(apiResponse)

      expect(result.buildDate).toBeNull()
    })
  })

  describe('fetchSystemInfo', () => {
    it('fetches system info successfully', async () => {
      mockSuccessResponse()

      const result = await fetchSystemInfo()

      expect(apiClient.get).toHaveBeenCalledWith('/api/v1/system/info')
      expect(result.version).toBe('1.2.3')
      expect(result.build).toBe('a1b2c3d4')
    })

    it('calls the correct API endpoint', async () => {
      mockSuccessResponse()

      await fetchSystemInfo()

      expect(apiClient.get).toHaveBeenCalledTimes(1)
      expect(apiClient.get).toHaveBeenCalledWith('/api/v1/system/info')
    })

    it('throws error on non-OK response', async () => {
      mockErrorResponse(500, 'Internal Server Error')

      await expect(fetchSystemInfo()).rejects.toThrow('Internal Server Error')
    })

    it('throws error on 503 service unavailable', async () => {
      mockErrorResponse(503, 'Service Unavailable')

      await expect(fetchSystemInfo()).rejects.toThrow('Service Unavailable')
    })

    it('transforms response data automatically', async () => {
      mockSuccessResponse()

      const result = await fetchSystemInfo()

      // Verify camelCase transformation
      expect(result.buildDate).toBe('2025-01-15T10:00:00Z')
      expect(result.support.documentationUrl).toBe('https://docs.example.com')
      expect(result.runtime.pythonVersion).toBe('3.12.1')
    })
  })

  describe('Error Handling', () => {
    it('handles network errors gracefully', async () => {
      mockErrorResponse(0, 'Network error', 'network')

      await expect(fetchSystemInfo()).rejects.toThrow('Network error')
    })

    it('propagates api-client errors with status', async () => {
      mockErrorResponse(500, 'Internal server error')

      try {
        await fetchSystemInfo()
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        expect((err as Error & { status?: number }).status).toBe(500)
      }
    })

    it('propagates api-client errors with type', async () => {
      mockErrorResponse(404, 'Not found', 'not_found')

      try {
        await fetchSystemInfo()
        expect.fail('Should have thrown')
      } catch (err) {
        expect((err as Error & { type?: string }).type).toBe('not_found')
      }
    })
  })

  describe('Version Format', () => {
    it('accepts standard semver version', async () => {
      mockSuccessResponse({ ...mockSystemInfoApiResponse, version: '2.0.0' })

      const result = await fetchSystemInfo()

      expect(result.version).toBe('2.0.0')
    })

    it('accepts semver with prerelease', async () => {
      mockSuccessResponse({ ...mockSystemInfoApiResponse, version: '2.0.0-beta.1' })

      const result = await fetchSystemInfo()

      expect(result.version).toBe('2.0.0-beta.1')
    })

    it('accepts development version', async () => {
      mockSuccessResponse({ ...mockSystemInfoApiResponse, version: '0.0.0-dev' })

      const result = await fetchSystemInfo()

      expect(result.version).toBe('0.0.0-dev')
    })
  })

  describe('Build Identifier', () => {
    it('accepts git short hash', async () => {
      mockSuccessResponse({ ...mockSystemInfoApiResponse, build: 'abc1234' })

      const result = await fetchSystemInfo()

      expect(result.build).toBe('abc1234')
    })

    it('accepts full git hash', async () => {
      mockSuccessResponse({ ...mockSystemInfoApiResponse, build: 'abc1234567890def1234567890abc1234567890de' })

      const result = await fetchSystemInfo()

      expect(result.build).toBe('abc1234567890def1234567890abc1234567890de')
    })

    it('accepts "local" build identifier', async () => {
      mockSuccessResponse({ ...mockSystemInfoApiResponse, build: 'local' })

      const result = await fetchSystemInfo()

      expect(result.build).toBe('local')
    })
  })

  describe('No environment (REQ-5.2.1.42)', () => {
    it('transforms to exactly version, build, buildDate, support and runtime', () => {
      const result = transformSystemInfoResponse(mockSystemInfoApiResponse)

      expectTypeOf<SystemInfo>().not.toHaveProperty('environment')
      expectTypeOf<SystemInfoApiResponse>().not.toHaveProperty('environment')
      expect(Object.keys(result).sort((a, b) => a.localeCompare(b))).toEqual([
        'build',
        'buildDate',
        'runtime',
        'support',
        'version',
      ])
    })

    it('drops a stray environment the payload carries', () => {
      const result = transformSystemInfoResponse(withStrayEnvironment)

      expect(result).not.toHaveProperty('environment')
      expect(JSON.stringify(result)).not.toContain('production')
    })

    it('fetches system info without an environment', async () => {
      mockSuccessResponse(withStrayEnvironment)

      const result = await fetchSystemInfo()

      expect(result).not.toHaveProperty('environment')
      expect(result).toEqual({
        version: '1.2.3',
        build: 'a1b2c3d4',
        buildDate: '2025-01-15T10:00:00Z',
        support: {
          documentationUrl: 'https://docs.example.com',
          issuesUrl: 'https://github.com/example/wave/issues',
          contactEmail: 'support@example.com',
        },
        runtime: {
          pythonVersion: '3.12.1',
          os: 'Linux',
          osVersion: '5.15.0-160-generic',
        },
      })
    })
  })
})
