/**
 * focusCurrentBlock - navigate to a block's Function scope, then center on it.
 *
 * If the block lives in the current drill scope, it just centers (requestFocus).
 * If it lives in a different Function level, it drills into/out to that level
 * first, then centers - so Focus Current and Follow Changes reach the current
 * block across nesting. No selection/highlight change: pure navigation.
 */

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { indexNodeAncestors, type AncestorNode } from '@/features/functions/canvas/node-ancestors'

function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

export function focusCurrentBlock(nodeId: string): void {
  const store = useWorkflowStore.getState()
  const path = indexNodeAncestors(store.nodes as unknown as AncestorNode[]).get(nodeId)
  if (path === undefined) return
  const current = store.drillPath.map((entry) => entry.nodeId)
  const target = path.map((segment) => segment.nodeId)
  if (!samePath(current, target)) {
    store.popDrillTo(0)
    for (const segment of path) store.pushDrill(segment.nodeId)
  }
  store.requestFocus(nodeId)
}
