/**
 * joinLabels - how failed-read labels are joined into one title.
 *
 * Module: frontend/src/lib/join-labels.ts
 *
 * One label reads on its own; two are joined with "and"; three or more take
 * commas up to the last pair.
 */

import { describe, it, expect } from 'vitest'
import { joinLabels } from '@/lib/join-labels'

describe('joinLabels', () => {
  it('returns a single label verbatim', () => {
    expect(joinLabels(['environments'])).toBe('environments')
  })

  it('joins two labels with and', () => {
    expect(joinLabels(['tags', 'environments'])).toBe('tags and environments')
  })

  it('commas every label but the last pair', () => {
    expect(joinLabels(['profile types', 'tags', 'environments'])).toBe(
      'profile types, tags and environments'
    )
  })
})
