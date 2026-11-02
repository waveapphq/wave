/**
 * Tests for the pure FE semver helpers: `parseSemver`, `classifyBumpLevel`,
 * and `bumpTarget` (version dropdown + edit-mode publish dialog, REQ-3.1.2.2).
 */

import { describe, it, expect } from 'vitest'

import {
  parseSemver,
  classifyBumpLevel,
  bumpTarget,
  nextAvailableTarget,
  comparePrecedence,
  isValidSemver,
} from '@/features/functions/lib/semver'

// "1.0.0-" is 6 chars; pad the pre-release to land exactly on 32 / 33.
const VERSION_32 = '1.0.0-' + 'a'.repeat(26) // 32 chars, well-formed semver
const VERSION_33 = '1.0.0-' + 'a'.repeat(27) // 33 chars, over the global cap

describe('parseSemver', () => {
  it('parses a plain MAJOR.MINOR.PATCH version into a numeric tuple', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3])
  })

  it('parses a version with pre-release and build metadata', () => {
    expect(parseSemver('10.20.30-alpha.1+build.5')).toEqual([10, 20, 30])
  })

  it('parses an all-zero version', () => {
    expect(parseSemver('0.0.0')).toEqual([0, 0, 0])
  })

  it('returns null for a non-semver string', () => {
    expect(parseSemver('not-a-version')).toBeNull()
  })

  it('returns null for a partial version missing the patch segment', () => {
    expect(parseSemver('1.2')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseSemver('')).toBeNull()
  })

  it('returns null when a segment has a leading zero', () => {
    expect(parseSemver('01.2.3')).toBeNull()
  })
})

describe('classifyBumpLevel', () => {
  it('classifies a patch increment', () => {
    expect(classifyBumpLevel('1.2.3', '1.2.4')).toBe('patch')
  })

  it('classifies a minor increment', () => {
    expect(classifyBumpLevel('1.2.3', '1.3.0')).toBe('minor')
  })

  it('classifies a major increment', () => {
    expect(classifyBumpLevel('1.2.3', '2.0.0')).toBe('major')
  })

  it('returns null when target equals source (no bump)', () => {
    expect(classifyBumpLevel('1.2.3', '1.2.3')).toBeNull()
  })

  it('returns null when target is lower than source', () => {
    expect(classifyBumpLevel('1.2.3', '1.2.2')).toBeNull()
  })

  it('returns null when the source is not valid semver', () => {
    expect(classifyBumpLevel('bad', '1.2.4')).toBeNull()
  })

  it('returns null when the target is not valid semver', () => {
    expect(classifyBumpLevel('1.2.3', 'bad')).toBeNull()
  })
})

describe('bumpTarget', () => {
  it('increments the patch segment', () => {
    expect(bumpTarget('1.2.3', 'patch')).toBe('1.2.4')
  })

  it('increments the minor segment and resets patch', () => {
    expect(bumpTarget('1.2.3', 'minor')).toBe('1.3.0')
  })

  it('increments the major segment and resets minor and patch', () => {
    expect(bumpTarget('1.2.3', 'major')).toBe('2.0.0')
  })

  it('falls back to 1.0.0 base when the source is not valid semver', () => {
    expect(bumpTarget('not-a-version', 'patch')).toBe('1.0.1')
    expect(bumpTarget('not-a-version', 'minor')).toBe('1.1.0')
    expect(bumpTarget('not-a-version', 'major')).toBe('2.0.0')
  })
})

describe('comparePrecedence', () => {
  it('orders by the numeric core first', () => {
    expect(comparePrecedence('1.0.0', '2.0.0')).toBeLessThan(0)
    expect(comparePrecedence('2.1.0', '2.0.9')).toBeGreaterThan(0)
    expect(comparePrecedence('1.2.3', '1.2.3')).toBe(0)
  })

  it('ranks a release above its pre-release (2.0.0-dev1 < 2.0.0)', () => {
    expect(comparePrecedence('2.0.0-dev1', '2.0.0')).toBeLessThan(0)
    expect(comparePrecedence('2.0.0', '2.0.0-dev1')).toBeGreaterThan(0)
  })

  it('orders pre-release identifiers per the semver spec', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ]
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(comparePrecedence(ordered[i], ordered[i + 1])).toBeLessThan(0)
    }
  })

  it('orders pre-release identifiers in the reverse direction too', () => {
    // a non-numeric vs b numeric (the "b is numeric -> a wins" branch), and a
    // greater-than b for two non-numeric identifiers.
    expect(comparePrecedence('1.0.0-alpha.beta', '1.0.0-alpha.1')).toBeGreaterThan(0)
    expect(comparePrecedence('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0)
  })

  it('treats two equal pre-releases as equal precedence', () => {
    expect(comparePrecedence('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0)
  })

  it('sorts an invalid string below any valid version', () => {
    expect(comparePrecedence('not-a-version', '0.0.0')).toBeLessThan(0)
    expect(comparePrecedence('1.0.0', 'garbage')).toBeGreaterThan(0)
    expect(comparePrecedence('bad', 'worse')).toBe(0)
  })
})

describe('nextAvailableTarget', () => {
  it('returns the plain bump target when it is not already taken', () => {
    expect(nextAvailableTarget('1.2.0', 'major', ['1.0.0', '1.2.0'])).toBe('2.0.0')
  })

  it('skips an existing target at the same level (major from 1.2.0 with 2.0.0 taken -> 3.0.0)', () => {
    expect(nextAvailableTarget('1.2.0', 'major', ['1.2.0', '2.0.0'])).toBe('3.0.0')
  })

  it('skips multiple consecutive existing majors', () => {
    expect(nextAvailableTarget('1.0.0', 'major', ['1.0.0', '2.0.0', '3.0.0'])).toBe('4.0.0')
  })

  it('skips taken minors and patches at their own level', () => {
    expect(nextAvailableTarget('1.2.0', 'minor', ['1.3.0'])).toBe('1.4.0')
    expect(nextAvailableTarget('1.2.0', 'patch', ['1.2.1', '1.2.2'])).toBe('1.2.3')
  })
})

describe('isValidSemver length cap (MAX_VERSION_LENGTH = 32)', () => {
  it('rejects an otherwise-valid version longer than 32 characters', () => {
    expect(VERSION_33.length).toBe(33)
    expect(isValidSemver(VERSION_33)).toBe(false)
  })

  it('accepts a well-formed version exactly 32 characters long', () => {
    expect(VERSION_32.length).toBe(32)
    expect(isValidSemver(VERSION_32)).toBe(true)
  })

  it('still accepts a plain short version (no regression)', () => {
    expect(isValidSemver('1.0.0')).toBe(true)
  })

  it('still rejects a malformed short version', () => {
    expect(isValidSemver('1.0')).toBe(false)
  })
})

describe('isValidSemver format validation', () => {
  it('accepts a version with valid build metadata', () => {
    expect(isValidSemver('1.0.0+build.1')).toBe(true)
  })

  it('rejects a trailing-plus version with empty build metadata', () => {
    expect(isValidSemver('1.0.0+')).toBe(false)
  })

  it('rejects a version with an illegal build identifier', () => {
    expect(isValidSemver('1.0.0+bu!ld')).toBe(false)
  })

  it('accepts a version with a valid pre-release', () => {
    expect(isValidSemver('1.0.0-rc.1')).toBe(true)
  })

  it('rejects a trailing-dash version with empty pre-release', () => {
    expect(isValidSemver('1.0.0-')).toBe(false)
  })

  it('rejects a pre-release identifier with a leading zero', () => {
    expect(isValidSemver('1.0.0-01')).toBe(false)
  })
})
