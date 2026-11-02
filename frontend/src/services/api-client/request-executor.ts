/**
 * Request Executor - REQ-5.2.1.3 REST API client layer with error handling
 *
 * Low-level fetch execution with timeout enforcement, response parsing,
 * and URL construction utilities.
 */

import type {
  ApiResponse,
  CursorBasedPaginationParams,
  PageBasedPaginationParams,
  RequestConfig,
  RetryConfig,
} from './types'

// ============================================================================
// URL Building
// ============================================================================

/**
 * Builds URL with query parameters and pagination.
 *
 * Concatenates baseUrl + path rather than using `new URL(path, baseUrl)`
 * - the URL constructor's "absolute path replaces base path" rule would
 * clobber a `/api` (or any) prefix on the baseUrl, which we rely on to
 * route requests through Vite's same-origin proxy in dev.
 */
export function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean>,
  pagination?: PageBasedPaginationParams | CursorBasedPaginationParams
): string {
  const url = new URL(`${baseUrl}${path}`)

  // Add regular params
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value))
    })
  }

  // Add pagination params
  if (pagination) {
    if ('page' in pagination) {
      // Page-based pagination
      url.searchParams.append('page', String(pagination.page))
      url.searchParams.append('pageSize', String(pagination.pageSize))
    } else {
      // Cursor-based pagination
      if (pagination.cursor) {
        url.searchParams.append('cursor', pagination.cursor)
      }
      url.searchParams.append('limit', String(pagination.limit))
    }
  }

  return url.toString()
}

// ============================================================================
// Retry Utilities
// ============================================================================

/**
 * Sleep for delay ms
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calculate delay for retry attempt with exponential backoff
 */
export function calculateRetryDelay(attempt: number, retryConfig: RetryConfig): number {
  const delay = retryConfig.baseDelay * Math.pow(retryConfig.backoffMultiplier, attempt)
  return Math.min(delay, retryConfig.maxDelay)
}

// ============================================================================
// Fetch Execution
// ============================================================================

/**
 * Options for executing a single fetch attempt
 */
export interface FetchAttemptOptions {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  timeout: number
  signal?: AbortSignal
}

/**
 * Executes a single fetch attempt with timeout enforcement via Promise.race.
 *
 * Returns the raw Response on success, or throws on network error/timeout.
 */
export async function executeFetchAttempt(options: FetchAttemptOptions): Promise<Response> {
  const controller = new AbortController()
  // The caller's signal rides the same controller, so an abort reaches the wire.
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  if (options.signal?.aborted) controller.abort()

  // Create a timeout promise that rejects when timeout expires
  // This ensures reliable timeout enforcement via Promise.race
  let timeoutId: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<Response>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new DOMException('Aborted', 'AbortError'))
    }, options.timeout)
  })

  const fetchOptions: RequestInit = {
    method: options.method,
    headers: options.headers,
    signal: controller.signal,
    cache: 'no-store',
  }

  if (options.body !== undefined) {
    fetchOptions.body = options.body
  }

  const fetchPromise = fetch(options.url, fetchOptions)

  // The promise that loses the race still settles; these handlers keep its
  // rejection from surfacing as an unhandled one. Promise.race below reads the
  // originals, so rejection still propagates to the caller.
  fetchPromise.catch(() => undefined)
  timeoutPromise.catch(() => undefined)

  let response: Response
  try {
    // Race the original promises (not the safe ones) to get proper rejection propagation
    response = await Promise.race([fetchPromise, timeoutPromise])
  } catch (raceError) {
    // Clear timeout before re-throwing
    clearTimeout(timeoutId!)
    throw raceError
  }
  // Clear timeout on success
  clearTimeout(timeoutId!)

  return response
}

// ============================================================================
// Response Building
// ============================================================================

/**
 * Builds an ApiResponse from a successful HTTP Response.
 *
 * Handles 204 No Content, envelope unwrapping vs raw mode,
 * and extraction of ETag / Cache-Control headers.
 */
export async function buildApiResponse<T, P = undefined>(
  response: Response,
  requestConfig?: RequestConfig
): Promise<ApiResponse<T, P>> {
  // Handle 204 No Content
  if (response.status === 204) {
    return {
      data: null as unknown as T,
      meta: { requestId: '' },
      status: 204,
    }
  }

  // Parse JSON response
  const json = await response.json()

  const result: ApiResponse<T, P> = requestConfig?.rawResponse
    ? {
        data: json as T,
        meta: { requestId: '' },
        status: response.status,
      }
    : {
        data: json.data,
        meta: { requestId: '', ...json.meta },
        status: response.status,
        pagination: json.pagination,
      }

  // Extract ETag
  const etag = response.headers.get('etag')
  if (etag) {
    result.etag = etag
  }

  // Extract Cache-Control
  const cacheControl = response.headers.get('cache-control')
  if (cacheControl) {
    result.cacheControl = cacheControl
  }

  return result
}
