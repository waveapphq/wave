/**
 * GhostEdge Component
 *
 * Rendered during drag proximity - dashed line from source output to drag position.
 * Extracted from canvas.tsx for modularity.
 */

import { useReactFlow, useInternalNode } from '@xyflow/react'

export function GhostEdge({ sourceNodeId, sourceHandleId, targetPos, testId = 'proximity-ghost-edge' }: Readonly<{ sourceNodeId: string; sourceHandleId?: string | null; targetPos: { x: number; y: number }; testId?: string }>) {
  const { flowToScreenPosition } = useReactFlow()
  const internalNode = useInternalNode(sourceNodeId)
  if (!internalNode) return null

  // Get exact source handle (egress) position from React Flow's internal handle bounds.
  // When sourceHandleId is provided (e.g. "pass" or "fail" for split-mode Assert),
  // find the matching handle instead of defaulting to the first one.
  const handles = internalNode.internals.handleBounds?.source
  /* v8 ignore next 3 - COV-BRANCH-136 */
  const handle = sourceHandleId
    ? handles?.find((h) => h.id === sourceHandleId) ?? handles?.[0]
    : handles?.[0]
  const nodePos = internalNode.internals.positionAbsolute
  let sourceFlowPos: { x: number; y: number }
  if (handle) {
    sourceFlowPos = {
      x: nodePos.x + handle.x + handle.width / 2,
      y: nodePos.y + handle.y + handle.height / 2,
    }
  } else {
    // Fallback if handle bounds not yet measured
    const w = internalNode.measured?.width ?? 120
    const h = internalNode.measured?.height ?? 50
    sourceFlowPos = { x: nodePos.x + w / 2, y: nodePos.y + h }
  }

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
    <svg data-testid={testId} className="pointer-events-none fixed inset-0 z-50 overflow-visible" style={{ width: '100vw', height: '100vh' }}>
      <path d={path} fill="none" stroke="#A1A1AA" strokeWidth={2} strokeDasharray="6 4" opacity={0.6} />
    </svg>
  )
}
