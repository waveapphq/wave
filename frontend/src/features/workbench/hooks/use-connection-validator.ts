/**
 * useConnectionValidator Hook - REQ-3.1.1.2 Sequential flow connections between blocks
 *
 * Validates edge connections for self-loop, duplicate, cycle, and scope isolation.
 * Designed for use with React Flow's onConnect callback.
 *
 * Validation Rules:
 * - No self-connections (source === target)
 * - No duplicate connections (same source-target pair)
 * - No cycles (target must not be able to reach source via existing edges)
 * - No cross-scope connections (try-catch path isolation)
 */

import { useMemo } from 'react'

interface Edge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

interface NodeData {
  id: string
  data?: Record<string, unknown>
}

interface ConnectionParams {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

interface ValidationResult {
  valid: boolean
  reason?: 'self-loop' | 'duplicate' | 'has-ingress' | 'has-egress' | 'cycle' | 'cross-scope'
}

interface UseConnectionValidatorProps {
  edges: Edge[]
  nodes?: NodeData[]
}

interface UseConnectionValidatorReturn {
  validate: (params: ConnectionParams) => ValidationResult
}

/** Path handle names that define scoped dead-end chains */
const SCOPED_PATH_HANDLES = new Set(['try', 'catch', 'finally', 'body'])

/** Element types that create scoped paths */
const SCOPED_ELEMENT_TYPES = new Set([
  'try-catch-finally',
  'for',
  'for-each',
  'while',
  'remote-execution',
])

/** Build reverse adjacency map: target -> [{source, handle}] */
function buildReverseAdjacency(
  edges: Edge[],
): Map<string, Array<{ source: string; handle: string | null }>> {
  const reverseAdj = new Map<string, Array<{ source: string; handle: string | null }>>()
  for (const edge of edges) {
    const list = reverseAdj.get(edge.target)
    if (list) {
      list.push({ source: edge.source, handle: edge.sourceHandle ?? null })
    } else {
      reverseAdj.set(edge.target, [{ source: edge.source, handle: edge.sourceHandle ?? null }])
    }
  }
  return reverseAdj
}

/** Build a map from node ID to element type */
function buildNodeTypeMap(nodes: NodeData[]): Map<string, string> {
  const nodeTypes = new Map<string, string>()
  for (const node of nodes) {
    const et = node.data?.elementType
    if (typeof et === 'string') nodeTypes.set(node.id, et)
  }
  return nodeTypes
}

/**
 * Find which try-catch scope a node belongs to (if any).
 * Returns "{tryCatchNodeId}:{handleName}" or null for outer flow.
 *
 * Traces backwards through incoming edges to find if the node
 * is reachable from a try-catch node's path handle.
 */
function findNodeScope(
  nodeId: string,
  edges: Edge[],
  nodes: NodeData[],
): string | null {
  const reverseAdj = buildReverseAdjacency(edges)
  const nodeTypes = buildNodeTypeMap(nodes)

  // BFS backwards from nodeId
  const visited = new Set<string>()
  const queue = [nodeId]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)

    const parents = reverseAdj.get(current)
    if (!parents) continue

    for (const { source, handle } of parents) {
      // Check if parent is a scoped element type AND the edge uses a scoped path handle
      if (SCOPED_ELEMENT_TYPES.has(nodeTypes.get(source) ?? '') && handle && SCOPED_PATH_HANDLES.has(handle)) {
        return `${source}:${handle}`
      }
      // Continue tracing backwards
      if (!visited.has(source)) {
        queue.push(source)
      }
    }
  }

  return null // Outer flow
}

/** Check if a cycle would be created by connecting source -> target */
function detectCycle(source: string, target: string, edges: Edge[]): boolean {
  const visited = new Set<string>()
  const queue = [target]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === source) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const edge of edges) {
      if (edge.source === current) queue.push(edge.target)
    }
  }
  return false
}

/** Check if a source handle already has an outgoing edge */
function hasExistingEgress(source: string, sourceHandle: string | null | undefined, edges: Edge[]): boolean {
  if (sourceHandle) {
    return edges.some((edge) => edge.source === source && edge.sourceHandle === sourceHandle)
  }
  return edges.some((edge) => edge.source === source)
}

/** Validate try-catch scope isolation between source and target */
function validateScopeIsolation(
  source: string,
  target: string,
  edges: Edge[],
  nodes: NodeData[],
): ValidationResult | null {
  if (!nodes || nodes.length === 0) return null

  const sourceScope = findNodeScope(source, edges, nodes)
  const targetScope = findNodeScope(target, edges, nodes)

  if (sourceScope !== null && targetScope !== null && sourceScope !== targetScope) {
    return { valid: false, reason: 'cross-scope' }
  }
  if (sourceScope === null && targetScope !== null) {
    return { valid: false, reason: 'cross-scope' }
  }
  if (sourceScope !== null && targetScope === null) {
    const targetHasIncoming = edges.some((e) => e.target === target)
    if (targetHasIncoming) return { valid: false, reason: 'cross-scope' }
  }

  return null
}

/**
 * Hook for validating edge connections
 *
 * @param props.edges - Array of existing edges
 * @param props.nodes - Array of workflow nodes (for scope detection)
 * @returns Object with validate function
 */
export function useConnectionValidator({
  edges,
  nodes,
}: UseConnectionValidatorProps): UseConnectionValidatorReturn {
  const validate = useMemo(() => {
    return (params: ConnectionParams): ValidationResult => {
      const { source, target, sourceHandle } = params

      if (source === target) return { valid: false, reason: 'self-loop' }

      const isDuplicate = edges.some((edge) => edge.source === source && edge.target === target)
      if (isDuplicate) return { valid: false, reason: 'duplicate' }

      if (detectCycle(source, target, edges)) return { valid: false, reason: 'cycle' }

      // Scope isolation must run BEFORE the has-egress check. The proximity
      // tracker calls validate WITHOUT ``sourceHandle`` (it doesn't know
      // which egress the user is dragging from), and ``hasExistingEgress``
      // then returns true for ANY source that already has an outgoing edge -
      // hiding cross-scope violations on multi-egress nodes (Try/Catch,
      // If/Else, split Assert). Surfacing cross-scope first lets the
      // proximity UI render the red "cycle/cross-scope" indicator instead
      // of a misleading green "+ slot" feedback.
      const scopeViolation = validateScopeIsolation(source, target, edges, nodes ?? [])
      if (scopeViolation) return scopeViolation

      if (hasExistingEgress(source, sourceHandle, edges)) return { valid: false, reason: 'has-egress' }

      return { valid: true }
    }
  }, [edges, nodes])

  return { validate }
}
