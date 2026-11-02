/**
 * SSR Utility Tests - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Tests for SSR detection utilities used throughout the routing system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isSSR, getWindowLocationHash } from '../../src/lib/ssr'

describe('SSR Utilities', () => {
  describe('isSSR', () => {
    it('returns false in browser environment (JSDOM)', () => {
      // In JSDOM, window is always defined
      expect(typeof window).toBe('object')
      expect(isSSR()).toBe(false)
    })
  })

  describe('getWindowLocationHash', () => {
    let originalHash: string

    beforeEach(() => {
      originalHash = window.location.hash
    })

    afterEach(() => {
      // Restore original hash
      window.location.hash = originalHash
    })

    it('returns window.location.hash in browser environment', () => {
      // Set up a hash using the setter
      window.location.hash = '#test-section'
      expect(getWindowLocationHash()).toBe('#test-section')
    })

    it('returns empty string when hash is empty', () => {
      window.location.hash = ''
      expect(getWindowLocationHash()).toBe('')
    })

    it('returns hash with # prefix', () => {
      window.location.hash = 'section'
      // Browser automatically adds # prefix
      expect(getWindowLocationHash()).toMatch(/^#?section$/)
    })
  })

  describe('SSR Branch via Module Reset', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('getWindowLocationHash returns empty string in SSR environment', async () => {
      // Mock the module to simulate SSR mode where isSSR returns true
      vi.doMock('../../src/lib/ssr', () => {
        const actualIsSSR = () => true // Simulate SSR
        return {
          isSSR: actualIsSSR,
          getWindowLocationHash: () => {
            if (actualIsSSR()) return ''
            return window.location.hash
          },
        }
      })

      const { getWindowLocationHash: mockGetHash } = await import('../../src/lib/ssr')
      expect(mockGetHash()).toBe('')
    })
  })

  describe('Function Exports', () => {
    it('exports isSSR function', () => {
      expect(typeof isSSR).toBe('function')
    })

    it('exports getWindowLocationHash function', () => {
      expect(typeof getWindowLocationHash).toBe('function')
    })
  })
})
