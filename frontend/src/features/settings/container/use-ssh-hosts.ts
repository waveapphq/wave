/**
 * useSshHosts Hook (REQ-4.5.14)
 *
 * Drives the SSH Hosts page: reads on activation while clean, stages the policy,
 * additions and removals, and writes them as one change set on Save.
 */

import { useCallback, useMemo, useState } from 'react'
import { useFailureToast } from '@/hooks/use-failure-toast'
import {
  DEFAULT_HOST_KEY_POLICY,
  fetchSshHosts,
  saveSshHosts,
  type HostKeyPolicy,
  type NewTrustedHost,
  type NewTrustedHostEntry,
  type SshHostsChange,
  type SshHostsView,
  type StagedTrustedHost,
  type TrustedHost,
} from '@/features/settings/api/ssh-hosts'
import {
  useActivationRead,
  type PageReadStatus,
} from '@/features/settings/container/use-activation-read'
import { useSshHostPolicyStore } from '@/stores/ssh-host-policy-store'

export interface UseSshHostsResult {
  status: PageReadStatus
  error?: string
  policy: HostKeyPolicy
  hosts: StagedTrustedHost[]
  dirty: boolean
  saving: boolean
  setPolicy: (next: HostKeyPolicy) => void
  addHosts: (entries: NewTrustedHostEntry[]) => void
  removeHosts: (ids: string[]) => void
  cancel: () => void
  save: () => void
  retry: () => void
}

const NO_HOSTS: TrustedHost[] = []
const NO_ADDITIONS: StagedAddition[] = []
const NO_IDS: ReadonlySet<string> = new Set()

type StagedAddition = NewTrustedHostEntry & { id: string; added: null; staged: true }

// Module-wide so ids stay unique across hook instances; a counter also works over plain LAN http.
let stagedCounter = 0

function nextStagedId(): string {
  stagedCounter += 1
  return `staged-${stagedCounter}`
}

/** Code-point order, as the backend sorts; ties keep their order. */
function byHost(a: StagedTrustedHost, b: StagedTrustedHost): number {
  if (a.host === b.host) return 0
  return a.host < b.host ? -1 : 1
}

function toWire({ host, port, key_type, key }: StagedAddition): NewTrustedHost {
  return { host, port, key_type, key }
}

/** Only the policy fields that differ from the saved ones, or undefined when none do. */
function policyChange(saved: HostKeyPolicy, staged: HostKeyPolicy): Partial<HostKeyPolicy> | undefined {
  const change: Partial<HostKeyPolicy> = {}
  if (staged.lock_trusted_hosts !== saved.lock_trusted_hosts) {
    change.lock_trusted_hosts = staged.lock_trusted_hosts
  }
  if (staged.default_block_action !== saved.default_block_action) {
    change.default_block_action = staged.default_block_action
  }
  return Object.keys(change).length > 0 ? change : undefined
}

export function useSshHosts(active: boolean): UseSshHostsResult {
  const { report } = useFailureToast('Could Not Save SSH Hosts')

  const [saved, setSaved] = useState<SshHostsView | undefined>()
  const [stagedPolicy, setStagedPolicy] = useState<HostKeyPolicy | undefined>()
  const [additions, setAdditions] = useState<StagedAddition[]>(NO_ADDITIONS)
  const [removed, setRemoved] = useState<ReadonlySet<string>>(NO_IDS)
  const [saving, setSaving] = useState(false)

  const savedHosts = saved?.hosts ?? NO_HOSTS
  const savedPolicy = saved?.policy ?? DEFAULT_HOST_KEY_POLICY
  const policy = stagedPolicy ?? savedPolicy
  const dirty =
    policyChange(savedPolicy, policy) !== undefined || additions.length > 0 || removed.size > 0

  const savedIds = useMemo(() => new Set(savedHosts.map((row) => row.id)), [savedHosts])

  const hosts = useMemo(() => {
    const kept: StagedTrustedHost[] = savedHosts.filter((row) => !removed.has(row.id))
    return [...kept, ...additions].sort(byHost)
  }, [savedHosts, additions, removed])

  const applyView = useCallback((view: SshHostsView) => {
    setSaved(view)
    setStagedPolicy(undefined)
    setAdditions(NO_ADDITIONS)
    setRemoved(NO_IDS)
  }, [])

  const { status, error, retry } = useActivationRead(active, dirty, fetchSshHosts, applyView)

  const addHosts = useCallback((entries: NewTrustedHostEntry[]) => {
    const rows = entries.map((entry): StagedAddition => ({
      ...entry,
      id: nextStagedId(),
      added: null,
      staged: true,
    }))
    setAdditions((prev) => [...prev, ...rows])
  }, [])

  const removeHosts = useCallback(
    (ids: string[]) => {
      const targets = new Set(ids)
      setAdditions((prev) => prev.filter((row) => !targets.has(row.id)))
      setRemoved((prev) => new Set([...prev, ...ids.filter((id) => savedIds.has(id))]))
    },
    [savedIds],
  )

  const cancel = useCallback(() => {
    setStagedPolicy(undefined)
    setAdditions(NO_ADDITIONS)
    setRemoved(NO_IDS)
  }, [])

  const save = useCallback(() => {
    const change: SshHostsChange = { add: additions.map(toWire), remove: [...removed] }
    const changedPolicy = policyChange(savedPolicy, policy)
    if (changedPolicy) change.policy = changedPolicy
    setSaving(true)
    saveSshHosts(change).then(
      (view) => {
        setSaving(false)
        applyView(view)
        useSshHostPolicyStore.getState().set(view.policy)
      },
      (err: unknown) => {
        setSaving(false)
        report(err)
      },
    )
  }, [additions, removed, savedPolicy, policy, applyView, report])

  return {
    status,
    error,
    policy,
    hosts,
    dirty,
    saving,
    setPolicy: setStagedPolicy,
    addHosts,
    removeHosts,
    cancel,
    save,
    retry,
  }
}
