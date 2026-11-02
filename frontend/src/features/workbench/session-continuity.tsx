/**
 * App-scoped session continuity - REQ-5.2.7.15
 *
 * This tab's part in the shared workbench session belongs to the tab, not to
 * the Workbench screen: liveness is asserted from any route, departure is
 * announced on exit, and a held session resumes after a reload.
 */

import { useEffect } from 'react'
import { isHeldByAnother, ownershipApi } from '@/features/workbench/api/ownership'
import { useToast } from '@/components/ui/toast'
import { getApiBaseUrl } from '@/lib/api'
import { toFailureDetail } from '@/lib/failure-detail'
import { getPageId, getSessionId, getSessionLabel } from '@/lib/session-identity'
import { useWebSocketStore } from '@/features/workbench/stores/websocket-store'
import {
  getPersistedSessionRole,
  useWorkbenchSessionStore,
} from '@/features/workbench/stores/workbench-session-store'
import { alreadyReported } from '@/features/workbench/lib/already-reported'

export const HEARTBEAT_MS = 15000

async function resumeHeldSession(reportFailure: (reason: unknown) => void): Promise<void> {
  const socket = useWebSocketStore.getState()
  try {
    await socket.connect()
    socket.sendFrame({
      type: 'identify',
      holderId: getSessionId(),
      pageId: getPageId(),
      clientType: 'workbench',
    })
    await ownershipApi.claim(getSessionId(), getSessionLabel())
    useWorkbenchSessionStore.getState().setSessionRole({ isHolder: true, isWatching: false })
  } catch (error_) {
    useWorkbenchSessionStore.getState().setSessionRole({ isHolder: false, isWatching: false })
    // A refusal is the server answering that someone else holds it, not a failure.
    if (!isHeldByAnother(error_)) reportFailure(error_)
  }
}

export function SessionContinuity() {
  const isHolder = useWorkbenchSessionStore((state) => state.isHolder)
  const { error: reportError } = useToast()

  useEffect(() => {
    // A reloaded holding tab re-asserts its slot before the reservation lapses.
    if (getPersistedSessionRole().isHolder) {
      resumeHeldSession((reason) => {
        reportError(toFailureDetail(reason).message, 'Workbench Session Not Resumed')
      }).catch(alreadyReported)
    }
    const announceLeave = () => {
      const { isHolder: holding, isWatching } = useWorkbenchSessionStore.getState()
      if (!holding && !isWatching) return
      // The socket frame is delivered in-order before the socket's own close.
      useWebSocketStore.getState().sendFrame({ type: 'leaving', holderId: getSessionId() })
      // Fallback for a dead socket, with no JSON header: a CORS preflight
      // would be aborted by the unload, and the API client is wrong here too.
      // It outlives the unload, so it names this page load, not just the tab.
      void fetch(`${getApiBaseUrl()}/workbench/ownership/leaving`, {
        method: 'POST',
        body: JSON.stringify({ holder_id: getSessionId(), page_id: getPageId() }),
        keepalive: true,
      }).catch(() => undefined)
    }
    globalThis.addEventListener('pagehide', announceLeave)
    return () => globalThis.removeEventListener('pagehide', announceLeave)
  }, [reportError])

  useEffect(() => {
    if (!isHolder) return
    const beat = () => void ownershipApi.heartbeat(getSessionId()).catch(() => undefined)
    beat()
    const timer = setInterval(beat, HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [isHolder])

  return null
}
