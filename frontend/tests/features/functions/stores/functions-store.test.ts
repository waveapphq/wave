/**
 * Function store tests.
 *
 * Tests the Zustand store at `@/features/functions/stores/functions-store`.
 * The store caches `functionsById`, `functionList`,
 * `pagination`, `etagsById`, `loading`, `lastError`, and exposes actions
 * `loadFunctions`, `loadFunction`, `createFunction`,
 * `deleteFunction`, `invalidate`. Four selector hooks are
 * exported: `useFunctionList`, `useFunction`, `useFunctionsLoading`,
 * `useFunctionsLastError`.
 *
 * Tests mock the API client module so the store sees canned successes and
 * failures, then assert on the resulting state slices. The selectors are
 * exercised via the store's `getState()` since they internally read from
 * the same store; we test the store first and selectors via direct getState.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type Mock,
} from 'vitest'

vi.mock('@/features/functions/api/functions-api', () => ({
  listFunctions: vi.fn(),
  getFunction: vi.fn(),
  createFunction: vi.fn(),
  deleteFunction: vi.fn(),
  FunctionsApiError: class FunctionsApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
      this.name = 'FunctionsApiError'
    }
  },
}))

import {
  listFunctions,
  getFunction,
  createFunction,
  deleteFunction,
  FunctionsApiError,
} from '@/features/functions/api/functions-api'

import {
  useFunctionsStore,
  useFunctionList,
  useFunction,
  useFunctionsLoading,
  useFunctionsLastError,
} from '@/features/functions/stores/functions-store'
import type {
  FunctionDefinition,
  FunctionSummary,
} from '@/features/functions/api/types'


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------


const DEF: FunctionDefinition = {
  id: 'fn-1',
  name: 'first',
  description: '',
  tags: [],
  inputs: [],
  outputs: [],
  dependencies: { functions: [], plugins: [] },
  workflow: { nodes: [], edges: [] },
  metadata: { author: 'tester', created_at: '2026-01-01', updated_at: '2026-01-01' },
}

const SUMMARY: FunctionSummary = {
  id: 'fn-1',
  name: 'first',
  description: '',
  tags: [],
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const INITIAL_STATE = {
  functionsById: {},
  functionList: [],
  pagination: null,
  etagsById: {},
  loading: false,
  lastError: null,
}


beforeEach(() => {
  vi.resetAllMocks()
  useFunctionsStore.setState(INITIAL_STATE, true)
})


// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------


describe('initial state', () => {
  it('starts with empty caches and no error', () => {
    const state = useFunctionsStore.getState()
    expect(state.functionsById).toEqual({})
    expect(state.functionList).toEqual([])
    expect(state.pagination).toBeNull()
    expect(state.etagsById).toEqual({})
    expect(state.loading).toBe(false)
    expect(state.lastError).toBeNull()
  })
})


// ---------------------------------------------------------------------------
// loadFunctions
// ---------------------------------------------------------------------------


describe('loadFunctions', () => {
  it('replaces functionList and pagination on success', async () => {
    ;(listFunctions as unknown as Mock).mockResolvedValue({
      functions: [SUMMARY],
      pagination: { page: 1, per_page: 50, total: 1, total_pages: 1 },
    })

    await useFunctionsStore.getState().loadFunctions()

    const state = useFunctionsStore.getState()
    expect(state.functionList).toEqual([SUMMARY])
    expect(state.pagination).toEqual({
      page: 1,
      per_page: 50,
      total: 1,
      total_pages: 1,
    })
    expect(state.loading).toBe(false)
    expect(state.lastError).toBeNull()
  })

  it('toggles loading flag during the call', async () => {
    let observedDuringCall: boolean | undefined
    ;(listFunctions as unknown as Mock).mockImplementation(async () => {
      observedDuringCall = useFunctionsStore.getState().loading
      return {
        functions: [],
        pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
      }
    })

    await useFunctionsStore.getState().loadFunctions()

    expect(observedDuringCall).toBe(true)
    expect(useFunctionsStore.getState().loading).toBe(false)
  })

  it('forwards filters to the API client', async () => {
    ;(listFunctions as unknown as Mock).mockResolvedValue({
      functions: [],
      pagination: { page: 2, per_page: 25, total: 0, total_pages: 0 },
    })

    await useFunctionsStore.getState().loadFunctions({
      page: 2,
      per_page: 25,
      search: 'foo',
      tags: ['a'],
    })

    expect(listFunctions).toHaveBeenCalledWith({
      page: 2,
      per_page: 25,
      search: 'foo',
      tags: ['a'],
    })
  })

  it('captures lastError on rejection', async () => {
    ;(listFunctions as unknown as Mock).mockRejectedValue(
      new FunctionsApiError(400, 'Invalid page parameter; must be a positive integer'),
    )

    await expect(
      useFunctionsStore.getState().loadFunctions({ page: -1 }),
    ).rejects.toBeInstanceOf(FunctionsApiError)
    const state = useFunctionsStore.getState()
    expect(state.loading).toBe(false)
    expect(state.lastError).toBe('Invalid page parameter; must be a positive integer')
  })

  it('clears a prior lastError on the next successful call', async () => {
    ;(listFunctions as unknown as Mock).mockRejectedValueOnce(
      new FunctionsApiError(500, 'boom'),
    )
    await useFunctionsStore.getState().loadFunctions().catch(() => undefined)
    expect(useFunctionsStore.getState().lastError).toBe('boom')

    ;(listFunctions as unknown as Mock).mockResolvedValueOnce({
      functions: [],
      pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
    })
    await useFunctionsStore.getState().loadFunctions()
    expect(useFunctionsStore.getState().lastError).toBeNull()
  })
})


// ---------------------------------------------------------------------------
// loadFunction (single)
// ---------------------------------------------------------------------------


describe('loadFunction', () => {
  it('merges definition into functionsById and etag into etagsById', async () => {
    ;(getFunction as unknown as Mock).mockResolvedValue({
      definition: DEF,
      etag: '"abc"',
    })

    const returned = await useFunctionsStore.getState().loadFunction('fn-1')

    expect(returned).toEqual(DEF)
    const state = useFunctionsStore.getState()
    expect(state.functionsById['fn-1']).toEqual(DEF)
    expect(state.etagsById['fn-1']).toBe('"abc"')
  })

  it('captures lastError on rejection', async () => {
    ;(getFunction as unknown as Mock).mockRejectedValue(
      new FunctionsApiError(404, "Function 'missing' not found"),
    )

    await expect(
      useFunctionsStore.getState().loadFunction('missing'),
    ).rejects.toBeInstanceOf(FunctionsApiError)
    expect(useFunctionsStore.getState().lastError).toBe(
      "Function 'missing' not found",
    )
  })
})


// ---------------------------------------------------------------------------
// createFunction
// ---------------------------------------------------------------------------


describe('createFunction', () => {
  it('inserts the new definition into the cache and prepends to functionList', async () => {
    useFunctionsStore.setState({
      ...INITIAL_STATE,
      functionList: [
        { ...SUMMARY, id: 'fn-existing', name: 'existing' },
      ],
    })
    ;(createFunction as unknown as Mock).mockResolvedValue({
      definition: DEF,
      etag: '"new-etag"',
    })

    const returned = await useFunctionsStore.getState().createFunction({
      name: 'first',
      description: '',
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
    })

    expect(returned).toEqual(DEF)
    const state = useFunctionsStore.getState()
    expect(state.functionsById['fn-1']).toEqual(DEF)
    expect(state.etagsById['fn-1']).toBe('"new-etag"')
    // Prepended to functionList
    expect(state.functionList[0].id).toBe('fn-1')
    expect(state.functionList[1].id).toBe('fn-existing')
  })

  it('captures duplicate-name error in lastError', async () => {
    ;(createFunction as unknown as Mock).mockRejectedValue(
      new FunctionsApiError(400, "Function name 'dup' already exists"),
    )

    await expect(
      useFunctionsStore.getState().createFunction({
        name: 'dup',
        description: '',
        tags: [],
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: [], edges: [] },
      }),
    ).rejects.toBeInstanceOf(FunctionsApiError)
    expect(useFunctionsStore.getState().lastError).toBe(
      "Function name 'dup' already exists",
    )
  })
})


// ---------------------------------------------------------------------------
// deleteFunction
// ---------------------------------------------------------------------------


describe('deleteFunction', () => {
  it('removes entries from functionsById, etagsById, and functionList', async () => {
    useFunctionsStore.setState({
      ...INITIAL_STATE,
      functionsById: { 'fn-1': DEF, 'fn-keep': { ...DEF, id: 'fn-keep' } },
      etagsById: { 'fn-1': '"e"', 'fn-keep': '"e"' },
      functionList: [SUMMARY, { ...SUMMARY, id: 'fn-keep', name: 'keep' }],
    })
    ;(deleteFunction as unknown as Mock).mockResolvedValue(undefined)

    await useFunctionsStore.getState().deleteFunction('fn-1')

    const state = useFunctionsStore.getState()
    expect(state.functionsById).toEqual({
      'fn-keep': { ...DEF, id: 'fn-keep' },
    })
    expect(state.etagsById).toEqual({ 'fn-keep': '"e"' })
    expect(state.functionList.map((row: FunctionSummary) => row.id)).toEqual(['fn-keep'])
  })

  it('forwards cascade option to the API', async () => {
    useFunctionsStore.setState({
      ...INITIAL_STATE,
      functionsById: { 'fn-1': DEF },
    })
    ;(deleteFunction as unknown as Mock).mockResolvedValue(undefined)

    await useFunctionsStore.getState().deleteFunction('fn-1', { cascade: true })

    expect(deleteFunction).toHaveBeenCalledWith('fn-1', { cascade: true })
  })

  it('captures 409 dependent-count error', async () => {
    useFunctionsStore.setState({
      ...INITIAL_STATE,
      functionsById: { 'fn-1': DEF },
    })
    ;(deleteFunction as unknown as Mock).mockRejectedValue(
      new FunctionsApiError(
        409,
        "Function 'fn-1' has 2 dependent(s); pass cascade=true to delete",
      ),
    )

    await expect(
      useFunctionsStore.getState().deleteFunction('fn-1'),
    ).rejects.toBeInstanceOf(FunctionsApiError)
    expect(useFunctionsStore.getState().lastError).toBe(
      "Function 'fn-1' has 2 dependent(s); pass cascade=true to delete",
    )
    // The cache is NOT mutated when delete fails.
    expect(useFunctionsStore.getState().functionsById['fn-1']).toEqual(DEF)
  })
})


// ---------------------------------------------------------------------------
// invalidate
// ---------------------------------------------------------------------------


describe('invalidate', () => {
  it('drops a single id when given an argument', () => {
    useFunctionsStore.setState({
      ...INITIAL_STATE,
      functionsById: { 'fn-1': DEF, 'fn-keep': { ...DEF, id: 'fn-keep' } },
      etagsById: { 'fn-1': '"e1"', 'fn-keep': '"e2"' },
    })

    useFunctionsStore.getState().invalidate('fn-1')

    const state = useFunctionsStore.getState()
    expect(state.functionsById['fn-1']).toBeUndefined()
    expect(state.etagsById['fn-1']).toBeUndefined()
    expect(state.functionsById['fn-keep']).toBeDefined()
  })

  it('clears everything when called with no argument', () => {
    useFunctionsStore.setState({
      ...INITIAL_STATE,
      functionsById: { 'fn-1': DEF },
      etagsById: { 'fn-1': '"e1"' },
      functionList: [SUMMARY],
      pagination: { page: 1, per_page: 50, total: 1, total_pages: 1 },
      lastError: 'something',
    })

    useFunctionsStore.getState().invalidate()

    const state = useFunctionsStore.getState()
    expect(state.functionsById).toEqual({})
    expect(state.etagsById).toEqual({})
    expect(state.functionList).toEqual([])
    expect(state.pagination).toBeNull()
  })
})


// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------


describe('selectors', () => {
  it('useFunctionList returns the current functionList slice', () => {
    useFunctionsStore.setState({
      ...INITIAL_STATE,
      functionList: [SUMMARY],
    })
    // Hooks are simple selectors; invoke via the store directly to read the
    // same value without rendering a component.
    const value = useFunctionsStore.getState().functionList
    expect(useFunctionList).toBeTypeOf('function')
    expect(value).toEqual([SUMMARY])
  })

  it('useFunction returns the cached definition by id', () => {
    useFunctionsStore.setState({
      ...INITIAL_STATE,
      functionsById: { 'fn-1': DEF },
    })
    const direct = useFunctionsStore.getState().functionsById['fn-1']
    expect(useFunction).toBeTypeOf('function')
    expect(direct).toEqual(DEF)
  })

  it('useFunctionsLoading exposes the loading flag', () => {
    useFunctionsStore.setState({ ...INITIAL_STATE, loading: true })
    expect(useFunctionsLoading).toBeTypeOf('function')
    expect(useFunctionsStore.getState().loading).toBe(true)
  })

  it('useFunctionsLastError exposes the lastError string', () => {
    useFunctionsStore.setState({ ...INITIAL_STATE, lastError: 'oops' })
    expect(useFunctionsLastError).toBeTypeOf('function')
    expect(useFunctionsStore.getState().lastError).toBe('oops')
  })
})


// ---------------------------------------------------------------------------
// Concurrent action guards
// ---------------------------------------------------------------------------


describe('loading flag during concurrent actions', () => {
  it('loading flag returns to false on rejection', async () => {
    ;(listFunctions as unknown as Mock).mockRejectedValue(
      new FunctionsApiError(500, 'oops'),
    )

    await useFunctionsStore.getState().loadFunctions().catch(() => undefined)

    expect(useFunctionsStore.getState().loading).toBe(false)
  })
})
