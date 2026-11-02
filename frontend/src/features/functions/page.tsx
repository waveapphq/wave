/**
 * FunctionsPage Component.
 *
 * Presentational Function library list, mirroring the canonical TestsPage.
 * Differences from TestsPage: columns Name(+desc)/Tags/Version/Updated/
 * Actions; view/export/delete row actions; NO New affordance (Functions are
 * born inside a Test); Search + Tags filters only; bulk export + delete only.
 */

import { useMemo } from 'react'
import type {
  ColumnDef,
  OnChangeFn,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import { FunctionSquare } from 'lucide-react'
import { ListPageHeader } from '@/components/shared/list-page-header'
import { ListErrorState, ListEmptyState } from '@/components/shared/list-page-states'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { Column } from '@/components/shared/filters/entity-filters'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import { FunctionsFilters, type FunctionsFiltersState } from '@/features/functions/components/functions-filters'
import { FunctionsBulkActions } from '@/features/functions/components/functions-bulk-actions'
import { getFunctionsColumns, type FunctionRow } from '@/features/functions/components/functions-columns'
import { listVisibility } from '@/lib/list-visibility'

export type { FunctionRow } from '@/features/functions/components/functions-columns'
export type { PageInfo } from '@/components/shared/tables/table-utils'

export interface FunctionsPageProps {
  functions: FunctionRow[]
  pageInfo: PageInfo
  filters: FunctionsFiltersState
  allTags: string[]
  loading?: boolean
  /** False until the first read has finished; skeletons stand in until it has. */
  settled?: boolean
  error?: string
  className?: string
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  visibleColumns: string[]
  enableSelection: boolean
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  selectedIds: string[]
  onViewFunction: (functionId: string) => void
  onExportFunction: (functionId: string) => void
  onDeleteFunction: (functionId: string) => void
  onBulkDelete: () => void
  onBulkExport: () => void
  onImport: () => void
  onFilterChange: (filters: FunctionsFiltersState) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
  onRetry: () => void
}

// Toggleable columns (Name + Actions are always visible).
const FUNCTION_FILTER_COLUMNS: Column[] = [
  { id: 'tags', label: 'Tags', visible: false },
  { id: 'version', label: 'Version', visible: true },
  { id: 'updated', label: 'Updated', visible: true },
]

export function FunctionsPage({
  functions,
  pageInfo,
  filters,
  allTags,
  loading = false,
  settled = true,
  error,
  className = '',
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  visibleColumns,
  enableSelection,
  rowSelection,
  onRowSelectionChange,
  selectedIds,
  onViewFunction,
  onExportFunction,
  onDeleteFunction,
  onBulkDelete,
  onBulkExport,
  onImport,
  onFilterChange,
  onPageChange,
  onPageSizeChange,
  onColumnToggle,
  onEnterSelectionMode,
  onExitSelectionMode,
  onRetry,
}: Readonly<FunctionsPageProps>) {
  const columnsWithVisibility: Column[] = FUNCTION_FILTER_COLUMNS.map((col) => ({
    ...col,
    visible: visibleColumns.includes(col.id),
  }))

  const columns: ColumnDef<FunctionRow, unknown>[] = useMemo(
    () =>
      getFunctionsColumns({
        onView: onViewFunction,
        onExport: onExportFunction,
        onDelete: onDeleteFunction,
      }),
    [onViewFunction, onExportFunction, onDeleteFunction],
  )

  const hasActiveFilters = filters.search !== '' || filters.tags.length > 0

  const handleClearFilters = () => {
    onFilterChange({ search: '', tags: [] })
  }

  const showError = !!error
  const { busy, showEmpty, showTable } = listVisibility(settled, loading, error, functions.length)
  const isFilteredEmpty = showEmpty && hasActiveFilters

  return (
    <div
      data-testid="functions-page"
      aria-busy={busy ? 'true' : 'false'}
      className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
    >
      <ListPageHeader title="Functions" onImport={onImport} />

      <FunctionsFilters
        filters={filters}
        allTags={allTags}
        columns={columnsWithVisibility}
        onFilterChange={onFilterChange}
        onColumnToggle={onColumnToggle}
        disabled={showError}
        actions={
          showTable && !busy ? (
            <FunctionsBulkActions
              selectedCount={selectedIds.length}
              totalCount={functions.length}
              selectionModeActive={enableSelection}
              onExport={onBulkExport}
              onDelete={onBulkDelete}
              onEnterSelectionMode={onEnterSelectionMode}
              onExitSelectionMode={onExitSelectionMode}
            />
          ) : undefined
        }
      />

      {showError && <ListErrorState entityName="functions" error={error} onRetry={onRetry} />}

      {showEmpty && (
        <ListEmptyState
          entityName="functions"
          entityNameSingular="Function"
          icon={FunctionSquare}
          emptyDescription="Functions are born inside a Test. Build one in the Workbench and publish it to populate the library."
          isFilteredEmpty={isFilteredEmpty}
          onClearFilters={handleClearFilters}
        />
      )}

      {showTable && (
        <DataTable
          data-testid="functions-table"
          columns={columns}
          data={functions}
          loading={busy}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.name}
          sorting={sorting}
          onSortingChange={onSortingChange}
          manualSorting
          pageInfo={pageInfo}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          entityName="functions"
          enableSelection={enableSelection}
          rowSelection={rowSelection}
          onRowSelectionChange={onRowSelectionChange}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={onColumnVisibilityChange}
        />
      )}
    </div>
  )
}
