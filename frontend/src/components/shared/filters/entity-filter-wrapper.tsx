/**
 * EntityFilterWrapper - Shared wrapper that wires up useEntityFilterHandlers
 * and EntityFilters for all entity list pages.
 *
 * Eliminates duplicated handler wiring and EntityFilters JSX across
 * SuitesFilters, RegressionsFilters, TestsFilters, and ProfilesFilters.
 */

import { type ReactNode } from 'react'
/* v8 ignore next - COV-V8-006: V8 coverage merge non-deterministically drops this import across forks pool */
import { EntityFilters, type Column, type FilterField } from '@/components/shared/filters/entity-filters'
import { useEntityFilterHandlers } from '@/components/shared/filters/use-entity-filter-handlers'

export interface EntityFilterWrapperProps<F extends { search: string; tags?: string[] }> {
  /** Entity name used for search input id, name, placeholder, and aria-label. */
  entityName: string
  /** Current filter state. */
  filters: F
  /** Default (empty) filter state for reset. */
  defaultFilters: F
  /** All available tags (omit or pass empty to hide the tags filter). */
  allTags?: string[]
  /** Column definitions for column toggle. */
  columns: Column[]
  /** Pre-computed filter field definitions. */
  fields: FilterField[]
  /** Called when any filter changes. */
  onFilterChange: (filters: F) => void
  /** Called when a column is toggled. */
  onColumnToggle: (columnId: string, visible: boolean) => void
  /** Whether the filters are disabled. */
  disabled?: boolean
  /** Optional slot for additional controls (e.g., Mass Action) rendered before Columns. */
  actions?: ReactNode
  /** Optional additional filter pills rendered after the standard fields (e.g. date range). */
  extraFields?: ReactNode
}

export function EntityFilterWrapper<F extends { search: string; tags?: string[] }>({
  entityName,
  filters,
  defaultFilters,
  allTags,
  columns,
  fields,
  onFilterChange,
  onColumnToggle,
  disabled = false,
  actions,
  extraFields,
}: Readonly<EntityFilterWrapperProps<F>>) {
  const {
    handleFieldChange,
    handleTagsChange,
    handleSearchChange,
    handleClearAll,
    hasActiveFilters,
  } = useEntityFilterHandlers(filters, onFilterChange, defaultFilters)

  return (
    <EntityFilters
      search={{
        id: `${entityName}-search`,
        name: `${entityName}-search`,
        placeholder: `Search ${entityName}…`,
        ariaLabel: `Search ${entityName}`,
        defaultValue: filters.search,
      }}
      fields={fields}
      allTags={allTags}
      selectedTags={filters.tags ?? []}
      columns={columns}
      hasActiveFilters={hasActiveFilters}
      disabled={disabled}
      actions={actions}
      extraFields={extraFields}
      onSearchChange={handleSearchChange}
      onFieldChange={handleFieldChange}
      onTagsChange={handleTagsChange}
      onColumnToggle={onColumnToggle}
      onClearAll={handleClearAll}
    />
  )
}
