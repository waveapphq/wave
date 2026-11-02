/**
 * useSessionArtifacts - single source of the live workbench session's
 * artifact list + count for the breadcrumb chip, the Session Artifacts
 * sheet, and the warn-on-wipe guards.
 *
 * Module: frontend/src/features/workbench/hooks/use-session-artifacts.ts
 *
 * Refresh contract: fetch when the session becomes active (mount /
 * session recovery), on run start (running false->true), on the terminal
 * transition (running true->false), on sheet open, after remove(), and on a
 * ~2s poll ONLY while the sheet is open AND the run is executing. A 404
 * ("No active workbench session") resolves to an empty list, never an error.
 *
 * Poll notice (LIST-26): a gesture or transition read that fails blocks the
 * canvas, while a failed poll tick keeps the last known items and reports the
 * reason through pollError; the next clean tick clears it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSessionArtifacts } from '@/features/workbench/hooks/use-session-artifacts'
import { workbenchApi } from '@/features/workbench/api/workbench'
import { usePageBlockStore } from '@/stores/page-block-store'

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    listSessionArtifacts: vi.fn(),
    deleteSessionArtifact: vi.fn(),
    downloadSessionArtifact: vi.fn(),
  },
}))

const listMock = vi.mocked(workbenchApi.listSessionArtifacts)
const deleteMock = vi.mocked(workbenchApi.deleteSessionArtifact)

const TWO_ITEMS = {
  items: [
    { path: 'output/data.json', size_bytes: 2048, created_at: '2026-07-02T10:00:00+00:00' },
    { path: 'report.json', size_bytes: 1024, created_at: '2026-07-02T10:00:01+00:00' },
  ],
}

interface HookOpts {
  sessionActive: boolean
  running: boolean
  sheetOpen: boolean
}

function setup(initial: HookOpts) {
  return renderHook((opts: HookOpts) => useSessionArtifacts(opts), {
    initialProps: initial,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  listMock.mockResolvedValue(TWO_ITEMS)
  deleteMock.mockResolvedValue(undefined)
  usePageBlockStore.setState({ block: null, retrying: false })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSessionArtifacts - activation fetches', () => {
  it('does not fetch while no session is active', async () => {
    setup({ sessionActive: false, running: false, sheetOpen: false })

    await act(async () => {})

    expect(listMock).not.toHaveBeenCalled()
  })

  it('fetches on mount when the session is already active and derives count/totalBytes', async () => {
    const { result } = setup({ sessionActive: true, running: false, sheetOpen: false })

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2)
    })
    expect(listMock).toHaveBeenCalledTimes(1)
    expect(result.current.count).toBe(2)
    expect(result.current.totalBytes).toBe(3072)
    expect(result.current.items[0].path).toBe('output/data.json')
  })

  it('fetches when the session becomes active (session recovery)', async () => {
    const { rerender } = setup({ sessionActive: false, running: false, sheetOpen: false })
    await act(async () => {})
    expect(listMock).not.toHaveBeenCalled()

    rerender({ sessionActive: true, running: false, sheetOpen: false })

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1)
    })
  })
})

describe('useSessionArtifacts - run transitions', () => {
  it('refetches on run start and again on the terminal transition', async () => {
    const { rerender } = setup({ sessionActive: true, running: false, sheetOpen: false })
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1)
    })

    rerender({ sessionActive: true, running: true, sheetOpen: false })
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2)
    })

    rerender({ sessionActive: true, running: false, sheetOpen: false })
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(3)
    })
  })

  it('refetches when the sheet opens', async () => {
    const { rerender } = setup({ sessionActive: true, running: false, sheetOpen: false })
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1)
    })

    rerender({ sessionActive: true, running: false, sheetOpen: true })

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2)
    })
  })
})

describe('useSessionArtifacts - error handling', () => {
  it('holds an empty list while the server reports no artifacts', async () => {
    listMock.mockResolvedValue({ items: [] })

    const { result } = setup({ sessionActive: true, running: false, sheetOpen: false })

    await waitFor(() => {
      expect(listMock).toHaveBeenCalled()
    })
    expect(result.current.items).toEqual([])
    expect(result.current.count).toBe(0)
    expect(result.current.totalBytes).toBe(0)
  })

  it('keeps the previous items and reports the read when a refresh fails with a non-404 error', async () => {
    const { result, rerender } = setup({ sessionActive: true, running: false, sheetOpen: false })
    await waitFor(() => {
      expect(result.current.count).toBe(2)
    })

    listMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    rerender({ sessionActive: true, running: false, sheetOpen: true })

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2)
    })
    expect(result.current.count).toBe(2)
    expect(result.current.items).toHaveLength(2)
    const block = usePageBlockStore.getState().block
    expect(block?.title).toBe('Could not load session artifacts')
    expect(block?.detail.message).toBe('boom')
  })

  it('clears the report once a later refresh succeeds', async () => {
    listMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
    const { result } = setup({ sessionActive: true, running: false, sheetOpen: false })
    await waitFor(() => {
      expect(usePageBlockStore.getState().block).not.toBeNull()
    })

    await act(async () => {
      await result.current.refresh()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.count).toBe(2)
  })

  it('re-runs the read on retry and keeps the report when it fails again', async () => {
    listMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    setup({ sessionActive: true, running: false, sheetOpen: false })
    await waitFor(() => {
      expect(usePageBlockStore.getState().block).not.toBeNull()
    })

    listMock.mockRejectedValue(Object.assign(new Error('still boom'), { status: 500 }))
    await act(async () => {
      await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow('still boom')
    })

    expect(usePageBlockStore.getState().block?.detail.message).toBe('still boom')
  })

  it('clears the report once a read succeeds again', async () => {
    listMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
    const { result } = setup({ sessionActive: true, running: false, sheetOpen: false })
    await waitFor(() => {
      expect(usePageBlockStore.getState().block).not.toBeNull()
    })

    listMock.mockResolvedValue({ items: [] })
    await act(async () => {
      await result.current.refresh()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.items).toEqual([])
  })
})

describe('useSessionArtifacts - refresh and remove', () => {
  it('refresh() fetches the list again', async () => {
    const { result } = setup({ sessionActive: true, running: false, sheetOpen: false })
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await result.current.refresh()
    })

    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('remove(path) deletes via the API then refreshes the list', async () => {
    const { result } = setup({ sessionActive: true, running: false, sheetOpen: false })
    await waitFor(() => {
      expect(result.current.count).toBe(2)
    })
    listMock.mockResolvedValue({
      items: [
        { path: 'report.json', size_bytes: 1024, created_at: '2026-07-02T10:00:01+00:00' },
      ],
    })

    await act(async () => {
      await result.current.remove('output/data.json')
    })

    expect(deleteMock).toHaveBeenCalledWith('output/data.json')
    expect(listMock).toHaveBeenCalledTimes(2)
    expect(result.current.count).toBe(1)
    expect(result.current.items[0].path).toBe('report.json')
  })

  it('remove(path) rejects and still re-reads the list when the delete fails', async () => {
    const { result } = setup({ sessionActive: true, running: false, sheetOpen: false })
    await waitFor(() => {
      expect(result.current.count).toBe(2)
    })
    deleteMock.mockRejectedValueOnce(new Error('Artifact is locked'))

    await act(async () => {
      await expect(result.current.remove('output/data.json')).rejects.toThrow('Artifact is locked')
    })

    // The file is still there, and the list on screen says so.
    expect(listMock).toHaveBeenCalledTimes(2)
    expect(result.current.count).toBe(2)
  })
})

describe('useSessionArtifacts - polling', () => {
  it('polls every 2s only while the sheet is open AND the run is executing', async () => {
    vi.useFakeTimers()
    const { rerender } = setup({ sessionActive: true, running: true, sheetOpen: true })
    // Initial activation + run-start fetches settle first.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const baseline = listMock.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(listMock.mock.calls.length).toBe(baseline + 1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(listMock.mock.calls.length).toBe(baseline + 2)

    // Closing the sheet stops the poll even though the run continues.
    rerender({ sessionActive: true, running: true, sheetOpen: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(listMock.mock.calls.length).toBe(baseline + 2)
  })

  it('does not poll while the sheet is open on a non-running session', async () => {
    vi.useFakeTimers()
    setup({ sessionActive: true, running: false, sheetOpen: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const baseline = listMock.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })

    expect(listMock.mock.calls.length).toBe(baseline)
  })
})

describe('useSessionArtifacts - poll failure notice (LIST-26)', () => {
  /** Mount with the poll running and let the activation fetch settle. */
  async function setupPolling() {
    vi.useFakeTimers()
    const view = setup({ sessionActive: true, running: true, sheetOpen: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    return view
  }

  async function tick() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
  }

  it('a failed tick keeps the last items, sets pollError, and raises no block', async () => {
    const { result } = await setupPolling()
    expect(result.current.items).toHaveLength(2)
    expect(result.current.pollError).toBeNull()

    listMock.mockRejectedValue(Object.assign(new Error('tick boom'), { status: 500 }))
    await tick()

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.items).toHaveLength(2)
    expect(result.current.count).toBe(2)
    expect(result.current.pollError).toBe('tick boom')
  })

  it('a tick succeeding clears pollError', async () => {
    const { result } = await setupPolling()
    listMock.mockRejectedValue(Object.assign(new Error('tick boom'), { status: 500 }))
    await tick()
    expect(result.current.pollError).toBe('tick boom')

    listMock.mockResolvedValue(TWO_ITEMS)
    await tick()

    expect(result.current.pollError).toBeNull()
    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.items).toHaveLength(2)
  })

  it('a failed tick leaves an existing block untouched', async () => {
    listMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
    const { result } = await setupPolling()
    const raised = usePageBlockStore.getState().block
    expect(raised?.detail.message).toBe('boom')

    listMock.mockRejectedValue(Object.assign(new Error('tick boom'), { status: 500 }))
    await tick()

    expect(usePageBlockStore.getState().block).toBe(raised)
    expect(usePageBlockStore.getState().block?.detail.message).toBe('boom')
    expect(result.current.pollError).toBe('tick boom')
  })

  it('a succeeding tick clears the block its own read raised', async () => {
    listMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
    const { result } = await setupPolling()
    expect(usePageBlockStore.getState().block).not.toBeNull()

    listMock.mockResolvedValue(TWO_ITEMS)
    await tick()

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.items).toHaveLength(2)
    expect(result.current.pollError).toBeNull()
  })

  it('pollError resets when the session ends', async () => {
    const { result, rerender } = await setupPolling()
    listMock.mockRejectedValue(Object.assign(new Error('tick boom'), { status: 500 }))
    await tick()
    expect(result.current.pollError).toBe('tick boom')

    await act(async () => {
      rerender({ sessionActive: false, running: false, sheetOpen: false })
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.pollError).toBeNull()
    expect(result.current.items).toEqual([])
  })
})
