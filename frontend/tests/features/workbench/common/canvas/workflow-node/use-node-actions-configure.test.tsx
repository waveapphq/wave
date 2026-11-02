/**
 * useNodeActions - configuring a block selects it.
 *
 * The action cluster stops its click reaching the canvas, so React Flow never
 * selects the block underneath. Without an explicit selection the keyboard and
 * the open config sheet disagree about which block is being worked on: Enter
 * would reopen a different block's config, or nothing at all.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useNodeActions } from '@/features/workbench/common/canvas/workflow-node/use-node-actions'
import { AdHocActionsProvider } from '@/features/workbench/common/canvas/adhoc-actions-context'
// Canvas nodes report a failed Function-body read through the toast; these
// specs render nodes without the app shell that provides one.
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  const { use } = await import('react')
  const fallback = { error: vi.fn() }
  return { ...actual, useToast: () => use(actual.ToastContext) ?? fallback }
})


function plugin(id: string) {
  return {
    id,
    type: 'workflowNode' as const,
    position: { x: 0, y: 0 },
    data: { label: id, nodeType: 'plugin' as const, elementType: 'shell-script' },
  }
}

function seed(selectedNodeIds: string[] = []) {
  useWorkflowStore.setState({
    nodes: [plugin('a'), plugin('b')] as unknown as never,
    edges: [] as never,
    variables: [] as never,
    drillPath: [],
    selectedNodeIds,
    selectedEdgeIds: [],
    openConfigNodeIds: [],
    isDirty: false,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AdHocActionsProvider dispatch={() => {}}>{children}</AdHocActionsProvider>
)

function renderActions(nodeId: string) {
  return renderHook(() => useNodeActions({ id: nodeId }), { wrapper })
}

beforeEach(() => seed())

describe('useNodeActions.handleConfigureClick', () => {
  it('selects the block it opens when nothing was selected', () => {
    const { result } = renderActions('a')

    act(() => result.current.handleConfigureClick())

    expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['a'])
    expect(useWorkflowStore.getState().openConfigNodeIds).toContain('a')
  })

  it('moves the selection to the block it opens', () => {
    seed(['b'])
    const { result } = renderActions('a')

    act(() => result.current.handleConfigureClick())

    expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['a'])
  })

  it('leaves an already-selected block selected', () => {
    seed(['a'])
    const { result } = renderActions('a')

    act(() => result.current.handleConfigureClick())

    expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['a'])
    expect(useWorkflowStore.getState().openConfigNodeIds).toContain('a')
  })

  it('still selects when the sheet is already open and is merely raised', () => {
    seed(['b'])
    const { result } = renderActions('a')
    act(() => result.current.handleConfigureClick())
    act(() => {
      seed(['b'])
      useWorkflowStore.setState({ openConfigNodeIds: ['a'] } as Partial<
        ReturnType<typeof useWorkflowStore.getState>
      >)
    })

    act(() => result.current.handleConfigureClick())

    expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['a'])
  })
})
