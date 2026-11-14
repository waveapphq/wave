/**
 * HistoricalBlockStatesContext
 *
 * Lets the historical canvas subtree inject per-block final statuses, and
 * the lanes each block took, without touching the global execution store. Read sites
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

import { createContext, use, type ReactNode } from 'react'
import type { ExecutionStatus } from '@/features/workbench/stores/execution-store'

export type HistoricalBlockStates = Readonly<Record<string, ExecutionStatus>>

/** The lanes each Block of the run took, by Block. */
export type HistoricalLanes = Readonly<Record<string, readonly string[]>>

const EMPTY_LANES: HistoricalLanes = {}

const HistoricalBlockStatesContext = createContext<HistoricalBlockStates | null>(null)
const HistoricalLanesContext = createContext<HistoricalLanes>(EMPTY_LANES)

export function HistoricalBlockStatesProvider({
  blockStates,
  lanes,
  children,
}: Readonly<{
  blockStates: HistoricalBlockStates
  lanes?: HistoricalLanes | null
  children: ReactNode
}>) {
  return (
    <HistoricalBlockStatesContext.Provider value={blockStates}>
      <HistoricalLanesContext.Provider value={lanes ?? EMPTY_LANES}>
        {children}
      </HistoricalLanesContext.Provider>
    </HistoricalBlockStatesContext.Provider>
  )
}

export function useHistoricalBlockStatuses(): HistoricalBlockStates | null {
  return use(HistoricalBlockStatesContext)
}

export function useHistoricalLanes(): HistoricalLanes {
  return use(HistoricalLanesContext)
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
