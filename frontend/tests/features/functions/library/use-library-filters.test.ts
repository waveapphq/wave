/**
 * Tests for `useLibraryFilters` - the search + tag filtering hook behind the
 * Functions Library modal.
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useLibraryFilters } from '@/features/functions/library/use-library-filters'
import type { FunctionSummary } from '@/features/functions/api/types'

const SAMPLE: FunctionSummary[] = [
  { id: '1', name: 'Greet User', description: '', tags: ['demo', 'greet'], created_at: '', updated_at: '' },
  { id: '2', name: 'Send Email', description: '', tags: ['mail'], created_at: '', updated_at: '' },
  { id: '3', name: 'Charge Card', description: '', tags: ['mail', 'payment'], created_at: '', updated_at: '' },
]


describe('useLibraryFilters - tag toggling', () => {
  it('adds a tag on first toggle and removes it on second toggle', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE))
    act(() => result.current.toggleTag('mail'))
    expect(result.current.selectedTags).toEqual(['mail'])
    act(() => result.current.toggleTag('mail'))
    expect(result.current.selectedTags).toEqual([])
  })
})


describe('useLibraryFilters - clear', () => {
  it('clearFilters resets search and selected tags', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE))
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
    const { result } = renderHook(() => useLibraryFilters(SAMPLE))
    expect(result.current.allTags).toEqual(['demo', 'greet', 'mail', 'payment'])
  })
})


describe('useLibraryFilters - tag filter AND semantics', () => {
  it('keeps only entries that carry every selected tag', () => {
    const { result } = renderHook(() => useLibraryFilters(SAMPLE))
    act(() => result.current.setSelectedTags(['mail', 'payment']))
    expect(result.current.filtered.map((fn) => fn.id)).toEqual(['3'])
  })
})
