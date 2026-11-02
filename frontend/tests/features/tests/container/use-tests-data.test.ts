/**
 * useTestsData load outcomes: the test list is the only primary read. The suite
 * names and the tag universe each block the page on their own, and a failed
 * test-list read owns the page so nothing is blocked alongside it.
 *
 * Every argument passed to the hook is a stable module reference - an unstable
 * filters/setPageInfo identity would re-create `loadData` every render and trip
 * the hook's load effect into an update loop.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('@/features/tests/api/crud', () => ({
  fetchTests: vi.fn(),
  fetchTestsTags: vi.fn(),
  transformApiTest: vi.fn((test) => ({ ...test, lastRun: test.last_run, tags: test.tags ?? [] })),
}))

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuiteNames: vi.fn(),
}))

import { fetchTests, fetchTestsTags } from '@/features/tests/api/crud'
import { fetchSuiteNames } from '@/features/suites/api/crud'
import { useTestsData } from '@/features/tests/container/use-tests-data'
import { usePageBlockStore, type PageBlock } from '@/stores/page-block-store'
import type { TestsFilters } from '@/features/tests/components/tests-filters'
import type { PageInfo } from '@/components/shared/tables/table-utils'

const mockFetchTests = vi.mocked(fetchTests)
const mockFetchTags = vi.mocked(fetchTestsTags)
const mockFetchSuiteNames = vi.mocked(fetchSuiteNames)

const PAGE: PageInfo = { currentPage: 1, pageSize: 25, totalItems: 0, totalPages: 0 }
const NO_FILTERS: TestsFilters = { search: '', status: [], suiteIds: [], tags: [] }
const SET_PAGE = vi.fn()

const SUITES = [{ id: 'suite-1', name: 'Smoke' }]

function testsOk() {
  return {
    success: true,
    data: [
      {
        id: 'test-1',
        name: 'Login',
        status: 'passed',
        last_run: null,
        tags: [],
        version: '1.0.0',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        metadata: {},
      },
    ],
    pagination: { page: 1, per_page: 25, total: 1, total_pages: 1 },
  }
}

function readFailure(message: string, path: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path,
    status: 500,
    statusText: 'Internal Server Error',
  })
}

function renderData() {
  return renderHook(() => useTestsData(PAGE, NO_FILTERS, null, null, SET_PAGE))
}

function currentBlock(): PageBlock {
  const { block } = usePageBlockStore.getState()
  if (!block) throw new Error('expected the page to be blocked')
  return block
}

beforeEach(() => {
  vi.clearAllMocks()
  usePageBlockStore.setState({ block: null, retrying: false })
  mockFetchTests.mockResolvedValue(testsOk())
  mockFetchTags.mockResolvedValue(['api'])
  mockFetchSuiteNames.mockResolvedValue(SUITES)
})

describe('useTestsData - every read succeeds', () => {
  it('sets tests, suites and tags and leaves the page unblocked', async () => {
    const { result } = renderData()

    await waitFor(() => expect(result.current.tests).toHaveLength(1))
    expect(result.current.suites).toEqual(SUITES)
    expect(result.current.allTags).toEqual(['api'])
    expect(result.current.error).toBeNull()
    expect(usePageBlockStore.getState().block).toBeNull()
  })
})

describe('useTestsData - active filters', () => {
  it('sends every active filter and the sort to the list read', async () => {
    const filters: TestsFilters = {
      search: 'login',
      status: ['passed'],
      suiteIds: ['suite-1'],
      tags: ['api'],
    }

    renderHook(() => useTestsData(PAGE, filters, 'name', 'asc', SET_PAGE))

    await waitFor(() =>
      expect(mockFetchTests).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'login',
          status: ['passed'],
          suite_ids: ['suite-1'],
          tags: ['api'],
          sort_by: 'name',
          sort_order: 'asc',
        })
      )
    )
  })
})

describe('useTestsData - the tag read fails', () => {
  it('blocks the page instead of only logging', async () => {
    mockFetchTags.mockRejectedValue(readFailure('Tags unavailable', '/tests/tags'))

    const { result } = renderData()

    await waitFor(() => expect(currentBlock().title).toBe('Could not load tags'))
    expect(result.current.allTags).toEqual([])
    expect(result.current.tests).toHaveLength(1)
    expect(result.current.error).toBeNull()
    expect(currentBlock().detail.message).toBe('Tags unavailable')
  })

  it('restores the tags on retry without refetching the list', async () => {
    mockFetchTags.mockRejectedValueOnce(readFailure('Tags unavailable', '/tests/tags'))

    const { result } = renderData()
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    const listCalls = mockFetchTests.mock.calls.length
    mockFetchTags.mockResolvedValue(['recovered'])
    await act(async () => {
      await currentBlock().retry()
    })

    expect(result.current.allTags).toEqual(['recovered'])
    expect(usePageBlockStore.getState().block).toBeNull()
    expect(mockFetchTests).toHaveBeenCalledTimes(listCalls)
  })
})

describe('useTestsData - the suite names read fails', () => {
  it('blocks the page instead of taking it to the error state', async () => {
    mockFetchSuiteNames.mockRejectedValue(readFailure('Suites unavailable', '/suites/names'))

    const { result } = renderData()

    await waitFor(() => expect(currentBlock().title).toBe('Could not load suites'))
    expect(result.current.error).toBeNull()
    expect(result.current.tests).toHaveLength(1)
    expect(result.current.suites).toEqual([])
  })

  it('names both reads when the suite names and the tags fail together', async () => {
    mockFetchSuiteNames.mockRejectedValue(readFailure('Suites unavailable', '/suites/names'))
    mockFetchTags.mockRejectedValue(readFailure('Tags unavailable', '/tests/tags'))

    renderData()

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    await waitFor(() => expect(currentBlock().title).toBe('Could not load suites and tags'))
  })
})

describe('useTestsData - the primary read fails', () => {
  it('shows only the full-page error state when every read fails', async () => {
    mockFetchTests.mockRejectedValue(new Error('Tests unavailable'))
    mockFetchSuiteNames.mockRejectedValue(readFailure('Suites unavailable', '/suites/names'))
    mockFetchTags.mockRejectedValue(readFailure('Tags unavailable', '/tests/tags'))

    const { result } = renderData()

    await waitFor(() => expect(result.current.error).toBe('Tests unavailable'))
    await waitFor(() => expect(mockFetchTags).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('falls back to a generic message when the failure is not an Error', async () => {
    mockFetchTests.mockRejectedValue('weird failure')

    const { result } = renderData()

    await waitFor(() => expect(result.current.error).toBe('Failed to load tests'))
  })

  it('reaches the error state without waiting for the suite names read', async () => {
    let releaseSuites: (suites: typeof SUITES) => void = () => {}
    mockFetchTests.mockRejectedValue(new Error('Tests unavailable'))
    mockFetchSuiteNames.mockReturnValue(
      new Promise<typeof SUITES>((resolve) => {
        releaseSuites = resolve
      })
    )

    const { result } = renderData()

    await waitFor(() => expect(result.current.error).toBe('Tests unavailable'))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      releaseSuites(SUITES)
    })
  })
})

describe('useTestsData - retrying the list read', () => {
  it('re-runs the failed tag read too, so one gesture recovers the page', async () => {
    mockFetchTests.mockRejectedValueOnce(new Error('Tests unavailable'))
    mockFetchTags.mockRejectedValueOnce(readFailure('Tags unavailable', '/tests/tags'))

    const { result } = renderData()
    await waitFor(() => expect(result.current.error).toBe('Tests unavailable'))
    await waitFor(() => expect(mockFetchTags).toHaveBeenCalledTimes(1))
    expect(usePageBlockStore.getState().block).toBeNull()

    await act(async () => {
      await result.current.loadData()
    })

    await waitFor(() => expect(mockFetchTags).toHaveBeenCalledTimes(2))
    expect(result.current.allTags).toEqual(['api'])
    expect(result.current.error).toBeNull()
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('carries the tag reason from the retry, not the one the list failure hid', async () => {
    mockFetchTests.mockRejectedValueOnce(new Error('Tests unavailable'))
    mockFetchTags
      .mockRejectedValueOnce(readFailure('Tags unavailable', '/tests/tags'))
      .mockRejectedValueOnce(readFailure('Gateway timeout', '/tests/tags'))

    const { result } = renderData()
    await waitFor(() => expect(result.current.error).toBe('Tests unavailable'))

    await act(async () => {
      await result.current.loadData()
    })

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(currentBlock().detail.message).toBe('Gateway timeout')
  })
})
