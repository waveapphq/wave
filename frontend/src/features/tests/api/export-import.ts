/**
 * Tests Export/Import API
 *
 * Export and import operations for test definitions.
 * REQ-5.2.4.9
 */

import { getApiBaseUrl } from '@/lib/api'
import { requestImport, requestImportValidation } from '@/lib/api/import-export'
import { parseFilename } from '@/lib/download-file'
import { apiErrorFromResponse } from '@/services/api-client/errors'
import type {
  ExportOptions,
  ValidateImportResult,
  ImportResult,
} from './types'

const ZIP_TYPE = 'application/zip'

export interface ExportedTest {
  blob: Blob
  /** The server's Content-Disposition name; else <name>.zip for an archive, <name>.<format> otherwise. */
  filename: string
}

/**
 * Export a single test: an archive when the test has files, else the bare document.
 */
export async function exportTest(
  testId: string,
  options: ExportOptions = {}
): Promise<ExportedTest> {
  const { format = 'yaml', secrets = 'mask', name = testId } = options
  const params = new URLSearchParams({ format, secrets })
  const path = `/tests/${testId}/export?${params}`
  const response = await fetch(`${getApiBaseUrl()}${path}`)
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'GET',
      path,
      fallback: 'Export failed',
    })
  }
  const blob = await response.blob()
  const extension = blob.type === ZIP_TYPE ? 'zip' : format
  return { blob, filename: parseFilename(response) ?? `${name}.${extension}` }
}

/**
 * Export multiple tests (returns single file for 1 test, ZIP for 2+)
 */
export async function exportTests(testIds: string[], options: ExportOptions = {}): Promise<Blob> {
  const { format = 'yaml', secrets = 'mask' } = options
  const path = '/tests/export'
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      test_ids: testIds,
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
 * Validate a file for import (dry-run)
 */
export function validateTestImport(file: File): Promise<ValidateImportResult> {
  return requestImportValidation('/tests/import/validate', file)
}

/**
 * Import tests from file with conflict resolutions
 */
export function importTests(
  file: File,
  conflictResolutions: Record<string, 'rename' | 'overwrite' | 'skip'> = {}
): Promise<ImportResult> {
  return requestImport('/tests/import', file, conflictResolutions)
}
