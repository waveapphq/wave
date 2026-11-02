/**
 * Tests for the kebab additions to `getBlockMenuGroups` (FN-LC-15).
 *
 * State-to-UI:
 *
 *   | State              | Kebab "Open"      | "Publish to Library" | "Make Local..." |
 *   | Local              | shown             | shown                | hidden          |
 *   | Published (shared) | shown             | hidden               | shown           |
 *
 * "Make Local..." sits at the top of the Published-Function kebab as
 * a lifecycle group with "Open". The label uses a trailing ellipsis
 * to signal a dialog: exact string is "Make Local..." (or its ascii rendering
 * "Make Local..." - the tests below accept either via case-insensitive
 * substring match because the actual canonical glyph lives in the wireframe).
 *
 * Existing tests:
 *   - `menu-groups-open.test.ts`: 'open' action for elementType==='function'
 *   - `menu-groups-function-lifecycle.test.ts`: 'open' gated by lifecycle
 *
 * REQ scope: REQ-3.1.2.1.
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


describe("getBlockMenuGroups: 'publish-to-library' on Local Functions", () => {
  it("includes a 'publish-to-library' action for a local Function", () => {
    const groups = getBlockMenuGroups(
      baseState({
        elementType: 'function',
        functionLifecycle: 'local',
      }) as BlockMenuGroupsState,
    )
    const flat = groups.flat()
    expect(flat.find((item) => item.action === 'publish-to-library')).toBeDefined()
  })

  it("the 'publish-to-library' label reads as 'Publish to Library'", () => {
    const groups = getBlockMenuGroups(
      baseState({
        elementType: 'function',
        functionLifecycle: 'local',
      }) as BlockMenuGroupsState,
    )
    const item = groups.flat().find((i) => i.action === 'publish-to-library')
    expect(item?.label).toBe('Publish to Library')
  })

  it("does NOT include 'publish-to-library' for a shared Function", () => {
    const groups = getBlockMenuGroups(
      baseState({
        elementType: 'function',
        functionLifecycle: 'shared',
      }) as BlockMenuGroupsState,
    )
    expect(
      groups.flat().find((i) => i.action === 'publish-to-library'),
    ).toBeUndefined()
  })

  it("does NOT include 'publish-to-library' on non-Function nodes", () => {
    const groups = getBlockMenuGroups(baseState({ elementType: 'log' }))
    expect(
      groups.flat().find((i) => i.action === 'publish-to-library'),
    ).toBeUndefined()
  })
})


describe("getBlockMenuGroups: 'make-local' on Shared Functions", () => {
  it("includes a 'make-local' action for a shared Function", () => {
    const groups = getBlockMenuGroups(
      baseState({
        elementType: 'function',
        functionLifecycle: 'shared',
      }) as BlockMenuGroupsState,
    )
    expect(groups.flat().find((i) => i.action === 'make-local')).toBeDefined()
  })

  it("the 'make-local' label reads as 'Make Local...' (FN-LC-15 trailing ellipsis)", () => {
    const groups = getBlockMenuGroups(
      baseState({
        elementType: 'function',
        functionLifecycle: 'shared',
      }) as BlockMenuGroupsState,
    )
    const item = groups.flat().find((i) => i.action === 'make-local')
    // Accept either the ASCII "..." or the Unicode horizontal ellipsis "…".
    expect(item?.label).toMatch(/^Make Local(\.\.\.|…)$/)
  })

  it("places 'make-local' alongside 'open' in the FIRST (lifecycle) group", () => {
    const groups = getBlockMenuGroups(
      baseState({
        elementType: 'function',
        functionLifecycle: 'shared',
      }) as BlockMenuGroupsState,
    )
    const firstGroupActions = groups[0]?.map((i) => i.action) ?? []
    // The lifecycle group at the top contains both 'open' and
    // 'make-local'. The order between them is
    // not asserted - the wireframe shows Open first, but the test only
    // requires they share the first group.
    expect(firstGroupActions).toContain('make-local')
    expect(firstGroupActions).toContain('open')
  })

  it("does NOT include 'make-local' for a local Function", () => {
    const groups = getBlockMenuGroups(
      baseState({
        elementType: 'function',
        functionLifecycle: 'local',
      }) as BlockMenuGroupsState,
    )
    expect(groups.flat().find((i) => i.action === 'make-local')).toBeUndefined()
  })

  it("does NOT include 'make-local' on non-Function nodes", () => {
    const groups = getBlockMenuGroups(baseState({ elementType: 'log' }))
    expect(groups.flat().find((i) => i.action === 'make-local')).toBeUndefined()
  })
})


describe('getBlockMenuGroups: standard actions remain alongside new lifecycle entries', () => {
  it('local Function kebab still includes run/debug/duplicate/delete', () => {
    const groups = getBlockMenuGroups(
      baseState({
        elementType: 'function',
        functionLifecycle: 'local',
      }) as BlockMenuGroupsState,
    )
    const flat = groups.flat().map((i) => i.action)
    expect(flat).toContain('run-current')
    expect(flat).toContain('debug-current')
    expect(flat).toContain('duplicate')
    expect(flat).toContain('delete')
  })

  it('shared Function kebab still includes run/debug/duplicate/delete', () => {
    const groups = getBlockMenuGroups(
      baseState({
        elementType: 'function',
        functionLifecycle: 'shared',
      }) as BlockMenuGroupsState,
    )
    const flat = groups.flat().map((i) => i.action)
    expect(flat).toContain('run-current')
    expect(flat).toContain('debug-current')
    expect(flat).toContain('duplicate')
    expect(flat).toContain('delete')
  })
})
