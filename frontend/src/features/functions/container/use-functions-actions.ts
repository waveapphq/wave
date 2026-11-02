/**
 * Functions Actions Hook.
 *
 * Owns the dialog state + handlers for the list page's destructive and
 * transfer actions: per-Function + bulk delete (via ConfirmationDialog),
 * single + bulk export (via the shared ExportDialog), and import.
 */

import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteFunction, batchDeleteFunctions } from '@/features/functions/api/functions-api'
import { exportFunction, exportFunctions } from '@/features/functions/api/export-import'
import { downloadBlob } from '@/lib/download-blob'
import type { FunctionRow } from '@/features/functions/components/functions-columns'
import type { ExportSecretsMode, ImportResult } from '@/types/import-export'

export interface FunctionsActionsParams {
  functions: FunctionRow[]
  selectedIds: string[]
  loadData: () => Promise<void>
  setError: (error: string | null) => void
  clearSelection: () => void
}

export function useFunctionsActions({
  functions,
  selectedIds,
  loadData,
  setError,
  clearSelection,
}: FunctionsActionsParams) {
  const navigate = useNavigate()

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [functionToDelete, setFunctionToDelete] = useState<FunctionRow | null>(null)
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)

  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportIds, setExportIds] = useState<string[]>([])
  const [exportLoading, setExportLoading] = useState(false)

  const [importDialogOpen, setImportDialogOpen] = useState(false)

  const handleViewFunction = useCallback(
    (functionId: string) => {
      navigate(`/functions/${functionId}`)
    },
    [navigate],
  )

  const handleDeleteFunction = useCallback(
    (functionId: string) => {
      setFunctionToDelete(functions.find((fn) => fn.id === functionId) ?? null)
      setDeleteDialogOpen(true)
    },
    [functions],
  )

  const confirmDeleteFunction = useCallback(async () => {
    if (!functionToDelete) return
    try {
      await deleteFunction(functionToDelete.id, { cascade: true })
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete function')
    } finally {
      setDeleteDialogOpen(false)
      setFunctionToDelete(null)
    }
  }, [functionToDelete, loadData, setError])

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.length > 0) setBulkDeleteDialogOpen(true)
  }, [selectedIds])

  const confirmBulkDelete = useCallback(async () => {
    try {
      await batchDeleteFunctions(selectedIds, { cascade: true })
      clearSelection()
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete functions')
    } finally {
      setBulkDeleteDialogOpen(false)
    }
  }, [selectedIds, clearSelection, loadData, setError])

  const handleExportFunction = useCallback((functionId: string) => {
    setExportIds([functionId])
    setExportDialogOpen(true)
  }, [])

  const handleBulkExport = useCallback(() => {
    if (selectedIds.length > 0) {
      setExportIds(selectedIds)
      setExportDialogOpen(true)
    }
  }, [selectedIds])

  const exportNames = useMemo(
    () => exportIds.map((id) => functions.find((fn) => fn.id === id)?.name ?? id),
    [exportIds, functions],
  )

  const handleExportAction = useCallback(
    async ({ format, secrets }: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }) => {
      setExportLoading(true)
      try {
        const blob =
          exportIds.length === 1
            ? await exportFunction(exportIds[0], { format, secrets })
            : await exportFunctions(exportIds, { format, secrets })
        const filename =
          exportIds.length === 1 ? `${exportNames[0]}.${format}` : 'functions-export.zip'
        downloadBlob(blob, filename)
        setExportDialogOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Export failed')
      } finally {
        setExportLoading(false)
      }
    },
    [exportIds, exportNames, setError],
  )

  const handleImportOpen = useCallback(() => setImportDialogOpen(true), [])

  /** An action that failed without reporting itself lands on the list's error line. */
  const reportFailure = useCallback(
    (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to complete the action')
    },
    [setError],
  )

  const handleImportComplete = useCallback(
    (_result: ImportResult) => {
      setImportDialogOpen(false)
      loadData().catch(reportFailure)
    },
    [loadData, reportFailure],
  )

  return {
    // delete
    deleteDialogOpen,
    setDeleteDialogOpen,
    functionToDelete,
    setFunctionToDelete,
    handleDeleteFunction,
    confirmDeleteFunction,
    bulkDeleteDialogOpen,
    setBulkDeleteDialogOpen,
    handleBulkDelete,
    confirmBulkDelete,
    // export
    exportDialogOpen,
    setExportDialogOpen,
    exportIds,
    exportNames,
    exportLoading,
    handleExportFunction,
    handleBulkExport,
    handleExportAction,
    // import
    importDialogOpen,
    setImportDialogOpen,
    handleImportOpen,
    handleImportComplete,
    // navigation
    handleViewFunction,
    reportFailure,
  }
}
