/**
 * Suite export/import hooks
 *
 * Manages export dialog, import dialog, and bulk export/import
 * operations for suites.
 */

import { useCallback, useState } from 'react'
import {
  exportSuite,
  exportSuites,
} from '@/features/suites/api/export-import'
import { downloadBlob } from '@/lib/download-blob'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import type { SuiteListItem } from '@/features/suites/api/types'
import type { ExportSecretsMode, ImportResult } from '@/types/import-export'

export interface UseExportImportReturn {
  // Export dialog state
  exportDialogOpen: boolean
  setExportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  exportSuiteIds: string[]
  exportSuiteNames: string[]
  exportLoading: boolean
  // Import dialog state
  importDialogOpen: boolean
  setImportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  // Handlers
  handleExportSuite: (suiteId: string) => void
  handleBulkExport: () => void
  handleExportAction: (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }) => void
  handleImportOpen: () => void
  handleImportComplete: (result: ImportResult) => void
}

export function useExportImport(
  suites: SuiteListItem[],
  selectedIds: string[],
  loadData: () => void,
  clearSelection: () => void
): UseExportImportReturn {
  // Export dialog state
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportSuiteIds, setExportSuiteIds] = useState<string[]>([])
  const [exportSuiteNames, setExportSuiteNames] = useState<string[]>([])
  const [exportLoading, setExportLoading] = useState(false)
  // Import dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const { error: toastError } = useToast()

  const handleExportSuite = useCallback(
    (suiteId: string) => {
      // suite is guaranteed to exist: handler is called from row actions with valid IDs
      const suite = suites.find((s) => s.id === suiteId)!
      setExportSuiteIds([suiteId])
      setExportSuiteNames([suite.name])
      setExportDialogOpen(true)
    },
    [suites]
  )

  const handleBulkExport = useCallback(() => {
    // selectedIds is guaranteed non-empty: bulk actions are only shown when items are selected
    const names = selectedIds
      .map((id) => suites.find((s) => s.id === id)?.name)
      .filter((n): n is string => Boolean(n))
    setExportSuiteIds(selectedIds)
    setExportSuiteNames(names)
    setExportDialogOpen(true)
  }, [selectedIds, suites])

  // The dialog's Export button cannot await, so the download carries its own
  // reporting catch: a failed export is named in a toast.
  const handleExportAction = useCallback(
    (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }): void => {
      setExportLoading(true)
      const run = async (): Promise<void> => {
        try {
          const blob =
            exportSuiteIds.length === 1
              ? await exportSuite(exportSuiteIds[0], { format: options.format, secrets: options.secrets })
              : await exportSuites(exportSuiteIds, { format: options.format, secrets: options.secrets })
          downloadBlob(
            blob,
            exportSuiteIds.length === 1
              ? `${exportSuiteNames[0]}.${options.format}`
              : 'suites-export.zip',
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
    [exportSuiteIds, exportSuiteNames, toastError]
  )

  const handleImportOpen = useCallback(() => {
    setImportDialogOpen(true)
  }, [])

  const handleImportComplete = useCallback(
    (_result: ImportResult) => {
      loadData()
      clearSelection()
    },
    [loadData, clearSelection]
  )

  return {
    exportDialogOpen,
    setExportDialogOpen,
    exportSuiteIds,
    exportSuiteNames,
    exportLoading,
    importDialogOpen,
    setImportDialogOpen,
    handleExportSuite,
    handleBulkExport,
    handleExportAction,
    handleImportOpen,
    handleImportComplete,
  }
}
