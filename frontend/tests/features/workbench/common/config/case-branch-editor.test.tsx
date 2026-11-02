/**
 * CaseBranchEditor Tests
 *
 * Locks the Switch/Case configuration editor contract: stacked CASE cards with a
 * Break switch in the header, an optional trailing DEFAULT card, equal treatment
 * of every case, and stable branch ids across rename and reorder.
 *
 * Design Reference:
 * SWITCH-2, SWITCH-3, SWITCH-4, SWITCH-8, SWITCH-9, SWITCH-10. REQ-3.5.1.20.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock AssertionBuilder to avoid rendering the full assertion builder
vi.mock('@/features/workbench/common/config/assertion-builder', () => ({
  AssertionBuilder: (props: {
    assertions: unknown[]
    availableVariables: unknown[]
    onAssertionsChange: (v: unknown[]) => void
    onValidChange?: (v: boolean) => void
  }) => {
    return (
      <div data-testid="assertion-builder-mock">
        <span data-testid="mock-assertion-count">{props.assertions.length}</span>
        <button
          data-testid="mock-add-assertion"
          onClick={() =>
            props.onAssertionsChange([
              {
                id: 'a1',
                type: 'literal',
                variable: 'x',
                value_type: 'integer',
                operator: 'equals',
                reference_value: 1,
                reference_is_expression: false,
              },
            ])
          }
        >
          AddAssertion
        </button>
      </div>
    )
  },
}))

// Import after mocks
import {
  CaseBranchEditor,
  type CaseBranch,
} from '@/features/workbench/common/config/case-branch-editor'

describe('CaseBranchEditor', () => {
  let onBranchesChange: ReturnType<typeof vi.fn>
  let onValidChange: ReturnType<typeof vi.fn>
  const defaultVars = [{ name: 'myVar', type: 'string' }]
  const conditions: NonNullable<CaseBranch['conditions']> = [
    {
      id: 'a1',
      type: 'literal',
      variable: 'x',
      value_type: 'integer',
      operator: 'equals',
      reference_value: 1,
      reference_is_expression: false,
    },
  ]
  const operatorOnly: NonNullable<CaseBranch['conditions']> = [
    { type: 'operator', value: 'and' },
  ]
  /** A literal row that never names a variable - the half-built case. */
  const unboundCondition: NonNullable<CaseBranch['conditions']> = [
    {
      id: 'a1',
      type: 'literal',
      variable: '',
      value_type: 'integer',
      operator: 'equals',
      reference_value: 1,
      reference_is_expression: false,
    },
  ]

  beforeEach(() => {
    onBranchesChange = vi.fn()
    onValidChange = vi.fn()
  })

  function renderEditor(branches: CaseBranch[]) {
    return render(
      <CaseBranchEditor
        branches={branches}
        availableVariables={defaultVars}
        onBranchesChange={onBranchesChange}
        onValidChange={onValidChange}
      />
    )
  }

  function lastBranches(): CaseBranch[] {
    return onBranchesChange.mock.calls[onBranchesChange.mock.calls.length - 1][0]
  }

  describe('Fresh state', () => {
    it('renders one expanded case card when branches is empty', () => {
      renderEditor([])

      expect(screen.getByTestId('case-card-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('case-body-branch_0')).toBeInTheDocument()
    })

    it('pushes the seeded single case upward on mount', () => {
      renderEditor([])

      expect(onBranchesChange).toHaveBeenCalledWith([
        { id: 'branch_0', type: 'case', label: '', conditions: [], break: true },
      ])
    })

    it('turns break on for the seeded case', () => {
      renderEditor([])

      expect(screen.getByTestId('case-break-branch_0')).toBeChecked()
    })

    it('renders no default card when branches is empty', () => {
      renderEditor([])

      expect(screen.queryByTestId('default-card-branch_1')).not.toBeInTheDocument()
    })
  })

  describe('Type badges', () => {
    it('shows CASE badge for a case branch', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      expect(screen.getByTestId('case-badge-branch_0')).toHaveTextContent('CASE')
    })

    // Guard: the variant class must land on the badge, not on a shell wrapper.
    it('uses the warning badge variant for a case branch', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      expect(screen.getByTestId('case-badge-branch_0').className).toContain('badge-warning')
    })

    it('shows DEFAULT badge for the default branch', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      expect(screen.getByTestId('default-badge-branch_1')).toHaveTextContent('DEFAULT')
    })

    it('uses the default badge variant for the default branch', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      expect(screen.getByTestId('default-badge-branch_1').className).toContain('badge-default')
    })
  })

  describe('Break switch', () => {
    it('renders a break switch in the header of every case card', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: false },
      ])

      expect(
        within(screen.getByTestId('case-header-branch_0')).getByTestId('case-break-branch_0')
      ).toBeInTheDocument()
      expect(
        within(screen.getByTestId('case-header-branch_1')).getByTestId('case-break-branch_1')
      ).toBeInTheDocument()
    })

    it('renders no break switch on the default card', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      const defaultCard = screen.getByTestId('default-card-branch_1')
      expect(within(defaultCard).queryByRole('switch')).not.toBeInTheDocument()
      expect(screen.queryByTestId('case-break-branch_1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('default-break-branch_1')).not.toBeInTheDocument()
    })

    it('keeps the break switch visible while the card is collapsed', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      await user.click(screen.getByTestId('case-toggle-branch_0'))

      expect(screen.queryByTestId('case-body-branch_0')).not.toBeInTheDocument()
      expect(screen.getByTestId('case-break-branch_0')).toBeInTheDocument()
    })

    it('checks the break switch when break is true', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      expect(screen.getByTestId('case-break-branch_0')).toBeChecked()
    })

    it('checks the break switch when break is undefined', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions }])

      expect(screen.getByTestId('case-break-branch_0')).toBeChecked()
    })

    it('unchecks the break switch when break is false', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: false }])

      expect(screen.getByTestId('case-break-branch_0')).not.toBeChecked()
    })

    it('emits break false when a break-on case is toggled', async () => {
      const user = userEvent.setup()
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
      ])

      await user.click(screen.getByTestId('case-break-branch_1'))

      const next = lastBranches()
      expect(next[0].break).toBe(true)
      expect(next[1].break).toBe(false)
      expect(next[1].id).toBe('branch_1')
    })

    it('emits break true when a break-off case is toggled', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: false }])

      await user.click(screen.getByTestId('case-break-branch_0'))

      expect(lastBranches()[0].break).toBe(true)
    })

    // Guard: flipping Break never collapses its own card.
    it('keeps an expanded case expanded when break is toggled', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      await user.click(screen.getByTestId('case-break-branch_0'))

      expect(lastBranches()[0].break).toBe(false)
      expect(screen.getByTestId('case-body-branch_0')).toBeInTheDocument()
    })

    it('keeps a collapsed case collapsed when break is toggled', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      await user.click(screen.getByTestId('case-toggle-branch_0'))
      await user.click(screen.getByTestId('case-break-branch_0'))

      expect(lastBranches()[0].break).toBe(false)
      expect(screen.queryByTestId('case-body-branch_0')).not.toBeInTheDocument()
    })

    it('labels the break switch for assistive tech', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      expect(screen.getByTestId('case-break-branch_0')).toHaveAttribute('aria-label', 'Break')
      expect(
        within(screen.getByTestId('case-header-branch_0')).getByText('Break')
      ).toBeInTheDocument()
    })

    it('toggles the break switch with the keyboard', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      const breakSwitch = screen.getByTestId('case-break-branch_0')
      breakSwitch.focus()
      await user.keyboard(' ')

      expect(lastBranches()[0].break).toBe(false)
    })
  })

  describe('Add branches', () => {
    it('renders the case and default add buttons in order', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      const addCase = screen.getByTestId('add-case-button')
      const addDefault = screen.getByTestId('add-default-button')
      expect(addCase).toHaveTextContent('Case')
      expect(addDefault).toHaveTextContent('Default')
      expect(
        addCase.compareDocumentPosition(addDefault) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeGreaterThan(0)
    })

    it('appends a new case with break on and empty conditions', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      await user.click(screen.getByTestId('add-case-button'))

      const next = lastBranches()
      expect(next).toHaveLength(2)
      expect(next[1]).toEqual({
        id: 'branch_1',
        type: 'case',
        label: '',
        conditions: [],
        break: true,
      })
    })

    it('numbers the first added case after the self-seeded case', async () => {
      const user = userEvent.setup()
      renderEditor([])

      await user.click(screen.getByTestId('add-case-button'))

      const next = lastBranches()
      expect(next.map((b) => b.id)).toEqual(['branch_0', 'branch_1'])
      expect(next[1]).toEqual({
        id: 'branch_1',
        type: 'case',
        label: '',
        conditions: [],
        break: true,
      })
    })

    it('inserts a new case before the default', async () => {
      const user = userEvent.setup()
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      await user.click(screen.getByTestId('add-case-button'))

      const next = lastBranches()
      expect(next.map((b) => b.id)).toEqual(['branch_0', 'branch_2', 'branch_1'])
      expect(next[1]).toEqual({
        id: 'branch_2',
        type: 'case',
        label: '',
        conditions: [],
        break: true,
      })
      expect(next[2].type).toBe('default')
    })

    it('appends the default last', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      await user.click(screen.getByTestId('add-default-button'))

      const next = lastBranches()
      expect(next).toHaveLength(2)
      expect(next[1]).toEqual({ id: 'branch_1', type: 'default', label: '' })
    })

    it('disables the add-default button when a default exists', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      expect(screen.getByTestId('add-default-button')).toBeDisabled()
    })

    it('enables the add-default button when no default exists', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      expect(screen.getByTestId('add-default-button')).not.toBeDisabled()
    })

    it('styles the disabled add-default button as unavailable', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      const addDefault = screen.getByTestId('add-default-button')
      expect(addDefault.className).toContain('opacity-50')
      expect(addDefault.className).toContain('cursor-not-allowed')
    })
  })

  describe('Reorder cases', () => {
    it('renders reorder buttons on every case', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
      ])

      expect(screen.getByTestId('case-move-up-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('case-move-down-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('case-move-up-branch_1')).toBeInTheDocument()
      expect(screen.getByTestId('case-move-down-branch_1')).toBeInTheDocument()
    })

    it('labels the reorder buttons with the case noun', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
      ])

      expect(screen.getByTestId('case-move-up-branch_0')).toHaveAttribute(
        'aria-label',
        'Move case up'
      )
      expect(screen.getByTestId('case-move-down-branch_0')).toHaveAttribute(
        'aria-label',
        'Move case down'
      )
      expect(screen.getByTestId('case-move-up-branch_1')).toHaveAttribute(
        'aria-label',
        'Move case up'
      )
      expect(screen.getByTestId('case-move-down-branch_1')).toHaveAttribute(
        'aria-label',
        'Move case down'
      )
    })

    it('disables move up on the first case', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
      ])

      expect(screen.getByTestId('case-move-up-branch_0')).toBeDisabled()
      expect(screen.getByTestId('case-move-up-branch_1')).not.toBeDisabled()
    })

    it('disables move down on the last case', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
      ])

      expect(screen.getByTestId('case-move-down-branch_1')).toBeDisabled()
      expect(screen.getByTestId('case-move-down-branch_0')).not.toBeDisabled()
    })

    it('never lets a case move past the default', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
        { id: 'branch_2', type: 'default', label: '' },
      ])

      expect(screen.getByTestId('case-move-down-branch_1')).toBeDisabled()
      expect(screen.getByTestId('case-move-down-branch_0')).not.toBeDisabled()
    })

    it('renders no reorder buttons on the default card', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      expect(screen.queryByTestId('default-move-up-branch_1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('default-move-down-branch_1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('case-move-up-branch_1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('case-move-down-branch_1')).not.toBeInTheDocument()
    })

    it('emits the reordered array on move down', async () => {
      const user = userEvent.setup()
      renderEditor([
        { id: 'branch_0', type: 'case', label: 'first', conditions, break: true },
        { id: 'branch_1', type: 'case', label: 'second', conditions, break: false },
      ])

      await user.click(screen.getByTestId('case-move-down-branch_0'))

      const next = lastBranches()
      expect(next.map((b) => b.id)).toEqual(['branch_1', 'branch_0'])
      expect(next.map((b) => b.label)).toEqual(['second', 'first'])
    })

    it('emits the reordered array on move up', async () => {
      const user = userEvent.setup()
      renderEditor([
        { id: 'branch_0', type: 'case', label: 'first', conditions, break: true },
        { id: 'branch_1', type: 'case', label: 'second', conditions, break: false },
      ])

      await user.click(screen.getByTestId('case-move-up-branch_1'))

      const next = lastBranches()
      expect(next.map((b) => b.id)).toEqual(['branch_1', 'branch_0'])
      expect(next[0].break).toBe(false)
      expect(next[1].break).toBe(true)
    })
  })

  describe('Delete branches', () => {
    it('renders a delete button on every card', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
        { id: 'branch_2', type: 'default', label: '' },
      ])

      expect(screen.getByTestId('case-delete-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('case-delete-branch_1')).toBeInTheDocument()
      expect(screen.getByTestId('default-delete-branch_2')).toBeInTheDocument()
    })

    // Guard: case and default cards do not inherit the branch aria noun.
    it('labels each delete button with its own card noun', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
        { id: 'branch_2', type: 'default', label: '' },
      ])

      expect(screen.getByTestId('case-delete-branch_0')).toHaveAttribute(
        'aria-label',
        'Delete case'
      )
      expect(screen.getByTestId('case-delete-branch_1')).toHaveAttribute(
        'aria-label',
        'Delete case'
      )
      expect(screen.getByTestId('default-delete-branch_2')).toHaveAttribute(
        'aria-label',
        'Delete default'
      )
    })

    it('disables delete on the only case', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      expect(screen.getByTestId('case-delete-branch_0')).toBeDisabled()
      expect(screen.getByTestId('default-delete-branch_1')).not.toBeDisabled()
    })

    it('enables delete once a second case exists', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
      ])

      expect(screen.getByTestId('case-delete-branch_0')).not.toBeDisabled()
      expect(screen.getByTestId('case-delete-branch_1')).not.toBeDisabled()
    })

    it('emits the filtered array when a case is deleted', async () => {
      const user = userEvent.setup()
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
        { id: 'branch_2', type: 'default', label: '' },
      ])

      await user.click(screen.getByTestId('case-delete-branch_1'))

      expect(lastBranches().map((b) => b.id)).toEqual(['branch_0', 'branch_2'])
    })

    it('re-enables the add-default button after the default is deleted', async () => {
      const user = userEvent.setup()
      const { rerender } = renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      await user.click(screen.getByTestId('default-delete-branch_1'))

      const next = lastBranches()
      expect(next.map((b) => b.id)).toEqual(['branch_0'])

      rerender(
        <CaseBranchEditor
          branches={next}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('add-default-button')).not.toBeDisabled()
    })
  })

  describe('Default card body', () => {
    it('renders the no-match explanation on the default card', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      // The default is also the last stop of the fall-through chain, so the
      // caption must not claim it only runs when nothing matched.
      expect(
        within(screen.getByTestId('default-body-branch_1')).getByText(
          'Runs when no case matched, or when a case above falls through'
        )
      ).toBeInTheDocument()
    })

    it('renders no assertion builder on the default card', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      expect(
        within(screen.getByTestId('default-card-branch_1')).queryByTestId('assertion-builder-mock')
      ).not.toBeInTheDocument()
      expect(screen.getAllByTestId('assertion-builder-mock')).toHaveLength(1)
    })

    it('renders an assertion builder in every case body', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: true },
      ])

      expect(screen.getAllByTestId('assertion-builder-mock')).toHaveLength(2)
    })

    it('passes an empty assertion list when a case has no conditions', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', break: true }])

      expect(screen.getByTestId('mock-assertion-count')).toHaveTextContent('0')
    })
  })

  describe('Assertion changes', () => {
    it('updates the case conditions when the assertion builder changes', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions: [], break: true }])

      await user.click(screen.getByTestId('mock-add-assertion'))

      expect(onBranchesChange).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'branch_0',
          break: true,
          conditions: [expect.objectContaining({ id: 'a1', type: 'literal' })],
        }),
      ])
    })
  })

  describe('Validation', () => {
    it('reports invalid when a case has no conditions', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions: [], break: true }])

      expect(onValidChange).toHaveBeenCalledWith(false)
    })

    it('reports invalid when a case has only operator items', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions: operatorOnly, break: true },
      ])

      expect(onValidChange).toHaveBeenCalledWith(false)
    })

    it('reports invalid when a case has undefined conditions', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', break: true }])

      expect(onValidChange).toHaveBeenCalledWith(false)
    })

    it('reports invalid when one of several cases has no conditions', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions: [], break: true },
      ])

      expect(onValidChange).toHaveBeenCalledWith(false)
    })

    it('marks a case with no assertions so a collapsed card still explains the block', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions: [], break: true }])
      expect(screen.getByTestId('case-alert-branch_0')).toBeInTheDocument()
    })

    it('marks a case whose assertion is half-built', () => {
      renderEditor([
        {
          id: 'branch_0',
          type: 'case',
          label: '',
          break: true,
          conditions: unboundCondition,
        },
      ])
      expect(screen.getByTestId('case-alert-branch_0')).toBeInTheDocument()
    })

    it('leaves a complete case unmarked, and never marks the default', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])
      expect(screen.queryByTestId('case-alert-branch_0')).not.toBeInTheDocument()
      expect(screen.queryByTestId('default-alert-branch_1')).not.toBeInTheDocument()
    })

    it('reports invalid when a case condition names no variable', () => {
      // A half-built row does not count as a condition.
      renderEditor([
        {
          id: 'branch_0',
          type: 'case',
          label: '',
          break: true,
          conditions: unboundCondition,
        },
      ])
      expect(onValidChange).toHaveBeenLastCalledWith(false)
    })

    it('reports invalid when a case carries an empty expression row', () => {
      renderEditor([
        {
          id: 'branch_0',
          type: 'case',
          label: '',
          break: true,
          conditions: [{ id: 'e1', type: 'expression', expression: '' }],
        },
      ])
      expect(onValidChange).toHaveBeenLastCalledWith(false)
    })

    it('reports valid when every case has a non-operator item', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'case', label: '', conditions, break: false },
      ])

      expect(onValidChange).toHaveBeenCalledWith(true)
    })

    it('ignores the default when computing validity', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      expect(onValidChange).toHaveBeenCalledWith(true)
      expect(onValidChange).not.toHaveBeenCalledWith(false)
    })
  })

  describe('Labels and stable ids', () => {
    it('renders the label input with the current value', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: 'Slow path', conditions, break: true },
      ])

      const input = screen.getByTestId('case-label-branch_0') as HTMLInputElement
      expect(input.value).toBe('Slow path')
    })

    it('emits the updated label when a case is renamed', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      await user.type(screen.getByTestId('case-label-branch_0'), 'X')

      const next = lastBranches()
      expect(next[0].label).toBe('X')
      expect(next[0].id).toBe('branch_0')
      expect(next[0].break).toBe(true)
    })

    it('keeps branch ids unchanged when cases are reordered', async () => {
      const user = userEvent.setup()
      renderEditor([
        { id: 'branch_5', type: 'case', label: 'a', conditions, break: true },
        { id: 'branch_2', type: 'case', label: 'b', conditions, break: true },
        { id: 'branch_9', type: 'default', label: '' },
      ])

      await user.click(screen.getByTestId('case-move-down-branch_5'))

      expect(lastBranches().map((b) => b.id)).toEqual(['branch_2', 'branch_5', 'branch_9'])
    })
  })

  describe('Fall-through annotation', () => {
    it('renders no fall-through note on an expanded break-off case', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: false }])

      expect(screen.queryByText(/fall/i)).not.toBeInTheDocument()
    })

    it('renders no extra line on a collapsed break-off case', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: false }])

      await user.click(screen.getByTestId('case-toggle-branch_0'))

      const card = screen.getByTestId('case-card-branch_0')
      expect(screen.queryByTestId('case-body-branch_0')).not.toBeInTheDocument()
      expect(within(card).queryByText(/fall/i)).not.toBeInTheDocument()
      expect(card.querySelectorAll('p')).toHaveLength(0)
    })
  })

  describe('Test id families', () => {
    it('renders the editor root', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      expect(screen.getByTestId('case-branch-editor')).toBeInTheDocument()
    })

    it('uses the case testid family for case cards', () => {
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      expect(screen.getByTestId('case-card-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('case-header-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('case-toggle-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('case-badge-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('case-label-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('case-body-branch_0')).toBeInTheDocument()
      expect(screen.queryByTestId('default-card-branch_0')).not.toBeInTheDocument()
    })

    it('uses the default testid family for the default card', () => {
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      expect(screen.getByTestId('default-card-branch_1')).toBeInTheDocument()
      expect(screen.getByTestId('default-header-branch_1')).toBeInTheDocument()
      expect(screen.getByTestId('default-toggle-branch_1')).toBeInTheDocument()
      expect(screen.getByTestId('default-badge-branch_1')).toBeInTheDocument()
      expect(screen.getByTestId('default-label-branch_1')).toBeInTheDocument()
      expect(screen.getByTestId('default-body-branch_1')).toBeInTheDocument()
      expect(screen.queryByTestId('case-card-branch_1')).not.toBeInTheDocument()
    })
  })

  describe('Aria nouns', () => {
    it('labels the case chevron with the case noun', async () => {
      const user = userEvent.setup()
      renderEditor([{ id: 'branch_0', type: 'case', label: '', conditions, break: true }])

      expect(screen.getByTestId('case-toggle-branch_0')).toHaveAttribute(
        'aria-label',
        'Collapse case'
      )

      await user.click(screen.getByTestId('case-toggle-branch_0'))

      expect(screen.getByTestId('case-toggle-branch_0')).toHaveAttribute(
        'aria-label',
        'Expand case'
      )
    })

    it('labels the default chevron with the default noun', async () => {
      const user = userEvent.setup()
      renderEditor([
        { id: 'branch_0', type: 'case', label: '', conditions, break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])

      expect(screen.getByTestId('default-toggle-branch_1')).toHaveAttribute(
        'aria-label',
        'Collapse default'
      )

      await user.click(screen.getByTestId('default-toggle-branch_1'))

      expect(screen.getByTestId('default-toggle-branch_1')).toHaveAttribute(
        'aria-label',
        'Expand default'
      )
    })
  })
})
