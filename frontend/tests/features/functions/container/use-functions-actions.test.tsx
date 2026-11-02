/**
 * useFunctionsActions branch coverage: the delete/export failure + fallback
 * paths and the import-complete callback. The happy paths (delete, export,
 * navigate) are exercised by functions-list-container.test.tsx.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/features/functions/api/functions-api', () => ({
  deleteFunction: vi.fn(),
  batchDeleteFunctions: vi.fn(),
}))

vi.mock('@/features/functions/api/export-import', () => ({
  exportFunction: vi.fn(),
  exportFunctions: vi.fn(),
}))

import { deleteFunction, batchDeleteFunctions } from '@/features/functions/api/functions-api'
import { exportFunction } from '@/features/functions/api/export-import'
import { useFunctionsActions } from '@/features/functions/container/use-functions-actions'
import type { FunctionRow } from '@/features/functions/components/functions-columns'
import type { ImportResult } from '@/types/import-export'

const mockDelete = vi.mocked(deleteFunction)
const mockBatchDelete = vi.mocked(batchDeleteFunctions)
const mockExportOne = vi.mocked(exportFunction)

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>

const FN: FunctionRow = {
  id: 'fn-1',
  name: 'F1',
  description: '',
  tags: [],
  latestVersion: '1.0.0',
  updatedAt: '2026-01-01T00:00:00Z',
}

function setup() {
  const deps = {
    functions: [FN],
    selectedIds: ['fn-1', 'fn-2'],
    loadData: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn(),
    clearSelection: vi.fn(),
  }
  const { result } = renderHook(() => useFunctionsActions(deps), { wrapper })
  return { result, deps }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useFunctionsActions', () => {
  it('surfaces a bulk-delete failure message via setError', async () => {
    mockBatchDelete.mockRejectedValueOnce(new Error('bulk boom'))
    const { result, deps } = setup()
    await act(async () => {
      await result.current.confirmBulkDelete()
    })
    expect(deps.setError).toHaveBeenCalledWith('bulk boom')
  })

  it('falls back to a generic message when the bulk-delete error is not an Error', async () => {
    mockBatchDelete.mockRejectedValueOnce('weird')
    const { result, deps } = setup()
    await act(async () => {
      await result.current.confirmBulkDelete()
    })
    expect(deps.setError).toHaveBeenCalledWith('Failed to delete functions')
  })

  it('closes the import dialog and reloads the list on import complete', () => {
    const { result, deps } = setup()
    act(() => {
      result.current.handleImportComplete({ imported: 1, skipped: 0, items: [] } as unknown as ImportResult)
    })
    expect(deps.loadData).toHaveBeenCalled()
    expect(result.current.importDialogOpen).toBe(false)
  })

  it('surfaces a reload that fails after an import', async () => {
    const deps = {
      functions: [FN],
      selectedIds: ['fn-1'],
      loadData: vi.fn().mockRejectedValue(new Error('reload boom')),
      setError: vi.fn(),
      clearSelection: vi.fn(),
    }
    const { result } = renderHook(() => useFunctionsActions(deps), { wrapper })

    await act(async () => {
      result.current.handleImportComplete({ imported: 1, skipped: 0, items: [] } as unknown as ImportResult)
    })

    expect(deps.setError).toHaveBeenCalledWith('reload boom')
  })

  it('falls back to a generic message when a failed reload rejects with a non-Error', async () => {
    const deps = {
      functions: [FN],
      selectedIds: ['fn-1'],
      loadData: vi.fn().mockRejectedValue('weird'),
      setError: vi.fn(),
      clearSelection: vi.fn(),
    }
    const { result } = renderHook(() => useFunctionsActions(deps), { wrapper })

    await act(async () => {
      result.current.handleImportComplete({ imported: 1, skipped: 0, items: [] } as unknown as ImportResult)
    })

    expect(deps.setError).toHaveBeenCalledWith('Failed to complete the action')
  })

  it('treats an unknown delete target as none and confirm becomes a no-op', async () => {
    const { result } = setup()
    act(() => {
      result.current.handleDeleteFunction('does-not-exist')
    })
    expect(result.current.functionToDelete).toBeNull()
    await act(async () => {
      await result.current.confirmDeleteFunction()
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the single-delete error is not an Error', async () => {
    mockDelete.mockRejectedValueOnce('weird')
    const { result, deps } = setup()
    act(() => {
      result.current.handleDeleteFunction('fn-1')
    })
    await act(async () => {
      await result.current.confirmDeleteFunction()
    })
    expect(deps.setError).toHaveBeenCalledWith('Failed to delete function')
  })

  it('labels an export target by id when it is not in the loaded list', () => {
    const { result } = setup()
    act(() => {
      result.current.handleExportFunction('fn-99')
    })
    expect(result.current.exportNames).toEqual(['fn-99'])
  })

  it('falls back to a generic message when an export error is not an Error', async () => {
    mockExportOne.mockRejectedValueOnce('weird')
    const { result, deps } = setup()
    act(() => {
      result.current.handleExportFunction('fn-1')
    })
    await act(async () => {
      await result.current.handleExportAction({ format: 'yaml', secrets: 'plaintext' })
    })
    expect(deps.setError).toHaveBeenCalledWith('Export failed')
  })
})
