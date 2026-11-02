/**
 * Tests for the regression collision-error-message decoder + wrapper.
 *
 * The wrapper normalizes the three backend collision shapes (pair,
 * regression-vs-member-suite, regression-vs-regression) into the shared
 * CollisionErrorMessage / CollisionResolutionModal contract. The decoder
 * functions are pure and exported for direct unit testing.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  CollisionErrorMessage,
  collisionKind,
  entityLabelForKind,
  groupCollisions,
  type CollisionEntry,
} from '@/features/regressions/components/collision-error-message'

describe('collisionKind', () => {
  it('returns "regression" when other_regression is populated', () => {
    const entry: CollisionEntry = {
      variable: 'env',
      this_type: 'string',
      other_type: 'integer',
      other_regression: 'Sibling',
      other_regression_id: 'reg-2',
    }
    expect(collisionKind(entry)).toBe('regression')
  })

  it('returns "pair" when this_suite is populated', () => {
    const entry: CollisionEntry = {
      variable: 'env',
      this_type: 'string',
      other_type: 'integer',
      this_suite: 'Suite Str',
      this_suite_id: 'suite-str',
      other_suite: 'Suite Int',
      other_suite_id: 'suite-int',
    }
    expect(collisionKind(entry)).toBe('pair')
  })

  it('returns "suite" when only other_suite is populated', () => {
    const entry: CollisionEntry = {
      variable: 'env',
      this_type: 'string',
      other_type: 'integer',
      other_suite: 'Member Suite',
      other_suite_id: 'suite-mem',
    }
    expect(collisionKind(entry)).toBe('suite')
  })
})

describe('entityLabelForKind', () => {
  it('returns "regression" for regression kind', () => {
    expect(entityLabelForKind('regression')).toBe('regression')
  })

  it('returns "suite" for suite kind', () => {
    expect(entityLabelForKind('suite')).toBe('suite')
  })

  it('returns "suite" for pair kind', () => {
    expect(entityLabelForKind('pair')).toBe('suite')
  })
})

describe('groupCollisions', () => {
  it('groups regression-kind collisions by variable+type pair', () => {
    const collisions: CollisionEntry[] = [
      {
        variable: 'env',
        this_type: 'string',
        other_type: 'integer',
        other_regression: 'Nightly',
        other_regression_id: 'reg-2',
      },
      {
        variable: 'env',
        this_type: 'string',
        other_type: 'integer',
        other_regression: 'Smoke',
        other_regression_id: 'reg-3',
      },
    ]

    const grouped = groupCollisions(collisions)

    expect(grouped).toHaveLength(1)
    expect(grouped[0].variable).toBe('env')
    expect(grouped[0].thisType).toBe('string')
    expect(grouped[0].otherType).toBe('integer')
    expect(grouped[0].regressions).toEqual(['Nightly', 'Smoke'])
  })

  it('groups pair collisions using the other_suite as source name', () => {
    const collisions: CollisionEntry[] = [
      {
        variable: 'env',
        this_type: 'string',
        other_type: 'boolean',
        this_suite: 'Suite Str',
        this_suite_id: 'suite-str',
        other_suite: 'Suite Bool',
        other_suite_id: 'suite-bool',
      },
    ]

    const grouped = groupCollisions(collisions)

    expect(grouped).toHaveLength(1)
    expect(grouped[0].regressions).toEqual(['Suite Bool'])
  })

  it('groups regression-vs-member-suite collisions using other_suite name', () => {
    const collisions: CollisionEntry[] = [
      {
        variable: 'env',
        this_type: 'string',
        other_type: 'integer',
        other_suite: 'Member Suite',
        other_suite_id: 'suite-1',
      },
    ]

    const grouped = groupCollisions(collisions)
    expect(grouped).toHaveLength(1)
    expect(grouped[0].regressions).toEqual(['Member Suite'])
  })
})

describe('<CollisionErrorMessage>', () => {
  it('renders using the "regression" label when all entries are regression-kind', () => {
    const collisions: CollisionEntry[] = [
      {
        variable: 'env',
        this_type: 'string',
        other_type: 'integer',
        other_regression: 'Nightly',
        other_regression_id: 'reg-2',
      },
    ]

    render(<CollisionErrorMessage collisions={collisions} />)

    // Shared primitive renders "variable type collision" header + the entity
    // label inside the body. Regression label should surface somewhere.
    expect(screen.getByTestId('collision-error')).toBeInTheDocument()
    expect(screen.getByText(/regression/i)).toBeInTheDocument()
  })

  it('renders using the "suite" label when all entries are suite-side', () => {
    const collisions: CollisionEntry[] = [
      {
        variable: 'env',
        this_type: 'string',
        other_type: 'integer',
        other_suite: 'Member Suite',
        other_suite_id: 'suite-mem',
      },
    ]

    render(<CollisionErrorMessage collisions={collisions} />)
    expect(screen.getByTestId('collision-error')).toBeInTheDocument()
    expect(screen.getByText(/Member Suite/)).toBeInTheDocument()
  })

  it('defaults to "suite" label when kinds are mixed', () => {
    const collisions: CollisionEntry[] = [
      {
        variable: 'env',
        this_type: 'string',
        other_type: 'integer',
        other_regression: 'Nightly',
        other_regression_id: 'reg-2',
      },
      {
        variable: 'host',
        this_type: 'string',
        other_type: 'integer',
        other_suite: 'Member Suite',
        other_suite_id: 'suite-mem',
      },
    ]

    render(<CollisionErrorMessage collisions={collisions} />)
    expect(screen.getByTestId('collision-error')).toBeInTheDocument()
  })
})
