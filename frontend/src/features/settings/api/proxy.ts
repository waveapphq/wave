/**
 * Proxy API Client (REQ-4.7.14, REQ-3.4.2.10)
 *
 * The proxy WAVE uses for web requests made from the WAVE host, and the blocks
 * that follow it. A save is one PATCH with the changed fields; the check writes
 * nothing. Plain payloads (rawResponse); apiClient errors propagate unchanged.
 */

import { apiClient } from '@/lib/api'

// ============================================================================
// Types
// ============================================================================

export interface ProxyEntry {
  kind: 'exact' | 'regex'
  address: string
}

export interface ProxySettings {
  enabled: boolean
  source: 'host' | 'custom'
  host: string
  port: number | null
  username: string
  password_set: boolean
  list_mode: 'except' | 'only'
  entries: ProxyEntry[]
  proxy_local_addresses: boolean
  /** The WAVE host's own proxy variables; a password inside a value arrives masked. */
  host_values: {
    https_proxy: string | null
    http_proxy: string | null
    no_proxy: string | null
  }
}

/** A password left out is unchanged; an empty one removes the stored password. */
export type ProxySettingsUpdate = Partial<{
  enabled: boolean
  source: 'host' | 'custom'
  host: string
  /** The number wire form: a JS number when exact, else its digit text (REQ-3.1.3.14). */
  port: number | string | null
  username: string
  password: string
  list_mode: 'except' | 'only'
  entries: ProxyEntry[]
  proxy_local_addresses: boolean
}>

export interface ProxyProblem {
  field: keyof ProxySettingsUpdate
  /** The entry number, counted from 1, for a problem of one list entry. */
  row: number | null
  message: string
}

export interface ProxyProblems {
  problems: ProxyProblem[]
}

export interface BlockRef {
  id: string
  name: string
  category: string
}

export interface ProxyBlocks {
  supported: BlockRef[]
  unsupported: BlockRef[]
  not_applicable: BlockRef[]
}

// ============================================================================
// API Functions
// ============================================================================

export async function fetchProxySettings(): Promise<ProxySettings> {
  const response = await apiClient.get<ProxySettings>('/network/proxy', { rawResponse: true })
  return response.data
}

export async function updateProxySettings(update: ProxySettingsUpdate): Promise<ProxySettings> {
  const response = await apiClient.patch<ProxySettings>('/network/proxy', update, {
    rawResponse: true,
  })
  return response.data
}

export async function validateProxySettings(update: ProxySettingsUpdate): Promise<ProxyProblems> {
  const response = await apiClient.post<ProxyProblems>('/network/proxy/validate', update, {
    rawResponse: true,
  })
  return response.data
}

export async function fetchProxyBlocks(): Promise<ProxyBlocks> {
  const response = await apiClient.get<ProxyBlocks>('/network/proxy/blocks', { rawResponse: true })
  return response.data
}
