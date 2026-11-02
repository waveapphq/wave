/**
 * Tests for `useAllowedBumps` hook (REQ-3.1.2.2).
 *
 * Hook signature:
 *   useAllowedBumps(functionId, sourceVersion, draftDefinition) => {
 *     allowed: string[],
 *     blocked: Record<string, string>,
 *     isLoading: boolean,
 *     failed: boolean,
 *     retry: () => void,
 *   }
 *
 * Behavior:
 *   - Debounces the POST /functions/{id}/validate-bumps call (so the user
 *     does not get a request per keystroke during draft editing)
 *   - Initial state has `isLoading: true` and empty `allowed`
 *   - Resolves with `{allowed, blocked}` from the API response
 *   - On rejection reports `failed` so the caller can say the read failed
 *   - Re-runs when draftDefinition changes (debounced)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'


const validateBumpsMock = vi.fn()
vi.mock('@/features/functions/api/functions-api', () => ({
  validateBumps: (...args: unknown[]) => validateBumpsMock(...args),
}))


import { useAllowedBumps } from '@/features/functions/hooks/use-allowed-bumps'


const FN_ID = '00000000-0000-0000-0000-0000000000aa'
const SOURCE = '1.0.0'

function draft(name = 'greet') {
  return {
    name,
    description: 'd',
    tags: ['demo'],
    inputs: [{ name: 'x', type: 'string', required: true }],
    outputs: [{ name: 'result', type: 'string' }],
    dependencies: { functions: [], plugins: [] },
    workflow: { nodes: [], edges: [] },
  }
}


beforeEach(() => {
  vi.useFakeTimers()
  validateBumpsMock.mockReset()
  validateBumpsMock.mockResolvedValue({
    allowed: ['patch', 'minor', 'major'],
    blocked: {},
  })
})

afterEach(() => {
  vi.useRealTimers()
})


describe('useAllowedBumps - initial state', () => {
  it('starts in loading state with empty allowed set', () => {
    const { result } = renderHook(() => useAllowedBumps(FN_ID, SOURCE, draft()))
    expect(result.current.isLoading).toBe(true)
    expect(result.current.allowed).toEqual([])
  })
})


describe('useAllowedBumps - debounced call', () => {
  it('does NOT call validateBumps synchronously on mount', () => {
    renderHook(() => useAllowedBumps(FN_ID, SOURCE, draft()))
    expect(validateBumpsMock).not.toHaveBeenCalled()
  })

  it('calls validateBumps once after the debounce window elapses', async () => {
    renderHook(() => useAllowedBumps(FN_ID, SOURCE, draft()))
    // Hook's debounce window is an implementation detail; assertion is that
    // the call eventually fires when the timer drains. 500ms is a generous
    // upper bound that any reasonable debounce setting fits inside.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(validateBumpsMock).toHaveBeenCalledTimes(1)
    const args = validateBumpsMock.mock.calls[0]
    expect(args[0]).toBe(FN_ID)
    expect(args[1]).toMatchObject({
      sourceVersion: SOURCE,
      draftDefinition: expect.objectContaining({ name: 'greet' }),
    })
  })

  it('coalesces rapid draft changes into one call', async () => {
    const { rerender } = renderHook(
      ({ d }: { d: ReturnType<typeof draft> }) =>
        useAllowedBumps(FN_ID, SOURCE, d),
      { initialProps: { d: draft('a') } },
    )
    rerender({ d: draft('ab') })
    rerender({ d: draft('abc') })
    rerender({ d: draft('abcd') })
    // No call yet (debounce window not elapsed).
    expect(validateBumpsMock).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(validateBumpsMock).toHaveBeenCalledTimes(1)
    // The latest draft is the one sent.
    const args = validateBumpsMock.mock.calls[0]
    expect(args[1].draftDefinition.name).toBe('abcd')
  })
})


describe('useAllowedBumps - resolved state', () => {
  it('returns allowed + blocked from the API response after the debounce', async () => {
    validateBumpsMock.mockResolvedValueOnce({
      allowed: ['major'],
      blocked: { patch: 'P', minor: 'M' },
    })
    const { result } = renderHook(() => useAllowedBumps(FN_ID, SOURCE, draft()))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.allowed).toEqual(['major'])
    expect(result.current.blocked).toEqual({ patch: 'P', minor: 'M' })
    expect(result.current.failed).toBe(false)
  })

  it('treats a server answer of no allowed bumps as an answer', async () => {
    validateBumpsMock.mockResolvedValueOnce({
      allowed: [],
      blocked: { patch: 'P', minor: 'M', major: 'J' },
    })
    const { result } = renderHook(() => useAllowedBumps(FN_ID, SOURCE, draft()))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.allowed).toEqual([])
    expect(result.current.failed).toBe(false)
  })
})


describe('useAllowedBumps - failed read', () => {
  it('reports a rejection as `failed` rather than as no allowed bumps', async () => {
    validateBumpsMock.mockRejectedValueOnce(new Error('Server unavailable'))
    const { result } = renderHook(() => useAllowedBumps(FN_ID, SOURCE, draft()))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.failed).toBe(true)
    expect(result.current.allowed).toEqual([])
  })

  it('runs the read again when the caller retries', async () => {
    validateBumpsMock
      .mockRejectedValueOnce(new Error('Server unavailable'))
      .mockResolvedValueOnce({ allowed: ['patch'], blocked: {} })
    const { result } = renderHook(() => useAllowedBumps(FN_ID, SOURCE, draft()))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await waitFor(() => expect(result.current.failed).toBe(true))

    act(() => {
      result.current.retry()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    await waitFor(() => expect(result.current.allowed).toEqual(['patch']))
    expect(result.current.failed).toBe(false)
    expect(validateBumpsMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good answer when a later read fails', async () => {
    validateBumpsMock
      .mockResolvedValueOnce({ allowed: ['patch', 'minor'], blocked: {} })
      .mockRejectedValueOnce(new Error('Server unavailable'))
    const { result, rerender } = renderHook(
      ({ d }: { d: ReturnType<typeof draft> }) => useAllowedBumps(FN_ID, SOURCE, d),
      { initialProps: { d: draft('a') } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await waitFor(() => expect(result.current.allowed).toEqual(['patch', 'minor']))

    rerender({ d: draft('b') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.allowed).toEqual(['patch', 'minor'])
  })
})


describe('useAllowedBumps - inactive inputs', () => {
  it('clears state without scheduling a request when functionId is empty', () => {
    const { result } = renderHook(() => useAllowedBumps('', SOURCE, draft()))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.allowed).toEqual([])
    expect(result.current.failed).toBe(false)
    expect(validateBumpsMock).not.toHaveBeenCalled()
  })
})


describe('useAllowedBumps - nullish draft', () => {
  it('hashes a null draft via the `?? null` fallback and still calls the API', async () => {
    const { result } = renderHook(() => useAllowedBumps(FN_ID, SOURCE, null))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(validateBumpsMock).toHaveBeenCalledTimes(1)
    expect(validateBumpsMock.mock.calls[0][1]).toMatchObject({
      sourceVersion: SOURCE,
      draftDefinition: null,
    })
  })
})
