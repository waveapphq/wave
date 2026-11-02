/**
 * ExecutionsFilters Component
 *
 * REQ-5.2.1.40: Execution history screen
 *
 * Filters for the executions list: search, status, type, user, date range,
 * columns toggle. Thin wrapper around EntityFilterWrapper (no tags for
 * executions). The date range pill is rendered via the extraFields slot since
 * it is execution-specific and uses a different UI shape than the generic
 * FilterField popovers.
 */

import { useMemo } from 'react'
import { type Column, type FilterField } from '@/components/shared/filters/entity-filters'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'
import {
  buildStatusField,
  buildTypeField,
  buildUserField,
} from '@/components/shared/filters/filter-field-builders'
import { DateRangePicker } from '@/components/shared/filters/date-range-picker'
import type { DateRangeValue } from '@/lib/date-range'

export type { Column } from '@/components/shared/filters/entity-filters'

export interface ExecutionsFilters {
  search: string
  status: string[]
  type: string[]
  user: string[]
  dateRange?: DateRangeValue
}

export interface ExecutionsFiltersProps {
  filters: ExecutionsFilters
  allUsers: string[]
  columns: Column[]
  onFilterChange: (filters: ExecutionsFilters) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  disabled?: boolean
  actions?: React.ReactNode
}

const STATUS_OPTIONS = [
  { value: 'running', label: 'Running' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'skipped', label: 'Skipped' },
]

const ALL_TIME: DateRangeValue = { kind: 'all-time' }

export const DEFAULT_EXECUTIONS_FILTERS: Required<ExecutionsFilters> = {
  search: '',
  status: [],
  type: [],
  user: [],
  dateRange: ALL_TIME,
}

export function ExecutionsFilters({
  filters,
  allUsers,
  columns,
  onFilterChange,
  onColumnToggle,
  disabled = false,
  actions,
}: Readonly<ExecutionsFiltersProps>) {
  const userOptions = useMemo(
    () => allUsers.map((u) => ({ value: u, label: u })),
    [allUsers],
  )

  const fields = useMemo((): FilterField[] => [
    buildStatusField(STATUS_OPTIONS, filters.status),
    buildTypeField(filters.type),
    buildUserField(userOptions, filters.user),
  ], [filters.status, filters.type, filters.user, userOptions])

  const normalizedFilters: Required<ExecutionsFilters> = {
    ...filters,
    dateRange: filters.dateRange ?? ALL_TIME,
  }

  const dateRangePill = (
    <DateRangePicker
      value={normalizedFilters.dateRange}
      onChange={(next) =>
        onFilterChange({ ...normalizedFilters, dateRange: next })
      }
      disabled={disabled}
    />
  )

  return (
    <EntityFilterWrapper
      entityName="executions"
      filters={normalizedFilters}
      defaultFilters={DEFAULT_EXECUTIONS_FILTERS}
      columns={columns}
      fields={fields}
      extraFields={dateRangePill}
      onFilterChange={onFilterChange}
      onColumnToggle={onColumnToggle}
      disabled={disabled}
      actions={actions}
    />
  )
}
