/**
 * Profile export/import hook tests - failure reporting.
 *
 * A failed export, bulk duplicate or bulk delete is reported in a toast; it is
 * never silent. The success paths are covered by the list-container tests.
 *
 * Hook: frontend/src/features/profiles/container/use-export-import.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/features/profiles/api/crud', () => ({
  duplicateProfile: vi.fn(),
  deleteProfile: vi.fn(),
}))

vi.mock('@/features/profiles/api/import-export', () => ({
  exportProfile: vi.fn(),
  exportProfiles: vi.fn(),
}))

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: mockToastError }),
}))

import { deleteProfile, duplicateProfile } from '@/features/profiles/api/crud'
import { exportProfile } from '@/features/profiles/api/import-export'
import { useExportImport } from '@/features/profiles/container/use-export-import'
import type { Profile } from '@/features/profiles/api/types'

const mockProfiles = [
  { id: 'p1', name: 'Production Database' },
  { id: 'p2', name: 'Staging Database' },
] as Profile[]

describe('useExportImport (profiles) - failure reporting', () => {
  const loadData = vi.fn().mockResolvedValue(undefined)
  const clearSelection = vi.fn()
  let consoleSpy: ReturnType<typeof vi.spyOn>

  function renderExportImport(selectedIds: string[] = ['p1'], environmentsFailed = false) {
    return renderHook(() =>
      useExportImport(mockProfiles, selectedIds, environmentsFailed, loadData, clearSelection)
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    loadData.mockResolvedValue(undefined)
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe('handleExportAction', () => {
    it('reports the reason and keeps the dialog open when the export fails', async () => {
      vi.mocked(exportProfile).mockRejectedValue(new Error('Export failed: Not Found'))
      const { result } = renderExportImport()

      act(() => {
        result.current.handleExportProfile('p1')
      })
      await act(async () => {
        await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
      })

      expect(mockToastError).toHaveBeenCalledWith('Export failed: Not Found', 'Export Failed')
      expect(result.current.exportDialogOpen).toBe(true)
      expect(result.current.exportLoading).toBe(false)
    })

    it('passes a non-Error rejection through verbatim', async () => {
      vi.mocked(exportProfile).mockRejectedValue('not an error object')
      const { result } = renderExportImport()

      act(() => {
        result.current.handleExportProfile('p1')
      })
      await act(async () => {
        await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
      })

      expect(mockToastError).toHaveBeenCalledWith('not an error object', 'Export Failed')
    })
  })

  describe('handleBulkDuplicate', () => {
    it('reports the reason and does not clear the selection when a duplicate fails', async () => {
      vi.mocked(duplicateProfile).mockRejectedValue(new Error('Conflict'))
      const { result } = renderExportImport(['p1', 'p2'])

      await act(async () => {
        await result.current.handleBulkDuplicate()
      })

      expect(mockToastError).toHaveBeenCalledWith('Conflict', 'Duplicate Failed')
      expect(clearSelection).not.toHaveBeenCalled()
      expect(loadData).toHaveBeenCalled()
    })

    it('names what landed when only some duplicates fail', async () => {
      vi.mocked(duplicateProfile)
        .mockResolvedValueOnce({ id: 'p1-copy' } as never)
        .mockRejectedValueOnce(new Error('Conflict'))
      const { result } = renderExportImport(['p1', 'p2'])

      await act(async () => {
        await result.current.handleBulkDuplicate()
      })

      expect(mockToastError).toHaveBeenCalledWith(
        'Duplicated 1 of 2 profiles. The rest failed: Conflict',
        'Duplicate Failed'
      )
      expect(clearSelection).not.toHaveBeenCalled()
      expect(loadData).toHaveBeenCalled()
    })

    it('passes a non-Error rejection through verbatim', async () => {
      vi.mocked(duplicateProfile).mockRejectedValue('not an error object')
      const { result } = renderExportImport(['p1'])

      await act(async () => {
        await result.current.handleBulkDuplicate()
      })

      expect(mockToastError).toHaveBeenCalledWith('not an error object', 'Duplicate Failed')
    })
  })

  describe('handleBulkDelete', () => {
    it('reports the reason and does not clear the selection when a delete fails', async () => {
      vi.mocked(deleteProfile).mockRejectedValue(new Error('Profile is in use'))
      const { result } = renderExportImport(['p1', 'p2'])

      await act(async () => {
        await result.current.handleBulkDelete()
      })

      expect(mockToastError).toHaveBeenCalledWith('Profile is in use', 'Delete Failed')
      expect(clearSelection).not.toHaveBeenCalled()
      expect(loadData).toHaveBeenCalled()
    })

    it('names what landed when only some deletes fail', async () => {
      vi.mocked(deleteProfile)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Profile is in use'))
      const { result } = renderExportImport(['p1', 'p2'])

      await act(async () => {
        await result.current.handleBulkDelete()
      })

      expect(mockToastError).toHaveBeenCalledWith(
        'Deleted 1 of 2 profiles. The rest failed: Profile is in use',
        'Delete Failed'
      )
      expect(clearSelection).not.toHaveBeenCalled()
      expect(loadData).toHaveBeenCalled()
    })

    it('passes a non-Error rejection through verbatim', async () => {
      vi.mocked(deleteProfile).mockRejectedValue('not an error object')
      const { result } = renderExportImport(['p1'])

      await act(async () => {
        await result.current.handleBulkDelete()
      })

      expect(mockToastError).toHaveBeenCalledWith('not an error object', 'Delete Failed')
    })
  })

  describe('refusals over a failed environments read', () => {
    const REFUSAL = 'Could not load environments. Try Again to load them.'

    it('refuses the bulk duplicate and issues no request', async () => {
      const { result } = renderExportImport(['p1', 'p2'], true)

      await act(async () => {
        await result.current.handleBulkDuplicate()
      })

      expect(duplicateProfile).not.toHaveBeenCalled()
      expect(loadData).not.toHaveBeenCalled()
      expect(clearSelection).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith(REFUSAL, 'Profiles Not Duplicated')
    })

    it('refuses the bulk delete and issues no request', async () => {
      const { result } = renderExportImport(['p1', 'p2'], true)

      await act(async () => {
        await result.current.handleBulkDelete()
      })

      expect(deleteProfile).not.toHaveBeenCalled()
      expect(loadData).not.toHaveBeenCalled()
      expect(clearSelection).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith(REFUSAL, 'Profiles Not Deleted')
    })
  })
})
