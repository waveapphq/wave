/**
 * Tests for getBlockMenuGroups - the 'open' action across Function lifecycles.
 *
 * Open shows on shared Function nodes so the
 * user can drill in to inspect a published Function. Both local and shared
 * variants therefore surface 'Open' in the first (lifecycle) menu group.
 */

import { describe, it, expect } from 'vitest'

import {
  getBlockMenuGroups,
  type BlockMenuGroupsState,
} from '@/features/workbench/common/canvas/workflow-node/menu-groups'

interface ExtendedState extends BlockMenuGroupsState {
  functionLifecycle?: 'local' | 'shared'
}

function baseState(overrides: Partial<ExtendedState> = {}): ExtendedState {
  return {
    hasBreakpoint: false,
    disabled: false,
    skipped: false,
    hasConnections: false,
    isExecuting: false,
    isNodeRunning: false,
    ...overrides,
  }
}

describe("getBlockMenuGroups: 'open' is visible on every Function lifecycle", () => {
  it("includes 'open' for a Function node with functionLifecycle='shared'", () => {
    const groups = getBlockMenuGroups(
      baseState({ elementType: 'function', functionLifecycle: 'shared' }) as BlockMenuGroupsState,
    )
    const flat = groups.flat()
    expect(flat.find((item) => item.action === 'open')).toBeDefined()
  })

  it("includes the 'open' action in the first group for a local Function", () => {
    const groups = getBlockMenuGroups(
      baseState({ elementType: 'function', functionLifecycle: 'local' }) as BlockMenuGroupsState,
    )
    expect(groups[0]?.some((item) => item.action === 'open')).toBe(true)
  })
})
