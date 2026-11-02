/** Variable Management Hook - output bindings, variable CRUD, per-scope saves and the runtime value overlay. */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  useWorkflowStore,
  type NamespaceVariables,
  type ParamSpec,
  type WorkflowVariable,
} from '@/features/workbench/stores/workflow-store'
import { useVariableUpdates } from '@/features/workbench/hooks/use-variable-updates'
import { workbenchApi, type WorkbenchVariableOverrideBody } from '@/features/workbench/api/workbench'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import {
  keepNamed,
  renamedScoped,
  useStagedOverrides,
  withoutGoneScopes,
  withoutScoped,
  type StagedOverride,
} from '@/features/workbench/live/staged-overrides'
import { drillNodePath, parseScopedVariableKey, scopedVariableKey } from '@/features/workbench/lib/variable-scope-key'
import { isEnumInput } from '@/features/functions/lib/enum-input'
import {
  editedDefinitions,
  namesBlocksWrite,
  resultsReading,
  type ResultsContext,
} from '@/features/workbench/live/stale-results'
import type { VariableCreateSpec } from '@/features/workbench/common/variables/variable-inspect-modal/use-inspect-create'
import { createNamespaceDottedEntries } from '@/features/workbench/live/variable-helpers'
import { canonicalEqual } from '@/features/workbench/lib/canonical-workflow'
import { getDefaultValueForType } from '@/lib/variable-defaults'
import { isNullValue } from '@/lib/variable-format'
import { PYTHON_KEYWORD_SET } from '@/features/workbench/lib/python-builtins'
import { EXPRESSION_SAFE_NAMES } from '@/features/workbench/lib/expression-sandbox'
import { detectExpressionCycle, type VariableLike as VariableLikeForCycle } from '@/features/workbench/live/expression-cycle-detector'
import { isScopeReadOnly, walkActiveSubtree, type DrillEntry } from '@/features/functions/canvas/inner-workflow'
import { useReadOnlyCanvas } from '@/features/workbench/common/canvas/use-readonly-canvas'
import type { ElementTypes } from '@/lib/variable-validation'
import { blockReads, blockWrites, namesInText, type NamedBlock } from '@/features/workbench/lib/saved-block-fields'
import {
  activeFunctionScopeBody,
  functionScopeRows,
  instancesWithoutBody,
  paramSpecsToVariables,
  visitScopes,
  walkBodies,
  type ManagerRow,
  type RawParamSpec,
  type ScopeBody,
} from '@/features/workbench/lib/function-scope-rows'

/** Mode for the Create Variable dialog when launched from the +Add button. */
type CreateDialogMode = 'input' | 'output' | 'variable'

/** The variables and computed outputs of the scope at `path`, as the cycle check reads them. */
function scopeCycleVariables(
  rootNodes: unknown[],
  rootVariables: WorkflowVariable[],
  path: DrillEntry[],
): WorkflowVariable[] {
  const active = walkActiveSubtree(rootNodes, [], rootVariables, path)
  const outputs = (active.localDefinition?.outputs ?? []) as RawParamSpec[]
  return [...active.variables, ...paramSpecsToVariables(outputs, 'output')]
}

/** Return type for the useVariableManagement hook */
export interface VariableManagementResult {
  // Computed data
  outputBoundVarNames: Set<string>
  outputBoundVarSources: Map<string, string[]>
  inputRefCounts: Map<string, number>
  workflowReferencedVarNames: Set<string>
  availableVariablesForManager: Array<{
    name: string
    type: string
    source?: string
  }>
  /** Workflow variables as defined in the store (no runtime overlay). */
  displayVariables: ManagerRow[]
  /** Root-scope secret variable ids whose value is still unsaved (new, or edited
   *  since the last save) - so their value stays visible until the test is saved. */
  unsavedSecretIds: ReadonlySet<string>
  /** Root-scope secret ids the saved Test does not hold yet: new, or a value that differs from the saved one. */
  changedSecretIds: ReadonlySet<string>
  /** Live runtime values streamed from the backend, keyed by scope (`scopedVariableKey`). */
  runtimeValues: Map<string, unknown>

  // Variable CRUD handlers
  handleCreateVariable: (
    variable: Omit<WorkflowVariable, 'id'>,
    functionPath?: DrillEntry[],
  ) => { success: boolean; error?: string }
  /** Routes a +Add save by mode into the window's Function path, else the drilled scope (VMGR-102). */
  handleCreateParameter: (
    mode: CreateDialogMode,
    spec: VariableCreateSpec,
    functionPath?: DrillEntry[],
  ) => { success: boolean; error?: string }
  validateExpressionCycle: (params: {
    variableId?: string
    variableName: string
    value: unknown
    isExpression: boolean
    functionPath?: DrillEntry[]
  }) => string | null
  /** The variable window's Save of a whole definition, in the window's own scope (the drilled one when absent). */
  handleVariableWindowSave: (
    target: WorkflowVariable,
    spec: VariableCreateSpec,
    functionPath?: DrillEntry[],
  ) => { success: boolean; error?: string }
  /** Applies a Current value in the window's scope to the live session, else stages it; rejects when it did not land. */
  applyVariableOverride: (
    name: string,
    body: WorkbenchVariableOverrideBody,
    functionPath?: DrillEntry[],
  ) => Promise<void>
  /** The window's Current Save: reports a failed write, then rejects so the window stays open. */
  handleVariableCurrentEdit: (
    name: string,
    body: WorkbenchVariableOverrideBody,
    functionPath?: DrillEntry[],
  ) => Promise<void>
  /** Idle staged Current overrides by scope as they are now, merged into every run-seed until Reset. */
  readStagedOverrides: () => Map<string, StagedOverride>
  /** Every Current-edit override (idle or live) by scope, for the Current display; cleared on Reset. */
  appliedOverrides: Map<string, StagedOverride>
  /** The shown values captured at run-start by scope: Current while that run lives; empty while idle. */
  runStartSnapshot: Map<string, unknown>
  /** The element types of each run-start snapshot value (REQ-3.1.3.19). */
  runStartElementTypes: Map<string, ElementTypes>
  handleVariableDelete: (id: string) => void
  confirmVariableDelete: () => void

  // Delete confirmation state
  pendingDeleteVarId: string | null
  pendingDeleteVarName: string
  pendingDeleteDescription: string
  setPendingDeleteVarId: (id: string | null) => void
  setPendingDeleteVarName: (name: string) => void
  setPendingDeleteDescription: (desc: string) => void
  cancelPendingDelete: () => void

  // Recently changed paths (from runtime)
  recentlyChangedPaths: Set<string>
}

// ===========================================================================
// Helpers - output binding / input reference analysis
// ===========================================================================

interface NodeLike {
  data: Record<string, unknown> & {
    config?: Record<string, unknown>
    label?: string
  }
}

function collectOutputBindings(
  node: NodeLike,
  names: Set<string>,
  sources: Map<string, string[]>,
): void {
  const bindings = node.data.config?.outputBindings as Record<string, string> | undefined
  if (!bindings) return
  /* v8 ignore next - COV-BRANCH-123 */
  const nodeName = node.data.label || ''
  for (const varName of Object.values(bindings)) {
    if (!varName) continue
    names.add(varName)
    const existing = sources.get(varName) || []
    existing.push(nodeName)
    sources.set(varName, existing)
  }
}

/** The names a computed variable's source reads, scanned as the engine scans them. */
function namesReadBySource(source: string, isTemplate: boolean): string[] {
  return namesInText(source, isTemplate ? 'template' : 'expression')
}

interface ProfileBindingShape {
  alias?: string
  profileName?: string
  fields?: Array<{ name: string }>
}

interface AliasEntry {
  type: string
  source: string
}

/** Add a single binding's alias + dotted-field entries to the accumulator. */
function addBindingEntries(
  binding: ProfileBindingShape,
  acc: Map<string, AliasEntry>,
): void {
  if (!binding.alias) return
  const source = `Profile: ${binding.profileName ?? ''}`
  if (!acc.has(binding.alias)) acc.set(binding.alias, { type: 'map', source })
  for (const f of binding.fields ?? []) {
    const dotted = `${binding.alias}.${f.name}`
    if (!acc.has(dotted)) acc.set(dotted, { type: 'string', source })
  }
}

/**
 * Aggregate every profile alias bound by any element across all nodes.
 * Returns the deduplicated set as an array suitable for autocomplete.
 */
function collectProfileAliasEntries(
  nodes: ReadonlyArray<{ data?: { config?: Record<string, unknown> } }>,
): Array<{ name: string } & AliasEntry> {
  const seen = new Map<string, AliasEntry>()
  for (const node of nodes) {
    const bindings = node.data?.config?.profileBindings as
      | ProfileBindingShape[]
      | undefined
    if (!bindings) continue
    for (const b of bindings) addBindingEntries(b, seen)
  }
  return Array.from(seen.entries()).map(([name, meta]) => ({ name, ...meta }))
}

/** The Test's own state a scope's autocomplete is built from. */
interface AutocompleteRoot {
  nodes: Array<{ data?: { config?: Record<string, unknown> } }>
  variables: WorkflowVariable[]
  namespaceVariables: NamespaceVariables
}

/** A scope's autocomplete: a Function's inputs, outputs and locals, or the Test variables with the namespaces and profile aliases. */
export function buildScopeAutocomplete(
  root: AutocompleteRoot,
  path: DrillEntry[],
): VariableManagementResult['availableVariablesForManager'] {
  // A Function cannot address the Test variables, the namespaces or the profile bindings.
  if (path.length > 0) {
    const localScope = activeFunctionScopeBody(root.nodes, path)
    const inputs = paramSpecsToVariables(localScope?.inputs ?? [], 'input')
    const outputs = paramSpecsToVariables(localScope?.outputs ?? [], 'output')
    const locals = localScope?.variables ?? []
    return [...inputs, ...outputs, ...locals].map((v) => ({ name: v.name, type: v.type }))
  }
  const sources = new Map<string, string[]>()
  for (const node of root.nodes) collectOutputBindings(node as unknown as NodeLike, new Set(), sources)
  return [
    ...root.variables.map((v) => ({ name: v.name, type: v.type, source: sources.get(v.name)?.[0] })),
    ...createNamespaceDottedEntries(root.namespaceVariables.system, 'system'),
    ...createNamespaceDottedEntries(root.namespaceVariables.suite, 'suite'),
    ...createNamespaceDottedEntries(root.namespaceVariables.regression, 'regression'),
    ...collectProfileAliasEntries(root.nodes),
  ]
}

type ValueKind = 'literal' | 'expression' | 'template'

/** What a run declared for one variable: its type and its kind. */
interface DeclaredShape {
  type: string
  kind: ValueKind
}

/** What the live run declared at its start (VMGR-19). */
interface RunDeclarations {
  /** Each scope the tree held, by scope path: its variables by name. */
  scopes: Map<string, Map<string, DeclaredShape>>
  /** Function Blocks whose body the tree did not hold (a Shared Function), by scope path. */
  unheld: Set<string>
}

const NO_RUN_DECLARATIONS: RunDeclarations = { scopes: new Map(), unheld: new Set() }

function kindOf(source: { isExpression?: boolean; isTemplate?: boolean }): ValueKind {
  if (source.isExpression) return 'expression'
  return source.isTemplate ? 'template' : 'literal'
}

function bodyKind(body: WorkbenchVariableOverrideBody): ValueKind {
  if ('expression' in body) return 'expression'
  return 'template' in body ? 'template' : 'literal'
}

/** Whether the live run takes a Current value: a variable it declared, same type and source kind. */
function runTakes(
  declarations: RunDeclarations,
  runName: string,
  body: WorkbenchVariableOverrideBody,
  nodePath: string[],
): boolean {
  const scope = declarations.scopes.get(JSON.stringify(nodePath))
  if (scope === undefined) {
    return nodePath.some((_, at) => declarations.unheld.has(JSON.stringify(nodePath.slice(0, at + 1))))
  }
  const declared = scope.get(runName)
  if (declared?.type !== body.type) return false
  return bodyKind(body) === 'literal' || bodyKind(body) === declared.kind
}

/** Every scope's declarations and literal values at run start; a computed value has none until evaluated. */
function runStartValues(
  nodes: unknown[],
  variables: WorkflowVariable[],
  inFunctionView: boolean,
): { declarations: RunDeclarations; values: Map<string, unknown>; elementTypes: Map<string, ElementTypes> } {
  const keyPathOf = (path: string[]) => (inFunctionView ? path.slice(1) : path)
  const scopes = new Map<string, Map<string, DeclaredShape>>()
  const values = new Map<string, unknown>()
  const elementTypes = new Map<string, ElementTypes>()
  visitScopes(nodes, variables, null, (path, body) => {
    const keyPath = keyPathOf(path)
    const rows = path.length === 0 ? variables : functionScopeRows(body)
    scopes.set(JSON.stringify(keyPath), new Map(rows.map((row) => [row.name, { type: row.type, kind: kindOf(row) }])))
    for (const row of rows) {
      const key = scopedVariableKey(row.name, keyPath)
      if (row.isExpression || row.isTemplate) continue
      values.set(key, row.value)
      if (row.elementTypes !== undefined) elementTypes.set(key, row.elementTypes)
    }
  })
  const unheld = new Set(instancesWithoutBody(nodes).map((path) => JSON.stringify(keyPathOf(path))))
  return { declarations: { scopes, unheld }, values, elementTypes }
}

/** The live run keeps the name it declared until the session ends (VMGR-19); following one rename twice keeps it. */
function followRunName(runNames: Map<string, string>, name: string, newName: string, keyPath: string[]) {
  if (name === newName) return
  const oldKey = scopedVariableKey(name, keyPath)
  const newKey = scopedVariableKey(newName, keyPath)
  if (!runNames.has(newKey)) runNames.set(newKey, runNames.get(oldKey) ?? name)
  runNames.delete(oldKey)
}

/** A definition that changed under a Current value: renamed, or gone (deleted, retyped or given another kind). */
interface DefinitionChange {
  keyPath: string[]
  name: string
  renamedTo?: string
}

/** The renames and the drops between two trees, scope by scope, matched by row id. */
function definitionChanges(before: Map<string, ScopeRows>, after: Map<string, ScopeRows>): DefinitionChange[] {
  const changes: DefinitionChange[] = []
  for (const [scopeKey, scope] of before) {
    // A scope that left the tree (a body unloaded or a Block deleted) is the gone-scope rule's.
    const rows = after.get(scopeKey)?.rows
    if (rows === undefined) continue
    const byId = new Map(rows.map((row) => [row.id, row]))
    const names = new Set(rows.map((row) => row.name))
    for (const row of scope.rows) {
      const next = byId.get(row.id)
      if (next === undefined) {
        if (!names.has(row.name)) changes.push({ keyPath: scope.keyPath, name: row.name })
      } else if (next.type !== row.type || kindOf(next) !== kindOf(row)) {
        changes.push({ keyPath: scope.keyPath, name: next.name })
      } else if (next.name !== row.name) {
        changes.push({ keyPath: scope.keyPath, name: row.name, renamedTo: next.name })
      }
    }
  }
  return changes
}

/** One scope's rows and Blocks, with the path its values are keyed by. */
interface ScopeRows {
  keyPath: string[]
  rows: ManagerRow[]
  nodes: unknown[]
}

/** Every scope's rows and Blocks, by its key path (JSON). */
function rowsByScope(nodes: unknown[], variables: WorkflowVariable[], inFunctionView: boolean): Map<string, ScopeRows> {
  const scopes = new Map<string, ScopeRows>()
  visitScopes(nodes, variables, null, (path, body) => {
    const keyPath = inFunctionView ? path.slice(1) : path
    const isRoot = path.length === 0
    scopes.set(JSON.stringify(keyPath), {
      keyPath,
      rows: isRoot ? variables : functionScopeRows(body),
      nodes: isRoot ? nodes : (body.workflow?.nodes ?? []),
    })
  })
  return scopes
}

/** The entries of a scope-keyed map that belong to one scope, by bare name. */
function namesInScope<V>(map: ReadonlyMap<string, V>, keyPath: string[]): Map<string, V> {
  const wanted = JSON.stringify(keyPath)
  const named = new Map<string, V>()
  for (const [key, value] of map) {
    const { name, functionPath } = parseScopedVariableKey(key)
    if (JSON.stringify(functionPath) === wanted) named.set(name, value)
  }
  return named
}

interface SecretSets {
  unsavedSecretIds: ReadonlySet<string>
  changedSecretIds: ReadonlySet<string>
}

/** Secrets against their saved definition, by scope: changed = new or a different value; unlocked = changed or null. */
function secretVisibility(
  current: { nodes: unknown[]; variables: WorkflowVariable[] },
  saved: { nodes: unknown[]; variables: WorkflowVariable[] },
  view: { inFunctionView: boolean; baseline: { nodeId: string; body: ScopeBody } | null },
): SecretSets {
  const viewRootId = view.baseline?.nodeId ?? null
  const savedScopes = new Map<string, ScopeBody>()
  const keep = (path: string[], body: ScopeBody, tracked: boolean) => {
    if (tracked) savedScopes.set(JSON.stringify(path), body)
  }
  visitScopes(saved.nodes, saved.variables, null, keep)
  if (view.baseline) {
    keep([view.baseline.nodeId], view.baseline.body, true)
    walkBodies(view.baseline.body.workflow?.nodes ?? [], [view.baseline.nodeId], true, null, keep)
  }
  const unsaved = new Set<string>()
  const changed = new Set<string>()
  const mark = (name: string, keyPath: string[], value: unknown, isChanged: boolean) => {
    const key = scopedVariableKey(name, keyPath)
    if (isChanged) changed.add(key)
    // A null secret has no stored value to protect, so it is never locked.
    if (isChanged || isNullValue(value)) unsaved.add(key)
  }
  visitScopes(current.nodes, current.variables, viewRootId, (path, body, tracked) => {
    const keyPath = view.inFunctionView ? path.slice(1) : path
    const savedBody = tracked ? savedScopes.get(JSON.stringify(path)) : undefined
    // Only a tracked scope can hold a change; a secret absent from its saved body is new.
    const differs = (now: unknown, before: unknown, known: boolean) => tracked && (!known || !canonicalEqual(now, before))
    for (const v of body.variables ?? []) {
      if (!v.isSecret) continue
      // By id, else by name: a body read back from the library carries no ids.
      const saved = savedBody?.variables
      const before = saved?.find((s) => s.id === v.id) ?? saved?.find((s) => s.name === v.name)
      mark(v.name, keyPath, v.value, differs(v.value, before?.value, before !== undefined))
    }
    for (const spec of body.outputs ?? []) {
      if (spec.secret !== true || typeof spec.name !== 'string') continue
      const before = savedBody?.outputs?.find((s) => s.name === spec.name)
      mark(spec.name, keyPath, spec.default ?? null, differs(spec.default ?? null, before?.default ?? null, before !== undefined))
    }
    for (const spec of body.inputs ?? []) {
      if (spec.secret === true && typeof spec.name === 'string') mark(spec.name, keyPath, spec.default ?? null, false)
    }
  })
  return { unsavedSecretIds: unsaved, changedSecretIds: changed }
}

/** A Block's config after the output bindings that write `name` are cleared; a parser query alias of that name goes with its query. */
function configWithoutBinding(config: Record<string, unknown>, name: string): Record<string, unknown> {
  const bindings = config.outputBindings as Record<string, string>
  const values = config.values as Record<string, unknown> | undefined
  const queries = (values?.queries ?? {}) as Record<string, string>
  const cleanedBindings: Record<string, string> = {}
  let isQueryAlias = false
  for (const [key, val] of Object.entries(bindings)) {
    if (key === name && key in queries) isQueryAlias = true
    else cleanedBindings[key] = val === name ? '' : val
  }
  if (!isQueryAlias) return { ...config, outputBindings: cleanedBindings }
  const { [name]: _query, ...remainingQueries } = queries
  const { [name]: _type, ...remainingTypes } = (values?.query_output_types ?? {}) as Record<string, string>
  return {
    ...config,
    outputBindings: cleanedBindings,
    values: { ...values, queries: remainingQueries, query_output_types: remainingTypes },
  }
}

/** The scope's Blocks with every output binding to `name` cleared; the same array when none writes it. */
function withoutBindingsTo<N extends { data: Record<string, unknown> }>(nodes: N[], name: string): N[] {
  let changed = false
  const next = nodes.map((node) => {
    const config = node.data.config as Record<string, unknown> | undefined
    const bindings = config?.outputBindings as Record<string, string> | undefined
    if (!config || !bindings || !Object.values(bindings).includes(name)) return node
    changed = true
    return { ...node, data: { ...node.data, config: configWithoutBinding(config, name) } }
  })
  return changed ? next : nodes
}

/** Filter out the variable's own name plus the sandbox's names and keywords. */
function isCrossVariableRef(ident: string, ownName: string): boolean {
  return (
    ident !== ownName &&
    !EXPRESSION_SAFE_NAMES.has(ident) &&
    !PYTHON_KEYWORD_SET.has(ident)
  )
}

/** The other variables one computed variable (or Expression / Template output) reads. */
function extractCrossRefsFromVariable(v: WorkflowVariable): string[] {
  if ((!v.isExpression && !v.isTemplate) || typeof v.value !== 'string') return []
  return namesReadBySource(v.value, !v.isExpression)
    .filter((ident) => isCrossVariableRef(ident, v.name))
}

/** Names other computed variables read; a self-reference does not count. */
function collectCrossVariableExpressionRefs(
  variables: ReadonlyArray<WorkflowVariable>,
): Set<string> {
  const refs = new Set<string>()
  for (const v of variables) {
    for (const ident of extractCrossRefsFromVariable(v)) {
      refs.add(ident)
    }
  }
  return refs
}

/** The parameter patch a window Save writes; a present key holding undefined removes that field (REQ-3.1.2.10, REQ-3.1.2.11). */
function windowParamPatch(kind: 'input' | 'output', target: WorkflowVariable, spec: VariableCreateSpec): Partial<ParamSpec> {
  const patch: Partial<ParamSpec> = {
    type: spec.type,
    default: kind === 'input' && spec.secret ? undefined : spec.value,
    description: spec.description,
    secret: spec.secret ? true : undefined,
    elementTypes: spec.elementTypes,
  }
  if (spec.name !== target.name) patch.name = spec.name
  if (kind === 'input') {
    patch.required = isEnumInput(spec) || spec.required === true
    patch.enumValues = spec.enumValues
  } else {
    patch.isExpression = spec.isExpression ? true : undefined
    patch.isTemplate = spec.isTemplate ? true : undefined
  }
  return patch
}

/** The variable patch a window Save writes: the whole definition in the window's scope. */
function windowVariablePatch(spec: VariableCreateSpec): Partial<Omit<WorkflowVariable, 'id'>> {
  return {
    type: spec.type,
    value: spec.value,
    isExpression: !!spec.isExpression,
    isTemplate: !!spec.isTemplate,
    isSecret: !!spec.secret,
    elementTypes: spec.elementTypes,
  }
}

/** Confirmation-dialog description for deleting an input parameter. The
 *  usedCount drives whether we warn the user about dangling references. */
function describeInputDelete(usedCount: number): string {
  if (usedCount === 0) {
    return 'This action cannot be undone. The input parameter will be permanently removed from the Function.'
  }
  const noun = usedCount === 1 ? 'block' : 'blocks'
  return `This action cannot be undone. The input parameter is used by ${usedCount} ${noun} - references will become unresolved.`
}

/** Confirmation-dialog description for deleting an output parameter. */
function describeOutputDelete(
  boundCount: number,
  sourceNames: string[],
  usedCount: number,
): string {
  if (boundCount > 0) {
    const noun = boundCount === 1 ? 'block' : 'blocks'
    return `This action cannot be undone. The output parameter is bound by ${boundCount} ${noun} (${sourceNames.join(', ')}) - those bindings will be cleared.`
  }
  if (usedCount > 0) {
    const noun = usedCount === 1 ? 'block' : 'blocks'
    return `This action cannot be undone. The output parameter is used by ${usedCount} ${noun} - references will become unresolved.`
  }
  return 'This action cannot be undone. The output parameter will be permanently removed from the Function.'
}

/** Confirmation-dialog description for deleting a workflow variable. */
function describeVariableDelete(
  boundCount: number,
  sourceNames: string[],
  usedCount: number,
): string {
  if (boundCount > 0) {
    const noun = boundCount === 1 ? 'block' : 'blocks'
    return `This action cannot be undone. The variable is bound as output by ${boundCount} ${noun} (${sourceNames.join(', ')}) - those bindings will be cleared.`
  }
  if (usedCount > 0) {
    const noun = usedCount === 1 ? 'block' : 'blocks'
    return `This action cannot be undone. The variable is used by ${usedCount} ${noun} - references will become unresolved.`
  }
  return 'This action cannot be undone. The variable will be permanently removed.'
}

// ===========================================================================
// Hook
// ===========================================================================

/** The default a new parameter stores: the window's value, else its type default unless left empty on purpose. */
function paramDefault(mode: CreateDialogMode, spec: VariableCreateSpec, computed: boolean): { default?: unknown } {
  if (spec.value !== undefined) return { default: spec.value }
  const leftEmpty = computed || (mode === 'input' && (spec.required === true || isEnumInput(spec)))
  return leftEmpty ? {} : { default: getDefaultValueForType(spec.type) }
}

/** The Function parameter a +Add window's spec describes; a secret input has no default (VMGR-113). */
function paramSpecFrom(mode: CreateDialogMode, spec: VariableCreateSpec): ParamSpec {
  const isExpression = mode === 'output' && !!spec.isExpression
  const isTemplate = mode === 'output' && !isExpression && !!spec.isTemplate
  const secretInput = mode === 'input' && !!spec.secret
  const paramSpec: ParamSpec = {
    name: spec.name,
    type: spec.type,
    ...(secretInput ? {} : paramDefault(mode, spec, isExpression || isTemplate)),
  }
  if (mode === 'input' && isEnumInput(spec)) {
    paramSpec.required = true
    paramSpec.enumValues = spec.enumValues
  } else if (mode === 'input' && spec.required !== undefined) {
    paramSpec.required = spec.required
  }
  if (spec.secret) paramSpec.secret = true
  if (spec.description) paramSpec.description = spec.description
  if (isExpression) paramSpec.isExpression = true
  if (isTemplate) paramSpec.isTemplate = true
  if (spec.elementTypes !== undefined) paramSpec.elementTypes = spec.elementTypes
  return paramSpec
}

/** The parameter kind a Variable Manager row id names; null for a variable or local. */
function parameterKind(id: string): 'input' | 'output' | null {
  if (id.startsWith('param:input:')) return 'input'
  if (id.startsWith('param:output:')) return 'output'
  return null
}

interface BodyNode {
  id: string
  data?: { localDefinition?: { workflow?: { nodes?: BodyNode[] } } }
}

/** True when a loaded body no longer holds the Function instance at `path`; an unloaded body keeps it. */
function isInstanceGone(rootNodes: ReadonlyArray<unknown>, path: ReadonlyArray<string>): boolean {
  let level = rootNodes as ReadonlyArray<BodyNode>
  for (const id of path) {
    const found = level.find((node) => node.id === id)
    if (!found) return true
    const inner = found.data?.localDefinition?.workflow?.nodes
    if (!Array.isArray(inner)) return false
    level = inner
  }
  return false
}

export function useVariableManagement(
  sessionId: string | null,
  registerVariableHandler: (handler: ((payload: unknown) => void) | null) => void,
): VariableManagementResult {
  const nodes = useWorkflowStore((state) => state.nodes)
  const workflowVariables = useWorkflowStore((state) => state.variables)
  const addVariable = useWorkflowStore((state) => state.addVariable)
  const updateVariable = useWorkflowStore((state) => state.updateVariable)
  const removeVariable = useWorkflowStore((state) => state.removeVariable)
  const setNodes = useWorkflowStore((state) => state.setNodes)
  const renameVariable = useWorkflowStore((state) => state.renameVariable)
  const transaction = useWorkflowStore((state) => state.transaction)
  const addInputParam = useWorkflowStore((state) => state.addInputParam)
  const addOutputParam = useWorkflowStore((state) => state.addOutputParam)
  const removeInputParam = useWorkflowStore((state) => state.removeInputParam)
  const removeOutputParam = useWorkflowStore((state) => state.removeOutputParam)
  const updateInputParam = useWorkflowStore((state) => state.updateInputParam)
  const updateOutputParam = useWorkflowStore((state) => state.updateOutputParam)
  const drillPathRaw = useWorkflowStore((state) => state.drillPath)
  const inFunctionView = useWorkflowStore((state) => !!state.functionViewMode)
  const { error: toastError } = useToast()

  // Compute output-bound variable names, source nodes, and input usage (REQ-3.1.3.6)
  //
  // When drilled into a Function the analysis must walk the inner subtree's
  // nodes - root edges / configs never reference inner-Function-local vars,
  // and inner plugins' references / output bindings are invisible to root
  // nodes. Without this scoping, deleting a Function-local var would skip
  // the "References will become unresolved" prompt even when an inner plugin
  // still uses the name.
  // inputRefCounts counts the blocks of the scope that read each name (VMGR-105).
  const { outputBoundVarNames, outputBoundVarSources, inputRefCounts, blockWrittenNames } = useMemo(() => {
    const names = new Set<string>()
    const sources = new Map<string, string[]>()
    const inputRefs = new Map<string, number>()
    const written = new Set<string>()
    let scopedNodes: typeof nodes = nodes
    if (drillPathRaw.length > 0) {
      scopedNodes = walkActiveSubtree(nodes, [], [], drillPathRaw).nodes
    }
    for (const node of scopedNodes) {
      collectOutputBindings(node as unknown as NodeLike, names, sources)
      for (const name of blockReads(node)) inputRefs.set(name, (inputRefs.get(name) ?? 0) + 1)
      for (const name of blockWrites(node)) written.add(name)
    }
    return {
      outputBoundVarNames: names,
      outputBoundVarSources: sources,
      inputRefCounts: inputRefs,
      blockWrittenNames: written,
    }
  }, [nodes, drillPathRaw])

  const namespaceVariables = useWorkflowStore((state) => state.namespaceVariables)
  // The autocomplete of the shown scope; a window left open elsewhere builds its own the same way.
  const availableVariablesForManager = useMemo(
    () => buildScopeAutocomplete({ nodes, variables: workflowVariables, namespaceVariables }, drillPathRaw),
    [nodes, workflowVariables, namespaceVariables, drillPathRaw],
  )

  // State for output-bound variable delete confirmation
  const [pendingDeleteVarId, setPendingDeleteVarId] = useState<string | null>(null)
  const [pendingDeleteVarName, setPendingDeleteVarName] = useState('')
  const [pendingDeleteDescription, setPendingDeleteDescription] = useState('')

  // Real-time variable updates via WebSocket (REQ-3.1.3.12)
  // Runtime values live in the hook's Map - NOT in the Zustand store.
  // This prevents runtime execution values from polluting the test definition on save.
  /* v8 ignore start - COV-CONTAINER-011 */
  const {
    values: runtimeValues,
    recentlyChangedPaths,
    forget: forgetRuntimeValue,
  } = useVariableUpdates({
    sessionId,
    registerVariableHandler,
  })
  /* v8 ignore stop */

  // Idle Current-edit staging: a Current edit with no live session
  // stages a transient override here; the run-seed merges it on every run and
  // it clears on Reset (sessionId -> null).
  const {
    read: readStagedOverrides,
    stage: stageOverride,
    restage: restageOverrides,
    clear: clearStagedOverrides,
  } = useStagedOverrides()

  // Current-mode display state by scope: every Current edit, and the values shown at run start.
  const [appliedOverrides, setAppliedOverrides] = useState<Map<string, StagedOverride>>(
    () => new Map()
  )
  const [runStartSnapshot, setRunStartSnapshot] = useState<Map<string, unknown>>(() => new Map())
  const [runStartElementTypes, setRunStartElementTypes] = useState<Map<string, ElementTypes>>(
    () => new Map(),
  )
  const prevSessionIdRef = useRef<string | null>(null)
  // The name the live run declared for a variable renamed since it started, by its scoped key now.
  const runNamesRef = useRef<Map<string, string>>(new Map())
  // What the live run declared at its start; a Current value it does not hold waits for the next run.
  const runDeclarationsRef = useRef<RunDeclarations>(NO_RUN_DECLARATIONS)

  // A window's scope as node ids, the drilled one when absent (REQ-3.1.2.10).
  const nodePathOf = useCallback(
    (functionPath: ReadonlyArray<DrillEntry> | undefined) => drillNodePath(functionPath ?? drillPathRaw, inFunctionView),
    [drillPathRaw, inFunctionView],
  )

  // What decides whether an evaluated result of a scope outlives an edit (REQ-3.2.1.5), per scope like every live map.
  const resultsContextOf = useCallback(
    (scope: ScopeRows): ResultsContext => ({
      variables: scope.rows,
      live: namesInScope(runtimeValues, scope.keyPath),
      overrides: namesInScope(appliedOverrides, scope.keyPath),
      blockWritten: namesBlocksWrite(scope.nodes as NamedBlock[]),
      namesRead: namesReadBySource,
    }),
    [runtimeValues, appliedOverrides],
  )

  // An effect, not a handler: pencil, rename, delete and undo all change the definitions, in any scope.
  const previousTreeRef = useRef({ nodes, variables: workflowVariables })
  useEffect(() => {
    const previous = previousTreeRef.current
    previousTreeRef.current = { nodes, variables: workflowVariables }
    if (previous.nodes === nodes && previous.variables === workflowVariables) return
    const before = rowsByScope(previous.nodes, previous.variables, inFunctionView)
    const after = rowsByScope(nodes, workflowVariables, inFunctionView)
    for (const [scopeKey, scope] of after) {
      const context = resultsContextOf(scope)
      for (const name of resultsReading(editedDefinitions(before.get(scopeKey)?.rows ?? [], context), context)) {
        forgetRuntimeValue(scopedVariableKey(name, scope.keyPath))
      }
    }
    // An undo or redo changes definitions with no window Save: Current values follow it too.
    for (const { keyPath, name, renamedTo } of definitionChanges(before, after)) {
      const follow =
        renamedTo === undefined
          ? (map: Map<string, StagedOverride>) => withoutScoped(map, name, keyPath)
          : (map: Map<string, StagedOverride>) => renamedScoped(map, name, renamedTo, keyPath)
      restageOverrides(follow)
      setAppliedOverrides(follow)
      if (renamedTo !== undefined) followRunName(runNamesRef.current, name, renamedTo, keyPath)
    }
  }, [nodes, workflowVariables, inFunctionView, resultsContextOf, forgetRuntimeValue, restageOverrides])

  // displayVariables is the workflow store's variables. The Variable Manager
  // panel applies the runtime overlay per row at render time, keyed by the
  // separate runtimeValues map below.
  //
  // When drilled into a local Function the panel renders rows for the
  // declared inputs, declared outputs, and Function-local vars in one
  // merged list. The Function scope hook supplies the declared-name
  // arrays; the workflow store's active-subtree selectors return the
  // Function-local vars. We compose them here so the Var Manager
  // receives one flat list with the scope-aware row kind computed by
  // `classifyKind` in content.tsx.
  //
  // Subscribing to `nodes` (already done above) is what keeps this memo
  // fresh when a variable / input / output is added inside the drilled-in
  // Function - the new entry lives nested in the active Function's
  // localDefinition (still inside `state.nodes`), so the memo must include
  // `nodes` in its dependency list or it returns the stale array.
  // (drillPathRaw is subscribed above so it can also feed availableVariablesForManager.)
  const displayVariables = useMemo<ManagerRow[]>(() => {
    if (drillPathRaw.length === 0) return workflowVariables
    // Inside a Function: build synthetic Variable rows from the declared
    // input + output param specs, then concatenate the Function-local vars.
    // Synthetic ids use a deterministic `param:` prefix so the rows stay
    // identity-stable across renders without colliding with real var ids.
    // Defensive: walkActiveSubtree throws on a missing node id; in that
    // race (e.g. node removed mid-render) return an empty list rather than
    // letting the exception bubble through the Var Manager.
    return functionScopeRows(activeFunctionScopeBody(nodes, drillPathRaw))
  }, [drillPathRaw, nodes, workflowVariables])

  // A variable read only by another variable or an Expression / Template output is not Unused.
  const crossVariableRefs = useMemo(
    () => collectCrossVariableExpressionRefs(displayVariables),
    [displayVariables],
  )

  // Every name a block of the scope reads or writes, or another variable reads.
  const workflowReferencedVarNames = useMemo(
    () => new Set([...outputBoundVarNames, ...inputRefCounts.keys(), ...blockWrittenNames, ...crossVariableRefs]),
    [outputBoundVarNames, inputRefCounts, blockWrittenNames, crossVariableRefs],
  )

  const savedVariables = useWorkflowStore((state) => state.getSavedVariables())
  const savedNodes = useWorkflowStore((state) => state.getSavedNodes())
  const viewBaseline = useWorkflowStore((state) => state.functionViewBaseline)
  const { unsavedSecretIds, changedSecretIds } = useMemo(
    () =>
      secretVisibility(
        { nodes, variables: workflowVariables },
        { nodes: savedNodes, variables: savedVariables },
        { inFunctionView, baseline: inFunctionView ? (viewBaseline as { nodeId: string; body: ScopeBody } | null) : null },
      ),
    [nodes, workflowVariables, savedNodes, savedVariables, inFunctionView, viewBaseline],
  )

  // A session start snapshots the shown values; only Reset clears Current values, a shown input's kept (FNCFG-8).
  useEffect(() => {
    const prev = prevSessionIdRef.current
    prevSessionIdRef.current = sessionId
    if (sessionId === prev) return
    runNamesRef.current = new Map()
    runDeclarationsRef.current = NO_RUN_DECLARATIONS
    const shownPath = nodePathOf(undefined)
    if (sessionId === null) {
      const kept = new Set(
        displayVariables
          .filter((row) => row.id.startsWith('param:input:'))
          .map((row) => scopedVariableKey(row.name, shownPath)),
      )
      clearStagedOverrides(kept)
      setAppliedOverrides((map) => keepNamed(map, kept))
      setRunStartSnapshot((map) => (map.size === 0 ? map : new Map()))
      setRunStartElementTypes((map) => (map.size === 0 ? map : new Map()))
      return
    }
    // Every scope, so a Function the canvas did not show at start keeps its start values too (VMGR-19).
    const start = runStartValues(nodes, workflowVariables, inFunctionView)
    runDeclarationsRef.current = start.declarations
    setRunStartSnapshot(start.values)
    setRunStartElementTypes(start.elementTypes)
  }, [sessionId, displayVariables, clearStagedOverrides, nodePathOf, nodes, workflowVariables, inFunctionView])

  // A Current value of a Function Block that left a loaded body goes with it.
  const viewRootPath = useMemo(
    () => (inFunctionView ? drillPathRaw.slice(0, 1).map((entry) => entry.nodeId) : []),
    [inFunctionView, drillPathRaw],
  )
  useEffect(() => {
    const isGone = (functionPath: string[]) =>
      functionPath.length > 0 && isInstanceGone(nodes, [...viewRootPath, ...functionPath])
    restageOverrides((map) => withoutGoneScopes(map, isGone))
    setAppliedOverrides((map) => withoutGoneScopes(map, isGone))
  }, [nodes, viewRootPath, restageOverrides])

  // A drilled-into-Shared scope is read-only: structural edits (add input /
  // output / variable) are blocked here as defense in depth behind the hidden
  // affordance.
  const isReadOnlyScope = useReadOnlyCanvas()

  // Both checks read the scope the create writes to: the window's own, else the drilled one (VMGR-102).
  const cycleOnCreate = useCallback(
    (candidate: Omit<WorkflowVariable, 'id'>, functionPath?: DrillEntry[]) =>
      detectExpressionCycle([
        ...scopeCycleVariables(nodes, workflowVariables, functionPath ?? drillPathRaw),
        { ...candidate, id: '__pending__' } as WorkflowVariable,
      ]),
    [nodes, workflowVariables, drillPathRaw],
  )

  const handleCreateVariable = useCallback(
    (variable: Omit<WorkflowVariable, 'id'>, functionPath?: DrillEntry[]) => {
      const cycleError = cycleOnCreate(variable, functionPath)
      if (cycleError) {
        return { success: false, error: cycleError }
      }
      try {
        if (functionPath === undefined) addVariable(variable)
        else addVariable(variable, functionPath)
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [addVariable, cycleOnCreate]
  )

  // The store actions refuse an input / output outside a Function, so no second guard here.
  const handleCreateParameter = useCallback(
    (mode: CreateDialogMode, spec: VariableCreateSpec, functionPath?: DrillEntry[]) => {
      const readOnly = functionPath === undefined ? isReadOnlyScope : isScopeReadOnly(nodes, functionPath)
      if (readOnly) {
        return { success: false, error: 'Read-only scope: structural edits are disabled' }
      }
      if (mode === 'variable') {
        return handleCreateVariable({
          name: spec.name,
          type: spec.type,
          value: spec.value,
          isSecret: spec.secret,
          isExpression: spec.isExpression,
          isTemplate: spec.isTemplate,
          ...(spec.elementTypes === undefined ? {} : { elementTypes: spec.elementTypes }),
        }, functionPath)
      }
      const paramSpec = paramSpecFrom(mode, spec)
      const [paramRow] = paramSpecsToVariables([paramSpec as RawParamSpec], mode)
      const cycleError = cycleOnCreate(paramRow, functionPath)
      if (cycleError) return { success: false, error: cycleError }
      const addParam = mode === 'input' ? addInputParam : addOutputParam
      try {
        if (functionPath === undefined) addParam(paramSpec)
        else addParam(paramSpec, functionPath)
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [isReadOnlyScope, nodes, handleCreateVariable, cycleOnCreate, addInputParam, addOutputParam],
  )

  // Live cycle validation for expression-mode value edits. Both the create
  // and edit dialogs call this on blur of the expression field so the user
  // sees the error before clicking Save. Returns null when the proposed
  // change is acyclic.
  const validateExpressionCycle = useCallback(
    (params: {
      variableId?: string
      variableName: string
      value: unknown
      isExpression: boolean
      functionPath?: DrillEntry[]
    }) => {
      if (!params.isExpression || typeof params.value !== 'string') return null
      const scope = scopeCycleVariables(nodes, workflowVariables, params.functionPath ?? drillPathRaw)
      let candidate: VariableLikeForCycle[]
      if (params.variableId === undefined) {
        candidate = [
          ...scope,
          {
            name: params.variableName,
            value: params.value,
            isExpression: true,
          },
        ]
      } else {
        candidate = scope.map((v) =>
          v.id === params.variableId
            ? { name: params.variableName, value: params.value, isExpression: true }
            : v,
        )
      }
      return detectExpressionCycle(candidate)
    },
    [nodes, workflowVariables, drillPathRaw],
  )

  // A Current value in the window's scope goes to the live session, else is staged; shown only once it landed.
  const applyVariableOverride = useCallback(
    async (name: string, body: WorkbenchVariableOverrideBody, functionPath?: DrillEntry[]): Promise<void> => {
      const nodePath = nodePathOf(functionPath)
      const key = scopedVariableKey(name, nodePath)
      const renamed = runNamesRef.current.get(key)
      const runName = renamed ?? name
      // A variable the run declared under this name but now renamed is not this one (a new variable took the name).
      const nameMoved =
        renamed === undefined &&
        [...runNamesRef.current].some(
          ([other, declared]) =>
            declared === name && other !== key && JSON.stringify(parseScopedVariableKey(other).functionPath) === JSON.stringify(nodePath),
        )
      if (sessionId && !nameMoved && runTakes(runDeclarationsRef.current, runName, body, nodePath)) {
        await workbenchApi.setVariableOverride(sessionId, runName, body, nodePath.length > 0 ? nodePath : undefined)
      } else {
        stageOverride(name, body, nodePath)
      }
      // The backend cannot return a re-armed source post-eval, so the override
      // value + source are held here for the Current-mode display.
      setAppliedOverrides((prev) => new Map(prev).set(key, body))
      // The results that read it are due again; a re-armed source holds no value (REQ-3.2.1.6).
      const scope = rowsByScope(nodes, workflowVariables, inFunctionView).get(JSON.stringify(nodePath))
      const reading = scope ? resultsReading([name], resultsContextOf(scope)) : []
      const due = new Set(reading.map((readingName) => scopedVariableKey(readingName, nodePath)))
      if ('value' in body) due.delete(key)
      else due.add(key)
      for (const dueKey of due) forgetRuntimeValue(dueKey)
    },
    [nodePathOf, sessionId, stageOverride, forgetRuntimeValue, nodes, workflowVariables, inFunctionView, resultsContextOf]
  )

  const handleVariableCurrentEdit = useCallback(
    async (name: string, body: WorkbenchVariableOverrideBody, functionPath?: DrillEntry[]): Promise<void> => {
      try {
        await applyVariableOverride(name, body, functionPath)
      } catch (err) {
        toastError(
          `"${name}" is unchanged: ${toFailureDetail(err).message}`,
          'Current Value Not Saved',
        )
        throw err
      }
    },
    [applyVariableOverride, toastError]
  )

  /* v8 ignore start - COV-CONTAINER-005 */
  const handleVariableDelete = useCallback(
    (id: string) => {
      // Always open the confirmation dialog regardless of reference count -
      // matches the existing pattern for suite / profile deletes which never
      // delete silently. The description carries the impact text when the
      // entity is referenced; otherwise it falls back to the standard
      // "permanently removed" copy used elsewhere in the project. The
      // dialog title uses the row's name (via pendingDeleteVarName) so the
      // user sees exactly which entity is about to be deleted.
      const variable = displayVariables.find((v) => v.id === id)
      if (!variable) return
      const varName = variable.name

      if (id.startsWith('param:input:')) {
        const usedCount = inputRefCounts.get(varName) || 0
        const description = describeInputDelete(usedCount)
        setPendingDeleteVarId(id)
        setPendingDeleteVarName(varName)
        setPendingDeleteDescription(description)
        return
      }
      const sourceNames = outputBoundVarSources.get(varName) || []
      const boundCount = sourceNames.length
      const usedCount = inputRefCounts.get(varName) || 0

      const description = id.startsWith('param:output:')
        ? describeOutputDelete(boundCount, sourceNames, usedCount)
        : describeVariableDelete(boundCount, sourceNames, usedCount)
      setPendingDeleteVarId(id)
      setPendingDeleteVarName(varName)
      setPendingDeleteDescription(description)
    },
    [displayVariables, outputBoundVarSources, inputRefCounts]
  )

  const confirmVariableDelete = useCallback(() => {
    if (!pendingDeleteVarId) return
    // A deleted variable of the scope shown takes its staged and applied Current value with it.
    const shownPath = nodePathOf(undefined)
    const dropCurrent = (map: Map<string, StagedOverride>) => withoutScoped(map, pendingDeleteVarName, shownPath)
    restageOverrides(dropCurrent)
    setAppliedOverrides(dropCurrent)
    // One transaction, so undo restores the variable or parameter and the bindings it cleared together.
    transaction(() => {
      // setNodes writes the drilled scope, so it gets that scope's Blocks, never the whole tree.
      const scopeNodes = walkActiveSubtree(nodes, [], [], drillPathRaw).nodes
      const cleaned = withoutBindingsTo(scopeNodes, pendingDeleteVarName)
      if (cleaned !== scopeNodes) setNodes(cleaned)
      if (pendingDeleteVarId.startsWith('param:input:')) removeInputParam(pendingDeleteVarId.slice('param:input:'.length))
      else if (pendingDeleteVarId.startsWith('param:output:')) removeOutputParam(pendingDeleteVarId.slice('param:output:'.length))
      else removeVariable(pendingDeleteVarId)
    }, 'Delete variable')
    setPendingDeleteVarId(null)
    setPendingDeleteVarName('')
    setPendingDeleteDescription('')
  }, [pendingDeleteVarId, pendingDeleteVarName, nodePathOf, restageOverrides, removeVariable, removeInputParam, removeOutputParam, nodes, drillPathRaw, setNodes, transaction])
  /* v8 ignore stop */

  // A staged or applied Current value moves with a rename and goes with a retype or a Kind change (REQ-3.2.1.6).
  const followDefinition = useCallback(
    (target: WorkflowVariable, spec: VariableCreateSpec, functionPath: DrillEntry[] | undefined) => {
      const nodePath = nodePathOf(functionPath)
      const sameKind = !!spec.isExpression === !!target.isExpression && !!spec.isTemplate === !!target.isTemplate
      const follow =
        spec.type === target.type && sameKind
          ? (map: Map<string, StagedOverride>) => renamedScoped(map, target.name, spec.name, nodePath)
          : (map: Map<string, StagedOverride>) => withoutScoped(map, target.name, nodePath)
      restageOverrides(follow)
      setAppliedOverrides(follow)
      if (sessionId !== null) followRunName(runNamesRef.current, target.name, spec.name, nodePath)
    },
    [nodePathOf, restageOverrides, sessionId],
  )

  // One definition Save for the four kinds in the window's scope; parameters take the parameter path (REQ-3.1.2.1).
  const handleVariableWindowSave = useCallback(
    (target: WorkflowVariable, spec: VariableCreateSpec, functionPath?: DrillEntry[]) => {
      // Frontend cycle detection mirrors the backend gate so the window shows it at Save.
      const scope = scopeCycleVariables(nodes, workflowVariables, functionPath ?? drillPathRaw)
      const cycleError = detectExpressionCycle(
        scope.map((v) =>
          v.id === target.id ? { ...v, name: spec.name, value: spec.value, isExpression: !!spec.isExpression } : v,
        ),
      )
      if (cycleError) return { success: false, error: cycleError }

      const kind = parameterKind(target.id)
      let outcome: { success: boolean; error?: string } = { success: true }
      if (kind === null) {
        const isRenaming = spec.name !== target.name
        try {
          transaction(() => {
            if (isRenaming) {
              const renamed = renameVariable(target.id, spec.name, functionPath)
              if (!renamed.success) {
                outcome = renamed
                throw new Error(renamed.error)
              }
            }
            updateVariable(target.id, windowVariablePatch(spec), functionPath)
          }, isRenaming ? `Rename variable "${target.name}" to "${spec.name}"` : 'Update variable')
        } catch {
          // The transaction rolled back; a refused rename is reported below.
        }
      } else {
        const update = kind === 'input' ? updateInputParam : updateOutputParam
        outcome = update(target.name, windowParamPatch(kind, target, spec), functionPath)
      }
      if (outcome.success) followDefinition(target, spec, functionPath)
      return outcome
    },
    [
      nodes,
      workflowVariables,
      drillPathRaw,
      transaction,
      renameVariable,
      updateVariable,
      updateInputParam,
      updateOutputParam,
      followDefinition,
    ],
  )

  // Convenience: clear all three pending-delete fields in one call. The
  // ConfirmationDialog onClose handler in container.tsx routes here instead
  // of inlining a three-setter lambda; keeping the body in the hook keeps
  // the close path uniformly testable.
  const cancelPendingDelete = useCallback(() => {
    setPendingDeleteVarId(null)
    setPendingDeleteVarName('')
    setPendingDeleteDescription('')
  }, [])

  return {
    outputBoundVarNames,
    outputBoundVarSources,
    inputRefCounts,
    workflowReferencedVarNames,
    availableVariablesForManager,
    displayVariables,
    unsavedSecretIds,
    changedSecretIds,
    runtimeValues,
    handleCreateVariable,
    handleCreateParameter,
    validateExpressionCycle,
    handleVariableWindowSave,
    applyVariableOverride,
    handleVariableCurrentEdit,
    readStagedOverrides,
    appliedOverrides,
    runStartSnapshot,
    runStartElementTypes,
    handleVariableDelete,
    confirmVariableDelete,
    pendingDeleteVarId,
    pendingDeleteVarName,
    pendingDeleteDescription,
    setPendingDeleteVarId,
    setPendingDeleteVarName,
    setPendingDeleteDescription,
    cancelPendingDelete,
    recentlyChangedPaths,
  }
}
