/**
 * Tests for the kebab menu-group lifecycle additions (REQ-3.1.2.2).
 *
 * The kebab menu on a canvas Function node is the single home for lifecycle
 * actions. The additions:
 *
 *   - `edit` action in the first group on Published Function kebabs
 *     (alongside Open / Make Local...)
 *   - `drop-changes` action visible only when the instance carries an active
 *     draft (`editMode: true`)
 *   - `publish-edit-mode` action visible only when editMode: true (replaces
 *     the `make-local` and `publish-to-library` slots while in edit mode)
 *   - `make-local` is DISABLED on Published Function instances when the
 *     source version is missing (no source definition to copy)
 *
 * Local Functions:
 *   - `edit` is hidden (Local Functions are already mutable)
 *   - `drop-changes` is hidden (no edit-mode concept)
 */

import { describe, it, expect } from 'vitest'

import {
  getBlockMenuGroups,
  resolveMenuAccess,
  type BlockMenuGroupsState,
} from '@/features/workbench/common/canvas/workflow-node/menu-groups'


function flatActions(groups: ReturnType<typeof getBlockMenuGroups>): string[] {
  return groups.flatMap((g) => g.map((entry) => entry.action))
}

function findAction(
  groups: ReturnType<typeof getBlockMenuGroups>,
  action: string,
) {
  for (const group of groups) {
    for (const entry of group) {
      if (entry.action === action) return entry
    }
  }
  return undefined
}


// ---------------------------------------------------------------------------
// Edit action visibility
// ---------------------------------------------------------------------------


describe('getBlockMenuGroups - edit action', () => {
  it('shows `edit` on Published Function kebabs', () => {
    const state: BlockMenuGroupsState = {
      hasBreakpoint: false,
      disabled: false,
      skipped: false,
      hasConnections: false,
      elementType: 'function',
      functionLifecycle: 'shared',
    }
    const groups = getBlockMenuGroups(state)
    expect(flatActions(groups)).toContain('edit')
  })

  it('hides `edit` on Local Function kebabs (already mutable)', () => {
    const state: BlockMenuGroupsState = {
      hasBreakpoint: false,
      disabled: false,
      skipped: false,
      hasConnections: false,
      elementType: 'function',
      functionLifecycle: 'local',
    }
    const groups = getBlockMenuGroups(state)
    expect(flatActions(groups)).not.toContain('edit')
  })

  it('hides `edit` on non-Function nodes (plugins, controls)', () => {
    const state: BlockMenuGroupsState = {
      hasBreakpoint: false,
      disabled: false,
      skipped: false,
      hasConnections: false,
      elementType: 'log',
    }
    const groups = getBlockMenuGroups(state)
    expect(flatActions(groups)).not.toContain('edit')
  })
})


// ---------------------------------------------------------------------------
// Drop changes / publish-edit-mode visibility
// ---------------------------------------------------------------------------


describe('getBlockMenuGroups - drop-changes action', () => {
  it('shows `drop-changes` only when `editMode: true`', () => {
    const editingState: BlockMenuGroupsState = {
      hasBreakpoint: false,
      disabled: false,
      skipped: false,
      hasConnections: false,
      elementType: 'function',
      functionLifecycle: 'shared',
      editMode: true,
    }
    const cleanState: BlockMenuGroupsState = {
      ...editingState,
      editMode: false,
    }
    expect(flatActions(getBlockMenuGroups(editingState))).toContain(
      'drop-changes',
    )
    expect(flatActions(getBlockMenuGroups(cleanState))).not.toContain(
      'drop-changes',
    )
  })

  it('shows `publish-edit-mode` only when `editMode: true`', () => {
    const editingState: BlockMenuGroupsState = {
      hasBreakpoint: false,
      disabled: false,
      skipped: false,
      hasConnections: false,
      elementType: 'function',
      functionLifecycle: 'shared',
      editMode: true,
    }
    const cleanState: BlockMenuGroupsState = {
      ...editingState,
      editMode: false,
    }
    expect(flatActions(getBlockMenuGroups(editingState))).toContain(
      'publish-edit-mode',
    )
    expect(flatActions(getBlockMenuGroups(cleanState))).not.toContain(
      'publish-edit-mode',
    )
  })

  it('hides `make-local` while in edit mode (publish-edit-mode replaces it)', () => {
    const state: BlockMenuGroupsState = {
      hasBreakpoint: false,
      disabled: false,
      skipped: false,
      hasConnections: false,
      elementType: 'function',
      functionLifecycle: 'shared',
      editMode: true,
    }
    expect(flatActions(getBlockMenuGroups(state))).not.toContain('make-local')
  })
})


// ---------------------------------------------------------------------------
// Make Local disabled on missing-version
// ---------------------------------------------------------------------------


describe('getBlockMenuGroups - make-local missing-version', () => {
  it('disables `make-local` when the source version is missing', () => {
    const state: BlockMenuGroupsState = {
      hasBreakpoint: false,
      disabled: false,
      skipped: false,
      hasConnections: false,
      elementType: 'function',
      functionLifecycle: 'shared',
      missingVersion: true,
    }
    const entry = findAction(getBlockMenuGroups(state), 'make-local')
    expect(entry).toBeDefined()
    expect(entry?.itemDisabled).toBe(true)
  })

  it('keeps `make-local` enabled on shared instances with the version present', () => {
    const state: BlockMenuGroupsState = {
      hasBreakpoint: false,
      disabled: false,
      skipped: false,
      hasConnections: false,
      elementType: 'function',
      functionLifecycle: 'shared',
    }
    const entry = findAction(getBlockMenuGroups(state), 'make-local')
    expect(entry).toBeDefined()
    expect(entry?.itemDisabled).toBeFalsy()
  })

  it('disables `edit` when the source version is missing (cannot snapshot a gone source)', () => {
    const state: BlockMenuGroupsState = {
      hasBreakpoint: false,
      disabled: false,
      skipped: false,
      hasConnections: false,
      elementType: 'function',
      functionLifecycle: 'shared',
      missingVersion: true,
    }
    const entry = findAction(getBlockMenuGroups(state), 'edit')
    expect(entry).toBeDefined()
    expect(entry?.itemDisabled).toBe(true)
  })
})


// ---------------------------------------------------------------------------
// A read-only Function body opened in the Workbench still runs its Blocks
// ---------------------------------------------------------------------------


describe('getBlockMenuGroups - inspect-only scope', () => {
  const inspected: BlockMenuGroupsState = {
    hasBreakpoint: false,
    disabled: false,
    skipped: false,
    hasConnections: true,
    elementType: 'function',
    functionLifecycle: 'shared',
    inspectOnly: true,
  }

  it('offers only the run and debug items on a Block in a read-only Function body', () => {
    expect(flatActions(getBlockMenuGroups(inspected))).toEqual([
      'run-current',
      'run-from-here',
      'debug-current',
      'debug-from-here',
      'toggle-breakpoint',
    ])
  })

  it('keeps the run items enabled while nothing runs', () => {
    expect(findAction(getBlockMenuGroups(inspected), 'run-current')?.itemDisabled).toBe(false)
  })
})


describe('resolveMenuAccess', () => {
  it('shows the full menu on an editable canvas', () => {
    expect(resolveMenuAccess(false, false, true)).toEqual({ hidden: false, inspectOnly: false })
  })

  it('shows the run and debug items on a read-only scope that can still run', () => {
    expect(resolveMenuAccess(true, false, true)).toEqual({ hidden: false, inspectOnly: true })
  })

  it('hides the menu on a read-only canvas that cannot run (history, mirroring)', () => {
    expect(resolveMenuAccess(true, false, false)).toEqual({ hidden: true, inspectOnly: false })
  })

  it('keeps the menu during execution so breakpoints can still be toggled', () => {
    expect(resolveMenuAccess(true, true, false)).toEqual({ hidden: false, inspectOnly: false })
  })
})
