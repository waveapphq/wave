/**
 * useConfigModal - per-sheet config element computation and save handlers
 *
 * One instance per open config sheet (multi-sheet model): computes
 * the element data for the given node id and handles saving config changes
 * back to that node, including version management, edge cleanup, and
 * variable creation.
 */

import { useCallback, useMemo } from 'react'
import { useUpdateNodeInternals } from '@xyflow/react'
import { useWorkflowStore, type WorkflowVariable } from '@/features/workbench/stores/workflow-store'
import type { FunctionBlockChromeData, FunctionBlockElement } from '@/features/functions/canvas/function-config-modal'
import type { FunctionInput, FunctionOutput } from '@/features/functions/api/types'
import type { ProfileBinding } from '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
import type { ElementData, SaveData } from '@/features/workbench/common/element-config/types'
import { savedBlockFields } from '@/features/workbench/lib/saved-block-fields'
import { blockInputParams, blockOutputParams } from '@/features/workbench/lib/node-parameters'
import { PARAM_TYPE_TO_VAR_TYPE } from '@/features/workbench/lib/node-parameters/types'
import type { SecretMaskingSetting } from '@/features/workbench/lib/node-parameters/secret-reveal'
import { isOutputBindable } from '@/features/workbench/lib/validation/output-binding-rules'
import { getControlMetadata, getControlVersions } from '@/features/workbench/docs/_loader'
import {
  activeFunctionScopeBody,
  functionScopeNames,
  paramSpecsToVariables,
  type ScopeBody,
} from '@/features/workbench/lib/function-scope-rows'
import { reconcileBindingsToContract } from '@/features/functions/lib/edit-mode-draft'
import type { ElementTypes } from '@/lib/variable-validation'
import {
  findNodeDeepById,
  walkActiveSubtree,
} from '@/features/functions/canvas/inner-workflow'

/** Minimal edge shape matching the workflow store's EdgeType */
interface StoreEdge {
  id: string
  source: string
  sourceHandle?: string
}

// ===========================================================================
// Helpers - edge cleanup
// ===========================================================================

function removeMatchingEdges<E extends StoreEdge>(storeEdges: E[], sourceId: string, shouldRemove: (e: E) => boolean): E[] | null {
  const toRemove = storeEdges.filter((e) => e.source === sourceId && shouldRemove(e))
  if (toRemove.length === 0) return null
  const removeIds = new Set(toRemove.map((e) => e.id))
  return storeEdges.filter((e) => !removeIds.has(e.id))
}

/** Clean up outgoing edges when assert mode changes (single <-> split).
 *
 * The mode value can be ``undefined`` in two places we must normalize before
 * comparing:
 *   - ``oldMode`` is ``undefined`` for a freshly-dropped Assert whose modal
 *     was never saved, because ``data.config.values.mode`` was never set on
 *     the node. The modal renders it as the default ("split"), so the
 *     effective mode the user sees is "split" - normalize undefined to that.
 *   - ``saveData.values.mode`` is set explicitly by the modal save path, but
 *     guard against undefined for the same reason.
 *
 * Without the normalization, editing a fresh Assert (no mode change, just
 * adding an expression) would wipe every wired egress edge because
 * ``undefined !== 'split'``.
 */
function cleanupAssertModeEdges<E extends StoreEdge>(
  storeEdges: E[],
  saveData: SaveData,
  oldMode: unknown,
): E[] | null {
  const normalizedOld = (oldMode as string | undefined) ?? 'split'
  const normalizedNew = (saveData.values.mode as string | undefined) ?? 'split'
  if (normalizedOld === normalizedNew) return null
  return removeMatchingEdges(storeEdges, saveData.id, () => true)
}

/** A container's egress lane is not a branch, so a branch edit never orphans it. */
const NON_BRANCH_EGRESS_HANDLES = new Set(['then'])

/** Clean up orphaned edges when if-else branches are removed */
function cleanupOrphanedBranchEdges<E extends StoreEdge>(
  storeEdges: E[],
  saveData: SaveData,
): E[] | null {
  const branches = saveData.values.branches as Array<{id: string}> | undefined
  if (!branches) return null
  const branchIds = new Set(branches.map((b) => b.id))
  return removeMatchingEdges(
    storeEdges,
    saveData.id,
    (e) =>
      !!e.sourceHandle &&
      !branchIds.has(e.sourceHandle) &&
      !NON_BRANCH_EGRESS_HANDLES.has(e.sourceHandle),
  )
}

// ===========================================================================
// Helpers - variable creation
// ===========================================================================

/** Create variables for new output bindings (REQ-3.1.3.6), marking the bound
 *  variable secret when its output carries the Secret column flag (SECUI-3/4). */
function createOutputBindingVariables(
  saveData: SaveData,
  secretOutputNames: readonly string[],
  variables: WorkflowVariable[],
  addVariable: (v: Omit<WorkflowVariable, 'id'>) => void,
  reservedScopeNames: Set<string> = new Set(),
): void {
  const existingVarNames = new Set(variables.map((v) => v.name))
  const secretOutputs = new Set(secretOutputNames)
  for (const [outputName, varName] of Object.entries(saveData.outputBindings)) {
    if (!varName) continue
    if (existingVarNames.has(varName)) continue
    if (reservedScopeNames.has(varName)) continue
    // Skip names that aren't valid output-binding targets - the inline
    // gate already blocks Save in this case, but defend against stale
    // bindings sneaking through.
    /* v8 ignore next - COV-DEF-017 */
    if (!isOutputBindable(varName)) continue
    const paramType = saveData.outputTypes[outputName]
    const varType = (PARAM_TYPE_TO_VAR_TYPE[paramType] ?? 'string') as WorkflowVariable['type']
    // A bound target is written by the Block at run time: declare it holding null.
    addVariable({
      name: varName,
      type: varType,
      isSecret: secretOutputs.has(outputName),
    })
    existingVarNames.add(varName)
  }
}

// The id prefix of a declared output's row (the shared row converter).
const OUTPUT_ROW_PREFIX = 'param:output:'

/** The output bindings and Variable Setter Secret rows a Save carries. */
interface SecretCarriers {
  outputBindings: Record<string, string>
  variableSecretKeys?: string[]
}

/** The existing plain variables a Save would make secret, each once; Secret is sticky (SECUI-4, SECUI-12). */
function variablesBecomingSecret(
  carriers: SecretCarriers,
  secretOutputNames: readonly string[],
  variables: WorkflowVariable[],
): WorkflowVariable[] {
  const secretOutputs = new Set(secretOutputNames)
  const names = new Set(carriers.variableSecretKeys ?? [])
  for (const [outputName, varName] of Object.entries(carriers.outputBindings)) {
    if (varName && secretOutputs.has(outputName)) names.add(varName)
  }
  return variables.filter((v) => names.has(v.name) && !(v.isSecret ?? false))
}

/** Turn each named existing variable, or Function output, secret once the Save that marks it runs. */
function promoteToSecret(
  promoted: WorkflowVariable[],
  updateVariable: (id: string, updates: Partial<Omit<WorkflowVariable, 'id'>>) => void,
  updateOutputParam: (name: string, updates: { secret: boolean }) => unknown,
): void {
  for (const variable of promoted) {
    if (variable.id.startsWith(OUTPUT_ROW_PREFIX)) updateOutputParam(variable.name, { secret: true })
    else updateVariable(variable.id, { isSecret: true })
  }
}

/**
 * Create variables for new Variable Setter entries (VARSET-1).
 *
 * Variables are created in the store on save so they're visible in the
 * Variable Manager and available for expression autocomplete before the
 * setter block actually executes. Names that already exist in active
 * scope - the test-local variables OR (inside a Function body) declared
 * inputs / outputs of the enclosing Function - are skipped: those are
 * assignment targets, not new declarations. Skipping prevents the
 * `addVariable` "Name already exists in this scope" throw that crashes
 * the save handler when a user picks an existing input/output name in
 * the setter row.
 */
function createVariableSetterVariables(
  saveData: SaveData,
  variables: WorkflowVariable[],
  addVariable: (v: Omit<WorkflowVariable, 'id'>) => void,
  reservedScopeNames: Set<string> = new Set(),
): void {
  if (!saveData.variableTypes) return
  const varMap = saveData.values.variables as Record<string, unknown> | undefined
  if (!varMap) return

  const existingTestVarNames = new Set(variables.map((v) => v.name))
  const secretKeys = new Set(saveData.variableSecretKeys ?? [])
  for (const varName of Object.keys(varMap)) {
    if (!varName) continue
    if (existingTestVarNames.has(varName)) continue
    if (reservedScopeNames.has(varName)) continue
    const varType = (saveData.variableTypes[varName] ?? 'string') as WorkflowVariable['type']
    // A Variable Setter target is written at run time: declare it holding null.
    addVariable({
      name: varName,
      type: varType,
      isSecret: secretKeys.has(varName),
    })
    existingTestVarNames.add(varName)
  }
}

/** Resolve a control node's effective version + selectable versions. Extracted
 *  so the config-modal element memo stays under the cognitive-complexity limit. */
function resolveControlVersion(
  controlVersions: Array<{ version: string }>,
  storedVersion: string,
): { nodeVersion: string; availableVersions: string[] } {
  const matched = controlVersions.find(
    (v) => v.version === storedVersion || v.version.startsWith(storedVersion + '.'),
  )?.version
  const nodeVersion = matched || controlVersions[0]?.version || '1.0.0'
  const availableVersions =
    controlVersions.length > 0 ? controlVersions.map((v) => v.version) : [nodeVersion]
  return { nodeVersion, availableVersions }
}

type Rec = Record<string, unknown>

/** A plugin or control Block's element: it carries none of a Function Block's chrome. */
type BlockElement = ElementData & { kind: 'block' } & {
  [K in Exclude<keyof FunctionBlockChromeData, 'kind'>]?: undefined
}

/** The element an open Block window reads. */
type ConfigModalElement = FunctionBlockElement | BlockElement

// Shared-instance version switch: build the node-data patch that clears the
// stale load-time `missingVersion` stamp and re-resolves the contract to the
// picked version (REQ-3.1.2.4). Empty for Local instances and unspecified fields.
function sharedVersionPatch(lifecycle: unknown, saveData: SaveData): Rec {
  if (lifecycle !== 'shared') return {}
  const patch: Rec = {}
  if (saveData.missingVersion !== undefined) patch.missingVersion = saveData.missingVersion
  if (saveData.resolvedInputs !== undefined) patch.resolvedInputs = saveData.resolvedInputs
  if (saveData.resolvedOutputs !== undefined) patch.resolvedOutputs = saveData.resolvedOutputs
  return patch
}

/** The picked contract of a Shared Function Block that moves to another version, else null. */
function switchedContract(
  stored: Rec,
  saveData: SaveData,
): { inputs: FunctionInput[]; outputs: FunctionOutput[] } | null {
  const { functionVersion, resolvedInputs, resolvedOutputs } = saveData
  if (stored.functionLifecycle !== 'shared' || functionVersion === undefined || functionVersion === stored.functionVersion) {
    return null
  }
  return resolvedInputs && resolvedOutputs ? { inputs: resolvedInputs, outputs: resolvedOutputs } : null
}

/** A Function Block Save: the shared fields plus the pin and the Local name sync; the description stays the Block's own. */
function functionBlockData(stored: Rec, next: Rec, saveData: SaveData): Rec {
  const lifecycle = stored.functionLifecycle
  const localDefinition = stored.localDefinition as Rec | undefined
  const stamped: Rec = {
    ...next,
    // `version` stays the Block's own; the library pin lives on `functionVersion`.
    version: stored.version,
    functionVersion: saveData.functionVersion ?? stored.functionVersion,
    ...sharedVersionPatch(lifecycle, saveData),
  }
  // The canvas label and a Local definition's name are one value; the structural check reads either.
  if (lifecycle === 'local' && localDefinition) stamped.localDefinition = { ...localDefinition, name: saveData.name }
  const picked = switchedContract(stored, saveData)
  if (!picked) return stamped
  // A switch drops what the picked version no longer fits and starts its new choice inputs on their defaults (FNCFG-9).
  const previous = { inputs: (stored.resolvedInputs as FunctionInput[] | undefined) ?? [], outputs: [] }
  return reconcileBindingsToContract(stamped, picked, previous)
}

/** The node data a Block's Save writes: its saved fields, and a Function Block's stamps. */
function savedNodeData(stored: Rec, saveData: SaveData, latestVersion: string | undefined): Rec {
  const saved = savedBlockFields(saveData)
  const next: Rec = {
    ...stored,
    // The window renames the canvas Block; the label IS the user-visible name.
    label: saveData.name || stored.label,
    ...saved.data,
    config: saved.config,
  }
  if (stored.nodeType === 'function') return functionBlockData(stored, next, saveData)
  return { ...next, hasNewerVersion: saveData.version !== latestVersion }
}

/** The Save as the node data stores it: the bindings and Secret rows a version switch kept, typed by the picked outputs. */
function storedSave(saveData: SaveData, data: Rec): SaveData {
  const config = data.config as Pick<SaveData, 'outputBindings' | 'outputSecretFields'>
  const pickedTypes = (saveData.resolvedOutputs ?? []).map((output) => [output.name, output.type])
  return {
    ...saveData,
    outputBindings: config.outputBindings,
    outputSecretFields: config.outputSecretFields,
    outputTypes: { ...saveData.outputTypes, ...Object.fromEntries(pickedTypes) },
  }
}

/** The outputs a Save leaves ticked Secret: a Block storing no list shows its schema-secret outputs ticked (FNCFG-7, K8SCON-4). */
function shownSecretOutputs(saveData: SaveData, element: ConfigModalElement | null): string[] {
  if (saveData.outputSecretFields !== undefined) return saveData.outputSecretFields
  if (element === null) return []
  return element.outputs.filter((output) => output.secret === true).map((output) => output.name)
}

/** A Function Block's element: the shared Block element read from its Function's contract, plus its lifecycle chrome. */
function functionBlockElement(id: string, data: Rec): FunctionBlockElement {
  const lifecycle = (data.functionLifecycle as 'local' | 'shared' | undefined) ?? 'local'
  const shared = lifecycle === 'shared'
  const localDefinition = data.localDefinition as { name?: string; description?: string } | undefined
  const config = (data.config ?? {}) as Rec
  const upstream = data.upstreamLink as { sourceVersion?: string } | undefined
  const version = typeof data.version === 'string' && data.version !== '' ? data.version : '1.0.0'
  return {
    kind: 'function',
    lifecycle,
    functionId: shared ? (data.functionId as string | undefined) : undefined,
    originalLibraryName: shared ? (data.originalLibraryName as string | undefined) : undefined,
    selectedVersion: shared ? (data.functionVersion as string | undefined) : undefined,
    editMode: shared && !!data.editMode,
    sourceVersion: shared ? upstream?.sourceVersion ?? (data.functionVersion as string | undefined) : undefined,
    missingVersion: shared && !!data.missingVersion,
    id,
    name: (data.label as string | undefined) ?? localDefinition?.name ?? 'function',
    description: (data.description as string | undefined) ?? localDefinition?.description ?? '',
    elementType: 'function',
    nodeType: 'function',
    version,
    availableVersions: [version],
    parameters: blockInputParams(data) ?? [],
    outputs: blockOutputParams(data) ?? [],
    currentValues: (config.values ?? {}) as Rec,
    outputBindings: (config.outputBindings ?? {}) as Record<string, string>,
    profileBindings: (config.profileBindings ?? []) as ProfileBinding[],
    expressionFields: (data.expressionFields as string[] | undefined) ?? [],
    templateFields: (data.templateFields as string[] | undefined) ?? [],
    elementTypes: (data.elementTypes as ElementData['elementTypes']) ?? {},
    // Undefined means never saved; the window then seeds the secret outputs (FNCFG-7).
    outputSecretFields: config.outputSecretFields as string[] | undefined,
  }
}

// ===========================================================================
// Hook
// ===========================================================================

export function useConfigModal(nodeId: string | null) {
  const storeNodes = useWorkflowStore((state) => state.nodes)
  const storeEdges = useWorkflowStore((state) => state.edges)
  const closeConfigModalAction = useWorkflowStore((state) => state.closeConfigModal)
  const updateNode = useWorkflowStore((state) => state.updateNode)
  const setEdges = useWorkflowStore((state) => state.setEdges)
  const variables = useWorkflowStore((state) => state.variables)
  const addVariable = useWorkflowStore((state) => state.addVariable)
  const updateVariable = useWorkflowStore((state) => state.updateVariable)
  const updateOutputParam = useWorkflowStore((state) => state.updateOutputParam)
  const clearPulseValidationNodeId = useWorkflowStore((state) => state.clearPulseValidationNodeId)
  const transaction = useWorkflowStore((state) => state.transaction)
  const requestSecretPromotion = useWorkflowStore((state) => state.requestSecretPromotion)
  const drillPath = useWorkflowStore((state) => state.drillPath)
  const updateNodeInternals = useUpdateNodeInternals()

  // Walk the active subtree so the lookup finds nodes inside the currently
  // drilled Function. Outside a Function this is identical to the root tree.
  const activeNodes = useMemo(
    () => walkActiveSubtree(storeNodes, storeEdges, variables, drillPath).nodes,
    [storeNodes, storeEdges, variables, drillPath],
  )
  const activeEdges = useMemo(
    () => walkActiveSubtree(storeNodes, storeEdges, variables, drillPath).edges,
    [storeNodes, storeEdges, variables, drillPath],
  )
  const activeVariables = useMemo(
    () => walkActiveSubtree(storeNodes, storeEdges, variables, drillPath).variables,
    [storeNodes, storeEdges, variables, drillPath],
  )
  // Inside a Function, its declared inputs and outputs are settable-but-not-creatable names.
  const reservedScopeNames = useMemo(() => {
    if (drillPath.length === 0) return new Set<string>()
    let active
    try {
      active = walkActiveSubtree(storeNodes, storeEdges, variables, drillPath)
    } catch {
      return new Set<string>()
    }
    const declared = functionScopeNames(active.localDefinition as ScopeBody | null).filter(
      (scopeName) => scopeName.kind === 'input' || scopeName.kind === 'output',
    )
    return new Set(declared.map((scopeName) => scopeName.name))
  }, [storeNodes, storeEdges, variables, drillPath])

  // What a Secret row may turn secret: the scope's variables and, inside a Function, its declared outputs.
  const promotionCandidates = useMemo(
    () => [
      ...activeVariables,
      ...(drillPath.length === 0 ? [] : paramSpecsToVariables(activeFunctionScopeBody(storeNodes, drillPath)?.outputs ?? [], 'output')),
    ],
    [activeVariables, storeNodes, drillPath],
  )

  // Whether the sheet's node belongs to the active (drilled) scope. Out-of-
  // scope sheets persist across drill but render read-only: their display
  // data is scope-independent, while editing semantics (autocomplete,
  // validation, save) are not.
  const isInActiveScope = !!nodeId && activeNodes.some((n) => n.id === nodeId)

  // Config modal element data
  const configModalElement = useMemo((): ConfigModalElement | null => {
    if (!nodeId) return null
    // In-scope lookup first; fall back to a deep, scope-independent lookup
    // so a sheet survives drilling into / out of Function bodies.
    const node =
      activeNodes.find((n) => n.id === nodeId) ??
      findNodeDeepById(storeNodes, nodeId)
    if (!node) return null

    if (node.data.nodeType === 'function') return functionBlockElement(node.id, node.data as Rec)

    // Get block type and metadata from control registry
    const elementType = node.data.elementType || 'unknown'
    const controlMeta = getControlMetadata(elementType)
    const controlVersions = getControlVersions(elementType)

    // Normalize version: match stored version to full version in metadata
    // e.g., "1.0" matches "1.0.0"
    const storedVersion = node.data.version || ''
    const { nodeVersion, availableVersions } = resolveControlVersion(
      controlVersions,
      storedVersion,
    )
    const config = node.data.config ?? {}

    // The one field lookup by Block data (0.0.x placeholders have no parameters)
    const nodeData = node.data as Rec
    const lookup = { ...nodeData, elementType, version: nodeVersion }
    const parameters = blockInputParams(lookup) ?? [
      { name: 'config', type: 'string' as const, required: false, description: 'Configuration' },
    ]
    const outputs = blockOutputParams(lookup) ?? []

    return {
      kind: 'block' as const,
      id: node.id,
      name: node.data.label || node.data.elementType || 'Unknown',
      elementType,
      nodeType: node.data.nodeType,
      version: nodeVersion,
      availableVersions,
      parameters,
      outputs,
      currentValues: (config.values ?? {}) as Record<string, unknown>,
      outputBindings: (config.outputBindings ?? {}) as Record<string, string>,
      description: node.data.description,
      summary: controlMeta?.description,
      versions: controlVersions,
      profileBindings: (config.profileBindings ?? []) as ProfileBinding[],
      expressionFields: (nodeData.expressionFields as string[] | undefined) ?? [],
      templateFields: (nodeData.templateFields as string[] | undefined) ?? [],
      variableExpressionKeys: (nodeData.variableExpressionKeys as string[] | undefined) ?? [],
      variableTemplateKeys: (nodeData.variableTemplateKeys as string[] | undefined) ?? [],
      variableSecretKeys: (config.variableSecretKeys as string[] | undefined) ?? [],
      // Undefined means never saved; the sheet then seeds schema-secret outputs (K8SCON-4).
      outputSecretFields: config.outputSecretFields as string[] | undefined,
      unmaskedSecretFields: (config.unmasked_secret_fields as string[] | undefined) ?? [],
      secretMasking: (config.secret_masking as SecretMaskingSetting | undefined) ?? 'system',
      variableTypes: (nodeData.variableTypes as Record<string, string> | undefined) ?? {},
      variableElementTypes:
        (nodeData.variableElementTypes as Record<string, ElementTypes> | undefined) ?? {},
      elementTypes: (nodeData.elementTypes as Record<string, ElementTypes> | undefined) ?? {},
    }
  }, [nodeId, activeNodes, storeNodes])

  // Writes a Block window's Save to its node, turning `promoted` secret.
  const saveBlockConfig = useCallback(
    (saveData: SaveData, data: Rec | null, promoted: WorkflowVariable[], secretOutputs: readonly string[]) => {
      if (data && configModalElement) {
        // Wrap node update + edge cleanup + variable creation in one
        // transaction so the entire save is a single undo entry.
        transaction(() => {
          updateNode(saveData.id, { data: data as typeof activeNodes[number]['data'] })

          // Clean up edges on assert mode change (scoped to active subtree)
          if (configModalElement.elementType === 'assert') {
            const cleaned = cleanupAssertModeEdges(activeEdges, saveData, configModalElement.currentValues.mode)
            if (cleaned) setEdges(cleaned)
          }

          // Clean up orphaned branch edges (scoped to active subtree)
          const orphanCleaned = cleanupOrphanedBranchEdges(activeEdges, saveData)
          if (orphanCleaned) setEdges(orphanCleaned)

          // Create variables for output bindings and variable setter entries.
          // The existing-name check reads activeVariables so inputs/outputs
          // declared on the current Function are also considered "taken".
          createOutputBindingVariables(
            saveData,
            secretOutputs,
            activeVariables,
            addVariable,
            reservedScopeNames,
          )
          createVariableSetterVariables(
            saveData,
            activeVariables,
            addVariable,
            reservedScopeNames,
          )
          promoteToSecret(promoted, updateVariable, updateOutputParam)
        }, 'Edit configuration')

        // Force React Flow to re-measure the node's handles. Config saves can
        // change handle topology (Assert mode flip, If/Else branch add/remove,
        // Try/Catch enable_catch/enable_finally) and React Flow caches the
        // bounds on first render. Without this the ghost-edge during drag
        // (and the snap proximity feedback) draws from the previous handle
        // positions until a separate event triggers a re-measurement.
        updateNodeInternals(saveData.id)
      }
      clearPulseValidationNodeId(saveData.id)
      closeConfigModalAction(saveData.id)
    },
    [activeEdges, activeVariables, reservedScopeNames, configModalElement, updateNode, setEdges, addVariable, updateVariable, updateOutputParam, clearPulseValidationNodeId, closeConfigModalAction, transaction, updateNodeInternals]
  )

  // A Save that turns existing plain variables secret waits for the warning (SECUI-12, REQ-4.5.20).
  const saveAfterWarning = useCallback(
    (promoted: WorkflowVariable[], save: () => void) => {
      if (promoted.length === 0) {
        save()
        return
      }
      requestSecretPromotion(promoted.map((v) => v.name), save)
    },
    [requestSecretPromotion],
  )

  const handleConfigSave = useCallback(
    (saveData: SaveData) => {
      const node = activeNodes.find((n) => n.id === saveData.id)
      const data = node ? savedNodeData(node.data as Rec, saveData, configModalElement?.availableVersions[0]) : null
      const stored = data ? storedSave(saveData, data) : saveData
      const secretOutputs = shownSecretOutputs(stored, configModalElement)
      const promoted = variablesBecomingSecret(stored, secretOutputs, promotionCandidates)
      saveAfterWarning(promoted, () => saveBlockConfig(stored, data, promoted, secretOutputs))
    },
    [activeNodes, configModalElement, promotionCandidates, saveBlockConfig, saveAfterWarning],
  )

  // Per-sheet close. The cast is branch-free on purpose: with a null nodeId
  // (no sheet rendered) the store filter removes nothing.
  const closeConfigModal = useCallback(
    () => closeConfigModalAction(nodeId as string),
    [closeConfigModalAction, nodeId],
  )

  return {
    configModalElement,
    isInActiveScope,
    closeConfigModal,
    handleConfigSave,
  }
}
