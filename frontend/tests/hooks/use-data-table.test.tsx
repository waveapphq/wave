/**
 * useDataTable Hook Tests
 *
 * Tests for the shared useDataTable hook covering:
 * - Pagination state and URL sync
 * - Sorting state management
 * - Column visibility with localStorage persistence
 * - Row selection state
 * - Default hidden columns
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useDataTable } from '@/hooks/use-data-table'

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('useDataTable', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('pagination', () => {
    it('initializes with default page info', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      expect(result.current.pageInfo).toEqual({
        currentPage: 1,
        pageSize: 25,
        totalItems: 0,
        totalPages: 1,
      })
    })

    it('initializes with custom default page size', () => {
      const { result } = renderHook(() => useDataTable({ defaultPageSize: 50 }), { wrapper })
      expect(result.current.pageInfo.pageSize).toBe(50)
    })

    it('handles page change', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      act(() => result.current.onPageChange(3))
      expect(result.current.pageInfo.currentPage).toBe(3)
    })

    it('handles page size change and resets to page 1', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      act(() => result.current.onPageChange(3))
      act(() => result.current.onPageSizeChange(50))
      expect(result.current.pageInfo.pageSize).toBe(50)
      expect(result.current.pageInfo.currentPage).toBe(1)
    })

    it('updates page info via setPageInfo', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      act(() => result.current.setPageInfo(prev => ({
        ...prev,
        totalItems: 100,
        totalPages: 4,
      })))
      expect(result.current.pageInfo.totalItems).toBe(100)
      expect(result.current.pageInfo.totalPages).toBe(4)
    })
  })

  describe('sorting', () => {
    it('initializes with empty sorting by default', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      expect(result.current.sorting).toEqual([])
      expect(result.current.sortColumn).toBeNull()
      expect(result.current.sortDirection).toBeNull()
    })

    it('initializes with default sorting', () => {
      const { result } = renderHook(
        () => useDataTable({ defaultSorting: [{ id: 'name', desc: false }] }),
        { wrapper },
      )
      expect(result.current.sorting).toEqual([{ id: 'name', desc: false }])
      expect(result.current.sortColumn).toBe('name')
      expect(result.current.sortDirection).toBe('asc')
    })

    it('derives desc sort direction', () => {
      const { result } = renderHook(
        () => useDataTable({ defaultSorting: [{ id: 'name', desc: true }] }),
        { wrapper },
      )
      expect(result.current.sortDirection).toBe('desc')
    })

    it('handles sorting change with updater function', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      act(() => result.current.onSortingChange(() => [{ id: 'type', desc: true }]))
      expect(result.current.sortColumn).toBe('type')
      expect(result.current.sortDirection).toBe('desc')
    })

    it('handles sorting change with direct value', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      act(() => result.current.onSortingChange([{ id: 'usage', desc: false }]))
      expect(result.current.sortColumn).toBe('usage')
    })
  })

  describe('column visibility', () => {
    it('initializes all columns visible by default', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      expect(result.current.columnVisibility).toEqual({})
    })

    it('initializes with hidden columns', () => {
      const { result } = renderHook(
        () => useDataTable({
          defaultVisibleColumns: ['name', 'status'],
          defaultHiddenColumns: ['tags', 'createdAt'],
        }),
        { wrapper },
      )
      expect(result.current.columnVisibility).toEqual({ tags: false, createdAt: false })
    })

    it('toggles column visibility', () => {
      const { result } = renderHook(
        () => useDataTable({
          defaultVisibleColumns: ['name', 'status'],
          defaultHiddenColumns: ['tags'],
        }),
        { wrapper },
      )
      act(() => result.current.toggleColumn('tags', true))
      expect(result.current.columnVisibility.tags).toBe(true)
    })

    it('persists to localStorage when key is provided', () => {
      const { result } = renderHook(
        () => useDataTable({
          defaultVisibleColumns: ['name', 'status', 'tags'],
          defaultHiddenColumns: ['tags'],
          visibleColumnsStorageKey: 'test_columns',
        }),
        { wrapper },
      )
      // tags starts hidden, toggle it visible
      act(() => result.current.toggleColumn('tags', true))
      const stored = JSON.parse(localStorage.getItem('test_columns')!)
      expect(stored).toContain('tags')
      expect(stored).toContain('name')
    })

    it('reads from localStorage when key is provided', () => {
      localStorage.setItem('test_cols', JSON.stringify(['name']))
      const { result } = renderHook(
        () => useDataTable({
          defaultVisibleColumns: ['name', 'status'],
          defaultHiddenColumns: ['tags'],
          visibleColumnsStorageKey: 'test_cols',
        }),
        { wrapper },
      )
      // name is visible, status and tags are hidden (not in stored array)
      expect(result.current.columnVisibility.name).toBe(true)
      expect(result.current.columnVisibility.status).toBe(false)
    })

    it('reads from localStorage without defaultHiddenColumns', () => {
      localStorage.setItem('test_no_hidden', JSON.stringify(['name']))
      const { result } = renderHook(
        () => useDataTable({
          defaultVisibleColumns: ['name', 'status'],
          visibleColumnsStorageKey: 'test_no_hidden',
        }),
        { wrapper },
      )
      expect(result.current.columnVisibility.name).toBe(true)
      expect(result.current.columnVisibility.status).toBe(false)
    })

    it('falls back to defaults on invalid localStorage', () => {
      localStorage.setItem('test_bad', 'invalid json')
      const { result } = renderHook(
        () => useDataTable({
          defaultVisibleColumns: ['name'],
          defaultHiddenColumns: ['tags'],
          visibleColumnsStorageKey: 'test_bad',
        }),
        { wrapper },
      )
      expect(result.current.columnVisibility).toEqual({ tags: false })
    })

    it('falls back to defaults on empty localStorage array', () => {
      localStorage.setItem('test_empty', JSON.stringify([]))
      const { result } = renderHook(
        () => useDataTable({
          defaultVisibleColumns: ['name'],
          defaultHiddenColumns: ['tags'],
          visibleColumnsStorageKey: 'test_empty',
        }),
        { wrapper },
      )
      expect(result.current.columnVisibility).toEqual({ tags: false })
    })

    it('derives visibleColumns list', () => {
      const { result } = renderHook(
        () => useDataTable({
          defaultVisibleColumns: ['name', 'status', 'tags'],
          defaultHiddenColumns: ['tags'],
        }),
        { wrapper },
      )
      expect(result.current.visibleColumns).toEqual(['name', 'status'])
    })

    it('handles onColumnVisibilityChange with direct value', () => {
      const { result } = renderHook(
        () => useDataTable({ defaultVisibleColumns: ['name'] }),
        { wrapper },
      )
      act(() => result.current.onColumnVisibilityChange({ name: false }))
      expect(result.current.columnVisibility.name).toBe(false)
    })

    it('handles onColumnVisibilityChange with updater', () => {
      const { result } = renderHook(
        () => useDataTable({ defaultVisibleColumns: ['name'] }),
        { wrapper },
      )
      act(() => result.current.onColumnVisibilityChange(prev => ({ ...prev, name: false })))
      expect(result.current.columnVisibility.name).toBe(false)
    })
  })

  describe('row selection', () => {
    it('initializes with empty selection', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      expect(result.current.rowSelection).toEqual({})
      expect(result.current.selectedIds).toEqual([])
    })

    it('handles selection change with updater', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      act(() => result.current.onRowSelectionChange(() => ({ 'row-1': true, 'row-2': true })))
      expect(result.current.selectedIds).toEqual(['row-1', 'row-2'])
    })

    it('handles selection change with direct value', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      act(() => result.current.onRowSelectionChange({ 'row-1': true }))
      expect(result.current.selectedIds).toEqual(['row-1'])
    })

    it('clears selection', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      act(() => result.current.onRowSelectionChange({ 'row-1': true }))
      expect(result.current.selectedIds).toHaveLength(1)
      act(() => result.current.clearSelection())
      expect(result.current.selectedIds).toEqual([])
    })

    it('filters out false values from selectedIds', () => {
      const { result } = renderHook(() => useDataTable(), { wrapper })
      act(() => result.current.onRowSelectionChange({ 'row-1': true, 'row-2': false }))
      expect(result.current.selectedIds).toEqual(['row-1'])
    })
  })
})
