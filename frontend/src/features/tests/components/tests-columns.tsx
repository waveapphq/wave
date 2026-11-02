/**
 * Column definitions for the Tests DataTable.
 *
 * Common columns come from the shared column-factories. The Suite column
 * has entity-specific multi-suite popover behavior and stays inline.
 */

import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import { RelativeTimeCell } from '@/components/shared/data-table/cell-renderers'
import {
  actionsColumn,
  nameColumn,
  statusColumn,
  tagsColumn,
} from '@/components/shared/data-table/column-factories'
import { TruncatedName } from '@/components/shared/truncated-name'
import { EntityListPopover } from '@/components/shared/entity-list-popover'
import { BreadcrumbSegmentIcon } from '@/components/shared/breadcrumb-segment-icon'
import { TestsRowActions } from '@/features/tests/components/tests-row-actions'
import type { Test, Suite } from '@/features/tests/api/types'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'

export interface TestsColumnCallbacks {
  onRowClick: (testId: string) => void
  onRunTest: (testId: string) => void
  onEditTest: (testId: string) => void
  onDeleteTest: (testId: string) => void
  onDuplicateTest: (testId: string) => void
  onExportTest?: (testId: string) => void
  onAddToSuite?: (testId: string, suiteId: string) => void
  onRemoveFromSuite?: (testId: string, suiteId: string) => void
  suites: Suite[]
}

function SuiteCell({ test }: Readonly<{ test: Test }>) {
  const navigate = useNavigate()

  if (test.suiteCount === 0) {
    return <span data-testid="test-suite" className="text-muted">-</span>
  }

  if (test.suiteCount === 1) {
    const suiteId = test.suiteIds[0]
    const suiteName = test.suiteNames[0]
    return (
      // Tighter cap than the default TruncatedName 40vw clamp - the Suite
      // column sits between sticky Name (left) and sticky Actions (right),
      // so the default would push the cell past the visible bounds at
      // narrow viewports and clip under sticky Actions. clamp(8rem,18vw,22rem)
      // keeps the cell to ~128-352px which fits between the sticky columns
      // and lets the ellipsis stay visible.
      <TruncatedName
        value={suiteName}
        testId="test-suite"
        className="max-w-[clamp(8rem,18vw,22rem)]"
        /* v8 ignore next - COV-V8-003: navigate fires only on click of a row with a suite */
        onClick={suiteId ? () => { navigate(`/suites/${suiteId}`) } : undefined}
        ariaLabel={`Open suite ${suiteName}`}
      />
    )
  }

  // Multi-suite: reuse the shared parent-path popover (same code that backs
  // the workbench breadcrumb and the detail-header collapse).
  return (
    <EntityListPopover
      triggerLabel={`${test.suiteCount} suites`}
      triggerTestId="test-suite"
      listTestId="test-suite-list"
      triggerAriaLabel={`Show ${test.suiteCount} suites containing this test`}
      label="Suites"
      entities={test.suiteIds.map((id, idx) => ({
        id,
        /* v8 ignore next - COV-V8-003: defensive fallback for length mismatch */
        name: test.suiteNames[idx] ?? id,
        href: `/suites/${id}`,
        icon: <BreadcrumbSegmentIcon type="suite" iconClassName="h-3.5 w-3.5" />,
      }))}
      onNavigate={(href) => { navigate(href) }}
    />
  )
}

export function getTestsColumns(callbacks: TestsColumnCallbacks): ColumnDef<Test, unknown>[] {
  return [
    nameColumn<Test>({
      accessor: (row) => row.name,
      testId: 'test-name',
      onClick: (row) => callbacks.onRowClick(row.id),
    }),
    {
      id: 'suite',
      accessorFn: (row) => row.suiteNames.join(', '),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Suite" />
      ),
      cell: ({ row }) => <SuiteCell test={row.original} />,
      meta: { skeletonWidth: 'w-[60%]' } satisfies DataTableColumnMeta,
    },
    statusColumn<Test>({
      accessor: (row) => row.status,
      testIdPrefix: 'test',
    }),
    {
      id: 'lastRun',
      accessorKey: 'lastRun',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Last Run" />
      ),
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.lastRun} data-testid="test-last-run" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    tagsColumn<Test>({
      accessor: (row) => row.tags,
      testId: 'test-tags',
    }),
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: ({ column }) => <DataTableColumnHeader column={column} label="Created At" />,
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.createdAt} data-testid="test-created-at" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    {
      id: 'updatedAt',
      accessorKey: 'updatedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} label="Updated At" />,
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.updatedAt} data-testid="test-updated-at" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    actionsColumn<Test>({
      render: (row) => (
        <TestsRowActions
          testId={row.id}
          testName={row.name}
          suites={callbacks.suites}
          testSuiteIds={row.suiteIds}
          onRun={callbacks.onRunTest}
          onEdit={callbacks.onEditTest}
          onDelete={callbacks.onDeleteTest}
          onDuplicate={callbacks.onDuplicateTest}
          onExport={callbacks.onExportTest}
          onAddToSuite={callbacks.onAddToSuite}
          onRemoveFromSuite={callbacks.onRemoveFromSuite}
        />
      ),
    }),
  ]
}
