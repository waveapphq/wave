/**
 * Responsive Layout Tests
 *
 * REQ-5.2.1.17: Responsive layout with desktop and tablet breakpoints
 *
 * Tests for responsive layout system following design specifications.
 *
 * Breakpoint Scale:
 * - sm: 640px (large phones landscape)
 * - md: 768px (tablets portrait)
 * - lg: 1024px (tablets landscape, small laptops - sidebar threshold)
 * - xl: 1280px (laptops, desktops)
 * - 2xl: 1536px (large desktops, ultrawide)
 */

import { describe, it, expect } from 'vitest'

// ===========================================================================
// Breakpoint Constants Tests
// ===========================================================================

describe('Breakpoint Configuration', () => {
  describe('Breakpoint Values', () => {
    it('defines sm breakpoint at 640px', async () => {
      const { breakpoints } = await import('@/design-system/responsive')
      expect(breakpoints.sm).toBe(640)
    })

    it('defines md breakpoint at 768px', async () => {
      const { breakpoints } = await import('@/design-system/responsive')
      expect(breakpoints.md).toBe(768)
    })

    it('defines lg breakpoint at 1024px', async () => {
      const { breakpoints } = await import('@/design-system/responsive')
      expect(breakpoints.lg).toBe(1024)
    })

    it('defines xl breakpoint at 1280px', async () => {
      const { breakpoints } = await import('@/design-system/responsive')
      expect(breakpoints.xl).toBe(1280)
    })

    it('defines 2xl breakpoint at 1536px', async () => {
      const { breakpoints } = await import('@/design-system/responsive')
      expect(breakpoints['2xl']).toBe(1536)
    })

    it('exports breakpoints in ascending order', async () => {
      const { breakpoints } = await import('@/design-system/responsive')
      const values = [
        breakpoints.sm,
        breakpoints.md,
        breakpoints.lg,
        breakpoints.xl,
        breakpoints['2xl'],
      ]
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1])
      }
    })
  })
})

// ===========================================================================
// Sidebar Layout Configuration Tests
// ===========================================================================

describe('Sidebar Layout Configuration', () => {
  describe('Sidebar Dimensions', () => {
    it('defines sidebar expanded width as 240px', async () => {
      const { sidebarConfig } = await import('@/design-system/responsive')
      expect(sidebarConfig.expandedWidth).toBe(240)
    })

    it('defines sidebar collapsed width as 64px', async () => {
      const { sidebarConfig } = await import('@/design-system/responsive')
      expect(sidebarConfig.collapsedWidth).toBe(64)
    })

    it('defines sidebar visibility threshold at 1024px (lg breakpoint)', async () => {
      const { sidebarConfig } = await import('@/design-system/responsive')
      expect(sidebarConfig.visibilityThreshold).toBe(1024)
    })
  })
})

// ===========================================================================
// Workflow Canvas Configuration Tests
// ===========================================================================

describe('Workflow Canvas Configuration', () => {
  describe('Canvas Interaction Threshold', () => {
    it('defines canvas interaction threshold at 768px (md breakpoint)', async () => {
      const { canvasConfig } = await import('@/design-system/responsive')
      expect(canvasConfig.interactionThreshold).toBe(768)
    })
  })
})

// ===========================================================================
// Viewport State Debouncing Tests
// ===========================================================================

describe('Viewport State Management', () => {
  describe('Resize Debounce Configuration', () => {
    it('defines resize debounce interval as 100ms', async () => {
      const { viewportConfig } = await import('@/design-system/responsive')
      expect(viewportConfig.resizeDebounceMs).toBe(100)
    })
  })
})

// ===========================================================================
// Breakpoint Utility Functions Tests
// ===========================================================================

describe('Breakpoint Utility Functions', () => {
  describe('getCurrentBreakpoint', () => {
    it('returns base for viewports below 640px', async () => {
      const { getCurrentBreakpoint } = await import('@/design-system/responsive')
      expect(getCurrentBreakpoint(320)).toBe('base')
      expect(getCurrentBreakpoint(639)).toBe('base')
    })

    it('returns sm for viewports from 640px to 767px', async () => {
      const { getCurrentBreakpoint } = await import('@/design-system/responsive')
      expect(getCurrentBreakpoint(640)).toBe('sm')
      expect(getCurrentBreakpoint(767)).toBe('sm')
    })

    it('returns md for viewports from 768px to 1023px', async () => {
      const { getCurrentBreakpoint } = await import('@/design-system/responsive')
      expect(getCurrentBreakpoint(768)).toBe('md')
      expect(getCurrentBreakpoint(1023)).toBe('md')
    })

    it('returns lg for viewports from 1024px to 1279px', async () => {
      const { getCurrentBreakpoint } = await import('@/design-system/responsive')
      expect(getCurrentBreakpoint(1024)).toBe('lg')
      expect(getCurrentBreakpoint(1279)).toBe('lg')
    })

    it('returns xl for viewports from 1280px to 1535px', async () => {
      const { getCurrentBreakpoint } = await import('@/design-system/responsive')
      expect(getCurrentBreakpoint(1280)).toBe('xl')
      expect(getCurrentBreakpoint(1535)).toBe('xl')
    })

    it('returns 2xl for viewports 1536px and above', async () => {
      const { getCurrentBreakpoint } = await import('@/design-system/responsive')
      expect(getCurrentBreakpoint(1536)).toBe('2xl')
      expect(getCurrentBreakpoint(2560)).toBe('2xl')
    })
  })

  describe('isAtLeast', () => {
    it('returns true when viewport meets minimum breakpoint', async () => {
      const { isAtLeast } = await import('@/design-system/responsive')
      expect(isAtLeast(1024, 'lg')).toBe(true)
      expect(isAtLeast(1920, 'lg')).toBe(true)
    })

    it('returns false when viewport is below minimum breakpoint', async () => {
      const { isAtLeast } = await import('@/design-system/responsive')
      expect(isAtLeast(800, 'lg')).toBe(false)
      expect(isAtLeast(1023, 'lg')).toBe(false)
    })
  })

  describe('isBelow', () => {
    it('returns true when viewport is below breakpoint', async () => {
      const { isBelow } = await import('@/design-system/responsive')
      expect(isBelow(800, 'lg')).toBe(true)
      expect(isBelow(1023, 'lg')).toBe(true)
    })

    it('returns false when viewport meets or exceeds breakpoint', async () => {
      const { isBelow } = await import('@/design-system/responsive')
      expect(isBelow(1024, 'lg')).toBe(false)
      expect(isBelow(1920, 'lg')).toBe(false)
    })
  })
})
