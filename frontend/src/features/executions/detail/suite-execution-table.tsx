/**
 * SuiteExecutionTable - flat list of a suite execution's tests with
 * Search + Status filter and pagination. Test names are plain text;
 * the View button in Actions is the only way to navigate to a test.
 */

import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/shared/data-table/data-table'
import {
  actionsColumn,
  durationColumn,
  nameColumn,
  statusColumn,
  tagsColumn,
} from '@/components/shared/data-table/column-factories'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'
import type { FilterField } from '@/components/shared/filters/entity-filters'
import { formatDuration } from '@/lib/format-duration'
import {
  DEFAULT_TEST_FILTERS,
  TEST_STATUS_OPTIONS,
  TestActions,
  useColumnToggle,
  type ExecutionFilters,
  type ExecutionTestRow,
} from './_shared'

const SUITE_EXEC_COLUMNS = [
  { id: 'status', label: 'Status' },
  { id: 'tags', label: 'Tags' },
  { id: 'duration', label: 'Duration' },
]

function buildSuiteExecColumns(executionId: string): ColumnDef<ExecutionTestRow, unknown>[] {
  return [
    nameColumn<ExecutionTestRow>({
      accessor: (row) => row.name,
      testId: 'execution-test-name',
    }),
    statusColumn<ExecutionTestRow>({
      accessor: (row) => row.status,
      testIdPrefix: 'test',
    }),
    tagsColumn<ExecutionTestRow>({
      accessor: (row) => row.tags ?? [],
      testId: 'execution-test-tags',
    }),
    durationColumn<ExecutionTestRow>({
      accessor: (row) => formatDuration(row.duration),
    }),
    actionsColumn<ExecutionTestRow>({
      render: (row) => (
        <TestActions executionId={executionId} testId={row.id} runId={row.run_id} status={row.status} />
      ),
    }),
  ]
}

export function SuiteExecutionTable({
  executionId,
  tests,
}: Readonly<{ executionId: string; tests: ExecutionTestRow[] }>) {
  const [filters, setFilters] = useState<ExecutionFilters>(DEFAULT_TEST_FILTERS)
  const { columnDefs, handleColumnToggle, columnVisibility } = useColumnToggle(
    SUITE_EXEC_COLUMNS,
    ['status', 'tags', 'duration'],
  )

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

  const filtered = useMemo(() => {
    let result = tests
    if (filters.search) {
      const q = filters.search.toLowerCase()
      result = result.filter((t) => t.name.toLowerCase().includes(q))
    }
    if (filters.status.length > 0) {
      result = result.filter((t) => filters.status.includes(t.status))
    }
    return result
  }, [tests, filters])

  const columns = useMemo<ColumnDef<ExecutionTestRow, unknown>[]>(
    () => buildSuiteExecColumns(executionId),
    [executionId],
  )

  return (
    <div className="flex h-full flex-col gap-3">
      <EntityFilterWrapper
        entityName="tests"
        filters={filters}
        defaultFilters={DEFAULT_TEST_FILTERS}
        allTags={tagPool}
        columns={columnDefs}
        fields={filterFields}
        onFilterChange={setFilters}
        onColumnToggle={handleColumnToggle}
      />
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(row) => row.id}
        entityName="tests"
        defaultPageSize={25}
        columnVisibility={columnVisibility}
      />
    </div>
  )
}
