/**
 * Column definitions for the Regression Suites DataTable.
 *
 * Two column sets: view mode (sortable, with Edit action) and edit mode
 * (no sorting, with Exclude action). Common columns use the shared
 * column-factories; order + relative-time columns stay inline.
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
import type { RegressionSuiteEntry } from '@/features/regressions/api/types'
import { Pencil, XCircle } from 'lucide-react'
import { ConditionalTooltip } from '@/components/ui/tooltip'

// ---------------------------------------------------------------------------
// Shared column builders
// ---------------------------------------------------------------------------

function orderColumn(sortable: boolean): ColumnDef<RegressionSuiteEntry, unknown> {
  return {
    id: 'order',
    accessorFn: (_row, index) => index,
    header: sortable
      ? ({ column }) => <DataTableColumnHeader column={column} label="Order" />
      : 'Order',
    enableSorting: sortable,
    cell: ({ row }: { row: Row<RegressionSuiteEntry> }) => (
      <span className="tabular-nums text-muted-foreground">{row.index + 1}</span>
    ),
    meta: { skeletonWidth: 'w-6' } satisfies DataTableColumnMeta,
  }
}

function nameCol(onClick?: (suiteId: string) => void): ColumnDef<RegressionSuiteEntry, unknown> {
  return nameColumn<RegressionSuiteEntry>({
    accessor: (row) => row.name,
    testId: 'suite-name',
    onClick: onClick ? (row) => onClick(row.id) : undefined,
  })
}

function statusCol(): ColumnDef<RegressionSuiteEntry, unknown> {
  return statusColumn<RegressionSuiteEntry>({
    /* v8 ignore next - COV-V8-003: V8 tracks defensive OR fallback as branch */
    accessor: (row) => row.status || 'never_run',
    testIdPrefix: 'suite',
  })
}

function lastRunColumn(): ColumnDef<RegressionSuiteEntry, unknown> {
  return {
    id: 'lastRun',
    accessorKey: 'lastRun',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Last Run" />
    ),
    cell: ({ row }) => (
      <RelativeTimeCell dateString={row.original.lastRun} data-testid="suite-last-run" />
    ),
    meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
  }
}

function tagsCol(): ColumnDef<RegressionSuiteEntry, unknown> {
  return tagsColumn<RegressionSuiteEntry>({
    accessor: (row) => row.tags,
    testId: 'suite-tags',
  })
}

function createdAtColumn(): ColumnDef<RegressionSuiteEntry, unknown> {
  return {
    id: 'createdAt',
    accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} label="Created At" />,
    /* v8 ignore next 3 - COV-V8-003: cell only renders when column toggled visible */
    cell: ({ row }) => (
      <RelativeTimeCell dateString={row.original.createdAt} data-testid="suite-created-at" />
    ),
    meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
  }
}

function updatedAtColumn(): ColumnDef<RegressionSuiteEntry, unknown> {
  return {
    id: 'updatedAt',
    accessorKey: 'updatedAt',
    header: ({ column }) => <DataTableColumnHeader column={column} label="Updated At" />,
    /* v8 ignore next 3 - COV-V8-003: cell only renders when column toggled visible */
    cell: ({ row }) => (
      <RelativeTimeCell dateString={row.original.updatedAt} data-testid="suite-updated-at" />
    ),
    meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
  }
}

// ---------------------------------------------------------------------------
// View mode columns
// ---------------------------------------------------------------------------

export interface RegressionSuitesViewCallbacks {
  onEditSuite: (suiteId: string) => void
}

export function getRegressionSuitesViewColumns(
  callbacks: RegressionSuitesViewCallbacks,
): ColumnDef<RegressionSuiteEntry, unknown>[] {
  return [
    orderColumn(true),
    nameCol(callbacks.onEditSuite),
    statusCol(),
    lastRunColumn(),
    tagsCol(),
    createdAtColumn(),
    updatedAtColumn(),
    actionsColumn<RegressionSuiteEntry>({
      render: (row) => (
        <ConditionalTooltip content="View suite">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="suite-edit-btn"
            onClick={() => callbacks.onEditSuite(row.id)}
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

export interface RegressionSuitesEditCallbacks {
  onExcludeSuite: (suiteId: string) => void
}

export function getRegressionSuitesEditColumns(
  callbacks: RegressionSuitesEditCallbacks,
): ColumnDef<RegressionSuiteEntry, unknown>[] {
  return [
    orderColumn(false),
    nameCol(),
    statusCol(),
    lastRunColumn(),
    tagsCol(),
    createdAtColumn(),
    updatedAtColumn(),
    actionsColumn<RegressionSuiteEntry>({
      render: (row) => (
        <ConditionalTooltip content="Exclude from regression">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="suite-exclude-btn"
            onClick={() => callbacks.onExcludeSuite(row.id)}
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
