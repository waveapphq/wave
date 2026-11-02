/**
 * Tests for the workflow-node menu groups' new `open` action.
 *
 * `getBlockMenuGroups` returns the kebab menu group layout. When the node's
 * element type is `function`, a leading group must include an `open` action
 * with the canonical label `Open`. For any other element type, the `open`
 * action must NOT appear.
 */

import { describe, it, expect } from 'vitest'

import {
  getBlockMenuGroups,
  type BlockMenuGroupsState,
} from '@/features/workbench/common/canvas/workflow-node/menu-groups'

function baseState(overrides: Partial<BlockMenuGroupsState> = {}): BlockMenuGroupsState {
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

describe("getBlockMenuGroups: 'open' action for Function nodes", () => {
  it("includes an 'open' action with label 'Open' when elementType is 'function'", () => {
    const groups = getBlockMenuGroups(baseState({ elementType: 'function' }))
    const flat = groups.flat()
    const open = flat.find((item) => item.action === 'open')
    expect(open).toBeDefined()
    expect(open?.label).toBe('Open')
  })

  it("places the 'open' action in the FIRST group when elementType is 'function'", () => {
    // The open group is prepended so it sits at the top of the kebab.
    const groups = getBlockMenuGroups(baseState({ elementType: 'function' }))
    expect(groups[0]?.some((item) => item.action === 'open')).toBe(true)
  })

  it("does not include an 'open' action when elementType is undefined", () => {
    const groups = getBlockMenuGroups(baseState())
    const flat = groups.flat()
    expect(flat.find((item) => item.action === 'open')).toBeUndefined()
  })

  it.each(['shell-script', 'http-client', 'if-else', 'for', 'try-catch-finally', 'note'])(
    "does not include an 'open' action when elementType is '%s'",
    (elementType) => {
      const groups = getBlockMenuGroups(baseState({ elementType }))
      const flat = groups.flat()
      expect(flat.find((item) => item.action === 'open')).toBeUndefined()
    },
  )

  it("preserves the rest of the menu structure for a Function node", () => {
    // The standard kebab actions (run, debug, duplicate/copy/cut, disable, delete)
    // must remain present alongside the new Open group.
    const groups = getBlockMenuGroups(baseState({ elementType: 'function' }))
    const flat = groups.flat().map((item) => item.action)
    expect(flat).toContain('run-current')
    expect(flat).toContain('debug-current')
    expect(flat).toContain('duplicate')
    expect(flat).toContain('disable')
    expect(flat).toContain('delete')
  })
})
