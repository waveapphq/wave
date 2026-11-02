/**
 * WebSocket Client Tests - REQ-5.2.1.4 WebSocket client for real-time updates
 *
 * Comprehensive tests for the WebSocket client layer including:
 * - Connection lifecycle (establish, disconnect, reconnect)
 * - Reconnection strategy (exponential backoff, jitter, session restoration)
 * - Subscription management (topics, hierarchical matching, persistence)
 * - Event dispatch (handlers, cleanup, typed payloads)
 * - Message protocol (envelopes, sequence numbers, compression, acknowledgment)
 * - Heartbeat protocol (ping/pong, latency measurement)
 * - Error handling (classification, recovery actions)
 * - State integration (reactive updates)
 * - Type safety (discriminated unions, typed events)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import type {
  WebSocketClient,
  WebSocketClientConfig,
  ConnectionState,
  ConnectionInfo,
  SubscriptionOptions,
  EventHandler,
  WebSocketError,
  ReconnectConfig,
  HeartbeatConfig,
  ExecutionEvent,
  SystemEvent,
  DebugEvent,
  VariableEvent,
  ErrorEvent,
} from '../../src/services/websocket-client'

import {
  createWebSocketClient,
  classifyWebSocketError,
  isReconnectableError,
  parseTopicCategory,
  matchesTopic,
} from '../../src/services/websocket-client'
import {
  _resetConnectionMonitor,
  useConnectionMonitor,
} from '../../src/services/connection-monitor'

// Mock WebSocket globally
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState: number = MockWebSocket.CONNECTING
  protocol: string = ''
  binaryType: BinaryType = 'blob'

  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  private closeHandler: (() => void) | null = null

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    if (protocols) {
      this.protocol = Array.isArray(protocols) ? protocols[0] : protocols
    }
  }

  send = vi.fn()
  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = MockWebSocket.CLOSED
    if (this.closeHandler) {
      this.closeHandler()
    }
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code: code ?? 1000, reason: reason ?? '' }))
    }
  })

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    if (this.onopen) {
      this.onopen(new Event('open'))
    }
  }

  simulateClose(code: number = 1000, reason: string = ''): void {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason }))
    }
  }

  simulateError(message: string = 'WebSocket error'): void {
    if (this.onerror) {
      const event = new Event('error')
      Object.defineProperty(event, 'message', { value: message })
      this.onerror(event)
    }
  }

  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }))
    }
  }

  simulateBinaryMessage(data: ArrayBuffer): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }))
    }
  }

  setCloseHandler(handler: () => void): void {
    this.closeHandler = handler
  }
}

// Store reference to mock constructor for test manipulation
let mockWebSocketInstance: MockWebSocket | null = null
const MockWebSocketConstructor = vi.fn((url: string, protocols?: string | string[]) => {
  mockWebSocketInstance = new MockWebSocket(url, protocols)
  return mockWebSocketInstance
})

// @ts-expect-error - Mock WebSocket globally
global.WebSocket = MockWebSocketConstructor

describe('WebSocket Client - REQ-5.2.1.4', () => {
  let client: WebSocketClient

  beforeEach(() => {
    vi.clearAllMocks()
    mockWebSocketInstance = null
    MockWebSocketConstructor.mockClear()
    _resetConnectionMonitor()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    _resetConnectionMonitor()
  })

  describe('Client Creation and Configuration', () => {
    it('creates client with WebSocket URL configuration', () => {
      const config: WebSocketClientConfig = {
        url: 'wss://api.example.com/ws',
      }
      client = createWebSocketClient(config)
      expect(client).toBeDefined()
      expect(client.getConfig().url).toBe('wss://api.example.com/ws')
    })

    it('creates client with client type identification', () => {
      const config: WebSocketClientConfig = {
        url: 'wss://api.example.com/ws',
        clientType: 'web-ui',
      }
      client = createWebSocketClient(config)
      expect(client.getConfig().clientType).toBe('web-ui')
    })

    it('creates client with reconnection configuration', () => {
      const reconnectConfig: ReconnectConfig = {
        enabled: true,
        maxAttempts: 10,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        jitter: true,
      }
      const config: WebSocketClientConfig = {
        url: 'wss://api.example.com/ws',
        reconnect: reconnectConfig,
      }
      client = createWebSocketClient(config)
      expect(client.getConfig().reconnect).toEqual(reconnectConfig)
    })

    it('creates client with heartbeat configuration', () => {
      const heartbeatConfig: HeartbeatConfig = {
        enabled: true,
        interval: 30000,
        timeout: 5000,
      }
      const config: WebSocketClientConfig = {
        url: 'wss://api.example.com/ws',
        heartbeat: heartbeatConfig,
      }
      client = createWebSocketClient(config)
      expect(client.getConfig().heartbeat).toEqual(heartbeatConfig)
    })

    it('uses default reconnection settings when not specified', () => {
      const config: WebSocketClientConfig = {
        url: 'wss://api.example.com/ws',
      }
      client = createWebSocketClient(config)
      expect(client.getConfig().reconnect?.enabled).toBe(true)
      // Bounded so a long BE outage does not churn dead sockets through
      // the browser pool; recovery is then handled by the global
      // connection-monitor probe.
      expect(client.getConfig().reconnect?.maxAttempts).toBe(5)
      expect(client.getConfig().reconnect?.maxDelay).toBe(30000)
      expect(client.getConfig().reconnect?.jitter).toBe(true)
    })

    it('uses default heartbeat settings when not specified', () => {
      const config: WebSocketClientConfig = {
        url: 'wss://api.example.com/ws',
      }
      client = createWebSocketClient(config)
      // Heartbeat is disabled by default until backend heartbeat loop is implemented
      expect(client.getConfig().heartbeat?.enabled).toBe(false)
      expect(client.getConfig().heartbeat?.interval).toBe(30000)
    })

    it('throws error when URL is not provided', () => {
      expect(() => createWebSocketClient({} as WebSocketClientConfig)).toThrow(
        'url is required'
      )
    })

    it('throws error when URL is empty string', () => {
      expect(() => createWebSocketClient({ url: '' })).toThrow('url is required')
    })

    it('throws error when URL does not use ws or wss protocol', () => {
      expect(() => createWebSocketClient({ url: 'http://example.com/ws' })).toThrow(
        'url must use ws or wss protocol'
      )
    })
  })

  describe('Connection Lifecycle', () => {
    beforeEach(() => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        clientType: 'web-ui',
      })
    })

    it('establishes connection when connect is called', async () => {
      const connectPromise = client.connect()
      // When no protocols configured, second argument should be undefined
      expect(MockWebSocketConstructor).toHaveBeenCalledWith(
        'wss://api.example.com/ws',
        undefined
      )
      expect(mockWebSocketInstance).not.toBeNull()

      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      expect(client.getState()).toBe('connected')
    })

    it('sends client identification on connection', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"identify"')
      )
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"clientType":"web-ui"')
      )
    })

    it('generates and persists session ID', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const sessionId = client.getSessionId()
      expect(sessionId).toBeDefined()
      expect(sessionId).toMatch(/^[a-f0-9-]{36}$/)

      // Session ID should be included in identify message
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining(`"sessionId":"${sessionId}"`)
      )
    })

    it('reuses session ID across reconnections', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const firstSessionId = client.getSessionId()

      // Simulate disconnect and reconnect
      mockWebSocketInstance!.simulateClose(1006)

      const reconnectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await reconnectPromise

      const secondSessionId = client.getSessionId()
      expect(secondSessionId).toBe(firstSessionId)
    })

    it('swallows errors thrown while closing a stale socket on reconnect', async () => {
      // Open a first connection so ctx.ws is populated.
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Close cleanly (code 1000) so no reconnect is scheduled in the
      // background. State -> 'disconnected', ctx.ws still points at the
      // stale socket.
      mockWebSocketInstance!.simulateClose(1000)

      // Make the stale socket's close() throw. The reconnect path
      // wraps that call in try/catch/ignore so the new socket still
      // gets created (belt-and-braces against browsers that reject
      // close() on sockets already torn down by the network stack).
      const staleSocket = mockWebSocketInstance!
      staleSocket.close = vi.fn(() => {
        throw new Error('simulated close failure')
      })

      const reconnectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await reconnectPromise

      // The new socket opened successfully - the throw did not
      // propagate out of performConnect.
      expect(client.getState()).toBe('connected')
      expect(staleSocket.close).toHaveBeenCalled()
    })

    it('reports connection state as disconnected initially', () => {
      expect(client.getState()).toBe('disconnected')
    })

    it('reports connection state as connecting during connection', () => {
      client.connect()
      expect(client.getState()).toBe('connecting')
    })

    it('reports connection state as connected after successful connection', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      expect(client.getState()).toBe('connected')
    })

    it('reports connection state as disconnected after close', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.simulateClose(1000)

      expect(client.getState()).toBe('disconnected')
    })

    it('performs graceful disconnection when disconnect is called', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      await client.disconnect()

      expect(mockWebSocketInstance!.close).toHaveBeenCalledWith(1000, 'Client disconnecting')
      expect(client.getState()).toBe('disconnected')
    })

    it('sends disconnect message before closing', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      await client.disconnect()

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"disconnect"')
      )
    })

    it('clears session ID on explicit disconnect', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      expect(client.getSessionId()).toBeDefined()

      await client.disconnect()

      expect(client.getSessionId()).toBeUndefined()
    })

    it('notifies connection state change listeners', async () => {
      const stateChanges: ConnectionState[] = []
      client.onStateChange((state) => stateChanges.push(state))

      const connectPromise = client.connect()
      expect(stateChanges).toContain('connecting')

      mockWebSocketInstance!.simulateOpen()
      await connectPromise
      expect(stateChanges).toContain('connected')

      mockWebSocketInstance!.simulateClose(1000)
      expect(stateChanges).toContain('disconnected')
    })

    it('provides connection info with latency', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const info = client.getConnectionInfo()
      expect(info).toMatchObject({
        url: 'wss://api.example.com/ws',
        state: 'connected',
        sessionId: expect.any(String),
        connectedAt: expect.any(Date),
      })
    })

    it('rejects connect promise on connection failure', async () => {
      vi.useFakeTimers()

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateError('Connection refused')
      mockWebSocketInstance!.simulateClose(1006, 'Connection failed')

      // The initial connect() promise rejects on first failure even with reconnection enabled
      // Reconnection attempts happen separately after the promise is rejected
      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const rejectAssertion = expect(connectPromise).rejects.toMatchObject({
        type: 'connection_failed',
        message: 'Connection failed',
      })

      await vi.advanceTimersByTimeAsync(100)
      await rejectAssertion
    })

    it('does not reconnect after explicit disconnect', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      await client.disconnect()

      // Clear mock to check no new connections
      MockWebSocketConstructor.mockClear()

      // Wait to ensure no reconnection attempt
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(MockWebSocketConstructor).not.toHaveBeenCalled()
    })

    it('resolves immediately when connect is called while already connected', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      expect(client.getState()).toBe('connected')

      // Calling connect again should resolve immediately without creating new WebSocket
      const initialCallCount = MockWebSocketConstructor.mock.calls.length
      await client.connect()

      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(initialCallCount)
      expect(client.getState()).toBe('connected')
    })

    it('rejects pending acknowledgments on disconnect', async () => {
      vi.useFakeTimers()

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Send a message requiring acknowledgment
      const sendPromise = client.send(
        'execution:abc123',
        { action: 'pause' },
        { requireAck: true, timeout: 10000 }
      )

      // Disconnect while waiting for ack
      await client.disconnect()

      // The pending ack should be rejected
      await expect(sendPromise).rejects.toMatchObject({
        type: 'network',
        message: 'Connection closed',
      })
    })
  })

  describe('Reconnection Strategy', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('automatically reconnects on unexpected disconnection', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          baseDelay: 1000,
          maxDelay: 30000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      expect(client.getState()).toBe('connected')

      // Simulate unexpected close
      MockWebSocketConstructor.mockClear()
      mockWebSocketInstance!.simulateClose(1006, 'Abnormal closure')

      expect(client.getState()).toBe('reconnecting')

      // Advance through reconnection delay
      await vi.advanceTimersByTimeAsync(1000)

      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(1)
    })

    it('uses exponential backoff for reconnection delays', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          baseDelay: 1000,
          maxDelay: 30000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Simulate unexpected close
      mockWebSocketInstance!.simulateClose(1006)

      // First retry after 1000ms
      await vi.advanceTimersByTimeAsync(999)
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(1) // Original only

      await vi.advanceTimersByTimeAsync(1)
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(2) // First retry

      // Simulate failure
      mockWebSocketInstance!.simulateClose(1006)

      // Second retry after 2000ms (1000 * 2)
      await vi.advanceTimersByTimeAsync(1999)
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1)
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(3) // Second retry
    })

    it('caps reconnection delay at maxDelay', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 10,
          baseDelay: 1000,
          maxDelay: 5000,
          backoffMultiplier: 3,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Simulate unexpected close
      mockWebSocketInstance!.simulateClose(1006)

      // First retry: 1000ms
      await vi.advanceTimersByTimeAsync(1000)
      mockWebSocketInstance!.simulateClose(1006)

      // Second retry: 3000ms (1000 * 3)
      await vi.advanceTimersByTimeAsync(3000)
      mockWebSocketInstance!.simulateClose(1006)

      // Third retry: Would be 9000ms but capped at 5000ms
      await vi.advanceTimersByTimeAsync(4999)
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(3)

      await vi.advanceTimersByTimeAsync(1)
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(4)
    })

    it('adds jitter to reconnection delays when enabled', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          baseDelay: 1000,
          maxDelay: 30000,
          backoffMultiplier: 2,
          jitter: true,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.simulateClose(1006)

      // With jitter enabled, reconnection should still happen within a reasonable window
      // (jitter multiplies delay by 0.5-1.5x, so baseDelay 1000 becomes 500-1500ms)
      await vi.advanceTimersByTimeAsync(2000) // Wait long enough for jittered delay

      // Verify reconnection was attempted (jitter doesn't prevent it, just varies timing)
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(2)
    })

    it('stops reconnecting after maxAttempts', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.simulateClose(1006)

      // First attempt
      await vi.advanceTimersByTimeAsync(100)
      mockWebSocketInstance!.simulateClose(1006)

      // Second attempt
      await vi.advanceTimersByTimeAsync(200)
      mockWebSocketInstance!.simulateClose(1006)

      // Third attempt
      await vi.advanceTimersByTimeAsync(400)
      mockWebSocketInstance!.simulateClose(1006)

      // No more attempts
      await vi.advanceTimersByTimeAsync(10000)
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(4) // Original + 3 retries

      expect(client.getState()).toBe('disconnected')
    })

    it('reports failure to the connection monitor when reconnect attempts exhaust', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 2,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // First failure schedules attempt 1; reconnect happens
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(100)
      // Second failure schedules attempt 2; reconnect happens
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(200)
      // Third failure - no more attempts; hands off to monitor
      mockWebSocketInstance!.simulateClose(1006)

      expect(useConnectionMonitor.getState().consecutiveFailures).toBeGreaterThanOrEqual(1)
    })

    it('resets reconnection attempts on successful connection', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Disconnect and fail twice
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(100)
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(200)

      // Third attempt succeeds
      mockWebSocketInstance!.simulateOpen()

      // Disconnect again - should have full 3 attempts available
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(100)
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(200)
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(400)
      mockWebSocketInstance!.simulateClose(1006)

      // Breakdown: original(1) + 2 reconnects (last succeeds) + 3 more reconnects (all fail) = 6 total
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(6)
    })

    it('preserves session ID during reconnection', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const originalSessionId = client.getSessionId()

      // Disconnect unexpectedly
      mockWebSocketInstance!.simulateClose(1006)

      // Reconnect
      await vi.advanceTimersByTimeAsync(100)
      mockWebSocketInstance!.simulateOpen()

      expect(client.getSessionId()).toBe(originalSessionId)
    })

    it('restores subscriptions after reconnection', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Subscribe to topics
      client.subscribe('execution:abc123', vi.fn())
      client.subscribe('system', vi.fn())

      // Clear mock to check resubscription
      mockWebSocketInstance!.send.mockClear()

      // Disconnect and reconnect
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(100)
      mockWebSocketInstance!.simulateOpen()

      // Should have resubscribed to both topics
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"topic":"execution:abc123"')
      )
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"topic":"system"')
      )
    })

    it('restores subscriptions with acknowledgment option after reconnection', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Subscribe with acknowledgment option
      client.subscribe('execution:abc123', vi.fn(), { acknowledgment: true })

      // Clear mock to check resubscription
      mockWebSocketInstance!.send.mockClear()

      // Disconnect and reconnect
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(100)
      mockWebSocketInstance!.simulateOpen()

      // Should have resubscribed with acknowledgment option
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"acknowledgment":true')
      )
    })

    it('restores level option on resubscription after reconnect', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Subscribe with level option
      client.subscribe('log:session-123', vi.fn(), { level: 'DEBUG' })

      // Clear mock to check resubscription
      mockWebSocketInstance!.send.mockClear()

      // Disconnect and reconnect
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(100)
      mockWebSocketInstance!.simulateOpen()

      // Should have resubscribed with level option
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"level":"DEBUG"')
      )
    })

    it('does not reconnect when reconnect is disabled', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: false,
          maxAttempts: 5,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      MockWebSocketConstructor.mockClear()
      mockWebSocketInstance!.simulateClose(1006)

      await vi.advanceTimersByTimeAsync(10000)

      expect(MockWebSocketConstructor).not.toHaveBeenCalled()
      expect(client.getState()).toBe('disconnected')
    })

    it('emits reconnecting state change event', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const stateChanges: ConnectionState[] = []
      client.onStateChange((state) => stateChanges.push(state))

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.simulateClose(1006)

      expect(stateChanges).toContain('reconnecting')
    })

    it('provides reconnection attempt info', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.simulateClose(1006)

      const info = client.getConnectionInfo()
      expect(info.reconnectAttempt).toBe(1)
      expect(info.maxReconnectAttempts).toBe(5)
    })

    it('handles burst of queued messages after reconnection', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Subscribe to topic
      const handler = vi.fn()
      client.subscribe('execution:abc123', handler)

      // Disconnect and reconnect
      mockWebSocketInstance!.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(100)
      mockWebSocketInstance!.simulateOpen()

      // Simulate server delivering a burst of queued messages accumulated during disconnection
      const queuedMessages = [
        { status: 'started', blockId: 'block-1' },
        { status: 'running', blockId: 'block-1', progress: 25 },
        { status: 'running', blockId: 'block-1', progress: 50 },
        { status: 'running', blockId: 'block-1', progress: 75 },
        { status: 'completed', blockId: 'block-1', progress: 100 },
      ]

      // Rapidly deliver all queued messages
      for (let i = 0; i < queuedMessages.length; i++) {
        mockWebSocketInstance!.simulateMessage({
          type: 'event',
          topic: 'execution:abc123',
          payload: { executionId: 'abc123', ...queuedMessages[i] },
          timestamp: Date.now() + i,
          sequence: i + 1,
        })
      }

      // All messages should be received and processed in order
      expect(handler).toHaveBeenCalledTimes(5)

      // Verify messages were received in correct order
      expect(handler.mock.calls[0][0]).toMatchObject({ status: 'started' })
      expect(handler.mock.calls[4][0]).toMatchObject({ status: 'completed', progress: 100 })

      // Client should remain connected
      expect(client.getState()).toBe('connected')
    })
  })

  describe('Subscription Management', () => {
    beforeEach(async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
      })
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise
    })

    it('subscribes to execution topic', () => {
      const handler = vi.fn()
      const subscription = client.subscribe('execution:abc123', handler)

      expect(subscription).toBeDefined()
      expect(subscription.topic).toBe('execution:abc123')
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"subscribe"')
      )
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"topic":"execution:abc123"')
      )
    })

    it('subscribes to system topic', () => {
      const handler = vi.fn()
      client.subscribe('system', handler)

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"topic":"system"')
      )
    })

    it('subscribes to debug topic', () => {
      const handler = vi.fn()
      client.subscribe('debug:execution:abc123', handler)

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"topic":"debug:execution:abc123"')
      )
    })

    it('subscribes to variable topic', () => {
      const handler = vi.fn()
      client.subscribe('variable:execution:abc123', handler)

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"topic":"variable:execution:abc123"')
      )
    })

    it('subscribes to error topic', () => {
      const handler = vi.fn()
      client.subscribe('error', handler)

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"topic":"error"')
      )
    })

    it('supports hierarchical topic matching', () => {
      const executionHandler = vi.fn()
      const specificHandler = vi.fn()

      // Subscribe to parent topic
      client.subscribe('execution', executionHandler)
      // Subscribe to specific topic
      client.subscribe('execution:abc123', specificHandler)

      // Simulate event for specific execution
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        timestamp: Date.now(),
        sequence: 1,
      })

      // Both handlers should receive the event
      expect(executionHandler).toHaveBeenCalled()
      expect(specificHandler).toHaveBeenCalled()
    })

    it('returns cleanup function from subscribe', () => {
      const handler = vi.fn()
      const subscription = client.subscribe('execution:abc123', handler)

      expect(typeof subscription.unsubscribe).toBe('function')
    })

    it('unsubscribes when cleanup function is called', () => {
      const handler = vi.fn()
      const subscription = client.subscribe('execution:abc123', handler)

      mockWebSocketInstance!.send.mockClear()
      subscription.unsubscribe()

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"unsubscribe"')
      )
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"topic":"execution:abc123"')
      )
    })

    it('handles calling unsubscribe multiple times safely', () => {
      const handler = vi.fn()
      const subscription = client.subscribe('execution:abc123', handler)

      subscription.unsubscribe()
      mockWebSocketInstance!.send.mockClear()

      // Calling unsubscribe again should not throw or send another message
      subscription.unsubscribe()

      expect(mockWebSocketInstance!.send).not.toHaveBeenCalled()
    })

    it('sends ad-hoc messages through subscription.send when socket is open', () => {
      const handler = vi.fn()
      const subscription = client.subscribe('log:session-1', handler)

      mockWebSocketInstance!.send.mockClear()
      subscription.send!({ type: 'request_history', topic: 'log:session-1', cursor: 'abc' })

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"request_history"')
      )
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"cursor":"abc"')
      )
    })

    it('subscription.send is a no-op when socket is not open', () => {
      const handler = vi.fn()
      const subscription = client.subscribe('log:session-1', handler)

      mockWebSocketInstance!.simulateClose()
      mockWebSocketInstance!.send.mockClear()
      subscription.send!({ type: 'request_history', topic: 'log:session-1' })

      expect(mockWebSocketInstance!.send).not.toHaveBeenCalled()
    })

    it('stops receiving events after unsubscribe', () => {
      const handler = vi.fn()
      const subscription = client.subscribe('execution:abc123', handler)

      subscription.unsubscribe()
      handler.mockClear()

      // Simulate event
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        timestamp: Date.now(),
        sequence: 1,
      })

      expect(handler).not.toHaveBeenCalled()
    })

    it('allows multiple handlers for same topic', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      client.subscribe('execution:abc123', handler1)
      client.subscribe('execution:abc123', handler2)

      // Simulate event
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        timestamp: Date.now(),
        sequence: 1,
      })

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('only sends one subscribe message for multiple handlers on same topic', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      mockWebSocketInstance!.send.mockClear()

      client.subscribe('execution:abc123', handler1)
      client.subscribe('execution:abc123', handler2)

      const subscribeCalls = mockWebSocketInstance!.send.mock.calls.filter((call) =>
        call[0].includes('"type":"subscribe"')
      )

      expect(subscribeCalls).toHaveLength(1)
    })

    it('only sends unsubscribe when all handlers for topic are removed', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      const sub1 = client.subscribe('execution:abc123', handler1)
      const sub2 = client.subscribe('execution:abc123', handler2)

      mockWebSocketInstance!.send.mockClear()

      sub1.unsubscribe()

      // Should not have sent unsubscribe yet
      expect(mockWebSocketInstance!.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"type":"unsubscribe"')
      )

      sub2.unsubscribe()

      // Now should send unsubscribe
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"unsubscribe"')
      )
    })

    it('lists active subscriptions', () => {
      client.subscribe('execution:abc123', vi.fn())
      client.subscribe('system', vi.fn())

      const subscriptions = client.getSubscriptions()

      expect(subscriptions).toContain('execution:abc123')
      expect(subscriptions).toContain('system')
    })

    it('supports subscription options', () => {
      const handler = vi.fn()
      const options: SubscriptionOptions = {
        acknowledgment: true,
      }

      client.subscribe('execution:abc123', handler, options)

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"acknowledgment":true')
      )
    })

    it('supports level option in subscription', () => {
      const handler = vi.fn()
      const options: SubscriptionOptions = {
        level: 'DEBUG',
      }

      client.subscribe('log:session-123', handler, options)

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"level":"DEBUG"')
      )
    })

    it('supports both acknowledgment and level options together', () => {
      const handler = vi.fn()
      const options: SubscriptionOptions = {
        acknowledgment: true,
        level: 'WARN',
      }

      client.subscribe('log:session-123', handler, options)

      // Find the subscribe message (skip the identify message)
      const subscribeCall = mockWebSocketInstance!.send.mock.calls.find(
        (call) => call[0].includes('"type":"subscribe"')
      )
      expect(subscribeCall).toBeDefined()
      expect(subscribeCall![0]).toContain('"acknowledgment":true')
      expect(subscribeCall![0]).toContain('"level":"WARN"')
    })

    it('validates topic format', () => {
      const handler = vi.fn()

      expect(() => client.subscribe('', handler)).toThrow('Invalid topic format')
      expect(() => client.subscribe('invalid topic with spaces', handler)).toThrow(
        'Invalid topic format'
      )
    })
  })

  describe('Async Subscription (subscribeAsync)', () => {
    beforeEach(async () => {
      vi.useFakeTimers()
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
      })
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('resolves when server confirms subscription', async () => {
      const handler = vi.fn()

      const subscribePromise = client.subscribeAsync('execution:abc123', handler)

      // Simulate server confirmation (message type is 'subscribed', not 'subscription_confirmed')
      mockWebSocketInstance!.simulateMessage({
        type: 'subscribed',
        topic: 'execution:abc123',
      })

      await vi.advanceTimersByTimeAsync(100)

      const subscription = await subscribePromise
      expect(subscription).toBeDefined()
      expect(subscription.topic).toBe('execution:abc123')
    })

    it('rejects with timeout error when server does not confirm within timeout', async () => {
      const handler = vi.fn()

      // Use a short timeout for testing
      const subscribePromise = client.subscribeAsync('execution:abc123', handler, undefined, 1000)

      // Set up the rejection assertion before advancing time
      const rejectAssertion = expect(subscribePromise).rejects.toThrow(
        'Subscription confirmation timeout for topic: execution:abc123'
      )

      // Advance past the timeout without sending confirmation
      await vi.advanceTimersByTimeAsync(1001)

      await rejectAssertion
    })

    it('uses default 5 second timeout when not specified', async () => {
      const handler = vi.fn()

      const subscribePromise = client.subscribeAsync('execution:abc123', handler)

      // Set up the rejection assertion
      const rejectAssertion = expect(subscribePromise).rejects.toThrow(
        'Subscription confirmation timeout for topic: execution:abc123'
      )

      // Advance past 5 second default timeout
      await vi.advanceTimersByTimeAsync(5001)

      await rejectAssertion
    })

    it('clears timeout when subscription is confirmed before timeout', async () => {
      const handler = vi.fn()

      const subscribePromise = client.subscribeAsync('execution:abc123', handler, undefined, 5000)

      // Confirm before timeout (message type is 'subscribed')
      await vi.advanceTimersByTimeAsync(1000)
      mockWebSocketInstance!.simulateMessage({
        type: 'subscribed',
        topic: 'execution:abc123',
      })

      // Should resolve successfully
      const subscription = await subscribePromise
      expect(subscription.topic).toBe('execution:abc123')

      // Advance past what would have been the timeout - should not throw
      await vi.advanceTimersByTimeAsync(10000)
    })

    it('ignores subscribed message without topic', async () => {
      // This tests the early return in handleSubscribedMessage when topic is missing
      // Line 791: if (!topic) return
      const handler = vi.fn()

      const subscribePromise = client.subscribeAsync('execution:abc123', handler, undefined, 1000)

      // Send a subscribed message without a topic - should be ignored
      mockWebSocketInstance!.simulateMessage({
        type: 'subscribed',
        // No topic field
      })

      // Since the message was ignored, the subscription should still timeout
      const rejectAssertion = expect(subscribePromise).rejects.toThrow(
        'Subscription confirmation timeout for topic: execution:abc123'
      )

      await vi.advanceTimersByTimeAsync(1001)

      await rejectAssertion
    })
  })

  describe('Event Dispatch', () => {
    beforeEach(async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
      })
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise
    })

    it('routes events to registered handlers based on topic', () => {
      const executionHandler = vi.fn()
      const systemHandler = vi.fn()

      client.subscribe('execution:abc123', executionHandler)
      client.subscribe('system', systemHandler)

      // Simulate execution event
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        timestamp: Date.now(),
        sequence: 1,
      })

      expect(executionHandler).toHaveBeenCalled()
      expect(systemHandler).not.toHaveBeenCalled()
    })

    it('transforms event payloads into typed domain objects', () => {
      const handler = vi.fn()
      client.subscribe('execution:abc123', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: {
          executionId: 'abc123',
          status: 'running',
          blockId: 'block-1',
          startTime: '2024-01-01T00:00:00Z',
        },
        timestamp: Date.now(),
        sequence: 1,
      })

      const event = handler.mock.calls[0][0] as ExecutionEvent
      expect(event.executionId).toBe('abc123')
      expect(event.status).toBe('running')
      expect(event.blockId).toBe('block-1')
    })

    it('includes event metadata in handler call', () => {
      const handler = vi.fn()
      client.subscribe('execution:abc123', handler)

      const timestamp = Date.now()
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        timestamp,
        sequence: 42,
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'running',
        }),
        expect.objectContaining({
          topic: 'execution:abc123',
          timestamp,
          sequence: 42,
        })
      )
    })

    it('uses default values for missing timestamp and sequence', () => {
      const handler = vi.fn()
      client.subscribe('execution:abc123', handler)

      // Send event without timestamp and sequence
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'running',
        }),
        expect.objectContaining({
          topic: 'execution:abc123',
          timestamp: expect.any(Number),
          sequence: 0,
        })
      )
    })

    it('ignores event messages without topic', () => {
      const handler = vi.fn()
      const eventHandler = vi.fn()

      client.subscribe('execution:abc123', handler)
      client.onEvent(eventHandler)

      // Send event without topic - should be silently ignored
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        payload: { status: 'running' },
        timestamp: Date.now(),
        sequence: 1,
      })

      // Neither handler should be called
      expect(handler).not.toHaveBeenCalled()
      expect(eventHandler).not.toHaveBeenCalled()
    })

    it('dispatches to multiple handlers for same event type', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      client.subscribe('execution:abc123', handler1)
      client.subscribe('execution:abc123', handler2)
      client.subscribe('execution', handler3) // Parent topic

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        timestamp: Date.now(),
        sequence: 1,
      })

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
      expect(handler3).toHaveBeenCalled()
    })

    it('handles errors in event handlers gracefully', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error')
      })
      const successHandler = vi.fn()

      client.subscribe('execution:abc123', errorHandler)
      client.subscribe('execution:abc123', successHandler)

      // Should not throw
      expect(() => {
        mockWebSocketInstance!.simulateMessage({
          type: 'event',
          topic: 'execution:abc123',
          payload: { status: 'running' },
          timestamp: Date.now(),
          sequence: 1,
        })
      }).not.toThrow()

      // Second handler should still be called
      expect(successHandler).toHaveBeenCalled()
    })

    it('dispatches system events', () => {
      const handler = vi.fn()
      client.subscribe('system', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'system',
        payload: {
          eventType: 'config_changed',
          message: 'Configuration updated',
        },
        timestamp: Date.now(),
        sequence: 1,
      })

      const event = handler.mock.calls[0][0] as SystemEvent
      expect(event.eventType).toBe('config_changed')
    })

    it('dispatches debug events', () => {
      const handler = vi.fn()
      client.subscribe('debug:execution:abc123', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'debug:execution:abc123',
        payload: {
          action: 'breakpoint_hit',
          blockId: 'block-1',
          lineNumber: 42,
        },
        timestamp: Date.now(),
        sequence: 1,
      })

      const event = handler.mock.calls[0][0] as DebugEvent
      expect(event.action).toBe('breakpoint_hit')
      expect(event.blockId).toBe('block-1')
    })

    it('dispatches variable events', () => {
      const handler = vi.fn()
      client.subscribe('variable:execution:abc123', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'variable:execution:abc123',
        payload: {
          variableName: 'result',
          value: { status: 'success' },
          scope: 'test',
        },
        timestamp: Date.now(),
        sequence: 1,
      })

      const event = handler.mock.calls[0][0] as VariableEvent
      expect(event.variableName).toBe('result')
      expect(event.value).toEqual({ status: 'success' })
    })

    it('dispatches error events', () => {
      const handler = vi.fn()
      client.subscribe('error', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'error',
        payload: {
          errorCode: 'EXECUTION_FAILED',
          message: 'Block execution failed',
          executionId: 'abc123',
        },
        timestamp: Date.now(),
        sequence: 1,
      })

      const event = handler.mock.calls[0][0] as ErrorEvent
      expect(event.errorCode).toBe('EXECUTION_FAILED')
      expect(event.message).toBe('Block execution failed')
    })
  })

  describe('Message Protocol', () => {
    beforeEach(async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
      })
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise
    })

    it('handles JSON message envelopes with event type', () => {
      const handler = vi.fn()
      client.subscribe('execution:abc123', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        timestamp: 1704067200000,
        sequence: 1,
      })

      expect(handler).toHaveBeenCalled()
    })

    it('validates message envelope structure', () => {
      const errorHandler = vi.fn()
      client.onError(errorHandler)

      // Invalid message - missing type
      mockWebSocketInstance!.simulateMessage({
        topic: 'execution:abc123',
        payload: { status: 'running' },
      })

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'protocol_error',
          message: 'Invalid message envelope: missing type',
        })
      )
    })

    it('tracks sequence numbers for gap detection', () => {
      const handler = vi.fn()
      const gapHandler = vi.fn()

      client.subscribe('execution:abc123', handler)
      client.onSequenceGap(gapHandler)

      // Send sequence 1
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'started' },
        timestamp: Date.now(),
        sequence: 1,
      })

      // Skip sequence 2, send sequence 3
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        timestamp: Date.now(),
        sequence: 3,
      })

      expect(gapHandler).toHaveBeenCalledWith({
        topic: 'execution:abc123',
        expected: 2,
        received: 3,
      })
    })

    it('handles binary messages with UTF-8 encoded JSON', () => {
      const handler = vi.fn()
      client.subscribe('execution:abc123', handler)

      // Binary messages may be sent as ArrayBuffer containing UTF-8 encoded JSON
      // This tests the client's ability to handle binary WebSocket frames
      const binaryData = new TextEncoder().encode(
        JSON.stringify({
          type: 'event',
          topic: 'execution:abc123',
          payload: { status: 'running', data: 'binary payload' },
          timestamp: Date.now(),
          sequence: 1,
        })
      )

      mockWebSocketInstance!.simulateBinaryMessage(binaryData.buffer)

      expect(handler).toHaveBeenCalled()
      expect(handler.mock.calls[0][0]).toMatchObject({
        status: 'running',
        data: 'binary payload',
      })
    })

    it('handles compressed messages with compression flag', () => {
      const handler = vi.fn()
      client.subscribe('execution:abc123', handler)

      // Messages with compression flag indicate the payload was compressed by server
      // Client should detect and decompress automatically (implementation detail)
      const compressedMessage = new TextEncoder().encode(
        JSON.stringify({
          type: 'event',
          topic: 'execution:abc123',
          payload: {
            status: 'completed',
            result: { summary: 'Large result that was compressed for transmission' },
          },
          timestamp: Date.now(),
          sequence: 1,
          compressed: true,
        })
      )

      mockWebSocketInstance!.simulateBinaryMessage(compressedMessage.buffer)

      expect(handler).toHaveBeenCalled()
      expect(handler.mock.calls[0][0]).toMatchObject({
        status: 'completed',
        result: { summary: 'Large result that was compressed for transmission' },
      })
    })

    it('sends acknowledgment for messages requiring it', () => {
      const handler = vi.fn()
      client.subscribe('execution:abc123', handler)

      mockWebSocketInstance!.send.mockClear()

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'completed' },
        timestamp: Date.now(),
        sequence: 1,
        ackId: 'ack-123',
      })

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"ack"')
      )
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"ackId":"ack-123"')
      )
    })

    it('handles server acknowledgment responses', () => {
      const ackHandler = vi.fn()
      client.onAcknowledgment(ackHandler)

      mockWebSocketInstance!.send.mockClear()

      // Send a message that requires ack
      client.send('execution:abc123', { action: 'pause' }, { requireAck: true })

      // Extract the ackId from the sent message
      const sentMessage = mockWebSocketInstance!.send.mock.calls.find((call) =>
        call[0].includes('"type":"message"')
      )
      expect(sentMessage).toBeDefined()
      const parsedMessage = JSON.parse(sentMessage![0]) as { ackId?: string }
      expect(parsedMessage.ackId).toBeDefined()

      // Simulate server ack response with the actual ackId
      mockWebSocketInstance!.simulateMessage({
        type: 'ack',
        ackId: parsedMessage.ackId,
        success: true,
      })

      expect(ackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          ackId: parsedMessage.ackId,
          success: true,
        })
      )
    })

    it('ignores ack messages without ackId', () => {
      const ackHandler = vi.fn()
      client.onAcknowledgment(ackHandler)

      // Simulate ack message without ackId
      mockWebSocketInstance!.simulateMessage({
        type: 'ack',
        success: true,
      })

      // Should not call the handler since ackId is missing
      expect(ackHandler).not.toHaveBeenCalled()
    })

    it('defaults success to false when undefined in ack message', () => {
      const ackHandler = vi.fn()
      client.onAcknowledgment(ackHandler)

      // Simulate ack message with ackId but no success field
      mockWebSocketInstance!.simulateMessage({
        type: 'ack',
        ackId: 'ack-123',
        // success is deliberately omitted
      })

      // Handler should be called with success defaulted to false
      expect(ackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          ackId: 'ack-123',
          success: false,
        })
      )
    })

    it('handles malformed JSON gracefully', () => {
      const errorHandler = vi.fn()
      client.onError(errorHandler)

      // Send malformed JSON
      if (mockWebSocketInstance!.onmessage) {
        mockWebSocketInstance!.onmessage(
          new MessageEvent('message', { data: 'not valid json{' })
        )
      }

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'protocol_error',
          message: expect.stringContaining('Invalid JSON'),
        })
      )
    })

    it('ignores unknown message types', () => {
      const handler = vi.fn()
      const errorHandler = vi.fn()

      client.subscribe('execution:abc123', handler)
      client.onError(errorHandler)

      mockWebSocketInstance!.simulateMessage({
        type: 'unknown_type',
        data: 'something',
      })

      expect(handler).not.toHaveBeenCalled()
      expect(errorHandler).not.toHaveBeenCalled() // Unknown types are silently ignored
    })
  })

  describe('Heartbeat Protocol', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('responds to server ping with pong', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        heartbeat: {
          enabled: true,
          interval: 30000,
          timeout: 5000,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.send.mockClear()

      // Simulate server ping
      mockWebSocketInstance!.simulateMessage({
        type: 'ping',
        timestamp: Date.now(),
      })

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"pong"')
      )
    })

    it('responds to server ping without timestamp', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        heartbeat: {
          enabled: true,
          interval: 30000,
          timeout: 5000,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.send.mockClear()

      // Simulate server ping without timestamp
      mockWebSocketInstance!.simulateMessage({
        type: 'ping',
      })

      // Should still respond with pong
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"pong"')
      )
    })

    it('includes timestamp in pong response', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        heartbeat: {
          enabled: true,
          interval: 30000,
          timeout: 5000,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.send.mockClear()

      const pingTimestamp = Date.now()
      mockWebSocketInstance!.simulateMessage({
        type: 'ping',
        timestamp: pingTimestamp,
      })

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining(`"pingTimestamp":${pingTimestamp}`)
      )
    })

    it('triggers reconnection on missed heartbeats', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        heartbeat: {
          enabled: true,
          interval: 30000,
          timeout: 5000,
        },
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      MockWebSocketConstructor.mockClear()

      // Advance past heartbeat timeout without receiving ping
      await vi.advanceTimersByTimeAsync(35000) // interval + timeout

      // Should trigger reconnection
      expect(client.getState()).toBe('reconnecting')
    })

    it('measures latency from heartbeat round-trip', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        heartbeat: {
          enabled: true,
          interval: 30000,
          timeout: 5000,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const startTime = Date.now()

      // Simulate server ping
      mockWebSocketInstance!.simulateMessage({
        type: 'ping',
        timestamp: startTime,
      })

      // Advance time to simulate latency
      await vi.advanceTimersByTimeAsync(50)

      const info = client.getConnectionInfo()
      expect(info.latency).toBeGreaterThanOrEqual(0)
    })

    it('resets heartbeat timer on any message', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        heartbeat: {
          enabled: true,
          interval: 30000,
          timeout: 5000,
        },
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Advance most of the way to timeout
      await vi.advanceTimersByTimeAsync(30000)

      // Receive a regular message (resets timer)
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'system',
        payload: { eventType: 'status' },
        timestamp: Date.now(),
        sequence: 1,
      })

      // Advance past what would have been the timeout
      await vi.advanceTimersByTimeAsync(10000)

      // Should still be connected (timer was reset)
      expect(client.getState()).toBe('connected')
    })

    it('does not send heartbeat when disabled', async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        heartbeat: {
          enabled: false,
          interval: 30000,
          timeout: 5000,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.send.mockClear()

      // Advance past heartbeat interval
      await vi.advanceTimersByTimeAsync(60000)

      // Should not have sent any heartbeat-related messages
      const pingCalls = mockWebSocketInstance!.send.mock.calls.filter((call) =>
        call[0].includes('"type":"ping"')
      )
      expect(pingCalls).toHaveLength(0)
    })
  })

  describe('Error Handling', () => {
    beforeEach(async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: false,
          maxAttempts: 0,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })
    })

    it('classifies network errors', async () => {
      const errorHandler = vi.fn()
      client.onError(errorHandler)

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateError('Network error')
      mockWebSocketInstance!.simulateClose(1006)

      try {
        await connectPromise
      } catch {
        // Expected to fail
      }

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'network',
        })
      )
    })

    it('classifies server rejection errors', async () => {
      const errorHandler = vi.fn()
      client.onError(errorHandler)

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateClose(4001, 'Authentication required')

      try {
        await connectPromise
      } catch {
        // Expected to fail
      }

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'server_rejection',
          code: 4001,
          message: 'Authentication required',
        })
      )
    })

    it('classifies protocol errors and keeps connection open', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const errorHandler = vi.fn()
      client.onError(errorHandler)

      // Send invalid protocol message
      mockWebSocketInstance!.simulateMessage({
        invalid: 'structure',
      })

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'protocol_error',
        })
      )

      // Protocol errors should NOT terminate the connection (per design doc)
      expect(client.getState()).toBe('connected')
    })

    it('classifies subscription errors', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const errorHandler = vi.fn()
      client.onError(errorHandler)

      // Simulate subscription error from server
      mockWebSocketInstance!.simulateMessage({
        type: 'error',
        code: 'SUBSCRIPTION_DENIED',
        message: 'Not authorized to subscribe to topic',
        topic: 'execution:private',
      })

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subscription_error',
          topic: 'execution:private',
        })
      )
    })

    it('classifies non-subscription errors as protocol errors', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const errorHandler = vi.fn()
      client.onError(errorHandler)

      // Simulate a generic error from server (not SUBSCRIPTION_DENIED)
      mockWebSocketInstance!.simulateMessage({
        type: 'error',
        code: 'INVALID_REQUEST',
        message: 'Malformed request',
      })

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'protocol_error',
          message: 'Malformed request',
        })
      )
    })

    it('uses default message for errors without message field', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const errorHandler = vi.fn()
      client.onError(errorHandler)

      // Simulate error from server without message field
      mockWebSocketInstance!.simulateMessage({
        type: 'error',
        code: 'UNKNOWN_ERROR',
      })

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'protocol_error',
          message: 'Unknown error',
        })
      )
    })

    it('provides error code for close events', async () => {
      const errorHandler = vi.fn()
      client.onError(errorHandler)

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      mockWebSocketInstance!.simulateClose(1008, 'Policy violation')

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 1008,
          message: 'Policy violation',
        })
      )
    })

    it('allows error handlers to be removed', async () => {
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      const errorHandler = vi.fn()
      const removeHandler = client.onError(errorHandler)

      removeHandler()

      mockWebSocketInstance!.simulateMessage({
        invalid: 'message',
      })

      expect(errorHandler).not.toHaveBeenCalled()
    })

    it('handles connection timeout', async () => {
      vi.useFakeTimers()

      const connectPromise = client.connect()

      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const rejectAssertion = expect(connectPromise).rejects.toMatchObject({
        type: 'timeout',
        message: 'Connection timeout',
      })

      // Advance past connection timeout without open event
      await vi.advanceTimersByTimeAsync(30000)
      await rejectAssertion
    })

    it('recovers from transient errors', async () => {
      vi.useFakeTimers()

      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise

      // Simulate transient error
      mockWebSocketInstance!.simulateClose(1006)

      // Wait for reconnection
      await vi.advanceTimersByTimeAsync(100)
      mockWebSocketInstance!.simulateOpen()

      expect(client.getState()).toBe('connected')
    })
  })

  describe('State Integration', () => {
    beforeEach(async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
      })
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise
    })

    it('provides onStateChange callback for reactive updates', () => {
      const callback = vi.fn()
      const unsubscribe = client.onStateChange(callback)

      mockWebSocketInstance!.simulateClose(1000)

      expect(callback).toHaveBeenCalledWith('disconnected')
      expect(typeof unsubscribe).toBe('function')
    })

    it('unsubscribes from state changes when cleanup is called', () => {
      const callback = vi.fn()
      const unsubscribe = client.onStateChange(callback)

      unsubscribe()
      callback.mockClear()

      mockWebSocketInstance!.simulateClose(1000)

      expect(callback).not.toHaveBeenCalled()
    })

    it('notifies all state change listeners', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      client.onStateChange(callback1)
      client.onStateChange(callback2)

      mockWebSocketInstance!.simulateClose(1000)

      expect(callback1).toHaveBeenCalledWith('disconnected')
      expect(callback2).toHaveBeenCalledWith('disconnected')
    })

    it('provides event stream for store integration', () => {
      const eventCallback = vi.fn()
      client.onEvent(eventCallback)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        timestamp: Date.now(),
        sequence: 1,
      })

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'execution:abc123',
          payload: expect.objectContaining({ status: 'running' }),
        })
      )
    })

    it('provides connection info observable', () => {
      const infoCallback = vi.fn()
      client.onConnectionInfo(infoCallback)

      // Connection info should be emitted periodically or on change
      expect(typeof infoCallback).toBe('function')
    })

    it('handles errors in state change callbacks gracefully', () => {
      const throwingCallback = vi.fn(() => {
        throw new Error('Callback error')
      })
      const normalCallback = vi.fn()

      client.onStateChange(throwingCallback)
      client.onStateChange(normalCallback)

      // Should not throw, and normal callback should still be called
      mockWebSocketInstance!.simulateClose(1000)

      expect(throwingCallback).toHaveBeenCalled()
      expect(normalCallback).toHaveBeenCalledWith('disconnected')
    })

    it('handles errors in error callbacks gracefully', () => {
      const throwingCallback = vi.fn(() => {
        throw new Error('Callback error')
      })
      const normalCallback = vi.fn()

      client.onError(throwingCallback)
      client.onError(normalCallback)

      // Simulate an error event
      mockWebSocketInstance!.simulateClose(1006, 'Connection lost')

      expect(throwingCallback).toHaveBeenCalled()
      expect(normalCallback).toHaveBeenCalled()
    })

    it('handles errors in event callbacks gracefully', () => {
      const throwingCallback = vi.fn(() => {
        throw new Error('Callback error')
      })
      const normalCallback = vi.fn()

      client.onEvent(throwingCallback)
      client.onEvent(normalCallback)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        timestamp: Date.now(),
        sequence: 1,
      })

      expect(throwingCallback).toHaveBeenCalled()
      expect(normalCallback).toHaveBeenCalled()
    })

    it('handles errors in acknowledgment callbacks gracefully', () => {
      const throwingCallback = vi.fn(() => {
        throw new Error('Callback error')
      })
      const normalCallback = vi.fn()

      client.onAcknowledgment(throwingCallback)
      client.onAcknowledgment(normalCallback)

      mockWebSocketInstance!.simulateMessage({
        type: 'ack',
        ackId: 'test-ack-id',
        success: true,
      })

      expect(throwingCallback).toHaveBeenCalled()
      expect(normalCallback).toHaveBeenCalled()
    })

    it('handles errors in sequence gap callbacks gracefully', () => {
      const throwingCallback = vi.fn(() => {
        throw new Error('Callback error')
      })
      const normalCallback = vi.fn()

      client.onSequenceGap(throwingCallback)
      client.onSequenceGap(normalCallback)

      // Subscribe to a topic and trigger a sequence gap
      client.subscribe('execution:abc123', vi.fn())

      // Send message with sequence 1
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'running' },
        sequence: 1,
      })

      // Send message with sequence 5 (gap of 3)
      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: { status: 'complete' },
        sequence: 5,
      })

      expect(throwingCallback).toHaveBeenCalled()
      expect(normalCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'execution:abc123',
          expected: 2,
          received: 5,
        })
      )
    })
  })

  describe('Type Safety', () => {
    beforeEach(async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
      })
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise
    })

    it('provides typed execution events', () => {
      const handler = vi.fn<EventHandler<ExecutionEvent>>()
      client.subscribe('execution:abc123', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'execution:abc123',
        payload: {
          executionId: 'abc123',
          status: 'running',
          blockId: 'block-1',
          startTime: '2024-01-01T00:00:00Z',
          progress: 50,
        },
        timestamp: Date.now(),
        sequence: 1,
      })

      const event = handler.mock.calls[0][0] as ExecutionEvent
      // TypeScript should infer event as ExecutionEvent
      expect(event.executionId).toBe('abc123')
      expect(event.status).toBe('running')
      expect(event.blockId).toBe('block-1')
      expect(event.progress).toBe(50)
    })

    it('provides typed system events', () => {
      const handler = vi.fn<EventHandler<SystemEvent>>()
      client.subscribe('system', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'system',
        payload: {
          eventType: 'config_changed',
          message: 'Configuration updated',
          affectedKeys: ['timeout', 'retries'],
        },
        timestamp: Date.now(),
        sequence: 1,
      })

      const event = handler.mock.calls[0][0] as SystemEvent
      expect(event.eventType).toBe('config_changed')
      expect(event.affectedKeys).toContain('timeout')
    })

    it('provides typed debug events', () => {
      const handler = vi.fn<EventHandler<DebugEvent>>()
      client.subscribe('debug:execution:abc123', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'debug:execution:abc123',
        payload: {
          action: 'breakpoint_hit',
          executionId: 'abc123',
          blockId: 'block-1',
          lineNumber: 42,
          variables: { x: 10, y: 20 },
        },
        timestamp: Date.now(),
        sequence: 1,
      })

      const event = handler.mock.calls[0][0] as DebugEvent
      expect(event.action).toBe('breakpoint_hit')
      expect(event.lineNumber).toBe(42)
      expect(event.variables).toEqual({ x: 10, y: 20 })
    })

    it('provides typed variable events', () => {
      const handler = vi.fn<EventHandler<VariableEvent>>()
      client.subscribe('variable:execution:abc123', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'variable:execution:abc123',
        payload: {
          executionId: 'abc123',
          variableName: 'result',
          value: { status: 'success', count: 42 },
          previousValue: null,
          scope: 'test',
          blockId: 'block-1',
        },
        timestamp: Date.now(),
        sequence: 1,
      })

      const event = handler.mock.calls[0][0] as VariableEvent
      expect(event.variableName).toBe('result')
      expect(event.value).toEqual({ status: 'success', count: 42 })
    })

    it('provides typed error events', () => {
      const handler = vi.fn<EventHandler<ErrorEvent>>()
      client.subscribe('error', handler)

      mockWebSocketInstance!.simulateMessage({
        type: 'event',
        topic: 'error',
        payload: {
          errorCode: 'EXECUTION_FAILED',
          message: 'Block execution failed',
          executionId: 'abc123',
          blockId: 'block-1',
          details: { reason: 'timeout' },
        },
        timestamp: Date.now(),
        sequence: 1,
      })

      const event = handler.mock.calls[0][0] as ErrorEvent
      expect(event.errorCode).toBe('EXECUTION_FAILED')
      expect(event.executionId).toBe('abc123')
      expect(event.details?.reason).toBe('timeout')
    })

    it('provides typed connection state', () => {
      const state: ConnectionState = client.getState()
      const validStates: ConnectionState[] = [
        'disconnected',
        'connecting',
        'connected',
        'reconnecting',
      ]
      expect(validStates).toContain(state)
    })

    it('provides typed connection info', () => {
      const info: ConnectionInfo = client.getConnectionInfo()
      expect(info.url).toBe('wss://api.example.com/ws')
      expect(info.state).toBeDefined()
      expect(info.sessionId).toBeDefined()
    })

    it('provides typed WebSocket error', () => {
      const errorHandler = vi.fn()
      client.onError(errorHandler)

      mockWebSocketInstance!.simulateMessage({
        type: 'error',
        code: 'SUBSCRIPTION_DENIED',
        message: 'Not authorized',
      })

      const error: WebSocketError = errorHandler.mock.calls[0][0]
      expect(error.type).toBeDefined()
      expect(error.message).toBeDefined()
    })
  })

  describe('Utility Functions', () => {
    describe('classifyWebSocketError', () => {
      it('classifies code 1006 as network error', () => {
        const result = classifyWebSocketError(1006)
        expect(result).toBe('network')
      })

      it('classifies code 1001 as normal closure', () => {
        const result = classifyWebSocketError(1001)
        expect(result).toBe('going_away')
      })

      it('classifies code 1008 as policy violation', () => {
        const result = classifyWebSocketError(1008)
        expect(result).toBe('policy_violation')
      })

      it('classifies code 4001-4099 as server rejection', () => {
        expect(classifyWebSocketError(4001)).toBe('server_rejection')
        expect(classifyWebSocketError(4050)).toBe('server_rejection')
        expect(classifyWebSocketError(4099)).toBe('server_rejection')
      })

      it('classifies code 4100-4199 as subscription error', () => {
        expect(classifyWebSocketError(4100)).toBe('subscription_error')
        expect(classifyWebSocketError(4150)).toBe('subscription_error')
      })

      it('classifies unknown codes as unknown', () => {
        const result = classifyWebSocketError(9999)
        expect(result).toBe('unknown')
      })
    })

    describe('isReconnectableError', () => {
      it('returns true for network errors', () => {
        expect(isReconnectableError({ type: 'network' } as WebSocketError)).toBe(true)
      })

      it('returns true for timeout errors', () => {
        expect(isReconnectableError({ type: 'timeout' } as WebSocketError)).toBe(true)
      })

      it('returns true for going_away errors', () => {
        expect(isReconnectableError({ type: 'going_away' } as WebSocketError)).toBe(true)
      })

      it('returns false for server rejection', () => {
        expect(isReconnectableError({ type: 'server_rejection' } as WebSocketError)).toBe(
          false
        )
      })

      it('returns false for policy violation', () => {
        expect(isReconnectableError({ type: 'policy_violation' } as WebSocketError)).toBe(
          false
        )
      })

      it('returns false for protocol errors', () => {
        expect(isReconnectableError({ type: 'protocol_error' } as WebSocketError)).toBe(
          false
        )
      })
    })

    describe('parseTopicCategory', () => {
      it('parses execution topic', () => {
        expect(parseTopicCategory('execution:abc123')).toBe('execution')
      })

      it('parses system topic', () => {
        expect(parseTopicCategory('system')).toBe('system')
      })

      it('parses debug topic', () => {
        expect(parseTopicCategory('debug:execution:abc123')).toBe('debug')
      })

      it('parses variable topic', () => {
        expect(parseTopicCategory('variable:execution:abc123')).toBe('variable')
      })

      it('parses error topic', () => {
        expect(parseTopicCategory('error')).toBe('error')
      })

      it('returns unknown for invalid topics', () => {
        expect(parseTopicCategory('invalid:topic')).toBe('unknown')
      })
    })

    describe('matchesTopic', () => {
      it('matches exact topic', () => {
        expect(matchesTopic('execution:abc123', 'execution:abc123')).toBe(true)
      })

      it('matches parent topic to child', () => {
        expect(matchesTopic('execution', 'execution:abc123')).toBe(true)
      })

      it('does not match child topic to parent', () => {
        expect(matchesTopic('execution:abc123', 'execution')).toBe(false)
      })

      it('does not match unrelated topics', () => {
        expect(matchesTopic('system', 'execution:abc123')).toBe(false)
      })

      it('matches nested hierarchical topics', () => {
        expect(matchesTopic('debug', 'debug:execution:abc123')).toBe(true)
        expect(matchesTopic('debug:execution', 'debug:execution:abc123')).toBe(true)
      })
    })
  })

  describe('Send Method', () => {
    beforeEach(async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
      })
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise
    })

    it('sends message to specified topic', () => {
      mockWebSocketInstance!.send.mockClear()

      client.send('execution:abc123', { action: 'pause' })

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"message"')
      )
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"topic":"execution:abc123"')
      )
      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        expect.stringContaining('"action":"pause"')
      )
    })

    it('throws when not connected', async () => {
      await client.disconnect()

      expect(() => client.send('execution:abc123', { action: 'pause' })).toThrow(
        'Cannot send message: not connected'
      )
    })

    it('returns promise for acknowledged sends', async () => {
      vi.useFakeTimers()

      mockWebSocketInstance!.send.mockClear()

      const sendPromise = client.send(
        'execution:abc123',
        { action: 'pause' },
        { requireAck: true, timeout: 5000 }
      )

      // Extract the ackId from the sent message
      const sentMessage = mockWebSocketInstance!.send.mock.calls.find((call) =>
        call[0].includes('"type":"message"')
      )
      expect(sentMessage).toBeDefined()
      const parsedMessage = JSON.parse(sentMessage![0]) as { ackId?: string }
      expect(parsedMessage.ackId).toBeDefined()

      // Simulate server ack with the actual ackId
      mockWebSocketInstance!.simulateMessage({
        type: 'ack',
        ackId: parsedMessage.ackId,
        success: true,
      })

      await vi.advanceTimersByTimeAsync(100)

      await expect(sendPromise).resolves.toMatchObject({
        ackId: parsedMessage.ackId,
        success: true,
      })
    })

    it('times out acknowledged sends', async () => {
      vi.useFakeTimers()

      const sendPromise = client.send(
        'execution:abc123',
        { action: 'pause' },
        { requireAck: true, timeout: 5000 }
      )

      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const rejectAssertion = expect(sendPromise).rejects.toMatchObject({
        type: 'timeout',
        message: 'Acknowledgment timeout',
      })

      await vi.advanceTimersByTimeAsync(5001)
      await rejectAssertion
    })
  })

  describe('Raw Frame Send (sendRaw)', () => {
    beforeEach(async () => {
      client = createWebSocketClient({
        url: 'wss://api.example.com/ws',
      })
      const connectPromise = client.connect()
      mockWebSocketInstance!.simulateOpen()
      await connectPromise
    })

    it('sends the frame verbatim with no envelope', () => {
      mockWebSocketInstance!.send.mockClear()

      client.sendRaw({ type: 'leaving', holderId: 'tab-1' })

      expect(mockWebSocketInstance!.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'leaving', holderId: 'tab-1' })
      )
    })

    it('drops the frame silently when not connected', async () => {
      await client.disconnect()
      mockWebSocketInstance!.send.mockClear()

      expect(() => client.sendRaw({ type: 'leaving', holderId: 'tab-1' })).not.toThrow()
      expect(mockWebSocketInstance!.send).not.toHaveBeenCalled()
    })
  })
})
