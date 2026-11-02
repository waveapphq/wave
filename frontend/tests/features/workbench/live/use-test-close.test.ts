/**
 * Tests for useTestClose hook
 *
 * Verifies close-workflow orchestration: dirty check, confirm dialog,
 * save-and-close (existing test direct save), discard-and-close,
 * switch-test dialog handlers (save-and-switch, discard-and-switch,
 * view pending workflow).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTestClose } from '@/features/workbench/live/use-test-close'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { usePageBlockStore } from '@/stores/page-block-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'
import { createSimpleRouterWrapper } from '../../../utils/router-test-utils'

// ---------------------------------------------------------------------------
// Mock: react-router-dom navigate
// ---------------------------------------------------------------------------
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// ---------------------------------------------------------------------------
// Mock: toast (the hook reports a failed save where the user is looking)
// ---------------------------------------------------------------------------
const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: mockToastError }),
}))

// ---------------------------------------------------------------------------
// Mock: workflow store
// ---------------------------------------------------------------------------
vi.mock('@/features/workbench/stores/workflow-store')

// ---------------------------------------------------------------------------
// Mock: @/api/tests (dynamic import)
// ---------------------------------------------------------------------------
const mockUpdateTest = vi.fn()
const mockFetchTestWorkflow = vi.fn()
vi.mock('@/features/tests/api/crud', () => ({
  updateTest: (...args: unknown[]) => mockUpdateTest(...args),
  fetchTestWorkflow: (...args: unknown[]) => mockFetchTestWorkflow(...args),
}))

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------
const storeFns = {
  isDirty: false,
  dirtyConfigNodeIds: [] as string[],
  nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
  edges: [] as Array<{ id: string; source: string; target: string }>,
  reset: vi.fn(),
  markSaved: vi.fn(),
  setPulseValidationNodeIds: vi.fn(),
  requestFitView: vi.fn(),
  editingTestId: null as string | null,
  editingTestName: null as string | null,
  clearEditingTest: vi.fn(),
  // Discard-and-Stay revert + edit-mode close nag store surface.
  setNodes: vi.fn(),
  setEdges: vi.fn(),
  hasEditModeNodes: (() => false) as () => boolean,
  functionViewMode: null as { functionId: string; version: string; editable: boolean } | null,
}

function setupStore(overrides: Partial<typeof storeFns> = {}) {
  const state = { ...storeFns, ...overrides }
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: typeof state) => unknown)(state)
  })
  // The save-error path reads the open test off the store outside React.
  Object.assign(vi.mocked(useWorkflowStore), { getState: () => state })
  return state
}

// ---------------------------------------------------------------------------
// Params helpers
// ---------------------------------------------------------------------------
function createParams(overrides: Partial<ReturnType<typeof defaultParams>> = {}) {
  return { ...defaultParams(), ...overrides }
}

function defaultParams() {
  return {
    executionActive: false,
    onCanvasClosed: undefined as (() => void) | undefined,
    pendingEditTestId: null as string | null,
    setPendingEditTestId: vi.fn(),
    loadTest: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn(),
    resetWorkbenchRun: vi.fn(),
    setIsDirectSaving: vi.fn(),
    saveAndCloseModeRef: { current: false },
    setShowSaveDialog: vi.fn(),
    setValidationErrors: vi.fn(),
    setValidationFatal: vi.fn(),
    setValidationMode: vi.fn(),
    setShowValidationErrorDialog: vi.fn(),
    closeFunctionView: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
const wrapper = createSimpleRouterWrapper(['/workbench'])

function renderCloseHook(paramOverrides: Partial<ReturnType<typeof defaultParams>> = {}, storeOverrides: Partial<typeof storeFns> = {}) {
  setupStore(storeOverrides)
  const params = createParams(paramOverrides)
  return {
    params,
    ...renderHook(() => useTestClose(params), { wrapper }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useTestClose', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePageBlockStore.setState({ block: null, retrying: false })
    useDeletedTestStore.setState({ info: null })
    // Reset store defaults
    storeFns.isDirty = false
    storeFns.nodes = []
    storeFns.edges = []
    storeFns.editingTestId = null
    storeFns.editingTestName = null
    storeFns.reset = vi.fn()
    storeFns.markSaved = vi.fn()
    storeFns.setPulseValidationNodeIds = vi.fn()
    storeFns.requestFitView = vi.fn()
    storeFns.clearEditingTest = vi.fn()
    storeFns.setNodes = vi.fn()
    storeFns.setEdges = vi.fn()
    storeFns.hasEditModeNodes = () => false
  })

  describe('initial state', () => {
    it('returns dialog state as closed', () => {
      const { result } = renderCloseHook()
      expect(result.current.showCloseConfirmDialog).toBe(false)
      expect(result.current.showSwitchTestDialog).toBe(false)
    })

    it('returns all handler functions', () => {
      const { result } = renderCloseHook()
      expect(typeof result.current.handleClose).toBe('function')
      expect(typeof result.current.handleSaveAndClose).toBe('function')
      expect(typeof result.current.handleDiscardAndClose).toBe('function')
      expect(typeof result.current.handleCloseConfirmDialog).toBe('function')
      expect(typeof result.current.handleSwitchTestSave).toBe('function')
      expect(typeof result.current.handleSwitchTestDiscard).toBe('function')
      expect(typeof result.current.handleViewPendingWorkflow).toBe('function')
    })

    it('returns dialog setters', () => {
      const { result } = renderCloseHook()
      expect(typeof result.current.setShowCloseConfirmDialog).toBe('function')
      expect(typeof result.current.setShowSwitchTestDialog).toBe('function')
    })
  })

  describe('handleClose', () => {
    it('opens close confirm dialog when dirty', () => {
      const { result } = renderCloseHook({}, { isDirty: true })
      act(() => { result.current.handleClose() })
      expect(result.current.showCloseConfirmDialog).toBe(true)
    })

    it('opens close confirm dialog when execution is active', () => {
      const { result } = renderCloseHook({ executionActive: true })
      act(() => { result.current.handleClose() })
      expect(result.current.showCloseConfirmDialog).toBe(true)
    })

    it('resets canvas immediately when clean and no execution', () => {
      const state = setupStore({ isDirty: false })
      const params = createParams({ executionActive: false })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => { result.current.handleClose() })

      expect(state.reset).toHaveBeenCalledOnce()
      expect(params.clearDraft).toHaveBeenCalledOnce()
      expect(state.clearEditingTest).toHaveBeenCalledOnce()
      expect(state.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
      expect(result.current.showCloseConfirmDialog).toBe(false)
    })

    it('hands a library View close to closeFunctionView, even when dirty', () => {
      const view = { functionId: 'fn-outer', version: '1.0.0', editable: false }
      const { result, params } = renderCloseHook({}, { functionViewMode: view, isDirty: true })

      act(() => { result.current.handleClose() })

      expect(params.closeFunctionView).toHaveBeenCalledOnce()
      expect(storeFns.reset).not.toHaveBeenCalled()
      expect(params.clearDraft).not.toHaveBeenCalled()
      expect(mockNavigate).not.toHaveBeenCalled()
      expect(result.current.showCloseConfirmDialog).toBe(false)
      expect(result.current.showEditModeNag).toBe(false)
    })
  })

  describe('onCanvasClosed (browse-away seam)', () => {
    it('fires before the clean-close canvas reset', () => {
      const onCanvasClosed = vi.fn()
      const state = setupStore({ editingTestId: 'test-1', editingTestName: 'T' })
      const params = createParams({ onCanvasClosed })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => { result.current.handleClose() })

      expect(onCanvasClosed).toHaveBeenCalledOnce()
      expect(onCanvasClosed.mock.invocationCallOrder[0]).toBeLessThan(
        state.reset.mock.invocationCallOrder[0],
      )
    })

    it('fires on Discard-and-Close', () => {
      const onCanvasClosed = vi.fn()
      const { result } = renderCloseHook({ onCanvasClosed })

      act(() => { result.current.handleDiscardAndClose() })

      expect(onCanvasClosed).toHaveBeenCalledOnce()
    })

    it('does not fire when the close only opens the confirm dialog', () => {
      const onCanvasClosed = vi.fn()
      const { result } = renderCloseHook({ onCanvasClosed }, { isDirty: true })

      act(() => { result.current.handleClose() })

      expect(onCanvasClosed).not.toHaveBeenCalled()
    })

    it('fires when the edit-mode nag finalizes the close', () => {
      const onCanvasClosed = vi.fn()
      const { result } = renderCloseHook({ onCanvasClosed })

      act(() => { result.current.handleCloseEditModeNag() })

      expect(onCanvasClosed).toHaveBeenCalledOnce()
    })
  })

  describe('handleSaveAndClose', () => {
    it('opens save dialog for draft (no editingTestId)', async () => {
      const params = createParams()
      setupStore({ editingTestId: null, editingTestName: null })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSaveAndClose() })

      expect(params.saveAndCloseModeRef.current).toBe(true)
      expect(params.setShowSaveDialog).toHaveBeenCalledWith(true)
    })

    it('direct-saves existing test successfully', async () => {
      const testNodes = [{ id: 'n1', data: { label: 'Test' } }]
      const testEdges = [{ id: 'e1', source: 'n1', target: 'n2' }]
      const state = setupStore({
        editingTestId: 'test-42',
        editingTestName: 'My Test',
        nodes: testNodes,
        edges: testEdges,
      })
      mockUpdateTest.mockResolvedValueOnce({ id: 'test-42' })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSaveAndClose() })

      expect(params.setIsDirectSaving).toHaveBeenCalledWith(true)
      expect(mockUpdateTest).toHaveBeenCalledWith('test-42', {
        name: 'My Test',
        workflow: { nodes: testNodes, edges: testEdges },
      })
      expect(state.markSaved).toHaveBeenCalledOnce()
      expect(state.setPulseValidationNodeIds).toHaveBeenCalledWith([])
      expect(params.clearDraft).toHaveBeenCalledOnce()
      expect(params.resetWorkbenchRun).toHaveBeenCalledOnce()
      expect(state.clearEditingTest).toHaveBeenCalledOnce()
      expect(state.reset).toHaveBeenCalledOnce()
      expect(params.setIsDirectSaving).toHaveBeenCalledWith(false)
    })

    it('loads pending test after save when pendingEditTestId is set', async () => {
      setupStore({
        editingTestId: 'test-42',
        editingTestName: 'My Test',
      })
      mockUpdateTest.mockResolvedValueOnce({ id: 'test-42' })
      const params = createParams({ pendingEditTestId: 'test-99' })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSaveAndClose() })

      expect(params.setPendingEditTestId).toHaveBeenCalledWith(null)
      expect(params.loadTest).toHaveBeenCalledWith('test-99')
    })

    it('handles 422 validation error from API', async () => {
      setupStore({
        editingTestId: 'test-42',
        editingTestName: 'My Test',
      })
      const apiError = {
        status: 422,
        details: [
          { path: 'nodes.0', node_id: 'n1', node_label: 'Shell Script', code: 'MISSING_PARAM', message: 'Missing param' },
          { path: 'nodes.1', node_id: 'n2', code: 'BAD_VALUE', message: 'Bad value' },
        ],
      }
      mockUpdateTest.mockRejectedValueOnce(apiError)
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSaveAndClose() })

      expect(params.setValidationErrors).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ code: 'MISSING_PARAM', node_id: 'n1' }),
          expect.objectContaining({ code: 'BAD_VALUE', node_id: 'n2' }),
        ])
      )
      expect(params.setValidationFatal).toHaveBeenCalledWith(false)
      expect(params.setValidationMode).toHaveBeenCalledWith('save')
      expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
      expect(params.setIsDirectSaving).toHaveBeenCalledWith(false)
    })

    it('reports a non-422 save error instead of closing silently', async () => {
      const state = setupStore({
        editingTestId: 'test-42',
        editingTestName: 'My Test',
      })
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockUpdateTest.mockRejectedValueOnce(new Error('Network error'))
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSaveAndClose() })

      expect(mockToastError).toHaveBeenCalledWith('Network error', 'Save Failed')
      expect(consoleSpy).toHaveBeenCalledWith('Direct save failed:', expect.any(Error))
      expect(params.setIsDirectSaving).toHaveBeenCalledWith(false)
      // The canvas stays open: nothing was saved.
      expect(state.reset).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('raises the not-found dialog when the open test is gone, and keeps the canvas', async () => {
      const state = setupStore({ editingTestId: 'test-42', editingTestName: 'My Test' })
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockUpdateTest.mockRejectedValueOnce(
        Object.assign(new Error("Test with ID 'test-42' not found"), { status: 404 }),
      )
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSaveAndClose() })

      expect(useDeletedTestStore.getState().info).toEqual({
        testId: 'test-42',
        testName: 'My Test',
      })
      expect(mockToastError).not.toHaveBeenCalled()
      expect(consoleSpy).not.toHaveBeenCalled()
      // Nothing was saved, so the canvas keeps the work and stays open.
      expect(state.markSaved).not.toHaveBeenCalled()
      expect(state.reset).not.toHaveBeenCalled()
      expect(params.setIsDirectSaving).toHaveBeenCalledWith(false)
      consoleSpy.mockRestore()
    })

    it('closes confirm dialog before saving', async () => {
      setupStore({ editingTestId: null })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      // Open dialog first
      act(() => { result.current.setShowCloseConfirmDialog(true) })
      expect(result.current.showCloseConfirmDialog).toBe(true)

      await act(async () => { await result.current.handleSaveAndClose() })
      expect(result.current.showCloseConfirmDialog).toBe(false)
    })
  })

  describe('handleDiscardAndClose', () => {
    it('resets and clears all state', () => {
      const state = setupStore()
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => { result.current.handleDiscardAndClose() })

      expect(result.current.showCloseConfirmDialog).toBe(false)
      expect(params.clearDraft).toHaveBeenCalledOnce()
      expect(state.reset).toHaveBeenCalledOnce()
      expect(params.resetWorkbenchRun).toHaveBeenCalledOnce()
      expect(state.clearEditingTest).toHaveBeenCalledOnce()
      expect(state.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
    })

    it('loads pending test if pendingEditTestId is set', () => {
      setupStore()
      const params = createParams({ pendingEditTestId: 'test-99' })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => { result.current.handleDiscardAndClose() })

      expect(params.setPendingEditTestId).toHaveBeenCalledWith(null)
      expect(params.loadTest).toHaveBeenCalledWith('test-99')
    })
  })

  describe('handleDiscardAndStay', () => {
    it('reverts to saved and keeps the test open (does not close it)', async () => {
      mockFetchTestWorkflow.mockResolvedValue({ nodes: [], edges: [] })
      const state = setupStore({
        editingTestId: 'test-1',
        editingTestName: 'My Test',
        isDirty: true,
        setNodes: vi.fn(),
        setEdges: vi.fn(),
      })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      // The Close dialog has a Discard-and-Stay action.
      expect(typeof result.current.handleDiscardAndStay).toBe('function')

      act(() => {
        result.current.setShowCloseConfirmDialog(true)
      })
      await act(async () => {
        await result.current.handleDiscardAndStay?.()
      })

      // Dialog closes, but the test stays open: NOT reset, NOT cleared.
      expect(result.current.showCloseConfirmDialog).toBe(false)
      expect(state.clearEditingTest).not.toHaveBeenCalled()
      expect(state.reset).not.toHaveBeenCalled()
    })

    it('blocks the canvas when the revert fetch fails, so the edits cannot be saved', async () => {
      mockFetchTestWorkflow.mockRejectedValueOnce(new Error('network'))
      const state = setupStore({ editingTestId: 'test-1', isDirty: true })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => {
        await result.current.handleDiscardAndStay()
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load saved test')
      expect(block?.detail.message).toBe('network')
      // The discard did not happen: nothing was reverted and nothing was marked saved.
      expect(state.setNodes).not.toHaveBeenCalled()
      expect(state.markSaved).not.toHaveBeenCalled()
      expect(state.clearEditingTest).not.toHaveBeenCalled()
    })

    it('reverts and clears the report when the retry succeeds', async () => {
      mockFetchTestWorkflow.mockRejectedValueOnce(new Error('network'))
      mockFetchTestWorkflow.mockResolvedValueOnce({ nodes: [{ id: 'n1' }], edges: [] })
      const state = setupStore({ editingTestId: 'test-1', isDirty: true })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => {
        await result.current.handleDiscardAndStay()
      })
      await act(async () => {
        await usePageBlockStore.getState().block!.retry()
      })

      expect(state.setNodes).toHaveBeenCalledWith([{ id: 'n1' }])
      expect(state.markSaved).toHaveBeenCalled()
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('keeps the report with the newest reason when the retry fails again', async () => {
      mockFetchTestWorkflow.mockRejectedValueOnce(new Error('network'))
      mockFetchTestWorkflow.mockRejectedValueOnce(new Error('still down'))
      setupStore({ editingTestId: 'test-1', isDirty: true })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => {
        await result.current.handleDiscardAndStay()
      })
      await act(async () => {
        await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow('still down')
      })

      expect(usePageBlockStore.getState().block?.detail.message).toBe('still down')
    })

    it('clears an earlier report once the revert succeeds', async () => {
      mockFetchTestWorkflow.mockResolvedValue({ nodes: [], edges: [] })
      setupStore({ editingTestId: 'test-1', isDirty: true })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => {
        await result.current.handleDiscardAndStay()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('returns early without a revert fetch when there is no editing test', async () => {
      const state = setupStore({ editingTestId: null })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => {
        await result.current.handleDiscardAndStay()
      })

      expect(mockFetchTestWorkflow).not.toHaveBeenCalled()
      expect(state.setNodes).not.toHaveBeenCalled()
    })
  })

  describe('edit-mode close nag', () => {
    it('exposes the nag state + setter', () => {
      const { result } = renderCloseHook()
      expect(typeof result.current.setShowEditModeNag).toBe('function')
      expect(result.current.showEditModeNag).toBe(false)
    })

    // A dirty close shows the confirm dialog first; the nag is deferred to the
    // chosen close action (it is irrelevant if the user then discards).
    it('opens the confirm dialog without a nag when dirty, even with edit-mode Functions', () => {
      const params = createParams()
      setupStore({ editingTestId: 'test-1', isDirty: true, hasEditModeNodes: () => true })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => {
        result.current.handleClose()
      })

      expect(result.current.showCloseConfirmDialog).toBe(true)
      expect(result.current.showEditModeNag).toBe(false)
    })

    // A clean close of an already-saved edit-mode test nags directly, deferring
    // the reset so the canvas stays visible behind the nag.
    it('pops the nag on a clean close when a Function is in edit mode, deferring the reset', () => {
      const params = createParams()
      const state = setupStore({ editingTestId: 'test-1', isDirty: false, hasEditModeNodes: () => true })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => {
        result.current.handleClose()
      })

      expect(result.current.showEditModeNag).toBe(true)
      expect(state.reset).not.toHaveBeenCalled()
    })

    // Save-and-Close persists the edit-mode markers, so it nags before the
    // canvas resets.
    it('pops the nag after Save-and-Close when a Function is in edit mode, deferring the reset', async () => {
      mockUpdateTest.mockResolvedValueOnce({ id: 'test-42' })
      const state = setupStore({
        editingTestId: 'test-42',
        editingTestName: 'My Test',
        hasEditModeNodes: () => true,
      })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => {
        await result.current.handleSaveAndClose()
      })

      expect(result.current.showEditModeNag).toBe(true)
      expect(state.reset).not.toHaveBeenCalled()
    })

    // Discard-and-Close throws the edit-mode changes away, so the nag is not
    // relevant and must not fire.
    it('does NOT pop the nag on Discard-and-Close', () => {
      const state = setupStore({ editingTestId: 'test-1', hasEditModeNodes: () => true })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => {
        result.current.handleDiscardAndClose()
      })

      expect(result.current.showEditModeNag).toBeFalsy()
      expect(state.reset).toHaveBeenCalledOnce()
    })

    it('handleCloseEditModeNag dismisses the nag and resets the canvas', () => {
      const params = createParams()
      const state = setupStore({ editingTestId: 'test-1', isDirty: false, hasEditModeNodes: () => true })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => {
        result.current.handleClose()
      })
      expect(result.current.showEditModeNag).toBe(true)

      act(() => {
        result.current.handleCloseEditModeNag()
      })

      expect(result.current.showEditModeNag).toBe(false)
      expect(state.reset).toHaveBeenCalledOnce()
      expect(state.clearEditingTest).toHaveBeenCalledOnce()
    })
  })

  describe('handleCloseConfirmDialog (Cancel)', () => {
    it('closes confirm dialog and clears pending test id', () => {
      setupStore()
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      // Open dialog
      act(() => { result.current.setShowCloseConfirmDialog(true) })
      expect(result.current.showCloseConfirmDialog).toBe(true)

      act(() => { result.current.handleCloseConfirmDialog() })
      expect(result.current.showCloseConfirmDialog).toBe(false)
      expect(params.setPendingEditTestId).toHaveBeenCalledWith(null)
    })
  })

  describe('handleSwitchTestSave', () => {
    it('opens save dialog for draft (no editingTestId)', async () => {
      setupStore({ editingTestId: null, editingTestName: null })
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSwitchTestSave() })

      expect(params.saveAndCloseModeRef.current).toBe(true)
      expect(params.setShowSaveDialog).toHaveBeenCalledWith(true)
    })

    it('direct-saves and switches to pending test', async () => {
      const state = setupStore({
        editingTestId: 'test-42',
        editingTestName: 'Old Test',
      })
      mockUpdateTest.mockResolvedValueOnce({ id: 'test-42' })
      const params = createParams({ pendingEditTestId: 'test-99' })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSwitchTestSave() })

      expect(params.setIsDirectSaving).toHaveBeenCalledWith(true)
      expect(mockUpdateTest).toHaveBeenCalled()
      expect(state.markSaved).toHaveBeenCalledOnce()
      expect(params.loadTest).toHaveBeenCalledWith('test-99')
      expect(params.setIsDirectSaving).toHaveBeenCalledWith(false)
      expect(result.current.showSwitchTestDialog).toBe(false)
    })

    it('leaves the saved test for a blank canvas when nothing is waiting to open', async () => {
      const state = setupStore({
        editingTestId: 'test-42',
        editingTestName: 'Old Test',
        isDirty: true,
      })
      mockUpdateTest.mockResolvedValueOnce({ id: 'test-42' })
      const params = createParams({ pendingEditTestId: null })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSwitchTestSave() })

      expect(mockUpdateTest).toHaveBeenCalledOnce()
      expect(state.markSaved).toHaveBeenCalledOnce()
      expect(state.reset).toHaveBeenCalledOnce()
      expect(state.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
      expect(params.loadTest).not.toHaveBeenCalled()
      expect(result.current.showSwitchTestDialog).toBe(false)
    })

    it('keeps the test on the canvas when the save fails with nothing waiting to open', async () => {
      const state = setupStore({
        editingTestId: 'test-42',
        editingTestName: 'Old Test',
        isDirty: true,
      })
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockUpdateTest.mockRejectedValueOnce(new Error('save failed'))
      const params = createParams({ pendingEditTestId: null })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSwitchTestSave() })

      expect(state.reset).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('reports a save error during switch, after the dialog has closed', async () => {
      setupStore({
        editingTestId: 'test-42',
        editingTestName: 'Old Test',
      })
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockUpdateTest.mockRejectedValueOnce(new Error('save failed'))
      const params = createParams({ pendingEditTestId: 'test-99' })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSwitchTestSave() })

      expect(mockToastError).toHaveBeenCalledWith('save failed', 'Save Failed')
      expect(consoleSpy).toHaveBeenCalledWith('Direct save failed:', expect.any(Error))
      expect(params.setIsDirectSaving).toHaveBeenCalledWith(false)
      // The switch does not happen: the unsaved work is still on the canvas.
      expect(params.loadTest).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('opens the validation dialog when a switch save is rejected with details', async () => {
      setupStore({
        editingTestId: 'test-42',
        editingTestName: 'Old Test',
      })
      mockUpdateTest.mockRejectedValueOnce({
        status: 422,
        details: [{ path: 'nodes.0', node_id: 'n1', code: 'MISSING_PARAM', message: 'Missing param' }],
      })
      const params = createParams({ pendingEditTestId: 'test-99' })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      await act(async () => { await result.current.handleSwitchTestSave() })

      expect(params.setValidationErrors).toHaveBeenCalledWith([
        expect.objectContaining({ code: 'MISSING_PARAM', node_id: 'n1' }),
      ])
      expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
      expect(params.loadTest).not.toHaveBeenCalled()
    })
  })

  describe('handleSwitchTestDiscard', () => {
    it('clears state and loads pending test', () => {
      setupStore()
      const params = createParams({ pendingEditTestId: 'test-99' })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => { result.current.handleSwitchTestDiscard() })

      expect(result.current.showSwitchTestDialog).toBe(false)
      expect(params.clearDraft).toHaveBeenCalledOnce()
      expect(params.resetWorkbenchRun).toHaveBeenCalledOnce()
      expect(params.setPendingEditTestId).toHaveBeenCalledWith(null)
      expect(params.loadTest).toHaveBeenCalledWith('test-99')
    })

    it('does not load test when no pending id', () => {
      setupStore()
      const params = createParams({ pendingEditTestId: null })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => { result.current.handleSwitchTestDiscard() })

      expect(params.loadTest).not.toHaveBeenCalled()
    })

    it('brings up the blank canvas when nothing is waiting to open', () => {
      const state = setupStore({ isDirty: true })
      const params = createParams({ pendingEditTestId: null })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => { result.current.handleSwitchTestDiscard() })

      expect(state.reset).toHaveBeenCalledOnce()
      expect(state.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
    })

    it('leaves the fit to the test that opens next', () => {
      const state = setupStore({ isDirty: true })
      const params = createParams({ pendingEditTestId: 'test-99' })
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => { result.current.handleSwitchTestDiscard() })

      expect(params.loadTest).toHaveBeenCalledWith('test-99')
      expect(state.requestFitView).not.toHaveBeenCalled()
    })
  })

  describe('handleViewPendingWorkflow', () => {
    it('closes dialog and navigates to workbench', () => {
      setupStore()
      const params = createParams()
      const { result } = renderHook(() => useTestClose(params), { wrapper })

      act(() => { result.current.handleViewPendingWorkflow() })

      expect(result.current.showSwitchTestDialog).toBe(false)
      expect(params.setPendingEditTestId).toHaveBeenCalledWith(null)
      expect(mockNavigate).toHaveBeenCalledWith('/workbench')
    })
  })

  describe('dialog state setters', () => {
    it('can toggle close confirm dialog', () => {
      const { result } = renderCloseHook()

      act(() => { result.current.setShowCloseConfirmDialog(true) })
      expect(result.current.showCloseConfirmDialog).toBe(true)

      act(() => { result.current.setShowCloseConfirmDialog(false) })
      expect(result.current.showCloseConfirmDialog).toBe(false)
    })

    it('can toggle switch test dialog', () => {
      const { result } = renderCloseHook()

      act(() => { result.current.setShowSwitchTestDialog(true) })
      expect(result.current.showSwitchTestDialog).toBe(true)

      act(() => { result.current.setShowSwitchTestDialog(false) })
      expect(result.current.showSwitchTestDialog).toBe(false)
    })
  })
})
