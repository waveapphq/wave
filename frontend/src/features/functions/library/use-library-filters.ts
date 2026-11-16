/**
 * `useLibraryFilters` - derive the visible card list from search + tag state.
 *
 * The search runs on the server over name, description and tags (CANVAS-205);
 * the caller passes its matches. Until the first answer lands the catalog stays
 * shown. Tag filtering uses AND semantics (a card must carry ALL selected tags).
 */

import { useMemo, useState } from 'react'

import type { FunctionSearchField, FunctionSummary } from '@/features/functions/api/types'

/** What the library window's search reads (CANVAS-205). */
export const LIBRARY_SEARCH_FIELDS: FunctionSearchField[] = ['name', 'description', 'tags']

export interface UseLibraryFiltersResult {
  search: string
  setSearch: (value: string) => void
  selectedTags: string[]
  setSelectedTags: (tags: string[]) => void
  toggleTag: (tag: string) => void
  clearFilters: () => void
  allTags: string[]
  filtered: FunctionSummary[]
  hasActiveFilters: boolean
}

export function useLibraryFilters(
  catalog: FunctionSummary[],
  searchMatches: FunctionSummary[] | null,
  initialSearch: string = '',
): UseLibraryFiltersResult {
  const [search, setSearch] = useState(initialSearch)
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const fn of catalog) {
      for (const tag of fn.tags) set.add(tag)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [catalog])

  const searching = search.trim().length > 0
  const shown = searching && searchMatches !== null ? searchMatches : catalog

  const filtered = useMemo(() => {
    if (selectedTags.length === 0) return shown
    return shown.filter((fn) => {
      const fnTagSet = new Set(fn.tags)
      return selectedTags.every((tag) => fnTagSet.has(tag))
    })
  }, [shown, selectedTags])

  const hasActiveFilters = searching || selectedTags.length > 0

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  const clearFilters = () => {
    setSearch('')
    setSelectedTags([])
  }

  return {
    search,
    setSearch,
    selectedTags,
    setSelectedTags,
    toggleTag,
    clearFilters,
    allTags,
    filtered,
    hasActiveFilters,
  }
}
