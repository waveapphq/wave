/**
 * Workbench Ownership API Client - REQ-5.2.7.15/.16
 *
 * Thin client for the single-active-session editing lock: claim, heartbeat,
 * release, and the take-over protocol. Draft mirroring itself travels over
 * WebSocket, not REST.
 */

import { apiClient } from '@/lib/api'

// ===========================================================================
// Types
// ===========================================================================

export interface OwnershipHolder {
  id: string
  label: string
  kind: 'person' | 'mcp'
}

export interface MirroredRunWire {
  session_id: string
  test_id: string
  test_name: string
  environment_id: string | null
  environment_name: string | null
  status: string
}

export interface MirroredRun {
  sessionId: string
  testId: string
  testName: string
  environmentId: string | null
  environmentName: string | null
  status: string
}

export interface Ownership {
  holder: OwnershipHolder | null
  watchers: number
  pending_takeover: { requester_label: string } | null
  run?: MirroredRunWire | null
  you_are_holder?: boolean
  mcp_session_id?: string | null
  browser_session_id?: string | null
}

export interface TakeoverOutcome extends Ownership {
  outcome: 'granted' | 'awaiting_approval' | 'awaiting_release' | 'denied'
}

// ===========================================================================
// Methods
// ===========================================================================

async function getOwnership(holderId?: string): Promise<Ownership> {
  const query = holderId ? `?holder_id=${encodeURIComponent(holderId)}` : ''
  const response = await apiClient.get<Ownership>(`/workbench/ownership${query}`)
  return response.data
}

async function claim(holderId: string, holderLabel: string): Promise<Ownership> {
  const response = await apiClient.post<Ownership>('/workbench/ownership/claim', {
    holder_id: holderId,
    holder_label: holderLabel,
  })
  return response.data
}

async function heartbeat(holderId: string): Promise<void> {
  await apiClient.post('/workbench/ownership/heartbeat', { holder_id: holderId })
}

async function release(holderId: string): Promise<void> {
  await apiClient.post('/workbench/ownership/release', { holder_id: holderId })
}

async function requestTakeover(
  requesterId: string,
  requesterLabel: string,
): Promise<TakeoverOutcome> {
  const response = await apiClient.post<TakeoverOutcome>('/workbench/ownership/takeover', {
    requester_id: requesterId,
    requester_label: requesterLabel,
  })
  return response.data
}

async function approveTakeover(holderId: string): Promise<Ownership> {
  const response = await apiClient.post<Ownership>('/workbench/ownership/takeover/approve', {
    holder_id: holderId,
  })
  return response.data
}

async function denyTakeover(holderId: string): Promise<Ownership> {
  const response = await apiClient.post<Ownership>('/workbench/ownership/takeover/deny', {
    holder_id: holderId,
  })
  return response.data
}

async function forceTakeover(requesterId: string, requesterLabel: string): Promise<Ownership> {
  const response = await apiClient.post<Ownership>('/workbench/ownership/takeover/force', {
    requester_id: requesterId,
    requester_label: requesterLabel,
  })
  return response.data
}

async function cancelTakeover(requesterId: string): Promise<Ownership> {
  const response = await apiClient.post<Ownership>('/workbench/ownership/takeover/cancel', {
    requester_id: requesterId,
  })
  return response.data
}

/** True when a rejection is the documented 409 answer: another session already holds the slot. */
export function isHeldByAnother(error: unknown): boolean {
  return (error as { status?: number }).status === 409
}

export const ownershipApi = {
  getOwnership,
  claim,
  heartbeat,
  release,
  requestTakeover,
  approveTakeover,
  denyTakeover,
  forceTakeover,
  cancelTakeover,
}
