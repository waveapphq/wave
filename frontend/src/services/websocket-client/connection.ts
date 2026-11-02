/**
 * WebSocket Connection Management - REQ-5.2.1.4
 *
 * Handles connection lifecycle: establishing connections, reconnection
 * scheduling with exponential backoff, and resubscription after reconnect.
 */

import type { ClientContext } from './client-context'
import { setState, emitError, sendMessage, clearTimers } from './client-context'
import { classifyWebSocketError, createWebSocketError, generateUUID, calculateReconnectDelay, CONNECTION_TIMEOUT, WS_CONNECTING } from './utils'
import { handleMessage } from './message-handler'
import { resetHeartbeatTimer } from './heartbeat'
import { reportFailure as reportConnectionFailure } from '@/services/connection-monitor'

/**
 * Schedules a reconnection attempt with exponential backoff
 */
export function scheduleReconnect(ctx: ClientContext): void {
  const reconnectConfig = ctx.config.reconnect!

  if (!reconnectConfig.enabled || ctx.isExplicitDisconnect) {
    setState(ctx, 'disconnected')
    return
  }

  if (ctx.reconnectAttempt >= reconnectConfig.maxAttempts) {
    setState(ctx, 'disconnected')
    // Hand off to the global connection monitor so its probe loop drives
    // recovery instead of letting the WS retry forever.
    reportConnectionFailure()
    return
  }

  setState(ctx, 'reconnecting')
  ctx.reconnectAttempt++

  const delay = calculateReconnectDelay(reconnectConfig, ctx.reconnectAttempt)
  ctx.reconnectTimeout = setTimeout(() => {
    performConnect(ctx, true)
  }, delay)
}

/**
 * Resubscribes to all active topics (after reconnection)
 */
function resubscribeAll(ctx: ClientContext): void {
  ctx.subscriptions.forEach((handlers, topic) => {
    if (handlers.length > 0) {
      const firstHandler = handlers[0]
      sendMessage(ctx, {
        type: 'subscribe',
        topic,
        ...(firstHandler.options?.acknowledgment ? { acknowledgment: true } : {}),
        ...(firstHandler.options?.level ? { level: firstHandler.options.level } : {}),
      })
    }
  })
}

/**
 * Establishes a WebSocket connection
 */
export function performConnect(ctx: ClientContext, isReconnect: boolean = false): void {
  if (!isReconnect) {
    // Generate session ID for new connections
    if (!ctx.sessionId) {
      ctx.sessionId = generateUUID()
    }
    ctx.reconnectAttempt = 0
    ctx.isExplicitDisconnect = false
  }

  // Close any stale socket before opening a new one. Detach the handlers
  // first so the old socket's onclose doesn't trigger another reconnect
  // on top of this one.
  if (ctx.ws) {
    ctx.ws.onopen = null
    ctx.ws.onclose = null
    ctx.ws.onerror = null
    ctx.ws.onmessage = null
    try {
      ctx.ws.close()
    } catch {
      /* ignore */
    }
    ctx.ws = null
  }

  setState(ctx, 'connecting')

  // Only use protocols if explicitly configured - browser rejects if server doesn't accept
  ctx.ws = new WebSocket(ctx.config.url, ctx.config.protocols)

  // Set up connection timeout
  ctx.connectionTimeout = setTimeout(() => {
    if (ctx.ws?.readyState === WS_CONNECTING) {
      const error = createWebSocketError('timeout', 'Connection timeout')

      // Reject BEFORE closing to prevent onclose from rejecting with different error
      if (!isReconnect && ctx.connectPromiseReject) {
        ctx.connectPromiseReject(error)
        ctx.connectPromiseResolve = null
        ctx.connectPromiseReject = null
      }

      emitError(ctx, error)
      ctx.ws.close()
      scheduleReconnect(ctx)
    }
  }, CONNECTION_TIMEOUT)

  ctx.ws.onopen = (): void => {
    if (ctx.connectionTimeout) {
      clearTimeout(ctx.connectionTimeout)
      ctx.connectionTimeout = null
    }

    setState(ctx, 'connected')
    ctx.connectedAt = new Date()
    ctx.reconnectAttempt = 0

    // Send identification message
    sendMessage(ctx, {
      type: 'identify',
      clientType: ctx.config.clientType ?? 'web-ui',
      sessionId: ctx.sessionId,
      timestamp: Date.now(),
    })

    // Resubscribe to topics after reconnection
    if (isReconnect) {
      resubscribeAll(ctx)
    }

    // Start heartbeat timer
    resetHeartbeatTimer(ctx)

    // Resolve connect promise
    if (ctx.connectPromiseResolve) {
      ctx.connectPromiseResolve()
      ctx.connectPromiseResolve = null
      ctx.connectPromiseReject = null
    }
  }

  ctx.ws.onclose = (event: CloseEvent): void => {
    clearTimers(ctx)

    // Admin termination is terminal: never reconnect, never leave the state.
    if (ctx.isTerminated) {
      return
    }

    const errorType = classifyWebSocketError(event.code)
    const error = createWebSocketError(errorType, event.reason || 'Connection closed', event.code)

    // If this is during initial connect, reject the promise
    if (ctx.connectPromiseReject && !isReconnect) {
      const connectError = createWebSocketError('connection_failed', event.reason || 'Connection failed', event.code)
      ctx.connectPromiseReject(connectError)
      ctx.connectPromiseResolve = null
      ctx.connectPromiseReject = null
    }

    if (event.code !== 1000) {
      emitError(ctx, error)
    }

    // Schedule reconnect if not explicit disconnect
    if (!ctx.isExplicitDisconnect && event.code !== 1000) {
      scheduleReconnect(ctx)
    } else {
      setState(ctx, 'disconnected')
    }
  }

  ctx.ws.onerror = (): void => {
    // Error handling is done in onclose
  }

  ctx.ws.onmessage = (event: MessageEvent<string | ArrayBuffer>): void => {
    handleMessage(ctx, event.data)
  }
}
