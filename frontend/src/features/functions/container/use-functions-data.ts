/**
 * Functions Data Hook.
 *
 * Fetches the published-Function list + the tag universe and maps the wire
 * `FunctionSummary` onto the list-row shape. Uses the container-hook pattern
 * (local state + direct API), matching the canonical list pages.
 */

import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedLoading } from '@/hooks/use-debounced-loading'
import { useBlockingReads, type BlockingRead, type PrimaryState } from '@/hooks/use-blocking-reads'
import { listFunctions, listFunctionTags } from '@/features/functions/api/functions-api'
import type { FunctionSummary } from '@/features/functions/api/types'
import type { FunctionRow } from '@/features/functions/components/functions-columns'
import type { FunctionsFiltersState } from '@/features/functions/components/functions-filters'
import type { PageInfo } from '@/components/shared/tables/table-utils'

function toFunctionRow(summary: FunctionSummary): FunctionRow {
  return {
    id: summary.id,
    name: summary.name,
    description: summary.description,
    tags: summary.tags,
    latestVersion: summary.latest_version ?? '',
    updatedAt: summary.updated_at,
  }
}

export interface FunctionsDataResult {
  functions: FunctionRow[]
  allTags: string[]
  loading: boolean
  /** False until the first read has finished; skeletons stand in until it has. */
  settled: boolean
  error: string | null
  setError: (error: string | null) => void
  loadData: () => Promise<void>
}

export function useFunctionsData(
  pageInfo: PageInfo,
  filters: FunctionsFiltersState,
  sortColumn: string | null,
  sortDirection: 'asc' | 'desc' | null,
  setPageInfo: React.Dispatch<React.SetStateAction<PageInfo>>,
): FunctionsDataResult {
  const [functions, setFunctions] = useState<FunctionRow[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [primary, setPrimary] = useState<PrimaryState>('pending')
  const { loading, settled, startLoading, stopLoading } = useDebouncedLoading()
  const [error, setError] = useState<string | null>(null)
  const blocking = useBlockingReads(primary)

  const tagReads = useMemo<BlockingRead[]>(
    () => [{ label: 'tags', run: async () => setAllTags(await listFunctionTags()) }],
    [],
  )

  const reportLoadFailure = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : 'Failed to load functions')
  }, [])

  const loadData = useCallback(async () => {
    startLoading()
    setError(null)
    setPrimary('pending')
    try {
      const result = await listFunctions({
        page: pageInfo.currentPage,
        per_page: pageInfo.pageSize,
        search: filters.search || undefined,
        tags: filters.tags.length > 0 ? filters.tags : undefined,
        sort_by: sortColumn || undefined,
        sort_order: sortDirection || undefined,
      })
      setFunctions(result.functions.map(toFunctionRow))
      setPageInfo((prev) => ({
        ...prev,
        totalItems: result.pagination.total,
        totalPages: result.pagination.total_pages,
      }))
      setPrimary('loaded')
    } catch (err) {
      reportLoadFailure(err)
      setPrimary('failed')
    } finally {
      stopLoading()
    }
  }, [pageInfo.currentPage, pageInfo.pageSize, filters, sortColumn, sortDirection, setPageInfo, startLoading, stopLoading, reportLoadFailure])

  useEffect(() => {
    loadData().catch(reportLoadFailure)
  }, [loadData, reportLoadFailure])

  // Each read reports itself on the page block; the list only hears about a
  // failure of the run itself.
  useEffect(() => {
    blocking.load(tagReads).catch(reportLoadFailure)
  }, [blocking, tagReads, reportLoadFailure])

  return { functions, allTags, loading, settled, error, setError, loadData }
}
