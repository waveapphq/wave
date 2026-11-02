/**
 * Test Run Hook - Run/stop execution and run-confirm dialog
 *
 * Handles run button click, save-and-run, discard-and-run, stop,
 * and skip node propagation during execution.
 */

import { useState, useCallback, useEffect } from 'react'
import { useWorkflowStore, type DebugOptions, type NodeType } from '@/features/workbench/stores/workflow-store'
import { useToast } from '@/components/ui/toast'
import {
  mapFunctionPath,
  type ValidationError,
  type ValidationDialogMode,
} from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import type {
  AdHocAction,
  AdHocRunOptions,
} from '@/features/workbench/common/canvas/adhoc-actions-context'
import {
  selectAdHocFunctionPath,
  selectRunScopeDispatch,
} from '@/features/workbench/common/canvas/canvas-action-bar/run-scope-dispatch'
import { buildVariablesPayload, sanitizeEdgesForSave, sanitizeNodesForSave } from './save-utils'
import { mergeStagedIntoRunVariables, stagedFunctionVariables, type StagedOverride } from './staged-overrides'
import type { FunctionVariablesSeed } from '@/types/function-variables'
import { canonicalizeNodes, storedFunctionBody } from '@/features/workbench/lib/canonical-workflow'
import {
  applyMutationAtPath,
  findNodeDeepById,
  type DrillEntry,
} from '@/features/functions/canvas/inner-workflow'
import { foldLocalDefinitionIntoDraft, type LocalDefinitionBody } from '@/features/functions/lib/edit-mode-draft'
import { alreadyReported } from '@/features/workbench/lib/already-reported'
import type { SavedBlockFields } from '@/features/workbench/lib/saved-block-fields'
import { reportTestNotFound } from '@/features/workbench/stores/deleted-test-store'
import { validateTest } from '@/features/tests/api/validation'

interface PendingAdHoc {
  action: AdHocAction
  nodeId: string
  blockDraft?: SavedBlockFields
}

interface ConfigurableNode {
  id: string
  data: { config?: Record<string, unknown> }
}

/** The canvas with one block overlaid by its unsaved config; the given nodes stay untouched. */
function withBlockDraft<T extends ConfigurableNode>(
  nodes: T[],
  drillPath: DrillEntry[],
  nodeId: string,
  draft: SavedBlockFields,
): T[] {
  return applyMutationAtPath(nodes, drillPath, (level) =>
    level.map((node) => {
      if (node.id !== nodeId) return node
      return {
        ...node,
        data: { ...node.data, ...draft.data, config: { ...node.data.config, ...draft.config } },
      }
    }),
  )
}

/** The parameters whose unsaved value differs from the block on the canvas. */
function replacedParameters(
  nodes: readonly NodeForDraftGate[],
  nodeId: string,
  values: Record<string, unknown>,
): string[] {
  const config = findNodeDeepById(nodes, nodeId)?.data.config as { values?: Record<string, unknown> } | undefined
  const saved = config?.values ?? {}
  const names = new Set([...Object.keys(saved), ...Object.keys(values)])
  return [...names].filter((name) => JSON.stringify(saved[name]) !== JSON.stringify(values[name]))
}

const EMPTY_STAGED_OVERRIDES: Map<string, StagedOverride> = new Map()
const readNoStagedOverrides = (): Map<string, StagedOverride> => EMPTY_STAGED_OVERRIDES

/** The staged Function values a run carries; no key when none is staged (REQ-3.2.1.6). */
function functionVariablesSeed(
  staged: Map<string, StagedOverride>,
): { function_variables?: FunctionVariablesSeed[] } {
  const entries = stagedFunctionVariables(staged)
  return entries.length > 0 ? { function_variables: entries } : {}
}

const RUN_BLOCKING_CODES: ReadonlySet<string> = new Set([
  'REQUIRED_PARAM_MISSING',
  'REQUIRED_PARAM_EMPTY',
  // PYRUN-13: a block whose script does not parse cannot run.
  'SCRIPT_SYNTAX_ERROR',
])

interface NodeForRunGate {
  id: string
  data: { label?: string; elementType?: string }
}

interface IssueForRunGate {
  code: string
  severity?: 'error' | 'warning'
  paramName?: string
  message: string
}

/** Blocking findings in the same shape the BE gate emits, for the in-memory
 *  body a dirty canvas runs instead of the saved test. */
function runBlockingErrors(
  nodes: readonly NodeForRunGate[],
  nodeIssues: ReadonlyMap<string, readonly IssueForRunGate[]>,
): ValidationError[] {
  const errors: ValidationError[] = []
  nodes.forEach((node, index) => {
    for (const issue of nodeIssues.get(node.id) ?? []) {
      if (issue.severity === 'warning') continue
      if (!RUN_BLOCKING_CODES.has(issue.code)) continue
      errors.push({
        path: `nodes[${index}].data.config.values.${issue.paramName}`,
        node_id: node.id,
        node_label: node.data.label,
        element_type: node.data.elementType,
        code: issue.code,
        message: issue.message,
        fix_action: null,
        severity: 'error',
      })
    }
  })
  return errors
}

const VARIABLE_IN_MESSAGE = /'([^']+)'/

/** In-memory unresolved references, in the UNDECLARED_VARIABLE shape the BE emits on save. */
function undeclaredVariableErrors(
  nodeIssues: ReadonlyMap<string, readonly IssueForRunGate[]>,
): ValidationError[] {
  const errors: ValidationError[] = []
  for (const [nodeId, issues] of nodeIssues) {
    for (const issue of issues) {
      if (issue.code !== 'UNRESOLVED_VARIABLE_REFERENCE') continue
      const varName = VARIABLE_IN_MESSAGE.exec(issue.message)?.[1]
      if (!varName) continue
      errors.push({
        path: `variables.${varName}`,
        node_id: nodeId,
        code: 'UNDECLARED_VARIABLE',
        message: `Variable '${varName}' is used in this Test but not declared in the Variable Manager`,
        fix_action: `Add variable to manager (type: string)`,
        severity: 'error',
      })
    }
  }
  return errors
}

/** The backend's findings, plus the in-memory ones at a path the backend did not report. */
function withBackendFindings(
  inMemory: readonly ValidationError[],
  backend: readonly ValidationError[],
): ValidationError[] {
  const reported = new Set(backend.map((finding) => finding.path))
  return [...inMemory.filter((finding) => !reported.has(finding.path)), ...backend]
}

/** The block the editor's Run executes and the parameters its unsaved draft replaces (PYRUN-21). */
interface BlockDraft {
  nodeId: string
  parameters: readonly string[]
}

interface FindingForRunGate {
  path?: string
  node_id?: string | null
}

interface NodeForDraftGate {
  id: string
  data: Record<string, unknown>
}

const FINDING_PARAMETER = /\.config\.values\.([^.[\]]+)/
const VARIABLE_FINDING = /^variables\.([^.[\]]+)/
const IDENTIFIER = /[A-Za-z_]\w*/g

/** The text at a dotted field name such as `input_vars.limit` or `arguments.0.value`. */
function fieldText(values: unknown, field: string): string | undefined {
  let current = values
  for (const part of field.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

/** True when the block binds the variable or names it in an expression or template field. */
function blockNamesVariable(node: NodeForDraftGate, name: string): boolean {
  const config = (node.data.config ?? {}) as { values?: unknown; outputBindings?: object }
  if (Object.values(config.outputBindings ?? {}).includes(name)) return true
  const fields = [
    ...((node.data.expressionFields as string[] | undefined) ?? []),
    ...((node.data.templateFields as string[] | undefined) ?? []),
  ]
  return fields.some((field) => fieldText(config.values, field)?.match(IDENTIFIER)?.includes(name) === true)
}

/** Keeps this block's findings, except on a replaced parameter, and those on a variable it uses (PYRUN-21). */
function stopsBlockDraft(
  draft: BlockDraft,
  nodes: readonly NodeForDraftGate[],
): (finding: FindingForRunGate) => boolean {
  const node = findNodeDeepById(nodes, draft.nodeId)
  return (finding) => {
    const path = finding.path ?? ''
    if (finding.node_id === draft.nodeId) {
      const parameter = FINDING_PARAMETER.exec(path)?.[1]
      return parameter === undefined || !draft.parameters.includes(parameter)
    }
    const variable = VARIABLE_FINDING.exec(path)?.[1]
    return variable !== undefined && node !== null && blockNamesVariable(node, variable)
  }
}

export interface TestRunResult {
  // Stop confirm dialog
  showStopConfirmDialog: boolean
  pendingStopMode: 'immediate' | 'finalize'

  // Handlers
  handleRun: (scope: 'current' | 'all', environmentOverride?: string) => Promise<void>
  handleDebug: (scope: 'current' | 'all', environmentOverride?: string) => Promise<void>
  /** Right-click ad-hoc dispatcher: same guardrails as ``handleRun`` /
   *  ``handleDebug`` (a dirty canvas runs its in-memory body directly), but
   *  pins execution to a single node or sub-tree entry point. Wired into
   *  ``AdHocActionsProvider``. */
  handleAdHocRun: (action: AdHocAction, nodeId: string, options?: AdHocRunOptions) => Promise<void>
  /** A saved Test the page holds can start ad-hoc runs, so a read-only Function body still offers them. */
  adHocOffered: boolean
  handleStop: (mode: 'immediate' | 'finalize') => Promise<void>
  handleStopConfirmCancel: () => void
  handleStopConfirm: (mode: 'immediate' | 'finalize') => Promise<void>
}

export interface UseTestRunParams {
  selectedEnvironment: string | null
  startRun: (params: {
    testId: string
    environmentId: string
    skippedNodeIds?: string[]
    scopeMode?: 'function'
    scopedFunctionNodeId?: string
    functionPath?: string[]
    workflow?: { nodes: unknown[]; edges: unknown[] }
    variables?: Record<string, unknown>
    function_variables?: FunctionVariablesSeed[]
  }) => Promise<void>
  startDebugRun: (params: {
    testId: string
    environmentId: string
    breakpoints: string[]
    debugOptions: DebugOptions
    skippedNodeIds?: string[]
    startNodeId?: string
    singleNodeId?: string
    blockDraft?: boolean
    scopeMode?: 'function'
    scopedFunctionNodeId?: string
    functionPath?: string[]
    workflow?: { nodes: unknown[]; edges: unknown[] }
    variables?: Record<string, unknown>
    function_variables?: FunctionVariablesSeed[]
  }) => Promise<void>
  runStandaloneFunction: (params: {
    functionId: string
    version: string | null
    draft: Record<string, unknown> | null
    environmentId: string
    debug?: { breakpoints: string[]; options?: Record<string, boolean> }
    variables?: Record<string, unknown>
    function_variables?: FunctionVariablesSeed[]
  }) => Promise<void>
  stopWorkbenchRun: () => Promise<void>
  updateWorkbenchSkippedNodes: (nodeIds: string[]) => Promise<void>
  workbenchStatus: string
  /** Idle Current-edit staged overrides as they are now, merged into every run-seed. */
  readStagedOverrides?: () => Map<string, StagedOverride>
  setValidationErrors: (errors: ValidationError[]) => void
  setValidationFatal: (fatal: boolean) => void
  setValidationMode: (mode: ValidationDialogMode) => void
  setShowValidationErrorDialog: (show: boolean) => void
  /** The page mirrors another holder's session and cannot start runs. */
  isMirroring?: boolean
}

/** Resolve the library-View run body: the pinned version, or the edit-mode draft made from it. */
export function resolveViewRunBody(
  fvm: { functionId: string; version: string },
  drillPath: ReadonlyArray<{ nodeId: string }>,
  nodes: ReadonlyArray<{ id: string; data?: unknown }>,
): { functionId: string; version: string; draft: Record<string, unknown> | null } {
  const rootId = drillPath[0]?.nodeId
  const data = nodes.find((n) => n.id === rootId)?.data as
    | { editMode?: boolean; draft?: Record<string, unknown>; localDefinition?: LocalDefinitionBody }
    | undefined
  // In edit mode the live working body sits in the transient localDefinition
  // (the drilled active subtree); fold it into the draft so the run executes the
  // unsaved edits, not the stale persisted draft (mirrors the save/publish fold).
  // The body is then canonicalized recursively so NESTED edit-mode drafts at any
  // depth execute too.
  let draft: Record<string, unknown> | null = null
  if (data?.editMode) {
    const folded = data.localDefinition
      ? foldLocalDefinitionIntoDraft(data.draft, data.localDefinition)
      : (data.draft ?? null)
    if (folded) {
      const workflow = (folded.workflow ?? { nodes: [], edges: [] }) as {
        nodes?: { data: Record<string, unknown> }[]
        edges?: unknown[]
      }
      draft = storedFunctionBody({
        ...folded,
        workflow: { ...workflow, nodes: canonicalizeNodes(workflow.nodes ?? []) },
      })
    }
  }
  // The run restores a draft's masked secrets from the version it was made from.
  return { functionId: fvm.functionId, version: fvm.version, draft }
}

export function useTestRun(params: UseTestRunParams): TestRunResult {
  const {
    selectedEnvironment,
    startRun,
    startDebugRun,
    runStandaloneFunction,
    stopWorkbenchRun,
    updateWorkbenchSkippedNodes,
    workbenchStatus,
    readStagedOverrides = readNoStagedOverrides,
    setValidationErrors,
    setValidationFatal,
    setValidationMode,
    setShowValidationErrorDialog,
    isMirroring = false,
  } = params
  const toast = useToast()

  const editingTestId = useWorkflowStore((state) => state.editingTestId)

  // Gather skipped node IDs from store
  const gatherSkippedNodeIds = useCallback(() => {
    const ids = useWorkflowStore.getState().skippedNodeIds
    return ids.length > 0 ? ids : undefined
  }, [])

  // Read at run start, carrying a held Save (VMGR-64); the backend takes variables only with a workflow.
  const buildRunCurrentPayload = useCallback((runNodes?: NodeType[]): {
    workflow?: { nodes: unknown[]; edges: unknown[] }
    variables?: Record<string, unknown>
    function_variables?: FunctionVariablesSeed[]
  } => {
    const { isDirty, nodes, edges, variables } = useWorkflowStore.getState()
    const staged = readStagedOverrides()
    if (!runNodes && !isDirty && staged.size === 0) return {}
    return {
      workflow: { nodes: sanitizeNodesForSave(runNodes ?? nodes), edges: sanitizeEdgesForSave(edges) },
      variables: mergeStagedIntoRunVariables(buildVariablesPayload(variables), staged),
      ...functionVariablesSeed(staged),
    }
  }, [readStagedOverrides])

  // Send skip updates to backend when skippedNodeIds changes during execution
  useEffect(() => {
    if (workbenchStatus !== 'running' && workbenchStatus !== 'paused') return

    const unsub = useWorkflowStore.subscribe(
      (state) => state.skippedNodeIds,
      (skippedNodeIds) => {
        updateWorkbenchSkippedNodes(skippedNodeIds).catch(alreadyReported)
      }
    )
    return unsub
  }, [workbenchStatus, updateWorkbenchSkippedNodes])

  // Quick FE-state probe: returns true when the in-memory nodeIssues map
  // already carries an UNRESOLVED_VARIABLE_REFERENCE on at least one node.
  // Caller uses this to short-circuit the dirty-Save prompt and surface
  // the actionable "Cannot Run Test" dialog directly.
  const hasFeUndeclaredVarBlockers = useCallback((): boolean => {
    const storeState = useWorkflowStore.getState()
    for (const issues of storeState.nodeIssues.values()) {
      for (const issue of issues) {
        if (issue.code === 'UNRESOLVED_VARIABLE_REFERENCE') return true
      }
    }
    return false
  }, [])

  // Shared pre-run validation gate used by both Run and Debug flows. Returns
  // true when validation blocked the run (caller must early-return) and
  // false when the run should proceed.
  const blockIfValidationFails = useCallback(
    async (
      testId: string,
      mode: 'run' | 'debug',
      draft?: BlockDraft,
      runNodes?: NodeType[],
    ): Promise<boolean> => {
      try {
        const storeState = useWorkflowStore.getState()
        const feErrors = undeclaredVariableErrors(storeState.nodeIssues)
        if (storeState.isDirty) {
          feErrors.push(...runBlockingErrors(storeState.nodes, storeState.nodeIssues))
        }

        // The backend checks the body the run sends, as the run start does.
        const { workflow, variables } = buildRunCurrentPayload(runNodes)
        const validation = workflow
          ? await validateTest(testId, 'run', { workflow, variables })
          : await validateTest(testId, 'run')

        const combinedErrors = withBackendFindings(feErrors, validation.errors)
        const scoped = draft && !validation.fatal ? stopsBlockDraft(draft, storeState.nodes) : undefined
        const errors = scoped ? combinedErrors.filter(scoped) : combinedErrors
        if (validation.fatal || errors.length > 0) {
          setValidationErrors(
            errors.map((e) => ({
              ...e,
              severity: 'error' as const,
              functionPath: mapFunctionPath((e as { function_path?: unknown }).function_path),
            }))
          )
          setValidationFatal(validation.fatal)
          setValidationMode(mode)
          setShowValidationErrorDialog(true)
          // Pulse is populated on modal Close (handleValidationClose), not here.
          return true
        }
      } catch (err) {
        // A 404 means the test is gone from storage, which the generic toast
        // would hide. Route it to the same dialog the load path raises.
        if (reportTestNotFound(err, { testId, testName: useWorkflowStore.getState().editingTestName })) {
          return true
        }
        console.error('Pre-run validation failed:', err)
        toast.error('Failed to validate test before running.', 'Validation Error')
        return true
      }
      return false
    },
    [
      toast,
      buildRunCurrentPayload,
      setValidationErrors,
      setValidationFatal,
      setValidationMode,
      setShowValidationErrorDialog,
    ]
  )

  const executeRun = useCallback(
    async (testId: string, environmentId: string) => {
      if (await blockIfValidationFails(testId, 'run')) return
      await startRun({
        testId,
        environmentId,
        skippedNodeIds: gatherSkippedNodeIds(),
        ...buildRunCurrentPayload(),
      })
    },
    [startRun, gatherSkippedNodeIds, blockIfValidationFails, buildRunCurrentPayload]
  )

  const executeDebugRun = useCallback(
    async (testId: string, environmentId: string) => {
      if (await blockIfValidationFails(testId, 'debug')) return
      const storeState = useWorkflowStore.getState()
      await startDebugRun({
        testId,
        environmentId,
        breakpoints: storeState.getBreakpointList(),
        debugOptions: storeState.debugOptions,
        skippedNodeIds: gatherSkippedNodeIds(),
        ...buildRunCurrentPayload(),
      })
    },
    [startDebugRun, gatherSkippedNodeIds, blockIfValidationFails, buildRunCurrentPayload]
  )

  // Pin execution to a single node (Run/Debug Current) or sub-tree entry
  // point (Run/Debug from Here). Run variants force breakpoints empty +
  // pause flags off; Debug variants honor the user's current breakpoint
  // set + debug options.
  const executeAdHocRun = useCallback(
    async (testId: string, environmentId: string, adhoc: PendingAdHoc) => {
      const isDebug = adhoc.action === 'debug-current' || adhoc.action === 'debug-from-here'
      const canvas = useWorkflowStore.getState()
      const draft = adhoc.blockDraft
        ? {
            nodeId: adhoc.nodeId,
            parameters: replacedParameters(canvas.nodes, adhoc.nodeId, adhoc.blockDraft.config.values),
          }
        : undefined
      const runNodes = adhoc.blockDraft
        ? withBlockDraft(canvas.nodes, canvas.drillPath, adhoc.nodeId, adhoc.blockDraft)
        : undefined
      if (await blockIfValidationFails(testId, isDebug ? 'debug' : 'run', draft, runNodes)) return
      const usesStart = adhoc.action === 'run-from-here' || adhoc.action === 'debug-from-here'
      const storeState = useWorkflowStore.getState()
      await startDebugRun({
        testId,
        environmentId,
        breakpoints: isDebug ? storeState.getBreakpointList() : [],
        debugOptions: isDebug
          ? storeState.debugOptions
          : { pauseOnFirstBlock: false, pauseOnErrors: false },
        skippedNodeIds: gatherSkippedNodeIds(),
        ...(usesStart ? { startNodeId: adhoc.nodeId } : { singleNodeId: adhoc.nodeId }),
        ...(draft ? { blockDraft: true } : {}),
        ...selectAdHocFunctionPath(storeState.drillPath),
        ...buildRunCurrentPayload(runNodes),
      })
    },
    [startDebugRun, gatherSkippedNodeIds, blockIfValidationFails, buildRunCurrentPayload]
  )

  // Library View: run/debug the standalone Function (no parent Test). Runs the
  // edit-mode draft when editing, else the pinned published version. Returns
  // true when handled so the Test run/debug guards below are skipped.
  const runStandaloneFromView = useCallback(
    async function runStandaloneFromView(
      envToUse: string | null,
      isDebug: boolean,
    ): Promise<boolean> {
      const viewState = useWorkflowStore.getState()
      const fvm = viewState.functionViewMode
      if (!fvm) return false
      if (!envToUse) {
        toast.warning(
          `Select an environment before ${isDebug ? 'debugging' : 'running'}.`,
          'No Environment Selected',
        )
        return true
      }
      const staged = readStagedOverrides()
      const body = {
        ...resolveViewRunBody(fvm, viewState.drillPath, viewState.nodes),
        environmentId: envToUse,
        // A Current value set before the run is the value the run uses (FNCFG-8).
        ...(staged.size > 0 ? { variables: mergeStagedIntoRunVariables({}, staged) } : {}),
        ...functionVariablesSeed(staged),
      }
      await runStandaloneFunction(
        isDebug ? { ...body, debug: { breakpoints: viewState.getBreakpointList() } } : body,
      )
      return true
    },
    [runStandaloneFunction, toast, readStagedOverrides],
  )

  // Handle Run button click
  /* v8 ignore start - COV-CONTAINER-014 */
  const handleRun = useCallback(
    async function runWorkbench(scope: 'current' | 'all', environmentOverride?: string) {
      const envToUse = environmentOverride || selectedEnvironment
      if (await runStandaloneFromView(envToUse, false)) return

      if (!editingTestId) {
        toast.warning('Save the test before running.', 'Cannot Run Draft')
        return
      }

      if (!envToUse) {
        toast.warning('Select an environment before running.', 'No Environment Selected')
        return
      }

      // Run Scope drilled into a Function routes through startRun so the FE subscribes to the WS topic.
      if (scope === 'current') {
        const drillPath = useWorkflowStore.getState().drillPath
        const dispatch = selectRunScopeDispatch({ drillPath })
        if (dispatch.mode === 'function' && dispatch.scopedFunctionNodeId) {
          if (await blockIfValidationFails(editingTestId, 'run')) return
          await startRun({
            testId: editingTestId,
            environmentId: envToUse,
            skippedNodeIds: gatherSkippedNodeIds(),
            scopeMode: 'function',
            scopedFunctionNodeId: dispatch.scopedFunctionNodeId,
            functionPath: dispatch.functionPath,
            ...buildRunCurrentPayload(),
          })
          return
        }
      }

      // FE-side validation pre-check: surface UNRESOLVED_VARIABLE_REFERENCE
      // issues as "Cannot Run Test" before the dirty-state prompt. The
      // dirty Save-and-Run path would just round-trip through BE 422 with
      // the same error, so we short-circuit here to give the user the
      // actionable dialog directly (Fix All restores the variable inline).
      if (hasFeUndeclaredVarBlockers()) {
        const blocked = await blockIfValidationFails(editingTestId, 'run')
        if (blocked) return
      }

      // A dirty canvas runs its in-memory body directly (no run-confirm
      // modal); buildRunCurrentPayload inside executeRun attaches it.
      await executeRun(editingTestId, envToUse)
    },
    [editingTestId, selectedEnvironment, executeRun, hasFeUndeclaredVarBlockers, blockIfValidationFails, startRun, gatherSkippedNodeIds, buildRunCurrentPayload, runStandaloneFromView, toast]
  )
  /* v8 ignore stop */

  // Handle Debug button click. Mirrors handleRun guardrails (editingTestId,
  // env selection, isDirty confirm dialog) but drives the debug-run branch.
  const handleDebug = useCallback(
    async function debugWorkbench(scope: 'current' | 'all', environmentOverride?: string) {
      const envToUse = environmentOverride || selectedEnvironment
      if (await runStandaloneFromView(envToUse, true)) return

      if (!editingTestId) {
        toast.warning('Save the test before debugging.', 'Cannot Debug Draft')
        return
      }

      if (!envToUse) {
        toast.warning('Select an environment before debugging.', 'No Environment Selected')
        return
      }

      // Same scope-aware routing as handleRun: when the user is drilled
      // into a Function and picks Debug Scope, route through startDebugRun
      // with the scope payload so the FE subscribes to the WS topic the
      // BE creates.
      if (scope === 'current') {
        const drillPath = useWorkflowStore.getState().drillPath
        const dispatch = selectRunScopeDispatch({ drillPath })
        if (dispatch.mode === 'function' && dispatch.scopedFunctionNodeId) {
          if (await blockIfValidationFails(editingTestId, 'debug')) return
          const storeState = useWorkflowStore.getState()
          await startDebugRun({
            testId: editingTestId,
            environmentId: envToUse,
            breakpoints: storeState.getBreakpointList(),
            debugOptions: storeState.debugOptions,
            skippedNodeIds: gatherSkippedNodeIds(),
            scopeMode: 'function',
            scopedFunctionNodeId: dispatch.scopedFunctionNodeId,
            functionPath: dispatch.functionPath,
            ...buildRunCurrentPayload(),
          })
          return
        }
      }

      // Same FE-side pre-check as handleRun - surface validation blockers first.
      if (hasFeUndeclaredVarBlockers()) {
        const blocked = await blockIfValidationFails(editingTestId, 'debug')
        if (blocked) return
      }

      // A dirty canvas debugs its in-memory body directly (no modal).
      await executeDebugRun(editingTestId, envToUse)
    },
    [editingTestId, selectedEnvironment, executeDebugRun, startDebugRun, gatherSkippedNodeIds, hasFeUndeclaredVarBlockers, blockIfValidationFails, buildRunCurrentPayload, runStandaloneFromView, toast]
  )

  // Right-click ad-hoc dispatcher. Same guardrails as ``handleRun`` /
  // ``handleDebug`` (editingTestId, env selection, isDirty confirm dialog),
  // but the executed branch is the ``executeAdHocRun`` flow that pins the
  // engine to a single node or sub-tree entry point.
  const handleAdHocRun = useCallback(
    async (action: AdHocAction, nodeId: string, options?: AdHocRunOptions) => {
      if (!editingTestId) {
        toast.warning('Save the test before running.', 'Cannot Run Draft')
        return
      }

      const environmentId = options?.environmentId ?? selectedEnvironment
      if (!environmentId) {
        toast.warning('Select an environment before running.', 'No Environment Selected')
        return
      }

      // A dirty canvas runs its in-memory body directly (no run-confirm
      // modal); executeAdHocRun attaches the run-current payload.
      await executeAdHocRun(editingTestId, environmentId, {
        action,
        nodeId,
        blockDraft: options?.blockDraft,
      })
    },
    [editingTestId, selectedEnvironment, executeAdHocRun, toast]
  )

  const [showStopConfirmDialog, setShowStopConfirmDialog] = useState(false)
  const [pendingStopMode, setPendingStopMode] = useState<'immediate' | 'finalize'>('immediate')

  // Both Stop modes route to the same backend path. The `mode` argument is
  // accepted for UI parity with the design; behavioral differentiation lives
  // in the backend when the finalize pipeline is present. Stop is
  // confirmation-gated.
  const handleStop = useCallback(
    async function requestStopWorkbench(mode: 'immediate' | 'finalize') {
      setPendingStopMode(mode)
      setShowStopConfirmDialog(true)
    },
    []
  )

  const handleStopConfirmCancel = useCallback(() => {
    setShowStopConfirmDialog(false)
  }, [])

  const handleStopConfirm = useCallback(
    async (_mode: 'immediate' | 'finalize') => {
      setShowStopConfirmDialog(false)
      await stopWorkbenchRun()
    },
    [stopWorkbenchRun]
  )

  return {
    showStopConfirmDialog,
    pendingStopMode,
    handleRun,
    handleDebug,
    handleAdHocRun,
    adHocOffered: !isMirroring && !!editingTestId,
    handleStop,
    handleStopConfirmCancel,
    handleStopConfirm,
  }
}
