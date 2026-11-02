/**
 * Function Export/Import API client.
 *
 * Mirrors `tests/api/export-import.ts` against the Function endpoints. Because
 * the Function backend already returns the canonical shared shape
 * (`items`/`existing_id`), validate/import results are consumed by the shared
 * dialogs unchanged. The export POST body uses `ids` (no `test_ids`) plus the
 * shared `secrets` mode.
 */

import { getApiBaseUrl } from '@/lib/api'
import { requestImport, requestImportValidation } from '@/lib/api/import-export'
import { apiErrorFromResponse } from '@/services/api-client/errors'
import type {
  ExportSecretsMode,
  ValidateImportResult,
  ImportResult,
} from '@/types/import-export'

export interface FunctionExportOptions {
  format?: 'yaml' | 'json'
  secrets?: ExportSecretsMode
}

/** Export a single Function (its full version history) as a downloadable file. */
export async function exportFunction(
  id: string,
  options: FunctionExportOptions = {},
): Promise<Blob> {
  const { format = 'yaml', secrets = 'mask' } = options
  const path = `/functions/${id}/export?format=${format}&secrets=${secrets}`
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

/** Export multiple Functions (single file for 1, ZIP for 2+). */
export async function exportFunctions(
  ids: string[],
  options: FunctionExportOptions = {},
): Promise<Blob> {
  const { format = 'yaml', secrets = 'mask' } = options
  const path = '/functions/export'
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, format, secrets }),
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

/** Validate a file for import (dry-run; persists nothing). */
export function validateFunctionImport(file: File): Promise<ValidateImportResult> {
  return requestImportValidation('/functions/import/validate', file)
}

/** Import Functions from a file with per-name conflict resolutions. */
export function importFunctions(
  file: File,
  conflictResolutions: Record<string, 'rename' | 'overwrite' | 'skip'> = {},
): Promise<ImportResult> {
  return requestImport('/functions/import', file, conflictResolutions)
}
