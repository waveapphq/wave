/**
 * HistoricalBlockStatesContext
 *
 * Lets the historical canvas subtree inject per-block final statuses
 * without touching the global execution store. Read sites
 * (`useBlockExecutionStatus`, `useCanvasEdges`) prefer the context value
 * when present and fall back to the singleton store otherwise, so live
 * Workbench behavior is byte-identical outside the provider.
 *
 * Status normalization: the backend returns lowercase tokens
 * (`passed`/`failed`/`stopped`/`skipped`/`running`), but the frontend
 * `ExecutionStatus` enum uses `success` for a pass. `normalizeBackendStatus`
 * is the single place that maps the two vocabularies so each consumer
 * does not reinvent the mapping.
 */

import { createContext, useContext, type ReactNode } from 'react'
import type { ExecutionStatus } from '@/features/workbench/stores/execution-store'

export type HistoricalBlockStates = Readonly<Record<string, ExecutionStatus>>

const HistoricalBlockStatesContext = createContext<HistoricalBlockStates | null>(null)

export function HistoricalBlockStatesProvider({
  blockStates,
  children,
}: Readonly<{
  blockStates: HistoricalBlockStates
  children: ReactNode
}>) {
  return (
    <HistoricalBlockStatesContext.Provider value={blockStates}>
      {children}
    </HistoricalBlockStatesContext.Provider>
  )
}

export function useHistoricalBlockStatuses(): HistoricalBlockStates | null {
  return useContext(HistoricalBlockStatesContext)
}

export function normalizeBackendStatus(raw: string | null | undefined): ExecutionStatus | undefined {
  if (!raw) return undefined
  const lower = raw.toLowerCase()
  if (lower === 'passed') return 'success'
  if (
    lower === 'failed' ||
    lower === 'stopped' ||
    lower === 'skipped' ||
    lower === 'running' ||
    lower === 'pending' ||
    lower === 'warning' ||
    lower === 'success'
  ) {
    return lower as ExecutionStatus
  }
  return undefined
}

export function buildHistoricalBlockStates(
  raw: Record<string, string>,
): HistoricalBlockStates {
  const out: Record<string, ExecutionStatus> = {}
  for (const [id, value] of Object.entries(raw)) {
    const normalized = normalizeBackendStatus(value)
    if (normalized) out[id] = normalized
  }
  return out
}
