/**
 * FunctionImportDialog.
 *
 * Thin adapter over the shared ImportDialog. The Function backend already
 * returns the canonical shared shape (`items`/`existing_id`), so this just
 * wires the Function validate/import client + entityLabel into the shared
 * dialog - no per-entity result mapping needed (unlike the Tests adapter).
 */

import { ImportDialog } from '@/components/shared/dialogs/import-dialog'
import {
  validateFunctionImport,
  importFunctions,
} from '@/features/functions/api/export-import'
import type { ImportResult } from '@/types/import-export'

export interface FunctionImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete: (result: ImportResult) => void
}

export function FunctionImportDialog({
  open,
  onOpenChange,
  onImportComplete,
}: Readonly<FunctionImportDialogProps>) {
  return (
    <ImportDialog
      open={open}
      onOpenChange={onOpenChange}
      entityLabel="Function"
      onValidate={validateFunctionImport}
      onImport={importFunctions}
      onImportComplete={onImportComplete}
    />
  )
}
