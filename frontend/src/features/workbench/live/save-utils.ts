/**
 * Shared utilities for workbench save/run/close hooks
 *
 * Extracts duplicated variable transformation and error handling logic
 * used across use-test-save, use-test-run, and use-test-close.
 */

import { useWorkflowStore, type WorkflowVariable } from '@/features/workbench/stores/workflow-store'
import { reportTestNotFound } from '@/features/workbench/stores/deleted-test-store'
import {
  mapFunctionPath,
  type ValidationError,
  type ValidationDialogMode,
} from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import {
  canonicalizeNodes,
  canonicalizeEdges,
  storedLocalFunctionBodies,
  storedVariableEntry,
  type VariableEntry,
} from '@/features/workbench/lib/canonical-workflow'
import { isSealedMapCredential, isSealedSecret } from '@/lib/secret-envelope'
import { usePageBlockStore } from '@/stores/page-block-store'
import { toFailureDetail } from '@/lib/failure-detail'

/** The re-sync runs outside React, so it reports under a fixed owner that the
 *  workbench lifecycle retires when the canvas goes. */
export const SAVE_RESYNC_OWNER = 'workbench-save-resync'
const SAVED_TEST_LABEL = 'saved test'

/** Toast interface - the subset of useToast() needed by handleSaveError */
export interface ToastHandle {
  error: (message: string, title?: string) => void
}

/** Callbacks that handleSaveError invokes to surface validation errors in the UI */
export interface SaveErrorHandlers {
  setValidationErrors: (errors: ValidationError[]) => void
  setValidationFatal: (fatal: boolean) => void
  setValidationMode: (mode: ValidationDialogMode) => void
  setShowValidationErrorDialog: (show: boolean) => void
}

/** Reduce nodes to the persistence shape at every depth: strips
 *  selection/drag residue, folds/strips Shared bodies and stores Function locals. */
export function sanitizeNodesForSave<T extends { data: Record<string, unknown> }>(nodes: T[]): T[] {
  return storedLocalFunctionBodies(canonicalizeNodes(nodes))
}

/**
 * Strip transient UI fields from edges before persisting to the backend.
 *
 * Removes top-level `selected` (added by React Flow's applyEdgeChanges
 * on selection events).
 */
export function sanitizeEdgesForSave<T extends object>(edges: T[]): T[] {
  return canonicalizeEdges(edges)
}

/**
 * Build the variables payload for the backend API from workflow variables.
 *
 * Maps workflow variables into the record format expected by
 * createTest / updateTest endpoints.
 */
export function buildVariablesPayload(
  variables: WorkflowVariable[],
): Record<string, VariableEntry> {
  return Object.fromEntries(variables.map((v) => [v.name, storedVariableEntry(v)]))
}

/** A workbench canvas node carrying plugin config values. */
type NodeWithConfig = { id: string; data: Record<string, unknown> }

/** The sealed (`wave:enc:v1:`) values a node re-syncs after a save: top-level
 *  scalar credential params (`config.values[key]`) and, for a Variable Setter,
 *  the sealed entries in its variables map (`config.values.variables[key]`). */
interface NodeSealedSecrets {
  params: Record<string, unknown>
  setterVars: Record<string, unknown>
}

/** A Variable Setter's own secrets live under this key and re-sync separately. */
const SETTER_VARIABLES_KEY = 'variables'

function sealedEntries(source: Record<string, unknown>, skipKey?: string): Record<string, unknown> {
  const sealed: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(source)) {
    if (key === skipKey) continue
    if (isSealedSecret(val) || isSealedMapCredential(val)) sealed[key] = val
  }
  return sealed
}

type WorkflowNodeShape = {
  id: string
  data?: { config?: { values?: Record<string, unknown> }; localDefinition?: unknown }
}

/** The Blocks of a Local Function body, saved and sealed with the Test like the root ones. */
function bodyNodesOf<N>(data: { localDefinition?: unknown } | undefined): N[] | undefined {
  const body = data?.localDefinition as { workflow?: { nodes?: N[] } } | undefined
  return body?.workflow?.nodes
}

/** Collect sealed values per node id, every Local Function body included. */
function collectSealedValuesByNode(
  workflowNodes: WorkflowNodeShape[],
  sealedByNode = new Map<string, NodeSealedSecrets>(),
): Map<string, NodeSealedSecrets> {
  for (const node of workflowNodes) {
    collectSealedValuesByNode(bodyNodesOf<WorkflowNodeShape>(node.data) ?? [], sealedByNode)
    const values = node.data?.config?.values
    if (!values) continue
    const params = sealedEntries(values, SETTER_VARIABLES_KEY)
    // A Variable Setter's secrets live in config.values.variables (a name->value
    // map); other nodes have no such key. sealedEntries safely ignores non-sealed
    // entries, so a plain truthy guard suffices.
    const vars = values[SETTER_VARIABLES_KEY]
    const setterVars = vars ? sealedEntries(vars as Record<string, unknown>) : {}
    if (Object.keys(params).length > 0 || Object.keys(setterVars).length > 0) {
      sealedByNode.set(node.id, { params, setterVars })
    }
  }
  return sealedByNode
}

/** One node with its sealed values patched in, or the node itself when nothing differs. */
function patchNode<T extends NodeWithConfig>(node: T, sealed: NodeSealedSecrets | undefined): T {
  if (!sealed) return node
  const config = (node.data.config ?? {}) as { values?: Record<string, unknown> }
  const nextValues = { ...config.values }
  let nodeChanged = applySealed(nextValues, sealed.params)
  if (Object.keys(sealed.setterVars).length > 0) {
    const nextVars = { ...(nextValues.variables as Record<string, unknown> | undefined) }
    if (applySealed(nextVars, sealed.setterVars)) {
      nextValues.variables = nextVars
      nodeChanged = true
    }
  }
  if (!nodeChanged) return node
  return { ...node, data: { ...node.data, config: { ...config, values: nextValues } } }
}

/** The nodes with their sealed values patched in, Local Function bodies walked the same way; untouched nodes keep their reference. */
function patchNodes<T extends NodeWithConfig>(nodes: T[], sealedByNode: Map<string, NodeSealedSecrets>): T[] {
  let changed = false
  const patched = nodes.map((node) => {
    let next = patchNode(node, sealedByNode.get(node.id))
    const inner = bodyNodesOf<NodeWithConfig>(next.data)
    if (inner) {
      const innerNext = patchNodes(inner, sealedByNode)
      if (innerNext !== inner) {
        const body = next.data.localDefinition as { workflow: Record<string, unknown> }
        next = {
          ...next,
          data: { ...next.data, localDefinition: { ...body, workflow: { ...body.workflow, nodes: innerNext } } },
        }
      }
    }
    if (next !== node) changed = true
    return next
  })
  return changed ? patched : nodes
}

/** A sealed map is a fresh object every fetch, so identity would always differ. */
function sameSealedValue(current: unknown, next: unknown): boolean {
  if (current === next) return true
  if (!isSealedMapCredential(current) || !isSealedMapCredential(next)) return false
  const held = current as Record<string, unknown>
  const fetched = next as Record<string, unknown>
  const keys = Object.keys(fetched)
  return (
    keys.length === Object.keys(held).length && keys.every((key) => held[key] === fetched[key])
  )
}

/** Overwrite `target[key]` with each sealed value that differs; returns whether
 *  anything changed. */
function applySealed(target: Record<string, unknown>, sealed: Record<string, unknown>): boolean {
  let changed = false
  for (const [key, val] of Object.entries(sealed)) {
    if (!sameSealedValue(target[key], val)) {
      target[key] = val
      changed = true
    }
  }
  return changed
}

/** Patch sealed secret values back into the canvas after a save; must run before `markSaved()` (REQ-3.1.3.18). */
export async function resyncSealedNodeSecrets<T extends NodeWithConfig>(
  testId: string,
  nodes: T[],
  setNodeTree: (nodes: T[], options?: { skipDirty?: boolean }) => void,
): Promise<void> {
  try {
    await applySealedNodeSecrets(testId, nodes, setNodeTree)
  } catch (err) {
    reportResyncFailure(testId, nodes, setNodeTree, err)
    return
  }
  usePageBlockStore.getState().clearBlock(SAVE_RESYNC_OWNER, SAVED_TEST_LABEL)
}

/** The blocked canvas is inert, so the nodes a retry patches cannot have been
 *  edited between the failure and the retry. */
function reportResyncFailure<T extends NodeWithConfig>(
  testId: string,
  nodes: T[],
  setNodeTree: (nodes: T[], options?: { skipDirty?: boolean }) => void,
  reason: unknown,
): void {
  usePageBlockStore.getState().setBlock({
    owner: SAVE_RESYNC_OWNER,
    label: SAVED_TEST_LABEL,
    detail: toFailureDetail(reason),
    retry: () => retryResync(testId, nodes, setNodeTree),
  })
}

async function retryResync<T extends NodeWithConfig>(
  testId: string,
  nodes: T[],
  setNodeTree: (nodes: T[], options?: { skipDirty?: boolean }) => void,
): Promise<void> {
  try {
    await applySealedNodeSecrets(testId, nodes, setNodeTree)
  } catch (err) {
    reportResyncFailure(testId, nodes, setNodeTree, err)
    throw err
  }
  usePageBlockStore.getState().clearBlock(SAVE_RESYNC_OWNER, SAVED_TEST_LABEL)
}

async function applySealedNodeSecrets<T extends NodeWithConfig>(
  testId: string,
  nodes: T[],
  setNodeTree: (nodes: T[], options?: { skipDirty?: boolean }) => void,
): Promise<void> {
  const { fetchTestWorkflow } = await import('@/features/tests/api/crud')
  const workflow = await fetchTestWorkflow(testId)
  const sealedByNode = collectSealedValuesByNode((workflow.nodes ?? []) as WorkflowNodeShape[])
  if (sealedByNode.size === 0) return
  const patched = patchNodes(nodes, sealedByNode)
  if (patched !== nodes) setNodeTree(patched, { skipDirty: true })
}

/** The open test is gone from storage. That is a product state the dialog owns,
 *  not an unknown failure, so it never reaches the toast or the console. */
function reportedAsDeletedTest(err: unknown): boolean {
  const { editingTestId, editingTestName } = useWorkflowStore.getState()
  if (!editingTestId) return false
  return reportTestNotFound(err, { testId: editingTestId, testName: editingTestName })
}

/**
 * Handle common save/update API errors.
 *
 * A 404 on the open test raises the "Test not found" dialog.
 *
 * Recognizes the 422 validation-details shape: maps details to
 * ValidationError[], sets validation dialog state, and highlights the
 * offending node IDs on the canvas
 *
 * Every other shape - a 500, a dropped connection, a conflict - is a failed
 * save the user pressed a button for, so it is reported on a toast.
 *
 * @param err - The caught error from the API call
 * @param toast - Toast handle for showing error messages
 * @param handlers - Optional validation-error callbacks. When omitted, a 422
 *   carrying details is reported on the toast instead of the dialog.
 * @param consoleLabel - Label for the console.warn diagnostic
 */
export function handleSaveError(
  err: unknown,
  toast: ToastHandle,
  handlers?: SaveErrorHandlers,
  consoleLabel = 'Direct save failed:',
): void {
  if (reportedAsDeletedTest(err)) return

  const apiErr = err as {
    status?: number
    code?: string
    details?: Array<Record<string, unknown>>
  }

  if (apiErr.status === 422 && apiErr.details?.length && handlers) {
    handlers.setValidationErrors(
      apiErr.details.map((d) => ({
        path: String((d.path as string | undefined) ?? ''),
        node_id: d.node_id as string | undefined,
        node_label: d.node_label as string | undefined,
        element_type: d.element_type as string | undefined,
        code: String((d.code as string | undefined) ?? 'UNKNOWN'),
        message: String((d.message as string | undefined) ?? 'Unknown validation error'),
        severity: 'error' as const,
        fix_action: d.fix_action as string | null | undefined,
        functionPath: mapFunctionPath(d.function_path),
      })),
    )
    handlers.setValidationFatal(false)
    handlers.setValidationMode('save')
    handlers.setShowValidationErrorDialog(true)
  } else {
    console.warn(consoleLabel, err)
    toast.error(toFailureDetail(err).message, 'Save Failed')
  }
}
