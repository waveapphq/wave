/** GhostEdge: the dashed line from a source output to the drag position. */

import { useReactFlow, useInternalNode } from '@xyflow/react'
import { getSourceHandleCenter } from './canvas-constants'

export function GhostEdge({ sourceNodeId, sourceHandleId, targetPos, testId = 'proximity-ghost-edge' }: Readonly<{ sourceNodeId: string; sourceHandleId?: string | null; targetPos: { x: number; y: number }; testId?: string }>) {
  const { flowToScreenPosition } = useReactFlow()
  const internalNode = useInternalNode(sourceNodeId)
  if (!internalNode) return null

  const sourceFlowPos = getSourceHandleCenter(internalNode, sourceHandleId)

  const sourceScreen = flowToScreenPosition(sourceFlowPos)
  const targetScreen = flowToScreenPosition(targetPos)

  const sx = sourceScreen.x
  const sy = sourceScreen.y
  const tx = targetScreen.x
  const ty = targetScreen.y

  // Smoothstep-like bezier
  const midY = (sy + ty) / 2
  const path = `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`

  return (
    <svg data-testid={testId} aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-visible" style={{ width: '100vw', height: '100vh' }}>
      <path d={path} fill="none" stroke="#A1A1AA" strokeWidth={2} strokeDasharray="6 4" opacity={0.6} />
    </svg>
  )
}
