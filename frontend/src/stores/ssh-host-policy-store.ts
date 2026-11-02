/** Global SSH host key policy; block placement reads the default block action synchronously (REQ-4.5.14). */

import { create } from 'zustand'
import {
  DEFAULT_HOST_KEY_POLICY,
  fetchHostKeyPolicy,
  type HostKeyAction,
  type HostKeyPolicy,
} from '@/features/settings/api/ssh-hosts'

interface SshHostPolicyState {
  defaultBlockAction: HostKeyAction
  locked: boolean
  /** Why the last hydrate failed; the fields then hold the block's own default. */
  loadError?: string
  set: (policy: HostKeyPolicy) => void
  /** Reads the policy. Rejects with the reason the read failed. */
  hydrate: () => Promise<void>
}

const LOAD_ERROR_FALLBACK = 'Failed to load the host key policy'

export const useSshHostPolicyStore = create<SshHostPolicyState>()((setState) => ({
  defaultBlockAction: DEFAULT_HOST_KEY_POLICY.default_block_action,
  locked: DEFAULT_HOST_KEY_POLICY.lock_trusted_hosts,
  loadError: undefined,

  set: (policy) =>
    setState({
      defaultBlockAction: policy.default_block_action,
      locked: policy.lock_trusted_hosts,
    }),

  hydrate: async () => {
    const policy = await fetchHostKeyPolicy()
    setState({
      defaultBlockAction: policy.default_block_action,
      locked: policy.lock_trusted_hosts,
      loadError: undefined,
    })
  },
}))

let hydrationInFlight: Promise<void> | undefined

/** Starts the one hydrate an app init needs; starts that overlap share one read and one report. */
export function startSshHostPolicyHydration(report: (reason: string) => void): void {
  if (hydrationInFlight) return
  hydrationInFlight = useSshHostPolicyStore
    .getState()
    .hydrate()
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : LOAD_ERROR_FALLBACK
      useSshHostPolicyStore.setState({ loadError: reason })
      report(reason)
    })
    .finally(() => {
      hydrationInFlight = undefined
    })
}
