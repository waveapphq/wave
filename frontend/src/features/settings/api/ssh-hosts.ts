/**
 * SSH Hosts API Client (REQ-4.5.14)
 *
 * WAVE's trusted SSH hosts list and host key policy. Every write is the one
 * PATCH change set; parse and detect write nothing. Plain payloads
 * (rawResponse); apiClient errors propagate unchanged.
 */

import { apiClient } from '@/lib/api'

// ============================================================================
// Types
// ============================================================================

export type HostKeyAction = 'strict' | 'accept-new' | 'disabled'

export type HostKeyType = 'ED25519' | 'ECDSA' | 'RSA'

export interface HostKeyPolicy {
  lock_trusted_hosts: boolean
  default_block_action: HostKeyAction
}

/** The policy the frontend holds until a read answers; equals the backend default. */
export const DEFAULT_HOST_KEY_POLICY: HostKeyPolicy = {
  lock_trusted_hosts: false,
  default_block_action: 'disabled',
}

export interface TrustedHost {
  id: string
  host: string
  port: number
  key_type: HostKeyType
  /** "SHA256:" followed by unpadded base64. */
  fingerprint: string
  /** ISO-8601 UTC. */
  added: string
}

export interface SshHostsView {
  policy: HostKeyPolicy
  hosts: TrustedHost[]
}

export interface NewTrustedHost {
  host: string
  port: number
  key_type: HostKeyType
  /** OpenSSH public key text: "<algorithm> <base64>". */
  key: string
}

/** A host the Add Hosts dialog hands to the page: the wire entry plus the fingerprint it showed. */
export type NewTrustedHostEntry = NewTrustedHost & { fingerprint: string }

/** A row of the SSH Hosts page: a saved host, or a staged addition (`added` null until Save). */
export type StagedTrustedHost = Omit<TrustedHost, 'added'> & {
  added: string | null
  staged?: true
  key?: string
}

export interface ParsedHostLine {
  host_names: string[]
  port: number
  key_type: HostKeyType
  key: string
  fingerprint: string
}

export interface HostLineError {
  line: number
  message: string
}

export interface HostLinesParse {
  entries: ParsedHostLine[]
  errors: HostLineError[]
}

export interface DetectedHostKey {
  host: string
  port: number
  key_type: HostKeyType
  key: string
  fingerprint: string
}

export interface SshHostsChange {
  policy?: Partial<HostKeyPolicy>
  add: NewTrustedHost[]
  remove: string[]
}

// ============================================================================
// API Functions
// ============================================================================

export async function fetchSshHosts(): Promise<SshHostsView> {
  const response = await apiClient.get<SshHostsView>('/network/ssh-hosts', { rawResponse: true })
  return response.data
}

export async function fetchHostKeyPolicy(): Promise<HostKeyPolicy> {
  const response = await apiClient.get<HostKeyPolicy>('/network/ssh-hosts/policy', {
    rawResponse: true,
  })
  return response.data
}

export async function saveSshHosts(change: SshHostsChange): Promise<SshHostsView> {
  const response = await apiClient.patch<SshHostsView>('/network/ssh-hosts', change, {
    rawResponse: true,
  })
  return response.data
}

export async function parseHostLines(text: string): Promise<HostLinesParse> {
  const response = await apiClient.post<HostLinesParse>(
    '/network/ssh-hosts/parse',
    { text },
    { rawResponse: true },
  )
  return response.data
}

export async function detectHostKeys(host: string, port: number): Promise<DetectedHostKey[]> {
  const response = await apiClient.post<{ entries: DetectedHostKey[] }>(
    '/network/ssh-hosts/detect',
    { host, port },
    { rawResponse: true },
  )
  return response.data.entries
}
