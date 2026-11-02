/**
 * Reusable TanStack column factories for the DataTable.
 *
 * Each factory returns a ColumnDef<T> with the header, cell, meta, and
 * sticky-positioning boilerplate that repeats across WAVE's list and
 * detail tables. Callers supply an accessor and any entity-specific
 * decoration via explicit options.
 *
 * The factories enforce a single canonical style per column category:
 *   - Name: bold (font-medium), sticky-left. Clickable is opt-in via onClick.
 *   - Status: StatusBadgeCell - colored dot (pulsing for 'running') + label.
 *   - Tags: pill badges on secondary background.
 *   - Duration: pre-formatted tabular-nums text.
 *   - Count: "{n} {singular|plural}" text.
 *   - Actions: caller-supplied render, sticky-right, non-sortable.
 */

import { type ReactNode } from 'react'
import type { ColumnDef, Row } from '@tanstack/react-table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import { StatusBadgeCell } from '@/components/shared/data-table/cell-renderers'
import { TruncatedName } from '@/components/shared/truncated-name'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'

// ---------------------------------------------------------------------------
// nameColumn
// ---------------------------------------------------------------------------

export interface NameColumnOptions<T> {
  accessor: (row: T) => string
  testId: string
  onClick?: (row: T) => void
  id?: string
  label?: string
  /** Optional secondary line rendered under the name, bounded + truncated with its own hover popover. */
  description?: (row: T) => string | null | undefined
  descriptionTestId?: string
}

export function nameColumn<T>(opts: NameColumnOptions<T>): ColumnDef<T, unknown> {
  const { accessor, testId, onClick, id = 'name', label = 'Name', description, descriptionTestId } = opts
  return {
    id,
    accessorFn: (row) => accessor(row),
    header: ({ column }) => <DataTableColumnHeader column={column} label={label} />,
    cell: ({ row }) => {
      const name = (
        <TruncatedName
          value={accessor(row.original)}
          testId={testId}
          onClick={onClick ? () => onClick(row.original) : undefined}
        />
      )
      const desc = description?.(row.original)
      if (!desc) return name
      return (
        <div className="flex min-w-0 flex-col">
          {name}
          <TruncatedName
            value={desc}
            testId={descriptionTestId}
            textClassName="text-xs font-normal text-muted-foreground"
          />
        </div>
      )
    },
    meta: { sticky: 'left', skeletonWidth: 'w-[70%]' } satisfies DataTableColumnMeta,
  }
}

// ---------------------------------------------------------------------------
// expandableNameColumn
// ---------------------------------------------------------------------------

/**
 * Name column for tree tables where some rows expand to reveal children.
 * The caller decides per-row whether the row is expandable (via
 * `isExpandable`) and whether a child row should render indented (via
 * `childIndent`). A `childDecoration` hook renders inline content after
 * the child row's name (e.g. the DuplicateTestBadge on regression-exec
 * test rows).
 */
export interface ExpandableNameColumnOptions<T> {
  accessor: (row: T) => string
  testId: string
  isExpandable: (row: T) => boolean
  childIndent?: boolean
  childDecoration?: (row: T) => ReactNode
  id?: string
  label?: string
}

export function expandableNameColumn<T>(
  opts: ExpandableNameColumnOptions<T>,
): ColumnDef<T, unknown> {
  const {
    accessor,
    testId,
    isExpandable,
    childIndent = false,
    childDecoration,
    id = 'name',
    label = 'Name',
  } = opts
  return {
    id,
    accessorFn: (row) => accessor(row),
    header: ({ column }) => <DataTableColumnHeader column={column} label={label} />,
    cell: ({ row }: { row: Row<T> }) => {
      const value = accessor(row.original)
      if (isExpandable(row.original)) {
        const isExpanded = row.getIsExpanded()
        const Icon = isExpanded ? ChevronDown : ChevronRight
        return (
          <TruncatedName
            value={value}
            testId={testId}
            onClick={row.getToggleExpandedHandler()}
            ariaExpanded={isExpanded}
            ariaLabel={`${isExpanded ? 'Collapse' : 'Expand'} ${value}`}
            leading={<Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
          />
        )
      }
      return (
        <div className={childIndent ? 'flex items-center gap-2 pl-8 min-w-0 w-full' : 'flex items-center gap-2 min-w-0 w-full'}>
          <div className="min-w-0 flex-1">
            <TruncatedName value={value} testId={testId} />
          </div>
          {childDecoration?.(row.original)}
        </div>
      )
    },
    meta: { sticky: 'left', skeletonWidth: 'w-[70%]' } satisfies DataTableColumnMeta,
  }
}

// ---------------------------------------------------------------------------
// statusColumn
// ---------------------------------------------------------------------------

export interface StatusColumnOptions<T> {
  accessor: (row: T) => string
  testIdPrefix?: string
  id?: string
  label?: string
}

export function statusColumn<T>(opts: StatusColumnOptions<T>): ColumnDef<T, unknown> {
  const { accessor, testIdPrefix, id = 'status', label = 'Status' } = opts
  return {
    id,
    accessorFn: (row) => accessor(row),
    header: ({ column }) => <DataTableColumnHeader column={column} label={label} />,
    cell: ({ row }) => (
      <StatusBadgeCell status={accessor(row.original)} testIdPrefix={testIdPrefix} />
    ),
    meta: { skeletonWidth: 'w-16', skeletonHeight: 'h-5' } satisfies DataTableColumnMeta,
  }
}

// ---------------------------------------------------------------------------
// tagsColumn
// ---------------------------------------------------------------------------

export interface TagsColumnOptions<T> {
  accessor: (row: T) => string[]
  testId: string
  id?: string
  label?: string
}

export function tagsColumn<T>(opts: TagsColumnOptions<T>): ColumnDef<T, unknown> {
  const { accessor, testId, id = 'tags', label = 'Tags' } = opts
  return {
    id,
    accessorFn: (row) => accessor(row).join(', '),
    header: ({ column }) => <DataTableColumnHeader column={column} label={label} />,
    cell: ({ row }) => (
      <span data-testid={testId} className="flex flex-wrap gap-1">
        {accessor(row.original).map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs"
          >
            {tag}
          </span>
        ))}
      </span>
    ),
    meta: { skeletonWidth: 'w-20' } satisfies DataTableColumnMeta,
  }
}

// ---------------------------------------------------------------------------
// durationColumn
// ---------------------------------------------------------------------------

export interface DurationColumnOptions<T> {
  accessor: (row: T) => string
  testId?: string
  id?: string
  label?: string
}

export function durationColumn<T>(opts: DurationColumnOptions<T>): ColumnDef<T, unknown> {
  const { accessor, testId, id = 'duration', label = 'Duration' } = opts
  return {
    id,
    accessorFn: (row) => accessor(row),
    header: ({ column }) => <DataTableColumnHeader column={column} label={label} />,
    cell: ({ row }) => (
      <span data-testid={testId} className="tabular-nums">
        {accessor(row.original)}
      </span>
    ),
    meta: { skeletonWidth: 'w-16' } satisfies DataTableColumnMeta,
  }
}

// ---------------------------------------------------------------------------
// countColumn
// ---------------------------------------------------------------------------

export interface CountColumnOptions<T> {
  id: string
  accessor: (row: T) => number
  label: string
  singularLabel: string
  pluralLabel: string
  testId?: string
  skeletonWidth?: string
}

export function countColumn<T>(opts: CountColumnOptions<T>): ColumnDef<T, unknown> {
  const {
    id,
    accessor,
    label,
    singularLabel,
    pluralLabel,
    testId,
    skeletonWidth = 'w-16',
  } = opts
  return {
    id,
    accessorFn: (row) => accessor(row),
    header: ({ column }) => <DataTableColumnHeader column={column} label={label} />,
    cell: ({ row }) => {
      const count = accessor(row.original)
      return (
        <span data-testid={testId}>
          {count} {count === 1 ? singularLabel : pluralLabel}
        </span>
      )
    },
    meta: { skeletonWidth } satisfies DataTableColumnMeta,
  }
}

// ---------------------------------------------------------------------------
// actionsColumn
// ---------------------------------------------------------------------------

export interface ActionsColumnOptions<T> {
  render: (row: T) => ReactNode
  id?: string
  skeletonWidth?: string
  skeletonHeight?: string
}

export function actionsColumn<T>(opts: ActionsColumnOptions<T>): ColumnDef<T, unknown> {
  const {
    render,
    id = 'actions',
    skeletonWidth = 'w-20',
    skeletonHeight = 'h-8',
  } = opts
  return {
    id,
    header: 'Actions',
    enableSorting: false,
    cell: ({ row }) => render(row.original),
    meta: { sticky: 'right', skeletonWidth, skeletonHeight } satisfies DataTableColumnMeta,
  }
}
