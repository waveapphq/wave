/**
 * MCP Server API Client
 *
 * MCP endpoint settings, live status, and administrative session disconnect.
 * Plain payloads (rawResponse); apiClient errors propagate unchanged.
 */

import { apiClient } from '@/lib/api'

// ============================================================================
// Types
// ============================================================================

export type McpBindScope = 'local' | 'network'

export interface McpSettings {
  enabled: boolean
  until_restart_active: boolean
  port: number
  bind: McpBindScope
  auth_enabled: boolean
  auth_username: string
  auth_password_set: boolean
  running: boolean
  /** The port the WAVE API itself is serving on (reserved for the port field). */
  server_port: number
}

/** Partial update; `auth_password` is write-only, `until_restart` is runtime-only. */
export interface McpSettingsUpdate {
  enabled?: boolean
  until_restart?: boolean
  /** The number wire form: a JS number when exact, else its digit text (REQ-3.1.3.14). */
  port?: number | string
  bind?: McpBindScope
  auth_enabled?: boolean
  auth_username?: string
  auth_password?: string
}

export interface McpSession {
  session_id: string
  client: string
  client_version: string
  ip: string
  connected_at: string
  last_activity: string
}

export interface McpActivityEntry {
  timestamp: string
  client: string
  tool: string
}

export interface McpStatus {
  running: boolean
  enabled: boolean
  until_restart_active: boolean
  port: number
  bind: McpBindScope
  /** Every address the endpoint is reachable on (loopback first); empty when stopped. */
  urls: string[]
  connected_clients: number
  sessions: McpSession[]
  recent_activity: McpActivityEntry[]
  last_error: string | null
}

// ============================================================================
// API Functions
// ============================================================================

export async function fetchMcpSettings(): Promise<McpSettings> {
  const response = await apiClient.get<McpSettings>('/mcp/settings', { rawResponse: true })
  return response.data
}

export async function updateMcpSettings(partial: McpSettingsUpdate): Promise<McpSettings> {
  const response = await apiClient.put<McpSettings>('/mcp/settings', partial, {
    rawResponse: true,
  })
  return response.data
}

export async function fetchMcpStatus(): Promise<McpStatus> {
  const response = await apiClient.get<McpStatus>('/mcp/status', { rawResponse: true })
  return response.data
}

export async function disconnectMcpSession(sessionId: string): Promise<void> {
  await apiClient.delete(`/mcp/sessions/${sessionId}`, undefined, { rawResponse: true })
}
