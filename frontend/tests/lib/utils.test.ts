/**
 * Utils Tests - REQ-5.2.1.17 Responsive layout utilities
 *
 * Tests for utility functions including SSR-safe helpers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cn, isBrowser, detectTouchDevice, safeStringify } from '@/lib/utils'

describe('Utility Functions', () => {
  describe('cn (classNames merger)', () => {
    it('merges class names correctly', () => {
      expect(cn('foo', 'bar')).toBe('foo bar')
    })

    it('handles conditional classes', () => {
      expect(cn('base', true && 'included', false && 'excluded')).toBe(
        'base included'
      )
    })

    it('handles tailwind class conflicts', () => {
      expect(cn('p-4', 'p-2')).toBe('p-2')
    })

    it('handles empty inputs', () => {
      expect(cn()).toBe('')
    })

    it('handles undefined and null', () => {
      expect(cn('foo', undefined, null, 'bar')).toBe('foo bar')
    })
  })

  describe('isBrowser', () => {
    it('returns true in browser environment (JSDOM)', () => {
      // In JSDOM, window is always defined
      expect(typeof window).toBe('object')
      expect(isBrowser()).toBe(true)
    })
  })

  describe('detectTouchDevice', () => {
    let originalOntouchstart: unknown
    let originalMaxTouchPoints: number

    beforeEach(() => {
      // Save original values
      originalOntouchstart = (window as { ontouchstart?: unknown }).ontouchstart
      originalMaxTouchPoints = navigator.maxTouchPoints
    })

    afterEach(() => {
      // Restore original values
      if (originalOntouchstart === undefined) {
        delete (window as { ontouchstart?: unknown }).ontouchstart
      } else {
        ;(window as { ontouchstart?: unknown }).ontouchstart = originalOntouchstart
      }
      Object.defineProperty(navigator, 'maxTouchPoints', {
        writable: true,
        configurable: true,
        value: originalMaxTouchPoints,
      })
      const nav = navigator as { msMaxTouchPoints?: number }
      delete nav.msMaxTouchPoints
    })

    it('detects touch hardware via maxTouchPoints', () => {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        writable: true,
        configurable: true,
        value: 5,
      })
      expect(detectTouchDevice()).toBe(true)
    })

    it('ignores exposed touch events with no touch hardware', () => {
      // jsdom (and some desktops) expose ontouchstart without a touchscreen;
      // that must not read as a touch device or every tooltip disappears.
      ;(window as { ontouchstart?: unknown }).ontouchstart = null
      Object.defineProperty(navigator, 'maxTouchPoints', {
        writable: true,
        configurable: true,
        value: 0,
      })
      expect(detectTouchDevice()).toBe(false)
    })

    it('returns false when no touch indicators present', () => {
      // Remove all touch indicators
      delete (window as { ontouchstart?: unknown }).ontouchstart
      Object.defineProperty(navigator, 'maxTouchPoints', {
        writable: true,
        configurable: true,
        value: 0,
      })
      const nav = navigator as { msMaxTouchPoints?: number }
      delete nav.msMaxTouchPoints

      expect(detectTouchDevice()).toBe(false)
    })
  })

  describe('safeStringify (REQ-3.1.3.14)', () => {
    it.each([
      [0.0000001, '0.0000001'],
      [1e21, '1000000000000000000000'],
      [-2.5, '-2.5'],
      [30, '30'],
    ])('writes the number %s in plain digits', (value, text) => {
      expect(safeStringify(value)).toBe(text)
    })

    it('writes text, a boolean, a structure and nothing as before', () => {
      expect(safeStringify('1e5')).toBe('1e5')
      expect(safeStringify(true)).toBe('true')
      expect(safeStringify({ a: 1 })).toBe('{"a":1}')
      expect(safeStringify(null)).toBe('')
      expect(safeStringify(undefined)).toBe('')
    })
  })
})
