import { describe, it, expect } from 'vitest'
import { numberEntryProps, takesEntryText } from '@/lib/number-entry'

// Every list item, map value, table cell and condition value box of a number type keeps one keystroke rule (REQ-3.1.3.14).

describe('numberEntryProps', () => {
  it('gives an integer box the number keyboard and a stop one past 19 digits', () => {
    expect(numberEntryProps('integer')).toEqual({ inputMode: 'numeric', maxLength: 20 })
  })

  it('gives a float box the decimal keyboard and a stop one past its character backstop', () => {
    expect(numberEntryProps('float')).toEqual({ inputMode: 'decimal', maxLength: 41 })
  })

  it.each(['string', 'boolean', 'array', 'map'])('gives a %s box nothing', (type) => {
    expect(numberEntryProps(type)).toEqual({})
  })
})

describe('takesEntryText', () => {
  it.each([
    ['', 'integer'],
    ['-', 'integer'],
    ['1234567890123456789', 'integer'],
    ['-1.', 'float'],
    ['0.5', 'float'],
  ])('takes %j in a %s box', (text, type) => {
    expect(takesEntryText(text, type)).toBe(true)
  })

  it.each([
    ['12345678901234567890', 'integer'],
    ['1.5', 'integer'],
    ['1e5', 'float'],
    ['+1', 'float'],
    [' 1', 'integer'],
  ])('drops %j in a %s box', (text, type) => {
    expect(takesEntryText(text, type)).toBe(false)
  })

  it('takes any text in a box of another type', () => {
    expect(takesEntryText('1e5 or anything', 'string')).toBe(true)
  })
})
