/**
 * Regression Import/Export API Client
 *
 * Export and import functionality for regressions.
 * Follows the same pattern as suites/api/export-import.ts.
 */

import { getApiBaseUrl } from '@/lib/api'
import {
  requestEntityImportValidation,
  requestImport,
} from '@/lib/api/import-export'
import { apiErrorFromResponse } from '@/services/api-client/errors'
import type { ValidateImportResult, ImportResult } from '@/types/import-export'
import type { RegressionExportOptions } from './types'

export type { RegressionExportOptions } from './types'

/**
 * Export a single regression as a downloadable file
 */
export async function exportRegression(
  regressionId: string,
  options: RegressionExportOptions = {},
): Promise<Blob> {
  const { format = 'yaml', secrets = 'mask' } = options
  const params = new URLSearchParams({ format, secrets })
  const path = `/regressions/${regressionId}/export?${params}`
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
 * Export multiple regressions (returns ZIP)
 */
export async function exportRegressions(
  regressionIds: string[],
  options: RegressionExportOptions = {},
): Promise<Blob> {
  const { format = 'yaml', secrets = 'mask' } = options
  const path = '/regressions/export'
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      regression_ids: regressionIds,
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
 * Validate a file for regression import (dry-run)
 */
export function validateRegressionImport(
  file: File,
): Promise<ValidateImportResult> {
  return requestEntityImportValidation('/regressions/import/validate', file, {
    collection: 'regressions',
    existingId: 'existing_regression_id',
  })
}

/**
 * Import regressions from file with conflict resolutions
 */
export function importRegressions(
  file: File,
  conflictResolutions: Record<string, string> = {},
): Promise<ImportResult> {
  return requestImport('/regressions/import', file, conflictResolutions)
}
