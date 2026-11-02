/**
 * RegressionExecutionTable - expandable suites-with-tests tree for
 * regression-type executions. Suites render as top-level rows
 * (REG-EX-2); clicking the chevron reveals the suite's tests as child
 * rows. The DuplicateTestBadge appears on per-test rows that belong to
 * 2+ suites of the regression. The status filter matches on individual
 * test status, and a suite is shown whenever at least one of its tests
 * passes the filter.
 */

import { useCallback, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import type { ColumnDef, ExpandedState, Row } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/shared/data-table/data-table'
import { StatusBadgeCell } from '@/components/shared/data-table/cell-renderers'
import {
  actionsColumn,
  durationColumn,
  expandableNameColumn,
  tagsColumn,
} from '@/components/shared/data-table/column-factories'
import {
  DuplicateTestBadge,
  type DuplicateTestBadgeSuite,
} from '@/components/shared/duplicate-test-badge'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'
import type { FilterField } from '@/components/shared/filters/entity-filters'
import {
  getStatusColor,
  getStatusDotColor,
  getStatusLabel,
} from '@/components/shared/tables/table-utils'
import { formatDuration } from '@/lib/format-duration'
import {
  TEST_STATUS_DEFAULT,
  TEST_STATUS_OPTIONS,
  TestActions,
  useColumnToggle,
  useExecutionDownload,
  type ExecutionFilters,
  type ExecutionSuiteRow,
} from './_shared'

const REGRESSION_EXEC_COLUMNS = [
  { id: 'status', label: 'Status' },
  { id: 'tests', label: 'Tests' },
  { id: 'tags', label: 'Tags' },
  { id: 'duration', label: 'Duration' },
]

const DEFAULT_REGRESSION_FILTERS: ExecutionFilters = {
  search: '',
  status: TEST_STATUS_DEFAULT,
  tags: [],
}

interface RegressionSuiteAggregate {
  id: string
  name: string
  duration: number | null
  totalTests: number
  passedTests: number
  aggregateStatus:
    | 'passed'
    | 'failed'
    | 'running'
    | 'pending'
    | 'skipped'
    | 'stopped'
    | 'excluded'
  tags: string[]
}

interface RegressionTreeSuiteRow extends RegressionSuiteAggregate {
  kind: 'suite'
  testIds: string[]
  children: RegressionTreeTestRow[]
}

interface RegressionTreeTestRow {
  kind: 'test'
  id: string
  name: string
  status: string
  duration: number | null
  tags: string[]
  suiteId: string
  /** Opaque per-run identifier; keys the Historical Test Canvas URL. */
  run_id?: string | null
  duplicateSuites: DuplicateTestBadgeSuite[]
}

type RegressionTreeRow = RegressionTreeSuiteRow | RegressionTreeTestRow

function isSuiteRow(row: RegressionTreeRow): row is RegressionTreeSuiteRow {
  return row.kind === 'suite'
}

function classifySuite(suite: ExecutionSuiteRow): RegressionSuiteAggregate {
  const total = suite.tests.length
  const passed = suite.tests.filter((t) => t.status === 'passed').length
  const failed = suite.tests.filter((t) => t.status === 'failed').length
  const pending = suite.tests.filter((t) => t.status === 'pending').length
  const running = suite.tests.filter((t) => t.status === 'running').length
  const skipped = suite.tests.filter((t) => t.status === 'skipped').length
  const stopped = suite.tests.filter((t) => t.status === 'stopped').length
  const excluded = suite.tests.filter((t) => t.status === 'excluded').length

  let aggregateStatus: RegressionSuiteAggregate['aggregateStatus']
  if (total > 0 && excluded === total) aggregateStatus = 'excluded'
  else if (total > 0 && skipped === total) aggregateStatus = 'skipped'
  else if (failed > 0) aggregateStatus = 'failed'
  else if (stopped > 0) aggregateStatus = 'stopped'
  else if (running > 0) aggregateStatus = 'running'
  else if (pending > 0) aggregateStatus = 'pending'
  else aggregateStatus = 'passed'

  return {
    id: suite.id,
    name: suite.name,
    duration: suite.duration,
    totalTests: total,
    passedTests: passed,
    aggregateStatus,
    tags: suite.tags ?? [],
  }
}

/** Suite status cell: colored dot + ratio text (or "Skipped"). */
function SuiteStatusRatio({ suite }: Readonly<{ suite: RegressionSuiteAggregate }>) {
  const pulse = suite.aggregateStatus === 'running' ? ' animate-pulse' : ''
  const showLabel =
    suite.aggregateStatus === 'skipped' || suite.aggregateStatus === 'excluded'
  const label = showLabel
    ? getStatusLabel(suite.aggregateStatus)
    : `${suite.passedTests}/${suite.totalTests}`
  return (
    <span
      data-testid={`status-badge-${suite.aggregateStatus}`}
      className={`inline-flex items-center gap-1.5 ${getStatusColor(suite.aggregateStatus)}`}
    >
      <span
        data-testid="status-dot"
        className={`h-2 w-2 rounded-full ${getStatusDotColor(suite.aggregateStatus)}${pulse}`}
        aria-hidden="true"
      />
      {label}
    </span>
  )
}

function renderRegressionStatus({ row }: { row: Row<RegressionTreeRow> }) {
  if (isSuiteRow(row.original)) return <SuiteStatusRatio suite={row.original} />
  return <StatusBadgeCell status={row.original.status} testIdPrefix="test" />
}

function renderRegressionTests({ row }: { row: Row<RegressionTreeRow> }) {
  if (!isSuiteRow(row.original)) return null
  const s = row.original
  return (
    <span className="tabular-nums">
      {s.totalTests} {s.totalTests === 1 ? 'test' : 'tests'}
    </span>
  )
}

function SuiteActions({
  executionId,
  testIds,
}: Readonly<{ executionId: string; testIds: string[] }>) {
  const download = useExecutionDownload(executionId)
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Download suite"
        onClick={() => { download(testIds) }}
      >
        <Download className="h-4 w-4" />
      </Button>
    </div>
  )
}

function makeRegressionActionsCell(executionId: string) {
  return (row: RegressionTreeRow) => {
    if (isSuiteRow(row)) {
      return <SuiteActions executionId={executionId} testIds={row.testIds} />
    }
    return (
      <TestActions
        executionId={executionId}
        testId={row.id}
        runId={row.run_id}
        status={row.status}
      />
    )
  }
}

function buildRegressionExecColumns(
  executionId: string,
): ColumnDef<RegressionTreeRow, unknown>[] {
  return [
    expandableNameColumn<RegressionTreeRow>({
      accessor: (row) => row.name,
      testId: 'regression-suite-toggle',
      isExpandable: isSuiteRow,
      childIndent: true,
      childDecoration: (row) =>
        !isSuiteRow(row) && row.duplicateSuites.length > 0 ? (
          <DuplicateTestBadge suites={row.duplicateSuites} />
        ) : null,
    }),
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: renderRegressionStatus,
    },
    {
      id: 'tests',
      header: 'Tests',
      cell: renderRegressionTests,
    },
    tagsColumn<RegressionTreeRow>({
      accessor: (row) => row.tags,
      testId: 'execution-tags',
    }),
    durationColumn<RegressionTreeRow>({
      accessor: (row) => formatDuration(row.duration),
    }),
    actionsColumn<RegressionTreeRow>({
      render: makeRegressionActionsCell(executionId),
    }),
  ]
}

function buildDuplicateSuitesFor(
  testId: string,
  suiteNames: Map<string, string>,
  duplicateTests: Record<string, string[]> | undefined,
): DuplicateTestBadgeSuite[] {
  const ids = duplicateTests?.[testId]
  if (!ids || ids.length < 2) return []
  const result: DuplicateTestBadgeSuite[] = []
  for (const id of ids) {
    const name = suiteNames.get(id)
    if (name !== undefined) result.push({ id, name })
  }
  return result
}

export function RegressionExecutionTable({
  executionId,
  suites,
  duplicateTests,
}: Readonly<{
  executionId: string
  suites: ExecutionSuiteRow[]
  duplicateTests?: Record<string, string[]>
}>) {
  const [filters, setFilters] = useState<ExecutionFilters>(DEFAULT_REGRESSION_FILTERS)
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const { columnDefs, handleColumnToggle, columnVisibility } = useColumnToggle(
    REGRESSION_EXEC_COLUMNS,
    ['status', 'tests', 'tags', 'duration'],
  )

  const treeRows = useMemo<RegressionTreeRow[]>(() => {
    const q = filters.search.trim().toLowerCase()
    const statusSet = new Set(filters.status)
    const suiteNames = new Map(suites.map((s) => [s.id, s.name]))

    const result: RegressionTreeRow[] = []
    for (const suite of suites) {
      const suiteNameMatches = q === '' || suite.name.toLowerCase().includes(q)
      const visibleTests = suite.tests.filter((t) => {
        const searchOk = q === '' || suiteNameMatches || t.name.toLowerCase().includes(q)
        const statusOk = statusSet.size === 0 || statusSet.has(t.status)
        return searchOk && statusOk
      })
      if (visibleTests.length === 0) continue

      const aggregate = classifySuite(suite)
      const children: RegressionTreeTestRow[] = visibleTests.map((t) => ({
        kind: 'test',
        id: t.id,
        name: t.name,
        status: t.status,
        duration: t.duration,
        tags: t.tags ?? [],
        suiteId: suite.id,
        run_id: t.run_id,
        duplicateSuites: buildDuplicateSuitesFor(t.id, suiteNames, duplicateTests),
      }))
      result.push({
        kind: 'suite',
        ...aggregate,
        testIds: suite.tests.map((t) => t.id),
        children,
      })
    }
    return result
  }, [suites, filters, duplicateTests])

  const tagPool = useMemo<string[]>(() => [], [])

  const filterFields = useMemo<FilterField[]>(
    () => [
      {
        key: 'status',
        placeholder: 'Status',
        countLabel: 'statuses',
        countLabelSingular: 'status',
        testId: 'filter-status',
        ariaLabel: 'Filter by status',
        buttonWidth: 'w-[140px]',
        searchPlaceholder: 'Search status…',
        emptyMessage: 'No status found.',
        options: TEST_STATUS_OPTIONS,
        mode: 'multi',
        selectedValues: filters.status,
      },
    ],
    [filters.status],
  )

  const columns = useMemo<ColumnDef<RegressionTreeRow, unknown>[]>(
    () => buildRegressionExecColumns(executionId),
    [executionId],
  )

  const getSubRows = useCallback(
    (row: RegressionTreeRow) => (isSuiteRow(row) ? row.children : undefined),
    [],
  )

  const getRowId = useCallback(
    (row: RegressionTreeRow) =>
      isSuiteRow(row) ? `suite-${row.id}` : `test-${row.suiteId}-${row.id}`,
    [],
  )

  return (
    <div className="flex h-full flex-col gap-3">
      <EntityFilterWrapper
        entityName="suites"
        filters={filters}
        defaultFilters={DEFAULT_REGRESSION_FILTERS}
        allTags={tagPool}
        columns={columnDefs}
        fields={filterFields}
        onFilterChange={setFilters}
        onColumnToggle={handleColumnToggle}
      />
      <DataTable
        columns={columns}
        data={treeRows}
        getRowId={getRowId}
        getSubRows={getSubRows}
        expanded={expanded}
        onExpandedChange={setExpanded}
        entityName="suites"
        defaultPageSize={25}
        columnVisibility={columnVisibility}
      />
    </div>
  )
}
