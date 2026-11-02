/**
 * Pure Focus Current target resolution.
 *
 * Resolves which node the run-controls Focus Current button centers on: the
 * paused block, else the running block. Null means no current block (no-op).
 */

export interface FocusTargetInput {
  pausedNodeId: string | null
  currentBlock: { blockId: string } | null
}

export function resolveFocusTarget(input: FocusTargetInput): string | null {
  return input.pausedNodeId ?? input.currentBlock?.blockId ?? null
}
