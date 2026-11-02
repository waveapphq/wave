/**
 * Workflow Store History Refactor Tests
 *
 * Unit tests that define the contract of the post-state baseline undo/redo
 * model.
 *
 * Model summary:
 * - `history` is a linear timeline of full canvas snapshots.
 * - `history[0]` is the baseline (loaded test, empty draft, or last save).
 *   It carries `isInitialState: true`.
 * - The canvas always equals `history[historyIndex]`.
 * - `undo()` is `index--; restore`; `redo()` is `index++; restore`.
 * - Every user-visible mutation produces exactly one history entry, except
 *   no-displacement drag (zero entries) and transactions (one entry for the
 *   whole batch).
 * - `commitHistory` (was `pushHistory`) is called AFTER the mutation.
 * - `canUndo()` is `historyIndex > 0`; `canRedo()` is `historyIndex < history.length - 1`.
 * - `HistoryEntry` carries `variables` so variable edits are undoable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  HistoryEntry,
  NodeType,
  EdgeType,
  WorkflowVariable,
} from '@/features/workbench/stores/workflow-store'

function makeBaseline(
  nodes: NodeType[] = [],
  edges: EdgeType[] = [],
  variables: WorkflowVariable[] = [],
): HistoryEntry {
  return {
    nodes: [...nodes],
    edges: [...edges],
    variables: [...variables],
    timestamp: Date.now(),
    operationDescription: 'Saved baseline',
    isInitialState: true,
  }
}

function makeBlock(
  id: string,
  overrides: Partial<NodeType> = {},
): NodeType {
  return {
    id,
    type: 'block',
    position: { x: 0, y: 0 },
    data: { label: `Block ${id}` },
    ...overrides,
  }
}

function makeNote(
  id: string,
  text: string = 'Original note',
  color: string = 'yellow',
): NodeType {
  return {
    id,
    type: 'noteNode',
    position: { x: 0, y: 0 },
    data: {
      label: text,
      config: { color },
    },
  }
}

function makeEdge(id: string, source: string, target: string): EdgeType {
  return { id, source, target }
}

function makeVariable(
  id: string,
  name: string,
  value: unknown = '',
  type: WorkflowVariable['type'] = 'string',
): WorkflowVariable {
  return { id, name, value, type }
}

describe('Workflow Store - History Refactor (post-state baseline model)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('User scenario: 4-step undo/redo round trip', () => {
    /**
     * Drop a log block (auto-connects an edge),
     * edit config msg=123 + save, edit config msg=abc + save. That sequence
     * must yield exactly 4 undo entries above the baseline that bounce
     * cleanly with 4 redos.
     */
    it('produces 4 entries above baseline and bounces cleanly through undo/redo', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const startNode = makeBlock('start', {
        position: { x: 0, y: 0 },
        data: { label: 'Start' },
      })
      const baseline = makeBaseline([startNode], [], [])

      useWorkflowStore.setState({
        nodes: [startNode],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
        isDirty: false,
      })

      const logNode = makeBlock('log-1', {
        type: 'block',
        position: { x: 200, y: 0 },
        data: {
          label: 'Log',
          elementType: 'log',
          config: { values: { msg: '' } },
        },
      })
      const autoEdge = makeEdge('e-start-log', 'start', 'log-1')

      // 1: drop log block (addNode commit)
      useWorkflowStore.getState().addNode(logNode)
      // 2: auto-connect (addEdge commit)
      useWorkflowStore.getState().addEdge(autoEdge)
      // 3: config save msg=123 (one transaction commit)
      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().updateNode('log-1', {
          data: {
            label: 'Log',
            elementType: 'log',
            config: { values: { msg: '123' } },
          },
        })
      }, 'Edit configuration')
      // 4: config save msg=abc (one transaction commit)
      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().updateNode('log-1', {
          data: {
            label: 'Log',
            elementType: 'log',
            config: { values: { msg: 'abc' } },
          },
        })
      }, 'Edit configuration')

      // Baseline + 4 commits = 5 entries
      expect(useWorkflowStore.getState().history.length).toBe(5)
      expect(useWorkflowStore.getState().historyIndex).toBe(4)

      const valuesAt = (i: number) =>
        ((useWorkflowStore.getState().history[i].nodes.find(
          (n) => n.id === 'log-1',
        )?.data.config) as { values?: { msg?: string } } | undefined)?.values
          ?.msg

      // Sanity: the entries record post-state of each op.
      expect(valuesAt(3)).toBe('123')
      expect(valuesAt(4)).toBe('abc')

      // Undo 4 times - each click changes the canvas meaningfully
      useWorkflowStore.getState().undo() // index 3: msg=123
      expect(useWorkflowStore.getState().historyIndex).toBe(3)
      const after1 = useWorkflowStore.getState().nodes.find((n) => n.id === 'log-1')
      expect(((after1?.data.config) as { values: { msg: string } }).values.msg).toBe('123')

      useWorkflowStore.getState().undo() // index 2: msg cleared (post-addEdge state)
      expect(useWorkflowStore.getState().historyIndex).toBe(2)
      const after2 = useWorkflowStore.getState().nodes.find((n) => n.id === 'log-1')
      expect(((after2?.data.config) as { values: { msg: string } }).values.msg).toBe('')

      useWorkflowStore.getState().undo() // index 1: edge gone
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().edges.find((e) => e.id === 'e-start-log')).toBeUndefined()
      expect(useWorkflowStore.getState().nodes.find((n) => n.id === 'log-1')).toBeDefined()

      useWorkflowStore.getState().undo() // index 0: node gone (back to baseline)
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().nodes.find((n) => n.id === 'log-1')).toBeUndefined()
      expect(useWorkflowStore.getState().nodes).toEqual([startNode])
      expect(useWorkflowStore.getState().isDirty).toBe(false) // baseline isInitialState

      // Redo 4 times - canvas walks back to fully configured
      useWorkflowStore.getState().redo() // index 1: log node added
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().nodes.find((n) => n.id === 'log-1')).toBeDefined()

      useWorkflowStore.getState().redo() // index 2: edge added
      expect(useWorkflowStore.getState().historyIndex).toBe(2)
      expect(useWorkflowStore.getState().edges.find((e) => e.id === 'e-start-log')).toBeDefined()

      useWorkflowStore.getState().redo() // index 3: msg=123
      expect(useWorkflowStore.getState().historyIndex).toBe(3)
      const afterRedo3 = useWorkflowStore.getState().nodes.find((n) => n.id === 'log-1')
      expect(((afterRedo3?.data.config) as { values: { msg: string } }).values.msg).toBe('123')

      useWorkflowStore.getState().redo() // index 4: msg=abc
      expect(useWorkflowStore.getState().historyIndex).toBe(4)
      const afterRedo4 = useWorkflowStore.getState().nodes.find((n) => n.id === 'log-1')
      expect(((afterRedo4?.data.config) as { values: { msg: string } }).values.msg).toBe('abc')
    })
  })

  describe('Drag operation', () => {
    it('produces exactly 1 history entry above baseline and undo restores pre-drag positions', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const node = makeBlock('drag-me', { position: { x: 0, y: 0 } })
      const baseline = makeBaseline([node])

      useWorkflowStore.setState({
        nodes: [node],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      useWorkflowStore.getState().startDragOperation()
      // Multiple position deltas during drag
      useWorkflowStore.getState().setNodes(
        [{ ...node, position: { x: 25, y: 25 } }],
      )
      useWorkflowStore.getState().setNodes(
        [{ ...node, position: { x: 75, y: 75 } }],
      )
      useWorkflowStore.getState().setNodes(
        [{ ...node, position: { x: 100, y: 100 } }],
      )
      useWorkflowStore.getState().endDragOperation()

      // Baseline + 1 drag commit
      expect(useWorkflowStore.getState().history.length).toBe(2)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().nodes[0].position).toEqual({ x: 100, y: 100 })
      // Post-state baseline model: history[1] IS the post-drag snapshot.
      expect(useWorkflowStore.getState().history[1].nodes[0].position).toEqual({ x: 100, y: 100 })

      // Undo restores the pre-drag positions
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 })

      // Redo restores the post-drag positions (only correct under post-state model)
      useWorkflowStore.getState().redo()
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().nodes[0].position).toEqual({ x: 100, y: 100 })
    })
  })

  describe('Round-trip stability', () => {
    it('undo→redo→undo lands back on the baseline state', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const baseline = makeBaseline([])
      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      const node = makeBlock('round-trip', { position: { x: 50, y: 50 } })
      useWorkflowStore.getState().addNode(node)

      // baseline + 1 op
      expect(useWorkflowStore.getState().history.length).toBe(2)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().nodes).toHaveLength(1)

      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().nodes).toEqual([])

      useWorkflowStore.getState().redo()
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().nodes).toHaveLength(1)

      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().nodes).toEqual([])
    })
  })

  describe('Click-twice regression', () => {
    /**
     * Every undo click moves the pointer AND restores state, so the first click
     * does the work and any further clicks at the baseline are silent no-ops.
     */
    it('first undo does the work; subsequent undos at baseline are no-ops', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const baseline = makeBaseline([])
      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      const node = makeBlock('only-block', { position: { x: 10, y: 10 } })
      useWorkflowStore.getState().addNode(node)

      expect(useWorkflowStore.getState().nodes).toHaveLength(1)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)

      // First click: real undo
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().nodes).toHaveLength(0)
      expect(useWorkflowStore.getState().historyIndex).toBe(0)

      // Second click: must be a no-op (no invisible re-restore step)
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().nodes).toHaveLength(0)
      expect(useWorkflowStore.getState().historyIndex).toBe(0)

      // Third click: still a no-op
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().nodes).toHaveLength(0)
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
    })
  })

  describe('updateNode wrapped in transaction', () => {
    it('produces exactly 1 history entry above baseline; undo restores prior data', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const node = makeBlock('node-1', {
        data: { label: 'Original', config: { values: { x: 1 } } },
      })
      const baseline = makeBaseline([node])

      useWorkflowStore.setState({
        nodes: [node],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().updateNode('node-1', {
          data: { label: 'Edited', config: { values: { x: 2 } } },
        })
      }, 'Edit configuration')

      expect(useWorkflowStore.getState().history.length).toBe(2)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Edited')
      // Post-state baseline model: history[1] IS the post-edit snapshot.
      expect(useWorkflowStore.getState().history[1].nodes[0].data.label).toBe('Edited')

      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Original')
      const restoredConfig = useWorkflowStore.getState().nodes[0].data.config as {
        values: { x: number }
      }
      expect(restoredConfig.values.x).toBe(1)

      // Redo restores the edited state (only correct under post-state model)
      useWorkflowStore.getState().redo()
      expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Edited')
      const redoConfig = useWorkflowStore.getState().nodes[0].data.config as {
        values: { x: number }
      }
      expect(redoConfig.values.x).toBe(2)
    })
  })

  describe('enableAll', () => {
    it('produces a history entry; undo restores the disabled flags', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const n1 = makeBlock('n1', { data: { label: 'N1', disabled: true } })
      const n2 = makeBlock('n2', { data: { label: 'N2', disabled: true } })
      const baseline = makeBaseline([n1, n2])

      useWorkflowStore.setState({
        nodes: [n1, n2],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      useWorkflowStore.getState().enableAll()

      expect(useWorkflowStore.getState().history.length).toBe(2)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(
        useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')?.data.disabled,
      ).toBe(false)
      expect(
        useWorkflowStore.getState().nodes.find((n) => n.id === 'n2')?.data.disabled,
      ).toBe(false)

      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(
        useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')?.data.disabled,
      ).toBe(true)
      expect(
        useWorkflowStore.getState().nodes.find((n) => n.id === 'n2')?.data.disabled,
      ).toBe(true)
    })
  })

  describe('updateVariable', () => {
    it('produces a history entry; undo restores prior value', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const variable = makeVariable('var-1', 'count', 5, 'integer')
      const baseline = makeBaseline([], [], [variable])

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [variable],
        history: [baseline],
        historyIndex: 0,
      })

      useWorkflowStore.getState().updateVariable('var-1', { value: 99 })

      expect(useWorkflowStore.getState().history.length).toBe(2)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().variables[0].value).toBe(99)

      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().variables[0].value).toBe(5)
    })
  })

  describe('Variable-deletion cascade', () => {
    /**
     * confirmVariableDelete wraps the node-binding clear
     * AND removeVariable in a single transaction so undo restores both at
     * once.
     */
    it('produces exactly 1 history entry; undo restores variable AND node bindings', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const boundVar = makeVariable('var-1', 'shared', '', 'string')
      const consumer = makeBlock('consumer', {
        data: {
          label: 'Consumer',
          config: { outputBindings: { result: 'shared' } },
        },
      })
      const baseline = makeBaseline([consumer], [], [boundVar])

      useWorkflowStore.setState({
        nodes: [consumer],
        edges: [],
        variables: [boundVar],
        history: [baseline],
        historyIndex: 0,
      })

      const cleared = [
        {
          ...consumer,
          data: {
            ...consumer.data,
            config: { outputBindings: {} },
          },
        },
      ]

      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().setNodes(cleared)
        useWorkflowStore.getState().removeVariable('var-1')
      }, 'Delete variable')

      // Baseline + 1 transaction
      expect(useWorkflowStore.getState().history.length).toBe(2)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().variables).toHaveLength(0)
      const afterConfig = useWorkflowStore.getState().nodes[0].data.config as {
        outputBindings: Record<string, string>
      }
      expect(afterConfig.outputBindings).toEqual({})

      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().variables).toHaveLength(1)
      expect(useWorkflowStore.getState().variables[0].name).toBe('shared')
      const restoredConfig = useWorkflowStore.getState().nodes[0].data.config as {
        outputBindings: Record<string, string>
      }
      expect(restoredConfig.outputBindings).toEqual({ result: 'shared' })
    })
  })

  describe('No-displacement drag', () => {
    /**
     * A drag with zero net displacement does not create a
     * history entry. The user's intent was effectively a click, not a move.
     */
    it('does not commit a history entry when nodes/edges are unchanged at endDragOperation', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const node = makeBlock('still', { position: { x: 0, y: 0 } })
      const baseline = makeBaseline([node])

      useWorkflowStore.setState({
        nodes: [node],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      useWorkflowStore.getState().startDragOperation()
      // No setNodes call - position unchanged
      useWorkflowStore.getState().endDragOperation()

      // Baseline only
      expect(useWorkflowStore.getState().history.length).toBe(1)
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
    })
  })

  describe('Note text edit', () => {
    /**
     * Mirrors note-node.commitEdit: updateNode followed by a manual
     * commitHistory('Edit note text'). This test only validates the
     * store-side contract.
     */
    it('updateNode + commitHistory produces 1 entry; undo restores prior text', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const note = makeNote('note-1', 'Original note', 'yellow')
      const baseline = makeBaseline([note])

      useWorkflowStore.setState({
        nodes: [note],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      useWorkflowStore.getState().updateNode('note-1', {
        data: { label: 'Edited note', config: { color: 'yellow' } },
      })
      useWorkflowStore.getState().commitHistory('Edit note text')

      expect(useWorkflowStore.getState().history.length).toBe(2)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Edited note')

      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Original note')
    })
  })

  describe('Note color change', () => {
    it('updateNode + commitHistory produces 1 entry; undo restores prior color', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const note = makeNote('note-1', 'My note', 'yellow')
      const baseline = makeBaseline([note])

      useWorkflowStore.setState({
        nodes: [note],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      useWorkflowStore.getState().updateNode('note-1', {
        data: { label: 'My note', config: { color: 'pink' } },
      })
      useWorkflowStore.getState().commitHistory('Change note color')

      expect(useWorkflowStore.getState().history.length).toBe(2)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(
        (useWorkflowStore.getState().nodes[0].data.config as { color: string }).color,
      ).toBe('pink')

      useWorkflowStore.getState().undo()
      expect(
        (useWorkflowStore.getState().nodes[0].data.config as { color: string }).color,
      ).toBe('yellow')
    })
  })

  describe('markSaved floors the undo stack', () => {
    /**
     * After markSaved, history is exactly [baseline] with
     * isInitialState: true and historyIndex 0. canUndo() === false. The
     * REQ-5.2.1.24 user-facing contract is preserved while the internal
     * mechanism switches from "clear to empty" to "seed with baseline".
     */
    it('three ops, then save, then one op; cannot undo past save', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const baseline = makeBaseline([])
      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      useWorkflowStore.getState().addNode(makeBlock('a'))
      useWorkflowStore.getState().addNode(makeBlock('b'))
      useWorkflowStore.getState().addNode(makeBlock('c'))

      // 3 ops above baseline = 4 entries
      expect(useWorkflowStore.getState().history.length).toBe(4)
      expect(useWorkflowStore.getState().historyIndex).toBe(3)
      expect(useWorkflowStore.getState().canUndo()).toBe(true)

      useWorkflowStore.getState().markSaved()

      // Save floors to a single baseline entry seeded from current state
      expect(useWorkflowStore.getState().history.length).toBe(1)
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().history[0].isInitialState).toBe(true)
      expect(useWorkflowStore.getState().canUndo()).toBe(false)
      expect(useWorkflowStore.getState().canRedo()).toBe(false)

      // Make one more edit
      useWorkflowStore.getState().addNode(makeBlock('d'))
      expect(useWorkflowStore.getState().canUndo()).toBe(true)

      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().canUndo()).toBe(false)
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      // Cannot undo further (back to saved baseline)
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
    })
  })

  describe('reset floors to empty baseline', () => {
    it('after reset: empty canvas, single baseline entry, cannot undo or redo', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      useWorkflowStore.setState({
        nodes: [makeBlock('x')],
        edges: [makeEdge('e1', 'x', 'y')],
        variables: [makeVariable('v1', 'a', 1, 'integer')],
        history: [makeBaseline([makeBlock('x')])],
        historyIndex: 0,
        isDirty: true,
      })

      useWorkflowStore.getState().reset()

      expect(useWorkflowStore.getState().nodes).toEqual([])
      expect(useWorkflowStore.getState().edges).toEqual([])
      expect(useWorkflowStore.getState().variables).toEqual([])
      expect(useWorkflowStore.getState().history.length).toBe(1)
      expect(useWorkflowStore.getState().history[0].isInitialState).toBe(true)
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().canUndo()).toBe(false)
      expect(useWorkflowStore.getState().canRedo()).toBe(false)

      // After 1 op
      useWorkflowStore.getState().addNode(makeBlock('after-reset'))
      expect(useWorkflowStore.getState().canUndo()).toBe(true)

      // Undo back to empty baseline
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().nodes).toEqual([])
      expect(useWorkflowStore.getState().canUndo()).toBe(false)
    })
  })

  describe('Undo/redo refused during transaction', () => {
    it('undo() inside a transaction does not change state', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const node = makeBlock('start', { position: { x: 0, y: 0 } })
      const baseline = makeBaseline([node])
      useWorkflowStore.setState({
        nodes: [node],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      // Add an op so undo would normally do something
      useWorkflowStore.getState().addNode(makeBlock('extra'))
      expect(useWorkflowStore.getState().nodes).toHaveLength(2)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)

      useWorkflowStore.getState().transaction(() => {
        // undo inside the transaction must be a no-op
        useWorkflowStore.getState().undo()
      }, 'Try to undo')

      // The transaction wrapper itself committed a no-mutation entry
      // OR (per implementation choice) committed nothing. Either way the
      // canvas state must NOT have rewound: both nodes still present.
      expect(useWorkflowStore.getState().nodes).toHaveLength(2)
    })

    it('redo() inside a transaction does not change state', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const node = makeBlock('start', { position: { x: 0, y: 0 } })
      const baseline = makeBaseline([node])
      useWorkflowStore.setState({
        nodes: [node],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      useWorkflowStore.getState().addNode(makeBlock('extra'))
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().nodes).toHaveLength(1)

      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().redo()
      }, 'Try to redo')

      // redo inside the transaction must be a no-op - canvas still at baseline
      expect(useWorkflowStore.getState().nodes).toHaveLength(1)
    })
  })

  describe('Auto-connect drop produces TWO history entries', () => {
    /**
     * Drop+auto-edge yields
     * two undo entries (add-node and add-edge). Undo first removes the
     * edge, then undo removes the node.
     */
    it('addNode then addEdge from baseline produces 2 entries; two undos walk both back', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const start = makeBlock('start')
      const baseline = makeBaseline([start])
      useWorkflowStore.setState({
        nodes: [start],
        edges: [],
        variables: [],
        history: [baseline],
        historyIndex: 0,
      })

      const dropped = makeBlock('dropped')
      const autoEdge = makeEdge('e-start-dropped', 'start', 'dropped')

      useWorkflowStore.getState().addNode(dropped)
      useWorkflowStore.getState().addEdge(autoEdge)

      // Baseline + add-node + add-edge = 3 entries
      expect(useWorkflowStore.getState().history.length).toBe(3)
      expect(useWorkflowStore.getState().historyIndex).toBe(2)
      expect(useWorkflowStore.getState().nodes).toHaveLength(2)
      expect(useWorkflowStore.getState().edges).toHaveLength(1)

      // Undo once: edge gone, node remains
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(1)
      expect(useWorkflowStore.getState().edges).toHaveLength(0)
      expect(useWorkflowStore.getState().nodes).toHaveLength(2)

      // Undo again: node gone, back to baseline
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().nodes).toEqual([start])
      expect(useWorkflowStore.getState().edges).toEqual([])
    })
  })

  describe('Baseline-preserving cap eviction', () => {
    /**
     * The depth cap evicts the OLDEST NON-BASELINE entry; the baseline entry
     * is never evicted, so the clean (saved) state stays reachable. The same
     * single commit helper must back all three commit paths.
     */
    it('commitHistory at the cap keeps the baseline entry', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [],
        history: [makeBaseline([])],
        historyIndex: 0,
        maxHistoryLength: 3,
      })

      useWorkflowStore.getState().addNode(makeBlock('a'))
      useWorkflowStore.getState().addNode(makeBlock('b'))
      useWorkflowStore.getState().addNode(makeBlock('c'))

      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(3)
      expect(state.history[0].isInitialState).toBe(true)
      expect(state.historyIndex).toBe(2)
    })

    it('keeps the baseline even when the cap is smaller than the baseline itself', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [],
        history: [makeBaseline([])],
        historyIndex: 0,
        maxHistoryLength: 0,
      })

      useWorkflowStore.getState().addNode(makeBlock('a'))

      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(1)
      expect(state.history[0].isInitialState).toBe(true)
      expect(state.historyIndex).toBe(0)
    })

    it('endDragOperation at the cap keeps the baseline entry', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      const node = makeBlock('drag-me', { position: { x: 0, y: 0 } })
      useWorkflowStore.setState({
        nodes: [node],
        edges: [],
        variables: [],
        history: [makeBaseline([node])],
        historyIndex: 0,
        maxHistoryLength: 2,
      })

      useWorkflowStore.getState().addNode(makeBlock('filler'))
      expect(useWorkflowStore.getState().history.length).toBe(2)

      useWorkflowStore.getState().startDragOperation()
      useWorkflowStore.getState().setNodes(
        useWorkflowStore.getState().nodes.map((n) =>
          n.id === 'drag-me' ? { ...n, position: { x: 50, y: 50 } } : n,
        ),
      )
      useWorkflowStore.getState().endDragOperation()

      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(2)
      expect(state.history[0].isInitialState).toBe(true)
    })

    it('transaction at the cap keeps the baseline entry', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [],
        history: [makeBaseline([])],
        historyIndex: 0,
        maxHistoryLength: 2,
      })

      useWorkflowStore.getState().addNode(makeBlock('a'))
      expect(useWorkflowStore.getState().history.length).toBe(2)

      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().setNodes([
          ...useWorkflowStore.getState().nodes,
          makeBlock('b'),
        ])
      }, 'Batch add')

      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(2)
      expect(state.history[0].isInitialState).toBe(true)
    })
  })

  describe('Pending text-edit debounce boundaries', () => {
    /**
     * A grouped text edit still inside its 500ms window is FINALIZED before
     * any undo, redo, save, or reset executes, so no late grouping commit can
     * alter the timeline afterwards (design doc "State Consistency").
     */
    it('undo finalizes the pending edit first, then undoes it (no late commit)', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [],
        history: [makeBaseline([])],
        historyIndex: 0,
        maxHistoryLength: 50,
      })

      useWorkflowStore.getState().addNode(makeBlock('n1'))
      useWorkflowStore.getState().updateNodeWithGrouping('n1', {
        data: { label: 'typed' },
      })

      useWorkflowStore.getState().undo()

      // The pending 'typed' edit was committed as an entry, then undone:
      // canvas shows the pre-edit label, the edit stays redoable.
      let state = useWorkflowStore.getState()
      expect(state.nodes[0]?.data.label).toBe('Block n1')
      expect(state.history.length).toBe(3)
      expect(state.historyIndex).toBe(1)
      expect(state.canRedo()).toBe(true)

      // The grouping timer must not fire a second commit afterwards.
      vi.advanceTimersByTime(600)
      state = useWorkflowStore.getState()
      expect(state.history.length).toBe(3)
      expect(state.historyIndex).toBe(1)
      expect(state.nodes[0]?.data.label).toBe('Block n1')

      useWorkflowStore.getState().redo()
      expect(useWorkflowStore.getState().nodes[0]?.data.label).toBe('typed')
    })

    it('redo finalizes the pending edit, which truncates the redo tail (redo is then a no-op)', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [],
        history: [makeBaseline([])],
        historyIndex: 0,
        maxHistoryLength: 50,
      })

      useWorkflowStore.getState().addNode(makeBlock('n1'))
      useWorkflowStore.getState().addNode(makeBlock('n2'))
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().canRedo()).toBe(true)

      useWorkflowStore.getState().updateNodeWithGrouping('n1', {
        data: { label: 'typed' },
      })
      useWorkflowStore.getState().redo()

      // The flushed edit is a new branch point: the n2 future is gone.
      const state = useWorkflowStore.getState()
      expect(state.nodes).toHaveLength(1)
      expect(state.nodes[0]?.data.label).toBe('typed')
      expect(state.canRedo()).toBe(false)

      vi.advanceTimersByTime(600)
      expect(useWorkflowStore.getState().history.length).toBe(state.history.length)
    })

    it('markSaved absorbs the pending edit into the baseline (no entry after save)', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [],
        history: [makeBaseline([])],
        historyIndex: 0,
        maxHistoryLength: 50,
      })

      useWorkflowStore.getState().addNode(makeBlock('n1'))
      useWorkflowStore.getState().updateNodeWithGrouping('n1', {
        data: { label: 'typed' },
      })

      useWorkflowStore.getState().markSaved()
      vi.advanceTimersByTime(600)

      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(1)
      expect(state.historyIndex).toBe(0)
      expect(state.history[0].isInitialState).toBe(true)
      expect(state.canUndo()).toBe(false)
      expect(state.nodes[0]?.data.label).toBe('typed')
    })

    it('reset cancels the pending edit (no stray entry above the empty baseline)', async () => {
      const { useWorkflowStore } = await import(
        '@/features/workbench/stores/workflow-store'
      )

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        variables: [],
        history: [makeBaseline([])],
        historyIndex: 0,
        maxHistoryLength: 50,
      })

      useWorkflowStore.getState().addNode(makeBlock('n1'))
      useWorkflowStore.getState().updateNodeWithGrouping('n1', {
        data: { label: 'typed' },
      })

      useWorkflowStore.getState().reset()
      vi.advanceTimersByTime(600)

      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(1)
      expect(state.history[0].isInitialState).toBe(true)
      expect(state.nodes).toEqual([])
      expect(state.canUndo()).toBe(false)
    })
  })
})
