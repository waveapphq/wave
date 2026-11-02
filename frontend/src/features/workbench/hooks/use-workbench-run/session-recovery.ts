/**
 * Session Recovery
 *
 * Recovers a workbench run session on mount. Hydrates state from a
 * previously running session and re-subscribes to WebSocket events.
 */

import type React from 'react'
import { useEffect, type RefObject } from 'react'
import { workbenchApi } from '@/features/workbench/api/workbench'
import type { Subscription } from '@/services/websocket-client'
import type { BlockExecution, ExecutionStatus } from '@/features/workbench/stores/execution-store'
import { useHistoricalBreadcrumb } from '@/features/workbench/hooks/use-breadcrumb-context/history-override'
import { usePageBlock } from '@/hooks/use-page-block'
import { startBlockingRead } from '@/hooks/use-blocking-reads'
import type { WorkbenchStatus, CurrentBlock, Progress } from './types'

const SESSION_LABEL = 'workbench session'

// ===========================================================================
// Types for the recovery function's dependencies
// ===========================================================================

export type SessionOutcome = 'success' | 'failed' | 'stopped' | 'skipped'

export interface SessionRecoveryDeps {
  /**
   * Skip the recovery fetch (and immediately mark recovery complete).
   * Used when a parent `WorkbenchRunSharedContext.Provider` already owns the
   * session, so the duplicate hook instance shouldn't fire its own fetch.
   */
  skipFetch?: boolean
  setSessionId: React.Dispatch<React.SetStateAction<string | null>>
  setTestId: React.Dispatch<React.SetStateAction<string | null>>
  setWebsocketTopic: React.Dispatch<React.SetStateAction<string | null>>
  setStatus: (next: WorkbenchStatus) => void
  setCurrentBlock: React.Dispatch<React.SetStateAction<CurrentBlock | null>>
  setProgress: React.Dispatch<React.SetStateAction<Progress | null>>
  setIsSessionRecoveryComplete: React.Dispatch<React.SetStateAction<boolean>>
  setExecutionId: React.Dispatch<React.SetStateAction<string | null>>
  setParentExecutionId: React.Dispatch<React.SetStateAction<string | null>>
  setSessionTestName: React.Dispatch<React.SetStateAction<string | null>>

  subscriptionRef: RefObject<Subscription | null>
  variableSubscriptionRef: RefObject<Subscription | null>
  executionIdRef: RefObject<string | null>
  executionIdTrackedRef: RefObject<string | null>
  parentExecutionIdRef: RefObject<string | null>
  /**
   * Ref to the Live Workbench's tracked-terminal handler. Fast-completing
   * test runs can reach a terminal state BEFORE the viewer subscribes,
   * so the ``execution_completed`` WebSocket event never arrives at this
   * page. Firing the same handler from session recovery covers that
   * timing hole with one code path for both fast and slow test runs.
   */
  trackedTerminalHandlerRef?: RefObject<((executionId: string) => void) | null>

  startStoreExecution: (testId: string) => string
  updateBlockExecution: (executionId: string, blockId: string, updates: Partial<BlockExecution>) => void
  completeStoreExecution: (executionId: string, status: SessionOutcome, result?: unknown) => void

  isConnected: boolean
  connect: () => Promise<void>
  subscribe: (topic: string, handler: (payload: unknown) => void) => Subscription
  handleWebSocketEvent: (payload: unknown) => void
  handleVariableEvent: (payload: unknown) => void
}

// ===========================================================================
// Status Mapping Helpers
// ===========================================================================

const BLOCK_STATUS_MAP: Record<string, string> = {
  passed: 'success',
  warning: 'warning',
  failed: 'failed',
  stopped: 'stopped',
  running: 'running',
  skipped: 'skipped',
}

function mapBlockStatus(backendStatus: string): ExecutionStatus {
  return (BLOCK_STATUS_MAP[backendStatus] ?? 'pending') as ExecutionStatus
}

const TERMINAL_STATUSES = new Set(['passed', 'failed', 'stopped', 'skipped'])

const SESSION_STATUS_MAP: Record<string, SessionOutcome> = {
  passed: 'success',
  skipped: 'skipped',
  failed: 'failed',
}

function mapSessionStatus(status: string): SessionOutcome {
  return SESSION_STATUS_MAP[status] ?? 'stopped'
}

// ===========================================================================
// Recovery Sub-steps
// ===========================================================================

function hydrateSessionState(
  deps: SessionRecoveryDeps,
  session: {
    session_id: string
    test_id: string
    websocket_topic: string
    status: string
    current_block?: { block_id: string; block_name: string } | null
    progress?: { current: number; total: number; percentage: number } | null
    execution_id?: string | null
    parent_execution_id?: string | null
    test_name?: string | null
  },
): void {
  deps.setSessionId(session.session_id)
  deps.setTestId(session.test_id)
  deps.setWebsocketTopic(session.websocket_topic)
  deps.setStatus(session.status as WorkbenchStatus)

  // Recovered tracked execution carries execution_id.
  const execId = session.execution_id ?? null
  deps.setExecutionId(execId)
  deps.executionIdTrackedRef.current = execId
  // parent_execution_id is set on sequential suite/regression children so
  // the viewer can follow the parent's progression between child tests.
  const parentId = session.parent_execution_id ?? null
  deps.parentExecutionIdRef.current = parentId
  deps.setParentExecutionId(parentId)
  deps.setSessionTestName(session.test_name ?? null)

  if (session.current_block) {
    deps.setCurrentBlock({
      blockId: session.current_block.block_id,
      blockName: session.current_block.block_name,
    })
  }

  if (session.progress) {
    deps.setProgress({
      current: session.progress.current,
      total: session.progress.total,
      percentage: session.progress.percentage,
    })
  }
}

function restoreBlockStates(
  deps: SessionRecoveryDeps,
  execId: string,
  blockStates: Record<string, string>,
): void {
  for (const [blockId, blockStatus] of Object.entries(blockStates)) {
    deps.updateBlockExecution(execId, blockId, { status: mapBlockStatus(blockStatus) })
  }
}

async function subscribeToRunningSession(
  deps: SessionRecoveryDeps,
  session: { websocket_topic: string; session_id: string },
): Promise<void> {
  if (!deps.isConnected) {
    await deps.connect()
  }
  deps.subscriptionRef.current = deps.subscribe(
    session.websocket_topic,
    deps.handleWebSocketEvent
  )
  deps.variableSubscriptionRef.current = deps.subscribe(
    `variable:${session.session_id}`,
    deps.handleVariableEvent,
  )
}

// ===========================================================================
// Hook
// ===========================================================================

/**
 * Hydrates a workbench session (either on mount or after a sequential
 * child-test transition). Returns true if the session was hydrated,
 * false when there's nothing to restore.
 */
export async function hydrateWorkbenchSession(
  deps: SessionRecoveryDeps,
  session: Awaited<ReturnType<typeof workbenchApi.getCurrentSession>>,
): Promise<boolean> {
  if (!session) return false

  hydrateSessionState(deps, session)

  const execId = deps.startStoreExecution(session.test_id)
  deps.executionIdRef.current = execId

  if (session.block_states) {
    restoreBlockStates(deps, execId, session.block_states)
  }

  if (TERMINAL_STATUSES.has(session.status)) {
    deps.completeStoreExecution(execId, mapSessionStatus(session.status))
    // Fast-completing tracked test runs: the test finished BEFORE this
    // viewer mounted, so the ``execution_completed`` WS event that
    // normally drives the redirect never fires here. Fall back to the
    // same terminal handler the event path uses. Sequential
    // suite/regression children (``parent_execution_id`` set) follow
    // their own follow-next-child flow and must not take this branch.
    const trackedId = session.execution_id
    if (trackedId && !session.parent_execution_id) {
      deps.trackedTerminalHandlerRef?.current?.(trackedId)
    }
  } else {
    await subscribeToRunningSession(deps, session)
  }
  return true
}

/**
 * Runs session recovery once on mount. Hydrates hook state from a
 * previously active backend session and re-subscribes to WebSocket events.
 *
 * Skips entirely when the parent tree provides a `HistoricalBreadcrumbProvider`
 * (history workbench): there is no live session to recover for a historical
 * canvas, and the fetch would be wasted + would surface as an unmocked-fetch
 * warning in unit tests for the history page.
 *
 * A failed read blocks the canvas: leaving is one click away in the sidebar, and
 * a session silently reported as absent can offer to discard a live run.
 */
export function useSessionRecovery(deps: SessionRecoveryDeps): void {
  const historyMode = useHistoricalBreadcrumb()
  const { blockPage, clearPageBlock } = usePageBlock()
  const skipRecovery = historyMode !== null || deps.skipFetch === true
  useEffect(() => {
    if (skipRecovery) {
      deps.setIsSessionRecoveryComplete(true)
      return
    }
    // StrictMode mounts the component twice in dev (mount → unmount →
    // remount). Without this `canceled` flag both async chains resolve
    // and each calls `hydrateWorkbenchSession`, creating two executions
    // in the store and two WS subscriptions. The canvas reads the
    // second execution's blocks but events emitted before the second
    // subscribe only reached the first execution, so the canvas looks
    // stuck. Short-circuiting the unmounted chain keeps hydration to
    // exactly one mount.
    let canceled = false
    const recoverSession = async () => {
      try {
        const session = await workbenchApi.getCurrentSession()
        if (canceled) return
        await hydrateWorkbenchSession(deps, session)
        clearPageBlock(SESSION_LABEL)
      } finally {
        if (!canceled) deps.setIsSessionRecoveryComplete(true)
      }
    }

    startBlockingRead(
      { label: SESSION_LABEL, canceled: () => canceled, run: recoverSession },
      blockPage,
    )
    return () => {
      canceled = true
    }
  }, [skipRecovery]) // Run once unless history-mode flag toggles
}
