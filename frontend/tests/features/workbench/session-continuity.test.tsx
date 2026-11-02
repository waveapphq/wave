/**
 * App-scoped session continuity.
 *
 * Holding outlives the Workbench screen, so the departure signal, the liveness
 * signal and the after-reload resume live at application scope and work from
 * any route for as long as the tab is open.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('@/lib/session-identity', () => ({
  getSessionId: () => 'tab-1',
  getPageId: () => 'page-1',
  getSessionLabel: () => 'Chrome (Linux)',
  rememberOwnSession: vi.fn(),
  getOwnSessionIds: () => new Set<string>(),
}))

vi.mock('@/lib/api', () => ({
  getApiBaseUrl: () => 'http://api.test',
}))

const { wsConnect, wsSendFrame, claimMock, heartbeatMock, toastError } = vi.hoisted(() => ({
  wsConnect: vi.fn(() => Promise.resolve()),
  wsSendFrame: vi.fn(),
  claimMock: vi.fn(() => Promise.resolve({})),
  heartbeatMock: vi.fn(() => Promise.resolve(undefined)),
  toastError: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    error: toastError,
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('@/features/workbench/stores/websocket-store', () => ({
  useWebSocketStore: { getState: () => ({ connect: wsConnect, sendFrame: wsSendFrame }) },
}))

vi.mock('@/features/workbench/api/ownership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/api/ownership')>()),
  ownershipApi: { claim: claimMock, heartbeat: heartbeatMock },
}))

import { SessionContinuity, HEARTBEAT_MS } from '@/features/workbench/session-continuity'
import { useWorkbenchSessionStore } from '@/features/workbench/stores/workbench-session-store'

function setRole(role: { isHolder: boolean; isWatching: boolean }): void {
  act(() => {
    useWorkbenchSessionStore.getState().setSessionRole(role)
  })
}

function firePageHide(): void {
  act(() => {
    globalThis.dispatchEvent(new Event('pagehide'))
  })
}

function lastFetchCall(): [string, RequestInit] {
  const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
  return mock.mock.calls.at(-1) as [string, RequestInit]
}

describe('SessionContinuity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    heartbeatMock.mockResolvedValue(undefined)
    useWorkbenchSessionStore.setState({ isHolder: false, isWatching: false })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing', () => {
    const { container } = render(<SessionContinuity />)
    expect(container).toBeEmptyDOMElement()
  })

  it('announces departure on pagehide while this tab holds the session', () => {
    render(<SessionContinuity />)
    setRole({ isHolder: true, isWatching: false })

    firePageHide()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = lastFetchCall()
    expect(url).toBe('http://api.test/workbench/ownership/leaving')
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect(JSON.parse(init.body as string)).toEqual({ holder_id: 'tab-1', page_id: 'page-1' })
  })

  it('announces departure on pagehide while this tab only mirrors', () => {
    // A closing mirror must drop out of the watcher count at once, exactly as
    // it did before the beacon moved to app scope.
    render(<SessionContinuity />)
    setRole({ isHolder: false, isWatching: true })

    firePageHide()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('stays silent when this tab takes part in nothing', () => {
    render(<SessionContinuity />)

    firePageHide()

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('reads the current role rather than the one at mount', () => {
    render(<SessionContinuity />)
    setRole({ isHolder: true, isWatching: false })
    setRole({ isHolder: false, isWatching: false })

    firePageHide()

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('announces from any route, with no Workbench mounted', () => {
    // Nothing Workbench-specific is rendered here; the component alone is enough.
    render(<SessionContinuity />)
    setRole({ isHolder: true, isWatching: false })

    firePageHide()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('stops announcing once unmounted', () => {
    const { unmount } = render(<SessionContinuity />)
    setRole({ isHolder: true, isWatching: false })

    unmount()
    firePageHide()

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('survives a rejected beacon request', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    render(<SessionContinuity />)
    setRole({ isHolder: true, isWatching: false })

    expect(() => firePageHide()).not.toThrow()
  })

  it('announces on the socket as well, in-order before its close', () => {
    // The HTTP beacon races the socket close (and can land after a reload), so
    // the departure also rides the socket, whose frames precede its close.
    render(<SessionContinuity />)
    setRole({ isHolder: true, isWatching: false })

    firePageHide()

    expect(wsSendFrame).toHaveBeenCalledWith({ type: 'leaving', holderId: 'tab-1' })
  })

  it('sends no socket frame when this tab takes part in nothing', () => {
    render(<SessionContinuity />)

    firePageHide()

    expect(wsSendFrame).not.toHaveBeenCalled()
  })

  describe('liveness while holding', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('asserts liveness at once when this tab becomes holder, from any route', async () => {
      render(<SessionContinuity />)
      expect(heartbeatMock).not.toHaveBeenCalled()

      setRole({ isHolder: true, isWatching: false })
      await act(async () => {})

      expect(heartbeatMock).toHaveBeenCalledTimes(1)
      expect(heartbeatMock).toHaveBeenCalledWith('tab-1')
    })

    it('keeps asserting liveness on the interval for as long as the tab holds', async () => {
      render(<SessionContinuity />)
      setRole({ isHolder: true, isWatching: false })
      await act(async () => {})

      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
      })
      expect(heartbeatMock).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
      })
      expect(heartbeatMock).toHaveBeenCalledTimes(3)
    })

    it('asserts liveness with nobody watching', async () => {
      // The hold is the tab's, not a contended resource: a solo holder must not
      // be reaped just because no mirror happens to be open.
      render(<SessionContinuity />)
      setRole({ isHolder: true, isWatching: false })
      await act(async () => {})

      expect(heartbeatMock).toHaveBeenCalled()
    })

    it('never asserts liveness while this tab only mirrors', async () => {
      render(<SessionContinuity />)
      setRole({ isHolder: false, isWatching: true })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3)
      })

      expect(heartbeatMock).not.toHaveBeenCalled()
    })

    it('stops once the tab is no longer the holder', async () => {
      render(<SessionContinuity />)
      setRole({ isHolder: true, isWatching: false })
      await act(async () => {})
      heartbeatMock.mockClear()

      setRole({ isHolder: false, isWatching: true })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3)
      })

      expect(heartbeatMock).not.toHaveBeenCalled()
    })

    it('stops once unmounted', async () => {
      const { unmount } = render(<SessionContinuity />)
      setRole({ isHolder: true, isWatching: false })
      await act(async () => {})
      heartbeatMock.mockClear()

      unmount()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3)
      })

      expect(heartbeatMock).not.toHaveBeenCalled()
    })

    it('stays holder when a liveness call fails', async () => {
      heartbeatMock.mockRejectedValue(new Error('offline'))
      render(<SessionContinuity />)
      setRole({ isHolder: true, isWatching: false })
      await act(async () => {})

      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
      })

      expect(useWorkbenchSessionStore.getState().isHolder).toBe(true)
    })
  })

  describe('resume after a reload', () => {
    it('re-asserts a held session from any route', async () => {
      sessionStorage.setItem(
        'wave.session-role',
        JSON.stringify({ isHolder: true, isWatching: false }),
      )

      render(<SessionContinuity />)
      await act(async () => {})

      expect(wsConnect).toHaveBeenCalled()
      expect(wsSendFrame).toHaveBeenCalledWith({
        type: 'identify',
        holderId: 'tab-1',
        pageId: 'page-1',
        clientType: 'workbench',
      })
      expect(claimMock).toHaveBeenCalledWith('tab-1', 'Chrome (Linux)')
      expect(useWorkbenchSessionStore.getState().isHolder).toBe(true)
    })

    it('accepts the refusal when another tab took the session meanwhile', async () => {
      // A 409 is the server answering that the slot is held, not a failed call.
      sessionStorage.setItem(
        'wave.session-role',
        JSON.stringify({ isHolder: true, isWatching: false }),
      )
      claimMock.mockRejectedValueOnce(Object.assign(new Error('held'), { status: 409 }))

      render(<SessionContinuity />)
      await act(async () => {})

      expect(useWorkbenchSessionStore.getState().isHolder).toBe(false)
      expect(useWorkbenchSessionStore.getState().isWatching).toBe(false)
      expect(toastError).not.toHaveBeenCalled()
    })

    it('says so when the claim fails rather than dropping the session in silence', async () => {
      sessionStorage.setItem(
        'wave.session-role',
        JSON.stringify({ isHolder: true, isWatching: false }),
      )
      claimMock.mockRejectedValueOnce(
        Object.assign(new Error('Service Unavailable'), { status: 503 }),
      )

      render(<SessionContinuity />)
      await act(async () => {})

      expect(toastError).toHaveBeenCalledWith(
        'Service Unavailable',
        'Workbench Session Not Resumed',
      )
      expect(useWorkbenchSessionStore.getState().isHolder).toBe(false)
    })

    it('says so when the socket never comes up', async () => {
      sessionStorage.setItem(
        'wave.session-role',
        JSON.stringify({ isHolder: true, isWatching: false }),
      )
      wsConnect.mockRejectedValueOnce(new Error('socket down'))

      render(<SessionContinuity />)
      await act(async () => {})

      expect(toastError).toHaveBeenCalledWith('socket down', 'Workbench Session Not Resumed')
      expect(claimMock).not.toHaveBeenCalled()
    })

    it('does not resume when the tab held nothing', async () => {
      render(<SessionContinuity />)
      await act(async () => {})

      expect(wsConnect).not.toHaveBeenCalled()
      expect(claimMock).not.toHaveBeenCalled()
    })
  })
})
