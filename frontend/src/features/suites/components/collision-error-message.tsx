import type { ReactNode } from 'react'
import {
  CollisionErrorMessage as SharedCollisionErrorMessage,
  groupCollisions as sharedGroupCollisions,
  type CollisionEntry as SharedCollisionEntry,
  type GroupedCollision as SharedGroupedCollision,
} from '@/components/shared/collision-error-message'

export interface CollisionEntry {
  variable: string
  this_type: string
  other_suite: string
  other_suite_id: string
  other_type: string
}

export interface GroupedCollision {
  variable: string
  thisType: string
  otherType: string
  suites: string[]
}

function toSharedEntries(collisions: CollisionEntry[]): SharedCollisionEntry[] {
  return collisions.map((c) => ({
    variable: c.variable,
    this_type: c.this_type,
    other_name: c.other_suite,
    other_id: c.other_suite_id,
    other_type: c.other_type,
  }))
}

export function groupCollisions(collisions: CollisionEntry[]): GroupedCollision[] {
  const shared = sharedGroupCollisions(toSharedEntries(collisions))
  return shared.map((g: SharedGroupedCollision) => ({
    variable: g.variable,
    thisType: g.thisType,
    otherType: g.otherType,
    suites: g.sources,
  }))
}

export function CollisionErrorMessage({
  collisions,
}: Readonly<{ collisions: CollisionEntry[] }>): ReactNode {
  return (
    <SharedCollisionErrorMessage
      collisions={toSharedEntries(collisions)}
      entityLabel="suite"
      testIdPrefix="suites"
    />
  )
}
