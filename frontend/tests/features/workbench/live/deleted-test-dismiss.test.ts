/**
 * The two answers to the "Test not found" dialog.
 *
 * What each one leaves behind is the whole contract. Discard leaves an empty
 * draft the user can work in, no test identity, no dead backend session, and a
 * canvas that is not stuck behind the loading overlay. The overlay comes down
 * only when a fit view is requested (the canvas hook turns that into
 * `isCanvasReady`), so `fitViewRequested` is the seam this asserts on. Keep
 * leaves the work exactly as it was, with only the test identity dropped.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  dismissDeletedTest,
  keepDeletedTestOnCanvas,
} from '@/features/workbench/live/deleted-test-dismiss'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'

const clearSession = vi.fn<() => Promise<void>>()

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: { clearSession: () => clearSession() },
}))

function makeDeps() {
  return { resetWorkbenchRun: vi.fn(), toastError: vi.fn(), clearDraft: vi.fn() }
}

describe('dismissDeletedTest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSession.mockResolvedValue(undefined)
    useWorkflowStore.getState().reset()
    useDeletedTestStore.getState().clear()
    useDeletedTestStore.getState().raise({ testId: 'test-gone', testName: 'Payment smoke' })
    useWorkflowStore.getState().setEditingTest('test-gone', 'Payment smoke')
    useWorkflowStore.setState({ isCanvasReady: true, fitViewRequested: false })
  })

  it('asks for a fit view so the canvas overlay comes down', () => {
    dismissDeletedTest(makeDeps())

    expect(useWorkflowStore.getState().fitViewRequested).toBe(true)
    expect(useWorkflowStore.getState().fitViewOptions).toEqual({ padding: 0.2, duration: 0 })
  })

  it('closes the dialog and leaves an empty, unnamed draft', () => {
    useWorkflowStore.getState().setNodes([
      { id: 'n1', type: 'workflowNode', position: { x: 0, y: 0 }, data: {} },
    ] as Parameters<ReturnType<typeof useWorkflowStore.getState>['setNodes']>[0])

    dismissDeletedTest(makeDeps())

    const state = useWorkflowStore.getState()
    expect(useDeletedTestStore.getState().info).toBeNull()
    expect(state.nodes).toEqual([])
    expect(state.edges).toEqual([])
    expect(state.editingTestId).toBeNull()
    expect(state.editingTestName).toBeNull()
    expect(state.isDirty).toBe(false)
  })

  it('drops the local run state, the stored draft and the backend session', () => {
    const deps = makeDeps()

    dismissDeletedTest(deps)

    expect(deps.resetWorkbenchRun).toHaveBeenCalledOnce()
    expect(deps.clearDraft).toHaveBeenCalledOnce()
    expect(clearSession).toHaveBeenCalledOnce()
  })

  it('reports a failed session clear on the toast without throwing', async () => {
    clearSession.mockRejectedValue(new Error('offline'))
    const deps = makeDeps()

    dismissDeletedTest(deps)
    await vi.waitFor(() => expect(deps.toastError).toHaveBeenCalled())

    expect(deps.toastError).toHaveBeenCalledWith(
      expect.stringContaining('offline'),
      'Session Not Cleared',
    )
    expect(useWorkflowStore.getState().fitViewRequested).toBe(true)
  })
})

describe('keepDeletedTestOnCanvas', () => {
  const DRAFT_KEY = 'wave-workbench-draft'

  beforeEach(() => {
    vi.clearAllMocks()
    clearSession.mockResolvedValue(undefined)
    useWorkflowStore.getState().reset()
    useDeletedTestStore.getState().clear()
    useDeletedTestStore.getState().raise({ testId: 'test-gone', testName: 'Payment smoke' })
    useWorkflowStore.getState().setEditingTest('test-gone', 'Payment smoke')
    useWorkflowStore.getState().setEditingTestSuiteIds(['suite-1'])
    useWorkflowStore.getState().setNodes([
      { id: 'n1', type: 'workflowNode', position: { x: 0, y: 0 }, data: {} },
    ] as Parameters<ReturnType<typeof useWorkflowStore.getState>['setNodes']>[0])
    localStorage.setItem(DRAFT_KEY, '{"nodes":[],"edges":[]}')
  })

  afterEach(() => {
    localStorage.removeItem(DRAFT_KEY)
  })

  it('closes the dialog and leaves the unsaved work on the canvas', () => {
    keepDeletedTestOnCanvas()

    const state = useWorkflowStore.getState()
    expect(useDeletedTestStore.getState().info).toBeNull()
    expect(state.nodes).toHaveLength(1)
    expect(state.isDirty).toBe(true)
  })

  it('drops the test identity so the work saves as a new test', () => {
    keepDeletedTestOnCanvas()

    const state = useWorkflowStore.getState()
    expect(state.editingTestId).toBeNull()
    expect(state.editingTestName).toBeNull()
    expect(state.editingTestSuiteIds).toEqual([])
  })

  it('keeps the stored draft and the backend session', () => {
    keepDeletedTestOnCanvas()

    expect(localStorage.getItem(DRAFT_KEY)).toBe('{"nodes":[],"edges":[]}')
    expect(clearSession).not.toHaveBeenCalled()
  })
})
