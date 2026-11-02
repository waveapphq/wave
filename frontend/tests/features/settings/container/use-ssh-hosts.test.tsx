/**
 * useSshHosts Hook Tests
 *
 * REQ-4.5.14: the SSH Hosts page state - read on
 * activation, staged policy / additions / removals, one change set on Save, Cancel.
 *
 * Module under test: frontend/src/features/settings/container/use-ssh-hosts.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

// Every request is replaced; the hook and the store take the real default policy constant.
vi.mock('@/features/settings/api/ssh-hosts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/api/ssh-hosts')>()),
  fetchSshHosts: vi.fn(),
  fetchHostKeyPolicy: vi.fn(),
  saveSshHosts: vi.fn(),
  parseHostLines: vi.fn(),
  detectHostKeys: vi.fn(),
}))

import {
  DEFAULT_HOST_KEY_POLICY,
  fetchSshHosts,
  saveSshHosts,
  type HostKeyPolicy,
  type NewTrustedHost,
  type SshHostsView,
  type TrustedHost,
} from '@/features/settings/api/ssh-hosts'
import { useSshHosts } from '@/features/settings/container/use-ssh-hosts'
import { useSshHostPolicyStore } from '@/stores/ssh-host-policy-store'

const mockFetchSshHosts = vi.mocked(fetchSshHosts)
const mockSaveSshHosts = vi.mocked(saveSshHosts)

// ============================================================================
// Fixtures
// ============================================================================

/** What the Add Hosts dialog hands over: the wire entry plus the fingerprint it showed. */
type DialogEntry = NewTrustedHost & { fingerprint: string }

const SAVED_POLICY: HostKeyPolicy = { lock_trusted_hosts: false, default_block_action: 'accept-new' }

const HOST_DB1: TrustedHost = {
  id: 'host-db1',
  host: 'db1',
  port: 22,
  key_type: 'ED25519',
  fingerprint: 'SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8',
  added: '2026-09-28T09:15:00Z',
}

const HOST_WEB: TrustedHost = {
  id: 'host-web',
  host: 'web-01.lab.internal',
  port: 2222,
  key_type: 'RSA',
  fingerprint: 'SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM',
  added: '2026-09-29T14:02:00Z',
}

const SAVED_VIEW: SshHostsView = { policy: SAVED_POLICY, hosts: [HOST_DB1, HOST_WEB] }

const NEW_CI: DialogEntry = {
  host: 'ci-02.lab.internal',
  port: 22,
  key_type: 'ED25519',
  key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  fingerprint: 'SHA256:4x0wPZ1Vh1o9xZQb0m3N0nQ2l3eC7yK5uXvR8sT2aBc',
}

const NEW_APP: DialogEntry = {
  host: 'app-01',
  port: 22,
  key_type: 'ECDSA',
  key: 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=',
  fingerprint: 'SHA256:9w8Yb2c1kRzv0QhT4mN6pLx3sD7eF5gH1jK2lM0nO9p',
}

const NEW_DB1_CONFLICT: DialogEntry = {
  host: 'db1',
  port: 22,
  key_type: 'ED25519',
  key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKtjP3h0Bq1Y3yJ5n4Rzv8m2t0LQ9kq6dHc8W1s3fG7a',
  fingerprint: 'SHA256:Qe3r5T7y9U1i3O5p7A9s1D3f5G7h9J1k3L5z7X9c1V3',
}

const CONFLICT_MESSAGE =
  'db1 port 22 already has a trusted ED25519 key; remove it before adding another'

const READ_FAILURE =
  "WAVE's trusted SSH hosts list /srv/wave/data/network/ssh_hosts.yaml cannot be read: [Errno 13] Permission denied"

function wire(entry: DialogEntry): NewTrustedHost {
  return { host: entry.host, port: entry.port, key_type: entry.key_type, key: entry.key }
}

function apiError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ============================================================================
// Utilities
// ============================================================================

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function renderSshHosts(active: boolean) {
  return renderHook(({ active: isActive }: { active: boolean }) => useSshHosts(isActive), {
    initialProps: { active },
  })
}

async function renderLoaded() {
  const view = renderSshHosts(true)
  await flush()
  expect(view.result.current.status).toBe('loaded')
  return view
}

function hostNames(hosts: { host: string }[]): string[] {
  return hosts.map((row) => row.host)
}

function resetPolicyStore() {
  act(() => {
    useSshHostPolicyStore.setState({
      defaultBlockAction: 'disabled',
      locked: false,
      loadError: undefined,
    })
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('useSshHosts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchSshHosts.mockResolvedValue(SAVED_VIEW)
    mockSaveSshHosts.mockResolvedValue(SAVED_VIEW)
  })

  afterEach(() => {
    resetPolicyStore()
  })

  describe('read', () => {
    it('does not read while the page is inactive', async () => {
      const { result } = renderSshHosts(false)
      await flush()

      expect(mockFetchSshHosts).not.toHaveBeenCalled()
      expect(result.current.status).toBe('pending')
    })

    it('is pending while the first read is in flight, then loaded with the saved state', async () => {
      const read = deferred<SshHostsView>()
      mockFetchSshHosts.mockReturnValueOnce(read.promise)

      const { result } = renderSshHosts(true)
      await flush()
      expect(mockFetchSshHosts).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('pending')

      await act(async () => {
        read.resolve(SAVED_VIEW)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.policy).toEqual(SAVED_POLICY)
      expect(result.current.hosts).toEqual([HOST_DB1, HOST_WEB])
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)
    })

    it('reads once the page turns active', async () => {
      const view = renderSshHosts(false)
      await flush()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchSshHosts).toHaveBeenCalledTimes(1)
      expect(view.result.current.status).toBe('loaded')
    })

    it('does not read again while the page stays active', async () => {
      const view = await renderLoaded()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchSshHosts).toHaveBeenCalledTimes(1)
    })

    it('is failed with the API message when the read fails', async () => {
      mockFetchSshHosts.mockRejectedValueOnce(apiError(READ_FAILURE, 500))

      const { result } = renderSshHosts(true)
      await flush()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe(READ_FAILURE)
    })

    it('retry reads again: pending, then loaded', async () => {
      mockFetchSshHosts.mockRejectedValueOnce(apiError(READ_FAILURE, 500))
      const { result } = renderSshHosts(true)
      await flush()
      expect(result.current.status).toBe('failed')

      const read = deferred<SshHostsView>()
      mockFetchSshHosts.mockReturnValueOnce(read.promise)
      act(() => {
        result.current.retry()
      })
      await flush()
      expect(mockFetchSshHosts).toHaveBeenCalledTimes(2)
      expect(result.current.status).toBe('pending')

      await act(async () => {
        read.resolve(SAVED_VIEW)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.hosts).toEqual([HOST_DB1, HOST_WEB])
    })

    it('reads again when a clean page turns active again', async () => {
      const view = await renderLoaded()
      const refreshed: SshHostsView = { policy: SAVED_POLICY, hosts: [HOST_DB1] }
      mockFetchSshHosts.mockResolvedValueOnce(refreshed)

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchSshHosts).toHaveBeenCalledTimes(2)
      expect(view.result.current.hosts).toEqual([HOST_DB1])
    })

    it('keeps the staged state and does not read when a dirty page turns active again', async () => {
      const view = await renderLoaded()
      act(() => {
        view.result.current.addHosts([NEW_CI])
        view.result.current.removeHosts([HOST_WEB.id])
      })

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchSshHosts).toHaveBeenCalledTimes(1)
      expect(view.result.current.dirty).toBe(true)
      expect(hostNames(view.result.current.hosts)).toEqual(['ci-02.lab.internal', 'db1'])
    })
  })

  describe('default policy before a read lands', () => {
    it('holds DEFAULT_HOST_KEY_POLICY until the first read lands', async () => {
      const read = deferred<SshHostsView>()
      mockFetchSshHosts.mockReturnValueOnce(read.promise)

      const { result } = renderSshHosts(true)
      await flush()

      expect(result.current.status).toBe('pending')
      expect(result.current.policy).toBe(DEFAULT_HOST_KEY_POLICY)
      expect(result.current.dirty).toBe(false)

      await act(async () => {
        read.resolve(SAVED_VIEW)
      })
      await flush()

      expect(result.current.policy).toEqual(SAVED_POLICY)
    })

    it('holds Disabled, unlocked, while the page is inactive', async () => {
      const { result } = renderSshHosts(false)
      await flush()

      expect(result.current.policy).toEqual({
        lock_trusted_hosts: false,
        default_block_action: 'disabled',
      })
      expect(result.current.dirty).toBe(false)
    })

    it('keeps Disabled, unlocked, when the first read fails', async () => {
      mockFetchSshHosts.mockRejectedValueOnce(apiError(READ_FAILURE, 500))

      const { result } = renderSshHosts(true)
      await flush()

      expect(result.current.status).toBe('failed')
      expect(result.current.policy).toEqual({
        lock_trusted_hosts: false,
        default_block_action: 'disabled',
      })
      expect(result.current.dirty).toBe(false)
    })
  })

  describe('staged view', () => {
    it('sorts the saved hosts by host', async () => {
      mockFetchSshHosts.mockResolvedValueOnce({ policy: SAVED_POLICY, hosts: [HOST_WEB, HOST_DB1] })

      const { result } = await renderLoaded()

      expect(result.current.hosts).toEqual([HOST_DB1, HOST_WEB])
    })

    it('shows staged additions in host order as unsaved rows and marks the page dirty', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.addHosts([NEW_CI, NEW_APP])
      })

      expect(hostNames(result.current.hosts)).toEqual([
        'app-01',
        'ci-02.lab.internal',
        'db1',
        'web-01.lab.internal',
      ])
      const [app, ci] = result.current.hosts
      expect(ci).toEqual({
        ...NEW_CI,
        id: expect.stringMatching(/^staged-\d+$/),
        added: null,
        staged: true,
      })
      expect(app).toEqual({
        ...NEW_APP,
        id: expect.stringMatching(/^staged-\d+$/),
        added: null,
        staged: true,
      })
      expect(result.current.dirty).toBe(true)
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    })

    it('numbers staged ids from one module counter, never crypto.randomUUID', async () => {
      const randomUUID = vi.spyOn(crypto, 'randomUUID')
      const first = await renderLoaded()

      act(() => {
        first.result.current.addHosts([NEW_CI, NEW_APP])
      })
      act(() => {
        first.result.current.addHosts([NEW_DB1_CONFLICT])
      })

      const idOf = (host: string, port: number, key: string) =>
        first.result.current.hosts.find(
          (row) => row.host === host && row.port === port && row.key === key,
        )?.id ?? ''
      const ciId = idOf(NEW_CI.host, NEW_CI.port, NEW_CI.key)
      const n = Number(/^staged-(\d+)$/.exec(ciId)?.[1])
      expect(Number.isInteger(n)).toBe(true)
      expect(idOf(NEW_APP.host, NEW_APP.port, NEW_APP.key)).toBe(`staged-${n + 1}`)
      expect(idOf(NEW_DB1_CONFLICT.host, NEW_DB1_CONFLICT.port, NEW_DB1_CONFLICT.key)).toBe(
        `staged-${n + 2}`,
      )

      const second = await renderLoaded()
      act(() => {
        second.result.current.addHosts([NEW_CI])
      })
      const secondStaged = second.result.current.hosts.find((row) => row.staged)
      expect(secondStaged?.id).toBe(`staged-${n + 3}`)

      expect(randomUUID).not.toHaveBeenCalled()
      randomUUID.mockRestore()
    })

    it('removes a saved row from the view and marks the page dirty', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.removeHosts([HOST_DB1.id])
      })

      expect(result.current.hosts).toEqual([HOST_WEB])
      expect(result.current.dirty).toBe(true)
    })

    it('removes several rows at once', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.removeHosts([HOST_DB1.id, HOST_WEB.id])
      })

      expect(result.current.hosts).toEqual([])
      expect(result.current.dirty).toBe(true)
    })

    it('removing a staged row drops the addition and leaves the page clean when nothing else changed', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.addHosts([NEW_CI])
      })
      const stagedId = result.current.hosts.find((row) => row.staged)?.id ?? ''

      act(() => {
        result.current.removeHosts([stagedId])
      })

      expect(result.current.hosts).toEqual([HOST_DB1, HOST_WEB])
      expect(result.current.dirty).toBe(false)
    })

    it('setPolicy stages the policy and marks the page dirty', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.setPolicy({ lock_trusted_hosts: true, default_block_action: 'strict' })
      })

      expect(result.current.policy).toEqual({ lock_trusted_hosts: true, default_block_action: 'strict' })
      expect(result.current.dirty).toBe(true)
    })

    it('is clean again when the staged policy returns to the saved values', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPolicy({ lock_trusted_hosts: true, default_block_action: 'strict' })
      })

      act(() => {
        result.current.setPolicy({ ...SAVED_POLICY })
      })

      expect(result.current.policy).toEqual(SAVED_POLICY)
      expect(result.current.dirty).toBe(false)
    })
  })

  describe('save', () => {
    it('sends one change set with only the differing policy field, the additions and the removed saved ids', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPolicy({ lock_trusted_hosts: false, default_block_action: 'strict' })
        result.current.addHosts([NEW_CI, NEW_APP])
      })
      const appId = result.current.hosts.find((row) => row.host === NEW_APP.host)?.id ?? ''
      act(() => {
        result.current.removeHosts([HOST_DB1.id, appId])
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockSaveSshHosts).toHaveBeenCalledTimes(1)
      expect(mockSaveSshHosts.mock.calls[0][0]).toStrictEqual({
        policy: { default_block_action: 'strict' },
        add: [wire(NEW_CI)],
        remove: [HOST_DB1.id],
      })
    })

    it('sends both policy fields when both differ', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPolicy({ lock_trusted_hosts: true, default_block_action: 'strict' })
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockSaveSshHosts.mock.calls[0][0]).toStrictEqual({
        policy: { lock_trusted_hosts: true, default_block_action: 'strict' },
        add: [],
        remove: [],
      })
    })

    it('leaves the policy out when it is unchanged', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.addHosts([NEW_APP, NEW_CI])
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockSaveSshHosts.mock.calls[0][0]).toStrictEqual({
        add: [wire(NEW_APP), wire(NEW_CI)],
        remove: [],
      })
    })

    it('is saving while the request is in flight', async () => {
      const write = deferred<SshHostsView>()
      mockSaveSshHosts.mockReturnValueOnce(write.promise)
      const { result } = await renderLoaded()
      act(() => {
        result.current.addHosts([NEW_CI])
      })

      await act(async () => {
        result.current.save()
      })
      expect(result.current.saving).toBe(true)

      await act(async () => {
        write.resolve(SAVED_VIEW)
      })
      await flush()

      expect(result.current.saving).toBe(false)
    })

    it('makes the response the new baseline, clears the staged state and refreshes the policy store', async () => {
      const response: SshHostsView = {
        policy: { lock_trusted_hosts: true, default_block_action: 'strict' },
        hosts: [
          HOST_DB1,
          {
            id: 'host-ci',
            host: NEW_CI.host,
            port: NEW_CI.port,
            key_type: NEW_CI.key_type,
            fingerprint: NEW_CI.fingerprint,
            added: '2026-10-02T10:30:00Z',
          },
        ],
      }
      mockSaveSshHosts.mockResolvedValueOnce(response)
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPolicy({ lock_trusted_hosts: true, default_block_action: 'strict' })
        result.current.addHosts([NEW_CI])
        result.current.removeHosts([HOST_WEB.id])
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(false)
      expect(result.current.policy).toEqual(response.policy)
      expect(result.current.hosts).toEqual([response.hosts[1], HOST_DB1])
      expect(result.current.hosts.some((row) => row.staged)).toBe(false)
      expect(useSshHostPolicyStore.getState().defaultBlockAction).toBe('strict')
      expect(useSshHostPolicyStore.getState().locked).toBe(true)
      expect(toastError).not.toHaveBeenCalled()

      act(() => {
        result.current.cancel()
      })
      expect(result.current.policy).toEqual(response.policy)
      expect(result.current.hosts).toEqual([response.hosts[1], HOST_DB1])
    })

    it('on a 409 shows the failure toast with the exact message and keeps the staged state', async () => {
      mockSaveSshHosts.mockRejectedValueOnce(apiError(CONFLICT_MESSAGE, 409))
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPolicy({ lock_trusted_hosts: true, default_block_action: 'strict' })
        result.current.addHosts([NEW_DB1_CONFLICT])
        result.current.removeHosts([HOST_WEB.id])
      })
      const stagedBefore = result.current.hosts

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith(CONFLICT_MESSAGE, 'Could Not Save SSH Hosts')
      expect(result.current.status).toBe('loaded')
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(true)
      expect(result.current.policy).toEqual({ lock_trusted_hosts: true, default_block_action: 'strict' })
      expect(result.current.hosts).toEqual(stagedBefore)
      expect(hostNames(result.current.hosts)).toEqual(['db1', 'db1'])
      expect(useSshHostPolicyStore.getState().defaultBlockAction).toBe('disabled')
      expect(useSshHostPolicyStore.getState().locked).toBe(false)
      expect(mockFetchSshHosts).toHaveBeenCalledTimes(1)
    })

    it('sends the same change set again on the next Save after a failure', async () => {
      mockSaveSshHosts.mockRejectedValueOnce(apiError(CONFLICT_MESSAGE, 409))
      const { result } = await renderLoaded()
      act(() => {
        result.current.addHosts([NEW_CI])
      })
      await act(async () => {
        result.current.save()
      })
      await flush()

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockSaveSshHosts).toHaveBeenCalledTimes(2)
      expect(mockSaveSshHosts.mock.calls[1][0]).toStrictEqual(mockSaveSshHosts.mock.calls[0][0])
      expect(result.current.dirty).toBe(false)
    })
  })

  describe('cancel', () => {
    it('restores the saved policy and hosts', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPolicy({ lock_trusted_hosts: true, default_block_action: 'disabled' })
        result.current.addHosts([NEW_CI])
        result.current.removeHosts([HOST_DB1.id])
      })

      act(() => {
        result.current.cancel()
      })

      expect(result.current.policy).toEqual(SAVED_POLICY)
      expect(result.current.hosts).toEqual([HOST_DB1, HOST_WEB])
      expect(result.current.dirty).toBe(false)
      expect(mockSaveSshHosts).not.toHaveBeenCalled()
    })
  })
})
