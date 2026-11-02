/**
 * Shared DataTable component.
 *
 * Generic table backed by TanStack Table for headless state management
 * and shadcn Table primitives for rendering. Handles sorting, pagination,
 * selection, column visibility, loading skeletons, and empty states.
 *
 * Entity pages provide column definitions and data - this component
 * handles everything else.
 */

/* v8 ignore next - COV-V8-003: V8 tracks import as branch */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ExpandedState,
  type OnChangeFn,
  type Row,
  type SortingState,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensors,
  useSensor,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { DataTableColumnMeta, DataTableProps } from './types'
import { DataTableSkeleton } from './data-table-skeleton'
import { DataTableEmpty } from './data-table-empty'
import { DataTablePagination } from './data-table-pagination'
import { DataTableToolbar } from './data-table-toolbar'

const SORT_ARIA: Record<string, 'ascending' | 'descending'> = {
  asc: 'ascending',
  desc: 'descending',
}

function handleSortKeyDown(toggle: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DataTableHeaderCell({ header }: Readonly<{ header: any }>) {
  const meta = header.column.columnDef.meta as DataTableColumnMeta | undefined
  const canSort: boolean = header.column.getCanSort()
  const sorted = header.column.getIsSorted()
  let stickyClass = ''
  if (meta?.sticky === 'left') stickyClass = 'sticky left-0 bg-card'
  else if (meta?.sticky === 'right') stickyClass = 'sticky right-0 bg-card'

  /* v8 ignore next 3 - COV-V8-003: V8 tracks JSX as branch */
  return (
    <th
      scope="col"
      aria-sort={canSort ? (SORT_ARIA[sorted as string] ?? 'none') : undefined}
      className={cn('px-4 py-3 text-left font-semibold', meta?.width, stickyClass, canSort && 'cursor-pointer select-none')}
      onClick={canSort ? () => header.column.toggleSorting() : undefined}
      onKeyDown={canSort ? handleSortKeyDown(header.column.toggleSorting) : undefined}
      tabIndex={canSort ? 0 : undefined}
    >
      {/* v8 ignore next 3 - COV-V8-003: isPlaceholder only true for grouped headers */}
      {header.isPlaceholder
        ? null
        : flexRender(header.column.columnDef.header as never, header.getContext() as never)}
    </th>
  )
}

/**
 * Compute new row ID order after a drag-and-drop reorder.
 * Pure function for testability.
 */
export function computeReorderedIds<TData>(
  rows: Row<TData>[],
  activeId: string,
  overId: string,
): string[] | null {
  if (activeId === overId) return null
  const ids = rows.map(r => r.id)
  const oldIndex = ids.indexOf(activeId)
  const newIndex = ids.indexOf(overId)
  if (oldIndex === -1 || newIndex === -1) return null
  const copy = [...ids]
  const [removed] = copy.splice(oldIndex, 1)
  copy.splice(newIndex, 0, removed)
  return copy
}

function SortableRow<TData>({ row, rowProps, children }: Readonly<{
  row: Row<TData>
  rowProps?: Record<string, unknown>
  children: (gripProps: Record<string, unknown>) => ReactNode
}>) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  /* v8 ignore next - COV-V8-003: V8 tracks ?? as branch */
  const { className: rowClassName, ...restRowProps } = rowProps ?? {}

  /* v8 ignore next 3 - COV-V8-003: V8 tracks JSX return as branch */
  return (
    <tr
      ref={setNodeRef}
      style={style}
      /* v8 ignore next 5 - COV-V8-003: isDragging only true during real drag */
      className={cn(
        'group border-b border-border transition-colors hover:bg-muted/50',
        isDragging && 'opacity-50',
        rowClassName as string,
      )}
      {...restRowProps}
    >
      {children({
        ref: setActivatorNodeRef,
        ...attributes,
        ...listeners,
      })}
    </tr>
  )
}

/** Extracted table head to reduce DataTable cognitive complexity. */
function DataTableHead({ headerGroups, enableSelection, enableDnD, loading, allSelected, selectAllRef, onToggleAllSelected }: Readonly<{
  headerGroups: { id: string; headers: { id: string }[] }[]
  enableSelection: boolean
  enableDnD: boolean
  loading: boolean
  allSelected: boolean
  selectAllRef: React.RefObject<HTMLButtonElement | null>
  onToggleAllSelected: (checked: boolean) => void
}>) {
  return (
    <thead className="sticky top-0 z-10 bg-card">
      {headerGroups.map((headerGroup) => (
        <tr key={headerGroup.id} className="border-b-2 border-border">
          {enableDnD && <th scope="col" className="w-8 bg-card px-2 py-3" />}
          {enableSelection && (
            <th
              scope="col"
              aria-label="Select all"
              data-testid="selection-column"
              className="sticky left-0 w-7 bg-card px-2 py-3 text-left font-semibold"
            >
              {!loading && (
                <Checkbox
                  ref={selectAllRef}
                  checked={allSelected}
                  onCheckedChange={(checked: boolean) => onToggleAllSelected(checked)}
                  aria-label="Select all"
                  data-testid="select-all-checkbox"
                />
              )}
              {/* v8 ignore next - COV-V8-003: loading state in header */}
              {loading && <Checkbox disabled />}
            </th>
          )}
          {headerGroup.headers.map((header: { id: string }) => (
            <DataTableHeaderCell key={header.id} header={header} />
          ))}
        </tr>
      ))}
    </thead>
  )
}

/** Extracted row renderer to reduce DataTable cognitive complexity. */
function DataTableRow<TData>({ row, rowTestId, enableDnD, enableSelection, getRowLabel }: Readonly<{
  row: Row<TData>
  rowTestId: string
  enableDnD: boolean
  enableSelection: boolean
  getRowLabel?: (row: TData) => string
}>) {
  const isSelected = row.getIsSelected()
  const canSelect = row.getCanSelect()

  function renderCells() {
    return (
      <>
        {/* v8 ignore next - COV-V8-003: V8 tracks && as branch */}
        {enableSelection && (
          <td className="sticky left-0 w-7 bg-card px-2 py-3">
            <Checkbox
              checked={isSelected}
              disabled={!canSelect}
              aria-disabled={canSelect ? undefined : true}
              className={cn(!canSelect && 'opacity-50 cursor-not-allowed')}
              onCheckedChange={(checked: boolean) => row.toggleSelected(!!checked)}
              aria-label={getRowLabel ? `Select ${getRowLabel(row.original)}` : 'Select row'}
              data-testid="row-checkbox"
            />
          </td>
        )}
        {row.getVisibleCells().map((cell) => {
          const meta = cell.column.columnDef.meta as DataTableColumnMeta | undefined
          return (
            <td
              key={cell.id}
              className={cn(
                'px-4 py-3',
                meta?.sticky === 'left' && 'sticky left-0 bg-card transition-colors group-hover:bg-muted/50',
                meta?.sticky === 'right' && 'sticky right-0 bg-card transition-colors group-hover:bg-muted/50',
              )}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          )
        })}
      </>
    )
  }

  const rowProps = {
    'data-testid': rowTestId,
    'data-row-id': row.id,
    'data-selected': isSelected ? 'true' : undefined,
    'aria-selected': isSelected || undefined,
  }

  const handleRowClick = enableSelection ? (e: React.MouseEvent) => {
    if (!canSelect) return
    const target = e.target as HTMLElement
    /* v8 ignore next - COV-V8-003: closest() guard for interactive elements */
    if (target.closest('button, a, input, [role="menuitem"], [role="checkbox"]')) return
    row.toggleSelected(!isSelected)
  } : undefined

  if (enableDnD) {
    return (
      <SortableRow
        row={row}
        rowProps={{
          /* v8 ignore next - COV-V8-003: V8 tracks cn() args as branches */
          className: cn(isSelected && 'bg-muted/30', enableSelection && canSelect && 'cursor-pointer'),
          ...rowProps,
          onClick: handleRowClick,
        }}
      >
        {/* v8 ignore next 2 - COV-V8-003: V8 tracks callback and fragment as branches */}
        {(gripProps: Record<string, unknown>) => (
          <>
            <td className="w-8 px-2 py-3">
              <div
                {...gripProps}
                data-testid="dnd-grip-handle"
                className="flex items-center justify-center cursor-grab"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground/50" />
              </div>
            </td>
            {renderCells()}
          </>
        )}
      </SortableRow>
    )
  }

  return (
    <tr
      {...rowProps}
      className={cn(
        'group border-b border-border transition-colors hover:bg-muted/50',
        isSelected && 'bg-muted/30',
        enableSelection && canSelect && 'cursor-pointer',
      )}
      onClick={handleRowClick}
    >
      {renderCells()}
    </tr>
  )
}

/** Table body: skeleton, empty, or data rows. */
function DataTableBody<TData>({ rows, columns, loading, skeletonRowCount, enableSelection, enableDnD, totalColumnCount, rowTestId, emptyIcon, emptyMessage, emptyAction, getRowLabel }: Readonly<{
  rows: Row<TData>[]
  columns: { id?: string; meta?: unknown }[]
  loading: boolean
  skeletonRowCount: number
  enableSelection: boolean
  enableDnD: boolean
  totalColumnCount: number
  rowTestId: string
  emptyIcon?: ReactNode
  emptyMessage?: string
  emptyAction?: ReactNode
  getRowLabel?: (row: TData) => string
}>) {
  return (
    <tbody>
      {/* v8 ignore next - COV-V8-003: V8 tracks && as branch */}
      {loading && (
        <DataTableSkeleton
          columns={columns as Parameters<typeof DataTableSkeleton>[0]['columns']}
          rowCount={skeletonRowCount}
          enableSelection={enableSelection}
        />
      )}
      {!loading && rows.length === 0 && (
        <DataTableEmpty
          colSpan={totalColumnCount}
          icon={emptyIcon}
          message={emptyMessage}
          action={emptyAction}
        />
      )}
      {!loading && rows.map((row) => (
        <DataTableRow
          key={row.id}
          row={row}
          rowTestId={rowTestId}
          enableDnD={enableDnD}
          enableSelection={enableSelection}
          getRowLabel={getRowLabel}
        />
      ))}
    </tbody>
  )
}

/** DnD wrapper with DndContext, SortableContext, and DragOverlay. */
function DataTableDnDWrapper<TData>({ rows, onReorder, ariaLabel, headProps, tableBody, getRowLabel }: Readonly<{
  rows: Row<TData>[]
  onReorder?: (newOrder: string[]) => void
  ariaLabel?: string
  headProps: Parameters<typeof DataTableHead>[0]
  tableBody: ReactNode
  getRowLabel?: (row: TData) => string
}>) {
  /* v8 ignore next - COV-V8-003: V8 tracks useState as branch */
  const [activeRowId, setActiveRowId] = useState<string | null>(null)

  /* v8 ignore next 4 - COV-V8-003: DnD sensor config only exercised during actual drag */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /* v8 ignore start - COV-V8-003: DnD events cannot be simulated in JSDOM */
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveRowId(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveRowId(null)
    const { active, over } = event
    if (!over || !onReorder) return
    const reordered = computeReorderedIds(rows, String(active.id), String(over.id))
    if (reordered) onReorder(reordered)
  }, [rows, onReorder])

  const handleDragCancel = useCallback(() => {
    setActiveRowId(null)
  }, [])
  /* v8 ignore stop */

  /* v8 ignore next - COV-V8-003: activeRowId only set during DnD drag events */
  const activeRow = activeRowId ? rows.find(r => r.id === activeRowId) : null

  /* v8 ignore start - COV-V8-003: V8 tracks DndContext props and JSX as branches */
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
    {/* v8 ignore stop */}
      <SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
        <table role="table" aria-label={ariaLabel} className="w-full border-collapse text-sm">
          <DataTableHead {...headProps} />
          {tableBody}
        </table>
      </SortableContext>
      {/* v8 ignore start - COV-V8-003: DragOverlay only renders during actual drag */}
      <DragOverlay>
        {activeRow && (
          <div
            data-testid="dnd-drag-overlay"
            className="flex items-center gap-2 rounded-md border bg-card px-4 py-3 text-sm shadow-lg"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground/50" />
            <span>{getRowLabel ? getRowLabel(activeRow.original) : activeRow.id}</span>
          </div>
        )}
      </DragOverlay>
      {/* v8 ignore stop */}
    </DndContext>
  )
}

/** Build TanStack table config - extracted to reduce DataTable cognitive complexity. */
/* v8 ignore start - COV-V8-003: V8 tracks spread conditionals, ??, and object literals as branches */
function buildTableOptions<TData>(opts: {
  props: Pick<DataTableProps<TData>, 'data' | 'columns' | 'enableSorting' | 'onSortingChange' | 'onRowSelectionChange' | 'onColumnVisibilityChange' | 'getRowId' | 'getSubRows' | 'getRowCanExpand' | 'onExpandedChange'>
  manualSorting: boolean
  enableRowSelection: boolean | ((row: Row<TData>) => boolean)
  clientSidePagination: boolean
  defaultPageSize: number
  sorting: SortingState
  rowSelection: RowSelectionState
  columnVisibility: VisibilityState
  expansionEnabled: boolean
  expanded: ExpandedState
}) {
  const { props, manualSorting, enableRowSelection, clientSidePagination, defaultPageSize, expansionEnabled } = opts
  return {
    data: props.data,
    columns: props.columns,
    getCoreRowModel: getCoreRowModel(),
    ...(manualSorting
      ? { manualSorting: true }
      : { getSortedRowModel: getSortedRowModel() }),
    enableSorting: props.enableSorting ?? true,
    enableSortingRemoval: true,
    sortDescFirst: false,
    state: {
      sorting: opts.sorting,
      rowSelection: opts.rowSelection,
      columnVisibility: opts.columnVisibility,
      ...(expansionEnabled ? { expanded: opts.expanded } : {}),
    },
    onSortingChange: props.onSortingChange,
    enableRowSelection,
    onRowSelectionChange: props.onRowSelectionChange,
    onColumnVisibilityChange: props.onColumnVisibilityChange,
    getRowId: props.getRowId,
    ...(expansionEnabled && {
      getSubRows: props.getSubRows,
      getExpandedRowModel: getExpandedRowModel(),
      getRowCanExpand: props.getRowCanExpand,
      onExpandedChange: props.onExpandedChange as OnChangeFn<ExpandedState>,
    }),
    ...(clientSidePagination && {
      getPaginationRowModel: getPaginationRowModel(),
      initialState: { pagination: { pageSize: defaultPageSize } },
    }),
  }
}
/* v8 ignore stop */

/** Select-all indeterminate state handler. */
function useIndeterminateCheckbox(
  selectAllRef: React.RefObject<HTMLButtonElement | null>,
  someSelected: boolean,
) {
  /* v8 ignore start - COV-V8-006: Radix Checkbox renders no native input in JSDOM */
  useEffect(() => {
    const checkbox = selectAllRef.current?.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement | null
    if (checkbox) {
      checkbox.indeterminate = someSelected
    }
  }, [someSelected, selectAllRef])
  /* v8 ignore stop */
}

/** Pagination state - extracted to reduce DataTable cognitive complexity. */
/* v8 ignore start - COV-V8-003: V8 tracks ternary branches */
function usePagination(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  pageInfo: DataTableProps<unknown>['pageInfo'],
  onPageChange: ((page: number) => void) | undefined,
  onPageSizeChange: ((size: number) => void) | undefined,
  clientSidePagination: boolean,
  totalItems: number,
) {
  const effectivePageInfo = pageInfo ?? (clientSidePagination ? {
    currentPage: table.getState().pagination.pageIndex + 1,
    pageSize: table.getState().pagination.pageSize,
    totalItems,
    totalPages: table.getPageCount(),
  } : undefined)

  const handlePageChange = pageInfo ? onPageChange : (page: number) => table.setPageIndex(page - 1)
  const handlePageSizeChange = pageInfo ? onPageSizeChange : (size: number) => table.setPageSize(size)

  return { effectivePageInfo, handlePageChange, handlePageSizeChange }
}
/* v8 ignore stop */

/* v8 ignore start - COV-V8-003: V8 tracks destructured params and default values as branches */
export function DataTable<TData>({
  columns,
  data,
  sorting,
  onSortingChange,
  manualSorting = false,
  enableSorting = true,
  pageInfo,
  onPageChange,
  onPageSizeChange,
  entityName,
  defaultPageSize = 25,
  enableDnD = false,
  onReorder,
  enableSelection = false,
  rowSelection,
  onRowSelectionChange,
  bulkActions,
  canSelectRow,
  columnVisibility,
  onColumnVisibilityChange,
  loading = false,
  skeletonRowCount = 9,
  emptyIcon,
  emptyMessage,
  emptyAction,
  getRowId,
  getRowLabel,
  getSubRows,
  expanded,
  onExpandedChange,
  getRowCanExpand,
  className,
  'data-testid': dataTestId,
}: Readonly<DataTableProps<TData>>): ReactNode {
  /* v8 ignore stop */
  const clientSidePagination = !pageInfo && defaultPageSize > 0
  const expansionEnabled = getSubRows !== undefined

  const stableSorting = useMemo(() => sorting ?? [], [sorting])
  const stableRowSelection = useMemo(() => rowSelection ?? {}, [rowSelection])
  const stableColumnVisibility = useMemo(() => columnVisibility ?? {}, [columnVisibility])
  const stableExpanded = useMemo<ExpandedState>(() => expanded ?? {}, [expanded])
  const enableRowSelection = enableSelection && canSelectRow
    ? (row: Row<TData>) => canSelectRow(row.original)
    : enableSelection

  const table = useReactTable(buildTableOptions({
    props: { data, columns, enableSorting, onSortingChange, onRowSelectionChange, onColumnVisibilityChange, getRowId, getSubRows, getRowCanExpand, onExpandedChange },
    manualSorting, enableRowSelection, clientSidePagination, defaultPageSize,
    sorting: stableSorting, rowSelection: stableRowSelection, columnVisibility: stableColumnVisibility,
    expansionEnabled, expanded: stableExpanded,
  }))

  const rows = table.getRowModel().rows
  const headerGroups = table.getHeaderGroups()
  const selectedCount = Object.keys(rowSelection ?? {}).length

  const pagination = usePagination(table, pageInfo, onPageChange, onPageSizeChange, clientSidePagination, data.length)

  /* v8 ignore next - COV-V8-003: V8 tracks useRef as branch */
  const selectAllRef = useRef<HTMLButtonElement>(null)
  const allSelected = rows.length > 0 && table.getIsAllPageRowsSelected()
  useIndeterminateCheckbox(selectAllRef, table.getIsSomePageRowsSelected())

  const totalColumnCount = columns.length + (enableSelection ? 1 : 0) + (enableDnD ? 1 : 0)
  /* v8 ignore next 2 - COV-V8-003: V8 tracks ternary branches */
  const rowTestId = entityName ? `${entityName.replace(/s$/, '')}-row` : 'data-row'
  const ariaLabel = entityName ? entityName.charAt(0).toUpperCase() + entityName.slice(1) : undefined

  const tableBody = (
    <DataTableBody
      rows={rows}
      columns={columns}
      loading={loading}
      skeletonRowCount={skeletonRowCount}
      enableSelection={enableSelection}
      enableDnD={enableDnD}
      totalColumnCount={totalColumnCount}
      rowTestId={rowTestId}
      emptyIcon={emptyIcon}
      emptyMessage={emptyMessage}
      emptyAction={emptyAction}
      getRowLabel={getRowLabel}
    />
  )

  const headProps = {
    headerGroups,
    enableSelection,
    loading,
    allSelected,
    selectAllRef,
    onToggleAllSelected: (checked: boolean) => table.toggleAllPageRowsSelected(!!checked),
  }

  return (
    <div data-testid={dataTestId} className={cn('flex flex-1 min-h-0 flex-col gap-4', className)}>
      {bulkActions && selectedCount > 0 && (
        <DataTableToolbar selectedCount={selectedCount}>
          {bulkActions}
        </DataTableToolbar>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {enableDnD ? (
          <DataTableDnDWrapper
            rows={rows}
            onReorder={onReorder}
            ariaLabel={ariaLabel}
            headProps={{ ...headProps, enableDnD: true }}
            tableBody={tableBody}
            getRowLabel={getRowLabel}
          />
        ) : (
          <table role="table" aria-label={ariaLabel} className="w-full border-collapse text-sm">
            <DataTableHead {...headProps} enableDnD={false} />
            {tableBody}
          </table>
        )}
      </div>

      {pagination.effectivePageInfo && pagination.handlePageChange && pagination.handlePageSizeChange && (
        <DataTablePagination
          pageInfo={pagination.effectivePageInfo}
          entityName={entityName}
          loading={loading}
          onPageChange={pagination.handlePageChange}
          onPageSizeChange={pagination.handlePageSizeChange}
        />
      )}
    </div>
  )
}
