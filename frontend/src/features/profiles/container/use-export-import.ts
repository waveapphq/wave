/**
 * Profile export/import hooks
 *
 * Manages export dialog, import dialog, and bulk export/import
 * operations for profiles.
 */

import { useCallback, useState } from 'react'
import { deleteProfile, duplicateProfile } from '@/features/profiles/api/crud'
import {
  exportProfile,
  exportProfiles,
} from '@/features/profiles/api/import-export'
import { downloadBlob } from '@/lib/download-blob'
import { bulkFailureMessage, type LandedSentence } from '@/lib/bulk-failure'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import { ENVIRONMENTS_UNAVAILABLE_TOAST } from './refusal-copy'
import type { Profile } from '@/features/profiles/api/types'
import type { ExportSecretsMode, ImportResult } from '@/types/import-export'

const DUPLICATED: LandedSentence = (done, total) => `Duplicated ${done} of ${total} profiles.`
const DELETED: LandedSentence = (done, total) => `Deleted ${done} of ${total} profiles.`

export interface UseExportImportReturn {
  // Export dialog state
  exportDialogOpen: boolean
  setExportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  exportProfileIds: string[]
  exportProfileNames: string[]
  exportLoading: boolean
  // Import dialog state
  importDialogOpen: boolean
  setImportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  // Handlers
  handleExportProfile: (profileId: string) => void
  handleBulkExport: () => void
  handleExportAction: (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }) => void
  handleImportOpen: () => void
  handleImportComplete: (result: ImportResult) => void
  // Bulk action handlers
  handleBulkDuplicate: () => void
  handleBulkDelete: () => void
}

export function useExportImport(
  profiles: Profile[],
  selectedIds: string[],
  environmentsFailed: boolean,
  loadData: () => void,
  clearSelection: () => void
): UseExportImportReturn {
  // Export dialog state
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportProfileIds, setExportProfileIds] = useState<string[]>([])
  const [exportProfileNames, setExportProfileNames] = useState<string[]>([])
  const [exportLoading, setExportLoading] = useState(false)
  // Import dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const { error: toastError } = useToast()

  const handleExportProfile = useCallback(
    (profileId: string) => {
      // profile is guaranteed to exist: handler is called from row actions with valid IDs
      const profile = profiles.find((p) => p.id === profileId)!
      setExportProfileIds([profileId])
      setExportProfileNames([profile.name])
      setExportDialogOpen(true)
    },
    [profiles]
  )

  const handleBulkExport = useCallback(() => {
    // selectedIds is guaranteed non-empty: bulk actions are only shown when items are selected
    const names = selectedIds
      .map((id) => profiles.find((p) => p.id === id)?.name)
      .filter((n): n is string => Boolean(n))
    setExportProfileIds(selectedIds)
    setExportProfileNames(names)
    setExportDialogOpen(true)
  }, [selectedIds, profiles])

  // None of these buttons can await, so each gesture carries its own reporting
  // catch and a failure is named in a toast.
  const handleExportAction = useCallback(
    (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }): void => {
      setExportLoading(true)
      const run = async (): Promise<void> => {
        try {
          const blob =
            exportProfileIds.length === 1
              ? await exportProfile(exportProfileIds[0], { format: options.format, secrets: options.secrets })
              : await exportProfiles(exportProfileIds, { format: options.format, secrets: options.secrets })
          downloadBlob(
            blob,
            exportProfileIds.length === 1
              ? `${exportProfileNames[0]}.${options.format}`
              : 'profiles-export.zip',
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
    [exportProfileIds, exportProfileNames, toastError]
  )

  const handleImportOpen = useCallback(() => {
    setImportDialogOpen(true)
  }, [])

  const handleImportComplete = useCallback(
    (_result: ImportResult) => {
      loadData()
    },
    [loadData]
  )

  // Bulk action handlers. Every selected profile is attempted, the list always
  // reloads so what landed is visible, and the selection survives a failure.
  // They refuse over a failed environments read exactly as their single-row twins do.
  const handleBulkDuplicate = useCallback((): void => {
    if (environmentsFailed) {
      toastError(ENVIRONMENTS_UNAVAILABLE_TOAST, 'Profiles Not Duplicated')
      return
    }
    // selectedIds is guaranteed non-empty: bulk actions are only shown when items are selected
    Promise.allSettled(selectedIds.map((id) => duplicateProfile(id)))
      .then((results) => {
        const message = bulkFailureMessage(results, DUPLICATED)
        if (message !== null) throw new Error(message)
        clearSelection()
      })
      .finally(loadData)
      .catch((err: unknown) => {
        toastError((err as Error).message, 'Duplicate Failed')
      })
  }, [selectedIds, environmentsFailed, loadData, clearSelection, toastError])

  const handleBulkDelete = useCallback((): void => {
    if (environmentsFailed) {
      toastError(ENVIRONMENTS_UNAVAILABLE_TOAST, 'Profiles Not Deleted')
      return
    }
    // selectedIds is guaranteed non-empty: bulk actions are only shown when items are selected
    Promise.allSettled(selectedIds.map((id) => deleteProfile(id)))
      .then((results) => {
        const message = bulkFailureMessage(results, DELETED)
        if (message !== null) throw new Error(message)
        clearSelection()
      })
      .finally(loadData)
      .catch((err: unknown) => {
        toastError((err as Error).message, 'Delete Failed')
      })
  }, [selectedIds, environmentsFailed, loadData, clearSelection, toastError])

  return {
    exportDialogOpen,
    setExportDialogOpen,
    exportProfileIds,
    exportProfileNames,
    exportLoading,
    importDialogOpen,
    setImportDialogOpen,
    handleExportProfile,
    handleBulkExport,
    handleExportAction,
    handleImportOpen,
    handleImportComplete,
    handleBulkDuplicate,
    handleBulkDelete,
  }
}
