/**
 * useConfigModal dispatch: a Function Block gets the shared Block element plus its Function chrome data,
 * with the field list from its Function's contract; a plugin or control Block keeps the registry schema.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'


// ---------------------------------------------------------------------------
// Mocks - shared workflow store and metadata loaders
// ---------------------------------------------------------------------------


interface StoreNode {
  id: string
  type?: string
  position?: { x: number; y: number }
  data: Record<string, unknown>
}

interface MockStoreShape {
  nodes: StoreNode[]
  edges: Array<{ id: string; source: string; target: string }>
  configModalNodeId: string | null
  closeConfigModal: ReturnType<typeof vi.fn>
  updateNode: ReturnType<typeof vi.fn>
  setEdges: ReturnType<typeof vi.fn>
  variables: Array<{ id: string; name: string; type: string; value: unknown }>
  addVariable: ReturnType<typeof vi.fn>
  clearPulseValidationNodeId: ReturnType<typeof vi.fn>
  transaction: ReturnType<typeof vi.fn>
  drillPath: Array<{ nodeId: string; label: string }>
}

const mockStore: MockStoreShape = {
  nodes: [],
  edges: [],
  configModalNodeId: null,
  closeConfigModal: vi.fn(),
  updateNode: vi.fn(),
  setEdges: vi.fn(),
  variables: [],
  addVariable: vi.fn(),
  clearPulseValidationNodeId: vi.fn(),
  transaction: vi.fn((cb: () => void) => cb()),
  drillPath: [],
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector: (state: MockStoreShape) => unknown) =>
    selector(mockStore),
}))

// The one Block lookup: a Function Block reads the real adapter, any other Block the stub schema.
vi.mock('@/features/workbench/lib/node-parameters', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/features/workbench/lib/node-parameters')
  const inputs = () => [{ name: 'cmd', type: 'string' as const, required: true, description: '' }]
  const outputs = () => [{ name: 'stdout', type: 'string' }]
  type BlockLookup = (data: Record<string, unknown>) => unknown
  const blockLookup = (name: string, stub: () => unknown): BlockLookup => (data) =>
    data.nodeType === 'function' ? (actual[name] as BlockLookup)(data) : stub()
  return {
    getInputParams: inputs,
    getOutputParams: outputs,
    blockInputParams: blockLookup('blockInputParams', inputs),
    blockOutputParams: blockLookup('blockOutputParams', outputs),
  }
})

vi.mock('@/features/workbench/docs/_loader', () => ({
  getControlMetadata: () => ({ description: 'test control' }),
  getControlVersions: () => [{ version: '1.0.0' }],
}))


import { useConfigModal } from '@/features/workbench/common/canvas/workflow-canvas/use-config-modal'


function withReactFlow({ children }: { children: ReactNode }) {
  return createElement(ReactFlowProvider, null, children)
}


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------


function pluginNode(id = 'plugin-1'): StoreNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'Plugin Block',
      elementType: 'log',
      nodeType: 'plugin',
      version: '1.0.0',
      config: { values: {}, profileBindings: [], outputBindings: {} },
    },
  }
}


function localFunctionNode(id = 'fn-1'): StoreNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 100, y: 100 },
    data: {
      label: 'my_function',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      version: '1.0.0',
      localDefinition: {
        name: 'my_function',
        description: '',
        tags: [],
        inputs: [{ name: 'x', type: 'string', required: true, description: '' }],
        outputs: [{ name: 'result', type: 'string', description: '' }],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: [], edges: [] },
      },
      config: { values: {}, profileBindings: [], outputBindings: {} },
    },
  }
}


function publishedFunctionNode(
  id = 'fn-2',
  fnId = '00000000-0000-0000-0000-000000000001',
): StoreNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 200, y: 200 },
    data: {
      label: 'published_function',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      version: '1.0.0',
      functionId: fnId,
      config: { values: {}, profileBindings: [], outputBindings: {} },
    },
  }
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


describe('useConfigModal - dispatcher: plugin nodes', () => {
  beforeEach(() => {
    mockStore.nodes = []
    mockStore.edges = []
    mockStore.configModalNodeId = null
    mockStore.drillPath = []
  })

  it('plugin node yields a non-Function modal element', () => {
    mockStore.nodes = [pluginNode('plugin-1')]
    mockStore.configModalNodeId = 'plugin-1'
    const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
    const element = result.current.configModalElement as
      | { kind?: string; elementType?: string }
      | null
    expect(element).not.toBeNull()
    // The existing behavior is preserved: the element is shaped for
    // ElementConfigModal (plugin/control), not FunctionConfigModal.
    expect(element?.kind ?? 'element').not.toBe('function')
    expect(element?.elementType).toBe('log')
  })
})


describe('useConfigModal - dispatcher: Function nodes', () => {
  beforeEach(() => {
    mockStore.nodes = []
    mockStore.edges = []
    mockStore.configModalNodeId = null
    mockStore.drillPath = []
  })

  it('Local Function node yields the shared Block element with its Function contract as fields', () => {
    mockStore.nodes = [localFunctionNode('fn-1')]
    mockStore.configModalNodeId = 'fn-1'
    const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
    const element = result.current.configModalElement as unknown as
      | {
          kind?: string
          lifecycle?: string
          parameters?: { name: string }[]
          outputs?: { name: string }[]
          name?: string
        }
      | null
    expect(element).not.toBeNull()
    expect(element?.kind).toBe('function')
    expect(element?.lifecycle).toBe('local')
    expect(element?.name).toBe('my_function')
    expect(element?.parameters?.[0]?.name).toBe('x')
    expect(element?.outputs?.[0]?.name).toBe('result')
  })

  it('Published Function node yields a shared-lifecycle element', () => {
    mockStore.nodes = [publishedFunctionNode('fn-2')]
    mockStore.configModalNodeId = 'fn-2'
    const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
    const element = result.current.configModalElement as
      | { kind?: string; lifecycle?: string; functionId?: string }
      | null
    expect(element?.kind).toBe('function')
    expect(element?.lifecycle).toBe('shared')
    expect(element?.functionId).toBe('00000000-0000-0000-0000-000000000001')
  })

  it('returns null when no node is selected (existing dispatcher invariant preserved)', () => {
    mockStore.nodes = [localFunctionNode('fn-1')]
    mockStore.configModalNodeId = null
    const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
    expect(result.current.configModalElement).toBeNull()
  })
})
