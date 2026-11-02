/**
 * Filters for the artifacts list: search, status, type, columns toggle. Thin
 * wrapper around EntityFilterWrapper, mirroring the reports/executions filters
 * (no user or date-range pills - the landing list is execution-first).
 */

import { useMemo, type ReactNode } from 'react'
import { type Column, type FilterField } from '@/components/shared/filters/entity-filters'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'
import { buildStatusField, buildTypeField } from '@/components/shared/filters/filter-field-builders'

export type { Column } from '@/components/shared/filters/entity-filters'

export interface ArtifactsFilters {
  search: string
  status: string[]
  type: string[]
}

export interface ArtifactsFiltersProps {
  filters: ArtifactsFilters
  columns: Column[]
  onFilterChange: (filters: ArtifactsFilters) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  disabled?: boolean
  /** Mass Action control, rendered in the toolbar next to the Columns button. */
  actions?: ReactNode
}

const STATUS_OPTIONS = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'stopped', label: 'Stopped' },
]

export const DEFAULT_ARTIFACTS_FILTERS: ArtifactsFilters = {
  search: '',
  status: [],
  type: [],
}

export function ArtifactsFilters({
  filters,
  columns,
  onFilterChange,
  onColumnToggle,
  disabled = false,
  actions,
}: Readonly<ArtifactsFiltersProps>) {
  const fields = useMemo(
    (): FilterField[] => [buildStatusField(STATUS_OPTIONS, filters.status), buildTypeField(filters.type)],
    [filters.status, filters.type],
  )

  return (
    <EntityFilterWrapper
      entityName="artifacts"
      filters={filters}
      defaultFilters={DEFAULT_ARTIFACTS_FILTERS}
      columns={columns}
      fields={fields}
      onFilterChange={onFilterChange}
      onColumnToggle={onColumnToggle}
      disabled={disabled}
      actions={actions}
    />
  )
}
