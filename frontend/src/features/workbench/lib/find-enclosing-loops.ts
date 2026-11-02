/**
 * Find Enclosing Loops - Graph Traversal Utility
 *
 * Walks backward through the workflow graph from a given node to find
 * all enclosing loop nodes reachable via body-handle edges. Used to
 * populate the target_loop dropdown for Break and Continue controls.
 *
 * REQ-3.5.1.2: Break current block execution
 * REQ-3.5.1.3: Continue to next iteration
 */

/**
 * Represents a loop option for the target_loop dropdown.
 */
export interface LoopOption {
  /** Node ID of the loop */
  nodeId: string
  /** Display label: "[Type]: [Name]" or "[Type]: No Title" */
  label: string
  /** The loop's element type (for, for-each, while) */
  loopType: string
}

// Minimal node/edge interfaces matching workflow store shapes
interface WorkflowNode {
  id: string
  data: {
    label: string
    elementType?: string
  }
}

interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

const LOOP_TYPES = new Set(['for', 'for-each', 'while'])

const LOOP_TYPE_LABELS: Record<string, string> = {
  'for': 'For Loop',
  'for-each': 'For Each',
  'while': 'While Loop',
}

function formatLoopLabel(elementType: string, name: string): string {
  const prefix = LOOP_TYPE_LABELS[elementType]
  return `${prefix}: ${name || 'No Title'}`
}

/**
 * Find all enclosing loop nodes for a given node by walking backward
 * through the workflow graph via body-handle edges.
 *
 * @param nodeId - The node to find enclosing loops for
 * @param nodes - All nodes in the workflow
 * @param edges - All edges in the workflow
 * @returns Ordered list of enclosing loops, outermost first (current loop last)
 */
function buildIncomingMap(edges: WorkflowEdge[]) {
  const map = new Map<string, { source: string; sourceHandle?: string }[]>()
  for (const e of edges) {
    let list = map.get(e.target)
    if (!list) {
      list = []
      map.set(e.target, list)
    }
    list.push({ source: e.source, sourceHandle: e.sourceHandle })
  }
  return map
}

function isEnclosingLoop(elementType: string | undefined, sourceHandle: string | undefined): boolean {
  return !!elementType && LOOP_TYPES.has(elementType) && sourceHandle === 'body'
}

export function findEnclosingLoops(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): LoopOption[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const incomingByTarget = buildIncomingMap(edges)

  const result: LoopOption[] = []
  const visited = new Set<string>([nodeId])
  const queue: string[] = [nodeId]

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const { source, sourceHandle } of incomingByTarget.get(current) ?? []) {
      const sourceNode = nodeMap.get(source)
      if (!sourceNode) continue

      if (isEnclosingLoop(sourceNode.data.elementType, sourceHandle)) {
        result.push({
          nodeId: source,
          label: formatLoopLabel(sourceNode.data.elementType!, sourceNode.data.label),
          loopType: sourceNode.data.elementType!,
        })
      }

      if (!visited.has(source)) {
        visited.add(source)
        queue.push(source)
      }
    }
  }

  return result.reverse()
}
