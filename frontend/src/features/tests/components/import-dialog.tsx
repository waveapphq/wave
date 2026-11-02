/**
 * Test Import Dialog
 *
 * Thin adapter around the shared ImportDialog that maps test-specific
 * API types (ValidateImportResult with `.tests` array) to the generic
 * shared types (ValidateImportResult with `.items` array).
 *
 * All drag-and-drop, file handling, validation display, and conflict
 * resolution logic lives in the shared component.
 */

import { useCallback } from 'react'
import {
  ImportDialog as SharedImportDialog,
} from '@/components/shared/dialogs/import-dialog'
import type {
  ValidateImportResult as TestValidateResult,
  ImportResult as TestImportResult,
} from '@/features/tests/api/types'
import type {
  ValidateImportResult as SharedValidateResult,
  ImportResult as SharedImportResult,
} from '@/types/import-export'

export interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onValidate: (file: File) => Promise<TestValidateResult>
  onImport: (file: File, resolutions: Record<string, 'rename' | 'overwrite' | 'skip'>) => Promise<TestImportResult>
  onImportComplete: (result: TestImportResult) => void
}

/**
 * Convert test-specific validation result to the shared format.
 *
 * Maps `.tests` -> `.items` and `existing_test_id` -> `existing_id`.
 */
function toSharedValidateResult(testResult: TestValidateResult): SharedValidateResult {
  return {
    items: testResult.tests.map((t) => ({
      name: t.name,
      status: t.status,
      fatal_errors: t.fatal_errors,
      fixable_errors: t.fixable_errors,
      warnings: t.warnings,
      existing_id: t.existing_test_id,
    })),
    total: testResult.total,
    importable: testResult.importable,
    blocked: testResult.blocked,
  }
}

/**
 * Convert test-specific import result to the shared format.
 *
 * The structures are identical - this is a type-level cast with
 * explicit field mapping for safety.
 */
function toSharedImportResult(testResult: TestImportResult): SharedImportResult {
  return {
    imported: testResult.imported.map((i) => ({
      name: i.name,
      id: i.id,
      action: i.action,
    })),
    skipped: testResult.skipped,
    fixes_applied: testResult.fixes_applied,
    total_imported: testResult.total_imported,
    total_skipped: testResult.total_skipped,
  }
}

export function ImportDialog({
  open,
  onOpenChange,
  onValidate,
  onImport,
  onImportComplete,
}: Readonly<ImportDialogProps>) {
  const handleValidate = useCallback(
    async (file: File): Promise<SharedValidateResult> => {
      const testResult = await onValidate(file)
      return toSharedValidateResult(testResult)
    },
    [onValidate]
  )

  const handleImport = useCallback(
    async (
      file: File,
      resolutions: Record<string, 'rename' | 'overwrite' | 'skip'>
    ): Promise<SharedImportResult> => {
      const testResult = await onImport(file, resolutions)
      return toSharedImportResult(testResult)
    },
    [onImport]
  )

  const handleImportComplete = useCallback(
    (sharedResult: SharedImportResult) => {
      // The shared result is structurally compatible with the test result,
      // but we reconstruct to satisfy the test-specific type contract.
      const testResult: TestImportResult = {
        imported: sharedResult.imported.map((i) => ({
          name: i.name,
          id: i.id,
          action: i.action,
        })),
        skipped: sharedResult.skipped,
        fixes_applied: sharedResult.fixes_applied,
        total_imported: sharedResult.total_imported,
        total_skipped: sharedResult.total_skipped,
      }
      onImportComplete(testResult)
    },
    [onImportComplete]
  )

  return (
    <SharedImportDialog
      open={open}
      onOpenChange={onOpenChange}
      entityLabel="Test"
      onValidate={handleValidate}
      onImport={handleImport}
      onImportComplete={handleImportComplete}
    />
  )
}
