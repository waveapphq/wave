/**
 * WebSocket Client Context - REQ-5.2.1.4
 *
 * Shared mutable context object used by the client implementation modules.
 * This enables splitting the client closure into focused modules while
 * sharing state without duplicating closure variables.
 */

import type {
  ConnectionState,
  WebSocketClientConfig,
  HandlerEntry,
  PendingAck,
  WebSocketError,
  StateChangeCallback,
  ErrorCallback,
  EventCallback,
  ConnectionInfoCallback,
  AcknowledgmentCallback,
  SequenceGapCallback,
  AcknowledgmentResponse,
  BaseEvent,
  SequenceGapInfo,
} from './types'

/**
 * Internal shared state for the WebSocket client implementation
 */
export interface ClientContext {
  // Configuration
  readonly config: WebSocketClientConfig

  // Connection state
  state: ConnectionState
  ws: WebSocket | null
  sessionId: string | undefined
  connectedAt: Date | undefined
  latency: number | undefined
  reconnectAttempt: number
  isExplicitDisconnect: boolean
  /** Admin-terminated: a terminal state that never auto-reconnects. */
  isTerminated: boolean

  // Timers
  reconnectTimeout: ReturnType<typeof setTimeout> | null
  connectionTimeout: ReturnType<typeof setTimeout> | null
  heartbeatTimeout: ReturnType<typeof setTimeout> | null

  // Connect promise handlers
  connectPromiseResolve: (() => void) | null
  connectPromiseReject: ((error: WebSocketError) => void) | null

  // Subscription management
  readonly subscriptions: Map<string, HandlerEntry[]>
  readonly topicSequences: Map<string, number>
  readonly pendingSubscriptionConfirmations: Map<string, () => void>
  readonly pendingAcks: Map<string, PendingAck>

  // Event listener sets
  readonly stateChangeCallbacks: Set<StateChangeCallback>
  readonly errorCallbacks: Set<ErrorCallback>
  readonly eventCallbacks: Set<EventCallback>
  readonly connectionInfoCallbacks: Set<ConnectionInfoCallback>
  readonly acknowledgmentCallbacks: Set<AcknowledgmentCallback>
  readonly sequenceGapCallbacks: Set<SequenceGapCallback>
}

/**
 * Creates a new client context with the given configuration
 */
export function createClientContext(config: WebSocketClientConfig): ClientContext {
  return {
    config,
    state: 'disconnected',
    ws: null,
    sessionId: undefined,
    connectedAt: undefined,
    latency: undefined,
    reconnectAttempt: 0,
    isExplicitDisconnect: false,
    isTerminated: false,
    reconnectTimeout: null,
    connectionTimeout: null,
    heartbeatTimeout: null,
    connectPromiseResolve: null,
    connectPromiseReject: null,
    subscriptions: new Map(),
    topicSequences: new Map(),
    pendingSubscriptionConfirmations: new Map(),
    pendingAcks: new Map(),
    stateChangeCallbacks: new Set(),
    errorCallbacks: new Set(),
    eventCallbacks: new Set(),
    connectionInfoCallbacks: new Set(),
    acknowledgmentCallbacks: new Set(),
    sequenceGapCallbacks: new Set(),
  }
}

// ============================================================================
// Shared Emit & State Helpers
// ============================================================================

/**
 * Sets the connection state and notifies listeners
 */
export function setState(ctx: ClientContext, newState: ConnectionState): void {
  if (ctx.state !== newState) {
    ctx.state = newState
    ctx.stateChangeCallbacks.forEach((cb) => {
      try {
        cb(newState)
      } catch {
        // Ignore errors in callbacks
      }
    })
  }
}

/**
 * Emits an error to all registered error callbacks
 */
export function emitError(ctx: ClientContext, error: WebSocketError): void {
  ctx.errorCallbacks.forEach((cb) => {
    try {
      cb(error)
    } catch {
      // Ignore errors in callbacks
    }
  })
}

/**
 * Emits a base event to all registered event callbacks
 */
export function emitEvent(ctx: ClientContext, event: BaseEvent): void {
  ctx.eventCallbacks.forEach((cb) => {
    try {
      cb(event)
    } catch {
      // Ignore errors in callbacks
    }
  })
}

/**
 * Emits an acknowledgment response to all registered ack callbacks
 */
export function emitAcknowledgment(ctx: ClientContext, response: AcknowledgmentResponse): void {
  ctx.acknowledgmentCallbacks.forEach((cb) => {
    try {
      cb(response)
    } catch {
      // Ignore errors in callbacks
    }
  })
}

/**
 * Emits a sequence gap to all registered gap callbacks
 */
export function emitSequenceGap(ctx: ClientContext, gap: SequenceGapInfo): void {
  ctx.sequenceGapCallbacks.forEach((cb) => {
    try {
      cb(gap)
    } catch {
      // Ignore errors in callbacks
    }
  })
}

/**
 * Sends a message over the WebSocket if connected
 */
export function sendMessage(ctx: ClientContext, message: Record<string, unknown>): void {
  if (ctx.ws?.readyState === 1 /* WS_OPEN */) {
    ctx.ws.send(JSON.stringify(message))
  }
}

/**
 * Clears all active timers
 */
export function clearTimers(ctx: ClientContext): void {
  if (ctx.reconnectTimeout) {
    clearTimeout(ctx.reconnectTimeout)
    ctx.reconnectTimeout = null
  }
  if (ctx.connectionTimeout) {
    clearTimeout(ctx.connectionTimeout)
    ctx.connectionTimeout = null
  }
  if (ctx.heartbeatTimeout) {
    clearTimeout(ctx.heartbeatTimeout)
    ctx.heartbeatTimeout = null
  }
}
