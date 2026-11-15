/**
 * Utils Tests - REQ-5.2.1.17 Responsive layout utilities
 *
 * Tests for utility functions including SSR-safe helpers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cn, isBrowser, detectTouchDevice, safeStringify, secureRandomId, secureRandomInt } from '@/lib/utils'

// Each getRandomValues call fills its array from the next queued draws, then zeros.
function queueRandomDraws(draws: number[]) {
  let next = 0
  return vi
    .spyOn(globalThis.crypto, 'getRandomValues')
    .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      const view = array as unknown as Uint8Array | Uint32Array
      for (let i = 0; i < view.length; i++) view[i] = draws[next++] ?? 0
      return array
    })
}

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

  describe('secureRandomInt', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('redraws a draw at or past the last full multiple of the bound', () => {
      // 2^32 % 36 is 4, so 4294967292 is the first draw that would favor low results.
      const getRandomValues = queueRandomDraws([4294967292, 4294967291])
      expect(secureRandomInt(36)).toBe(35)
      expect(getRandomValues).toHaveBeenCalledTimes(2)
    })

    it('takes every draw when the bound divides 2^32', () => {
      const getRandomValues = queueRandomDraws([0xffffffff])
      expect(secureRandomInt(16)).toBe(15)
      expect(getRandomValues).toHaveBeenCalledTimes(1)
    })

    it('stays within the bound', () => {
      const results = Array.from({ length: 200 }, () => secureRandomInt(40))
      expect(results.every((n) => Number.isInteger(n) && n >= 0 && n < 40)).toBe(true)
    })
  })

  describe('secureRandomId', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('redraws a draw that would favor the first letters', () => {
      queueRandomDraws([0xffffffff])
      expect(secureRandomId(3)).toBe('aaa')
    })

    it('maps draws onto the lowercase letters, then the digits', () => {
      queueRandomDraws([0, 25, 26, 35])
      expect(secureRandomId(4)).toBe('az09')
    })

    it('makes seven lowercase letters or digits by default', () => {
      const ids = Array.from({ length: 200 }, () => secureRandomId())
      expect(ids.every((id) => /^[a-z0-9]{7}$/.test(id))).toBe(true)
    })
  })
})
