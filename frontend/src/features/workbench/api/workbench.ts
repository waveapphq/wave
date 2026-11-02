/**
 * Workbench API Client - V-CANVAS-14 / REQ-3.2.1.1
 *
 * API client for ephemeral Workbench execution.
 * Workbench runs are ephemeral - they do NOT create Execution entities.
 */

import { apiClient, getApiBaseUrl } from '@/lib/api'
import { downloadFromUrl } from '@/lib/download-file'
import type { ElementTypes } from '@/lib/variable-validation'
import type { FunctionVariablesSeed } from '@/types/function-variables'

// ===========================================================================
// Types
// ===========================================================================

export interface WorkbenchRunParams {
  test_id: string
  environment_id: string
  /** V-CANVAS-04: Client-provided session ID for pre-subscription to WebSocket */
  session_id?: string
  /** CANVAS-72: Runtime skip - flat list of node IDs to skip */
  skipped_node_ids?: string[]
  /** Drilled-in Run/Debug Scope: invoke a single Function in isolation. */
  scope_mode?: 'function'
  scoped_function_node_id?: string
  /** Function instance ids from the Test canvas to the canvas that holds the run's target. */
  function_path?: string[]
  /** Run-current: in-memory dirty body (nodes+edges) to run instead of on-disk. */
  workflow?: { nodes: unknown[]; edges: unknown[] }
  /** Run-current: in-memory variables overriding the persisted ones. */
  variables?: Record<string, unknown>
  /** Current values staged for Function instances, each under its instance path (REQ-3.2.1.6). */
  function_variables?: FunctionVariablesSeed[]
}

export interface WorkbenchDebugOptions {
  pause_on_first_block: boolean
  pause_on_errors: boolean
}

export interface WorkbenchDebugRunParams extends WorkbenchRunParams {
  breakpoints: string[]
  debug_options: WorkbenchDebugOptions
  /** Ad-hoc Run/Debug from Here: engine entry-point override. Mutually exclusive with single_node_id. */
  start_node_id?: string
  /** Ad-hoc Run/Debug Current: bound traversal to the target node's structural sub-tree. */
  single_node_id?: string
  /** The single_node_id block runs the editor's unsaved draft; the run gate holds to that block (PYRUN-21). */
  block_draft?: boolean
}

export interface WorkbenchDebugOptionsPatch {
  pause_on_first_block?: boolean
  pause_on_errors?: boolean
}

export interface WorkbenchDebugOptionsResponse {
  session_id: string
  debug_options: WorkbenchDebugOptions
}

export interface WorkbenchWarning {
  type: string
  profile_name: string
  message: string
}

export interface WorkbenchRunResponse {
  session_id: string
  status: string
  websocket_topic: string
  warnings: WorkbenchWarning[]
  execution_id?: string | null
  test_name?: string | null
}

export interface WorkbenchBreakpointsResponse {
  session_id: string
  breakpoints: string[]
}

export interface WorkbenchContinueResponse {
  session_id: string
  status: string
}

export interface WorkbenchSkipBlockResponse {
  session_id: string
  status: string
  skipped_node_id: string
}

export interface WorkbenchStepResponse {
  session_id: string
  status: string
}

export interface WorkbenchRepeatStepResponse {
  session_id: string
  status: string
  repeated_node_id: string
}

/** One parameter value substituted for a single repeat (PYRUN-21). */
export interface WorkbenchRepeatStepOverride {
  node_id: string
  parameter: string
  value: unknown
}

export interface WorkbenchRepeatStepBody {
  override: WorkbenchRepeatStepOverride
}

export interface WorkbenchStopResponse {
  session_id: string
  status: string
}

export interface WorkbenchStatusResponse {
  session_id: string
  status: string
  current_block?: { block_id: string; block_name: string }
  progress?: { current: number; total: number; percentage: number }
}

export interface WorkbenchSessionResponse {
  session_id: string
  status: string
  test_id: string
  websocket_topic: string
  current_block?: { block_id: string; block_name: string } | null
  progress?: { current: number; total: number; percentage: number }
  error?: string
  /** V-CANVAS-04: Block execution states for session recovery - maps block_id to status */
  block_states?: Record<string, string>
  /** Present when the recovered session is a tracked execution. */
  execution_id?: string | null
  /** Present when the session is one step of a sequential suite/regression run.
   *  The Workbench viewer uses this to follow the parent's progression to the
   *  next child when this child terminates. */
  parent_execution_id?: string | null
  test_name?: string | null
}

export interface WorkbenchSkipUpdateParams {
  skipped_node_ids: string[]
}

export interface WorkbenchSkipUpdateResponse {
  session_id: string
  skipped_node_ids: string[]
}

export interface WorkbenchClearResponse {
  cleared: boolean
}

export interface WorkbenchSessionArtifact {
  /** Path relative to the session's artifacts dir (may contain `/`). */
  path: string
  size_bytes: number
  created_at: string
}

export interface WorkbenchSessionArtifactsResponse {
  items: WorkbenchSessionArtifact[]
}

export interface WorkbenchSessionVariableEntry {
  value: unknown
  type: string
  /** An unmasked array / map's real element types (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

/** Current-edit override body: exactly one of value / expression / template, plus the declared type. */
export type WorkbenchVariableOverrideBody =
  | { value: unknown; type: string; elementTypes?: ElementTypes }
  | { expression: string; type: string }
  | { template: string; type: string }

export interface WorkbenchVariableOverrideResponse {
  name: string
  /** Coerced literal (secrets masked); null for a re-armed expression (null is in unknown). */
  value: unknown
  /** True when the override re-armed an expression (pending until next reference). */
  pending: boolean
}

// ===========================================================================
// API Functions
// ===========================================================================

/**
 * Start an ephemeral workbench run
 */
async function startRun(params: WorkbenchRunParams): Promise<WorkbenchRunResponse> {
  const response = await apiClient.post<WorkbenchRunResponse>('/workbench/run', params)
  return response.data
}

/**
 * Stop a running workbench session
 */
async function stopRun(sessionId: string): Promise<WorkbenchStopResponse> {
  const response = await apiClient.post<WorkbenchStopResponse>(`/workbench/${sessionId}/stop`)
  return response.data
}

/**
 * Get status of a workbench session
 */
async function getStatus(sessionId: string): Promise<WorkbenchStatusResponse | null> {
  try {
    const response = await apiClient.get<WorkbenchStatusResponse>(`/workbench/${sessionId}/status`)
    return response.data
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null
    throw err
  }
}

/**
 * Get current user's active session for session recovery.
 * Returns session data in any status (running, passed, failed, stopped).
 */
async function getCurrentSession(): Promise<WorkbenchSessionResponse | null> {
  const response = await apiClient.get<WorkbenchSessionResponse | null>('/workbench/session')
  return response.data
}

/**
 * Clear/reset the current user's session.
 * Idempotent - succeeds even if no session exists.
 */
async function clearSession(): Promise<WorkbenchClearResponse> {
  const response = await apiClient.delete<WorkbenchClearResponse>('/workbench/session')
  return response.data
}

/**
 * Returns the running/paused session, or null when nothing is running. A
 * failed read rejects so the calling gesture can refuse with the reason.
 */
async function getRunningSession(): Promise<{ testName: string | null } | null> {
  const session = await getCurrentSession()
  if (session && (session.status === 'running' || session.status === 'paused')) {
    return { testName: session.test_name ?? null }
  }
  return null
}

/**
 * Update skipped node IDs for a running session (mid-execution skip)
 */
async function updateSkippedNodes(
  sessionId: string,
  params: WorkbenchSkipUpdateParams
): Promise<WorkbenchSkipUpdateResponse> {
  const response = await apiClient.post<WorkbenchSkipUpdateResponse>(
    `/workbench/${sessionId}/skip`,
    params
  )
  return response.data
}

/**
 * Start a workbench run in Debug mode. Sends breakpoints + debug_options on
 * the /workbench/run request; backend wires the pause machinery from the
 * payload rather than a separate "debug_mode" flag.
 */
async function startDebugRun(
  params: WorkbenchDebugRunParams
): Promise<WorkbenchRunResponse> {
  if (params.start_node_id !== undefined && params.single_node_id !== undefined) {
    throw new Error('start_node_id and single_node_id are mutually exclusive')
  }
  const body: Record<string, unknown> = {
    test_id: params.test_id,
    environment_id: params.environment_id,
    breakpoints: params.breakpoints,
    debug_options: params.debug_options,
  }
  if (params.session_id !== undefined) body.session_id = params.session_id
  if (params.skipped_node_ids !== undefined) body.skipped_node_ids = params.skipped_node_ids
  if (params.start_node_id !== undefined) body.start_node_id = params.start_node_id
  if (params.single_node_id !== undefined) body.single_node_id = params.single_node_id
  if (params.block_draft !== undefined) body.block_draft = params.block_draft
  // Drilled-in Debug Scope on a Function: forward the scope payload to the
  // BE so it dispatches via `_start_scoped_function_run` (with debug
  // options honored) instead of treating it as a whole-test debug run.
  // The hand-rolled body builder above was dropping these fields, which is
  // why Run Scope worked (the run path posts the params object directly)
  // but Debug Scope started from the test root.
  if (params.scope_mode !== undefined) body.scope_mode = params.scope_mode
  if (params.scoped_function_node_id !== undefined) {
    body.scoped_function_node_id = params.scoped_function_node_id
  }
  if (params.function_path !== undefined) body.function_path = params.function_path
  if (params.workflow !== undefined) body.workflow = params.workflow
  if (params.variables !== undefined) body.variables = params.variables
  if (params.function_variables !== undefined) body.function_variables = params.function_variables
  const response = await apiClient.post<WorkbenchRunResponse>('/workbench/run', body)
  return response.data
}

/**
 * Replace the live breakpoint set on a running or paused debug session.
 */
async function updateWorkbenchBreakpoints(
  sessionId: string,
  nodeIds: string[]
): Promise<WorkbenchBreakpointsResponse> {
  const response = await apiClient.patch<WorkbenchBreakpointsResponse>(
    `/workbench/${sessionId}/breakpoints`,
    { breakpoints: nodeIds }
  )
  return response.data
}

/**
 * Patch live debug-options on a running or paused debug session.
 * Either flag may be omitted; the backend preserves it.
 */
async function updateDebugOptions(
  sessionId: string,
  patch: WorkbenchDebugOptionsPatch,
): Promise<WorkbenchDebugOptionsResponse> {
  const response = await apiClient.patch<WorkbenchDebugOptionsResponse>(
    `/workbench/${sessionId}/debug-options`,
    patch,
  )
  return response.data
}

/**
 * Resume a paused debug session. The engine runs the paused node and
 * proceeds until the next pause trigger or terminal state.
 */
async function continueExecution(sessionId: string): Promise<WorkbenchContinueResponse> {
  const response = await apiClient.post<WorkbenchContinueResponse>(
    `/workbench/${sessionId}/continue`
  )
  return response.data
}

/**
 * Skip the currently paused node and re-pause before the next one executes.
 */
async function skipBlockAtPause(sessionId: string): Promise<WorkbenchSkipBlockResponse> {
  const response = await apiClient.post<WorkbenchSkipBlockResponse>(
    `/workbench/${sessionId}/skip-block`
  )
  return response.data
}

/**
 * Step-over the paused node: run it (and its sub-graph for control-flow parents)
 * to completion, then re-pause BEFORE the sibling-after successor.
 */
async function stepOver(sessionId: string): Promise<WorkbenchStepResponse> {
  const response = await apiClient.post<WorkbenchStepResponse>(
    `/workbench/${sessionId}/step-over`
  )
  return response.data
}

/**
 * Step-into the paused node: re-pause BEFORE the first descendant
 * (body node for loops, selected branch for If-Else, immediate sibling for a leaf).
 */
async function stepInto(sessionId: string): Promise<WorkbenchStepResponse> {
  const response = await apiClient.post<WorkbenchStepResponse>(
    `/workbench/${sessionId}/step-into`
  )
  return response.data
}

/**
 * Repeat the paused block in place: re-run it WITHOUT advancing and
 * re-pause on the same node. The final attempt's signals drive Continue/Step/Skip.
 */
async function repeatStep(
  sessionId: string,
  body?: WorkbenchRepeatStepBody
): Promise<WorkbenchRepeatStepResponse> {
  const path = `/workbench/${sessionId}/repeat-step`
  const response = body
    ? await apiClient.post<WorkbenchRepeatStepResponse>(path, body)
    : await apiClient.post<WorkbenchRepeatStepResponse>(path)
  return response.data
}

/** Encode each path segment while preserving the `/` separators. */
function encodeArtifactPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * List the active session's artifact files (the endpoint returns a bare
 * `{ items }` body, so the envelope unwrap is bypassed).
 */
async function listSessionArtifacts(): Promise<WorkbenchSessionArtifactsResponse> {
  const response = await apiClient.get<WorkbenchSessionArtifactsResponse>(
    '/workbench/session/artifacts',
    { rawResponse: true }
  )
  return response.data
}

/**
 * Hard-delete one artifact file from the active ephemeral session.
 */
async function deleteSessionArtifact(path: string): Promise<void> {
  await apiClient.delete(`/workbench/session/artifacts/${encodeArtifactPath(path)}`)
}

/**
 * Download one session artifact file under its own filename.
 */
async function downloadSessionArtifact(path: string): Promise<void> {
  await downloadFromUrl(
    `${getApiBaseUrl()}/workbench/session/artifacts/content/${encodeArtifactPath(path)}`,
    path.slice(path.lastIndexOf('/') + 1)
  )
}

/** Get one session scope's realized runtime variables (secrets masked), optionally filtered by name. */
async function getSessionVariables(
  sessionId: string,
  names?: string[],
  functionPath?: string[]
): Promise<Record<string, WorkbenchSessionVariableEntry>> {
  const params: string[] = []
  if (names && names.length > 0) params.push(`names=${names.map(encodeURIComponent).join(',')}`)
  if (functionPath && functionPath.length > 0) {
    params.push(`function_path=${functionPath.map(encodeURIComponent).join(',')}`)
  }
  const query = params.length > 0 ? `?${params.join('&')}` : ''
  const response = await apiClient.get<{
    variables: Record<string, WorkbenchSessionVariableEntry>
  }>(`/workbench/${sessionId}/variables${query}`)
  return response.data.variables
}

/** Apply a transient Current-edit override to one session variable; 409 while the session runs (REQ-5.2.4.7). */
async function setVariableOverride(
  sessionId: string,
  name: string,
  body: WorkbenchVariableOverrideBody,
  functionPath?: string[]
): Promise<WorkbenchVariableOverrideResponse> {
  const response = await apiClient.patch<WorkbenchVariableOverrideResponse>(
    `/workbench/${sessionId}/variables/${encodeURIComponent(name)}`,
    functionPath === undefined ? body : { ...body, function_path: functionPath }
  )
  return response.data
}

export const workbenchApi = {
  startRun,
  stopRun,
  getStatus,
  getCurrentSession,
  getRunningSession,
  clearSession,
  updateSkippedNodes,
  startDebugRun,
  updateWorkbenchBreakpoints,
  updateDebugOptions,
  continueExecution,
  skipBlockAtPause,
  stepOver,
  stepInto,
  repeatStep,
  getSessionVariables,
  setVariableOverride,
  listSessionArtifacts,
  deleteSessionArtifact,
  downloadSessionArtifact,
}
