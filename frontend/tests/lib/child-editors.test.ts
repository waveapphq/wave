/**
 * child-editors - what a parent derives from the floating editors open beneath it.
 *
 * Module: frontend/src/lib/child-editors.ts
 *
 * A parent's Save is blocked by its own invalid form first, then by an open child
 * that has changes and cannot be saved; a child that shows errors but has no
 * changes blocks nothing. A child's write replays onto a draft as the difference
 * from the state the parent held when the replay began.
 */

import { describe, it, expect } from 'vitest'
import {
  anyChildHasChanges,
  childEditorNote,
  formErrorsNote,
  openEditorAfterRemoval,
  replayListWrite,
  replayRecordWrite,
  saveBlockedNote,
  type ChildEditorStatus,
} from '@/lib/child-editors'

const clean: ChildEditorStatus = { label: 'Headers', hasChanges: false, cannotBeSaved: false }
const changed: ChildEditorStatus = { label: 'Body', hasChanges: true, cannotBeSaved: false }
const broken: ChildEditorStatus = { label: 'Input Variables', hasChanges: true, cannotBeSaved: true }
const brokenUnchanged: ChildEditorStatus = { label: 'Environment', hasChanges: false, cannotBeSaved: true }

describe('childEditorNote', () => {
  it('names the row the child was opened from', () => {
    expect(childEditorNote('Input Variables')).toBe(
      'Save is disabled: the Input Variables editor has errors',
    )
  })

  it('names the action a parent labels its Save with', () => {
    expect(childEditorNote('Value', 'Create')).toBe('Create is disabled: the Value editor has errors')
  })

})

describe('formErrorsNote', () => {
  it("names the parent's own form", () => {
    expect(formErrorsNote('settings')).toBe('Save is disabled: the settings have errors')
  })

  it('names the action a parent labels its Save with', () => {
    expect(formErrorsNote('settings', 'Create')).toBe('Create is disabled: the settings have errors')
  })
})

describe('anyChildHasChanges', () => {
  it('is false with no child open', () => {
    expect(anyChildHasChanges([])).toBe(false)
  })

  it('is false while every open child is clean', () => {
    expect(anyChildHasChanges([clean, brokenUnchanged])).toBe(false)
  })

  it('is true once one open child has changes', () => {
    expect(anyChildHasChanges([clean, changed])).toBe(true)
  })
})

describe('saveBlockedNote', () => {
  it('is null when nothing blocks', () => {
    expect(saveBlockedNote(null, [clean, changed])).toBeNull()
  })

  it("names the parent's own form first", () => {
    expect(saveBlockedNote(formErrorsNote('settings'), [broken])).toBe(
      'Save is disabled: the settings have errors',
    )
  })

  it('names the first open child that has changes and cannot be saved', () => {
    const second: ChildEditorStatus = { label: 'Arguments', hasChanges: true, cannotBeSaved: true }
    expect(saveBlockedNote(null, [clean, broken, second])).toBe(
      'Save is disabled: the Input Variables editor has errors',
    )
  })

  it('ignores a child that shows errors but has no changes', () => {
    expect(saveBlockedNote(null, [brokenUnchanged])).toBeNull()
  })

  it('names the action a parent labels its Save with', () => {
    expect(saveBlockedNote(null, [broken], 'Create')).toBe(
      'Create is disabled: the Input Variables editor has errors',
    )
  })
})

describe('replayRecordWrite', () => {
  it('sets the keys the write changed from the base', () => {
    const base = { a: 1, b: 2 }
    const draft = { a: 1, b: 3 }
    expect(replayRecordWrite(base, draft, { a: 5, b: 2 })).toEqual({ a: 5, b: 3 })
  })

  it('removes the keys the write dropped from the base', () => {
    const base = { a: 1, b: 2 }
    const draft = { a: 1, b: 2, c: 9 }
    expect(replayRecordWrite(base, draft, { a: 1 })).toEqual({ a: 1, c: 9 })
  })

  it('adds a key the base never had', () => {
    expect(replayRecordWrite({}, { x: 1 }, { y: 2 })).toEqual({ x: 1, y: 2 })
  })

  it('leaves the draft untouched when the write repeats the base', () => {
    const draft = { a: 7 }
    expect(replayRecordWrite({ a: 1 }, draft, { a: 1 })).toEqual({ a: 7 })
  })
})

describe('replayListWrite', () => {
  it('adds the entries the write added to the base', () => {
    expect(replayListWrite(['a'], ['a', 'b'], ['a', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('removes the entries the write removed from the base', () => {
    expect(replayListWrite(['a', 'b'], ['a', 'b', 'c'], ['b'])).toEqual(['b', 'c'])
  })

  it('never lists an entry twice', () => {
    expect(replayListWrite([], ['a'], ['a'])).toEqual(['a'])
  })
})

describe('openEditorAfterRemoval', () => {
  it('reports no editor when none was open', () => {
    expect(openEditorAfterRemoval(null, 1)).toBeNull()
  })

  it('closes the editor of the row that is taken away', () => {
    expect(openEditorAfterRemoval(2, 2)).toBeNull()
  })

  it('shifts the editor of a later row down one place', () => {
    expect(openEditorAfterRemoval(3, 1)).toBe(2)
  })

  it('leaves the editor of an earlier row where it is', () => {
    expect(openEditorAfterRemoval(0, 1)).toBe(0)
  })
})
