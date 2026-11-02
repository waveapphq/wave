/**
 * Loop Target Validation
 *
 * Validates that a Break/Continue node's target_loop parameter references
 * a valid enclosing loop node that is an upstream ancestor.
 *
 * REQ-3.5.1.2: Break current block execution
 * REQ-3.5.1.3: Continue to next iteration
 */

import { findEnclosingLoops } from './find-enclosing-loops'

/**
 * Result of validating a loop target reference.
 */
export interface LoopTargetValidationResult {
  valid: boolean
  error?: string
}

// Minimal node/edge interfaces matching workflow store shapes
interface WorkflowNode {
  id: string
  data: {
    label: string
    elementType?: string
    description?: string
  }
}

interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

/**
 * Validate that a break/continue node's target_loop references a valid
 * enclosing loop node.
 *
 * @param nodeId - The break/continue node ID
 * @param targetLoop - The target_loop value to validate
 * @param nodes - All workflow nodes
 * @param edges - All workflow edges
 * @returns Validation result with valid flag and optional error message
 */
export function validateLoopTarget(
  nodeId: string,
  targetLoop: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): LoopTargetValidationResult {
  if (!targetLoop) {
    return { valid: false, error: 'Target loop is required' }
  }

  const enclosingLoops = findEnclosingLoops(nodeId, nodes, edges)

  if (enclosingLoops.length === 0) {
    return { valid: false, error: 'Block is not inside any loop' }
  }

  const match = enclosingLoops.find((l) => l.nodeId === targetLoop)
  if (!match) {
    return { valid: false, error: 'Target is not an enclosing loop' }
  }

  return { valid: true }
}
