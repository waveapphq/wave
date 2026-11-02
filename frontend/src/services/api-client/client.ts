/**
 * REST API Client - REQ-5.2.1.3 REST API client layer with error handling
 *
 * This module provides a unified abstraction for all HTTP communication between
 * the frontend application and the backend API server.
 */

import type {
  ApiClient,
  ApiClientConfig,
  ApiError,
  ApiResponse,
  RequestConfig,
} from './types'
import {
  classifyError,
  createApiError,
  createApiErrorFromException,
  isIdempotentMethod,
  isRetryableError,
  parseErrorResponse,
} from './errors'
import { createCircuitBreakerManager } from './circuit-breaker'
import {
  buildUrl,
  sleep,
  calculateRetryDelay,
  executeFetchAttempt,
  buildApiResponse,
} from './request-executor'
import {
  reportFailure as reportConnectionFailure,
  reportSuccess as reportConnectionSuccess,
  resolveOfflineReason,
  useConnectionMonitor,
} from '@/services/connection-monitor'
import { unreachableMessage } from '@/services/connection-monitor/diagnose'

// ============================================================================
// Client Factory
// ============================================================================

const DEFAULT_TIMEOUT = 30000

/** Whole milliseconds elapsed since a performance.now() mark */
function elapsedMs(startMark: number): number {
  return Math.round(performance.now() - startMark)
}

/**
 * Prevent unhandled rejection warnings when a promise is not immediately awaited.
 * Attaches a no-op handler so async consumers can handle rejections at their own pace,
 * but returns the original promise so the caller can still await/catch it.
 */
function wrapPromise<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {
    // Intentionally empty - just marking as handled
  })
  return promise
}

/**
 * Creates an API client instance with the given configuration
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  // Validate config
  if (!config.baseUrl) {
    throw new Error('baseUrl is required')
  }

  // Apply defaults
  const resolvedConfig: ApiClientConfig = {
    ...config,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
  }

  // Circuit breaker manager
  const circuitBreaker = createCircuitBreakerManager(config.circuitBreaker)

  /** Build the intercepted request configuration */
  function prepareRequest(
    method: string,
    path: string,
    body: unknown,
    requestConfig?: RequestConfig,
  ) {
    const url = buildUrl(config.baseUrl, path, requestConfig?.params, requestConfig?.pagination)
    const headers: Record<string, string> = {
      ...config.defaultHeaders,
      ...requestConfig?.headers,
    }
    // A content type on a bodyless request buys nothing and costs a CORS preflight.
    if (body === undefined) {
      delete headers['Content-Type']
    }
    if (requestConfig?.etag) {
      headers['If-Match'] = requestConfig.etag
    }

    let interceptedConfig: RequestConfig & { method: string; url: string; body?: unknown } = {
      ...requestConfig, method, url, body, headers,
    }
    if (config.interceptors?.request) {
      for (const interceptor of config.interceptors.request) {
        interceptedConfig = interceptor(interceptedConfig)
      }
    }
    return interceptedConfig
  }

  /** Apply response interceptors and return the final result */
  async function applyResponseInterceptors<T, P>(
    result: ApiResponse<T, P>,
  ): Promise<ApiResponse<T, P>> {
    if (!config.interceptors?.response) return result
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let interceptedResponse: any = result
    for (const interceptor of config.interceptors.response) {
      interceptedResponse = interceptor(interceptedResponse)
    }
    return interceptedResponse as ApiResponse<T, P>
  }

  /** Handle a non-OK HTTP response and return the resulting ApiError */
  async function handleErrorResponse(
    response: Response,
    path: string,
    method: string,
    durationMs: number,
  ): Promise<ApiError> {
    circuitBreaker.recordFailure(path)
    const errorData = await parseErrorResponse(response)
    const errorType = classifyError(null, response.status)
    const retryAfterHeader = response.headers.get('retry-after')
    const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined

    return createApiError({
      type: errorType,
      message: errorData.message,
      status: response.status,
      code: errorData.code,
      requestId: errorData.requestId,
      fields: errorData.fields,
      details: errorData.details,
      resourceType: errorData.resourceType,
      resourceId: errorData.resourceId,
      retryAfter,
      userMessage: errorData.userMessage,
      method,
      path,
      statusText: response.statusText || undefined,
      durationMs,
    })
  }

  /** Apply error interceptors, potentially recovering with a retry */
  async function applyErrorInterceptors<T, P>(
    lastError: ApiError,
    method: string,
    path: string,
    body: unknown,
    requestConfig?: RequestConfig,
  ): Promise<ApiResponse<T, P> | ApiError> {
    if (!config.interceptors?.error) return lastError
    let err = lastError
    for (const interceptor of config.interceptors.error) {
      const retryFn = (overrides?: RequestConfig): Promise<ApiResponse<unknown>> =>
        request(method, path, body, { ...requestConfig, ...overrides })
      const result = await interceptor(err, retryFn)
      if ('data' in result) return result as ApiResponse<T, P>
      err = result
    }
    return err
  }

  /** Determine the max number of retry attempts for a request */
  function resolveMaxAttempts(method: string, requestConfig?: RequestConfig): number {
    const shouldRetry =
      requestConfig?.retry === true ||
      (requestConfig?.retry !== false && isIdempotentMethod(method))
    return shouldRetry && config.retry ? config.retry.maxRetries + 1 : 1
  }

  /** Execute a single fetch attempt, returning either a success response or an error */
  async function executeSingleRequest<T, P>(
    interceptedConfig: { url: string; method: string; headers?: Record<string, string> },
    body: unknown,
    method: string,
    path: string,
    timeout: number,
    requestConfig?: RequestConfig,
  ): Promise<{ response: ApiResponse<T, P> } | { error: ApiError }> {
    const startMark = performance.now()
    try {
      const fetchBody =
        body !== undefined && method !== 'GET' && method !== 'HEAD'
          ? JSON.stringify(body) : undefined

      const response = await executeFetchAttempt({
        url: interceptedConfig.url,
        method: interceptedConfig.method,
        headers: interceptedConfig.headers as Record<string, string>,
        body: fetchBody,
        timeout,
        signal: requestConfig?.signal,
      })

      if (response.ok) {
        circuitBreaker.recordSuccess(path)
        reportConnectionSuccess()
        const result = await buildApiResponse<T, P>(response, requestConfig)
        return { response: await applyResponseInterceptors(result) }
      }

      // 502/504 from Vite's proxy mean the BE is unreachable from Vite -
      // an unambiguous outage signal, so trip the monitor immediately.
      // Any other 4xx/5xx is BE answering with an error, which is
      // reachability.
      if (response.status === 502 || response.status === 504) {
        reportConnectionFailure(true)
      } else {
        reportConnectionSuccess()
      }
      return { error: await handleErrorResponse(response, path, method, elapsedMs(startMark)) }
    } catch (error) {
      circuitBreaker.recordFailure(path)
      const apiError = createApiErrorFromException(error, {
        method,
        path,
        durationMs: elapsedMs(startMark),
      })
      // Network and timeout errors are the signal that BE is unreachable;
      // 4xx/5xx already returned via the response branch above.
      if (apiError.type === 'network' || apiError.type === 'timeout') {
        reportConnectionFailure()
      }
      return { error: apiError }
    }
  }

  /**
   * Make an HTTP request
   */
  async function request<T, P = undefined>(
    method: string,
    path: string,
    body?: unknown,
    requestConfig?: RequestConfig
  ): Promise<ApiResponse<T, P>> {
    // When the global connection monitor has tripped offline, fail fast
    // instead of generating another 30s-hung socket. The monitor's probe
    // loop is already polling /health and will resume traffic when BE
    // answers.
    const monitor = useConnectionMonitor.getState()
    if (monitor.status === 'offline') {
      throw createApiError({
        type: 'network',
        message: monitor.offlineReason ?? unreachableMessage(config.baseUrl),
        method,
        path,
      })
    }

    if (circuitBreaker.shouldBlockRequest(path)) {
      throw createApiError({
        type: 'circuit_open',
        message: 'Circuit breaker is open',
        method,
        path,
      })
    }

    const interceptedConfig = prepareRequest(method, path, body, requestConfig)
    const maxAttempts = resolveMaxAttempts(method, requestConfig)
    let lastError: ApiError | undefined
    const timeout = requestConfig?.timeout ?? resolvedConfig.timeout!

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await executeSingleRequest<T, P>(
        interceptedConfig, body, method, path, timeout, requestConfig,
      )

      if ('response' in result) return result.response

      lastError = result.error
      if (!isRetryableError(lastError)) break

      // Wait before retry if we have more attempts
      const canRetry = attempt < maxAttempts - 1 && config.retry
      if (canRetry) {
        await sleep(calculateRetryDelay(attempt, config.retry!))
      }
    }

    // Apply error interceptors (may recover) - lastError is always set after retry loop
    // (set in both try-catch branches of every iteration)
    const interceptResult = await applyErrorInterceptors<T, P>(lastError!, method, path, body, requestConfig)
    if ('data' in interceptResult) return interceptResult
    if (interceptResult.type === 'network') {
      interceptResult.message = await resolveOfflineReason(config.baseUrl)
    }
    throw interceptResult
  }

  /**
   * Wrapper that triggers cache invalidation on success
   */
  async function requestWithCacheInvalidation<T, P = undefined>(
    method: string,
    path: string,
    body?: unknown,
    requestConfig?: RequestConfig
  ): Promise<ApiResponse<T, P>> {
    const result = await request<T, P>(method, path, body, requestConfig)

    // Invalidate cache on successful mutation
    if (
      config.onCacheInvalidation &&
      method !== 'GET' &&
      method !== 'HEAD' &&
      result.status >= 200 &&
      result.status < 300
    ) {
      config.onCacheInvalidation(path)
    }

    return result
  }

  return {
    get<T, P = undefined>(
      path: string,
      requestConfig?: RequestConfig
    ): Promise<ApiResponse<T, P>> {
      return wrapPromise(request<T, P>('GET', path, undefined, requestConfig))
    },

    post<T, B = unknown>(
      path: string,
      body?: B,
      requestConfig?: RequestConfig
    ): Promise<ApiResponse<T>> {
      return wrapPromise(
        requestWithCacheInvalidation<T>('POST', path, body, requestConfig)
      )
    },

    put<T, B = unknown>(
      path: string,
      body?: B,
      requestConfig?: RequestConfig
    ): Promise<ApiResponse<T>> {
      return wrapPromise(
        requestWithCacheInvalidation<T>('PUT', path, body, requestConfig)
      )
    },

    patch<T, B = unknown>(
      path: string,
      body?: B,
      requestConfig?: RequestConfig
    ): Promise<ApiResponse<T>> {
      return wrapPromise(
        requestWithCacheInvalidation<T>('PATCH', path, body, requestConfig)
      )
    },

    delete<T = null, B = unknown>(
      path: string,
      body?: B,
      requestConfig?: RequestConfig
    ): Promise<ApiResponse<T>> {
      return wrapPromise(
        requestWithCacheInvalidation<T>('DELETE', path, body, requestConfig)
      )
    },

    getConfig(): ApiClientConfig {
      return resolvedConfig
    },
  }
}
