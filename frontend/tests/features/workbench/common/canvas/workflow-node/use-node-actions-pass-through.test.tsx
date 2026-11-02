/**
 * useNodeActions - disabled multi-egress cascade matrix.
 *
 * The hook's ``isUnreachable`` BFS walks ``start-node -> ...`` and uses an
 * internal ``disabledPassThroughHandles`` helper to decide which children of
 * a disabled control to keep enabled. This mirrors the backend
 * ``signals.py:_disabled_pass_through_handles`` matrix scenario-by-scenario
 * (see ``backend/tests/api/test_workbench_signals_pass_through.py``).
 *
 * The pass-through helper is private, so each case here is exercised
 * indirectly via ``isUnreachable``: we seed nodes + edges, render the hook
 * for the target child, then assert the muted descendants resolve as
 * unreachable while the kept descendants stay reachable.
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


// ===========================================================================
// Helpers
// ===========================================================================

interface MinNode {
  id: string
  type: 'workflowNode'
  position: { x: number; y: number }
  data: {
    label: string
    nodeType?: 'control' | 'plugin' | 'function'
    elementType?: string
    disabled?: boolean
    config?: Record<string, unknown>
  }
}

interface MinEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

function plugin(id: string): MinNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label: id, nodeType: 'plugin', elementType: 'shell-script' },
  }
}

function ctrl(
  id: string,
  elementType: string,
  opts: { disabled?: boolean; config?: Record<string, unknown> } = {},
): MinNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      nodeType: 'control',
      elementType,
      disabled: opts.disabled,
      config: opts.config,
    },
  }
}

function reset(nodes: MinNode[] = [], edges: MinEdge[] = []) {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    edges: edges as unknown as never,
    variables: [] as never,
    drillPath: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    isDirty: false,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AdHocActionsProvider dispatch={() => {}}>{children}</AdHocActionsProvider>
)

function renderActions(nodeId: string) {
  return renderHook(() => useNodeActions({ id: nodeId }), { wrapper })
}

beforeEach(() => reset())

// ===========================================================================
// Matrix: disabled multi-egress controls (mirrors BE pass-through tests)
// ===========================================================================

describe('useNodeActions.isUnreachable - disabled multi-egress matrix', () => {
  // -------------------------------------------------------------------------
  // Early-return guards
  // -------------------------------------------------------------------------

  it('does not cascade when the disabled node is not a control (plugin)', () => {
    // A disabled plugin: data.nodeType !== 'control' makes the matrix return
    // null - the BFS keeps walking through its children normally. The child
    // is reachable because the plugin's outgoing edge is followed without
    // any pass-through filtering.
    const log = {
      id: 'log',
      type: 'workflowNode' as const,
      position: { x: 0, y: 0 },
      data: {
        label: 'log',
        nodeType: 'plugin' as const,
        elementType: 'log',
        disabled: true,
      },
    }
    const after = plugin('after')
    reset([log, after], [
      { id: 'e0', source: 'start-node', target: 'log' },
      { id: 'e1', source: 'log', target: 'after' },
    ])

    expect(renderActions('after').result.current.isUnreachable).toBe(false)
  })

  it('does not cascade when the control is not disabled', () => {
    const ifElse = ctrl('if-1', 'if-else', {
      config: { values: { branches: [{ id: 'branch_a' }, { id: 'branch_b' }] } },
    })
    const a = plugin('a')
    const b = plugin('b')
    reset([ifElse, a, b], [
      { id: 'e0', source: 'start-node', target: 'if-1' },
      { id: 'e1', source: 'if-1', target: 'a', sourceHandle: 'branch_a' },
      { id: 'e2', source: 'if-1', target: 'b', sourceHandle: 'branch_b' },
    ])

    expect(renderActions('a').result.current.isUnreachable).toBe(false)
    expect(renderActions('b').result.current.isUnreachable).toBe(false)
  })

  // -------------------------------------------------------------------------
  // assert (split mode) - keeps 'pass'
  // -------------------------------------------------------------------------

  it('assert (split mode): keeps "pass" branch, mutes "fail" branch', () => {
    const assertNode = ctrl('as-1', 'assert', {
      disabled: true,
      config: { values: { mode: 'split' } },
    })
    const pass = plugin('pass-target')
    const fail = plugin('fail-target')
    reset([assertNode, pass, fail], [
      { id: 'e0', source: 'start-node', target: 'as-1' },
      { id: 'e1', source: 'as-1', target: 'pass-target', sourceHandle: 'pass' },
      { id: 'e2', source: 'as-1', target: 'fail-target', sourceHandle: 'fail' },
    ])

    expect(renderActions('pass-target').result.current.isUnreachable).toBe(false)
    expect(renderActions('fail-target').result.current.isUnreachable).toBe(true)
  })

  it('assert with no config defaults to split mode (keeps "pass")', () => {
    // Triggers the `(config?.mode as string | undefined) ?? 'split'` default.
    const assertNode = ctrl('as-2', 'assert', { disabled: true })
    const pass = plugin('p')
    const fail = plugin('f')
    reset([assertNode, pass, fail], [
      { id: 'e0', source: 'start-node', target: 'as-2' },
      { id: 'e1', source: 'as-2', target: 'p', sourceHandle: 'pass' },
      { id: 'e2', source: 'as-2', target: 'f', sourceHandle: 'fail' },
    ])

    expect(renderActions('p').result.current.isUnreachable).toBe(false)
    expect(renderActions('f').result.current.isUnreachable).toBe(true)
  })

  it('assert (single mode): returns null - all children pass through (no cascade)', () => {
    // mode !== 'split' returns null, which makes the BFS skip pass-through
    // filtering entirely - the disabled assert behaves like a single-egress
    // control, so the downstream child stays reachable.
    const assertNode = ctrl('as-3', 'assert', {
      disabled: true,
      config: { values: { mode: 'single' } },
    })
    const after = plugin('after')
    reset([assertNode, after], [
      { id: 'e0', source: 'start-node', target: 'as-3' },
      { id: 'e1', source: 'as-3', target: 'after' },
    ])

    expect(renderActions('after').result.current.isUnreachable).toBe(false)
  })

  // -------------------------------------------------------------------------
  // try-catch-finally / for / for-each / while - empty set + implicit 'then'
  // -------------------------------------------------------------------------

  it('try-catch-finally: keeps "then", mutes "try"/"catch"/"finally"', () => {
    const tc = ctrl('tc-1', 'try-catch-finally', { disabled: true })
    const tryT = plugin('try-target')
    const catchT = plugin('catch-target')
    const finallyT = plugin('finally-target')
    const thenT = plugin('then-target')
    reset([tc, tryT, catchT, finallyT, thenT], [
      { id: 'e0', source: 'start-node', target: 'tc-1' },
      { id: 'e1', source: 'tc-1', target: 'try-target', sourceHandle: 'try' },
      { id: 'e2', source: 'tc-1', target: 'catch-target', sourceHandle: 'catch' },
      { id: 'e3', source: 'tc-1', target: 'finally-target', sourceHandle: 'finally' },
      { id: 'e4', source: 'tc-1', target: 'then-target', sourceHandle: 'then' },
    ])

    expect(renderActions('try-target').result.current.isUnreachable).toBe(true)
    expect(renderActions('catch-target').result.current.isUnreachable).toBe(true)
    expect(renderActions('finally-target').result.current.isUnreachable).toBe(true)
    expect(renderActions('then-target').result.current.isUnreachable).toBe(false)
  })

  it('for: keeps "then", mutes "body"', () => {
    const forNode = ctrl('for-1', 'for', { disabled: true })
    const body = plugin('body-target')
    const after = plugin('then-target')
    reset([forNode, body, after], [
      { id: 'e0', source: 'start-node', target: 'for-1' },
      { id: 'e1', source: 'for-1', target: 'body-target', sourceHandle: 'body' },
      { id: 'e2', source: 'for-1', target: 'then-target', sourceHandle: 'then' },
    ])

    expect(renderActions('body-target').result.current.isUnreachable).toBe(true)
    expect(renderActions('then-target').result.current.isUnreachable).toBe(false)
  })

  it('for-each: keeps "then", mutes "body"', () => {
    const feNode = ctrl('fe-1', 'for-each', { disabled: true })
    const body = plugin('body-target')
    const after = plugin('then-target')
    reset([feNode, body, after], [
      { id: 'e0', source: 'start-node', target: 'fe-1' },
      { id: 'e1', source: 'fe-1', target: 'body-target', sourceHandle: 'body' },
      { id: 'e2', source: 'fe-1', target: 'then-target', sourceHandle: 'then' },
    ])

    expect(renderActions('body-target').result.current.isUnreachable).toBe(true)
    expect(renderActions('then-target').result.current.isUnreachable).toBe(false)
  })

  it('while: keeps "then", mutes "body"', () => {
    const wh = ctrl('while-1', 'while', { disabled: true })
    const body = plugin('body-target')
    const after = plugin('then-target')
    reset([wh, body, after], [
      { id: 'e0', source: 'start-node', target: 'while-1' },
      { id: 'e1', source: 'while-1', target: 'body-target', sourceHandle: 'body' },
      { id: 'e2', source: 'while-1', target: 'then-target', sourceHandle: 'then' },
    ])

    expect(renderActions('body-target').result.current.isUnreachable).toBe(true)
    expect(renderActions('then-target').result.current.isUnreachable).toBe(false)
  })

  // -------------------------------------------------------------------------
  // if-else
  // -------------------------------------------------------------------------

  it('if-else with branches: keeps the FIRST branch id, mutes the rest', () => {
    const ifElse = ctrl('if-1', 'if-else', {
      disabled: true,
      config: { values: { branches: [{ id: 'branch_a' }, { id: 'branch_b' }] } },
    })
    const a = plugin('branch-a-target')
    const b = plugin('branch-b-target')
    reset([ifElse, a, b], [
      { id: 'e0', source: 'start-node', target: 'if-1' },
      { id: 'e1', source: 'if-1', target: 'branch-a-target', sourceHandle: 'branch_a' },
      { id: 'e2', source: 'if-1', target: 'branch-b-target', sourceHandle: 'branch_b' },
    ])

    expect(renderActions('branch-a-target').result.current.isUnreachable).toBe(false)
    expect(renderActions('branch-b-target').result.current.isUnreachable).toBe(true)
  })

  it('if-else with empty branches: mutes every branch descendant', () => {
    const ifElse = ctrl('if-2', 'if-else', {
      disabled: true,
      config: { values: { branches: [] } },
    })
    const stranded = plugin('stranded')
    reset([ifElse, stranded], [
      { id: 'e0', source: 'start-node', target: 'if-2' },
      { id: 'e1', source: 'if-2', target: 'stranded', sourceHandle: 'branch_x' },
    ])

    expect(renderActions('stranded').result.current.isUnreachable).toBe(true)
  })

  it('if-else with branch missing id: mutes everything (firstId resolves falsy)', () => {
    const ifElse = ctrl('if-3', 'if-else', {
      disabled: true,
      config: { values: { branches: [{ label: 'x' }] } },
    })
    const stranded = plugin('stranded')
    reset([ifElse, stranded], [
      { id: 'e0', source: 'start-node', target: 'if-3' },
      { id: 'e1', source: 'if-3', target: 'stranded', sourceHandle: 'branch_a' },
    ])

    expect(renderActions('stranded').result.current.isUnreachable).toBe(true)
  })

  it('if-else with no config: empty branches default, everything muted', () => {
    // Exercises the `(config?.branches as ...) ?? []` default.
    const ifElse = ctrl('if-4', 'if-else', { disabled: true })
    const stranded = plugin('stranded')
    reset([ifElse, stranded], [
      { id: 'e0', source: 'start-node', target: 'if-4' },
      { id: 'e1', source: 'if-4', target: 'stranded', sourceHandle: 'branch_a' },
    ])

    expect(renderActions('stranded').result.current.isUnreachable).toBe(true)
  })

  // -------------------------------------------------------------------------
  // switch-case - container: empty set + implicit 'then'
  // -------------------------------------------------------------------------

  it('switch-case: keeps "then", mutes every case and the default', () => {
    // Container parity with try-catch: the branch list is never consulted, so
    // no case is kept the way if-else keeps its first branch.
    const sw = ctrl('sw-1', 'switch-case', {
      disabled: true,
      config: {
        values: {
          branches: [
            { id: 'branch_0', type: 'case', label: '', conditions: [], break: true },
            { id: 'branch_1', type: 'case', label: 'Slow', conditions: [], break: false },
            { id: 'branch_2', type: 'default', label: '' },
          ],
        },
      },
    })
    const caseFirst = plugin('case-0-target')
    const caseSecond = plugin('case-1-target')
    const defaultTarget = plugin('default-target')
    const thenTarget = plugin('then-target')
    reset([sw, caseFirst, caseSecond, defaultTarget, thenTarget], [
      { id: 'e0', source: 'start-node', target: 'sw-1' },
      { id: 'e1', source: 'sw-1', target: 'case-0-target', sourceHandle: 'branch_0' },
      { id: 'e2', source: 'sw-1', target: 'case-1-target', sourceHandle: 'branch_1' },
      { id: 'e3', source: 'sw-1', target: 'default-target', sourceHandle: 'branch_2' },
      { id: 'e4', source: 'sw-1', target: 'then-target', sourceHandle: 'then' },
    ])

    expect(renderActions('case-0-target').result.current.isUnreachable).toBe(true)
    expect(renderActions('case-1-target').result.current.isUnreachable).toBe(true)
    expect(renderActions('default-target').result.current.isUnreachable).toBe(true)
    // Guard: Switch is a container, never diverging - 'then' stays reachable.
    expect(renderActions('then-target').result.current.isUnreachable).toBe(false)
  })

  // -------------------------------------------------------------------------
  // parallel - container: empty set + implicit 'then' (REQ-3.2.3.2)
  // -------------------------------------------------------------------------

  it('parallel: keeps "then", mutes every branch body', () => {
    // Container parity with switch-case: no branch is kept the way if-else
    // keeps its first branch, so the exit lane is the only pass-through.
    const par = ctrl('par-1', 'parallel', {
      disabled: true,
      config: {
        values: {
          branches: [
            { id: 'branch_1', name: 'ingest' },
            { id: 'branch_2', name: 'probe' },
          ],
        },
      },
    })
    const first = plugin('branch-1-target')
    const second = plugin('branch-2-target')
    const thenTarget = plugin('then-target')
    reset([par, first, second, thenTarget], [
      { id: 'e0', source: 'start-node', target: 'par-1' },
      { id: 'e1', source: 'par-1', target: 'branch-1-target', sourceHandle: 'branch_1' },
      { id: 'e2', source: 'par-1', target: 'branch-2-target', sourceHandle: 'branch_2' },
      { id: 'e3', source: 'par-1', target: 'then-target', sourceHandle: 'then' },
    ])

    expect(renderActions('branch-1-target').result.current.isUnreachable).toBe(true)
    expect(renderActions('branch-2-target').result.current.isUnreachable).toBe(true)
    // Guard: Parallel is a container, never diverging - 'then' stays reachable.
    expect(renderActions('then-target').result.current.isUnreachable).toBe(false)
  })

  it('parallel: mutes a whole branch chain, not just its head', () => {
    const par = ctrl('par-1', 'parallel', {
      disabled: true,
      config: {
        values: {
          branches: [
            { id: 'branch_1', name: '' },
            { id: 'branch_2', name: '' },
          ],
        },
      },
    })
    const head = plugin('branch-1-head')
    const tail = plugin('branch-1-tail')
    const second = plugin('branch-2-target')
    const thenTarget = plugin('then-target')
    reset([par, head, tail, second, thenTarget], [
      { id: 'e0', source: 'start-node', target: 'par-1' },
      { id: 'e1', source: 'par-1', target: 'branch-1-head', sourceHandle: 'branch_1' },
      { id: 'e2', source: 'branch-1-head', target: 'branch-1-tail' },
      { id: 'e3', source: 'par-1', target: 'branch-2-target', sourceHandle: 'branch_2' },
      { id: 'e4', source: 'par-1', target: 'then-target', sourceHandle: 'then' },
    ])

    expect(renderActions('branch-1-tail').result.current.isUnreachable).toBe(true)
    expect(renderActions('then-target').result.current.isUnreachable).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Unknown / single-egress control (sentinel: returns null)
  // -------------------------------------------------------------------------

  it('disabled single-egress control: matrix returns null, child stays reachable', () => {
    // Element type 'delay' isn't in the multi-egress matrix; pass-through
    // returns null and the BFS walks through without filtering.
    const delay = ctrl('d-1', 'delay', { disabled: true })
    const after = plugin('after')
    reset([delay, after], [
      { id: 'e0', source: 'start-node', target: 'd-1' },
      { id: 'e1', source: 'd-1', target: 'after' },
    ])

    expect(renderActions('after').result.current.isUnreachable).toBe(false)
  })

  it('cascades a disabled if-else edge that has no sourceHandle ("" handle is not pass-through)', () => {
    // Exercises the ``sourceHandle ?? ''`` default in the BFS filter.
    // Edge from the disabled if-else has no sourceHandle, so handle = ''.
    // '' is neither 'then' nor in passThrough; cascade-skips the child.
    const ifElse = ctrl('if-x', 'if-else', {
      disabled: true,
      config: { values: { branches: [{ id: 'branch_a' }] } },
    })
    const noHandle = plugin('no-handle')
    reset([ifElse, noHandle], [
      { id: 'e0', source: 'start-node', target: 'if-x' },
      { id: 'e1', source: 'if-x', target: 'no-handle' }, // no sourceHandle
    ])

    expect(renderActions('no-handle').result.current.isUnreachable).toBe(true)
  })

  it('tolerates a node whose data is missing at runtime (defensive `node.data ?? {}` default)', () => {
    // The matrix signature widens ``data`` to optional, so a node without
    // ``data`` at runtime must not crash the BFS. Such a node trivially has
    // disabled !== true (data is empty), so passThrough returns null and the
    // child remains reachable - we only assert the lookup succeeded.
    const malformed = {
      id: 'malformed',
      type: 'workflowNode' as const,
      position: { x: 0, y: 0 },
      // ``data`` deliberately missing to exercise the runtime guard.
    }
    const after = plugin('after')
    reset([malformed as unknown as MinNode, after], [
      { id: 'e0', source: 'start-node', target: 'malformed' },
      { id: 'e1', source: 'malformed', target: 'after' },
    ])

    expect(renderActions('after').result.current.isUnreachable).toBe(false)
  })
})

// ===========================================================================
// isUnreachable - topology cases (no disabled cascade involved)
// ===========================================================================

describe('useNodeActions.isUnreachable - topology', () => {
  it('marks a node disconnected from start as unreachable', () => {
    const orphan = plugin('orphan')
    const connected = plugin('connected')
    reset([orphan, connected], [
      { id: 'e0', source: 'start-node', target: 'connected' },
    ])

    expect(renderActions('orphan').result.current.isUnreachable).toBe(true)
    expect(renderActions('connected').result.current.isUnreachable).toBe(false)
  })

  it('reaches grand-children through a chain', () => {
    const a = plugin('a')
    const b = plugin('b')
    const c = plugin('c')
    reset([a, b, c], [
      { id: 'e0', source: 'start-node', target: 'a' },
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ])

    expect(renderActions('a').result.current.isUnreachable).toBe(false)
    expect(renderActions('b').result.current.isUnreachable).toBe(false)
    expect(renderActions('c').result.current.isUnreachable).toBe(false)
  })
})
