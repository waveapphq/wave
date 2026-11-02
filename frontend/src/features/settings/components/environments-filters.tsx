/**
 * EnvironmentsFilters Component
 *
 * Filters for the environments list: search, tags, columns toggle.
 * Thin wrapper around EntityFilterWrapper.
 */

import { type Column, type FilterField } from '@/components/shared/filters/entity-filters'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'

export type { Column } from '@/components/shared/filters/entity-filters'

export interface EnvironmentsFilters {
  search: string
  tags: string[]
}

export interface EnvironmentsFiltersProps {
  filters: EnvironmentsFilters
  allTags: string[]
  columns: Column[]
  onFilterChange: (filters: EnvironmentsFilters) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  disabled?: boolean
  actions?: React.ReactNode
}

const EMPTY_FIELDS: FilterField[] = []
const DEFAULT_FILTERS: EnvironmentsFilters = { search: '', tags: [] }

export function EnvironmentsFilters({
  filters,
  allTags,
  columns,
  onFilterChange,
  onColumnToggle,
  disabled = false,
  actions,
}: Readonly<EnvironmentsFiltersProps>) {
  return (
    <EntityFilterWrapper
      entityName="environments"
      filters={filters}
      defaultFilters={DEFAULT_FILTERS}
      allTags={allTags}
      columns={columns}
      fields={EMPTY_FIELDS}
      onFilterChange={onFilterChange}
      onColumnToggle={onColumnToggle}
      disabled={disabled}
      actions={actions}
    />
  )
}
