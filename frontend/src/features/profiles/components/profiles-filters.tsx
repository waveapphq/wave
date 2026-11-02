/**
 * ProfilesFilters Component
 *
 * REQ-4.7.4: Profile management UI
 *
 * Filters for profiles page: search, type (single-select), tags, columns toggle.
 * NO Status filter (profiles do not execute).
 * Thin wrapper around EntityFilterWrapper.
 */

import { useMemo } from 'react'
import { type Column, type FilterField } from '@/components/shared/filters/entity-filters'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'

export type { Column } from '@/components/shared/filters/entity-filters'

export interface Filters {
  search: string
  type: string
  tags: string[]
}

export interface ProfilesFiltersProps {
  filters: Filters
  profileTypes: string[]
  allTags: string[]
  columns: Column[]
  onFilterChange: (filters: Filters) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  disabled?: boolean
  actions?: React.ReactNode
}

const DEFAULT_FILTERS: Filters = { search: '', type: '', tags: [] }

export function ProfilesFilters({
  filters,
  profileTypes,
  allTags,
  columns,
  onFilterChange,
  onColumnToggle,
  disabled = false,
  actions,
}: Readonly<ProfilesFiltersProps>) {
  const typeOptions = useMemo(
    () => profileTypes.map((t) => ({ value: t, label: t })),
    [profileTypes]
  )

  const fields = useMemo((): FilterField[] => [
    {
      key: 'type',
      placeholder: 'Type',
      countLabel: 'types',
      countLabelSingular: 'type',
      testId: 'filter-type',
      ariaLabel: 'Filter by type',
      buttonWidth: 'w-[140px]',
      searchPlaceholder: 'Search type…',
      emptyMessage: 'No types found',
      options: typeOptions,
      mode: 'single',
      selectedValue: filters.type,
      emptySourceMessage: 'No types available',
    },
  ], [filters.type, typeOptions])

  return (
    <EntityFilterWrapper
      entityName="profiles"
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
