/**
 * `useLibraryFilters` - derive the visible card list from search + tag state.
 *
 * Tag filtering uses AND semantics (a card must carry ALL selected tags).
 * Search is a case-insensitive substring match against the Function name.
 */

import { useMemo, useState } from 'react'

import type { FunctionSummary } from '@/features/functions/api/types'

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
  allFunctions: FunctionSummary[],
  initialSearch: string = '',
): UseLibraryFiltersResult {
  const [search, setSearch] = useState(initialSearch)
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const fn of allFunctions) {
      for (const tag of fn.tags) set.add(tag)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [allFunctions])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return allFunctions.filter((fn) => {
      if (term && !fn.name.toLowerCase().includes(term)) return false
      if (selectedTags.length > 0) {
        const fnTagSet = new Set(fn.tags)
        for (const tag of selectedTags) {
          if (!fnTagSet.has(tag)) return false
        }
      }
      return true
    })
  }, [allFunctions, search, selectedTags])

  const hasActiveFilters = search.trim().length > 0 || selectedTags.length > 0

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
