/**
 * useDataTable - Shared hook for DataTable state management.
 *
 * Manages sorting, pagination, column visibility, and row selection
 * using TanStack Table's native state types. Syncs pagination to URL
 * search params and column visibility to localStorage.
 */

import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type {
  OnChangeFn,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import type { PageInfo } from '@/components/shared/tables/table-utils'

export interface UseDataTableOptions {
  /** Default page size when no URL param is present. Defaults to 25. */
  defaultPageSize?: number
  /** Default visible column IDs. Used when no localStorage value exists. */
  defaultVisibleColumns?: string[]
  /** Column IDs hidden by default. Set to false in initial VisibilityState. */
  defaultHiddenColumns?: string[]
  /** localStorage key for persisting column visibility. */
  visibleColumnsStorageKey?: string
  /** Default sorting state. */
  defaultSorting?: SortingState
}

export interface UseDataTableReturn {
  // Pagination
  pageInfo: PageInfo
  setPageInfo: React.Dispatch<React.SetStateAction<PageInfo>>
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void

  // Sorting (TanStack native)
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  /** Derived sort column name, or null when unsorted. */
  sortColumn: string | null
  /** Derived sort direction, or null when unsorted. */
  sortDirection: 'asc' | 'desc' | null

  // Column visibility (TanStack native)
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  /** List of currently visible column IDs (convenience getter). */
  visibleColumns: string[]
  /** Toggle a single column's visibility. */
  toggleColumn: (columnId: string, visible: boolean) => void

  // Row selection (TanStack native)
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  /** Array of selected row IDs (convenience getter). */
  selectedIds: string[]
  /** Clear all selections. */
  clearSelection: () => void
}

/** Read stored column visibility from localStorage. Returns null on failure. */
function readStoredColumns(storageKey: string): string[] | null {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
    return null
  } catch {
    return null
  }
}

/** Build VisibilityState from an array of visible column IDs. */
function buildVisibilityFromArray(
  visibleIds: string[],
  allColumnIds: string[],
): VisibilityState {
  const state: VisibilityState = {}
  for (const col of allColumnIds) {
    state[col] = visibleIds.includes(col)
  }
  return state
}

/** Build VisibilityState with only hidden columns marked false. */
function buildHiddenState(hiddenIds: string[]): VisibilityState {
  const state: VisibilityState = {}
  for (const col of hiddenIds) {
    state[col] = false
  }
  return state
}

function initVisibleColumnsState(
  storageKey: string | undefined,
  defaultColumns: string[] | undefined,
  defaultHidden: string[] | undefined,
): VisibilityState {
  if (!defaultColumns && !defaultHidden) return {}

  // Try localStorage first
  if (storageKey && defaultColumns) {
    const stored = readStoredColumns(storageKey)
    if (stored) {
      const allKnown = [...defaultColumns, ...(defaultHidden ?? [])]
      return buildVisibilityFromArray(stored, allKnown)
    }
  }

  // Default: hidden columns set to false
  if (defaultHidden && defaultHidden.length > 0) {
    return buildHiddenState(defaultHidden)
  }

  return {}
}

export function useDataTable(options: UseDataTableOptions = {}): UseDataTableReturn {
  const {
    defaultPageSize = 25,
    defaultVisibleColumns,
    defaultHiddenColumns,
    visibleColumnsStorageKey,
    defaultSorting = [],
  } = options

  const [searchParams, setSearchParams] = useSearchParams()

  // --- Pagination ---
  const [pageInfo, setPageInfo] = useState<PageInfo>({
    currentPage: Number.parseInt(searchParams.get('page') || '1', 10),
    pageSize: Number.parseInt(
      searchParams.get('pageSize') || defaultPageSize.toString(),
      10,
    ),
    totalItems: 0,
    totalPages: 1,
  })

  const onPageChange = useCallback(
    (page: number) => {
      setPageInfo((prev) => ({ ...prev, currentPage: page }))
      const params = new URLSearchParams(searchParams)
      params.set('page', page.toString())
      setSearchParams(params)
    },
    [searchParams, setSearchParams],
  )

  const onPageSizeChange = useCallback(
    (size: number) => {
      setPageInfo((prev) => ({ ...prev, pageSize: size, currentPage: 1 }))
      const params = new URLSearchParams(searchParams)
      params.set('pageSize', size.toString())
      params.set('page', '1')
      setSearchParams(params)
    },
    [searchParams, setSearchParams],
  )

  // --- Sorting ---
  const [sorting, setSorting] = useState<SortingState>(defaultSorting)

  const onSortingChange: OnChangeFn<SortingState> = useCallback(
    (updaterOrValue) => {
      setSorting((prev) =>
        typeof updaterOrValue === 'function'
          ? updaterOrValue(prev)
          : updaterOrValue,
      )
    },
    [],
  )

  const sortColumn = sorting.length > 0 ? sorting[0].id : null
  let sortDirection: 'asc' | 'desc' | null = null
  if (sorting.length > 0) sortDirection = sorting[0].desc ? 'desc' : 'asc'

  // --- Column visibility ---
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => initVisibleColumnsState(visibleColumnsStorageKey, defaultVisibleColumns, defaultHiddenColumns),
  )

  const allToggleableColumns = useMemo(
    () => [...(defaultVisibleColumns ?? []), ...(defaultHiddenColumns ?? [])],
    [defaultVisibleColumns, defaultHiddenColumns],
  )

  const onColumnVisibilityChange: OnChangeFn<VisibilityState> = useCallback(
    (updaterOrValue) => {
      setColumnVisibility((prev) => {
        const next =
          typeof updaterOrValue === 'function'
            ? updaterOrValue(prev)
            : updaterOrValue

        // Persist to localStorage
        if (visibleColumnsStorageKey) {
          const visibleIds = allToggleableColumns.filter(
            (col) => next[col] !== false,
          )
          localStorage.setItem(
            visibleColumnsStorageKey,
            JSON.stringify(visibleIds),
          )
        }

        return next
      })
    },
    [visibleColumnsStorageKey, allToggleableColumns],
  )

  const visibleColumns = useMemo(() => {
    return allToggleableColumns.filter((col) => columnVisibility[col] !== false)
  }, [allToggleableColumns, columnVisibility])

  const toggleColumn = useCallback(
    (columnId: string, visible: boolean) => {
      onColumnVisibilityChange((prev) => ({
        ...prev,
        [columnId]: visible,
      }))
    },
    [onColumnVisibilityChange],
  )

  // --- Row selection ---
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const onRowSelectionChange: OnChangeFn<RowSelectionState> = useCallback(
    (updaterOrValue) => {
      setRowSelection((prev) =>
        typeof updaterOrValue === 'function'
          ? updaterOrValue(prev)
          : updaterOrValue,
      )
    },
    [],
  )

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((key) => rowSelection[key]),
    [rowSelection],
  )

  const clearSelection = useCallback(() => {
    setRowSelection({})
  }, [])

  return {
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
  }
}
