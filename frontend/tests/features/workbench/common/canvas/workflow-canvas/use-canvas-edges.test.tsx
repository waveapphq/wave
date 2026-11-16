/**
 * useCanvasEdges Hook Tests
 *
 * Tests for the edge computation hook, focusing on execution store
 * selector behavior when the active execution is missing from the
 * executions map.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Edge } from '@xyflow/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useExecutionStore } from '@/features/workbench/stores/execution-store'
import { useCanvasEdges } from '@/features/workbench/common/canvas/workflow-canvas/use-canvas-edges'
import { HistoricalBlockStatesProvider } from '@/features/workbench/common/canvas/historical-block-states-context'

// ============================================================================
// Setup
// ============================================================================

const defaultParams = {
  isEmptyCanvas: false,
  proximitySourceId: null,
  relocatingEdgeId: null,
  replacementEdgeId: null,
  isSnappedToHandle: false,
  isOverDeleteX: false,
}

beforeEach(() => {
  // Reset stores to initial state
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedEdgeIds: [],
  })
  useExecutionStore.setState({
    executions: {},
    activeExecutionId: null,
  })
})

// ============================================================================
// Tests
// ============================================================================

describe('useCanvasEdges', () => {
  it('returns null block states when activeExecutionId is set but execution does not exist', () => {
    // Set activeExecutionId to an ID that is NOT in the executions map
    useExecutionStore.setState({
      activeExecutionId: 'non-existent-execution-id',
      executions: {},
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    // The hook should still return edges (empty in this case) without errors
    expect(result.current.allEdges).toEqual([])
  })

  it('returns block states when activeExecutionId matches an existing execution', () => {
    useExecutionStore.setState({
      activeExecutionId: 'exec-1',
      executions: {
        'exec-1': {
          id: 'exec-1',
          testId: 'test-1',
          status: 'running',
          startTime: Date.now(),
          blocks: {
            'block-1': {
              id: 'be-1',
              blockId: 'block-1',
              status: 'success',
            },
          },
          progress: 50,
        },
      },
    })

    // Add an edge so the hook has something to process
    useWorkflowStore.setState({
      nodes: [],
      edges: [
        { id: 'e1', source: 'block-1', target: 'block-2', type: 'smoothstep' },
      ],
      selectedEdgeIds: [],
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    // Should have processed the edge with execution state
    expect(result.current.allEdges).toHaveLength(1)
  })

  it('applies traversed style to for loop body handle edge when the loop ran its body', () => {
    useExecutionStore.setState({
      activeExecutionId: 'exec-for',
      executions: {
        'exec-for': {
          id: 'exec-for',
          testId: 'test-1',
          status: 'running',
          startTime: Date.now(),
          blocks: {
            'for-1': { id: 'be-for', blockId: 'for-1', status: 'success', lanes: ['body'] },
            'body-1': { id: 'be-body', blockId: 'body-1', status: 'success' },
          },
          progress: 50,
        },
      },
    })

    useWorkflowStore.setState({
      nodes: [
        { id: 'for-1', type: 'workflowNode', data: { label: 'For Loop', elementType: 'for' }, position: { x: 0, y: 0 } },
        { id: 'body-1', type: 'workflowNode', data: { label: 'Body Log', elementType: 'log' }, position: { x: 0, y: 100 } },
      ],
      edges: [
        { id: 'e-for-body', source: 'for-1', target: 'body-1', sourceHandle: 'body', type: 'smoothstep' },
      ],
      selectedEdgeIds: [],
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(result.current.allEdges).toHaveLength(1)
    expect(result.current.allEdges[0].style).toEqual({ stroke: '#22C55E', strokeWidth: 2 })
  })

  it('returns no execution style for for loop edge when source not yet executed', () => {
    useExecutionStore.setState({
      activeExecutionId: 'exec-for-noop',
      executions: {
        'exec-for-noop': {
          id: 'exec-for-noop',
          testId: 'test-1',
          status: 'running',
          startTime: Date.now(),
          blocks: {},
          progress: 0,
        },
      },
    })

    useWorkflowStore.setState({
      nodes: [
        { id: 'for-1', type: 'workflowNode', data: { label: 'For Loop', elementType: 'for' }, position: { x: 0, y: 0 } },
        { id: 'body-1', type: 'workflowNode', data: { label: 'Body Log', elementType: 'log' }, position: { x: 0, y: 100 } },
      ],
      edges: [
        { id: 'e-for-body-noop', source: 'for-1', target: 'body-1', sourceHandle: 'body', type: 'smoothstep' },
      ],
      selectedEdgeIds: [],
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(result.current.allEdges).toHaveLength(1)
    // Source not executed, so no execution style applied (reachability dimming may apply instead)
    const edge = result.current.allEdges[0]
    expect(edge).toBeDefined()
  })

  it('dims an edge between two skipped nodes (cascade-skip from a skip-block-at-pause)', () => {
    // When a skip-at-pause cascades the body sub-graph of a single-egress
    // parent, both the parent and its non-'then' descendants land in
    // ``status: 'skipped'``. Without the special-case dim, every internal
    // edge in the cascaded sub-graph would render in the green TRAVERSED
    // style even though no plugin actually ran there.
    useExecutionStore.setState({
      activeExecutionId: 'exec-skipped-cascade',
      executions: {
        'exec-skipped-cascade': {
          id: 'exec-skipped-cascade',
          testId: 'test-skipped-cascade',
          status: 'running',
          startTime: Date.now(),
          blocks: {
            'for-1': { id: 'be-for', blockId: 'for-1', status: 'skipped' },
            'body-1': { id: 'be-body-1', blockId: 'body-1', status: 'skipped' },
            'body-2': { id: 'be-body-2', blockId: 'body-2', status: 'skipped' },
          },
          progress: 0,
        },
      },
    })

    useWorkflowStore.setState({
      nodes: [
        { id: 'for-1', type: 'workflowNode', data: { label: 'For Loop', elementType: 'for' }, position: { x: 0, y: 0 } },
        { id: 'body-1', type: 'workflowNode', data: { label: 'Body 1', elementType: 'log' }, position: { x: 0, y: 100 } },
        { id: 'body-2', type: 'workflowNode', data: { label: 'Body 2', elementType: 'log' }, position: { x: 0, y: 200 } },
      ],
      edges: [
        { id: 'e-for-body', source: 'for-1', target: 'body-1', sourceHandle: 'body', type: 'smoothstep' },
        { id: 'e-body1-body2', source: 'body-1', target: 'body-2', type: 'smoothstep' },
      ],
      selectedEdgeIds: [],
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(result.current.allEdges).toHaveLength(2)
    for (const edge of result.current.allEdges) {
      expect(edge.style).toBeDefined()
      expect(edge.style).toHaveProperty('opacity', 0.3)
    }
  })

  it('applies dimmed style to for loop body handle edge when source executed but target not', () => {
    useExecutionStore.setState({
      activeExecutionId: 'exec-for-dimmed',
      executions: {
        'exec-for-dimmed': {
          id: 'exec-for-dimmed',
          testId: 'test-1',
          status: 'running',
          startTime: Date.now(),
          blocks: {
            'for-1': { id: 'be-for', blockId: 'for-1', status: 'success' },
          },
          progress: 25,
        },
      },
    })

    useWorkflowStore.setState({
      nodes: [
        { id: 'for-1', type: 'workflowNode', data: { label: 'For Loop', elementType: 'for' }, position: { x: 0, y: 0 } },
        { id: 'body-1', type: 'workflowNode', data: { label: 'Body Log', elementType: 'log' }, position: { x: 0, y: 100 } },
      ],
      edges: [
        { id: 'e-for-body-dim', source: 'for-1', target: 'body-1', sourceHandle: 'body', type: 'smoothstep' },
      ],
      selectedEdgeIds: [],
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(result.current.allEdges).toHaveLength(1)
    const edge = result.current.allEdges[0]
    // Edge should have dimmed style since target is not executed
    expect(edge.style).toBeDefined()
    expect(edge.style).toHaveProperty('opacity', 0.3)
  })

  it('prefers the historical block-states context over the live execution store', () => {
    // Seed the live store with a DIFFERENT status to prove context wins.
    useExecutionStore.setState({
      activeExecutionId: 'exec-live',
      executions: {
        'exec-live': {
          id: 'exec-live',
          testId: 'test-live',
          status: 'running',
          startTime: Date.now(),
          blocks: {
            'node-a': { id: 'b-a', blockId: 'node-a', status: 'failed' },
          },
          progress: 0,
        },
      },
    })

    useWorkflowStore.setState({
      nodes: [
        { id: 'node-a', type: 'workflowNode', data: { label: 'A', elementType: 'log' }, position: { x: 0, y: 0 } },
        { id: 'node-b', type: 'workflowNode', data: { label: 'B', elementType: 'log' }, position: { x: 0, y: 100 } },
      ],
      edges: [
        { id: 'e-hist', source: 'node-a', target: 'node-b', type: 'smoothstep' },
      ],
      selectedEdgeIds: [],
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <HistoricalBlockStatesProvider blockStates={{ 'node-a': 'success', 'node-b': 'success' }}>
        {children}
      </HistoricalBlockStatesProvider>
    )

    const { result } = renderHook(() => useCanvasEdges(defaultParams), { wrapper })

    // With historical context, the edge should be styled as fully traversed
    // (green) rather than inheriting any live 'failed' coloring.
    const edge = result.current.allEdges[0]
    expect(edge.style).toBeDefined()
    expect((edge.style as { stroke: string }).stroke).toBe('#22C55E')
  })

})

// ============================================================================
// Switch/Case lane styling (REQ-3.5.1.20)
// ============================================================================

const TRAVERSED_STYLE = { stroke: '#22C55E', strokeWidth: 2 }
const DIMMED_STYLE = { stroke: '#71717A', strokeWidth: 1, opacity: 0.3 }

const FAILED_STYLE = { stroke: '#EF4444', strokeWidth: 2 }

type BlockStatus = 'success' | 'failed' | 'skipped' | 'running' | 'pending'

/** Seed a live run: each block's status, and the lanes each block took. */
function seedRun(
  executionId: string,
  statuses: Record<string, BlockStatus>,
  lanes: Record<string, string[]> = {},
) {
  const blocks: Record<
    string,
    { id: string; blockId: string; status: BlockStatus; lanes?: string[] }
  > = {}
  for (const [blockId, status] of Object.entries(statuses)) {
    blocks[blockId] = { id: `be-${blockId}`, blockId, status, lanes: lanes[blockId] }
  }

  useExecutionStore.setState({
    activeExecutionId: executionId,
    executions: {
      [executionId]: {
        id: executionId,
        testId: 'test-switch',
        status: 'running',
        startTime: Date.now(),
        blocks,
        progress: 100,
      },
    },
  })
}

/** Switch with two case lanes, a default lane and the `then` egress. */
function seedSwitchGraph() {
  useWorkflowStore.setState({
    nodes: [
      { id: 'sw-1', type: 'workflowNode', data: { label: 'Switch', elementType: 'switch-case' }, position: { x: 0, y: 0 } },
      { id: 'case-a', type: 'workflowNode', data: { label: 'Case A', elementType: 'log' }, position: { x: 0, y: 100 } },
      { id: 'case-b', type: 'workflowNode', data: { label: 'Case B', elementType: 'log' }, position: { x: 100, y: 100 } },
      { id: 'fallback', type: 'workflowNode', data: { label: 'Fallback', elementType: 'log' }, position: { x: 200, y: 100 } },
      { id: 'after', type: 'workflowNode', data: { label: 'After', elementType: 'log' }, position: { x: 300, y: 100 } },
    ],
    edges: [
      { id: 'e-case-a', source: 'sw-1', target: 'case-a', sourceHandle: 'branch_0', type: 'smoothstep' },
      { id: 'e-case-b', source: 'sw-1', target: 'case-b', sourceHandle: 'branch_1', type: 'smoothstep' },
      { id: 'e-default', source: 'sw-1', target: 'fallback', sourceHandle: 'branch_2', type: 'smoothstep' },
      { id: 'e-then', source: 'sw-1', target: 'after', sourceHandle: 'then', type: 'smoothstep' },
    ],
    selectedEdgeIds: [],
  })
}

function styleOf(edges: Edge[], id: string): Edge['style'] {
  return edges.find((e) => e.id === id)?.style
}

describe('useCanvasEdges - Switch lane styling', () => {
  it('paints a taken case lane with the branch traversed style', () => {
    seedSwitchGraph()
    seedRun(
      'exec-switch-taken',
      {
        'sw-1': 'success',
        'case-a': 'success',
        'case-b': 'skipped',
        fallback: 'skipped',
        after: 'success',
      },
      { 'sw-1': ['branch_0'] },
    )

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-case-a')).toEqual(TRAVERSED_STYLE)
  })

  // Guard: Switch lanes must inherit the If/Else branch styling, not fall through.
  it('styles a case lane exactly as an If/Else branch lane', () => {
    useWorkflowStore.setState({
      nodes: [
        { id: 'sw-1', type: 'workflowNode', data: { label: 'Switch', elementType: 'switch-case' }, position: { x: 0, y: 0 } },
        { id: 'sw-target', type: 'workflowNode', data: { label: 'Case', elementType: 'log' }, position: { x: 0, y: 100 } },
        { id: 'ie-1', type: 'workflowNode', data: { label: 'If / Else', elementType: 'if-else' }, position: { x: 200, y: 0 } },
        { id: 'ie-target', type: 'workflowNode', data: { label: 'Branch', elementType: 'log' }, position: { x: 200, y: 100 } },
      ],
      edges: [
        { id: 'e-sw-lane', source: 'sw-1', target: 'sw-target', sourceHandle: 'branch_0', type: 'smoothstep' },
        { id: 'e-ie-lane', source: 'ie-1', target: 'ie-target', sourceHandle: 'branch_0', type: 'smoothstep' },
      ],
      selectedEdgeIds: [],
    })
    seedRun(
      'exec-lane-parity',
      {
        'sw-1': 'success',
        'sw-target': 'success',
        'ie-1': 'success',
        'ie-target': 'success',
      },
      { 'sw-1': ['branch_0'], 'ie-1': ['branch_0'] },
    )

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-sw-lane')).toEqual(
      styleOf(result.current.allEdges, 'e-ie-lane'),
    )
    expect(styleOf(result.current.allEdges, 'e-sw-lane')).toEqual(TRAVERSED_STYLE)
  })

  // Guard: only one lane could ever highlight in a single run.
  it('highlights every case lane that ran when Break is off', () => {
    seedSwitchGraph()
    seedRun(
      'exec-switch-fallthrough',
      {
        'sw-1': 'success',
        'case-a': 'success',
        'case-b': 'success',
        fallback: 'skipped',
        after: 'success',
      },
      { 'sw-1': ['branch_0', 'branch_1'] },
    )

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-case-a')).toEqual(TRAVERSED_STYLE)
    expect(styleOf(result.current.allEdges, 'e-case-b')).toEqual(TRAVERSED_STYLE)
  })

  // Guard: an untaken lane painted green because 'skipped' counted as executed.
  it('dims a case lane whose chain was skipped', () => {
    seedSwitchGraph()
    seedRun(
      'exec-switch-untaken',
      {
        'sw-1': 'success',
        'case-a': 'success',
        'case-b': 'skipped',
        fallback: 'skipped',
        after: 'success',
      },
      { 'sw-1': ['branch_0'] },
    )

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-case-b')).toEqual(DIMMED_STYLE)
  })

  it('dims the default lane when a case matched', () => {
    seedSwitchGraph()
    seedRun(
      'exec-switch-default-untaken',
      {
        'sw-1': 'success',
        'case-a': 'success',
        'case-b': 'skipped',
        fallback: 'skipped',
        after: 'success',
      },
      { 'sw-1': ['branch_0'] },
    )

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-default')).toEqual(DIMMED_STYLE)
  })

  it('dims a case lane whose chain never started', () => {
    seedSwitchGraph()
    seedRun('exec-switch-unstarted', { 'sw-1': 'success', 'case-a': 'success' }, { 'sw-1': ['branch_0'] })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-case-b')).toEqual(DIMMED_STYLE)
  })

  // Guard: the always-present then egress must take the container styling.
  it('paints the then egress traversed once the continuation ran', () => {
    seedSwitchGraph()
    seedRun(
      'exec-switch-then',
      {
        'sw-1': 'success',
        'case-a': 'success',
        'case-b': 'skipped',
        fallback: 'skipped',
        after: 'success',
      },
      { 'sw-1': ['branch_0'] },
    )

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-then')).toEqual(TRAVERSED_STYLE)
  })

  it('dims the then egress while the continuation has not run', () => {
    seedSwitchGraph()
    seedRun('exec-switch-then-pending', { 'sw-1': 'success', 'case-a': 'success' }, { 'sw-1': ['branch_0'] })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-then')).toEqual(DIMMED_STYLE)
  })

  it('dims every lane of a cascade-skipped Switch', () => {
    seedSwitchGraph()
    seedRun('exec-switch-cascade', {
      'sw-1': 'skipped',
      'case-a': 'skipped',
      'case-b': 'skipped',
      fallback: 'skipped',
      after: 'skipped',
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    for (const id of ['e-case-a', 'e-case-b', 'e-default', 'e-then']) {
      expect(styleOf(result.current.allEdges, id)).toEqual(DIMMED_STYLE)
    }
  })
})

// ============================================================================
// Lane wires show the lanes the run took (REQ-3.5.1.6, REQ-3.5.1.11,
// REQ-3.5.1.17, REQ-3.5.4.3, REQ-3.2.2.6)
// ============================================================================

type Link = { id: string; source: string; target: string; sourceHandle?: string }

/** Seed a graph whose Blocks are every end of ``links``. */
function seedLinks(links: Link[]) {
  const ids = [...new Set(links.flatMap((link) => [link.source, link.target]))]
  useWorkflowStore.setState({
    nodes: ids.map((id, index) => ({
      id,
      type: 'workflowNode',
      data: { label: id, elementType: 'log' },
      position: { x: index * 100, y: 0 },
    })),
    edges: links.map((link) => ({ ...link, type: 'smoothstep' })),
    selectedEdgeIds: [],
  })
}

function renderEdges() {
  return renderHook(() => useCanvasEdges(defaultParams)).result.current.allEdges
}

describe('useCanvasEdges - lane wires show the lanes the run took', () => {
  const JOINED_BRANCHES: Link[] = [
    { id: 'e-if', source: 'ie-1', target: 'join', sourceHandle: 'branch_0' },
    { id: 'e-elif', source: 'ie-1', target: 'join', sourceHandle: 'branch_1' },
    { id: 'e-else', source: 'ie-1', target: 'join', sourceHandle: 'branch_2' },
  ]

  it('lights only the branch taken when every branch joins one Block', () => {
    seedLinks(JOINED_BRANCHES)
    seedRun('exec-joined', { 'ie-1': 'success', join: 'success' }, { 'ie-1': ['branch_0'] })

    const edges = renderEdges()

    expect(styleOf(edges, 'e-if')).toEqual(TRAVERSED_STYLE)
    expect(styleOf(edges, 'e-elif')).toEqual(DIMMED_STYLE)
    expect(styleOf(edges, 'e-else')).toEqual(DIMMED_STYLE)
  })

  it('lights the branch taken when the branches lead to different Blocks', () => {
    seedLinks([
      { id: 'e-if', source: 'ie-1', target: 'a', sourceHandle: 'branch_0' },
      { id: 'e-elif', source: 'ie-1', target: 'b', sourceHandle: 'branch_1' },
      { id: 'e-else', source: 'ie-1', target: 'c', sourceHandle: 'branch_2' },
    ])
    seedRun('exec-apart', { 'ie-1': 'success', a: 'success' }, { 'ie-1': ['branch_0'] })

    const edges = renderEdges()

    expect(styleOf(edges, 'e-if')).toEqual(TRAVERSED_STYLE)
    expect(styleOf(edges, 'e-elif')).toEqual(DIMMED_STYLE)
    expect(styleOf(edges, 'e-else')).toEqual(DIMMED_STYLE)
  })

  it('dims every branch of an If/Else that matched none', () => {
    seedLinks(JOINED_BRANCHES)
    seedRun('exec-no-match', { 'ie-1': 'success' })

    const edges = renderEdges()

    for (const id of ['e-if', 'e-elif', 'e-else']) {
      expect(styleOf(edges, id)).toEqual(DIMMED_STYLE)
    }
  })

  it.each([
    ['pass', TRAVERSED_STYLE, DIMMED_STYLE],
    ['fail', DIMMED_STYLE, FAILED_STYLE],
  ])('paints the split Assert lane %s and dims the other where both join', (lane, pass, fail) => {
    seedLinks([
      { id: 'e-pass', source: 'gate', target: 'join', sourceHandle: 'pass' },
      { id: 'e-fail', source: 'gate', target: 'join', sourceHandle: 'fail' },
    ])
    seedRun('exec-gate', { gate: 'success', join: 'success' }, { gate: [lane] })

    const edges = renderEdges()

    expect(styleOf(edges, 'e-pass')).toEqual(pass)
    expect(styleOf(edges, 'e-fail')).toEqual(fail)
  })

  it('dims the body of a loop that never ran it and lights its then lane', () => {
    seedLinks([
      { id: 'e-body', source: 'loop', target: 'body', sourceHandle: 'body' },
      { id: 'e-then', source: 'loop', target: 'after', sourceHandle: 'then' },
    ])
    seedRun('exec-zero-rounds', { loop: 'success', body: 'skipped', after: 'success' })

    const edges = renderEdges()

    expect(styleOf(edges, 'e-body')).toEqual(DIMMED_STYLE)
    expect(styleOf(edges, 'e-then')).toEqual(TRAVERSED_STYLE)
  })

  it('lights the body of a loop that ran it, whatever its first Block shows', () => {
    seedLinks([{ id: 'e-body', source: 'loop', target: 'disabled', sourceHandle: 'body' }])
    seedRun('exec-pass-through', { loop: 'success', disabled: 'skipped' }, { loop: ['body'] })

    expect(styleOf(renderEdges(), 'e-body')).toEqual(TRAVERSED_STYLE)
  })

  it('lights the try path and dims the catch path that never ran', () => {
    seedLinks([
      { id: 'e-try', source: 'guard', target: 'trier', sourceHandle: 'try' },
      { id: 'e-catch', source: 'guard', target: 'catcher', sourceHandle: 'catch' },
      { id: 'e-then', source: 'guard', target: 'after', sourceHandle: 'then' },
    ])
    seedRun(
      'exec-try',
      { guard: 'success', trier: 'success', catcher: 'skipped', after: 'success' },
      { guard: ['try'] },
    )

    const edges = renderEdges()

    expect(styleOf(edges, 'e-try')).toEqual(TRAVERSED_STYLE)
    expect(styleOf(edges, 'e-catch')).toEqual(DIMMED_STYLE)
    expect(styleOf(edges, 'e-then')).toEqual(TRAVERSED_STYLE)
  })

  it('lights a Wait Until retry lane only when a round ran it', () => {
    seedLinks([
      { id: 'e-retried', source: 'wait-1', target: 'probe-1', sourceHandle: 'retry' },
      { id: 'e-met', source: 'wait-2', target: 'probe-2', sourceHandle: 'retry' },
    ])
    seedRun(
      'exec-wait',
      { 'wait-1': 'success', 'probe-1': 'success', 'wait-2': 'success', 'probe-2': 'skipped' },
      { 'wait-1': ['retry'] },
    )

    const edges = renderEdges()

    expect(styleOf(edges, 'e-retried')).toEqual(TRAVERSED_STYLE)
    expect(styleOf(edges, 'e-met')).toEqual(DIMMED_STYLE)
  })

  it('lights every Parallel lane that started', () => {
    seedLinks([
      { id: 'e-one', source: 'fork', target: 'one', sourceHandle: 'branch_1' },
      { id: 'e-two', source: 'fork', target: 'two', sourceHandle: 'branch_2' },
    ])
    seedRun(
      'exec-fork',
      { fork: 'running', one: 'success', two: 'running' },
      { fork: ['branch_1', 'branch_2'] },
    )

    const edges = renderEdges()

    expect(styleOf(edges, 'e-one')).toEqual(TRAVERSED_STYLE)
    expect(styleOf(edges, 'e-two')).toEqual(TRAVERSED_STYLE)
  })

  it('dims the then lane when the Block after it was skipped and lights it once that Block runs', () => {
    seedLinks([
      { id: 'e-skipped', source: 'guard', target: 'never', sourceHandle: 'then' },
      { id: 'e-running', source: 'loop', target: 'next', sourceHandle: 'then' },
    ])
    seedRun('exec-then', { guard: 'failed', never: 'skipped', loop: 'success', next: 'running' })

    const edges = renderEdges()

    expect(styleOf(edges, 'e-skipped')).toEqual(DIMMED_STYLE)
    expect(styleOf(edges, 'e-running')).toEqual(TRAVERSED_STYLE)
  })

  it('lights the lane a disabled Block passed the flow through', () => {
    seedLinks([
      { id: 'e-through', source: 'ie-1', target: 'first', sourceHandle: 'branch_0' },
      { id: 'e-muted', source: 'ie-1', target: 'other', sourceHandle: 'branch_1' },
    ])
    seedRun(
      'exec-disabled',
      { 'ie-1': 'skipped', first: 'success', other: 'skipped' },
      { 'ie-1': ['branch_0'] },
    )

    const edges = renderEdges()

    expect(styleOf(edges, 'e-through')).toEqual(TRAVERSED_STYLE)
    expect(styleOf(edges, 'e-muted')).toEqual(DIMMED_STYLE)
  })

  it('leaves the lane wires of a Block that has not run unstyled', () => {
    seedLinks([
      { id: 'e-start', source: 'start-node', target: 'ie-1' },
      { id: 'e-if', source: 'ie-1', target: 'a', sourceHandle: 'branch_0' },
      { id: 'e-then', source: 'ie-1', target: 'b', sourceHandle: 'then' },
    ])
    seedRun('exec-not-yet', { a: 'success', b: 'success' })

    const edges = renderEdges()

    expect(styleOf(edges, 'e-if')).toBeUndefined()
    expect(styleOf(edges, 'e-then')).toBeUndefined()
  })

  it('reads the lanes of a history canvas from its provider', () => {
    seedLinks(JOINED_BRANCHES)
    seedRun('exec-live-other', { 'ie-1': 'success', join: 'success' }, { 'ie-1': ['branch_2'] })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <HistoricalBlockStatesProvider
        blockStates={{ 'ie-1': 'success', join: 'success' }}
        lanes={{ 'ie-1': ['branch_1'] }}
      >
        {children}
      </HistoricalBlockStatesProvider>
    )

    const edges = renderHook(() => useCanvasEdges(defaultParams), { wrapper }).result.current
      .allEdges

    expect(styleOf(edges, 'e-if')).toEqual(DIMMED_STYLE)
    expect(styleOf(edges, 'e-elif')).toEqual(TRAVERSED_STYLE)
    expect(styleOf(edges, 'e-else')).toEqual(DIMMED_STYLE)
  })

  it('dims every lane of a history canvas whose run stored no lanes', () => {
    seedLinks(JOINED_BRANCHES)
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <HistoricalBlockStatesProvider blockStates={{ 'ie-1': 'success', join: 'success' }}>
        {children}
      </HistoricalBlockStatesProvider>
    )

    const edges = renderHook(() => useCanvasEdges(defaultParams), { wrapper }).result.current
      .allEdges

    for (const id of ['e-if', 'e-elif', 'e-else']) {
      expect(styleOf(edges, id)).toEqual(DIMMED_STYLE)
    }
  })
})
