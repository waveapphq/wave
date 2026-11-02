/**
 * Shared node construction + egress wiring for palette drop and quick-add,
 * promoted out of `use-canvas-drop.ts` so both surfaces build identical nodes.
 */

import { getControlVersions } from '@/features/workbench/docs/_loader'
import type { FunctionInput } from '@/features/functions/api/types'
import {
  getNextFunctionInstanceName,
  getNextSequencedName,
} from '@/features/functions/lib/naming'
import { getInputParams } from '@/features/workbench/lib/node-parameters'
import { choiceDefaults } from '@/features/workbench/lib/saved-block-fields'
import { useSshHostPolicyStore } from '@/stores/ssh-host-policy-store'
import type { WaveBlockData } from './canvas-constants'

export type DropPayload =
  | (WaveBlockData & { type: 'plugin' | 'control' })
  | { type: 'function-new-local' }
  | {
      type: 'function-published'
      functionId: string
      name: string
      /** Library entry's current version; stamped onto the new node's `data.functionVersion`. */
      version?: string
      source?: string
    }

export interface NewNodeData {
  label: string
  elementType: string
  nodeType: 'control' | 'plugin' | 'function'
  version?: string
  config?: Record<string, unknown>
  functionLifecycle?: 'local' | 'shared'
  // The local function definition's nested workflow holds the same node /
  // edge shapes as the parent. `Record<string, never>[]` would be wrong; we
  // intentionally keep the inner arrays unknown[] at construction time and
  // let the store widen them on insert.
  localDefinition?: {
    name?: string
    workflow: { nodes: never[]; edges: never[] }
    inputs: unknown[]
    outputs: unknown[]
  }
  functionId?: string
  /** Shared-lifecycle only: per-instance version pin. */
  functionVersion?: string
  /** Shared-lifecycle only: library entry's name at drop time. */
  originalLibraryName?: string
}

export interface NewNode {
  id: string
  type: 'workflowNode' | 'noteNode'
  position: { x: number; y: number }
  data: NewNodeData
}

export function buildLocalFunctionNode(
  newNodeId: string,
  position: { x: number; y: number },
  existingNodes: ReadonlyArray<{ data: { label: string; nodeType?: string } }>,
): NewNode {
  // The canvas label IS the user-facing Function name for a Local instance.
  // The save-time validator reads ``localDefinition.name`` for the
  // structural name check, so the two must stay in sync from creation.
  const name: string = getNextFunctionInstanceName(existingNodes)
  return {
    id: newNodeId,
    type: 'workflowNode',
    position,
    data: {
      label: name,
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        name,
        workflow: { nodes: [], edges: [] },
        inputs: [],
        outputs: [],
      },
    },
  }
}

/** The values a new Block holds from creation: a choice list or true / false never starts not set (REQ-3.1.1.5). */
function creationConfig(values: Record<string, unknown>): { config: Record<string, unknown> } | undefined {
  return Object.keys(values).length === 0 ? undefined : { config: { values } }
}

export function buildPublishedFunctionNode(
  newNodeId: string,
  position: { x: number; y: number },
  payload: { functionId: string; name: string; version?: string; inputs?: readonly FunctionInput[] },
  existingNodes: ReadonlyArray<{ data: { label: string; nodeType?: string } }>,
): NewNode {
  // Shared instances auto-name from the LIBRARY entry's name (e.g.
  // "fetch_user", "fetch_user_1", ...) so the canvas label is immediately
  // meaningful. The library entry's name is also stored verbatim in
  // `originalLibraryName` so the modal can surface a "From library:
  // <name>" inline link that survives later user renames of the label.
  const name: string = getNextSequencedName(existingNodes, payload.name)
  return {
    id: newNodeId,
    type: 'workflowNode',
    position,
    data: {
      label: name,
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: payload.functionId,
      functionVersion: payload.version,
      originalLibraryName: payload.name,
      // The pinned version's choice-list and true / false inputs start on their default, Required included.
      ...creationConfig(choiceDefaults(payload.inputs ?? [])),
    },
  }
}

// Branches are structure, not field values: they seed every new Block of the kind.
const STRUCTURAL_SEEDS: Record<string, () => Record<string, unknown>> = {
  'if-else': () => ({
    branches: [
      { id: 'branch_0', type: 'if', label: '', conditions: [] },
      { id: 'branch_1', type: 'else', label: '' },
    ],
  }),
  'switch-case': () => ({
    branches: [{ id: 'branch_0', type: 'case', label: '', conditions: [], break: true }],
  }),
  parallel: () => ({
    branches: [
      { id: 'branch_1', name: '' },
      { id: 'branch_2', name: '' },
    ],
    join: 'all',
  }),
}

/** Every declared choice-list and true / false default of a Block, shown or hidden (REQ-3.1.1.5). */
function paletteChoiceValues(id: string): Record<string, unknown> {
  const fields = (getInputParams(id) ?? []).map((param) => ({
    name: param.name,
    type: param.type,
    enumValues: param.enumValues,
    default: param.defaultValue,
  }))
  return choiceDefaults(fields)
}

export function buildDefaultConfigForPalette(id: string): Record<string, unknown> | undefined {
  if (id === 'note') return { text: '', color: 'slate' }
  const values = { ...paletteChoiceValues(id), ...STRUCTURAL_SEEDS[id]?.() }
  // REQ-4.5.14: the Settings default is stamped at placement, never looked up at run time.
  if (id === 'ssh-session-open') values.host_key_verification = useSshHostPolicyStore.getState().defaultBlockAction
  return creationConfig(values)?.config
}

export function buildPaletteNode(
  newNodeId: string,
  position: { x: number; y: number },
  paletteData: WaveBlockData,
  existingNodes: ReadonlyArray<{ data: { label: string; nodeType?: string } }>,
): NewNode {
  const controlVersions = getControlVersions(paletteData.id)
  const initialVersion = controlVersions[0]?.version || '1.0.0'
  const nodeType = paletteData.id === 'note' ? 'noteNode' : 'workflowNode'
  const defaultConfig = buildDefaultConfigForPalette(paletteData.id)
  // Auto-name with the universal "base first, _N afterwards" rule:
  // the FIRST drop of "Log" is just "Log", the second is "Log_1", and
  // so on. Collision check is canvas-wide (no type predicate) so a
  // plugin "Log" and a Function "Log" don't both exist with the same
  // label - that would confuse variable references and the user's
  // mental model. Notes are inline labels and keep the palette's raw
  // name as their initial content.
  const label =
    paletteData.id === 'note'
      ? paletteData.name
      : getNextSequencedName(existingNodes, paletteData.name)
  return {
    id: newNodeId,
    type: nodeType,
    position,
    data: {
      label,
      elementType: paletteData.id,
      nodeType: paletteData.type,
      version: initialVersion,
      ...(defaultConfig && { config: defaultConfig }),
    },
  }
}

interface EgressNode {
  id: string
  data?: {
    elementType?: string
    config?: Record<string, unknown>
  }
}

interface EgressEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

type EgressValues = Record<string, unknown>

type OutputHandlesOf = (config: EgressValues) => string[] | null

function valuesOf(config: EgressValues): EgressValues {
  return (config.values as EgressValues) ?? {}
}

function branchIds(values: EgressValues): string[] {
  const branches = values.branches
  return Array.isArray(branches) ? (branches as Array<{ id?: string }>).map((b) => String(b.id)) : []
}

function bodyThenHandles(): string[] {
  return ['body', 'then']
}

function tryCatchHandles(config: EgressValues): string[] {
  const vals = (config.values as EgressValues) ?? config
  const h = ['try']
  if (vals.enable_catch !== false) h.push('catch')
  if (vals.enable_finally) h.push('finally')
  h.push('then')
  return h
}

function branchesThenHandles(config: EgressValues): string[] {
  return [...branchIds(valuesOf(config)), 'then']
}

function assertHandles(config: EgressValues): string[] | null {
  const mode = (valuesOf(config).mode as string | undefined) ?? 'split'
  return mode === 'split' ? ['pass', 'fail'] : null
}

function waitUntilHandles(config: EgressValues): string[] | null {
  const mode = (valuesOf(config).mode as string | undefined) ?? 'retry'
  return mode === 'retry' ? ['retry', 'then'] : null
}

function ifElseHandles(config: EgressValues): string[] | null {
  const ids = branchIds(valuesOf(config))
  return ids.length > 0 ? ids : null
}

function noHandles(): string[] {
  return []
}

// Loops and Remote Execution share body + then; must match the canvas renderer's lanes
const OUTPUT_HANDLES = new Map<string, OutputHandlesOf>([
  ['for', bodyThenHandles],
  ['for-each', bodyThenHandles],
  ['while', bodyThenHandles],
  ['remote-execution', bodyThenHandles],
  ['try-catch-finally', tryCatchHandles],
  ['switch-case', branchesThenHandles],
  ['parallel', branchesThenHandles],
  ['assert', assertHandles],
  ['wait-until', waitUntilHandles],
  ['if-else', ifElseHandles],
  ['halt', noHandles],
])

/** Named output handles for a multi-handle node, [] for no-egress nodes,
 *  or null for single-default-handle nodes. */
export function getNodeOutputHandles(node: EgressNode): string[] | null {
  const handlesOf = OUTPUT_HANDLES.get(node.data?.elementType ?? '')
  if (handlesOf === undefined) return null
  return handlesOf((node.data?.config as EgressValues) ?? {})
}

/** First free sourceHandle of a node, or a "none free" marker. */
function findFirstFreeEgress(
  node: EgressNode,
  edges: ReadonlyArray<EgressEdge>,
): { free: boolean; sourceHandle?: string } {
  const handles = getNodeOutputHandles(node)
  if (!handles) {
    const hasOutgoing = edges.some((e) => e.source === node.id)
    return { free: !hasOutgoing }
  }
  const usedHandles = new Set(
    edges.filter((e) => e.source === node.id).map((e) => e.sourceHandle),
  )
  const sourceHandle = handles.find((h) => !usedHandles.has(h))
  return sourceHandle === undefined ? { free: false } : { free: true, sourceHandle }
}

export interface ConnectFromFirstFreeEgressParams {
  anchorId: string
  newNodeId: string
  nodes: ReadonlyArray<EgressNode>
  edges: ReadonlyArray<EgressEdge>
  validate: (params: {
    source: string
    target: string
    sourceHandle?: string
  }) => { valid: boolean }
  addEdge: (edge: EgressEdge) => void
}

/** Link `newNodeId` from the anchor's first free egress handle; returns
 *  whether an edge was added (false on no anchor, no free handle, or
 *  validator rejection). */
export function connectFromFirstFreeEgress({
  anchorId,
  newNodeId,
  nodes,
  edges,
  validate,
  addEdge,
}: ConnectFromFirstFreeEgressParams): boolean {
  const anchor = nodes.find((n) => n.id === anchorId)
  if (!anchor) return false
  const { free, sourceHandle } = findFirstFreeEgress(anchor, edges)
  if (!free) return false
  const result = validate({ source: anchorId, target: newNodeId, sourceHandle })
  if (!result.valid) return false
  const newEdge: EgressEdge = {
    id: `edge-${anchorId}-${newNodeId}`,
    source: anchorId,
    target: newNodeId,
  }
  if (sourceHandle) newEdge.sourceHandle = sourceHandle
  addEdge(newEdge)
  return true
}
