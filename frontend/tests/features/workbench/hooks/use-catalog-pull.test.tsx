/**
 * useCatalogPull: the generic catalog pull behind the editor chip (Get Tables, Get fields) - start, poll every
 * 500 ms, cancel, the shared store entry keyed by kind and state key, and the 3 s Done hold. The API functions are
 * passed in, so nothing here reaches the network.
 *
 * REQ-3.3.2.6, REQ-5.1.2, REQ-5.1.4; SQL-12, OS-12, OS-13
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ContextType, ReactNode } from 'react'

import { ToastContext } from '@/components/ui/toast'
import {
  CATALOG_DONE_HOLD_MS,
  CATALOG_POLL_MS,
  useCatalogPull,
  type CatalogPullApi,
} from '@/features/workbench/hooks/use-catalog-pull'
import { catalogStateKey, type CatalogJobStatus } from '@/features/workbench/lib/catalog-request'
import {
  WorkflowStoreProvider,
  createWorkflowStore,
  useWorkflowStore,
  type CatalogPullEntry,
} from '@/features/workbench/stores/workflow-store'

// ============================================
// Test Helpers
// ============================================

const POLL_MS = 500
const HOLD_MS = 3000
const JOB_ID = 'job-1'

type Kind = 'sql' | 'opensearch'

interface Names {
  names: string[]
}

type StartAnswer = { job_id: string; cached: boolean } & Partial<Names>
type JobAnswer = { status: CatalogJobStatus; error?: string } & Partial<Names>

const SAMPLE_NAMES = ['orders', 'order_items', 'customers', 'active_customers']
const EMPTY: Names = { names: [] }

const startMock = vi.fn<(body: object) => Promise<StartAnswer>>()
const getMock = vi.fn<(jobId: string) => Promise<JobAnswer>>()
const cancelMock = vi.fn<(jobId: string) => Promise<unknown>>()

const API: CatalogPullApi<Names> = {
  start: (body: object) => startMock(body),
  get: (jobId: string) => getMock(jobId),
  cancel: (jobId: string) => cancelMock(jobId),
  dataOf: (answer: Partial<Names>) => ({ names: answer.names ?? [] }),
  empty: EMPTY,
}

const REQUEST = {
  connection: { url: 'https://catalog.lab:9200', username: 'wave', password: 'secret-pw' },
  expression_fields: [],
  template_fields: [],
  element_types: {},
  profile_bindings: [],
  environment_id: 'env-lab',
  test_id: 'test-logs',
}

const OTHER_HOST_REQUEST = {
  ...REQUEST,
  connection: { ...REQUEST.connection, url: 'https://other.lab:9200' },
}

const OTHER_ENVIRONMENT_REQUEST = { ...REQUEST, environment_id: 'env-staging' }

const NEW_JOB: StartAnswer = { job_id: JOB_ID, cached: false }

const CONNECTING: CatalogPullEntry = { status: 'connecting', jobId: null, data: EMPTY, error: null }

const LOADED: CatalogPullEntry = {
  status: 'loaded',
  jobId: 'job-0',
  data: { names: [...SAMPLE_NAMES] },
  error: null,
}

function cachedAnswer(names = [...SAMPLE_NAMES]): StartAnswer {
  return { job_id: 'job-cached', cached: true, names }
}

function doneJob(names = [...SAMPLE_NAMES]): JobAnswer {
  return { status: 'done', names }
}

function keyOf(request: object, kind: Kind = 'sql'): string {
  return `${kind}:${catalogStateKey(request as typeof REQUEST)}`
}

function entryOf(request: object = REQUEST, kind: Kind = 'sql'): CatalogPullEntry | undefined {
  return useWorkflowStore.getState().catalogPulls.get(keyOf(request, kind))
}

function seed(entry: CatalogPullEntry, request: object = REQUEST, kind: Kind = 'sql'): void {
  useWorkflowStore.getState().setCatalogPull(keyOf(request, kind), entry)
}

function renderPull(request: object | null = REQUEST, kind: Kind = 'sql') {
  return renderHook(
    ({ value }: { value: object | null }) => useCatalogPull<Names>(kind, value, API),
    { initialProps: { value: request } },
  )
}

function renderPair(first: object, second: object, kinds: readonly [Kind, Kind] = ['sql', 'sql']) {
  return renderHook(() => ({
    first: useCatalogPull<Names>(kinds[0], first, API),
    second: useCatalogPull<Names>(kinds[1], second, API),
  }))
}

/** Runs an action inside act and lets its settled promises land. */
async function perform(action: () => void): Promise<void> {
  await act(async () => {
    action()
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function deferred<T>() {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: (value: T) => settle(value) }
}

function providerFor(store: ReturnType<typeof createWorkflowStore>) {
  return function StoreWrapper({ children }: { children: ReactNode }) {
    return <WorkflowStoreProvider store={store}>{children}</WorkflowStoreProvider>
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  startMock.mockResolvedValue(NEW_JOB)
  getMock.mockResolvedValue({ status: 'connecting' })
  cancelMock.mockResolvedValue({ status: 'canceled' })
  useWorkflowStore.getState().clearCatalogPulls()
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================
// Timing constants
// ============================================

describe('useCatalogPull timing', () => {
  it('polls every 500 ms and holds Done for 3000 ms', () => {
    expect(CATALOG_POLL_MS).toBe(POLL_MS)
    expect(CATALOG_DONE_HOLD_MS).toBe(HOLD_MS)
  })
})

// ============================================
// No request
// ============================================

describe('useCatalogPull without a request', () => {
  it('reads idle with no data', () => {
    const { result } = renderPull(null)

    expect(result.current.state).toBe('idle')
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('does nothing on start, refresh, stop or settle', async () => {
    const { result } = renderPull(null)

    await perform(() => result.current.start())
    await perform(() => result.current.refresh())
    await perform(() => result.current.stop())
    await perform(() => result.current.settle())
    await advance(2000)

    expect(result.current.state).toBe('idle')
    expect(startMock).not.toHaveBeenCalled()
    expect(getMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
    expect(useWorkflowStore.getState().catalogPulls.size).toBe(0)
  })
})

// ============================================
// Before any pull
// ============================================

describe('useCatalogPull before any pull', () => {
  it('reads idle and never pulls on its own', async () => {
    const { result } = renderPull()

    await advance(5000)

    expect(result.current.state).toBe('idle')
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
    expect(startMock).not.toHaveBeenCalled()
    expect(entryOf()).toBeUndefined()
  })
})

// ============================================
// Start and poll
// ============================================

describe('useCatalogPull start', () => {
  it('writes a connecting entry with the empty data at once and starts the pull once', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())

    expect(entryOf()).toEqual(CONNECTING)
    expect(result.current.state).toBe('connecting')
    expect(result.current.data).toBeNull()
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(startMock).toHaveBeenCalledWith(REQUEST)
  })

  it('keys the entry by the kind and the state key of the request', async () => {
    const { result } = renderPull()

    await perform(() => result.current.start())

    expect([...useWorkflowStore.getState().catalogPulls.keys()]).toEqual([
      `sql:${catalogStateKey(REQUEST)}`,
    ])
  })

  it('keeps the job id of a new pull and polls it 500 ms after the answer', async () => {
    const { result } = renderPull()

    await perform(() => result.current.start())

    expect(entryOf()).toMatchObject({ status: 'connecting', jobId: JOB_ID })
    expect(result.current.state).toBe('connecting')

    await advance(POLL_MS - 1)
    expect(getMock).not.toHaveBeenCalled()

    await advance(1)
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledWith(JOB_ID)
  })

  it('polls every 500 ms while the job connects', async () => {
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)
    await advance(POLL_MS)
    await advance(POLL_MS)

    expect(getMock).toHaveBeenCalledTimes(3)
    for (const call of getMock.mock.calls) {
      expect(call).toEqual([JOB_ID])
    }
    expect(result.current.state).toBe('connecting')
  })

  it('reads reading once the job reads', async () => {
    getMock.mockResolvedValueOnce({ status: 'reading' })
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('reading')
    expect(result.current.data).toBeNull()
    expect(entryOf()).toMatchObject({ status: 'reading', jobId: JOB_ID, data: EMPTY })
  })

  it('loads what dataOf reads from the done job, reads done for 3000 ms, then settled', async () => {
    getMock
      .mockResolvedValueOnce({ status: 'connecting' })
      .mockResolvedValueOnce({ status: 'reading' })
      .mockResolvedValueOnce(doneJob())
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)
    expect(result.current.state).toBe('connecting')
    await advance(POLL_MS)
    expect(result.current.state).toBe('reading')
    await advance(POLL_MS)

    expect(result.current.state).toBe('done')
    expect(result.current.data).toEqual({ names: SAMPLE_NAMES })
    expect(result.current.error).toBeNull()
    expect(entryOf()).toEqual({
      status: 'loaded',
      jobId: JOB_ID,
      data: { names: SAMPLE_NAMES },
      error: null,
    })

    await advance(HOLD_MS - 1)
    expect(result.current.state).toBe('done')

    await advance(1)
    expect(result.current.state).toBe('settled')
    expect(result.current.data).toEqual({ names: SAMPLE_NAMES })
  })

  it('hands the whole done answer to dataOf', async () => {
    const dataOf = vi.fn((answer: Partial<Names>): Names => ({ names: answer.names ?? [] }))
    const job: JobAnswer = { status: 'done', names: ['orders'] }
    getMock.mockResolvedValueOnce(job)
    const { result } = renderHook(() => useCatalogPull<Names>('sql', REQUEST, { ...API, dataOf }))

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(dataOf).toHaveBeenCalledWith(job)
    expect(result.current.data).toEqual({ names: ['orders'] })
  })

  it('stops polling once the job is done', async () => {
    getMock.mockResolvedValueOnce(doneJob())
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)
    await advance(POLL_MS * 4)

    expect(getMock).toHaveBeenCalledTimes(1)
  })
})

// ============================================
// Cached answer
// ============================================

describe('useCatalogPull cached answer', () => {
  it('loads what dataOf reads from the cached answer with its job id and never polls', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())
    await perform(() => answer.resolve(cachedAnswer()))

    expect(entryOf()).toEqual({
      status: 'loaded',
      jobId: 'job-cached',
      data: { names: SAMPLE_NAMES },
      error: null,
    })
    expect(result.current.state).toBe('done')
    expect(result.current.data).toEqual({ names: SAMPLE_NAMES })

    await advance(HOLD_MS - 1)
    expect(result.current.state).toBe('done')

    await advance(1)
    expect(result.current.state).toBe('settled')
    expect(getMock).not.toHaveBeenCalled()
  })

  it('hands the whole cached answer to dataOf', async () => {
    const dataOf = vi.fn((answer: Partial<Names>): Names => ({ names: answer.names ?? [] }))
    const cached = cachedAnswer(['orders'])
    startMock.mockResolvedValueOnce(cached)
    const { result } = renderHook(() => useCatalogPull<Names>('sql', REQUEST, { ...API, dataOf }))

    await perform(() => result.current.start())

    expect(dataOf).toHaveBeenCalledWith(cached)
    expect(result.current.data).toEqual({ names: ['orders'] })
  })
})

// ============================================
// Settle
// ============================================

describe('useCatalogPull settle', () => {
  it('settles Done at once and keeps the data', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())
    await perform(() => answer.resolve(cachedAnswer()))
    expect(result.current.state).toBe('done')

    await perform(() => result.current.settle())

    expect(result.current.state).toBe('settled')
    expect(result.current.data).toEqual({ names: SAMPLE_NAMES })
    expect(entryOf()).toMatchObject({ status: 'loaded', data: { names: SAMPLE_NAMES } })

    await advance(HOLD_MS)
    expect(result.current.state).toBe('settled')
  })
})

// ============================================
// An entry that is already there
// ============================================

describe('useCatalogPull on an existing entry', () => {
  it('reads settled at once on a loaded entry', () => {
    seed(LOADED)

    const { result } = renderPull()

    expect(result.current.state).toBe('settled')
    expect(result.current.data).toEqual({ names: SAMPLE_NAMES })
    expect(result.current.error).toBeNull()
    expect(startMock).not.toHaveBeenCalled()
  })

  it.each(['connecting', 'reading'] as const)('reads %s as stored', (status) => {
    seed({ status, jobId: 'job-other', data: EMPTY, error: null })

    const { result } = renderPull()

    expect(result.current.state).toBe(status)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('reads failed with its error', () => {
    seed({ status: 'failed', jobId: 'job-other', data: EMPTY, error: 'URL is required' })

    const { result } = renderPull()

    expect(result.current.state).toBe('failed')
    expect(result.current.error).toBe('URL is required')
    expect(result.current.data).toBeNull()
  })

  it('reads done when a busy entry it watched turns loaded, then settled', async () => {
    seed({ status: 'reading', jobId: 'job-other', data: EMPTY, error: null })
    const { result } = renderPull()
    expect(result.current.state).toBe('reading')

    act(() => {
      seed({ status: 'loaded', jobId: 'job-other', data: { names: ['orders', 'customers'] }, error: null })
    })

    expect(result.current.state).toBe('done')
    expect(result.current.data).toEqual({ names: ['orders', 'customers'] })

    await advance(HOLD_MS - 1)
    expect(result.current.state).toBe('done')
    await advance(1)
    expect(result.current.state).toBe('settled')
  })

  it('joins a busy entry on start', async () => {
    const busy: CatalogPullEntry = { status: 'reading', jobId: 'job-other', data: EMPTY, error: null }
    seed(busy)
    const { result } = renderPull()

    await perform(() => result.current.start())

    expect(startMock).not.toHaveBeenCalled()
    expect(entryOf()).toEqual(busy)
    expect(result.current.state).toBe('reading')
  })

  it('does nothing on start while the entry is loaded', async () => {
    seed(LOADED)
    const { result } = renderPull()

    await perform(() => result.current.start())

    expect(startMock).not.toHaveBeenCalled()
    expect(entryOf()).toEqual(LOADED)
    expect(result.current.state).toBe('settled')
  })
})

// ============================================
// Two hooks on one pull
// ============================================

describe('useCatalogPull shared by two editors on one request', () => {
  it('runs one pull and both hooks show every state', async () => {
    getMock.mockResolvedValueOnce({ status: 'reading' }).mockResolvedValueOnce(doneJob())
    const { result } = renderPair(REQUEST, { ...REQUEST })

    await perform(() => result.current.first.start())
    await perform(() => result.current.second.start())

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(result.current.first.state).toBe('connecting')
    expect(result.current.second.state).toBe('connecting')

    await advance(POLL_MS)
    expect(result.current.first.state).toBe('reading')
    expect(result.current.second.state).toBe('reading')

    await advance(POLL_MS)
    expect(result.current.first.state).toBe('done')
    expect(result.current.second.state).toBe('done')
    expect(result.current.second.data).toEqual({ names: SAMPLE_NAMES })
    expect(getMock).toHaveBeenCalledTimes(2)

    await advance(HOLD_MS)
    expect(result.current.first.state).toBe('settled')
    expect(result.current.second.state).toBe('settled')
  })

  it('reads settled in a hook mounted after the load while the one that watched it reads done', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const watcher = renderPull()

    await perform(() => watcher.result.current.start())
    await perform(() => answer.resolve(cachedAnswer()))
    const late = renderPull()

    expect(watcher.result.current.state).toBe('done')
    expect(late.result.current.state).toBe('settled')
    expect(late.result.current.data).toEqual({ names: SAMPLE_NAMES })
  })

  it('stops the shared pull from either hook', async () => {
    const { result } = renderPair(REQUEST, REQUEST)

    await perform(() => result.current.first.start())
    await perform(() => result.current.second.stop())

    expect(result.current.first.state).toBe('idle')
    expect(result.current.second.state).toBe('idle')
    expect(cancelMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledWith(JOB_ID)
  })
})

// ============================================
// Two blocks whose secrets were sealed apart
// ============================================

describe('useCatalogPull shared by two blocks with identical rows', () => {
  /** The request of a block whose rows match the sample's, its password saved as `password`. */
  const blockRequest = (password: string) => ({
    ...REQUEST,
    connection: { ...REQUEST.connection, password },
  })
  const FIRST_BLOCK = blockRequest('wave:enc:v1:bm9uY2UtMWNpcGhlcg==')
  const SECOND_BLOCK = blockRequest('wave:enc:v1:bm9uY2UtMmNpcGhlcg==')

  it('opens the second block editor settled once the first has loaded', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const first = renderPull(FIRST_BLOCK)

    await perform(() => first.result.current.start())
    await perform(() => answer.resolve(cachedAnswer()))
    const second = renderPull(SECOND_BLOCK)

    expect(second.result.current.state).toBe('settled')
    expect(second.result.current.data).toEqual({ names: SAMPLE_NAMES })
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(startMock).toHaveBeenCalledWith(FIRST_BLOCK)
  })

  it('joins the pull the first block started and sends nothing more', async () => {
    const { result } = renderPair(FIRST_BLOCK, SECOND_BLOCK)

    await perform(() => result.current.first.start())
    await perform(() => result.current.second.start())

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(result.current.second.state).toBe('connecting')
  })

  it('pulls with the second block own sealed password when it refreshes', async () => {
    seed(LOADED, FIRST_BLOCK)
    const second = renderPull(SECOND_BLOCK)

    await perform(() => second.result.current.refresh())

    expect(startMock).toHaveBeenCalledExactlyOnceWith({ ...SECOND_BLOCK, refresh: true })
  })

  it('keeps a block whose password is typed apart from one whose password is sealed', () => {
    seed(LOADED, FIRST_BLOCK)

    expect(renderPull(blockRequest('typed-password')).result.current.state).toBe('idle')
  })
})

// ============================================
// Kinds
// ============================================

describe('useCatalogPull kinds', () => {
  it('writes an opensearch pull under the opensearch kind', async () => {
    const { result } = renderPull(REQUEST, 'opensearch')

    await perform(() => result.current.start())

    expect(entryOf(REQUEST, 'opensearch')).toEqual({ ...CONNECTING, jobId: JOB_ID })
    expect(entryOf(REQUEST, 'sql')).toBeUndefined()
    expect([...useWorkflowStore.getState().catalogPulls.keys()]).toEqual([
      `opensearch:${catalogStateKey(REQUEST)}`,
    ])
  })

  it('keeps a loaded entry of one kind from the hook of another kind on the same request', () => {
    seed(LOADED, REQUEST, 'sql')

    const { result } = renderPair(REQUEST, REQUEST, ['sql', 'opensearch'])

    expect(result.current.first.state).toBe('settled')
    expect(result.current.second.state).toBe('idle')
    expect(result.current.second.data).toBeNull()
  })

  it('runs one pull per kind for the same request', async () => {
    const { result } = renderPair(REQUEST, REQUEST, ['sql', 'opensearch'])

    await perform(() => result.current.first.start())
    await perform(() => result.current.second.start())

    expect(startMock).toHaveBeenCalledTimes(2)
    expect(entryOf(REQUEST, 'sql')).toMatchObject({ status: 'connecting' })
    expect(entryOf(REQUEST, 'opensearch')).toMatchObject({ status: 'connecting' })
  })

  it('stops the pull of its own kind only', async () => {
    const { result } = renderPair(REQUEST, REQUEST, ['sql', 'opensearch'])
    await perform(() => result.current.first.start())
    await perform(() => result.current.second.start())

    await perform(() => result.current.second.stop())

    expect(entryOf(REQUEST, 'opensearch')).toBeUndefined()
    expect(entryOf(REQUEST, 'sql')).toMatchObject({ status: 'connecting' })
    expect(result.current.first.state).toBe('connecting')
  })
})

// ============================================
// Failures
// ============================================

describe('useCatalogPull failures', () => {
  it('fails with the message of a refused start and never polls', async () => {
    startMock.mockRejectedValueOnce(new Error('URL is required'))
    const { result } = renderPull()

    await perform(() => result.current.start())

    expect(result.current.state).toBe('failed')
    expect(result.current.error).toBe('URL is required')
    expect(result.current.data).toBeNull()
    expect(entryOf()).toEqual({ status: 'failed', jobId: null, data: EMPTY, error: 'URL is required' })

    await advance(POLL_MS * 4)
    expect(getMock).not.toHaveBeenCalled()
  })

  it('fails with the message of a refused poll and polls no more', async () => {
    getMock.mockRejectedValueOnce(new Error('Network request failed'))
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('failed')
    expect(result.current.error).toBe('Network request failed')
    expect(entryOf()).toEqual({
      status: 'failed',
      jobId: JOB_ID,
      data: EMPTY,
      error: 'Network request failed',
    })

    await advance(POLL_MS * 4)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('fails with the error of a failed job and polls no more', async () => {
    const message = 'Authentication failed: HTTP 401'
    getMock.mockResolvedValueOnce({ status: 'failed', error: message })
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('failed')
    expect(result.current.error).toBe(message)
    expect(result.current.data).toBeNull()
    expect(entryOf()).toEqual({ status: 'failed', jobId: JOB_ID, data: EMPTY, error: message })

    await advance(POLL_MS * 4)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('fails with no error text when the failed job carries none', async () => {
    getMock.mockResolvedValueOnce({ status: 'failed' })
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('failed')
    expect(result.current.error).toBeNull()
    expect(entryOf()).toMatchObject({ status: 'failed', error: null })
  })

  it('tries again on start from failed', async () => {
    startMock.mockRejectedValueOnce(new Error('URL is required'))
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())
    expect(result.current.state).toBe('failed')

    await perform(() => result.current.start())

    expect(startMock).toHaveBeenCalledTimes(2)
    expect(startMock).toHaveBeenLastCalledWith(REQUEST)
    expect(entryOf()).toEqual(CONNECTING)
    expect(result.current.state).toBe('connecting')
    expect(result.current.error).toBeNull()

    await perform(() => answer.resolve(cachedAnswer()))
    expect(result.current.state).toBe('done')
    expect(result.current.data).toEqual({ names: SAMPLE_NAMES })
  })
})

// ============================================
// Refresh
// ============================================

describe('useCatalogPull refresh', () => {
  it('pulls again from loaded with refresh and drops the data while it runs', async () => {
    seed(LOADED)
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result } = renderPull()
    expect(result.current.state).toBe('settled')

    await perform(() => result.current.refresh())

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(startMock).toHaveBeenCalledWith({ ...REQUEST, refresh: true })
    expect(entryOf()).toEqual(CONNECTING)
    expect(result.current.state).toBe('connecting')
    expect(result.current.data).toBeNull()

    await perform(() => answer.resolve(cachedAnswer(['orders'])))

    expect(result.current.state).toBe('done')
    expect(result.current.data).toEqual({ names: ['orders'] })

    await advance(HOLD_MS)
    expect(result.current.state).toBe('settled')
  })

  it('polls a new job started by refresh', async () => {
    seed(LOADED)
    getMock.mockResolvedValueOnce(doneJob(['customers']))
    const { result } = renderPull()

    await perform(() => result.current.refresh())
    await advance(POLL_MS)

    expect(getMock).toHaveBeenCalledWith(JOB_ID)
    expect(result.current.state).toBe('done')
    expect(result.current.data).toEqual({ names: ['customers'] })
  })

  it('pulls with refresh when nothing is loaded yet', async () => {
    const { result } = renderPull()

    await perform(() => result.current.refresh())

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(startMock).toHaveBeenCalledWith({ ...REQUEST, refresh: true })
    expect(result.current.state).toBe('connecting')
  })

  it('joins a pull that is already running', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())
    await perform(() => result.current.refresh())

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('connecting')
  })

  it('pulls again from failed with refresh', async () => {
    seed({ status: 'failed', jobId: 'job-0', data: EMPTY, error: 'URL is required' })
    const { result } = renderPull()

    await perform(() => result.current.refresh())

    expect(startMock).toHaveBeenCalledExactlyOnceWith({ ...REQUEST, refresh: true })
    expect(result.current.state).toBe('connecting')
  })
})

// ============================================
// Stop
// ============================================

describe('useCatalogPull stop', () => {
  it('removes the entry at once and cancels the known job', async () => {
    const { result } = renderPull()

    await perform(() => result.current.start())
    await perform(() => result.current.stop())

    expect(entryOf()).toBeUndefined()
    expect(result.current.state).toBe('idle')
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
    expect(cancelMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledWith(JOB_ID)

    await advance(POLL_MS * 4)
    expect(getMock).not.toHaveBeenCalled()
  })

  it('cancels the job while it reads', async () => {
    getMock.mockResolvedValueOnce({ status: 'reading' })
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)
    expect(result.current.state).toBe('reading')

    await perform(() => result.current.stop())

    expect(result.current.state).toBe('idle')
    expect(entryOf()).toBeUndefined()
    expect(cancelMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledWith(JOB_ID)

    await advance(POLL_MS * 4)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a poll answer that arrives after Stop', async () => {
    const poll = deferred<JobAnswer>()
    getMock.mockReturnValueOnce(poll.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)
    expect(getMock).toHaveBeenCalledTimes(1)

    await perform(() => result.current.stop())
    await perform(() => poll.resolve(doneJob()))

    expect(entryOf()).toBeUndefined()
    expect(result.current.state).toBe('idle')
    expect(result.current.data).toBeNull()

    await advance(POLL_MS * 4)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('cancels the job of a start answer that arrives after Stop and writes nothing', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())
    await perform(() => result.current.stop())

    expect(result.current.state).toBe('idle')
    expect(entryOf()).toBeUndefined()
    expect(cancelMock).not.toHaveBeenCalled()

    await perform(() => answer.resolve({ job_id: 'job-2', cached: false }))

    expect(cancelMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledWith('job-2')
    expect(entryOf()).toBeUndefined()
    expect(result.current.state).toBe('idle')

    await advance(POLL_MS * 4)
    expect(getMock).not.toHaveBeenCalled()
  })

  it('writes nothing when a cached answer arrives after Stop', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())
    await perform(() => result.current.stop())
    await perform(() => answer.resolve(cachedAnswer()))

    expect(entryOf()).toBeUndefined()
    expect(result.current.state).toBe('idle')
    expect(result.current.data).toBeNull()
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('ignores a refused cancel', async () => {
    cancelMock.mockRejectedValueOnce(new Error('Catalog job not found'))
    const { result } = renderPull()

    await perform(() => result.current.start())
    await perform(() => result.current.stop())
    await advance(POLL_MS)

    expect(cancelMock).toHaveBeenCalledWith(JOB_ID)
    expect(result.current.state).toBe('idle')
    expect(result.current.error).toBeNull()
    expect(entryOf()).toBeUndefined()
  })

  it('ignores a refused cancel of a start answer that arrives after Stop', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    cancelMock.mockRejectedValueOnce(new Error('Catalog job not found'))
    const { result } = renderPull()

    await perform(() => result.current.start())
    await perform(() => result.current.stop())
    await perform(() => answer.resolve({ job_id: 'job-2', cached: false }))
    await advance(POLL_MS)

    expect(cancelMock).toHaveBeenCalledWith('job-2')
    expect(result.current.state).toBe('idle')
    expect(result.current.error).toBeNull()
    expect(entryOf()).toBeUndefined()
  })

  it('does nothing while the data is loaded', async () => {
    seed(LOADED)
    const { result } = renderPull()

    await perform(() => result.current.stop())

    expect(entryOf()).toEqual(LOADED)
    expect(result.current.state).toBe('settled')
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('does nothing on a failed entry', async () => {
    const failed: CatalogPullEntry = { status: 'failed', jobId: 'job-0', data: EMPTY, error: 'x' }
    seed(failed)
    const { result } = renderPull()

    await perform(() => result.current.stop())

    expect(entryOf()).toEqual(failed)
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('does nothing before any pull', async () => {
    const { result } = renderPull()

    await perform(() => result.current.stop())

    expect(entryOf()).toBeUndefined()
    expect(result.current.state).toBe('idle')
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('keeps a new pull started after Stop from the stopped pull', async () => {
    const first = deferred<StartAnswer>()
    const second = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())
    await perform(() => result.current.stop())
    await perform(() => result.current.start())
    expect(startMock).toHaveBeenCalledTimes(2)

    await perform(() => first.resolve({ job_id: 'job-a', cached: false }))

    expect(cancelMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledWith('job-a')
    expect(entryOf()).toEqual(CONNECTING)
    expect(result.current.state).toBe('connecting')

    await perform(() => second.resolve({ job_id: 'job-b', cached: false }))
    expect(entryOf()).toMatchObject({ status: 'connecting', jobId: 'job-b' })

    await advance(POLL_MS)
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledWith('job-b')
  })

  it('never writes a poll answer of a stopped pull into the pull started after it', async () => {
    const poll = deferred<JobAnswer>()
    const second = deferred<StartAnswer>()
    getMock.mockReturnValueOnce(poll.promise)
    const { result } = renderPull()
    await perform(() => result.current.start())
    await advance(POLL_MS)
    expect(getMock).toHaveBeenCalledExactlyOnceWith(JOB_ID)
    await perform(() => result.current.stop())
    startMock.mockReturnValueOnce(second.promise)
    await perform(() => result.current.start())

    await perform(() => poll.resolve(doneJob()))

    expect(entryOf()).toEqual(CONNECTING)
    expect(result.current.state).toBe('connecting')
    expect(result.current.data).toBeNull()
  })
})

// ============================================
// Canceled job
// ============================================

describe('useCatalogPull canceled job', () => {
  it('removes the entry when the job reports canceled and polls no more', async () => {
    getMock.mockResolvedValueOnce({ status: 'canceled' })
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(entryOf()).toBeUndefined()
    expect(result.current.state).toBe('idle')
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()

    await advance(POLL_MS * 4)
    expect(getMock).toHaveBeenCalledTimes(1)
  })
})

// ============================================
// Store reset
// ============================================

describe('useCatalogPull after the store is reset', () => {
  it('makes no further poll for a pull whose entry reset() removed', async () => {
    const { result } = renderPull()

    await perform(() => result.current.start())
    act(() => {
      useWorkflowStore.getState().reset()
    })

    expect(result.current.state).toBe('idle')
    expect(entryOf()).toBeUndefined()

    await advance(POLL_MS * 4)
    expect(getMock).not.toHaveBeenCalled()
    expect(entryOf()).toBeUndefined()
  })

  it('drops a poll answer that arrives after reset()', async () => {
    const poll = deferred<JobAnswer>()
    getMock.mockReturnValueOnce(poll.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())
    await advance(POLL_MS)
    act(() => {
      useWorkflowStore.getState().reset()
    })
    await perform(() => poll.resolve(doneJob()))

    expect(entryOf()).toBeUndefined()
    expect(result.current.state).toBe('idle')

    await advance(POLL_MS * 4)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('drops a start answer that arrives after reset()', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result } = renderPull()

    await perform(() => result.current.start())
    act(() => {
      useWorkflowStore.getState().reset()
    })
    await perform(() => answer.resolve({ job_id: 'job-2', cached: false }))

    expect(entryOf()).toBeUndefined()
    expect(result.current.state).toBe('idle')

    await advance(POLL_MS * 4)
    expect(getMock).not.toHaveBeenCalled()
  })
})

// ============================================
// Separate pulls
// ============================================

describe('useCatalogPull on different requests', () => {
  it('keeps one entry per request', async () => {
    const firstAnswer = deferred<StartAnswer>()
    startMock
      .mockReturnValueOnce(firstAnswer.promise)
      .mockRejectedValueOnce(new Error('URL is required'))
    const { result } = renderPair(REQUEST, OTHER_HOST_REQUEST)

    await perform(() => result.current.first.start())
    expect(result.current.first.state).toBe('connecting')
    expect(result.current.second.state).toBe('idle')

    await perform(() => result.current.second.start())
    await perform(() => firstAnswer.resolve(cachedAnswer()))

    expect(startMock).toHaveBeenCalledTimes(2)
    expect(startMock).toHaveBeenNthCalledWith(1, REQUEST)
    expect(startMock).toHaveBeenNthCalledWith(2, OTHER_HOST_REQUEST)
    expect(result.current.first.state).toBe('done')
    expect(result.current.first.data).toEqual({ names: SAMPLE_NAMES })
    expect(result.current.second.state).toBe('failed')
    expect(result.current.second.error).toBe('URL is required')
    expect(entryOf(REQUEST)).toMatchObject({ status: 'loaded' })
    expect(entryOf(OTHER_HOST_REQUEST)).toMatchObject({ status: 'failed' })
  })

  it('keeps a separate entry per Environment for the same rows', async () => {
    seed(LOADED)
    const { result } = renderPair(REQUEST, OTHER_ENVIRONMENT_REQUEST)

    expect(result.current.first.state).toBe('settled')
    expect(result.current.second.state).toBe('idle')

    await perform(() => result.current.second.start())

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(startMock).toHaveBeenCalledWith(OTHER_ENVIRONMENT_REQUEST)
    expect(result.current.first.state).toBe('settled')
    expect(entryOf(REQUEST)).toEqual(LOADED)
  })

  it('reads the entry of the request it is given now', () => {
    seed(LOADED)
    const { result, rerender } = renderPull(REQUEST)
    expect(result.current.state).toBe('settled')

    rerender({ value: OTHER_HOST_REQUEST })
    expect(result.current.state).toBe('idle')
    expect(result.current.data).toBeNull()

    rerender({ value: null })
    expect(result.current.state).toBe('idle')
    expect(result.current.data).toBeNull()
  })
})

// ============================================
// After the editor closes
// ============================================

describe('useCatalogPull after the editor closes', () => {
  it('keeps polling after the hook unmounts and fills the store', async () => {
    getMock.mockResolvedValueOnce({ status: 'reading' }).mockResolvedValueOnce(doneJob())
    const { result, unmount } = renderPull()
    await perform(() => result.current.start())

    unmount()
    await advance(POLL_MS)
    expect(entryOf()).toMatchObject({ status: 'reading', jobId: JOB_ID })
    await advance(POLL_MS)

    expect(getMock).toHaveBeenCalledTimes(2)
    expect(getMock.mock.calls).toEqual([[JOB_ID], [JOB_ID]])
    expect(entryOf()).toEqual({
      status: 'loaded',
      jobId: JOB_ID,
      data: { names: SAMPLE_NAMES },
      error: null,
    })
  })

  it('polls a job whose start answer arrives after the hook unmounted', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    getMock.mockResolvedValueOnce(doneJob())
    const { result, unmount } = renderPull()
    await perform(() => result.current.start())

    unmount()
    await perform(() => answer.resolve(NEW_JOB))
    await advance(POLL_MS)

    expect(getMock).toHaveBeenCalledExactlyOnceWith(JOB_ID)
    expect(cancelMock).not.toHaveBeenCalled()
    expect(entryOf()).toMatchObject({ status: 'loaded', data: { names: SAMPLE_NAMES } })
  })

  it('keeps a cached answer that arrives after the hook unmounted', async () => {
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result, unmount } = renderPull()
    await perform(() => result.current.start())

    unmount()
    await perform(() => answer.resolve(cachedAnswer()))

    expect(entryOf()).toMatchObject({ status: 'loaded', data: { names: SAMPLE_NAMES } })
  })

  it('reads settled when the editor opens again on a pull that finished while it was closed', async () => {
    getMock.mockResolvedValueOnce(doneJob())
    const first = renderPull()
    await perform(() => first.result.current.start())
    first.unmount()
    await advance(POLL_MS)

    const { result } = renderPull()

    expect(result.current.state).toBe('settled')
    expect(result.current.data).toEqual({ names: SAMPLE_NAMES })
    expect(startMock).toHaveBeenCalledTimes(1)
  })

  it('shows the running pull when the editor opens again before it finished', async () => {
    getMock.mockResolvedValueOnce({ status: 'reading' }).mockResolvedValueOnce(doneJob())
    const first = renderPull()
    await perform(() => first.result.current.start())
    first.unmount()
    await advance(POLL_MS)

    const { result } = renderPull()
    expect(result.current.state).toBe('reading')

    await advance(POLL_MS)

    expect(result.current.state).toBe('done')
    expect(result.current.data).toEqual({ names: SAMPLE_NAMES })
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('stores the failure of a pull that failed while the editor was closed', async () => {
    getMock.mockResolvedValueOnce({ status: 'failed', error: 'Connection refused' })
    const { result, unmount } = renderPull()
    await perform(() => result.current.start())

    unmount()
    await advance(POLL_MS)

    expect(entryOf()).toMatchObject({ status: 'failed', error: 'Connection refused' })
    expect(renderPull().result.current.state).toBe('failed')
  })
})

// ============================================
// One poll at a time
// ============================================

describe('useCatalogPull one poll at a time', () => {
  it('asks no more while a poll is unanswered', async () => {
    const poll = deferred<JobAnswer>()
    getMock.mockReturnValueOnce(poll.promise)
    const { result } = renderPull()
    await perform(() => result.current.start())

    await advance(POLL_MS)
    expect(getMock).toHaveBeenCalledTimes(1)
    await advance(POLL_MS * 6)

    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('schedules the next poll 500 ms after a slow answer, not after the slow poll began', async () => {
    const poll = deferred<JobAnswer>()
    getMock.mockReturnValueOnce(poll.promise)
    const { result } = renderPull()
    await perform(() => result.current.start())
    await advance(POLL_MS)
    await advance(1200)

    await perform(() => poll.resolve({ status: 'reading' }))
    expect(result.current.state).toBe('reading')
    await advance(POLL_MS - 1)
    expect(getMock).toHaveBeenCalledTimes(1)

    await advance(1)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('keeps one poll in flight while the editor is closed', async () => {
    const poll = deferred<JobAnswer>()
    getMock.mockReturnValueOnce(poll.promise)
    const { result, unmount } = renderPull()
    await perform(() => result.current.start())
    unmount()

    await advance(POLL_MS * 5)
    expect(getMock).toHaveBeenCalledTimes(1)

    await perform(() => poll.resolve({ status: 'connecting' }))
    await advance(POLL_MS)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('runs one poll sequence for one pull watched by two editors', async () => {
    const { result } = renderPair(REQUEST, REQUEST)
    await perform(() => result.current.first.start())

    await advance(POLL_MS)
    await advance(POLL_MS)
    await advance(POLL_MS)

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledTimes(3)
  })
})

// ============================================
// Store instance
// ============================================

describe('useCatalogPull store instance', () => {
  it('reads and writes the store of the workbench it is rendered in', async () => {
    const store = createWorkflowStore({ persistKey: null })
    const answer = deferred<StartAnswer>()
    startMock.mockReturnValueOnce(answer.promise)
    const { result } = renderHook(() => useCatalogPull<Names>('opensearch', REQUEST, API), {
      wrapper: providerFor(store),
    })

    await perform(() => result.current.start())

    expect(store.getState().catalogPulls.get(keyOf(REQUEST, 'opensearch'))).toEqual(CONNECTING)
    expect(entryOf(REQUEST, 'opensearch')).toBeUndefined()
    expect(result.current.state).toBe('connecting')

    await perform(() => answer.resolve(cachedAnswer()))

    expect(store.getState().catalogPulls.get(keyOf(REQUEST, 'opensearch'))).toMatchObject({
      status: 'loaded',
      data: { names: SAMPLE_NAMES },
    })
    expect(entryOf(REQUEST, 'opensearch')).toBeUndefined()
    expect(result.current.state).toBe('done')
  })
})

// ============================================
// Failure toast
// ============================================

describe('useCatalogPull failure toast', () => {
  const toastError = vi.fn()
  const TOAST: NonNullable<ContextType<typeof ToastContext>> = {
    toasts: [],
    toast: vi.fn(),
    success: vi.fn(),
    error: (message, title) => toastError(message, title),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
    maxToasts: 5,
  }

  function ToastWrapper({ children }: { children: ReactNode }) {
    return <ToastContext.Provider value={TOAST}>{children}</ToastContext.Provider>
  }

  function renderWithToast(kind: Kind = 'sql') {
    return renderHook(() => useCatalogPull<Names>(kind, REQUEST, API), { wrapper: ToastWrapper })
  }

  it.each([
    ['sql', 'Could not get tables'],
    ['opensearch', 'Could not get fields'],
  ] as const)('toasts why a refused %s start failed under %s', async (kind, title) => {
    startMock.mockRejectedValueOnce(new Error('Cluster URL is required'))
    const { result } = renderWithToast(kind)

    await perform(() => result.current.start())

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Cluster URL is required', title)
  })

  it('toasts the error of a failed job once', async () => {
    const message = 'Authentication failed: HTTP 401'
    getMock.mockResolvedValueOnce({ status: 'failed', error: message })
    const { result } = renderWithToast('opensearch')

    await perform(() => result.current.start())
    await advance(POLL_MS)
    await advance(POLL_MS * 4)

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(message, 'Could not get fields')
  })

  it('toasts the message of a refused poll', async () => {
    getMock.mockRejectedValueOnce(new Error('Network request failed'))
    const { result } = renderWithToast('opensearch')

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Network request failed', 'Could not get fields')
  })

  it('toasts once when two editors share the failed pull', async () => {
    startMock.mockRejectedValueOnce(new Error('Cluster URL is required'))
    const { result } = renderHook(
      () => ({
        first: useCatalogPull<Names>('opensearch', REQUEST, API),
        second: useCatalogPull<Names>('opensearch', REQUEST, API),
      }),
      { wrapper: ToastWrapper },
    )

    await perform(() => result.current.first.start())

    expect(result.current.second.state).toBe('failed')
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('toasts again when a retry fails again', async () => {
    startMock.mockRejectedValue(new Error('Cluster URL is required'))
    const { result } = renderWithToast('opensearch')

    await perform(() => result.current.start())
    await perform(() => result.current.start())

    expect(toastError).toHaveBeenCalledTimes(2)
  })

  it('toasts even after the editor that started the pull is gone', async () => {
    const message = 'Connection refused'
    getMock.mockResolvedValueOnce({ status: 'failed', error: message })
    const { result, unmount } = renderWithToast('opensearch')

    await perform(() => result.current.start())
    unmount()
    await advance(POLL_MS)

    expect(toastError).toHaveBeenCalledWith(message, 'Could not get fields')
  })

  it('does not toast a failed job that gives no reason', async () => {
    getMock.mockResolvedValueOnce({ status: 'failed' })
    const { result } = renderWithToast('opensearch')

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('failed')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('does not toast a pull that loads or is stopped', async () => {
    startMock.mockResolvedValueOnce(cachedAnswer())
    const { result } = renderWithToast('opensearch')
    await perform(() => result.current.start())
    expect(result.current.state).toBe('done')

    await perform(() => result.current.refresh())
    await perform(() => result.current.stop())
    await advance(POLL_MS * 4)

    expect(toastError).not.toHaveBeenCalled()
  })
})

// ============================================
// Failure toast title by where the pull started
// ============================================

describe('useCatalogPull failure toast title from the start', () => {
  const toastError = vi.fn()
  const TOAST: NonNullable<ContextType<typeof ToastContext>> = {
    toasts: [],
    toast: vi.fn(),
    success: vi.fn(),
    error: (message, title) => toastError(message, title),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
    maxToasts: 5,
  }

  function ToastWrapper({ children }: { children: ReactNode }) {
    return <ToastContext.Provider value={TOAST}>{children}</ToastContext.Provider>
  }

  function renderWithToast() {
    return renderHook(() => useCatalogPull<Names>('opensearch', REQUEST, API), { wrapper: ToastWrapper })
  }

  it('toasts a failed job under the title its start gave', async () => {
    const message = 'These credentials may not list every index. Type an index pattern they can read, such as logs-*'
    getMock.mockResolvedValueOnce({ status: 'failed', error: message })
    const { result } = renderWithToast()

    await perform(() => result.current.start('Could not get indexes'))
    await advance(POLL_MS)

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(message, 'Could not get indexes')
  })

  it('toasts a refused start under the title its start gave', async () => {
    startMock.mockRejectedValueOnce(new Error('Cluster URL is required'))
    const { result } = renderWithToast()

    await perform(() => result.current.start('Could not get indexes'))

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Cluster URL is required', 'Could not get indexes')
  })

  it('toasts a retry started without a title under the title of its kind', async () => {
    startMock.mockRejectedValue(new Error('Cluster URL is required'))
    const { result } = renderWithToast()

    await perform(() => result.current.start('Could not get indexes'))
    await perform(() => result.current.start())

    expect(toastError).toHaveBeenCalledTimes(2)
    expect(toastError).toHaveBeenLastCalledWith('Cluster URL is required', 'Could not get fields')
  })

  it('toasts once, under the first title, when a second start joins the running pull', async () => {
    const message = 'Connection refused'
    const { result } = renderWithToast()

    await perform(() => result.current.start('Could not get indexes'))
    await perform(() => result.current.start())
    getMock.mockResolvedValueOnce({ status: 'failed', error: message })
    await advance(POLL_MS)
    await advance(POLL_MS * 4)

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(message, 'Could not get indexes')
  })

  it('never takes a title for a refresh', async () => {
    startMock.mockResolvedValueOnce(cachedAnswer())
    const { result } = renderWithToast()
    await perform(() => result.current.start('Could not get indexes'))
    startMock.mockRejectedValueOnce(new Error('Connection refused'))

    await perform(() => result.current.refresh())

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Connection refused', 'Could not get fields')
  })
})
