/**
 * useEntityFilterHandlers Hook Tests
 *
 * Tests the shared hook that provides memoized filter-change callbacks
 * and an active-filters flag for entity filter components.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEntityFilterHandlers } from '@/components/shared/filters/use-entity-filter-handlers'

// ============================================================================
// Test Filter Types
// ============================================================================

interface SimpleFilters {
  search: string
  status: string[]
  tags: string[]
}

interface ExtendedFilters {
  search: string
  status: string[]
  suiteIds: string[]
  tags: string[]
}

interface SingleSelectFilters {
  search: string
  type: string
  tags: string[]
}

// ============================================================================
// Tests
// ============================================================================

describe('useEntityFilterHandlers', () => {
  const simpleDefaults: SimpleFilters = { search: '', status: [], tags: [] }
  const extendedDefaults: ExtendedFilters = { search: '', status: [], suiteIds: [], tags: [] }
  const singleSelectDefaults: SingleSelectFilters = { search: '', type: '', tags: [] }

  describe('handleFieldChange', () => {
    it('updates an array field by key', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: '', status: [], tags: [] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      act(() => {
        result.current.handleFieldChange('status', ['passed'])
      })

      expect(onChange).toHaveBeenCalledWith({ search: '', status: ['passed'], tags: [] })
    })

    it('updates a string field by key', () => {
      const onChange = vi.fn()
      const filters: SingleSelectFilters = { search: '', type: '', tags: [] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, singleSelectDefaults)
      )

      act(() => {
        result.current.handleFieldChange('type', 'database')
      })

      expect(onChange).toHaveBeenCalledWith({ search: '', type: 'database', tags: [] })
    })

    it('preserves other filter values when updating one field', () => {
      const onChange = vi.fn()
      const filters: ExtendedFilters = { search: 'test', status: ['passed'], suiteIds: [], tags: ['auth'] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, extendedDefaults)
      )

      act(() => {
        result.current.handleFieldChange('suiteIds', ['suite-1'])
      })

      expect(onChange).toHaveBeenCalledWith({
        search: 'test',
        status: ['passed'],
        suiteIds: ['suite-1'],
        tags: ['auth'],
      })
    })
  })

  describe('handleTagsChange', () => {
    it('updates tags with new array', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: '', status: [], tags: [] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      act(() => {
        result.current.handleTagsChange(['auth', 'smoke'])
      })

      expect(onChange).toHaveBeenCalledWith({ search: '', status: [], tags: ['auth', 'smoke'] })
    })

    it('preserves other filter values when updating tags', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: 'query', status: ['failed'], tags: [] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      act(() => {
        result.current.handleTagsChange(['regression'])
      })

      expect(onChange).toHaveBeenCalledWith({
        search: 'query',
        status: ['failed'],
        tags: ['regression'],
      })
    })

    it('clears tags with an empty array', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: '', status: [], tags: ['auth'] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      act(() => {
        result.current.handleTagsChange([])
      })

      expect(onChange).toHaveBeenCalledWith({ search: '', status: [], tags: [] })
    })
  })

  describe('handleSearchChange', () => {
    it('updates search value', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: '', status: [], tags: [] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      act(() => {
        result.current.handleSearchChange('login')
      })

      expect(onChange).toHaveBeenCalledWith({ search: 'login', status: [], tags: [] })
    })

    it('preserves other filter values when updating search', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: '', status: ['passed'], tags: ['smoke'] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      act(() => {
        result.current.handleSearchChange('auth')
      })

      expect(onChange).toHaveBeenCalledWith({
        search: 'auth',
        status: ['passed'],
        tags: ['smoke'],
      })
    })

    it('clears search with an empty string', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: 'query', status: [], tags: [] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      act(() => {
        result.current.handleSearchChange('')
      })

      expect(onChange).toHaveBeenCalledWith({ search: '', status: [], tags: [] })
    })
  })

  describe('handleClearAll', () => {
    it('resets to default filters for simple filter type', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: 'test', status: ['passed'], tags: ['auth'] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      act(() => {
        result.current.handleClearAll()
      })

      expect(onChange).toHaveBeenCalledWith({ search: '', status: [], tags: [] })
    })

    it('resets to default filters for extended filter type', () => {
      const onChange = vi.fn()
      const filters: ExtendedFilters = {
        search: 'test',
        status: ['passed'],
        suiteIds: ['suite-1'],
        tags: ['auth'],
      }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, extendedDefaults)
      )

      act(() => {
        result.current.handleClearAll()
      })

      expect(onChange).toHaveBeenCalledWith({
        search: '',
        status: [],
        suiteIds: [],
        tags: [],
      })
    })

    it('resets to default filters for single-select filter type', () => {
      const onChange = vi.fn()
      const filters: SingleSelectFilters = { search: 'prod', type: 'database', tags: ['critical'] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, singleSelectDefaults)
      )

      act(() => {
        result.current.handleClearAll()
      })

      expect(onChange).toHaveBeenCalledWith({ search: '', type: '', tags: [] })
    })

    it('calling clear when already at defaults still calls onChange', () => {
      const onChange = vi.fn()

      const { result } = renderHook(() =>
        useEntityFilterHandlers(simpleDefaults, onChange, simpleDefaults)
      )

      act(() => {
        result.current.handleClearAll()
      })

      expect(onChange).toHaveBeenCalledWith(simpleDefaults)
    })
  })

  describe('hasActiveFilters', () => {
    it('returns false when all filters are at defaults', () => {
      const onChange = vi.fn()

      const { result } = renderHook(() =>
        useEntityFilterHandlers(simpleDefaults, onChange, simpleDefaults)
      )

      expect(result.current.hasActiveFilters).toBe(false)
    })

    it('returns true when search is active', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: 'query', status: [], tags: [] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      expect(result.current.hasActiveFilters).toBe(true)
    })

    it('returns true when an array filter has values', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: '', status: ['passed'], tags: [] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      expect(result.current.hasActiveFilters).toBe(true)
    })

    it('returns true when tags are selected', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: '', status: [], tags: ['auth'] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      expect(result.current.hasActiveFilters).toBe(true)
    })

    it('returns true when a string filter differs from default', () => {
      const onChange = vi.fn()
      const filters: SingleSelectFilters = { search: '', type: 'database', tags: [] }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, singleSelectDefaults)
      )

      expect(result.current.hasActiveFilters).toBe(true)
    })

    it('returns true when multiple filters are active', () => {
      const onChange = vi.fn()
      const filters: ExtendedFilters = {
        search: 'test',
        status: ['passed'],
        suiteIds: ['s-1'],
        tags: ['auth'],
      }

      const { result } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, extendedDefaults)
      )

      expect(result.current.hasActiveFilters).toBe(true)
    })

    it('returns false for extended filters when all at defaults', () => {
      const onChange = vi.fn()

      const { result } = renderHook(() =>
        useEntityFilterHandlers(extendedDefaults, onChange, extendedDefaults)
      )

      expect(result.current.hasActiveFilters).toBe(false)
    })

    it('updates when filters change', () => {
      const onChange = vi.fn()
      let filters: SimpleFilters = { search: '', status: [], tags: [] }

      const { result, rerender } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      expect(result.current.hasActiveFilters).toBe(false)

      filters = { search: 'query', status: [], tags: [] }
      rerender()

      expect(result.current.hasActiveFilters).toBe(true)
    })
  })

  describe('callback memoization', () => {
    it('returns stable callbacks when filters and onChange do not change', () => {
      const onChange = vi.fn()
      const filters: SimpleFilters = { search: '', status: [], tags: [] }

      const { result, rerender } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      const first = result.current

      rerender()

      expect(result.current.handleFieldChange).toBe(first.handleFieldChange)
      expect(result.current.handleTagsChange).toBe(first.handleTagsChange)
      expect(result.current.handleSearchChange).toBe(first.handleSearchChange)
      expect(result.current.handleClearAll).toBe(first.handleClearAll)
    })

    it('returns new callbacks when filters change', () => {
      const onChange = vi.fn()
      let filters: SimpleFilters = { search: '', status: [], tags: [] }

      const { result, rerender } = renderHook(() =>
        useEntityFilterHandlers(filters, onChange, simpleDefaults)
      )

      const first = result.current

      filters = { search: 'new', status: [], tags: [] }
      rerender()

      // handleFieldChange, handleTagsChange, handleSearchChange depend on filters
      expect(result.current.handleFieldChange).not.toBe(first.handleFieldChange)
      expect(result.current.handleTagsChange).not.toBe(first.handleTagsChange)
      expect(result.current.handleSearchChange).not.toBe(first.handleSearchChange)
    })
  })
})
