/**
 * secret-envelope - stored-secret detection helpers.
 *
 * isSealedSecret matches the backend at-rest envelope; isStoredSecretValue also
 * matches the masked placeholder returned by variable / profile read paths. Both
 * distinguish a STORED secret (masked write-only in the UI) from a value typed
 * this session or revealed as plaintext (visible and editable).
 */

import { describe, it, expect } from 'vitest'
import {
  MASK_PLACEHOLDER,
  SECRET_ENVELOPE_PREFIX,
  hidesSecretValue,
  holdsSecretValue,
  holdsUnsavedSecret,
  isSealedSecret,
  isStoredSecretValue,
} from '@/lib/secret-envelope'

describe('isSealedSecret', () => {
  it('is true for a sealed envelope string', () => {
    expect(isSealedSecret(`${SECRET_ENVELOPE_PREFIX}abc123`)).toBe(true)
  })

  it('is false for the masked placeholder, plaintext, and non-strings', () => {
    expect(isSealedSecret(MASK_PLACEHOLDER)).toBe(false)
    expect(isSealedSecret('plaintext')).toBe(false)
    expect(isSealedSecret('')).toBe(false)
    expect(isSealedSecret(null)).toBe(false)
    expect(isSealedSecret(undefined)).toBe(false)
    expect(isSealedSecret(42)).toBe(false)
    expect(isSealedSecret(['x'])).toBe(false)
  })
})

describe('isStoredSecretValue', () => {
  it('is true for a sealed envelope (workflow node config form)', () => {
    expect(isStoredSecretValue(`${SECRET_ENVELOPE_PREFIX}xyz`)).toBe(true)
  })

  it('is true for the masked placeholder (variable / profile read-path form)', () => {
    expect(isStoredSecretValue(MASK_PLACEHOLDER)).toBe(true)
    expect(MASK_PLACEHOLDER).toBe('********')
  })

  it('is false for a value typed this session or revealed as plaintext', () => {
    expect(isStoredSecretValue('just-typed-plaintext')).toBe(false)
    expect(isStoredSecretValue('revealed-secret')).toBe(false)
  })

  it('is false for an empty / absent value and non-string structured values', () => {
    expect(isStoredSecretValue('')).toBe(false)
    expect(isStoredSecretValue(null)).toBe(false)
    expect(isStoredSecretValue(undefined)).toBe(false)
    expect(isStoredSecretValue([1, 2, 3])).toBe(false)
    expect(isStoredSecretValue({ a: 1 })).toBe(false)
    expect(isStoredSecretValue(7)).toBe(false)
  })
})

// The backend's rule: absent, null and "" hold nothing; anything else is a value, sealed and masked.
describe('holdsSecretValue', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty', ''],
  ])('holds nothing when the value is %s', (_label, value) => {
    expect(holdsSecretValue(value)).toBe(false)
  })

  it.each([
    ['a space', ' '],
    ['tabs and new lines', '\t\n'],
    ['a sealed envelope', `${SECRET_ENVELOPE_PREFIX}abc`],
    ['the mask', MASK_PLACEHOLDER],
    ['plain text', 'token'],
    ['zero', 0],
    ['false', false],
    ['an empty list', []],
    ['an empty map', {}],
  ])('holds a value when the value is %s', (_label, value) => {
    expect(holdsSecretValue(value)).toBe(true)
  })
})

describe('hidesSecretValue', () => {
  it('is true for a secret holding a value', () => {
    expect(hidesSecretValue({ isSecret: true, value: MASK_PLACEHOLDER })).toBe(true)
  })

  it.each([
    ['null', null],
    ['empty text', ''],
    ['no value', undefined],
  ])('is false for a secret holding %s', (_label, value) => {
    expect(hidesSecretValue({ isSecret: true, value })).toBe(false)
  })

  it('is false for a plain variable holding a value', () => {
    expect(hidesSecretValue({ isSecret: false, value: 'visible' })).toBe(false)
    expect(hidesSecretValue({ value: 'visible' })).toBe(false)
  })
})

// A credential's save seals what it holds: a scalar whole, a map value by value (REQ-3.1.3.18).
describe('holdsUnsavedSecret', () => {
  const SEALED = `${SECRET_ENVELOPE_PREFIX}abc`

  it.each([
    ['typed text', 'hunter2'],
    ['a space', ' '],
    ['zero', 0],
    ['false', false],
    ['a list', ['a']],
    ['a typed map', { username: 'admin', password: 'hunter2' }],
    ['a map with one typed value among empty ones', { a: '', b: 'token' }],
  ])('is true for %s', (_label, value) => {
    expect(holdsUnsavedSecret(value)).toBe(true)
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty text', ''],
    ['a sealed envelope', SEALED],
    ['the mask', MASK_PLACEHOLDER],
    ['an empty map', {}],
    ['a map of empty values', { a: '', b: null }],
    ['a sealed map', { 'tls.crt': SEALED, 'tls.key': SEALED }],
    ['a masked map', { 'tls.crt': MASK_PLACEHOLDER }],
  ])('is false for %s', (_label, value) => {
    expect(holdsUnsavedSecret(value)).toBe(false)
  })
})
