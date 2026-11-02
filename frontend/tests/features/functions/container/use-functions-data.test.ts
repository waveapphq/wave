/**
 * useFunctionsData branch coverage: the filter/sort query params, the
 * latest-version fallback, the non-Error load-failure message, and the tag
 * read, which blocks the page on failure. The happy path is exercised by
 * functions-list-container.test.tsx.
 *
 * All props passed to the hook are stable module references - an unstable
 * filters/setPageInfo identity would re-create `loadData` every render and
 * trip the hook's load effect into an update loop.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('@/features/functions/api/functions-api', () => ({
  listFunctions: vi.fn(),
  listFunctionTags: vi.fn(),
}))

import { listFunctions, listFunctionTags } from '@/features/functions/api/functions-api'
import { useFunctionsData } from '@/features/functions/container/use-functions-data'
import { usePageBlockStore, type PageBlock } from '@/stores/page-block-store'
import type { FunctionsFiltersState } from '@/features/functions/components/functions-filters'
import type { FunctionSummary } from '@/features/functions/api/types'
import type { PageInfo } from '@/components/shared/tables/table-utils'

const mockList = vi.mocked(listFunctions)
const mockTags = vi.mocked(listFunctionTags)

const PAGE: PageInfo = { currentPage: 1, pageSize: 25, totalItems: 0, totalPages: 0 }
const NO_FILTERS: FunctionsFiltersState = { search: '', tags: [] }
const TAG_FILTER: FunctionsFiltersState = { search: '', tags: ['mail'] }
const SET_PAGE = vi.fn()

function listOk(functions: FunctionSummary[]) {
  return {
    functions,
    pagination: { page: 1, per_page: 25, total: functions.length, total_pages: 1 },
  }
}

function tagFailure(message: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path: '/functions/tags',
    status: 500,
    statusText: 'Internal Server Error',
    durationMs: 9,
    requestId: 'req-tags',
    occurredAt: '2026-08-10T15:42:09.000Z',
  })
}

function currentBlock(): PageBlock {
  const { block } = usePageBlockStore.getState()
  if (!block) throw new Error('expected the page to be blocked')
  return block
}

beforeEach(() => {
  vi.clearAllMocks()
  usePageBlockStore.setState({ block: null, retrying: false })
  mockList.mockResolvedValue(listOk([]))
  mockTags.mockResolvedValue([])
})

describe('useFunctionsData', () => {
  it('sends tag + sort query params when filters and a sort are active', async () => {
    renderHook(() => useFunctionsData(PAGE, TAG_FILTER, 'name', 'asc', SET_PAGE))
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['mail'], sort_by: 'name', sort_order: 'asc' }),
      ),
    )
  })

  it('maps a summary with no latest version to an empty string', async () => {
    mockList.mockResolvedValue(
      listOk([
        {
          id: 'f1',
          name: 'no_version',
          description: '',
          tags: [],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]),
    )
    const { result } = renderHook(() => useFunctionsData(PAGE, NO_FILTERS, null, null, SET_PAGE))
    await waitFor(() => expect(result.current.functions).toHaveLength(1))
    expect(result.current.functions[0].latestVersion).toBe('')
  })

  it('falls back to a generic message when the load error is not an Error', async () => {
    mockList.mockRejectedValue('weird failure')
    const { result } = renderHook(() => useFunctionsData(PAGE, NO_FILTERS, null, null, SET_PAGE))
    await waitFor(() => expect(result.current.error).toBe('Failed to load functions'))
  })
})

describe('useFunctionsData - the tag read', () => {
  it('leaves the page unblocked when it succeeds', async () => {
    mockTags.mockResolvedValue(['mail'])
    const { result } = renderHook(() => useFunctionsData(PAGE, NO_FILTERS, null, null, SET_PAGE))

    await waitFor(() => expect(result.current.allTags).toEqual(['mail']))
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('leaves a block raised by another surface alone', async () => {
    usePageBlockStore.getState().setBlock({
      owner: 'another-surface',
      label: 'sessions',
      detail: { message: 'stale' },
      retry: vi.fn().mockResolvedValue(undefined),
    })
    mockTags.mockResolvedValue(['mail'])
    const { result } = renderHook(() => useFunctionsData(PAGE, NO_FILTERS, null, null, SET_PAGE))

    await waitFor(() => expect(result.current.allTags).toEqual(['mail']))
    expect(currentBlock().title).toBe('Could not load sessions')
  })

  it('raises no block when the list read failed too', async () => {
    mockList.mockRejectedValue(new Error('Functions unavailable'))
    mockTags.mockRejectedValue(tagFailure('Tags unavailable'))
    const { result } = renderHook(() => useFunctionsData(PAGE, NO_FILTERS, null, null, SET_PAGE))

    await waitFor(() => expect(result.current.error).toBe('Functions unavailable'))
    await waitFor(() => expect(mockTags).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('blocks the page when it fails', async () => {
    mockTags.mockRejectedValue(tagFailure('Tags unavailable'))
    const { result } = renderHook(() => useFunctionsData(PAGE, NO_FILTERS, null, null, SET_PAGE))

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(result.current.allTags).toEqual([])
    expect(result.current.error).toBeNull()
    expect(currentBlock().title).toBe('Could not load tags')
    expect(currentBlock().detail).toEqual({
      method: 'GET',
      path: '/functions/tags',
      status: 500,
      statusText: 'Internal Server Error',
      durationMs: 9,
      requestId: 'req-tags',
      occurredAt: '2026-08-10T15:42:09.000Z',
      message: 'Tags unavailable',
    })
  })

  it('restores the tags and clears the block on retry, without refetching the list', async () => {
    mockTags.mockRejectedValueOnce(tagFailure('Tags unavailable'))
    const { result } = renderHook(() => useFunctionsData(PAGE, NO_FILTERS, null, null, SET_PAGE))
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    const listCalls = mockList.mock.calls.length
    mockTags.mockResolvedValue(['recovered'])
    await act(async () => {
      await currentBlock().retry()
    })

    expect(result.current.allTags).toEqual(['recovered'])
    expect(usePageBlockStore.getState().block).toBeNull()
    expect(mockList).toHaveBeenCalledTimes(listCalls)
  })

  it('is re-run when the list retry succeeds, so one gesture recovers the page', async () => {
    mockList.mockRejectedValueOnce(new Error('Functions unavailable'))
    mockTags.mockRejectedValueOnce(tagFailure('Tags unavailable'))
    const { result } = renderHook(() => useFunctionsData(PAGE, NO_FILTERS, null, null, SET_PAGE))

    await waitFor(() => expect(result.current.error).toBe('Functions unavailable'))
    await waitFor(() => expect(mockTags).toHaveBeenCalledTimes(1))
    expect(usePageBlockStore.getState().block).toBeNull()

    mockTags.mockResolvedValue(['recovered'])
    await act(async () => {
      await result.current.loadData()
    })

    await waitFor(() => expect(result.current.allTags).toEqual(['recovered']))
    expect(mockTags).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('carries the reason from the re-run, not the one the list failure hid', async () => {
    mockList.mockRejectedValueOnce(new Error('Functions unavailable'))
    mockTags
      .mockRejectedValueOnce(tagFailure('Tags unavailable'))
      .mockRejectedValueOnce(tagFailure('Gateway timeout'))
    const { result } = renderHook(() => useFunctionsData(PAGE, NO_FILTERS, null, null, SET_PAGE))

    await waitFor(() => expect(result.current.error).toBe('Functions unavailable'))

    await act(async () => {
      await result.current.loadData()
    })

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(currentBlock().detail.message).toBe('Gateway timeout')
  })

  it('re-blocks with the newer failure and rejects when the retry fails again', async () => {
    mockTags.mockRejectedValue(tagFailure('Tags unavailable'))
    renderHook(() => useFunctionsData(PAGE, NO_FILTERS, null, null, SET_PAGE))
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    const newer = tagFailure('Still unavailable')
    mockTags.mockRejectedValue(newer)
    await act(async () => {
      await expect(currentBlock().retry()).rejects.toBe(newer)
    })

    expect(currentBlock().detail.message).toBe('Still unavailable')
  })
})
