import { describe, it, expect } from 'vitest'

import { deriveSwitchEntity } from '@/features/workbench/common/canvas/dialogs/switch-entity'

describe('deriveSwitchEntity', () => {
  it('labels a Function with its name when a Function View is open', () => {
    expect(deriveSwitchEntity({ name: 'Greet User' }, 'Some Test')).toEqual({
      entityKind: 'function',
      currentName: 'Greet User',
    })
  })

  it('falls back to null when the open Function has no resolved name', () => {
    expect(deriveSwitchEntity({}, 'Some Test')).toEqual({
      entityKind: 'function',
      currentName: null,
    })
  })

  it('labels a Test with the editing test name when no Function is open', () => {
    expect(deriveSwitchEntity(null, 'My Test')).toEqual({
      entityKind: 'test',
      currentName: 'My Test',
    })
  })
})
