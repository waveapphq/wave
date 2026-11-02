/** The scopes of a canvas (the Test root and every Function body) and the Variable Manager rows of each (REQ-3.1.1.5). */

import { walkActiveSubtree, type DrillEntry } from '@/features/functions/canvas/inner-workflow'
import type { WorkflowVariable } from '@/features/workbench/stores/workflow-store'
import { isElementTypes } from '@/lib/variable-validation'

/** A declared input or output as a Function body stores it. */
export interface RawParamSpec {
  name?: unknown
  type?: unknown
  default?: unknown
  required?: unknown
  description?: unknown
  enumValues?: unknown
  secret?: unknown
  isExpression?: unknown
  isTemplate?: unknown
  elementTypes?: unknown
}

/** A Variable Manager row: a variable, or a Function parameter with its declaration (REQ-3.1.1.5). */
export type ManagerRow = WorkflowVariable & { required?: boolean; description?: string; enumValues?: unknown[] }

/** The body of the deepest Function on `drillPath`, or null when the path resolves to none. */
export function activeFunctionScopeBody(rootNodes: unknown[], drillPath: DrillEntry[]): ScopeBody | null {
  return walkActiveSubtree(rootNodes, [], [], drillPath).localDefinition as ScopeBody | null
}

const VALID_TYPES = new Set<WorkflowVariable['type']>(['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'])

/** Declared inputs or outputs as rows; the `param:` id prefix keeps them stable and apart from variable ids. */
export function paramSpecsToVariables(specs: RawParamSpec[], kind: 'input' | 'output'): ManagerRow[] {
  return specs
    .filter((spec): spec is RawParamSpec & { name: string } => typeof spec?.name === 'string')
    .map((spec) => {
      const rawType = typeof spec.type === 'string' ? spec.type : 'string'
      const type = VALID_TYPES.has(rawType as WorkflowVariable['type']) ? (rawType as WorkflowVariable['type']) : 'string'
      const row: ManagerRow = {
        id: `param:${kind}:${spec.name}`,
        name: spec.name,
        // A parameter with no default holds null, drawn in the null look.
        value: spec.default ?? null,
        type,
      }
      if (isElementTypes(spec.elementTypes)) row.elementTypes = spec.elementTypes
      // A secret parameter's default is masked; an output's Kind shows its badge.
      if (spec.secret === true) row.isSecret = true
      if (spec.isExpression === true) row.isExpression = true
      if (spec.isTemplate === true) row.isTemplate = true
      if (spec.required === true) row.required = true
      if (typeof spec.description === 'string') row.description = spec.description
      if (Array.isArray(spec.enumValues)) row.enumValues = spec.enumValues
      return row
    })
}

/** A Function scope's rows: its inputs and outputs (with their defaults), then its locals. */
export function functionScopeRows(body: ScopeBody | null | undefined): ManagerRow[] {
  return [
    ...paramSpecsToVariables(body?.inputs ?? [], 'input'),
    ...paramSpecsToVariables(body?.outputs ?? [], 'output'),
    ...(body?.variables ?? []),
  ]
}

/** A Function body as the scope walk reads it. */
export interface ScopeBody {
  variables?: WorkflowVariable[]
  inputs?: RawParamSpec[]
  outputs?: RawParamSpec[]
  workflow?: { nodes?: unknown[] }
}

/** A name a Function scope can read, and the labels of the Blocks in that scope whose outputs write it. */
export interface ScopeName {
  name: string
  kind: 'input' | 'output' | 'local' | 'profile'
  writers: string[]
}

interface ScopeBlockData {
  label?: unknown
  config?: { outputBindings?: unknown; profileBindings?: unknown }
}

function entryNames(entries: unknown): string[] {
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry: unknown) => {
    const name = entry !== null && typeof entry === 'object' ? (entry as { name?: unknown }).name : undefined
    return typeof name === 'string' && name !== '' ? [name] : []
  })
}

function blocksOf(body: ScopeBody): ScopeBlockData[] {
  const nodes = body.workflow?.nodes
  if (!Array.isArray(nodes)) return []
  return nodes.flatMap((node: unknown) => {
    const data = node !== null && typeof node === 'object' ? (node as { data?: unknown }).data : undefined
    return data !== null && typeof data === 'object' ? [data as ScopeBlockData] : []
  })
}

function boundTargets(data: ScopeBlockData): string[] {
  const bindings = data.config?.outputBindings
  if (bindings === null || typeof bindings !== 'object') return []
  return Object.values(bindings as Record<string, unknown>).filter(
    (target): target is string => typeof target === 'string' && target !== '',
  )
}

function profileAliases(data: ScopeBlockData): string[] {
  const bindings = data.config?.profileBindings
  if (!Array.isArray(bindings)) return []
  return bindings.flatMap((binding: unknown) => {
    const alias = binding !== null && typeof binding === 'object' ? (binding as { alias?: unknown }).alias : undefined
    return typeof alias === 'string' && alias !== '' ? [alias] : []
  })
}

/**
 * The one scope-names reader (REQ-3.1.3.11): a Function's inputs, outputs and locals in declared order,
 * then the profile aliases its own Blocks bind, each with the Blocks of the scope that write it.
 */
export function functionScopeNames(body: ScopeBody | null | undefined): ScopeName[] {
  if (!body) return []
  const names: ScopeName[] = []
  const byName = new Map<string, ScopeName>()
  const add = (name: string, kind: ScopeName['kind']) => {
    if (byName.has(name)) return
    const entry: ScopeName = { name, kind, writers: [] }
    byName.set(name, entry)
    names.push(entry)
  }
  for (const name of entryNames(body.inputs)) add(name, 'input')
  for (const name of entryNames(body.outputs)) add(name, 'output')
  for (const name of entryNames(body.variables)) add(name, 'local')
  const blocks = blocksOf(body)
  for (const data of blocks) for (const alias of profileAliases(data)) add(alias, 'profile')
  for (const data of blocks) {
    const label = typeof data.label === 'string' ? data.label : ''
    for (const target of new Set(boundTargets(data))) byName.get(target)?.writers.push(label)
  }
  return names
}

interface FunctionNodeData {
  nodeType?: unknown
  functionLifecycle?: unknown
  editMode?: unknown
  localDefinition?: ScopeBody
  draft?: ScopeBody
}

interface FunctionNodeLike {
  id: string
  data?: FunctionNodeData
}

/** A Function Block's body: the drilled working copy, else a Shared draft's own (the saved Test keeps only that). */
function bodyOf(data: FunctionNodeData | undefined): ScopeBody | undefined {
  if (data?.nodeType !== 'function') return undefined
  return data.localDefinition ?? (data.editMode === true ? data.draft : undefined)
}

/** A Function whose secrets its saved definition tracks: a Local Function, a Shared draft (saved with the Test), or the library View root. */
function tracksBody(node: FunctionNodeLike, viewRootId: string | null): boolean {
  return node.data?.functionLifecycle === 'local' || node.data?.editMode === true || node.id === viewRootId
}

/** Visits the Test root and every Function body: its node-id path, and whether every Function on it is tracked. */
export function visitScopes(
  rootNodes: unknown[],
  rootVariables: WorkflowVariable[],
  viewRootId: string | null,
  visit: (path: string[], body: ScopeBody, tracked: boolean) => void,
): void {
  visit([], { variables: rootVariables }, true)
  walkBodies(rootNodes, [], true, viewRootId, visit)
}

/** Walks the Function bodies under one level of nodes (see visitScopes). */
export function walkBodies(
  nodes: unknown[],
  path: string[],
  tracked: boolean,
  viewRootId: string | null,
  visit: (path: string[], body: ScopeBody, tracked: boolean) => void,
): void {
  for (const node of nodes as FunctionNodeLike[]) {
    const body = bodyOf(node.data)
    if (!body) continue
    const childPath = [...path, node.id]
    const childTracked = tracked && tracksBody(node, viewRootId)
    visit(childPath, body, childTracked)
    walkBodies(body.workflow?.nodes ?? [], childPath, childTracked, viewRootId, visit)
  }
}

/** Every Function Block whose body the tree does not hold (a Shared Function), by node-id path. */
export function instancesWithoutBody(rootNodes: unknown[]): string[][] {
  const found: string[][] = []
  const walk = (nodes: unknown[], path: string[]) => {
    for (const node of nodes as FunctionNodeLike[]) {
      if (node.data?.nodeType !== 'function') continue
      const childPath = [...path, node.id]
      const body = bodyOf(node.data)
      if (body) walk(body.workflow?.nodes ?? [], childPath)
      else found.push(childPath)
    }
  }
  walk(rootNodes, [])
  return found
}

/** A scope (full node-id path) whose secrets a saved definition tracks: the Test root or a chain of tracked Functions. */
export function tracksSecretsAt(rootNodes: unknown[], path: readonly string[], viewRootId: string | null): boolean {
  let nodes = rootNodes as FunctionNodeLike[]
  for (const id of path) {
    const node = nodes.find((candidate) => candidate.id === id)
    const body = node && bodyOf(node.data)
    if (!node || !body || !tracksBody(node, viewRootId)) return false
    nodes = (body.workflow?.nodes ?? []) as FunctionNodeLike[]
  }
  return true
}
