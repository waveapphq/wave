/**
 * RegressionsFilters Component
 *
 * REQ-5.2.1.37: Regression management screen
 *
 * Filters for the regressions list: search, status, tags, columns toggle.
 * NO Mass Action button (regressions are top of hierarchy per wireframe).
 * Thin wrapper around EntityFilterWrapper.
 */

/* v8 ignore next - COV-V8-006: V8 coverage merge non-deterministically drops this import across forks pool */
import { useMemo } from 'react'
import { type Column, type FilterField } from '@/components/shared/filters/entity-filters'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'
import { buildStatusField } from '@/components/shared/filters/filter-field-builders'

export type { Column } from '@/components/shared/filters/entity-filters'

export interface RegressionsFilters {
  search: string
  status: string[]
  tags: string[]
}

export interface RegressionsFiltersProps {
  filters: RegressionsFilters
  allTags: string[]
  columns: Column[]
  onFilterChange: (filters: RegressionsFilters) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  disabled?: boolean
  actions?: React.ReactNode
}

const STATUS_OPTIONS = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'never_run', label: 'Never Run' },
]

const DEFAULT_FILTERS: RegressionsFilters = { search: '', status: [], tags: [] }

export function RegressionsFilters({
  filters,
  allTags,
  columns,
  onFilterChange,
  onColumnToggle,
  disabled = false,
  actions,
}: Readonly<RegressionsFiltersProps>) {
  const fields = useMemo((): FilterField[] => [
    buildStatusField(STATUS_OPTIONS, filters.status),
  ], [filters.status])

  return (
    <EntityFilterWrapper
      entityName="regressions"
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
