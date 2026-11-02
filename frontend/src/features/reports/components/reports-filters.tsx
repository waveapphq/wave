/**
 * ReportsFilters Component (RVIEW-11)
 *
 * Filters for the reports list: search, status, type, user, date range,
 * columns toggle. Thin wrapper around EntityFilterWrapper, mirroring the
 * executions filters. Status options carry only the values the strict
 * GET /reports validation accepts.
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

export interface ReportsFilters {
  search: string
  status: string[]
  type: string[]
  user: string[]
  dateRange?: DateRangeValue
}

export interface ReportsFiltersProps {
  filters: ReportsFilters
  allUsers: string[]
  columns: Column[]
  onFilterChange: (filters: ReportsFilters) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  disabled?: boolean
}

const STATUS_OPTIONS = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'stopped', label: 'Stopped' },
]

const ALL_TIME: DateRangeValue = { kind: 'all-time' }

export const DEFAULT_REPORTS_FILTERS: Required<ReportsFilters> = {
  search: '',
  status: [],
  type: [],
  user: [],
  dateRange: ALL_TIME,
}

export function ReportsFilters({
  filters,
  allUsers,
  columns,
  onFilterChange,
  onColumnToggle,
  disabled = false,
}: Readonly<ReportsFiltersProps>) {
  const userOptions = useMemo(() => allUsers.map((u) => ({ value: u, label: u })), [allUsers])

  const fields = useMemo(
    (): FilterField[] => [
      buildStatusField(STATUS_OPTIONS, filters.status),
      buildTypeField(filters.type),
      buildUserField(userOptions, filters.user),
    ],
    [filters.status, filters.type, filters.user, userOptions],
  )

  const normalizedFilters: Required<ReportsFilters> = {
    ...filters,
    dateRange: filters.dateRange ?? ALL_TIME,
  }

  const dateRangePill = (
    <DateRangePicker
      value={normalizedFilters.dateRange}
      onChange={(next) => onFilterChange({ ...normalizedFilters, dateRange: next })}
      disabled={disabled}
    />
  )

  return (
    <EntityFilterWrapper
      entityName="reports"
      filters={normalizedFilters}
      defaultFilters={DEFAULT_REPORTS_FILTERS}
      columns={columns}
      fields={fields}
      extraFields={dateRangePill}
      onFilterChange={onFilterChange}
      onColumnToggle={onColumnToggle}
      disabled={disabled}
    />
  )
}
