/**
 * Circuit Breaker - REQ-5.2.1.3 REST API client layer with error handling
 *
 * Implements the circuit breaker resilience pattern to prevent cascading failures
 * when backend endpoints become unavailable.
 */

import type { CircuitBreakerConfig } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Circuit breaker state per endpoint
 */
export interface CircuitBreakerState {
  failures: number
  state: 'closed' | 'open' | 'half-open'
  lastFailureTime: number
}

/**
 * Circuit breaker manager for tracking endpoint health
 */
export interface CircuitBreakerManager {
  /** Check if circuit is open and should block request */
  shouldBlockRequest(path: string): boolean
  /** Record a failure for the given path */
  recordFailure(path: string): void
  /** Record a success for the given path (resets circuit) */
  recordSuccess(path: string): void
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Creates a circuit breaker manager for the given configuration.
 *
 * If no config is provided, all operations are no-ops (circuit never opens).
 */
export function createCircuitBreakerManager(
  config: CircuitBreakerConfig | undefined
): CircuitBreakerManager {
  const circuitBreakers = new Map<string, CircuitBreakerState>()

  /**
   * Get or create circuit breaker state for an endpoint
   */
  function getCircuitBreaker(path: string): CircuitBreakerState {
    if (!circuitBreakers.has(path)) {
      circuitBreakers.set(path, {
        failures: 0,
        state: 'closed',
        lastFailureTime: 0,
      })
    }
    // We just ensured the path exists, so get() will return a value
    return circuitBreakers.get(path)!
  }

  return {
    shouldBlockRequest(path: string): boolean {
      if (!config) return false

      const cb = getCircuitBreaker(path)
      if (cb.state === 'open') {
        const now = Date.now()
        if (now - cb.lastFailureTime >= config.resetTimeout) {
          // Transition to half-open
          cb.state = 'half-open'
          return false
        }
        return true
      }
      return false
    },

    recordFailure(path: string): void {
      if (!config) return

      const cb = getCircuitBreaker(path)
      cb.failures++
      cb.lastFailureTime = Date.now()

      if (cb.state === 'half-open' || cb.failures >= config.failureThreshold) {
        // Failure in half-open reopens the circuit; threshold breach also opens it
        cb.state = 'open'
      }
    },

    recordSuccess(path: string): void {
      if (!config) return

      const cb = getCircuitBreaker(path)
      cb.failures = 0
      cb.state = 'closed'
    },
  }
}
