/**
 * Tests for the singleton API client instance.
 *
 * Verifies that the centralized base URL resolution and ApiClient
 * singleton are properly configured.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('api singleton', () => {
  const originalEnv = import.meta.env.VITE_API_BASE_URL

  afterEach(() => {
    vi.restoreAllMocks()
    // Restore original env
    if (originalEnv !== undefined) {
      import.meta.env.VITE_API_BASE_URL = originalEnv
    } else {
      delete import.meta.env.VITE_API_BASE_URL
    }
  })

  describe('apiClient', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it('exports a valid ApiClient instance', async () => {
      const { apiClient } = await import('@/lib/api')
      expect(apiClient).toBeDefined()
      expect(typeof apiClient.get).toBe('function')
      expect(typeof apiClient.post).toBe('function')
      expect(typeof apiClient.put).toBe('function')
      expect(typeof apiClient.patch).toBe('function')
      expect(typeof apiClient.delete).toBe('function')
    })

    it('is configured with the correct base URL', async () => {
      import.meta.env.VITE_API_BASE_URL = 'http://test-api:3000'
      const { apiClient } = await import('@/lib/api')
      const config = apiClient.getConfig()
      expect(config.baseUrl).toBe('http://test-api:3000')
    })

    it('derives default base URL from page origin so traffic flows through Vite proxy', async () => {
      delete import.meta.env.VITE_API_BASE_URL
      const { apiClient } = await import('@/lib/api')
      const config = apiClient.getConfig()
      expect(config.baseUrl).toBe(`${globalThis.location.origin}/api`)
    })

    it('derives default base URL when env var is empty string', async () => {
      import.meta.env.VITE_API_BASE_URL = ''
      const { apiClient } = await import('@/lib/api')
      const config = apiClient.getConfig()
      expect(config.baseUrl).toBe(`${globalThis.location.origin}/api`)
    })

    it('includes Content-Type: application/json in default headers', async () => {
      const { apiClient } = await import('@/lib/api')
      const config = apiClient.getConfig()
      expect(config.defaultHeaders).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/json' })
      )
    })
  })
})
