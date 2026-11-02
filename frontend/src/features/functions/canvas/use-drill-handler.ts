/**
 * Centralized drill action surface used by:
 *   - the dig-in glyph in the node status bar
 *   - the kebab "Open" item
 *   - Cmd/Ctrl+Enter when a single Function node is selected
 *   - the breadcrumb-segment click path
 *
 * All four callers go through this hook so push/pop semantics, gating, and
 * label resolution live in one place. The hook is intentionally thin - it
 * wraps the workflow store's drill actions, which already implement the
 * push/pop logic and the local-Function guards.
 */

import { useCallback } from 'react'

import type { SharedFunctionBody } from '@/features/functions/canvas/shared-function-body'
import { useWorkflowStore, type NodeType } from '@/features/workbench/stores/workflow-store'

export interface DrillHandler {
  pushDrill: (nodeId: string) => void
  popOne: () => void
  popDrillTo: (depth: number) => void
  clearDrill: () => void
}

/** One ancestor in a drill chain; `shared` marks a published Function ancestor, opened on `body` when given. */
export interface DrillSegment {
  nodeId: string
  shared?: boolean
  body?: SharedFunctionBody
}

/** The body already loaded on each segment's node, read before the drill is reset. */
function loadedBodies(nodes: NodeType[], segments: DrillSegment[]): (SharedFunctionBody | undefined)[] {
  let cursor = nodes
  return segments.map((segment) => {
    const body = cursor.find((node) => node.id === segment.nodeId)?.data.localDefinition
    cursor = body?.workflow.nodes ?? []
    return body
  })
}

/**
 * Drill the canvas to a node at arbitrary depth: reset to root, push each
 * ancestor Function in order (a Shared one on its body), select the leaf, and
 * fit the view. Shared by validation-navigation and the debug-drill sync so the
 * operation has one home.
 */
export function drillToPath(segments: DrillSegment[], leafNodeId?: string): void {
  const store = useWorkflowStore.getState()
  const needsLoaded = segments.some((segment) => segment.shared && !segment.body)
  const bodies = needsLoaded ? loadedBodies(store.nodes, segments) : []
  store.popDrillTo(0)
  segments.forEach((segment, depth) => {
    const body = segment.body ?? bodies[depth]
    if (segment.shared && body) {
      store.pushSharedDrill(segment.nodeId, body)
    } else {
      store.pushDrill(segment.nodeId)
    }
  })
  if (leafNodeId) {
    store.setSelectedNodes([leafNodeId])
  }
  store.requestFitView({ duration: 0 })
}

export function useDrillHandler(): DrillHandler {
  const storePushDrill = useWorkflowStore((state) => state.pushDrill)
  const storePopOne = useWorkflowStore((state) => state.popDrillOne)
  const storePopDrillTo = useWorkflowStore((state) => state.popDrillTo)
  const storeClearDrill = useWorkflowStore((state) => state.clearDrill)
  // Scope changes reset sheet form state, so every
  // user-initiated drill routes through the dirty-sheet confirmation guard.
  const requestDrill = useWorkflowStore((state) => state.requestDrill)

  const pushDrill = useCallback(
    (nodeId: string) => {
      requestDrill(() => storePushDrill(nodeId))
    },
    [requestDrill, storePushDrill],
  )

  const popOne = useCallback(() => {
    requestDrill(() => storePopOne())
  }, [requestDrill, storePopOne])

  const popDrillTo = useCallback(
    (depth: number) => {
      requestDrill(() => storePopDrillTo(depth))
    },
    [requestDrill, storePopDrillTo],
  )

  const clearDrill = useCallback(() => {
    requestDrill(() => storeClearDrill())
  }, [requestDrill, storeClearDrill])

  return { pushDrill, popOne, popDrillTo, clearDrill }
}
