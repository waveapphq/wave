/**
 * useDebouncedCallback: the shared wait of a server search. The callback runs once, the delay after the
 * last call; a newer call restarts the wait and an unmount cancels it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useDebouncedCallback } from '@/hooks/use-debounced-callback'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedCallback', () => {
  it('runs the callback with the last value once the delay has passed', () => {
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 300))

    result.current('c')
    result.current('cr')
    vi.advanceTimersByTime(299)
    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith('cr')
  })

  it('restarts the wait on every call', () => {
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 300))

    result.current('a')
    vi.advanceTimersByTime(200)
    result.current('ab')
    vi.advanceTimersByTime(200)
    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledWith('ab')
  })

  it('does nothing without a callback or without a delay', () => {
    const callback = vi.fn()
    const noCallback = renderHook(() => useDebouncedCallback<string>(undefined, 300))
    const noDelay = renderHook(() => useDebouncedCallback(callback, undefined))

    noCallback.result.current('a')
    noDelay.result.current('a')
    vi.runAllTimers()

    expect(callback).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a waiting call on unmount', () => {
    const callback = vi.fn()
    const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 300))

    result.current('a')
    unmount()
    vi.runAllTimers()

    expect(callback).not.toHaveBeenCalled()
  })

  it('unmounts cleanly with no call waiting', () => {
    const { unmount } = renderHook(() => useDebouncedCallback(vi.fn(), 300))

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
