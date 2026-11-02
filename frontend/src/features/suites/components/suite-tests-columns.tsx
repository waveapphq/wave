/**
 * Column definitions for the Suite Tests DataTable.
 *
 * Two column sets: view mode (sortable, with Edit action) and edit mode
 * (no sorting, with Exclude action). Common columns use the shared
 * column-factories; order + suite + relative-time columns stay inline.
 */

import type { ColumnDef, Row } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import { RelativeTimeCell } from '@/components/shared/data-table/cell-renderers'
import {
  actionsColumn,
  nameColumn,
  statusColumn,
  tagsColumn,
} from '@/components/shared/data-table/column-factories'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'
import type { SuiteTestEntry } from '@/features/suites/api/types'
import { Pencil, XCircle } from 'lucide-react'
import { ConditionalTooltip } from '@/components/ui/tooltip'

// ---------------------------------------------------------------------------
// Shared column builders
// ---------------------------------------------------------------------------

function orderColumn(sortable: boolean): ColumnDef<SuiteTestEntry, unknown> {
  return {
    id: 'order',
    // accessorFn returns the original array index so TanStack can sort by it
    accessorFn: (_row, index) => index,
    header: sortable
      ? ({ column }) => <DataTableColumnHeader column={column} label="Order" />
      : 'Order',
    enableSorting: sortable,
    cell: ({ row }: { row: Row<SuiteTestEntry> }) => (
      <span className="tabular-nums text-muted-foreground">{row.index + 1}</span>
    ),
    meta: { skeletonWidth: 'w-6' } satisfies DataTableColumnMeta,
  }
}

function nameCol(onClick?: (testId: string) => void): ColumnDef<SuiteTestEntry, unknown> {
  return nameColumn<SuiteTestEntry>({
    accessor: (row) => row.name,
    testId: 'test-name',
    onClick: onClick ? (row) => onClick(row.id) : undefined,
  })
}

function suiteColumn(): ColumnDef<SuiteTestEntry, unknown> {
  return {
    id: 'suite',
    header: 'Suite',
    enableSorting: false,
    cell: () => <span className="text-muted">-</span>,
    meta: { skeletonWidth: 'w-[60%]' } satisfies DataTableColumnMeta,
  }
}

function statusCol(): ColumnDef<SuiteTestEntry, unknown> {
  return statusColumn<SuiteTestEntry>({
    accessor: (row) => row.status,
    testIdPrefix: 'test',
  })
}

function lastRunColumn(): ColumnDef<SuiteTestEntry, unknown> {
  return {
    id: 'lastRun',
    accessorKey: 'lastRun',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Last Run" />
    ),
    cell: ({ row }) => (
      <RelativeTimeCell dateString={row.original.lastRun} data-testid="test-last-run" />
    ),
    meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
  }
}

function tagsCol(): ColumnDef<SuiteTestEntry, unknown> {
  return tagsColumn<SuiteTestEntry>({
    accessor: (row) => row.tags,
    testId: 'test-tags',
  })
}

function createdAtColumn(): ColumnDef<SuiteTestEntry, unknown> {
  return {
    id: 'createdAt',
    accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} label="Created At" />,
    /* v8 ignore next 3 - COV-V8-003: cell only renders when column toggled visible */
    cell: ({ row }) => (
      <RelativeTimeCell dateString={row.original.createdAt} data-testid="test-created-at" />
    ),
    meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
  }
}

function updatedAtColumn(): ColumnDef<SuiteTestEntry, unknown> {
  return {
    id: 'updatedAt',
    accessorKey: 'updatedAt',
    header: ({ column }) => <DataTableColumnHeader column={column} label="Updated At" />,
    /* v8 ignore next 3 - COV-V8-003: cell only renders when column toggled visible */
    cell: ({ row }) => (
      <RelativeTimeCell dateString={row.original.updatedAt} data-testid="test-updated-at" />
    ),
    meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
  }
}

// ---------------------------------------------------------------------------
// View mode columns
// ---------------------------------------------------------------------------

export interface SuiteTestsViewCallbacks {
  onEditTest: (testId: string) => void
}

export function getSuiteTestsViewColumns(
  callbacks: SuiteTestsViewCallbacks,
): ColumnDef<SuiteTestEntry, unknown>[] {
  return [
    orderColumn(true),
    nameCol(callbacks.onEditTest),
    suiteColumn(),
    statusCol(),
    lastRunColumn(),
    tagsCol(),
    createdAtColumn(),
    updatedAtColumn(),
    actionsColumn<SuiteTestEntry>({
      render: (row) => (
        <ConditionalTooltip content="Edit test">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="test-edit-btn"
            onClick={() => callbacks.onEditTest(row.id)}
            className="h-7 w-7"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </ConditionalTooltip>
      ),
      skeletonWidth: 'w-8',
    }),
  ]
}

// ---------------------------------------------------------------------------
// Edit mode columns
// ---------------------------------------------------------------------------

export interface SuiteTestsEditCallbacks {
  onExcludeTest: (testId: string) => void
}

export function getSuiteTestsEditColumns(
  callbacks: SuiteTestsEditCallbacks,
): ColumnDef<SuiteTestEntry, unknown>[] {
  return [
    orderColumn(false),
    nameCol(),
    suiteColumn(),
    statusCol(),
    lastRunColumn(),
    tagsCol(),
    createdAtColumn(),
    updatedAtColumn(),
    actionsColumn<SuiteTestEntry>({
      render: (row) => (
        <ConditionalTooltip content="Exclude from suite">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="test-exclude-btn"
            onClick={() => callbacks.onExcludeTest(row.id)}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        </ConditionalTooltip>
      ),
      skeletonWidth: 'w-8',
    }),
  ]
}
