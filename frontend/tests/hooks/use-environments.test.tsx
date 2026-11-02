/**
 * useEnvironments Hook Tests
 *
 * The environment names every execution-context picker reads. A failed read is
 * a failure: it blocks the surface that started it and never leaves an empty
 * list behind that the rest of the app would read as "there are none".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useEnvironments } from '@/hooks/use-environments'
import type { EnvironmentName } from '@/features/settings/api/environments/types'
import { fetchEnvironmentNames } from '@/features/settings/api/environments/crud'
import { usePageBlockStore, type PageBlock } from '@/stores/page-block-store'
import type { PrimaryState } from '@/hooks/use-blocking-reads'

// Mock the environments API
vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironmentNames: vi.fn(),
}))

const mockFetchEnvironmentNames = vi.mocked(fetchEnvironmentNames)

function currentBlock(): PageBlock {
  const { block } = usePageBlockStore.getState()
  if (!block) throw new Error('expected the surface to be blocked')
  return block
}

function readFailure(message: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path: '/environments/names',
    status: 503,
    statusText: 'Service Unavailable',
  })
}

describe('useEnvironments', () => {
  // Mock data matches EnvironmentName type (id, name, tags only)
  const mockEnvironments: EnvironmentName[] = [
    { id: 'env-1', name: 'Development', tags: ['dev'] },
    { id: 'env-2', name: 'Staging', tags: ['staging'] },
    { id: 'env-3', name: 'Production', tags: ['prod'] },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    usePageBlockStore.setState({ block: null, retrying: false })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('Initial State', () => {
    it('starts with loading true and empty environments', () => {
      // Setup: API returns after a delay
      mockFetchEnvironmentNames.mockImplementation(
        () => new Promise(() => {})
      )

      const { result } = renderHook(() => useEnvironments())

      expect(result.current.loading).toBe(true)
      expect(result.current.environments).toEqual([])
      expect(result.current.loaded).toBe(false)
    })
  })

  describe('Successful Fetch', () => {
    it('fetches environments on mount and updates state', async () => {
      // fetchEnvironmentNames returns array directly (not wrapped in { data })
      mockFetchEnvironmentNames.mockResolvedValue(mockEnvironments)

      const { result } = renderHook(() => useEnvironments())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.environments).toEqual(mockEnvironments)
      expect(result.current.loaded).toBe(true)
      expect(usePageBlockStore.getState().block).toBeNull()
      expect(mockFetchEnvironmentNames).toHaveBeenCalledTimes(1)
    })

    it('returns empty array when backend returns no environments', async () => {
      mockFetchEnvironmentNames.mockResolvedValue([])

      const { result } = renderHook(() => useEnvironments())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // A genuinely empty answer is still an answer: nothing is blocked and
      // the list reads as loaded.
      expect(result.current.environments).toEqual([])
      expect(result.current.loaded).toBe(true)
      expect(result.current.hasEnvironments).toBe(false)
      expect(usePageBlockStore.getState().block).toBeNull()
    })
  })

  describe('Failed Read', () => {
    it('blocks the surface instead of reporting no environments', async () => {
      mockFetchEnvironmentNames.mockRejectedValue(readFailure('Service Unavailable'))

      const { result } = renderHook(() => useEnvironments())

      await waitFor(() => {
        expect(usePageBlockStore.getState().block).not.toBeNull()
      })

      expect(currentBlock().title).toBe('Could not load environments')
      expect(currentBlock().detail.status).toBe(503)
      // The empty list is NOT an answer, so nothing may read it as one.
      expect(result.current.loaded).toBe(false)
      expect(result.current.loading).toBe(false)
    })

    it('reports a rejection that is not an Error', async () => {
      mockFetchEnvironmentNames.mockRejectedValue('Network error')

      renderHook(() => useEnvironments())

      await waitFor(() => {
        expect(usePageBlockStore.getState().block).not.toBeNull()
      })

      expect(currentBlock().detail.message).toBe('Network error')
    })

    it('keeps the last good list when a later read fails', async () => {
      mockFetchEnvironmentNames
        .mockResolvedValueOnce(mockEnvironments)
        .mockRejectedValueOnce(readFailure('down'))

      const { result } = renderHook(() => useEnvironments())

      await waitFor(() => expect(result.current.loaded).toBe(true))

      await act(async () => {
        await result.current.refresh()
      })

      await waitFor(() => {
        expect(usePageBlockStore.getState().block).not.toBeNull()
      })
      expect(result.current.environments).toEqual(mockEnvironments)
    })

    it('clears the block when Try Again succeeds', async () => {
      mockFetchEnvironmentNames
        .mockRejectedValueOnce(readFailure('down'))
        .mockResolvedValueOnce(mockEnvironments)

      const { result } = renderHook(() => useEnvironments())

      await waitFor(() => {
        expect(usePageBlockStore.getState().block).not.toBeNull()
      })

      await act(async () => {
        await currentBlock().retry()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      expect(result.current.environments).toEqual(mockEnvironments)
      expect(result.current.loaded).toBe(true)
    })

    it('stays blocked when Try Again fails again', async () => {
      mockFetchEnvironmentNames.mockRejectedValue(readFailure('still down'))

      renderHook(() => useEnvironments())

      await waitFor(() => {
        expect(usePageBlockStore.getState().block).not.toBeNull()
      })

      await act(async () => {
        await expect(currentBlock().retry()).rejects.toThrow('still down')
      })

      expect(usePageBlockStore.getState().block).not.toBeNull()
    })

    it('raises no block while the surface own records read has failed', async () => {
      mockFetchEnvironmentNames.mockRejectedValue(readFailure('down'))

      const { result } = renderHook(
        ({ primary }: { primary: PrimaryState }) => useEnvironments(primary),
        { initialProps: { primary: 'failed' as PrimaryState } }
      )

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('drops the block when the surface unmounts', async () => {
      mockFetchEnvironmentNames.mockRejectedValue(readFailure('down'))

      const { unmount } = renderHook(() => useEnvironments())

      await waitFor(() => {
        expect(usePageBlockStore.getState().block).not.toBeNull()
      })

      act(() => {
        unmount()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
    })
  })

  describe('Refresh', () => {
    it('refresh function re-fetches environments', async () => {
      mockFetchEnvironmentNames
        .mockResolvedValueOnce([mockEnvironments[0]])
        .mockResolvedValueOnce(mockEnvironments)

      const { result } = renderHook(() => useEnvironments())

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })
      expect(result.current.environments).toHaveLength(1)

      // Trigger refresh
      await act(async () => {
        await result.current.refresh()
      })

      expect(result.current.environments).toHaveLength(3)
      expect(mockFetchEnvironmentNames).toHaveBeenCalledTimes(2)
    })

    it('refresh sets loading state during re-fetch', async () => {
      let resolveSecondCall: (value: EnvironmentName[]) => void
      mockFetchEnvironmentNames
        .mockResolvedValueOnce(mockEnvironments)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecondCall = resolve
            })
        )

      const { result } = renderHook(() => useEnvironments())

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Start refresh - should be loading
      act(() => {
        void result.current.refresh()
      })

      expect(result.current.loading).toBe(true)

      // Resolve the refresh
      await act(async () => {
        resolveSecondCall(mockEnvironments)
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })
    })
  })

  describe('hasEnvironments Helper', () => {
    it('hasEnvironments is true when environments exist', async () => {
      mockFetchEnvironmentNames.mockResolvedValue(mockEnvironments)

      const { result } = renderHook(() => useEnvironments())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.hasEnvironments).toBe(true)
    })

    it('hasEnvironments is false when no environments exist', async () => {
      mockFetchEnvironmentNames.mockResolvedValue([])

      const { result } = renderHook(() => useEnvironments())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.hasEnvironments).toBe(false)
    })
  })
})
