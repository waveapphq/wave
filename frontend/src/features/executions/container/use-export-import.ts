/**
 * Executions export hook
 *
 * Manages export dialog state and download orchestration for the
 * executions list and detail surfaces: single export goes through the
 * single-execution GET, bulk export through the bulk POST + ZIP download.
 */

import { useCallback, useState } from 'react'
import { downloadExecutionExport, exportExecutions } from '@/features/executions/api/export'
import { downloadBlob } from '@/lib/download-blob'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'

export interface UseExportImportReturn {
  exportDialogOpen: boolean
  setExportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  exportIds: string[]
  exportNames: string[]
  exportLoading: boolean
  handleExport: (executionId: string, name: string) => void
  handleBulkExport: (executionIds: string[], names: string[]) => void
  handleExportAction: (options: { format: 'yaml' | 'json' }) => void
}

export function useExportImport(): UseExportImportReturn {
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportIds, setExportIds] = useState<string[]>([])
  const [exportNames, setExportNames] = useState<string[]>([])
  const [exportLoading, setExportLoading] = useState(false)
  const { error: toastError } = useToast()

  const handleExport = useCallback((executionId: string, name: string) => {
    setExportIds([executionId])
    setExportNames([name])
    setExportDialogOpen(true)
  }, [])

  const handleBulkExport = useCallback((executionIds: string[], names: string[]) => {
    setExportIds(executionIds)
    setExportNames(names)
    setExportDialogOpen(true)
  }, [])

  // The dialog's Export button cannot await, so the download carries its own
  // reporting catch: a failed export is named in a toast.
  const handleExportAction = useCallback(
    (options: { format: 'yaml' | 'json' }): void => {
      setExportLoading(true)
      const run = async (): Promise<void> => {
        try {
          if (exportIds.length === 1) {
            await downloadExecutionExport(exportIds[0], { format: options.format })
          } else {
            const blob = await exportExecutions(exportIds, options.format)
            downloadBlob(blob, 'executions-export.zip')
          }
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
    [exportIds, toastError]
  )

  return {
    exportDialogOpen,
    setExportDialogOpen,
    exportIds,
    exportNames,
    exportLoading,
    handleExport,
    handleBulkExport,
    handleExportAction,
  }
}
