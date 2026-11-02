/**
 * useSqlCatalog: the SQL adapter on the generic catalog pull behind the Get Tables chip - the sql-tools calls,
 * the `{ tables }` data under the `sql` kind, and the tables and count the editor reads. The pull mechanics
 * (poll, Done hold, stop, stale answers) are covered in use-catalog-pull.test.tsx.
 *
 * REQ-3.4.1.6, REQ-5.1.4; SQL-12
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ContextType, ReactNode } from 'react'

const api = vi.hoisted(() => ({
  checkSql: vi.fn(),
  startCatalog: vi.fn(),
  getCatalog: vi.fn(),
  cancelCatalog: vi.fn(),
}))

vi.mock('@/features/workbench/api/sql-tools', () => api)

import { ToastContext } from '@/components/ui/toast'
import { useSqlCatalog } from '@/features/workbench/hooks/use-sql-catalog'
import { sqlCatalogRequestOf, sqlCatalogStateKey } from '@/features/workbench/lib/sql-connection'
import {
  WorkflowStoreProvider,
  createWorkflowStore,
  useWorkflowStore,
} from '@/features/workbench/stores/workflow-store'
import type { CatalogPullEntry } from '@/features/workbench/stores/workflow-store'
import type {
  SqlCatalogJob,
  SqlCatalogRequest,
  SqlCatalogStartResult,
} from '@/features/workbench/api/sql-tools'
import { CUSTOMERS, ORDERS, SAMPLE_CATALOG_REQUEST, SAMPLE_TABLES } from '../sql-fixtures'

// ============================================
// Test Helpers
// ============================================

const POLL_MS = 500
const HOLD_MS = 3000
const JOB_ID = 'job-1'

const REQUEST = SAMPLE_CATALOG_REQUEST

const NEW_JOB: SqlCatalogStartResult = { job_id: JOB_ID, cached: false }

const LOADED: CatalogPullEntry = {
  status: 'loaded',
  jobId: 'job-0',
  data: { tables: [...SAMPLE_TABLES] },
  error: null,
}

function cachedAnswer(tables = [...SAMPLE_TABLES]): SqlCatalogStartResult {
  return { job_id: 'job-cached', cached: true, tables }
}

function doneJob(tables = [...SAMPLE_TABLES]): SqlCatalogJob {
  return { status: 'done', tables }
}

function sqlKey(request: SqlCatalogRequest): string {
  return `sql:${sqlCatalogStateKey(request)}`
}

function entryOf(request: SqlCatalogRequest = REQUEST): CatalogPullEntry | undefined {
  return useWorkflowStore.getState().catalogPulls.get(sqlKey(request))
}

function seed(entry: CatalogPullEntry, key: string = sqlKey(REQUEST)): void {
  useWorkflowStore.getState().setCatalogPull(key, entry)
}

function renderCatalog(request: SqlCatalogRequest | null = REQUEST) {
  return renderHook(
    ({ value }: { value: SqlCatalogRequest | null }) => useSqlCatalog(value),
    { initialProps: { value: request } }
  )
}

function renderPair(first: SqlCatalogRequest, second: SqlCatalogRequest) {
  return renderHook(() => ({ first: useSqlCatalog(first), second: useSqlCatalog(second) }))
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
  api.startCatalog.mockResolvedValue(NEW_JOB)
  api.getCatalog.mockResolvedValue({ status: 'connecting' })
  api.cancelCatalog.mockResolvedValue({ status: 'canceled' })
  useWorkflowStore.getState().clearCatalogPulls()
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================
// No connection
// ============================================

describe('useSqlCatalog without a connection', () => {
  it('reads idle with no tables', () => {
    const { result } = renderCatalog(null)

    expect(result.current.state).toBe('idle')
    expect(result.current.tables).toBeNull()
    expect(result.current.count).toBe(0)
    expect(result.current.error).toBeNull()
  })

  it('never calls the sql-tools API', async () => {
    const { result } = renderCatalog(null)

    await perform(() => result.current.start())
    await perform(() => result.current.refresh())
    await perform(() => result.current.stop())
    await advance(2000)

    expect(api.startCatalog).not.toHaveBeenCalled()
    expect(api.getCatalog).not.toHaveBeenCalled()
    expect(api.cancelCatalog).not.toHaveBeenCalled()
  })
})

// ============================================
// The sql-tools pull
// ============================================

describe('useSqlCatalog pull', () => {
  it('starts the pull with startCatalog and the request, under the sql kind, with no tables yet', async () => {
    const answer = deferred<SqlCatalogStartResult>()
    api.startCatalog.mockReturnValueOnce(answer.promise)
    const { result } = renderCatalog()

    await perform(() => result.current.start())

    expect(api.startCatalog).toHaveBeenCalledExactlyOnceWith(REQUEST)
    expect([...useWorkflowStore.getState().catalogPulls.keys()]).toEqual([sqlKey(REQUEST)])
    expect(entryOf()).toEqual({ status: 'connecting', jobId: null, data: { tables: [] }, error: null })
    expect(result.current.state).toBe('connecting')
    expect(result.current.tables).toBeNull()
    expect(result.current.count).toBe(0)
  })

  it('reads the Connecting state of the job as connecting', async () => {
    const { result } = renderCatalog()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(api.getCatalog).toHaveBeenCalledExactlyOnceWith(JOB_ID)
    expect(result.current.state).toBe('connecting')
  })

  it('polls the job with getCatalog and loads its tables once done', async () => {
    api.getCatalog.mockResolvedValueOnce({ status: 'reading' }).mockResolvedValueOnce(doneJob())
    const { result } = renderCatalog()

    await perform(() => result.current.start())
    await advance(POLL_MS)
    expect(result.current.state).toBe('reading')
    await advance(POLL_MS)

    expect(api.getCatalog.mock.calls).toEqual([[JOB_ID], [JOB_ID]])
    expect(result.current.state).toBe('done')
    expect(result.current.tables).toEqual(SAMPLE_TABLES)
    expect(result.current.count).toBe(4)
    expect(result.current.error).toBeNull()
    expect(entryOf()).toEqual({
      status: 'loaded',
      jobId: JOB_ID,
      data: { tables: SAMPLE_TABLES },
      error: null,
    })

    await advance(HOLD_MS)
    expect(result.current.state).toBe('settled')
    expect(result.current.count).toBe(4)
  })

  it('loads an empty catalog when the done job carries no tables', async () => {
    api.getCatalog.mockResolvedValueOnce({ status: 'done' })
    const { result } = renderCatalog()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('done')
    expect(result.current.tables).toEqual([])
    expect(result.current.count).toBe(0)
    expect(entryOf()).toMatchObject({ status: 'loaded', data: { tables: [] } })
  })

  it('loads the cached tables with the job id and never polls', async () => {
    api.startCatalog.mockResolvedValueOnce(cachedAnswer())
    const { result } = renderCatalog()

    await perform(() => result.current.start())

    expect(entryOf()).toEqual({
      status: 'loaded',
      jobId: 'job-cached',
      data: { tables: SAMPLE_TABLES },
      error: null,
    })
    expect(result.current.state).toBe('done')
    expect(result.current.tables).toEqual(SAMPLE_TABLES)
    expect(result.current.count).toBe(4)

    await advance(POLL_MS * 4)
    expect(api.getCatalog).not.toHaveBeenCalled()
  })

  it('loads an empty catalog when the cached answer carries no tables', async () => {
    api.startCatalog.mockResolvedValueOnce({ job_id: 'job-cached', cached: true })
    const { result } = renderCatalog()

    await perform(() => result.current.start())

    expect(entryOf()).toMatchObject({ status: 'loaded', jobId: 'job-cached', data: { tables: [] } })
    expect(result.current.tables).toEqual([])
    expect(result.current.count).toBe(0)
  })

  it('pulls again with refresh through startCatalog', async () => {
    seed(LOADED)
    const { result } = renderCatalog()

    await perform(() => result.current.refresh())

    expect(api.startCatalog).toHaveBeenCalledExactlyOnceWith({ ...REQUEST, refresh: true })
    expect(result.current.tables).toBeNull()
    expect(result.current.count).toBe(0)
  })

  it('cancels the running job through cancelCatalog on stop', async () => {
    const { result } = renderCatalog()

    await perform(() => result.current.start())
    await perform(() => result.current.stop())

    expect(api.cancelCatalog).toHaveBeenCalledExactlyOnceWith(JOB_ID)
    expect(result.current.state).toBe('idle')
    expect(entryOf()).toBeUndefined()
  })

  it('fails with the error of a failed job and shows no tables', async () => {
    const message = 'password authentication failed for user "wave"'
    api.getCatalog.mockResolvedValueOnce({ status: 'failed', error: message })
    const { result } = renderCatalog()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('failed')
    expect(result.current.error).toBe(message)
    expect(result.current.tables).toBeNull()
    expect(result.current.count).toBe(0)
    expect(entryOf()).toEqual({ status: 'failed', jobId: JOB_ID, data: { tables: [] }, error: message })
  })

  it('fails with the message of a refused start', async () => {
    api.startCatalog.mockRejectedValueOnce(new Error('Host is required'))
    const { result } = renderCatalog()

    await perform(() => result.current.start())

    expect(result.current.state).toBe('failed')
    expect(result.current.error).toBe('Host is required')
    expect(result.current.tables).toBeNull()
  })
})

// ============================================
// An entry that is already there
// ============================================

describe('useSqlCatalog on an existing entry', () => {
  it('reads settled at once with the tables and count of a loaded entry', () => {
    seed(LOADED)

    const { result } = renderCatalog()

    expect(result.current.state).toBe('settled')
    expect(result.current.tables).toEqual(SAMPLE_TABLES)
    expect(result.current.count).toBe(4)
    expect(result.current.error).toBeNull()
    expect(api.startCatalog).not.toHaveBeenCalled()
  })

  it('reads the count of the tables a busy entry turns loaded with', () => {
    seed({ status: 'reading', jobId: 'job-other', data: { tables: [] }, error: null })
    const { result } = renderCatalog()

    act(() => {
      seed({ status: 'loaded', jobId: 'job-other', data: { tables: [ORDERS, CUSTOMERS] }, error: null })
    })

    expect(result.current.state).toBe('done')
    expect(result.current.tables).toEqual([ORDERS, CUSTOMERS])
    expect(result.current.count).toBe(2)
  })

  it('never reads an opensearch entry of the same state key', () => {
    seed(
      { status: 'loaded', jobId: 'job-fields', data: { indexes: [], fields: [] }, error: null },
      `opensearch:${sqlCatalogStateKey(REQUEST)}`,
    )

    const { result } = renderCatalog()

    expect(result.current.state).toBe('idle')
    expect(result.current.tables).toBeNull()
  })
})

// ============================================
// Two blocks whose passwords were sealed apart (SQL-12)
// ============================================

describe('useSqlCatalog shared by two blocks with identical rows', () => {
  /** The request of a block whose rows match the sample's, its password saved as `sealed`. */
  const blockRequest = (sealed: string): SqlCatalogRequest =>
    sqlCatalogRequestOf({
      values: { ...SAMPLE_CATALOG_REQUEST.connection, password: sealed },
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
      environmentId: SAMPLE_CATALOG_REQUEST.environment_id,
      testId: SAMPLE_CATALOG_REQUEST.test_id,
    })
  const FIRST_BLOCK = blockRequest('wave:enc:v1:bm9uY2UtMWNpcGhlcg==')
  const SECOND_BLOCK = blockRequest('wave:enc:v1:bm9uY2UtMmNpcGhlcg==')

  it('opens the second block editor settled once the first has loaded the tables', async () => {
    const answer = deferred<SqlCatalogStartResult>()
    api.startCatalog.mockReturnValueOnce(answer.promise)
    const first = renderCatalog(FIRST_BLOCK)

    await perform(() => first.result.current.start())
    await perform(() => answer.resolve(cachedAnswer()))
    const second = renderCatalog(SECOND_BLOCK)

    expect(sqlCatalogStateKey(SECOND_BLOCK)).toBe(sqlCatalogStateKey(FIRST_BLOCK))
    expect(second.result.current.state).toBe('settled')
    expect(second.result.current.tables).toEqual(SAMPLE_TABLES)
    expect(api.startCatalog).toHaveBeenCalledTimes(1)
    expect(api.startCatalog).toHaveBeenCalledWith(FIRST_BLOCK)
  })

  it('joins the pull the first block started and sends nothing more', async () => {
    const { result } = renderPair(FIRST_BLOCK, SECOND_BLOCK)

    await perform(() => result.current.first.start())
    await perform(() => result.current.second.start())

    expect(api.startCatalog).toHaveBeenCalledTimes(1)
    expect(result.current.second.state).toBe('connecting')
  })

  it('pulls with the second block own sealed password when it refreshes', async () => {
    seed(LOADED, sqlKey(FIRST_BLOCK))
    const second = renderCatalog(SECOND_BLOCK)

    await perform(() => second.result.current.refresh())

    expect(api.startCatalog).toHaveBeenCalledExactlyOnceWith({ ...SECOND_BLOCK, refresh: true })
  })

  it('keeps a block whose password is typed apart from one whose password is sealed', () => {
    seed(LOADED, sqlKey(FIRST_BLOCK))

    expect(renderCatalog(blockRequest('typed-password')).result.current.state).toBe('idle')
  })
})

// ============================================
// Store instance
// ============================================

describe('useSqlCatalog store instance', () => {
  it('reads and writes the store of the workbench it is rendered in', async () => {
    const store = createWorkflowStore({ persistKey: null })
    const answer = deferred<SqlCatalogStartResult>()
    api.startCatalog.mockReturnValueOnce(answer.promise)
    const { result } = renderHook(() => useSqlCatalog(REQUEST), { wrapper: providerFor(store) })

    await perform(() => result.current.start())

    expect(store.getState().catalogPulls.get(sqlKey(REQUEST))).toEqual({
      status: 'connecting',
      jobId: null,
      data: { tables: [] },
      error: null,
    })
    expect(entryOf()).toBeUndefined()
    expect(result.current.state).toBe('connecting')

    await perform(() => answer.resolve(cachedAnswer()))

    expect(store.getState().catalogPulls.get(sqlKey(REQUEST))).toMatchObject({
      status: 'loaded',
      data: { tables: SAMPLE_TABLES },
    })
    expect(entryOf()).toBeUndefined()
    expect(result.current.state).toBe('done')
    expect(result.current.count).toBe(4)
  })
})

// ============================================
// Failure toast title
// ============================================

describe('useSqlCatalog failure toast', () => {
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

  it('keeps Could not get tables whatever its caller hands start, such as a click', async () => {
    api.startCatalog.mockRejectedValueOnce(new Error('Host is required'))
    const { result } = renderHook(() => useSqlCatalog(REQUEST), { wrapper: ToastWrapper })
    const start = result.current.start as (arg: unknown) => void

    await perform(() => start({ type: 'click' }))

    expect(toastError).toHaveBeenCalledExactlyOnceWith('Host is required', 'Could not get tables')
  })
})
