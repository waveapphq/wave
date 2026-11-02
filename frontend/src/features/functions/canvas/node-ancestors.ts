/**
 * Index every node to its Function-ancestor chain (drill path) in one pass.
 *
 * Shared by the debug-drill sync (auto-navigate to the paused block) and Focus
 * Current / Follow Changes (navigate to a block at arbitrary depth).
 */

import { fetchSharedBody, sharedDraftBody, type SharedFunctionBody } from './shared-function-body'
import type { DrillSegment } from './use-drill-handler'

export interface AncestorNode {
  id: string
  data: {
    functionLifecycle?: 'local' | 'shared'
    localDefinition?: { workflow: { nodes: AncestorNode[] } }
  }
}

export function indexNodeAncestors(
  nodes: AncestorNode[],
  prefix: DrillSegment[] = [],
  out: Map<string, DrillSegment[]> = new Map(),
): Map<string, DrillSegment[]> {
  for (const node of nodes) {
    out.set(node.id, prefix)
    const def = node.data.localDefinition
    if (def) {
      indexNodeAncestors(
        def.workflow.nodes,
        [...prefix, { nodeId: node.id, shared: node.data.functionLifecycle === 'shared' }],
        out,
      )
    }
  }
  return out
}

interface Scope {
  nodes: AncestorNode[]
  path: DrillSegment[]
}

async function sharedBody(data: Record<string, unknown>): Promise<SharedFunctionBody | null> {
  const loaded = data.localDefinition as SharedFunctionBody | undefined
  const known = loaded ?? sharedDraftBody(data)
  if (known) return known
  const functionId = data.functionId as string | undefined
  return functionId ? fetchSharedBody(functionId, data.functionVersion as string | undefined) : null
}

async function openBody(node: AncestorNode, path: DrillSegment[]): Promise<Scope | null> {
  if (node.data.functionLifecycle === 'shared') {
    const body = await sharedBody(node.data as Record<string, unknown>)
    if (!body) return null
    return {
      nodes: body.workflow.nodes as unknown as AncestorNode[],
      path: [...path, { nodeId: node.id, shared: true, body }],
    }
  }
  const def = node.data.localDefinition
  return def ? { nodes: def.workflow.nodes, path: [...path, { nodeId: node.id, shared: false }] } : null
}

async function openLevel(level: Scope[], failures: unknown[]): Promise<Scope[]> {
  const opened = await Promise.allSettled(
    level.flatMap((scope) => scope.nodes.map((node) => openBody(node, scope.path))),
  )
  const next: Scope[] = []
  for (const result of opened) {
    if (result.status === 'rejected') failures.push(result.reason)
    else if (result.value) next.push(result.value)
  }
  return next
}

/**
 * Find a node's drill path level by level, opening Shared bodies that are not
 * loaded the way dig-in does. Resolves undefined when no body holds the node,
 * and rejects with the first body that failed to load when that hid it.
 */
export async function resolveNodeAncestors(
  nodes: AncestorNode[],
  nodeId: string,
): Promise<DrillSegment[] | undefined> {
  const failures: unknown[] = []
  let level: Scope[] = [{ nodes, path: [] }]
  while (level.length > 0) {
    const hit = level.find((scope) => scope.nodes.some((node) => node.id === nodeId))
    if (hit) return hit.path
    level = await openLevel(level, failures)
  }
  if (failures.length > 0) throw failures[0]
  return undefined
}
