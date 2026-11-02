/**
 * masking-settings-store - global system reveal flags (REQ-3.1.3.17).
 *
 * A global Zustand store holding the three system-wide reveal flags so the
 * canvas badge and the block config modal both resolve effective reveal from
 * one place. Hydrates from the admin API on app init (mirrors timezone-store
 * as a global store, but sourced from the server rather than localStorage).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// importOriginal keeps ADMIN_NOT_ENABLED_MESSAGE real: the store compares against it.
vi.mock('@/features/settings/api/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/api/admin')>()),
  fetchMaskingSettings: vi.fn(),
  setMaskingSettings: vi.fn(),
}))

import {
  startMaskingSettingsHydration,
  useMaskingSettingsStore,
} from '@/stores/masking-settings-store'
import { fetchMaskingSettings } from '@/features/settings/api/admin'

const mockFetch = vi.mocked(fetchMaskingSettings)

beforeEach(() => {
  vi.clearAllMocks()
  useMaskingSettingsStore.setState({
    runOutput: false,
    testVariables: false,
    sharedVariables: false,
    credentialInputs: false,
    loadError: undefined,
    hydrated: false,
  })
})

describe('masking-settings-store', () => {
  it('defaults every flag to false (secure by default)', () => {
    const state = useMaskingSettingsStore.getState()
    expect(state.runOutput).toBe(false)
    expect(state.testVariables).toBe(false)
    expect(state.sharedVariables).toBe(false)
  })

  describe('hydrated', () => {
    it('is false until the flags have loaded', () => {
      expect(useMaskingSettingsStore.getInitialState().hydrated).toBe(false)
    })

    it('turns true once the read returns', async () => {
      mockFetch.mockResolvedValue({
        run_output: false,
        test_variables: true,
        shared_variables: false,
        credential_inputs: false,
      })
      await useMaskingSettingsStore.getState().hydrate()
      expect(useMaskingSettingsStore.getState().hydrated).toBe(true)
    })

    it('turns true when the read fails, the flags staying masked', async () => {
      mockFetch.mockRejectedValue(new Error('boom'))
      startMaskingSettingsHydration(vi.fn())
      await vi.waitFor(() => {
        expect(useMaskingSettingsStore.getState().hydrated).toBe(true)
      })
      expect(useMaskingSettingsStore.getState().testVariables).toBe(false)
      expect(useMaskingSettingsStore.getState().loadError).toBe('boom')
    })
  })

  describe('set', () => {
    it('updates a single flag, preserving the others', () => {
      useMaskingSettingsStore.getState().set({ runOutput: true })
      const state = useMaskingSettingsStore.getState()
      expect(state.runOutput).toBe(true)
      expect(state.testVariables).toBe(false)
      expect(state.sharedVariables).toBe(false)
    })

    it('updates multiple flags at once', () => {
      useMaskingSettingsStore.getState().set({ testVariables: true, sharedVariables: true })
      const state = useMaskingSettingsStore.getState()
      expect(state.testVariables).toBe(true)
      expect(state.sharedVariables).toBe(true)
      expect(state.runOutput).toBe(false)
    })

    it('flips a flag back off', () => {
      useMaskingSettingsStore.getState().set({ runOutput: true })
      useMaskingSettingsStore.getState().set({ runOutput: false })
      expect(useMaskingSettingsStore.getState().runOutput).toBe(false)
    })
  })

  describe('hydrate', () => {
    it('loads the flags from the admin API (snake_case to camelCase)', async () => {
      mockFetch.mockResolvedValue({
        run_output: true,
        test_variables: false,
        shared_variables: true,
        credential_inputs: true,
      })
      await useMaskingSettingsStore.getState().hydrate()
      const state = useMaskingSettingsStore.getState()
      expect(state.runOutput).toBe(true)
      expect(state.testVariables).toBe(false)
      expect(state.sharedVariables).toBe(true)
      expect(state.credentialInputs).toBe(true)
    })

    it('calls the admin API exactly once', async () => {
      mockFetch.mockResolvedValue({
        run_output: false,
        test_variables: false,
        shared_variables: false,
        credential_inputs: false,
      })
      await useMaskingSettingsStore.getState().hydrate()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('rejects with the reason the read failed', async () => {
      mockFetch.mockRejectedValue(new Error('Admin API is not enabled on this server'))
      await expect(useMaskingSettingsStore.getState().hydrate()).rejects.toThrow(
        'Admin API is not enabled on this server',
      )
    })
  })

  describe('startMaskingSettingsHydration', () => {
    it('keeps every flag masked when the API call fails (secure default)', async () => {
      mockFetch.mockRejectedValue(new Error('Admin API is not enabled on this server'))
      startMaskingSettingsHydration(vi.fn())
      await vi.waitFor(() => {
        expect(useMaskingSettingsStore.getState().loadError).toBeDefined()
      })
      const state = useMaskingSettingsStore.getState()
      expect(state.runOutput).toBe(false)
      expect(state.testVariables).toBe(false)
      expect(state.sharedVariables).toBe(false)
    })

    it('records why the read failed instead of swallowing it', async () => {
      mockFetch.mockRejectedValue(new Error('Admin API is not enabled on this server'))
      startMaskingSettingsHydration(vi.fn())
      await vi.waitFor(() => {
        expect(useMaskingSettingsStore.getState().loadError).toBe(
          'Admin API is not enabled on this server',
        )
      })
    })

    it('records a generic reason when the rejection is not an Error', async () => {
      mockFetch.mockRejectedValue('offline')
      startMaskingSettingsHydration(vi.fn())
      await vi.waitFor(() => {
        expect(useMaskingSettingsStore.getState().loadError).toBe(
          'Failed to load secret masking settings',
        )
      })
    })

    it('a genuine hydrate failure is reported, not only recorded', async () => {
      mockFetch.mockRejectedValue(new Error('boom'))
      const report = vi.fn()

      startMaskingSettingsHydration(report)

      await vi.waitFor(() => {
        expect(report).toHaveBeenCalledWith('boom')
      })
      expect(report).toHaveBeenCalledTimes(1)
      const state = useMaskingSettingsStore.getState()
      expect(state.runOutput).toBe(false)
      expect(state.testVariables).toBe(false)
      expect(state.sharedVariables).toBe(false)
      expect(state.credentialInputs).toBe(false)
      expect(state.loadError).toBe('boom')
    })

    it('the not-enabled answer is recorded but never reported', async () => {
      mockFetch.mockRejectedValue(new Error('Admin API is not enabled on this server'))
      const report = vi.fn()

      startMaskingSettingsHydration(report)

      await vi.waitFor(() => {
        expect(useMaskingSettingsStore.getState().loadError).toBe(
          'Admin API is not enabled on this server',
        )
      })
      expect(report).not.toHaveBeenCalled()
      expect(useMaskingSettingsStore.getState().credentialInputs).toBe(false)
    })

    it('reports the generic reason when the rejection is not an Error', async () => {
      mockFetch.mockRejectedValue('offline')
      const report = vi.fn()

      startMaskingSettingsHydration(report)

      await vi.waitFor(() => {
        expect(report).toHaveBeenCalledWith('Failed to load secret masking settings')
      })
    })

    it('reports nothing when the read succeeds', async () => {
      mockFetch.mockResolvedValue({
        run_output: true,
        test_variables: false,
        shared_variables: false,
        credential_inputs: false,
      })
      const report = vi.fn()

      startMaskingSettingsHydration(report)

      await vi.waitFor(() => {
        expect(useMaskingSettingsStore.getState().runOutput).toBe(true)
      })
      expect(report).not.toHaveBeenCalled()
    })

    it('clears a recorded failure once the read succeeds', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Admin API is not enabled on this server'))
      startMaskingSettingsHydration(vi.fn())
      await vi.waitFor(() => {
        expect(useMaskingSettingsStore.getState().loadError).toBeDefined()
      })

      mockFetch.mockResolvedValue({
        run_output: true,
        test_variables: false,
        shared_variables: false,
        credential_inputs: false,
      })
      await useMaskingSettingsStore.getState().hydrate()
      expect(useMaskingSettingsStore.getState().loadError).toBeUndefined()
      expect(useMaskingSettingsStore.getState().runOutput).toBe(true)
    })
  })
})
