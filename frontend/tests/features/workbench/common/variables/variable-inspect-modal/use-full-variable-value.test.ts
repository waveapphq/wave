/**
 * Tests for useFullVariableValue - the event-driven full-value fetch hook.
 *
 * Contract under test:
 *   - needsFetch = isComplex && hasRuntimeValue && isSummaryEnvelope(runtime)
 *     && !!sessionId; when false the hook returns {fullValue: undefined,
 *     isFirstFetchPending: false} and never calls the API
 *   - first fetch: isFirstFetchPending true until the value lands
 *   - 250ms trailing debounce per watcher; rapid envelopes coalesce
 *   - re-fetch on runtimeValue OBJECT IDENTITY change (each WS envelope is a
 *     fresh object); same identity never re-fetches
 *   - stale-while-revalidate: previous fullValue holds during re-fetches
 *   - fetch errors keep the previous value, report themselves through
 *     refreshFailure so the watcher can show it beside that value, and retry
 *     on the next envelope
 *   - unmount cancels the pending debounce timer
 *
 * REQ-3.1.3.12: Auto-refresh watched variables on change
 * REQ-3.2.2.18: Live variable values display
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    getSessionVariables: vi.fn(),
  },
}))

import { workbenchApi } from '@/features/workbench/api/workbench'
import { useFullVariableValue } from '@/features/workbench/common/variables/variable-inspect-modal/use-full-variable-value'

const mockGetSessionVariables = vi.mocked(
  (workbenchApi as unknown as {
    getSessionVariables: (
      sessionId: string,
      names?: string[],
      functionPath?: string[],
    ) => Promise<Record<string, { value: unknown; type: string; elementTypes?: unknown }>>
  }).getSessionVariables,
)

interface HookParams {
  sessionId?: string | null
  variableName: string
  runtimeValue: unknown
  hasRuntimeValue: boolean
  isComplex: boolean
  functionPath?: string[]
}

function liveParams(overrides: Partial<HookParams> = {}): HookParams {
  return {
    sessionId: 'session-1',
    variableName: 'items',
    runtimeValue: { count: 2, changed: true },
    hasRuntimeValue: true,
    isComplex: true,
    ...overrides,
  }
}

function renderFetchHook(initial: HookParams) {
  return renderHook((params: HookParams) => useFullVariableValue(params), {
    initialProps: initial,
  })
}

async function flushFetch() {
  // Fire the trailing debounce, then flush the resolved promise chain.
  await act(async () => {
    vi.advanceTimersByTime(250)
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  mockGetSessionVariables.mockReset()
  mockGetSessionVariables.mockResolvedValue({
    items: { value: ['a', 'b'], type: 'array' },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

// ===========================================================================
// needsFetch matrix
// ===========================================================================

describe('useFullVariableValue - needsFetch matrix', () => {
  it('does not fetch while idle (no runtime value)', () => {
    const { result } = renderFetchHook(
      liveParams({ runtimeValue: undefined, hasRuntimeValue: false }),
    )
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(mockGetSessionVariables).not.toHaveBeenCalled()
    expect(result.current.fullValue).toBeUndefined()
    expect(result.current.isFirstFetchPending).toBe(false)
  })

  it('does not fetch for a full (history snapshot) runtime value', () => {
    const { result } = renderFetchHook(
      liveParams({ runtimeValue: ['already', 'full'] }),
    )
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(mockGetSessionVariables).not.toHaveBeenCalled()
    expect(result.current.fullValue).toBeUndefined()
    expect(result.current.isFirstFetchPending).toBe(false)
  })

  it('does not fetch without a sessionId (history workbench)', () => {
    const { result } = renderFetchHook(liveParams({ sessionId: undefined }))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(mockGetSessionVariables).not.toHaveBeenCalled()
    expect(result.current.isFirstFetchPending).toBe(false)
  })

  it('does not fetch with a null sessionId', () => {
    renderFetchHook(liveParams({ sessionId: null }))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(mockGetSessionVariables).not.toHaveBeenCalled()
  })

  it('does not fetch for non-complex variables', () => {
    renderFetchHook(liveParams({ isComplex: false }))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(mockGetSessionVariables).not.toHaveBeenCalled()
  })

  it('returns undefined fullValue when needsFetch turns false again', async () => {
    const { result, rerender } = renderFetchHook(liveParams())
    await flushFetch()
    expect(result.current.fullValue).toEqual(['a', 'b'])

    rerender(liveParams({ runtimeValue: undefined, hasRuntimeValue: false }))
    expect(result.current.fullValue).toBeUndefined()
    expect(result.current.isFirstFetchPending).toBe(false)
  })
})

// ===========================================================================
// First fetch
// ===========================================================================

describe('useFullVariableValue - first fetch', () => {
  it('flags the first fetch pending immediately', () => {
    const { result } = renderFetchHook(liveParams())
    expect(result.current.isFirstFetchPending).toBe(true)
    expect(result.current.fullValue).toBeUndefined()
  })

  it('debounces the fetch by 250ms (trailing)', async () => {
    renderFetchHook(liveParams())
    act(() => {
      vi.advanceTimersByTime(249)
    })
    expect(mockGetSessionVariables).not.toHaveBeenCalled()
    // Drain the resolved fetch inside act so the state update is not orphaned.
    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(mockGetSessionVariables).toHaveBeenCalledTimes(1)
  })

  it('fetches only this watcher name from the session endpoint', async () => {
    renderFetchHook(liveParams())
    await flushFetch()
    expect(mockGetSessionVariables).toHaveBeenCalledWith('session-1', ['items'])
  })

  it('delivers the fetched value and clears the pending flag', async () => {
    const { result } = renderFetchHook(liveParams())
    await flushFetch()
    expect(result.current.fullValue).toEqual(['a', 'b'])
    expect(result.current.isFirstFetchPending).toBe(false)
  })
})

// ===========================================================================
// Re-fetch on envelope identity change
// ===========================================================================

describe('useFullVariableValue - envelope-driven re-fetch', () => {
  it('re-fetches when a NEW envelope object arrives (identity change)', async () => {
    const { rerender } = renderFetchHook(liveParams())
    await flushFetch()
    expect(mockGetSessionVariables).toHaveBeenCalledTimes(1)

    rerender(liveParams({ runtimeValue: { count: 2, changed: true } }))
    await flushFetch()
    expect(mockGetSessionVariables).toHaveBeenCalledTimes(2)
  })

  it('does NOT re-fetch when the same envelope object rerenders', async () => {
    const params = liveParams()
    const { rerender } = renderFetchHook(params)
    await flushFetch()

    rerender({ ...params })
    await flushFetch()
    expect(mockGetSessionVariables).toHaveBeenCalledTimes(1)
  })

  it('coalesces rapid envelopes into one trailing fetch', async () => {
    const { rerender } = renderFetchHook(liveParams())
    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender(liveParams({ runtimeValue: { count: 3, changed: true } }))
    act(() => {
      vi.advanceTimersByTime(249)
    })
    expect(mockGetSessionVariables).not.toHaveBeenCalled()
    await flushFetch()
    expect(mockGetSessionVariables).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous value while a re-fetch is in flight (stale-while-revalidate)', async () => {
    const { result, rerender } = renderFetchHook(liveParams())
    await flushFetch()
    expect(result.current.fullValue).toEqual(['a', 'b'])

    let resolveSecond!: (
      value: Record<string, { value: unknown; type: string }>,
    ) => void
    mockGetSessionVariables.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
    )
    rerender(liveParams({ runtimeValue: { count: 3, changed: true } }))
    act(() => {
      vi.advanceTimersByTime(250)
    })

    // In flight: previous value holds, no first-fetch skeleton.
    expect(result.current.fullValue).toEqual(['a', 'b'])
    expect(result.current.isFirstFetchPending).toBe(false)

    await act(async () => {
      resolveSecond({ items: { value: ['a', 'b', 'c'], type: 'array' } })
      await Promise.resolve()
    })
    expect(result.current.fullValue).toEqual(['a', 'b', 'c'])
  })
})

// ===========================================================================
// Error handling
// ===========================================================================

describe('useFullVariableValue - fetch errors', () => {
  it('keeps the previous state when the response omits the watcher name', async () => {
    const { result, rerender } = renderFetchHook(liveParams())
    await flushFetch()
    expect(result.current.fullValue).toEqual(['a', 'b'])

    // E.g. the variable was reset server-side between envelope and fetch.
    mockGetSessionVariables.mockResolvedValueOnce({})
    rerender(liveParams({ runtimeValue: { count: 7, changed: true } }))
    await flushFetch()
    expect(result.current.fullValue).toEqual(['a', 'b'])
  })

  it('keeps the previous value on a failed re-fetch and retries on the next envelope', async () => {
    const { result, rerender } = renderFetchHook(liveParams())
    await flushFetch()
    expect(result.current.fullValue).toEqual(['a', 'b'])

    mockGetSessionVariables.mockRejectedValueOnce(new Error('network down'))
    rerender(liveParams({ runtimeValue: { count: 9, changed: true } }))
    await flushFetch()
    expect(result.current.fullValue).toEqual(['a', 'b'])

    mockGetSessionVariables.mockResolvedValueOnce({
      items: { value: ['fresh'], type: 'array' },
    })
    rerender(liveParams({ runtimeValue: { count: 1, changed: true } }))
    await flushFetch()
    expect(result.current.fullValue).toEqual(['fresh'])
  })

  it('reports a failed refresh and that a value is already on screen', async () => {
    const { result, rerender } = renderFetchHook(liveParams())
    await flushFetch()
    expect(result.current.refreshFailure).toBeNull()

    mockGetSessionVariables.mockRejectedValueOnce(new Error('network down'))
    rerender(liveParams({ runtimeValue: { count: 9, changed: true } }))
    await flushFetch()

    expect(result.current.refreshFailure).toEqual({
      reason: 'network down',
      hasLastValue: true,
    })
  })

  it('reports that nothing has landed yet when the first read fails', async () => {
    mockGetSessionVariables.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderFetchHook(liveParams())
    await flushFetch()

    expect(result.current.refreshFailure).toEqual({
      reason: 'network down',
      hasLastValue: false,
    })
  })

  it('reports the reason the API gave for an API error', async () => {
    mockGetSessionVariables.mockRejectedValueOnce({
      message: 'Session 42 is gone',
      status: 404,
    })
    const { result } = renderFetchHook(liveParams())
    await flushFetch()

    expect(result.current.refreshFailure?.reason).toBe('Session 42 is gone')
  })

  it('keeps reporting across a failing streak and clears on recovery', async () => {
    mockGetSessionVariables.mockRejectedValue(new Error('network down'))
    const { result, rerender } = renderFetchHook(liveParams())
    await flushFetch()
    rerender(liveParams({ runtimeValue: { count: 9, changed: true } }))
    await flushFetch()
    rerender(liveParams({ runtimeValue: { count: 10, changed: true } }))
    await flushFetch()
    expect(result.current.refreshFailure).toEqual({
      reason: 'network down',
      hasLastValue: false,
    })

    mockGetSessionVariables.mockResolvedValueOnce({
      items: { value: ['fresh'], type: 'array' },
    })
    rerender(liveParams({ runtimeValue: { count: 11, changed: true } }))
    await flushFetch()
    expect(result.current.refreshFailure).toBeNull()
    expect(result.current.fullValue).toEqual(['fresh'])

    mockGetSessionVariables.mockRejectedValue(new Error('network down'))
    rerender(liveParams({ runtimeValue: { count: 12, changed: true } }))
    await flushFetch()
    expect(result.current.refreshFailure).toEqual({
      reason: 'network down',
      hasLastValue: true,
    })
  })

  it('drops the failure of a tick a newer envelope superseded', async () => {
    let rejectFirst!: (reason: unknown) => void
    mockGetSessionVariables.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject
        }),
    )
    const { result, rerender } = renderFetchHook(liveParams())
    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    // A newer envelope takes over before the first tick settles.
    rerender(liveParams({ runtimeValue: { count: 9, changed: true } }))
    await act(async () => {
      rejectFirst(new Error('network down'))
      await Promise.resolve()
    })
    expect(result.current.refreshFailure).toBeNull()

    await flushFetch()
    expect(result.current.fullValue).toEqual(['a', 'b'])
    expect(result.current.refreshFailure).toBeNull()
  })

  it('reports nothing when the failure lands after the watcher closed', async () => {
    let rejectFetch!: (reason: unknown) => void
    mockGetSessionVariables.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject
        }),
    )
    const { result, unmount } = renderFetchHook(liveParams())
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    unmount()

    await act(async () => {
      rejectFetch(new Error('network down'))
      await Promise.resolve()
    })

    expect(result.current.refreshFailure).toBeNull()
  })

  it('drops a stale failure once the watcher stops needing a fetch', async () => {
    mockGetSessionVariables.mockRejectedValueOnce(new Error('network down'))
    const { result, rerender } = renderFetchHook(liveParams())
    await flushFetch()
    expect(result.current.refreshFailure).not.toBeNull()

    rerender(liveParams({ runtimeValue: undefined, hasRuntimeValue: false }))
    expect(result.current.refreshFailure).toBeNull()
  })

  it('never replays the old reason when polling resumes', async () => {
    mockGetSessionVariables.mockRejectedValueOnce(new Error('network down'))
    const { result, rerender } = renderFetchHook(liveParams())
    await flushFetch()
    expect(result.current.refreshFailure).not.toBeNull()

    rerender(liveParams({ runtimeValue: undefined, hasRuntimeValue: false }))
    rerender(liveParams({ runtimeValue: { count: 4, changed: true } }))
    expect(result.current.refreshFailure).toBeNull()

    await flushFetch()
    expect(result.current.refreshFailure).toBeNull()
    expect(result.current.fullValue).toEqual(['a', 'b'])
  })
})

// ===========================================================================
// Unmount
// ===========================================================================

describe('useFullVariableValue - unmount', () => {
  it('cancels the pending debounce on unmount', () => {
    const { unmount } = renderFetchHook(liveParams())
    unmount()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(mockGetSessionVariables).not.toHaveBeenCalled()
  })

  it('ignores an in-flight resolution after unmount without crashing', async () => {
    let resolveFetch!: (
      value: Record<string, { value: unknown; type: string }>,
    ) => void
    mockGetSessionVariables.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    const { unmount } = renderFetchHook(liveParams())
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(mockGetSessionVariables).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => {
      resolveFetch({ items: { value: ['late'], type: 'array' } })
      await Promise.resolve()
    })
    // Nothing to assert beyond "no crash / no act warnings" - the aborted
    // delivery must not update state on an unmounted hook.
  })
})

describe('useFullVariableValue - the Function scope (REQ-3.2.2.18)', () => {
  it('reads a Function variable from its own Function scope', async () => {
    renderFetchHook(liveParams({ functionPath: ['fn-node-1'] }))
    await flushFetch()
    expect(mockGetSessionVariables).toHaveBeenCalledWith('session-1', ['items'], ['fn-node-1'])
  })

  it('reads a nested Function variable with its whole path, outermost first', async () => {
    renderFetchHook(liveParams({ functionPath: ['outer-node', 'inner-node'] }))
    await flushFetch()
    expect(mockGetSessionVariables).toHaveBeenCalledWith(
      'session-1',
      ['items'],
      ['outer-node', 'inner-node'],
    )
  })

  it('reads the root scope for an empty path', async () => {
    renderFetchHook(liveParams({ functionPath: [] }))
    await flushFetch()
    expect(mockGetSessionVariables).toHaveBeenCalledTimes(1)
    const [sessionId, names, functionPath] = mockGetSessionVariables.mock.calls[0]
    expect([sessionId, names, functionPath ?? []]).toEqual(['session-1', ['items'], []])
  })

  it('delivers the value its own scope returned', async () => {
    mockGetSessionVariables.mockResolvedValueOnce({
      items: { value: ['from', 'function'], type: 'array' },
    })
    const { result } = renderFetchHook(liveParams({ functionPath: ['fn-node-1'] }))
    await flushFetch()
    expect(result.current.fullValue).toEqual(['from', 'function'])
  })

  it('re-reads from the new scope when the path changes', async () => {
    const params = liveParams({ functionPath: ['fn-a'] })
    const { rerender } = renderFetchHook(params)
    await flushFetch()

    rerender({ ...params, functionPath: ['fn-b'] })
    await flushFetch()
    expect(mockGetSessionVariables).toHaveBeenCalledTimes(2)
    expect(mockGetSessionVariables).toHaveBeenLastCalledWith('session-1', ['items'], ['fn-b'])
  })

  it('does not re-read when the same path arrives as a new array', async () => {
    const params = liveParams({ functionPath: ['fn-a'] })
    const { rerender } = renderFetchHook(params)
    await flushFetch()

    rerender({ ...params, functionPath: ['fn-a'] })
    await flushFetch()
    expect(mockGetSessionVariables).toHaveBeenCalledTimes(1)
  })
})

describe('useFullVariableValue - element types (REQ-3.1.3.19)', () => {
  it('returns the fetched value with its real element types', async () => {
    mockGetSessionVariables.mockResolvedValueOnce({
      items: { value: { n: 16, f: '1.0' }, type: 'map', elementTypes: { n: 'integer', f: 'float' } },
    })
    const { result } = renderFetchHook(liveParams())
    await flushFetch()
    expect(result.current.fullValue).toEqual({ n: 16, f: '1.0' })
    expect(result.current.fullElementTypes).toEqual({ n: 'integer', f: 'float' })
  })

  it('reports no element types while nothing is fetched', () => {
    const { result } = renderFetchHook(liveParams({ hasRuntimeValue: false, runtimeValue: undefined }))
    expect(result.current.fullElementTypes).toBeUndefined()
  })
})
