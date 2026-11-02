/**
 * useUrlListFilters Tests
 *
 * Shared URL-synchronized list filter state (promoted from the executions
 * and reports list containers): seeds from search params on mount; on
 * change rewrites the URL with page reset and resets the table page.
 */

import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useUrlListFilters } from '@/hooks/use-url-list-filters'

function wrapperWith(initialEntry: string) {
  return function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
  }
}

function renderFiltersHook(initialEntry = '/reports') {
  const setPageInfo = vi.fn()
  const rendered = renderHook(
    () => ({
      hook: useUrlListFilters({ pageSize: 10, setPageInfo }),
      searchParams: useSearchParams()[0],
    }),
    { wrapper: wrapperWith(initialEntry) },
  )
  return { ...rendered, setPageInfo }
}

describe('useUrlListFilters', () => {
  it('defaults to empty filters with an all-time date range', () => {
    const { result } = renderFiltersHook()

    expect(result.current.hook.filters).toEqual({
      search: '',
      status: [],
      type: [],
      user: [],
      dateRange: { kind: 'all-time' },
    })
  })

  it('seeds filters from the URL search params', () => {
    const { result } = renderFiltersHook(
      '/reports?search=night&status=passed,failed&type=suite&user=alice&date=preset:last-7',
    )

    expect(result.current.hook.filters).toEqual({
      search: 'night',
      status: ['passed', 'failed'],
      type: ['suite'],
      user: ['alice'],
      dateRange: { kind: 'preset', preset: 'last-7' },
    })
  })

  it('writes active filters to the URL with a page reset and resets the table page', () => {
    const { result, setPageInfo } = renderFiltersHook()

    act(() => {
      result.current.hook.handleFilterChange({
        search: 'smoke',
        status: ['failed'],
        type: ['suite', 'regression'],
        user: ['bob'],
        dateRange: { kind: 'preset', preset: 'last-30' },
      })
    })

    expect(result.current.hook.filters.search).toBe('smoke')
    const params = result.current.searchParams
    expect(params.get('search')).toBe('smoke')
    expect(params.get('status')).toBe('failed')
    expect(params.get('type')).toBe('suite,regression')
    expect(params.get('user')).toBe('bob')
    expect(params.get('date')).toBe('preset:last-30')
    expect(params.get('page')).toBe('1')
    expect(params.get('pageSize')).toBe('10')

    expect(setPageInfo).toHaveBeenCalledTimes(1)
    const updater = setPageInfo.mock.calls[0][0]
    expect(updater({ currentPage: 4, pageSize: 10, totalItems: 50, totalPages: 5 })).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalItems: 50,
      totalPages: 5,
    })
  })

  it('omits empty filters and the all-time date range from the URL', () => {
    const { result } = renderFiltersHook('/reports?search=old')

    act(() => {
      result.current.hook.handleFilterChange({
        search: '',
        status: [],
        type: [],
        user: [],
        dateRange: { kind: 'all-time' },
      })
    })

    const params = result.current.searchParams
    expect(params.get('search')).toBeNull()
    expect(params.get('status')).toBeNull()
    expect(params.get('type')).toBeNull()
    expect(params.get('user')).toBeNull()
    expect(params.get('date')).toBeNull()
    expect(params.get('page')).toBe('1')
  })

  it('treats a missing dateRange as all-time', () => {
    const { result } = renderFiltersHook()

    act(() => {
      result.current.hook.handleFilterChange({
        search: '',
        status: [],
        type: [],
        user: [],
      })
    })

    expect(result.current.searchParams.get('date')).toBeNull()
  })
})
