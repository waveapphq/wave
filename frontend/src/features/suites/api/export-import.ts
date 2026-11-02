/**
 * Suites Import/Export API Client
 *
 * Export and import functionality for suites.
 */

import { getApiBaseUrl } from '@/lib/api'
import {
  requestEntityImportValidation,
  requestImport,
} from '@/lib/api/import-export'
import { apiErrorFromResponse } from '@/services/api-client/errors'
import type { ValidateImportResult, ImportResult } from '@/types/import-export'
import type { SuiteExportOptions } from './types'

/**
 * Export a single suite as a downloadable file
 */
export async function exportSuite(
  suiteId: string,
  options: SuiteExportOptions = {}
): Promise<Blob> {
  const { format = 'yaml', secrets = 'mask' } = options
  const params = new URLSearchParams({ format, secrets })
  const path = `/suites/${suiteId}/export?${params}`
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
 * Export multiple suites (returns single file for 1, ZIP for 2+)
 */
export async function exportSuites(
  suiteIds: string[],
  options: SuiteExportOptions = {}
): Promise<Blob> {
  const { format = 'yaml', secrets = 'mask' } = options
  const path = '/suites/export'
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suite_ids: suiteIds,
      format,
      secrets,
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
 * Validate a file for suite import (dry-run)
 */
export function validateSuiteImport(file: File): Promise<ValidateImportResult> {
  return requestEntityImportValidation('/suites/import/validate', file, {
    collection: 'suites',
    existingId: 'existing_suite_id',
  })
}

/**
 * Import suites from file with conflict resolutions
 */
export function importSuites(
  file: File,
  conflictResolutions: Record<string, string> = {}
): Promise<ImportResult> {
  return requestImport('/suites/import', file, conflictResolutions)
}
