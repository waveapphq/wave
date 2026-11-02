/**
 * Tests for useExportImport hook
 *
 * Suite export/import dialog state management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/features/suites/api/export-import', () => ({
  exportSuite: vi.fn(),
  exportSuites: vi.fn(),
}))

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: mockToastError }),
}))

import { exportSuite, exportSuites } from '@/features/suites/api/export-import'
import { downloadBlob } from '@/lib/download-blob'
import { useExportImport } from '@/features/suites/container/use-export-import'
import type { SuiteListItem } from '@/features/suites/api/types'

const mockSuites: SuiteListItem[] = [
  { id: 's1', name: 'Suite A', testsCount: 3, status: 'passed', lastRun: null, tags: [], createdAt: null, updatedAt: null },
  { id: 's2', name: 'Suite B', testsCount: 5, status: 'failed', lastRun: null, tags: [], createdAt: null, updatedAt: null },
]

describe('useExportImport', () => {
  const mockLoadData = vi.fn().mockResolvedValue(undefined)
  const mockClearSelection = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    mockLoadData.mockResolvedValue(undefined)
  })

  function renderUseExportImport(selectedIds: string[] = []) {
    return renderHook(() =>
      useExportImport(mockSuites, selectedIds, mockLoadData, mockClearSelection)
    )
  }

  describe('initial state', () => {
    it('starts with dialogs closed', () => {
      const { result } = renderUseExportImport()

      expect(result.current.exportDialogOpen).toBe(false)
      expect(result.current.importDialogOpen).toBe(false)
      expect(result.current.exportLoading).toBe(false)
      expect(result.current.exportSuiteIds).toEqual([])
      expect(result.current.exportSuiteNames).toEqual([])
    })
  })

  describe('handleExportSuite', () => {
    it('sets export dialog state for single suite', () => {
      const { result } = renderUseExportImport()

      act(() => {
        result.current.handleExportSuite('s1')
      })

      expect(result.current.exportDialogOpen).toBe(true)
      expect(result.current.exportSuiteIds).toEqual(['s1'])
      expect(result.current.exportSuiteNames).toEqual(['Suite A'])
    })
  })

  describe('handleBulkExport', () => {
    it('sets export dialog state for selected suites', () => {
      const { result } = renderUseExportImport(['s1', 's2'])

      act(() => {
        result.current.handleBulkExport()
      })

      expect(result.current.exportDialogOpen).toBe(true)
      expect(result.current.exportSuiteIds).toEqual(['s1', 's2'])
      expect(result.current.exportSuiteNames).toEqual(['Suite A', 'Suite B'])
    })
  })

  describe('handleExportAction', () => {
    it('exports single suite and downloads it through the shared downloadBlob helper', async () => {
      const mockBlob = new Blob(['content'], { type: 'application/x-yaml' })
      vi.mocked(exportSuite).mockResolvedValue(mockBlob)

      const { result } = renderUseExportImport()

      // First set up the export state
      act(() => {
        result.current.handleExportSuite('s1')
      })

      // Then trigger the export action
      await act(async () => {
        await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
      })

      expect(exportSuite).toHaveBeenCalledWith('s1', { format: 'yaml', secrets: 'mask' })
      expect(downloadBlob).toHaveBeenCalledWith(mockBlob, 'Suite A.yaml')
      expect(result.current.exportDialogOpen).toBe(false)
      expect(result.current.exportLoading).toBe(false)
    })

    it('exports multiple suites as ZIP through the shared downloadBlob helper', async () => {
      const mockBlob = new Blob(['zip'], { type: 'application/zip' })
      vi.mocked(exportSuites).mockResolvedValue(mockBlob)

      const { result } = renderUseExportImport(['s1', 's2'])

      act(() => {
        result.current.handleBulkExport()
      })

      await act(async () => {
        await result.current.handleExportAction({ format: 'yaml', secrets: 'plaintext' })
      })

      expect(exportSuites).toHaveBeenCalledWith(['s1', 's2'], { format: 'yaml', secrets: 'plaintext' })
      expect(downloadBlob).toHaveBeenCalledWith(mockBlob, 'suites-export.zip')
    })

    it('reports the reason when the export fails', async () => {
      vi.mocked(exportSuite).mockRejectedValue(new Error('Network error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderUseExportImport()

      act(() => {
        result.current.handleExportSuite('s1')
      })

      await act(async () => {
        await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
      })

      expect(consoleSpy).toHaveBeenCalledWith('Export failed:', expect.any(Error))
      expect(mockToastError).toHaveBeenCalledWith('Network error', 'Export Failed')
      expect(result.current.exportLoading).toBe(false)
      consoleSpy.mockRestore()
    })

    it('passes a non-Error rejection through verbatim', async () => {
      vi.mocked(exportSuite).mockRejectedValue('not an error object')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderUseExportImport()

      act(() => {
        result.current.handleExportSuite('s1')
      })

      await act(async () => {
        await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
      })

      expect(mockToastError).toHaveBeenCalledWith('not an error object', 'Export Failed')
      consoleSpy.mockRestore()
    })
  })

  describe('handleImportOpen', () => {
    it('opens import dialog', () => {
      const { result } = renderUseExportImport()

      act(() => {
        result.current.handleImportOpen()
      })

      expect(result.current.importDialogOpen).toBe(true)
    })
  })

  describe('handleImportComplete', () => {
    it('reloads data and clears selection', () => {
      const { result } = renderUseExportImport()

      act(() => {
        result.current.handleImportComplete({
          imported: [],
          skipped: [],
          fixes_applied: [],
          total_imported: 0,
          total_skipped: 0,
        })
      })

      expect(mockLoadData).toHaveBeenCalled()
      expect(mockClearSelection).toHaveBeenCalled()
    })
  })
})
