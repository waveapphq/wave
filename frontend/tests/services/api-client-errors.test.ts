import { describe, it, expect } from 'vitest'
import {
  classifyError,
  isRetryableError,
  isIdempotentMethod,
  createApiError,
  extractErrorMessage,
  createApiErrorFromException,
  parseErrorResponse,
  apiErrorFromResponse,
} from '@/services/api-client/errors'
import type { ApiError, ApiErrorType } from '@/services/api-client/types'

// ============================================================================
// classifyError
// ============================================================================

describe('classifyError', () => {
  it('classifies TypeError as network', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('network')
  })

  it('classifies DOMException with name AbortError as timeout', () => {
    const err = new DOMException('The operation was aborted', 'AbortError')
    expect(classifyError(err)).toBe('timeout')
  })

  it('classifies DOMException with other name as unknown', () => {
    const err = new DOMException('Something else', 'NotAllowedError')
    expect(classifyError(err)).toBe('unknown')
  })

  it('classifies status 401 as unauthorized', () => {
    expect(classifyError(null, 401)).toBe('unauthorized')
  })

  it('classifies status 403 as forbidden', () => {
    expect(classifyError(null, 403)).toBe('forbidden')
  })

  it('classifies status 404 as not_found', () => {
    expect(classifyError(null, 404)).toBe('not_found')
  })

  it('classifies status 409 as conflict', () => {
    expect(classifyError(null, 409)).toBe('conflict')
  })

  it('classifies status 412 as precondition_failed', () => {
    expect(classifyError(null, 412)).toBe('precondition_failed')
  })

  it('classifies status 422 as validation', () => {
    expect(classifyError(null, 422)).toBe('validation')
  })

  it('classifies status 429 as rate_limited', () => {
    expect(classifyError(null, 429)).toBe('rate_limited')
  })

  it('classifies unmapped 4xx status as client', () => {
    expect(classifyError(null, 400)).toBe('client')
  })

  it('classifies status 500 as server', () => {
    expect(classifyError(null, 500)).toBe('server')
  })

  it('classifies status 502 as server', () => {
    expect(classifyError(null, 502)).toBe('server')
  })

  it('classifies status 200 (no error) as unknown', () => {
    expect(classifyError(null, 200)).toBe('unknown')
  })

  it('returns unknown when no error and no status', () => {
    expect(classifyError(null)).toBe('unknown')
  })
})

// ============================================================================
// isRetryableError
// ============================================================================

describe('isRetryableError', () => {
  function makeApiError(type: ApiErrorType): ApiError {
    return createApiError({ type, message: 'test' })
  }

  it.each([
    ['network', true],
    ['timeout', true],
    ['server', true],
    ['rate_limited', true],
    ['unauthorized', false],
    ['forbidden', false],
    ['not_found', false],
    ['client', false],
  ] as [ApiErrorType, boolean][])(
    'returns %s for type "%s"',
    (type, expected) => {
      expect(isRetryableError(makeApiError(type))).toBe(expected)
    }
  )
})

// ============================================================================
// isIdempotentMethod
// ============================================================================

describe('isIdempotentMethod', () => {
  it.each(['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'])(
    'returns true for %s',
    (method) => {
      expect(isIdempotentMethod(method)).toBe(true)
    }
  )

  it.each(['get', 'put', 'delete', 'head', 'options'])(
    'returns true for lowercase %s',
    (method) => {
      expect(isIdempotentMethod(method)).toBe(true)
    }
  )

  it.each(['POST', 'PATCH'])('returns false for %s', (method) => {
    expect(isIdempotentMethod(method)).toBe(false)
  })
})

// ============================================================================
// createApiError
// ============================================================================

describe('createApiError', () => {
  it('creates an error with all fields', () => {
    const error = createApiError({
      type: 'validation',
      message: 'Invalid input',
      status: 422,
      code: 'INVALID_FIELD',
      requestId: 'req-123',
      fields: { name: 'required' },
      details: [{ field: 'name', issue: 'blank' }],
      resourceType: 'test',
      resourceId: 'test-1',
      retryAfter: 30,
      userMessage: 'Please fix the input',
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Invalid input')
    expect(error.type).toBe('validation')
    expect(error.status).toBe(422)
    expect(error.code).toBe('INVALID_FIELD')
    expect(error.requestId).toBe('req-123')
    expect(error.fields).toEqual({ name: 'required' })
    expect(error.details).toEqual([{ field: 'name', issue: 'blank' }])
    expect(error.resourceType).toBe('test')
    expect(error.resourceId).toBe('test-1')
    expect(error.retryAfter).toBe(30)
    expect(error.userMessage).toBe('Please fix the input')
  })

  it('sets isRetryable based on type', () => {
    const retryable = createApiError({ type: 'network', message: 'fail' })
    expect(retryable.isRetryable).toBe(true)

    const notRetryable = createApiError({ type: 'not_found', message: 'missing' })
    expect(notRetryable.isRetryable).toBe(false)
  })

  it('sets requiresRefresh for conflict', () => {
    const error = createApiError({ type: 'conflict', message: 'conflict' })
    expect(error.requiresRefresh).toBe(true)
  })

  it('sets requiresRefresh for precondition_failed', () => {
    const error = createApiError({
      type: 'precondition_failed',
      message: 'stale',
    })
    expect(error.requiresRefresh).toBe(true)
  })

  it('does not set requiresRefresh for other types', () => {
    const types: ApiErrorType[] = [
      'network',
      'timeout',
      'client',
      'unauthorized',
      'forbidden',
      'not_found',
      'validation',
      'rate_limited',
      'server',
      'unknown',
    ]
    for (const type of types) {
      const error = createApiError({ type, message: 'test' })
      expect(error.requiresRefresh).toBeUndefined()
    }
  })

  it('assigns the failure context fields from options', () => {
    const error = createApiError({
      type: 'server',
      message: 'boom',
      method: 'GET',
      path: '/environments/names',
      statusText: 'Internal Server Error',
      durationMs: 1421,
      occurredAt: '2026-08-10T15:42:09.000Z',
    })

    expect(error.method).toBe('GET')
    expect(error.path).toBe('/environments/names')
    expect(error.statusText).toBe('Internal Server Error')
    expect(error.durationMs).toBe(1421)
    expect(error.occurredAt).toBe('2026-08-10T15:42:09.000Z')
  })

  it('stamps occurredAt when the caller does not supply one', () => {
    const before = Date.now()
    const error = createApiError({ type: 'server', message: 'boom' })
    const after = Date.now()

    expect(typeof error.occurredAt).toBe('string')
    const stamped = Date.parse(error.occurredAt!)
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(after)
  })

  it('leaves the failure context undefined when it is not supplied', () => {
    const error = createApiError({ type: 'server', message: 'boom' })

    expect(error.method).toBeUndefined()
    expect(error.path).toBeUndefined()
    expect(error.statusText).toBeUndefined()
    expect(error.durationMs).toBeUndefined()
  })
})

// ============================================================================
// extractErrorMessage
// ============================================================================

describe('extractErrorMessage', () => {
  it('returns message from Error instance', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns message from object with string message property', () => {
    expect(extractErrorMessage({ message: 'oops' })).toBe('oops')
  })

  it('returns Unknown error for object with non-string message', () => {
    expect(extractErrorMessage({ message: 42 })).toBe('Unknown error')
  })

  it('returns Unknown error for a string', () => {
    expect(extractErrorMessage('some string')).toBe('Unknown error')
  })

  it('returns Unknown error for null', () => {
    expect(extractErrorMessage(null)).toBe('Unknown error')
  })

  it('returns Unknown error for undefined', () => {
    expect(extractErrorMessage(undefined)).toBe('Unknown error')
  })
})

// ============================================================================
// createApiErrorFromException
// ============================================================================

describe('createApiErrorFromException', () => {
  it('wraps a TypeError as a network ApiError', () => {
    const error = createApiErrorFromException(new TypeError('Failed to fetch'))
    expect(error.type).toBe('network')
    expect(error.message).toBe('Failed to fetch')
    expect(error.isRetryable).toBe(true)
  })

  it('wraps a DOMException AbortError as a timeout ApiError', () => {
    const error = createApiErrorFromException(
      new DOMException('Aborted', 'AbortError')
    )
    expect(error.type).toBe('timeout')
    expect(error.message).toBe('Aborted')
    expect(error.isRetryable).toBe(true)
  })

  it('wraps an unknown value as an unknown ApiError', () => {
    const error = createApiErrorFromException(42)
    expect(error.type).toBe('unknown')
    expect(error.message).toBe('Unknown error')
  })

  it('forwards the request context when one is supplied', () => {
    const error = createApiErrorFromException(new TypeError('Failed to fetch'), {
      method: 'GET',
      path: '/environments/names',
      durationMs: 87,
    })

    expect(error.method).toBe('GET')
    expect(error.path).toBe('/environments/names')
    expect(error.durationMs).toBe(87)
  })

  it('leaves the request context undefined when called with one argument', () => {
    const error = createApiErrorFromException(new TypeError('Failed to fetch'))

    expect(error.method).toBeUndefined()
    expect(error.path).toBeUndefined()
    expect(error.durationMs).toBeUndefined()
  })
})

// ============================================================================
// parseErrorResponse
// ============================================================================

describe('parseErrorResponse', () => {
  function mockResponse(options: {
    status?: number
    statusText?: string
    contentType?: string
    body?: unknown
    jsonFails?: boolean
    requestIdHeader?: string
  }): Response {
    const headers = new Headers()
    if (options.contentType) {
      headers.set('content-type', options.contentType)
    }
    if (options.requestIdHeader) {
      headers.set('X-Request-ID', options.requestIdHeader)
    }

    return {
      status: options.status ?? 500,
      statusText: options.statusText ?? 'Internal Server Error',
      headers,
      json: options.jsonFails
        ? () => Promise.reject(new Error('parse error'))
        : () => Promise.resolve(options.body),
    } as unknown as Response
  }

  it('returns statusText only for non-JSON content type', async () => {
    const result = await parseErrorResponse(
      mockResponse({
        statusText: 'Bad Request',
        contentType: 'text/plain',
      })
    )
    expect(result).toEqual({ message: 'Bad Request' })
  })

  it('extracts fields from JSON { error: { message, code, fields } }', async () => {
    const result = await parseErrorResponse(
      mockResponse({
        statusText: 'Unprocessable Entity',
        contentType: 'application/json',
        body: {
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            fields: { email: 'invalid format' },
          },
        },
      })
    )
    expect(result.message).toBe('Validation failed')
    expect(result.code).toBe('VALIDATION_ERROR')
    expect(result.fields).toEqual({ email: 'invalid format' })
  })

  it('uses detail string from JSON { detail: "string" }', async () => {
    const result = await parseErrorResponse(
      mockResponse({
        statusText: 'Not Found',
        contentType: 'application/json',
        body: { detail: 'Resource not found' },
      })
    )
    expect(result.message).toBe('Resource not found')
  })

  it('JSON.stringifies non-string detail from JSON { detail: { ... } }', async () => {
    const detailObj = { loc: ['body', 'name'], msg: 'required', type: 'value_error' }
    const result = await parseErrorResponse(
      mockResponse({
        statusText: 'Unprocessable Entity',
        contentType: 'application/json',
        body: { detail: detailObj },
      })
    )
    expect(result.message).toBe(JSON.stringify(detailObj))
  })

  it('returns statusText when JSON parsing fails', async () => {
    const result = await parseErrorResponse(
      mockResponse({
        statusText: 'Server Error',
        contentType: 'application/json',
        jsonFails: true,
      })
    )
    expect(result).toEqual({ message: 'Server Error' })
  })

  // The backend emits the id in three different shapes plus a response header.
  describe('request id resolution', () => {
    it('reads the id from json.error.requestId', async () => {
      const result = await parseErrorResponse(
        mockResponse({
          contentType: 'application/json',
          body: { error: { message: 'boom', requestId: 'camel-1' } },
        })
      )
      expect(result.requestId).toBe('camel-1')
    })

    it('reads the id from json.error.request_id', async () => {
      const result = await parseErrorResponse(
        mockResponse({
          contentType: 'application/json',
          body: { error: { message: 'boom', request_id: 'snake-1' } },
        })
      )
      expect(result.requestId).toBe('snake-1')
    })

    it('reads the id from json.meta.request_id', async () => {
      const result = await parseErrorResponse(
        mockResponse({
          contentType: 'application/json',
          body: {
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'boom' },
            meta: { timestamp: '2026-08-10T15:42:09Z', version: '1', request_id: 'meta-1' },
          },
        })
      )
      expect(result.requestId).toBe('meta-1')
    })

    it('reads the id from the X-Request-ID header when the body carries none', async () => {
      const result = await parseErrorResponse(
        mockResponse({
          contentType: 'application/json',
          body: { detail: 'Resource not found' },
          requestIdHeader: 'header-1',
        })
      )
      expect(result.message).toBe('Resource not found')
      expect(result.requestId).toBe('header-1')
    })

    it('reads the id from the X-Request-ID header for a non-JSON response', async () => {
      const result = await parseErrorResponse(
        mockResponse({
          statusText: 'Bad Gateway',
          contentType: 'text/html',
          requestIdHeader: 'header-2',
        })
      )
      expect(result.message).toBe('Bad Gateway')
      expect(result.requestId).toBe('header-2')
    })

    it('prefers json.error.requestId over every other source', async () => {
      const result = await parseErrorResponse(
        mockResponse({
          contentType: 'application/json',
          body: {
            error: { message: 'boom', requestId: 'camel-1', request_id: 'snake-1' },
            meta: { request_id: 'meta-1' },
          },
          requestIdHeader: 'header-1',
        })
      )
      expect(result.requestId).toBe('camel-1')
    })

    it('prefers json.error.request_id over meta and the header', async () => {
      const result = await parseErrorResponse(
        mockResponse({
          contentType: 'application/json',
          body: {
            error: { message: 'boom', request_id: 'snake-1' },
            meta: { request_id: 'meta-1' },
          },
          requestIdHeader: 'header-1',
        })
      )
      expect(result.requestId).toBe('snake-1')
    })

    it('prefers json.meta.request_id over the header', async () => {
      const result = await parseErrorResponse(
        mockResponse({
          contentType: 'application/json',
          body: {
            error: { message: 'boom' },
            meta: { request_id: 'meta-1' },
          },
          requestIdHeader: 'header-1',
        })
      )
      expect(result.requestId).toBe('meta-1')
    })

    it('leaves the id undefined when no source carries one', async () => {
      const result = await parseErrorResponse(
        mockResponse({
          contentType: 'application/json',
          body: { error: { message: 'boom' } },
        })
      )
      expect(result.requestId).toBeUndefined()
    })
  })
})

// ============================================================================
// apiErrorFromResponse
// ============================================================================

describe('apiErrorFromResponse', () => {
  function failedResponse(options: {
    status?: number
    statusText?: string
    contentType?: string
    body?: unknown
    requestIdHeader?: string
  }): Response {
    const headers = new Headers()
    if (options.contentType) headers.set('content-type', options.contentType)
    if (options.requestIdHeader) headers.set('X-Request-ID', options.requestIdHeader)
    return {
      ok: false,
      status: options.status ?? 500,
      statusText: options.statusText ?? 'Internal Server Error',
      headers,
      json: () => Promise.resolve(options.body),
    } as unknown as Response
  }

  const context = { method: 'POST', path: '/tests/import', fallback: 'Import failed' }

  it('uses the reason the server sent, not the status text', async () => {
    const error = await apiErrorFromResponse(
      failedResponse({
        status: 400,
        statusText: 'Bad Request',
        contentType: 'application/json',
        body: { error: { message: "Duplicate test name 'login'" } },
      }),
      context
    )

    expect(error.message).toBe("Duplicate test name 'login'")
  })

  it('trims surrounding whitespace off the server reason', async () => {
    const error = await apiErrorFromResponse(
      failedResponse({
        status: 400,
        statusText: 'Bad Request',
        contentType: 'application/json',
        body: { error: { message: '  Schema version 3 is unsupported  ' } },
      }),
      context
    )

    expect(error.message).toBe('Schema version 3 is unsupported')
  })

  it('names the operation and the status text when the body carries no reason', async () => {
    const error = await apiErrorFromResponse(
      failedResponse({ status: 404, statusText: 'Not Found', contentType: 'text/plain' }),
      context
    )

    expect(error.message).toBe('Import failed: Not Found')
  })

  it('names the operation and the status code when there is no status text either', async () => {
    const error = await apiErrorFromResponse(
      failedResponse({ status: 503, statusText: '', contentType: 'text/plain' }),
      context
    )

    expect(error.message).toBe('Import failed: HTTP 503')
    expect(error.statusText).toBeUndefined()
  })

  it('names the operation when the server reason is blank', async () => {
    const error = await apiErrorFromResponse(
      failedResponse({
        status: 500,
        statusText: 'Internal Server Error',
        contentType: 'application/json',
        body: { error: { message: '   ' } },
      }),
      context
    )

    expect(error.message).toBe('Import failed: Internal Server Error')
  })

  it('carries the request context the details panel renders', async () => {
    const error = await apiErrorFromResponse(
      failedResponse({
        status: 409,
        statusText: 'Conflict',
        contentType: 'application/json',
        body: {
          error: {
            message: 'Suite already exists',
            code: 'CONFLICT',
            details: [{ name: 'smoke' }],
            userMessage: 'Pick another name',
          },
          meta: { request_id: 'req-77' },
        },
      }),
      { method: 'PUT', path: '/suites/import', fallback: 'Import failed' }
    )

    expect(error.type).toBe('conflict')
    expect(error.status).toBe(409)
    expect(error.statusText).toBe('Conflict')
    expect(error.method).toBe('PUT')
    expect(error.path).toBe('/suites/import')
    expect(error.code).toBe('CONFLICT')
    expect(error.requestId).toBe('req-77')
    expect(error.details).toEqual([{ name: 'smoke' }])
    expect(error.userMessage).toBe('Pick another name')
  })

  it('carries field and resource context when the server sends it', async () => {
    const error = await apiErrorFromResponse(
      failedResponse({
        status: 422,
        statusText: 'Unprocessable Entity',
        contentType: 'application/json',
        body: {
          error: {
            message: 'Validation failed',
            fields: { name: 'is required' },
            resourceType: 'profile',
            resourceId: 'prof-1',
          },
        },
      }),
      { method: 'POST', path: '/profiles/import', fallback: 'Import failed' }
    )

    expect(error.type).toBe('validation')
    expect(error.fields).toEqual({ name: 'is required' })
    expect(error.resourceType).toBe('profile')
    expect(error.resourceId).toBe('prof-1')
  })
})
