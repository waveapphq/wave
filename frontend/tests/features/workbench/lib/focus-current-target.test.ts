/**
 * Unit tests for ``resolveFocusTarget``.
 *
 * The run-controls Focus Current button centers on the paused block, else the
 * running block, else nothing (button no-op). It never targets a selection or a
 * mirror block - watching uses Follow Changes, not this button.
 */

import { describe, it, expect } from 'vitest'
import { resolveFocusTarget } from '@/features/workbench/lib/focus-target'

describe('resolveFocusTarget', () => {
  it('returns the paused node first', () => {
    expect(
      resolveFocusTarget({ pausedNodeId: 'p1', currentBlock: { blockId: 'r1' } }),
    ).toBe('p1')
  })

  it('falls to the running block when nothing is paused', () => {
    expect(
      resolveFocusTarget({ pausedNodeId: null, currentBlock: { blockId: 'r1' } }),
    ).toBe('r1')
  })

  it('returns null when nothing is paused or running (button no-op)', () => {
    expect(
      resolveFocusTarget({ pausedNodeId: null, currentBlock: null }),
    ).toBeNull()
  })
})
