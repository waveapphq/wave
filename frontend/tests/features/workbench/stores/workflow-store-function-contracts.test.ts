/**
 * Workflow Store - applyFunctionContracts: every Shared (library) Function instance, at any
 * depth, in the live tree, every history entry and the clipboard, takes the contract of the
 * version it pins (REQ-3.1.2.4), with no history entry of its own and the dirty flag unchanged.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { VersionDescriptor } from '@/features/functions/api/types'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

type Node = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }

const WHO = [{ name: 'who', type: 'string', required: true }]

function shared(id: string): Node {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label: id, nodeType: 'function', functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '1.0.0' },
  }
}

function host(nodes: Node[]): Node {
  return {
    id: 'host',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'host',
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: { inputs: [], outputs: [], workflow: { nodes, edges: [] } },
    },
  }
}

const VERSIONS = new Map([
  ['lib-1', new Map([['1.0.0', { version: '1.0.0', inputs: WHO, outputs: [] } as unknown as VersionDescriptor]])],
])

type State = ReturnType<typeof useWorkflowStore.getState>

function seed(state: Partial<Record<keyof State, unknown>>): void {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    variables: [],
    drillPath: [],
    isDirty: false,
    history: [],
    historyIndex: -1,
    clipboard: null,
    clipboardSource: null,
    ...state,
  } as unknown as Partial<State>)
}

const contractOf = (node: unknown): unknown => (node as Node).data.resolvedInputs

beforeEach(() => seed({}))

describe('applyFunctionContracts', () => {
  it('stamps an instance on the Test flow and one inside a Local Function body, while drilled in', () => {
    seed({ nodes: [shared('top'), host([shared('inner')])], drillPath: [{ nodeId: 'host', label: 'host' }] })

    useWorkflowStore.getState().applyFunctionContracts(VERSIONS)

    const [top, hostNode] = useWorkflowStore.getState().nodes as unknown as Node[]
    expect(contractOf(top)).toEqual(WHO)
    const body = (hostNode.data.localDefinition as { workflow: { nodes: Node[] } }).workflow.nodes
    expect(contractOf(body[0])).toEqual(WHO)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it('stamps every history entry, so undo and redo bring the contract back', () => {
    const untouched = { nodes: [], edges: [], timestamp: 1, isInitialState: true }
    seed({
      nodes: [shared('a')],
      history: [untouched, { nodes: [shared('a')], edges: [], timestamp: 2 }],
      historyIndex: 1,
    })

    useWorkflowStore.getState().applyFunctionContracts(VERSIONS)

    const { history, historyIndex } = useWorkflowStore.getState()
    expect(history[0]).toBe(untouched)
    expect(contractOf(history[1].nodes[0])).toEqual(WHO)
    expect(historyIndex).toBe(1)
  })

  it('stamps a copied Block, so its paste carries the contract', () => {
    seed({ nodes: [shared('a')], clipboard: { nodes: [shared('a')], edges: [] }, clipboardSource: 'copy' })

    useWorkflowStore.getState().applyFunctionContracts(VERSIONS)
    useWorkflowStore.getState().paste()

    const nodes = useWorkflowStore.getState().nodes as unknown as Node[]
    expect(nodes).toHaveLength(2)
    expect(nodes.every((node) => contractOf(node) !== undefined)).toBe(true)
  })

  it('leaves the state as it is when no instance changes', () => {
    const plain = { id: 'log', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'log' } }
    seed({ nodes: [plain], history: [{ nodes: [plain], edges: [], timestamp: 1 }], historyIndex: 0, clipboard: { nodes: [plain], edges: [] } })
    const before = useWorkflowStore.getState()

    before.applyFunctionContracts(VERSIONS)

    const after = useWorkflowStore.getState()
    expect(after.nodes).toBe(before.nodes)
    expect(after.history).toBe(before.history)
    expect(after.clipboard).toBe(before.clipboard)
  })

  it('leaves an empty clipboard empty', () => {
    seed({ nodes: [shared('a')] })

    useWorkflowStore.getState().applyFunctionContracts(VERSIONS)

    expect(useWorkflowStore.getState().clipboard).toBeNull()
    expect(contractOf(useWorkflowStore.getState().nodes[0])).toEqual(WHO)
  })
})

describe('applyFunctionContracts - a Shared Function Block dropped or added by Quick Add (FIELD-8, REQ-3.1.2.10)', () => {
  const CHOICES = [
    { name: 'level', type: 'string', required: true, default: 'low', enumValues: ['low', 'high'] },
    { name: 'strict', type: 'boolean', required: true, default: true },
    { name: 'region', type: 'string', required: false, default: 'eu' },
    { name: 'who', type: 'string', required: true },
  ]
  const CHOICE_VERSIONS = new Map([
    ['lib-1', new Map([['1.0.0', { version: '1.0.0', inputs: CHOICES, outputs: [] } as unknown as VersionDescriptor]])],
  ])
  const valuesOf = (node: unknown) => ((node as Node).data.config as { values?: unknown } | undefined)?.values

  it('writes the choice-list and true / false defaults, Required included, once the contract lands', () => {
    seed({ nodes: [shared('dropped')] })

    useWorkflowStore.getState().applyFunctionContracts(CHOICE_VERSIONS)

    expect(valuesOf(useWorkflowStore.getState().nodes[0])).toEqual({ level: 'low', strict: true })
  })

  it('writes them on a Block added inside a Local Function body while drilled in', () => {
    seed({ nodes: [host([shared('inner')])], drillPath: [{ nodeId: 'host', label: 'host' }] })

    useWorkflowStore.getState().applyFunctionContracts(CHOICE_VERSIONS)

    const [hostNode] = useWorkflowStore.getState().nodes as unknown as Node[]
    const body = (hostNode.data.localDefinition as { workflow: { nodes: Node[] } }).workflow.nodes
    expect(valuesOf(body[0])).toEqual({ level: 'low', strict: true })
  })
})
