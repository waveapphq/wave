/**
 * URL-synchronized list filters (search / status / type / user / date range).
 *
 * Seeds the filter state from the current search params on mount and, on
 * change, rewrites the URL (page reset to 1) and resets the table page.
 * Shared by the executions and reports list containers.
 */

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import {
  parseDateRangeParam,
  serializeDateRange,
  type DateRangeValue,
} from '@/lib/date-range'

export interface UrlListFilters {
  search: string
  status: string[]
  type: string[]
  user: string[]
  dateRange?: DateRangeValue
}

export interface UseUrlListFiltersOptions {
  pageSize: number
  setPageInfo: Dispatch<SetStateAction<PageInfo>>
}

export interface UseUrlListFiltersResult {
  filters: UrlListFilters
  handleFilterChange: (next: UrlListFilters) => void
}

export function useUrlListFilters({
  pageSize,
  setPageInfo,
}: UseUrlListFiltersOptions): UseUrlListFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams()

  const [filters, setFilters] = useState<UrlListFilters>(() => ({
    search: searchParams.get('search') || '',
    status: searchParams.get('status')?.split(',').filter(Boolean) || [],
    type: searchParams.get('type')?.split(',').filter(Boolean) || [],
    user: searchParams.get('user')?.split(',').filter(Boolean) || [],
    dateRange: parseDateRangeParam(searchParams.get('date')),
  }))

  const handleFilterChange = useCallback(
    (next: UrlListFilters) => {
      setFilters(next)
      const params = new URLSearchParams()
      if (next.search) params.set('search', next.search)
      if (next.status.length > 0) params.set('status', next.status.join(','))
      if (next.type.length > 0) params.set('type', next.type.join(','))
      if (next.user.length > 0) params.set('user', next.user.join(','))
      const dateParam = serializeDateRange(next.dateRange ?? { kind: 'all-time' })
      if (dateParam) params.set('date', dateParam)
      params.set('page', '1')
      params.set('pageSize', pageSize.toString())
      setSearchParams(params, { replace: true })
      setPageInfo((prev) => ({ ...prev, currentPage: 1 }))
    },
    [pageSize, setSearchParams, setPageInfo],
  )

  return { filters, handleFilterChange }
}
