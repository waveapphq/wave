/**
 * Historical breadcrumb override.
 *
 * The history workbench reads its execution info from
 * `getHistoricalTestRun`, not from `useWorkbenchRun` (which is the live
 * session). This context lets the history container hand the execution
 * info to `useBreadcrumbContext` so the back arrow + segments render
 * against the historical run instead of the empty live state.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'

export interface HistoricalBreadcrumbInfo {
  executionId: string | null
  runId: string | null
  testName: string | null
}

const HistoricalBreadcrumbContext = createContext<HistoricalBreadcrumbInfo | null>(null)

export function HistoricalBreadcrumbProvider({
  children,
  executionId,
  runId,
  testName,
}: Readonly<{
  children: ReactNode
  executionId: string | null
  runId: string | null
  testName: string | null
}>) {
  const value = useMemo(
    () => ({ executionId, runId, testName }),
    [executionId, runId, testName],
  )
  return (
    <HistoricalBreadcrumbContext.Provider value={value}>
      {children}
    </HistoricalBreadcrumbContext.Provider>
  )
}

export function useHistoricalBreadcrumb(): HistoricalBreadcrumbInfo | null {
  return useContext(HistoricalBreadcrumbContext)
}
