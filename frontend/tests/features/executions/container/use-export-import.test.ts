/**
 * Tests for the executions useExportImport hook
 *
 * Export dialog state + download orchestration for the executions list and
 * detail surfaces: single export goes through the existing single-execution
 * GET (downloadExecutionExport), bulk export goes through the bulk POST and
 * downloads the ZIP blob via the shared downloadBlob helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/features/executions/api/export', () => ({
  downloadExecutionExport: vi.fn(),
  exportExecutions: vi.fn(),
}))

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: mockToastError }),
}))

import { downloadExecutionExport, exportExecutions } from '@/features/executions/api/export'
import { downloadBlob } from '@/lib/download-blob'
import { useExportImport } from '@/features/executions/container/use-export-import'

describe('useExportImport (executions)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(downloadExecutionExport).mockResolvedValue(undefined)
    vi.mocked(exportExecutions).mockResolvedValue(new Blob(['zip'], { type: 'application/zip' }))
  })

  describe('initial state', () => {
    it('starts with the dialog closed and no targets', () => {
      const { result } = renderHook(() => useExportImport())

      expect(result.current.exportDialogOpen).toBe(false)
      expect(result.current.exportLoading).toBe(false)
      expect(result.current.exportIds).toEqual([])
      expect(result.current.exportNames).toEqual([])
    })
  })

  describe('handleExport', () => {
    it('opens the dialog for a single execution', () => {
      const { result } = renderHook(() => useExportImport())

      act(() => {
        result.current.handleExport('exec-1', 'Nightly Run')
      })

      expect(result.current.exportDialogOpen).toBe(true)
      expect(result.current.exportIds).toEqual(['exec-1'])
      expect(result.current.exportNames).toEqual(['Nightly Run'])
    })
  })

  describe('handleBulkExport', () => {
    it('opens the dialog for the selected executions', () => {
      const { result } = renderHook(() => useExportImport())

      act(() => {
        result.current.handleBulkExport(['exec-1', 'exec-2'], ['Run A', 'Run B'])
      })

      expect(result.current.exportDialogOpen).toBe(true)
      expect(result.current.exportIds).toEqual(['exec-1', 'exec-2'])
      expect(result.current.exportNames).toEqual(['Run A', 'Run B'])
    })
  })

  describe('handleExportAction - single execution', () => {
    it('downloads through the existing single-execution GET with the chosen format', async () => {
      const { result } = renderHook(() => useExportImport())

      act(() => {
        result.current.handleExport('exec-1', 'Nightly Run')
      })
      await act(async () => {
        await result.current.handleExportAction({ format: 'yaml' })
      })

      expect(downloadExecutionExport).toHaveBeenCalledWith('exec-1', { format: 'yaml' })
      expect(exportExecutions).not.toHaveBeenCalled()
      expect(downloadBlob).not.toHaveBeenCalled()
      expect(result.current.exportDialogOpen).toBe(false)
      expect(result.current.exportLoading).toBe(false)
    })

    it('passes json format through to the single export', async () => {
      const { result } = renderHook(() => useExportImport())

      act(() => {
        result.current.handleExport('exec-1', 'Nightly Run')
      })
      await act(async () => {
        await result.current.handleExportAction({ format: 'json' })
      })

      expect(downloadExecutionExport).toHaveBeenCalledWith('exec-1', { format: 'json' })
    })
  })

  describe('handleExportAction - bulk export', () => {
    it('posts the bulk export and downloads the ZIP via downloadBlob', async () => {
      const zipBlob = new Blob(['zip-bytes'], { type: 'application/zip' })
      vi.mocked(exportExecutions).mockResolvedValue(zipBlob)
      const { result } = renderHook(() => useExportImport())

      act(() => {
        result.current.handleBulkExport(['exec-1', 'exec-2'], ['Run A', 'Run B'])
      })
      await act(async () => {
        await result.current.handleExportAction({ format: 'json' })
      })

      expect(exportExecutions).toHaveBeenCalledWith(['exec-1', 'exec-2'], 'json')
      expect(downloadBlob).toHaveBeenCalledWith(zipBlob, 'executions-export.zip')
      expect(downloadExecutionExport).not.toHaveBeenCalled()
      expect(result.current.exportDialogOpen).toBe(false)
    })

    it('passes yaml format through to the bulk export', async () => {
      const { result } = renderHook(() => useExportImport())

      act(() => {
        result.current.handleBulkExport(['exec-1', 'exec-2'], ['Run A', 'Run B'])
      })
      await act(async () => {
        await result.current.handleExportAction({ format: 'yaml' })
      })

      expect(exportExecutions).toHaveBeenCalledWith(['exec-1', 'exec-2'], 'yaml')
    })
  })

  describe('loading state', () => {
    it('reports loading while the export is in flight', async () => {
      let resolveExport!: () => void
      vi.mocked(downloadExecutionExport).mockReturnValue(
        new Promise<void>((resolve) => {
          resolveExport = resolve
        })
      )
      const { result } = renderHook(() => useExportImport())

      act(() => {
        result.current.handleExport('exec-1', 'Nightly Run')
      })
      act(() => {
        result.current.handleExportAction({ format: 'json' })
      })

      expect(result.current.exportLoading).toBe(true)

      await act(async () => {
        resolveExport()
      })

      expect(result.current.exportLoading).toBe(false)
    })
  })

  describe('error handling', () => {
    it('keeps the dialog open, clears loading and reports the reason when the export fails', async () => {
      vi.mocked(downloadExecutionExport).mockRejectedValue(new Error('Network error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = renderHook(() => useExportImport())

      act(() => {
        result.current.handleExport('exec-1', 'Nightly Run')
      })
      await act(async () => {
        await result.current.handleExportAction({ format: 'json' })
      })

      expect(consoleSpy).toHaveBeenCalledWith('Export failed:', expect.any(Error))
      expect(mockToastError).toHaveBeenCalledWith('Network error', 'Export Failed')
      expect(result.current.exportDialogOpen).toBe(true)
      expect(result.current.exportLoading).toBe(false)
      consoleSpy.mockRestore()
    })

    it('passes a non-Error rejection through verbatim', async () => {
      vi.mocked(exportExecutions).mockRejectedValue('not an error object')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = renderHook(() => useExportImport())

      act(() => {
        result.current.handleBulkExport(['exec-1', 'exec-2'], ['Run A', 'Run B'])
      })
      await act(async () => {
        await result.current.handleExportAction({ format: 'json' })
      })

      expect(mockToastError).toHaveBeenCalledWith('not an error object', 'Export Failed')
      consoleSpy.mockRestore()
    })
  })
})
