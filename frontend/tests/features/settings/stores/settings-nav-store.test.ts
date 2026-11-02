/**
 * Settings nav store (NET-1, NET-10, SHELL-9): the open state of the Network group and
 * of the Proxy group nested in it, for the browser session; each is null until
 * its group is first shown open or toggled.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsNavStore } from '@/features/settings/stores/settings-nav-store'

describe('useSettingsNavStore', () => {
  // Every test starts from what a page load gives.
  beforeEach(() => {
    useSettingsNavStore.setState(useSettingsNavStore.getInitialState(), true)
  })

  it('holds no Network choice after a page load', () => {
    expect(useSettingsNavStore.getState().networkExpanded).toBeNull()
  })

  it('records the Network group open and closed', () => {
    useSettingsNavStore.getState().setNetworkExpanded(true)
    expect(useSettingsNavStore.getState().networkExpanded).toBe(true)

    useSettingsNavStore.getState().setNetworkExpanded(false)
    expect(useSettingsNavStore.getState().networkExpanded).toBe(false)
  })

  describe('Proxy group (NET-10)', () => {
    it('holds no Proxy choice after a page load', () => {
      expect(useSettingsNavStore.getState().proxyExpanded).toBeNull()
    })

    it('records the Proxy group open and closed', () => {
      useSettingsNavStore.getState().setProxyExpanded(true)
      expect(useSettingsNavStore.getState().proxyExpanded).toBe(true)

      useSettingsNavStore.getState().setProxyExpanded(false)
      expect(useSettingsNavStore.getState().proxyExpanded).toBe(false)
    })

    it('leaves the Proxy choice alone when the Network group is recorded', () => {
      useSettingsNavStore.getState().setNetworkExpanded(true)

      expect(useSettingsNavStore.getState().proxyExpanded).toBeNull()
    })

    it('leaves the Network choice alone when the Proxy group is recorded', () => {
      useSettingsNavStore.getState().setNetworkExpanded(true)
      useSettingsNavStore.getState().setProxyExpanded(false)

      expect(useSettingsNavStore.getState().networkExpanded).toBe(true)
      expect(useSettingsNavStore.getState().proxyExpanded).toBe(false)
    })
  })

  describe('remembered for the browser session (SHELL-9)', () => {
    async function afterAPageLoad() {
      vi.resetModules()
      const reloaded = await import('@/features/settings/stores/settings-nav-store')
      return reloaded.useSettingsNavStore.getState()
    }

    it('reads both choices back after a page load in the same tab', async () => {
      useSettingsNavStore.getState().setNetworkExpanded(false)
      useSettingsNavStore.getState().setProxyExpanded(true)

      const reloaded = await afterAPageLoad()

      expect(reloaded.networkExpanded).toBe(false)
      expect(reloaded.proxyExpanded).toBe(true)
    })

    it('holds no choice in a new tab', async () => {
      useSettingsNavStore.getState().setNetworkExpanded(false)
      sessionStorage.clear()

      const reloaded = await afterAPageLoad()

      expect(reloaded.networkExpanded).toBeNull()
      expect(reloaded.proxyExpanded).toBeNull()
    })

    it('keeps the choices in the tab, never in the browser', () => {
      useSettingsNavStore.getState().setNetworkExpanded(true)

      expect(sessionStorage.getItem('wave-settings-nav')).toContain('"networkExpanded":true')
      expect(localStorage.length).toBe(0)
    })
  })
})
