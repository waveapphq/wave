/**
 * Shared DataTable types.
 *
 * Extends TanStack Table's ColumnDef with WAVE-specific metadata
 * for sticky positioning and skeleton widths.
 */

import type { ReactNode } from 'react'
import type {
  ColumnDef,
  ExpandedState,
  OnChangeFn,
  Row,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import type { PageInfo } from '@/components/shared/tables/table-utils'

/** Custom column metadata for WAVE table features. */
export interface DataTableColumnMeta {
  /** Sticky positioning for horizontal scroll. */
  sticky?: 'left' | 'right'
  /** Tailwind width class for skeleton loading state (e.g. 'w-24'). */
  skeletonWidth?: string
  /** Tailwind class for skeleton height (e.g. 'h-5'). Defaults to 'h-4'. */
  skeletonHeight?: string
  /** Tailwind width class for the column, set on its header cell (e.g. 'w-32'); columns without one share the rest. */
  width?: string
}

/** Props for the DataTable component. */
export interface DataTableProps<TData> {
  /** TanStack column definitions with optional WAVE metadata. */
  columns: ColumnDef<TData, unknown>[]
  /** Row data to display. */
  data: TData[]

  // --- Sorting ---
  /** Controlled sorting state. */
  sorting?: SortingState
  /** Callback when sorting changes. */
  onSortingChange?: OnChangeFn<SortingState>
  /** When true, sorting is handled externally (server-side). */
  manualSorting?: boolean
  /** Enable/disable sorting globally. Defaults to true. */
  enableSorting?: boolean

  // --- Pagination ---
  /** Pagination state for display and navigation. */
  pageInfo?: PageInfo
  /** Callback when page changes. */
  onPageChange?: (page: number) => void
  /** Callback when page size changes. */
  onPageSizeChange?: (size: number) => void
  /** Entity name for pagination display (e.g. "tests"). */
  entityName?: string

  // --- Selection ---
  /** Enable row selection with checkboxes. */
  enableSelection?: boolean
  /** Controlled row selection state (keyed by row ID). */
  rowSelection?: RowSelectionState
  /** Callback when selection changes. */
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  /** Content to render in the toolbar when rows are selected. */
  bulkActions?: ReactNode
  /** Which rows can be selected; a non-selectable row shows a disabled checkbox. Defaults to every row. */
  canSelectRow?: (row: TData) => boolean

  // --- Column visibility ---
  /** Controlled column visibility state. */
  columnVisibility?: VisibilityState
  /** Callback when column visibility changes. */
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>

  // --- Client-side pagination ---
  /** Default page size for client-side pagination (when pageInfo is not provided). */
  defaultPageSize?: number

  // --- Drag and drop ---
  /** Enable drag-and-drop row reordering. */
  enableDnD?: boolean
  /** Callback with new row ID order after a drag-and-drop reorder. */
  onReorder?: (newOrder: string[]) => void

  // --- Loading & empty ---
  /** Show skeleton loading state. */
  loading?: boolean
  /** Number of skeleton rows to show. Defaults to 9. */
  skeletonRowCount?: number
  /** Icon for empty state. */
  emptyIcon?: ReactNode
  /** Message for empty state. */
  emptyMessage?: string
  /** Action button for empty state. */
  emptyAction?: ReactNode

  // --- Row identity ---
  /** Extract a unique ID from each row. Required for selection. */
  getRowId?: (row: TData) => string
  /** Extract a human-readable label from each row for aria labels. */
  getRowLabel?: (row: TData) => string

  // --- Row expansion (opt-in) ---
  /** Return child rows for a given row. When provided, enables hierarchical expansion. */
  getSubRows?: (row: TData) => TData[] | undefined
  /** Controlled expanded state. */
  expanded?: ExpandedState
  /** Callback when expanded state changes. */
  onExpandedChange?: OnChangeFn<ExpandedState>
  /** Predicate controlling which rows can be expanded. Defaults to rows whose getSubRows returns a non-empty array. */
  getRowCanExpand?: (row: Row<TData>) => boolean

  // --- Styling ---
  /** Additional className for the outer wrapper. */
  className?: string
  /** data-testid for the outer wrapper. */
  'data-testid'?: string
}
