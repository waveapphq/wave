/**
 * LoopTargetSelector Component Tests
 *
 * Tests the Break/Continue target_loop dropdown that finds enclosing loops
 * and validates the selected target.
 *
 * REQ-3.5.1.2: Break current block execution
 * REQ-3.5.1.3: Continue to next iteration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---- Mock setup (module-level, before imports) ----

const mockFindEnclosingLoops = vi.fn()
vi.mock('@/features/workbench/lib/find-enclosing-loops', () => ({
  findEnclosingLoops: (...args: unknown[]) => mockFindEnclosingLoops(...args),
}))

const mockValidateLoopTarget = vi.fn()
vi.mock('@/features/workbench/lib/validate-loop-target', () => ({
  validateLoopTarget: (...args: unknown[]) => mockValidateLoopTarget(...args),
}))

const mockNodes = [
  {
    id: 'break-1',
    data: { label: 'Break', elementType: 'break', displayName: 'My Break' },
  },
  {
    id: 'for-1',
    data: { label: 'For', elementType: 'for', displayName: 'Outer Loop' },
  },
  {
    id: 'for-2',
    data: { label: 'For', elementType: 'for', displayName: 'Inner Loop' },
  },
]
const mockEdges = [
  { id: 'e1', source: 'for-2', target: 'break-1', sourceHandle: 'body' },
  { id: 'e2', source: 'for-1', target: 'for-2', sourceHandle: 'body' },
]

const mockWorkflowStore = {
  nodes: mockNodes,
  edges: mockEdges,
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (state: typeof mockWorkflowStore) => unknown) =>
    selector ? selector(mockWorkflowStore) : mockWorkflowStore,
}))

// ---- Import component under test after mocks ----

import { LoopTargetSelector } from '@/features/workbench/common/element-config/loop-target-selector'

describe('LoopTargetSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = mockNodes
    mockWorkflowStore.edges = mockEdges
    // Default: valid target
    mockValidateLoopTarget.mockReturnValue({ valid: true })
  })

  it('renders with loop options - shows dropdown with options', async () => {
    const user = userEvent.setup()
    mockFindEnclosingLoops.mockReturnValue([
      { nodeId: 'for-2', label: 'For Loop: Inner Loop', loopType: 'for' },
      { nodeId: 'for-1', label: 'For Loop: Outer Loop', loopType: 'for' },
    ])

    render(
      <LoopTargetSelector
        nodeId="break-1"
        value="for-2"
        onChange={vi.fn()}
      />,
    )

    // Label should be rendered
    expect(screen.getByText('Target Loop')).toBeInTheDocument()

    // Trigger should show selected value
    const trigger = screen.getByRole('combobox')
    expect(trigger).toBeEnabled()

    // Open the dropdown and verify options are rendered
    await user.click(trigger)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'For Loop: Inner Loop' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'For Loop: Outer Loop' })).toBeInTheDocument()
    })

    // No error messages should be shown when valid and has options
    expect(screen.queryByText('This control must be placed inside a loop body')).not.toBeInTheDocument()
  })

  it('renders with no loops - shows disabled dropdown and error message', () => {
    mockFindEnclosingLoops.mockReturnValue([])
    mockValidateLoopTarget.mockReturnValue({ valid: false, error: 'Block is not inside any loop' })

    render(
      <LoopTargetSelector
        nodeId="break-1"
        value=""
        onChange={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('combobox')
    expect(trigger).toBeDisabled()

    // Should show "No loops detected" placeholder
    expect(screen.getByText('No loops detected')).toBeInTheDocument()

    // Should show the error message for controls not inside a loop
    expect(screen.getByText('This control must be placed inside a loop body')).toBeInTheDocument()
  })

  it('auto-selects innermost (last) loop when value is empty and options exist', () => {
    const onChange = vi.fn()
    mockFindEnclosingLoops.mockReturnValue([
      { nodeId: 'for-1', label: 'For Loop: Outer Loop', loopType: 'for' },
      { nodeId: 'for-2', label: 'For Loop: Inner Loop', loopType: 'for' },
    ])

    render(
      <LoopTargetSelector
        nodeId="break-1"
        value=""
        onChange={onChange}
      />,
    )

    // Should auto-select the last (innermost) loop
    expect(onChange).toHaveBeenCalledWith('for-2')
  })

  it('does NOT auto-select when value is already set', () => {
    const onChange = vi.fn()
    mockFindEnclosingLoops.mockReturnValue([
      { nodeId: 'for-2', label: 'For Loop: Inner Loop', loopType: 'for' },
      { nodeId: 'for-1', label: 'For Loop: Outer Loop', loopType: 'for' },
    ])

    render(
      <LoopTargetSelector
        nodeId="break-1"
        value="for-1"
        onChange={onChange}
      />,
    )

    // Should NOT call onChange because value is already set
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders validation error when value is set but invalid', () => {
    mockFindEnclosingLoops.mockReturnValue([
      { nodeId: 'for-2', label: 'For Loop: Inner Loop', loopType: 'for' },
    ])
    mockValidateLoopTarget.mockReturnValue({
      valid: false,
      error: 'Target is not an enclosing loop',
    })

    render(
      <LoopTargetSelector
        nodeId="break-1"
        value="deleted-loop"
        onChange={vi.fn()}
      />,
    )

    // Should show the validation error
    expect(screen.getByText('Target is not an enclosing loop')).toBeInTheDocument()

    // Should NOT show the "no loops" error since there are options
    expect(screen.queryByText('This control must be placed inside a loop body')).not.toBeInTheDocument()
  })

  it('does NOT render validation error when valid', () => {
    mockFindEnclosingLoops.mockReturnValue([
      { nodeId: 'for-2', label: 'For Loop: Inner Loop', loopType: 'for' },
    ])
    mockValidateLoopTarget.mockReturnValue({ valid: true })

    render(
      <LoopTargetSelector
        nodeId="break-1"
        value="for-2"
        onChange={vi.fn()}
      />,
    )

    // No error text should appear
    expect(screen.queryByText('Target is not an enclosing loop')).not.toBeInTheDocument()
    expect(screen.queryByText('This control must be placed inside a loop body')).not.toBeInTheDocument()
  })

  it('calls onChange when user selects a different loop', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    mockFindEnclosingLoops.mockReturnValue([
      { nodeId: 'for-2', label: 'For Loop: Inner Loop', loopType: 'for' },
      { nodeId: 'for-1', label: 'For Loop: Outer Loop', loopType: 'for' },
    ])

    render(
      <LoopTargetSelector
        nodeId="break-1"
        value="for-2"
        onChange={onChange}
      />,
    )

    // Open dropdown
    const trigger = screen.getByRole('combobox')
    await user.click(trigger)

    // Select the outer loop option
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'For Loop: Outer Loop' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: 'For Loop: Outer Loop' }))

    // onChange should be called with the outer loop's nodeId
    expect(onChange).toHaveBeenCalledWith('for-1')
  })

  it('does not show validation error when value is empty (no value condition on line 84)', () => {
    // This tests the `value &&` condition in line 84 -
    // when value is empty, even with invalid validation, no error is shown
    mockFindEnclosingLoops.mockReturnValue([
      { nodeId: 'for-2', label: 'For Loop: Inner Loop', loopType: 'for' },
    ])
    mockValidateLoopTarget.mockReturnValue({
      valid: false,
      error: 'Target loop is required',
    })

    const onChange = vi.fn()
    render(
      <LoopTargetSelector
        nodeId="break-1"
        value=""
        onChange={onChange}
      />,
    )

    // The validation error should NOT show because value is empty
    // (the auto-select useEffect handles the empty case)
    expect(screen.queryByText('Target loop is required')).not.toBeInTheDocument()
  })

  it('does not show validation error when validation has no error message', () => {
    // Tests the `validation.error` check on line 84 -
    // valid is false but error is undefined
    mockFindEnclosingLoops.mockReturnValue([
      { nodeId: 'for-2', label: 'For Loop: Inner Loop', loopType: 'for' },
    ])
    mockValidateLoopTarget.mockReturnValue({ valid: false })

    render(
      <LoopTargetSelector
        nodeId="break-1"
        value="for-2"
        onChange={vi.fn()}
      />,
    )

    // No error should be shown because validation.error is undefined
    expect(screen.queryByText('This control must be placed inside a loop body')).not.toBeInTheDocument()
  })
})
