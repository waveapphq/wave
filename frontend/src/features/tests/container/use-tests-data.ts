/**
 * Tests Data Hook
 *
 * Handles fetching tests, suites, and tags from the backend.
 */

import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedLoading } from '@/hooks/use-debounced-loading'
import { useBlockingReads, type BlockingRead, type PrimaryState } from '@/hooks/use-blocking-reads'
import type { Test } from '@/features/tests/api/types'
import type { PageInfo } from '@/components/shared/tables/table-utils'
export type { PageInfo } from '@/components/shared/tables/table-utils'
import type { Suite as FiltersSuite, TestsFilters } from '@/features/tests/components/tests-filters'
import {
  fetchTests,
  fetchTestsTags,
  transformApiTest,
} from '@/features/tests/api/crud'
import { fetchSuiteNames } from '@/features/suites/api/crud'

export interface TestsDataResult {
  tests: Test[]
  suites: FiltersSuite[]
  allTags: string[]
  loading: boolean
  /** False until the first read has finished; skeletons stand in until it has. */
  settled: boolean
  error: string | null
  /** How the list's own records read ended; gates the surface's other reads. */
  primary: PrimaryState
  setError: (error: string | null) => void
  /** Awaitable form, for a caller that sequences work after the reload. */
  loadData: () => Promise<void>
  /** Form for a caller that cannot await; the page's error state reports a failure. */
  reload: () => void
}

export function useTestsData(
  pageInfo: PageInfo,
  filters: TestsFilters,
  sortColumn: string | null,
  sortDirection: 'asc' | 'desc' | null,
  setPageInfo: React.Dispatch<React.SetStateAction<PageInfo>>
): TestsDataResult {
  const [tests, setTests] = useState<Test[]>([])
  const [suites, setSuites] = useState<FiltersSuite[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [primary, setPrimary] = useState<PrimaryState>('pending')
  const { loading, settled, startLoading, stopLoading } = useDebouncedLoading()
  const [error, setError] = useState<string | null>(null)
  const blocking = useBlockingReads(primary)

  const suiteReads = useMemo<BlockingRead[]>(
    () => [{ label: 'suites', run: async () => setSuites(await fetchSuiteNames()) }],
    []
  )
  const tagReads = useMemo<BlockingRead[]>(
    () => [{ label: 'tags', run: async () => setAllTags(await fetchTestsTags()) }],
    []
  )

  const readAll = useCallback(async () => {
    startLoading()
    setError(null)
    setPrimary('pending')

    // Started before the primary read is awaited so both reads stay concurrent.
    const reads = blocking.load(suiteReads)

    try {
      const testsResult = await fetchTests({
        page: pageInfo.currentPage,
        per_page: pageInfo.pageSize,
        search: filters.search || undefined,
        status: filters.status.length > 0 ? filters.status : undefined,
        suite_ids: filters.suiteIds.length > 0 ? filters.suiteIds : undefined,
        tags: filters.tags.length > 0 ? filters.tags : undefined,
        sort_by: sortColumn || undefined,
        sort_order: sortDirection || undefined,
      })
      setTests(testsResult.data.map(transformApiTest))
      setPageInfo((prev) => ({
        ...prev,
        totalItems: testsResult.pagination.total,
        totalPages: testsResult.pagination.total_pages,
      }))
      setPrimary('loaded')
      await reads
    } catch (err) {
      // The page owns this failure, so its error state is never held behind a
      // read the page does not exist to show. Each read still reports itself.
      setPrimary('failed')
      throw err
    } finally {
      stopLoading()
    }
  }, [pageInfo.currentPage, pageInfo.pageSize, filters, sortColumn, sortDirection, setPageInfo, startLoading, stopLoading, blocking, suiteReads])

  const reportLoadFailure = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : 'Failed to load tests')
  }, [])

  const reload = useCallback((): void => {
    readAll().catch(reportLoadFailure)
  }, [readAll, reportLoadFailure])

  const loadData = useCallback(async (): Promise<void> => {
    await readAll().catch(reportLoadFailure)
  }, [readAll, reportLoadFailure])

  useEffect(() => {
    reload()
  }, [reload])

  // Tag universe (REQ-9.5.3.1), read once on mount
  useEffect(() => {
    blocking.start(tagReads)
  }, [blocking, tagReads])

  return {
    tests,
    suites,
    allTags,
    loading,
    settled,
    error,
    primary,
    setError,
    loadData,
    reload,
  }
}
