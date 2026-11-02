/**
 * REST API Client Types - REQ-5.2.1.3 REST API client layer with error handling
 *
 * Type definitions for the API client layer including request/response types,
 * pagination, retry configuration, circuit breaker configuration, and interceptors.
 */

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error types for classifying API errors
 */
export type ApiErrorType =
  | 'network'
  | 'timeout'
  | 'client'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'precondition_failed'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'circuit_open'
  | 'unknown'

/**
 * Structured API error with full context
 */
export interface ApiError extends Error {
  type: ApiErrorType
  status?: number
  code?: string
  requestId?: string
  fields?: Record<string, string>
  details?: Array<Record<string, unknown>>
  resourceType?: string
  resourceId?: string
  retryAfter?: number
  isRetryable: boolean
  requiresRefresh?: boolean
  userMessage?: string
  handled?: boolean
  method?: string
  /** Request path, not the full URL */
  path?: string
  /** HTTP reason phrase, empty over HTTP/2 */
  statusText?: string
  /** Whole milliseconds from request start to failure */
  durationMs?: number
  /** ISO 8601 instant the error was created */
  occurredAt?: string
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Response metadata from backend
 */
export interface ResponseMeta {
  timestamp?: string
  apiVersion?: string
  requestId: string
}

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T, P = undefined> {
  data: T
  meta: ResponseMeta
  status: number
  etag?: string
  cacheControl?: string
  pagination?: P
}

// ============================================================================
// Pagination Types
// ============================================================================

/**
 * Page-based pagination info
 */
export interface PaginatedResponse {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasNextPage?: boolean
  hasPreviousPage?: boolean
}

/**
 * Cursor-based pagination info
 */
export interface CursorBasedPaginationResponse {
  cursor: string | null
  hasMore: boolean
}

/**
 * Page-based pagination parameters
 */
export interface PageBasedPaginationParams {
  page: number
  pageSize: number
}

/**
 * Cursor-based pagination parameters
 */
export interface CursorBasedPaginationParams {
  cursor?: string
  limit: number
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number
  resetTimeout: number
}

/**
 * Request configuration for individual requests
 */
export interface RequestConfig {
  headers?: Record<string, string>
  timeout?: number
  params?: Record<string, string | number | boolean>
  pagination?: PageBasedPaginationParams | CursorBasedPaginationParams
  etag?: string
  retry?: boolean
  /** When true, return the raw JSON body as `data` instead of unwrapping `{ data, meta }` envelope */
  rawResponse?: boolean
  /** Aborts the request when the caller supersedes it, e.g. the next keystroke of an editor */
  signal?: AbortSignal
}

// ============================================================================
// Interceptor Types
// ============================================================================

/**
 * Request interceptor function
 */
export type RequestInterceptor = (
  config: RequestConfig & { method: string; url: string; body?: unknown }
) => RequestConfig & { method: string; url: string; body?: unknown }

/**
 * Response interceptor function
 */
export type ResponseInterceptor<T = unknown> = (
  response: ApiResponse<T>
) => ApiResponse<T> | (ApiResponse<T> & Record<string, unknown>)

/**
 * Error interceptor function with retry capability
 */
export type ErrorInterceptor = (
  error: ApiError,
  retry: (overrides?: RequestConfig) => Promise<ApiResponse<unknown>>
) => ApiError | Promise<ApiError | ApiResponse<unknown>>

/**
 * Interceptors configuration
 */
export interface Interceptors {
  request?: RequestInterceptor[]
  response?: ResponseInterceptor[]
  error?: ErrorInterceptor[]
}

// ============================================================================
// Client Types
// ============================================================================

/**
 * API client configuration
 */
export interface ApiClientConfig {
  baseUrl: string
  defaultHeaders?: Record<string, string>
  timeout?: number
  retry?: RetryConfig
  circuitBreaker?: CircuitBreakerConfig
  interceptors?: Interceptors
  onCacheInvalidation?: (path: string) => void
}

/**
 * API client interface
 */
export interface ApiClient {
  get<T, P = undefined>(
    path: string,
    config?: RequestConfig
  ): Promise<ApiResponse<T, P>>
  post<T, B = unknown>(
    path: string,
    body?: B,
    config?: RequestConfig
  ): Promise<ApiResponse<T>>
  put<T, B = unknown>(
    path: string,
    body?: B,
    config?: RequestConfig
  ): Promise<ApiResponse<T>>
  patch<T, B = unknown>(
    path: string,
    body?: B,
    config?: RequestConfig
  ): Promise<ApiResponse<T>>
  delete<T = null, B = unknown>(path: string, body?: B, config?: RequestConfig): Promise<ApiResponse<T>>
  getConfig(): ApiClientConfig
}
