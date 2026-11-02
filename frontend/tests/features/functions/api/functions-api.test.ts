/**
 * Function API client tests.
 *
 * Tests the wire-level surface in `@/features/functions/api/functions-api`.
 * Every method routes through the global `fetch`
 * and converts non-2xx responses into a thrown `FunctionsApiError` carrying
 * the exact backend error string.
 *
 * These tests mock `global.fetch` directly and assert:
 *  1. Correct method + URL + body shape per request.
 *  2. ETag header reading (GET, POST, PUT) into the resolved value.
 *  3. `If-Match` header sending on PUT requests.
 *  4. `FunctionsApiError` is thrown on non-2xx with the backend error string.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest'

import {
  listFunctions,
  listFunctionTags,
  getFunction,
  createFunction,
  deleteFunction,
  deleteFunctionVersion,
  getDependents,
  getDependentsByVersion,
  batchCreateFunctions,
  batchDeleteFunctions,
  publishLocalFunction,
  detachPublishedInstance,
  listFunctionVersions,
  getFunctionVersion,
  validateBumps,
  addFunctionVersion,
  runFunctionStandalone,
  sweepFunctionRun,
  FunctionsApiError,
} from '@/features/functions/api/functions-api'
import type {
  FunctionDefinition,
  FunctionSummary,
  CreateFunctionPayload,
} from '@/features/functions/api/types'


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


type MockResponseInit = {
  status?: number
  json?: unknown
  blob?: Blob
  text?: string
  headers?: Record<string, string>
}

function mockFetchResponse(init: MockResponseInit = {}): Response {
  const status = init.status ?? 200
  const headers = new Headers(init.headers ?? {})
  const body =
    init.json !== undefined
      ? JSON.stringify(init.json)
      : init.text ?? ''
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
    json: vi.fn().mockResolvedValue(init.json),
    text: vi.fn().mockResolvedValue(body),
    blob: vi.fn().mockResolvedValue(init.blob ?? new Blob([body])),
    clone() {
      return response
    },
  } as unknown as Response
  return response
}

function envelope<T, P = undefined>(
  data: T,
  extras: { pagination?: P; etag?: string; contentType?: string } = {},
): MockResponseInit {
  const headers: Record<string, string> = {}
  if (extras.etag) headers.ETag = extras.etag
  if (extras.contentType) headers['Content-Type'] = extras.contentType
  const body: Record<string, unknown> = { success: true, data }
  if (extras.pagination) body.pagination = extras.pagination
  return { status: 200, json: body, headers }
}

function errorEnvelope(
  status: number,
  message: string,
  code = 'VALIDATION_ERROR',
): MockResponseInit {
  return {
    status,
    json: {
      success: false,
      error: { message, code },
    },
  }
}

function getCall(index = 0): { url: string; init: RequestInit } {
  const mock = global.fetch as unknown as Mock
  const call = mock.mock.calls[index] as [string | URL | Request, RequestInit?]
  const url =
    typeof call[0] === 'string'
      ? call[0]
      : call[0] instanceof URL
        ? call[0].toString()
        : (call[0] as Request).url
  return { url, init: call[1] ?? {} }
}

function bodyJson(init: RequestInit): unknown {
  if (typeof init.body === 'string') return JSON.parse(init.body)
  return init.body
}

function header(init: RequestInit, name: string): string | undefined {
  if (!init.headers) return undefined
  if (init.headers instanceof Headers) return init.headers.get(name) ?? undefined
  if (Array.isArray(init.headers)) {
    const found = init.headers.find(
      ([k]) => k.toLowerCase() === name.toLowerCase(),
    )
    return found?.[1]
  }
  const obj = init.headers as Record<string, string>
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === name.toLowerCase()) return obj[key]
  }
  return undefined
}


const SAMPLE_DEFINITION: FunctionDefinition = {
  id: 'fn-1',
  name: 'example',
  description: '',
  tags: [],
  inputs: [],
  outputs: [],
  dependencies: { functions: [], plugins: [] },
  workflow: { nodes: [], edges: [] },
  metadata: { author: 'tester', created_at: '2026-01-01', updated_at: '2026-01-01' },
}

const SAMPLE_SUMMARY: FunctionSummary = {
  id: 'fn-1',
  name: 'example',
  description: '',
  tags: [],
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}


beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})


// ---------------------------------------------------------------------------
// listFunctions
// ---------------------------------------------------------------------------


describe('listFunctions', () => {
  it('GETs /functions with no query string by default', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope([SAMPLE_SUMMARY], {
          pagination: { page: 1, per_page: 50, total: 1, total_pages: 1 },
        }),
      ),
    )

    const result = await listFunctions()

    const { url, init } = getCall()
    expect(init.method ?? 'GET').toBe('GET')
    expect(url).toMatch(/\/functions(\?|$)/)
    expect(result.functions).toEqual([SAMPLE_SUMMARY])
    expect(result.pagination.total).toBe(1)
  })

  it('forwards page, per_page, search, and tags as query params', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope([], {
          pagination: { page: 2, per_page: 25, total: 0, total_pages: 0 },
        }),
      ),
    )

    await listFunctions({ page: 2, per_page: 25, search: 'foo', tags: ['a', 'b'] })

    const { url } = getCall()
    expect(url).toContain('page=2')
    expect(url).toContain('per_page=25')
    expect(url).toContain('search=foo')
    expect(url).toContain('tags=')
    expect(url).toMatch(/tags=a%2Cb|tags=a,b/)
  })

  it('forwards sort_by and sort_order as query params', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope([], {
          pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
        }),
      ),
    )

    await listFunctions({ sort_by: 'name', sort_order: 'desc' })

    const { url } = getCall()
    expect(url).toContain('sort_by=name')
    expect(url).toContain('sort_order=desc')
  })

  it('throws FunctionsApiError on non-2xx with backend error message', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        errorEnvelope(400, 'Invalid page parameter; must be a positive integer'),
      ),
    )

    await expect(listFunctions({ page: -1 })).rejects.toThrow(
      FunctionsApiError,
    )
    await expect(listFunctions({ page: -1 })).rejects.toMatchObject({
      status: 400,
      message: 'Invalid page parameter; must be a positive integer',
    })
  })
})


// ---------------------------------------------------------------------------
// getFunction
// ---------------------------------------------------------------------------


describe('getFunction', () => {
  it('GETs /functions/:id and surfaces the ETag header', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope(SAMPLE_DEFINITION, { etag: '"abc123"' }),
      ),
    )

    const { definition, etag } = await getFunction('fn-1')

    const { url, init } = getCall()
    expect(init.method ?? 'GET').toBe('GET')
    expect(url).toContain('/functions/fn-1')
    expect(definition).toEqual(SAMPLE_DEFINITION)
    expect(etag).toBe('"abc123"')
  })

  it('throws FunctionsApiError on 404 with backend message', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(errorEnvelope(404, "Function 'fn-missing' not found", 'NOT_FOUND')),
    )

    await expect(getFunction('fn-missing')).rejects.toMatchObject({
      status: 404,
      message: "Function 'fn-missing' not found",
    })
  })
})


// ---------------------------------------------------------------------------
// createFunction
// ---------------------------------------------------------------------------


describe('createFunction', () => {
  it('POSTs /functions with the payload and reads ETag from the response', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope(SAMPLE_DEFINITION, { etag: '"new-etag"' }),
      ),
    )

    const payload: CreateFunctionPayload = {
      name: 'example',
      description: '',
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
    }
    const { definition, etag } = await createFunction(payload)

    const { url, init } = getCall()
    expect(init.method).toBe('POST')
    expect(url).toContain('/functions')
    expect(bodyJson(init)).toEqual(payload)
    expect(header(init, 'content-type')).toMatch(/application\/json/)
    expect(definition).toEqual(SAMPLE_DEFINITION)
    expect(etag).toBe('"new-etag"')
  })

  it('throws FunctionsApiError on 400 with backend duplicate-name message', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(errorEnvelope(400, "Function name 'dup' already exists")),
    )

    await expect(
      createFunction({
        name: 'dup',
        description: '',
        tags: [],
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: [], edges: [] },
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Function name 'dup' already exists",
    })
  })
})


// ---------------------------------------------------------------------------
// deleteFunction
// ---------------------------------------------------------------------------


describe('deleteFunction', () => {
  it('sends DELETE for /functions/:id and resolves on 204', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse({ status: 204 }),
    )

    await deleteFunction('fn-1')

    const { url, init } = getCall()
    expect(init.method).toBe('DELETE')
    expect(url).toContain('/functions/fn-1')
  })

  it('appends ?cascade=true when cascade option is true', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse({ status: 204 }),
    )

    await deleteFunction('fn-1', { cascade: true })

    const { url } = getCall()
    expect(url).toContain('cascade=true')
  })

  it('throws on 409 with dependents-count message', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        errorEnvelope(
          409,
          "Function 'fn-1' has 3 dependent(s); pass cascade=true to delete",
          'CONFLICT',
        ),
      ),
    )

    await expect(deleteFunction('fn-1')).rejects.toMatchObject({
      status: 409,
      message: "Function 'fn-1' has 3 dependent(s); pass cascade=true to delete",
    })
  })
})


// ---------------------------------------------------------------------------
// getDependents
// ---------------------------------------------------------------------------


describe('getDependents', () => {
  it('GETs /functions/:id/dependents', async () => {
    const payload = {
      tests: [{ id: 't1', name: 'first test' }],
      functions: [{ id: 'fn-9', name: 'caller' }],
    }
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope(payload)),
    )

    const result = await getDependents('fn-1')

    const { url, init } = getCall()
    expect(init.method ?? 'GET').toBe('GET')
    expect(url).toContain('/functions/fn-1/dependents')
    expect(url).not.toContain('version=')
    expect(result).toEqual(payload)
  })

  it('appends ?version= when a version is supplied (per-version usage)', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope({ tests: [], functions: [] })),
    )

    await getDependents('fn-1', '2.0.0')

    const { url } = getCall()
    expect(url).toContain('/functions/fn-1/dependents')
    expect(url).toContain('version=2.0.0')
  })

  it('throws FunctionsApiError on 404', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(errorEnvelope(404, "Function 'fn-x' not found", 'NOT_FOUND')),
    )

    await expect(getDependents('fn-x')).rejects.toMatchObject({
      status: 404,
      message: "Function 'fn-x' not found",
    })
  })
})


describe('getDependentsByVersion', () => {
  it('GETs /functions/:id/dependents/by-version and returns the version map', async () => {
    const payload = {
      '2.0.0': { tests: [{ id: 't1', name: 'first test' }], functions: [] },
      '1.0.0': { tests: [], functions: [{ id: 'fn-9', name: 'caller' }] },
    }
    ;(global.fetch as unknown as Mock).mockResolvedValue(mockFetchResponse(envelope(payload)))

    const result = await getDependentsByVersion('fn-1')

    const { url } = getCall()
    expect(url).toContain('/functions/fn-1/dependents/by-version')
    expect(result).toEqual(payload)
  })

  it('throws FunctionsApiError on 404', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(errorEnvelope(404, "Function 'fn-x' not found", 'NOT_FOUND')),
    )
    await expect(getDependentsByVersion('fn-x')).rejects.toMatchObject({ status: 404 })
  })
})


// ---------------------------------------------------------------------------
// deleteFunctionVersion (per-version delete)
// ---------------------------------------------------------------------------


describe('deleteFunctionVersion', () => {
  it('sends DELETE for /functions/{id}/versions/{version} and resolves on 204', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse({ status: 204 }),
    )

    await deleteFunctionVersion('fn-1', '1.0.0')

    const { url, init } = getCall()
    expect(init.method).toBe('DELETE')
    expect(url).toContain('/functions/fn-1/versions/1.0.0')
  })

  it('throws FunctionsApiError on 404 with the version-not-found message', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        errorEnvelope(404, "Function 'fn-1' version '9.9.9' not found", 'NOT_FOUND'),
      ),
    )

    await expect(deleteFunctionVersion('fn-1', '9.9.9')).rejects.toMatchObject({
      status: 404,
      message: "Function 'fn-1' version '9.9.9' not found",
    })
  })
})


// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------


describe('batchCreateFunctions', () => {
  it('POSTs /functions/batch with items wrapped under `items`', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope({ created: [SAMPLE_DEFINITION], failed: [] })),
    )

    const items: CreateFunctionPayload[] = [
      {
        name: 'one',
        description: '',
        tags: [],
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: [], edges: [] },
      },
    ]
    const result = await batchCreateFunctions(items)

    const { url, init } = getCall()
    expect(init.method).toBe('POST')
    expect(url).toContain('/functions/batch')
    expect(bodyJson(init)).toEqual({ items })
    expect(result.created).toHaveLength(1)
    expect(result.failed).toEqual([])
  })

  it('surfaces per-item failures with index and errors', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope({
          created: [SAMPLE_DEFINITION],
          failed: [
            {
              index: 1,
              errors: [
                "Function name must match pattern '^[a-zA-Z][a-zA-Z0-9_-]*$'",
              ],
            },
          ],
        }),
      ),
    )

    const result = await batchCreateFunctions([
      {} as CreateFunctionPayload,
      {} as CreateFunctionPayload,
    ])

    expect(result.failed[0].index).toBe(1)
    expect(result.failed[0].errors).toEqual([
      "Function name must match pattern '^[a-zA-Z][a-zA-Z0-9_-]*$'",
    ])
  })
})


describe('batchDeleteFunctions', () => {
  it('sends DELETE for /functions/batch with ids and cascade flag', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope({ deleted: ['fn-1', 'fn-2'], failed: [] })),
    )

    const result = await batchDeleteFunctions(['fn-1', 'fn-2'], { cascade: true })

    const { url, init } = getCall()
    expect(init.method).toBe('DELETE')
    expect(url).toContain('/functions/batch')
    expect(bodyJson(init)).toEqual({ ids: ['fn-1', 'fn-2'], cascade: true })
    expect(result.deleted).toEqual(['fn-1', 'fn-2'])
  })

  it('defaults cascade to false when option is omitted', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope({ deleted: ['fn-1'], failed: [] })),
    )

    await batchDeleteFunctions(['fn-1'])

    const { init } = getCall()
    expect(bodyJson(init)).toEqual({ ids: ['fn-1'], cascade: false })
  })
})


// ---------------------------------------------------------------------------
// Export / Import - the client lives in api/export-import.ts and is
// covered by export-import.test.ts.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// FunctionsApiError shape
// ---------------------------------------------------------------------------


describe('FunctionsApiError', () => {
  it('is an Error subclass with status and message', () => {
    const err = new FunctionsApiError(404, "Function 'x' not found")
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(404)
    expect(err.message).toBe("Function 'x' not found")
  })

  it('carries the exact backend error string from the response', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(errorEnvelope(404, "Function 'specific-id' not found", 'NOT_FOUND')),
    )

    let captured: FunctionsApiError | undefined
    try {
      await getFunction('specific-id')
    } catch (err) {
      captured = err as FunctionsApiError
    }
    expect(captured).toBeInstanceOf(FunctionsApiError)
    expect(captured?.status).toBe(404)
    expect(captured?.message).toBe("Function 'specific-id' not found")
  })
})


describe('listFunctionTags', () => {
  it('returns the deduped tag list from /functions/tags', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope(['demo', 'mail', 'payment'])),
    )
    const result = await listFunctionTags()
    expect(result).toEqual(['demo', 'mail', 'payment'])
    expect(getCall().url).toContain('/functions/tags')
  })
})


describe('publishLocalFunction', () => {
  it('POSTs the canonical payload to /tests/{id}/functions/publish', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope({
          function_id: 'new-fn-1',
          version: '1.0.0',
          node: { id: 'fn-local', data: { functionLifecycle: 'shared' } },
        }),
      ),
    )
    const result = await publishLocalFunction(
      'test-1',
      'fn-local',
      {
        name: 'Greet',
        description: 'desc',
        tags: ['demo'],
        changelog: 'first',
        details: 'long',
        version: '1.0.0',
      },
    )
    expect(result.function_id).toBe('new-fn-1')
    expect(result.version).toBe('1.0.0')
    const { url, init } = getCall()
    expect(url).toContain('/tests/test-1/functions/publish')
    expect(init.method).toBe('POST')
    const body = bodyJson(init) as Record<string, unknown>
    expect(body.node_id).toBe('fn-local')
    expect(body.name).toBe('Greet')
    expect(body.tags).toEqual(['demo'])
    expect(body.changelog).toBe('first')
    expect(body.details).toBe('long')
    expect(body.version).toBe('1.0.0')
  })

  it('sends If-Match when an etag is provided', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope({ function_id: 'x', version: '1.0.0', node: { id: 'n', data: {} } })),
    )
    await publishLocalFunction(
      'test-2',
      'n',
      { name: 'X', description: '', tags: [] },
      { etag: '"abc"' },
    )
    const { init } = getCall()
    expect(header(init, 'If-Match')).toBe('"abc"')
  })

  it('defaults optional payload fields to empty strings / 1.0.0', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope({ function_id: 'x', version: '1.0.0', node: { id: 'n', data: {} } })),
    )
    await publishLocalFunction('t', 'n', {
      name: 'X',
      description: '',
      tags: [],
    })
    const body = bodyJson(getCall().init) as Record<string, unknown>
    expect(body.changelog).toBe('')
    expect(body.details).toBe('')
    expect(body.version).toBe('1.0.0')
  })

  it('throws FunctionsApiError on non-2xx', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        errorEnvelope(409, "Function name 'X' is already in use", 'CONFLICT'),
      ),
    )
    await expect(
      publishLocalFunction('t', 'n', { name: 'X', description: '', tags: [] }),
    ).rejects.toBeInstanceOf(FunctionsApiError)
  })
})


describe('detachPublishedInstance', () => {
  it('POSTs the canonical payload to /tests/{id}/functions/detach', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope({
          node: {
            id: 'fn-shared',
            data: { functionLifecycle: 'local', localDefinition: {} },
          },
        }),
      ),
    )
    const result = await detachPublishedInstance('test-1', 'fn-shared')
    expect(result.node.id).toBe('fn-shared')
    const { url, init } = getCall()
    expect(url).toContain('/tests/test-1/functions/detach')
    expect(init.method).toBe('POST')
    const body = bodyJson(init) as Record<string, unknown>
    expect(body.node_id).toBe('fn-shared')
  })

  it('sends If-Match when an etag is provided', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope({ node: { id: 'n', data: {} } })),
    )
    await detachPublishedInstance('t', 'n', { etag: '"xyz"' })
    const { init } = getCall()
    expect(header(init, 'If-Match')).toBe('"xyz"')
  })

  it('throws FunctionsApiError on non-2xx', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        errorEnvelope(404, "Library entry 'fn-1' does not exist", 'NOT_FOUND'),
      ),
    )
    await expect(
      detachPublishedInstance('t', 'n'),
    ).rejects.toBeInstanceOf(FunctionsApiError)
  })
})


// ===========================================================================
// Version lifecycle additions (REQ-3.1.2.2)
// ===========================================================================


describe('listFunctionVersions', () => {
  it('GETs /functions/{id}/versions and returns the versions + latest', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope({
          versions: [
            { version: '2.0.0', published_at: '2026-03-01T00:00:00Z' },
            { version: '1.0.0', published_at: '2026-01-01T00:00:00Z' },
          ],
          latest: '2.0.0',
        }),
      ),
    )
    const result = await listFunctionVersions('fn-1')
    expect(result.latest).toBe('2.0.0')
    expect(result.versions).toHaveLength(2)
    const { url, init } = getCall()
    expect(url).toContain('/functions/fn-1/versions')
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('throws FunctionsApiError on 404', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        errorEnvelope(404, "Function 'fn-x' not found", 'NOT_FOUND'),
      ),
    )
    await expect(listFunctionVersions('fn-x')).rejects.toBeInstanceOf(
      FunctionsApiError,
    )
  })
})


describe('getFunctionVersion', () => {
  it('GETs /functions/{id}/versions/{version} and returns definition + etag', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope(
          {
            definition: { name: 'greet', version: '1.0.0' },
          },
          { etag: '"v-etag"' },
        ),
      ),
    )
    const result = await getFunctionVersion('fn-1', '1.0.0')
    expect(result.definition).toMatchObject({ name: 'greet' })
    expect(result.etag).toBe('"v-etag"')
    const { url } = getCall()
    expect(url).toContain('/functions/fn-1/versions/1.0.0')
  })

  it('throws on version-not-found', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        errorEnvelope(
          404,
          "Function 'fn-1' version '9.9.9' not found",
          'NOT_FOUND',
        ),
      ),
    )
    await expect(getFunctionVersion('fn-1', '9.9.9')).rejects.toBeInstanceOf(
      FunctionsApiError,
    )
  })
})


describe('validateBumps', () => {
  it('POSTs the draft + sourceVersion to /functions/{id}/validate-bumps', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope({ allowed: ['patch', 'minor', 'major'], blocked: {} }),
      ),
    )
    const draftDefinition = {
      name: 'greet',
      description: 'd',
      tags: ['demo'],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
    }
    const result = await validateBumps('fn-1', {
      draftDefinition,
      sourceVersion: '1.0.0',
    })
    expect(result.allowed).toEqual(['patch', 'minor', 'major'])
    const { url, init } = getCall()
    expect(url).toContain('/functions/fn-1/validate-bumps')
    expect(init.method).toBe('POST')
    const body = bodyJson(init) as Record<string, unknown>
    expect(body.source_version).toBe('1.0.0')
    expect(body.draft_definition).toMatchObject({ name: 'greet' })
  })

  it('throws on 422 malformed payload', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        errorEnvelope(
          422,
          'Draft definition is malformed: missing inputs',
          'VALIDATION_ERROR',
        ),
      ),
    )
    await expect(
      validateBumps('fn-1', {
        draftDefinition: { name: 'x' } as unknown as Parameters<
          typeof validateBumps
        >[1]['draftDefinition'],
        sourceVersion: '1.0.0',
      }),
    ).rejects.toBeInstanceOf(FunctionsApiError)
  })
})


describe('addFunctionVersion', () => {
  it('POSTs the draft + versions payload to /functions/{id}/versions (snake_case)', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope({ function_id: 'fn-1', version: '1.0.1' })),
    )
    const result = await addFunctionVersion('fn-1', {
      sourceVersion: '1.0.0',
      targetVersion: '1.0.1',
      draftDefinition: { name: 'greet', inputs: [], outputs: [] },
      changelog: 'patched',
      description: 'd',
      tags: ['demo'],
      details: '',
    })
    expect(result.function_id).toBe('fn-1')
    expect(result.version).toBe('1.0.1')
    const { url, init } = getCall()
    expect(url).toContain('/functions/fn-1/versions')
    expect(init.method).toBe('POST')
    const body = bodyJson(init) as Record<string, unknown>
    expect(body.source_version).toBe('1.0.0')
    expect(body.target_version).toBe('1.0.1')
    expect(body.changelog).toBe('patched')
    expect(body.draft_definition).toMatchObject({ name: 'greet' })
  })

  it('throws FunctionsApiError on a 409 duplicate target', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        errorEnvelope(409, "Target version '1.0.1' already exists in the library", 'CONFLICT'),
      ),
    )
    await expect(
      addFunctionVersion('fn-1', {
        sourceVersion: '1.0.0',
        targetVersion: '1.0.1',
        draftDefinition: { name: 'greet', inputs: [], outputs: [] },
        changelog: 'c',
        description: '',
        tags: [],
        details: '',
      }),
    ).rejects.toBeInstanceOf(FunctionsApiError)
  })

  it('defaults omitted description/tags/details to empty values in the body', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(envelope({ function_id: 'fn-1', version: '1.0.1' })),
    )
    await addFunctionVersion('fn-1', {
      sourceVersion: '1.0.0',
      targetVersion: '1.0.1',
      draftDefinition: { name: 'greet', inputs: [], outputs: [] },
      changelog: 'patched',
    })
    const body = bodyJson(getCall().init) as Record<string, unknown>
    expect(body.description).toBe('')
    expect(body.tags).toEqual([])
    expect(body.details).toBe('')
  })
})


describe('runFunctionStandalone', () => {
  it('POSTs a version run and returns the session', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope({
          session_id: 's-1',
          status: 'running',
          websocket_topic: 'workbench:s-1',
          warnings: [],
        }),
      ),
    )
    const session = await runFunctionStandalone('fn-1', {
      version: '1.0.0',
      environmentId: 'env-1',
      sessionId: 's-1',
    })
    expect(session.websocket_topic).toBe('workbench:s-1')
    const { url, init } = getCall()
    expect(url).toContain('/functions/fn-1/run')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ version: '1.0.0', draft: null, environment_id: 'env-1', session_id: 's-1' })
  })

  it('POSTs a draft run with version null', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope({ session_id: 's-2', status: 'running', websocket_topic: 'workbench:s-2', warnings: [] }),
      ),
    )
    await runFunctionStandalone('fn-1', {
      draft: { name: 'd' },
      environmentId: 'env-1',
      debug: { breakpoints: [] },
    })
    const body = JSON.parse(getCall().init.body as string)
    expect(body.version).toBeNull()
    expect(body.draft).toEqual({ name: 'd' })
    expect(body.debug).toEqual({ breakpoints: [] })
  })

  it('throws FunctionsApiError on a backend error', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(errorEnvelope(404, "Function 'fn-1' version '9.9.9' not found", 'NOT_FOUND')),
    )
    await expect(
      runFunctionStandalone('fn-1', { version: '9.9.9', environmentId: 'env-1' }),
    ).rejects.toBeInstanceOf(FunctionsApiError)
  })
})

describe('runFunctionStandalone - the Current values of a run alone (FNCFG-8, REQ-3.1.2.10)', () => {
  it('POSTs the Current values set before the run as variables', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope({ session_id: 's-3', status: 'running', websocket_topic: 'workbench:s-3', warnings: [] }),
      ),
    )
    const variables = { who: { type: 'string', value: 'ann' }, tries: { type: 'integer', value: 3 } }

    await runFunctionStandalone('fn-1', {
      version: '1.0.0',
      environmentId: 'env-1',
      sessionId: 's-3',
      variables,
    } as Parameters<typeof runFunctionStandalone>[1])

    const body = JSON.parse(getCall().init.body as string)
    expect(body.variables).toEqual(variables)
    expect(body).toMatchObject({ version: '1.0.0', environment_id: 'env-1', session_id: 's-3' })
  })

  it('POSTs the values of Function instances nested in the run as function_variables', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope({ session_id: 's-4', status: 'running', websocket_topic: 'workbench:s-4', warnings: [] }),
      ),
    )
    const nested = [{ function_path: ['inner-fn'], variables: { tries: { type: 'integer', value: 3 } } }]

    await runFunctionStandalone('fn-1', {
      version: '1.0.0',
      environmentId: 'env-1',
      sessionId: 's-4',
      variables: { who: { type: 'string', value: 'ann' } },
      function_variables: nested,
    } as Parameters<typeof runFunctionStandalone>[1])

    const body = JSON.parse(getCall().init.body as string)
    expect(body.function_variables).toEqual(nested)
    expect(body.variables).toEqual({ who: { type: 'string', value: 'ann' } })
  })

  it('sends no function_variables when the run carries no nested Function values', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(
      mockFetchResponse(
        envelope({ session_id: 's-5', status: 'running', websocket_topic: 'workbench:s-5', warnings: [] }),
      ),
    )

    await runFunctionStandalone('fn-1', { version: '1.0.0', environmentId: 'env-1', sessionId: 's-5' })

    expect(JSON.parse(getCall().init.body as string)).not.toHaveProperty('function_variables')
  })
})

describe('sweepFunctionRun', () => {
  it('sends DELETE for the view-session', async () => {
    ;(global.fetch as unknown as Mock).mockResolvedValue(mockFetchResponse(envelope({})))
    await sweepFunctionRun('s-1')
    const { url, init } = getCall()
    expect(url).toContain('/functions/view-session/s-1')
    expect(init.method).toBe('DELETE')
  })
})
