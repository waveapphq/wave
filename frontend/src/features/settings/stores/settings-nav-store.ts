/**
 * Settings nav state for the browser session (NET-1, NET-10, SHELL-9): leaving Settings and
 * a page load in the same tab keep it, a new tab starts it over.
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface SettingsNavState {
  /** The Network group's open state once it was shown open or toggled; null until then. */
  networkExpanded: boolean | null
  setNetworkExpanded: (expanded: boolean) => void
  /** The same for the Proxy group nested in the Network group. */
  proxyExpanded: boolean | null
  setProxyExpanded: (expanded: boolean) => void
}

export const useSettingsNavStore = create<SettingsNavState>()(
  persist(
    (set) => ({
      networkExpanded: null,
      setNetworkExpanded: (expanded) => set({ networkExpanded: expanded }),
      proxyExpanded: null,
      setProxyExpanded: (expanded) => set({ proxyExpanded: expanded }),
    }),
    {
      name: 'wave-settings-nav',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        networkExpanded: state.networkExpanded,
        proxyExpanded: state.proxyExpanded,
      }),
    },
  ),
)
