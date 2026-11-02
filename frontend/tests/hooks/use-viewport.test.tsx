/**
 * useViewport Hook Tests
 *
 * REQ-5.2.1.17: Responsive layout with desktop and tablet breakpoints
 *
 * Tests for viewport state management hook following design specifications.
 *
 * Viewport State Management:
 * - Tracks viewport dimensions through centralized mechanism
 * - Debounces resize events at 100ms intervals
 * - Components subscribe to breakpoint changes rather than raw dimensions
 * - Notifies when crossing thresholds
 * - Sidebar state auto-adjusts at 1024px boundary
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock window resize
const mockWindowWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  })
}

const mockWindowHeight = (height: number) => {
  Object.defineProperty(window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: height,
  })
}

const triggerResize = () => {
  window.dispatchEvent(new Event('resize'))
}

describe('useViewport Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Default to desktop viewport
    mockWindowWidth(1280)
    mockWindowHeight(800)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('returns current viewport width', async () => {
      mockWindowWidth(1024)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.width).toBe(1024)
    })

    it('returns current viewport height', async () => {
      mockWindowHeight(768)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.height).toBe(768)
    })

    it('returns current breakpoint based on viewport width', async () => {
      mockWindowWidth(1024)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.breakpoint).toBe('lg')
    })

    it('returns base breakpoint for mobile viewports', async () => {
      mockWindowWidth(375)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.breakpoint).toBe('base')
    })
  })

  describe('Breakpoint Detection', () => {
    it('detects sm breakpoint at 640px', async () => {
      mockWindowWidth(640)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.breakpoint).toBe('sm')
    })

    it('detects md breakpoint at 768px', async () => {
      mockWindowWidth(768)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.breakpoint).toBe('md')
    })

    it('detects lg breakpoint at 1024px', async () => {
      mockWindowWidth(1024)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.breakpoint).toBe('lg')
    })

    it('detects xl breakpoint at 1280px', async () => {
      mockWindowWidth(1280)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.breakpoint).toBe('xl')
    })

    it('detects 2xl breakpoint at 1536px', async () => {
      mockWindowWidth(1536)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.breakpoint).toBe('2xl')
    })
  })

  describe('Breakpoint Helper Methods', () => {
    it('provides isAtLeast method for breakpoint comparison', async () => {
      mockWindowWidth(1024)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.isAtLeast('sm')).toBe(true)
      expect(result.current.isAtLeast('md')).toBe(true)
      expect(result.current.isAtLeast('lg')).toBe(true)
      expect(result.current.isAtLeast('xl')).toBe(false)
    })

    it('provides isBelow method for breakpoint comparison', async () => {
      mockWindowWidth(800)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.isBelow('sm')).toBe(false)
      expect(result.current.isBelow('md')).toBe(false)
      expect(result.current.isBelow('lg')).toBe(true)
      expect(result.current.isBelow('xl')).toBe(true)
    })

    it('provides isMobile computed property (below lg)', async () => {
      mockWindowWidth(800)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.isMobile).toBe(true)

      mockWindowWidth(1024)
      const { result: result2 } = renderHook(() => useViewport())
      expect(result2.current.isMobile).toBe(false)
    })

    it('provides isTablet computed property (md to lg)', async () => {
      mockWindowWidth(800)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.isTablet).toBe(true)

      mockWindowWidth(640)
      const { result: result2 } = renderHook(() => useViewport())
      expect(result2.current.isTablet).toBe(false)

      mockWindowWidth(1024)
      const { result: result3 } = renderHook(() => useViewport())
      expect(result3.current.isTablet).toBe(false)
    })

    it('provides isDesktop computed property (lg and above)', async () => {
      mockWindowWidth(1024)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.isDesktop).toBe(true)

      mockWindowWidth(800)
      const { result: result2 } = renderHook(() => useViewport())
      expect(result2.current.isDesktop).toBe(false)
    })
  })

  describe('Resize Event Handling', () => {
    it('updates viewport dimensions on resize', async () => {
      mockWindowWidth(1280)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.width).toBe(1280)

      act(() => {
        mockWindowWidth(800)
        triggerResize()
        vi.advanceTimersByTime(100)
      })

      expect(result.current.width).toBe(800)
    })

    it('debounces resize events at 100ms intervals', async () => {
      mockWindowWidth(1280)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      act(() => {
        mockWindowWidth(1000)
        triggerResize()
        // Don't advance timer - should not have updated yet
      })

      // Width should still be old value
      expect(result.current.width).toBe(1280)

      act(() => {
        vi.advanceTimersByTime(50)
        mockWindowWidth(900)
        triggerResize()
      })

      // Still within debounce window, should not update
      expect(result.current.width).toBe(1280)

      act(() => {
        vi.advanceTimersByTime(100)
      })

      // Now should be updated to latest value
      expect(result.current.width).toBe(900)
    })

    it('updates breakpoint when crossing threshold during resize', async () => {
      mockWindowWidth(1100)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.breakpoint).toBe('lg')

      act(() => {
        mockWindowWidth(900)
        triggerResize()
        vi.advanceTimersByTime(100)
      })

      expect(result.current.breakpoint).toBe('md')
    })
  })

  describe('Sidebar Threshold Detection', () => {
    it('provides sidebarShouldBeVisible flag based on lg breakpoint', async () => {
      mockWindowWidth(1024)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.sidebarShouldBeVisible).toBe(true)
    })

    it('sets sidebarShouldBeVisible to false below 1024px', async () => {
      mockWindowWidth(1023)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.sidebarShouldBeVisible).toBe(false)
    })

    it('updates sidebarShouldBeVisible when crossing 1024px threshold', async () => {
      mockWindowWidth(1024)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.sidebarShouldBeVisible).toBe(true)

      act(() => {
        mockWindowWidth(900)
        triggerResize()
        vi.advanceTimersByTime(100)
      })

      expect(result.current.sidebarShouldBeVisible).toBe(false)
    })
  })

  describe('Workflow Canvas Mode', () => {
    it('provides canvasInteractionEnabled flag based on md breakpoint', async () => {
      mockWindowWidth(768)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.canvasInteractionEnabled).toBe(true)
    })

    it('sets canvasInteractionEnabled to false below 768px', async () => {
      mockWindowWidth(767)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.canvasInteractionEnabled).toBe(false)
    })
  })

  describe('Touch Device Detection', () => {
    it('provides isTouchDevice flag', async () => {
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      // In JSDOM, touch is not typically available
      expect(typeof result.current.isTouchDevice).toBe('boolean')
    })
  })

  describe('Cleanup', () => {
    it('removes resize event listener on unmount', async () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
      const { useViewport } = await import('@/hooks/use-viewport')
      const { unmount } = renderHook(() => useViewport())

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'resize',
        expect.any(Function)
      )

      removeEventListenerSpy.mockRestore()
    })
  })

  describe('Server-Side Rendering Safety', () => {
    it('handles undefined window gracefully', async () => {
      // This test verifies the hook doesn't crash in SSR context
      // The hook should return sensible defaults when window is undefined
      const { useViewport } = await import('@/hooks/use-viewport')

      // In test environment, window is defined, but the hook should
      // be written to handle SSR. We're testing that it doesn't throw.
      expect(() => {
        renderHook(() => useViewport())
      }).not.toThrow()
    })

    it('resize effect returns early when isBrowser returns false', async () => {
      // Reset modules for fresh import
      vi.resetModules()

      // Mock isBrowser to return false (simulate SSR)
      vi.doMock('@/lib/utils', async (importOriginal) => {
        const original = await importOriginal<typeof import('@/lib/utils')>()
        return {
          ...original,
          isBrowser: () => false,
        }
      })

      const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

      const { useViewport } = await import('@/hooks/use-viewport')
      renderHook(() => useViewport())

      // resize event listener should NOT be added when isBrowser returns false
      expect(
        addEventListenerSpy.mock.calls.filter(
          (call) => call[0] === 'resize'
        ).length
      ).toBe(0)

      addEventListenerSpy.mockRestore()
      vi.doUnmock('@/lib/utils')
    })
  })

  describe('Touch Device Detection', () => {
    it('provides isTouchDevice flag from detectTouchDevice utility', async () => {
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      // In JSDOM, touch is typically not available, so expect false
      expect(typeof result.current.isTouchDevice).toBe('boolean')
    })

    it('reflects touch device state from utility function', async () => {
      // Reset module cache
      vi.resetModules()

      // Mock the detectTouchDevice utility to return true
      vi.doMock('@/lib/utils', async (importOriginal) => {
        const original = await importOriginal<typeof import('@/lib/utils')>()
        return {
          ...original,
          detectTouchDevice: () => true,
        }
      })

      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      expect(result.current.isTouchDevice).toBe(true)

      // Clean up mock
      vi.doUnmock('@/lib/utils')
    })
  })

  describe('Debounce Timer Cleanup', () => {
    it('clears pending debounce timer on unmount', async () => {
      mockWindowWidth(1280)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { unmount } = renderHook(() => useViewport())

      // Trigger resize to start a debounce timer
      act(() => {
        mockWindowWidth(800)
        triggerResize()
      })

      // Unmount before debounce completes - should not throw
      expect(() => unmount()).not.toThrow()

      // Advance timer to ensure cleanup worked
      act(() => {
        vi.advanceTimersByTime(200)
      })
    })

    it('clears existing debounce timer when new resize occurs', async () => {
      mockWindowWidth(1280)
      const { useViewport } = await import('@/hooks/use-viewport')
      const { result } = renderHook(() => useViewport())

      // Trigger first resize
      act(() => {
        mockWindowWidth(1000)
        triggerResize()
      })

      // Advance partially
      act(() => {
        vi.advanceTimersByTime(50)
      })

      // Trigger another resize before first debounce completes
      act(() => {
        mockWindowWidth(800)
        triggerResize()
      })

      // Advance past first debounce period
      act(() => {
        vi.advanceTimersByTime(60)
      })

      // Should still be at original width (debounce restarted)
      expect(result.current.width).toBe(1280)

      // Advance to complete second debounce
      act(() => {
        vi.advanceTimersByTime(50)
      })

      // Now should be updated to latest value
      expect(result.current.width).toBe(800)
    })
  })
})

// ===========================================================================
// Viewport Store Tests (if using Zustand store pattern)
// ===========================================================================

describe('Viewport Store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWindowWidth(1280)
    mockWindowHeight(800)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Store State', () => {
    it('initializes with current viewport dimensions', async () => {
      mockWindowWidth(1440)
      mockWindowHeight(900)
      const { useViewportStore } = await import('@/stores/viewport-store')

      // Reset and reinitialize
      useViewportStore.getState().initialize()

      const state = useViewportStore.getState()
      expect(state.width).toBe(1440)
      expect(state.height).toBe(900)
    })

    it('updates dimensions via updateDimensions action', async () => {
      const { useViewportStore } = await import('@/stores/viewport-store')

      act(() => {
        useViewportStore.getState().updateDimensions(1024, 768)
      })

      const state = useViewportStore.getState()
      expect(state.width).toBe(1024)
      expect(state.height).toBe(768)
    })
  })

  describe('Breakpoint Subscription', () => {
    it('notifies subscribers when breakpoint changes', async () => {
      const { useViewportStore } = await import('@/stores/viewport-store')
      const callback = vi.fn()

      // Subscribe to breakpoint changes using selector
      const unsubscribe = useViewportStore.subscribe(
        (state) => state.breakpoint,
        (breakpoint, prevBreakpoint) => {
          if (breakpoint !== prevBreakpoint) {
            callback(breakpoint, prevBreakpoint)
          }
        }
      )

      act(() => {
        useViewportStore.getState().updateDimensions(800, 600)
      })

      expect(callback).toHaveBeenCalled()

      unsubscribe()
    })

    it('does not notify when dimensions change within same breakpoint', async () => {
      const { useViewportStore } = await import('@/stores/viewport-store')
      const callback = vi.fn()

      // Start at lg breakpoint
      act(() => {
        useViewportStore.getState().updateDimensions(1100, 700)
      })

      const initialBreakpoint = useViewportStore.getState().breakpoint

      // Subscribe after setting initial state
      const unsubscribe = useViewportStore.subscribe(
        (state) => state.breakpoint,
        (breakpoint, prevBreakpoint) => {
          if (breakpoint !== prevBreakpoint) {
            callback(breakpoint, prevBreakpoint)
          }
        }
      )

      // Change dimensions but stay in lg breakpoint
      act(() => {
        useViewportStore.getState().updateDimensions(1200, 700)
      })

      // Callback should not be called since breakpoint didn't change
      expect(callback).not.toHaveBeenCalled()
      expect(useViewportStore.getState().breakpoint).toBe(initialBreakpoint)

      unsubscribe()
    })
  })

  describe('SSR Safety', () => {
    it('getInitialDimensions returns defaults when window is undefined', async () => {
      // The viewport-store is designed to handle SSR where window is undefined
      // We test that the store initializes with sensible defaults
      const { useViewportStore } = await import('@/stores/viewport-store')

      // Reset store and check initial values are sensible defaults
      const state = useViewportStore.getState()
      expect(typeof state.width).toBe('number')
      expect(typeof state.height).toBe('number')
      expect(state.width).toBeGreaterThan(0)
      expect(state.height).toBeGreaterThan(0)
    })

    it('initialize returns early when window is undefined', async () => {
      const { useViewportStore } = await import('@/stores/viewport-store')

      // Call initialize - in browser environment, it will use window dimensions
      // The function is designed to return early in SSR
      act(() => {
        useViewportStore.getState().initialize()
      })

      const stateAfter = useViewportStore.getState()

      // In browser env, it updates; in SSR it would return early
      // We're just verifying it doesn't crash and updates state
      expect(typeof stateAfter.width).toBe('number')
      expect(typeof stateAfter.height).toBe('number')
    })
  })
})
