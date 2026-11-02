/**
 * WebSocket Client Utilities - REQ-5.2.1.4
 *
 * Stateless utility functions for error classification, topic parsing,
 * UUID generation, and error construction.
 */

import type { WebSocketErrorType, WebSocketError, TopicCategory, ReconnectConfig, HeartbeatConfig } from './types'
import { secureRandom } from '@/lib/utils'

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  enabled: true,
  // Bounded so a long BE outage doesn't churn dead sockets through the
  // browser's per-origin connection pool. After exhaustion the global
  // connection-monitor probe (HEAD /health) takes over recovery.
  maxAttempts: 5,
  baseDelay: 500,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
}

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  enabled: false,
  interval: 30000,
  timeout: 5000,
}

// Short per-attempt timeout so a backend bounce doesn't leave stale WS
// handshakes in the browser's CONNECTING state long enough to saturate
// the per-origin connection pool (Chrome caps at 6) and queue every
// subsequent HTTP request behind them.
export const CONNECTION_TIMEOUT = 5000

// WebSocket readyState constants (defined locally to avoid dependency on global WebSocket)
export const WS_CONNECTING = 0
export const WS_OPEN = 1

// ============================================================================
// Exported Utility Functions
// ============================================================================

/**
 * Classifies a WebSocket close code into an error type
 */
export function classifyWebSocketError(code: number): WebSocketErrorType {
  if (code === 1006) return 'network'
  if (code === 1001) return 'going_away'
  if (code === 1008) return 'policy_violation'
  if (code >= 4001 && code <= 4099) return 'server_rejection'
  if (code >= 4100 && code <= 4199) return 'subscription_error'
  return 'unknown'
}

/**
 * Determines if an error is reconnectable
 */
export function isReconnectableError(error: WebSocketError): boolean {
  const reconnectableTypes: WebSocketErrorType[] = ['network', 'timeout', 'going_away']
  return reconnectableTypes.includes(error.type)
}

/**
 * Parses the topic category from a topic string
 */
export function parseTopicCategory(topic: string): TopicCategory {
  const validCategories: TopicCategory[] = ['execution', 'system', 'debug', 'variable', 'error']
  const category = topic.split(':')[0] as TopicCategory
  return validCategories.includes(category) ? category : 'unknown'
}

/**
 * Checks if a subscription pattern matches a topic
 */
export function matchesTopic(pattern: string, topic: string): boolean {
  if (pattern === topic) return true
  if (topic.startsWith(pattern + ':')) return true
  return false
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Generates a UUID v4 for session identification
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(/[xy]/g, (c) => {
    const r = Math.trunc(secureRandom() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Creates a WebSocket error with proper typing
 */
export function createWebSocketError(
  type: WebSocketErrorType,
  message: string,
  code?: number,
  topic?: string
): WebSocketError {
  const error = new Error(message) as WebSocketError
  error.type = type
  error.code = code
  error.topic = topic
  error.isReconnectable = isReconnectableError({ type } as WebSocketError)
  return error
}

/**
 * Validates topic format
 */
export function isValidTopic(topic: string): boolean {
  if (!topic || topic.length === 0) return false
  if (topic.includes(' ')) return false
  return true
}

/**
 * Calculates reconnect delay with exponential backoff and optional jitter
 */
export function calculateReconnectDelay(reconnectConfig: ReconnectConfig, attempt: number): number {
  let delay = reconnectConfig.baseDelay * Math.pow(reconnectConfig.backoffMultiplier, attempt - 1)
  delay = Math.min(delay, reconnectConfig.maxDelay)

  if (reconnectConfig.jitter) {
    // Apply jitter: random factor between 0.5 and 1.5
    const jitterFactor = 0.5 + secureRandom()
    delay = delay * jitterFactor
  }

  return delay
}
