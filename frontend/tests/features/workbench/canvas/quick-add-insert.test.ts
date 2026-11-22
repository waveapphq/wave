/** Quick Insert placement and wiring tests (REQ-4.2.5, CANVAS-225, CANVAS-249). */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { performQuickAddInsert } from '@/features/workbench/common/canvas/quick-add/quick-add-insert'
import {
  START_NODE_ID,
  START_NODE_POSITION,
} from '@/features/workbench/common/canvas/workflow-canvas/canvas-constants'
import { walkActiveSubtree } from '@/features/functions/canvas/inner-workflow'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { usePaletteUsageStore } from '@/features/workbench/stores/palette-usage-store'
import type { QuickAddItem } from '@/features/workbench/lib/quick-add-catalog'

type StoreState = ReturnType<typeof useWorkflowStore.getState>

interface SheetSlice {
  lastInteractedNodeId: string | null
}

function getStore(): StoreState & SheetSlice {
  return useWorkflowStore.getState() as StoreState & SheetSlice
}

const CENTER = { x: 500, y: 300 }

const PLUGIN_ITEM: QuickAddItem = {
  id: 'log',
  name: 'Log',
  type: 'plugin',
  group: 'plugins',
  iconName: 'ScrollText',
  colorClass: 'text-slate-400',
  categoryLabel: 'System',
}

const FUNCTION_ITEM: QuickAddItem = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'fetch_user',
  type: 'function',
  group: 'functions',
  iconName: 'Braces',
  colorClass: 'text-emerald-500',
  functionId: '00000000-0000-0000-0000-000000000001',
  version: '1.2.0',
}

const NEW_FUNCTION_ITEM: QuickAddItem = {
  id: 'new-function',
  name: 'New Function',
  type: 'new-function',
  group: 'functions',
  iconName: 'Plus',
  colorClass: 'text-emerald-500',
}

/** One anchor's measured center x and source-handle center xs, in flow coordinates. */
interface AnchorGeometry {
  centerX: number
  handles?: Record<string, number>
}

/** Stands in for the canvas handle-center resolver; null when the node is not measured. */
function makeHandleCenterResolver(geometry: Record<string, AnchorGeometry>) {
  return vi.fn((nodeId: string, sourceHandle?: string) => {
    const node = geometry[nodeId]
    if (!node) return null
    if (sourceHandle === undefined) return { x: node.centerX, y: 0 }
    const x = node.handles?.[sourceHandle]
    return x === undefined ? null : { x, y: 0 }
  })
}

/** The drawn width of a fresh plugin Block, a fresh Function Block and a fresh Note (their floors). */
const FRESH_BLOCK_WIDTH = 160
const FRESH_FUNCTION_WIDTH = 192
const FRESH_NOTE_WIDTH = 120

function makeDeps(
  overrides: Record<string, unknown> = {},
  geometry: Record<string, AnchorGeometry> = {},
) {
  return {
    validate: vi.fn(() => ({ valid: true })),
    toast: { error: vi.fn() },
    viewportCenter: CENTER,
    drilledFunctionIds: new Set<string>(),
    resolveHandleCenter: makeHandleCenterResolver(geometry),
    ...overrides,
  }
}

function makeNode(
  id: string,
  position: { x: number; y: number },
  data: Record<string, unknown> = {},
) {
  return {
    id,
    type: 'workflowNode' as const,
    position,
    data: { label: id, elementType: 'log', nodeType: 'plugin' as const, ...data },
  }
}

function seed(nodes: unknown[], edges: unknown[] = []): void {
  useWorkflowStore.setState({
    nodes,
    edges,
  } as unknown as Partial<StoreState>)
}

/** The node added by the call under test (diff against the pre-call ids). */
function findAddedNode(beforeIds: Set<string>) {
  return getStore().nodes.find((n) => !beforeIds.has(n.id))
}

beforeEach(() => {
  useWorkflowStore.getState().reset()
  usePaletteUsageStore.setState({
    recentItems: [],
    usageCounts: {},
    frequentItems: [],
  })
})

describe('performQuickAddInsert - center mode', () => {
  it('places the node at the viewport center with no links', () => {
    const deps = makeDeps()
    const newId = performQuickAddInsert(PLUGIN_ITEM, 'center', deps)

    expect(newId).toBeTruthy()
    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node).toBeDefined()
    expect(node?.position).toEqual(CENTER)
    expect(getStore().edges).toHaveLength(0)
  })

  it('selects the placed node and records it as last interacted', () => {
    const newId = performQuickAddInsert(PLUGIN_ITEM, 'center', makeDeps())
    expect(getStore().selectedNodeIds).toEqual([newId])
    expect(getStore().lastInteractedNodeId).toBe(newId)
  })

  it('replaces any existing selection with the placed node', () => {
    seed([makeNode('a', { x: 0, y: 0 })])
    getStore().selectNode('a')
    const newId = performQuickAddInsert(PLUGIN_ITEM, 'center', makeDeps())
    expect(getStore().selectedNodeIds).toEqual([newId])
  })

  it('builds plugin nodes with palette-drop parity (auto-name, type fields)', () => {
    seed([makeNode('a', { x: 0, y: 0 }, { label: 'Log' })])
    const before = new Set(getStore().nodes.map((n) => n.id))
    performQuickAddInsert(PLUGIN_ITEM, 'center', makeDeps())
    const node = findAddedNode(before)
    expect(node?.data).toMatchObject({
      label: 'Log_1',
      elementType: 'log',
      nodeType: 'plugin',
    })
    expect(node?.data).not.toHaveProperty('category')
  })
})

describe("performQuickAddInsert - anchor mode", () => {
  it('anchors on the single selected block', () => {
    seed([makeNode('a', { x: 200, y: 50 })])
    getStore().selectNode('a')

    const newId = performQuickAddInsert(
      PLUGIN_ITEM,
      'anchor',
      makeDeps({}, { a: { centerX: 280 } }),
    )

    const edge = getStore().edges.find((e) => e.target === newId)
    expect(edge?.source).toBe('a')
    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position.x).toBe(280 - FRESH_BLOCK_WIDTH / 2)
    expect(node?.position.y).toBe(50 + 140)
  })

  it('anchors on the last interacted block when nothing is selected', () => {
    seed([makeNode('a', { x: 100, y: 100 })])
    useWorkflowStore.setState({
      lastInteractedNodeId: 'a',
      selectedNodeIds: [],
    } as unknown as Partial<StoreState>)

    const newId = performQuickAddInsert(
      PLUGIN_ITEM,
      'anchor',
      makeDeps({}, { a: { centerX: 180 } }),
    )

    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position.x).toBe(180 - FRESH_BLOCK_WIDTH / 2)
    expect(node?.position.y).toBe(100 + 140)
    const edge = getStore().edges.find((e) => e.target === newId)
    expect(edge?.source).toBe('a')
    expect(edge?.sourceHandle).toBeUndefined()
  })

  it('prefers the selection over the last interacted block', () => {
    seed([makeNode('a', { x: 100, y: 100 }), makeNode('b', { x: 400, y: 100 })])
    useWorkflowStore.setState({
      lastInteractedNodeId: 'a',
    } as unknown as Partial<StoreState>)
    getStore().setSelectedNodes(['b'])

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    expect(getStore().edges.find((e) => e.target === newId)?.source).toBe('b')
  })

  it('ignores a multi-selection and uses the last interacted block', () => {
    seed([makeNode('a', { x: 100, y: 100 }), makeNode('b', { x: 400, y: 100 })])
    useWorkflowStore.setState({
      lastInteractedNodeId: 'a',
    } as unknown as Partial<StoreState>)
    getStore().setSelectedNodes(['a', 'b'])

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    expect(getStore().edges.find((e) => e.target === newId)?.source).toBe('a')
  })

  it('skips a stale selection and uses the last interacted block', () => {
    seed([makeNode('a', { x: 100, y: 100 })])
    useWorkflowStore.setState({
      lastInteractedNodeId: 'a',
      selectedNodeIds: ['ghost'],
    } as unknown as Partial<StoreState>)

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    expect(getStore().edges.find((e) => e.target === newId)?.source).toBe('a')
  })

  it('falls back to the end of the flow when neither anchor is available', () => {
    seed(
      [makeNode('a', { x: 100, y: 100 }), makeNode('b', { x: 100, y: 250 })],
      [{ id: 'edge-a-b', source: 'a', target: 'b' }],
    )

    const newId = performQuickAddInsert(
      PLUGIN_ITEM,
      'anchor',
      makeDeps({}, { a: { centerX: 180 }, b: { centerX: 180 } }),
    )

    expect(getStore().edges.find((e) => e.target === newId)?.source).toBe('b')
    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position.x).toBe(180 - FRESH_BLOCK_WIDTH / 2)
    expect(node?.position.y).toBe(250 + 140)
  })

  it('falls back to the last terminal block when the flow branches', () => {
    seed(
      [
        makeNode('a', { x: 100, y: 100 }),
        makeNode('b', { x: 0, y: 250 }),
        makeNode('c', { x: 200, y: 250 }),
      ],
      [
        { id: 'edge-a-b', source: 'a', target: 'b' },
        { id: 'edge-a-c', source: 'a', target: 'c' },
      ],
    )

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    expect(getStore().edges.find((e) => e.target === newId)?.source).toBe('c')
  })

  it('anchors on Start when the root canvas is untouched', () => {
    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    const edge = getStore().edges.find((e) => e.target === newId)
    expect(edge?.source).toBe(START_NODE_ID)
    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position).not.toEqual(CENTER)
    expect(node?.position.y).toBeGreaterThan(START_NODE_POSITION.y)
  })

  it('anchors on Start inside an empty Function body', () => {
    seed([
      makeNode('fn1', { x: 0, y: 0 }, {
        label: 'Function',
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          name: 'Function',
          workflow: { nodes: [], edges: [] },
          inputs: [],
          outputs: [],
        },
      }),
    ])
    useWorkflowStore.setState({
      drillPath: [{ nodeId: 'fn1', label: 'Function' }],
    } as unknown as Partial<StoreState>)

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    const state = getStore()
    const body = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
    expect(body.nodes.map((n) => n.id)).toEqual([newId])
    expect(body.edges).toHaveLength(1)
    expect(body.edges[0].source).toBe(START_NODE_ID)
    expect(body.edges[0].target).toBe(newId)
  })

  it('places without linking when the anchor is already fully linked', () => {
    seed(
      [makeNode('a', { x: 100, y: 100 }), makeNode('b', { x: 100, y: 250 })],
      [{ id: 'edge-a-b', source: 'a', target: 'b' }],
    )
    useWorkflowStore.setState({
      lastInteractedNodeId: 'a',
    } as unknown as Partial<StoreState>)

    const before = new Set(getStore().nodes.map((n) => n.id))
    performQuickAddInsert(
      PLUGIN_ITEM,
      'anchor',
      makeDeps({}, { a: { centerX: 180 }, b: { centerX: 180 } }),
    )

    const node = findAddedNode(before)
    expect(node?.position).not.toEqual(CENTER)
    expect(node?.position.x).toBe(180 - FRESH_BLOCK_WIDTH / 2)
    expect(node?.position.y).toBe(100 + 140)
    expect(getStore().edges).toHaveLength(1)
  })

  it('links from the first FREE handle of a multi-egress anchor', () => {
    seed(
      [
        makeNode('a', { x: 100, y: 100 }, {
          label: 'For Loop',
          elementType: 'for',
          nodeType: 'control',
        }),
        makeNode('b', { x: 100, y: 250 }),
      ],
      [{ id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'body' }],
    )
    useWorkflowStore.setState({
      lastInteractedNodeId: 'a',
    } as unknown as Partial<StoreState>)

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    const newEdge = getStore().edges.find((e) => e.target === newId)
    expect(newEdge?.source).toBe('a')
    expect(newEdge?.sourceHandle).toBe('then')
  })

  it('places without linking when the validator rejects the connection', () => {
    seed([makeNode('a', { x: 100, y: 100 })])
    useWorkflowStore.setState({
      lastInteractedNodeId: 'a',
    } as unknown as Partial<StoreState>)

    const deps = makeDeps({ validate: vi.fn(() => ({ valid: false })) })
    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', deps)

    expect(getStore().nodes.find((n) => n.id === newId)).toBeDefined()
    expect(getStore().edges).toHaveLength(0)
  })

  it('selects the placed block and records it as last interacted', () => {
    seed([makeNode('a', { x: 100, y: 100 })])
    getStore().selectNode('a')

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    expect(getStore().selectedNodeIds).toEqual([newId])
    expect(getStore().lastInteractedNodeId).toBe(newId)
  })
})

const NOTE_ITEM: QuickAddItem = {
  id: 'note',
  name: 'Note',
  type: 'control',
  group: 'controls',
  iconName: 'StickyNote',
  colorClass: 'text-amber-400',
}

function makeIfElse(id: string, position: { x: number; y: number }) {
  return makeNode(id, position, {
    label: 'If/Else',
    elementType: 'if-else',
    nodeType: 'control',
    config: {
      values: {
        branches: [
          { id: 'branch_0', type: 'if', label: '', conditions: [] },
          { id: 'branch_1', type: 'else', label: '' },
        ],
      },
    },
  })
}

describe('performQuickAddInsert - Enter centers the block under its egress (CANVAS-249)', () => {
  it('centers a block under Start, whose center is x 0', () => {
    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    expect(getStore().edges.find((e) => e.target === newId)?.source).toBe(START_NODE_ID)
    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position).toEqual({ x: 0 - FRESH_BLOCK_WIDTH / 2, y: START_NODE_POSITION.y + 140 })
  })

  it('centers a block under the implicit Start of an empty Function body', () => {
    seed([
      makeNode('fn1', { x: 0, y: 0 }, {
        label: 'Function',
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          name: 'Function',
          workflow: { nodes: [], edges: [] },
          inputs: [],
          outputs: [],
        },
      }),
    ])
    useWorkflowStore.setState({
      drillPath: [{ nodeId: 'fn1', label: 'Function' }],
    } as unknown as Partial<StoreState>)

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    const state = getStore()
    const body = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
    const node = body.nodes.find((n) => n.id === newId)
    expect(node?.position.x).toBe(0 - FRESH_BLOCK_WIDTH / 2)
  })

  it('centers a Note under Start by its 120 px minimum width', () => {
    const newId = performQuickAddInsert(NOTE_ITEM, 'anchor', makeDeps())

    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.type).toBe('noteNode')
    expect(node?.position.x).toBe(0 - FRESH_NOTE_WIDTH / 2)
  })

  it('centers a published Function under Start by its 192 px drawn width', () => {
    const newId = performQuickAddInsert(FUNCTION_ITEM, 'anchor', makeDeps())

    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position.x).toBe(0 - FRESH_FUNCTION_WIDTH / 2)
  })

  it('centers a block under the handle of an anchor narrower than 240 px', () => {
    seed([makeNode('a', { x: 200, y: 300 })])
    getStore().selectNode('a')

    const newId = performQuickAddInsert(
      PLUGIN_ITEM,
      'anchor',
      makeDeps({}, { a: { centerX: 200 + 200 / 2 } }),
    )

    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position).toEqual({ x: 300 - FRESH_BLOCK_WIDTH / 2, y: 300 + 140 })
  })

  it('centers a block under the handle of an anchor wider than 240 px', () => {
    seed([makeNode('a', { x: 200, y: 300 })])
    getStore().selectNode('a')

    const newId = performQuickAddInsert(
      PLUGIN_ITEM,
      'anchor',
      makeDeps({}, { a: { centerX: 200 + 360 / 2 } }),
    )

    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position).toEqual({ x: 380 - FRESH_BLOCK_WIDTH / 2, y: 300 + 140 })
  })

  it('centers a block under an anchor not yet drawn by the width the anchor draws at', () => {
    seed([makeNode('a', { x: 200, y: 300 })])
    getStore().selectNode('a')

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position).toEqual({ x: 200 + FRESH_BLOCK_WIDTH / 2 - FRESH_BLOCK_WIDTH / 2, y: 300 + 140 })
  })

  it('centers a block under the first branch handle of an unlinked If/Else', () => {
    seed([makeIfElse('a', { x: 100, y: 100 })])
    getStore().selectNode('a')
    const deps = makeDeps({}, {
      a: { centerX: 230, handles: { branch_0: 168, branch_1: 272 } },
    })

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', deps)

    const edge = getStore().edges.find((e) => e.target === newId)
    expect(edge?.sourceHandle).toBe('branch_0')
    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position.x).toBe(168 - FRESH_BLOCK_WIDTH / 2)
  })

  it('centers a block under the first free branch handle when the first branch is linked', () => {
    seed(
      [makeIfElse('a', { x: 100, y: 100 }), makeNode('b', { x: 48, y: 240 })],
      [{ id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'branch_0' }],
    )
    getStore().selectNode('a')
    const deps = makeDeps({}, {
      a: { centerX: 230, handles: { branch_0: 168, branch_1: 272 } },
    })

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'anchor', deps)

    const edge = getStore().edges.find((e) => e.target === newId)
    expect(edge?.source).toBe('a')
    expect(edge?.sourceHandle).toBe('branch_1')
    expect(deps.resolveHandleCenter).toHaveBeenCalledWith('a', 'branch_1')
    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position).toEqual({ x: 272 - FRESH_BLOCK_WIDTH / 2, y: 100 + 140 })
  })

  it('centers a block under a fully linked If/Else itself and links nothing', () => {
    seed(
      [
        makeIfElse('a', { x: 100, y: 100 }),
        makeNode('b', { x: 48, y: 240 }),
        makeNode('c', { x: 152, y: 240 }),
      ],
      [
        { id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'branch_0' },
        { id: 'edge-a-c', source: 'a', target: 'c', sourceHandle: 'branch_1' },
      ],
    )
    getStore().selectNode('a')
    const deps = makeDeps({}, {
      a: { centerX: 230, handles: { branch_0: 168, branch_1: 272 } },
    })

    const before = new Set(getStore().nodes.map((n) => n.id))
    performQuickAddInsert(PLUGIN_ITEM, 'anchor', deps)

    const node = findAddedNode(before)
    expect(node?.position).toEqual({ x: 230 - FRESH_BLOCK_WIDTH / 2, y: 100 + 140 })
    expect(getStore().edges).toHaveLength(2)
  })

  it('keeps Ctrl+Enter at the viewport center without consulting any handle', () => {
    seed([makeNode('a', { x: 200, y: 50 })])
    getStore().selectNode('a')
    const deps = makeDeps({}, { a: { centerX: 320 } })

    const newId = performQuickAddInsert(PLUGIN_ITEM, 'center', deps)

    const node = getStore().nodes.find((n) => n.id === newId)
    expect(node?.position).toEqual(CENTER)
    expect(getStore().edges).toHaveLength(0)
    expect(deps.resolveHandleCenter).not.toHaveBeenCalled()
  })
})

describe('performQuickAddInsert - item kinds', () => {
  it('inserts a published Function pinned to the entry version', () => {
    const before = new Set(getStore().nodes.map((n) => n.id))
    performQuickAddInsert(FUNCTION_ITEM, 'center', makeDeps())
    const node = findAddedNode(before)
    expect(node?.data).toMatchObject({
      label: 'fetch_user',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: FUNCTION_ITEM.functionId,
      functionVersion: '1.2.0',
      originalLibraryName: 'fetch_user',
    })
  })

  it('inserts an empty Local Function from the New Function row', () => {
    const before = new Set(getStore().nodes.map((n) => n.id))
    performQuickAddInsert(NEW_FUNCTION_ITEM, 'center', makeDeps())
    const node = findAddedNode(before)
    expect(node?.data).toMatchObject({
      label: 'Function',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
    })
    expect(node?.data.localDefinition).toMatchObject({
      name: 'Function',
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
    })
  })

  it('rejects nesting a published Function inside itself with the existing toast', () => {
    const toast = { error: vi.fn() }
    const deps = makeDeps({
      toast,
      drilledFunctionIds: new Set([FUNCTION_ITEM.functionId]),
    })
    const before = getStore().nodes.length

    const result = performQuickAddInsert(FUNCTION_ITEM, 'center', deps)

    expect(result).toBeNull()
    expect(toast.error).toHaveBeenCalledWith(
      'A Function cannot be nested inside itself',
    )
    expect(getStore().nodes).toHaveLength(before)
  })

  it('rejects self-nesting without crashing when no toast surface is available', () => {
    const deps = makeDeps({
      toast: null,
      drilledFunctionIds: new Set([FUNCTION_ITEM.functionId]),
    })
    expect(performQuickAddInsert(FUNCTION_ITEM, 'center', deps)).toBeNull()
    expect(getStore().nodes).toHaveLength(0)
  })
})

describe('performQuickAddInsert - palette usage parity', () => {
  it('tracks usage for plugin/control inserts', () => {
    performQuickAddInsert(PLUGIN_ITEM, 'center', makeDeps())
    expect(usePaletteUsageStore.getState().usageCounts.log).toBe(1)
    expect(usePaletteUsageStore.getState().recentItems).toContain('log')
  })

  it('does not track usage for Function inserts', () => {
    performQuickAddInsert(FUNCTION_ITEM, 'center', makeDeps())
    performQuickAddInsert(NEW_FUNCTION_ITEM, 'center', makeDeps())
    expect(usePaletteUsageStore.getState().usageCounts).toEqual({})
    expect(usePaletteUsageStore.getState().recentItems).toHaveLength(0)
  })
})

describe('performQuickAddInsert - bringing the placement into view', () => {
  it('centers on a block that lands outside what the canvas is showing', () => {
    seed([makeNode('a', { x: 200, y: 50 })])
    getStore().selectNode('a')
    const isPlacementVisible = vi.fn(() => false)

    const newId = performQuickAddInsert(
      PLUGIN_ITEM,
      'anchor',
      makeDeps({ isPlacementVisible }),
    )

    expect(getStore().focusRequested).toBe(true)
    expect(getStore().focusNodeId).toBe(newId)
  })

  it('asks about the placement itself, not the anchor', () => {
    seed([makeNode('a', { x: 200, y: 50 })])
    getStore().selectNode('a')
    const isPlacementVisible = vi.fn(() => true)

    const newId = performQuickAddInsert(
      PLUGIN_ITEM,
      'anchor',
      makeDeps({ isPlacementVisible }),
    )

    const placed = getStore().nodes.find((n) => n.id === newId)
    expect(isPlacementVisible).toHaveBeenCalledWith(placed?.position)
  })

  it('leaves the view alone when the block lands in sight', () => {
    seed([makeNode('a', { x: 200, y: 50 })])
    getStore().selectNode('a')

    performQuickAddInsert(
      PLUGIN_ITEM,
      'anchor',
      makeDeps({ isPlacementVisible: () => true }),
    )

    expect(getStore().focusRequested).toBe(false)
  })

  it('leaves the view alone with no visibility test supplied', () => {
    seed([makeNode('a', { x: 200, y: 50 })])
    getStore().selectNode('a')

    performQuickAddInsert(PLUGIN_ITEM, 'anchor', makeDeps())

    expect(getStore().focusRequested).toBe(false)
  })

  it('never moves the view for a center insert, which is visible by construction', () => {
    performQuickAddInsert(
      PLUGIN_ITEM,
      'center',
      makeDeps({ isPlacementVisible: () => true }),
    )

    expect(getStore().focusRequested).toBe(false)
  })
})
