/**
 * The contract of a Shared (library) Function instance - the inputs and outputs of the version
 * it pins - carried on the instance at any depth of the tree (REQ-3.1.2.4).
 */

import type { VersionDescriptor } from '@/features/functions/api/types'
import { writeNewChoiceInputs } from '@/features/workbench/lib/saved-block-fields'

interface ContractNode {
  id: string
  data: Record<string, unknown>
}

/** Each library Function's versions, by Function id then by version. */
export type VersionsByFunction = ReadonlyMap<string, ReadonlyMap<string, VersionDescriptor>>

export interface PinnedShared {
  functionId: string
  functionVersion: string
}

function pinnedShared(data: Record<string, unknown>): PinnedShared | null {
  if (data.functionLifecycle !== 'shared') return null
  const { functionId, functionVersion } = data
  if (typeof functionId !== 'string' || typeof functionVersion !== 'string') return null
  return { functionId, functionVersion }
}

function innerNodes<N extends ContractNode>(node: N): N[] | null {
  const body = node.data.localDefinition as { workflow?: { nodes?: N[] } } | undefined
  return Array.isArray(body?.workflow?.nodes) ? body.workflow.nodes : null
}

/** Every library Function a pinned Shared instance at any depth refers to, once each. */
export function sharedFunctionIds<N extends ContractNode>(nodes: readonly N[]): string[] {
  const ids = new Set<string>()
  const visit = (scope: readonly N[]): void => {
    for (const node of scope) {
      const pinned = pinnedShared(node.data)
      if (pinned) ids.add(pinned.functionId)
      const inner = innerNodes(node)
      if (inner) visit(inner)
    }
  }
  visit(nodes)
  return [...ids]
}

/**
 * Each pinned Shared instance at any depth that carries no contract yet - no inputs, no outputs
 * and no missing-version mark - once per library Function and version.
 */
export function unresolvedSharedPins<N extends ContractNode>(nodes: readonly N[]): PinnedShared[] {
  const pins = new Map<string, PinnedShared>()
  const visit = (scope: readonly N[]): void => {
    for (const node of scope) {
      const pinned = pinnedShared(node.data)
      const resolved =
        node.data.resolvedInputs !== undefined ||
        node.data.resolvedOutputs !== undefined ||
        node.data.missingVersion === true
      if (pinned && !resolved) pins.set(`${pinned.functionId}@${pinned.functionVersion}`, pinned)
      const inner = innerNodes(node)
      if (inner) visit(inner)
    }
  }
  visit(nodes)
  return [...pins.values()]
}

// One empty list, so a version with no inputs or no outputs stamps the same value every time.
const NO_PARAMETERS: never[] = []

/** The contract fields one Shared instance takes from the versions read, or null for none. */
function contractPatch(
  data: Record<string, unknown>,
  versions: VersionsByFunction,
): Record<string, unknown> | null {
  const pinned = pinnedShared(data)
  const versionMap = pinned ? versions.get(pinned.functionId) : undefined
  if (!pinned || !versionMap) return null
  const version = versionMap.get(pinned.functionVersion)
  // Pinned to a version the library no longer has: the alert says so.
  if (version === undefined) return data.missingVersion === true ? null : { missingVersion: true }
  const inputs = Array.isArray(version.inputs) ? version.inputs : NO_PARAMETERS
  const outputs = Array.isArray(version.outputs) ? version.outputs : NO_PARAMETERS
  if (inputs.length === 0 && outputs.length === 0) return null
  if (data.resolvedInputs === inputs && data.resolvedOutputs === outputs) return null
  const stamp = { resolvedInputs: inputs, resolvedOutputs: outputs }
  // A Block dropped or added by Quick Add starts each choice-list and true / false input on its default (REQ-3.1.2.10).
  const previous = Array.isArray(data.resolvedInputs) ? data.resolvedInputs : NO_PARAMETERS
  const written = writeNewChoiceInputs(data, previous, inputs)
  return written === data ? stamp : { ...stamp, config: written.config }
}

/**
 * Stamp every Shared instance at any depth with the contract of the version it pins, from the
 * versions read; returns `nodes` itself when nothing changed.
 */
export function stampSharedFunctionContracts<N extends ContractNode>(
  nodes: N[],
  versions: VersionsByFunction,
): N[] {
  let changed = false
  const next = nodes.map((node) => {
    let data = node.data
    const patch = contractPatch(data, versions)
    if (patch) data = { ...data, ...patch }
    const inner = innerNodes(node)
    const innerNext = inner ? stampSharedFunctionContracts(inner, versions) : inner
    if (innerNext !== inner) {
      const body = data.localDefinition as { workflow: Record<string, unknown> }
      data = {
        ...data,
        localDefinition: { ...body, workflow: { ...body.workflow, nodes: innerNext } },
      }
    }
    if (data === node.data) return node
    changed = true
    return { ...node, data }
  })
  return changed ? next : nodes
}
