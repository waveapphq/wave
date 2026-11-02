/**
 * WebSocket Client Types - REQ-5.2.1.4
 *
 * Type definitions for the WebSocket client, including connection states,
 * event types, configuration, and the client interface.
 */

import type { BaseEvent } from './events'

// ============================================================================
// Connection & Error Types
// ============================================================================

/**
 * Connection states for the WebSocket client
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'terminated'

/**
 * Topic categories for subscription management
 */
export type TopicCategory = 'execution' | 'system' | 'debug' | 'variable' | 'error' | 'unknown'

/**
 * WebSocket error types for classification
 */
export type WebSocketErrorType =
  | 'network'
  | 'timeout'
  | 'server_rejection'
  | 'protocol_error'
  | 'subscription_error'
  | 'policy_violation'
  | 'going_away'
  | 'connection_failed'
  | 'unknown'

/**
 * Structured WebSocket error with full context
 */
export interface WebSocketError extends Error {
  type: WebSocketErrorType
  code?: number
  topic?: string
  isReconnectable: boolean
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Reconnection configuration
 */
export interface ReconnectConfig {
  enabled: boolean
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
  jitter: boolean
}

/**
 * Heartbeat configuration
 */
export interface HeartbeatConfig {
  enabled: boolean
  interval: number
  timeout: number
}

/**
 * WebSocket client configuration
 */
export interface WebSocketClientConfig {
  url: string
  clientType?: string
  reconnect?: ReconnectConfig
  heartbeat?: HeartbeatConfig
  protocols?: string[]
}

/**
 * Connection information
 */
export interface ConnectionInfo {
  url: string
  state: ConnectionState
  sessionId?: string
  connectedAt?: Date
  latency?: number
  reconnectAttempt?: number
  maxReconnectAttempts?: number
}

// ============================================================================
// Subscription & Messaging Types
// ============================================================================

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  acknowledgment?: boolean
  /** Log level filter for log topic subscriptions */
  level?: string
}

/**
 * Send options
 */
export interface SendOptions {
  requireAck?: boolean
  timeout?: number
}

/**
 * Subscription handle returned from subscribe
 */
export interface Subscription {
  topic: string
  unsubscribe: () => void
  /** Send a raw (already-shaped) message through the subscription's socket.
   *  Used by log pagination which needs to reach the backend's top-level
   *  router with a specific message type (e.g. `request_history`) rather
   *  than the wrapped `{type:"message", topic, payload}` envelope used by
   *  the client's generic `send(topic, payload)` call. */
  send?: (message: Record<string, unknown>) => void
}

/**
 * Event metadata included with each event
 */
export interface EventMetadata {
  topic: string
  timestamp: number
  sequence: number
}

/**
 * Event handler function signature
 */
export type EventHandler<T = unknown> = (payload: T, metadata: EventMetadata) => void

/**
 * Message envelope structure
 */
export interface MessageEnvelope {
  type: string
  topic?: string
  payload?: unknown
  timestamp?: number
  sequence?: number
  ackId?: string
  compressed?: boolean
}

/**
 * Acknowledgment response
 */
export interface AcknowledgmentResponse {
  ackId: string
  success: boolean
  error?: string
}

/**
 * Sequence gap information
 */
export interface SequenceGapInfo {
  topic: string
  expected: number
  received: number
}

// ============================================================================
// Event Types (re-exported from events.ts)
// ============================================================================

export type {
  BaseEvent,
  ExecutionEvent,
  SystemEvent,
  DebugEvent,
  VariableEvent,
  ErrorEvent,
  WebSocketEvent,
} from './events'

// ============================================================================
// Callback Types
// ============================================================================

/**
 * State change callback
 */
export type StateChangeCallback = (state: ConnectionState) => void

/**
 * Error callback
 */
export type ErrorCallback = (error: WebSocketError) => void

/**
 * Event callback for store integration
 */
export type EventCallback = (event: BaseEvent) => void

/**
 * Connection info callback
 */
export type ConnectionInfoCallback = (info: ConnectionInfo) => void

/**
 * Acknowledgment callback
 */
export type AcknowledgmentCallback = (response: AcknowledgmentResponse) => void

/**
 * Sequence gap callback
 */
export type SequenceGapCallback = (gap: SequenceGapInfo) => void

// ============================================================================
// Client Interface
// ============================================================================

/**
 * WebSocket client interface
 */
export interface WebSocketClient {
  // Connection lifecycle
  connect(): Promise<void>
  disconnect(): Promise<void>
  getState(): ConnectionState
  getSessionId(): string | undefined
  getConnectionInfo(): ConnectionInfo
  getConfig(): WebSocketClientConfig

  // Subscription management
  subscribe<T = unknown>(
    topic: string,
    handler: EventHandler<T>,
    options?: SubscriptionOptions
  ): Subscription
  subscribeAsync<T = unknown>(
    topic: string,
    handler: EventHandler<T>,
    options?: SubscriptionOptions,
    timeout?: number
  ): Promise<Subscription>
  getSubscriptions(): string[]

  // Messaging
  send(topic: string, payload: unknown, options?: SendOptions): Promise<AcknowledgmentResponse> | void
  /** Send one raw protocol frame verbatim; silently dropped while not connected. */
  sendRaw(message: Record<string, unknown>): void

  // Event listeners
  onStateChange(callback: StateChangeCallback): () => void
  onError(callback: ErrorCallback): () => void
  onEvent(callback: EventCallback): () => void
  onConnectionInfo(callback: ConnectionInfoCallback): () => void
  onAcknowledgment(callback: AcknowledgmentCallback): () => void
  onSequenceGap(callback: SequenceGapCallback): () => void
}

// ============================================================================
// Internal Types (used by client implementation modules)
// ============================================================================

/**
 * Internal handler entry for subscription management
 */
export interface HandlerEntry {
  handler: EventHandler<unknown>
  options?: SubscriptionOptions
}

/**
 * Pending acknowledgment tracker
 */
export interface PendingAck {
  resolve: (response: AcknowledgmentResponse) => void
  reject: (error: WebSocketError) => void
  timeout: ReturnType<typeof setTimeout>
}
