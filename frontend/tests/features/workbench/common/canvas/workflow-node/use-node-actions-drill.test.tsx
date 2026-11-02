/**
 * useNodeActions - drill-aware derived selectors.
 *
 * `ingressCount`, `isUnreachable`, and `hasConnections` must read from the
 * active subtree so that nodes inside a drilled-in local Function render
 * with the correct connectivity state. Without this, inner nodes look
 * unreachable / unconnected and the "Unlink" menu entry is hidden.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useNodeActions } from '@/features/workbench/common/canvas/workflow-node/use-node-actions'
import { AdHocActionsProvider } from '@/features/workbench/common/canvas/adhoc-actions-context'
import type { ReactNode } from 'react'
// Canvas nodes report a failed Function-body read through the toast; these
// specs render nodes without the app shell that provides one.
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  const { use } = await import('react')
  const fallback = { error: vi.fn() }
  return { ...actual, useToast: () => use(actual.ToastContext) ?? fallback }
})


interface MinimalNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    nodeType?: 'control' | 'plugin' | 'function'
    functionLifecycle?: 'local' | 'shared'
    elementType?: string
    localDefinition?: {
      workflow: { nodes: MinimalNode[]; edges: Array<{ id: string; source: string; target: string }> }
      inputs: unknown[]
      outputs: unknown[]
      variables?: unknown[]
    }
  }
}

const plugin = (id: string): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: { label: id, nodeType: 'plugin', elementType: 'shell-script' },
})

const localFn = (
  id: string,
  inner: { nodes?: MinimalNode[]; edges?: Array<{ id: string; source: string; target: string }> } = {},
): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: {
    label: id,
    nodeType: 'function',
    elementType: 'function',
    functionLifecycle: 'local',
    localDefinition: {
      workflow: { nodes: inner.nodes ?? [], edges: inner.edges ?? [] },
      inputs: [],
      outputs: [],
      variables: [],
    },
  },
})

interface MinimalIssue {
  code: string
  severity: 'error' | 'warning'
  message: string
}

function reset(
  nodes: MinimalNode[] = [],
  edges: Array<{ id: string; source: string; target: string }> = [],
  nodeIssues: Map<string, MinimalIssue[]> = new Map(),
) {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    edges: edges as unknown as never,
    variables: [] as never,
    drillPath: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    isDirty: false,
    nodeIssues: nodeIssues as unknown as never,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AdHocActionsProvider dispatch={() => {}}>{children}</AdHocActionsProvider>
)

beforeEach(() => reset())

describe('useNodeActions - drill-aware connectivity', () => {
  it('inner node is reachable when an inner edge connects it from start-node', () => {
    const inner = plugin('inner-1')
    const fn = localFn('fn-1', {
      nodes: [inner],
      edges: [{ id: 'e1', source: 'start-node', target: 'inner-1' }],
    })
    reset([fn])
    useWorkflowStore.getState().pushDrill('fn-1')

    const { result } = renderHook(() => useNodeActions({ id: 'inner-1' }), { wrapper })

    expect(result.current.isUnreachable).toBe(false)
    expect(result.current.ingressCount).toBe(1)
  })

  it('inner node menu Unlink entry is enabled when inner edges connect it', () => {
    const a = plugin('a')
    const b = plugin('b')
    const fn = localFn('fn-1', {
      nodes: [a, b],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
    })
    reset([fn])
    useWorkflowStore.getState().pushDrill('fn-1')

    const { result } = renderHook(() => useNodeActions({ id: 'a' }), { wrapper })

    const unlinkEntry = result.current.menuGroups
      .flat()
      .find((item) => item.action === 'unlink')
    expect(unlinkEntry).toBeDefined()
    expect(unlinkEntry?.itemDisabled).toBe(false)
  })

  it('inner node menu Unlink entry is disabled when no inner edges touch it', () => {
    const a = plugin('a')
    const fn = localFn('fn-1', { nodes: [a], edges: [] })
    reset([fn])
    useWorkflowStore.getState().pushDrill('fn-1')

    const { result } = renderHook(() => useNodeActions({ id: 'a' }), { wrapper })

    const unlinkEntry = result.current.menuGroups
      .flat()
      .find((item) => item.action === 'unlink')
    expect(unlinkEntry?.itemDisabled).toBe(true)
  })
})

// PYRUN-14: a warning never marks the block invalid, so it is not a node issue.
describe('useNodeActions - node issue severity', () => {
  const WARNING: MinimalIssue = {
    code: 'OUTPUT_LIST_NAME',
    severity: 'warning',
    message: "Script never sets 'COUNT'",
  }
  const ERROR: MinimalIssue = {
    code: 'REQUIRED_PARAM_MISSING',
    severity: 'error',
    message: 'Script has a syntax error on line 3',
  }

  function renderWith(issues: MinimalIssue[]) {
    reset([plugin('py-1')])
    // Seeding nodes recomputes the issue map, so the fixture issues go in after that.
    useWorkflowStore.setState({
      nodeIssues: new Map([['py-1', issues]]) as unknown as never,
    } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
    return renderHook(() => useNodeActions({ id: 'py-1' }), { wrapper })
  }

  it('reports no node issue while every issue is a warning', () => {
    const { result } = renderWith([WARNING])

    expect(result.current.hasNodeIssue).toBe(false)
  })

  it('reports a node issue as soon as one issue is an error', () => {
    const { result } = renderWith([ERROR, WARNING])

    expect(result.current.hasNodeIssue).toBe(true)
  })
})
