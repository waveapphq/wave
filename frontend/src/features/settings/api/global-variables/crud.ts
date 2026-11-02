/**
 * System Variables - CRUD Operations
 *
 * Provides functions for system variable CRUD operations.
 */

import { getApiBaseUrl } from '@/lib/api'
import { apiErrorFromResponse } from '@/services/api-client/errors'
import type { SystemVariablesMap, SystemVariablesApiResponse } from './types'

const SYSTEM_VARIABLES_PATH = '/variables/system'

/**
 * Fetch all system variables.
 * Auto-initializes to empty set if none exist.
 */
export async function fetchSystemVariables(): Promise<SystemVariablesMap> {
  // cache:'reload' bypasses the 60s HTTP cache: import/delete mutate other URLs,
  // so the cached GET is never invalidated and would render stale values.
  const response = await fetch(`${getApiBaseUrl()}${SYSTEM_VARIABLES_PATH}`, { cache: 'reload' })
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'GET',
      path: SYSTEM_VARIABLES_PATH,
      fallback: 'Failed to fetch system variables',
    })
  }
  const json: SystemVariablesApiResponse = await response.json()
  return json.data.variables
}

/**
 * Save system variables (replace entire collection).
 */
export async function saveSystemVariables(variables: SystemVariablesMap): Promise<SystemVariablesMap> {
  const response = await fetch(`${getApiBaseUrl()}${SYSTEM_VARIABLES_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables }),
  })
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'POST',
      path: SYSTEM_VARIABLES_PATH,
      fallback: 'Failed to save system variables',
    })
  }
  const json: SystemVariablesApiResponse = await response.json()
  return json.data.variables
}

/**
 * Delete all system variables.
 */
export async function deleteAllSystemVariables(): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}${SYSTEM_VARIABLES_PATH}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'DELETE',
      path: SYSTEM_VARIABLES_PATH,
      fallback: 'Failed to delete system variables',
    })
  }
}

/**
 * Delete a single system variable by name.
 */
export async function deleteSystemVariable(name: string): Promise<void> {
  const path = `${SYSTEM_VARIABLES_PATH}/${encodeURIComponent(name)}`
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'DELETE',
      path,
      fallback:
        response.status === 404
          ? `Variable '${name}' not found`
          : 'Failed to delete system variable',
    })
  }
}
