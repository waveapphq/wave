/**
 * Singleton API client instance for all HTTP communication.
 *
 * Centralizes the base URL resolution and provides a configured ApiClient
 * that all API modules should use instead of raw fetch().
 *
 * REQ-5.2.1.15: Unified API client with retry, circuit breaker, and error classification
 */

import { createApiClient } from '@/services/api-client'
import type { ApiClient } from '@/services/api-client'

/**
 * Get the base URL for all API calls.
 *
 * In dev (no env override) returns `${origin}/api` so all FE -> BE
 * traffic flows through Vite's proxy. That keeps everything in the same
 * Network Isolation Key pool as the page, avoiding the cross-origin
 * pool poisoning that BE bounces would otherwise cause in Chrome (the
 * pool for `localhost:3000 -> localhost:8000` accumulates stale state
 * that only browser-process exit can clear).
 *
 * Prod sets VITE_API_BASE_URL explicitly and bypasses the dev proxy.
 */
export function getApiBaseUrl(): string {
  /* v8 ignore start - COV-SSR-008 */
  if (globalThis.window === undefined) {
    return 'http://localhost:8000'
  }
  /* v8 ignore stop */
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }
  return `${globalThis.location.origin}/api`
}

/**
 * Singleton API client instance.
 *
 * Configured with the base URL from environment. Provides retry logic,
 * circuit breaker, and structured error classification.
 */
export const apiClient: ApiClient = createApiClient({
  baseUrl: getApiBaseUrl(),
  defaultHeaders: { 'Content-Type': 'application/json' },
})

export type { ApiClient } from '@/services/api-client'
