/**
 * Shared table utility functions used by suites, tests, regressions, and executions tables.
 */

import type React from 'react'
import type {
  OnChangeFn,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import type { Column } from '@/components/shared/filters/entity-filters'

/**
 * Common trailing columns shared across entity list pages (tests, suites, regressions).
 * Each page prepends its entity-specific columns before spreading these.
 */
export const COMMON_LIST_COLUMNS: readonly Column[] = [
  { id: 'status', label: 'Status', visible: true },
  { id: 'lastRun', label: 'Last Run', visible: true },
  { id: 'tags', label: 'Tags', visible: false },
  { id: 'createdAt', label: 'Created At', visible: false },
  { id: 'updatedAt', label: 'Updated At', visible: false },
]

/** Pagination state for data tables. */
export interface PageInfo {
  /** Current page number (1-based). */
  currentPage: number
  /** Number of items per page. */
  pageSize: number
  /** Total number of items across all pages. */
  totalItems: number
  /** Total number of pages. */
  totalPages: number
}

/** Sort direction for table columns. */
export type SortDirection = 'asc' | 'desc'

/** Table presentation state shared by every entity list page. `TFilters` is the
 *  feature-specific filter shape (search plus entity-specific facets). */
export interface EntityTableResult<TFilters> {
  filters: TFilters
  handleFilterChange: (newFilters: TFilters) => void
  pageInfo: PageInfo
  setPageInfo: React.Dispatch<React.SetStateAction<PageInfo>>
  handlePageChange: (page: number) => void
  handlePageSizeChange: (size: number) => void
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  sortColumn: string | null
  sortDirection: 'asc' | 'desc' | null
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  visibleColumns: string[]
  handleColumnToggle: (columnId: string, visible: boolean) => void
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  selectedIds: string[]
  selectionModeActive: boolean
  setSelectionModeActive: React.Dispatch<React.SetStateAction<boolean>>
  handleEnterSelectionMode: () => void
  handleExitSelectionMode: () => void
}

/** Status style mappings */
const STATUS_TEXT_COLORS: Record<string, string> = {
  passed: 'text-success',
  failed: 'text-error',
  never_run: 'text-muted',
  running: 'text-info',
  stopped: 'text-muted',
  pending: 'text-muted',
  skipped: 'text-muted',
  excluded: 'text-muted',
  warning: 'text-warning',
}

const STATUS_DOT_COLORS: Record<string, string> = {
  passed: 'bg-success',
  failed: 'bg-error',
  never_run: 'bg-muted',
  running: 'bg-info',
  stopped: 'bg-muted',
  pending: 'bg-muted',
  skipped: 'bg-muted',
  excluded: 'bg-muted',
  warning: 'bg-warning',
}

const STATUS_LABELS: Record<string, string> = {
  passed: 'Passed',
  failed: 'Failed',
  never_run: 'Never Run',
  running: 'Running',
  stopped: 'Stopped',
  pending: 'Pending',
  skipped: 'Skipped',
  excluded: 'Excluded',
  warning: 'Warning',
}

/** Get text color class for a status value. */
export function getStatusColor(status: string): string {
  return STATUS_TEXT_COLORS[status] ?? 'text-muted'
}

/** Get dot/badge background color class for a status value. */
export function getStatusDotColor(status: string): string {
  return STATUS_DOT_COLORS[status] ?? 'bg-muted'
}

/** Get human-readable label for a status value. */
export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

/** Terminal (finished) execution statuses: Re-run + Delete become available. */
const TERMINAL_STATUSES = new Set(['passed', 'failed', 'stopped', 'skipped'])

/** True when an execution has finished, so it can be re-run or deleted. */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Build URLSearchParams from a filters object, resetting to page 1.
 *
 * String values are set directly when truthy.
 * Array values are joined with commas when non-empty.
 * Always appends page=1 and the given pageSize.
 */
export function buildFilterParams(
  filters: object,
  pageSize: number,
): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','))
    } else if (typeof value === 'string' && value) {
      params.set(key, value)
    }
  }
  params.set('page', '1')
  params.set('pageSize', pageSize.toString())
  return params
}
