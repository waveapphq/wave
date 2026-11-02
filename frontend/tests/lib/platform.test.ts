/**
 * Platform Detection Utility Tests
 *
 * REQ-4.2.5 Keyboard shortcuts for common operations
 *
 * Tests for platform detection utilities used by keyboard shortcut display,
 * hint bar, and context menu shortcut labels.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

describe('REQ-4.2.5 Platform Detection Utilities', () => {
  // Save original navigator descriptor so we can restore it
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  function mockNavigator(platform: string, userAgent?: string) {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        platform,
        userAgent: userAgent ?? platform,
      },
      writable: true,
      configurable: true,
    })
  }

  afterEach(() => {
    vi.resetModules()
    // Restore original navigator
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator)
    }
  })

  describe('isMac', () => {
    it('returns true when userAgent contains Macintosh', async () => {
      mockNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
      const { isMac } = await import('@/lib/platform')
      expect(isMac()).toBe(true)
    })

    it('returns true when navigator.userAgent contains Macintosh', async () => {
      mockNavigator('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
      const { isMac } = await import('@/lib/platform')
      expect(isMac()).toBe(true)
    })

    it('returns false on Windows platform', async () => {
      mockNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
      const { isMac } = await import('@/lib/platform')
      expect(isMac()).toBe(false)
    })

    it('returns false on Linux platform', async () => {
      mockNavigator('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')
      const { isMac } = await import('@/lib/platform')
      expect(isMac()).toBe(false)
    })
  })

  describe('getModifierLabel', () => {
    it('returns ⌘ on macOS', async () => {
      mockNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
      const { getModifierLabel } = await import('@/lib/platform')
      expect(getModifierLabel()).toBe('⌘')
    })

    it('returns Ctrl on non-Mac platforms', async () => {
      mockNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0)')
      const { getModifierLabel } = await import('@/lib/platform')
      expect(getModifierLabel()).toBe('Ctrl')
    })
  })

  describe('getModifierKey', () => {
    it('returns Meta on macOS (for event.metaKey check)', async () => {
      mockNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
      const { getModifierKey } = await import('@/lib/platform')
      expect(getModifierKey()).toBe('Meta')
    })

    it('returns Control on non-Mac platforms (for event.ctrlKey check)', async () => {
      mockNavigator('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')
      const { getModifierKey } = await import('@/lib/platform')
      expect(getModifierKey()).toBe('Control')
    })
  })

  describe('formatShortcut', () => {
    it('returns ⌘C on macOS for key C', async () => {
      mockNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
      const { formatShortcut } = await import('@/lib/platform')
      expect(formatShortcut('C')).toBe('⌘C')
    })

    it('returns Ctrl+C on non-Mac for key C', async () => {
      mockNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0)')
      const { formatShortcut } = await import('@/lib/platform')
      expect(formatShortcut('C')).toBe('Ctrl+C')
    })

    it('formats multi-character keys correctly', async () => {
      mockNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0)')
      const { formatShortcut } = await import('@/lib/platform')
      expect(formatShortcut('Shift+Z')).toBe('Ctrl+Shift+Z')
    })

    it('formats multi-character keys on Mac', async () => {
      mockNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
      const { formatShortcut } = await import('@/lib/platform')
      expect(formatShortcut('Shift+Z')).toBe('⌘Shift+Z')
    })
  })
})
