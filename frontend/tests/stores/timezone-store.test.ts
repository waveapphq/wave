/**
 * Tests for the per-browser Time Zone preference store.
 *
 * User-selectable Time Zone for UI timestamps.
 *
 * Storage contract: localStorage key `wave.timezone` holds either 'local' or 'utc'.
 * Default mode is 'local'. Initialization reads the stored value (if valid) and
 * subscribes to the cross-tab `storage` event so two browser tabs converge.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useTimezoneStore, TIMEZONE_STORAGE_KEY } from '@/stores/timezone-store'

describe('Timezone Store', () => {
  beforeEach(() => {
    // Reset store and storage between tests
    useTimezoneStore.setState({ mode: 'local' })
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Initial State', () => {
    it("defaults to 'local' mode", () => {
      expect(useTimezoneStore.getState().mode).toBe('local')
    })
  })

  describe('setMode', () => {
    it("transitions mode from 'local' to 'utc'", () => {
      useTimezoneStore.getState().setMode('utc')
      expect(useTimezoneStore.getState().mode).toBe('utc')
    })

    it("transitions mode from 'utc' back to 'local'", () => {
      useTimezoneStore.setState({ mode: 'utc' })
      useTimezoneStore.getState().setMode('local')
      expect(useTimezoneStore.getState().mode).toBe('local')
    })

    it("persists 'utc' to localStorage under wave.timezone", () => {
      useTimezoneStore.getState().setMode('utc')
      expect(localStorage.getItem(TIMEZONE_STORAGE_KEY)).toBe('utc')
    })

    it("persists 'local' to localStorage under wave.timezone", () => {
      useTimezoneStore.setState({ mode: 'utc' })
      useTimezoneStore.getState().setMode('local')
      expect(localStorage.getItem(TIMEZONE_STORAGE_KEY)).toBe('local')
    })

    it('storage key is exactly "wave.timezone" (per HLD)', () => {
      expect(TIMEZONE_STORAGE_KEY).toBe('wave.timezone')
    })

    it('survives a localStorage write failure without throwing', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded')
      })
      expect(() => useTimezoneStore.getState().setMode('utc')).not.toThrow()
      expect(useTimezoneStore.getState().mode).toBe('utc')
      setItemSpy.mockRestore()
    })
  })

  describe('initializeFromStorage', () => {
    it("rehydrates mode='utc' from localStorage", () => {
      localStorage.setItem(TIMEZONE_STORAGE_KEY, 'utc')
      useTimezoneStore.getState().initializeFromStorage()
      expect(useTimezoneStore.getState().mode).toBe('utc')
    })

    it("rehydrates mode='local' from localStorage", () => {
      useTimezoneStore.setState({ mode: 'utc' })
      localStorage.setItem(TIMEZONE_STORAGE_KEY, 'local')
      useTimezoneStore.getState().initializeFromStorage()
      expect(useTimezoneStore.getState().mode).toBe('local')
    })

    it("falls back to 'local' default when nothing is stored", () => {
      useTimezoneStore.setState({ mode: 'utc' })
      // Storage is empty (cleared in beforeEach)
      useTimezoneStore.getState().initializeFromStorage()
      expect(useTimezoneStore.getState().mode).toBe('local')
    })

    it("falls back to 'local' default for an unknown stored value", () => {
      localStorage.setItem(TIMEZONE_STORAGE_KEY, 'mars-time')
      useTimezoneStore.getState().initializeFromStorage()
      expect(useTimezoneStore.getState().mode).toBe('local')
    })

    it('survives a localStorage read failure without throwing', () => {
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('access denied')
      })
      expect(() => useTimezoneStore.getState().initializeFromStorage()).not.toThrow()
      expect(useTimezoneStore.getState().mode).toBe('local')
      getItemSpy.mockRestore()
    })
  })

  describe('cross-tab sync via storage event', () => {
    it('updates mode when another tab writes utc to wave.timezone', () => {
      useTimezoneStore.getState().initializeFromStorage()
      // Simulate another tab writing the new value, then the storage event firing
      localStorage.setItem(TIMEZONE_STORAGE_KEY, 'utc')
      const evt = new StorageEvent('storage', {
        key: TIMEZONE_STORAGE_KEY,
        newValue: 'utc',
        oldValue: 'local',
        storageArea: localStorage,
      })
      window.dispatchEvent(evt)
      expect(useTimezoneStore.getState().mode).toBe('utc')
    })

    it('ignores storage events for unrelated keys', () => {
      useTimezoneStore.getState().initializeFromStorage()
      const evt = new StorageEvent('storage', {
        key: 'some-other-key',
        newValue: 'utc',
        oldValue: null,
        storageArea: localStorage,
      })
      window.dispatchEvent(evt)
      expect(useTimezoneStore.getState().mode).toBe('local')
    })

    it("ignores storage events with an unknown new value", () => {
      useTimezoneStore.getState().initializeFromStorage()
      const evt = new StorageEvent('storage', {
        key: TIMEZONE_STORAGE_KEY,
        newValue: 'mars-time',
        oldValue: 'local',
        storageArea: localStorage,
      })
      window.dispatchEvent(evt)
      // Stays at default
      expect(useTimezoneStore.getState().mode).toBe('local')
    })

    it("falls back to default when another tab clears the key (newValue=null)", () => {
      useTimezoneStore.setState({ mode: 'utc' })
      useTimezoneStore.getState().initializeFromStorage()
      const evt = new StorageEvent('storage', {
        key: TIMEZONE_STORAGE_KEY,
        newValue: null,
        oldValue: 'utc',
        storageArea: localStorage,
      })
      window.dispatchEvent(evt)
      expect(useTimezoneStore.getState().mode).toBe('local')
    })
  })
})
