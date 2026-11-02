/**
 * System Variables - Import/Export Operations
 *
 * Clients for the server-side system variable export/import endpoints.
 */

import { getApiBaseUrl } from '@/lib/api'
import { apiErrorFromResponse } from '@/services/api-client/errors'
import type {
  ExportSecretsMode,
  ValidateImportResult,
  ImportResult,
} from '@/types/import-export'

/**
 * Download the server-side system variables export in the given format.
 */
export async function exportSystemVariables(
  format: 'yaml' | 'json',
  secrets: ExportSecretsMode = 'mask',
): Promise<Blob> {
  const path = `/variables/system/export?format=${format}&secrets=${secrets}`
  const response = await fetch(`${getApiBaseUrl()}${path}`)
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'GET',
      path,
      fallback: 'Failed to export system variables',
    })
  }
  return response.blob()
}

/**
 * Validate a file for system variables import without persisting.
 */
export async function validateSystemVariablesImport(file: File): Promise<ValidateImportResult> {
  const formData = new FormData()
  formData.append('file', file)

  const path = '/variables/system/import/validate'
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'POST',
      path,
      fallback: 'Failed to validate import file',
    })
  }
  const json = await response.json()
  return json.data
}

/**
 * Import system variables from a file with per-variable conflict resolutions.
 */
export async function importSystemVariables(
  file: File,
  resolutions: Record<string, string>
): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('conflict_resolutions', JSON.stringify(resolutions))

  const path = '/variables/system/import'
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'POST',
      path,
      fallback: 'Failed to import system variables',
    })
  }
  const json = await response.json()
  return json.data
}
