/**
 * Environments Import/Export API
 *
 * REQ-5.2.1.42: Settings and preferences screen - Environments management
 *
 * Import and export operations for environment data.
 */

import { getApiBaseUrl } from '@/lib/api'
import {
  requestEntityImportValidation,
  requestImport,
} from '@/lib/api/import-export'
import { apiErrorFromResponse } from '@/services/api-client/errors'
import type { ValidateImportResult, ImportResult } from '@/types/import-export'
import type { EnvironmentExportOptions } from './types'

// ===========================================================================
// Environment Export/Import API
// ===========================================================================

/**
 * Export a single environment as a downloadable file
 */
export async function exportEnvironment(
  envId: string,
  options: EnvironmentExportOptions = {}
): Promise<Blob> {
  const { format = 'yaml' } = options
  const params = new URLSearchParams({ format })
  const path = `/environments/${envId}/export?${params}`
  const response = await fetch(`${getApiBaseUrl()}${path}`)
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'GET',
      path,
      fallback: 'Export failed',
    })
  }
  return response.blob()
}

/**
 * Export multiple environments (returns single file for 1, ZIP for 2+)
 */
export async function exportEnvironments(
  envIds: string[],
  options: EnvironmentExportOptions = {}
): Promise<Blob> {
  const { format = 'yaml' } = options
  const path = '/environments/export'
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      environment_ids: envIds,
      format,
    }),
  })
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'POST',
      path,
      fallback: 'Export failed',
    })
  }
  return response.blob()
}

/**
 * Validate a file for environment import (dry-run)
 */
export function validateEnvironmentImport(file: File): Promise<ValidateImportResult> {
  return requestEntityImportValidation('/environments/import/validate', file, {
    collection: 'environments',
    existingId: 'existing_environment_id',
  })
}

/**
 * Import environments from file with conflict resolutions
 */
export function importEnvironments(
  file: File,
  conflictResolutions: Record<string, string> = {}
): Promise<ImportResult> {
  return requestImport('/environments/import', file, conflictResolutions)
}
