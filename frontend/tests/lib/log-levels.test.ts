/**
 * Canonical log level list tests.
 *
 * The list is keyed by the LogLevel type, so a level added to the type fails
 * to compile until it is listed, and then fails this test until the order it
 * takes in every level dropdown is chosen deliberately.
 *
 * Module: frontend/src/lib/log-levels.ts
 */

import { describe, it, expect } from 'vitest'
import { LOG_LEVELS, type LogLevel } from '@/lib/log-levels'

describe('LOG_LEVELS', () => {
  it('lists every level from least to most severe', () => {
    expect(LOG_LEVELS).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'])
  })

  it('lists each level once', () => {
    expect(new Set(LOG_LEVELS).size).toBe(LOG_LEVELS.length)
  })

  it('cannot be mutated by a consumer that casts the readonly type away', () => {
    expect(Object.isFrozen(LOG_LEVELS)).toBe(true)

    const escaped = LOG_LEVELS as LogLevel[]
    expect(() => escaped.push('DEBUG')).toThrow(TypeError)
    expect(() => {
      escaped[0] = 'FATAL'
    }).toThrow(TypeError)

    expect(LOG_LEVELS).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'])
  })
})
