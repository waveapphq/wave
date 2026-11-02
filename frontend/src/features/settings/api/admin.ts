/**
 * Admin API Client
 *
 * REQ-3.7.2.6: Log levels (DEBUG, INFO, WARN, ERROR, FATAL)
 *
 * Provides functions to fetch and set backend log level via the admin API.
 */

import { apiClient } from '@/lib/api'
import type { LogLevel } from '@/lib/log-levels'

// ============================================================================
// Types
// ============================================================================

/**
 * API response for log level endpoints
 */
export interface LogLevelApiResponse {
  level: LogLevel
}

// ============================================================================
// Standard HTTP status texts for distinguishing backend detail from fallback
// ============================================================================

/** The supported answer for the admin API being switched off; an answer, never a failure. */
export const ADMIN_NOT_ENABLED_MESSAGE = 'Admin API is not enabled on this server'

const HTTP_STATUS_TEXTS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

// ============================================================================
// Error Mapping
// ============================================================================

/**
 * Map an apiClient error to the admin-specific Error format.
 *
 * - 503 → "Admin API service unavailable"
 * - 403 → "Admin API is not enabled on this server"
 * - Errors with backend detail → detail message directly
 * - Errors without detail (statusText only) → "{prefix}: {statusText}"
 * - Non-HTTP errors (network, parse) → propagate as-is
 */
function mapAdminError(e: unknown, prefix: string): Error {
  if (e && typeof e === 'object' && 'status' in e) {
    const err = e as { status: number; message: string }
    if (err.status === 503) return new Error('Admin API service unavailable')
    if (err.status === 403) return new Error(ADMIN_NOT_ENABLED_MESSAGE)
    // If the message differs from the standard HTTP status text for this status,
    // it came from the backend's detail field - use it directly.
    // Otherwise, prefix it with context.
    const standardText = HTTP_STATUS_TEXTS[err.status]
    if (err.message && err.message !== standardText) {
      return new Error(err.message)
    }
    return new Error(`${prefix}: ${err.message || 'Unknown error'}`)
  }
  // Non-HTTP errors (network, JSON parse) - propagate directly
  return e instanceof Error ? e : new Error(String(e))
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch the current log level from the admin API
 */
export async function fetchLogLevel(): Promise<LogLevel> {
  try {
    const response = await apiClient.get<LogLevelApiResponse>('/admin/log-level', {
      rawResponse: true,
    })
    return response.data.level
  } catch (e) {
    throw mapAdminError(e, 'Failed to fetch log level')
  }
}

/**
 * Set the log level via the admin API
 */
export async function setLogLevel(level: LogLevel): Promise<LogLevel> {
  try {
    const response = await apiClient.put<LogLevelApiResponse>('/admin/log-level', { level }, {
      rawResponse: true,
    })
    return response.data.level
  } catch (e) {
    throw mapAdminError(e, 'Failed to set log level')
  }
}

// ============================================================================
// Secret masking reveal settings
// ============================================================================

/**
 * The system-wide secret-reveal flags (snake_case, matching the API).
 */
export interface MaskingSettingsApiResponse {
  run_output: boolean
  test_variables: boolean
  shared_variables: boolean
  credential_inputs: boolean
}

/**
 * Partial update of the reveal flags (omitted fields stay unchanged).
 */
export type MaskingSettingsPartial = Partial<MaskingSettingsApiResponse>

/** The secret-reveal flags as the app holds them, one per surface. */
export interface MaskingSettings {
  runOutput: boolean
  testVariables: boolean
  sharedVariables: boolean
  credentialInputs: boolean
}

/**
 * Fetch the system-wide secret-reveal flags from the admin API
 */
export async function fetchMaskingSettings(): Promise<MaskingSettingsApiResponse> {
  try {
    const response = await apiClient.get<MaskingSettingsApiResponse>('/admin/secret-masking', {
      rawResponse: true,
    })
    return {
      run_output: response.data.run_output,
      test_variables: response.data.test_variables,
      shared_variables: response.data.shared_variables,
      credential_inputs: response.data.credential_inputs,
    }
  } catch (e) {
    throw mapAdminError(e, 'Failed to fetch secret masking settings')
  }
}

/**
 * Set any subset of the system-wide secret-reveal flags via the admin API
 */
export async function setMaskingSettings(
  partial: MaskingSettingsPartial,
): Promise<MaskingSettingsApiResponse> {
  try {
    const response = await apiClient.put<MaskingSettingsApiResponse>(
      '/admin/secret-masking',
      partial,
      { rawResponse: true },
    )
    return {
      run_output: response.data.run_output,
      test_variables: response.data.test_variables,
      shared_variables: response.data.shared_variables,
      credential_inputs: response.data.credential_inputs,
    }
  } catch (e) {
    throw mapAdminError(e, 'Failed to set secret masking settings')
  }
}
