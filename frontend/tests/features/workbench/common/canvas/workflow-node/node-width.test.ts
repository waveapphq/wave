/** Block width rule tests (REQ-4.2.5, CANVAS-249). */

import { describe, it, expect } from 'vitest'

import {
  computeFreshNodeWidth,
  computeNodeMinWidth,
  computeOutputWidth,
  detectNodeModes,
  NOTE_MIN_WIDTH,
} from '@/features/workbench/common/canvas/workflow-node/node-width'

const PLAIN_MODES = {
  isTryCatch: false,
  tryCatchEnableCatch: false,
  tryCatchEnableFinally: false,
  isIfElseMode: false,
  ifElseBranchCount: 0,
  switchBranchCount: 0,
  parallelBranchCount: 0,
  isSplitMode: false,
  isForLoop: false,
  isRemoteExecution: false,
  isWaitRetry: false,
}

function parallelBranches(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `branch_${index + 1}`, name: '' }))
}

describe('NOTE_MIN_WIDTH', () => {
  it('is the 120 px floor a Note is drawn and resized at', () => {
    expect(NOTE_MIN_WIDTH).toBe(120)
  })
})

describe('detectNodeModes', () => {
  it('reads the If/Else branches from the config', () => {
    const modes = detectNodeModes('if-else', {
      values: {
        branches: [
          { id: 'branch_0', type: 'if' },
          { id: 'branch_1', type: 'else' },
        ],
      },
    })
    expect(modes.isIfElseMode).toBe(true)
    expect(modes.ifElseBranches).toHaveLength(2)
  })

  it('marks loops and Remote Execution as two-lane blocks', () => {
    expect(detectNodeModes('for').isForLoop).toBe(true)
    expect(detectNodeModes('for-each').isForLoop).toBe(true)
    expect(detectNodeModes('while').isForLoop).toBe(true)
    expect(detectNodeModes('remote-execution').isRemoteExecution).toBe(true)
  })

  it('defaults Try/Catch to a catch lane and no finally lane', () => {
    const modes = detectNodeModes('try-catch-finally', { values: {} })
    expect(modes.isTryCatch).toBe(true)
    expect(modes.tryCatchEnableCatch).toBe(true)
    expect(modes.tryCatchEnableFinally).toBe(false)
  })

  it('reads the Parallel branches from the config', () => {
    expect(detectNodeModes('parallel', { values: { branches: parallelBranches(3) } }).parallelBranches).toHaveLength(3)
  })

  it('finds no lanes on a plain plugin', () => {
    const modes = detectNodeModes('log')
    expect(modes.isIfElseMode).toBe(false)
    expect(modes.isSplitMode).toBe(false)
    expect(modes.switchBranches).toEqual([])
    expect(modes.parallelBranches).toEqual([])
  })
})

describe('computeOutputWidth', () => {
  it('gives a single-egress block 120 px and a split Assert 160 px', () => {
    expect(computeOutputWidth(PLAIN_MODES)).toBe(120)
    expect(computeOutputWidth({ ...PLAIN_MODES, isSplitMode: true })).toBe(160)
  })

  it('spaces If/Else lanes 64 px apart inside 48 px margins', () => {
    expect(computeOutputWidth({ ...PLAIN_MODES, isIfElseMode: true, ifElseBranchCount: 3 })).toBe(48 * 2 + 2 * 64)
  })

  it('adds the trailing then lane to Switch and Parallel branches', () => {
    expect(computeOutputWidth({ ...PLAIN_MODES, switchBranchCount: 2 })).toBe(48 * 2 + 2 * 64)
    expect(computeOutputWidth({ ...PLAIN_MODES, parallelBranchCount: 4 })).toBe(48 * 2 + 4 * 64)
  })

  it('counts the Try/Catch lanes that are on', () => {
    expect(
      computeOutputWidth({ ...PLAIN_MODES, isTryCatch: true, tryCatchEnableCatch: true, tryCatchEnableFinally: true }),
    ).toBe(48 * 2 + 3 * 64)
  })

  it('gives loops, Remote Execution and a Retry Wait Until two lanes', () => {
    expect(computeOutputWidth({ ...PLAIN_MODES, isForLoop: true })).toBe(48 * 2 + 64)
    expect(computeOutputWidth({ ...PLAIN_MODES, isRemoteExecution: true })).toBe(48 * 2 + 64)
    expect(computeOutputWidth({ ...PLAIN_MODES, isWaitRetry: true })).toBe(48 * 2 + 64)
  })
})

describe('computeNodeMinWidth', () => {
  it('never goes below 120 px', () => {
    expect(computeNodeMinWidth(1, PLAIN_MODES)).toBe(120)
  })

  it('takes the wider of the ingress row (80 px per handle) and the egress row', () => {
    expect(computeNodeMinWidth(3, PLAIN_MODES)).toBe(240)
    expect(computeNodeMinWidth(1, { ...PLAIN_MODES, parallelBranchCount: 5 })).toBe(48 * 2 + 5 * 64)
  })
})

describe('computeFreshNodeWidth', () => {
  it('draws a fresh plugin Block at its 160 px floor', () => {
    expect(computeFreshNodeWidth({ type: 'workflowNode', data: { elementType: 'log' } })).toBe(160)
    expect(computeFreshNodeWidth({ type: 'workflowNode', data: { elementType: 'log', nodeType: 'plugin' } })).toBe(160)
  })

  it('draws a fresh Function Block at its 192 px floor', () => {
    expect(
      computeFreshNodeWidth({ type: 'workflowNode', data: { elementType: 'function', nodeType: 'function' } }),
    ).toBe(192)
  })

  it('draws a fresh Block with the default If/Else lanes at the 160 px floor', () => {
    expect(
      computeFreshNodeWidth({
        type: 'workflowNode',
        data: {
          elementType: 'if-else',
          config: {
            values: {
              branches: [
                { id: 'branch_0', type: 'if', label: '', conditions: [] },
                { id: 'branch_1', type: 'else', label: '' },
              ],
            },
          },
        },
      }),
    ).toBe(160)
  })

  it('draws a Block at its handle-row minimum when that is wider than its floor', () => {
    expect(
      computeFreshNodeWidth({
        type: 'workflowNode',
        data: { elementType: 'parallel', config: { values: { branches: parallelBranches(5) } } },
      }),
    ).toBe(48 * 2 + 5 * 64)
  })

  it('draws a fresh Note at its 120 px minimum', () => {
    expect(computeFreshNodeWidth({ type: 'noteNode', data: { elementType: 'note' } })).toBe(120)
  })
})
