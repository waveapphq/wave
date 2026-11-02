import type { ReactNode } from 'react'
import {
  CollisionErrorMessage as SharedCollisionErrorMessage,
  groupCollisions as sharedGroupCollisions,
  type CollisionEntry as SharedCollisionEntry,
  type GroupedCollision as SharedGroupedCollision,
} from '@/components/shared/collision-error-message'

/**
 * The backend raises three collision shapes for regressions:
 *
 * 1. Regression-vs-other-regression (sibling regressions sharing suites):
 *    `{ variable, this_type, other_type, other_regression, other_regression_id }`
 * 2. Regression-vs-member-suite (regression var conflicts with a suite var):
 *    `{ variable, this_type, other_type, other_suite, other_suite_id }`
 * 3. Suite-pair inside the regression (two member suites disagree):
 *    `{ variable, this_type, other_type, this_suite, this_suite_id,
 *       other_suite, other_suite_id }`
 *
 * This type is a loose union over all three. Consumers pick fields via the
 * `toSharedEntries` helper which normalizes to `other_name`/`other_id`.
 */
export interface CollisionEntry {
  variable: string
  this_type: string
  other_type: string
  other_regression?: string
  other_regression_id?: string
  this_suite?: string
  this_suite_id?: string
  other_suite?: string
  other_suite_id?: string
}

export type CollisionKind = 'regression' | 'suite' | 'pair'

export interface GroupedCollision {
  variable: string
  thisType: string
  otherType: string
  regressions: string[]
}

/**
 * Determine the collision kind by looking at which side fields are populated.
 *
 * - If `other_regression` is set → sibling-regression conflict.
 * - If `this_suite` is set → suite pair inside the same regression.
 * - Otherwise → regression-vs-member-suite.
 */
export function collisionKind(c: CollisionEntry): CollisionKind {
  if (c.other_regression) return 'regression'
  if (c.this_suite) return 'pair'
  return 'suite'
}

function toSharedEntries(collisions: CollisionEntry[]): SharedCollisionEntry[] {
  return collisions.map((c) => {
    const kind = collisionKind(c)
    if (kind === 'regression') {
      // ``collisionKind`` already verified ``other_regression`` is truthy; the
      // paired ``_id`` field is always emitted alongside by the backend.
      return {
        variable: c.variable,
        this_type: c.this_type,
        other_type: c.other_type,
        other_name: c.other_regression as string,
        other_id: c.other_regression_id as string,
      }
    }
    // Both 'pair' and 'suite' surface the other suite as the source. The
    // backend always emits ``other_suite`` + ``other_suite_id`` together
    // for these kinds.
    return {
      variable: c.variable,
      this_type: c.this_type,
      other_type: c.other_type,
      other_name: c.other_suite as string,
      other_id: c.other_suite_id as string,
    }
  })
}

export function groupCollisions(collisions: CollisionEntry[]): GroupedCollision[] {
  const shared = sharedGroupCollisions(toSharedEntries(collisions))
  return shared.map((g: SharedGroupedCollision) => ({
    variable: g.variable,
    thisType: g.thisType,
    otherType: g.otherType,
    regressions: g.sources,
  }))
}

/**
 * Label to use in the human-readable error message for a given kind.
 * The shared primitive takes a single label, so callers pass one per kind.
 */
export function entityLabelForKind(kind: CollisionKind): string {
  return kind === 'regression' ? 'regression' : 'suite'
}

export function CollisionErrorMessage({
  collisions,
}: Readonly<{ collisions: CollisionEntry[] }>): ReactNode {
  // If all entries share the same kind, use a single label. Otherwise default
  // to "suite" since both pair and reg-vs-suite talk about suites.
  const kinds = new Set(collisions.map(collisionKind))
  const label = kinds.size === 1 ? entityLabelForKind([...kinds][0]) : 'suite'
  return (
    <SharedCollisionErrorMessage
      collisions={toSharedEntries(collisions)}
      entityLabel={label}
      testIdPrefix="regressions"
    />
  )
}
