/**
 * Hook tests for useEnvironmentsState - covers the defensive guards in
 * handleDeleteEnvironment and confirmDeleteEnvironment that aren't
 * reachable through the standard UI flow, plus the tag read, which blocks
 * the page on failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, screen, waitFor } from '@testing-library/react'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'
import type { ReactNode } from 'react'

vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironments: vi.fn().mockResolvedValue({
    data: [],
    pagination: { page: 1, per_page: 20, total: 0, total_pages: 1 },
  }),
  fetchEnvironmentsTags: vi.fn().mockResolvedValue([]),
  createEnvironment: vi.fn(),
  updateEnvironment: vi.fn(),
  deleteEnvironment: vi.fn(),
  duplicateEnvironment: vi.fn(),
}))

vi.mock('@/features/settings/api/environments/import-export', () => ({
  exportEnvironment: vi.fn(),
  exportEnvironments: vi.fn(),
  validateEnvironmentImport: vi.fn(),
  importEnvironments: vi.fn(),
}))

import { useEnvironmentsState } from '@/features/settings/container/use-environments-state'
import {
  fetchEnvironments,
  fetchEnvironmentsTags,
  updateEnvironment,
} from '@/features/settings/api/environments/crud'
import { usePageBlockStore, type PageBlock } from '@/stores/page-block-store'

const mockFetchEnvironments = vi.mocked(fetchEnvironments)
const mockFetchTags = vi.mocked(fetchEnvironmentsTags)
const mockUpdateEnvironment = vi.mocked(updateEnvironment)

const LIST_RESULT = {
  data: [],
  pagination: { page: 1, per_page: 20, total: 0, total_pages: 1 },
}

/** Both section reads are primed per test: persistent overrides leak between tests. */
function primeSectionReads({ failListOnce = false } = {}) {
  mockFetchEnvironments.mockReset()
  mockFetchTags.mockReset()
  if (failListOnce) {
    mockFetchEnvironments.mockRejectedValueOnce(new Error('Environments unavailable'))
  }
  mockFetchEnvironments.mockResolvedValue(LIST_RESULT as never)
}

function tagFailure(message: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path: '/environments/tags',
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

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <ToastContainer />
    </ToastProvider>
  )
}

describe('useEnvironmentsState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePageBlockStore.setState({ block: null, retrying: false })
    mockFetchTags.mockResolvedValue([])
  })

  /** Render the hook and flush any on-mount effects (loadTags etc.). */
  async function renderAndSettle(active = true) {
    const view = renderHook(({ on }: { on: boolean }) => useEnvironmentsState(on), {
      wrapper,
      initialProps: { on: active },
    })
    // Drain pending promises from useEffect callbacks so subsequent state
    // settlements happen inside act().
    await act(async () => {
      await Promise.resolve()
    })
    return view
  }

  it('handleDeleteEnvironment is a no-op when the id is not in the list', async () => {
    const { result } = await renderAndSettle()

    act(() => {
      result.current.handleDeleteEnvironment('does-not-exist')
    })

    // No env was selected for delete - the dialog should never open.
    expect(result.current.envToDelete).toBeNull()
  })

  it('confirmDeleteEnvironment is a no-op when no env has been selected', async () => {
    const { result } = await renderAndSettle()
    const { deleteEnvironment } = await import('@/features/settings/api/environments/crud')

    await act(async () => {
      await result.current.confirmDeleteEnvironment()
    })

    expect(deleteEnvironment).not.toHaveBeenCalled()
    expect(result.current.deleteLoading).toBe(false)
  })

  describe('the tag read', () => {
    it('leaves the page unblocked when it succeeds', async () => {
      mockFetchTags.mockResolvedValue(['prod'])
      const { result } = await renderAndSettle()

      await waitFor(() => expect(result.current.allEnvironmentTags).toEqual(['prod']))
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('leaves a block raised elsewhere alone when its own read succeeds', async () => {
      usePageBlockStore.setState({
        block: {
          title: 'Could not load tags',
          detail: { message: 'stale' },
          retry: vi.fn().mockResolvedValue(undefined),
          reads: [
            {
              owner: 'someone-else',
              label: 'tags',
              detail: { message: 'stale' },
              retry: vi.fn().mockResolvedValue(undefined),
            },
          ],
        },
      })
      mockFetchTags.mockResolvedValue(['prod'])
      const { result } = await renderAndSettle()

      await waitFor(() => expect(result.current.allEnvironmentTags).toEqual(['prod']))
      expect(currentBlock().detail.message).toBe('stale')
    })

    it('does not read tags while the section is not showing', async () => {
      await renderAndSettle(false)

      expect(mockFetchTags).not.toHaveBeenCalled()
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('reads tags when the section becomes active', async () => {
      mockFetchTags.mockResolvedValue(['prod'])
      const { result, rerender } = await renderAndSettle(false)

      await act(async () => {
        rerender({ on: true })
        await Promise.resolve()
      })

      await waitFor(() => expect(result.current.allEnvironmentTags).toEqual(['prod']))
    })

    it('releases the block when the user leaves the section', async () => {
      mockFetchTags.mockRejectedValue(tagFailure('Tags unavailable'))
      const { rerender } = await renderAndSettle()
      await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

      await act(async () => {
        rerender({ on: false })
        await Promise.resolve()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
    })
  })

  describe('a failed environments read', () => {
    it('shows its own error and blocks nothing, even when the tag read failed too', async () => {
      const { fetchEnvironments } = await import('@/features/settings/api/environments/crud')
      vi.mocked(fetchEnvironments).mockRejectedValue(new Error('Environments unavailable'))
      mockFetchTags.mockRejectedValue(tagFailure('Tags unavailable'))

      const { result } = await renderAndSettle()
      await act(async () => {
        await result.current.loadEnvironments()
      })

      expect(result.current.environmentsError).toBe('Environments unavailable')
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('re-runs the tags read when the environments read recovers and blocks with the fresh reason', async () => {
      primeSectionReads({ failListOnce: true })
      mockFetchTags.mockRejectedValueOnce(tagFailure('Tags unavailable'))
      mockFetchTags.mockRejectedValue(tagFailure('Still unavailable'))

      const { result } = await renderAndSettle()
      await act(async () => {
        await result.current.loadEnvironments()
      })
      expect(usePageBlockStore.getState().block).toBeNull()

      await act(async () => {
        await result.current.loadEnvironments()
      })

      await waitFor(() => expect(mockFetchTags).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(currentBlock().detail.message).toBe('Still unavailable'))
      expect(currentBlock().title).toBe('Could not load tags')
    })

    it('clears the hidden tags failure when the re-run succeeds on recovery', async () => {
      primeSectionReads({ failListOnce: true })
      mockFetchTags.mockRejectedValueOnce(tagFailure('Tags unavailable'))
      mockFetchTags.mockResolvedValue(['recovered'])

      const { result } = await renderAndSettle()
      await act(async () => {
        await result.current.loadEnvironments()
      })
      expect(usePageBlockStore.getState().block).toBeNull()

      await act(async () => {
        await result.current.loadEnvironments()
      })

      await waitFor(() => expect(mockFetchTags).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(result.current.allEnvironmentTags).toEqual(['recovered']))
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('a tags block beside a healthy list is not re-fetched by a later list reload', async () => {
      primeSectionReads()
      mockFetchTags.mockRejectedValue(tagFailure('Tags unavailable'))

      const { result } = await renderAndSettle()
      await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

      await act(async () => {
        await result.current.loadEnvironments()
      })

      expect(mockFetchTags).toHaveBeenCalledTimes(1)
      expect(currentBlock().detail.message).toBe('Tags unavailable')
    })

    it('a recovered list read leaves healthy tags alone', async () => {
      primeSectionReads({ failListOnce: true })
      mockFetchTags.mockResolvedValue(['prod'])

      const { result } = await renderAndSettle()
      await act(async () => {
        await result.current.loadEnvironments()
      })
      await act(async () => {
        await result.current.loadEnvironments()
      })

      expect(mockFetchTags).toHaveBeenCalledTimes(1)
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('blocks the page when it fails', async () => {
      mockFetchTags.mockRejectedValue(tagFailure('Tags unavailable'))
      const { result } = await renderAndSettle()

      await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
      expect(result.current.allEnvironmentTags).toEqual([])
      expect(currentBlock().title).toBe('Could not load tags')
      expect(currentBlock().detail).toEqual({
        method: 'GET',
        path: '/environments/tags',
        status: 500,
        statusText: 'Internal Server Error',
        durationMs: 9,
        requestId: 'req-tags',
        occurredAt: '2026-08-10T15:42:09.000Z',
        message: 'Tags unavailable',
      })
    })

    it('restores the tags and clears the block on retry, without refetching the list', async () => {
      const { fetchEnvironments } = await import('@/features/settings/api/environments/crud')
      mockFetchTags.mockRejectedValueOnce(tagFailure('Tags unavailable'))
      const { result } = await renderAndSettle()
      await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

      const listCalls = vi.mocked(fetchEnvironments).mock.calls.length
      mockFetchTags.mockResolvedValue(['recovered'])
      await act(async () => {
        await currentBlock().retry()
      })

      expect(result.current.allEnvironmentTags).toEqual(['recovered'])
      expect(usePageBlockStore.getState().block).toBeNull()
      expect(vi.mocked(fetchEnvironments)).toHaveBeenCalledTimes(listCalls)
    })

    it('re-blocks with the newer failure and rejects when the retry fails again', async () => {
      mockFetchTags.mockRejectedValue(tagFailure('Tags unavailable'))
      await renderAndSettle()
      await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

      const newer = tagFailure('Still unavailable')
      mockFetchTags.mockRejectedValue(newer)
      await act(async () => {
        await expect(currentBlock().retry()).rejects.toBe(newer)
      })

      expect(currentBlock().detail.message).toBe('Still unavailable')
    })

    it('names the export failure in its toast title', async () => {
      const { exportEnvironments } = await import(
        '@/features/settings/api/environments/import-export'
      )
      vi.mocked(exportEnvironments).mockRejectedValue(new Error('Export unavailable'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = await renderAndSettle()

      await act(async () => {
        await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
      })

      expect(await screen.findByText('Export Failed')).toBeInTheDocument()
      expect(screen.getByText('Export unavailable')).toBeInTheDocument()
      consoleSpy.mockRestore()
    })

    it('blocks the page when the reload after a successful save fails', async () => {
      mockUpdateEnvironment.mockResolvedValue({
        id: 'env-1',
        name: 'Production',
        description: null,
        tags: [],
        usage: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as unknown as Awaited<ReturnType<typeof updateEnvironment>>)

      const { result } = await renderAndSettle()
      await waitFor(() => expect(mockFetchTags).toHaveBeenCalledTimes(1))

      mockFetchTags.mockRejectedValue(tagFailure('Tags unavailable'))
      await act(async () => {
        await result.current.handleFormSubmit({
          name: 'Production',
          description: null,
          tags: ['prod'],
        })
      })

      await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
      expect(currentBlock().title).toBe('Could not load tags')
    })
  })
})
