/**
 * Workflow Store - library-View mode actions.
 *
 * Covers enterFunctionView / exitFunctionView / setFunctionViewVersion: the
 * standalone-Function-view state that boots the read-only workbench from the
 * Functions library detail page. (use-function-view.test.tsx mocks the store,
 * so the real actions are exercised here.)
 *
 * REQ scope: REQ-3.2.1.1.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

beforeEach(() => {
  useWorkflowStore.getState().reset()
})

describe('workflow-store - functionViewMode', () => {
  it('starts null', () => {
    expect(useWorkflowStore.getState().functionViewMode).toBeNull()
  })

  it('enterFunctionView sets the mode', () => {
    useWorkflowStore.getState().enterFunctionView({
      functionId: 'fn-1',
      version: '1.2.0',
      editable: false,
    })
    expect(useWorkflowStore.getState().functionViewMode).toEqual({
      functionId: 'fn-1',
      version: '1.2.0',
      editable: false,
    })
  })

  it('exitFunctionView clears the mode', () => {
    useWorkflowStore.getState().enterFunctionView({
      functionId: 'fn-1',
      version: '1.2.0',
      editable: true,
    })
    useWorkflowStore.getState().exitFunctionView()
    expect(useWorkflowStore.getState().functionViewMode).toBeNull()
  })

  it('setFunctionViewVersion updates the version in place', () => {
    useWorkflowStore.getState().enterFunctionView({
      functionId: 'fn-1',
      version: '1.2.0',
      editable: false,
    })
    useWorkflowStore.getState().setFunctionViewVersion('1.3.0')
    expect(useWorkflowStore.getState().functionViewMode).toEqual({
      functionId: 'fn-1',
      version: '1.3.0',
      editable: false,
    })
  })

  it('setFunctionViewVersion is a no-op when not in View mode', () => {
    useWorkflowStore.getState().setFunctionViewVersion('9.9.9')
    expect(useWorkflowStore.getState().functionViewMode).toBeNull()
  })

  it('reset clears functionViewMode', () => {
    useWorkflowStore.getState().enterFunctionView({
      functionId: 'fn-1',
      version: '1.2.0',
      editable: false,
    })
    useWorkflowStore.getState().reset()
    expect(useWorkflowStore.getState().functionViewMode).toBeNull()
  })
})

describe('workflow-store - View boot baseline', () => {
  /** The full View boot recipe (what use-function-view performs): reset, stage
   *  the synthetic root, drill into the resolved body, re-baseline. */
  function bootView(): void {
    const store = useWorkflowStore.getState()
    store.reset()
    store.enterFunctionView({ functionId: 'fn-1', version: '1.0.0', editable: false })
    store.setNodes(
      [
        {
          id: 'view-shared-root',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'Greet User',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            functionId: 'fn-1',
            functionVersion: '1.0.0',
          },
        },
      ] as never,
      { skipDirty: true },
    )
    useWorkflowStore.getState().pushSharedDrill('view-shared-root', {
      workflow: {
        nodes: [
          {
            id: 'body-log',
            type: 'workflowNode',
            position: { x: 0, y: 0 },
            data: { label: 'log', nodeType: 'plugin' },
          },
        ] as never,
        edges: [] as never,
      },
      inputs: [],
      outputs: [],
      variables: [],
    })
    useWorkflowStore.getState().markSaved()
  }

  it('the baseline entry holds the loaded published body, not an empty canvas', () => {
    bootView()
    const state = useWorkflowStore.getState()
    expect(state.history).toHaveLength(1)
    expect(state.history[0].isInitialState).toBe(true)
    expect(state.history[0].nodes).not.toHaveLength(0)
    expect(state.canUndo()).toBe(false)
    expect(state.isDirty).toBe(false)
  })

  it('the first in-View undo floors at the published body, never a blank canvas', () => {
    bootView()
    const store = useWorkflowStore.getState()
    store.addNode({
      id: 'added-inner',
      type: 'workflowNode',
      position: { x: 10, y: 10 },
      data: { label: 'added', nodeType: 'plugin' },
    } as never)
    expect(useWorkflowStore.getState().canUndo()).toBe(true)

    useWorkflowStore.getState().undo()

    const state = useWorkflowStore.getState()
    expect(state.nodes).not.toHaveLength(0)
    expect(state.nodes.some((n) => n.id === 'view-shared-root')).toBe(true)
    expect(state.canUndo()).toBe(false)
  })
})
