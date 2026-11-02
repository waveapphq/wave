/**
 * Tests Table Hook
 *
 * Manages table presentation concerns: filters, pagination, sorting,
 * visible columns, and selection state with URL synchronization.
 *
 * Delegates sort, pagination, column visibility, and selection to the
 * shared useDataTable hook; keeps filter logic feature-specific.
 */

import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { TestsFilters } from '@/features/tests/components/tests-filters'
import type { EntityTableResult } from '@/components/shared/tables/table-utils'
import { buildFilterParams } from '@/components/shared/tables/table-utils'
import { useDataTable } from '@/hooks/use-data-table'

// Storage key for visible columns preference
const VISIBLE_COLUMNS_KEY = 'wave_tests_visible_columns'
const DEFAULT_COLUMNS = ['name', 'suite', 'status', 'lastRun']

export type TestsTableResult = EntityTableResult<TestsFilters>

export function useTestsTable(): TestsTableResult {
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
    defaultHiddenColumns: ['tags', 'createdAt', 'updatedAt'],
    visibleColumnsStorageKey: VISIBLE_COLUMNS_KEY,
    defaultSorting: [{ id: 'name', desc: false }],
  })

  // Filters state (initialized from URL params)
  const [filters, setFilters] = useState<TestsFilters>({
    search: searchParams.get('search') || '',
    status: searchParams.get('status')?.split(',').filter(Boolean) || [],
    suiteIds: searchParams.get('suiteIds')?.split(',').filter(Boolean) || [],
    tags: searchParams.get('tags')?.split(',').filter(Boolean) || [],
  })

  // Selection mode state
  const [selectionModeActive, setSelectionModeActive] = useState(false)

  /* v8 ignore start - COV-V8-003: V8 tracks callback deps as branch */
  const handleFilterChange = useCallback(
    (newFilters: TestsFilters) => {
      setFilters(newFilters)
      const params = buildFilterParams(newFilters, pageInfo.pageSize)
      setSearchParams(params, { replace: true })
      setPageInfo((prev) => ({ ...prev, currentPage: 1 }))
    },
    [pageInfo.pageSize, setSearchParams, setPageInfo]
  )
  /* v8 ignore stop */

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
