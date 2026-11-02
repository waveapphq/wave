/**
 * Sidebar Store - REQ-5.2.1.29 Sidebar navigation with collapsible sections
 * REQ-5.2.1.5 Zustand state management stores
 *
 * State management for sidebar collapse state and section visibility.
 * Persists user preferences to localStorage for cross-session consistency.
 * - Section collapse states persist independently
 * - Sidebar collapse state persists across sessions
 * - All sections default to expanded on first visit
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

interface SidebarState {
  isCollapsed: boolean
  collapsedSections: Record<string, boolean>
  toggleCollapsed: () => void
  setCollapsed: (collapsed: boolean) => void
  toggleSection: (sectionId: string) => void
  isSectionCollapsed: (sectionId: string) => boolean
  initializeFromStorage: () => void
}

const SIDEBAR_COLLAPSED_KEY = 'wave-sidebar-collapsed'
const SIDEBAR_SECTIONS_KEY = 'wave-sidebar-sections'

/**
 * Persist sidebar collapse state to localStorage
 */
function persistCollapseState(isCollapsed: boolean): void {
  try {
    if (globalThis.window?.localStorage) {
      globalThis.window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed))
    }
  } catch {
    // Ignore storage errors (e.g., quota exceeded, security restrictions)
  }
}

/**
 * Persist section collapse states to localStorage
 */
function persistSectionStates(sections: Record<string, boolean>): void {
  try {
    if (globalThis.window?.localStorage) {
      globalThis.window.localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(sections))
    }
  } catch {
    // Ignore storage errors (e.g., quota exceeded, security restrictions)
  }
}

/**
 * Zustand store for sidebar state
 */
export const useSidebarStore = create<SidebarState>()(
  subscribeWithSelector((set, get) => ({
    isCollapsed: false,
    collapsedSections: {},

    toggleCollapsed: () => {
      const newCollapsed = !get().isCollapsed
      set({ isCollapsed: newCollapsed })
      persistCollapseState(newCollapsed)
    },

    setCollapsed: (collapsed: boolean) => {
      set({ isCollapsed: collapsed })
      persistCollapseState(collapsed)
    },

    toggleSection: (sectionId: string) => {
      const current = get().collapsedSections
      const newSections = {
        ...current,
        [sectionId]: !current[sectionId],
      }
      set({ collapsedSections: newSections })
      persistSectionStates(newSections)
    },

    isSectionCollapsed: (sectionId: string) => {
      return get().collapsedSections[sectionId] ?? false
    },

    initializeFromStorage: () => {
      try {
        if (!globalThis.window?.localStorage) {
          return
        }

        // Restore sidebar collapse state
        const storedCollapsed = globalThis.window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
        if (storedCollapsed === 'true') {
          set({ isCollapsed: true })
        } else {
          set({ isCollapsed: false })
        }

        // Restore section collapse states
        const storedSections = globalThis.window.localStorage.getItem(SIDEBAR_SECTIONS_KEY)
        if (storedSections) {
          const parsed = JSON.parse(storedSections)
          if (typeof parsed === 'object' && parsed !== null) {
            set({ collapsedSections: parsed })
          }
        }
      } catch {
        // Storage errors or invalid JSON - use defaults
        set({ isCollapsed: false, collapsedSections: {} })
      }
    },
  }))
)
