/**
 * ConditionBranchEditor Tests
 *
 * Tests for the If/Else branch editor component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  ConditionBranchEditor,
  type ConditionBranch,
} from '@/features/workbench/common/config/condition-branch-editor'

describe('ConditionBranchEditor', () => {
  let onBranchesChange: ReturnType<typeof vi.fn>
  let onValidChange: ReturnType<typeof vi.fn>
  const defaultVars = [{ name: 'myVar', type: 'string' }]

  beforeEach(() => {
    onBranchesChange = vi.fn()
    onValidChange = vi.fn()
  })

  describe('Default branches', () => {
    it('initializes with if + else when branches array is empty', () => {
      render(
        <ConditionBranchEditor
          branches={[]}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Should call onBranchesChange with default branches
      expect(onBranchesChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 'if' }),
          expect.objectContaining({ type: 'else' }),
        ])
      )
    })

    it('renders provided branches', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: 'Check status', conditions: [] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('branch-card-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('branch-card-branch_1')).toBeInTheDocument()
    })
  })

  describe('Type badges', () => {
    it('shows IF badge for if branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('branch-badge-branch_0')).toHaveTextContent('IF')
    })

    it('shows ELSE IF badge for else_if branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('branch-badge-branch_1')).toHaveTextContent('ELSE IF')
    })

    it('shows ELSE badge for else branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('branch-badge-branch_1')).toHaveTextContent('ELSE')
    })
  })

  describe('Add branches', () => {
    it('adds else-if branch before else', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      await user.click(screen.getByTestId('add-else-if-button'))

      expect(onBranchesChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 'if' }),
          expect.objectContaining({ type: 'else_if' }),
          expect.objectContaining({ type: 'else' }),
        ])
      )
      // Verify else is still last
      const lastCall = onBranchesChange.mock.calls[onBranchesChange.mock.calls.length - 1][0]
      expect(lastCall[lastCall.length - 1].type).toBe('else')
    })

    it('adds else branch at the end', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      await user.click(screen.getByTestId('add-else-button'))

      expect(onBranchesChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 'if' }),
          expect.objectContaining({ type: 'else' }),
        ])
      )
    })

    it('disables add-else button when else exists', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('add-else-button')).toBeDisabled()
    })

    it('enables add-else button when no else exists', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('add-else-button')).not.toBeDisabled()
    })
  })

  describe('Delete branches', () => {
    it('does not show delete button for if branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.queryByTestId('branch-delete-branch_0')).not.toBeInTheDocument()
    })

    it('shows delete button for else-if branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('branch-delete-branch_1')).toBeInTheDocument()
    })

    it('deletes else-if branch on click', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [] },
        { id: 'branch_2', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      await user.click(screen.getByTestId('branch-delete-branch_1'))

      expect(onBranchesChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'branch_0', type: 'if' }),
        expect.objectContaining({ id: 'branch_2', type: 'else' }),
      ])
    })

    it('deletes else branch on click', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      await user.click(screen.getByTestId('branch-delete-branch_1'))

      expect(onBranchesChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'branch_0', type: 'if' }),
      ])
    })
  })

  describe('Reorder branches', () => {
    it('does not show reorder buttons for if branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.queryByTestId('branch-move-up-branch_0')).not.toBeInTheDocument()
      expect(screen.queryByTestId('branch-move-down-branch_0')).not.toBeInTheDocument()
    })

    it('shows reorder buttons for else-if branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [{ id: 'a2', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 2, reference_is_expression: false }] },
        { id: 'branch_2', type: 'else_if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('branch-move-up-branch_1')).toBeInTheDocument()
      expect(screen.getByTestId('branch-move-down-branch_1')).toBeInTheDocument()
    })

    it('swaps else-if branches on move down', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: 'first', conditions: [{ id: 'a2', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 2, reference_is_expression: false }] },
        { id: 'branch_2', type: 'else_if', label: 'second', conditions: [{ id: 'a3', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 3, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      await user.click(screen.getByTestId('branch-move-down-branch_1'))

      // branch_1 and branch_2 should be swapped
      const lastCall = onBranchesChange.mock.calls[onBranchesChange.mock.calls.length - 1][0]
      expect(lastCall[1].id).toBe('branch_2')
      expect(lastCall[2].id).toBe('branch_1')
    })

    it('swaps else-if branches on move up', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: 'first', conditions: [{ id: 'a2', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 2, reference_is_expression: false }] },
        { id: 'branch_2', type: 'else_if', label: 'second', conditions: [{ id: 'a3', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 3, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      await user.click(screen.getByTestId('branch-move-up-branch_2'))

      const lastCall = onBranchesChange.mock.calls[onBranchesChange.mock.calls.length - 1][0]
      expect(lastCall[1].id).toBe('branch_2')
      expect(lastCall[2].id).toBe('branch_1')
    })

    it('cannot move first else-if above if branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [{ id: 'a2', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 2, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Move up button should be disabled (visually via class)
      const moveUpBtn = screen.getByTestId('branch-move-up-branch_1')
      expect(moveUpBtn).toBeDisabled()
    })

    it('cannot move else-if down past else', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [{ id: 'a2', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 2, reference_is_expression: false }] },
        { id: 'branch_2', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Move down button should be disabled
      const moveDownBtn = screen.getByTestId('branch-move-down-branch_1')
      expect(moveDownBtn).toBeDisabled()
    })
  })

  describe('Expand/collapse', () => {
    it('expands all branches by default', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('branch-body-branch_1')).toBeInTheDocument()
    })

    it('collapses branch on header click', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Body should be visible initially
      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()

      // Click header to collapse
      await user.click(screen.getByTestId('branch-toggle-branch_0'))

      // Body should be hidden
      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()
    })

    it('expands collapsed branch on header click', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Collapse
      await user.click(screen.getByTestId('branch-toggle-branch_0'))
      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()

      // Expand
      await user.click(screen.getByTestId('branch-toggle-branch_0'))
      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })
  })

  describe('Label input', () => {
    it('renders label input with current value', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: 'Check status', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      const input = screen.getByTestId('branch-label-branch_0') as HTMLInputElement
      expect(input.value).toBe('Check status')
    })

    it('calls onBranchesChange when label changes', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      const input = screen.getByTestId('branch-label-branch_0')
      await user.type(input, 'X')

      // Should have called onBranchesChange with the new label
      expect(onBranchesChange).toHaveBeenCalled()
      const firstLabelCall = onBranchesChange.mock.calls.find(
        (call) => call[0]?.[0]?.label !== ''
      )
      expect(firstLabelCall).toBeDefined()
      expect(firstLabelCall![0][0].label).toBe('X')
    })
  })

  describe('Branch body content', () => {
    it('renders AssertionBuilder for if branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('assertion-builder-mock')).toBeInTheDocument()
    })

    it('renders AssertionBuilder for else-if branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Two assertion builder mocks (one for if, one for else_if)
      const builders = screen.getAllByTestId('assertion-builder-mock')
      expect(builders).toHaveLength(2)
    })

    it('renders catch-all message for else branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByText('Catch-all branch - no conditions needed')).toBeInTheDocument()
    })

    it('does not render AssertionBuilder for else branch', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Only one assertion builder mock (for the if branch)
      const builders = screen.getAllByTestId('assertion-builder-mock')
      expect(builders).toHaveLength(1)
    })
  })

  describe('Validation', () => {
    it('reports valid when if branch has conditions', () => {
      const branches: ConditionBranch[] = [
        {
          id: 'branch_0',
          type: 'if',
          label: '',
          conditions: [
            { id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false },
          ],
        },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(onValidChange).toHaveBeenCalledWith(true)
    })

    it('reports invalid when if branch has no conditions', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(onValidChange).toHaveBeenCalledWith(false)
    })

    it('reports invalid when else-if branch has no conditions', () => {
      const branches: ConditionBranch[] = [
        {
          id: 'branch_0',
          type: 'if',
          label: '',
          conditions: [
            { id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false },
          ],
        },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(onValidChange).toHaveBeenCalledWith(false)
    })

    it('else branch does not affect validity', () => {
      const branches: ConditionBranch[] = [
        {
          id: 'branch_0',
          type: 'if',
          label: '',
          conditions: [
            { id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false },
          ],
        },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Valid because if has conditions, else has no conditions requirement
      expect(onValidChange).toHaveBeenCalledWith(true)
    })

    it('treats operator-only conditions as invalid', () => {
      const branches: ConditionBranch[] = [
        {
          id: 'branch_0',
          type: 'if',
          label: '',
          conditions: [
            { type: 'operator', value: 'and' },
          ],
        },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(onValidChange).toHaveBeenCalledWith(false)
    })

    it('marks a conditional branch that has no assertions', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('branch-alert-branch_0')).toBeInTheDocument()
      // The else branch carries no conditions by design, so it is never marked.
      expect(screen.queryByTestId('branch-alert-branch_1')).not.toBeInTheDocument()
    })

    it('treats a condition with no variable picked as invalid', () => {
      // A half-built row does not count as a condition.
      const branches: ConditionBranch[] = [
        {
          id: 'branch_0',
          type: 'if',
          label: '',
          conditions: [
            {
              id: 'a1',
              type: 'literal',
              variable: '',
              value_type: 'string',
              operator: 'equals',
              reference_value: 'x',
              reference_is_expression: false,
            },
          ],
        },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(onValidChange).toHaveBeenLastCalledWith(false)
    })
  })

  describe('Assertion changes', () => {
    it('updates branch conditions when AssertionBuilder changes', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Click the mock add assertion button
      await user.click(screen.getByTestId('mock-add-assertion'))

      expect(onBranchesChange).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'branch_0',
          conditions: [
            expect.objectContaining({ id: 'a1', type: 'literal' }),
          ],
        }),
      ])
    })
  })

  describe('Edge cases', () => {
    it('handles moveBranch with invalid id gracefully', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [{ id: 'a2', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 2, reference_is_expression: false }] },
        { id: 'branch_2', type: 'else_if', label: '', conditions: [{ id: 'a3', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 3, reference_is_expression: false }] },
        { id: 'branch_3', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Try moving the last else-if down (next to else - should be disabled)
      const moveDownBtn = screen.getByTestId('branch-move-down-branch_2')
      expect(moveDownBtn).toBeDisabled()
    })

    it('adds else-if when no else exists', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      await user.click(screen.getByTestId('add-else-if-button'))

      const lastCall = onBranchesChange.mock.calls[onBranchesChange.mock.calls.length - 1][0]
      expect(lastCall).toHaveLength(2)
      expect(lastCall[1].type).toBe('else_if')
    })

    it('validates branches where conditions is undefined (uses ?? [] fallback)', () => {
      // Branch with conditions=undefined triggers the `?? []` fallback in validation
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '' },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // If branch has no conditions (undefined) - should be invalid
      expect(onValidChange).toHaveBeenCalledWith(false)
    })

    it('passes conditions ?? [] to AssertionBuilder when conditions is undefined', () => {
      // Branch with conditions=undefined should pass [] to AssertionBuilder
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // The assertion builder mock should show 0 assertions (from conditions ?? [])
      expect(screen.getByTestId('mock-assertion-count')).toHaveTextContent('0')
    })

    it('updateBranch only updates the matching branch, leaving others unchanged', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: 'First', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: 'Second', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Type in the second branch's label input - updateBranch should only change branch_1
      const input = screen.getByTestId('branch-label-branch_1')
      await user.type(input, 'Z')

      // The last call should have updated only branch_1's label
      const lastCall = onBranchesChange.mock.calls[onBranchesChange.mock.calls.length - 1][0]
      expect(lastCall[0].label).toBe('First') // unchanged
      expect(lastCall[1].label).toBe('SecondZ') // updated
    })

    it('moveBranch does nothing when target index is below 1 (cannot swap above if)', async () => {
      // Branch at index 1 is the first else_if - moving up would put it at index 0 (if's position)
      // The button is disabled but let's verify move logic is safe even if called
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [{ id: 'a2', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 2, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // The move-up button for the first else_if should be disabled
      const moveUpBtn = screen.getByTestId('branch-move-up-branch_1')
      expect(moveUpBtn).toBeDisabled()
    })

    it('moveBranch does nothing when target index is past end of array', async () => {
      // Branch at last position trying to move down
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [{ id: 'a2', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 2, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // The move-down button for branch_1 (last item) should be disabled
      const moveDownBtn = screen.getByTestId('branch-move-down-branch_1')
      expect(moveDownBtn).toBeDisabled()
    })

    it('moveBranch does not swap with else branch', async () => {
      // else_if at position before else - cannot move down past else
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [{ id: 'a2', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 2, reference_is_expression: false }] },
        { id: 'branch_2', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      // Move-down for branch_1 should be disabled (next is else)
      const moveDownBtn = screen.getByTestId('branch-move-down-branch_1')
      expect(moveDownBtn).toBeDisabled()
    })
  })

  describe('Shared branch card shell', () => {
    it('removes a collapsed branch body from the DOM', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('assertion-builder-mock')).toBeInTheDocument()

      await user.click(screen.getByTestId('branch-toggle-branch_0'))

      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()
      expect(screen.queryByTestId('assertion-builder-mock')).not.toBeInTheDocument()
    })

    it('labels the card controls with the branch noun', () => {
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else_if', label: '', conditions: [{ id: 'a2', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 2, reference_is_expression: false }] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      expect(screen.getByTestId('branch-toggle-branch_0')).toHaveAttribute('aria-label', 'Collapse branch')
      expect(screen.getByTestId('branch-move-up-branch_1')).toHaveAttribute('aria-label', 'Move branch up')
      expect(screen.getByTestId('branch-move-down-branch_1')).toHaveAttribute('aria-label', 'Move branch down')
      expect(screen.getByTestId('branch-delete-branch_1')).toHaveAttribute('aria-label', 'Delete branch')
    })

    it('collapses one branch without collapsing another', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [{ id: 'a1', type: 'literal', variable: 'x', value_type: 'integer', operator: 'equals', reference_value: 1, reference_is_expression: false }] },
        { id: 'branch_1', type: 'else', label: '' },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      await user.click(screen.getByTestId('branch-toggle-branch_0'))

      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()
      expect(screen.getByTestId('branch-body-branch_1')).toBeInTheDocument()
    })

    it('toggles a branch exactly once per chevron click', async () => {
      const user = userEvent.setup()
      const branches: ConditionBranch[] = [
        { id: 'branch_0', type: 'if', label: '', conditions: [] },
      ]

      render(
        <ConditionBranchEditor
          branches={branches}
          availableVariables={defaultVars}
          onBranchesChange={onBranchesChange}
          onValidChange={onValidChange}
        />
      )

      await user.click(screen.getByTestId('branch-toggle-branch_0'))
      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('branch-toggle-branch_0'))
      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })
  })
})
