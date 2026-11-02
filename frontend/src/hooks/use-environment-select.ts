/**
 * Shared environment selection + recent-environments tracking.
 * Used by useSuiteRunDialog and useRegressionRunDialog to avoid
 * duplicating the same selectEnvironment + recentEnvironments logic.
 *
 * The list comes from the surface, which owns the one environments read and
 * the gating that goes with it.
 */

import { useCallback, useState } from 'react'

export interface EnvironmentSelectState {
  environments: Array<{ id: string; name: string }>
  recentEnvironments: Array<{ id: string; name: string }>
  selectedEnvironmentId: string | null
  selectEnvironment: (envId: string | null) => void
}

export function useEnvironmentSelect(
  environments: Array<{ id: string; name: string }>,
): EnvironmentSelectState {
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null)
  const [recentEnvironments, setRecentEnvironments] = useState<Array<{ id: string; name: string }>>([])

  const selectEnvironment = useCallback((envId: string | null) => {
    setSelectedEnvironmentId(envId)
    if (envId) {
      const env = environments.find((e) => e.id === envId)
      if (env) {
        setRecentEnvironments((prev) => {
          const filtered = prev.filter((e) => e.id !== envId)
          return [{ id: env.id, name: env.name }, ...filtered].slice(0, 3)
        })
      }
    }
  }, [environments])

  return { environments, recentEnvironments, selectedEnvironmentId, selectEnvironment }
}
