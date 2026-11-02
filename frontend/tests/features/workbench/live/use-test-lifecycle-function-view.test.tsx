/** useTestLifecycle with the real store: a library View reached by a plain /workbench keeps its draft and never touches the Test draft (VIEW-10). */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: vi.fn() }),
}))
vi.mock('@/features/settings/api/global-variables/crud', () => ({
  fetchSystemVariables: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/features/tests/api/crud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tests/api/crud')>()),
  fetchTest: vi.fn(),
}))

import { useTestLifecycle } from '@/features/workbench/live/use-test-lifecycle'
import { useWorkflowStore, type NodeType } from '@/features/workbench/stores/workflow-store'
import type { SharedFunctionBody } from '@/features/functions/canvas/shared-function-body'
import { createSimpleRouterWrapper } from '../../../utils/router-test-utils'

const DRAFT_KEY = 'wave-workbench-draft'
const ROOT_ID = 'view-shared-root'

const TEST_DRAFT = JSON.stringify({
  nodes: [{ id: 'draft-marker', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Draft' } }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  testId: null,
  testName: null,
  isDirty: true,
  variables: [],
})

function node(id: string, data: Record<string, unknown>): NodeType {
  return { id, type: 'workflowNode', position: { x: 0, y: 0 }, data } as NodeType
}

const OUTER_BODY: SharedFunctionBody = {
  workflow: { nodes: [node('outer-log', { label: 'Outer Log', elementType: 'log', nodeType: 'plugin' })], edges: [] },
  inputs: [],
  outputs: [],
  variables: [],
}

function openEditModeView(): void {
  const store = useWorkflowStore.getState()
  store.reset()
  store.enterFunctionView({ functionId: 'fn-outer', version: '1.0.0', editable: false, name: 'Outer' })
  store.setNodes(
    [
      node(ROOT_ID, {
        label: 'Outer',
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: 'fn-outer',
        functionVersion: '1.0.0',
      }),
    ],
    { skipDirty: true },
  )
  store.pushSharedDrill(ROOT_ID, OUTER_BODY)
  store.markSaved()
  store.applyEditModeEntered(
    ROOT_ID,
    {
      ...useWorkflowStore.getState().nodes[0].data,
      editMode: true,
      upstreamLink: { functionId: 'fn-outer', sourceVersion: '1.0.0' },
      draft: OUTER_BODY,
    },
    false,
  )
}

function params() {
  return {
    setValidationErrors: vi.fn(),
    setValidationFatal: vi.fn(),
    setValidationMode: vi.fn(),
    setShowValidationErrorDialog: vi.fn(),
    workbenchStatus: 'idle',
    isSessionRecoveryComplete: true,
    recoveredTestId: null,
    setShowSwitchTestDialog: vi.fn(),
    setIsNewTestMode: vi.fn(),
  }
}

function visitPlainWorkbench() {
  return renderHook(() => useTestLifecycle(params()), { wrapper: createSimpleRouterWrapper(['/workbench']) })
}

function expectViewDraftKept(): void {
  const state = useWorkflowStore.getState()
  expect(state.functionViewMode?.functionId).toBe('fn-outer')
  expect(state.drillPath.map((entry) => entry.nodeId)).toEqual([ROOT_ID])
  expect(state.getActiveNodes().map((n) => n.id)).toEqual(['outer-log'])
  expect(state.nodes.map((n) => n.id)).toEqual([ROOT_ID])
  expect(state.hasEditModeNodes()).toBe(true)
  expect(state.isDirty).toBe(true)
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.removeItem(DRAFT_KEY)
  openEditModeView()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.removeItem(DRAFT_KEY)
  useWorkflowStore.getState().reset()
})

describe('useTestLifecycle - library View on a plain /workbench', () => {
  it('writes no Test draft from the View, however long the visit lasts', async () => {
    visitPlainWorkbench()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expectViewDraftKept()
  })

  it('never restores a Test draft into the View body', async () => {
    localStorage.setItem(DRAFT_KEY, TEST_DRAFT)
    visitPlainWorkbench()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expectViewDraftKept()
    expect(localStorage.getItem(DRAFT_KEY)).toBe(TEST_DRAFT)
  })

  it('keeps the View draft over two Workbench visits with a page in between', async () => {
    const first = visitPlainWorkbench()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    first.unmount()
    visitPlainWorkbench()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expectViewDraftKept()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })
})
