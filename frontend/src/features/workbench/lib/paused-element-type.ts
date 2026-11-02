/**
 * Normalize the engine's raw ``elementType`` for the paused node so the
 * Paused Toolbar can disable Skip Block on diverging parents (if-else,
 * assert-split, switch). Mirrors the backend's normalization in
 * ``wavecore/api/services/workbench/signals.py:_normalize_element_type``
 * so the frontend predicate matches the backend's diverging-parent set
 * exactly: the engine exposes ``elementType="switch-case"`` for Switch
 * and ``elementType="assert"`` (with ``config.values.mode`` set) for
 * both assert variants; we collapse those to the canonical synonyms.
 */

interface PausedNodeLike {
  id: string
  data?: {
    elementType?: string
    config?: {
      values?: {
        mode?: string
      }
    }
  }
}

export function derivePausedElementType(
  pausedNodeId: string | null,
  nodes: ReadonlyArray<PausedNodeLike>,
): string | null {
  if (!pausedNodeId) return null
  const node = nodes.find((n) => n.id === pausedNodeId)
  if (!node) return null
  const raw = node.data?.elementType
  if (!raw) return null
  if (raw === 'switch-case') return 'switch'
  if (raw === 'assert') {
    const mode = node.data?.config?.values?.mode
    return mode === 'split' ? 'assert-split' : 'assert-single'
  }
  return raw
}
