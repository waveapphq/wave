/**
 * Layout choices kept for the browser session (SHELL-9): a page load in the same
 * tab reads them back, a new tab starts without them.
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface LayoutSessionState {
  /** One entry per layout choice the user made, by the key of the control. */
  values: Record<string, unknown>
  setValue: (key: string, value: unknown) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const useLayoutSessionStore = create<LayoutSessionState>()(
  persist(
    (set) => ({
      values: {},
      setValue: (key, value) => set((state) => ({ values: { ...state.values, [key]: value } })),
    }),
    {
      name: 'wave-layout-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ values: state.values }),
      merge: (persisted, current) => {
        const stored = (persisted as Partial<LayoutSessionState> | undefined)?.values
        return { ...current, values: isRecord(stored) ? stored : current.values }
      },
    },
  ),
)
