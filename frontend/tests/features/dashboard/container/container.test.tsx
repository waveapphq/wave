/**
 * DashboardContainer Tests
 *
 * REQ-3.2.2.17 - Real-time dashboard with metrics.
 *
 * Covers:
 * - Serial ticks (no concurrent in-flight requests)
 * - Cadence locked to POLL_MS between request STARTS (slow responses do not shift it)
 * - Watchdog flips the header pill to "reconnecting" at POLL_MS while a
 *   request is still in flight
 * - Fast failures also flip to "reconnecting"; next success returns to "live"
 * - Pause/resume on `visibilitychange`, with an immediate refetch on resume
 * - Initial-load failure still surfaces the hard error state
 * - Last-good data preserved across tick failures (no error-page replacement)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardContainer } from '@/features/dashboard/container/container'

vi.mock('@/features/dashboard/api/dashboard', () => ({
  fetchDashboard: vi.fn(),
}))

import { fetchDashboard } from '@/features/dashboard/api/dashboard'

type FetchDashboardMock = Mock<typeof fetchDashboard>

const POLL_MS = 5000

function buildData(runningCount: number) {
  return {
    metrics: {
      tests: { count: 10 },
      suites: { count: 3 },
      regressions: { count: 1 },
      executions: {
        sinceDays: 1,
        count: runningCount + 5,
        running: runningCount,
        passed: 5,
        failed: 0,
      },
    },
    recentActivity: [],
    recentExecutions: [],
  }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await flushMicrotasks()
}

/**
 * Build a deferred promise whose resolve/reject are exposed so the test can
 * hold a tick in flight for as long as it wants.
 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderContainer() {
  return render(
    <MemoryRouter>
      <DashboardContainer />
    </MemoryRouter>
  )
}

describe('DashboardContainer - live refresh (REQ-3.2.2.17)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    setVisibility('visible')
    ;(fetchDashboard as FetchDashboardMock).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initial load', () => {
    it('fetches /dashboard once on mount', async () => {
      ;(fetchDashboard as FetchDashboardMock).mockResolvedValue(buildData(1))

      renderContainer()
      await flushMicrotasks()

      expect(fetchDashboard).toHaveBeenCalledTimes(1)
    })

    it('passes `timeout: 5000` to fetchDashboard so the request is aborted if the backend stalls', async () => {
      ;(fetchDashboard as FetchDashboardMock).mockResolvedValue(buildData(1))

      renderContainer()
      await flushMicrotasks()

      expect(fetchDashboard).toHaveBeenCalledWith({ timeout: POLL_MS })
    })

    it('renders the full error state when the initial load fails', async () => {
      ;(fetchDashboard as FetchDashboardMock).mockRejectedValue(new Error('boom'))

      renderContainer()
      await flushMicrotasks()

      expect(screen.getByText('boom')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })

    it('Retry button re-fetches and renders data on success', async () => {
      ;(fetchDashboard as FetchDashboardMock)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(buildData(2))

      renderContainer()
      await flushMicrotasks()

      const retry = screen.getByRole('button', { name: /retry/i })
      await act(async () => {
        retry.click()
      })
      await flushMicrotasks()

      expect(screen.queryByText('boom')).not.toBeInTheDocument()
      expect(screen.getByText(/2 running/i)).toBeInTheDocument()
    })
  })

  describe('Serial ticks + cadence', () => {
    it('does not issue a second request while the previous is still in flight', async () => {
      const d1 = deferred<ReturnType<typeof buildData>>()
      ;(fetchDashboard as FetchDashboardMock).mockImplementationOnce(() => d1.promise)

      renderContainer()
      await flushMicrotasks()
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      // 10 POLL_MS worth of time elapses while the first request is held open.
      await advance(POLL_MS * 10)
      expect(fetchDashboard).toHaveBeenCalledTimes(1)
    })

    it('re-fetches POLL_MS after the previous tick STARTED when the response was fast', async () => {
      ;(fetchDashboard as FetchDashboardMock).mockResolvedValue(buildData(1))

      renderContainer()
      await flushMicrotasks()
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      await advance(POLL_MS - 1)
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      await advance(1)
      expect(fetchDashboard).toHaveBeenCalledTimes(2)
    })

    it('keeps cadence from-start when the response takes 2s (waits only the remaining 3s, not another 5s)', async () => {
      let callCount = 0
      ;(fetchDashboard as FetchDashboardMock).mockImplementation(() => {
        callCount += 1
        // Only the first call is slow; subsequent calls resolve immediately.
        if (callCount === 1) {
          return new Promise((resolve) => {
            globalThis.setTimeout(() => resolve(buildData(1)), 2000)
          })
        }
        return Promise.resolve(buildData(1))
      })

      renderContainer()
      await flushMicrotasks()
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      // Advance 2s: first response resolves, but total time from start == 2s,
      // so the next tick must wait another POLL_MS - 2s = 3s.
      await advance(2000)
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      // 2.999s from start: still waiting.
      await advance(2999)
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      // 3s from response → POLL_MS from start → next tick fires.
      await advance(1)
      expect(fetchDashboard).toHaveBeenCalledTimes(2)
    })

    it('fires the next tick immediately when the previous one consumed the full POLL_MS', async () => {
      const d2 = deferred<ReturnType<typeof buildData>>()
      ;(fetchDashboard as FetchDashboardMock)
        .mockResolvedValueOnce(buildData(1))
        .mockImplementationOnce(() => d2.promise)
        .mockResolvedValueOnce(buildData(1))

      renderContainer()
      await flushMicrotasks()
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      // Tick 2 starts at startedAt(tick1) + POLL_MS.
      await advance(POLL_MS)
      expect(fetchDashboard).toHaveBeenCalledTimes(2)

      // Hold tick 2 open for the full POLL_MS (watchdog fires mid-wait).
      await advance(POLL_MS)
      expect(fetchDashboard).toHaveBeenCalledTimes(2)

      // apiClient timeout finally fulfills the in-flight promise with an error.
      await act(async () => {
        d2.reject(new Error('timeout'))
      })
      // startedAt(tick2) + POLL_MS has already passed, so the next tick is
      // scheduled with a 0 ms setTimeout. Flush that timer so the tick runs.
      await advance(0)

      expect(fetchDashboard).toHaveBeenCalledTimes(3)
    })

    it('cancels further ticks on unmount', async () => {
      ;(fetchDashboard as FetchDashboardMock).mockResolvedValue(buildData(0))

      const { unmount } = renderContainer()
      await flushMicrotasks()
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      unmount()
      await advance(POLL_MS * 10)
      expect(fetchDashboard).toHaveBeenCalledTimes(1)
    })

    it('swallows an in-flight successful fetch that resolves after unmount', async () => {
      // This exercises the `if (canceled) return` guard right after the
      // await in the try branch - the unmount path must not let a late
      // resolve setState on an unmounted component.
      const d = deferred<ReturnType<typeof buildData>>()
      ;(fetchDashboard as FetchDashboardMock).mockImplementationOnce(() => d.promise)

      const { unmount } = renderContainer()
      await flushMicrotasks()
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      unmount()

      // Resolve AFTER unmount; the guard should swallow the result silently.
      await act(async () => {
        d.resolve(buildData(1))
      })
      await flushMicrotasks()

      // No further ticks, no errors thrown.
      expect(fetchDashboard).toHaveBeenCalledTimes(1)
    })

    it('swallows an in-flight failing fetch that rejects after unmount', async () => {
      // Same as above but for the catch branch's cancellation guard.
      const d = deferred<ReturnType<typeof buildData>>()
      ;(fetchDashboard as FetchDashboardMock).mockImplementationOnce(() => d.promise)

      const { unmount } = renderContainer()
      await flushMicrotasks()
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      unmount()

      await act(async () => {
        d.reject(new Error('late failure'))
      })
      await flushMicrotasks()

      expect(fetchDashboard).toHaveBeenCalledTimes(1)
    })
  })

  describe('Watchdog (in-flight > POLL_MS)', () => {
    it('flips the badge to Reconnecting at POLL_MS while a tick is still in flight', async () => {
      const d2 = deferred<ReturnType<typeof buildData>>()
      ;(fetchDashboard as FetchDashboardMock)
        .mockResolvedValueOnce(buildData(1))
        .mockImplementationOnce(() => d2.promise)

      renderContainer()
      await flushMicrotasks()
      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'live'
      )

      // Tick 2 starts at POLL_MS; watchdog armed for (POLL_MS + POLL_MS).
      await advance(POLL_MS)
      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'live'
      )

      // Watchdog fires while tick 2 is still in flight.
      await advance(POLL_MS)
      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'reconnecting'
      )
    })

    it('returns to Live if a hanging tick eventually resolves successfully', async () => {
      const d2 = deferred<ReturnType<typeof buildData>>()
      ;(fetchDashboard as FetchDashboardMock)
        .mockResolvedValueOnce(buildData(1))
        .mockImplementationOnce(() => d2.promise)

      renderContainer()
      await flushMicrotasks()

      await advance(POLL_MS) // tick 2 starts
      await advance(POLL_MS) // watchdog fires
      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'reconnecting'
      )

      await act(async () => {
        d2.resolve(buildData(2))
      })
      await flushMicrotasks()

      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'live'
      )
    })
  })

  describe('Tick failures', () => {
    it('keeps rendering last-good data when a single tick fails', async () => {
      ;(fetchDashboard as FetchDashboardMock)
        .mockResolvedValueOnce(buildData(1))
        .mockRejectedValueOnce(new Error('transient'))

      renderContainer()
      await flushMicrotasks()
      expect(screen.getByText(/1 running/i)).toBeInTheDocument()

      await advance(POLL_MS)

      // No error-page replacement.
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
      expect(screen.getByText(/1 running/i)).toBeInTheDocument()
    })

    it('flips the badge to Reconnecting on a single tick failure, then back to Live on the next success', async () => {
      ;(fetchDashboard as FetchDashboardMock)
        .mockResolvedValueOnce(buildData(1))
        .mockRejectedValueOnce(new Error('tick failed'))
        .mockResolvedValueOnce(buildData(2))

      renderContainer()
      await flushMicrotasks()
      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'live'
      )

      await advance(POLL_MS)
      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'reconnecting'
      )

      await advance(POLL_MS)
      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'live'
      )
      expect(screen.getByText(/2 running/i)).toBeInTheDocument()
    })
  })

  describe('Visibility-based pausing', () => {
    it('stops ticking while the tab is hidden', async () => {
      ;(fetchDashboard as FetchDashboardMock).mockResolvedValue(buildData(1))

      renderContainer()
      await flushMicrotasks()
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      act(() => {
        setVisibility('hidden')
      })
      await advance(POLL_MS * 10)

      expect(fetchDashboard).toHaveBeenCalledTimes(1)
    })

    it('performs an immediate refetch on `visibilitychange -> visible`', async () => {
      ;(fetchDashboard as FetchDashboardMock).mockResolvedValue(buildData(1))

      renderContainer()
      await flushMicrotasks()
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      act(() => {
        setVisibility('hidden')
      })
      await advance(30000)
      expect(fetchDashboard).toHaveBeenCalledTimes(1)

      act(() => {
        setVisibility('visible')
      })
      await flushMicrotasks()

      expect(fetchDashboard).toHaveBeenCalledTimes(2)
    })

    it('flips badge to Paused when hidden and back to Live when visible again', async () => {
      ;(fetchDashboard as FetchDashboardMock).mockResolvedValue(buildData(1))

      renderContainer()
      await flushMicrotasks()

      act(() => {
        setVisibility('hidden')
      })
      await flushMicrotasks()
      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'paused'
      )

      act(() => {
        setVisibility('visible')
      })
      await flushMicrotasks()
      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'live'
      )
    })
  })

  describe('Manual refresh button removal', () => {
    it('does not render a manual Refresh button', async () => {
      ;(fetchDashboard as FetchDashboardMock).mockResolvedValue(buildData(0))

      renderContainer()
      await flushMicrotasks()

      expect(screen.queryByRole('button', { name: /^refresh$/i })).not.toBeInTheDocument()
    })
  })
})
