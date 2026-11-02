/**
 * ExecutionDetailPage
 *
 * Shared orchestrator for the Execution Detail view. Used by Test, Suite,
 * and Regression executions (single shared layout).
 *
 * Responsibilities:
 *   - Fetches the execution on mount (loading / error / not-found states).
 *   - Renders the breadcrumb header, EXECUTION INFO panel, the Components
 *     table (per-type content), and the Console slot.
 *   - Subscribes to the SSE event stream only while the execution is
 *     running; on terminal status the stream is not opened.
 *   - Swaps the toolbar action set (Running vs Terminal) on status change.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { type PanelImperativeHandle } from 'react-resizable-panels'
import { DetailHeader } from '@/components/shared/detail-header'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { fetchExecution } from '@/features/executions/api/executions'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { useExportImport } from '@/features/executions/container/use-export-import'
import { ExecutionConsole } from './execution-console'
import { ExecutionInfoPanel } from './execution-info-panel'
import { ExecutionComponentsTable } from './execution-components-table'
import type { ExecutionTestRow, ExecutionSuiteRow } from './_shared'
import { ExecutionToolbar } from './execution-toolbar'

interface ExecutionDetailData {
  id: string
  name: string
  entity_type: string
  entity_id: string
  environment_id: string
  environment?: { id: string; name: string } | null
  status: string
  counts?: {
    total: number
    passed: number
    failed: number
    pending: number
    skipped: number
    excluded: number
    stopped?: number
  }
  started_at: string
  completed_at: string | null
  duration: number | null
  triggered_by: string
  tags?: string[]
  description?: string | null
  tests?: ExecutionTestRow[]
  suites?: ExecutionSuiteRow[]
  duplicate_tests?: Record<string, string[]>
  selected_tests?: string[] | Array<{ suite_id: string; test_id: string }>
}

// 'skipped' is terminal: a regression-scope or single-suite halt emits it
// as the parent's final status. Leaving it out kept the UI polling and
// rendering the Running toolbar even though the backend had stopped.
const TERMINAL_STATUSES = new Set(['passed', 'failed', 'stopped', 'skipped'])

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

const LIVE_POLL_MS = 1500

export function ExecutionDetailPage() {
  const navigate = useNavigate()
  const { executionId = '' } = useParams()
  const [execution, setExecution] = useState<ExecutionDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  // Export dialog state + download orchestration (single execution)
  const {
    exportDialogOpen,
    setExportDialogOpen,
    exportIds,
    exportNames,
    exportLoading,
    handleExport,
    handleExportAction,
  } = useExportImport()

  // Console panel state - mirrors the Workbench pattern in use-panel-state.ts
  // so the console collapses DOWN (ResizablePanel shrinks to its collapsed
  // size and the header sits flush with the bottom of the container).
  const consolePanelRef = useRef<PanelImperativeHandle>(null)
  const [consoleCollapsed, setConsoleCollapsed] = useState(false)
  const handleConsoleCollapsedChange = useCallback((collapsed: boolean) => {
    setConsoleCollapsed(collapsed)
    if (collapsed) {
      consolePanelRef.current!.collapse()
    } else {
      consolePanelRef.current!.resize(200)
    }
  }, [])

  useEffect(() => {
    let canceled = false
    setLoading(true)
    setError(null)
    setNotFound(false)
    fetchExecution(executionId)
      .then((response) => {
        if (canceled) return
        if (!response.success || !response.data) {
          setNotFound(true)
          setExecution(null)
        } else {
          const data = response.data as ExecutionDetailData
          // Test-type executions are a single workflow; the list routes
          // them straight to the Historical Canvas. This guards direct URL
          // access so someone pasting `/executions/:id` for a test run
          // still lands on the Canvas instead of an empty Components table.
          if (data.entity_type === 'test') {
            navigate(`/executions/history/${executionId}`, { replace: true })
            return
          }
          setExecution(data)
        }
      })
      .catch((err) => {
        if (canceled) return
        setError(err instanceof Error ? err : new Error(String(err)))
      })
      .finally(() => {
        if (!canceled) setLoading(false)
      })
    return () => {
      canceled = true
    }
  }, [executionId, navigate])

  // Poll while the execution is still running so the toolbar, EXECUTION INFO
  // counts, and Components table reflect backend state without requiring a
  // manual refresh. Stops polling once the execution reaches a terminal
  // status.
  const running = execution ? !isTerminal(execution.status) : false
  useEffect(() => {
    if (!executionId || !running) return
    let canceled = false
    const refresh = async (): Promise<void> => {
      const response = await fetchExecution(executionId)
      if (canceled) return
      if (response.success && response.data) {
        setExecution(response.data as ExecutionDetailData)
      }
      setRefreshError(null)
    }
    const interval = globalThis.setInterval(() => {
      refresh().catch((err: unknown) => {
        if (canceled) return
        // The last known execution stays on screen, with the failure named beside it.
        setRefreshError(err instanceof Error ? err.message : 'Could not refresh the execution')
      })
    }, LIVE_POLL_MS)
    return () => {
      canceled = true
      globalThis.clearInterval(interval)
    }
  }, [executionId, running])

  if (loading) {
    return (
      <div
        data-testid="execution-detail-page"
        className="flex h-full items-center justify-center"
      >
        <span data-testid="execution-detail-loading" className="text-sm text-muted-foreground">
          Loading execution…
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div data-testid="execution-detail-error" className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-lg font-medium">Unable to load execution</p>
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </div>
    )
  }

  if (notFound || !execution) {
    return (
      <div data-testid="execution-detail-not-found" className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-lg font-medium">Execution not found</p>
        <p className="text-sm text-muted-foreground">
          The execution you are looking for does not exist or was deleted.
        </p>
      </div>
    )
  }

  return (
    <div data-testid="execution-detail-page" className="flex h-full flex-col">
      <DetailHeader
        name={execution.name}
        entityType="execution"
        onBack={() => { navigate('/executions') }}
        actions={
          <ExecutionToolbar
            execution={execution}
            onDeleted={() => { navigate('/executions') }}
            onExport={() => handleExport(execution.id, execution.name)}
          />
        }
      />

      {refreshError && (
        <p
          data-testid="execution-detail-refresh-error"
          role="alert"
          className="shrink-0 border-b px-6 py-2 text-sm text-error"
        >
          {refreshError} (showing the last known state)
        </p>
      )}

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        entityIds={exportIds}
        entityNames={exportNames}
        entityLabel="execution"
        hasSecrets={false}
        defaultFormat="json"
        loading={exportLoading}
        onExport={handleExportAction}
      />

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden border-r bg-muted/30">
          <ExecutionInfoPanel execution={execution} />
        </aside>

        <div className="flex flex-1 flex-col overflow-hidden">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel minSize="30%" defaultSize="70%">
              <div className="flex h-full flex-col overflow-hidden p-6">
                <div className="flex-1 min-h-0 overflow-hidden">
                  <ExecutionComponentsTable
                    executionId={execution.id}
                    entityType={execution.entity_type}
                    tests={execution.tests}
                    suites={execution.suites}
                    duplicateTests={execution.duplicate_tests}
                  />
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle
              orientation="vertical"
              id="execution-console-resize-handle"
              style={consoleCollapsed ? { display: 'none' } : undefined}
            />
            <ResizablePanel
              panelRef={consolePanelRef}
              collapsible
              collapsedSize={48}
              defaultSize="30%"
              minSize={100}
              maxSize="60%"
              onResize={(panelSize, _id, prevPanelSize) => {
                if (prevPanelSize === undefined) return
                setConsoleCollapsed(panelSize.inPixels <= 48)
              }}
            >
              <ExecutionConsole
                executionId={execution.id}
                testId="execution-console"
                collapsed={consoleCollapsed}
                onCollapsedChange={handleConsoleCollapsedChange}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </div>
  )
}

export default ExecutionDetailPage
