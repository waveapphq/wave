/**
 * Connection Monitor
 *
 * Global online/offline gate for the FE. Trips after a small number of
 * network/timeout failures so HTTP and WebSocket stop generating dead
 * sockets during BE outages, then runs a single lightweight probe
 * against /health until BE answers.
 *
 * Without this gate, every page transition during a BE outage fires a
 * fresh batch of fetches that hang for 30s while the WebSocket retries
 * forever; together they accumulate dead sockets in the browser's
 * network process pool which only a full browser restart can clear.
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

import { diagnoseConnection } from './diagnose'

export type ConnectionStatus = 'online' | 'offline'

export interface ConnectionMonitorState {
  status: ConnectionStatus
  consecutiveFailures: number
  lastProbeAt: number | null
  /**
   * Increments each time the monitor recovers from offline -> online.
   * Components that want to refresh their data after a reconnection use
   * this as a remount key (e.g. on the route content wrapper) so all
   * data fetches re-run without forcing a full page reload.
   */
  dataEpoch: number
  /** Why the last request failed, in the words shown to the user. */
  offlineReason: string | null
}

const FAILURE_THRESHOLD = 2
const PROBE_INTERVAL_MS = 5000
const PROBE_TIMEOUT_MS = 3000

let probeTimer: ReturnType<typeof setTimeout> | null = null
let probeAbort: AbortController | null = null
let reasonProbe: Promise<string> | null = null

export const useConnectionMonitor = create<ConnectionMonitorState>(() => ({
  status: 'online',
  consecutiveFailures: 0,
  lastProbeAt: null,
  dataEpoch: 0,
  offlineReason: null,
}))

function forgetOfflineReason(): void {
  reasonProbe = null
  if (useConnectionMonitor.getState().offlineReason !== null) {
    useConnectionMonitor.setState({ offlineReason: null })
  }
}

/**
 * Diagnoses the current outage once and reuses that answer until the
 * connection recovers.
 */
export function resolveOfflineReason(baseUrl: string): Promise<string> {
  if (reasonProbe === null) {
    const probe: Promise<string> = diagnoseConnection(baseUrl).then((reason) => {
      // A recovery in the meantime replaced or cleared this probe.
      if (reasonProbe === probe) {
        useConnectionMonitor.setState({ offlineReason: reason })
      }
      return reason
    })
    reasonProbe = probe
  }
  return reasonProbe
}

function getProbeUrl(): string {
  // Mirror getApiBaseUrl from @/lib/api - duplicated to avoid a circular
  // import (lib/api -> api-client -> connection-monitor). The probe must
  // hit the same origin as the api-client so it reuses the same NIK pool.
  if (import.meta.env.VITE_API_BASE_URL) {
    return `${import.meta.env.VITE_API_BASE_URL}/health`
  }
  return `${globalThis.location.origin}/api/health`
}

function clearProbeTimer(): void {
  if (probeTimer !== null) {
    clearTimeout(probeTimer)
    probeTimer = null
  }
}

function abortInflightProbe(): void {
  if (probeAbort !== null) {
    probeAbort.abort()
    probeAbort = null
  }
}

function scheduleProbe(): void {
  clearProbeTimer()
  probeTimer = setTimeout(runProbe, PROBE_INTERVAL_MS)
}

function runProbe(): void {
  clearProbeTimer()
  abortInflightProbe()

  useConnectionMonitor.setState({ lastProbeAt: Date.now() })

  const controller = new AbortController()
  probeAbort = controller
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  const settle = (ok: boolean): void => {
    clearTimeout(timeoutId)
    if (probeAbort === controller) {
      probeAbort = null
    }
    if (ok) {
      reportSuccess()
    } else if (useConnectionMonitor.getState().status === 'offline') {
      scheduleProbe()
    }
  }

  const reachable = async (): Promise<boolean> => {
    const response = await fetch(getProbeUrl(), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.ok
  }

  reachable().then(
    settle,
    // Network error / timeout / abort - the probe answers "still offline".
    () => settle(false)
  )
}

/**
 * Records a connectivity failure.
 *
 * `definitive` (e.g. a 502 from the Vite proxy = BE unreachable upstream)
 * trips the monitor immediately. Soft signals (network/timeout errors,
 * which can be transient) require FAILURE_THRESHOLD consecutive hits.
 */
export function reportFailure(definitive: boolean = false): void {
  const state = useConnectionMonitor.getState()
  if (state.status === 'offline') return
  if (definitive) {
    useConnectionMonitor.setState({
      status: 'offline',
      consecutiveFailures: FAILURE_THRESHOLD,
    })
    scheduleProbe()
    return
  }
  const next = state.consecutiveFailures + 1
  if (next >= FAILURE_THRESHOLD) {
    useConnectionMonitor.setState({ status: 'offline', consecutiveFailures: next })
    scheduleProbe()
    return
  }
  useConnectionMonitor.setState({ consecutiveFailures: next })
}

export function reportSuccess(): void {
  forgetOfflineReason()
  const state = useConnectionMonitor.getState()
  if (state.status === 'offline') {
    clearProbeTimer()
    abortInflightProbe()
    // Bump dataEpoch on the offline -> online edge so subscribers (the
    // route content wrapper) can remount and re-fetch without a full
    // page reload.
    useConnectionMonitor.setState({
      status: 'online',
      consecutiveFailures: 0,
      dataEpoch: state.dataEpoch + 1,
    })
    return
  }
  if (state.consecutiveFailures !== 0) {
    useConnectionMonitor.setState({ consecutiveFailures: 0 })
  }
}

export function requestRetry(): void {
  if (useConnectionMonitor.getState().status !== 'offline') return
  runProbe()
}

export function useConnectionStatus(): ConnectionStatus {
  return useConnectionMonitor(useShallow((state) => state.status))
}

/**
 * Hook returning the current data-epoch counter. Use as a remount key on
 * route content so components re-fetch after a reconnection.
 */
export function useDataEpoch(): number {
  return useConnectionMonitor(useShallow((state) => state.dataEpoch))
}

/**
 * Test-only reset. Clears state and any pending probe.
 */
export function _resetConnectionMonitor(): void {
  clearProbeTimer()
  abortInflightProbe()
  reasonProbe = null
  useConnectionMonitor.setState({
    status: 'online',
    consecutiveFailures: 0,
    lastProbeAt: null,
    dataEpoch: 0,
    offlineReason: null,
  })
}
