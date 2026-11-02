/**
 * useIsMobile Hook Tests
 *
 * Tests for the useIsMobile hook that detects mobile breakpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIsMobile } from '@/hooks/use-mobile'

describe('useIsMobile', () => {
  let originalMatchMedia: typeof window.matchMedia
  let originalInnerWidth: number

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    originalInnerWidth = window.innerWidth
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    Object.defineProperty(window, 'innerWidth', {
      value: originalInnerWidth,
      writable: true,
      configurable: true,
    })
  })

  it('returns false for desktop width', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
      configurable: true,
    })

    const listeners: Array<() => void> = []
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: (_: string, handler: () => void) => listeners.push(handler),
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('returns true for mobile width', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 500,
      writable: true,
      configurable: true,
    })

    const listeners: Array<() => void> = []
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: (_: string, handler: () => void) => listeners.push(handler),
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('responds to media query changes', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
      configurable: true,
    })

    const listeners: Array<() => void> = []
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: (_: string, handler: () => void) => listeners.push(handler),
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    // Simulate resize to mobile
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        value: 500,
        writable: true,
        configurable: true,
      })
      listeners.forEach((handler) => handler())
    })

    expect(result.current).toBe(true)
  })

  it('handles missing matchMedia gracefully', () => {
    // @ts-expect-error - Testing edge case
    window.matchMedia = undefined

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('handles matchMedia without addEventListener gracefully', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 500,
      writable: true,
      configurable: true,
    })

    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      // No addEventListener
    }))

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('cleans up event listener on unmount', () => {
    const removeEventListenerSpy = vi.fn()
    const listeners: Array<() => void> = []

    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: (_: string, handler: () => void) => listeners.push(handler),
      removeEventListener: removeEventListenerSpy,
    }))

    const { unmount } = renderHook(() => useIsMobile())
    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
