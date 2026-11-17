/**
 * changedMirrorNode - find the block that changed between two mirror snapshots.
 *
 * Walks the full nested node tree (Function bodies included) and returns the id
 * of the block that was added or whose position / label / config changed, at any
 * depth. Variable and metadata edits do not change any node signature, so they
 * return null (Follow Changes must not move for them). The first snapshot
 * (empty previous) returns null so the initial mirror load never yanks the view.
 *
 * mirrorChangeTarget - the Block a mirrored frame changed. A watched stream (a
 * frame with bounds) names its own target, and null means none; only a frame
 * without bounds, such as a person's, is diffed.
 */

interface DiffNode {
  id: string
  position: { x: number; y: number }
  data?: {
    label?: string
    config?: unknown
    localDefinition?: { workflow: { nodes: DiffNode[] } }
  }
  width?: number
  height?: number
}

function collectSignatures(nodes: readonly DiffNode[], out: Map<string, string>): void {
  for (const node of nodes) {
    out.set(
      node.id,
      JSON.stringify([node.position.x, node.position.y, node.data?.label, node.data?.config]),
    )
    const nested = node.data?.localDefinition?.workflow.nodes
    if (nested) collectSignatures(nested, out)
  }
}

export function changedMirrorNode(
  prev: readonly DiffNode[],
  next: readonly DiffNode[],
): string | null {
  if (prev.length === 0) return null
  const before = new Map<string, string>()
  collectSignatures(prev, before)
  const after = new Map<string, string>()
  collectSignatures(next, after)

  let changed: string | null = null
  for (const [id, signature] of after) {
    if (before.get(id) !== signature) changed = id
  }
  return changed
}

interface MirrorFrame {
  active_node_id?: string | null
  final_bounds?: unknown
}

export function mirrorChangeTarget(
  frame: MirrorFrame,
  prev: readonly DiffNode[],
  next: readonly DiffNode[],
): string | null {
  // A watched change moves every staying Block in its first step: the diff would ring one of them.
  if (frame.final_bounds) return frame.active_node_id ?? null
  return frame.active_node_id ?? changedMirrorNode(prev, next)
}
