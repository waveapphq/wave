/**
 * Which canvas blocks a test report lists, and which summary tile counts each.
 */

import type { ReportTimelineBlock } from '@/features/reports/api/types'

export type BlockTileKey = 'passed' | 'failed' | 'warning' | 'skipped' | 'stopped'

export type BlockTileCounts = Record<BlockTileKey, number>

/** A recorded outcome is listed as a row and counted by its tile; a status
 *  absent here is a block the run never reached. */
const OUTCOME_TILE: Record<string, BlockTileKey> = {
  passed: 'passed',
  failed: 'failed',
  warning: 'warning',
  skipped: 'skipped',
  stopped: 'stopped',
  // A block still running when the run ended is finalized as stopped.
  running: 'stopped',
}

/** True once the run recorded an outcome for the block. */
export function hasRecordedOutcome(block: ReportTimelineBlock): boolean {
  return block.status in OUTCOME_TILE
}

/** Listed blocks, renumbered contiguously over the rows actually shown. */
export function listedBlocks(blocks: readonly ReportTimelineBlock[]): ReportTimelineBlock[] {
  return blocks
    .filter(hasRecordedOutcome)
    .map((block, index) => ({ ...block, order: index + 1 }))
}

/** Each listed block counted by exactly one tile; never-reached blocks by none. */
export function countBlocksByTile(blocks: readonly ReportTimelineBlock[]): BlockTileCounts {
  const counts: BlockTileCounts = {
    passed: 0,
    failed: 0,
    warning: 0,
    skipped: 0,
    stopped: 0,
  }
  for (const block of blocks) {
    const tile = OUTCOME_TILE[block.status]
    if (tile) counts[tile] += 1
  }
  return counts
}
