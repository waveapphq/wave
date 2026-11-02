/**
 * Per-browser Time Zone preference store.
 *
 * The preference is purely a UI display concern - the
 * backend stores and returns UTC ISO-8601 only, so this store has no API
 * surface. State is persisted to localStorage under `wave.timezone` so the
 * choice survives reload, navigation, and tab close. A `storage` event
 * listener reflects changes made in another tab so two open tabs converge.
 */

import { create } from 'zustand'
import type { TimezoneMode } from '@/lib/timestamp-format'

export type { TimezoneMode } from '@/lib/timestamp-format'

export const TIMEZONE_STORAGE_KEY = 'wave.timezone'
const VALID_MODES: TimezoneMode[] = ['local', 'utc']

interface TimezoneState {
  mode: TimezoneMode
  setMode: (mode: TimezoneMode) => void
  initializeFromStorage: () => void
}

function isValidMode(value: unknown): value is TimezoneMode {
  return typeof value === 'string' && (VALID_MODES as string[]).includes(value)
}

function readStored(): TimezoneMode | null {
  try {
    const raw = globalThis.window?.localStorage?.getItem(TIMEZONE_STORAGE_KEY)
    return isValidMode(raw) ? raw : null
  } catch {
    return null
  }
}

function writeStored(mode: TimezoneMode): void {
  try {
    globalThis.window?.localStorage?.setItem(TIMEZONE_STORAGE_KEY, mode)
  } catch {
    // Storage failures (quota, privacy mode) are non-fatal: in-memory state
    // still flips so the current session feels responsive.
  }
}

let storageListenerAttached = false

// Read the persisted preference at module-load time so every consumer surface
// starts in the right mode without needing an explicit init call. The full
// `initializeFromStorage` action below is still used by the SettingsContainer
// to attach the cross-tab `storage` listener once the app has mounted.
const initialMode: TimezoneMode = readStored() ?? 'local'

export const useTimezoneStore = create<TimezoneState>()((set) => ({
  mode: initialMode,

  setMode: (mode: TimezoneMode) => {
    set({ mode })
    writeStored(mode)
  },

  initializeFromStorage: () => {
    const stored = readStored()
    set({ mode: stored ?? 'local' })

    if (storageListenerAttached || globalThis.window === undefined) {
      return
    }
    storageListenerAttached = true
    globalThis.window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key !== TIMEZONE_STORAGE_KEY) return
      if (event.newValue === null) {
        // Another tab cleared the preference - fall back to default.
        set({ mode: 'local' })
        return
      }
      if (isValidMode(event.newValue)) {
        set({ mode: event.newValue })
      }
    })
  },
}))
