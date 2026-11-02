/**
 * Functions Table Hook.
 *
 * Table presentation state: filters (search + tags), pagination, sorting,
 * column visibility, and selection. Delegates the shared concerns to
 * useDataTable; keeps the Function-specific filter shape local.
 */

import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FunctionsFiltersState } from '@/features/functions/components/functions-filters'
import type { EntityTableResult } from '@/components/shared/tables/table-utils'
import { buildFilterParams } from '@/components/shared/tables/table-utils'
import { useDataTable } from '@/hooks/use-data-table'

const VISIBLE_COLUMNS_KEY = 'wave_functions_visible_columns'
const DEFAULT_COLUMNS = ['name', 'version', 'updated']

export type FunctionsTableResult = EntityTableResult<FunctionsFiltersState>

export function useFunctionsTable(): FunctionsTableResult {
  const [searchParams, setSearchParams] = useSearchParams()

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
    defaultHiddenColumns: ['tags'],
    visibleColumnsStorageKey: VISIBLE_COLUMNS_KEY,
    defaultSorting: [{ id: 'name', desc: false }],
  })

  const [filters, setFilters] = useState<FunctionsFiltersState>({
    search: searchParams.get('search') || '',
    tags: searchParams.get('tags')?.split(',').filter(Boolean) || [],
  })

  const [selectionModeActive, setSelectionModeActive] = useState(false)

  const handleFilterChange = useCallback(
    (newFilters: FunctionsFiltersState) => {
      setFilters(newFilters)
      const params = buildFilterParams(newFilters, pageInfo.pageSize)
      setSearchParams(params, { replace: true })
      setPageInfo((prev) => ({ ...prev, currentPage: 1 }))
    },
    [pageInfo.pageSize, setSearchParams, setPageInfo],
  )

  const handleEnterSelectionMode = useCallback(() => {
    setSelectionModeActive(true)
  }, [])

  const handleExitSelectionMode = useCallback(() => {
    setSelectionModeActive(false)
    clearSelection()
  }, [clearSelection])

  return {
    filters,
    handleFilterChange,
    pageInfo,
    setPageInfo,
    handlePageChange: onPageChange,
    handlePageSizeChange: onPageSizeChange,
    sorting,
    onSortingChange,
    sortColumn,
    sortDirection,
    columnVisibility,
    onColumnVisibilityChange,
    visibleColumns,
    handleColumnToggle: toggleColumn,
    rowSelection,
    onRowSelectionChange,
    selectedIds,
    selectionModeActive,
    setSelectionModeActive,
    handleEnterSelectionMode,
    handleExitSelectionMode,
  }
}
