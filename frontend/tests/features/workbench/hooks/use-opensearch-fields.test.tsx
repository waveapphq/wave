/**
 * useOpenSearchFields: the Get fields pull behind the Query editor's Fields chip and the field suggestions.
 *
 * REQ-3.3.2.5, REQ-3.3.2.6, REQ-5.1.2; OS-12, OS-13
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ContextType, ReactNode } from 'react'

const api = vi.hoisted(() => ({
  checkOpenSearch: vi.fn(),
  suggestOpenSearch: vi.fn(),
  startFields: vi.fn(),
  getFields: vi.fn(),
  cancelFields: vi.fn(),
}))

vi.mock('@/features/workbench/api/opensearch-tools', () => api)

import { ToastContext } from '@/components/ui/toast'
import { useOpenSearchFields } from '@/features/workbench/hooks/use-opensearch-fields'
import { catalogStateKey } from '@/features/workbench/lib/catalog-request'
import { useWorkflowStore, type CatalogPullEntry } from '@/features/workbench/stores/workflow-store'
import type { OpenSearchFieldsRequest } from '@/features/workbench/api/opensearch-tools'
import { SAMPLE_FIELDS, SAMPLE_FIELDS_REQUEST, SAMPLE_INDEXES } from '../opensearch-fixtures'

// ============================================
// Test Helpers
// ============================================

const POLL_MS = 500
const HOLD_MS = 3000
const JOB_ID = 'job-fields-1'
const REQUEST = SAMPLE_FIELDS_REQUEST

const OTHER_INDEX_REQUEST: OpenSearchFieldsRequest = {
  ...SAMPLE_FIELDS_REQUEST,
  connection: { ...SAMPLE_FIELDS_REQUEST.connection, index: 'metrics-*' },
}

const LOADED: CatalogPullEntry = {
  status: 'loaded',
  jobId: 'job-0',
  data: { indexes: [...SAMPLE_INDEXES], fields: [...SAMPLE_FIELDS] },
  error: null,
}

const openSearchKey = (request: OpenSearchFieldsRequest = REQUEST) => `opensearch:${catalogStateKey(request)}`

function seed(key: string, entry: CatalogPullEntry): void {
  act(() => {
    useWorkflowStore.getState().setCatalogPull(key, entry)
  })
}

function renderFields(request: OpenSearchFieldsRequest | null = REQUEST) {
  return renderHook(
    ({ value }: { value: OpenSearchFieldsRequest | null }) => useOpenSearchFields(value),
    { initialProps: { value: request } },
  )
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

function doneJob(fields = [...SAMPLE_FIELDS]) {
  return { status: 'done' as const, indexes: [...SAMPLE_INDEXES], fields }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  api.startFields.mockResolvedValue({ job_id: JOB_ID, cached: false })
  api.getFields.mockResolvedValue({ status: 'connecting' })
  api.cancelFields.mockResolvedValue({ status: 'canceled' })
  act(() => {
    useWorkflowStore.getState().clearCatalogPulls()
  })
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================
// Nothing asked yet
// ============================================

describe('useOpenSearchFields without a request', () => {
  it('reads idle with no fields, no indexes and no job', () => {
    const { result } = renderFields(null)

    expect(result.current.state).toBe('idle')
    expect(result.current.fields).toBeNull()
    expect(result.current.indexes).toBeNull()
    expect(result.current.jobId).toBeNull()
    expect(result.current.count).toBe(0)
    expect(result.current.error).toBeNull()
  })

  it('does nothing on start, refresh, stop or settle', async () => {
    const { result } = renderFields(null)

    await perform(() => result.current.start())
    await perform(() => result.current.refresh())
    await perform(() => result.current.stop())
    await perform(() => result.current.settle())
    await advance(2000)

    expect(result.current.state).toBe('idle')
    expect(api.startFields).not.toHaveBeenCalled()
    expect(api.getFields).not.toHaveBeenCalled()
    expect(api.cancelFields).not.toHaveBeenCalled()
    expect(useWorkflowStore.getState().catalogPulls.size).toBe(0)
  })
})

describe('useOpenSearchFields before any pull', () => {
  it('reads idle and never pulls on its own', async () => {
    const { result } = renderFields()

    await advance(5000)

    expect(result.current.state).toBe('idle')
    expect(result.current.fields).toBeNull()
    expect(result.current.indexes).toBeNull()
    expect(result.current.jobId).toBeNull()
    expect(result.current.count).toBe(0)
    expect(api.startFields).not.toHaveBeenCalled()
  })
})

// ============================================
// Start: connecting reads as reading
// ============================================

describe('useOpenSearchFields start', () => {
  it('asks for the fields once with the request as it is', async () => {
    const { result } = renderFields()

    await perform(() => result.current.start())

    expect(api.startFields).toHaveBeenCalledTimes(1)
    expect(api.startFields).toHaveBeenCalledWith(REQUEST)
  })

  it('reads Getting fields at once, while the pull connects', async () => {
    const answer = deferred<{ job_id: string; cached: boolean }>()
    api.startFields.mockReturnValueOnce(answer.promise)
    const { result } = renderFields()

    await perform(() => result.current.start())

    expect(result.current.state).toBe('reading')
    expect(result.current.fields).toBeNull()
    expect(result.current.indexes).toBeNull()
    expect(result.current.count).toBe(0)
  })

  it('keeps reading while the job reports it is connecting', async () => {
    const { result } = renderFields()

    await perform(() => result.current.start())
    await advance(POLL_MS)
    await advance(POLL_MS)

    expect(api.getFields).toHaveBeenCalledTimes(2)
    expect(api.getFields).toHaveBeenCalledWith(JOB_ID)
    expect(result.current.state).toBe('reading')
  })

  it('reads Getting fields while the job reads', async () => {
    api.getFields.mockResolvedValueOnce({ status: 'reading' })
    const { result } = renderFields()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('reading')
    expect(result.current.fields).toBeNull()
  })

  it('never reads connecting, from start to done', async () => {
    api.getFields
      .mockResolvedValueOnce({ status: 'connecting' })
      .mockResolvedValueOnce({ status: 'reading' })
      .mockResolvedValueOnce(doneJob())
    const { result } = renderFields()
    const seen = new Set<string>()

    await perform(() => result.current.start())
    seen.add(result.current.state)
    for (let poll = 0; poll < 3; poll += 1) {
      await advance(POLL_MS)
      seen.add(result.current.state)
    }

    expect(seen).not.toContain('connecting')
    expect([...seen]).toEqual(['reading', 'done'])
  })
})

// ============================================
// Loaded fields: the data mapping
// ============================================

describe('useOpenSearchFields loaded', () => {
  it('maps a done job to its fields, indexes, field count and job id', async () => {
    api.getFields.mockResolvedValueOnce(doneJob())
    const { result } = renderFields()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('done')
    expect(result.current.fields).toEqual(SAMPLE_FIELDS)
    expect(result.current.indexes).toEqual(SAMPLE_INDEXES)
    expect(result.current.count).toBe(SAMPLE_FIELDS.length)
    expect(result.current.jobId).toBe(JOB_ID)
    expect(result.current.error).toBeNull()
  })

  it('counts the fields, not the indexes', async () => {
    api.getFields.mockResolvedValueOnce(doneJob())
    const { result } = renderFields()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.count).toBe(11)
    expect(result.current.indexes).toHaveLength(4)
  })

  it('reads done for 3000 ms, then settled, keeping the fields', async () => {
    api.getFields.mockResolvedValueOnce(doneJob())
    const { result } = renderFields()

    await perform(() => result.current.start())
    await advance(POLL_MS)
    await advance(HOLD_MS - 1)
    expect(result.current.state).toBe('done')

    await advance(1)
    expect(result.current.state).toBe('settled')
    expect(result.current.fields).toEqual(SAMPLE_FIELDS)
    expect(result.current.count).toBe(11)
  })

  it('maps a cached answer the same way and never polls', async () => {
    api.startFields.mockResolvedValueOnce({
      job_id: 'job-cached',
      cached: true,
      indexes: [...SAMPLE_INDEXES],
      fields: [...SAMPLE_FIELDS],
    })
    const { result } = renderFields()

    await perform(() => result.current.start())

    expect(result.current.state).toBe('done')
    expect(result.current.fields).toEqual(SAMPLE_FIELDS)
    expect(result.current.indexes).toEqual(SAMPLE_INDEXES)
    expect(result.current.count).toBe(11)
    expect(result.current.jobId).toBe('job-cached')

    await advance(POLL_MS * 4)
    expect(api.getFields).not.toHaveBeenCalled()
  })

  it('lists the indexes alone for a blank Index pattern', async () => {
    api.getFields.mockResolvedValueOnce(doneJob([]))
    const { result } = renderFields()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('done')
    expect(result.current.fields).toEqual([])
    expect(result.current.indexes).toEqual(SAMPLE_INDEXES)
    expect(result.current.count).toBe(0)
  })

  it('loads empty lists when the done job carries neither', async () => {
    api.getFields.mockResolvedValueOnce({ status: 'done' })
    const { result } = renderFields()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('done')
    expect(result.current.fields).toEqual([])
    expect(result.current.indexes).toEqual([])
    expect(result.current.count).toBe(0)
  })
})

// ============================================
// Failures
// ============================================

describe('useOpenSearchFields failures', () => {
  it('reads failed with the job error and no fields', async () => {
    const error = 'Cannot resolve Cluster URL: name os_url is not defined'
    api.getFields.mockResolvedValueOnce({ status: 'failed', error })
    const { result } = renderFields()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(result.current.state).toBe('failed')
    expect(result.current.error).toBe(error)
    expect(result.current.fields).toBeNull()
    expect(result.current.indexes).toBeNull()
    expect(result.current.count).toBe(0)
  })

  it('reads failed with the message of a refused start', async () => {
    api.startFields.mockRejectedValueOnce(new Error('Cluster URL is required'))
    const { result } = renderFields()

    await perform(() => result.current.start())

    expect(result.current.state).toBe('failed')
    expect(result.current.error).toBe('Cluster URL is required')
  })

  it('tries again on start after a failure', async () => {
    api.startFields.mockRejectedValueOnce(new Error('Cluster URL is required'))
    const { result } = renderFields()

    await perform(() => result.current.start())
    await perform(() => result.current.start())

    expect(api.startFields).toHaveBeenCalledTimes(2)
    expect(result.current.state).toBe('reading')
  })
})

// ============================================
// Stop, refresh, settle
// ============================================

describe('useOpenSearchFields stop', () => {
  it('cancels the job and reads idle again', async () => {
    const { result } = renderFields()

    await perform(() => result.current.start())
    await perform(() => result.current.stop())

    expect(api.cancelFields).toHaveBeenCalledTimes(1)
    expect(api.cancelFields).toHaveBeenCalledWith(JOB_ID)
    expect(result.current.state).toBe('idle')
    expect(result.current.fields).toBeNull()
    expect(result.current.jobId).toBeNull()
  })

  it('stops polling once stopped', async () => {
    const { result } = renderFields()

    await perform(() => result.current.start())
    await perform(() => result.current.stop())
    await advance(POLL_MS * 4)

    expect(api.getFields).not.toHaveBeenCalled()
  })
})

describe('useOpenSearchFields refresh', () => {
  it('asks for a new pull of a loaded list with refresh set', async () => {
    seed(openSearchKey(), LOADED)
    const { result } = renderFields()

    await perform(() => result.current.refresh())

    expect(api.startFields).toHaveBeenCalledTimes(1)
    expect(api.startFields).toHaveBeenCalledWith({ ...REQUEST, refresh: true })
    expect(result.current.state).toBe('reading')
  })

  it('does not pull a loaded list again on start', async () => {
    seed(openSearchKey(), LOADED)
    const { result } = renderFields()

    await perform(() => result.current.start())

    expect(api.startFields).not.toHaveBeenCalled()
    expect(result.current.state).toBe('settled')
  })
})

describe('useOpenSearchFields settle', () => {
  it('settles Done at once and keeps the fields', async () => {
    api.getFields.mockResolvedValueOnce(doneJob())
    const { result } = renderFields()

    await perform(() => result.current.start())
    await advance(POLL_MS)
    expect(result.current.state).toBe('done')

    await perform(() => result.current.settle())

    expect(result.current.state).toBe('settled')
    expect(result.current.fields).toEqual(SAMPLE_FIELDS)
  })
})

// ============================================
// The shared store entry (OS-13)
// ============================================

describe('useOpenSearchFields on a stored entry', () => {
  it('reads a loaded entry under its opensearch key as settled', () => {
    seed(openSearchKey(), LOADED)

    const { result } = renderFields()

    expect(result.current.state).toBe('settled')
    expect(result.current.fields).toEqual(SAMPLE_FIELDS)
    expect(result.current.indexes).toEqual(SAMPLE_INDEXES)
    expect(result.current.count).toBe(11)
    expect(result.current.jobId).toBe('job-0')
  })

  it('reads a connecting entry as Getting fields', () => {
    seed(openSearchKey(), { status: 'connecting', jobId: null, data: null, error: null })

    expect(renderFields().result.current.state).toBe('reading')
  })

  it('writes its pull under the opensearch key', async () => {
    const { result } = renderFields()

    await perform(() => result.current.start())

    expect([...useWorkflowStore.getState().catalogPulls.keys()]).toEqual([openSearchKey()])
  })

  it('never reads a SQL pull that shares the state key', () => {
    seed(`sql:${catalogStateKey(REQUEST)}`, { ...LOADED, data: { tables: [] } })

    const { result } = renderFields()

    expect(result.current.state).toBe('idle')
    expect(result.current.fields).toBeNull()
  })

  it('reads the entry of its own Index pattern only', () => {
    seed(openSearchKey(OTHER_INDEX_REQUEST), LOADED)

    expect(renderFields().result.current.state).toBe('idle')
    expect(renderFields(OTHER_INDEX_REQUEST).result.current.state).toBe('settled')
  })
})

// ============================================
// Get indexes from the Index pattern row (OS-13)
// ============================================

describe('useOpenSearchFields start from the Index pattern row', () => {
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

  function renderWithToast(request: OpenSearchFieldsRequest = REQUEST) {
    return renderHook(() => useOpenSearchFields(request), { wrapper: ToastWrapper })
  }

  const REFUSED = 'These credentials may not list every index. Type an index pattern they can read, such as logs-*'

  it('asks for the same pull as Get fields', async () => {
    const { result } = renderWithToast()

    await perform(() => result.current.startIndexes())

    expect(api.startFields).toHaveBeenCalledExactlyOnceWith(REQUEST)
    expect(result.current.state).toBe('reading')
  })

  it('titles the failure toast Could not get indexes', async () => {
    api.getFields.mockResolvedValueOnce({ status: 'failed', error: REFUSED })
    const { result } = renderWithToast()

    await perform(() => result.current.startIndexes())
    await advance(POLL_MS)

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(REFUSED, 'Could not get indexes')
  })

  it('keeps Could not get fields for a start from anywhere else', async () => {
    api.getFields.mockResolvedValueOnce({ status: 'failed', error: 'Connection refused' })
    const { result } = renderWithToast()

    await perform(() => result.current.start())
    await advance(POLL_MS)

    expect(toastError).toHaveBeenCalledExactlyOnceWith('Connection refused', 'Could not get fields')
  })

  it('takes no title from what its caller hands start, such as a click', async () => {
    api.startFields.mockRejectedValueOnce(new Error('Cluster URL is required'))
    const { result } = renderWithToast()
    const start = result.current.start as (arg: unknown) => void

    await perform(() => start({ type: 'click' }))

    expect(toastError).toHaveBeenCalledExactlyOnceWith('Cluster URL is required', 'Could not get fields')
  })

  it('lists every index for a blank Index pattern', async () => {
    const blank: OpenSearchFieldsRequest = { ...REQUEST, connection: { ...REQUEST.connection, index: '' } }
    api.startFields.mockResolvedValueOnce({ job_id: JOB_ID, cached: true, indexes: [...SAMPLE_INDEXES], fields: [] })
    const { result } = renderWithToast(blank)

    await perform(() => result.current.startIndexes())

    expect(api.startFields).toHaveBeenCalledExactlyOnceWith(blank)
    expect(result.current.indexes).toEqual(SAMPLE_INDEXES)
    expect(result.current.fields).toEqual([])
  })

  it('does nothing without a request', async () => {
    const { result } = renderHook(() => useOpenSearchFields(null), { wrapper: ToastWrapper })

    await perform(() => result.current.startIndexes())

    expect(api.startFields).not.toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
  })
})
