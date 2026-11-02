/**
 * Connection Diagnosis Tests
 *
 * A cross-origin request the browser blocked and a backend that is not
 * listening both surface as the same opaque network error. A no-cors probe
 * tells them apart: it resolves when something answered, rejects when
 * nothing did.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  diagnoseConnection,
  unreachableMessage,
} from '@/services/connection-monitor/diagnose'
import {
  useConnectionMonitor,
  resolveOfflineReason,
  reportSuccess,
  _resetConnectionMonitor,
} from '@/services/connection-monitor'

const BASE_URL = 'http://192.0.2.20:8000'
const PROBE_TIMEOUT_MS = 3000

const mockFetch = vi.fn()

function pageOrigin(): string {
  return globalThis.location.origin
}

function blockedMessage(): string {
  const origin = pageOrigin()
  return (
    `The backend at ${BASE_URL} is running but rejected requests from ${origin}. ` +
    `Add ${origin} to its allowed origins.`
  )
}

describe('connection diagnosis', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    global.fetch = mockFetch as unknown as typeof fetch
    _resetConnectionMonitor()
  })

  afterEach(() => {
    _resetConnectionMonitor()
    vi.useRealTimers()
  })

  describe('diagnoseConnection', () => {
    it('probes the backend health path without CORS enforcement', async () => {
      mockFetch.mockResolvedValueOnce(undefined)

      await diagnoseConnection(BASE_URL)

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/health`,
        expect.objectContaining({ mode: 'no-cors', cache: 'no-store' }),
      )
    })

    it('names the rejected origin when the backend answers the probe', async () => {
      mockFetch.mockResolvedValueOnce(undefined)

      await expect(diagnoseConnection(BASE_URL)).resolves.toBe(blockedMessage())
    })

    it('reports an unreachable backend when nothing answers the probe', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      await expect(diagnoseConnection(BASE_URL)).resolves.toBe(
        `Cannot reach the backend at ${BASE_URL}`,
      )
    })

    it('reports an unreachable backend when the probe never answers', async () => {
      vi.useFakeTimers()
      mockFetch.mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      )

      const diagnosis = diagnoseConnection(BASE_URL)
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

      await expect(diagnosis).resolves.toBe(`Cannot reach the backend at ${BASE_URL}`)
    })
  })

  describe('unreachableMessage', () => {
    it('names the address that could not be reached', () => {
      expect(unreachableMessage(BASE_URL)).toBe(`Cannot reach the backend at ${BASE_URL}`)
    })
  })

  describe('resolveOfflineReason', () => {
    it('records the diagnosis on the monitor', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      await resolveOfflineReason(BASE_URL)

      expect(useConnectionMonitor.getState().offlineReason).toBe(
        `Cannot reach the backend at ${BASE_URL}`,
      )
    })

    it('probes once per outage', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))

      const first = await resolveOfflineReason(BASE_URL)
      const second = await resolveOfflineReason(BASE_URL)

      expect(first).toBe(second)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('probes again after the connection recovers', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))
      await resolveOfflineReason(BASE_URL)

      reportSuccess()
      expect(useConnectionMonitor.getState().offlineReason).toBeNull()

      await resolveOfflineReason(BASE_URL)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('discards a diagnosis that lands after the connection recovered', async () => {
      let answerProbe: (value: unknown) => void = () => undefined
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerProbe = resolve
          }),
      )

      const pending = resolveOfflineReason(BASE_URL)
      reportSuccess()
      answerProbe(undefined)
      await pending

      expect(useConnectionMonitor.getState().offlineReason).toBeNull()
    })
  })
})
