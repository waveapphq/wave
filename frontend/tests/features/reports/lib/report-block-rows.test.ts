/**
 * Report block row selection tests.
 *
 * A test report lists a step only once the run recorded an outcome for it.
 * Steps the run never reached are neither listed nor counted by a tile; the
 * outcome tiles account for exactly the steps that ran, once each.
 *
 * Module: frontend/src/features/reports/lib/report-block-rows.ts
 */

import { describe, it, expect } from 'vitest'
import type { ReportTimelineBlock } from '@/features/reports/api/types'
import {
  countBlocksByTile,
  hasRecordedOutcome,
  listedBlocks,
  type BlockTileCounts,
} from '@/features/reports/lib/report-block-rows'

const RECORDED_STATUSES = ['passed', 'failed', 'warning', 'skipped', 'stopped', 'running']

function block(overrides: Partial<ReportTimelineBlock> = {}): ReportTimelineBlock {
  return {
    order: 1,
    block_id: 'b1',
    block_path: 'Init_Session',
    status: 'passed',
    started_at: '2026-06-10T11:00:00+00:00',
    ended_at: '2026-06-10T11:00:05+00:00',
    duration: 5,
    ...overrides,
  }
}

/** A step the run never reached: nothing was recorded for it. */
function neverReached(overrides: Partial<ReportTimelineBlock> = {}): ReportTimelineBlock {
  return block({
    status: 'pending',
    started_at: null,
    ended_at: null,
    duration: null,
    ...overrides,
  })
}

function tileTotal(counts: BlockTileCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0)
}

const ONE_OF_EACH: ReportTimelineBlock[] = [
  block({ block_id: 'b1', status: 'passed' }),
  block({ block_id: 'b2', status: 'failed' }),
  block({ block_id: 'b3', status: 'warning' }),
  block({ block_id: 'b4', status: 'skipped' }),
  block({ block_id: 'b5', status: 'stopped' }),
  block({ block_id: 'b6', status: 'running' }),
  neverReached({ block_id: 'b7' }),
  neverReached({ block_id: 'b8', status: '' }),
]

describe('hasRecordedOutcome', () => {
  it.each(RECORDED_STATUSES)('is true for a step that ended up %s', (status) => {
    expect(hasRecordedOutcome(block({ status }))).toBe(true)
  })

  it('is false for a step the run never reached', () => {
    expect(hasRecordedOutcome(neverReached())).toBe(false)
  })

  it('is false for a step carrying no outcome the report recognizes', () => {
    expect(hasRecordedOutcome(neverReached({ status: '' }))).toBe(false)
  })
})

describe('listedBlocks', () => {
  const BLOCKS: ReportTimelineBlock[] = [
    block({ order: 1, block_id: 'b1', block_path: 'Init_Session', status: 'passed' }),
    neverReached({ order: 2, block_id: 'b2', block_path: 'Fetch_Status' }),
    block({ order: 3, block_id: 'b3', block_path: 'Cleanup_Tmp', status: 'skipped' }),
    neverReached({ order: 4, block_id: 'b4', block_path: 'Notify' }),
    block({ order: 5, block_id: 'b5', block_path: 'Validate', status: 'failed' }),
  ]

  it('drops the steps the run never reached', () => {
    expect(listedBlocks(BLOCKS).map((row) => row.block_path)).toEqual([
      'Init_Session',
      'Cleanup_Tmp',
      'Validate',
    ])
  })

  it('keeps a deliberately skipped step', () => {
    expect(listedBlocks(BLOCKS).map((row) => row.status)).toContain('skipped')
  })

  it('numbers the listed steps contiguously from one', () => {
    expect(listedBlocks(BLOCKS).map((row) => row.order)).toEqual([1, 2, 3])
  })

  it('leaves the source rows untouched', () => {
    listedBlocks(BLOCKS)

    expect(BLOCKS.map((row) => row.order)).toEqual([1, 2, 3, 4, 5])
  })

  it('lists nothing when the run reached nothing', () => {
    expect(listedBlocks([neverReached(), neverReached({ block_id: 'b2' })])).toEqual([])
  })

  it('lists nothing for an empty report', () => {
    expect(listedBlocks([])).toEqual([])
  })
})

describe('countBlocksByTile', () => {
  it.each(RECORDED_STATUSES)('counts a %s step in exactly one tile', (status) => {
    expect(tileTotal(countBlocksByTile([block({ status })]))).toBe(1)
  })

  it('buckets each recorded outcome into its own tile', () => {
    expect(countBlocksByTile(ONE_OF_EACH)).toEqual({
      passed: 1,
      failed: 1,
      warning: 1,
      skipped: 1,
      stopped: 2,
    })
  })

  it('counts a step left running when the run ended as stopped', () => {
    expect(countBlocksByTile([block({ status: 'running' })])).toMatchObject({ stopped: 1 })
  })

  it('leaves the steps the run never reached out of the tiles', () => {
    const counts = countBlocksByTile([neverReached(), neverReached({ block_id: 'b2', status: '' })])

    expect(tileTotal(counts)).toBe(0)
  })

  it('accounts for exactly the steps that ran, once each', () => {
    expect(tileTotal(countBlocksByTile(ONE_OF_EACH))).toBe(listedBlocks(ONE_OF_EACH).length)
  })

  it('gives every listed step a tile, so no listed step goes uncounted', () => {
    const listed = listedBlocks(ONE_OF_EACH)

    expect(tileTotal(countBlocksByTile(listed))).toBe(listed.length)
  })

  it('counts nothing for an empty report', () => {
    expect(tileTotal(countBlocksByTile([]))).toBe(0)
  })
})
