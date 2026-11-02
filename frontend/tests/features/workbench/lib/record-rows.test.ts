/**
 * record-rows - list settings stored as record rows `[{value: x}]`: the editor works on plain items,
 * the Block keeps the rows (REQ-3.1.1.5).
 */

import { describe, it, expect } from 'vitest'
import { recordItems, recordRows } from '@/features/workbench/lib/record-rows'

describe('recordItems', () => {
  it('reads each record row as its value', () => {
    expect(recordItems([{ value: 'a' }, { value: null }, { value: 3 }])).toEqual(['a', null, 3])
  })

  it('reads a row that is not a record as itself', () => {
    expect(recordItems(['plain', null, ['x'], 7])).toEqual(['plain', null, ['x'], 7])
  })
})

describe('recordRows', () => {
  it('wraps each item in a record row', () => {
    expect(recordRows(['a', null])).toEqual([{ value: 'a' }, { value: null }])
  })
})
