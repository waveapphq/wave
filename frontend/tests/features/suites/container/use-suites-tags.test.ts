/**
 * useSuitesTags: the suite tag universe is a blocking read, so a failed fetch
 * blocks the page and the card's Try Again re-runs just that fetch. A failed
 * suite-list read owns the page instead, so nothing is blocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuitesTags: vi.fn(),
}))

import { fetchSuitesTags } from '@/features/suites/api/crud'
import { useSuitesTags } from '@/features/suites/container/use-suites-tags'
import type { PrimaryState } from '@/hooks/use-blocking-reads'
import { usePageBlockStore, type PageBlock } from '@/stores/page-block-store'

const mockFetchSuitesTags = vi.mocked(fetchSuitesTags)

function tagFailure(message: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path: '/suites/tags',
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

function renderTags(primary: PrimaryState = 'loaded') {
  return renderHook(({ state }: { state: PrimaryState }) => useSuitesTags(state), {
    initialProps: { state: primary },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  usePageBlockStore.setState({ block: null, retrying: false })
  mockFetchSuitesTags.mockResolvedValue(['smoke'])
})

describe('useSuitesTags', () => {
  it('returns the tags and leaves the page unblocked', async () => {
    const { result } = renderTags()

    await waitFor(() => expect(result.current).toEqual(['smoke']))
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('leaves a block raised by another surface alone', async () => {
    usePageBlockStore.getState().setBlock({
      owner: 'another-surface',
      label: 'sessions',
      detail: { message: 'stale' },
      retry: vi.fn().mockResolvedValue(undefined),
    })

    const { result } = renderTags()

    await waitFor(() => expect(result.current).toEqual(['smoke']))
    expect(currentBlock().title).toBe('Could not load sessions')
  })

  it('blocks the page when the tag read fails', async () => {
    mockFetchSuitesTags.mockRejectedValue(tagFailure('Tags unavailable'))

    const { result } = renderTags()

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(result.current).toEqual([])
    expect(currentBlock().title).toBe('Could not load tags')
    expect(currentBlock().detail).toEqual({
      method: 'GET',
      path: '/suites/tags',
      status: 500,
      statusText: 'Internal Server Error',
      durationMs: 9,
      requestId: 'req-tags',
      occurredAt: '2026-08-10T15:42:09.000Z',
      message: 'Tags unavailable',
    })
  })

  it('raises no block while the suite list read is still in flight', async () => {
    mockFetchSuitesTags.mockRejectedValue(tagFailure('Tags unavailable'))

    renderTags('pending')

    await waitFor(() => expect(mockFetchSuitesTags).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('raises no block when the suite list read failed', async () => {
    mockFetchSuitesTags.mockRejectedValue(tagFailure('Tags unavailable'))

    renderTags('failed')

    await waitFor(() => expect(mockFetchSuitesTags).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('restores the tags and clears the block on retry', async () => {
    mockFetchSuitesTags.mockRejectedValueOnce(tagFailure('Tags unavailable'))

    const { result } = renderTags()
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    mockFetchSuitesTags.mockResolvedValue(['recovered'])
    await act(async () => {
      await currentBlock().retry()
    })

    expect(result.current).toEqual(['recovered'])
    expect(usePageBlockStore.getState().block).toBeNull()
    expect(mockFetchSuitesTags).toHaveBeenCalledTimes(2)
  })

  it('re-blocks with the newer failure and rejects when the retry fails again', async () => {
    mockFetchSuitesTags.mockRejectedValue(tagFailure('Tags unavailable'))

    renderTags()
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    const newer = tagFailure('Still unavailable')
    mockFetchSuitesTags.mockRejectedValue(newer)
    await act(async () => {
      await expect(currentBlock().retry()).rejects.toBe(newer)
    })

    expect(currentBlock().detail.message).toBe('Still unavailable')
  })
})
