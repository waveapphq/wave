/**
 * Upload helpers shared by the entity import/export API modules.
 */

import { postUpload } from '@/lib/api/upload'
import type { ValidateImportResult, ValidationItemResult } from '@/types/import-export'

/** Field names a backend uses in place of the shared `items` / `existing_id`. */
export interface ImportEntityFields {
  collection: string
  existingId: string
}

type EntityValidateResult = {
  items?: ValidationItemResult[]
  total: number
  importable: number
  blocked: number
}

type EntityValidationRow = Omit<ValidationItemResult, 'existing_id'> & Record<string, unknown>

/** Dry-run an import file. Returns the response envelope's data unchanged. */
export function requestImportValidation<T>(path: string, file: File): Promise<T> {
  const formData = new FormData()
  formData.append('file', file)
  return postUpload<T>(path, formData, 'Validation failed')
}

/** The same dry-run, for a backend that names the validated rows after its entity. */
export async function requestEntityImportValidation(
  path: string,
  file: File,
  fields: ImportEntityFields
): Promise<ValidateImportResult> {
  const data = await requestImportValidation<EntityValidateResult>(path, file)
  if (data.items) {
    return data as ValidateImportResult
  }
  const rows = ((data as Record<string, unknown>)[fields.collection] ??
    []) as EntityValidationRow[]
  return {
    items: rows.map((row) => ({
      ...row,
      existing_id: (row[fields.existingId] ?? null) as string | null,
    })),
    total: data.total,
    importable: data.importable,
    blocked: data.blocked,
  }
}

/** Commit an import file with its per-name conflict resolutions. */
export function requestImport<T>(
  path: string,
  file: File,
  conflictResolutions: Record<string, string>
): Promise<T> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('conflict_resolutions', JSON.stringify(conflictResolutions))
  return postUpload<T>(path, formData, 'Import failed')
}
