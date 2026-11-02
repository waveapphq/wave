/**
 * ssh-host-policy-store - global host key policy (REQ-4.5.14).
 *
 * Module: frontend/src/stores/ssh-host-policy-store.ts
 *
 * Placement reads the default block action synchronously, so the policy is
 * hydrated at app start like the masking settings store; a failed read keeps
 * the default `disabled` (DEFAULT_HOST_KEY_POLICY) and is reported once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// Only the read is replaced; the store takes the real default policy constant.
vi.mock('@/features/settings/api/ssh-hosts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/api/ssh-hosts')>()),
  fetchHostKeyPolicy: vi.fn(),
}))

import type { HostKeyPolicy } from '@/features/settings/api/ssh-hosts'
import { DEFAULT_HOST_KEY_POLICY, fetchHostKeyPolicy } from '@/features/settings/api/ssh-hosts'
import { useSshHostPolicyStore } from '@/stores/ssh-host-policy-store'

const mockFetchPolicy = vi.mocked(fetchHostKeyPolicy)

const LOCKED_STRICT: HostKeyPolicy = { lock_trusted_hosts: true, default_block_action: 'strict' }
const OPEN_DISABLED: HostKeyPolicy = { lock_trusted_hosts: false, default_block_action: 'disabled' }

/** A fresh copy of the store module, as on a new page load; the API mock stays shared. */
async function loadFreshStore(): Promise<typeof import('@/stores/ssh-host-policy-store')> {
  vi.resetModules()
  return import('@/stores/ssh-host-policy-store')
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  act(() => {
    useSshHostPolicyStore.setState({
      defaultBlockAction: 'disabled',
      locked: false,
      loadError: undefined,
    })
  })
})

describe('ssh-host-policy-store', () => {
  describe('initial state', () => {
    it('starts with Disabled, unlocked and no load error', async () => {
      const { useSshHostPolicyStore: store } = await loadFreshStore()

      const state = store.getState()
      expect(state.defaultBlockAction).toBe('disabled')
      expect(state.locked).toBe(false)
      expect(state.loadError).toBeUndefined()
    })

    it('takes both initial fields from DEFAULT_HOST_KEY_POLICY', async () => {
      const { useSshHostPolicyStore: store } = await loadFreshStore()

      const state = store.getState()
      expect(state.defaultBlockAction).toBe(DEFAULT_HOST_KEY_POLICY.default_block_action)
      expect(state.locked).toBe(DEFAULT_HOST_KEY_POLICY.lock_trusted_hosts)
    })

    it('reads nothing until hydration is started', async () => {
      await loadFreshStore()

      expect(mockFetchPolicy).not.toHaveBeenCalled()
    })
  })

  describe('set', () => {
    it('replaces both fields from a policy', () => {
      useSshHostPolicyStore.getState().set(LOCKED_STRICT)

      const state = useSshHostPolicyStore.getState()
      expect(state.defaultBlockAction).toBe('strict')
      expect(state.locked).toBe(true)
    })

    it('replaces both fields again on the next policy', () => {
      useSshHostPolicyStore.getState().set(LOCKED_STRICT)
      useSshHostPolicyStore.getState().set(OPEN_DISABLED)

      const state = useSshHostPolicyStore.getState()
      expect(state.defaultBlockAction).toBe('disabled')
      expect(state.locked).toBe(false)
    })

    it('reaches subscribers reading through a selector', () => {
      const { result } = renderHook(() => ({
        action: useSshHostPolicyStore((s) => s.defaultBlockAction),
        locked: useSshHostPolicyStore((s) => s.locked),
      }))
      expect(result.current).toEqual({ action: 'disabled', locked: false })

      act(() => {
        useSshHostPolicyStore.getState().set(LOCKED_STRICT)
      })

      expect(result.current).toEqual({ action: 'strict', locked: true })
    })
  })

  describe('hydrate', () => {
    it('reads the policy once and stores both fields', async () => {
      mockFetchPolicy.mockResolvedValue(LOCKED_STRICT)

      await act(() => useSshHostPolicyStore.getState().hydrate())

      expect(mockFetchPolicy).toHaveBeenCalledTimes(1)
      const state = useSshHostPolicyStore.getState()
      expect(state.defaultBlockAction).toBe('strict')
      expect(state.locked).toBe(true)
      expect(state.loadError).toBeUndefined()
    })

    it('stores the Disabled default', async () => {
      act(() => {
        useSshHostPolicyStore.getState().set(LOCKED_STRICT)
      })
      mockFetchPolicy.mockResolvedValue(OPEN_DISABLED)

      await act(() => useSshHostPolicyStore.getState().hydrate())

      expect(useSshHostPolicyStore.getState().defaultBlockAction).toBe('disabled')
      expect(useSshHostPolicyStore.getState().locked).toBe(false)
    })

    it('clears an earlier load error once the read succeeds', async () => {
      act(() => {
        useSshHostPolicyStore.setState({ loadError: 'Service Unavailable' })
      })
      mockFetchPolicy.mockResolvedValue(LOCKED_STRICT)

      await act(() => useSshHostPolicyStore.getState().hydrate())

      expect(useSshHostPolicyStore.getState().loadError).toBeUndefined()
    })

    it('rejects with the reason the read failed and keeps Disabled', async () => {
      mockFetchPolicy.mockRejectedValue(new Error('Service Unavailable'))
      const { useSshHostPolicyStore: store } = await loadFreshStore()

      await expect(store.getState().hydrate()).rejects.toThrow(/^Service Unavailable$/)

      const state = store.getState()
      expect(state.defaultBlockAction).toBe('disabled')
      expect(state.locked).toBe(false)
    })
  })

  describe('startSshHostPolicyHydration', () => {
    it('stores the read policy and reports nothing', async () => {
      mockFetchPolicy.mockResolvedValue(LOCKED_STRICT)
      const { useSshHostPolicyStore: store, startSshHostPolicyHydration } = await loadFreshStore()
      const report = vi.fn()

      startSshHostPolicyHydration(report)

      await vi.waitFor(() => {
        expect(store.getState().defaultBlockAction).toBe('strict')
      })
      expect(store.getState().locked).toBe(true)
      expect(store.getState().loadError).toBeUndefined()
      expect(mockFetchPolicy).toHaveBeenCalledTimes(1)
      expect(report).not.toHaveBeenCalled()
    })

    it('keeps Disabled, records the reason and reports it when the read fails', async () => {
      const reason =
        "WAVE's trusted SSH hosts list /srv/wave/data/network/ssh_hosts.yaml cannot be read: Permission denied"
      mockFetchPolicy.mockRejectedValue(new Error(reason))
      const { useSshHostPolicyStore: store, startSshHostPolicyHydration } = await loadFreshStore()
      const report = vi.fn()

      startSshHostPolicyHydration(report)

      await vi.waitFor(() => {
        expect(report).toHaveBeenCalledWith(reason)
      })
      expect(report).toHaveBeenCalledTimes(1)
      const state = store.getState()
      expect(state.loadError).toBe(reason)
      expect(state.defaultBlockAction).toBe('disabled')
      expect(state.locked).toBe(false)
    })

    it('reports a failure exactly once even when started twice', async () => {
      mockFetchPolicy.mockRejectedValue(new Error('Service Unavailable'))
      const { useSshHostPolicyStore: store, startSshHostPolicyHydration } = await loadFreshStore()
      const report = vi.fn()

      startSshHostPolicyHydration(report)
      startSshHostPolicyHydration(report)

      await vi.waitFor(() => {
        expect(store.getState().loadError).toBe('Service Unavailable')
      })
      await vi.waitFor(() => {
        expect(report).toHaveBeenCalled()
      })
      // Let any second read settle before counting reports.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(report).toHaveBeenCalledTimes(1)
      expect(report).toHaveBeenCalledWith('Service Unavailable')
      expect(store.getState().defaultBlockAction).toBe('disabled')
    })

    it('records and reports a non-empty reason when the rejection is not an Error', async () => {
      mockFetchPolicy.mockRejectedValue('offline')
      const { useSshHostPolicyStore: store, startSshHostPolicyHydration } = await loadFreshStore()
      const report = vi.fn()

      startSshHostPolicyHydration(report)

      await vi.waitFor(() => {
        expect(report).toHaveBeenCalledTimes(1)
      })
      const reason = report.mock.calls[0][0] as unknown
      expect(typeof reason).toBe('string')
      expect((reason as string).length).toBeGreaterThan(0)
      expect(store.getState().loadError).toBe(reason)
      expect(store.getState().defaultBlockAction).toBe('disabled')
    })
  })
})
