/**
 * Tests for `useFunctionVersions` (REQ-3.1.2.2): fetches the published version
 * list for a Function instance config modal. A failed read is a failure - it
 * never leaves an empty list behind that reads as "not in the library".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const listFunctionVersionsMock = vi.fn()
vi.mock('@/features/functions/api/functions-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/functions/api/functions-api')>()),
  listFunctionVersions: (...args: unknown[]) => listFunctionVersionsMock(...args),
}))

import { useFunctionVersions } from '@/features/functions/hooks/use-function-versions'
import { usePageBlockStore, type PageBlock } from '@/stores/page-block-store'

function currentBlock(): PageBlock {
  const { block } = usePageBlockStore.getState()
  if (!block) throw new Error('expected the surface to be blocked')
  return block
}

function readFailure(message: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path: '/functions/fn-1/versions',
    status: 500,
  })
}

/** What the server sends for a Function the library no longer holds. */
function absentFunction() {
  return Object.assign(new Error("Function 'fn-1' not found"), {
    method: 'GET',
    path: '/functions/fn-1/versions',
    status: 404,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  usePageBlockStore.setState({ block: null, retrying: false })
})

describe('useFunctionVersions', () => {
  it('loads versions and latest on success', async () => {
    listFunctionVersionsMock.mockResolvedValue({
      versions: [{ version: '1.0.0' }, { version: '2.0.0' }],
      latest: '2.0.0',
    })
    const { result } = renderHook(() => useFunctionVersions('fn-1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(listFunctionVersionsMock).toHaveBeenCalledWith('fn-1')
    expect(result.current.versions).toHaveLength(2)
    expect(result.current.latest).toBe('2.0.0')
    expect(result.current.failed).toBe(false)
  })

  it('reports a genuinely empty library entry as an answer, not a failure', async () => {
    listFunctionVersionsMock.mockResolvedValue({ versions: [], latest: '' })
    const { result } = renderHook(() => useFunctionVersions('fn-1', null, true))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.versions).toEqual([])
    expect(result.current.failed).toBe(false)
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('reads a Function the library no longer holds as an answer, not a failure', async () => {
    listFunctionVersionsMock.mockRejectedValue(absentFunction())
    const { result } = renderHook(() => useFunctionVersions('fn-1', null, true))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.versions).toEqual([])
    expect(result.current.latest).toBe('')
    expect(result.current.failed).toBe(false)
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('clears state and skips the fetch when functionId is empty', async () => {
    const { result } = renderHook(() => useFunctionVersions(''))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(listFunctionVersionsMock).not.toHaveBeenCalled()
    expect(result.current.versions).toEqual([])
    expect(result.current.latest).toBe('')
    expect(result.current.failed).toBe(false)
  })

  it('marks the read failed on rejection without blocking a caller that reports itself', async () => {
    listFunctionVersionsMock.mockRejectedValue(readFailure('boom'))
    const { result } = renderHook(() => useFunctionVersions('fn-1'))

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.versions).toEqual([])
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('re-runs the read when the caller retries', async () => {
    listFunctionVersionsMock
      .mockRejectedValueOnce(readFailure('boom'))
      .mockResolvedValueOnce({ versions: [{ version: '1.0.0' }], latest: '1.0.0' })
    const { result } = renderHook(() => useFunctionVersions('fn-1'))

    await waitFor(() => expect(result.current.failed).toBe(true))

    act(() => {
      result.current.retry()
    })

    await waitFor(() => expect(result.current.versions).toHaveLength(1))
    expect(result.current.failed).toBe(false)
    expect(listFunctionVersionsMock).toHaveBeenCalledTimes(2)
  })

  it('blocks the surface when the caller owns no error state of its own', async () => {
    listFunctionVersionsMock.mockRejectedValue(readFailure('boom'))
    const { result } = renderHook(() => useFunctionVersions('fn-1', null, true))

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(currentBlock().title).toBe('Could not load Function versions')
    expect(currentBlock().detail.status).toBe(500)
    expect(result.current.failed).toBe(true)
  })

  it('clears the block when Try Again succeeds', async () => {
    listFunctionVersionsMock
      .mockRejectedValueOnce(readFailure('boom'))
      .mockResolvedValueOnce({ versions: [{ version: '3.0.0' }], latest: '3.0.0' })
    const { result } = renderHook(() => useFunctionVersions('fn-1', null, true))

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    await act(async () => {
      await currentBlock().retry()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.versions).toHaveLength(1)
    expect(result.current.failed).toBe(false)
  })

  it('keeps the last good version list when a later read fails', async () => {
    listFunctionVersionsMock
      .mockResolvedValueOnce({ versions: [{ version: '1.0.0' }], latest: '1.0.0' })
      .mockRejectedValueOnce(readFailure('gone'))
    const { result, rerender } = renderHook(
      ({ key }: { key: number }) => useFunctionVersions('fn-1', key),
      { initialProps: { key: 1 } },
    )

    await waitFor(() => expect(result.current.versions).toHaveLength(1))

    rerender({ key: 2 })

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.versions).toHaveLength(1)
    expect(result.current.latest).toBe('1.0.0')
  })

  it('ignores a resolution that arrives after unmount', async () => {
    let resolve!: (value: { versions: unknown[]; latest: string }) => void
    listFunctionVersionsMock.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const { result, unmount } = renderHook(() => useFunctionVersions('fn-1'))
    unmount()
    resolve({ versions: [{ version: '1.0.0' }], latest: '1.0.0' })
    await Promise.resolve()
    // The post-unmount resolution must be ignored: state never advances past
    // the initial loading snapshot.
    expect(result.current.isLoading).toBe(true)
    expect(result.current.versions).toEqual([])
  })

  it('ignores a rejection that arrives after unmount', async () => {
    let reject!: (err: Error) => void
    listFunctionVersionsMock.mockReturnValue(
      new Promise((_r, rej) => {
        reject = rej
      }),
    )
    const { result, unmount } = renderHook(() => useFunctionVersions('fn-1', null, true))
    unmount()
    reject(readFailure('late'))
    await Promise.resolve()
    // The post-unmount rejection must be ignored: nothing is committed and
    // nothing is reported.
    expect(result.current.failed).toBe(false)
    expect(result.current.isLoading).toBe(true)
    expect(usePageBlockStore.getState().block).toBeNull()
  })
})
