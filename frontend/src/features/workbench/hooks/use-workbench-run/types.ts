/**
 * useWorkbenchRun Types
 *
 * Type definitions for the workbench run hook, including public API types
 * and internal WebSocket event types.
 */

import type { WorkbenchWarning } from '@/features/workbench/api/workbench'
import type { FunctionVariablesSeed } from '@/types/function-variables'

export interface DebugOptionsClient {
  pauseOnFirstBlock: boolean
  pauseOnErrors: boolean
}

// ===========================================================================
// Public Types
// ===========================================================================

export type WorkbenchStatus = 'idle' | 'running' | 'paused' | 'passed' | 'failed' | 'stopped' | 'skipped'

export interface CurrentBlock {
  blockId: string
  blockName: string
}

export interface Progress {
  current: number
  total: number
  percentage: number
}

export interface Warning {
  type: string
  profileName: string
  message: string
}

export interface WorkbenchRunState {
  status: WorkbenchStatus
  sessionId: string | null
  testId: string | null
  websocketTopic: string | null
  currentBlock: CurrentBlock | null
  progress: Progress | null
  warnings: Warning[]
  isRunning: boolean
  error: Error | null
  /** True once session recovery has completed (whether a session was found or not) */
  isSessionRecoveryComplete: boolean
  /** Set execution_id when the session represents a tracked execution; null for ephemeral runs. */
  executionId: string | null
  /** Parent execution id when this is a sequential suite/regression child;
   *  null for standalone test executions and ephemeral runs. The workbench
   *  breadcrumb uses this to reconstruct the Executions / Parent / Test path. */
  parentExecutionId: string | null
  /** Entity name resolved by the backend session (used by the viewer indicator
   *  so the display does not wait for frontend test-lifecycle hydration). */
  sessionTestName: string | null
  /** True while the viewer is waiting for the next sequential child session
   *  to appear on the backend (between one test terminating and the driver
   *  spawning the next). UI uses this to render a subtle overlay instead of
   *  flashing an empty canvas for fast-completing tests. */
  isTransitioningToNextChild: boolean
  /** True from a repeat started in the block editor until that block pauses
   *  again or the session ends (PYRUN-21). */
  runBusy: boolean
}

export interface StartRunParams {
  testId: string
  environmentId: string
  /** CANVAS-72: Runtime skip - flat list of node IDs to skip */
  skippedNodeIds?: string[]
  /** Drilled-in Run/Debug Scope: invoke a single Function in isolation. */
  scopeMode?: 'function'
  scopedFunctionNodeId?: string
  /** Function instance ids from the Test canvas to the canvas that holds the run's target. */
  functionPath?: string[]
  /** Run-current: in-memory dirty body to execute instead of the on-disk test. */
  workflow?: { nodes: unknown[]; edges: unknown[] }
  /** Run-current: in-memory variables overriding the persisted ones. */
  variables?: Record<string, unknown>
  /** Current values staged for Function instances, each under its instance path (REQ-3.2.1.6). */
  function_variables?: FunctionVariablesSeed[]
}

export interface StartDebugRunParams extends StartRunParams {
  breakpoints: string[]
  debugOptions: DebugOptionsClient
  /** Ad-hoc Run/Debug from Here: engine entry-point override. Mutually exclusive with singleNodeId. */
  startNodeId?: string
  /** Ad-hoc Run/Debug Current: bound traversal to the target node's structural sub-tree. */
  singleNodeId?: string
  /** The singleNodeId block runs the editor's unsaved draft; the run gate holds to that block (PYRUN-21). */
  blockDraft?: boolean
}

/** Standalone library-View run: a Function executed in isolation (no parent
 *  Test). Exactly one of version / draft drives the run body. */
export interface StandaloneRunParams {
  functionId: string
  version: string | null
  draft: Record<string, unknown> | null
  environmentId: string
  debug?: { breakpoints: string[]; options?: Record<string, boolean> }
  /** The Current values set before the run (FNCFG-8). */
  variables?: Record<string, unknown>
  /** The Current values of Function instances nested in the run (REQ-3.2.1.6). */
  function_variables?: FunctionVariablesSeed[]
}

export interface WorkbenchRunActions {
  startRun: (params: StartRunParams) => Promise<void>
  startDebugRun: (params: StartDebugRunParams) => Promise<void>
  runStandaloneFunction: (params: StandaloneRunParams) => Promise<void>
  stopRun: () => Promise<void>
  continueExecution: () => Promise<void>
  skipBlockAtPause: () => Promise<void>
  stepOver: () => Promise<void>
  stepInto: () => Promise<void>
  repeatStep: () => Promise<void>
  /** PYRUN-21: repeat the block the session is paused on with one unsaved
   *  parameter value; does nothing unless paused at that block. */
  repeatBlockDraft: (nodeId: string, parameter: string, value: unknown) => Promise<void>
  /** PYRUN-21: true while the run state allows a draft run of that block. */
  canRunBlockDraft: (nodeId: string) => boolean
  updateBreakpoints: (nodeIds: string[]) => Promise<void>
  updateSkippedNodes: (skippedNodeIds: string[]) => Promise<void>
  reset: () => void
  registerVariableHandler: (handler: ((payload: unknown) => void) | null) => void
  /** Register a callback invoked when the loaded tracked
   *  session reaches a terminal state. Consumers (e.g. the workbench page
   *  container) register here to trigger navigation to the execution detail
   *  view. No-op for ephemeral sessions. */
  registerTrackedTerminalHandler: (handler: ((executionId: string) => void) | null) => void
  /** Run-mirror: hydrate + subscribe the holder's announced run as a viewer. */
  attachToAnnouncedRun: () => Promise<void>
  /** Run-mirror: drop the announced run's subscriptions (paint + console stay). */
  detachFromAnnouncedRun: () => void
}

export type UseWorkbenchRunReturn = WorkbenchRunState & WorkbenchRunActions

// ===========================================================================
// Internal WebSocket Event Types
// ===========================================================================

export interface BlockStatusChangedEvent {
  type: 'block_status_changed'
  block_id: string
  block_name: string
  status: string
  progress?: { current: number; total: number; percentage: number }
}

export interface ExecutionCompletedEvent {
  type: 'execution_completed'
  status: 'passed' | 'failed' | 'stopped' | 'skipped'
  error?: string
}

export interface ExecutionPausedEvent {
  type: 'execution_paused'
  reason: string
  block_id: string
  block_name: string
}

export interface DebugBreakpointHitEvent {
  type: 'debug_breakpoint_hit'
  node_id: string
  node_name: string
  reason: 'breakpoint' | 'first_block' | 'error'
  exception_class: string | null
  exception_message: string | null
}

export type WorkbenchEvent =
  | BlockStatusChangedEvent
  | ExecutionCompletedEvent
  | ExecutionPausedEvent
  | DebugBreakpointHitEvent

// ===========================================================================
// Helpers
// ===========================================================================

export function transformWarning(warning: WorkbenchWarning): Warning {
  return {
    type: warning.type,
    profileName: warning.profile_name,
    message: warning.message,
  }
}

export function isRunningStatus(status: WorkbenchStatus): boolean {
  return status === 'running' || status === 'paused'
}
