/**
 * Regression export/import hooks
 *
 * Manages export dialog, import dialog, and bulk export/import
 * operations for regressions. Same pattern as suites/container/use-export-import.ts.
 */

import { useCallback, useState } from 'react'
import {
  exportRegression,
  exportRegressions,
} from '@/features/regressions/api/export-import'
import { downloadBlob } from '@/lib/download-blob'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import type { ExportSecretsMode, ImportResult } from '@/types/import-export'

interface RegressionListItem {
  id: string
  name: string
}

export interface UseExportImportReturn {
  // Export dialog state
  exportDialogOpen: boolean
  setExportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  exportRegressionIds: string[]
  exportRegressionNames: string[]
  exportLoading: boolean
  // Import dialog state
  importDialogOpen: boolean
  setImportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  // Handlers
  handleExportRegression: (regressionId: string) => void
  handleBulkExport: () => void
  handleExportAction: (options: {
    format: 'yaml' | 'json'
    secrets: ExportSecretsMode
  }) => void
  handleImportOpen: () => void
  handleImportComplete: (result: ImportResult) => void
}

export function useExportImport(
  regressions: RegressionListItem[],
  selectedIds: string[],
  loadData: () => void,
  clearSelection: () => void,
): UseExportImportReturn {
  // Export dialog state
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportRegressionIds, setExportRegressionIds] = useState<string[]>([])
  const [exportRegressionNames, setExportRegressionNames] = useState<string[]>(
    [],
  )
  const [exportLoading, setExportLoading] = useState(false)
  // Import dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const { error: toastError } = useToast()

  const handleExportRegression = useCallback(
    (regressionId: string) => {
      const regression = regressions.find((r) => r.id === regressionId)!
      setExportRegressionIds([regressionId])
      setExportRegressionNames([regression.name])
      setExportDialogOpen(true)
    },
    [regressions],
  )

  const handleBulkExport = useCallback(() => {
    const names = selectedIds
      .map((id) => regressions.find((r) => r.id === id)?.name)
      .filter((n): n is string => Boolean(n))
    setExportRegressionIds(selectedIds)
    setExportRegressionNames(names)
    setExportDialogOpen(true)
  }, [selectedIds, regressions])

  // The dialog's Export button cannot await, so the download carries its own
  // reporting catch: a failed export is named in a toast.
  const handleExportAction = useCallback(
    (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }): void => {
      setExportLoading(true)
      const run = async (): Promise<void> => {
        try {
          const blob =
            exportRegressionIds.length === 1
              ? await exportRegression(exportRegressionIds[0], {
                  format: options.format,
                  secrets: options.secrets,
                })
              : await exportRegressions(exportRegressionIds, {
                  format: options.format,
                  secrets: options.secrets,
                })
          downloadBlob(
            blob,
            exportRegressionIds.length === 1
              ? `${exportRegressionNames[0]}.${options.format}`
              : 'regressions-export.zip',
          )
          setExportDialogOpen(false)
        } finally {
          setExportLoading(false)
        }
      }
      run().catch((err: unknown) => {
        console.error('Export failed:', err)
        toastError(toFailureDetail(err).message, 'Export Failed')
      })
    },
    [exportRegressionIds, exportRegressionNames, toastError],
  )

  const handleImportOpen = useCallback(() => {
    setImportDialogOpen(true)
  }, [])

  const handleImportComplete = useCallback(
    (_result: ImportResult) => {
      loadData()
      clearSelection()
    },
    [loadData, clearSelection],
  )

  return {
    exportDialogOpen,
    setExportDialogOpen,
    exportRegressionIds,
    exportRegressionNames,
    exportLoading,
    importDialogOpen,
    setImportDialogOpen,
    handleExportRegression,
    handleBulkExport,
    handleExportAction,
    handleImportOpen,
    handleImportComplete,
  }
}
