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

  it.each([
    ['reads the persisted value when within bounds', '900', 900],
    ['falls back to defaultWidth when persisted value is non-numeric', 'corrupt', 768],
    ['falls back to defaultWidth when persisted value is below MIN_WIDTH', '100', 768],
    ['falls back to defaultWidth when persisted value is above MAX_WIDTH', '99999', 768],
  ])('%s', (_title, stored, expected) => {
    window.localStorage.setItem(KEY, stored)
    const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
    expect(result.current[0]).toBe(expected)
  })

  describe('setWidth', () => {
    it.each([
      ['persists writes that are in-bounds', 900, 900, '900'],
      ['clamps writes below MIN_WIDTH (480)', 100, 480, '480'],
      ['clamps writes above MAX_WIDTH (1600)', 99999, 1600, '1600'],
    ])('%s', (_title, requested, expected, persisted) => {
      const { result } = renderHook(() => usePersistedModalWidth(KEY, 768))
      act(() => result.current[1](requested))
      expect(result.current[0]).toBe(expected)
      expect(window.localStorage.getItem(KEY)).toBe(persisted)
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
