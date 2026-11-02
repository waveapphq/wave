/**
 * HistoryWorkbench - container for `/executions/history/:runId`.
 *
 * Fetches the painted-snapshot payload for a completed test, seeds a
 * scoped `workflow-store` instance from it (no persistence; isolated
 * from the live workbench so opening history cannot disturb a live run
 * in another tab), and renders the shared `WorkbenchShell` with the
 * history-mode wrapper components.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { WorkflowCanvas } from '@/features/workbench/common/canvas/workflow-canvas'
import { CanvasLoadingOverlay } from '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
import { WorkbenchShell } from '@/features/workbench/common/shell'
import {
  WorkflowStoreProvider,
  createWorkflowStore,
  type EdgeType,
  type NodeType,
} from '@/features/workbench/stores/workflow-store'
import {
  HistoricalBlockStatesProvider,
  buildHistoricalBlockStates,
} from '@/features/workbench/common/canvas/historical-block-states-context'
import { HistoricalBreadcrumbProvider } from '@/features/workbench/hooks/use-breadcrumb-context'
import { getHistoricalTestRun } from '@/features/executions/api/executions'
import { canvasLocalFunctionBodies } from '@/features/workbench/lib/canonical-workflow'
import type { HistoricalTestCanvasResponse } from '@/features/executions/api/types'
import type { WorkflowStatus } from '@/features/workbench/common/canvas/canvas-action-bar/types'
import { HistoryActionBar } from './action-bar'
import { HistoryBreadcrumbBar } from './breadcrumb-bar'
import { HistoryPalette } from './palette'
import { HistoryConsole, buildLogEntries } from './console'
import {
  HistoryVariableManager,
  buildRuntimeValuesMap,
  buildVariablesFromDefinitions,
} from './variable-manager'

const TERMINAL_STATUSES: ReadonlySet<WorkflowStatus> = new Set([
  'passed',
  'failed',
  'stopped',
  'skipped',
])

function normalizeStatus(raw: string | null | undefined): WorkflowStatus {
  if (!raw) return 'idle'
  const lower = raw.toLowerCase() as WorkflowStatus
  return TERMINAL_STATUSES.has(lower) ||
    lower === 'running' ||
    lower === 'paused' ||
    lower === 'idle'
    ? lower
    : 'idle'
}

export function HistoryWorkbench(): ReactNode {
  const { runId = '' } = useParams()
  const [data, setData] = useState<HistoricalTestCanvasResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    setData(null)
    setError(null)
    getHistoricalTestRun(runId)
      .then((resp) => {
        if (!canceled) setData(resp)
      })
      .catch((err: unknown) => {
        if (canceled) return
        setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      canceled = true
    }
  }, [runId])

  if (error) {
    return (
      <div
        data-testid="execution-test-canvas-error"
        className="flex h-full items-center justify-center p-6 text-sm text-destructive"
      >
        {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div
        data-testid="execution-test-canvas-loading"
        className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
      >
        Loading test canvas…
      </div>
    )
  }

  return (
    <HistoryCanvasContent
      data={data}
      status={normalizeStatus(data.status)}
    />
  )
}

// Back-compat alias for the existing router + test imports.
export { HistoryWorkbench as ExecutionTestCanvasPage }

function HistoryCanvasContent({
  data,
  status,
}: Readonly<{
  data: HistoricalTestCanvasResponse
  status: WorkflowStatus
}>) {
  const navigate = useNavigate()
  const store = useMemo(() => {
    const nodes = canvasLocalFunctionBodies(data.workflow?.nodes ?? []) as unknown as NodeType[]
    const edges = (data.workflow?.edges ?? []) as unknown as EdgeType[]
    const s = createWorkflowStore({
      initialSnapshot: { nodes, edges },
      persistKey: null,
    })
    // Match the live Workbench's load-test behavior: keep the canvas
    // hidden behind the loading overlay, request a fit-view pass, and
    // let `useCanvasFitView` flip `isCanvasReady` to true only AFTER
    // React Flow has fit the snapshot. That way the user never sees
    // an unfitted frame.
    s.getState().requestFitView({ padding: 0.2, duration: 0 })
    return s
  }, [data])

  const isCanvasReady = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState().isCanvasReady,
  )

  const blockStates = useMemo(
    () => buildHistoricalBlockStates(data.block_states ?? {}),
    [data.block_states],
  )

  const variables = useMemo(
    () => buildVariablesFromDefinitions(data.variable_definitions ?? {}, data.variables ?? {}),
    [data.variable_definitions, data.variables],
  )

  const runtimeValues = useMemo(
    () => buildRuntimeValuesMap(data.variables ?? {}),
    [data.variables],
  )

  const logEntries = useMemo(
    () => buildLogEntries(data.logs ?? []),
    [data.logs],
  )

  return (
    <WorkflowStoreProvider store={store}>
      <HistoricalBlockStatesProvider blockStates={blockStates}>
        <HistoricalBreadcrumbProvider
          /* v8 ignore next 2 - COV-V8-003: nullish fallbacks on backend response shape; integration tests cover both populated and missing-id cases */
          executionId={data.execution_id ?? null}
          runId={data.run_id ?? null}
          testName={null}
        >
        <div data-testid="canvas-page" className="flex h-full flex-col">
          <WorkbenchShell
            mode="history"
            actionBar={
              <HistoryActionBar
                environmentName={data.environment_name}
                onOpenReport={() => { navigate(`/reports/${data.execution_id}`) }}
              />
            }
            breadcrumbBar={<HistoryBreadcrumbBar status={status} />}
            palette={<HistoryPalette />}
            canvas={
              <>
                <WorkflowCanvas executionStatus={status} readOnly />
                <CanvasLoadingOverlay isReady={isCanvasReady} message="Loading test canvas…" />
              </>
            }
            renderConsole={(slot) => <HistoryConsole entries={logEntries} {...slot} />}
            renderVariableManager={(slot) => (
              <HistoryVariableManager
                variables={variables}
                runtimeValues={runtimeValues}
                {...slot}
              />
            )}
          />
        </div>
        </HistoricalBreadcrumbProvider>
      </HistoricalBlockStatesProvider>
    </WorkflowStoreProvider>
  )
}
