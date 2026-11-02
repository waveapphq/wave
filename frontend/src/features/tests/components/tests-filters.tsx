/**
 * TestsFilters Component
 *
 * Filters for the tests list: search, status, suite, tags, columns toggle.
 * Thin wrapper around EntityFilterWrapper.
 */

import { useMemo } from 'react'
import { type Column, type FilterField } from '@/components/shared/filters/entity-filters'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'
import { buildStatusField } from '@/components/shared/filters/filter-field-builders'

export type { Column } from '@/components/shared/filters/entity-filters'

export interface TestsFilters {
  search: string
  status: string[]
  suiteIds: string[]
  tags: string[]
}

export interface Suite {
  id: string
  name: string
}

export interface TestsFiltersProps {
  filters: TestsFilters
  suites: Suite[]
  allTags: string[]
  columns: Column[]
  onFilterChange: (filters: TestsFilters) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  disabled?: boolean
  /** Optional slot for additional controls (e.g., Mass Action) rendered before Columns */
  actions?: React.ReactNode
}

const STATUS_OPTIONS = [
  { value: 'running', label: 'Running' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'never_run', label: 'Never Run' },
]

const DEFAULT_FILTERS: TestsFilters = { search: '', status: [], suiteIds: [], tags: [] }

export function TestsFilters({
  filters,
  suites,
  allTags,
  columns,
  onFilterChange,
  onColumnToggle,
  disabled = false,
  actions,
}: Readonly<TestsFiltersProps>) {
  const suiteOptions = useMemo(
    () => suites.map((s) => ({ value: s.id, label: s.name })),
    [suites]
  )

  const fields = useMemo((): FilterField[] => [
    buildStatusField(STATUS_OPTIONS, filters.status),
    {
      key: 'suiteIds',
      placeholder: 'Suite',
      countLabel: 'suites',
      countLabelSingular: 'suite',
      testId: 'filter-suite',
      ariaLabel: 'Filter by suite',
      buttonWidth: 'w-[160px]',
      searchPlaceholder: 'Search suites…',
      emptyMessage: 'No suites found.',
      options: suiteOptions,
      mode: 'multi',
      selectedValues: filters.suiteIds,
    },
  ], [filters.status, filters.suiteIds, suiteOptions])

  return (
    <EntityFilterWrapper
      entityName="tests"
      filters={filters}
      defaultFilters={DEFAULT_FILTERS}
      allTags={allTags}
      columns={columns}
      fields={fields}
      onFilterChange={onFilterChange}
      onColumnToggle={onColumnToggle}
      disabled={disabled}
      actions={actions}
    />
  )
}
