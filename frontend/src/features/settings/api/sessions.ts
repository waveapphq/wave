/**
 * WAVE Server API Client
 *
 * Server facts (frontend + backend) plus the browser-session roster and admin
 * disconnect endpoints. Plain payloads (rawResponse); apiClient errors propagate
 * unchanged (these endpoints are not admin-gated).
 */

import { apiClient } from '@/lib/api'

// ============================================================================
// Types
// ============================================================================

export interface ServerFacts {
  running: boolean
  urls: string[]
  port: number
  bind: string
}

export interface BrowserSession {
  session_id: string
  client: string
  ip: string
  connected_at: string
  last_activity: string
}

export interface ServerStatus {
  frontend: ServerFacts
  backend: ServerFacts
  session_count: number
  sessions: BrowserSession[]
  /** The person holder currently editing the shared Workbench, or null. */
  active_session_id: string | null
  /** Sessions currently mirroring the shared Workbench read-only. */
  watching_session_ids: string[]
  /** Absolute path of the data folder WAVE runs on (REQ-4.7.13). */
  data_folder: string
  /** Absolute path of the config file WAVE runs on (REQ-4.7.15). */
  config_file: string
}

// ============================================================================
// API Functions
// ============================================================================

export async function fetchServerStatus(): Promise<ServerStatus> {
  const response = await apiClient.get<ServerStatus>('/server/status', { rawResponse: true })
  return response.data
}

export async function disconnectSession(sessionId: string): Promise<void> {
  await apiClient.delete(`/server/sessions/${sessionId}`, undefined, { rawResponse: true })
}

export async function disconnectOthers(requesterId: string): Promise<{ disconnected: number }> {
  const response = await apiClient.post<{ disconnected: number }>(
    '/server/sessions/disconnect-others',
    { requester_session_id: requesterId },
    { rawResponse: true },
  )
  return response.data
}

export async function disconnectAll(): Promise<{ disconnected: number }> {
  const response = await apiClient.post<{ disconnected: number }>(
    '/server/sessions/disconnect-all',
    {},
    { rawResponse: true },
  )
  return response.data
}
