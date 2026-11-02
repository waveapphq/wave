/**
 * focusCurrentBlock tests - navigate to a block's Function scope (if different),
 * then center on it. Same scope centers with no drilling; a missing node is a
 * no-op.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const requestFocus = vi.fn()
const popDrillTo = vi.fn()
const pushDrill = vi.fn()
const getState = vi.fn()

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: { getState: () => getState() },
}))

import { focusCurrentBlock } from '@/features/workbench/lib/focus-current'

// A top-level block `top`, and a local Function `f1` containing `child`.
const NODES = [
  { id: 'top', data: {} },
  {
    id: 'f1',
    data: {
      functionLifecycle: 'local',
      localDefinition: { workflow: { nodes: [{ id: 'child', data: {} }] } },
    },
  },
]

function storeWith(drillPath: { nodeId: string }[]) {
  return { nodes: NODES, drillPath, requestFocus, popDrillTo, pushDrill }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('focusCurrentBlock', () => {
  it('centers without drilling when the block is in the current scope', () => {
    getState.mockReturnValue(storeWith([]))

    focusCurrentBlock('top')

    expect(popDrillTo).not.toHaveBeenCalled()
    expect(pushDrill).not.toHaveBeenCalled()
    expect(requestFocus).toHaveBeenCalledWith('top')
  })

  it('drills into the Function then centers when the block is nested elsewhere', () => {
    getState.mockReturnValue(storeWith([]))

    focusCurrentBlock('child')

    expect(popDrillTo).toHaveBeenCalledWith(0)
    expect(pushDrill).toHaveBeenCalledWith('f1')
    expect(requestFocus).toHaveBeenCalledWith('child')
  })

  it('pops out to the top level then centers when the block is above the current scope', () => {
    getState.mockReturnValue(storeWith([{ nodeId: 'f1' }]))

    focusCurrentBlock('top')

    expect(popDrillTo).toHaveBeenCalledWith(0)
    expect(pushDrill).not.toHaveBeenCalled()
    expect(requestFocus).toHaveBeenCalledWith('top')
  })

  it('centers without drilling when already inside the block\'s Function', () => {
    getState.mockReturnValue(storeWith([{ nodeId: 'f1' }]))

    focusCurrentBlock('child')

    expect(popDrillTo).not.toHaveBeenCalled()
    expect(pushDrill).not.toHaveBeenCalled()
    expect(requestFocus).toHaveBeenCalledWith('child')
  })

  it('is a no-op when the block is not in the test', () => {
    getState.mockReturnValue(storeWith([]))

    focusCurrentBlock('ghost')

    expect(requestFocus).not.toHaveBeenCalled()
    expect(popDrillTo).not.toHaveBeenCalled()
  })
})
