/**
 * useViewport and viewport-store SSR Tests
 *
 * REQ-5.2.1.17: Responsive layout with desktop and tablet breakpoints
 *
 * Tests SSR-safety branches where window is undefined.
 * Uses node environment (no JSDOM) to properly test SSR code paths.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('SSR Safety - Node Environment', () => {
  beforeEach(() => {
    // Ensure we're in node environment without window
    vi.resetModules()
  })

  describe('isBrowser utility SSR behavior', () => {
    it('returns false when window is undefined', async () => {
      // Verify we're in node environment
      expect(typeof globalThis.window).toBe('undefined')

      const { isBrowser } = await import('@/lib/utils')
      expect(isBrowser()).toBe(false)
    })
  })

  describe('detectTouchDevice utility SSR behavior', () => {
    it('returns false when window is undefined', async () => {
      // Verify we're in node environment
      expect(typeof globalThis.window).toBe('undefined')

      const { detectTouchDevice } = await import('@/lib/utils')
      expect(detectTouchDevice()).toBe(false)
    })
  })

  describe('viewport-store SSR behavior', () => {
    it('getInitialDimensions returns SSR defaults when window undefined', async () => {
      // In node environment, window is undefined
      expect(typeof globalThis.window).toBe('undefined')

      // Import the store module
      const { useViewportStore } = await import('@/stores/viewport-store')

      // The store should have initialized with SSR defaults (1280x800)
      const state = useViewportStore.getState()
      expect(state.width).toBe(1280)
      expect(state.height).toBe(800)
    })

    it('initialize returns early when window undefined', async () => {
      expect(typeof globalThis.window).toBe('undefined')

      const { useViewportStore } = await import('@/stores/viewport-store')

      // Get initial state
      const stateBefore = { ...useViewportStore.getState() }

      // Call initialize - should return early and not crash
      useViewportStore.getState().initialize()

      // State should remain unchanged since initialize returns early
      const stateAfter = useViewportStore.getState()
      expect(stateAfter.width).toBe(stateBefore.width)
      expect(stateAfter.height).toBe(stateBefore.height)
    })
  })

  describe('useViewport hook SSR behavior', () => {
    it('module loads without errors in SSR environment', async () => {
      expect(typeof globalThis.window).toBe('undefined')

      // The hook module should load without crashing even when window is undefined
      const module = await import('@/hooks/use-viewport')
      expect(module.useViewport).toBeDefined()
    })
  })

  describe('responsive design-system SSR behavior', () => {
    it('breakpoint functions work without window', async () => {
      expect(typeof globalThis.window).toBe('undefined')

      const {
        getCurrentBreakpoint,
        isAtLeast,
        isBelow,
      } = await import('@/design-system/responsive')

      // These functions should work purely with passed-in values
      expect(getCurrentBreakpoint(1024)).toBe('lg')
      expect(isAtLeast(1024, 'md')).toBe(true)
      expect(isBelow(640, 'md')).toBe(true)
    })
  })
})
