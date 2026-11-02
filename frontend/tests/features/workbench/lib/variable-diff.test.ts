/**
 * Unit tests for ``changedVariableNames``.
 *
 * The pure helper diffs two variable snapshots and returns the names present
 * in ``next`` whose value or expression changed, plus names newly added in
 * ``next``. Names removed in ``next`` are never reported (nothing to pulse).
 */

import { describe, it, expect } from 'vitest'
import { changedVariableNames } from '@/features/workbench/lib/variable-diff'

describe('changedVariableNames', () => {
  it('reports a variable whose value changed', () => {
    expect(
      changedVariableNames(
        [{ name: 'x', value: 1 }],
        [{ name: 'x', value: 2 }],
      ),
    ).toEqual(['x'])
  })

  it('reports a variable newly added in next', () => {
    expect(
      changedVariableNames(
        [{ name: 'x', value: 1 }],
        [
          { name: 'x', value: 1 },
          { name: 'y', value: 5 },
        ],
      ),
    ).toEqual(['y'])
  })

  it('does not report a variable removed in next', () => {
    expect(
      changedVariableNames(
        [
          { name: 'x', value: 1 },
          { name: 'y', value: 2 },
        ],
        [{ name: 'x', value: 1 }],
      ),
    ).toEqual([])
  })

  it('reports nothing when no value or expression changed', () => {
    expect(
      changedVariableNames(
        [
          { name: 'x', value: 1 },
          { name: 'y', value: 'hi' },
        ],
        [
          { name: 'x', value: 1 },
          { name: 'y', value: 'hi' },
        ],
      ),
    ).toEqual([])
  })

  it('reports a variable whose expression changed', () => {
    expect(
      changedVariableNames(
        [{ name: 'x', value: 0, expression: '1 + 1' }],
        [{ name: 'x', value: 0, expression: '2 + 2' }],
      ),
    ).toEqual(['x'])
  })

  it('reports every changed and added name in next order', () => {
    expect(
      changedVariableNames(
        [
          { name: 'a', value: 1 },
          { name: 'b', value: 2 },
          { name: 'c', value: 3 },
        ],
        [
          { name: 'a', value: 100 },
          { name: 'b', value: 2 },
          { name: 'c', value: 300 },
          { name: 'd', value: 4 },
        ],
      ),
    ).toEqual(['a', 'c', 'd'])
  })

  it('reports all next names when prev is empty', () => {
    expect(
      changedVariableNames(
        [],
        [
          { name: 'x', value: 1 },
          { name: 'y', value: 2 },
        ],
      ),
    ).toEqual(['x', 'y'])
  })

  it('reads a number and the digit text of that exact number as unchanged (REQ-3.1.3.14)', () => {
    expect(changedVariableNames([{ name: 'n', value: 5 }], [{ name: 'n', value: '5' }])).toEqual([])
  })

  it('reports a change one JS double cannot tell apart', () => {
    expect(
      changedVariableNames([{ name: 'n', value: 9007199254740992 }], [{ name: 'n', value: '9007199254740993' }]),
    ).toEqual(['n'])
  })
})
