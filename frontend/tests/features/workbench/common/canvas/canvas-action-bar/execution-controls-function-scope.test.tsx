/**
 * Tests for Run Scope routing in the canvas-action-bar execution controls.
 *
 * The Run Scope action routes differently based on whether
 * the canvas drill stack is empty (Test level) or non-empty (drilled into a
 * Function):
 *
 *   - Test level (drillPath = [])         -> normal run endpoint (same as Run All)
 *   - Function level (drillPath non-empty) -> POST /workbench/run with
 *                                              scope_mode='function',
 *                                              scoped_function_node_id =
 *                                              the active Function node id
 *
 * The handler wiring is supplied by the consumer (CanvasActionBar plumbing);
 * this test ensures the dispatch behavior is correct.
 */

import { describe, it, expect, vi } from 'vitest'


// ---------------------------------------------------------------------------
// Run Scope routing (selector that picks Test vs Function dispatch)
// ---------------------------------------------------------------------------


describe('selectRunScopeDispatch - canvas-aware routing', () => {
  it('returns "test" dispatch when drillPath is empty', async () => {
    const { selectRunScopeDispatch } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/run-scope-dispatch'
    )
    const result = selectRunScopeDispatch({ drillPath: [] })
    expect(result.mode).toBe('test')
    expect(result.scopedFunctionNodeId).toBeUndefined()
  })

  it('returns "function" dispatch when drillPath has one entry', async () => {
    const { selectRunScopeDispatch } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/run-scope-dispatch'
    )
    const result = selectRunScopeDispatch({
      drillPath: [{ nodeId: 'fn-1', label: 'fn-1' }],
    })
    expect(result.mode).toBe('function')
    expect(result.scopedFunctionNodeId).toBe('fn-1')
  })

  it('uses the LEAF entry of a multi-level drill as the scoped function node', async () => {
    const { selectRunScopeDispatch } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/run-scope-dispatch'
    )
    const result = selectRunScopeDispatch({
      drillPath: [
        { nodeId: 'outer-fn', label: 'outer' },
        { nodeId: 'inner-fn', label: 'inner' },
      ],
    })
    expect(result.mode).toBe('function')
    expect(result.scopedFunctionNodeId).toBe('inner-fn')
  })
})


// ---------------------------------------------------------------------------
// Component-level Run Scope behavior
// ---------------------------------------------------------------------------


describe('ExecutionControls - Run Scope handler integration', () => {
  it('invokes onRun("current") at Test level (drillPath empty)', async () => {
    const { ExecutionControls } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/execution-controls'
    )
    const { render, screen } = await import('@testing-library/react')
    const userEvent = (await import('@testing-library/user-event')).default

    const onRun = vi.fn()
    render(
      <ExecutionControls
        selectedEnvironment="env-1"
        onActionWithoutEnv={() => {}}
        onRun={onRun}
        showIdleControls
        isRunning={false}
        isPaused={false}
      />,
    )
    const user = userEvent.setup()
    // Open the Run split-button menu and pick Run Scope. The shared
    // SplitButton derives the caret testid from its ``testIdPrefix`` as
    // ``<prefix>-button-dropdown`` (see ``components/shared/split-button``).
    await user.click(screen.getByTestId('run-button-dropdown'))
    await user.click(screen.getByText(/Run Scope/i))
    expect(onRun).toHaveBeenCalledWith('current')
  })
})
