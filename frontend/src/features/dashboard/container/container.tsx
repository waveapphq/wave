/**
 * Dashboard Container
 *
 * Owns auto-refresh for the Dashboard. Ticks are strictly serial: a new
 * request is only scheduled after the previous one has resolved (success,
 * error, or apiClient-enforced timeout), and the next start time is clamped
 * to `startedAt + POLL_MS` so the effective cadence between request starts
 * stays at POLL_MS even when responses take 1-2 s. A watchdog flips the
 * header pill to "reconnecting" if a request is still in flight at the
 * POLL_MS mark, which is also when apiClient aborts the fetch via its
 * timeout option.
 */

/* v8 ignore next - COV-V8-001 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardPage as DashboardPageComponent } from '@/features/dashboard/page'
import type { DashboardData } from '@/features/dashboard/page'
import { fetchDashboard } from '@/features/dashboard/api/dashboard'
import type { LiveStatus } from '@/features/dashboard/components/last-updated-indicator'

const POLL_MS = 5000

function getIsVisible(): boolean {
  return document.visibilityState !== 'hidden'
}

export function DashboardContainer(): ReactNode {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('live')
  const [isVisible, setIsVisible] = useState<boolean>(getIsVisible)

  const [retryCounter, setRetryCounter] = useState(0)
  const initialLoadDoneRef = useRef(false)

  useEffect(() => {
    const handler = () => setIsVisible(getIsVisible())
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  useEffect(() => {
    if (!isVisible) {
      setLiveStatus('paused')
      return
    }

    let canceled = false
    let nextTickTimer: ReturnType<typeof globalThis.setTimeout> | null = null
    let watchdogTimer: ReturnType<typeof globalThis.setTimeout> | null = null

    const clearWatchdog = () => {
      if (watchdogTimer !== null) {
        globalThis.clearTimeout(watchdogTimer)
        watchdogTimer = null
      }
    }

    const runTick = (): void => {
      const startedAt = Date.now()

      // Next request starts POLL_MS after THIS one started, not after it
      // completed. Fast responses wait; slow/timed-out ones fire the next
      // tick immediately.
      const scheduleNextTick = (): void => {
        const elapsed = Date.now() - startedAt
        const delay = Math.max(0, POLL_MS - elapsed)
        nextTickTimer = globalThis.setTimeout(runTick, delay)
      }

      // Arm the watchdog BEFORE the fetch so the badge flips the moment the
      // request stalls past POLL_MS, not only when the underlying AbortError
      // finally surfaces. The watchdog only fires if it was not cleared -
      // unmount path calls clearWatchdog in cleanup, so the setLiveStatus
      // call here is safe.
      watchdogTimer = globalThis.setTimeout(
        () => setLiveStatus('reconnecting'),
        POLL_MS
      )

      const read = async (): Promise<void> => {
        const nextData = await fetchDashboard({ timeout: POLL_MS })
        if (canceled) return

        clearWatchdog()
        setData(nextData)
        setLiveStatus('live')
        if (!initialLoadDoneRef.current) {
          initialLoadDoneRef.current = true
          setLoading(false)
          setError(null)
        }
        scheduleNextTick()
      }

      // The last good tick stays on screen; a failed refresh names itself
      // beside the data through the header pill.
      read().catch((err: unknown) => {
        if (canceled) return

        clearWatchdog()

        if (!initialLoadDoneRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard')
          setLoading(false)
          initialLoadDoneRef.current = true
          return
        }

        setLiveStatus('reconnecting')
        scheduleNextTick()
      })
    }

    runTick()

    return () => {
      canceled = true
      if (nextTickTimer !== null) globalThis.clearTimeout(nextTickTimer)
      clearWatchdog()
    }
  }, [isVisible, retryCounter])

  const handleRetry = useCallback(() => {
    initialLoadDoneRef.current = false
    setError(null)
    setLoading(true)
    setRetryCounter((c) => c + 1)
  }, [])

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path)
    },
    [navigate]
  )

  return (
    <DashboardPageComponent
      data={data ?? undefined}
      loading={loading}
      error={error ?? undefined}
      onRetry={handleRetry}
      onNavigate={handleNavigate}
      liveStatus={liveStatus}
    />
  )
}
