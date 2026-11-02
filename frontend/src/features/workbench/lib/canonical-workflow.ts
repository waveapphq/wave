/**
 * Canonical workflow transform: one definition of the
 * persistence shape shared by save payloads, run-current payloads, derived
 * dirty, and history surgery, plus the order-stable structural equality used
 * for snapshot comparison.
 */

import {
  foldLocalDefinitionIntoDraft,
  type LocalDefinitionBody,
} from '@/features/functions/lib/edit-mode-draft'
import type { WorkflowVariable } from '@/features/workbench/stores/workflow-store'
import { secureRandomId } from '@/lib/utils'
import { isElementTypes, type ElementTypes } from '@/lib/variable-validation'

interface CanonicalNodeShape {
  data: Record<string, unknown>
  selected?: boolean
  dragging?: boolean
  measured?: { width?: number; height?: number }
}

interface BodyShape {
  workflow?: { nodes?: unknown[]; edges?: unknown[] }
  [key: string]: unknown
}

function canonicalizeBody(body: BodyShape): BodyShape {
  const workflow = (body.workflow ?? { nodes: [], edges: [] }) as {
    nodes?: unknown[]
    edges?: unknown[]
  }
  return {
    ...body,
    workflow: {
      ...workflow,
      nodes: canonicalizeNodes((workflow.nodes ?? []) as CanonicalNodeShape[]),
      edges: canonicalizeEdges((workflow.edges ?? []) as object[]),
    },
  }
}

function isSharedFunction(data: Record<string, unknown>): boolean {
  return data.nodeType === 'function' && data.functionLifecycle === 'shared'
}

/**
 * Recursively reduce a node tree to its persistence shape at every depth:
 * strip selection/drag/measure residue and `hasNewerVersion`; fold an
 * edit-mode Shared's transient working body into its draft; drop the
 * drill-stamped transient body of a non-edit Shared; keep (and canonicalize
 * inside) the persisted `localDefinition` of Local Functions.
 */
export function canonicalizeNodes<T extends CanonicalNodeShape>(nodes: readonly T[]): T[] {
  return nodes.map((node) => {
    const { selected: _selected, dragging: _dragging, measured: _measured, ...rest } = node
    if (!rest.data || typeof rest.data !== 'object') return rest as unknown as T
    const { hasNewerVersion: _hnv, ...data } = rest.data
    if (isSharedFunction(data)) {
      const { localDefinition: stamp, ...sharedRest } = data
      const sharedData = sharedRest as Record<string, unknown>
      if (sharedData.editMode && stamp && typeof stamp === 'object') {
        sharedData.draft = foldLocalDefinitionIntoDraft(
          sharedData.draft as Record<string, unknown> | undefined,
          stamp as LocalDefinitionBody,
        )
      }
      if (sharedData.draft && typeof sharedData.draft === 'object') {
        sharedData.draft = canonicalizeBody(sharedData.draft as BodyShape)
      }
      return { ...rest, data: sharedData } as unknown as T
    }
    const next: Record<string, unknown> = { ...data }
    if (next.localDefinition && typeof next.localDefinition === 'object') {
      next.localDefinition = canonicalizeBody(next.localDefinition as BodyShape)
    }
    return { ...rest, data: next } as unknown as T
  })
}

/** Strip transient UI residue (`selected`) from edges. */
export function canonicalizeEdges<T extends object>(edges: readonly T[]): T[] {
  return edges.map((edge) => {
    const { selected: _selected, ...rest } = edge as T & { selected?: boolean }
    return rest as T
  })
}

/**
 * Targeted shared-drill stamp removal. Strips the transient `localDefinition`
 * from Shared instances at any depth, folding an edit-mode node's working
 * body into its draft first so edits survive. `only` limits the strip to the
 * given ids; `keep` strips every stamped Shared EXCEPT the given ids.
 */
export function stripSharedDrillStamps<T extends CanonicalNodeShape & { id: string }>(
  nodes: readonly T[],
  target: { only?: ReadonlySet<string>; keep?: ReadonlySet<string> },
): T[] {
  let mutated = false
  const next = nodes.map((node) => {
    const data = node.data
    const shouldStrip = target.only ? target.only.has(node.id) : !target.keep?.has(node.id)
    if (isSharedFunction(data) && data.localDefinition && shouldStrip) {
      mutated = true
      const { localDefinition: stamp, ...restData } = data
      if (restData.editMode) {
        restData.draft = foldLocalDefinitionIntoDraft(
          restData.draft as Record<string, unknown> | undefined,
          stamp as LocalDefinitionBody,
        )
      }
      return { ...node, data: restData }
    }
    const localDef = data.localDefinition as BodyShape | undefined
    const innerNodes = localDef?.workflow?.nodes as T[] | undefined
    if (!innerNodes) return node
    const innerNext = stripSharedDrillStamps(innerNodes, target)
    if (innerNext === innerNodes) return node
    mutated = true
    return {
      ...node,
      data: {
        ...data,
        localDefinition: {
          ...localDef,
          workflow: { ...localDef!.workflow, nodes: innerNext },
        },
      },
    }
  })
  return mutated ? next : (nodes as T[])
}

/**
 * Order-stable structural equality: key-order insensitive, value- and
 * array-order sensitive. Keys holding `undefined` compare as absent.
 */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => canonicalEqual(item, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const aRec = a as Record<string, unknown>
    const bRec = b as Record<string, unknown>
    const aKeys = Object.keys(aRec)
      .filter((k) => aRec[k] !== undefined)
      .sort((x, y) => x.localeCompare(y))
    const bKeys = Object.keys(bRec)
      .filter((k) => bRec[k] !== undefined)
      .sort((x, y) => x.localeCompare(y))
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((k, i) => k === bKeys[i] && canonicalEqual(aRec[k], bRec[k]))
  }
  return false
}

// ---------------------------------------------------------------------------
// Stored variable shape: the one place the canvas `isSecret` and the stored `secret` meet
// ---------------------------------------------------------------------------

/** One variable as the backend stores it: a Test keys these by name, a Function body lists them with their name. */
export interface VariableEntry {
  /** Absent when the variable is declared but was never given a value. */
  value?: unknown
  type: string
  isExpression?: boolean
  /** Template string value kind (REQ-3.1.3.15). Mutually exclusive with isExpression. */
  isTemplate?: boolean
  /** The stored secret flag; the canvas calls it `isSecret`. */
  secret?: boolean
  /** Array / map literal only: each element's declared type (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

/** A Function body's local variable as stored (REQ-3.1.2.1). */
export type FunctionVariableEntry = VariableEntry & { name: string }

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An array / map literal with a value stores its element types (REQ-3.1.3.19). */
function carriesElementTypes(v: WorkflowVariable): boolean {
  return (
    v.elementTypes !== undefined &&
    (v.type === 'array' || v.type === 'map') &&
    v.value !== undefined &&
    !v.isExpression
  )
}

/** The stored entry of a canvas variable. */
export function storedVariableEntry(v: WorkflowVariable): VariableEntry {
  // No value key means the variable holds null, so nothing invents an initial value.
  const entry: VariableEntry = v.value === undefined ? { type: v.type } : { value: v.value, type: v.type }
  if (v.isExpression) entry.isExpression = true
  if (v.isTemplate) entry.isTemplate = true
  if (v.isSecret) entry.secret = true
  if (carriesElementTypes(v)) entry.elementTypes = v.elementTypes
  return entry
}

/** A fresh canvas id for a loaded variable. */
export function newVariableId(name: string): string {
  return `var-${name}-${Date.now()}-${secureRandomId(7)}`
}

/** The canvas variable of a stored entry. */
export function canvasVariable(id: string, name: string, stored: Rec & { type: string }): WorkflowVariable {
  const variable: WorkflowVariable = { id, name, type: stored.type as WorkflowVariable['type'] }
  // No value key means the declaration holds null.
  if ('value' in stored) variable.value = stored.value
  if (stored.isExpression) variable.isExpression = true
  if (stored.isTemplate) variable.isTemplate = true
  if (stored.secret) variable.isSecret = true
  if (isElementTypes(stored.elementTypes)) variable.elementTypes = stored.elementTypes
  return variable
}

/** A Function body's local variables in their stored list shape. */
export function storedFunctionVariables(variables: readonly WorkflowVariable[]): FunctionVariableEntry[] {
  return variables.map((v) => ({ name: v.name, ...storedVariableEntry(v) }))
}

/** A Function body's stored `variables` list as canvas variables. */
export function canvasFunctionVariables(
  stored: unknown,
  makeId: (name: string) => string = newVariableId,
): WorkflowVariable[] {
  if (!Array.isArray(stored)) return []
  return stored
    .filter((entry): entry is Rec & { name: string; type: string } => isRec(entry) && typeof entry.name === 'string')
    .map((entry) => canvasVariable(makeId(entry.name), entry.name, entry))
}

type VariablesMap = (variables: unknown[]) => unknown[]

const toStoredVariables: VariablesMap = (variables) => storedFunctionVariables(variables as WorkflowVariable[])
const toCanvasVariables: VariablesMap = (variables) => canvasFunctionVariables(variables)

/** One Function body's locals and every nested body's locals passed through `mapVariables`. */
function mapBody(body: Rec, mapVariables: VariablesMap): Rec {
  const next = Array.isArray(body.variables) ? { ...body, variables: mapVariables(body.variables) } : body
  const workflow = next.workflow
  if (!isRec(workflow) || !Array.isArray(workflow.nodes)) return next
  return { ...next, workflow: { ...workflow, nodes: mapLocalFunctionVariables(workflow.nodes, mapVariables) } }
}

/** Every Local Function body and edit-mode draft in the tree, its locals passed through `mapVariables`, at any depth. */
function mapLocalFunctionVariables<T>(nodes: readonly T[], mapVariables: VariablesMap): T[] {
  return nodes.map((node) => {
    const data = isRec(node) ? node.data : undefined
    if (!isRec(data) || (!isRec(data.localDefinition) && !isRec(data.draft))) return node
    const nextData: Rec = { ...data }
    if (isRec(data.localDefinition)) nextData.localDefinition = mapBody(data.localDefinition, mapVariables)
    if (isRec(data.draft)) nextData.draft = mapBody(data.draft, mapVariables)
    return { ...node, data: nextData }
  })
}

/** Nodes as a Test stores them: every Local Function's locals in the stored shape. */
export function storedLocalFunctionBodies<T>(nodes: readonly T[]): T[] {
  return mapLocalFunctionVariables(nodes, toStoredVariables)
}

/** Nodes as the canvas holds them: every Local Function's locals with an id and `isSecret`. */
export function canvasLocalFunctionBodies<T>(nodes: readonly T[], makeId: (name: string) => string = newVariableId): T[] {
  return mapLocalFunctionVariables(nodes, (variables) => canvasFunctionVariables(variables, makeId))
}

/** A Function body as the backend stores it, nested bodies included. */
export function storedFunctionBody<T extends object>(body: T): T {
  return mapBody(body as Rec, toStoredVariables) as T
}

/** A Function body as the canvas holds it, nested bodies included. */
export function canvasFunctionBody<T extends object>(body: T): T {
  return mapBody(body as Rec, toCanvasVariables) as T
}
