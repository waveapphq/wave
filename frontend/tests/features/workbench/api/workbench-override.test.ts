/**
 * workbenchApi.setVariableOverride tests (REQ-3.2.1.6).
 *
 * PATCH /workbench/{session_id}/variables/{name} applies a transient runtime
 * override to one session variable - a literal value (coerced to its declared
 * type) or a re-armed expression source. These tests pin the request shape and
 * the response parse; the BE contract lives in test_workbench_variable_override.py.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
import { workbenchApi } from '@/features/workbench/api/workbench'

describe('workbenchApi.setVariableOverride', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('PATCHes a literal override with the value+type body and parses the response', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({
      data: { name: 'count', value: 42, pending: false },
      meta: { requestId: 'r' },
      status: 200,
    })

    const result = await workbenchApi.setVariableOverride('sess-1', 'count', {
      value: '42',
      type: 'integer',
    })

    expect(apiClient.patch).toHaveBeenCalledWith('/workbench/sess-1/variables/count', {
      value: '42',
      type: 'integer',
    })
    expect(result).toEqual({ name: 'count', value: 42, pending: false })
  })

  it('PATCHes an expression override with the expression+type body and a pending response', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({
      data: { name: 'derived', value: null, pending: true },
      meta: { requestId: 'r' },
      status: 200,
    })

    const result = await workbenchApi.setVariableOverride('sess-1', 'derived', {
      expression: '1 + 2',
      type: 'integer',
    })

    expect(apiClient.patch).toHaveBeenCalledWith('/workbench/sess-1/variables/derived', {
      expression: '1 + 2',
      type: 'integer',
    })
    expect(result).toEqual({ name: 'derived', value: null, pending: true })
  })

  it('returns the unwrapped data envelope (not the full response)', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({
      data: { name: 'config', value: { host: 'localhost' }, pending: false },
      meta: { requestId: 'r' },
      status: 200,
    })

    const result = await workbenchApi.setVariableOverride('sess-1', 'config', {
      value: { host: 'localhost' },
      type: 'map',
    })

    expect(result).toEqual({ name: 'config', value: { host: 'localhost' }, pending: false })
  })

  it('propagates a rejected request (e.g. 409 while the session is running)', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(
      Object.assign(
        new Error("Cannot override variable 'count' while the session is running"),
        { type: 'conflict', status: 409, code: 'CONFLICT', isRetryable: false },
      ),
    )

    await expect(
      workbenchApi.setVariableOverride('sess-1', 'count', { value: '2', type: 'integer' }),
    ).rejects.toThrow("Cannot override variable 'count' while the session is running")
  })
})

// A Current value addresses its own scope (REQ-5.2.4.7, REQ-3.2.1.6).
describe('workbenchApi.setVariableOverride - scope and null value', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(apiClient.patch).mockResolvedValue({
      data: { name: 'loc_n', value: null, pending: false },
      meta: { requestId: 'r' },
      status: 200,
    })
  })

  function sentBody(): unknown {
    return vi.mocked(apiClient.patch).mock.calls[0][1]
  }

  it('sends a null literal value as null', async () => {
    const result = await workbenchApi.setVariableOverride('sess-1', 'note', { value: null, type: 'string' })

    expect(apiClient.patch).toHaveBeenCalledWith('/workbench/sess-1/variables/note', { value: null, type: 'string' })
    expect(result).toEqual({ name: 'loc_n', value: null, pending: false })
  })

  it('adds function_path to the body for a variable of a Function instance', async () => {
    await workbenchApi.setVariableOverride('sess-1', 'loc_n', { value: '5', type: 'integer' }, ['fn-outer', 'fn-inner'])

    expect(apiClient.patch).toHaveBeenCalledWith('/workbench/sess-1/variables/loc_n', {
      value: '5',
      type: 'integer',
      function_path: ['fn-outer', 'fn-inner'],
    })
  })

  it('sends a null value into a Function scope', async () => {
    await workbenchApi.setVariableOverride('sess-1', 'loc_n', { value: null, type: 'integer' }, ['fn-1'])

    expect(sentBody()).toStrictEqual({ value: null, type: 'integer', function_path: ['fn-1'] })
  })

  it('adds function_path to an expression body', async () => {
    await workbenchApi.setVariableOverride('sess-1', 'loc_n', { expression: 'base + 1', type: 'integer' }, ['fn-1'])

    expect(sentBody()).toStrictEqual({ expression: 'base + 1', type: 'integer', function_path: ['fn-1'] })
  })

  it('adds function_path to a template body', async () => {
    await workbenchApi.setVariableOverride('sess-1', 'greeting', { template: 'Hi {{ who }}', type: 'string' }, ['fn-1'])

    expect(sentBody()).toStrictEqual({ template: 'Hi {{ who }}', type: 'string', function_path: ['fn-1'] })
  })

  it('sends no function_path key for the Test scope', async () => {
    await workbenchApi.setVariableOverride('sess-1', 'count', { value: '2', type: 'integer' })

    expect(sentBody()).toStrictEqual({ value: '2', type: 'integer' })
  })
})

describe('workbenchApi.getSessionVariables - scope', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { variables: { loc_map: { value: { a: 1 }, type: 'map' } } },
      meta: { requestId: 'r' },
      status: 200,
    })
  })

  it('reads one Function scope with the function_path CSV query', async () => {
    const result = await workbenchApi.getSessionVariables('sess-1', undefined, ['fn-outer', 'fn-inner'])

    expect(apiClient.get).toHaveBeenCalledWith('/workbench/sess-1/variables?function_path=fn-outer,fn-inner')
    expect(result).toEqual({ loc_map: { value: { a: 1 }, type: 'map' } })
  })

  it('sends the names filter and the function_path together', async () => {
    await workbenchApi.getSessionVariables('sess-1', ['loc_map', 'b&c'], ['fn-1'])

    expect(apiClient.get).toHaveBeenCalledWith('/workbench/sess-1/variables?names=loc_map,b%26c&function_path=fn-1')
  })

  it('sends the function_path alone when the names filter is empty', async () => {
    await workbenchApi.getSessionVariables('sess-1', [], ['fn-1'])

    expect(apiClient.get).toHaveBeenCalledWith('/workbench/sess-1/variables?function_path=fn-1')
  })

  it('omits function_path for the root canvas scope (an empty path)', async () => {
    await workbenchApi.getSessionVariables('sess-1', ['loc_map'], [])

    expect(apiClient.get).toHaveBeenCalledWith('/workbench/sess-1/variables?names=loc_map')
  })
})

describe('workbenchApi.startRun - staged Current values of Function instances', () => {
  const FUNCTION_VARIABLES = [
    { function_path: ['fn-1'], variables: { loc_n: { value: null, type: 'integer' } } },
  ]

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { session_id: 'sess-1', status: 'running', websocket_topic: 'workbench:sess-1', warnings: [] },
      meta: { requestId: 'r' },
      status: 200,
    })
  })

  it('posts function_variables beside the Test variables', async () => {
    const params = {
      test_id: 'test-1',
      environment_id: 'env-1',
      variables: { base: { type: 'string', value: 'x' } },
      function_variables: FUNCTION_VARIABLES,
    }

    await workbenchApi.startRun(params)

    expect(apiClient.post).toHaveBeenCalledWith('/workbench/run', params)
  })

  it('posts function_variables with a Debug and a block run too', async () => {
    await workbenchApi.startDebugRun({
      test_id: 'test-1',
      environment_id: 'env-1',
      breakpoints: [],
      debug_options: { pause_on_first_block: false, pause_on_errors: true },
      single_node_id: 'log-1',
      variables: { base: { type: 'string', value: 'x' } },
      function_variables: FUNCTION_VARIABLES,
    })

    const body = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>
    expect(body.variables).toEqual({ base: { type: 'string', value: 'x' } })
    expect(body.function_variables).toEqual(FUNCTION_VARIABLES)
  })
})
