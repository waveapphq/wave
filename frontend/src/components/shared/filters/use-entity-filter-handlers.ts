/**
 * useEntityFilterHandlers - Shared hook for entity filter page callbacks.
 *
 * Eliminates duplicated handleFieldChange, handleTagsChange,
 * handleSearchChange, handleClearAll, and hasActiveFilters logic
 * across SuitesFilters, RegressionsFilters, ProfilesFilters, and TestsFilters.
 */

import { useCallback, useMemo } from 'react'

/** Minimal contract: every filter object has search, tags optional. */
interface BaseFilters {
  search: string
  tags?: string[]
}

/**
 * Equality for filter values. Handles primitives, arrays (by element), and
 * plain objects (by structural equality). Used so discriminated objects such
 * as the executions `dateRange` filter are compared by content, not reference.
 */
function filterValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i])
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

export interface UseEntityFilterHandlersResult {
  /** Update a single filter field by key. */
  handleFieldChange: (key: string, value: string | string[]) => void
  /** Replace the tags array. */
  handleTagsChange: (tags: string[]) => void
  /** Update the search string. */
  handleSearchChange: (value: string) => void
  /** Reset all filters to their defaults. */
  handleClearAll: () => void
  /** True when any filter value differs from its default. */
  hasActiveFilters: boolean
}

/**
 * Provides memoized filter-change callbacks and an active-filters flag.
 *
 * @param filters        Current filter state object.
 * @param onChange        Callback invoked with the updated filter state.
 * @param defaultFilters The "empty" filter state used for clear-all and
 *                       active-filters comparison.
 */
export function useEntityFilterHandlers<T extends BaseFilters>(
  filters: T,
  onChange: (filters: T) => void,
  defaultFilters: T,
): UseEntityFilterHandlersResult {
  const handleFieldChange = useCallback(
    (key: string, value: string | string[]) => {
      onChange({ ...filters, [key]: value } as T)
    },
    [filters, onChange],
  )

  const handleTagsChange = useCallback(
    (tags: string[]) => {
      onChange({ ...filters, tags })
    },
    [filters, onChange],
  )

  const handleSearchChange = useCallback(
    (value: string) => {
      onChange({ ...filters, search: value })
    },
    [filters, onChange],
  )

  const handleClearAll = useCallback(() => {
    onChange(defaultFilters)
  }, [onChange, defaultFilters])

  const hasActiveFilters = useMemo(() => {
    const keys = Object.keys(defaultFilters) as (keyof T)[]
    return keys.some((key) => !filterValuesEqual(filters[key], defaultFilters[key]))
  }, [filters, defaultFilters])

  return {
    handleFieldChange,
    handleTagsChange,
    handleSearchChange,
    handleClearAll,
    hasActiveFilters,
  }
}
