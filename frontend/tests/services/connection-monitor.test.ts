/**
 * Connection Monitor Tests
 *
 * Global online/offline state for the FE. Trips to offline after a
 * small number of network/timeout failures so that the FE stops
 * generating dead sockets during BE outages, and runs a single
 * lightweight probe against /health to detect recovery.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import {
  useConnectionMonitor,
  useConnectionStatus,
  useDataEpoch,
  reportFailure,
  reportSuccess,
  requestRetry,
  _resetConnectionMonitor,
} from '@/services/connection-monitor'

const PROBE_INTERVAL_MS = 5000
const PROBE_TIMEOUT_MS = 3000

const mockFetch = vi.fn()

function setOkProbe(): void {
  mockFetch.mockResolvedValueOnce({ ok: true } as Response)
}

function setNotOkProbe(status = 503): void {
  mockFetch.mockResolvedValueOnce({ ok: false, status } as Response)
}

function setRejectingProbe(error: Error = new TypeError('NetworkError')): void {
  mockFetch.mockRejectedValueOnce(error)
}

describe('connection-monitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockFetch.mockReset()
    global.fetch = mockFetch as unknown as typeof fetch
    _resetConnectionMonitor()
  })

  afterEach(() => {
    _resetConnectionMonitor()
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('starts online with zero failures', () => {
      const state = useConnectionMonitor.getState()
      expect(state.status).toBe('online')
      expect(state.consecutiveFailures).toBe(0)
      expect(state.lastProbeAt).toBeNull()
    })
  })

  describe('reportFailure', () => {
    it('does not trip on a single failure', () => {
      reportFailure()
      const state = useConnectionMonitor.getState()
      expect(state.status).toBe('online')
      expect(state.consecutiveFailures).toBe(1)
    })

    it('trips to offline on the second consecutive failure', () => {
      reportFailure()
      reportFailure()
      const state = useConnectionMonitor.getState()
      expect(state.status).toBe('offline')
      expect(state.consecutiveFailures).toBe(2)
    })

    it('schedules a probe when transitioning to offline', async () => {
      reportFailure()
      reportFailure()
      expect(mockFetch).not.toHaveBeenCalled()

      setOkProbe()
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/health$/),
        expect.objectContaining({ method: 'GET', cache: 'no-store' }),
      )
    })

    it('uses VITE_API_BASE_URL for the probe when set', async () => {
      const original = import.meta.env.VITE_API_BASE_URL
      import.meta.env.VITE_API_BASE_URL = 'http://api.example.com:9000'
      try {
        reportFailure()
        reportFailure()
        setOkProbe()
        await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)

        expect(mockFetch).toHaveBeenCalledWith(
          'http://api.example.com:9000/health',
          expect.any(Object),
        )
      } finally {
        if (original === undefined) {
          delete import.meta.env.VITE_API_BASE_URL
        } else {
          import.meta.env.VITE_API_BASE_URL = original
        }
      }
    })

    it('probes via the page origin /api/health when no env var is set', async () => {
      const original = import.meta.env.VITE_API_BASE_URL
      delete import.meta.env.VITE_API_BASE_URL
      try {
        reportFailure()
        reportFailure()
        setOkProbe()
        await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)

        expect(mockFetch).toHaveBeenCalledWith(
          `${globalThis.location.origin}/api/health`,
          expect.any(Object),
        )
      } finally {
        if (original !== undefined) {
          import.meta.env.VITE_API_BASE_URL = original
        }
      }
    })

    it('trips immediately when reportFailure is called with definitive=true', async () => {
      reportFailure(true)
      const state = useConnectionMonitor.getState()
      expect(state.status).toBe('offline')

      // Probe loop is running
      setOkProbe()
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('definitive=true on an already-offline monitor is a no-op', async () => {
      reportFailure(true)
      reportFailure(true)
      // Still offline, counter unchanged from the first trip
      const state = useConnectionMonitor.getState()
      expect(state.status).toBe('offline')
    })

    it('does not schedule additional probes while offline', async () => {
      reportFailure()
      reportFailure() // trips offline, schedules probe

      // Reporting more failures while offline must not stack timers
      reportFailure()
      reportFailure()

      setRejectingProbe()
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)

      // Exactly one probe ran for the elapsed interval
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('reportSuccess', () => {
    it('resets failure counter when online', () => {
      reportFailure()
      expect(useConnectionMonitor.getState().consecutiveFailures).toBe(1)
      reportSuccess()
      expect(useConnectionMonitor.getState().consecutiveFailures).toBe(0)
      expect(useConnectionMonitor.getState().status).toBe('online')
    })

    it('is a no-op when already online with no failures', () => {
      reportSuccess()
      const state = useConnectionMonitor.getState()
      expect(state.status).toBe('online')
      expect(state.consecutiveFailures).toBe(0)
    })

    it('transitions offline back to online and cancels probe', async () => {
      reportFailure()
      reportFailure()
      expect(useConnectionMonitor.getState().status).toBe('offline')

      reportSuccess()
      expect(useConnectionMonitor.getState().status).toBe('online')
      expect(useConnectionMonitor.getState().consecutiveFailures).toBe(0)

      // No probe runs after recovery
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 3)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('probe loop', () => {
    beforeEach(() => {
      reportFailure()
      reportFailure() // trip offline, schedule probe
    })

    it('transitions to online when probe responds 2xx', async () => {
      setOkProbe()
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)

      expect(useConnectionMonitor.getState().status).toBe('online')
      expect(useConnectionMonitor.getState().consecutiveFailures).toBe(0)
    })

    it('records the probe timestamp', async () => {
      const before = Date.now()
      setOkProbe()
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
      const lastProbeAt = useConnectionMonitor.getState().lastProbeAt
      expect(lastProbeAt).not.toBeNull()
      expect(lastProbeAt!).toBeGreaterThanOrEqual(before)
    })

    it('stays offline and reschedules when probe rejects', async () => {
      setRejectingProbe()
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
      expect(useConnectionMonitor.getState().status).toBe('offline')

      setOkProbe()
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
      expect(useConnectionMonitor.getState().status).toBe('online')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('stays offline when probe responds with non-2xx', async () => {
      setNotOkProbe(503)
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
      expect(useConnectionMonitor.getState().status).toBe('offline')

      setOkProbe()
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
      expect(useConnectionMonitor.getState().status).toBe('online')
    })

    it('aborts the in-flight probe when probe times out', async () => {
      // fetch hangs until the signal aborts (simulates a stuck BE)
      let abortedSignal: AbortSignal | undefined
      mockFetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
        abortedSignal = init?.signal ?? undefined
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      })

      // Trigger the probe
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
      expect(abortedSignal?.aborted).toBe(false)

      // Hit the in-probe abort timeout
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)
      expect(abortedSignal?.aborted).toBe(true)
      expect(useConnectionMonitor.getState().status).toBe('offline')

      // Next probe is scheduled
      setOkProbe()
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
      expect(useConnectionMonitor.getState().status).toBe('online')
    })
  })

  describe('requestRetry', () => {
    it('runs an immediate probe when offline', async () => {
      reportFailure()
      reportFailure()
      mockFetch.mockReset()

      setOkProbe()
      requestRetry()
      await vi.advanceTimersByTimeAsync(0)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(useConnectionMonitor.getState().status).toBe('online')
    })

    it('cancels the next scheduled probe when triggered manually', async () => {
      reportFailure()
      reportFailure()

      // Manual retry succeeds before the scheduled timer
      setOkProbe()
      requestRetry()
      await vi.advanceTimersByTimeAsync(0)
      expect(useConnectionMonitor.getState().status).toBe('online')

      // The would-be scheduled probe must NOT fire
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 2)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('is a no-op when already online', async () => {
      requestRetry()
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('aborts the in-flight probe when invoked mid-fetch', async () => {
      reportFailure()
      reportFailure()
      mockFetch.mockReset()

      // First probe hangs forever and listens for its abort signal
      let firstAbort = false
      mockFetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            firstAbort = true
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      })

      // Fire the scheduled probe synchronously - probeAbort is set before
      // the runProbe coroutine awaits the (hanging) fetch
      vi.advanceTimersByTime(PROBE_INTERVAL_MS)

      // Manual retry aborts the in-flight probe and starts a fresh one
      setOkProbe()
      requestRetry()
      await vi.advanceTimersByTimeAsync(0)

      expect(firstAbort).toBe(true)
      expect(useConnectionMonitor.getState().status).toBe('online')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('useConnectionStatus', () => {
    it('reflects current status and updates on transitions', () => {
      const { result } = renderHook(() => useConnectionStatus())
      expect(result.current).toBe('online')

      act(() => {
        reportFailure()
        reportFailure()
      })
      expect(result.current).toBe('offline')

      act(() => {
        reportSuccess()
      })
      expect(result.current).toBe('online')
    })
  })

  describe('useDataEpoch', () => {
    it('starts at zero', () => {
      const { result } = renderHook(() => useDataEpoch())
      expect(result.current).toBe(0)
    })

    it('increments on each offline -> online recovery', () => {
      // Read store state directly to keep this test independent of
      // React act() flushing for the multi-transition assertions below.
      const start = useConnectionMonitor.getState().dataEpoch

      reportFailure()
      reportFailure()
      // Still at start - epoch only bumps on the recovery edge, not the
      // outage edge. Otherwise repeated transient failures would churn
      // every page's data fetches needlessly.
      expect(useConnectionMonitor.getState().dataEpoch).toBe(start)

      reportSuccess()
      expect(useConnectionMonitor.getState().dataEpoch).toBe(start + 1)

      reportFailure()
      reportFailure()
      reportSuccess()
      expect(useConnectionMonitor.getState().dataEpoch).toBe(start + 2)
    })

    it('does not bump when reportSuccess fires while already online', () => {
      const start = useConnectionMonitor.getState().dataEpoch
      reportSuccess()
      expect(useConnectionMonitor.getState().dataEpoch).toBe(start)
    })
  })
})
