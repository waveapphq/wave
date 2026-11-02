/**
 * How an open sheet's draft follows its Block changed elsewhere: a field left
 * alone takes the change, an edited field keeps the edit.
 */

import { describe, it, expect } from 'vitest'
import { followRecord, followValue, sameStored } from '@/lib/draft-follow'

describe('sameStored', () => {
  it('treats equal content as the same, whatever the object', () => {
    expect(sameStored({ a: [1] }, { a: [1] })).toBe(true)
    expect(sameStored({ a: [1] }, { a: [2] })).toBe(false)
  })
})

describe('followValue', () => {
  it('takes the change while the draft still holds the stored value', () => {
    expect(followValue('old', 'old', 'new')).toBe('new')
  })

  it('keeps an edited draft', () => {
    expect(followValue('old', 'typed', 'new')).toBe('typed')
  })
})

describe('followRecord', () => {
  it('takes a changed, an added and a removed key the draft left alone', () => {
    const draft = { changed: 'a', removed: 'b', same: 'c' }
    expect(followRecord({ changed: 'a', removed: 'b', same: 'c' }, draft, { changed: '', same: 'c', added: 'd' })).toEqual({
      changed: '',
      same: 'c',
      added: 'd',
    })
  })

  it('keeps a key the draft changed itself', () => {
    expect(followRecord({ out: 'a' }, { out: 'typed' }, { out: '' })).toEqual({ out: 'typed' })
  })

  it('returns the same draft when nothing it left alone moved', () => {
    const draft = { out: 'typed', other: 'x' }
    expect(followRecord({ out: 'a', other: 'x' }, draft, { out: '', other: 'x' })).toBe(draft)
  })
})
