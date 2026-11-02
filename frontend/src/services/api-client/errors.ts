/**
 * API Error Handling - REQ-5.2.1.3 REST API client layer with error handling
 *
 * Error classification, creation, retryability determination, and response parsing
 * for the API client layer.
 */

import type { ApiError, ApiErrorType } from './types'

// ============================================================================
// Error Classification
// ============================================================================

const STATUS_TO_ERROR_TYPE: Record<number, ApiErrorType> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  412: 'precondition_failed',
  422: 'validation',
  429: 'rate_limited',
}

function classifyByStatus(status: number): ApiErrorType {
  const mapped = STATUS_TO_ERROR_TYPE[status]
  if (mapped) return mapped
  if (status >= 400 && status < 500) return 'client'
  if (status >= 500) return 'server'
  return 'unknown'
}

/**
 * Classifies an error into an ApiErrorType
 */
export function classifyError(error: unknown, status?: number): ApiErrorType {
  if (error instanceof TypeError) return 'network'
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout'
  if (status !== undefined) return classifyByStatus(status)
  return 'unknown'
}

/**
 * Determines if an error is retryable
 */
export function isRetryableError(error: ApiError): boolean {
  const retryableTypes: ApiErrorType[] = [
    'network',
    'timeout',
    'server',
    'rate_limited',
  ]
  return retryableTypes.includes(error.type)
}

/**
 * Determines if an HTTP method is idempotent
 */
export function isIdempotentMethod(method: string): boolean {
  const idempotentMethods = ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']
  return idempotentMethods.includes(method.toUpperCase())
}

// ============================================================================
// Error Creation
// ============================================================================

/**
 * Options for creating an ApiError
 */
export interface CreateApiErrorOptions {
  type: ApiErrorType
  message: string
  status?: number
  code?: string
  requestId?: string
  fields?: Record<string, string>
  details?: Array<Record<string, unknown>>
  resourceType?: string
  resourceId?: string
  retryAfter?: number
  userMessage?: string
  method?: string
  path?: string
  statusText?: string
  durationMs?: number
  occurredAt?: string
}

/**
 * Creates an ApiError object
 */
export function createApiError(options: CreateApiErrorOptions): ApiError {
  const error = new Error(options.message) as ApiError
  error.type = options.type
  error.status = options.status
  error.code = options.code
  error.requestId = options.requestId
  error.fields = options.fields
  error.details = options.details
  error.resourceType = options.resourceType
  error.resourceId = options.resourceId
  error.retryAfter = options.retryAfter
  error.userMessage = options.userMessage
  error.method = options.method
  error.path = options.path
  error.statusText = options.statusText
  error.durationMs = options.durationMs
  error.occurredAt = options.occurredAt ?? new Date().toISOString()
  error.isRetryable = isRetryableError(error)

  // Special handling for conflict and precondition_failed
  if (options.type === 'conflict' || options.type === 'precondition_failed') {
    error.requiresRefresh = true
  }

  return error
}

// ============================================================================
// Error Message Extraction
// ============================================================================

/**
 * Extracts a human-readable message from an unknown caught error.
 *
 * Handles Error instances, DOMExceptions, and plain objects with a message property.
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }
  return 'Unknown error'
}

/**
 * Context describing the request that produced a caught exception
 */
export interface ExceptionRequestContext {
  method?: string
  path?: string
  durationMs?: number
}

/**
 * Creates an ApiError from a caught exception (network error, timeout, etc.)
 */
export function createApiErrorFromException(
  error: unknown,
  context?: ExceptionRequestContext
): ApiError {
  return createApiError({
    type: classifyError(error),
    message: extractErrorMessage(error),
    method: context?.method,
    path: context?.path,
    durationMs: context?.durationMs,
  })
}

// ============================================================================
// Error Response Parsing
// ============================================================================

/**
 * Parsed error response data from backend
 */
export interface ParsedErrorResponse {
  code?: string
  message: string
  fields?: Record<string, string>
  details?: Array<Record<string, unknown>>
  resourceType?: string
  resourceId?: string
  requestId?: string
  userMessage?: string
}

/** Copy known fields from a JSON error object to the result */
function applyErrorFields(result: ParsedErrorResponse, errorObj: Record<string, unknown>): void {
  const fieldNames: (keyof ParsedErrorResponse)[] = [
    'message', 'code', 'fields', 'details',
    'resourceType', 'resourceId', 'requestId', 'userMessage',
  ]
  for (const field of fieldNames) {
    if (errorObj[field]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[field] = errorObj[field]
    }
  }
}

/** Every body shape the backend uses to carry the correlation id */
interface RequestIdCarrier {
  error?: { requestId?: string; request_id?: string }
  meta?: { request_id?: string }
}

/** The id lives in one of three body shapes, else in the response header */
function resolveRequestId(
  json: RequestIdCarrier | null,
  response: Response
): string | undefined {
  return (
    json?.error?.requestId ||
    json?.error?.request_id ||
    json?.meta?.request_id ||
    response.headers.get('X-Request-ID') ||
    undefined
  )
}

/**
 * Parse error response from backend
 */
export async function parseErrorResponse(
  response: Response
): Promise<ParsedErrorResponse> {
  const contentType = response.headers.get('content-type') || ''

  const result: ParsedErrorResponse = {
    message: response.statusText,
  }

  const json = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null

  if (json?.error) {
    applyErrorFields(result, json.error)
  } else if (json?.detail) {
    // FastAPI returns errors as { detail: "message" }
    result.message = typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail)
  }

  const requestId = resolveRequestId(json, response)
  if (requestId) {
    result.requestId = requestId
  }

  return result
}

/**
 * Describes the request behind a failed raw `fetch`, plus the message to use
 * when the server sent no reason of its own.
 */
export interface ResponseFailureContext {
  method: string
  path: string
  fallback: string
}

/**
 * Builds an ApiError from a failed raw `fetch` response so the reason the
 * server sent reaches the user instead of the bare HTTP status text.
 */
export async function apiErrorFromResponse(
  response: Response,
  context: ResponseFailureContext
): Promise<ApiError> {
  const parsed = await parseErrorResponse(response)
  // parseErrorResponse falls back to the status text, so a message equal to it
  // means the body carried no reason.
  const reason = parsed.message.trim()
  const serverSaidWhy = reason !== '' && reason !== response.statusText
  const statusLabel = response.statusText || `HTTP ${response.status}`

  return createApiError({
    type: classifyError(null, response.status),
    message: serverSaidWhy ? reason : `${context.fallback}: ${statusLabel}`,
    status: response.status,
    code: parsed.code,
    requestId: parsed.requestId,
    fields: parsed.fields,
    details: parsed.details,
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    userMessage: parsed.userMessage,
    method: context.method,
    path: context.path,
    statusText: response.statusText || undefined,
  })
}
