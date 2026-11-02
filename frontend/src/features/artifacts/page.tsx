/**
 * Execution-first artifacts landing list.
 *
 * Reports/Executions list chrome (filters, DataTable, pagination) with one row
 * per execution that has artifacts: Execution / Type / Status / Finished /
 * Artifacts / Size. Adds a selection mode + mass actions (Download .zip, Delete
 * artifacts). No "+ New" - artifacts come from executions.
 */

import { useMemo } from 'react'
import { Archive, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/format-bytes'
import type {
  SortingState,
  OnChangeFn,
  VisibilityState,
  RowSelectionState,
} from '@tanstack/react-table'
import {
  ArtifactsFilters as ArtifactsFiltersComponent,
  type ArtifactsFilters as ArtifactsFiltersType,
} from '@/features/artifacts/components/artifacts-filters'
import { ArtifactsBulkActions } from '@/features/artifacts/components/artifacts-bulk-actions'
import { DataTable } from '@/components/shared/data-table/data-table'
import { getArtifactsColumns } from '@/features/artifacts/components/artifacts-columns'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import type { ExecutionArtifactSummary } from '@/features/artifacts/api/types'

export type { ArtifactsFilters } from '@/features/artifacts/components/artifacts-filters'

export interface ArtifactsListPageProps {
  rows: ExecutionArtifactSummary[]
  pageInfo: PageInfo
  filters: ArtifactsFiltersType
  loading: boolean
  error?: string
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  visibleColumns: string[]
  onColumnToggle: (columnId: string, visible: boolean) => void
  selectionModeActive: boolean
  selectedCount: number
  totalSizeBytes: number
  selectedSizeBytes: number
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
  onOpenExecution: (execution: ExecutionArtifactSummary) => void
  onDownloadZip: (execution?: ExecutionArtifactSummary) => void
  onDeleteSelected: (execution?: ExecutionArtifactSummary) => void
  onFilterChange: (filters: ArtifactsFiltersType) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onRetry: () => void
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
}

const COLUMNS = [
  { id: 'execution', label: 'Execution', visible: true },
  { id: 'type', label: 'Type', visible: true },
  { id: 'status', label: 'Status', visible: true },
  { id: 'finishedAt', label: 'Finished', visible: true },
  { id: 'artifacts', label: 'Artifacts', visible: true },
  { id: 'size', label: 'Size', visible: true },
]

export function ArtifactsListPage({
  rows,
  pageInfo,
  filters,
  loading,
  error,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  visibleColumns,
  onColumnToggle,
  selectionModeActive,
  selectedCount,
  totalSizeBytes,
  selectedSizeBytes,
  onEnterSelectionMode,
  onExitSelectionMode,
  onOpenExecution,
  onDownloadZip,
  onDeleteSelected,
  onFilterChange,
  onPageChange,
  onPageSizeChange,
  onRetry,
  rowSelection,
  onRowSelectionChange,
}: Readonly<ArtifactsListPageProps>) {
  const columnsWithVisibility = COLUMNS.map((col) => ({
    ...col,
    visible: visibleColumns.includes(col.id),
  }))

  const tableColumns = useMemo(
    () =>
      getArtifactsColumns({
        onOpen: onOpenExecution,
        onDownloadZip,
        onDelete: onDeleteSelected,
      }),
    [onOpenExecution, onDownloadZip, onDeleteSelected],
  )

  const showError = !!error
  const showTable = !error && (loading || rows.length > 0)
  const showEmpty = !error && !loading && rows.length === 0

  if (showError) {
    return (
      <div data-testid="artifacts-page" className="flex h-full flex-col gap-6 overflow-hidden p-6">
        <div className="flex min-h-10 items-center justify-between">
          <h1 className="text-2xl font-semibold">Artifacts</h1>
        </div>
        <div
          data-testid="error-state"
          className="flex flex-1 flex-col items-center justify-center gap-4"
        >
          <AlertTriangle className="h-12 w-12 text-error" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-muted">{error}</p>
          <Button variant="primary" onClick={onRetry}>
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="artifacts-page"
      className="flex h-full flex-col gap-6 overflow-hidden p-6"
      aria-busy={loading}
    >
      <div className="flex min-h-10 items-start justify-between gap-4">
        <div className="flex flex-col justify-center">
          <h1 className="text-2xl font-semibold">Artifacts</h1>
          <p className="text-sm text-muted">
            Browse outputs by execution. Open one to see its reports, logs and files.
          </p>
        </div>
        {showTable && (
          <div
            data-testid="artifacts-total-size"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border bg-subtle px-3 py-1.5"
          >
            <Archive className="h-4 w-4 text-muted" aria-hidden="true" />
            <span className="text-sm font-semibold tabular-nums text-secondary">
              {formatBytes(totalSizeBytes)}
            </span>
            <span className="text-sm text-muted">total</span>
          </div>
        )}
      </div>

      <ArtifactsFiltersComponent
        filters={filters}
        columns={columnsWithVisibility}
        onFilterChange={onFilterChange}
        onColumnToggle={onColumnToggle}
        disabled={showEmpty}
        actions={
          showTable ? (
            <ArtifactsBulkActions
              selectedCount={selectedCount}
              totalCount={pageInfo.totalItems}
              selectedSizeBytes={selectedSizeBytes}
              selectionModeActive={selectionModeActive}
              onDownloadZip={onDownloadZip}
              onDelete={onDeleteSelected}
              onEnterSelectionMode={onEnterSelectionMode}
              onExitSelectionMode={onExitSelectionMode}
            />
          ) : undefined
        }
      />

      {showEmpty && (
        <div
          data-testid="empty-state"
          className="flex flex-1 flex-col items-center justify-center gap-4"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/20">
            <Archive className="h-8 w-8 text-muted" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold">No executions with artifacts yet</h2>
          <p className="text-muted">Finished executions that produced artifacts appear here</p>
        </div>
      )}

      {showTable && (
        <DataTable
          data-testid="artifacts-table"
          columns={tableColumns}
          data={rows}
          loading={loading}
          getRowId={(row) => row.execution_id}
          getRowLabel={(row) => row.name ?? row.execution_id}
          sorting={sorting}
          onSortingChange={onSortingChange}
          manualSorting
          pageInfo={pageInfo}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          entityName="artifacts"
          enableSelection={selectionModeActive}
          rowSelection={rowSelection}
          onRowSelectionChange={onRowSelectionChange}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={onColumnVisibilityChange}
        />
      )}
    </div>
  )
}
