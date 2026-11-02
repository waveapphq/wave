/**
 * usePersistedModalWidth hook tests
 *
 * Pins the contract: the hook reads localStorage on mount, falls back to the
 * default for missing / corrupt / out-of-bounds values, and clamps writes to
 * the [480, 1600] bounds before persisting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePersistedModalWidth } from '@/features/workbench/common/element-config/expressions/use-persisted-modal-width'

const KEY = 'wave.test.modal.width'

describe('usePersistedModalWidth', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('falls back to defaultWidth when no value is persisted', () => {
    const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
    expect(result.current[0]).toBe(768)
  })

  it('reads the persisted value when within bounds', () => {
    window.localStorage.setItem(KEY, '900')
    const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
    expect(result.current[0]).toBe(900)
  })

  it('falls back to defaultWidth when persisted value is non-numeric', () => {
    window.localStorage.setItem(KEY, 'corrupt')
    const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
    expect(result.current[0]).toBe(768)
  })

  it('falls back to defaultWidth when persisted value is below MIN_WIDTH', () => {
    window.localStorage.setItem(KEY, '100')
    const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
    expect(result.current[0]).toBe(768)
  })

  it('falls back to defaultWidth when persisted value is above MAX_WIDTH', () => {
    window.localStorage.setItem(KEY, '99999')
    const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
    expect(result.current[0]).toBe(768)
  })

  describe('setWidth', () => {
    it('persists writes that are in-bounds', () => {
      const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
      act(() => result.current[1](900))
      expect(result.current[0]).toBe(900)
      expect(window.localStorage.getItem(KEY)).toBe('900')
    })

    it('clamps writes below MIN_WIDTH (480)', () => {
      const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
      act(() => result.current[1](100))
      expect(result.current[0]).toBe(480)
      expect(window.localStorage.getItem(KEY)).toBe('480')
    })

    it('clamps writes above MAX_WIDTH (1600)', () => {
      const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
      act(() => result.current[1](99999))
      expect(result.current[0]).toBe(1600)
      expect(window.localStorage.getItem(KEY)).toBe('1600')
    })

    it('handles repeated writes', () => {
      const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
      act(() => result.current[1](600))
      act(() => result.current[1](700))
      act(() => result.current[1](800))
      expect(result.current[0]).toBe(800)
      expect(window.localStorage.getItem(KEY)).toBe('800')
    })
  })
})
