/**
 * useDebouncedLoading - Unit tests
 *
 * Tests the debounced loading hook that prevents skeleton flicker
 * by only showing loading state after a configurable delay, and the `settled`
 * flag a surface needs to tell "nothing here" from "nothing read yet".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedLoading } from '@/hooks/use-debounced-loading'

describe('useDebouncedLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with loading=false', () => {
    const { result } = renderHook(() => useDebouncedLoading())
    expect(result.current.loading).toBe(false)
  })

  it('does not set loading immediately on startLoading', () => {
    const { result } = renderHook(() => useDebouncedLoading())
    act(() => result.current.startLoading())
    expect(result.current.loading).toBe(false)
  })

  it('sets loading=true after delay expires', () => {
    const { result } = renderHook(() => useDebouncedLoading(150))
    act(() => result.current.startLoading())
    act(() => vi.advanceTimersByTime(150))
    expect(result.current.loading).toBe(true)
  })

  it('cancels pending loading on stopLoading before delay', () => {
    const { result } = renderHook(() => useDebouncedLoading(150))
    act(() => result.current.startLoading())
    act(() => result.current.stopLoading())
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.loading).toBe(false)
  })

  it('resets loading to false on stopLoading after delay fired', () => {
    const { result } = renderHook(() => useDebouncedLoading(50))
    act(() => result.current.startLoading())
    act(() => vi.advanceTimersByTime(50))
    expect(result.current.loading).toBe(true)
    act(() => result.current.stopLoading())
    expect(result.current.loading).toBe(false)
  })

  it('uses custom delay', () => {
    const { result } = renderHook(() => useDebouncedLoading(500))
    act(() => result.current.startLoading())
    act(() => vi.advanceTimersByTime(499))
    expect(result.current.loading).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.loading).toBe(true)
  })

  it('replaces pending timer on repeated startLoading calls', () => {
    const { result } = renderHook(() => useDebouncedLoading(100))
    act(() => result.current.startLoading())
    act(() => vi.advanceTimersByTime(80))
    // Restart - should reset the timer
    act(() => result.current.startLoading())
    act(() => vi.advanceTimersByTime(80))
    expect(result.current.loading).toBe(false)
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.loading).toBe(true)
  })

  it('is not settled before the first read finishes', () => {
    const { result } = renderHook(() => useDebouncedLoading())

    act(() => result.current.startLoading())

    expect(result.current.settled).toBe(false)
  })

  it('is settled once the first read finishes, even before the delay', () => {
    const { result } = renderHook(() => useDebouncedLoading())
    act(() => result.current.startLoading())

    act(() => result.current.stopLoading())

    expect(result.current.settled).toBe(true)
    expect(result.current.loading).toBe(false)
  })

  it('stays settled through a later read', () => {
    const { result } = renderHook(() => useDebouncedLoading())
    act(() => result.current.startLoading())
    act(() => result.current.stopLoading())

    act(() => result.current.startLoading())
    act(() => vi.advanceTimersByTime(150))

    expect(result.current.settled).toBe(true)
    expect(result.current.loading).toBe(true)
  })
})
