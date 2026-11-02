/**
 * Shared types for import/export functionality.
 *
 * Generic types used by environment, profile, and test import/export
 * dialogs and API functions.
 */

export type ExportSecretsMode = 'mask' | 'encrypted' | 'plaintext'

export interface ValidationItemResult {
  name: string
  status: 'ok' | 'conflict' | 'fixable' | 'fatal'
  fatal_errors: Array<{ code: string; message: string }>
  fixable_errors: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
  existing_id: string | null
  conflict_reason?: 'name' | 'id' | 'both'
}

export interface ValidateImportResult {
  items: ValidationItemResult[]
  total: number
  importable: number
  blocked: number
}

export interface ImportedItem {
  name: string
  id: string
  action: 'created' | 'renamed' | 'overwritten'
}

export interface ImportResult {
  imported: ImportedItem[]
  skipped: Array<{ name: string; reason: string }>
  fixes_applied: Array<{ name: string; fixes: string[] }>
  total_imported: number
  total_skipped: number
}
