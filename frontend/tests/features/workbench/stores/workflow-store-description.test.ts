/**
 * Tests for workflow-store description-field rename.
 *
 * Contract:
 * - `WorkflowNodeData.displayName` is removed from the node-data shape.
 * - `WorkflowNodeData.nameCollapsed` is removed (no successor).
 * - A new `description?: string` is allowed on the node data and preserved by store mutations.
 * - An absent description is represented as `undefined`, not the empty string.
 */

import { describe, it, expect, beforeEach } from 'vitest'

const STARTING_NODES = (): Array<{
  id: string
  type: 'workflowNode' | 'noteNode'
  position: { x: number; y: number }
  data: {
    label: string
    elementType?: string
    description?: string
  }
}> => [
  {
    id: 'n1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label: 'HTTP_Client', elementType: 'http-client' },
  },
]

describe('workflow-store - description field', () => {
  beforeEach(() => {
    // Tests reset the store explicitly via setState in each case.
  })

  it('accepts a description on a node and exposes it via getState()', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({ nodes: STARTING_NODES() })
    useWorkflowStore.getState().updateNode('n1', {
      data: {
        label: 'HTTP_Client',
        elementType: 'http-client',
        description: 'Probe gateway',
      },
    })
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')!
    expect(node.data.description).toBe('Probe gateway')
  })

  it('absent description is represented as `undefined`, not an empty string', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({ nodes: STARTING_NODES() })
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')!
    // No description set on the seed node
    expect(node.data.description).toBeUndefined()
    // Specifically, NOT the empty string - "absent" and "empty" are different states
    expect(node.data.description).not.toBe('')
  })

  it('description updates round-trip through updateNode', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({
      nodes: [
        {
          id: 'n1',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'HTTP_Client',
            elementType: 'http-client',
            description: 'Original',
          },
        },
      ],
    })
    useWorkflowStore.getState().updateNode('n1', {
      data: {
        label: 'HTTP_Client',
        elementType: 'http-client',
        description: 'Updated',
      },
    })
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')!
    expect(node.data.description).toBe('Updated')
  })

  it('the legacy `displayName` field is no longer in the NodeType.data type surface', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({ nodes: STARTING_NODES() })
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')!
    // Even though tests can't directly check a TS type at runtime, a displayName
    // assignment must not be exposed by the store. The seed payload does not set it,
    // and the store must not synthesize it.
    expect((node.data as Record<string, unknown>).displayName).toBeUndefined()
  })

  it('the legacy `nameCollapsed` field is no longer in the NodeType.data type surface', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({ nodes: STARTING_NODES() })
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')!
    expect((node.data as Record<string, unknown>).nameCollapsed).toBeUndefined()
  })

  it('passing a description through addNode preserves it intact', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({ nodes: [] })
    useWorkflowStore.getState().addNode({
      id: 'n2',
      type: 'workflowNode',
      position: { x: 10, y: 10 },
      data: {
        label: 'Delay',
        elementType: 'delay',
        description: 'Wait gateway',
      },
    })
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n2')!
    expect(node.data.description).toBe('Wait gateway')
  })

  it('updating with an undefined description clears the field on the node', async () => {
    const { useWorkflowStore } = await import('@/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({
      nodes: [
        {
          id: 'n1',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'HTTP_Client',
            elementType: 'http-client',
            description: 'Probe gateway',
          },
        },
      ],
    })
    useWorkflowStore.getState().updateNode('n1', {
      data: {
        label: 'HTTP_Client',
        elementType: 'http-client',
        description: undefined,
      },
    })
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')!
    expect(node.data.description).toBeUndefined()
  })
})
