/**
 * Palette Usage Store Tests - V-CANVAS-01f/g
 *
 * Tests for tracking palette usage for Recently Used and Most Used sections.
 *
 * Note: Tests focus on WAVE behavior, not Zustand internals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('usePaletteUsageStore', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  describe('Recent Items Tracking', () => {
    it('adds dragged items to recent list (most recent first)', async () => {
      const { usePaletteUsageStore } = await import('@/features/workbench/stores/palette-usage-store')
      const { result } = renderHook(() => usePaletteUsageStore())

      act(() => {
        result.current.trackUsage('shell-script')
        result.current.trackUsage('python')
        result.current.trackUsage('http-client')
      })

      expect(result.current.recentItems).toEqual(['http-client', 'python', 'shell-script'])
    })

    it('moves re-used item to front without duplicates', async () => {
      const { usePaletteUsageStore } = await import('@/features/workbench/stores/palette-usage-store')
      const { result } = renderHook(() => usePaletteUsageStore())

      act(() => {
        result.current.trackUsage('shell-script')
        result.current.trackUsage('python')
        result.current.trackUsage('shell-script') // Re-use shell-script
      })

      expect(result.current.recentItems).toEqual(['shell-script', 'python'])
    })

    it('limits recent items to 10', async () => {
      const { usePaletteUsageStore } = await import('@/features/workbench/stores/palette-usage-store')
      const { result } = renderHook(() => usePaletteUsageStore())

      act(() => {
        for (let i = 0; i < 15; i++) {
          result.current.trackUsage(`item-${i}`)
        }
      })

      expect(result.current.recentItems).toHaveLength(10)
      expect(result.current.recentItems[0]).toBe('item-14') // Most recent
      expect(result.current.recentItems).not.toContain('item-0') // Oldest dropped
    })
  })

  describe('Frequent Items Tracking', () => {
    it('ranks items by usage count (most used first)', async () => {
      const { usePaletteUsageStore } = await import('@/features/workbench/stores/palette-usage-store')
      const { result } = renderHook(() => usePaletteUsageStore())

      act(() => {
        result.current.trackUsage('shell-script')
        result.current.trackUsage('python')
        result.current.trackUsage('shell-script')
        result.current.trackUsage('shell-script')
        result.current.trackUsage('python')
      })

      expect(result.current.frequentItems[0]).toEqual({ id: 'shell-script', count: 3 })
      expect(result.current.frequentItems[1]).toEqual({ id: 'python', count: 2 })
    })

    it('limits frequent items to top 10', async () => {
      const { usePaletteUsageStore } = await import('@/features/workbench/stores/palette-usage-store')
      const { result } = renderHook(() => usePaletteUsageStore())

      act(() => {
        for (let i = 0; i < 20; i++) {
          // Use items with varying frequency (higher index = more uses)
          for (let j = 0; j <= i; j++) {
            result.current.trackUsage(`item-${i}`)
          }
        }
      })

      expect(result.current.frequentItems).toHaveLength(10)
      expect(result.current.frequentItems[0].id).toBe('item-19') // Most used
    })
  })

  describe('Persistence', () => {
    it('persists data to localStorage', async () => {
      const { usePaletteUsageStore } = await import('@/features/workbench/stores/palette-usage-store')
      const { result } = renderHook(() => usePaletteUsageStore())

      act(() => {
        result.current.trackUsage('shell-script')
      })

      const stored = JSON.parse(localStorageMock.getItem('wave-palette-usage') ?? '{}')
      expect(stored.state.recentItems).toContain('shell-script')
    })

    it('restores data from localStorage on load', async () => {
      // Pre-populate localStorage
      localStorageMock.setItem('wave-palette-usage', JSON.stringify({
        state: { recentItems: ['shell-script', 'python'], usageCounts: { 'shell-script': 5, python: 3 } },
        version: 1,
      }))

      const { usePaletteUsageStore } = await import('@/features/workbench/stores/palette-usage-store')
      const { result } = renderHook(() => usePaletteUsageStore())

      expect(result.current.recentItems).toEqual(['shell-script', 'python'])
      expect(result.current.frequentItems[0]).toEqual({ id: 'shell-script', count: 5 })
    })

    it('clears corrupted data gracefully', async () => {
      localStorageMock.setItem('wave-palette-usage', 'invalid json{{{')

      const { usePaletteUsageStore } = await import('@/features/workbench/stores/palette-usage-store')
      const { result } = renderHook(() => usePaletteUsageStore())

      // Should start fresh, not crash
      expect(result.current.recentItems).toEqual([])
    })
  })

  describe('Clear History', () => {
    it('clears all usage data', async () => {
      const { usePaletteUsageStore } = await import('@/features/workbench/stores/palette-usage-store')
      const { result } = renderHook(() => usePaletteUsageStore())

      act(() => {
        result.current.trackUsage('shell-script')
        result.current.trackUsage('python')
        result.current.clearHistory()
      })

      expect(result.current.recentItems).toEqual([])
      expect(result.current.frequentItems).toEqual([])
    })
  })
})
