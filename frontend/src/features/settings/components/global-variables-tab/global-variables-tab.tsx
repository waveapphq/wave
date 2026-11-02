/**
 * SystemVariablesTab Component
 *
 * Settings tab for managing system variables that are available
 * to all tests/suites/regressions via the variable hierarchy.
 *
 * Read-only display by default with EditDialog for editing.
 * EditDialog provides unsaved-changes protection automatically.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Plus, Loader2, Braces, Upload, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import { EditDialog } from '@/components/ui/edit-dialog'
import { fetchSystemVariables, saveSystemVariables } from '@/features/settings/api/global-variables/crud'
import { exportSystemVariables, validateSystemVariablesImport, importSystemVariables } from '@/features/settings/api/global-variables/import-export'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { ImportDialog, type ConflictResolution } from '@/components/shared/dialogs/import-dialog'
import { downloadBlob } from '@/lib/download-blob'
import { randomUUID } from '@/lib/uuid'
import { VariableReadonlyTable } from '@/components/shared/variable-editor/variable-readonly-table'
import { VariableEditor } from '@/components/shared/variable-editor/variable-editor'
import { EntityVariableValueCell } from '@/features/workbench/common/variables/entity-variable-value-cell'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { hasVariableErrors } from '@/lib/variable-validation'
import { useChildEditorScope } from '@/components/shared/child-editors/child-editor-scope'
import { formErrorsNote } from '@/lib/child-editors'
import type { SystemVariablesMap } from '@/features/settings/api/global-variables/types'
import { duplicateRows, deleteRows, type VariableRow } from '@/lib/variable-types'
import { mapToRows, rowsToMap } from './helpers'
import type { ExportSecretsMode } from '@/types/import-export'

// Variable names are reference targets in expressions; renaming on import
// would silently break references.
const IMPORT_RESOLUTIONS: ConflictResolution[] = ['overwrite', 'skip']

// The server exports the whole collection as one file (no per-variable
// selection), so the dialog always presents a single "System Variables" export.
const EXPORT_IDS = ['global']
const EXPORT_NAMES = ['System Variables']
const VARIABLES_NOTE = formErrorsNote('variables')

export function SystemVariablesTab() {
  const { success: toastSuccess, error: toastError } = useToast()

  // Data state
  const [variables, setVariables] = useState<SystemVariablesMap>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const childEditors = useChildEditorScope()
  const [editRows, setEditRows] = useState<VariableRow[]>([])
  const [savedRows, setSavedRows] = useState<VariableRow[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Export/Import dialog state
  const [exportOpen, setExportOpen] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // Dirty tracking for EditDialog
  const isDirty = JSON.stringify(editRows) !== JSON.stringify(savedRows)

  // Readonly display data
  // SystemVariablesMap extends VariableRecord - pass directly to VariableReadonlyTable
  const readonlyVars = variables
  const hasVariables = Object.keys(variables).length > 0

  const reportLoadFailure = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : 'Failed to load system variables')
  }, [])

  // Load data
  const loadVariables = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const data = await fetchSystemVariables()
      setVariables(data)
    } catch (err) {
      reportLoadFailure(err)
    } finally {
      setLoading(false)
    }
  }, [reportLoadFailure])

  // Re-fetch when the system reveal flag flips: the GET returns plaintext when
  // revealed, the placeholder when masked, so the read-only table reflects it.
  const sharedVariablesReveal = useMaskingSettingsStore((s) => s.sharedVariables)
  useEffect(() => {
    loadVariables().catch(reportLoadFailure)
  }, [loadVariables, reportLoadFailure, sharedVariablesReveal])

  // Open edit dialog with current variables
  const handleOpenEdit = useCallback(() => {
    const rows = mapToRows(variables)
    setEditRows(rows)
    setSavedRows(rows)
    setSelectedIds(new Set())
    setEditDialogOpen(true)
  }, [variables])

  // Open edit dialog and add an empty row (for empty state CTA)
  const handleOpenEditAndAdd = useCallback(() => {
    const rows = mapToRows(variables)
    const newRow: VariableRow = {
      id: randomUUID(),
      name: '',
      type: 'string',
      secret: false,
      value: '',
    }
    const withNew = [...rows, newRow]
    setEditRows(withNew)
    setSavedRows(rows)
    setSelectedIds(new Set())
    setEditDialogOpen(true)
  }, [variables])

  // Save handler for EditDialog
  const handleSave = useCallback(async () => {
    const map = rowsToMap(editRows)
    await saveSystemVariables(map)
    const fresh = await fetchSystemVariables()
    setVariables(fresh)
    toastSuccess('System variables saved')
  }, [editRows, toastSuccess])

  // Bulk actions
  /* v8 ignore start - COV-V8-003: V8 tracks useCallback definition as branch */
  const handleBulkDuplicate = useCallback(() => {
    const newRows = duplicateRows(editRows, selectedIds)
    setEditRows((prev) => [...prev, ...newRows])
    setSelectedIds(new Set())
  }, [selectedIds, editRows])
  /* v8 ignore stop */

  const handleBulkDelete = useCallback(() => {
    setEditRows((prev) => deleteRows(prev, selectedIds))
    setSelectedIds(new Set())
  }, [selectedIds])

  const reportExportFailure = useCallback((err: unknown) => {
    toastError(toFailureDetail(err).message, 'Export Failed')
  }, [toastError])

  // Export (server-side; the raw sealed store is transformed per the chosen mode)
  const handleExport = useCallback(async (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }) => {
    setExportLoading(true)
    try {
      const blob = await exportSystemVariables(options.format, options.secrets)
      downloadBlob(blob, `system-variables.${options.format}`)
      setExportOpen(false)
      toastSuccess('System variables exported')
    } catch (err) {
      reportExportFailure(err)
    } finally {
      setExportLoading(false)
    }
  }, [toastSuccess, reportExportFailure])

  // Import complete
  const handleImportComplete = useCallback(() => {
    setImportOpen(false)
    loadVariables().catch(reportLoadFailure)
    toastSuccess('System variables imported')
  }, [loadVariables, reportLoadFailure, toastSuccess])

  // Render: Loading
  if (loading) {
    return (
      <div data-testid="system-variables-tab" className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="system-variables-loading" />
      </div>
    )
  }

  // Render: Error
  if (error) {
    return (
      <div data-testid="system-variables-tab" className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-8 w-8 text-destructive mb-3" />
        <p className="text-muted-foreground mb-3" data-testid="system-variables-error">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { loadVariables().catch(reportLoadFailure) }}
        >
          Try Again
        </Button>
      </div>
    )
  }

  // Render: Main
  return (
    <div data-testid="system-variables-tab" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">System Variables</h2>
          <p className="text-muted-foreground text-sm">
            Variables available to all tests, suites, and regressions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
            data-testid="system-variables-import-btn"
          >
            <Upload className="h-4 w-4 mr-1" />
            Import
          </Button>
          {hasVariables && (
            <Button
              size="sm"
              onClick={handleOpenEdit}
              data-testid="system-variables-edit-btn"
            >
              <Pencil className="h-4 w-4 mr-1" />
              Edit Variables
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      {hasVariables ? (
        <VariableReadonlyTable variables={readonlyVars} />
      ) : (
        <div data-testid="system-variables-empty" className="flex flex-col items-center justify-center py-16 text-center">
          <Braces className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-2">No system variables</h3>
          <p className="text-muted-foreground max-w-md mb-4">
            Add variables that will be available to all tests, suites, and regressions.
          </p>
          <Button size="sm" onClick={handleOpenEditAndAdd} data-testid="system-variables-add-btn">
            <Plus className="h-4 w-4 mr-1" />
            Add Variable
          </Button>
        </div>
      )}

      {/* Edit Dialog */}
      <EditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        title="Edit System Variables"
        description="Add, remove, or modify system variables."
        isDirty={isDirty}
        saveDisabled={hasVariableErrors(editRows)}
        invalidNote={VARIABLES_NOTE}
        childEditors={childEditors}
        onSave={handleSave}
        className="sm:max-w-3xl"
        allowFloatingSheet
        data-testid="edit-variables-dialog"
      >
        <VariableEditor
          rows={editRows}
          onChange={setEditRows}
          enableSelection
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          renderValueCell={(row) => (
            <EntityVariableValueCell row={row} rows={editRows} onRowsChange={setEditRows} />
          )}
          bulkActions={
            <>
              <Button variant="outline" size="sm" onClick={handleBulkDuplicate} data-testid="bulk-duplicate-btn">
                Duplicate
              </Button>
              <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} data-testid="bulk-export-btn">
                Export
              </Button>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete} data-testid="bulk-delete-btn">
                Delete
              </Button>
            </>
          }
        />
      </EditDialog>

      {/* Export dialog */}
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        entityIds={EXPORT_IDS}
        entityNames={EXPORT_NAMES}
        entityLabel="System Variables"
        hasSecrets
        loading={exportLoading}
        onExport={(options) => { handleExport(options).catch(reportExportFailure) }}
      />

      {/* Import dialog */}
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        entityLabel="System Variable"
        onValidate={validateSystemVariablesImport}
        onImport={importSystemVariables}
        onImportComplete={handleImportComplete}
        allowedResolutions={IMPORT_RESOLUTIONS}
      />
    </div>
  )
}
