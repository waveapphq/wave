/**
 * field-constraints constants tests.
 *
 * Pins the entity-name + test-name caps in the field-constraints module, and
 * the one rule for when a capped field shows its counter. The
 * no-bare-inputs test in
 * `tests/design-system/no-bare-inputs-in-target-surfaces.test.ts` reads these
 * values via runtime import and re-asserts them in production source.
 *
 * Existing constants `MAX_ELEMENT_NAME_LENGTH` and `MAX_VARIABLE_NAME_LENGTH`
 * are covered by the NameField primitive test.
 */

import { describe, it, expect } from 'vitest'

import {
  MAX_ENTITY_NAME_LENGTH,
  MAX_TEST_NAME_LENGTH,
} from '@/lib/field-constraints'
// Namespace import so a not-yet-added export reads as `undefined` instead of
// crashing the module load (the named import above would throw on a missing key).
import * as fieldConstraints from '@/lib/field-constraints'

describe('field-constraints (entity + test name caps)', () => {
  it('MAX_ENTITY_NAME_LENGTH equals 64 (suite, regression, environment, profile)', () => {
    expect(MAX_ENTITY_NAME_LENGTH).toBe(64)
  })

  it('MAX_TEST_NAME_LENGTH equals 255 (tests only - long descriptive names allowed)', () => {
    expect(MAX_TEST_NAME_LENGTH).toBe(255)
  })

  it('MAX_TEST_NAME_LENGTH is strictly larger than MAX_ENTITY_NAME_LENGTH', () => {
    // Sanity: tests get the looser cap; entities get the tight cap.
    expect(MAX_TEST_NAME_LENGTH).toBeGreaterThan(MAX_ENTITY_NAME_LENGTH)
  })
})

describe('field-constraints (version cap)', () => {
  it('MAX_VERSION_LENGTH equals 32 (global Function version cap, sibling of MAX_BLOCK_NAME_LENGTH)', () => {
    expect(fieldConstraints.MAX_VERSION_LENGTH).toBe(32)
  })
})

// One rule for every capped field: the counter hides under 80% of the cap, is muted from 80% and destructive at the cap.
describe('field-constraints (counter state)', () => {
  it.each([
    [0, 'hidden'],
    [51, 'hidden'],
    [52, 'muted'],
    [63, 'muted'],
    [64, 'destructive'],
  ] as const)('reads %i of 64 as %s', (count, state) => {
    expect(fieldConstraints.counterState(count, 64)).toBe(state)
  })

  it('reads 8 of 10 as muted, exactly 80% of the cap', () => {
    expect(fieldConstraints.counterState(8, 10)).toBe('muted')
  })
})
