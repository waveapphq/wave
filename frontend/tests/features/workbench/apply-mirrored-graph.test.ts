/** applyMirroredGraph store action: root apply, no dirty, history starts fresh at the mirrored surface. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

interface Position {
  x: number
  y: number
}

interface NodeType {
  id: string
  type: 'block' | 'control' | 'parallel' | 'error-handler'
  position: Position
  data: {
    label: string
  }
}

interface EdgeType {
  id: string
  source: string
  target: string
}

interface WorkflowVariable {
  id: string
  name: string
  value: unknown
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
}

function makeNode(id: string): NodeType {
  return { id, type: 'block', position: { x: 0, y: 0 }, data: { label: id } }
}

describe('applyMirroredGraph', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('replaces root nodes, edges, and variables from the snapshot', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      variables: [],
      isDirty: false,
      drillPath: [],
    } as never)

    const nodes = [makeNode('n1')]
    const edges: EdgeType[] = [{ id: 'e1', source: 'n1', target: 'n2' }]
    const variables: WorkflowVariable[] = [
      { id: 'v1', name: 'x', value: '1', type: 'integer' },
    ]

    useWorkflowStore.getState().applyMirroredGraph({ nodes, edges, variables })

    const state = useWorkflowStore.getState()
    expect(state.nodes).toEqual(nodes)
    expect(state.edges).toEqual(edges)
    expect(state.variables).toEqual(variables)
  })

  it('leaves isDirty false when the prior canvas was clean', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      variables: [],
      isDirty: false,
      drillPath: [],
    } as never)

    useWorkflowStore.getState().applyMirroredGraph({
      nodes: [makeNode('n1')],
      edges: [],
      variables: [],
    })

    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it('forces isDirty false even when the prior canvas was dirty (a mirror is never dirty)', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      variables: [],
      isDirty: true,
      drillPath: [],
    } as never)

    useWorkflowStore.getState().applyMirroredGraph({
      nodes: [makeNode('n1')],
      edges: [],
      variables: [],
    })

    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it('starts the history fresh at the mirrored surface: nothing to undo or redo', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    const store = () => useWorkflowStore.getState()
    store().reset()
    store().addNode(makeNode('own-1') as never)
    store().addNode(makeNode('own-2') as never)
    store().undo()
    expect(store().canUndo()).toBe(true)
    expect(store().canRedo()).toBe(true)

    store().applyMirroredGraph({
      nodes: [makeNode('n1'), makeNode('n2')] as never,
      edges: [],
      variables: [],
    })

    expect(store().history).toHaveLength(1)
    expect(store().historyIndex).toBe(0)
    expect(store().canUndo()).toBe(false)
    expect(store().canRedo()).toBe(false)
  })

  it('an edit plus undo never brings back the test shown before the mirrored surface', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    const store = () => useWorkflowStore.getState()
    store().reset()
    store().setEditingTest('test-x', 'X')
    store().setNodeTree([makeNode('x1')] as never, { skipDirty: true })
    store().markSaved()

    store().applyMirroredGraph({
      nodes: [makeNode('y1'), makeNode('y2')] as never,
      edges: [],
      variables: [],
    })
    store().setEditingTest('test-y', 'Y')
    store().addNode(makeNode('y3') as never)
    store().undo()

    expect(store().nodes.map((node) => node.id)).toEqual(['y1', 'y2'])
    expect(store().getSavedNodes().map((node) => node.id)).not.toContain('x1')
  })

  it('drops a grouped text edit still waiting to commit, so it never lands on the mirrored surface', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    const store = () => useWorkflowStore.getState()
    store().reset()
    store().setNodeTree([makeNode('own-1')] as never, { skipDirty: true })
    store().markSaved()
    store().updateNodeWithGrouping('own-1', { data: { label: 'typed' } } as never)

    store().applyMirroredGraph({ nodes: [makeNode('n1')] as never, edges: [], variables: [] })
    vi.runAllTimers()

    expect(store().canUndo()).toBe(false)
    expect(store().history).toHaveLength(1)
  })

  it('ignores drillPath and always writes the root canvas', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({
      nodes: [makeNode('root-old')],
      edges: [],
      variables: [],
      isDirty: false,
      drillPath: [{ nodeId: 'fn-1', label: 'Function' }],
    } as never)

    const mirrored = [makeNode('mirrored-root')]
    useWorkflowStore.getState().applyMirroredGraph({
      nodes: mirrored,
      edges: [],
      variables: [],
    })

    expect(useWorkflowStore.getState().nodes).toEqual(mirrored)
  })
})

describe('glideMirroredGraph', () => {
  function placed(id: string, y: number): NodeType {
    return { id, type: 'block', position: { x: 0, y }, data: { label: id } }
  }

  // The canvas shows a, b, c; the frame keeps a and moves b and c down.
  const SHOWN = [placed('a', 0), placed('b', 200), placed('c', 400)]
  const FRAME = [placed('a', 0), placed('b', 400), placed('c', 600)]

  async function showing(nodes: NodeType[]) {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    const store = () => useWorkflowStore.getState()
    store().reset()
    store().setNodeTree(nodes as never, { skipDirty: true })
    store().markSaved()
    return store
  }

  function yOf(nodes: readonly { id: string; position: Position }[], id: string): number | undefined {
    return nodes.find((node) => node.id === id)?.position.y
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('moves every moved Block from where it shows to its new place, all together, in about a third of a second', async () => {
    const store = await showing(SHOWN)

    store().glideMirroredGraph({ nodes: FRAME as never, edges: [], variables: [] })

    expect(yOf(store().nodes, 'b')).toBe(200)
    expect(yOf(store().nodes, 'c')).toBe(400)
    vi.advanceTimersByTime(150)
    const bMoved = (yOf(store().nodes, 'b') ?? 0) - 200
    expect(bMoved).toBeGreaterThan(0)
    expect(bMoved).toBeLessThan(200)
    expect((yOf(store().nodes, 'c') ?? 0) - 400).toBe(bMoved)
    expect(yOf(store().nodes, 'a')).toBe(0)
    vi.advanceTimersByTime(200)
    expect(store().nodes.map((node) => node.position)).toEqual(FRAME.map((node) => node.position))
    expect(store().mirrorGlide).toBeNull()
  })

  it('applies the rest of the frame at once and saves its places from the start', async () => {
    const store = await showing(SHOWN)
    const edges = [{ id: 'e1', source: 'a', target: 'b' }]

    store().glideMirroredGraph({ nodes: FRAME as never, edges: edges as never, variables: [] })

    expect(store().edges).toEqual(edges)
    expect(store().getSavedNodes().map((node) => node.position)).toEqual(FRAME.map((node) => node.position))
    expect(store().canUndo()).toBe(false)
    vi.advanceTimersByTime(150)
    expect(store().getSavedNodes().map((node) => node.position)).toEqual(FRAME.map((node) => node.position))
  })

  it('never marks the canvas unsaved on the way', async () => {
    const store = await showing(SHOWN)

    store().glideMirroredGraph({ nodes: FRAME as never, edges: [], variables: [] })

    expect(store().isDirty).toBe(false)
    vi.advanceTimersByTime(150)
    expect(store().isDirty).toBe(false)
    vi.advanceTimersByTime(200)
    expect(store().isDirty).toBe(false)
  })

  it('places the Blocks at once when the person asks for reduced motion', async () => {
    const store = await showing(SHOWN)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))

    store().glideMirroredGraph({ nodes: FRAME as never, edges: [], variables: [] })

    expect(store().nodes.map((node) => node.position)).toEqual(FRAME.map((node) => node.position))
    expect(store().mirrorGlide).toBeNull()
  })

  it('starts nothing when no shown Block moves', async () => {
    const store = await showing(SHOWN)

    store().glideMirroredGraph({ nodes: [placed('a', 0), placed('n', 200)] as never, edges: [], variables: [] })

    expect(store().nodes.map((node) => node.id)).toEqual(['a', 'n'])
    expect(store().mirrorGlide).toBeNull()
  })

  it('holds the Blocks where they show while the view is still framed, then moves them', async () => {
    const store = await showing(SHOWN)

    store().glideMirroredGraph({ nodes: FRAME as never, edges: [], variables: [] })
    store().requestFitView({ padding: 0.2, duration: 0, bounds: { x: 0, y: 0, width: 200, height: 680 } })
    vi.advanceTimersByTime(400)

    expect(yOf(store().nodes, 'b')).toBe(200)
    expect(store().mirrorGlide?.startedAt).toBeNull()
    store().acknowledgeFitView()
    vi.advanceTimersByTime(160)
    expect(yOf(store().nodes, 'b')).toBeGreaterThan(200)
    expect(yOf(store().nodes, 'b')).toBeLessThan(400)
    vi.advanceTimersByTime(200)
    expect(yOf(store().nodes, 'b')).toBe(400)
  })

  it('keeps what another write changes on the way', async () => {
    const store = await showing(SHOWN)
    store().glideMirroredGraph({ nodes: FRAME as never, edges: [], variables: [] })
    vi.advanceTimersByTime(100)

    store().setNodeTree(
      store().nodes.map((node) => ({ ...node, data: { ...node.data, label: 'Stamped' } })) as never,
      { skipDirty: true },
    )
    vi.advanceTimersByTime(300)

    expect(store().nodes.map((node) => node.data.label)).toEqual(['Stamped', 'Stamped', 'Stamped'])
    expect(store().nodes.map((node) => node.position)).toEqual(FRAME.map((node) => node.position))
  })

  it('finishMirrorGlide ends a glide on the new places and stops it', async () => {
    const store = await showing(SHOWN)
    store().glideMirroredGraph({ nodes: FRAME as never, edges: [], variables: [] })
    vi.advanceTimersByTime(100)

    store().finishMirrorGlide()

    expect(store().nodes.map((node) => node.position)).toEqual(FRAME.map((node) => node.position))
    expect(store().mirrorGlide).toBeNull()
    const settled = store().nodes
    vi.advanceTimersByTime(300)
    expect(store().nodes).toBe(settled)
  })

  it('finishMirrorGlide with nothing gliding changes nothing', async () => {
    const store = await showing(SHOWN)
    const before = store().nodes

    store().finishMirrorGlide()

    expect(store().nodes).toBe(before)
  })

  it('a mirrored frame that comes mid-glide ends the glide, then lands as it is', async () => {
    const store = await showing(SHOWN)
    store().glideMirroredGraph({ nodes: FRAME as never, edges: [], variables: [] })
    vi.advanceTimersByTime(100)
    const next = [placed('a', 0), placed('n', 200), placed('b', 400), placed('c', 600)]

    store().applyMirroredGraph({ nodes: next as never, edges: [], variables: [] })

    expect(store().nodes).toEqual(next)
    expect(store().mirrorGlide).toBeNull()
    vi.advanceTimersByTime(300)
    expect(store().nodes).toEqual(next)
  })

  it('a second glide mid-glide starts from where the first one ends', async () => {
    const store = await showing(SHOWN)
    store().glideMirroredGraph({ nodes: FRAME as never, edges: [], variables: [] })
    vi.advanceTimersByTime(100)

    store().glideMirroredGraph({
      nodes: [placed('a', 0), placed('b', 600), placed('c', 600)] as never,
      edges: [],
      variables: [],
    })

    expect(yOf(store().nodes, 'b')).toBe(400)
    expect(yOf(store().nodes, 'c')).toBe(600)
    expect([...(store().mirrorGlide?.moves.keys() ?? [])]).toEqual(['b'])
  })

  it('a reset stops a glide', async () => {
    const store = await showing(SHOWN)
    store().glideMirroredGraph({ nodes: FRAME as never, edges: [], variables: [] })
    vi.advanceTimersByTime(100)

    store().reset()
    vi.advanceTimersByTime(300)

    expect(store().nodes).toEqual([])
    expect(store().mirrorGlide).toBeNull()
  })
})
