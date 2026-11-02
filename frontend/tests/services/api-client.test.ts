/**
 * REST API Client Tests - REQ-5.2.1.3 REST API client layer with error handling
 *
 * Comprehensive tests for the REST API client layer including:
 * - Core configuration and request/response handling
 * - Response envelope unwrapping
 * - Pagination support (page-based and cursor-based)
 * - Caching and ETag support
 * - Error classification and structured error handling
 * - Resilience patterns (retry, circuit breaker)
 * - Request interceptors
 * - Type safety
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import type {
  ApiClient,
  ApiClientConfig,
  ApiResponse,
  ApiError,
  PaginatedResponse,
  CursorBasedPaginationResponse,
  PageBasedPaginationParams,
  CursorBasedPaginationParams,
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
  RetryConfig,
} from '../../src/services/api-client'

// Import production implementation
import {
  createApiClient,
  classifyError,
  isRetryableError,
  isIdempotentMethod,
} from '../../src/services/api-client'
import { _resetConnectionMonitor } from '../../src/services/connection-monitor'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

/** Fetch calls for one request path, excluding the connection diagnosis probe. */
function requestCallsTo(path: string): unknown[][] {
  return mockFetch.mock.calls.filter(([url]) => String(url).endsWith(path))
}

describe('REST API Client - REQ-5.2.1.3', () => {
  let client: ApiClient

  beforeEach(() => {
    mockFetch.mockReset()
    _resetConnectionMonitor()
    client = createApiClient({
      baseUrl: 'https://api.example.com',
      defaultHeaders: {
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    _resetConnectionMonitor()
  })

  describe('Core Configuration', () => {
    it('creates client with base URL configuration', () => {
      const config: ApiClientConfig = {
        baseUrl: 'https://api.example.com',
      }
      const testClient = createApiClient(config)
      expect(testClient).toBeDefined()
      expect(testClient.getConfig().baseUrl).toBe('https://api.example.com')
    })

    it('creates client with default headers', () => {
      const config: ApiClientConfig = {
        baseUrl: 'https://api.example.com',
        defaultHeaders: {
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer token123',
        },
      }
      const testClient = createApiClient(config)
      expect(testClient.getConfig().defaultHeaders).toEqual({
        'X-Custom-Header': 'custom-value',
        Authorization: 'Bearer token123',
      })
    })

    it('creates client with timeout configuration', () => {
      const config: ApiClientConfig = {
        baseUrl: 'https://api.example.com',
        timeout: 10000,
      }
      const testClient = createApiClient(config)
      expect(testClient.getConfig().timeout).toBe(10000)
    })

    it('creates client with retry configuration', () => {
      const retryConfig: RetryConfig = {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
      }
      const config: ApiClientConfig = {
        baseUrl: 'https://api.example.com',
        retry: retryConfig,
      }
      const testClient = createApiClient(config)
      expect(testClient.getConfig().retry).toEqual(retryConfig)
    })

    it('uses default timeout of 30000ms when not specified', () => {
      const config: ApiClientConfig = {
        baseUrl: 'https://api.example.com',
      }
      const testClient = createApiClient(config)
      expect(testClient.getConfig().timeout).toBe(30000)
    })

    it('throws error when baseUrl is not provided', () => {
      expect(() => createApiClient({} as ApiClientConfig)).toThrow(
        'baseUrl is required'
      )
    })

    it('throws error when baseUrl is empty string', () => {
      expect(() => createApiClient({ baseUrl: '' })).toThrow(
        'baseUrl is required'
      )
    })
  })

  describe('Request Pipeline', () => {
    it('makes GET request to correct URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1, name: 'Test' },
            meta: { timestamp: '2024-01-01T00:00:00Z', requestId: 'req-123' },
          }),
      })

      await client.get('/users/1')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('makes POST request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 2, name: 'New User' },
            meta: { timestamp: '2024-01-01T00:00:00Z', requestId: 'req-124' },
          }),
      })

      const body = { name: 'New User', email: 'new@example.com' }
      await client.post('/users', body)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      )
    })

    it('makes PUT request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1, name: 'Updated User' },
            meta: { timestamp: '2024-01-01T00:00:00Z', requestId: 'req-125' },
          }),
      })

      const body = { name: 'Updated User' }
      await client.put('/users/1', body)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        })
      )
    })

    it('makes PATCH request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1, name: 'Patched User' },
            meta: { timestamp: '2024-01-01T00:00:00Z', requestId: 'req-126' },
          }),
      })

      const body = { name: 'Patched User' }
      await client.patch('/users/1', body)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      )
    })

    it('makes DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({}),
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      })

      await client.delete('/users/1')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('sends no content type on a request with no body', async () => {
      // A content type on a bodyless cross-origin request costs a CORS preflight.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            success: true,
            data: {},
            meta: { timestamp: '2024-01-01T00:00:00Z', requestId: 'req-128' },
          }),
      })

      await client.get('/test')

      const [, init] = mockFetch.mock.calls[0]
      expect((init as RequestInit).headers).not.toHaveProperty('Content-Type')
    })

    // A caller's AbortSignal has to reach the wire, or a canceled request keeps running.
    it('aborts the request when the caller aborts its own signal', async () => {
      const controller = new AbortController()
      let sent: AbortSignal | undefined
      mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
        sent = init.signal as AbortSignal
        return new Promise(() => {})
      })

      void client.get('/test', { signal: controller.signal })
      await Promise.resolve()
      controller.abort()

      expect(sent?.aborted).toBe(true)
    })

    it('aborts at once when the caller hands in an already aborted signal', async () => {
      const controller = new AbortController()
      controller.abort()
      let sent: AbortSignal | undefined
      mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
        sent = init.signal as AbortSignal
        return new Promise(() => {})
      })

      void client.get('/test', { signal: controller.signal })
      await Promise.resolve()

      expect(sent?.aborted).toBe(true)
    })

    it('includes default headers in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: {},
            meta: { timestamp: '2024-01-01T00:00:00Z', requestId: 'req-127' },
          }),
      })

      await client.post('/test', { name: 'x' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('allows request-specific header overrides', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: {},
            meta: { timestamp: '2024-01-01T00:00:00Z', requestId: 'req-128' },
          }),
      })

      await client.get('/test', {
        headers: {
          'X-Request-ID': 'custom-request-id',
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-ID': 'custom-request-id',
          }),
        })
      )
    })

    it('allows request-specific timeout override', async () => {
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
      vi.useFakeTimers()

      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'application/json' }),
                json: () =>
                  Promise.resolve({
                    success: true,
                    data: {},
                    meta: {
                      timestamp: '2024-01-01T00:00:00Z',
                      requestId: 'req-129',
                    },
                  }),
              })
            }, 15000)
          })
      )

      const promise = client.get('/slow-endpoint', { timeout: 10000 })

      // Advance timer to just before timeout
      await vi.advanceTimersByTimeAsync(9999)
      expect(abortSpy).not.toHaveBeenCalled()

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(2)
      expect(abortSpy).toHaveBeenCalled()

      await expect(promise).rejects.toThrow()

      vi.useRealTimers()
      abortSpy.mockRestore()
    })

    it('handles query parameters in GET requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: [],
            meta: { timestamp: '2024-01-01T00:00:00Z', requestId: 'req-130' },
          }),
      })

      await client.get('/users', {
        params: { status: 'active', limit: 10 },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users?status=active&limit=10',
        expect.any(Object)
      )
    })
  })

  describe('Response Envelope Handling', () => {
    it('unwraps success response and returns data payload', async () => {
      const responseData = { id: 1, name: 'Test User', email: 'test@example.com' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: responseData,
            meta: {
              timestamp: '2024-01-01T00:00:00Z',
              apiVersion: '1.0.0',
              requestId: 'req-131',
            },
          }),
      })

      const result = await client.get<typeof responseData>('/users/1')

      expect(result.data).toEqual(responseData)
    })

    it('extracts and preserves response metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1 },
            meta: {
              timestamp: '2024-01-01T12:00:00Z',
              apiVersion: '1.2.3',
              requestId: 'unique-request-id-abc123',
            },
          }),
      })

      const result = await client.get('/users/1')

      expect(result.meta).toEqual({
        timestamp: '2024-01-01T12:00:00Z',
        apiVersion: '1.2.3',
        requestId: 'unique-request-id-abc123',
      })
    })

    it('propagates request ID for correlation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: {},
            meta: {
              timestamp: '2024-01-01T00:00:00Z',
              requestId: 'correlation-id-xyz789',
            },
          }),
      })

      const result = await client.get('/test')

      expect(result.meta.requestId).toBe('correlation-id-xyz789')
    })

    it('handles response without optional metadata fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1 },
            meta: {
              requestId: 'req-132',
            },
          }),
      })

      const result = await client.get('/test')

      expect(result.data).toEqual({ id: 1 })
      expect(result.meta.requestId).toBe('req-132')
      expect(result.meta.timestamp).toBeUndefined()
      expect(result.meta.apiVersion).toBeUndefined()
    })

    it('handles 204 No Content response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({}),
        text: () => Promise.resolve(''),
      })

      const result = await client.delete('/users/1')

      expect(result.data).toBeNull()
      expect(result.status).toBe(204)
    })

    it('returns raw JSON body when rawResponse is true', async () => {
      const flatJson = { level: 'INFO', timestamp: '2025-01-01T00:00:00Z' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () => Promise.resolve(flatJson),
      })

      const result = await client.get<typeof flatJson>('/admin/log-level', {
        rawResponse: true,
      })

      expect(result.data).toEqual(flatJson)
      expect(result.meta).toEqual({ requestId: '' })
      expect(result.status).toBe(200)
    })

    it('still unwraps envelope when rawResponse is not set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            data: { id: 1 },
            meta: { requestId: 'req-200' },
          }),
      })

      const result = await client.get('/users/1')

      expect(result.data).toEqual({ id: 1 })
      expect(result.meta.requestId).toBe('req-200')
    })
  })

  describe('DELETE with body', () => {
    it('sends request body on DELETE when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            data: { deleted: ['id-1', 'id-2'], failed: [] },
            meta: { requestId: 'req-del' },
          }),
      })

      const result = await client.delete<{ deleted: string[]; failed: string[] }>(
        '/tests/batch',
        { ids: ['id-1', 'id-2'] }
      )

      expect(result.data).toEqual({ deleted: ['id-1', 'id-2'], failed: [] })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/tests/batch',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ ids: ['id-1', 'id-2'] }),
        })
      )
    })

    it('sends DELETE without body when body is omitted', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({}),
        text: () => Promise.resolve(''),
      })

      await client.delete('/users/1')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
      // Verify body is NOT included in the fetch options
      const fetchOptions = mockFetch.mock.calls[0][1]
      expect(fetchOptions).not.toHaveProperty('body')
    })

    it('supports rawResponse with DELETE body', async () => {
      const batchResult = { deleted: ['s1'], failed: [{ index: 0, error: 'not found' }] }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () => Promise.resolve(batchResult),
      })

      const result = await client.delete<typeof batchResult>(
        '/suites/batch',
        ['s1', 's2'],
        { rawResponse: true }
      )

      expect(result.data).toEqual(batchResult)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/suites/batch',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify(['s1', 's2']),
        })
      )
    })
  })

  describe('Pagination Support - Page-Based', () => {
    it('sends page number and page size parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: [],
            meta: { requestId: 'req-133' },
            pagination: {
              page: 2,
              pageSize: 20,
              totalItems: 100,
              totalPages: 5,
            },
          }),
      })

      const pagination: PageBasedPaginationParams = {
        page: 2,
        pageSize: 20,
      }
      await client.get('/users', { pagination })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users?page=2&pageSize=20',
        expect.any(Object)
      )
    })

    it('extracts total count from paginated response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: [{ id: 1 }, { id: 2 }],
            meta: { requestId: 'req-134' },
            pagination: {
              page: 1,
              pageSize: 10,
              totalItems: 50,
              totalPages: 5,
            },
          }),
      })

      const result = (await client.get('/users')) as ApiResponse<
        unknown[],
        PaginatedResponse
      >

      expect(result.pagination?.totalItems).toBe(50)
      expect(result.pagination?.totalPages).toBe(5)
    })

    it('extracts page metadata from paginated response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: [],
            meta: { requestId: 'req-135' },
            pagination: {
              page: 3,
              pageSize: 25,
              totalItems: 100,
              totalPages: 4,
              hasNextPage: true,
              hasPreviousPage: true,
            },
          }),
      })

      const result = (await client.get('/users')) as ApiResponse<
        unknown[],
        PaginatedResponse
      >

      expect(result.pagination).toEqual({
        page: 3,
        pageSize: 25,
        totalItems: 100,
        totalPages: 4,
        hasNextPage: true,
        hasPreviousPage: true,
      })
    })

    it('returns default pagination values when not present in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: [{ id: 1 }],
            meta: { requestId: 'req-136' },
          }),
      })

      const result = await client.get('/users')

      expect(result.pagination).toBeUndefined()
    })

    it('combines pagination params with regular query params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: [],
            meta: { requestId: 'req-combined-params' },
            pagination: {
              page: 2,
              pageSize: 20,
              totalItems: 50,
              totalPages: 3,
            },
          }),
      })

      const pagination: PageBasedPaginationParams = {
        page: 2,
        pageSize: 20,
      }
      await client.get('/users', {
        params: { status: 'active', role: 'admin' },
        pagination,
      })

      // Should include both regular params and pagination params
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(
          /https:\/\/api\.example\.com\/users\?.*status=active.*&.*role=admin.*&.*page=2.*&.*pageSize=20/
        ),
        expect.any(Object)
      )
    })
  })

  describe('Pagination Support - Cursor-Based', () => {
    it('sends cursor token in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: [],
            meta: { requestId: 'req-137' },
            pagination: {
              cursor: 'next-cursor-token',
              hasMore: true,
            },
          }),
      })

      const pagination: CursorBasedPaginationParams = {
        cursor: 'previous-cursor-token',
        limit: 50,
      }
      await client.get('/events', { pagination })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/events?cursor=previous-cursor-token&limit=50',
        expect.any(Object)
      )
    })

    it('extracts next cursor token from response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: [{ id: 1 }],
            meta: { requestId: 'req-138' },
            pagination: {
              cursor: 'next-page-cursor-abc',
              hasMore: true,
            },
          }),
      })

      const result = (await client.get('/events')) as ApiResponse<
        unknown[],
        CursorBasedPaginationResponse
      >

      expect(result.pagination?.cursor).toBe('next-page-cursor-abc')
      expect(result.pagination?.hasMore).toBe(true)
    })

    it('indicates when no more pages are available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: [{ id: 1 }],
            meta: { requestId: 'req-139' },
            pagination: {
              cursor: null,
              hasMore: false,
            },
          }),
      })

      const result = (await client.get('/events')) as ApiResponse<
        unknown[],
        CursorBasedPaginationResponse
      >

      expect(result.pagination?.cursor).toBeNull()
      expect(result.pagination?.hasMore).toBe(false)
    })
  })

  describe('Caching and ETag Support', () => {
    it('tracks ETag from response headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          etag: '"abc123"',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1, name: 'Resource' },
            meta: { requestId: 'req-140' },
          }),
      })

      const result = await client.get('/resources/1')

      expect(result.etag).toBe('"abc123"')
    })

    it('includes If-Match header on update requests with ETag', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1, name: 'Updated' },
            meta: { requestId: 'req-141' },
          }),
      })

      await client.put(
        '/resources/1',
        { name: 'Updated' },
        { etag: '"xyz789"' }
      )

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'If-Match': '"xyz789"',
          }),
        })
      )
    })

    it('handles 412 Precondition Failed as conflict error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 412,
        statusText: 'Precondition Failed',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'PRECONDITION_FAILED',
              message: 'Resource has been modified by another user',
              requestId: 'req-142',
            },
          }),
      })

      await expect(
        client.put('/resources/1', { name: 'Updated' }, { etag: '"old-etag"' })
      ).rejects.toMatchObject({
        type: 'precondition_failed',
        code: 'PRECONDITION_FAILED',
        message: 'Resource has been modified by another user',
      })
    })

    it('surfaces precondition failed error for UI to handle refresh', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 412,
        statusText: 'Precondition Failed',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'PRECONDITION_FAILED',
              message: 'Concurrent modification detected',
              requestId: 'req-143',
            },
          }),
      })

      try {
        await client.put(
          '/resources/1',
          { name: 'Updated' },
          { etag: '"stale-etag"' }
        )
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('precondition_failed')
        expect(apiError.requiresRefresh).toBe(true)
      }
    })

    it('respects Cache-Control headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'cache-control': 'max-age=3600',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1 },
            meta: { requestId: 'req-144' },
          }),
      })

      const result = await client.get('/cached-resource')

      expect(result.cacheControl).toBe('max-age=3600')
    })

    it('invalidates cache on successful mutation', async () => {
      const cacheInvalidationSpy = vi.fn()
      const clientWithCacheInvalidation = createApiClient({
        baseUrl: 'https://api.example.com',
        onCacheInvalidation: cacheInvalidationSpy,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1, name: 'Updated' },
            meta: { requestId: 'req-145' },
          }),
      })

      await clientWithCacheInvalidation.put('/resources/1', { name: 'Updated' })

      expect(cacheInvalidationSpy).toHaveBeenCalledWith('/resources/1')
    })
  })

  describe('Error Classification', () => {
    it('classifies network errors (fetch failed)', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      try {
        await client.get('/test')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('network')
        expect(apiError.isRetryable).toBe(true)
      }
    })

    it('classifies timeout errors', async () => {
      const abortError = new DOMException('Aborted', 'AbortError')
      mockFetch.mockRejectedValueOnce(abortError)

      try {
        await client.get('/test')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('timeout')
        expect(apiError.isRetryable).toBe(true)
      }
    })

    it('classifies 400 Bad Request as client error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request body',
              requestId: 'req-146',
            },
          }),
      })

      try {
        await client.post('/users', {})
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('client')
        expect(apiError.status).toBe(400)
        expect(apiError.isRetryable).toBe(false)
      }
    })

    it('classifies 401 Unauthorized as auth error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
              requestId: 'req-147',
            },
          }),
      })

      try {
        await client.get('/protected')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('unauthorized')
        expect(apiError.status).toBe(401)
      }
    })

    it('classifies 403 Forbidden as client error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Access denied',
              requestId: 'req-148',
            },
          }),
      })

      try {
        await client.get('/admin')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('forbidden')
        expect(apiError.status).toBe(403)
      }
    })

    it('classifies 404 Not Found as client error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'User not found',
              resourceId: 'user-123',
              requestId: 'req-149',
            },
          }),
      })

      try {
        await client.get('/users/non-existent')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('not_found')
        expect(apiError.resourceId).toBe('user-123')
      }
    })

    it('classifies 409 Conflict as conflict error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'CONFLICT',
              message: 'Resource already exists',
              requestId: 'req-150',
            },
          }),
      })

      try {
        await client.post('/users', { email: 'existing@example.com' })
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('conflict')
        expect(apiError.status).toBe(409)
        expect(apiError.requiresRefresh).toBe(true)
      }
    })

    it('classifies 422 Unprocessable Entity as validation error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Validation failed',
              fields: {
                email: 'Invalid email format',
                age: 'Must be a positive number',
              },
              requestId: 'req-151',
            },
          }),
      })

      try {
        await client.post('/users', { email: 'invalid', age: -5 })
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('validation')
        expect(apiError.fields).toEqual({
          email: 'Invalid email format',
          age: 'Must be a positive number',
        })
      }
    })

    it('classifies 429 Too Many Requests as rate limit error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({
          'content-type': 'application/json',
          'retry-after': '60',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests',
              requestId: 'req-152',
            },
          }),
      })

      try {
        await client.get('/test')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('rate_limited')
        expect(apiError.retryAfter).toBe(60)
        expect(apiError.isRetryable).toBe(true)
      }
    })

    it('classifies 500 Internal Server Error as server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'An unexpected error occurred',
              requestId: 'req-153',
            },
          }),
      })

      try {
        await client.get('/test')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('server')
        expect(apiError.status).toBe(500)
        expect(apiError.isRetryable).toBe(true)
      }
    })

    it('classifies 502 Bad Gateway as server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers({}),
        text: () => Promise.resolve('Bad Gateway'),
      })

      try {
        await client.get('/test')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('server')
        expect(apiError.status).toBe(502)
        expect(apiError.isRetryable).toBe(true)
      }
    })

    it('classifies 503 Service Unavailable as server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({
          'retry-after': '120',
        }),
        text: () => Promise.resolve('Service Unavailable'),
      })

      try {
        await client.get('/test')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('server')
        expect(apiError.status).toBe(503)
        expect(apiError.isRetryable).toBe(true)
        expect(apiError.retryAfter).toBe(120)
      }
    })

    it('classifies 504 Gateway Timeout as server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 504,
        statusText: 'Gateway Timeout',
        headers: new Headers({}),
        text: () => Promise.resolve('Gateway Timeout'),
      })

      try {
        await client.get('/test')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('server')
        expect(apiError.status).toBe(504)
        expect(apiError.isRetryable).toBe(true)
      }
    })
  })

  describe('Structured Error Handling', () => {
    it('transforms backend error response to consistent internal format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              requestId: 'req-154',
            },
          }),
      })

      try {
        await client.post('/test', {})
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.code).toBe('VALIDATION_ERROR')
        expect(apiError.message).toBe('Request validation failed')
        expect(apiError.requestId).toBe('req-154')
      }
    })

    it('preserves field-level validation errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Multiple validation errors',
              fields: {
                username: 'Username is required',
                email: 'Email must be valid',
                password: 'Password must be at least 8 characters',
              },
              requestId: 'req-155',
            },
          }),
      })

      try {
        await client.post('/register', {})
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.fields).toEqual({
          username: 'Username is required',
          email: 'Email must be valid',
          password: 'Password must be at least 8 characters',
        })
      }
    })

    it('preserves error details field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Payload too large',
              details: 'Maximum request body size is 10MB',
              requestId: 'req-details-1',
            },
          }),
      })

      try {
        await client.post('/upload', {})
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.details).toBe('Maximum request body size is 10MB')
      }
    })

    it('preserves resource identifiers for not-found errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'User not found',
              resourceType: 'User',
              resourceId: 'user-12345',
              requestId: 'req-156',
            },
          }),
      })

      try {
        await client.get('/users/user-12345')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.resourceType).toBe('User')
        expect(apiError.resourceId).toBe('user-12345')
      }
    })

    it('carries request ID for support correlation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Something went wrong',
              requestId: 'support-correlation-id-abc',
            },
          }),
      })

      try {
        await client.get('/test')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.requestId).toBe('support-correlation-id-abc')
      }
    })

    it('parses FastAPI detail field in error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            detail: "Test with name 'Existing Test' already exists",
          }),
      })

      try {
        await client.post('/tests', { name: 'Existing Test' })
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('conflict')
        expect(apiError.message).toBe("Test with name 'Existing Test' already exists")
        expect(apiError.status).toBe(409)
      }
    })

    it('handles non-string detail field in error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            detail: [{ loc: ['body', 'name'], msg: 'field required', type: 'value_error.missing' }],
          }),
      })

      try {
        await client.post('/tests', {})
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('validation')
        expect(apiError.message).toContain('field required')
        expect(apiError.status).toBe(422)
      }
    })

    it('handles non-JSON error responses gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({
          'content-type': 'text/html',
        }),
        text: () => Promise.resolve('<html>Internal Server Error</html>'),
      })

      try {
        await client.get('/test')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.type).toBe('server')
        expect(apiError.message).toBe('Internal Server Error')
        expect(apiError.status).toBe(500)
      }
    })

    it('creates error with sufficient context for user-facing messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have permission to access this resource',
              userMessage: 'Please contact your administrator for access',
              requestId: 'req-157',
            },
          }),
      })

      try {
        await client.get('/admin/settings')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError
        expect(apiError.message).toBe(
          'You do not have permission to access this resource'
        )
        expect(apiError.userMessage).toBe(
          'Please contact your administrator for access'
        )
      }
    })
  })

  describe('Failure Context', () => {
    /** Drive performance.now from a controllable value so durations are deterministic. */
    function stubClock(): { t: number } {
      const clock = { t: 0 }
      vi.spyOn(performance, 'now').mockImplementation(() => clock.t)
      return clock
    }

    function captureError(promise: Promise<unknown>): Promise<ApiError> {
      return promise.then(
        () => {
          throw new Error('Expected the request to fail')
        },
        (error: unknown) => error as ApiError,
      )
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('carries method, path, status and reason on an error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'boom' },
            meta: { request_id: 'rid-envelope' },
          }),
      })

      const error = await captureError(client.get('/environments/names'))

      expect(error.method).toBe('GET')
      expect(error.path).toBe('/environments/names')
      expect(error.status).toBe(500)
      expect(error.statusText).toBe('Internal Server Error')
      expect(error.requestId).toBe('rid-envelope')
    })

    it('leaves statusText undefined when the response carries no reason phrase', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: '',
        headers: new Headers({}),
      })

      const error = await captureError(client.get('/environments/names'))

      expect(error.statusText).toBeUndefined()
    })

    it('takes the request id from the X-Request-ID header when the body has none', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers({ 'X-Request-ID': 'rid-header' }),
      })

      const error = await captureError(client.get('/environments/names'))

      expect(error.requestId).toBe('rid-header')
    })

    it('records an integer duration measured with performance.now', async () => {
      const clock = stubClock()
      clock.t = 1000
      mockFetch.mockImplementationOnce(() => {
        clock.t = 2421.6
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({}),
        })
      })

      const error = await captureError(client.get('/environments/names'))

      expect(error.durationMs).toBe(1422)
    })

    it('stamps occurredAt as an ISO timestamp', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
      })

      const error = await captureError(client.get('/environments/names'))

      expect(error.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })

    it('carries method, path and duration on a network failure', async () => {
      const clock = stubClock()
      clock.t = 500
      mockFetch.mockImplementationOnce(() => {
        clock.t = 587
        return Promise.reject(new TypeError('Failed to fetch'))
      })

      const error = await captureError(client.post('/profiles', { name: 'a' }))

      expect(error.type).toBe('network')
      expect(error.method).toBe('POST')
      expect(error.path).toBe('/profiles')
      expect(error.durationMs).toBe(87)
    })

    it('carries method and path but no duration when the monitor is offline', async () => {
      mockFetch.mockRejectedValue(new TypeError('NetworkError'))
      await client.get('/first').catch(() => undefined)
      await client.get('/second').catch(() => undefined)
      mockFetch.mockReset()

      const error = await captureError(client.get('/environments/names'))

      expect(error.message).toBe('Cannot reach the backend at https://api.example.com')
      expect(error.method).toBe('GET')
      expect(error.path).toBe('/environments/names')
      expect(error.durationMs).toBeUndefined()
    })

    it('carries method and path but no duration when the circuit breaker is open', async () => {
      const guarded = createApiClient({
        baseUrl: 'https://api.example.com',
        circuitBreaker: { failureThreshold: 1, resetTimeout: 30000 },
      })
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
      })
      await guarded.get('/environments/names').catch(() => undefined)

      const error = await captureError(guarded.get('/environments/names'))

      expect(error.type).toBe('circuit_open')
      expect(error.method).toBe('GET')
      expect(error.path).toBe('/environments/names')
      expect(error.durationMs).toBeUndefined()
    })
  })

  describe('Resilience Patterns - Retry Logic', () => {
    it('retries GET requests on transient failures', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
          }),
          json: () =>
            Promise.resolve({
              success: true,
              data: { id: 1 },
              meta: { requestId: 'req-158' },
            }),
        })

      const clientWithRetry = createApiClient({
        baseUrl: 'https://api.example.com',
        retry: {
          maxRetries: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
        },
      })

      vi.useFakeTimers()
      const promise = clientWithRetry.get('/test')

      // First retry after baseDelay (100ms)
      await vi.advanceTimersByTimeAsync(100)
      // Second retry after baseDelay * backoffMultiplier (200ms)
      await vi.advanceTimersByTimeAsync(200)

      const result = await promise

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(result.data).toEqual({ id: 1 })

      vi.useRealTimers()
    })

    it('retries with exponential backoff', async () => {
      const timestamps: number[] = []

      vi.useFakeTimers()
      vi.setSystemTime(0)

      mockFetch
        .mockImplementationOnce(() => {
          timestamps.push(Date.now())
          return Promise.reject(new TypeError('Failed to fetch'))
        })
        .mockImplementationOnce(() => {
          timestamps.push(Date.now())
          return Promise.reject(new TypeError('Failed to fetch'))
        })
        .mockImplementationOnce(() => {
          timestamps.push(Date.now())
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({
              'content-type': 'application/json',
            }),
            json: () =>
              Promise.resolve({
                success: true,
                data: { id: 1 },
                meta: { requestId: 'req-159' },
              }),
          })
        })

      const clientWithRetry = createApiClient({
        baseUrl: 'https://api.example.com',
        retry: {
          maxRetries: 3,
          baseDelay: 1000,
          maxDelay: 10000,
          backoffMultiplier: 2,
        },
      })

      const promise = clientWithRetry.get('/test')

      // Initial request at t=0
      await vi.advanceTimersByTimeAsync(0)

      // First retry at t=1000 (baseDelay)
      await vi.advanceTimersByTimeAsync(1000)

      // Second retry at t=3000 (1000 + 2000 due to backoff)
      await vi.advanceTimersByTimeAsync(2000)

      await promise

      expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(1000)
      expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(2000)

      vi.useRealTimers()
    })

    it('caps delay at maxDelay when backoff would exceed it', async () => {
      const timestamps: number[] = []

      vi.useFakeTimers()
      vi.setSystemTime(0)

      // Configure with low maxDelay that will be exceeded by backoff
      // baseDelay=1000, multiplier=2: delays would be 1000, 2000, 4000, 8000...
      // But maxDelay=2500 should cap at 2500
      mockFetch
        .mockImplementationOnce(() => {
          timestamps.push(Date.now())
          return Promise.reject(new TypeError('Failed to fetch'))
        })
        .mockImplementationOnce(() => {
          timestamps.push(Date.now())
          return Promise.reject(new TypeError('Failed to fetch'))
        })
        .mockImplementationOnce(() => {
          timestamps.push(Date.now())
          return Promise.reject(new TypeError('Failed to fetch'))
        })
        .mockImplementationOnce(() => {
          timestamps.push(Date.now())
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({
              'content-type': 'application/json',
            }),
            json: () =>
              Promise.resolve({
                success: true,
                data: { id: 1 },
                meta: { requestId: 'req-maxdelay' },
              }),
          })
        })

      const clientWithRetry = createApiClient({
        baseUrl: 'https://api.example.com',
        retry: {
          maxRetries: 4,
          baseDelay: 1000,
          maxDelay: 2500,
          backoffMultiplier: 2,
        },
      })

      const promise = clientWithRetry.get('/test')

      // Initial request at t=0
      await vi.advanceTimersByTimeAsync(0)

      // First retry at t=1000 (baseDelay)
      await vi.advanceTimersByTimeAsync(1000)

      // Second retry at t=3000 (1000 + 2000 due to backoff)
      await vi.advanceTimersByTimeAsync(2000)

      // Third retry: would be 4000ms but capped at maxDelay=2500
      // So at t=5500 (3000 + 2500)
      await vi.advanceTimersByTimeAsync(2500)

      await promise

      // First retry delay: 1000ms
      expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(1000)
      // Second retry delay: 2000ms (1000 * 2)
      expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(2000)
      // Third retry delay: should be capped at 2500ms, not 4000ms
      expect(timestamps[3] - timestamps[2]).toBeGreaterThanOrEqual(2500)
      expect(timestamps[3] - timestamps[2]).toBeLessThan(4000)

      vi.useRealTimers()
    })

    it('respects max retry limit', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))

      const clientWithRetry = createApiClient({
        baseUrl: 'https://api.example.com',
        retry: {
          maxRetries: 2,
          baseDelay: 10,
          maxDelay: 100,
          backoffMultiplier: 2,
        },
      })

      vi.useFakeTimers()
      const promise = clientWithRetry.get('/test')

      // Advance through all retries
      await vi.advanceTimersByTimeAsync(10) // First retry
      await vi.advanceTimersByTimeAsync(20) // Second retry (with backoff)
      await vi.advanceTimersByTimeAsync(100) // Extra time to ensure completion

      await expect(promise).rejects.toMatchObject({
        type: 'network',
      })

      // Initial request + 2 retries = 3 attempts
      expect(requestCallsTo('/test')).toHaveLength(3)

      vi.useRealTimers()
    })

    it('does not retry non-idempotent POST requests by default', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      const clientWithRetry = createApiClient({
        baseUrl: 'https://api.example.com',
        retry: {
          maxRetries: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
        },
      })

      await expect(clientWithRetry.post('/users', { name: 'Test' })).rejects.toMatchObject({
        type: 'network',
      })

      expect(requestCallsTo('/users')).toHaveLength(1)
    })

    it('retries PUT requests as they are idempotent', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
          }),
          json: () =>
            Promise.resolve({
              success: true,
              data: { id: 1, name: 'Updated' },
              meta: { requestId: 'req-160' },
            }),
        })

      const clientWithRetry = createApiClient({
        baseUrl: 'https://api.example.com',
        retry: {
          maxRetries: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
        },
      })

      vi.useFakeTimers()
      const promise = clientWithRetry.put('/users/1', { name: 'Updated' })

      await vi.advanceTimersByTimeAsync(100)

      const result = await promise

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.data).toEqual({ id: 1, name: 'Updated' })

      vi.useRealTimers()
    })

    it('retries DELETE requests as they are idempotent', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        })

      const clientWithRetry = createApiClient({
        baseUrl: 'https://api.example.com',
        retry: {
          maxRetries: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
        },
      })

      vi.useFakeTimers()
      const promise = clientWithRetry.delete('/users/1')

      await vi.advanceTimersByTimeAsync(100)

      const result = await promise

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.status).toBe(204)

      vi.useRealTimers()
    })

    it('does not retry 4xx client errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid input',
              requestId: 'req-161',
            },
          }),
      })

      const clientWithRetry = createApiClient({
        baseUrl: 'https://api.example.com',
        retry: {
          maxRetries: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
        },
      })

      await expect(clientWithRetry.get('/test')).rejects.toMatchObject({
        type: 'client',
        status: 400,
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('retries 5xx server errors', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({}),
          text: () => Promise.resolve('Service Unavailable'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
          }),
          json: () =>
            Promise.resolve({
              success: true,
              data: { id: 1 },
              meta: { requestId: 'req-162' },
            }),
        })

      const clientWithRetry = createApiClient({
        baseUrl: 'https://api.example.com',
        retry: {
          maxRetries: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
        },
      })

      vi.useFakeTimers()
      const promise = clientWithRetry.get('/test')

      await vi.advanceTimersByTimeAsync(100)

      const result = await promise

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.data).toEqual({ id: 1 })

      vi.useRealTimers()
    })

    it('allows enabling retry for POST with explicit configuration', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers({
            'content-type': 'application/json',
          }),
          json: () =>
            Promise.resolve({
              success: true,
              data: { id: 1 },
              meta: { requestId: 'req-163' },
            }),
        })

      const clientWithRetry = createApiClient({
        baseUrl: 'https://api.example.com',
        retry: {
          maxRetries: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
        },
      })

      vi.useFakeTimers()
      const promise = clientWithRetry.post(
        '/idempotent-operation',
        { key: 'value' },
        { retry: true }
      )

      await vi.advanceTimersByTimeAsync(100)

      const result = await promise

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.data).toEqual({ id: 1 })

      vi.useRealTimers()
    })
  })

  describe('Resilience Patterns - Circuit Breaker', () => {
    it('opens circuit after threshold failures', async () => {
      const clientWithCircuitBreaker = createApiClient({
        baseUrl: 'https://api.example.com',
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 30000,
        },
      })

      // Fail 3 times to trip the circuit
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
        text: () => Promise.resolve('Internal Server Error'),
      })

      await expect(clientWithCircuitBreaker.get('/test')).rejects.toMatchObject({
        type: 'server',
      })
      await expect(clientWithCircuitBreaker.get('/test')).rejects.toMatchObject({
        type: 'server',
      })
      await expect(clientWithCircuitBreaker.get('/test')).rejects.toMatchObject({
        type: 'server',
      })

      // Fourth request should fail immediately due to open circuit
      await expect(clientWithCircuitBreaker.get('/test')).rejects.toMatchObject({
        type: 'circuit_open',
        message: 'Circuit breaker is open',
      })

      // Should not have made a 4th fetch call
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('allows requests after reset timeout in half-open state', async () => {
      vi.useFakeTimers()

      const clientWithCircuitBreaker = createApiClient({
        baseUrl: 'https://api.example.com',
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 5000,
        },
      })

      // Fail 2 times to trip the circuit
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
        text: () => Promise.resolve('Internal Server Error'),
      })

      await expect(clientWithCircuitBreaker.get('/test')).rejects.toMatchObject({
        type: 'server',
      })
      await expect(clientWithCircuitBreaker.get('/test')).rejects.toMatchObject({
        type: 'server',
      })

      // Circuit should be open now
      await expect(clientWithCircuitBreaker.get('/test')).rejects.toMatchObject({
        type: 'circuit_open',
      })

      // Advance time past reset timeout
      await vi.advanceTimersByTimeAsync(5001)

      // Mock a successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1 },
            meta: { requestId: 'req-164' },
          }),
      })

      // Should allow the request in half-open state
      const result = await clientWithCircuitBreaker.get('/test')
      expect(result.data).toEqual({ id: 1 })

      vi.useRealTimers()
    })

    it('closes circuit after successful request in half-open state', async () => {
      vi.useFakeTimers()

      const clientWithCircuitBreaker = createApiClient({
        baseUrl: 'https://api.example.com',
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 5000,
        },
      })

      // Fail to open circuit
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
        text: () => Promise.resolve('Internal Server Error'),
      })

      await expect(clientWithCircuitBreaker.get('/test')).rejects.toBeDefined()
      await expect(clientWithCircuitBreaker.get('/test')).rejects.toBeDefined()

      // Circuit is open
      await expect(clientWithCircuitBreaker.get('/test')).rejects.toMatchObject({
        type: 'circuit_open',
      })

      // Advance time past reset timeout
      await vi.advanceTimersByTimeAsync(5001)

      // Success in half-open state should close circuit
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1 },
            meta: { requestId: 'req-165' },
          }),
      })

      await clientWithCircuitBreaker.get('/test')

      // Subsequent requests should work normally
      const result = await clientWithCircuitBreaker.get('/test')
      expect(result.data).toEqual({ id: 1 })

      vi.useRealTimers()
    })

    it('reopens circuit on failure in half-open state', async () => {
      vi.useFakeTimers()

      const clientWithCircuitBreaker = createApiClient({
        baseUrl: 'https://api.example.com',
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 5000,
        },
      })

      // Fail to open circuit
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
        text: () => Promise.resolve('Internal Server Error'),
      })

      await expect(clientWithCircuitBreaker.get('/test')).rejects.toBeDefined()
      await expect(clientWithCircuitBreaker.get('/test')).rejects.toBeDefined()

      // Advance time to half-open
      await vi.advanceTimersByTimeAsync(5001)

      // Fail again in half-open state
      await expect(clientWithCircuitBreaker.get('/test')).rejects.toMatchObject({
        type: 'server',
      })

      // Circuit should be open again
      await expect(clientWithCircuitBreaker.get('/test')).rejects.toMatchObject({
        type: 'circuit_open',
      })

      vi.useRealTimers()
    })

    it('isolates circuit breaker state per endpoint', async () => {
      const clientWithCircuitBreaker = createApiClient({
        baseUrl: 'https://api.example.com',
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 30000,
        },
      })

      // Fail endpoint A twice to trip its circuit
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
        text: () => Promise.resolve('Internal Server Error'),
      })

      await expect(clientWithCircuitBreaker.get('/endpoint-a')).rejects.toMatchObject({
        type: 'server',
      })
      await expect(clientWithCircuitBreaker.get('/endpoint-a')).rejects.toMatchObject({
        type: 'server',
      })

      // Endpoint A circuit should be open
      await expect(clientWithCircuitBreaker.get('/endpoint-a')).rejects.toMatchObject({
        type: 'circuit_open',
      })

      // Endpoint B should still work - circuit breaker is per-endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1 },
            meta: { requestId: 'req-endpoint-b' },
          }),
      })

      const result = await clientWithCircuitBreaker.get('/endpoint-b')
      expect(result.data).toEqual({ id: 1 })

      // Endpoint A is still open
      await expect(clientWithCircuitBreaker.get('/endpoint-a')).rejects.toMatchObject({
        type: 'circuit_open',
      })
    })
  })

  describe('Request Interceptors', () => {
    it('applies request interceptor before sending', async () => {
      const requestInterceptor: RequestInterceptor = vi.fn((config) => ({
        ...config,
        headers: {
          ...config.headers,
          'X-Intercepted': 'true',
        },
      }))

      const clientWithInterceptor = createApiClient({
        baseUrl: 'https://api.example.com',
        interceptors: {
          request: [requestInterceptor],
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: {},
            meta: { requestId: 'req-166' },
          }),
      })

      await clientWithInterceptor.get('/test')

      expect(requestInterceptor).toHaveBeenCalled()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Intercepted': 'true',
          }),
        })
      )
    })

    it('applies multiple request interceptors in order', async () => {
      const callOrder: string[] = []

      const firstInterceptor: RequestInterceptor = vi.fn((config) => {
        callOrder.push('first')
        return {
          ...config,
          headers: {
            ...config.headers,
            'X-First': 'value1',
          },
        }
      })

      const secondInterceptor: RequestInterceptor = vi.fn((config) => {
        callOrder.push('second')
        return {
          ...config,
          headers: {
            ...config.headers,
            'X-Second': 'value2',
          },
        }
      })

      const clientWithInterceptors = createApiClient({
        baseUrl: 'https://api.example.com',
        interceptors: {
          request: [firstInterceptor, secondInterceptor],
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: {},
            meta: { requestId: 'req-167' },
          }),
      })

      await clientWithInterceptors.get('/test')

      expect(callOrder).toEqual(['first', 'second'])
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-First': 'value1',
            'X-Second': 'value2',
          }),
        })
      )
    })

    it('injects authentication header via request interceptor', async () => {
      const authInterceptor: RequestInterceptor = (config) => ({
        ...config,
        headers: {
          ...config.headers,
          Authorization: 'Bearer auth-token-123',
        },
      })

      const clientWithAuth = createApiClient({
        baseUrl: 'https://api.example.com',
        interceptors: {
          request: [authInterceptor],
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: {},
            meta: { requestId: 'req-168' },
          }),
      })

      await clientWithAuth.get('/protected')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer auth-token-123',
          }),
        })
      )
    })

    it('applies response interceptor after receiving response', async () => {
      const responseInterceptor: ResponseInterceptor = vi.fn((response) => ({
        ...response,
        intercepted: true,
      }))

      const clientWithInterceptor = createApiClient({
        baseUrl: 'https://api.example.com',
        interceptors: {
          response: [responseInterceptor],
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1 },
            meta: { requestId: 'req-169' },
          }),
      })

      const result = await clientWithInterceptor.get('/test')

      expect(responseInterceptor).toHaveBeenCalled()
      expect((result as typeof result & { intercepted: boolean }).intercepted).toBe(true)
    })

    it('applies error interceptor on request failure', async () => {
      const errorInterceptor: ErrorInterceptor = vi.fn((error) => {
        error.handled = true
        return error
      })

      const clientWithInterceptor = createApiClient({
        baseUrl: 'https://api.example.com',
        interceptors: {
          error: [errorInterceptor],
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
        text: () => Promise.resolve('Internal Server Error'),
      })

      try {
        await clientWithInterceptor.get('/test')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const apiError = error as ApiError & { handled: boolean }
        expect(errorInterceptor).toHaveBeenCalled()
        expect(apiError.handled).toBe(true)
      }
    })

    it('allows error interceptor to trigger toast notification', async () => {
      const showToast = vi.fn()
      const errorInterceptor: ErrorInterceptor = (error) => {
        if (error.type === 'server') {
          showToast({ type: 'error', message: 'Server error occurred' })
        }
        return error
      }

      const clientWithInterceptor = createApiClient({
        baseUrl: 'https://api.example.com',
        interceptors: {
          error: [errorInterceptor],
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
        text: () => Promise.resolve('Internal Server Error'),
      })

      await expect(clientWithInterceptor.get('/test')).rejects.toBeDefined()

      expect(showToast).toHaveBeenCalledWith({
        type: 'error',
        message: 'Server error occurred',
      })
    })

    it('allows error interceptor to handle token refresh', async () => {
      const refreshToken = vi.fn().mockResolvedValue('new-token')
      let retryCount = 0

      const authErrorInterceptor: ErrorInterceptor = async (error, retry) => {
        if (error.type === 'unauthorized' && retryCount === 0) {
          retryCount++
          const newToken = await refreshToken()
          return retry({
            headers: {
              Authorization: `Bearer ${newToken}`,
            },
          })
        }
        return error
      }

      const clientWithInterceptor = createApiClient({
        baseUrl: 'https://api.example.com',
        interceptors: {
          error: [authErrorInterceptor],
        },
      })

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({
            'content-type': 'application/json',
          }),
          json: () =>
            Promise.resolve({
              success: false,
              error: {
                code: 'UNAUTHORIZED',
                message: 'Token expired',
                requestId: 'req-170',
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
          }),
          json: () =>
            Promise.resolve({
              success: true,
              data: { id: 1 },
              meta: { requestId: 'req-171' },
            }),
        })

      const result = await clientWithInterceptor.get('/protected')

      expect(refreshToken).toHaveBeenCalled()
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.data).toEqual({ id: 1 })
    })
  })

  describe('Type Safety', () => {
    it('returns typed response data', async () => {
      interface User {
        id: number
        name: string
        email: string
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1, name: 'Test User', email: 'test@example.com' },
            meta: { requestId: 'req-172' },
          }),
      })

      const result = await client.get<User>('/users/1')

      // TypeScript should infer result.data as User
      const user: User = result.data
      expect(user.id).toBe(1)
      expect(user.name).toBe('Test User')
      expect(user.email).toBe('test@example.com')
    })

    it('accepts typed request body', async () => {
      interface CreateUserRequest {
        name: string
        email: string
      }

      interface User {
        id: number
        name: string
        email: string
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 1, name: 'New User', email: 'new@example.com' },
            meta: { requestId: 'req-173' },
          }),
      })

      const requestBody: CreateUserRequest = {
        name: 'New User',
        email: 'new@example.com',
      }

      const result = await client.post<User, CreateUserRequest>(
        '/users',
        requestBody
      )

      expect(result.data.id).toBe(1)
    })

    it('provides typed error handling', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Validation failed',
              fields: {
                email: 'Invalid email',
              },
              requestId: 'req-174',
            },
          }),
      })

      try {
        await client.post('/users', {})
        expect.fail('Should have thrown an error')
      } catch (error) {
        // TypeScript should narrow error to ApiError
        const apiError = error as ApiError
        expect(apiError.type).toBe('validation')
        expect(apiError.fields?.email).toBe('Invalid email')
      }
    })
  })

  describe('Utility Functions', () => {
    describe('classifyError', () => {
      it('classifies network TypeError as network error', () => {
        const result = classifyError(new TypeError('Failed to fetch'))
        expect(result).toBe('network')
      })

      it('classifies AbortError as timeout', () => {
        const result = classifyError(new DOMException('Aborted', 'AbortError'))
        expect(result).toBe('timeout')
      })

      it('classifies status 400 as client error', () => {
        const result = classifyError(null, 400)
        expect(result).toBe('client')
      })

      it('classifies status 401 as unauthorized', () => {
        const result = classifyError(null, 401)
        expect(result).toBe('unauthorized')
      })

      it('classifies status 403 as forbidden', () => {
        const result = classifyError(null, 403)
        expect(result).toBe('forbidden')
      })

      it('classifies status 404 as not_found', () => {
        const result = classifyError(null, 404)
        expect(result).toBe('not_found')
      })

      it('classifies status 409 as conflict', () => {
        const result = classifyError(null, 409)
        expect(result).toBe('conflict')
      })

      it('classifies status 412 as precondition_failed', () => {
        const result = classifyError(null, 412)
        expect(result).toBe('precondition_failed')
      })

      it('classifies status 422 as validation', () => {
        const result = classifyError(null, 422)
        expect(result).toBe('validation')
      })

      it('classifies status 429 as rate_limited', () => {
        const result = classifyError(null, 429)
        expect(result).toBe('rate_limited')
      })

      it('classifies status 5xx as server error', () => {
        expect(classifyError(null, 500)).toBe('server')
        expect(classifyError(null, 502)).toBe('server')
        expect(classifyError(null, 503)).toBe('server')
        expect(classifyError(null, 504)).toBe('server')
      })

      it('classifies unknown errors as unknown', () => {
        const result = classifyError(new Error('Unknown'))
        expect(result).toBe('unknown')
      })
    })

    describe('isRetryableError', () => {
      it('returns true for network errors', () => {
        expect(isRetryableError({ type: 'network' } as ApiError)).toBe(true)
      })

      it('returns true for timeout errors', () => {
        expect(isRetryableError({ type: 'timeout' } as ApiError)).toBe(true)
      })

      it('returns true for server errors', () => {
        expect(isRetryableError({ type: 'server' } as ApiError)).toBe(true)
      })

      it('returns true for rate limited errors', () => {
        expect(isRetryableError({ type: 'rate_limited' } as ApiError)).toBe(true)
      })

      it('returns false for client errors', () => {
        expect(isRetryableError({ type: 'client' } as ApiError)).toBe(false)
      })

      it('returns false for validation errors', () => {
        expect(isRetryableError({ type: 'validation' } as ApiError)).toBe(false)
      })

      it('returns false for not found errors', () => {
        expect(isRetryableError({ type: 'not_found' } as ApiError)).toBe(false)
      })

      it('returns false for unauthorized errors', () => {
        expect(isRetryableError({ type: 'unauthorized' } as ApiError)).toBe(false)
      })

      it('returns false for forbidden errors', () => {
        expect(isRetryableError({ type: 'forbidden' } as ApiError)).toBe(false)
      })
    })

    describe('isIdempotentMethod', () => {
      it('returns true for GET', () => {
        expect(isIdempotentMethod('GET')).toBe(true)
      })

      it('returns true for PUT', () => {
        expect(isIdempotentMethod('PUT')).toBe(true)
      })

      it('returns true for DELETE', () => {
        expect(isIdempotentMethod('DELETE')).toBe(true)
      })

      it('returns true for HEAD', () => {
        expect(isIdempotentMethod('HEAD')).toBe(true)
      })

      it('returns true for OPTIONS', () => {
        expect(isIdempotentMethod('OPTIONS')).toBe(true)
      })

      it('returns false for POST', () => {
        expect(isIdempotentMethod('POST')).toBe(false)
      })

      it('returns false for PATCH', () => {
        expect(isIdempotentMethod('PATCH')).toBe(false)
      })
    })
  })

  describe('Connection Monitor Integration', () => {
    it('fails fast with a network error when monitor is offline', async () => {
      // Trip the monitor offline via two consecutive network failures
      mockFetch.mockRejectedValue(new TypeError('NetworkError'))
      await client.get('/first').catch(() => undefined)
      await client.get('/second').catch(() => undefined)
      mockFetch.mockReset()

      // Subsequent requests must NOT hit fetch
      await expect(client.get('/third')).rejects.toMatchObject({
        type: 'network',
        message: 'Cannot reach the backend at https://api.example.com',
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('reports the diagnosed reason when a request never reaches the backend', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(client.get('/dashboard')).rejects.toMatchObject({
        type: 'network',
        message: 'Cannot reach the backend at https://api.example.com',
      })
    })

    it('names the rejected origin when the backend answers the diagnosis probe', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(undefined)
      const origin = globalThis.location.origin

      await expect(client.get('/dashboard')).rejects.toMatchObject({
        type: 'network',
        message:
          `The backend at https://api.example.com is running but rejected requests from ${origin}. ` +
          `Add ${origin} to its allowed origins.`,
      })
    })

    it('reports success on a 2xx response so the counter resets', async () => {
      // One failure on the counter
      mockFetch.mockRejectedValueOnce(new TypeError('NetworkError'))
      await client.get('/probe').catch(() => undefined)

      // A success resets the counter so the next failure does not trip
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
      )
      await client.get('/ok')

      mockFetch.mockRejectedValueOnce(new TypeError('NetworkError'))
      await client.get('/another').catch(() => undefined)

      // Still online - one failure since the success
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
      )
      await expect(client.get('/final')).resolves.toMatchObject({ status: 200 })
    })

    it('treats 4xx/5xx responses as BE reachable (does not trip)', async () => {
      // Two consecutive 5xx responses must NOT trip the monitor
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }),
      )
      await client.get('/boom').catch(() => undefined)

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'still boom' } }), { status: 500 }),
      )
      await client.get('/boom').catch(() => undefined)

      // Should still be reachable - the next request hits fetch
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
      )
      await client.get('/ok')

      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('trips immediately on a single 502 from the Vite proxy', async () => {
      // 502 from Vite is an unambiguous BE-outage signal, no threshold
      mockFetch.mockResolvedValueOnce(
        new Response('{}', { status: 502 }),
      )
      await client.get('/something').catch(() => undefined)
      mockFetch.mockReset()

      await expect(client.get('/something')).rejects.toMatchObject({
        type: 'network',
        message: 'Cannot reach the backend at https://api.example.com',
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('trips immediately on a single 504 from the Vite proxy', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{}', { status: 504 }),
      )
      await client.get('/something').catch(() => undefined)
      mockFetch.mockReset()

      await expect(client.get('/something')).rejects.toMatchObject({
        type: 'network',
        message: 'Cannot reach the backend at https://api.example.com',
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('trips on consecutive timeout (AbortError) errors', async () => {
      const abortError = new DOMException('Aborted', 'AbortError')
      mockFetch.mockRejectedValueOnce(abortError)
      mockFetch.mockRejectedValueOnce(abortError)

      await client.get('/slow').catch(() => undefined)
      await client.get('/slow').catch(() => undefined)
      mockFetch.mockReset()

      await expect(client.get('/slow')).rejects.toMatchObject({
        type: 'network',
        message: 'Cannot reach the backend at https://api.example.com',
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
