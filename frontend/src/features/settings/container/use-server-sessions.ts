/**
 * useServerSessions Hook
 *
 * Drives the WAVE Server roster - load on activation, 5s status polling while
 * active (a failed poll keeps the last-known status and reports the failure),
 * and per-row / bulk disconnect mutations that each refetch immediately and
 * toast on failure. The own tab id comes from the shared session identity.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/toast'
import {
  disconnectAll,
  disconnectOthers,
  disconnectSession,
  fetchServerStatus,
  type ServerStatus,
} from '@/features/settings/api/sessions'
import { getSessionId } from '@/lib/session-identity'

const POLL_INTERVAL_MS = 5000
const LOAD_ERROR_FALLBACK = 'Failed to load server status'

export function useServerSessions(active: boolean) {
  const { error: toastError } = useToast()

  const [status, setStatus] = useState<ServerStatus | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const ownSessionId = getSessionId()

  // The last known roster stays on screen, with the failure named beside it.
  const reportReadFailure = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : LOAD_ERROR_FALLBACK)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchServerStatus())
      setError(undefined)
    } catch (err) {
      reportReadFailure(err)
    }
  }, [reportReadFailure])

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setStatus(await fetchServerStatus())
    } catch (err) {
      reportReadFailure(err)
    } finally {
      setLoading(false)
    }
  }, [reportReadFailure])

  // Load on the inactive -> active transition (value-transition ref, not a
  // skip-first-run guard, so StrictMode double-mount stays a single load).
  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (active && !wasActiveRef.current) {
      load().catch(reportReadFailure)
    }
    wasActiveRef.current = active
  }, [active, load, reportReadFailure])

  // 5s status polling while the section is active
  useEffect(() => {
    if (!active) return
    const interval = setInterval(() => {
      refresh().catch(reportReadFailure)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [active, refresh, reportReadFailure])

  const disconnect = useCallback(
    async (sessionId: string) => {
      try {
        await disconnectSession(sessionId)
        await refresh()
      } catch (err) {
        toastError(err instanceof Error ? err.message : 'Failed to disconnect session')
      }
    },
    [refresh, toastError],
  )

  const disconnectOthersAction = useCallback(async () => {
    try {
      await disconnectOthers(ownSessionId)
      await refresh()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to disconnect sessions')
    }
  }, [ownSessionId, refresh, toastError])

  const disconnectAllAction = useCallback(async () => {
    try {
      await disconnectAll()
      await refresh()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to disconnect sessions')
    }
  }, [refresh, toastError])

  return {
    status,
    loading,
    error,
    refresh,
    retry: load,
    disconnect,
    disconnectOthers: disconnectOthersAction,
    disconnectAll: disconnectAllAction,
    ownSessionId,
  }
}
