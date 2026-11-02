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

  it('applies traversed style to for loop body handle edge when both source and target executed', () => {
    useExecutionStore.setState({
      activeExecutionId: 'exec-for',
      executions: {
        'exec-for': {
          id: 'exec-for',
          testId: 'test-1',
          status: 'running',
          startTime: Date.now(),
          blocks: {
            'for-1': { id: 'be-for', blockId: 'for-1', status: 'success' },
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
    // Edge should be styled (not default) when both nodes have execution state
    const edge = result.current.allEdges[0]
    expect(edge.style).toBeDefined()
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

type BlockStatus = 'success' | 'failed' | 'skipped'

function seedRun(executionId: string, statuses: Record<string, BlockStatus>) {
  const blocks: Record<string, { id: string; blockId: string; status: BlockStatus }> = {}
  for (const [blockId, status] of Object.entries(statuses)) {
    blocks[blockId] = { id: `be-${blockId}`, blockId, status }
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
    seedRun('exec-switch-taken', {
      'sw-1': 'success',
      'case-a': 'success',
      'case-b': 'skipped',
      fallback: 'skipped',
      after: 'success',
    })

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
    seedRun('exec-lane-parity', {
      'sw-1': 'success',
      'sw-target': 'success',
      'ie-1': 'success',
      'ie-target': 'success',
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-sw-lane')).toEqual(
      styleOf(result.current.allEdges, 'e-ie-lane'),
    )
    expect(styleOf(result.current.allEdges, 'e-sw-lane')).toEqual(TRAVERSED_STYLE)
  })

  // Guard: only one lane could ever highlight in a single run.
  it('highlights every case lane that ran when Break is off', () => {
    seedSwitchGraph()
    seedRun('exec-switch-fallthrough', {
      'sw-1': 'success',
      'case-a': 'success',
      'case-b': 'success',
      fallback: 'skipped',
      after: 'success',
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-case-a')).toEqual(TRAVERSED_STYLE)
    expect(styleOf(result.current.allEdges, 'e-case-b')).toEqual(TRAVERSED_STYLE)
  })

  // Guard: an untaken lane painted green because 'skipped' counted as executed.
  it('dims a case lane whose chain was skipped', () => {
    seedSwitchGraph()
    seedRun('exec-switch-untaken', {
      'sw-1': 'success',
      'case-a': 'success',
      'case-b': 'skipped',
      fallback: 'skipped',
      after: 'success',
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-case-b')).toEqual(DIMMED_STYLE)
  })

  it('dims the default lane when a case matched', () => {
    seedSwitchGraph()
    seedRun('exec-switch-default-untaken', {
      'sw-1': 'success',
      'case-a': 'success',
      'case-b': 'skipped',
      fallback: 'skipped',
      after: 'success',
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-default')).toEqual(DIMMED_STYLE)
  })

  it('dims a case lane whose chain never started', () => {
    seedSwitchGraph()
    seedRun('exec-switch-unstarted', { 'sw-1': 'success', 'case-a': 'success' })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-case-b')).toEqual(DIMMED_STYLE)
  })

  // Guard: the always-present then egress must take the container styling.
  it('paints the then egress traversed once the continuation ran', () => {
    seedSwitchGraph()
    seedRun('exec-switch-then', {
      'sw-1': 'success',
      'case-a': 'success',
      'case-b': 'skipped',
      fallback: 'skipped',
      after: 'success',
    })

    const { result } = renderHook(() => useCanvasEdges(defaultParams))

    expect(styleOf(result.current.allEdges, 'e-then')).toEqual(TRAVERSED_STYLE)
  })

  it('dims the then egress while the continuation has not run', () => {
    seedSwitchGraph()
    seedRun('exec-switch-then-pending', { 'sw-1': 'success', 'case-a': 'success' })

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
