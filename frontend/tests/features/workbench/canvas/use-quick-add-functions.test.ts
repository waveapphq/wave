/**
 * useQuickAddFunctions tests (REQ-4.2.5, PICKER-1).
 *
 * The paged published-Function half of Quick Insert: page 1 on open, 25 rows
 * a request, alphabetical, server-side search after a 300ms pause, next page
 * on demand, and only the newest request may write.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const listFunctionsMock = vi.fn()
vi.mock('@/features/functions/api/functions-api', () => ({
  listFunctions: (...args: unknown[]) => listFunctionsMock(...args),
}))

import { useQuickAddFunctions } from '@/features/workbench/common/canvas/quick-add/use-quick-add-functions'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type { FunctionSummary } from '@/features/functions/api/types'

const PAGE_1 = { page: 1, per_page: 25, sort_by: 'name', sort_order: 'asc' }

function makeFn(overrides: Partial<FunctionSummary> = {}): FunctionSummary {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'fetch_user',
    description: 'Fetches a user',
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    latest_version: '1.0.0',
    ...overrides,
  } as FunctionSummary
}

/** N summaries with distinct ids and names, alphabetical by construction. */
function makeFns(count: number, prefix = 'fn'): FunctionSummary[] {
  return Array.from({ length: count }, (_, i) =>
    makeFn({
      id: `${prefix}-${String(i).padStart(3, '0')}`,
      name: `${prefix}_${String(i).padStart(3, '0')}`,
    }),
  )
}

function okResult(functions: FunctionSummary[], total = functions.length) {
  return {
    functions,
    pagination: {
      page: 1,
      per_page: 25,
      total,
      total_pages: Math.max(1, Math.ceil(total / 25)),
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Let every already-settled promise callback run. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function renderOpen() {
  return renderHook(({ open }) => useQuickAddFunctions(open), {
    initialProps: { open: true },
  })
}

beforeEach(() => {
  useWorkflowStore.getState().reset()
  listFunctionsMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useQuickAddFunctions - opening', () => {
  it('does not fetch while closed', () => {
    const { result } = renderHook(() => useQuickAddFunctions(false))
    expect(listFunctionsMock).not.toHaveBeenCalled()
    expect(result.current.items).toHaveLength(0)
  })

  it('fetches page 1 on open, 25 a page, alphabetical, with no search', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult([makeFn()]))
    const { result } = renderOpen()

    expect(listFunctionsMock).toHaveBeenCalledTimes(1)
    expect(listFunctionsMock).toHaveBeenCalledWith(PAGE_1)
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })
    expect(result.current.items[0]).toMatchObject({ type: 'function', name: 'fetch_user' })
    expect(result.current.status).toBe('ready')
    expect(result.current.total).toBe(1)
    expect(result.current.appliedQuery).toBe('')
  })

  it('reports the fetch as in flight until it lands', async () => {
    const first = deferred<ReturnType<typeof okResult>>()
    listFunctionsMock.mockReturnValueOnce(first.promise)
    const { result } = renderOpen()

    expect(result.current.status).toBe('loading')

    await act(async () => {
      first.resolve(okResult([makeFn()]))
    })
    expect(result.current.status).toBe('ready')
  })

  it('carries the server total even when the page is shorter than it', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(25), 60))
    const { result } = renderOpen()

    await waitFor(() => {
      expect(result.current.items).toHaveLength(25)
    })
    expect(result.current.total).toBe(60)
  })
})

describe('useQuickAddFunctions - failures', () => {
  it('falls back to an empty functions list when the first page rejects', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult([makeFn()]))
    const { result, rerender } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })

    listFunctionsMock.mockRejectedValueOnce(new Error('network down'))
    rerender({ open: false })
    rerender({ open: true })

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })
    expect(result.current.items).toHaveLength(0)
    expect(result.current.total).toBe(0)
  })

  it('keeps the loaded rows when a next page rejects', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(25), 60))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(25)
    })

    listFunctionsMock.mockRejectedValueOnce(new Error('network down'))
    act(() => {
      result.current.onLoadMore()
    })
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })
    expect(result.current.items).toHaveLength(25)
    expect(result.current.total).toBe(60)
  })

  it('retries exactly the first page that failed, with the same search', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult([]))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('ab')
    })
    listFunctionsMock.mockRejectedValueOnce(new Error('network down'))
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    vi.useRealTimers()
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    listFunctionsMock.mockResolvedValueOnce(okResult([makeFn({ name: 'abba' })]))
    act(() => {
      result.current.onRetry()
    })

    expect(listFunctionsMock).toHaveBeenLastCalledWith({ ...PAGE_1, search: 'ab' })
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })
  })

  it('retries the next page that failed, not page 1', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(25), 60))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(25)
    })

    listFunctionsMock.mockRejectedValueOnce(new Error('network down'))
    act(() => {
      result.current.onLoadMore()
    })
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(25, 'more'), 60))
    act(() => {
      result.current.onRetry()
    })

    expect(listFunctionsMock).toHaveBeenLastCalledWith({ ...PAGE_1, page: 2 })
    await waitFor(() => {
      expect(result.current.items).toHaveLength(50)
    })
  })

  it('ignores a response that settles after the popover closed', async () => {
    const first = deferred<ReturnType<typeof okResult>>()
    listFunctionsMock.mockReturnValueOnce(first.promise)
    const { result, rerender } = renderOpen()

    rerender({ open: false })
    await act(async () => {
      first.resolve(okResult([makeFn()]))
    })

    expect(result.current.items).toHaveLength(0)
    expect(result.current.status).toBe('loading')
  })

  it('ignores a rejection that settles after the popover closed', async () => {
    const first = deferred<ReturnType<typeof okResult>>()
    listFunctionsMock.mockReturnValueOnce(first.promise)
    const { result, rerender } = renderOpen()

    rerender({ open: false })
    await act(async () => {
      first.reject(new Error('late failure'))
    })

    expect(listFunctionsMock).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('loading')
  })
})

describe('useQuickAddFunctions - searching', () => {
  it('waits out the typing and sends only the last value', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult([]))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    listFunctionsMock.mockResolvedValue(okResult([makeFn({ name: 'abc_fn' })]))

    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('a')
      vi.advanceTimersByTime(100)
      result.current.onQueryChange('ab')
      vi.advanceTimersByTime(100)
      result.current.onQueryChange('abc')
    })
    expect(listFunctionsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    expect(listFunctionsMock).toHaveBeenCalledTimes(2)
    expect(listFunctionsMock).toHaveBeenLastCalledWith({ ...PAGE_1, search: 'abc' })
  })

  it('sends the trimmed search, not what was typed', async () => {
    listFunctionsMock.mockResolvedValue(okResult([]))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('  ab  ')
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    expect(listFunctionsMock).toHaveBeenLastCalledWith({ ...PAGE_1, search: 'ab' })
  })

  it('sends no search at all for a whitespace-only query', async () => {
    listFunctionsMock.mockResolvedValue(okResult([]))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('ab')
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    act(() => {
      result.current.onQueryChange('   ')
    })
    vi.useRealTimers()

    expect(listFunctionsMock).toHaveBeenLastCalledWith(PAGE_1)
    await waitFor(() => {
      expect(result.current.appliedQuery).toBe('')
    })
  })

  it('clears the search without waiting, dropping the pending one', async () => {
    listFunctionsMock.mockResolvedValue(okResult([]))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('ab')
      result.current.onQueryChange('')
    })
    expect(listFunctionsMock).toHaveBeenCalledTimes(2)
    expect(listFunctionsMock).toHaveBeenLastCalledWith(PAGE_1)

    await act(async () => {
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })
    expect(listFunctionsMock).toHaveBeenCalledTimes(2)
  })

  it('does not re-search when only surrounding spaces changed', async () => {
    listFunctionsMock.mockResolvedValue(okResult([]))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('ab')
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    expect(listFunctionsMock).toHaveBeenCalledTimes(2)

    act(() => {
      result.current.onQueryChange('ab ')
    })
    await act(async () => {
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })
    expect(listFunctionsMock).toHaveBeenCalledTimes(2)
  })

  it('replaces the rows on a query change rather than appending', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(3), 3))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(3)
    })

    vi.useFakeTimers()
    listFunctionsMock.mockResolvedValueOnce(okResult([makeFn({ id: 'only', name: 'only_one' })]))
    act(() => {
      result.current.onQueryChange('only')
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    vi.useRealTimers()

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })
    expect(result.current.items[0].name).toBe('only_one')
    expect(result.current.appliedQuery).toBe('only')
  })
})

describe('useQuickAddFunctions - paging', () => {
  it('appends the next page, keeping the search', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(25), 60))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(25)
    })

    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(25, 'more'), 60))
    act(() => {
      result.current.onLoadMore()
    })
    expect(listFunctionsMock).toHaveBeenLastCalledWith({ ...PAGE_1, page: 2 })

    await waitFor(() => {
      expect(result.current.items).toHaveLength(50)
    })
    expect(result.current.items[0].id).toBe('fn-000')
    expect(result.current.items[25].id).toBe('more-000')
  })

  it('keeps the search on the next page', async () => {
    listFunctionsMock.mockResolvedValue(okResult(makeFns(25), 60))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(25)
    })

    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('fn')
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    vi.useRealTimers()
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    act(() => {
      result.current.onLoadMore()
    })
    expect(listFunctionsMock).toHaveBeenLastCalledWith({ ...PAGE_1, page: 2, search: 'fn' })
    await flush()
  })

  it('stops paging once every row is loaded', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(3), 3))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(3)
    })

    act(() => {
      result.current.onLoadMore()
    })

    expect(listFunctionsMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a second load-more while one is already in flight', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(25), 60))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(25)
    })

    listFunctionsMock.mockReturnValueOnce(deferred<ReturnType<typeof okResult>>().promise)
    act(() => {
      result.current.onLoadMore()
      result.current.onLoadMore()
    })

    expect(listFunctionsMock).toHaveBeenCalledTimes(2)
  })

  it('does not page while a search is still waiting to be sent', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(25), 60))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(25)
    })

    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('ab')
      result.current.onLoadMore()
    })

    expect(listFunctionsMock).toHaveBeenCalledTimes(1)
  })

  it('does not page after a failure', async () => {
    listFunctionsMock.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    act(() => {
      result.current.onLoadMore()
    })

    expect(listFunctionsMock).toHaveBeenCalledTimes(1)
  })
})

describe('useQuickAddFunctions - superseded responses', () => {
  it('drops a search answer the user has already typed past', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult([]))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    const slow = deferred<ReturnType<typeof okResult>>()
    const fast = deferred<ReturnType<typeof okResult>>()
    listFunctionsMock.mockReturnValueOnce(slow.promise)
    listFunctionsMock.mockReturnValueOnce(fast.promise)

    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('ab')
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    act(() => {
      result.current.onQueryChange('abc')
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    vi.useRealTimers()

    await act(async () => {
      fast.resolve(okResult([makeFn({ id: 'abc-1', name: 'abc_fn' })], 1))
      await Promise.resolve()
    })
    await act(async () => {
      slow.resolve(okResult(makeFns(9, 'ab'), 9))
      await Promise.resolve()
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].name).toBe('abc_fn')
    expect(result.current.total).toBe(1)
    expect(result.current.appliedQuery).toBe('abc')
  })

  it('drops a stale append that lands after a fresh replace', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(25), 60))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(25)
    })

    const append = deferred<ReturnType<typeof okResult>>()
    listFunctionsMock.mockReturnValueOnce(append.promise)
    act(() => {
      result.current.onLoadMore()
    })

    vi.useFakeTimers()
    listFunctionsMock.mockResolvedValueOnce(okResult([makeFn({ id: 'x', name: 'x_fn' })], 60))
    act(() => {
      result.current.onQueryChange('x')
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    vi.useRealTimers()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })

    await act(async () => {
      append.resolve(okResult(makeFns(25, 'more'), 60))
      await Promise.resolve()
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.total).toBe(60)

    // The dropped append must not have advanced the page cursor either.
    listFunctionsMock.mockResolvedValueOnce(okResult([], 60))
    act(() => {
      result.current.onLoadMore()
    })
    expect(listFunctionsMock).toHaveBeenLastCalledWith({ ...PAGE_1, page: 2, search: 'x' })
    await flush()
  })

  it('keeps a good list when a superseded request fails', async () => {
    const slow = deferred<ReturnType<typeof okResult>>()
    listFunctionsMock.mockReturnValueOnce(slow.promise)
    const { result } = renderOpen()

    listFunctionsMock.mockResolvedValueOnce(okResult([makeFn({ id: 'good', name: 'good_fn' })], 1))
    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('good')
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    vi.useRealTimers()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })

    await act(async () => {
      slow.reject(new Error('the superseded one failed'))
      await Promise.resolve()
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.items).toHaveLength(1)
  })
})

describe('useQuickAddFunctions - library revision', () => {
  it('re-fetches page 1 with the current search when the library changes', async () => {
    listFunctionsMock.mockResolvedValue(okResult(makeFns(25), 60))
    const { result } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(25)
    })

    vi.useFakeTimers()
    act(() => {
      result.current.onQueryChange('fn')
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    vi.useRealTimers()
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(listFunctionsMock).toHaveBeenCalledTimes(2)

    listFunctionsMock.mockResolvedValueOnce(okResult(makeFns(2, 'after'), 2))
    act(() => {
      useWorkflowStore.getState().bumpFunctionLibraryRevision()
    })

    await waitFor(() => {
      expect(listFunctionsMock).toHaveBeenCalledTimes(3)
    })
    expect(listFunctionsMock).toHaveBeenLastCalledWith({ ...PAGE_1, search: 'fn' })
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2)
    })
  })

  it('does not fetch when the library changes while the popover is closed', async () => {
    const { rerender } = renderHook(({ open }) => useQuickAddFunctions(open), {
      initialProps: { open: false },
    })

    act(() => {
      useWorkflowStore.getState().bumpFunctionLibraryRevision()
    })
    expect(listFunctionsMock).not.toHaveBeenCalled()

    listFunctionsMock.mockResolvedValueOnce(okResult([]))
    rerender({ open: true })
    await flush()

    expect(listFunctionsMock).toHaveBeenCalledTimes(1)
  })
})

describe('useQuickAddFunctions - row identity', () => {
  it('keeps the row array when page 1 comes back unchanged', async () => {
    listFunctionsMock.mockResolvedValue(okResult(makeFns(3), 3))
    const { result, rerender } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(3)
    })
    const first = result.current.items

    rerender({ open: false })
    rerender({ open: true })
    await waitFor(() => {
      expect(listFunctionsMock).toHaveBeenCalledTimes(2)
    })
    await flush()

    expect(result.current.items).toBe(first)
  })

  it('replaces the row array when a version changed', async () => {
    listFunctionsMock.mockResolvedValueOnce(okResult([makeFn({ latest_version: '1.0.0' })], 1))
    const { result, rerender } = renderOpen()
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })
    const first = result.current.items

    listFunctionsMock.mockResolvedValueOnce(okResult([makeFn({ latest_version: '2.0.0' })], 1))
    rerender({ open: false })
    rerender({ open: true })

    await waitFor(() => {
      expect(result.current.items[0].version).toBe('2.0.0')
    })
    expect(result.current.items).not.toBe(first)
  })
})
