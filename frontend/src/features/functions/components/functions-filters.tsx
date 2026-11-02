/**
 * FunctionsFilters - search + tags + column toggle for the Functions list.
 *
 * Wraps the canonical EntityFilterWrapper. Functions have no Status or Suite
 * filters, so the field list is empty and only Search + Tags + Columns render.
 */

import { type ReactNode } from 'react'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'
import type { Column } from '@/components/shared/filters/entity-filters'

export interface FunctionsFiltersState {
  search: string
  tags: string[]
}

const DEFAULT_FILTERS: FunctionsFiltersState = { search: '', tags: [] }

export interface FunctionsFiltersProps {
  filters: FunctionsFiltersState
  allTags: string[]
  columns: Column[]
  onFilterChange: (filters: FunctionsFiltersState) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  disabled?: boolean
  actions?: ReactNode
}

export function FunctionsFilters({
  filters,
  allTags,
  columns,
  onFilterChange,
  onColumnToggle,
  disabled = false,
  actions,
}: Readonly<FunctionsFiltersProps>) {
  return (
    <EntityFilterWrapper
      entityName="functions"
      filters={filters}
      defaultFilters={DEFAULT_FILTERS}
      allTags={allTags}
      columns={columns}
      fields={[]}
      onFilterChange={onFilterChange}
      onColumnToggle={onColumnToggle}
      disabled={disabled}
      actions={actions}
    />
  )
}
