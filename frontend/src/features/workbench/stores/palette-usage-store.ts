/**
 * Palette Usage Store - V-CANVAS-01f/g
 *
 * Tracks palette usage for Recently Used and Most Used sections.
 * Persists data to localStorage across sessions.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface FrequentItem {
  id: string
  count: number
}

interface PaletteUsageState {
  /** Recently used item IDs (most recent first) */
  recentItems: string[]
  /** Usage counts for frequency tracking */
  usageCounts: Record<string, number>
}

interface PaletteUsageActions {
  /** Track usage of an item (updates both recent and frequent) */
  trackUsage: (itemId: string) => void
  /** Clear all usage history */
  clearHistory: () => void
}

interface PaletteUsageComputed {
  /** Computed: frequent items sorted by count (top 10) */
  frequentItems: FrequentItem[]
}

type PaletteUsageStore = PaletteUsageState & PaletteUsageActions & PaletteUsageComputed

const MAX_RECENT_ITEMS = 10

// Compute frequent items from usage counts
function computeFrequentItems(usageCounts: Record<string, number>): FrequentItem[] {
  return Object.entries(usageCounts)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
}

export const usePaletteUsageStore = create<PaletteUsageStore>()(
  persist(
    (set) => ({
      recentItems: [],
      usageCounts: {},
      frequentItems: [],

      trackUsage: (itemId: string) => {
        set((state) => {
          // Update recent items (move to front, dedupe)
          const filteredRecent = state.recentItems.filter((id) => id !== itemId)
          const newRecent = [itemId, ...filteredRecent].slice(0, MAX_RECENT_ITEMS)

          // Update usage counts
          const newCounts = {
            ...state.usageCounts,
            [itemId]: (state.usageCounts[itemId] ?? 0) + 1,
          }

          return {
            recentItems: newRecent,
            usageCounts: newCounts,
            frequentItems: computeFrequentItems(newCounts),
          }
        })
      },

      clearHistory: () => {
        set({ recentItems: [], usageCounts: {}, frequentItems: [] })
      },
    }),
    {
      name: 'wave-palette-usage',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only persist the raw data, compute frequentItems on rehydration
      partialize: (state) => ({
        recentItems: state.recentItems,
        usageCounts: state.usageCounts,
      }),
      // Recompute frequentItems after rehydration
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.frequentItems = computeFrequentItems(state.usageCounts)
        }
      },
    }
  )
)
