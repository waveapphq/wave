/**
 * WebSocket Store - REQ-5.2.1.4 WebSocket client state management
 *
 * Zustand store for managing WebSocket connection state and subscriptions.
 * Provides a simple interface for components to subscribe to real-time events.
 */

import { create } from 'zustand'
import {
  createWebSocketClient,
  type WebSocketClient,
  type ConnectionState,
  type EventHandler,
  type Subscription,
  type SubscriptionOptions,
} from '@/services/websocket-client'
import { useConnectionMonitor } from '@/services/connection-monitor'
import { alreadyReported } from '@/features/workbench/lib/already-reported'

// ===========================================================================
// Types
// ===========================================================================

interface WebSocketState {
  // Connection state
  isConnected: boolean
  state: ConnectionState
  sessionId: string | undefined
  latency: number | undefined

  // Client instance (internal)
  _client: WebSocketClient | null

  // Actions
  connect: (url?: string) => Promise<void>
  disconnect: () => Promise<void>
  subscribe: <T = unknown>(
    topic: string,
    handler: EventHandler<T>,
    options?: SubscriptionOptions
  ) => Subscription
  subscribeAsync: <T = unknown>(
    topic: string,
    handler: EventHandler<T>,
    options?: SubscriptionOptions,
    timeout?: number
  ) => Promise<Subscription>
  getSubscriptions: () => string[]
  /** Send one raw protocol frame verbatim; silently dropped with no live socket. */
  sendFrame: (message: Record<string, unknown>) => void
}

// ===========================================================================
// Default Configuration
// ===========================================================================

function getDefaultWebSocketUrl(): string {
  /* v8 ignore start - COV-SSR-008 */
  if (globalThis.window === undefined) {
    return 'ws://localhost:8000/ws'
  }
  /* v8 ignore stop */
  const wsUrl = import.meta.env.VITE_WS_URL
  if (wsUrl) return wsUrl

  // When VITE_API_BASE_URL is set (prod), derive WS from it.
  const apiUrl = import.meta.env.VITE_API_BASE_URL
  if (apiUrl) {
    const wsProtocol = apiUrl.startsWith('https') ? 'wss' : 'ws'
    const host = apiUrl.replace(/^https?:\/\//, '')
    return `${wsProtocol}://${host}/ws`
  }

  // Dev: route through Vite's /ws proxy on the page's own host so the
  // WebSocket lives in the same NIK pool as everything else.
  const wsProtocol = globalThis.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${wsProtocol}://${globalThis.location.host}/ws`
}

// ===========================================================================
// Store Implementation
// ===========================================================================

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  isConnected: false,
  state: 'disconnected',
  sessionId: undefined,
  latency: undefined,
  _client: null,

  connect: async (url?: string) => {
    const state = get()

    // Singleton pattern: If already connected, return early
    if (state.isConnected) {
      return
    }

    // If client exists but not connected, reconnect it (don't create new client)
    if (state._client) {
      // If connecting is already in progress, don't start another
      if (state.state === 'connecting') {
        return
      }
      // Reconnect existing client
      await state._client.connect()
      return
    }

    // Create new client only if none exists
    const wsUrl = url || getDefaultWebSocketUrl()
    const client = createWebSocketClient({ url: wsUrl })

    // Set up state change listener
    client.onStateChange((connectionState) => {
      set({
        state: connectionState,
        isConnected: connectionState === 'connected',
        sessionId: client.getSessionId(),
      })
    })

    // Store client BEFORE connecting to prevent race conditions
    // (React Strict Mode may call connect() twice rapidly)
    set({ _client: client, state: 'connecting' })

    await client.connect()
  },

  disconnect: async () => {
    const { _client } = get()
    if (_client) {
      await _client.disconnect()
      set({
        _client: null,
        isConnected: false,
        state: 'disconnected',
        sessionId: undefined,
        latency: undefined,
      })
    }
  },

  subscribe: <T = unknown>(
    topic: string,
    handler: EventHandler<T>,
    options?: SubscriptionOptions
  ): Subscription => {
    const { _client } = get()
    if (!_client) {
      // Return a no-op subscription if not connected
      return {
        topic,
        unsubscribe: () => {},
      }
    }
    return _client.subscribe(topic, handler, options)
  },

  subscribeAsync: async <T = unknown>(
    topic: string,
    handler: EventHandler<T>,
    options?: SubscriptionOptions,
    timeout?: number
  ): Promise<Subscription> => {
    const { _client } = get()
    if (!_client) {
      // Return a no-op subscription if not connected
      return {
        topic,
        unsubscribe: () => {},
      }
    }
    return _client.subscribeAsync(topic, handler, options, timeout)
  },

  getSubscriptions: () => {
    const { _client } = get()
    return _client?.getSubscriptions() ?? []
  },

  sendFrame: (message: Record<string, unknown>) => {
    get()._client?.sendRaw(message)
  },
}))

// Bridge to the global connection monitor: when the BE outage probe
// trips offline, halt the WS client's own reconnect loop so it does not
// pile dead sockets into the browser's per-origin pool. When the probe
// recovers, reconnect the existing client (subscribers re-subscribe via
// their useEffect deps reacting to isConnected).
let lastConnectionStatus = useConnectionMonitor.getState().status
useConnectionMonitor.subscribe((state) => {
  if (state.status === lastConnectionStatus) return
  const previous = lastConnectionStatus
  lastConnectionStatus = state.status

  const client = useWebSocketStore.getState()._client
  if (!client) return

  if (state.status === 'offline') {
    client.disconnect().catch(alreadyReported)
  } else if (previous === 'offline' && state.status === 'online') {
    void client.connect().catch(() => undefined)
  }
})
