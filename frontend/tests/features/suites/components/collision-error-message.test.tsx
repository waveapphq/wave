/**
 * CollisionErrorMessage Tests
 *
 * Tests for grouped collision error display with popover for multiple suites.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  CollisionErrorMessage,
  groupCollisions,
  type CollisionEntry,
} from '@/features/suites/components/collision-error-message'

function makeCollision(
  variable: string,
  thisType: string,
  otherSuite: string,
  otherType: string,
): CollisionEntry {
  return {
    variable,
    this_type: thisType,
    other_suite: otherSuite,
    other_suite_id: `id-${otherSuite}`,
    other_type: otherType,
  }
}

describe('CollisionErrorMessage', () => {
  it('renders single collision with suite name directly', () => {
    const collisions = [makeCollision('env', 'float', 'TestSuite', 'string')]

    render(<CollisionErrorMessage collisions={collisions} />)

    expect(screen.getByText('Variable type collision')).toBeInTheDocument()
    expect(screen.getByText('env')).toBeInTheDocument()
    expect(screen.getByText('float')).toBeInTheDocument()
    expect(screen.getByText('string')).toBeInTheDocument()
    expect(screen.getByText('TestSuite')).toBeInTheDocument()
  })

  it('groups same variable+type across multiple suites into popover', () => {
    const collisions = [
      makeCollision('env', 'float', 'SuiteA', 'string'),
      makeCollision('env', 'float', 'SuiteB', 'string'),
      makeCollision('env', 'float', 'SuiteC', 'string'),
    ]

    render(<CollisionErrorMessage collisions={collisions} />)

    // Should show "3 suites" trigger, not individual names
    const trigger = screen.getByTestId('collision-suites-trigger')
    expect(trigger).toHaveTextContent('3 suites')

    // Click to open popover
    fireEvent.click(trigger)

    // Popover should show all suite names
    expect(screen.getByText('SuiteA')).toBeInTheDocument()
    expect(screen.getByText('SuiteB')).toBeInTheDocument()
    expect(screen.getByText('SuiteC')).toBeInTheDocument()
  })

  it('renders multiple variable groups separately', () => {
    const collisions = [
      makeCollision('env', 'float', 'SuiteA', 'string'),
      makeCollision('timeout', 'string', 'SuiteA', 'integer'),
    ]

    render(<CollisionErrorMessage collisions={collisions} />)

    expect(screen.getByText('env')).toBeInTheDocument()
    expect(screen.getByText('timeout')).toBeInTheDocument()
  })

  it('deduplicates same suite appearing multiple times', () => {
    const collisions = [
      makeCollision('env', 'float', 'SuiteA', 'string'),
      makeCollision('env', 'float', 'SuiteA', 'string'),
    ]

    render(<CollisionErrorMessage collisions={collisions} />)

    // Single suite - shows name directly, not popover
    expect(screen.getByText('SuiteA')).toBeInTheDocument()
    expect(screen.queryByTestId('collision-suites-trigger')).not.toBeInTheDocument()
  })
})

describe('groupCollisions', () => {
  it('merges multiple suites with the same variable+type into one group', () => {
    const collisions: CollisionEntry[] = [
      makeCollision('env', 'float', 'SuiteA', 'string'),
      makeCollision('env', 'float', 'SuiteB', 'string'),
    ]

    const grouped = groupCollisions(collisions)

    expect(grouped).toHaveLength(1)
    expect(grouped[0].variable).toBe('env')
    expect(grouped[0].thisType).toBe('float')
    expect(grouped[0].otherType).toBe('string')
    expect(grouped[0].suites).toEqual(expect.arrayContaining(['SuiteA', 'SuiteB']))
  })

  it('keeps separate groups for different variable names', () => {
    const collisions: CollisionEntry[] = [
      makeCollision('env', 'float', 'SuiteA', 'string'),
      makeCollision('timeout', 'string', 'SuiteA', 'integer'),
    ]

    const grouped = groupCollisions(collisions)

    expect(grouped).toHaveLength(2)
    const envGroup = grouped.find((g) => g.variable === 'env')
    const timeoutGroup = grouped.find((g) => g.variable === 'timeout')
    expect(envGroup).toBeDefined()
    expect(timeoutGroup).toBeDefined()
  })

  it('returns empty array for empty input', () => {
    expect(groupCollisions([])).toEqual([])
  })
})
