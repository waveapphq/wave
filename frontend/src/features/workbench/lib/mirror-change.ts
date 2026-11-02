/**
 * changedMirrorNode - find the block that changed between two mirror snapshots.
 *
 * Walks the full nested node tree (Function bodies included) and returns the id
 * of the block that was added or whose position / label / config changed, at any
 * depth. Variable and metadata edits do not change any node signature, so they
 * return null (Follow Changes must not move for them). The first snapshot
 * (empty previous) returns null so the initial mirror load never yanks the view.
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
