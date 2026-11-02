/**
 * Persisted per-browser console display settings - REQ-3.4.2.7.
 *
 * Single source for every console surface: the live workbench console, the
 * Execution History console, and the report log panel.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { DisplaySettings } from '@/types/console'

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  showTimestamps: true,
  showLevel: true,
  showSource: true,
  sourceWidth: 20,
  showSystemLogs: true,
  fontSize: 12,
}

interface DisplaySettingsStore {
  settings: DisplaySettings
  updateSettings: (changes: Partial<DisplaySettings>) => void
}

export const useDisplaySettingsStore = create<DisplaySettingsStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_DISPLAY_SETTINGS,

      updateSettings: (changes) => {
        set((state) => ({ settings: { ...state.settings, ...changes } }))
      },
    }),
    {
      name: 'wave-console-display-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ settings: state.settings }),
      // A partial stored payload keeps the missing defaults.
      merge: (persistedState, currentState) => ({
        ...currentState,
        settings: {
          ...DEFAULT_DISPLAY_SETTINGS,
          ...(persistedState as Partial<DisplaySettingsStore> | undefined)?.settings,
        },
      }),
    }
  )
)
