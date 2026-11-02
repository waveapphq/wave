/**
 * Sidebar Store Tests
 *
 * REQ-5.2.1.29: Sidebar navigation with collapsible sections
 * REQ-5.2.1.5: Zustand state management stores
 *
 * Tests for sidebar collapse state and section visibility management
 * with localStorage persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSidebarStore } from '@/stores/sidebar-store'

describe('Sidebar Store', () => {
  // Reset store state before each test
  beforeEach(() => {
    // Reset the store to initial state
    useSidebarStore.setState({
      isCollapsed: false,
      collapsedSections: {},
    })
    // Clear localStorage
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Initial State', () => {
    it('starts with sidebar expanded', () => {
      expect(useSidebarStore.getState().isCollapsed).toBe(false)
    })

    it('starts with no collapsed sections', () => {
      expect(useSidebarStore.getState().collapsedSections).toEqual({})
    })
  })

  describe('toggleCollapsed', () => {
    it('toggles sidebar from expanded to collapsed', () => {
      const { toggleCollapsed } = useSidebarStore.getState()
      toggleCollapsed()
      expect(useSidebarStore.getState().isCollapsed).toBe(true)
    })

    it('toggles sidebar from collapsed to expanded', () => {
      useSidebarStore.setState({ isCollapsed: true })
      const { toggleCollapsed } = useSidebarStore.getState()
      toggleCollapsed()
      expect(useSidebarStore.getState().isCollapsed).toBe(false)
    })

    it('persists collapse state to localStorage', () => {
      const { toggleCollapsed } = useSidebarStore.getState()
      toggleCollapsed()
      expect(localStorage.getItem('wave-sidebar-collapsed')).toBe('true')
    })

    it('persists expanded state to localStorage', () => {
      useSidebarStore.setState({ isCollapsed: true })
      const { toggleCollapsed } = useSidebarStore.getState()
      toggleCollapsed()
      expect(localStorage.getItem('wave-sidebar-collapsed')).toBe('false')
    })
  })

  describe('setCollapsed', () => {
    it('sets sidebar to collapsed', () => {
      const { setCollapsed } = useSidebarStore.getState()
      setCollapsed(true)
      expect(useSidebarStore.getState().isCollapsed).toBe(true)
    })

    it('sets sidebar to expanded', () => {
      useSidebarStore.setState({ isCollapsed: true })
      const { setCollapsed } = useSidebarStore.getState()
      setCollapsed(false)
      expect(useSidebarStore.getState().isCollapsed).toBe(false)
    })

    it('persists state to localStorage', () => {
      const { setCollapsed } = useSidebarStore.getState()
      setCollapsed(true)
      expect(localStorage.getItem('wave-sidebar-collapsed')).toBe('true')
    })
  })

  describe('toggleSection', () => {
    it('collapses a section that was expanded', () => {
      const { toggleSection, isSectionCollapsed } = useSidebarStore.getState()
      toggleSection('section-1')
      expect(isSectionCollapsed('section-1')).toBe(true)
    })

    it('expands a section that was collapsed', () => {
      useSidebarStore.setState({ collapsedSections: { 'section-1': true } })
      const { toggleSection, isSectionCollapsed } = useSidebarStore.getState()
      toggleSection('section-1')
      expect(isSectionCollapsed('section-1')).toBe(false)
    })

    it('persists section states to localStorage', () => {
      const { toggleSection } = useSidebarStore.getState()
      toggleSection('section-1')
      toggleSection('section-2')

      const stored = JSON.parse(localStorage.getItem('wave-sidebar-sections') || '{}')
      expect(stored['section-1']).toBe(true)
      expect(stored['section-2']).toBe(true)
    })

    it('handles multiple sections independently', () => {
      const { toggleSection, isSectionCollapsed } = useSidebarStore.getState()
      toggleSection('section-1')
      toggleSection('section-2')
      toggleSection('section-1') // Toggle back

      expect(isSectionCollapsed('section-1')).toBe(false)
      expect(isSectionCollapsed('section-2')).toBe(true)
    })
  })

  describe('isSectionCollapsed', () => {
    it('returns false for unknown sections', () => {
      const { isSectionCollapsed } = useSidebarStore.getState()
      expect(isSectionCollapsed('unknown-section')).toBe(false)
    })

    it('returns true for collapsed sections', () => {
      useSidebarStore.setState({ collapsedSections: { 'section-1': true } })
      const { isSectionCollapsed } = useSidebarStore.getState()
      expect(isSectionCollapsed('section-1')).toBe(true)
    })

    it('returns false for expanded sections', () => {
      useSidebarStore.setState({ collapsedSections: { 'section-1': false } })
      const { isSectionCollapsed } = useSidebarStore.getState()
      expect(isSectionCollapsed('section-1')).toBe(false)
    })
  })

  describe('initializeFromStorage', () => {
    it('restores collapsed state from localStorage', () => {
      localStorage.setItem('wave-sidebar-collapsed', 'true')
      const { initializeFromStorage } = useSidebarStore.getState()
      initializeFromStorage()
      expect(useSidebarStore.getState().isCollapsed).toBe(true)
    })

    it('restores expanded state from localStorage', () => {
      localStorage.setItem('wave-sidebar-collapsed', 'false')
      useSidebarStore.setState({ isCollapsed: true })
      const { initializeFromStorage } = useSidebarStore.getState()
      initializeFromStorage()
      expect(useSidebarStore.getState().isCollapsed).toBe(false)
    })

    it('restores section collapse states from localStorage', () => {
      localStorage.setItem('wave-sidebar-sections', JSON.stringify({
        'section-1': true,
        'section-2': false,
      }))
      const { initializeFromStorage, isSectionCollapsed } = useSidebarStore.getState()
      initializeFromStorage()
      expect(isSectionCollapsed('section-1')).toBe(true)
      expect(isSectionCollapsed('section-2')).toBe(false)
    })

    it('handles invalid JSON in localStorage gracefully', () => {
      localStorage.setItem('wave-sidebar-sections', 'invalid-json')
      const { initializeFromStorage } = useSidebarStore.getState()
      initializeFromStorage()
      // Should reset to defaults
      expect(useSidebarStore.getState().isCollapsed).toBe(false)
      expect(useSidebarStore.getState().collapsedSections).toEqual({})
    })

    it('handles null parsed value gracefully', () => {
      localStorage.setItem('wave-sidebar-sections', 'null')
      const { initializeFromStorage } = useSidebarStore.getState()
      initializeFromStorage()
      // Should keep existing state since parsed is null
      expect(useSidebarStore.getState().collapsedSections).toEqual({})
    })

    it('handles non-object parsed value gracefully', () => {
      localStorage.setItem('wave-sidebar-sections', '"string"')
      const { initializeFromStorage } = useSidebarStore.getState()
      initializeFromStorage()
      // Should keep existing state since parsed is not an object
      expect(useSidebarStore.getState().collapsedSections).toEqual({})
    })

    it('handles missing localStorage keys', () => {
      // localStorage is empty
      const { initializeFromStorage } = useSidebarStore.getState()
      initializeFromStorage()
      expect(useSidebarStore.getState().isCollapsed).toBe(false)
      expect(useSidebarStore.getState().collapsedSections).toEqual({})
    })
  })

  describe('localStorage Error Handling', () => {
    it('handles localStorage setItem errors gracefully for collapse state', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      const { toggleCollapsed } = useSidebarStore.getState()
      // Should not throw
      expect(() => toggleCollapsed()).not.toThrow()
      // State should still update
      expect(useSidebarStore.getState().isCollapsed).toBe(true)
    })

    it('handles localStorage setItem errors gracefully for section states', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      const { toggleSection } = useSidebarStore.getState()
      // Should not throw
      expect(() => toggleSection('section-1')).not.toThrow()
      // State should still update
      expect(useSidebarStore.getState().collapsedSections['section-1']).toBe(true)
    })

    it('handles localStorage getItem errors gracefully', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError')
      })

      const { initializeFromStorage } = useSidebarStore.getState()
      // Should not throw and should reset to defaults
      expect(() => initializeFromStorage()).not.toThrow()
      expect(useSidebarStore.getState().isCollapsed).toBe(false)
      expect(useSidebarStore.getState().collapsedSections).toEqual({})
    })
  })

  describe('SSR Safety', () => {
    it('handles window undefined gracefully in persistCollapseState', () => {
      // Simulate SSR by temporarily removing window.localStorage
      const originalLocalStorage = window.localStorage
      Object.defineProperty(window, 'localStorage', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const { toggleCollapsed } = useSidebarStore.getState()
      expect(() => toggleCollapsed()).not.toThrow()

      // Restore
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      })
    })

    it('handles window undefined gracefully in persistSectionStates', () => {
      const originalLocalStorage = window.localStorage
      Object.defineProperty(window, 'localStorage', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const { toggleSection } = useSidebarStore.getState()
      expect(() => toggleSection('section-1')).not.toThrow()

      // Restore
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      })
    })

    it('handles window undefined gracefully in initializeFromStorage', () => {
      const originalLocalStorage = window.localStorage
      Object.defineProperty(window, 'localStorage', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const { initializeFromStorage } = useSidebarStore.getState()
      expect(() => initializeFromStorage()).not.toThrow()

      // Restore
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      })
    })
  })

  describe('subscribeWithSelector middleware', () => {
    it('allows subscribing to specific state changes', () => {
      const listener = vi.fn()
      const unsubscribe = useSidebarStore.subscribe(
        (state) => state.isCollapsed,
        listener
      )

      const { toggleCollapsed } = useSidebarStore.getState()
      toggleCollapsed()

      expect(listener).toHaveBeenCalledWith(true, false)

      unsubscribe()
    })

    it('allows subscribing to collapsedSections changes', () => {
      const listener = vi.fn()
      const unsubscribe = useSidebarStore.subscribe(
        (state) => state.collapsedSections,
        listener
      )

      const { toggleSection } = useSidebarStore.getState()
      toggleSection('section-1')

      expect(listener).toHaveBeenCalled()

      unsubscribe()
    })
  })
})
