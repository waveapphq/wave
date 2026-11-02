/**
 * useServerSessions Hook Tests
 *
 * REQ-5.2.7.15 (WAVE Server section).
 *
 * Contract: useServerSessions(active: boolean) drives the WAVE Server roster -
 * load on activation, 5s status polling while active that keeps the last known
 * roster and reports the failure, and per-row / bulk disconnect mutations that
 * each refetch immediately and toast on failure. The own tab id comes from
 * @/lib/session-identity.
 *
 * Module under test:
 * frontend/src/features/settings/container/use-server-sessions.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}))

vi.mock('@/features/settings/api/sessions', () => ({
  fetchServerStatus: vi.fn(),
  disconnectSession: vi.fn(),
  disconnectOthers: vi.fn(),
  disconnectAll: vi.fn(),
}))

vi.mock('@/lib/session-identity', () => ({
  getSessionId: () => 'me',
  getSessionLabel: () => 'Tab me',
}))

import {
  fetchServerStatus,
  disconnectSession,
  disconnectOthers,
  disconnectAll,
  type ServerStatus,
} from '@/features/settings/api/sessions'
import { useServerSessions } from '@/features/settings/container/use-server-sessions'

const mockFetchServerStatus = vi.mocked(fetchServerStatus)
const mockDisconnectSession = vi.mocked(disconnectSession)
const mockDisconnectOthers = vi.mocked(disconnectOthers)
const mockDisconnectAll = vi.mocked(disconnectAll)

// ============================================================================
// Mock Data
// ============================================================================

const DEFAULT_STATUS: ServerStatus = {
  frontend: { running: true, urls: ['http://localhost:3000'], port: 3000, bind: 'local' },
  backend: { running: true, urls: ['http://localhost:8000'], port: 8000, bind: 'local' },
  session_count: 1,
  sessions: [
    {
      session_id: 'me',
      client: 'Chrome (macOS)',
      ip: '10.0.0.5',
      connected_at: '2026-07-25T12:00:00+00:00',
      last_activity: '2026-07-25T12:00:00+00:00',
    },
  ],
  active_session_id: null,
  watching_session_ids: [],
  data_folder: '/srv/wave/data',
  config_file: '/srv/wave/config/config.yaml',
}

// ============================================================================
// Utilities
// ============================================================================

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderActiveHook() {
  const view = renderHook(
    ({ active }: { active: boolean }) => useServerSessions(active),
    { initialProps: { active: true } },
  )
  await flush()
  return view
}

// ============================================================================
// Tests
// ============================================================================

describe('useServerSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchServerStatus.mockResolvedValue(DEFAULT_STATUS)
    mockDisconnectSession.mockResolvedValue(undefined)
    mockDisconnectOthers.mockResolvedValue({ disconnected: 2 })
    mockDisconnectAll.mockResolvedValue({ disconnected: 3 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Load', () => {
    it('loads server status when the section becomes active', async () => {
      const { result } = await renderActiveHook()

      expect(mockFetchServerStatus).toHaveBeenCalledTimes(1)
      expect(result.current.status).toEqual(DEFAULT_STATUS)
      expect(result.current.loading).toBe(false)
    })

    it('does not load while the section is inactive', async () => {
      renderHook(({ active }: { active: boolean }) => useServerSessions(active), {
        initialProps: { active: false },
      })
      await flush()

      expect(mockFetchServerStatus).not.toHaveBeenCalled()
    })

    it('loads once the section transitions from inactive to active', async () => {
      const view = renderHook(
        ({ active }: { active: boolean }) => useServerSessions(active),
        { initialProps: { active: false } },
      )
      await flush()
      expect(mockFetchServerStatus).not.toHaveBeenCalled()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchServerStatus).toHaveBeenCalledTimes(1)
    })

    it('exposes the own session id from session-identity', async () => {
      const { result } = await renderActiveHook()

      expect(result.current.ownSessionId).toBe('me')
    })

    it('reports why the load failed instead of leaving the roster empty', async () => {
      mockFetchServerStatus.mockRejectedValue(new Error('Server status unavailable'))

      const { result } = await renderActiveHook()

      expect(result.current.status).toBeUndefined()
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe('Server status unavailable')
    })

    it('reports a generic reason when the rejection is not an Error', async () => {
      mockFetchServerStatus.mockRejectedValue('offline')

      const { result } = await renderActiveHook()

      expect(result.current.error).toBe('Failed to load server status')
    })

    it('clears the reported failure when retry succeeds', async () => {
      mockFetchServerStatus.mockRejectedValueOnce(new Error('Server status unavailable'))

      const { result } = await renderActiveHook()
      expect(result.current.error).toBe('Server status unavailable')

      mockFetchServerStatus.mockResolvedValue(DEFAULT_STATUS)
      await act(async () => {
        await result.current.retry()
      })

      expect(result.current.error).toBeUndefined()
      expect(result.current.status).toEqual(DEFAULT_STATUS)
    })
  })

  describe('Status polling', () => {
    it('polls status every 5 seconds while active', async () => {
      vi.useFakeTimers()

      const view = renderHook(
        ({ active }: { active: boolean }) => useServerSessions(active),
        { initialProps: { active: true } },
      )
      await flush()
      const callsAfterLoad = mockFetchServerStatus.mock.calls.length

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()
      expect(mockFetchServerStatus.mock.calls.length).toBe(callsAfterLoad + 1)

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()
      expect(mockFetchServerStatus.mock.calls.length).toBe(callsAfterLoad + 2)

      view.unmount()
    })

    it('stops polling when the section deactivates', async () => {
      vi.useFakeTimers()

      const view = renderHook(
        ({ active }: { active: boolean }) => useServerSessions(active),
        { initialProps: { active: true } },
      )
      await flush()

      view.rerender({ active: false })
      const callsAtDeactivation = mockFetchServerStatus.mock.calls.length

      await act(async () => {
        vi.advanceTimersByTime(20_000)
      })
      await flush()

      expect(mockFetchServerStatus.mock.calls.length).toBe(callsAtDeactivation)
      view.unmount()
    })

    it('keeps the last known status and does not toast when a poll tick fails', async () => {
      vi.useFakeTimers()
      mockFetchServerStatus.mockResolvedValueOnce(DEFAULT_STATUS)
      mockFetchServerStatus.mockRejectedValueOnce(new Error('poll failed'))

      const view = renderHook(
        ({ active }: { active: boolean }) => useServerSessions(active),
        { initialProps: { active: true } },
      )
      await flush()
      expect(view.result.current.status).toEqual(DEFAULT_STATUS)

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()

      expect(view.result.current.status).toEqual(DEFAULT_STATUS)
      expect(view.result.current.error).toBe('poll failed')
      expect(toastError).not.toHaveBeenCalled()
      view.unmount()
    })

    it('reports a generic reason when a poll rejects with a non-Error', async () => {
      vi.useFakeTimers()
      mockFetchServerStatus.mockResolvedValueOnce(DEFAULT_STATUS)
      mockFetchServerStatus.mockRejectedValueOnce('offline')

      const view = renderHook(
        ({ active }: { active: boolean }) => useServerSessions(active),
        { initialProps: { active: true } },
      )
      await flush()

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()

      expect(view.result.current.error).toBe('Failed to load server status')
      view.unmount()
    })

    it('drops the reported failure once a later poll succeeds', async () => {
      vi.useFakeTimers()
      mockFetchServerStatus.mockResolvedValueOnce(DEFAULT_STATUS)
      mockFetchServerStatus.mockRejectedValueOnce(new Error('poll failed'))
      mockFetchServerStatus.mockResolvedValue(DEFAULT_STATUS)

      const view = renderHook(
        ({ active }: { active: boolean }) => useServerSessions(active),
        { initialProps: { active: true } },
      )
      await flush()

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()
      expect(view.result.current.error).toBe('poll failed')

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await flush()

      expect(view.result.current.error).toBeUndefined()
      view.unmount()
    })
  })

  describe('disconnect', () => {
    it('disconnects a session and refetches status immediately', async () => {
      const { result } = await renderActiveHook()
      const callsAfterLoad = mockFetchServerStatus.mock.calls.length

      await act(async () => {
        await result.current.disconnect('sess-1')
      })

      expect(mockDisconnectSession).toHaveBeenCalledWith('sess-1')
      expect(mockFetchServerStatus.mock.calls.length).toBeGreaterThanOrEqual(
        callsAfterLoad + 1,
      )
    })

    it('toasts on disconnect failure', async () => {
      mockDisconnectSession.mockRejectedValue(
        new Error("Browser session with ID 'ghost' not found"),
      )

      const { result } = await renderActiveHook()

      await act(async () => {
        await result.current.disconnect('ghost')
      })

      expect(toastError).toHaveBeenCalledWith(
        "Browser session with ID 'ghost' not found",
      )
    })
  })

  describe('disconnectOthers', () => {
    it('disconnects other sessions with the own id and refetches', async () => {
      const { result } = await renderActiveHook()
      const callsAfterLoad = mockFetchServerStatus.mock.calls.length

      await act(async () => {
        await result.current.disconnectOthers()
      })

      expect(mockDisconnectOthers).toHaveBeenCalledWith('me')
      expect(mockFetchServerStatus.mock.calls.length).toBeGreaterThanOrEqual(
        callsAfterLoad + 1,
      )
    })

    it('toasts on disconnect-others failure', async () => {
      mockDisconnectOthers.mockRejectedValue(new Error('Bulk disconnect failed'))

      const { result } = await renderActiveHook()

      await act(async () => {
        await result.current.disconnectOthers()
      })

      expect(toastError).toHaveBeenCalledWith('Bulk disconnect failed')
    })
  })

  describe('disconnectAll', () => {
    it('disconnects all sessions and refetches', async () => {
      const { result } = await renderActiveHook()
      const callsAfterLoad = mockFetchServerStatus.mock.calls.length

      await act(async () => {
        await result.current.disconnectAll()
      })

      expect(mockDisconnectAll).toHaveBeenCalledTimes(1)
      expect(mockFetchServerStatus.mock.calls.length).toBeGreaterThanOrEqual(
        callsAfterLoad + 1,
      )
    })

    it('toasts on disconnect-all failure', async () => {
      mockDisconnectAll.mockRejectedValue(new Error('Bulk disconnect failed'))

      const { result } = await renderActiveHook()

      await act(async () => {
        await result.current.disconnectAll()
      })

      expect(toastError).toHaveBeenCalledWith('Bulk disconnect failed')
    })
  })

  describe('Non-Error failures fall back to a generic message', () => {
    it('disconnect', async () => {
      mockDisconnectSession.mockRejectedValue('boom')
      const { result } = await renderActiveHook()
      await act(async () => {
        await result.current.disconnect('x')
      })
      expect(toastError).toHaveBeenCalledWith('Failed to disconnect session')
    })

    it('disconnectOthers', async () => {
      mockDisconnectOthers.mockRejectedValue('boom')
      const { result } = await renderActiveHook()
      await act(async () => {
        await result.current.disconnectOthers()
      })
      expect(toastError).toHaveBeenCalledWith('Failed to disconnect sessions')
    })

    it('disconnectAll', async () => {
      mockDisconnectAll.mockRejectedValue('boom')
      const { result } = await renderActiveHook()
      await act(async () => {
        await result.current.disconnectAll()
      })
      expect(toastError).toHaveBeenCalledWith('Failed to disconnect sessions')
    })
  })
})
