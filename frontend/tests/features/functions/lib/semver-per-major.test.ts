/**
 * Per-major bump-target base for the publish suggestion (REQ-3.1.2.2, VIEW-9).
 *
 * Under per-major no-backports, the suggested next version must advance past the
 * latest version *in the source's major line*, not merely bump from the opened
 * source version. Opening an older version in an occupied line and bumping from
 * the source alone would suggest a version at or below the line head, which the
 * backend rejects. `nextAvailableTarget` therefore advances past the
 * major-line latest.
 */

import { describe, it, expect } from 'vitest'

import { nextAvailableTarget } from '@/features/functions/lib/semver'

describe('nextAvailableTarget - per-major base', () => {
  it('advances a patch past the occupied line head, not from an old source', () => {
    // Source 2.0.0 is opened, but the 2.x line head is 2.0.2. A patch must land
    // on 2.0.3 (past the line head), not 2.0.1 (a backport the backend rejects).
    expect(nextAvailableTarget('2.0.0', 'patch', ['1.0.0', '2.0.0', '2.0.2'])).toBe('2.0.3')
  })

  it('advances a minor past the line head, not from an old source', () => {
    // Source 2.0.0 opened; 2.x line head is 2.3.0. A minor must land on 2.4.0.
    expect(nextAvailableTarget('2.0.0', 'minor', ['2.0.0', '2.3.0'])).toBe('2.4.0')
  })

  it('does not let a higher major line push a lower-major patch (per-major isolation)', () => {
    // The 2.x head (2.5.0) must not bump the 1.x line; a 1.x patch stays 1.0.1.
    expect(nextAvailableTarget('1.0.0', 'patch', ['1.0.0', '2.0.0', '2.5.0'])).toBe('1.0.1')
  })

  it('matches the documented example: open 2.0.1, line head 2.0.2 -> 2.0.3', () => {
    expect(nextAvailableTarget('2.0.1', 'patch', ['2.0.1', '2.0.2'])).toBe('2.0.3')
  })

  it('keeps a patch at source+1 when the source IS the line head', () => {
    expect(nextAvailableTarget('2.0.2', 'patch', ['1.0.0', '2.0.0', '2.0.2'])).toBe('2.0.3')
  })
})
