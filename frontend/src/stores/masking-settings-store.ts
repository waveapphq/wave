/** Global store of the system secret-reveal flags; hydrated from the admin API, masked by default. */

import { create } from 'zustand'
import { ADMIN_NOT_ENABLED_MESSAGE, fetchMaskingSettings } from '@/features/settings/api/admin'

interface MaskingSettingsFlags {
  runOutput: boolean
  testVariables: boolean
  sharedVariables: boolean
  credentialInputs: boolean
}

interface MaskingSettingsState extends MaskingSettingsFlags {
  /** Whether the flags have their answer: the read returned, or failed and left them masked. */
  hydrated: boolean
  /** Why the last hydrate failed; the flags then hold the masked default, not the server's. */
  loadError?: string
  set: (partial: Partial<MaskingSettingsFlags>) => void
  /** Reads the flags. Rejects with the reason the read failed. */
  hydrate: () => Promise<void>
}

const LOAD_ERROR_FALLBACK = 'Failed to load secret masking settings'

export const useMaskingSettingsStore = create<MaskingSettingsState>()((setState) => ({
  runOutput: false,
  testVariables: false,
  sharedVariables: false,
  credentialInputs: false,
  hydrated: false,
  loadError: undefined,

  set: (partial) => setState(partial),

  hydrate: async () => {
    const flags = await fetchMaskingSettings()
    setState({
      runOutput: flags.run_output,
      testVariables: flags.test_variables,
      sharedVariables: flags.shared_variables,
      credentialInputs: flags.credential_inputs,
      hydrated: true,
      loadError: undefined,
    })
  },
}))

/** Starts the one hydrate an app init needs: the unknown flags stay masked whatever comes
 *  back, and only a genuine failure is reported, once, through `report`. */
export function startMaskingSettingsHydration(report: (reason: string) => void): void {
  useMaskingSettingsStore
    .getState()
    .hydrate()
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : LOAD_ERROR_FALLBACK
      useMaskingSettingsStore.setState({ loadError: reason, hydrated: true })
      // The capability being switched off is an answer, so nothing went wrong to report.
      if (reason !== ADMIN_NOT_ENABLED_MESSAGE) report(reason)
    })
}
