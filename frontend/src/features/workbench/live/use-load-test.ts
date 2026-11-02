/**
 * Load Test Hook - Fetches test data from API and loads it into the canvas
 *
 * Handles fetching test details, workflow, validation, and system variables,
 * then reconciles output bindings and auto-creates missing variables.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useWorkflowStore, type WorkflowVariable, type NamespaceEntry } from '@/features/workbench/stores/workflow-store'
import {
  mapFunctionPath,
  type ValidationError,
  type ValidationDialogMode,
} from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import { getInputParams, getOutputParams } from '@/features/workbench/lib/node-parameters'
import { PARAM_TYPE_TO_VAR_TYPE } from '@/features/workbench/lib/node-parameters/types'
import { resolveOutputTypes } from '@/features/workbench/lib/node-parameters/output-type'
import { secureRandomId } from '@/lib/utils'
import { convertBackendVariables, convertSystemVariables } from './variable-helpers'
import { canvasLocalFunctionBodies } from '@/features/workbench/lib/canonical-workflow'
import { fetchTest, fetchTestWorkflow } from '@/features/tests/api/crud'
import { validateTest } from '@/features/tests/api/validation'
import { fetchSystemVariables } from '@/features/settings/api/global-variables/crud'
import {
  FUNCTION_VERSIONS_LABEL,
  readFunctionVersions,
  versionsDetail,
  type VersionReadFailure,
} from './function-versions'
import {
  sharedFunctionIds,
  stampSharedFunctionContracts,
} from '@/features/workbench/lib/shared-function-contracts'
import { usePageBlock } from '@/hooks/use-page-block'
import { toFailureDetail } from '@/lib/failure-detail'
import type { FailedRead } from '@/stores/page-block-store'
import { reportTestNotFound } from '@/features/workbench/stores/deleted-test-store'

const TEST_LABEL = 'test'
const VALIDATION_LABEL = 'test validation'
const SYSTEM_VARIABLES_LABEL = 'system variables'
const PARSER_LABEL = 'expression validation'

/** The expression parser the canvas needs to raise undeclared-variable alerts.
 *  Without it every expression extracts no identifiers, so a test with bad
 *  references renders as a test with none. */
async function loadExpressionParser(): Promise<void> {
  const { initializeTreeSitter } = await import('@/features/workbench/lib/tree-sitter-init')
  await initializeTreeSitter()
}

type ValidationRead = Awaited<ReturnType<typeof validateTest>>
type SystemVariablesRead = Awaited<ReturnType<typeof fetchSystemVariables>>

/** A settled read: `ok` is the only thing that says it succeeded, so a read that
 *  resolves with null is a success and not a failure. */
type ReadOutcome<T> = { ok: true; value: T } | { ok: false; reason: unknown }

/** The reads that are not the test itself, plus what to do once they all succeed. */
interface SupportingLoad {
  testId: string
  apply: (validation: ValidationRead, systemVars: SystemVariablesRead) => Promise<void>
  block: (failure: FailedRead) => void
  clear: (label: string) => void
  /** False once the canvas that started the load is gone. */
  active: () => boolean
}

/** One in-flight load. Retries mutate it so concurrent ones see each other. */
interface SupportingState {
  load: SupportingLoad
  validation: ReadOutcome<ValidationRead>
  systemVars: ReadOutcome<SystemVariablesRead>
  parser: ReadOutcome<void>
  applied: boolean
}

function toOutcome<T>(result: PromiseSettledResult<T>): ReadOutcome<T> {
  if (result.status === 'fulfilled') return { ok: true, value: result.value }
  return { ok: false, reason: result.reason }
}

function reportRead(
  load: SupportingLoad,
  label: string,
  outcome: ReadOutcome<unknown>,
  retry: () => Promise<void>,
): void {
  if (outcome.ok) {
    load.clear(label)
    return
  }
  load.block({ label, detail: toFailureDetail(outcome.reason), retry })
}

async function applySupportingReads(state: SupportingState): Promise<void> {
  if (!state.load.active()) return
  reportRead(state.load, VALIDATION_LABEL, state.validation, () => retryValidation(state))
  reportRead(state.load, SYSTEM_VARIABLES_LABEL, state.systemVars, () => retrySystemVariables(state))
  reportRead(state.load, PARSER_LABEL, state.parser, () => retryParser(state))
  if (!state.validation.ok || !state.systemVars.ok || !state.parser.ok || state.applied) return
  state.applied = true
  await state.load.apply(state.validation.value, state.systemVars.value)
}

async function retryValidation(state: SupportingState): Promise<void> {
  const [result] = await Promise.allSettled([validateTest(state.load.testId)])
  state.validation = toOutcome(result)
  await applySupportingReads(state)
  if (result.status === 'rejected') throw result.reason
}

async function retrySystemVariables(state: SupportingState): Promise<void> {
  const [result] = await Promise.allSettled([fetchSystemVariables()])
  state.systemVars = toOutcome(result)
  await applySupportingReads(state)
  if (result.status === 'rejected') throw result.reason
}

async function retryParser(state: SupportingState): Promise<void> {
  const [result] = await Promise.allSettled([loadExpressionParser()])
  state.parser = toOutcome(result)
  await applySupportingReads(state)
  if (result.status === 'rejected') throw result.reason
}

async function applyVersionStamp(load: SupportingLoad): Promise<VersionReadFailure[]> {
  const failures = await stampMissingFunctionVersions()
  if (!load.active()) return failures
  if (failures.length === 0) {
    load.clear(FUNCTION_VERSIONS_LABEL)
    return failures
  }
  load.block({
    label: FUNCTION_VERSIONS_LABEL,
    detail: versionsDetail(failures),
    retry: () => retryVersionStamp(load),
  })
  return failures
}

async function retryVersionStamp(load: SupportingLoad): Promise<void> {
  const failures = await applyVersionStamp(load)
  if (failures.length > 0) throw failures[0].reason
}

export interface LoadTestResult {
  isLoadingTest: boolean
  loadTest: (testId: string, options?: { silentNotFound?: boolean }) => Promise<void>
}

/** Options for handleValidationResult */
interface ValidationResultOptions {
  validation: { fatal: boolean; errors: Array<{ node_id?: string }>; warnings: Array<unknown> }
  testId: string
  testDetails: { name: string }
  setEditingTest: (id: string, name: string) => void
  setValidationErrors: (errors: ValidationError[]) => void
  setValidationFatal: (fatal: boolean) => void
  setValidationMode: (mode: ValidationDialogMode) => void
  setShowValidationErrorDialog: (show: boolean) => void
}

/** Check validation result and show error dialog if fatal or errors exist.
 * Returns true ONLY when fatal (load must stop). Non-fatal errors render the
 * dialog over the canvas - the test still loads so the user can Cancel and
 * keep working with the per-node alerts, or click Fix to repair the workflow. */
function handleValidationResult(opts: ValidationResultOptions): boolean {
  const { validation, testId, testDetails, setEditingTest, setValidationErrors, setValidationFatal, setValidationMode, setShowValidationErrorDialog } = opts
  if (!validation || (!validation.fatal && validation.errors.length === 0)) return false

  setEditingTest(testId, testDetails.name)
  setValidationErrors(
    validation.errors.map((error) => ({
      ...(error as ValidationError),
      functionPath: mapFunctionPath((error as { function_path?: unknown }).function_path),
    })),
  )
  setValidationFatal(validation.fatal)
  setValidationMode('load')
  setShowValidationErrorDialog(true)
  return validation.fatal
}

type PositionedNode = { position?: { x?: unknown; y?: unknown } }

function toFiniteCoordinate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** React Flow reads position.x on every node, so a missing one crashes the canvas. */
function withSafePositions(nodes: unknown[]): unknown[] {
  return (nodes as PositionedNode[]).map((n) => ({
    ...n,
    position: { x: toFiniteCoordinate(n.position?.x), y: toFiniteCoordinate(n.position?.y) },
  }))
}

/** Load test variables into the store */
function loadTestVariables(
  testDetails: { variables?: Record<string, unknown> },
  setVariables: (vars: WorkflowVariable[], opts?: { skipDirty?: boolean }) => void,
): void {
  if (testDetails.variables && Object.keys(testDetails.variables).length > 0) {
    const loadedVariables = convertBackendVariables(testDetails.variables as Record<string, { type: string; value?: unknown; [key: string]: unknown }>)
    setVariables(loadedVariables, { skipDirty: true })
  } else {
    setVariables([], { skipDirty: true })
  }
}

/** Store system variables as namespace entries for autocomplete */
function storeSystemNamespaceEntries(
  systemVars: Record<string, unknown>,
  setNamespaceVariables: (namespace: 'system', entries: ReturnType<typeof convertSystemVariables>) => void,
): void {
  if (!systemVars || Object.keys(systemVars).length === 0) return

  const entries = convertSystemVariables(
    systemVars as Record<string, { type: string; value: unknown; secret?: boolean }>,
  )
  setNamespaceVariables('system', entries)
}

/** Convert pre-merged suite variables from the test detail response to namespace entries */
function storeNamespaceEntries(
  namespace: 'suite' | 'regression',
  variables: Array<{ name: string; type: string }>,
  setNamespaceVariables: (namespace: 'suite' | 'regression', entries: NamespaceEntry[]) => void,
): void {
  const entries: NamespaceEntry[] = variables.map((v) => ({ name: v.name, type: v.type }))
  setNamespaceVariables(namespace, entries)
}

export function useLoadTest(
  clearDraft: () => void,
  setValidationErrors: (errors: ValidationError[]) => void,
  setValidationFatal: (fatal: boolean) => void,
  setValidationMode: (mode: ValidationDialogMode) => void,
  setShowValidationErrorDialog: (show: boolean) => void,
): LoadTestResult {

  const reset = useWorkflowStore((state) => state.reset)
  const setNodes = useWorkflowStore((state) => state.setNodes)
  const setEdges = useWorkflowStore((state) => state.setEdges)
  const setVariables = useWorkflowStore((state) => state.setVariables)
  const markSaved = useWorkflowStore((state) => state.markSaved)
  const requestFitView = useWorkflowStore((state) => state.requestFitView)
  const setCanvasReady = useWorkflowStore((state) => state.setCanvasReady)
  const setEditingTest = useWorkflowStore((state) => state.setEditingTest)
  const setEditingTestSuiteIds = useWorkflowStore((state) => state.setEditingTestSuiteIds)
  const setNamespaceVariables = useWorkflowStore((state) => state.setNamespaceVariables)

  const [isLoadingTest, setIsLoadingTest] = useState(false)
  const { blockPage, clearPageBlock } = usePageBlock()

  // A load applies to the canvas that started it; once that canvas is gone the
  // result must not reach the global store or raise a card nobody can clear.
  const activeRef = useRef(true)
  // The card's retry re-runs the load, which reports its own failure, so the outcome comes back here.
  const loadFailureRef = useRef<unknown>(undefined)
  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
    }
  }, [])

  const loadTest = useCallback(
    async function loadTestById(testId: string, options?: { silentNotFound?: boolean }) {
      setIsLoadingTest(true)
      // Immediately hide the old canvas and show overlay before async fetch
      setCanvasReady(false)
      try {
        // The parser is warmed with the reads so the live
        // UNRESOLVED_VARIABLE_REFERENCE check (computeNodeIssues ->
        // extractIdentifiers) can detect undeclared refs on the first render.
        const supportingSettled = Promise.allSettled([
          validateTest(testId),
          fetchSystemVariables(),
          loadExpressionParser(),
        ])
        // A failed primary reports as soon as it settles, never behind a supporting read.
        const [detailsResult, workflowResult] = await Promise.allSettled([
          fetchTest(testId),
          fetchTestWorkflow(testId),
        ])

        if (detailsResult.status === 'rejected') throw detailsResult.reason
        if (workflowResult.status === 'rejected') throw workflowResult.reason
        const testDetails = detailsResult.value
        const workflow = workflowResult.value
        loadFailureRef.current = undefined
        clearPageBlock(TEST_LABEL)

        const applyLoadedTest = async (
          validation: ValidationRead,
          systemVars: SystemVariablesRead,
        ) => {
          // If validation found issues, show appropriate dialog (no toast for warnings;
          // visible-class issues are conveyed via per-node alert icons).
          if (handleValidationResult({
            validation, testId, testDetails, setEditingTest,
            setValidationErrors, setValidationFatal, setValidationMode,
            setShowValidationErrorDialog,
          })) return

          // Reset canvas first
          reset()

          // Store the test ID and name in store
          setEditingTest(testId, testDetails.name)
          setEditingTestSuiteIds(testDetails.suite_ids ?? [])

          // Positions are only coerced after validation ran, which reports the
          // bad ones and offers Fix All to write real ones back.
          if (workflow.nodes && workflow.nodes.length > 0) {
            const safeNodes = canvasLocalFunctionBodies(withSafePositions(workflow.nodes))
            setNodes(safeNodes as Parameters<typeof setNodes>[0], { skipDirty: true })
          }
          if (workflow.edges && workflow.edges.length > 0) {
            setEdges(workflow.edges as Parameters<typeof setEdges>[0], { skipDirty: true })
          }

          // Load variables from the test
          loadTestVariables(testDetails, setVariables)

          // Store system variables as namespace entries (read-only, for autocomplete)
          storeSystemNamespaceEntries(systemVars, setNamespaceVariables)

          // Store suite and regression variables as namespace entries (read-only, for autocomplete)
          storeNamespaceEntries('suite', testDetails.suite_variables ?? [], setNamespaceVariables)
          storeNamespaceEntries('regression', testDetails.regression_variables ?? [], setNamespaceVariables)

          // Reconcile: auto-create missing variables and fix type mismatches
          reconcileOutputBindingVariables(setVariables, reportedUndeclaredNames(validation))

          // Stamp Shared instances whose pinned version is gone from the library
          // so the canvas alert + config-modal banner surface the missing pin.
          await applyVersionStamp(supporting)

          // Mark as saved since we just loaded it
          markSaved()
          clearDraft()
          requestFitView({ padding: 0.2, duration: 0 })
        }

        const supporting: SupportingLoad = {
          testId,
          apply: applyLoadedTest,
          block: blockPage,
          clear: clearPageBlock,
          active: () => activeRef.current,
        }

        const [validationResult, systemVarsResult, parserResult] = await supportingSettled
        await applySupportingReads({
          load: supporting,
          validation: toOutcome(validationResult),
          systemVars: toOutcome(systemVarsResult),
          parser: toOutcome(parserResult),
          applied: false,
        })
      } catch (err) {
        loadFailureRef.current = err
        const apiErr = err as { status?: number } | undefined
        if (apiErr?.status === 404) {
          // silentNotFound is set by background session recovery - the user
          // did not explicitly ask to open this test, so a blocking modal
          // would be incorrect. Just clean up silently.
          if (options?.silentNotFound) {
            setCanvasReady(true)
            return
          }
          // Do NOT call reset() - preserve the FE state so Restore can keep the user's work
          setCanvasReady(true)
          reportTestNotFound(err, { testId, testName: useWorkflowStore.getState().editingTestName })
          return
        }
        if (activeRef.current) {
          // Nothing of the test loaded, so the canvas has nothing to show.
          blockPage({
            label: TEST_LABEL,
            detail: toFailureDetail(err),
            retry: async () => {
              await loadTestById(testId, options)
              if (loadFailureRef.current !== undefined) throw loadFailureRef.current
            },
          })
        }
        console.error('Failed to load test:', err)
        requestFitView({ padding: 0.2, duration: 0 })
      } finally {
        setIsLoadingTest(false)
      }
    },
    [reset, setNodes, setEdges, setVariables, markSaved, clearDraft, setEditingTest, setEditingTestSuiteIds, requestFitView, setCanvasReady, setNamespaceVariables, blockPage, clearPageBlock]
  )

  return { isLoadingTest, loadTest }
}

/** Process a single node's output bindings, collecting missing vars and type fixes */
function collectNodeBindingFixes(
  node: { data: Record<string, unknown> },
  varsByName: Map<string, WorkflowVariable>,
  missingVars: WorkflowVariable[],
  typeFixIds: Map<string, string>,
) {
  const config = node.data.config as Record<string, unknown> | undefined
  const bindings = config?.outputBindings as Record<string, string> | undefined
  if (!bindings) return

  const elementType = (node.data.elementType as string) || ''
  const outputs = getOutputParams(elementType)
  const outputTypes = resolveOutputTypes(
    outputs ?? [],
    (config?.values ?? {}) as Record<string, unknown>,
    getInputParams(elementType),
  )

  for (const [paramName, varName] of Object.entries(bindings)) {
    if (!varName) continue
    // An output the schema does not declare (a script variable) carries no type.
    const paramType = outputTypes.get(paramName)
    const expectedVarType = (PARAM_TYPE_TO_VAR_TYPE[paramType ?? 'string'] ?? 'string') as WorkflowVariable['type']

    const existingVar = varsByName.get(varName)
    if (!existingVar && !missingVars.some((v) => v.name === varName)) {
      // A bound target is written by the Block at run time: declare it holding null.
      missingVars.push({
        id: `var-${varName}-${Date.now()}-${secureRandomId(7)}`,
        name: varName,
        type: expectedVarType,
      })
    } else if (existingVar && paramType !== undefined && existingVar.type !== expectedVarType) {
      typeFixIds.set(existingVar.id, expectedVarType)
    }
  }
}

const VARIABLE_PATH_PREFIX = 'variables.'
const NO_REPORTED_NAMES: ReadonlySet<string> = new Set()

/** The variables the load's validation reports as undeclared; declaring one is the user's Fix All. */
function reportedUndeclaredNames(validation: ValidationRead): ReadonlySet<string> {
  if (!validation) return NO_REPORTED_NAMES
  return new Set(
    validation.errors
      .filter((error) => error.code === 'UNDECLARED_VARIABLE')
      .map((error) => error.path.slice(VARIABLE_PATH_PREFIX.length)),
  )
}

/**
 * Reconcile output bindings: auto-create missing variables and fix type mismatches.
 * Uses control metadata to determine correct variable types.
 */
export function reconcileOutputBindingVariables(
  setVariables: (vars: WorkflowVariable[], opts?: { skipDirty?: boolean }) => void,
  reported: ReadonlySet<string> = NO_REPORTED_NAMES,
) {
  const currentVars = useWorkflowStore.getState().variables
  const varsByName = new Map(currentVars.map((v) => [v.name, v]))
  const allNodes = useWorkflowStore.getState().nodes
  const collected: WorkflowVariable[] = []
  const typeFixIds = new Map<string, string>()

  for (const node of allNodes) {
    collectNodeBindingFixes(node as { data: Record<string, unknown> }, varsByName, collected, typeFixIds)
  }
  const missingVars = collected.filter((v) => !reported.has(v.name))

  if (missingVars.length > 0 || typeFixIds.size > 0) {
    const fixedVars = currentVars.map((v) => {
      const fixedType = typeFixIds.get(v.id)
      /* v8 ignore next - COV-BRANCH-122 */
      return fixedType ? { ...v, type: fixedType as typeof v.type } : v
    })
    setVariables([...fixedVars, ...missingVars], { skipDirty: true })
  }
}

/**
 * Post-load pass: read the library versions of every Shared Function instance at any depth,
 * stamp `missingVersion` on an instance pinned to a version that no longer exists and the
 * pinned contract (`resolvedInputs` / `resolvedOutputs`) on the others. Drives the canvas
 * alert, the config-modal banner, the disabled Edit / Make Local kebab actions and the
 * instance's call sheet. Returns the reads that failed, so a Function whose versions are
 * unknown is never presented as one that resolved.
 */
export async function stampMissingFunctionVersions(): Promise<VersionReadFailure[]> {
  const functionIds = sharedFunctionIds(useWorkflowStore.getState().nodes)
  if (functionIds.length === 0) return []
  const { versions, failures } = await readFunctionVersions(functionIds)
  const { nodes, setNodes } = useWorkflowStore.getState()
  const stamped = stampSharedFunctionContracts(nodes, versions)
  if (stamped !== nodes) setNodes(stamped, { skipDirty: true })
  return failures
}
