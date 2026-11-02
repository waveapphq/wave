/** applyMirroredGraph store action: root apply, no dirty, no history. */

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

  it('leaves history untouched: length and pointer unchanged', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      variables: [],
      isDirty: false,
      drillPath: [],
    } as never)

    const historyLengthBefore = useWorkflowStore.getState().history.length
    const historyIndexBefore = useWorkflowStore.getState().historyIndex

    useWorkflowStore.getState().applyMirroredGraph({
      nodes: [makeNode('n1'), makeNode('n2')],
      edges: [],
      variables: [],
    })

    const state = useWorkflowStore.getState()
    expect(state.history).toHaveLength(historyLengthBefore)
    expect(state.historyIndex).toBe(historyIndexBefore)
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
