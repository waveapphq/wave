/**
 * Workflow Store - Drop Changes pick-out surgery (REQ-5.2.1.24) +
 * hasEditModeNodes (close-time nag).
 *
 * Dropping an edit-mode draft is NOT an undoable action. It performs a
 * per-entry session collapse: the Function's changes (nested included) are
 * normalized out of every retained entry to the published reference, no-op
 * entries dedup against the previous retained entry, the redo tail is
 * truncated (a collapse is a branch point), unrelated changes REMAIN, and
 * derived dirty reflects whether the dropped state still diverges from the
 * saved baseline. Dropping while drilled into (or below) the dropped Function
 * reconciles the drill location to the nearest valid ancestor scope.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

interface AnyNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

function func1(version: string, opts: { editMode?: boolean } = {}): AnyNode {
  const data: Record<string, unknown> = {
    label: 'Func1',
    nodeType: 'function',
    elementType: 'function',
    functionLifecycle: 'shared',
    functionId: 'F1',
    functionVersion: version,
  }
  if (opts.editMode) {
    data.editMode = true
    data.upstreamLink = { functionId: 'F1', sourceVersion: version }
    data.draft = {
      name: 'Func1',
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
    }
  }
  return { id: 'func1', type: 'workflowNode', position: { x: 0, y: 0 }, data }
}

function outerLog(id: string, label: string): AnyNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label, nodeType: 'plugin', elementType: 'log' },
  }
}

function cleanFunc1Data(version: string): Record<string, unknown> {
  return {
    label: 'Func1',
    nodeType: 'function',
    elementType: 'function',
    functionLifecycle: 'shared',
    functionId: 'F1',
    functionVersion: version,
  }
}

type StoreState = ReturnType<typeof useWorkflowStore.getState>

/** Mid-edit-session: func1 in edit mode on the canvas, history with both an
 *  undoable past AND a redoable future (historyIndex points mid-stack). */
function seedEditSessionMidStack() {
  const baseNodes = [func1('1.0.0'), outerLog('log-a', 'log1')]
  const enterEdit = [func1('1.0.0', { editMode: true }), outerLog('log-a', 'log1')]
  const innerEdit = [func1('1.0.0', { editMode: true }), outerLog('log-a', 'log1'), outerLog('log-b', 'log2')]
  useWorkflowStore.setState({
    nodes: enterEdit as unknown as never,
    edges: [] as unknown as never,
    variables: [] as never,
    drillPath: [],
    editingTestId: 'test-1',
    isDirty: true,
    history: [
      { nodes: baseNodes, edges: [], variables: [], timestamp: 1, operationDescription: 'baseline', isInitialState: true },
      { nodes: enterEdit, edges: [], variables: [], timestamp: 2, operationDescription: 'Enter edit mode' },
      { nodes: innerEdit, edges: [], variables: [], timestamp: 3, operationDescription: 'Add block' },
    ] as unknown as never,
    // index 1 of a 3-entry history: BOTH canUndo (1>0) and canRedo (1<2) hold.
    historyIndex: 1,
  } as Partial<StoreState>)
}

beforeEach(() => {
  seedEditSessionMidStack()
})

describe('applyEditModeDropped - hard history reset', () => {
  it('clears the undo stack (canUndo is false after a drop)', () => {
    expect(useWorkflowStore.getState().canUndo()).toBe(true) // precondition
    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))
    expect(useWorkflowStore.getState().canUndo()).toBe(false)
  })

  it('clears the redo stack (canRedo is false after a drop)', () => {
    expect(useWorkflowStore.getState().canRedo()).toBe(true) // precondition
    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))
    expect(useWorkflowStore.getState().canRedo()).toBe(false)
  })

  it('redo after a drop is a safe no-op (does not throw, stays on the clean node)', () => {
    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))
    expect(() => useWorkflowStore.getState().redo()).not.toThrow()
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'func1') as unknown as
      | AnyNode
      | undefined
    expect(node?.data.editMode).toBeFalsy()
    expect(node?.data.draft).toBeUndefined()
  })

  it('marks the test dirty after dropping a Function that was SAVED in edit mode', () => {
    // Baseline (saved state) carries the Function in edit mode; dropping reverts
    // it to the published reference, which diverges from saved -> saveable.
    const editBaseline = [func1('1.0.0', { editMode: true }), outerLog('log-a', 'log1')]
    useWorkflowStore.setState({
      nodes: editBaseline as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      isDirty: false,
      history: [
        { nodes: editBaseline, edges: [], variables: [], timestamp: 1, operationDescription: 'baseline', isInitialState: true },
      ] as unknown as never,
      historyIndex: 0,
    } as Partial<StoreState>)
    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))
    expect(useWorkflowStore.getState().isDirty).toBe(true)
  })

  it('reverts to the clean saved state when the only changes were edit-mode (no other edits)', () => {
    // Baseline published; enter edit + draft edits only -> drop returns to the
    // exact saved state, so there is nothing left to save.
    useWorkflowStore.setState({ isDirty: true } as Partial<StoreState>)
    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))
    // seedEditSessionMidStack's baseline (index 0) is the published func1.
    expect(useWorkflowStore.getState().isDirty).toBe(false)
    expect(useWorkflowStore.getState().canUndo()).toBe(false)
  })
})

describe('applyEditModeDropped - surgical history (keep unrelated changes)', () => {
  const editDraftC = (): AnyNode => {
    const n = func1('1.0.0', { editMode: true })
    return {
      ...n,
      data: {
        ...n.data,
        draft: { name: 'Func1', inputs: [], outputs: [], dependencies: { functions: [], plugins: [] }, workflow: { nodes: [{ id: 'logC', message: 'c1' }], edges: [] } },
      },
    }
  }
  const histEntry = (nodes: AnyNode[], operationDescription: string, isInitialState = false) => ({
    nodes, edges: [], variables: [], timestamp: 1, operationDescription, ...(isInitialState ? { isInitialState } : {}),
  })

  it('strips only the Function edit-mode entries, keeping unrelated changes and the node move', () => {
    const moved = (): AnyNode => ({ ...editDraftC(), position: { x: 100, y: 0 } })
    const history = [
      histEntry([func1('1.0.0'), outerLog('log-a', 'a0'), outerLog('log-b', 'b0')], 'baseline', true),
      histEntry([func1('1.0.0'), outerLog('log-a', 'a1'), outerLog('log-b', 'b0')], 'Log A msg'),
      histEntry([func1('1.0.0', { editMode: true }), outerLog('log-a', 'a1'), outerLog('log-b', 'b0')], 'Func X to edit'),
      histEntry([func1('1.0.0', { editMode: true }), outerLog('log-a', 'a1'), outerLog('log-b', 'b1')], 'Log B msg'),
      histEntry([editDraftC(), outerLog('log-a', 'a1'), outerLog('log-b', 'b1')], 'Func X/Log C msg'),
      histEntry([editDraftC(), outerLog('log-a', 'a2'), outerLog('log-b', 'b1')], 'Log A msg'),
      histEntry([moved(), outerLog('log-a', 'a2'), outerLog('log-b', 'b1')], 'Func X move'),
    ]
    useWorkflowStore.setState({
      nodes: history[6].nodes as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      editingTestId: 'test-1',
      isDirty: true,
      history: history as unknown as never,
      historyIndex: 6,
      maxHistoryLength: 100,
    } as Partial<StoreState>)

    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))

    const state = useWorkflowStore.getState()
    expect(state.history.map((e) => e.operationDescription)).toEqual([
      'baseline', 'Log A msg', 'Log B msg', 'Log A msg', 'Func X move',
    ])
    expect(state.historyIndex).toBe(4)
    expect(state.isDirty).toBe(true)
    const f = state.nodes.find((n) => n.id === 'func1') as unknown as AnyNode
    expect(f.data.editMode).toBeFalsy()
    expect(f.data.draft).toBeUndefined()
    expect(f.position.x).toBe(100)
  })

  it('dedups no-op entries that differ only in selection/drag residue', () => {
    // Move block A (leaves selected residue in the snapshot), enter
    // edit, move block B (selection shifts). The normalized enter-edit entry
    // must dedup against the move-A entry although their RAW snapshots differ
    // in `selected` flags - else undo hits a dead "Enter edit mode" step.
    const selected = (n: AnyNode, isSelected: boolean): AnyNode =>
      ({ ...n, selected: isSelected }) as AnyNode
    const movedA = (sel: boolean): AnyNode =>
      selected({ ...outerLog('log-a', 'a'), position: { x: 50, y: 0 } }, sel)
    const movedB = (sel: boolean): AnyNode =>
      selected({ ...outerLog('log-b', 'b'), position: { x: 70, y: 0 } }, sel)
    const history = [
      histEntry([outerLog('log-a', 'a'), outerLog('log-b', 'b'), func1('1.0.0')], 'baseline', true),
      histEntry([movedA(true), outerLog('log-b', 'b'), func1('1.0.0')], 'Move block'),
      histEntry([movedA(false), outerLog('log-b', 'b'), selected(func1('1.0.0', { editMode: true }), true)], 'Enter edit mode'),
      histEntry([movedA(false), movedB(true), func1('1.0.0', { editMode: true })], 'Move block'),
    ]
    useWorkflowStore.setState({
      nodes: history[3].nodes as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      editingTestId: 'test-1',
      isDirty: true,
      history: history as unknown as never,
      historyIndex: 3,
      maxHistoryLength: 100,
    } as Partial<StoreState>)

    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))

    const state = useWorkflowStore.getState()
    expect(state.history.map((e) => e.operationDescription)).toEqual([
      'baseline', 'Move block', 'Move block',
    ])
    expect(state.historyIndex).toBe(2)
    // Undo from the dropped state walks real changes only (no dead step).
    useWorkflowStore.getState().undo()
    expect(useWorkflowStore.getState().lastAnnouncement).toBe('Undone: Move block')
    const logB = useWorkflowStore.getState().nodes.find((n) => n.id === 'log-b')
    expect(logB?.position.x).toBe(0)
  })

  it('treats an absent variables list as empty during no-op dedup', () => {
    // HistoryEntry.variables is optional; snapshot equality must compare an
    // omitted list as empty, not as a mismatch that defeats the dedup.
    const bare = (nodes: AnyNode[], operationDescription: string, isInitialState = false) => ({
      nodes, edges: [], timestamp: 1, operationDescription, ...(isInitialState ? { isInitialState } : {}),
    })
    const history = [
      bare([outerLog('log-a', 'a'), func1('1.0.0')], 'baseline', true),
      bare([outerLog('log-a', 'a'), func1('1.0.0', { editMode: true })], 'Enter edit mode'),
    ]
    useWorkflowStore.setState({
      nodes: history[1].nodes as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      editingTestId: 'test-1',
      isDirty: true,
      history: history as unknown as never,
      historyIndex: 1,
      maxHistoryLength: 100,
    } as Partial<StoreState>)

    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))

    const state = useWorkflowStore.getState()
    expect(state.history.map((e) => e.operationDescription)).toEqual(['baseline'])
    expect(state.historyIndex).toBe(0)
  })

  it('handles an empty history defensively (reverts the node + seeds the dropped tip)', () => {
    useWorkflowStore.setState({
      nodes: [func1('1.0.0', { editMode: true })] as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      isDirty: true,
      history: [] as unknown as never,
      historyIndex: -1,
    } as Partial<StoreState>)

    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))

    const state = useWorkflowStore.getState()
    expect(state.history).toHaveLength(1)
    expect(state.historyIndex).toBe(0)
    const f = state.nodes.find((n) => n.id === 'func1') as unknown as AnyNode
    expect(f.data.editMode).toBeFalsy()
  })

  it('strips the transient drill-stamped localDefinition so drilled edits dedup to baseline', () => {
    // Drilling into an edit-mode Shared stamps a transient localDefinition that
    // holds the working body; the drilled inner-block move lives there. The
    // surgery must strip it too, else the entries never dedup (undo survives).
    const drilled = (innerX: number): AnyNode => {
      const n = func1('1.0.0', { editMode: true })
      return {
        ...n,
        data: {
          ...n.data,
          localDefinition: {
            workflow: { nodes: [{ id: 'inner-1', type: 'workflowNode', position: { x: innerX, y: 0 }, data: { label: 'inner', nodeType: 'plugin' } }], edges: [] },
            inputs: [], outputs: [], variables: [],
          },
        },
      }
    }
    const history = [
      histEntry([func1('1.0.0'), outerLog('log-a', 'a0')], 'baseline', true),
      histEntry([drilled(0), outerLog('log-a', 'a0')], 'Func X to edit'),
      histEntry([drilled(50), outerLog('log-a', 'a0')], 'Move inner block'),
    ]
    useWorkflowStore.setState({
      nodes: history[2].nodes as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      editingTestId: 'test-1',
      isDirty: true,
      history: history as unknown as never,
      historyIndex: 2,
      maxHistoryLength: 100,
    } as Partial<StoreState>)

    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))

    const state = useWorkflowStore.getState()
    // All changes were edit-mode (drilled inner move) -> revert to saved baseline.
    expect(state.history.map((e) => e.operationDescription)).toEqual(['baseline'])
    expect(state.canUndo()).toBe(false)
    expect(state.isDirty).toBe(false)
    const f = state.nodes.find((n) => n.id === 'func1') as unknown as AnyNode
    expect(f.data.editMode).toBeFalsy()
    expect(f.data.localDefinition).toBeUndefined()
  })
})

describe('applyEditModeDropped - drilled coherence', () => {
  function stampedEditFunc(inner: AnyNode[]): AnyNode {
    const n = func1('1.0.0', { editMode: true })
    return {
      ...n,
      data: {
        ...n.data,
        localDefinition: {
          workflow: { nodes: inner, edges: [] },
          inputs: [],
          outputs: [],
          variables: [],
        },
      },
    }
  }

  function innerLocalFn(id: string, inner: AnyNode[]): AnyNode {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: id,
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: inner, edges: [] },
          inputs: [],
          outputs: [],
          variables: [],
        },
      },
    }
  }

  it('drop while drilled INTO the dropped Function pops to the nearest valid scope', () => {
    const editing = stampedEditFunc([outerLog('inner-1', 'inner')])
    useWorkflowStore.setState({
      nodes: [editing] as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [{ nodeId: 'func1', label: 'Func1' }],
      isDirty: true,
      history: [
        { nodes: [func1('1.0.0')], edges: [], variables: [], timestamp: 1, operationDescription: 'baseline', isInitialState: true },
        { nodes: [editing], edges: [], variables: [], timestamp: 2, operationDescription: 'Func X to edit' },
      ] as unknown as never,
      historyIndex: 1,
    } as Partial<StoreState>)

    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))

    const state = useWorkflowStore.getState()
    expect(state.drillPath).toEqual([])
    expect(() => state.getActiveNodes()).not.toThrow()
    const f = state.nodes.find((n) => n.id === 'func1') as unknown as AnyNode
    expect(f.data.editMode).toBeFalsy()
    expect(f.data.localDefinition).toBeUndefined()
  })

  it('drop while drilled BELOW the dropped Function pops every invalidated entry', () => {
    const nested = innerLocalFn('inner-fn', [outerLog('leaf', 'leaf')])
    const editing = stampedEditFunc([nested])
    useWorkflowStore.setState({
      nodes: [editing] as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [
        { nodeId: 'func1', label: 'Func1' },
        { nodeId: 'inner-fn', label: 'inner-fn' },
      ],
      isDirty: true,
      history: [
        { nodes: [func1('1.0.0')], edges: [], variables: [], timestamp: 1, operationDescription: 'baseline', isInitialState: true },
        { nodes: [editing], edges: [], variables: [], timestamp: 2, operationDescription: 'Func X to edit' },
      ] as unknown as never,
      historyIndex: 1,
    } as Partial<StoreState>)

    useWorkflowStore.getState().applyEditModeDropped('func1', cleanFunc1Data('1.0.0'))

    const state = useWorkflowStore.getState()
    expect(state.drillPath).toEqual([])
    expect(() => state.getActiveNodes()).not.toThrow()
    expect(state.getActiveNodes().map((n) => n.id)).toEqual(['func1'])
  })
})

describe('hasEditModeNodes selector', () => {
  // Typed accessor so a not-yet-added selector reads as undefined (clean
  // assertion failure) instead of a hard TypeError.
  function hasEditModeNodes(): boolean | undefined {
    const state = useWorkflowStore.getState() as StoreState & {
      hasEditModeNodes?: () => boolean
    }
    return state.hasEditModeNodes?.()
  }

  it('returns true when the active tree carries an edit-mode Function', () => {
    expect(hasEditModeNodes()).toBe(true)
  })

  it('returns false when no node is in edit mode', () => {
    useWorkflowStore.setState({
      nodes: [func1('1.0.0'), outerLog('log-a', 'log1')] as unknown as never,
    } as Partial<StoreState>)
    expect(hasEditModeNodes()).toBe(false)
  })

  function localWrapping(inner: AnyNode): AnyNode {
    return {
      id: 'outer',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Outer',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [inner], edges: [] }, inputs: [], outputs: [], variables: [] },
      },
    }
  }

  it('returns true when an edit-mode Function is nested inside a local Function body', () => {
    useWorkflowStore.setState({
      nodes: [localWrapping(func1('1.0.0', { editMode: true }))] as unknown as never,
    } as Partial<StoreState>)
    expect(hasEditModeNodes()).toBe(true)
  })

  it('returns false when a nested local Function body has no edit-mode node', () => {
    useWorkflowStore.setState({
      nodes: [localWrapping(func1('1.0.0'))] as unknown as never,
    } as Partial<StoreState>)
    expect(hasEditModeNodes()).toBe(false)
  })
})
