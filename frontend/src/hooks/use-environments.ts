/**
 * useEnvironments Hook
 *
 * Fetches environments from the backend API for use across the application.
 * Environments are used for execution context selection in workbench, tests,
 * suites, regressions, and profile management.
 *
 * Uses the lightweight /environments/names endpoint which returns all environments
 * with minimal data (id, name, tags) - suitable for dropdown selection UI.
 *
 * A failed load blocks the surface that started it; it never empties the list,
 * so an empty list always means the backend answered with none.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchEnvironmentNames } from '@/features/settings/api/environments/crud'
import type { EnvironmentName } from '@/features/settings/api/environments/types'
import {
  useBlockingReads,
  type BlockingRead,
  type PrimaryState,
} from '@/hooks/use-blocking-reads'

export interface UseEnvironmentsReturn {
  environments: EnvironmentName[]
  loading: boolean
  /** True only after a read succeeded; only then is an empty list an answer. */
  loaded: boolean
  hasEnvironments: boolean
  refresh: () => Promise<void>
  /** Reads the list again and answers with it; a failed read rejects and blocks nothing. */
  readLatest: () => Promise<EnvironmentName[]>
}

const ENVIRONMENTS_LABEL = 'environments'

/** `primary` is the state of the surface's own records read; the default suits
 *  a surface that has no records read of its own. */
export function useEnvironments(primary: PrimaryState = 'loaded'): UseEnvironmentsReturn {
  const [environments, setEnvironments] = useState<EnvironmentName[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const blocking = useBlockingReads(primary)

  const readLatest = useCallback(async () => {
    const latest = await fetchEnvironmentNames()
    setEnvironments(latest)
    setLoaded(true)
    return latest
  }, [])

  const reads = useMemo<BlockingRead[]>(
    () => [
      {
        label: ENVIRONMENTS_LABEL,
        run: async () => {
          setLoading(true)
          try {
            await readLatest()
          } finally {
            setLoading(false)
          }
        },
      },
    ],
    [readLatest]
  )

  const refresh = useCallback(() => blocking.load(reads), [blocking, reads])

  useEffect(() => {
    blocking.start(reads)
  }, [blocking, reads])

  return {
    environments,
    loading,
    loaded,
    hasEnvironments: environments.length > 0,
    refresh,
    readLatest,
  }
}
