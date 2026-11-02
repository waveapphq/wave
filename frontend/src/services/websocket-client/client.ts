/**
 * WebSocket Client - REQ-5.2.1.4 WebSocket client for real-time updates
 *
 * This module provides bidirectional, real-time communication between the frontend
 * and backend, enabling instant delivery of execution events, status updates, and
 * system notifications without HTTP polling overhead.
 *
 * Entry point: creates and configures the WebSocket client instance.
 * Internal logic is split across focused modules:
 *   - types.ts: All type definitions
 *   - utils.ts: Stateless utility functions and constants
 *   - client-context.ts: Shared mutable state and emit helpers
 *   - connection.ts: Connection lifecycle and reconnection
 *   - message-handler.ts: Incoming message dispatch
 *   - heartbeat.ts: Heartbeat timer management
 */

import type {
  WebSocketClient,
  WebSocketClientConfig,
  EventHandler,
  SubscriptionOptions,
  SendOptions,
  AcknowledgmentResponse,
} from './types'
import {
  DEFAULT_RECONNECT_CONFIG,
  DEFAULT_HEARTBEAT_CONFIG,
  WS_OPEN,
  generateUUID,
  createWebSocketError,
  isValidTopic,
} from './utils'
import { createClientContext, setState, sendMessage, clearTimers } from './client-context'
import { performConnect } from './connection'

// Re-export everything for barrel consumers
export * from './types'
export { classifyWebSocketError, isReconnectableError, parseTopicCategory, matchesTopic } from './utils'

/**
 * Creates a WebSocket client instance with the given configuration
 */
export function createWebSocketClient(config: WebSocketClientConfig): WebSocketClient {
  // Validate config
  if (!config.url) {
    throw new Error('url is required')
  }

  if (!config.url.startsWith('ws://') && !config.url.startsWith('wss://')) {
    throw new Error('url must use ws or wss protocol')
  }

  // Merge with defaults
  const resolvedConfig: WebSocketClientConfig = {
    ...config,
    reconnect: { ...DEFAULT_RECONNECT_CONFIG, ...config.reconnect },
    heartbeat: { ...DEFAULT_HEARTBEAT_CONFIG, ...config.heartbeat },
  }

  // Create shared context
  const ctx = createClientContext(resolvedConfig)

  // ========================================================================
  // Public API
  // ========================================================================

  const client: WebSocketClient = {
    connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (ctx.state === 'connected') {
          resolve()
          return
        }

        if (ctx.isTerminated) {
          // Terminal admin-disconnect: a mounted hook re-running connect() on the
          // isConnected true->false edge must NOT revive the socket. Only a reload does.
          resolve()
          return
        }

        ctx.connectPromiseResolve = resolve
        ctx.connectPromiseReject = reject
        performConnect(ctx, false)
      })
    },

    async disconnect(): Promise<void> {
      ctx.isExplicitDisconnect = true
      clearTimers(ctx)

      // Clear pending acks
      ctx.pendingAcks.forEach((pending) => {
        clearTimeout(pending.timeout)
        pending.reject(createWebSocketError('network', 'Connection closed'))
      })
      ctx.pendingAcks.clear()

      if (ctx.ws?.readyState === WS_OPEN) {
        // Send disconnect message
        sendMessage(ctx, {
          type: 'disconnect',
          timestamp: Date.now(),
        })

        ctx.ws.close(1000, 'Client disconnecting')
      }

      // Clear session on explicit disconnect
      ctx.sessionId = undefined
      ctx.connectedAt = undefined
      ctx.latency = undefined

      setState(ctx, 'disconnected')
    },

    getState() {
      return ctx.state
    },

    getSessionId() {
      return ctx.sessionId
    },

    getConnectionInfo() {
      return {
        url: resolvedConfig.url,
        state: ctx.state,
        sessionId: ctx.sessionId,
        connectedAt: ctx.connectedAt,
        latency: ctx.latency,
        reconnectAttempt: ctx.state === 'reconnecting' ? ctx.reconnectAttempt : undefined,
        maxReconnectAttempts: resolvedConfig.reconnect?.maxAttempts,
      }
    },

    getConfig() {
      return resolvedConfig
    },

    subscribe<T = unknown>(
      topic: string,
      handler: EventHandler<T>,
      options?: SubscriptionOptions
    ) {
      if (!isValidTopic(topic)) {
        throw new Error('Invalid topic format')
      }

      const handlers = ctx.subscriptions.get(topic) ?? []
      const isFirstHandler = handlers.length === 0

      handlers.push({ handler: handler as EventHandler<unknown>, options })
      ctx.subscriptions.set(topic, handlers)

      // Only send subscribe message for first handler
      if (isFirstHandler && ctx.ws?.readyState === WS_OPEN) {
        sendMessage(ctx, {
          type: 'subscribe',
          topic,
          ...(options?.acknowledgment ? { acknowledgment: true } : {}),
          ...(options?.level ? { level: options.level } : {}),
        })
      }

      return {
        topic,
        unsubscribe: (): void => {
          const currentHandlers = ctx.subscriptions.get(topic)
          if (!currentHandlers) return

          const index = currentHandlers.findIndex((h) => h.handler === handler)
          if (index !== -1) {
            currentHandlers.splice(index, 1)
          }

          // Only send unsubscribe when all handlers are removed
          if (currentHandlers.length === 0) {
            ctx.subscriptions.delete(topic)
            if (ctx.ws?.readyState === WS_OPEN) {
              sendMessage(ctx, {
                type: 'unsubscribe',
                topic,
              })
            }
          }
        },
        send: (message: Record<string, unknown>): void => {
          if (ctx.ws?.readyState === WS_OPEN) {
            sendMessage(ctx, message)
          }
        },
      }
    },

    async subscribeAsync<T = unknown>(
      topic: string,
      handler: EventHandler<T>,
      options?: SubscriptionOptions,
      timeout: number = 5000
    ) {
      const subscription = this.subscribe(topic, handler, options)

      // Wait for server confirmation
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          ctx.pendingSubscriptionConfirmations.delete(topic)
          reject(new Error(`Subscription confirmation timeout for topic: ${topic}`))
        }, timeout)

        ctx.pendingSubscriptionConfirmations.set(topic, () => {
          clearTimeout(timeoutId)
          resolve()
        })
      })

      return subscription
    },

    getSubscriptions() {
      return Array.from(ctx.subscriptions.keys())
    },

    send(
      topic: string,
      payload: unknown,
      options?: SendOptions
    ): Promise<AcknowledgmentResponse> | void {
      if (ctx.state !== 'connected' || ctx.ws?.readyState !== WS_OPEN) {
        throw new Error('Cannot send message: not connected')
      }

      const message: Record<string, unknown> = {
        type: 'message',
        topic,
        payload,
        timestamp: Date.now(),
      }

      if (options?.requireAck) {
        const ackId = generateUUID()
        message.ackId = ackId

        sendMessage(ctx, message)

        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            ctx.pendingAcks.delete(ackId)
            reject(createWebSocketError('timeout', 'Acknowledgment timeout'))
          }, options.timeout ?? 5000)

          ctx.pendingAcks.set(ackId, { resolve, reject, timeout })
        })
      }

      sendMessage(ctx, message)
    },

    sendRaw(message: Record<string, unknown>): void {
      sendMessage(ctx, message)
    },

    onStateChange(callback) {
      ctx.stateChangeCallbacks.add(callback)
      return () => ctx.stateChangeCallbacks.delete(callback)
    },

    onError(callback) {
      ctx.errorCallbacks.add(callback)
      return () => ctx.errorCallbacks.delete(callback)
    },

    onEvent(callback) {
      ctx.eventCallbacks.add(callback)
      return () => ctx.eventCallbacks.delete(callback)
    },

    onConnectionInfo(callback) {
      ctx.connectionInfoCallbacks.add(callback)
      return () => ctx.connectionInfoCallbacks.delete(callback)
    },

    onAcknowledgment(callback) {
      ctx.acknowledgmentCallbacks.add(callback)
      return () => ctx.acknowledgmentCallbacks.delete(callback)
    },

    onSequenceGap(callback) {
      ctx.sequenceGapCallbacks.add(callback)
      return () => ctx.sequenceGapCallbacks.delete(callback)
    },
  }

  return client
}
