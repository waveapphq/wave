/**
 * CollisionResolutionModal Tests
 *
 * Tests for the shared collision resolution modal with Fix/Cancel actions.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  CollisionResolutionModal,
  type GroupedCollision,
} from '@/components/shared/dialogs/collision-resolution-modal'

function makeConflicts(overrides?: GroupedCollision[]): GroupedCollision[] {
  return overrides ?? [
    {
      variable: 'env',
      thisType: 'float',
      otherType: 'string',
      entities: ['SuiteA'],
    },
  ]
}

describe('CollisionResolutionModal', () => {
  it('renders collision details', () => {
    render(
      <CollisionResolutionModal
        open
        onClose={vi.fn()}
        description="Adding this test would cause a variable type conflict."
        entityLabel="suite"
        conflicts={makeConflicts()}
      />
    )

    expect(screen.getByText(/variable type collision/i)).toBeInTheDocument()
    expect(screen.getByText('env')).toBeInTheDocument()
  })

  it('calls onClose when Cancel button clicked', () => {
    const onClose = vi.fn()

    render(
      <CollisionResolutionModal
        open
        onClose={onClose}
        description="Conflict detected."
        entityLabel="suite"
        conflicts={makeConflicts()}
      />
    )

    fireEvent.click(screen.getByTestId('collision-cancel'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls fixAction.onFix when Fix button clicked', () => {
    const onFix = vi.fn()

    render(
      <CollisionResolutionModal
        open
        onClose={vi.fn()}
        description="Conflict detected."
        entityLabel="suite"
        conflicts={makeConflicts()}
        fixAction={{
          buttonLabel: 'Remove tests',
          items: [
            { id: 't1', name: 'Login Test' },
            { id: 't2', name: 'Logout Test' },
          ],
          onFix,
        }}
      />
    )

    fireEvent.click(screen.getByTestId('collision-fix'))

    expect(onFix).toHaveBeenCalledWith(['t1', 't2'])
  })

  it('shows fix button with custom label', () => {
    render(
      <CollisionResolutionModal
        open
        onClose={vi.fn()}
        description="Conflict detected."
        entityLabel="suite"
        conflicts={makeConflicts()}
        fixAction={{
          buttonLabel: 'Remove tests',
          items: [
            { id: 't1', name: 'Login Test' },
            { id: 't2', name: 'Logout Test' },
          ],
          onFix: vi.fn(),
        }}
      />
    )

    expect(screen.getByTestId('collision-fix')).toHaveTextContent('Remove tests')
  })

  it('shows multiple entities in popover when > 1', () => {
    render(
      <CollisionResolutionModal
        open
        onClose={vi.fn()}
        description="Conflict detected."
        entityLabel="suite"
        conflicts={[{
          variable: 'env',
          thisType: 'float',
          otherType: 'string',
          entities: ['Suite A', 'Suite B'],
        }]}
      />
    )

    expect(screen.getByText('2 suites')).toBeInTheDocument()
  })
})
