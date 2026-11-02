/**
 * Profile table UI hooks
 *
 * Manages filtering, pagination, sorting, column visibility,
 * and row selection state for the profiles list table.
 *
 * Delegates state management to the shared useDataTable hook;
 * keeps filter logic feature-specific.
 */

import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { OnChangeFn, RowSelectionState, SortingState, VisibilityState } from '@tanstack/react-table'
import type { Filters } from '@/features/profiles/components/profiles-filters'
import { buildFilterParams } from '@/components/shared/tables/table-utils'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import { useDataTable } from '@/hooks/use-data-table'

export type { PageInfo } from '@/components/shared/tables/table-utils'

const DEFAULT_COLUMNS = ['name', 'type', 'tags', 'environments', 'usage']

export interface UseProfilesTableReturn {
  // Filters
  filters: Filters
  handleFilterChange: (newFilters: Filters) => void
  // Sorting (TanStack native)
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  sortColumn: string | null
  sortDirection: 'asc' | 'desc' | null
  // Columns (TanStack native)
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  visibleColumns: string[]
  handleColumnToggle: (columnId: string, visible: boolean) => void
  // Pagination
  pageInfo: PageInfo
  setPageInfo: React.Dispatch<React.SetStateAction<PageInfo>>
  handlePageChange: (page: number) => void
  handlePageSizeChange: (pageSize: number) => void
  // Selection (TanStack native)
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  selectedIds: string[]
  selectionModeActive: boolean
  handleEnterSelectionMode: () => void
  handleExitSelectionMode: () => void
}

export function useProfilesTable(): UseProfilesTableReturn {
  const [searchParams, setSearchParams] = useSearchParams()

  // Shared table state: sort, pagination, columns, selection
  const {
    pageInfo,
    setPageInfo,
    onPageChange,
    onPageSizeChange,
    sorting,
    onSortingChange,
    sortColumn,
    sortDirection,
    columnVisibility,
    onColumnVisibilityChange,
    visibleColumns,
    toggleColumn,
    rowSelection,
    onRowSelectionChange,
    selectedIds,
    clearSelection,
  } = useDataTable({
    defaultVisibleColumns: DEFAULT_COLUMNS,
    visibleColumnsStorageKey: 'wave_profiles_visible_columns',
    defaultSorting: [{ id: 'name', desc: false }],
  })

  // Filters
  const [filters, setFilters] = useState<Filters>({
    search: searchParams.get('search') || '',
    type: searchParams.get('type') || '',
    tags: searchParams.get('tags')?.split(',').filter(Boolean) || [],
  })

  // Selection mode state
  const [selectionModeActive, setSelectionModeActive] = useState(false)

  const handleFilterChange = useCallback(
    (newFilters: Filters) => {
      setFilters(newFilters)
      const params = buildFilterParams(newFilters, pageInfo.pageSize)
      setSearchParams(params, { replace: true })
      setPageInfo((prev) => ({ ...prev, currentPage: 1 }))
    },
    [pageInfo.pageSize, setSearchParams, setPageInfo]
  )

  const handleEnterSelectionMode = useCallback(() => {
    setSelectionModeActive(true)
    clearSelection()
  }, [clearSelection])

  const handleExitSelectionMode = useCallback(() => {
    setSelectionModeActive(false)
    clearSelection()
  }, [clearSelection])

  return {
    filters,
    handleFilterChange,
    sorting,
    onSortingChange,
    sortColumn,
    sortDirection,
    columnVisibility,
    onColumnVisibilityChange,
    visibleColumns,
    handleColumnToggle: toggleColumn,
    pageInfo,
    setPageInfo,
    handlePageChange: onPageChange,
    handlePageSizeChange: onPageSizeChange,
    rowSelection,
    onRowSelectionChange,
    selectedIds,
    selectionModeActive,
    handleEnterSelectionMode,
    handleExitSelectionMode,
  }
}
