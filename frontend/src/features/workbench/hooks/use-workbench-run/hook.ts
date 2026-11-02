/**
 * useWorkbenchRun Hook - V-CANVAS-14 / REQ-3.2.1.1
 *
 * Hook for managing ephemeral Workbench test execution.
 *
 * Key WAVE-specific behaviors:
 * - Ephemeral runs use session_id (NOT execution_id)
 * - WebSocket topic format: workbench:{session_id}
 * - Pre-flight profile validation with warnings (doesn't block execution)
 * - Toast notifications for user feedback
 * - State transitions: idle → running → paused/passed/failed/stopped
 */

import { useState, useCallback, useContext, useEffect, useRef, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { workbenchApi, type WorkbenchRunResponse } from '@/features/workbench/api/workbench'
import { randomUUID } from '@/lib/uuid'
import { runFunctionStandalone } from '@/features/functions/api/functions-api'
import { apiClient } from '@/lib/api'
import { useWebSocketStore } from '@/features/workbench/stores/websocket-store'
import { useExecutionStore } from '@/features/workbench/stores/execution-store'
import { useLogStore } from '@/features/workbench/stores/log-store'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useToast } from '@/components/ui/toast'
import type { Subscription } from '@/services/websocket-client/types'
import type {
  WorkbenchStatus,
  CurrentBlock,
  Progress,
  Warning,
  StartRunParams,
  StartDebugRunParams,
  StandaloneRunParams,
  UseWorkbenchRunReturn,
  WorkbenchEvent,
} from './types'
import { transformWarning, isRunningStatus } from './types'
import { hydrateWorkbenchSession, useSessionRecovery } from './session-recovery'
import { WorkbenchRunSharedContext } from './shared-context'
import { usePageBlock } from '@/hooks/use-page-block'
import { runBlockingRead } from '@/hooks/use-blocking-reads'
import { clearWorkbenchSession } from '@/features/workbench/lib/clear-session'
import { alreadyReported } from '@/features/workbench/lib/already-reported'

const ANNOUNCED_RUN_LABEL = 'announced run'

// Internal helper: keeps a status value and a ref mirror in lockstep so
// synchronous guards (skippedNodeIds subscriber, terminal handler) can
// observe the new status before React commits the state update. Also mirrors
// the status into the workflow store so the undo/redo gate sees it.
function useStatusWithRef(
  initial: WorkbenchStatus,
): [WorkbenchStatus, (next: WorkbenchStatus) => void, RefObject<WorkbenchStatus>] {
  const [status, setStatus] = useState<WorkbenchStatus>(initial)
  const statusRef = useRef<WorkbenchStatus>(initial)
  const commitStatus = useCallback((next: WorkbenchStatus) => {
    statusRef.current = next
    setStatus(next)
    useWorkflowStore.getState().setExecutionStatus(next)
  }, [])
  return [status, commitStatus, statusRef]
}

export function useWorkbenchRun(): UseWorkbenchRunReturn {
  // When a parent has already provided a shared instance, every hook
  // declared below still runs (rules of hooks), but the side effects
  // (session recovery + WS subscriptions) skip work and we return the
  // shared value instead of the local state. This keeps the live
  // workbench to a single set of effects across the container + the
  // breadcrumb subtree.
  const shared = useContext(WorkbenchRunSharedContext)
  const skipEffects = shared !== null
  // Wrapper `setStatus` mirrors updates into `statusRef` synchronously.
  // Guards that fire inside synchronous code paths - e.g. the
  // skippedNodeIds subscriber triggered by `workflowStore.reset()` in
  // the terminal handler - must see the terminal status before React
  // commits its state update, otherwise they POST to a finished (or
  // already-cleared) backend session.
  const [status, setStatus, statusRef] = useStatusWithRef('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [testId, setTestId] = useState<string | null>(null)
  const [websocketTopic, setWebsocketTopic] = useState<string | null>(null)
  const [currentBlock, setCurrentBlock] = useState<CurrentBlock | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [error, setError] = useState<Error | null>(null)
  // Track when session recovery has completed (whether session found or not)
  const [isSessionRecoveryComplete, setIsSessionRecoveryComplete] = useState(false)
  // Set execution_id when this session represents a tracked execution.
  const [executionId, setExecutionId] = useState<string | null>(null)
  // Parent execution id when this session is a sequential suite/regression child.
  const [parentExecutionId, setParentExecutionId] = useState<string | null>(null)
  const [sessionTestName, setSessionTestName] = useState<string | null>(null)

  // Refs
  const subscriptionRef = useRef<Subscription | null>(null)
  const variableSubscriptionRef = useRef<Subscription | null>(null)
  // Callback ref for forwarding variable events to useVariableUpdates
  const variableHandlerRef = useRef<((payload: unknown) => void) | null>(null)
  // Track current block ID for use in event handlers (avoids stale closure)
  const currentBlockIdRef = useRef<string | null>(null)
  // Handler invoked on terminal events for tracked sessions.
  const trackedTerminalHandlerRef = useRef<((executionId: string) => void) | null>(null)
  // Track tracked-session executionId in a ref for use in event handlers.
  const executionIdTrackedRef = useRef<string | null>(null)
  // Track the parent execution id for sequential suite/regression children.
  // Set from session.parent_execution_id during recovery or when a new
  // child session is picked up mid-run. Drives the "follow next child"
  // path instead of the "redirect to detail view" path on terminal.
  const parentExecutionIdRef = useRef<string | null>(null)
  // Track the current session id in a ref so event handlers + polling can
  // read the latest value without the state closure going stale.
  const sessionIdRef = useRef<string | null>(null)
  // True while we are polling for the next sequential child session.
  // Canvas consumers read this to render a subtle "Loading next test…"
  // overlay instead of flashing an empty canvas.
  const [isTransitioningToNextChild, setIsTransitioningToNextChild] = useState(false)
  // PYRUN-21: a repeat started from the block editor is still in flight.
  const [runBusy, setRunBusy] = useState(false)
  // Resolvers waiting for the next pause or terminal event of this session.
  const draftWaitersRef = useRef<(() => void)[]>([])
  // Callback ref: invoked when a sequential child terminates and we need to
  // poll the backend for the next child session. Defined later in the hook
  // and read through a ref so the WebSocket handler doesn't close over stale
  // dependencies.
  const followNextSequentialChildRef = useRef<
    ((parentId: string, previousSessionId: string | null) => Promise<void>) | null
  >(null)
  // True while the active session is an ad-hoc run (Run/Debug Current,
  // Run/Debug from Here). Drives the per-block completion toast that
  // distinguishes ad-hoc runs from full-test runs.
  const adhocRunRef = useRef(false)
  // Most recent block_status_changed name; used as the human-readable
  // anchor for the ad-hoc completion toast since the terminal event
  // carries no block reference of its own.
  const lastTargetedBlockNameRef = useRef<string | null>(null)

  // External hooks
  // subscribeAsync: for new runs, waits for server confirmation before proceeding
  // subscribe: for session recovery, reconnecting to already-running sessions
  const { subscribe, subscribeAsync, connect, isConnected } = useWebSocketStore()
  const toast = useToast()
  const { blockPage, clearPageBlock } = usePageBlock()

  // Execution store - V-CANVAS-04: Update block states for visual feedback on canvas
  const startStoreExecution = useExecutionStore((state) => state.startExecution)
  const updateBlockExecution = useExecutionStore((state) => state.updateBlockExecution)
  const completeStoreExecution = useExecutionStore((state) => state.completeExecution)
  const clearExecution = useExecutionStore((state) => state.clearExecution)
  const stopRunningBlocks = useExecutionStore((state) => state.stopRunningBlocks)
  const executionIdRef = useRef<string | null>(null)

  // Derived state
  const isRunning = isRunningStatus(status)

  // Keep sessionIdRef in sync so event handlers always see the latest id.
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  // ===========================================================================
  // WebSocket Event Handler
  // ===========================================================================

  // Emit the per-block completion toast for an ad-hoc run (Run/Debug Current
  // or Run/Debug from Here). No-op when the active session is a full run.
  const emitAdHocCompletionToast = useCallback(
    (status: 'passed' | 'failed' | 'stopped' | 'skipped', error: string | undefined) => {
      if (!adhocRunRef.current) return
      const blockName = lastTargetedBlockNameRef.current ?? 'Block'
      if (status === 'passed') {
        toast.success(`Block '${blockName}' ran successfully`)
      } else if (status === 'failed') {
        const detail = error ? `: ${error}` : ''
        toast.error(`Block '${blockName}' failed${detail}`)
      }
      adhocRunRef.current = false
      lastTargetedBlockNameRef.current = null
    },
    [toast],
  )

  // Release every pending block-editor Run wait; each caller re-checks the
  // state it was waiting for.
  const resolveDraftWaiters = useCallback(() => {
    const pending = draftWaitersRef.current
    draftWaitersRef.current = []
    for (const resolve of pending) resolve()
  }, [])

  const handleWebSocketEvent = useCallback((payload: unknown) => {
    const event = payload as WorkbenchEvent

    switch (event.type) {
      case 'block_status_changed':
        setCurrentBlock({
          blockId: event.block_id,
          blockName: event.block_name,
        })
        // Track current block ID for use when execution is stopped
        currentBlockIdRef.current = event.block_id
        lastTargetedBlockNameRef.current = event.block_name
        if (event.progress) {
          setProgress({
            current: event.progress.current,
            total: event.progress.total,
            percentage: event.progress.percentage,
          })
        }

        // V-CANVAS-04: Update execution store for canvas visual feedback
        if (executionIdRef.current) {
          // Map workbench status to execution store status
          const blockStatusMap: Record<string, string> = { passed: 'success', warning: 'warning', running: 'running' }
          const storeStatus = (blockStatusMap[event.status] ?? event.status) as 'pending' | 'running' | 'success' | 'failed' | 'warning' | 'skipped' | 'stopped'
          updateBlockExecution(executionIdRef.current, event.block_id, {
            status: storeStatus,
          })
        }
        break

      case 'execution_completed': {
        setStatus(event.status)
        resolveDraftWaiters()
        // Clear the paused-node marker on any terminal transition so the
        // amber halo doesn't stick around after Stop / passed / failed.
        useWorkflowStore.getState().setPausedNodeId(null)

        // Capture the ad-hoc flag BEFORE the toast helper resets it - we
        // need it to decide whether to roll the parent execution's terminal
        // state forward. Ad-hoc runs only re-execute a subset of the test;
        // the full-test pass/fail recorded by the previous run still stands.
        const wasAdHoc = adhocRunRef.current
        emitAdHocCompletionToast(event.status, event.error)

        // V-CANVAS-04: Complete execution in store
        if (executionIdRef.current && !wasAdHoc) {
          // When stopped, mark the current running/paused block as stopped.
          // Prefer the workflow store's pausedNodeId when the session ended
          // from a paused state - currentBlockIdRef is now also aligned with
          // it (see debug_breakpoint_hit handler above).
          const pausedId = useWorkflowStore.getState().pausedNodeId
          const stoppedBlockId = pausedId ?? currentBlockIdRef.current
          if (event.status === 'stopped' && stoppedBlockId) {
            updateBlockExecution(executionIdRef.current, stoppedBlockId, {
              status: 'stopped',
            })
          }
          const completionStatusMap: Record<string, string> = { passed: 'success', skipped: 'skipped' }
          const storeStatus = (completionStatusMap[event.status] ?? event.status) as 'success' | 'failed' | 'stopped' | 'skipped'
          completeStoreExecution(executionIdRef.current, storeStatus)
        }

        // Three terminal paths:
        // 1. Sequential suite/regression child - parent still running.
        //    Follow to the next child (swap canvas) instead of redirecting.
        // 2. Test-type tracked execution - redirect to detail view.
        // 3. Ephemeral workbench run - keep canvas, user resets manually.
        if (parentExecutionIdRef.current) {
          const parentId = parentExecutionIdRef.current
          const previousSessionId = sessionIdRef.current
          followNextSequentialChildRef.current?.(parentId, previousSessionId)?.catch(() => undefined)
        } else if (executionIdTrackedRef.current) {
          const trackedId = executionIdTrackedRef.current
          trackedTerminalHandlerRef.current?.(trackedId)
          executionIdTrackedRef.current = null
          setExecutionId(null)
          setParentExecutionId(null)
          setStatus('idle')
          setSessionId(null)
          setTestId(null)
          setWebsocketTopic(null)
          setCurrentBlock(null)
          setProgress(null)
          setWarnings([])
        }
        break
      }

      case 'execution_paused':
        setStatus('paused')
        setCurrentBlock({
          blockId: event.block_id,
          blockName: event.block_name,
        })
        break

      case 'debug_breakpoint_hit':
        setStatus('paused')
        setCurrentBlock({
          blockId: event.node_id,
          blockName: event.node_name,
        })
        // Update the ref so a subsequent Stop marks the PAUSED node as
        // stopped, not the previous-completed block. The engine pauses
        // BEFORE ``_start_block_execution`` fires, so no block_status_changed
        // was emitted for this node - the ref would otherwise stay stale.
        currentBlockIdRef.current = event.node_id
        useWorkflowStore.getState().setPausedNodeId(event.node_id)
        resolveDraftWaiters()
        break
    }
  }, [updateBlockExecution, completeStoreExecution, emitAdHocCompletionToast, resolveDraftWaiters])

  // Forward variable events to the registered handler (useVariableUpdates)
  const handleVariableEvent = useCallback((payload: unknown) => {
    variableHandlerRef.current?.(payload)
  }, [])

  // When a sequential suite/regression child terminates, poll the backend
  // for the next child session on the same parent execution and hydrate
  // the workbench from it. The previous canvas stays visible with its
  // terminal block states while we wait, so fast-completing tests don't
  // flash an empty canvas between transitions.
  const followNextSequentialChild = useCallback(
    async (parentId: string, previousSessionId: string | null) => {
      setIsTransitioningToNextChild(true)

      // Unsubscribe from the previous child's topics up front so stray
      // events from the terminating session don't leak into the next one.
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
      if (variableSubscriptionRef.current) {
        variableSubscriptionRef.current.unsubscribe()
        variableSubscriptionRef.current = null
      }

      const { fetchExecution } = await import('@/features/executions/api/executions')
      const TERMINAL_STATUSES = new Set(['passed', 'failed', 'stopped', 'skipped'])
      const POLL_INTERVAL_MS = 150
      const MAX_ATTEMPTS = 20 // 20 * 150ms = 3s total
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

        // If the parent tracked execution has already reached a terminal
        // state, short-circuit out of the poll and redirect. Without this
        // the console waits the full 3s timeout with the last finished
        // child's canvas still painted.
        try {
          const parentResp = await fetchExecution(parentId)
          if (
            parentResp.success &&
            parentResp.data &&
            TERMINAL_STATUSES.has(parentResp.data.status)
          ) {
            break
          }
        } catch {
          // Ignore transient fetch errors and continue polling.
        }

        let session: Awaited<ReturnType<typeof workbenchApi.getCurrentSession>>
        try {
          session = await workbenchApi.getCurrentSession()
        } catch {
          continue
        }
        if (
          session?.parent_execution_id === parentId &&
          session.session_id !== previousSessionId &&
          !TERMINAL_STATUSES.has(session.status)
        ) {
          // New child session is live. hydrateWorkbenchSession →
          // subscribeToRunningSession handles the reconnect when the WS
          // has dropped, so we just pass isConnected through verbatim.
          await hydrateWorkbenchSession(
            {
              setSessionId,
              setTestId,
              setWebsocketTopic,
              setStatus,
              setCurrentBlock,
              setProgress,
              setIsSessionRecoveryComplete,
              setExecutionId,
              setParentExecutionId,
              setSessionTestName,
              subscriptionRef,
              variableSubscriptionRef,
              executionIdRef,
              executionIdTrackedRef,
              parentExecutionIdRef,
              startStoreExecution,
              updateBlockExecution,
              completeStoreExecution,
              isConnected,
              connect,
              subscribe,
              handleWebSocketEvent,
              handleVariableEvent,
            },
            session,
          )
          setIsTransitioningToNextChild(false)
          return
        }
      }

      // No next child appeared within the timeout - the parent must have
      // reached a terminal state. Fall back to the redirect behavior.
      setIsTransitioningToNextChild(false)
      trackedTerminalHandlerRef.current?.(parentId)
      executionIdTrackedRef.current = null
      parentExecutionIdRef.current = null
      setExecutionId(null)
      setParentExecutionId(null)
      setStatus('idle')
      setSessionId(null)
      setTestId(null)
      setWebsocketTopic(null)
      setCurrentBlock(null)
      setProgress(null)
      setWarnings([])
    },
    [
      connect,
      isConnected,
      subscribe,
      handleWebSocketEvent,
      handleVariableEvent,
      startStoreExecution,
      updateBlockExecution,
      completeStoreExecution,
    ],
  )

  // Store the latest follow-next callback in a ref so the WebSocket event
  // handler always invokes the freshest version.
  useEffect(() => {
    followNextSequentialChildRef.current = followNextSequentialChild
  }, [followNextSequentialChild])

  // Run-mirror attach: hydrate the announced run's backend session exactly as
  // session recovery would, but as a viewer - the tracked refs stay untouched
  // so the terminal never redirects this tab off the canvas. A failed read
  // blocks the canvas: a viewer told a run was announced must not be left
  // watching nothing with no reason given.
  const attachToAnnouncedRun = useCallback(async () => {
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }
    if (variableSubscriptionRef.current) {
      variableSubscriptionRef.current.unsubscribe()
      variableSubscriptionRef.current = null
    }
    await runBlockingRead(
      {
        label: ANNOUNCED_RUN_LABEL,
        run: async () => {
          const session = await workbenchApi.getCurrentSession()
          clearPageBlock(ANNOUNCED_RUN_LABEL)
          if (!session) return
          await hydrateWorkbenchSession(
            {
              setSessionId,
              setTestId,
              setWebsocketTopic,
              setStatus,
              setCurrentBlock,
              setProgress,
              setIsSessionRecoveryComplete,
              setExecutionId: () => {},
              setParentExecutionId: () => {},
              setSessionTestName,
              subscriptionRef,
              variableSubscriptionRef,
              executionIdRef,
              executionIdTrackedRef: { current: null },
              parentExecutionIdRef: { current: null },
              startStoreExecution,
              updateBlockExecution,
              completeStoreExecution,
              isConnected,
              connect,
              subscribe,
              handleWebSocketEvent,
              handleVariableEvent,
            },
            session,
          )
        },
      },
      blockPage,
    ).catch(() => {})
  }, [
    connect,
    isConnected,
    subscribe,
    handleWebSocketEvent,
    handleVariableEvent,
    startStoreExecution,
    updateBlockExecution,
    completeStoreExecution,
    setStatus,
    blockPage,
    clearPageBlock,
  ])

  // Run-mirror detach: drop the announced run's subscriptions; painted states
  // and console entries stay for late reading.
  const detachFromAnnouncedRun = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }
    if (variableSubscriptionRef.current) {
      variableSubscriptionRef.current.unsubscribe()
      variableSubscriptionRef.current = null
    }
  }, [])

  // Registration function exposed to useVariableUpdates
  const registerVariableHandler = useCallback(
    (handler: ((payload: unknown) => void) | null) => {
      variableHandlerRef.current = handler
    },
    [],
  )

  // ===========================================================================
  // Actions
  // ===========================================================================

  // Shared response handler for startRun / startDebugRun.
  const applyRunResponse = useCallback(
    (response: WorkbenchRunResponse) => {
      const responseExecId = response.execution_id ?? null
      executionIdTrackedRef.current = responseExecId
      setExecutionId(responseExecId)
      setSessionTestName(response.test_name ?? null)

      if (response.warnings && response.warnings.length > 0) {
        const transformedWarnings: Warning[] = response.warnings.map(transformWarning)
        setWarnings(transformedWarnings)
        transformedWarnings.forEach((warning: Warning) => {
          // The BE emits warnings with a `type` tag; map each tag to a
          // user-facing toast title so we don't blanket-label every
          // advisory as a profile problem.
          const title = warning.type === 'SCOPED_RUN_ADVISORY'
            ? 'Scope Initialized'
            : 'Missing Profile Value'
          toast.warning(warning.message, title)
        })
      }
    },
    [toast]
  )

  // Shared error handler for startRun / startDebugRun.
  const handleRunFailure = useCallback(
    (err: unknown) => {
      const apiError = err as Error
      setError(apiError)
      setStatus('idle')
      toast.error(apiError.message, 'Run Error')
    },
    [toast]
  )

  // Shared pre-run setup: connects WS, generates session id, subscribes.
  // Returns the generated session id so callers can pass it to the API.
  //
  // ``isAdHoc`` skips the ``startStoreExecution`` reset so the previous run's
  // per-block status badges remain visible on the canvas. Right-click ad-hoc
  // execution is an incremental dev tool - dropping the prior run's display
  // would force the user to re-run the upstream pipeline before testing a
  // single new block.
  const prepareRun = useCallback(
    async (testId: string, isAdHoc = false): Promise<string> => {
      if (!isConnected) {
        await connect()
      }

      // Run All / Debug All must be equivalent to Reset + Run on the
      // frontend: the backend always starts a full run from scratch, so
      // the panel must drop the prior run's runtime values too. We
      // achieve that by force-flushing the prior sessionId through
      // ``null`` between back-to-back full runs - that null transition
      // is the existing reset signal for ``useVariableUpdates``. Ad-hoc
      // runs skip this so they inherit the prior runtime values
      // (Run/Debug Current, Run/Debug from Here are incremental dev
      // tools by design).
      if (!isAdHoc && sessionIdRef.current !== null) {
        flushSync(() => {
          setSessionId(null)
        })
      }

      if (!isAdHoc || !executionIdRef.current) {
        const execId = startStoreExecution(testId)
        executionIdRef.current = execId
      }

      const newSessionId = randomUUID()
      const newWebsocketTopic = `workbench:${newSessionId}`

      setStatus('running')
      setSessionId(newSessionId)
      setTestId(testId)
      setWebsocketTopic(newWebsocketTopic)

      subscriptionRef.current = await subscribeAsync(newWebsocketTopic, handleWebSocketEvent)
      variableSubscriptionRef.current = await subscribeAsync(
        `variable:${newSessionId}`,
        handleVariableEvent,
      )

      return newSessionId
    },
    [subscribeAsync, handleWebSocketEvent, handleVariableEvent, isConnected, connect, startStoreExecution]
  )

  const startRun = useCallback(
    async (params: StartRunParams) => {
      if (isRunningStatus(status)) {
        return
      }

      setError(null)

      try {
        // Run Scope is ad-hoc: it keeps the canvas state the session holds (REQ-3.2.1.5).
        const newSessionId = await prepareRun(params.testId, params.scopeMode === 'function')
        const response = await workbenchApi.startRun({
          test_id: params.testId,
          environment_id: params.environmentId,
          session_id: newSessionId,
          skipped_node_ids: params.skippedNodeIds,
          // Scope-mode payload for drilled-in Run/Debug Scope on a Function.
          scope_mode: params.scopeMode,
          scoped_function_node_id: params.scopedFunctionNodeId,
          function_path: params.functionPath,
          // Run-current: dirty in-memory body + variables (omitted when clean).
          workflow: params.workflow,
          variables: params.variables,
          function_variables: params.function_variables,
        })
        applyRunResponse(response)
      } catch (err) {
        handleRunFailure(err)
      }
    },
    [status, prepareRun, applyRunResponse, handleRunFailure]
  )

  const stopRun = useCallback(async () => {
    if (!sessionId) {
      return
    }

    try {
      // Route Stop through the execution lifecycle for
      // tracked sessions; ephemeral workbench runs keep the workbench stop.
      if (executionIdTrackedRef.current) {
        await apiClient.put(`/executions/${executionIdTrackedRef.current}/stop`)
      } else {
        await workbenchApi.stopRun(sessionId)
      }
      setStatus('stopped')
      // Clear the paused marker now: we unsubscribe below, so the terminal
      // execution_completed event that would otherwise clear it won't arrive.
      useWorkflowStore.getState().setPausedNodeId(null)
      // Finalize blocks left mid-flight (the engine is canceled, so the parent
      // control / Function blocks never get a terminal status over WS).
      if (executionIdRef.current) {
        stopRunningBlocks(executionIdRef.current)
      }

      // Unsubscribe from WebSocket
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
      if (variableSubscriptionRef.current) {
        variableSubscriptionRef.current.unsubscribe()
        variableSubscriptionRef.current = null
      }
    } catch (err) {
      const apiError = err as Error
      toast.error(apiError.message, 'Stop Error')
    }
  }, [sessionId, toast, stopRunningBlocks])

  const startDebugRun = useCallback(
    async (params: StartDebugRunParams) => {
      if (isRunningStatus(status)) {
        return
      }

      setError(null)

      try {
        const isAdHoc =
          params.startNodeId !== undefined || params.singleNodeId !== undefined
        const newSessionId = await prepareRun(params.testId, isAdHoc || params.scopeMode === 'function')
        const apiParams: Parameters<typeof workbenchApi.startDebugRun>[0] = {
          test_id: params.testId,
          environment_id: params.environmentId,
          session_id: newSessionId,
          skipped_node_ids: params.skippedNodeIds,
          breakpoints: params.breakpoints,
          debug_options: {
            pause_on_first_block: params.debugOptions.pauseOnFirstBlock,
            pause_on_errors: params.debugOptions.pauseOnErrors,
          },
        }
        if (params.startNodeId !== undefined) apiParams.start_node_id = params.startNodeId
        if (params.singleNodeId !== undefined) apiParams.single_node_id = params.singleNodeId
        if (params.blockDraft !== undefined) apiParams.block_draft = params.blockDraft
        // Drilled-in Debug Scope on a Function: invoke a single Function in
        // isolation while still subscribing to the workbench WS channel.
        if (params.scopeMode !== undefined) apiParams.scope_mode = params.scopeMode
        if (params.scopedFunctionNodeId !== undefined) {
          apiParams.scoped_function_node_id = params.scopedFunctionNodeId
        }
        if (params.functionPath !== undefined) apiParams.function_path = params.functionPath
        // Run-current: forward the dirty in-memory body + variables.
        if (params.workflow !== undefined) apiParams.workflow = params.workflow
        if (params.variables !== undefined) apiParams.variables = params.variables
        if (params.function_variables !== undefined) apiParams.function_variables = params.function_variables
        adhocRunRef.current = isAdHoc
        const response = await workbenchApi.startDebugRun(apiParams)
        applyRunResponse(response)
      } catch (err) {
        adhocRunRef.current = false
        handleRunFailure(err)
      }
    },
    [status, prepareRun, applyRunResponse, handleRunFailure]
  )

  // Library-View standalone run/debug (no parent Test): subscribe to the WS
  // topic via prepareRun, then POST to the dedicated standalone-run endpoint.
  const runStandaloneFunction = useCallback(
    async (params: StandaloneRunParams) => {
      if (isRunningStatus(status)) {
        return
      }
      setError(null)
      try {
        const newSessionId = await prepareRun(params.functionId)
        const response = await runFunctionStandalone(params.functionId, {
          version: params.version,
          draft: params.draft,
          environmentId: params.environmentId,
          sessionId: newSessionId,
          debug: params.debug,
          variables: params.variables,
          function_variables: params.function_variables,
        })
        // Same session shape as /workbench/run; warnings carry an optional
        // profile_name the standalone advisory omits (transformWarning tolerates it).
        applyRunResponse(response as unknown as WorkbenchRunResponse)
      } catch (err) {
        handleRunFailure(err)
      }
    },
    [status, prepareRun, applyRunResponse, handleRunFailure]
  )

  const continueExecution = useCallback(async () => {
    if (!sessionId) return
    // Optimistically transition to running BEFORE the POST so the UI does not
    // race with the next ``debug_breakpoint_hit`` WS event: if the engine
    // re-pauses on the very next node, the WS handler will set paused AFTER
    // this optimistic update, landing on the correct state.
    setStatus('running')
    useWorkflowStore.getState().setPausedNodeId(null)
    try {
      await workbenchApi.continueExecution(sessionId)
    } catch (err) {
      const apiError = err as Error
      toast.error(apiError.message, 'Continue Error')
    }
  }, [sessionId, toast])

  const skipBlockAtPause = useCallback(async () => {
    if (!sessionId) return
    // Same optimistic flip as ``continueExecution``: the engine will re-pause
    // at the NEXT node, and the WS handler must win the race against the
    // HTTP response resolution.
    setStatus('running')
    useWorkflowStore.getState().setPausedNodeId(null)
    try {
      await workbenchApi.skipBlockAtPause(sessionId)
    } catch (err) {
      const apiError = err as Error
      toast.error(apiError.message, 'Skip Block Error')
    }
  }, [sessionId, toast])

  const updateBreakpoints = useCallback(async (nodeIds: string[]) => {
    if (!sessionId || !isRunningStatus(statusRef.current)) return
    try {
      await workbenchApi.updateWorkbenchBreakpoints(sessionId, nodeIds)
    } catch (err) {
      // Non-fatal - breakpoint update is best-effort during live debug
      const apiError = err as Error
      toast.error(apiError.message, 'Breakpoint Update Error')
    }
  }, [sessionId, toast, statusRef])

  const stepOver = useCallback(async () => {
    if (!sessionId) return
    setStatus('running')
    useWorkflowStore.getState().setPausedNodeId(null)
    try {
      await workbenchApi.stepOver(sessionId)
    } catch (err) {
      const apiError = err as Error
      toast.error(apiError.message, 'Step Over Error')
    }
  }, [sessionId, toast, setStatus])

  const stepInto = useCallback(async () => {
    if (!sessionId) return
    setStatus('running')
    useWorkflowStore.getState().setPausedNodeId(null)
    try {
      await workbenchApi.stepInto(sessionId)
    } catch (err) {
      const apiError = err as Error
      toast.error(apiError.message, 'Step Into Error')
    }
  }, [sessionId, toast, setStatus])

  const repeatStep = useCallback(async () => {
    if (!sessionId) return
    // Repeat keeps the session paused on the same node; no optimistic flip.
    try {
      await workbenchApi.repeatStep(sessionId)
    } catch (err) {
      const apiError = err as Error
      toast.error(apiError.message, 'Repeat Step Error')
    }
  }, [sessionId, toast])

  // PYRUN-21: Run from the block editor.
  const pausedAtNode = useCallback(
    (nodeId: string) =>
      statusRef.current === 'paused' &&
      useWorkflowStore.getState().pausedNodeId === nodeId,
    [statusRef],
  )

  const canRunBlockDraft = useCallback(
    (nodeId: string) => pausedAtNode(nodeId) || !isRunningStatus(statusRef.current),
    [pausedAtNode, statusRef],
  )

  // Called only while paused at the block, so a pause or the run's end always follows.
  const waitForNextPause = useCallback(
    () =>
      new Promise<void>((resolve) => {
        draftWaitersRef.current.push(resolve)
      }),
    [],
  )

  const repeatBlockDraft = useCallback(
    async (nodeId: string, parameter: string, value: unknown) => {
      if (!pausedAtNode(nodeId)) return
      setRunBusy(true)
      // Wait from before the request: the next pause can arrive before the request answers.
      const nextPause = waitForNextPause()
      try {
        await workbenchApi.repeatStep(sessionIdRef.current as string, {
          override: { node_id: nodeId, parameter, value },
        })
        await nextPause
      } catch (err) {
        toast.error((err as Error).message, 'Run Error')
      } finally {
        setRunBusy(false)
      }
    },
    [pausedAtNode, waitForNextPause, toast],
  )

  const registerTrackedTerminalHandler = useCallback(
    (handler: ((executionId: string) => void) | null) => {
      trackedTerminalHandlerRef.current = handler
    },
    [],
  )

  const updateSkippedNodes = useCallback(async (skippedNodeIds: string[]) => {
    // statusRef catches synchronous fires (e.g. workflowStore.reset() during
    // the terminal handler) that happen before React commits the terminal
    // status. Reading from state would pass the guard and we'd POST to a
    // passed / already-cleared session.
    if (!sessionId || !isRunningStatus(statusRef.current)) return

    try {
      await workbenchApi.updateSkippedNodes(sessionId, {
        skipped_node_ids: skippedNodeIds,
      })
    } catch (err) {
      // Non-fatal - skip update is best-effort
      const apiError = err as Error
      toast.error(apiError.message, 'Skip Update Error')
    }
  }, [sessionId, toast])

  const reset = useCallback(() => {
    // Reset all state FIRST (synchronous) so UI updates immediately
    setStatus('idle')
    setSessionId(null)
    setTestId(null)
    setWebsocketTopic(null)
    setCurrentBlock(null)
    setProgress(null)
    setWarnings([])
    setError(null)
    setExecutionId(null)
    setParentExecutionId(null)
    setSessionTestName(null)
    // Drop the paused-node marker so a stopped/paused block doesn't keep its
    // amber halo after Reset.
    useWorkflowStore.getState().setPausedNodeId(null)

    // Unsubscribe from WebSocket
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }
    if (variableSubscriptionRef.current) {
      variableSubscriptionRef.current.unsubscribe()
      variableSubscriptionRef.current = null
    }

    // V-CANVAS-04: Clear execution from store
    if (executionIdRef.current) {
      clearExecution(executionIdRef.current)
      executionIdRef.current = null
    }
    currentBlockIdRef.current = null
    executionIdTrackedRef.current = null
    parentExecutionIdRef.current = null

    // Wipe the console log panel. Logs accumulate across runs so the user
    // sees an incremental-dev history; Reset is the explicit "start fresh"
    // gesture that throws it away.
    useLogStore.getState().clearLogs()

    // Clear the backend session so session recovery cannot restore this run.
    // The local wipe is the user's explicit gesture and stands either way, so a
    // failure is reported rather than gating it.
    clearWorkbenchSession(toast.error).catch(alreadyReported)
  }, [clearExecution, toast])

  // ===========================================================================
  // Session Recovery on Mount
  // ===========================================================================

  useSessionRecovery({
    skipFetch: skipEffects,
    setSessionId,
    setTestId,
    setWebsocketTopic,
    setStatus,
    setCurrentBlock,
    setProgress,
    setIsSessionRecoveryComplete,
    setExecutionId,
    setParentExecutionId,
    setSessionTestName,
    subscriptionRef,
    variableSubscriptionRef,
    executionIdRef,
    executionIdTrackedRef,
    parentExecutionIdRef,
    trackedTerminalHandlerRef,
    startStoreExecution,
    updateBlockExecution,
    completeStoreExecution,
    isConnected,
    connect,
    subscribe,
    handleWebSocketEvent,
    handleVariableEvent,
  })

  // ===========================================================================
  // CANVAS-72: Clear transient skip state on terminal status
  // ===========================================================================

  useEffect(() => {
    if (status === 'passed' || status === 'failed' || status === 'stopped' || status === 'skipped') {
      useWorkflowStore.getState().unskipAll()
    }
  }, [status])

  // ===========================================================================
  // Cleanup on unmount
  // ===========================================================================

  useEffect(() => {
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
      if (variableSubscriptionRef.current) {
        variableSubscriptionRef.current.unsubscribe()
        variableSubscriptionRef.current = null
      }
    }
  }, [])

  // ===========================================================================
  // Return
  // ===========================================================================

  if (shared) return shared

  return {
    // State
    status,
    sessionId,
    testId,
    websocketTopic,
    currentBlock,
    progress,
    warnings,
    isRunning,
    error,
    isSessionRecoveryComplete,
    executionId,
    parentExecutionId,
    sessionTestName,
    isTransitioningToNextChild,
    runBusy,

    // Actions
    startRun,
    startDebugRun,
    runStandaloneFunction,
    stopRun,
    continueExecution,
    skipBlockAtPause,
    stepOver,
    stepInto,
    repeatStep,
    repeatBlockDraft,
    canRunBlockDraft,
    updateBreakpoints,
    updateSkippedNodes,
    reset,
    registerVariableHandler,
    registerTrackedTerminalHandler,
    attachToAnnouncedRun,
    detachFromAnnouncedRun,
  }
}
