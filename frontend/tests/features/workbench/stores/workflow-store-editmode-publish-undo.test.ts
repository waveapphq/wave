/**
 * Workflow Store - edit-mode publish PICK-OUT surgery (REQ-5.2.1.24).
 *
 * Publishing an edit-mode draft is NOT an undoable action. It performs a
 * per-entry session collapse on the timeline:
 *
 *   - every RETAINED history entry is normalized so the published Function
 *     (including changes nested anywhere inside its body) appears in its
 *     pre-session pinned form; entries that become no-ops dedup away;
 *   - unrelated changes (root edits, other Functions) REMAIN individually
 *     undoable - including entries INTERLEAVED with the edit session (the
 *     old whole-entry filtering lost them);
 *   - keep-old appends NOTHING; set-new appends exactly ONE undoable
 *     version-change entry at the tip;
 *   - every surgery truncates the redo tail;
 *   - the instance's input fields and output bindings are reconciled against
 *     the target version's contract; mismatched fields are dropped with their
 *     flags, and each choice-list or true / false input the new version adds
 *     is written with its default (FNCFG-9).
 *
 * Contract surface defined by these tests:
 *   applyEditModePublished(nodeId, nodeData, opts) with
 *   opts: { mode: 'keep-old' | 'set-new',
 *           targetContract?: { inputs: { name: string }[],
 *                              outputs: { name: string }[] } }
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

interface AnyNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

interface TargetContract {
  inputs: { name: string; type?: string; enumValues?: unknown[]; default?: unknown; required?: boolean }[]
  outputs: { name: string }[]
}

type StoreState = ReturnType<typeof useWorkflowStore.getState>

type PublishWithOpts = (
  nodeId: string,
  nodeData: Record<string, unknown>,
  opts?: { mode: 'keep-old' | 'set-new'; targetContract?: TargetContract },
) => void

function publishAction(): PublishWithOpts {
  return useWorkflowStore.getState().applyEditModePublished as unknown as PublishWithOpts
}

function func1(
  version: string,
  opts: {
    editMode?: boolean
    innerLog?: boolean
    stampedInner?: boolean
    /** Input fields held as expressions (input name -> expression text). */
    inputValues?: Record<string, string>
    outputBindings?: Record<string, string>
  } = {},
): AnyNode {
  const data: Record<string, unknown> = {
    label: 'Func1',
    nodeType: 'function',
    elementType: 'function',
    functionLifecycle: 'shared',
    functionId: 'F1',
    functionVersion: version,
  }
  if (opts.inputValues) data.expressionFields = Object.keys(opts.inputValues)
  if (opts.inputValues || opts.outputBindings) {
    data.config = { values: opts.inputValues ?? {}, profileBindings: [], outputBindings: opts.outputBindings ?? {} }
  }
  if (opts.editMode) {
    data.editMode = true
    data.upstreamLink = { functionId: 'F1', sourceVersion: version }
    data.draft = {
      name: 'Func1',
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: {
        nodes: opts.innerLog
          ? [{ id: 'inner-log', type: 'workflowNode', data: { label: 'log3', nodeType: 'plugin' } }]
          : [],
        edges: [],
      },
    }
  }
  if (opts.stampedInner) {
    data.localDefinition = {
      workflow: {
        nodes: [
          {
            id: 'drilled-inner',
            type: 'workflowNode',
            position: { x: 0, y: 0 },
            data: { label: 'drilled', nodeType: 'plugin' },
          },
        ],
        edges: [],
      },
      inputs: [],
      outputs: [],
      variables: [],
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

function histEntry(
  nodes: AnyNode[],
  operationDescription: string,
  isInitialState = false,
): Record<string, unknown> {
  return {
    nodes,
    edges: [],
    variables: [],
    timestamp: 1,
    operationDescription,
    ...(isInitialState ? { isInitialState } : {}),
  }
}

/** Saved-Test canvas mid-edit-session with an unrelated edit BETWEEN the
 *  in-session entries. */
function seedInterleavedEditSession(): void {
  const baseNodes = [func1('1.0.0'), outerLog('log-a', 'a0'), outerLog('log-b', 'b0')]
  const enterEdit = [func1('1.0.0', { editMode: true }), outerLog('log-a', 'a0'), outerLog('log-b', 'b0')]
  const interleaved = [func1('1.0.0', { editMode: true }), outerLog('log-a', 'a1'), outerLog('log-b', 'b0')]
  const innerEdit = [
    func1('1.0.0', { editMode: true, innerLog: true, stampedInner: true }),
    outerLog('log-a', 'a1'),
    outerLog('log-b', 'b0'),
  ]
  const interleaved2 = [
    func1('1.0.0', { editMode: true, innerLog: true, stampedInner: true }),
    outerLog('log-a', 'a1'),
    outerLog('log-b', 'b1'),
  ]
  useWorkflowStore.setState({
    nodes: interleaved2 as unknown as never,
    edges: [] as unknown as never,
    variables: [] as never,
    drillPath: [],
    editingTestId: 'test-1',
    isDirty: true,
    maxHistoryLength: 50,
    history: [
      histEntry(baseNodes, 'baseline', true),
      histEntry(enterEdit, 'Enter edit mode'),
      histEntry(interleaved, 'Log A msg'),
      histEntry(innerEdit, 'Add block'),
      histEntry(interleaved2, 'Log B msg'),
    ] as unknown as never,
    historyIndex: 4,
  } as Partial<StoreState>)
}

function getFunc1(): AnyNode | undefined {
  return useWorkflowStore.getState().nodes.find((n) => n.id === 'func1') as unknown as
    | AnyNode
    | undefined
}

beforeEach(() => {
  seedInterleavedEditSession()
})

describe('applyEditModePublished set-new - re-pin + dirty', () => {
  it('re-pins the node to the new version and clears the draft and stamp', () => {
    publishAction()('func1', cleanFunc1Data('1.0.1'), { mode: 'set-new' })
    const node = getFunc1()
    expect(node?.data.functionVersion).toBe('1.0.1')
    expect(node?.data.editMode).toBeFalsy()
    expect(node?.data.draft).toBeUndefined()
    expect(node?.data.localDefinition).toBeUndefined()
  })

  it('leaves the canvas dirty (publish does NOT force a save)', () => {
    publishAction()('func1', cleanFunc1Data('1.0.1'), { mode: 'set-new' })
    expect(useWorkflowStore.getState().isDirty).toBe(true)
  })
})

describe('applyEditModePublished set-new - pick-out keeps interleaved unrelated entries', () => {
  it('retains the unrelated interleaved entries and appends exactly ONE flip at the tip', () => {
    publishAction()('func1', cleanFunc1Data('1.0.1'), { mode: 'set-new' })
    const state = useWorkflowStore.getState()
    expect(state.history.map((e) => e.operationDescription)).toEqual([
      'baseline',
      'Log A msg',
      'Log B msg',
      'Func1 ver changed (1.0.0 -> 1.0.1)',
    ])
    expect(state.historyIndex).toBe(3)
  })

  it('normalizes the Function (nested changes included) in every retained entry', () => {
    publishAction()('func1', cleanFunc1Data('1.0.1'), { mode: 'set-new' })
    const state = useWorkflowStore.getState()
    const tipIndex = state.historyIndex
    for (const [i, entry] of state.history.entries()) {
      const fn = (entry.nodes as unknown as AnyNode[]).find((n) => n.id === 'func1')
      expect(fn?.data.editMode, `entry ${i}`).toBeFalsy()
      expect(fn?.data.draft, `entry ${i}`).toBeUndefined()
      expect(fn?.data.localDefinition, `entry ${i}`).toBeUndefined()
      // Retained entries hold the pre-session pin; only the tip holds the new pin.
      expect(fn?.data.functionVersion).toBe(i === tipIndex ? '1.0.1' : '1.0.0')
    }
  })

  it('undo walks the retained unrelated entries on a clean reference', () => {
    publishAction()('func1', cleanFunc1Data('1.0.1'), { mode: 'set-new' })

    // Undo 1: leave the flip -> old pin, unrelated edits intact.
    useWorkflowStore.getState().undo()
    expect(getFunc1()?.data.functionVersion).toBe('1.0.0')
    expect(getFunc1()?.data.draft).toBeUndefined()
    let logB = useWorkflowStore.getState().nodes.find((n) => n.id === 'log-b')
    expect(logB?.data.label).toBe('b1')

    // Undo 2: revert the interleaved Log B edit.
    useWorkflowStore.getState().undo()
    logB = useWorkflowStore.getState().nodes.find((n) => n.id === 'log-b')
    expect(logB?.data.label).toBe('b0')

    // Undo 3: revert the interleaved Log A edit -> baseline.
    useWorkflowStore.getState().undo()
    const logA = useWorkflowStore.getState().nodes.find((n) => n.id === 'log-a')
    expect(logA?.data.label).toBe('a0')
    expect(useWorkflowStore.getState().canUndo()).toBe(false)
  })

  it('redo re-pins the instance to the published version', () => {
    publishAction()('func1', cleanFunc1Data('1.0.1'), { mode: 'set-new' })
    useWorkflowStore.getState().undo()
    useWorkflowStore.getState().redo()
    expect(getFunc1()?.data.functionVersion).toBe('1.0.1')
  })
})

describe('applyEditModePublished keep-old - surgery only, NO entry', () => {
  it('normalizes to the old pin and appends NO version-change entry', () => {
    publishAction()('func1', cleanFunc1Data('1.0.0'), { mode: 'keep-old' })
    const state = useWorkflowStore.getState()
    expect(state.history.map((e) => e.operationDescription)).toEqual([
      'baseline',
      'Log A msg',
      'Log B msg',
    ])
    expect(state.history.some((e) => /ver changed/.test(e.operationDescription ?? ''))).toBe(false)
    const node = getFunc1()
    expect(node?.data.functionVersion).toBe('1.0.0')
    expect(node?.data.editMode).toBeFalsy()
    expect(node?.data.draft).toBeUndefined()
  })

  it('keeps the canvas equal to the history tip after the collapse', () => {
    publishAction()('func1', cleanFunc1Data('1.0.0'), { mode: 'keep-old' })
    const state = useWorkflowStore.getState()
    expect(state.historyIndex).toBe(state.history.length - 1)
    const tip = state.history[state.historyIndex]
    expect(tip.nodes.map((n) => n.id)).toEqual(state.nodes.map((n) => n.id))
  })
})

describe('pick-out surgery truncates the redo tail', () => {
  it('keep-old publish from a mid-stack pointer discards the redoable future', () => {
    useWorkflowStore.getState().undo()
    expect(useWorkflowStore.getState().canRedo()).toBe(true)

    publishAction()('func1', cleanFunc1Data('1.0.0'), { mode: 'keep-old' })

    const state = useWorkflowStore.getState()
    expect(state.canRedo()).toBe(false)
    // The undone Log B edit was in the discarded future, not in retained history.
    expect(state.history.some((e) => e.operationDescription === 'Log B msg')).toBe(false)
  })

  it('set-new publish from a mid-stack pointer discards the redoable future', () => {
    useWorkflowStore.getState().undo()
    publishAction()('func1', cleanFunc1Data('1.0.1'), { mode: 'set-new' })

    const state = useWorkflowStore.getState()
    const tip = state.history[state.historyIndex]
    expect(tip.operationDescription).toMatch(/ver changed/)
    expect(state.canRedo()).toBe(false)
    expect(state.history.some((e) => e.operationDescription === 'Log B msg')).toBe(false)
  })
})

describe('field reconciliation on pin transitions (FNCFG-9)', () => {
  function seedWithBindings(): void {
    const editing = func1('1.0.0', {
      editMode: true,
      inputValues: { kept_in: 'expr_a', dropped_in: 'expr_b' },
      outputBindings: { kept_out: 'var_a', dropped_out: 'var_b' },
    })
    const base = func1('1.0.0', {
      inputValues: { kept_in: 'expr_a', dropped_in: 'expr_b' },
      outputBindings: { kept_out: 'var_a', dropped_out: 'var_b' },
    })
    useWorkflowStore.setState({
      nodes: [editing] as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      isDirty: true,
      maxHistoryLength: 50,
      history: [
        histEntry([base], 'baseline', true),
        histEntry([editing], 'Enter edit mode'),
      ] as unknown as never,
      historyIndex: 1,
    } as Partial<StoreState>)
  }

  const narrowContract: TargetContract = {
    inputs: [{ name: 'kept_in' }],
    outputs: [{ name: 'kept_out' }],
  }

  function fieldsOf(node: AnyNode | undefined) {
    const config = node?.data.config as { values?: Record<string, unknown>; outputBindings?: Record<string, string> } | undefined
    return { values: config?.values, expressionFields: node?.data.expressionFields, outputBindings: config?.outputBindings }
  }

  it('set-new drops instance fields that mismatch the new version contract, with their flags', () => {
    seedWithBindings()
    publishAction()('func1', cleanFunc1Data('1.1.0'), {
      mode: 'set-new',
      targetContract: narrowContract,
    })
    expect(fieldsOf(getFunc1())).toEqual({
      values: { kept_in: 'expr_a' },
      expressionFields: ['kept_in'],
      outputBindings: { kept_out: 'var_a' },
    })
  })

  it('keep-old drops instance fields that mismatch the kept version contract, with their flags', () => {
    seedWithBindings()
    publishAction()('func1', cleanFunc1Data('1.0.0'), {
      mode: 'keep-old',
      targetContract: narrowContract,
    })
    expect(fieldsOf(getFunc1())).toEqual({
      values: { kept_in: 'expr_a' },
      expressionFields: ['kept_in'],
      outputBindings: { kept_out: 'var_a' },
    })
  })

  it('undo of the version flip restores the prior fields; redo drops them again', () => {
    seedWithBindings()
    publishAction()('func1', cleanFunc1Data('1.1.0'), {
      mode: 'set-new',
      targetContract: narrowContract,
    })

    useWorkflowStore.getState().undo()
    let node = getFunc1()
    expect(node?.data.functionVersion).toBe('1.0.0')
    expect(fieldsOf(node).values).toEqual({ kept_in: 'expr_a', dropped_in: 'expr_b' })

    useWorkflowStore.getState().redo()
    node = getFunc1()
    expect(node?.data.functionVersion).toBe('1.1.0')
    expect(fieldsOf(node).values).toEqual({ kept_in: 'expr_a' })
  })
})

describe('a published version adds choice-list and true / false inputs (FNCFG-9, REQ-3.1.2.10)', () => {
  const PINNED_INPUTS = [{ name: 'kept_in', type: 'string' }]
  const OUTPUTS = [{ name: 'kept_out' }]
  const NEXT_INPUTS = [
    { name: 'kept_in', type: 'string' },
    { name: 'tier', type: 'string', required: true, enumValues: ['gold', 'silver'], default: 'silver' },
    { name: 'verbose', type: 'boolean', required: false, default: false },
    { name: 'note', type: 'string', required: false, default: 'hello' },
  ]

  /** A Shared Block in edit mode, stamped with the contract of the version it pins. */
  function seedWithPinnedContract(pinnedInputs: TargetContract['inputs']): void {
    const stamp = { resolvedInputs: pinnedInputs, resolvedOutputs: OUTPUTS }
    const editing = func1('1.0.0', { editMode: true, inputValues: { kept_in: 'expr_a' }, outputBindings: { kept_out: 'var_a' } })
    const base = func1('1.0.0', { inputValues: { kept_in: 'expr_a' }, outputBindings: { kept_out: 'var_a' } })
    Object.assign(editing.data, stamp)
    Object.assign(base.data, stamp)
    useWorkflowStore.setState({
      nodes: [editing] as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      isDirty: true,
      maxHistoryLength: 50,
      history: [
        histEntry([base], 'baseline', true),
        histEntry([editing], 'Enter edit mode'),
      ] as unknown as never,
      historyIndex: 1,
    } as Partial<StoreState>)
  }

  function publishSetNew(): void {
    publishAction()(
      'func1',
      { ...cleanFunc1Data('1.1.0'), resolvedInputs: NEXT_INPUTS, resolvedOutputs: OUTPUTS },
      { mode: 'set-new', targetContract: { inputs: NEXT_INPUTS, outputs: OUTPUTS } },
    )
  }

  function valuesOfFunc1(): Record<string, unknown> | undefined {
    return (getFunc1()?.data.config as { values?: Record<string, unknown> } | undefined)?.values
  }

  it('set-new writes the default of each new choice-list and true / false input, and nothing for a free-entry one', () => {
    seedWithPinnedContract(PINNED_INPUTS)

    publishSetNew()

    expect(valuesOfFunc1()).toEqual({ kept_in: 'expr_a', tier: 'silver', verbose: false })
    expect(getFunc1()?.data.expressionFields).toEqual(['kept_in'])
  })

  it('undo of the version flip removes the written defaults; redo writes them again', () => {
    seedWithPinnedContract(PINNED_INPUTS)
    publishSetNew()

    useWorkflowStore.getState().undo()
    expect(valuesOfFunc1()).toEqual({ kept_in: 'expr_a' })

    useWorkflowStore.getState().redo()
    expect(valuesOfFunc1()).toEqual({ kept_in: 'expr_a', tier: 'silver', verbose: false })
  })

  it('keep-old writes nothing for a choice-list input the kept version already had', () => {
    seedWithPinnedContract(NEXT_INPUTS)

    publishAction()('func1', cleanFunc1Data('1.0.0'), {
      mode: 'keep-old',
      targetContract: { inputs: NEXT_INPUTS, outputs: OUTPUTS },
    })

    expect(valuesOfFunc1()).toEqual({ kept_in: 'expr_a' })
  })
})

describe('applyEditModePublished - nested + fallback coverage', () => {
  function findDeep(nodes: AnyNode[], id: string): AnyNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node
      const inner = (
        node.data.localDefinition as { workflow?: { nodes?: AnyNode[] } } | undefined
      )?.workflow?.nodes
      if (inner) {
        const found = findDeep(inner, id)
        if (found) return found
      }
    }
    return undefined
  }

  it('re-pins a nested edit-mode Function (deep walk into localDefinition bodies)', () => {
    const inner = func1('1.0.0', { editMode: true })
    const outer: AnyNode = {
      id: 'outer',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Outer',
        nodeType: 'function',
        elementType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          name: 'Outer',
          inputs: [],
          outputs: [],
          dependencies: { functions: [], plugins: [] },
          workflow: { nodes: [inner], edges: [] },
        },
      },
    }
    useWorkflowStore.setState({
      nodes: [outer] as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      maxHistoryLength: 50,
      history: [histEntry([outer], 'baseline', true)] as unknown as never,
      historyIndex: 0,
    } as Partial<StoreState>)

    publishAction()('func1', cleanFunc1Data('1.0.1'), { mode: 'set-new' })
    const node = findDeep(useWorkflowStore.getState().nodes as unknown as AnyNode[], 'func1')
    expect(node?.data.functionVersion).toBe('1.0.1')
    expect(node?.data.editMode).toBeFalsy()
    expect(node?.data.draft).toBeUndefined()
  })

  it('labels the version-flip "Function" when neither nodeData nor the node carry a label', () => {
    const node: AnyNode = {
      id: 'nolabel',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'function',
        elementType: 'function',
        functionLifecycle: 'shared',
        functionId: 'F1',
        functionVersion: '1.0.0',
        editMode: true,
        upstreamLink: { functionId: 'F1', sourceVersion: '1.0.0' },
        draft: {
          name: '',
          inputs: [],
          outputs: [],
          dependencies: { functions: [], plugins: [] },
          workflow: { nodes: [], edges: [] },
        },
      },
    }
    useWorkflowStore.setState({
      nodes: [node] as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      maxHistoryLength: 50,
      history: [histEntry([node], 'baseline', true)] as unknown as never,
      historyIndex: 0,
    } as Partial<StoreState>)

    publishAction()('nolabel', { functionVersion: '1.0.1' }, { mode: 'set-new' })
    const state = useWorkflowStore.getState()
    const tip = state.history[state.historyIndex]
    expect(tip.operationDescription ?? '').toMatch(/^Function ver changed/)
  })

  it('tolerates an absent node + version-less nodeData (current/version fallbacks)', () => {
    useWorkflowStore.setState({
      nodes: [outerLog('keep', 'log1')] as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      maxHistoryLength: 50,
      history: [histEntry([outerLog('keep', 'log1')], 'baseline', true)] as unknown as never,
      historyIndex: 0,
    } as Partial<StoreState>)

    expect(() =>
      publishAction()('ghost', { label: 'X' }, { mode: 'set-new' }),
    ).not.toThrow()
  })

  it('cap eviction after the flip keeps the baseline entry', () => {
    const editing = func1('1.0.0', { editMode: true })
    useWorkflowStore.setState({
      nodes: [editing] as unknown as never,
      edges: [] as unknown as never,
      variables: [] as never,
      drillPath: [],
      maxHistoryLength: 2,
      history: [
        histEntry([func1('1.0.0')], 'baseline', true),
        histEntry([outerLog('log-x', 'x1'), func1('1.0.0')], 'Add block'),
        histEntry([editing], 'Enter edit mode'),
      ] as unknown as never,
      historyIndex: 2,
    } as Partial<StoreState>)

    publishAction()('func1', cleanFunc1Data('1.0.1'), { mode: 'set-new' })
    const state = useWorkflowStore.getState()
    expect(state.history.length).toBeLessThanOrEqual(2)
    expect(state.history[0].isInitialState).toBe(true)
  })
})
