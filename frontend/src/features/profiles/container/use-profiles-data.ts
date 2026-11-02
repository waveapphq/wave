/**
 * Profiles data fetching hook
 *
 * Manages loading profiles, profile types, tags, and environments
 * from the API with pagination and filter support.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedLoading } from '@/hooks/use-debounced-loading'
import { useBlockingReads, type BlockingRead, type PrimaryState } from '@/hooks/use-blocking-reads'
import {
  fetchProfiles,
  fetchProfileTypes,
  fetchAllTags,
  fetchProfileEnvironments,
} from '@/features/profiles/api/crud'
import type { Profile, Environment } from '@/features/profiles/api/types'
import type { Filters } from '@/features/profiles/components/profiles-filters'
// Sort column/direction are now plain strings from useDataTable
import type { PageInfo } from './use-profiles-table'

export interface UseProfilesDataReturn {
  profiles: Profile[]
  profileTypes: string[]
  allTags: string[]
  environments: Environment[]
  environmentsFailed: boolean
  loading: boolean
  /** False until the first read has finished; skeletons stand in until it has. */
  settled: boolean
  error: string | null
  setError: React.Dispatch<React.SetStateAction<string | null>>
  loadData: () => void
}

const NO_ENVIRONMENTS: Environment[] = []

export function useProfilesData(
  pageInfo: PageInfo,
  setPageInfo: React.Dispatch<React.SetStateAction<PageInfo>>,
  filters: Filters,
  sortColumn: string | null,
  sortDirection: 'asc' | 'desc' | null
): UseProfilesDataReturn {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileTypes, setProfileTypes] = useState<string[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [environments, setEnvironments] = useState<Environment[]>(NO_ENVIRONMENTS)
  const [environmentsFailed, setEnvironmentsFailed] = useState(false)
  const [primary, setPrimary] = useState<PrimaryState>('pending')
  const { loading, settled, startLoading, stopLoading } = useDebouncedLoading()
  const [error, setError] = useState<string | null>(null)
  const blocking = useBlockingReads(primary)

  const blockingReads = useMemo<BlockingRead[]>(
    () => [
      { label: 'profile types', run: async () => setProfileTypes(await fetchProfileTypes()) },
      { label: 'tags', run: async () => setAllTags(await fetchAllTags()) },
      {
        label: 'environments',
        run: async () => {
          try {
            setEnvironments(await fetchProfileEnvironments())
            setEnvironmentsFailed(false)
          } catch (err) {
            // The failed flag, not emptiness, is what closes the save path.
            setEnvironments(NO_ENVIRONMENTS)
            setEnvironmentsFailed(true)
            throw err
          }
        },
      },
    ],
    []
  )

  const readAll = useCallback(async () => {
    startLoading()
    setError(null)
    setPrimary('pending')

    // Started before the primary read is awaited so every read stays concurrent.
    const reads = blocking.load(blockingReads)

    try {
      const profilesResult = await fetchProfiles({
        page: pageInfo.currentPage,
        per_page: pageInfo.pageSize,
        search: filters.search || undefined,
        type: filters.type || undefined,
        tags: filters.tags.length > 0 ? filters.tags : undefined,
        sort_by: sortColumn || undefined,
        sort_order: sortDirection || undefined,
      })
      setProfiles(profilesResult.data)
      setPageInfo((prev) => ({
        ...prev,
        totalItems: profilesResult.pagination.total,
        totalPages: profilesResult.pagination.total_pages,
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
  }, [pageInfo.currentPage, pageInfo.pageSize, filters, sortColumn, sortDirection, setPageInfo, startLoading, stopLoading, blocking, blockingReads])

  // Nothing that starts this read can await it, so the page's own error state
  // is where a failed profiles read is reported.
  const loadData = useCallback((): void => {
    readAll().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load profiles')
    })
  }, [readAll])

  useEffect(() => {
    loadData()
  }, [loadData])

  return {
    profiles,
    profileTypes,
    allTags,
    environments,
    environmentsFailed,
    loading,
    settled,
    error,
    setError,
    loadData,
  }
}
