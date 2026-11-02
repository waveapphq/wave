/**
 * Regression Export/Import Hook Tests
 *
 * REQ-5.2.1.37: Regression management screen - import/export
 *
 * Tests for useExportImport hook:
 * - Export dialog state management
 * - Single export triggers file download
 * - Batch export (2+ regressions) triggers ZIP download
 * - Import dialog state
 * - Import complete triggers data reload
 * - Format selection (YAML/JSON)
 * - Secret masking toggle
 *
 * Hook: frontend/src/features/regressions/container/use-export-import.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock the export/import API
vi.mock('@/features/regressions/api/export-import', () => ({
  exportRegression: vi.fn(),
  exportRegressions: vi.fn(),
}))

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: mockToastError }),
}))

import { useExportImport } from '@/features/regressions/container/use-export-import'
import { exportRegression, exportRegressions } from '@/features/regressions/api/export-import'
import { downloadBlob } from '@/lib/download-blob'

const mockExportRegression = vi.mocked(exportRegression)
const mockExportRegressions = vi.mocked(exportRegressions)

// ============================================================================
// Mock Data
// ============================================================================

interface RegressionListItem {
  id: string
  name: string
}

const mockRegressions: RegressionListItem[] = [
  { id: 'reg-1', name: 'WAVE 26.04' },
  { id: 'reg-2', name: 'Nightly Smoke' },
  { id: 'reg-3', name: 'API Regression' },
]

// ============================================================================
// Tests
// ============================================================================

describe('useExportImport', () => {
  const mockLoadData = vi.fn().mockResolvedValue(undefined)
  const mockClearSelection = vi.fn()

  beforeEach(() => {
    mockExportRegression.mockReset()
    mockExportRegressions.mockReset()
    vi.mocked(downloadBlob).mockReset()
    mockLoadData.mockReset().mockResolvedValue(undefined)
    mockClearSelection.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderExportImportHook(selectedIds: string[] = []) {
    return renderHook(() =>
      useExportImport(
        mockRegressions,
        selectedIds,
        mockLoadData,
        mockClearSelection
      )
    )
  }

  // =========================================================================
  // Initial State
  // =========================================================================

  it('initializes with closed dialogs', () => {
    const { result } = renderExportImportHook()

    expect(result.current.exportDialogOpen).toBe(false)
    expect(result.current.importDialogOpen).toBe(false)
    expect(result.current.exportLoading).toBe(false)
    expect(result.current.exportRegressionIds).toEqual([])
    expect(result.current.exportRegressionNames).toEqual([])
  })

  // =========================================================================
  // Single Export
  // =========================================================================

  it('opens export dialog for a single regression', () => {
    const { result } = renderExportImportHook()

    act(() => {
      result.current.handleExportRegression('reg-1')
    })

    expect(result.current.exportDialogOpen).toBe(true)
    expect(result.current.exportRegressionIds).toEqual(['reg-1'])
    expect(result.current.exportRegressionNames).toEqual(['WAVE 26.04'])
  })

  it('exports single regression as file download', async () => {
    const mockBlob = new Blob(['yaml-content'])
    mockExportRegression.mockResolvedValue(mockBlob)

    const { result } = renderExportImportHook()

    // Open export dialog
    act(() => {
      result.current.handleExportRegression('reg-1')
    })

    // Trigger export
    await act(async () => {
      await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
    })

    expect(mockExportRegression).toHaveBeenCalledWith('reg-1', {
      format: 'yaml',
      secrets: 'mask',
    })
    expect(downloadBlob).toHaveBeenCalledWith(mockBlob, 'WAVE 26.04.yaml')
    expect(result.current.exportDialogOpen).toBe(false)
  })

  it('exports with JSON format when specified', async () => {
    const mockBlob = new Blob(['{}'])
    mockExportRegression.mockResolvedValue(mockBlob)

    const { result } = renderExportImportHook()

    act(() => {
      result.current.handleExportRegression('reg-1')
    })

    await act(async () => {
      await result.current.handleExportAction({ format: 'json', secrets: 'plaintext' })
    })

    expect(mockExportRegression).toHaveBeenCalledWith('reg-1', {
      format: 'json',
      secrets: 'plaintext',
    })
  })

  // =========================================================================
  // Batch Export (ZIP)
  // =========================================================================

  it('opens export dialog for bulk export with selected IDs', () => {
    const { result } = renderExportImportHook(['reg-1', 'reg-2'])

    act(() => {
      result.current.handleBulkExport()
    })

    expect(result.current.exportDialogOpen).toBe(true)
    expect(result.current.exportRegressionIds).toEqual(['reg-1', 'reg-2'])
    expect(result.current.exportRegressionNames).toEqual(['WAVE 26.04', 'Nightly Smoke'])
  })

  it('exports multiple regressions as ZIP', async () => {
    const mockBlob = new Blob(['zip-content'])
    mockExportRegressions.mockResolvedValue(mockBlob)

    const { result } = renderExportImportHook(['reg-1', 'reg-2'])

    act(() => {
      result.current.handleBulkExport()
    })

    await act(async () => {
      await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
    })

    expect(mockExportRegressions).toHaveBeenCalledWith(['reg-1', 'reg-2'], {
      format: 'yaml',
      secrets: 'mask',
    })
    expect(downloadBlob).toHaveBeenCalledWith(mockBlob, 'regressions-export.zip')
  })

  // =========================================================================
  // Import
  // =========================================================================

  it('opens import dialog', () => {
    const { result } = renderExportImportHook()

    act(() => {
      result.current.handleImportOpen()
    })

    expect(result.current.importDialogOpen).toBe(true)
  })

  it('reloads data after import completes', () => {
    const { result } = renderExportImportHook()

    act(() => {
      result.current.handleImportComplete({
        imported: [{ name: 'New Reg', id: 'reg-new', action: 'created' }],
        skipped: [],
        fixes_applied: [],
        total_imported: 1,
        total_skipped: 0,
      })
    })

    expect(mockLoadData).toHaveBeenCalled()
    expect(mockClearSelection).toHaveBeenCalled()
  })

  // =========================================================================
  // Loading State
  // =========================================================================

  it('sets loading state during export', async () => {
    let resolveExport!: (value: Blob) => void
    mockExportRegression.mockImplementation(
      () => new Promise<Blob>((resolve) => { resolveExport = resolve }),
    )

    const { result } = renderExportImportHook()

    act(() => {
      result.current.handleExportRegression('reg-1')
    })

    // Start export - act flushes the synchronous setExportLoading(true)
    // but does NOT settle the inner promise (export is still pending)
    await act(async () => {
      result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
    })

    // Loading should be true (export still in progress)
    expect(result.current.exportLoading).toBe(true)

    // Resolve the export and let it settle
    await act(async () => {
      resolveExport(new Blob(['content']))
    })

    expect(result.current.exportLoading).toBe(false)
  })

  // =========================================================================
  // Error Handling
  // =========================================================================

  it('reports the reason when the export fails', async () => {
    mockExportRegression.mockRejectedValue(new Error('Export failed'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderExportImportHook()

    act(() => {
      result.current.handleExportRegression('reg-1')
    })

    await act(async () => {
      await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
    })

    expect(consoleSpy).toHaveBeenCalledWith('Export failed:', expect.any(Error))
    expect(mockToastError).toHaveBeenCalledWith('Export failed', 'Export Failed')
    expect(result.current.exportLoading).toBe(false)

    consoleSpy.mockRestore()
  })

  it('passes a non-Error rejection through verbatim', async () => {
    mockExportRegression.mockRejectedValue('not an error object')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderExportImportHook()

    act(() => {
      result.current.handleExportRegression('reg-1')
    })

    await act(async () => {
      await result.current.handleExportAction({ format: 'yaml', secrets: 'mask' })
    })

    expect(mockToastError).toHaveBeenCalledWith('not an error object', 'Export Failed')
    consoleSpy.mockRestore()
  })
})
