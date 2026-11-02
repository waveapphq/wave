/**
 * Blocking reads: a failed secondary read blocks the surface, a primary
 * failure suppresses and clears the block, and every retry re-runs the read
 * rather than replaying a stored reason.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import {
  runBlockingRead,
  startBlockingRead,
  useBlockingReads,
  type BlockingRead,
  type PrimaryState,
} from '@/hooks/use-blocking-reads'
import { usePageBlockStore, type FailedRead, type PageBlock } from '@/stores/page-block-store'

function readFailure(message: string, path: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path,
    status: 500,
    statusText: 'Internal Server Error',
    durationMs: 12,
    requestId: 'req-1',
    occurredAt: '2026-08-10T15:42:09.000Z',
  })
}

function currentBlock(): PageBlock {
  const { block } = usePageBlockStore.getState()
  if (!block) throw new Error('expected the surface to be blocked')
  return block
}

function collector() {
  const raised: FailedRead[] = []
  return { raised, report: (failure: FailedRead) => raised.push(failure) }
}

beforeEach(() => {
  usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
})

describe('useBlockingReads', () => {
  it('holds the block until the primary read has settled', async () => {
    const tags = vi.fn().mockRejectedValue(readFailure('down', '/tags'))
    const reads: BlockingRead[] = [{ label: 'tags', run: tags }]
    const { result, rerender } = renderHook(
      ({ primary }: { primary: PrimaryState }) => useBlockingReads(primary),
      { initialProps: { primary: 'pending' as PrimaryState } }
    )

    await act(async () => {
      await result.current.load(reads)
    })
    expect(usePageBlockStore.getState().block).toBeNull()

    rerender({ primary: 'loaded' })
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(currentBlock().title).toBe('Could not load tags')
    expect(tags).toHaveBeenCalledTimes(1)
  })

  it('leaves the block alone while the primary read is reloading', async () => {
    const tags = vi.fn().mockRejectedValue(readFailure('down', '/tags'))
    const { result, rerender } = renderHook(
      ({ primary }: { primary: PrimaryState }) => useBlockingReads(primary),
      { initialProps: { primary: 'loaded' as PrimaryState } }
    )

    await act(async () => {
      await result.current.load([{ label: 'tags', run: tags }])
    })
    expect(usePageBlockStore.getState().block).not.toBeNull()

    await act(async () => {
      rerender({ primary: 'pending' })
    })

    expect(currentBlock().title).toBe('Could not load tags')
    expect(tags).toHaveBeenCalledTimes(1)
  })

  it('re-runs nothing when the primary read recovers with every read healthy', async () => {
    const tags = vi.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(
      ({ primary }: { primary: PrimaryState }) => useBlockingReads(primary),
      { initialProps: { primary: 'failed' as PrimaryState } }
    )

    await act(async () => {
      await result.current.load([{ label: 'tags', run: tags }])
    })

    await act(async () => {
      rerender({ primary: 'loaded' })
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(tags).toHaveBeenCalledTimes(1)
  })

  it('clears the block when the primary read fails', async () => {
    const reads: BlockingRead[] = [
      { label: 'tags', run: vi.fn().mockRejectedValue(readFailure('down', '/tags')) },
    ]
    const { result, rerender } = renderHook(
      ({ primary }: { primary: PrimaryState }) => useBlockingReads(primary),
      { initialProps: { primary: 'loaded' as PrimaryState } }
    )

    await act(async () => {
      await result.current.load(reads)
    })
    expect(usePageBlockStore.getState().block).not.toBeNull()

    rerender({ primary: 'failed' })
    await waitFor(() => expect(usePageBlockStore.getState().block).toBeNull())
  })

  it('raises no block when the primary read failed first', async () => {
    const reads: BlockingRead[] = [
      { label: 'tags', run: vi.fn().mockRejectedValue(readFailure('down', '/tags')) },
    ]
    const { result } = renderHook(() => useBlockingReads('failed'))

    await act(async () => {
      await result.current.load(reads)
    })

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('re-runs the read when the primary read recovers, and blocks on what it finds', async () => {
    const tags = vi.fn().mockRejectedValue(readFailure('down', '/tags'))
    const { result, rerender } = renderHook(
      ({ primary }: { primary: PrimaryState }) => useBlockingReads(primary),
      { initialProps: { primary: 'failed' as PrimaryState } }
    )

    await act(async () => {
      await result.current.load([{ label: 'tags', run: tags }])
    })
    expect(usePageBlockStore.getState().block).toBeNull()

    rerender({ primary: 'loaded' })
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(currentBlock().title).toBe('Could not load tags')
    expect(tags).toHaveBeenCalledTimes(2)
  })

  it('never replays a reason the read no longer gives', async () => {
    const tags = vi
      .fn()
      .mockRejectedValueOnce(readFailure('tags down', '/tags'))
      .mockRejectedValueOnce(readFailure('gateway timeout', '/tags'))
    const { result, rerender } = renderHook(
      ({ primary }: { primary: PrimaryState }) => useBlockingReads(primary),
      { initialProps: { primary: 'failed' as PrimaryState } }
    )

    await act(async () => {
      await result.current.load([{ label: 'tags', run: tags }])
    })

    rerender({ primary: 'loaded' })
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(currentBlock().detail.message).toBe('gateway timeout')
  })

  it('recovers the surface in one gesture when the primary read carried the retry', async () => {
    const tags = vi.fn().mockRejectedValueOnce(readFailure('tags down', '/tags'))
    const { result, rerender } = renderHook(
      ({ primary }: { primary: PrimaryState }) => useBlockingReads(primary),
      { initialProps: { primary: 'pending' as PrimaryState } }
    )

    await act(async () => {
      await result.current.load([{ label: 'tags', run: tags }])
    })
    await act(async () => {
      rerender({ primary: 'failed' })
    })
    expect(usePageBlockStore.getState().block).toBeNull()

    // The surface's own Try Again re-runs the primary read only.
    tags.mockResolvedValue(undefined)
    await act(async () => {
      rerender({ primary: 'pending' })
      rerender({ primary: 'loaded' })
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(tags).toHaveBeenCalledTimes(2)
  })

  it('clears its read once that read succeeds', async () => {
    const tags = vi.fn().mockRejectedValueOnce(readFailure('down', '/tags'))
    const { result } = renderHook(() => useBlockingReads('loaded'))

    await act(async () => {
      await result.current.load([{ label: 'tags', run: tags }])
    })
    expect(usePageBlockStore.getState().block).not.toBeNull()

    tags.mockResolvedValue(undefined)
    await act(async () => {
      await result.current.load([{ label: 'tags', run: tags }])
    })

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('names every read that failed and carries each reason', async () => {
    const { result } = renderHook(() => useBlockingReads('loaded'))

    await act(async () => {
      await result.current.load([
        {
          label: 'profile types',
          run: vi.fn().mockRejectedValue(readFailure('types down', '/types')),
        },
        { label: 'tags', run: vi.fn().mockRejectedValue(readFailure('tags down', '/tags')) },
      ])
    })

    expect(currentBlock().title).toBe('Could not load profile types and tags')
    expect(currentBlock().detail.message).toContain('types down')
    expect(currentBlock().detail.message).toContain('tags down')
  })

  it('reports a single failure with its full detail', async () => {
    const reason = readFailure('tags down', '/tags')
    const { result } = renderHook(() => useBlockingReads('loaded'))

    await act(async () => {
      await result.current.load([{ label: 'tags', run: vi.fn().mockRejectedValue(reason) }])
    })

    expect(currentBlock().detail).toEqual({
      method: 'GET',
      path: '/tags',
      status: 500,
      statusText: 'Internal Server Error',
      durationMs: 12,
      requestId: 'req-1',
      occurredAt: '2026-08-10T15:42:09.000Z',
      message: 'tags down',
    })
  })

  it('keeps a failure raised by a different group of reads', async () => {
    const { result } = renderHook(() => useBlockingReads('loaded'))

    await act(async () => {
      await result.current.load([
        { label: 'tags', run: vi.fn().mockRejectedValue(readFailure('tags down', '/tags')) },
      ])
    })
    await act(async () => {
      await result.current.load([
        { label: 'suites', run: vi.fn().mockRejectedValue(readFailure('suites down', '/suites')) },
      ])
    })

    expect(currentBlock().title).toBe('Could not load tags and suites')
  })

  it('retries only the read that failed and clears the block on success', async () => {
    const tags = vi.fn().mockRejectedValueOnce(readFailure('tags down', '/tags'))
    const suites = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useBlockingReads('loaded'))

    await act(async () => {
      await result.current.load([
        { label: 'tags', run: tags },
        { label: 'suites', run: suites },
      ])
    })
    tags.mockResolvedValue(undefined)
    await act(async () => {
      await currentBlock().retry()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(tags).toHaveBeenCalledTimes(2)
    expect(suites).toHaveBeenCalledTimes(1)
  })

  it('re-blocks with the newer reason and rejects when the retry fails again', async () => {
    const tags = vi.fn().mockRejectedValue(readFailure('tags down', '/tags'))
    const { result } = renderHook(() => useBlockingReads('loaded'))

    await act(async () => {
      await result.current.load([{ label: 'tags', run: tags }])
    })
    const newer = readFailure('still down', '/tags')
    tags.mockRejectedValue(newer)
    await act(async () => {
      await expect(currentBlock().retry()).rejects.toBe(newer)
    })

    expect(currentBlock().detail.message).toBe('still down')
  })

  it('clears the block when the surface unmounts', async () => {
    const { result, unmount } = renderHook(() => useBlockingReads('loaded'))

    await act(async () => {
      await result.current.load([
        { label: 'tags', run: vi.fn().mockRejectedValue(readFailure('down', '/tags')) },
      ])
    })
    expect(usePageBlockStore.getState().block).not.toBeNull()

    unmount()
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('raises nothing when a read fails after the surface unmounted', async () => {
    let fail: (reason: unknown) => void = () => {}
    const pending = new Promise<void>((_resolve, reject) => {
      fail = reject
    })
    const settled = pending.catch(() => {})
    const { result, unmount } = renderHook(() => useBlockingReads('loaded'))

    act(() => {
      result.current.start([{ label: 'tags', run: () => pending }])
    })
    unmount()
    await act(async () => {
      fail(readFailure('down', '/tags'))
      await settled
    })

    expect(usePageBlockStore.getState().block).toBeNull()
  })
})

describe('runBlockingRead', () => {
  it('reports nothing when the read succeeds', async () => {
    const { raised, report } = collector()

    await runBlockingRead({ label: 'tags', run: async () => {} }, report)

    expect(raised).toHaveLength(0)
  })

  it('reports the failure and rejects with the same reason', async () => {
    const { raised, report } = collector()
    const reason = new Error('Tags API down')

    await expect(
      runBlockingRead({ label: 'tags', run: () => Promise.reject(reason) }, report)
    ).rejects.toBe(reason)

    expect(raised).toHaveLength(1)
    expect(raised[0].label).toBe('tags')
    expect(raised[0].detail.message).toBe('Tags API down')
  })

  it('re-runs only this read on retry and reports the newest reason', async () => {
    const { raised, report } = collector()
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('still down'))

    await expect(runBlockingRead({ label: 'tags', run }, report)).rejects.toThrow('down')
    await expect(raised[0].retry()).rejects.toThrow('still down')

    expect(run).toHaveBeenCalledTimes(2)
    expect(raised[1].detail.message).toBe('still down')
  })

  it('reports nothing when the caller canceled the read', async () => {
    const { raised, report } = collector()

    await expect(
      runBlockingRead(
        {
          label: 'tags',
          canceled: () => true,
          run: () => Promise.reject(new Error('down')),
        },
        report
      )
    ).rejects.toThrow('down')

    expect(raised).toHaveLength(0)
  })

  it('reports when the caller has not canceled the read', async () => {
    const { raised, report } = collector()

    await expect(
      runBlockingRead(
        {
          label: 'tags',
          canceled: () => false,
          run: () => Promise.reject(new Error('down')),
        },
        report
      )
    ).rejects.toThrow('down')

    expect(raised).toHaveLength(1)
  })
})

describe('startBlockingRead', () => {
  it('reports a failure without rejecting to the caller', async () => {
    const { raised, report } = collector()

    startBlockingRead({ label: 'tags', run: () => Promise.reject(new Error('down')) }, report)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(raised).toHaveLength(1)
  })

  it('leaves a successful read unreported', async () => {
    const { raised, report } = collector()

    startBlockingRead({ label: 'tags', run: async () => {} }, report)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(raised).toHaveLength(0)
  })
})
