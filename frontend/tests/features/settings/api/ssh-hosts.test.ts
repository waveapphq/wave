/**
 * SSH Hosts API client (REQ-4.5.14, REQ-5.2.1.42).
 *
 * Module: frontend/src/features/settings/api/ssh-hosts.ts
 *
 * Plain payloads (rawResponse) and apiClient errors propagate unchanged, like
 * the MCP client. Every write goes through the one PATCH change set.
 */

import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest'

import type {
  DetectedHostKey,
  HostKeyPolicy,
  HostLinesParse,
  NewTrustedHost,
  SshHostsView,
} from '@/features/settings/api/ssh-hosts'
import {
  DEFAULT_HOST_KEY_POLICY,
  detectHostKeys,
  fetchHostKeyPolicy,
  fetchSshHosts,
  parseHostLines,
  saveSshHosts,
} from '@/features/settings/api/ssh-hosts'
import { apiClient } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getConfig: vi.fn(() => ({ baseUrl: 'http://localhost:8000' })),
  },
  getApiBaseUrl: vi.fn(() => 'http://localhost:8000'),
}))

// ============================================================================
// Fixtures
// ============================================================================

const ED25519_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
const ECDSA_KEY =
  'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg='
const RSA_KEY =
  'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk='

const POLICY: HostKeyPolicy = { lock_trusted_hosts: false, default_block_action: 'accept-new' }

const VIEW: SshHostsView = {
  policy: POLICY,
  hosts: [
    {
      id: 'host-db1-22-ed25519',
      host: 'db1.lab.internal',
      port: 22,
      key_type: 'ED25519',
      fingerprint: 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
      added: '2026-09-30T08:15:00Z',
    },
  ],
}

const NEW_HOST: NewTrustedHost = {
  host: 'ci-02.lab.internal',
  port: 2222,
  key_type: 'ED25519',
  key: ED25519_KEY,
}

const PARSE_RESULT: HostLinesParse = {
  entries: [
    {
      host_names: ['ci-02.lab.internal', '10.0.4.12'],
      port: 2222,
      key_type: 'ED25519',
      key: ED25519_KEY,
      fingerprint: 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
    },
  ],
  errors: [{ line: 3, message: 'not a known_hosts line' }],
}

const DETECTED: DetectedHostKey[] = [
  {
    host: 'ci-02.lab.internal',
    port: 2222,
    key_type: 'ED25519',
    key: ED25519_KEY,
    fingerprint: 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
  },
  {
    host: 'ci-02.lab.internal',
    port: 2222,
    key_type: 'ECDSA',
    key: ECDSA_KEY,
    fingerprint: 'SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM',
  },
  {
    host: 'ci-02.lab.internal',
    port: 2222,
    key_type: 'RSA',
    key: RSA_KEY,
    fingerprint: 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU',
  },
]

function envelope<T>(data: T) {
  return { data, meta: { requestId: '' }, status: 200 }
}

function createMockApiError(status: number, message: string) {
  return Object.assign(new Error(message), {
    type: 'server',
    status,
    isRetryable: false,
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('SSH Hosts API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('DEFAULT_HOST_KEY_POLICY', () => {
    it('is unlocked with the Disabled block action', () => {
      expectTypeOf(DEFAULT_HOST_KEY_POLICY).toEqualTypeOf<HostKeyPolicy>()
      expect(DEFAULT_HOST_KEY_POLICY).toStrictEqual({
        lock_trusted_hosts: false,
        default_block_action: 'disabled',
      })
    })
  })

  describe('fetchSshHosts', () => {
    it('reads the policy and the trusted hosts from GET /network/ssh-hosts', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(envelope(VIEW))

      const result = await fetchSshHosts()

      expect(apiClient.get).toHaveBeenCalledTimes(1)
      expect(apiClient.get).toHaveBeenCalledWith('/network/ssh-hosts', { rawResponse: true })
      expect(result).toEqual(VIEW)
    })

    it('propagates the unreadable-store error unchanged', async () => {
      const apiError = createMockApiError(
        500,
        "WAVE's trusted SSH hosts list /srv/wave/data/network/ssh_hosts.yaml cannot be read: Permission denied",
      )
      vi.mocked(apiClient.get).mockRejectedValue(apiError)

      await expect(fetchSshHosts()).rejects.toBe(apiError)
    })
  })

  describe('fetchHostKeyPolicy', () => {
    it('reads the policy alone from GET /network/ssh-hosts/policy', async () => {
      const locked: HostKeyPolicy = { lock_trusted_hosts: true, default_block_action: 'strict' }
      vi.mocked(apiClient.get).mockResolvedValue(envelope(locked))

      const result = await fetchHostKeyPolicy()

      expect(apiClient.get).toHaveBeenCalledTimes(1)
      expect(apiClient.get).toHaveBeenCalledWith('/network/ssh-hosts/policy', {
        rawResponse: true,
      })
      expect(result).toEqual(locked)
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = createMockApiError(503, 'Service Unavailable')
      vi.mocked(apiClient.get).mockRejectedValue(apiError)

      await expect(fetchHostKeyPolicy()).rejects.toBe(apiError)
    })
  })

  describe('saveSshHosts', () => {
    it('PATCHes the whole change set to /network/ssh-hosts and resolves the saved view', async () => {
      const saved: SshHostsView = {
        policy: { lock_trusted_hosts: true, default_block_action: 'strict' },
        hosts: [],
      }
      vi.mocked(apiClient.patch).mockResolvedValue(envelope(saved))
      const change = {
        policy: { lock_trusted_hosts: true },
        add: [NEW_HOST],
        remove: ['host-db1-22-ed25519'],
      }

      const result = await saveSshHosts(change)

      expect(apiClient.patch).toHaveBeenCalledTimes(1)
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/network/ssh-hosts',
        {
          policy: { lock_trusted_hosts: true },
          add: [NEW_HOST],
          remove: ['host-db1-22-ed25519'],
        },
        { rawResponse: true },
      )
      expect(result).toEqual(saved)
    })

    it('sends no policy key when the change set carries no policy change', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue(envelope(VIEW))

      await saveSshHosts({ add: [], remove: ['host-db1-22-ed25519'] })

      const body = vi.mocked(apiClient.patch).mock.calls[0][1] as Record<string, unknown>
      expect(body).toStrictEqual({ add: [], remove: ['host-db1-22-ed25519'] })
      expect('policy' in body).toBe(false)
    })

    it('passes a partial policy through as given', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue(envelope(VIEW))

      await saveSshHosts({ policy: { default_block_action: 'disabled' }, add: [], remove: [] })

      expect(apiClient.patch).toHaveBeenCalledWith(
        '/network/ssh-hosts',
        { policy: { default_block_action: 'disabled' }, add: [], remove: [] },
        { rawResponse: true },
      )
    })

    it('propagates the key conflict (409) unchanged', async () => {
      const apiError = createMockApiError(
        409,
        'db1.lab.internal port 22 already has a trusted ED25519 key; remove it before adding another',
      )
      vi.mocked(apiClient.patch).mockRejectedValue(apiError)

      await expect(saveSshHosts({ add: [NEW_HOST], remove: [] })).rejects.toBe(apiError)
      await expect(saveSshHosts({ add: [NEW_HOST], remove: [] })).rejects.toThrow(
        /^db1\.lab\.internal port 22 already has a trusted ED25519 key; remove it before adding another$/,
      )
    })

    it('propagates the locked-default refusal (400) unchanged', async () => {
      const apiError = createMockApiError(
        400,
        "Default block action cannot be 'accept-new' while trusted hosts are locked",
      )
      vi.mocked(apiClient.patch).mockRejectedValue(apiError)

      await expect(
        saveSshHosts({
          policy: { lock_trusted_hosts: true, default_block_action: 'accept-new' },
          add: [],
          remove: [],
        }),
      ).rejects.toBe(apiError)
    })
  })

  describe('parseHostLines', () => {
    it('POSTs the pasted text to /network/ssh-hosts/parse and resolves entries and line errors', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(envelope(PARSE_RESULT))
      const text = `[ci-02.lab.internal]:2222,10.0.4.12 ${ED25519_KEY}\n\nHostName ci-02.lab.internal`

      const result = await parseHostLines(text)

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      expect(apiClient.post).toHaveBeenCalledWith(
        '/network/ssh-hosts/parse',
        { text },
        { rawResponse: true },
      )
      expect(result).toEqual(PARSE_RESULT)
    })

    it('sends the text verbatim, keeping blank and comment lines so line numbers match', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(envelope({ entries: [], errors: [] }))
      const text = '# trusted lab hosts\n\n  \n'

      await parseHostLines(text)

      expect(apiClient.post).toHaveBeenCalledWith(
        '/network/ssh-hosts/parse',
        { text: '# trusted lab hosts\n\n  \n' },
        { rawResponse: true },
      )
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = new TypeError('Failed to fetch')
      vi.mocked(apiClient.post).mockRejectedValue(apiError)

      await expect(parseHostLines('db1 ssh-ed25519 AAAA')).rejects.toBe(apiError)
    })
  })

  describe('detectHostKeys', () => {
    it('POSTs host and port to /network/ssh-hosts/detect and resolves the entries array', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(envelope({ entries: DETECTED }))

      const result = await detectHostKeys('ci-02.lab.internal', 2222)

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      expect(apiClient.post).toHaveBeenCalledWith(
        '/network/ssh-hosts/detect',
        { host: 'ci-02.lab.internal', port: 2222 },
        { rawResponse: true },
      )
      expect(result).toEqual(DETECTED)
    })

    it('propagates the unreachable-host error (400) unchanged', async () => {
      const apiError = createMockApiError(
        400,
        'Could not reach ci-02.lab.internal:2222: Connection refused',
      )
      vi.mocked(apiClient.post).mockRejectedValue(apiError)

      await expect(detectHostKeys('ci-02.lab.internal', 2222)).rejects.toBe(apiError)
      await expect(detectHostKeys('ci-02.lab.internal', 2222)).rejects.toThrow(
        /^Could not reach ci-02\.lab\.internal:2222: Connection refused$/,
      )
    })

    it('propagates the timeout error (400) unchanged', async () => {
      const apiError = createMockApiError(
        400,
        'Timed out after 10 seconds reaching ci-02.lab.internal:2222',
      )
      vi.mocked(apiClient.post).mockRejectedValue(apiError)

      await expect(detectHostKeys('ci-02.lab.internal', 2222)).rejects.toBe(apiError)
    })
  })
})
