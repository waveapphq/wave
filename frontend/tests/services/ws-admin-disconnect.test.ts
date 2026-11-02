/**
 * WebSocket admin terminate - REQ-5.2.7.15
 *
 * A `session_terminated` frame drives the client into a terminal 'terminated'
 * ConnectionState and stops auto-reconnect. Mirrors the MockWebSocket harness
 * in services/websocket-client.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import type { WebSocketClient } from '@/services/websocket-client'
import { createWebSocketClient } from '@/services/websocket-client'
import { _resetConnectionMonitor } from '@/services/connection-monitor'

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

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    if (protocols) {
      this.protocol = Array.isArray(protocols) ? protocols[0] : protocols
    }
  }

  send = vi.fn()
  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code: code ?? 1000, reason: reason ?? '' }))
    }
  })

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

  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }))
    }
  }
}

let mockWebSocketInstance: MockWebSocket | null = null
const MockWebSocketConstructor = vi.fn((url: string, protocols?: string | string[]) => {
  mockWebSocketInstance = new MockWebSocket(url, protocols)
  return mockWebSocketInstance
})

// @ts-expect-error - Mock WebSocket globally
global.WebSocket = MockWebSocketConstructor

describe('WebSocket Client - admin session_terminated', () => {
  let client: WebSocketClient

  beforeEach(() => {
    vi.useFakeTimers()
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

  async function connectOpen(): Promise<void> {
    client = createWebSocketClient({
      url: 'wss://api.example.com/ws',
      clientType: 'web-ui',
    })
    const connectPromise = client.connect()
    mockWebSocketInstance!.simulateOpen()
    await connectPromise
  }

  it('enters the terminated state on a session_terminated frame', async () => {
    await connectOpen()
    MockWebSocketConstructor.mockClear()

    mockWebSocketInstance!.simulateMessage({ type: 'session_terminated' })

    const state: string = client.getState()
    expect(state).toBe('terminated')
  })

  it('does not auto-reconnect after termination when timers advance', async () => {
    await connectOpen()

    mockWebSocketInstance!.simulateMessage({ type: 'session_terminated' })
    MockWebSocketConstructor.mockClear()

    await vi.advanceTimersByTimeAsync(30000)

    expect(MockWebSocketConstructor).not.toHaveBeenCalled()
    const state: string = client.getState()
    expect(state).toBe('terminated')
  })

  it('does not reconnect on a later abnormal close after termination', async () => {
    await connectOpen()

    mockWebSocketInstance!.simulateMessage({ type: 'session_terminated' })
    MockWebSocketConstructor.mockClear()

    mockWebSocketInstance!.simulateClose(1006, 'x')
    await vi.advanceTimersByTimeAsync(30000)

    expect(MockWebSocketConstructor).not.toHaveBeenCalled()
  })

  it('a mounted hook re-calling connect() after termination never revives the socket', async () => {
    await connectOpen()

    mockWebSocketInstance!.simulateMessage({ type: 'session_terminated' })
    MockWebSocketConstructor.mockClear()

    // A hook re-running its subscribe effect on the isConnected true->false edge.
    await client.connect()

    expect(MockWebSocketConstructor).not.toHaveBeenCalled()
    expect(client.getState()).toBe('terminated')
  })
})
