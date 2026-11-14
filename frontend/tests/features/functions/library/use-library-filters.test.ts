/**
 * Tests for `useLibraryFilters` - the search + tag filtering hook behind the
 * Functions Library modal. The search itself runs on the server (CANVAS-205).
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import {
  LIBRARY_SEARCH_FIELDS,
  useLibraryFilters,
} from '@/features/functions/library/use-library-filters'
import type { FunctionSummary } from '@/features/functions/api/types'

const SAMPLE: FunctionSummary[] = [
  { id: '1', name: 'Greet User', description: '', tags: ['demo', 'greet'], created_at: '', updated_at: '' },
  { id: '2', name: 'Send Email', description: '', tags: ['mail'], created_at: '', updated_at: '' },
  { id: '3', name: 'Charge Card', description: '', tags: ['mail', 'payment'], created_at: '', updated_at: '' },
]


describe('useLibraryFilters - tag toggling', () => {
  it('adds a tag on first toggle and removes it on second toggle', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE, null))
    act(() => result.current.toggleTag('mail'))
    expect(result.current.selectedTags).toEqual(['mail'])
    act(() => result.current.toggleTag('mail'))
    expect(result.current.selectedTags).toEqual([])
  })
})


describe('useLibraryFilters - clear', () => {
  it('clearFilters resets search and selected tags', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE, null))
    act(() => result.current.setSearch('greet'))
    act(() => result.current.toggleTag('mail'))
    expect(result.current.hasActiveFilters).toBe(true)
    act(() => result.current.clearFilters())
    expect(result.current.search).toBe('')
    expect(result.current.selectedTags).toEqual([])
    expect(result.current.hasActiveFilters).toBe(false)
  })
})


describe('useLibraryFilters - allTags derivation', () => {
  it('returns the sorted unique tag union', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE, null))
    expect(result.current.allTags).toEqual(['demo', 'greet', 'mail', 'payment'])
  })
})


describe('useLibraryFilters - tag filter AND semantics', () => {
  it('keeps only entries that carry every selected tag', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE, null))
    act(() => result.current.setSelectedTags(['mail', 'payment']))
    expect(result.current.filtered.map((fn) => fn.id)).toEqual(['3'])
  })
})


describe('useLibraryFilters - server search matches', () => {
  it('reads name, description and tags', () => {
    expect(LIBRARY_SEARCH_FIELDS).toEqual(['name', 'description', 'tags'])
  })

  it('shows the whole catalog while no search is typed, whatever matches are held', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE, [SAMPLE[1]]))
    expect(result.current.filtered.map((fn) => fn.id)).toEqual(['1', '2', '3'])
  })

  it('shows the server matches once a search is typed', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE, [SAMPLE[2]], 'payment'))
    expect(result.current.filtered.map((fn) => fn.id)).toEqual(['3'])
  })

  it('keeps the catalog shown until the first answer for a search lands', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE, null, 'payment'))
    expect(result.current.filtered.map((fn) => fn.id)).toEqual(['1', '2', '3'])
  })

  it('treats a search of spaces as no search', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE, [], '   '))
    expect(result.current.filtered.map((fn) => fn.id)).toEqual(['1', '2', '3'])
    expect(result.current.hasActiveFilters).toBe(false)
  })

  it('AND-filters the matches by the selected tags', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE, [SAMPLE[1], SAMPLE[2]], 'mail'))
    act(() => result.current.setSelectedTags(['payment']))
    expect(result.current.filtered.map((fn) => fn.id)).toEqual(['3'])
  })

  it('lists the tags of the whole catalog, not of the matches', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE, [SAMPLE[1]], 'send'))
    expect(result.current.allTags).toEqual(['demo', 'greet', 'mail', 'payment'])
  })
})
