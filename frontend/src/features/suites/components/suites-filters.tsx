/**
 * SuitesFilters Component
 *
 * Filters for the suites list: search, status, tags, columns toggle.
 * Thin wrapper around EntityFilterWrapper.
 */

import { useMemo } from 'react'
import { type Column, type FilterField } from '@/components/shared/filters/entity-filters'
import { buildStatusField } from '@/components/shared/filters/filter-field-builders'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'

export type { Column } from '@/components/shared/filters/entity-filters'

export interface SuitesFilters {
  search: string
  status: string[]
  tags: string[]
}

export interface SuitesFiltersProps {
  filters: SuitesFilters
  allTags: string[]
  columns: Column[]
  onFilterChange: (filters: SuitesFilters) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  disabled?: boolean
  /** Optional slot for additional controls (e.g., Mass Action) rendered before Columns */
  actions?: React.ReactNode
}

const STATUS_OPTIONS = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'never_run', label: 'Never Run' },
]

const DEFAULT_FILTERS: SuitesFilters = { search: '', status: [], tags: [] }

export function SuitesFilters({
  filters,
  allTags,
  columns,
  onFilterChange,
  onColumnToggle,
  disabled = false,
  actions,
}: Readonly<SuitesFiltersProps>) {
  const fields = useMemo((): FilterField[] => [
    buildStatusField(STATUS_OPTIONS, filters.status),
  ], [filters.status])

  return (
    <EntityFilterWrapper
      entityName="suites"
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
