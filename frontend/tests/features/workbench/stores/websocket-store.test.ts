/**
 * WebSocket Store Tests - REQ-5.2.1.4
 *
 * Tests for WebSocket connection state management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// Mock the websocket-client module
const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockSubscribe = vi.fn()
const mockSubscribeAsync = vi.fn()
const mockUnsubscribe = vi.fn()
const mockOnStateChange = vi.fn()
const mockGetSessionId = vi.fn()
const mockGetSubscriptions = vi.fn()
const mockSendRaw = vi.fn()

vi.mock('@/services/websocket-client', () => ({
  createWebSocketClient: vi.fn(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    subscribe: mockSubscribe.mockImplementation((topic: string, _handler: unknown) => ({
      topic,
      unsubscribe: mockUnsubscribe,
    })),
    subscribeAsync: mockSubscribeAsync.mockImplementation(async (topic: string, _handler: unknown) => ({
      topic,
      unsubscribe: mockUnsubscribe,
    })),
    onStateChange: mockOnStateChange,
    getSessionId: mockGetSessionId,
    getSubscriptions: mockGetSubscriptions.mockReturnValue([]),
    sendRaw: mockSendRaw,
  })),
}))

// Import after mocking
import { useWebSocketStore } from '@/features/workbench/stores/websocket-store'
import {
  reportFailure as reportConnectionFailure,
  reportSuccess as reportConnectionSuccess,
  _resetConnectionMonitor,
} from '@/services/connection-monitor'

describe('useWebSocketStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state between tests
    act(() => {
      // Reset internal state
      useWebSocketStore.setState({
        isConnected: false,
        state: 'disconnected',
        sessionId: undefined,
        latency: undefined,
        _client: null,
      })
    })
  })

  describe('Initial State', () => {
    it('initializes with disconnected state', () => {
      const { result } = renderHook(() => useWebSocketStore())

      expect(result.current.isConnected).toBe(false)
      expect(result.current.state).toBe('disconnected')
      expect(result.current.sessionId).toBeUndefined()
      expect(result.current.latency).toBeUndefined()
    })
  })

  describe('connect', () => {
    it('creates client and connects to WebSocket', async () => {
      mockConnect.mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useWebSocketStore())

      await act(async () => {
        await result.current.connect('ws://localhost:8000/ws')
      })

      expect(mockConnect).toHaveBeenCalled()
      expect(mockOnStateChange).toHaveBeenCalledWith(expect.any(Function))
    })

    it('updates state when connection state changes', async () => {
      mockConnect.mockResolvedValueOnce(undefined)
      mockGetSessionId.mockReturnValue('session-123')

      // Capture the onStateChange callback
      let stateChangeCallback: ((state: string) => void) | null = null
      mockOnStateChange.mockImplementation((cb: (state: string) => void) => {
        stateChangeCallback = cb
      })

      const { result } = renderHook(() => useWebSocketStore())

      await act(async () => {
        await result.current.connect()
      })

      // Trigger state change to 'connected'
      act(() => {
        stateChangeCallback?.('connected')
      })

      expect(result.current.isConnected).toBe(true)
      expect(result.current.state).toBe('connected')
      expect(result.current.sessionId).toBe('session-123')
    })

    it('does nothing if already connected', async () => {
      mockConnect.mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useWebSocketStore())

      // First connection
      await act(async () => {
        await result.current.connect()
      })

      // Simulate connected state
      act(() => {
        useWebSocketStore.setState({ isConnected: true })
      })

      // Second connection attempt
      await act(async () => {
        await result.current.connect()
      })

      // Should only connect once
      expect(mockConnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('disconnect', () => {
    it('disconnects client and resets state', async () => {
      mockConnect.mockResolvedValueOnce(undefined)
      mockDisconnect.mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useWebSocketStore())

      // Connect first
      await act(async () => {
        await result.current.connect()
      })

      // Then disconnect
      await act(async () => {
        await result.current.disconnect()
      })

      expect(mockDisconnect).toHaveBeenCalled()
      expect(result.current.isConnected).toBe(false)
      expect(result.current.state).toBe('disconnected')
    })

    it('does nothing if not connected', async () => {
      const { result } = renderHook(() => useWebSocketStore())

      await act(async () => {
        await result.current.disconnect()
      })

      expect(mockDisconnect).not.toHaveBeenCalled()
    })
  })

  describe('subscribe', () => {
    it('subscribes to topic when connected', async () => {
      mockConnect.mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useWebSocketStore())

      await act(async () => {
        await result.current.connect()
      })

      const handler = vi.fn()
      let subscription: { topic: string; unsubscribe: () => void }

      act(() => {
        subscription = result.current.subscribe('test-topic', handler)
      })

      expect(mockSubscribe).toHaveBeenCalledWith('test-topic', handler, undefined)
      expect(subscription!.topic).toBe('test-topic')
    })

    it('returns no-op subscription when not connected', () => {
      const { result } = renderHook(() => useWebSocketStore())

      const handler = vi.fn()
      let subscription: { topic: string; unsubscribe: () => void }

      act(() => {
        subscription = result.current.subscribe('test-topic', handler)
      })

      expect(subscription!.topic).toBe('test-topic')
      // Unsubscribe should be a no-op
      subscription!.unsubscribe()
      expect(mockUnsubscribe).not.toHaveBeenCalled()
    })
  })

  describe('subscribeAsync', () => {
    it('subscribes asynchronously to topic when connected', async () => {
      mockConnect.mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useWebSocketStore())

      await act(async () => {
        await result.current.connect()
      })

      const handler = vi.fn()
      let subscription: { topic: string; unsubscribe: () => void }

      await act(async () => {
        subscription = await result.current.subscribeAsync('test-topic', handler)
      })

      expect(mockSubscribeAsync).toHaveBeenCalledWith('test-topic', handler, undefined, undefined)
      expect(subscription!.topic).toBe('test-topic')
    })

    it('passes timeout parameter to client', async () => {
      mockConnect.mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useWebSocketStore())

      await act(async () => {
        await result.current.connect()
      })

      const handler = vi.fn()

      await act(async () => {
        await result.current.subscribeAsync('test-topic', handler, undefined, 1000)
      })

      expect(mockSubscribeAsync).toHaveBeenCalledWith('test-topic', handler, undefined, 1000)
    })

    it('returns no-op subscription when not connected', async () => {
      const { result } = renderHook(() => useWebSocketStore())

      const handler = vi.fn()
      let subscription: { topic: string; unsubscribe: () => void }

      await act(async () => {
        subscription = await result.current.subscribeAsync('test-topic', handler)
      })

      expect(subscription!.topic).toBe('test-topic')
      // Unsubscribe should be a no-op
      subscription!.unsubscribe()
      expect(mockUnsubscribe).not.toHaveBeenCalled()
      // Client's subscribeAsync should not be called when not connected
      expect(mockSubscribeAsync).not.toHaveBeenCalled()
    })
  })

  describe('getSubscriptions', () => {
    it('returns empty array when not connected', () => {
      const { result } = renderHook(() => useWebSocketStore())

      const subscriptions = result.current.getSubscriptions()

      expect(subscriptions).toEqual([])
    })

    it('returns subscriptions when connected', async () => {
      mockConnect.mockResolvedValueOnce(undefined)
      mockGetSubscriptions.mockReturnValueOnce(['topic-1', 'topic-2'])

      const { result } = renderHook(() => useWebSocketStore())

      await act(async () => {
        await result.current.connect()
      })

      const subscriptions = result.current.getSubscriptions()

      expect(subscriptions).toEqual(['topic-1', 'topic-2'])
    })
  })

  describe('sendFrame', () => {
    it('drops the frame silently when no client exists', () => {
      const { result } = renderHook(() => useWebSocketStore())

      expect(() => result.current.sendFrame({ type: 'leaving', holderId: 'tab-1' })).not.toThrow()
      expect(mockSendRaw).not.toHaveBeenCalled()
    })

    it('passes the frame verbatim to the client', async () => {
      mockConnect.mockResolvedValueOnce(undefined)
      const { result } = renderHook(() => useWebSocketStore())
      await act(async () => {
        await result.current.connect()
      })

      result.current.sendFrame({ type: 'leaving', holderId: 'tab-1' })

      expect(mockSendRaw).toHaveBeenCalledWith({ type: 'leaving', holderId: 'tab-1' })
    })
  })

  describe('getDefaultWebSocketUrl', () => {
    const originalEnv = { ...import.meta.env }

    afterEach(() => {
      // Reset environment variables
      import.meta.env.VITE_WS_URL = originalEnv.VITE_WS_URL
      import.meta.env.VITE_API_BASE_URL = originalEnv.VITE_API_BASE_URL
    })

    it('uses VITE_WS_URL when set', async () => {
      import.meta.env.VITE_WS_URL = 'ws://custom-ws.example.com/ws'
      mockConnect.mockResolvedValueOnce(undefined)

      // Need to reimport to pick up new env values
      // For this test, we verify the createWebSocketClient is called
      const { createWebSocketClient } = await import('@/services/websocket-client')
      const { result } = renderHook(() => useWebSocketStore())

      // Reset store to force new client creation
      act(() => {
        useWebSocketStore.setState({ _client: null, isConnected: false })
      })

      await act(async () => {
        await result.current.connect()
      })

      expect(createWebSocketClient).toHaveBeenCalledWith({
        url: 'ws://custom-ws.example.com/ws',
      })
    })

    it('uses wss protocol when API URL starts with https', async () => {
      import.meta.env.VITE_WS_URL = ''
      import.meta.env.VITE_API_BASE_URL = 'https://api.example.com'
      mockConnect.mockResolvedValueOnce(undefined)

      const { createWebSocketClient } = await import('@/services/websocket-client')
      const { result } = renderHook(() => useWebSocketStore())

      // Reset store to force new client creation
      act(() => {
        useWebSocketStore.setState({ _client: null, isConnected: false })
      })

      await act(async () => {
        await result.current.connect()
      })

      expect(createWebSocketClient).toHaveBeenCalledWith({
        url: 'wss://api.example.com/ws',
      })
    })

    it('uses ws protocol when API URL starts with http', async () => {
      import.meta.env.VITE_WS_URL = ''
      import.meta.env.VITE_API_BASE_URL = 'http://api.example.com:9000'
      mockConnect.mockResolvedValueOnce(undefined)

      const { createWebSocketClient } = await import('@/services/websocket-client')
      const { result } = renderHook(() => useWebSocketStore())

      act(() => {
        useWebSocketStore.setState({ _client: null, isConnected: false })
      })

      await act(async () => {
        await result.current.connect()
      })

      expect(createWebSocketClient).toHaveBeenCalledWith({
        url: 'ws://api.example.com:9000/ws',
      })
    })

    it('derives ws URL from page host (Vite proxy) when no env var is set', async () => {
      import.meta.env.VITE_WS_URL = ''
      delete import.meta.env.VITE_API_BASE_URL
      mockConnect.mockResolvedValueOnce(undefined)

      const { createWebSocketClient } = await import('@/services/websocket-client')
      const { result } = renderHook(() => useWebSocketStore())

      act(() => {
        useWebSocketStore.setState({ _client: null, isConnected: false })
      })

      await act(async () => {
        await result.current.connect()
      })

      const expectedProtocol = globalThis.location.protocol === 'https:' ? 'wss' : 'ws'
      expect(createWebSocketClient).toHaveBeenCalledWith({
        url: `${expectedProtocol}://${globalThis.location.host}/ws`,
      })
    })

    it('uses wss when the page is served over https and no env var is set', async () => {
      import.meta.env.VITE_WS_URL = ''
      delete import.meta.env.VITE_API_BASE_URL
      mockConnect.mockResolvedValueOnce(undefined)

      const originalLocation = globalThis.location
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { ...originalLocation, protocol: 'https:', host: 'app.example.com' },
      })

      try {
        const { createWebSocketClient } = await import('@/services/websocket-client')
        const { result } = renderHook(() => useWebSocketStore())

        act(() => {
          useWebSocketStore.setState({ _client: null, isConnected: false })
        })

        await act(async () => {
          await result.current.connect()
        })

        expect(createWebSocketClient).toHaveBeenCalledWith({
          url: 'wss://app.example.com/ws',
        })
      } finally {
        Object.defineProperty(globalThis, 'location', {
          configurable: true,
          value: originalLocation,
        })
      }
    })
  })

  describe('Singleton Pattern - Prevent Multiple Connections', () => {
    /**
     * The WebSocket store must implement a singleton pattern to prevent:
     * - React Strict Mode double-renders causing multiple connections
     * - Rapid navigation between pages creating connection proliferation
     * - Multiple hook instances creating separate clients
     *
     * Per design doc: "The store maintains a single client instance,
     * preventing multiple concurrent connections that could occur during
     * React Strict Mode double-renders or rapid navigation."
     */

    it('reuses existing client on subsequent connect calls (not just checks isConnected)', async () => {
      const { createWebSocketClient } = await import('@/services/websocket-client')
      vi.mocked(createWebSocketClient).mockClear()
      mockConnect.mockResolvedValue(undefined)

      const { result } = renderHook(() => useWebSocketStore())

      // Reset store to clean state
      act(() => {
        useWebSocketStore.setState({
          _client: null,
          isConnected: false,
          state: 'disconnected',
        })
      })

      // First connect - should create client
      await act(async () => {
        await result.current.connect()
      })

      expect(createWebSocketClient).toHaveBeenCalledTimes(1)

      // Simulate connection in progress (not yet connected)
      act(() => {
        useWebSocketStore.setState({ isConnected: false, state: 'connecting' })
      })

      // Second connect while connecting - should NOT create new client
      await act(async () => {
        await result.current.connect()
      })

      // Should still only have created one client
      expect(createWebSocketClient).toHaveBeenCalledTimes(1)
    })

    it('returns early when client exists and is connected', async () => {
      const { createWebSocketClient } = await import('@/services/websocket-client')
      vi.mocked(createWebSocketClient).mockClear()
      mockConnect.mockResolvedValue(undefined)

      const { result } = renderHook(() => useWebSocketStore())

      // Reset and connect
      act(() => {
        useWebSocketStore.setState({
          _client: null,
          isConnected: false,
          state: 'disconnected',
        })
      })

      await act(async () => {
        await result.current.connect()
      })

      // Mark as connected
      act(() => {
        useWebSocketStore.setState({ isConnected: true, state: 'connected' })
      })

      // Try to connect again
      await act(async () => {
        await result.current.connect()
      })

      // Should only have called connect once total
      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    it('reconnects existing client when disconnected', async () => {
      const { createWebSocketClient } = await import('@/services/websocket-client')
      vi.mocked(createWebSocketClient).mockClear()
      mockConnect.mockResolvedValue(undefined)

      const { result } = renderHook(() => useWebSocketStore())

      // Reset and connect
      act(() => {
        useWebSocketStore.setState({
          _client: null,
          isConnected: false,
          state: 'disconnected',
        })
      })

      await act(async () => {
        await result.current.connect()
      })

      // Simulate disconnect (client still exists but not connected)
      act(() => {
        const currentState = useWebSocketStore.getState()
        useWebSocketStore.setState({
          ...currentState,
          isConnected: false,
          state: 'disconnected',
        })
      })

      // Connect again - should reuse client, not create new one
      await act(async () => {
        await result.current.connect()
      })

      // Should only have created ONE client (reused)
      expect(createWebSocketClient).toHaveBeenCalledTimes(1)
    })

    it('prevents connection proliferation during React Strict Mode simulation', async () => {
      const { createWebSocketClient } = await import('@/services/websocket-client')
      vi.mocked(createWebSocketClient).mockClear()
      mockConnect.mockResolvedValue(undefined)

      // Reset store
      act(() => {
        useWebSocketStore.setState({
          _client: null,
          isConnected: false,
          state: 'disconnected',
        })
      })

      // Simulate React Strict Mode: multiple rapid hook renders calling connect
      const { result: result1 } = renderHook(() => useWebSocketStore())
      const { result: result2 } = renderHook(() => useWebSocketStore())

      // Both hooks try to connect simultaneously (simulating Strict Mode)
      await Promise.all([
        act(async () => { await result1.current.connect() }),
        act(async () => { await result2.current.connect() }),
      ])

      // Should only create ONE client despite multiple concurrent connect calls
      expect(createWebSocketClient).toHaveBeenCalledTimes(1)
    })

    it('handles connecting state to prevent multiple in-flight connections', async () => {
      const { createWebSocketClient } = await import('@/services/websocket-client')
      vi.mocked(createWebSocketClient).mockClear()

      // Make connect slow so we can test concurrent calls
      mockConnect.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      const { result } = renderHook(() => useWebSocketStore())

      // Reset store
      act(() => {
        useWebSocketStore.setState({
          _client: null,
          isConnected: false,
          state: 'disconnected',
        })
      })

      // Start first connection (will take 100ms)
      const connect1 = act(async () => { await result.current.connect() })

      // Immediately try second connection
      const connect2 = act(async () => { await result.current.connect() })

      await Promise.all([connect1, connect2])

      // Should only create one client
      expect(createWebSocketClient).toHaveBeenCalledTimes(1)
    })
  })

  describe('Connection Monitor Bridge', () => {
    afterEach(() => {
      _resetConnectionMonitor()
    })

    it('disconnects the WS client when the monitor trips offline', async () => {
      mockConnect.mockResolvedValueOnce(undefined)
      mockDisconnect.mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useWebSocketStore())
      await act(async () => { await result.current.connect() })

      mockDisconnect.mockClear()
      act(() => {
        reportConnectionFailure()
        reportConnectionFailure()
      })

      expect(mockDisconnect).toHaveBeenCalledTimes(1)
    })

    it('reconnects the WS client when the monitor recovers to online', async () => {
      mockConnect.mockResolvedValue(undefined)
      mockDisconnect.mockResolvedValue(undefined)

      const { result } = renderHook(() => useWebSocketStore())
      await act(async () => { await result.current.connect() })

      // Trip offline first
      act(() => {
        reportConnectionFailure()
        reportConnectionFailure()
      })

      mockConnect.mockClear()

      // Probe success transitions back to online
      act(() => {
        reportConnectionSuccess()
      })

      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    it('is a no-op when no client exists', () => {
      // No connect() call - _client stays null
      mockDisconnect.mockClear()
      act(() => {
        reportConnectionFailure()
        reportConnectionFailure()
      })

      expect(mockDisconnect).not.toHaveBeenCalled()
    })

    it('swallows reconnect failures from the monitor bridge', async () => {
      mockConnect.mockResolvedValueOnce(undefined)
      mockDisconnect.mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useWebSocketStore())
      await act(async () => { await result.current.connect() })

      act(() => {
        reportConnectionFailure()
        reportConnectionFailure()
      })

      // Probe-driven reconnect rejects; bridge must not throw
      mockConnect.mockRejectedValueOnce(new Error('reconnect failed'))
      expect(() => {
        act(() => {
          reportConnectionSuccess()
        })
      }).not.toThrow()
    })
  })
})
