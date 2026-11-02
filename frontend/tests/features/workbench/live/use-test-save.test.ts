/**
 * Tests for useTestSave hook
 *
 * Verifies save orchestration: direct save for existing tests, save dialog
 * for drafts, output binding validation, metadata editing, and save-and-close
 * mode coordination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTestSave } from '@/features/workbench/live/use-test-save'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'
import { createSimpleRouterWrapper } from '../../../utils/router-test-utils'

// ---------------------------------------------------------------------------
// Mock: workflow store
// ---------------------------------------------------------------------------
vi.mock('@/features/workbench/stores/workflow-store')

// ---------------------------------------------------------------------------
// Mock: toast
// ---------------------------------------------------------------------------
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockToastWarning = vi.fn()

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    warning: mockToastWarning,
    info: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Mock: @/api/tests (dynamic import)
// ---------------------------------------------------------------------------
const mockCreateTest = vi.fn()
const mockUpdateTest = vi.fn()
const mockUpdateTestMetadata = vi.fn()
const mockFetchTestWorkflow = vi.fn()

vi.mock('@/features/tests/api/crud', () => ({
  createTest: (...args: unknown[]) => mockCreateTest(...args),
  updateTest: (...args: unknown[]) => mockUpdateTest(...args),
  updateTestMetadata: (...args: unknown[]) => mockUpdateTestMetadata(...args),
  fetchTestWorkflow: (...args: unknown[]) => mockFetchTestWorkflow(...args),
}))

// ---------------------------------------------------------------------------
// Mock: node-parameters
// ---------------------------------------------------------------------------
const mockValidateOutputBindings = vi.fn().mockReturnValue([])

vi.mock('@/features/workbench/lib/node-parameters', () => ({
  validateOutputBindings: (...args: unknown[]) => mockValidateOutputBindings(...args),
}))

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------
const storeFns = {
  nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
  edges: [] as Array<{ id: string; source: string; target: string }>,
  reset: vi.fn(),
  markSaved: vi.fn(),
  setPulseValidationNodeIds: vi.fn(),
  requestFitView: vi.fn(),
  editingTestId: null as string | null,
  editingTestName: null as string | null,
  setEditingTest: vi.fn(),
  clearEditingTest: vi.fn(),
  variables: [] as Array<{ id: string; name: string; value: unknown; type: string; isExpression?: boolean }>,
  setSaveInFlight: vi.fn(),
}

function setupStore(overrides: Partial<typeof storeFns> = {}) {
  const state = { ...storeFns, ...overrides }
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: typeof state) => unknown)(state)
  })
  // The save handlers reach the save-in-flight gate via getState().setSaveInFlight.
  ;(useWorkflowStore as unknown as { getState: () => typeof state }).getState = () => state
  return state
}

// ---------------------------------------------------------------------------
// Params helpers
// ---------------------------------------------------------------------------
function defaultParams() {
  return {
    pendingEditTestId: null as string | null,
    setPendingEditTestId: vi.fn(),
    loadTest: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn(),
    resetWorkbenchRun: vi.fn(),
    setValidationErrors: vi.fn(),
    setValidationFatal: vi.fn(),
    setValidationMode: vi.fn(),
    setShowValidationErrorDialog: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
const wrapper = createSimpleRouterWrapper(['/workbench'])

function renderSaveHook(paramOverrides: Partial<ReturnType<typeof defaultParams>> = {}, storeOverrides: Partial<typeof storeFns> = {}) {
  setupStore(storeOverrides)
  const params = { ...defaultParams(), ...paramOverrides }
  return {
    params,
    ...renderHook(() => useTestSave(params), { wrapper }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useTestSave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeFns.nodes = []
    storeFns.edges = []
    storeFns.editingTestId = null
    storeFns.editingTestName = null
    storeFns.variables = []
    storeFns.reset = vi.fn()
    storeFns.markSaved = vi.fn()
    storeFns.setPulseValidationNodeIds = vi.fn()
    storeFns.requestFitView = vi.fn()
    storeFns.setEditingTest = vi.fn()
    storeFns.clearEditingTest = vi.fn()
    mockValidateOutputBindings.mockReturnValue([])
  })

  describe('initial state', () => {
    it('returns correct initial values', () => {
      const { result } = renderSaveHook()

      expect(result.current.showSaveDialog).toBe(false)
      expect(result.current.showEditMetadataDialog).toBe(false)
      expect(result.current.isSaving).toBe(false)
      expect(result.current.isDirectSaving).toBe(false)
      expect(result.current.isNewTestMode).toBe(false)
      expect(result.current.saveAndCloseModeRef.current).toBe(false)
    })

    it('returns all handler functions', () => {
      const { result } = renderSaveHook()

      expect(typeof result.current.handleSaveClick).toBe('function')
      expect(typeof result.current.handleSave).toBe('function')
      expect(typeof result.current.handleCloseSaveDialog).toBe('function')
      expect(typeof result.current.handleEditClick).toBe('function')
      expect(typeof result.current.handleCloseEditMetadataDialog).toBe('function')
      expect(typeof result.current.handleEditMetadataSave).toBe('function')
    })
  })

  describe('handleSaveClick', () => {
    it('opens save dialog for draft (no editingTestId)', async () => {
      const { result } = renderSaveHook({}, { editingTestId: null })

      await act(async () => { await result.current.handleSaveClick() })

      expect(result.current.showSaveDialog).toBe(true)
      expect(mockUpdateTest).not.toHaveBeenCalled()
    })

    it('direct-saves existing test', async () => {
      const testVars = [
        { id: 'v1', name: 'host', value: 'localhost', type: 'string' },
        { id: 'v2', name: 'count', value: 5, type: 'integer', isExpression: true },
      ]
      const state = setupStore({
        editingTestId: 'test-42',
        editingTestName: 'My Test',
        nodes: [{ id: 'n1', data: { label: 'A' } }],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        variables: testVars,
      })
      mockUpdateTest.mockResolvedValueOnce({ id: 'test-42' })
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      await act(async () => { await result.current.handleSaveClick() })

      expect(mockUpdateTest).toHaveBeenCalledWith('test-42', expect.objectContaining({
        name: 'My Test',
        workflow: { nodes: [{ id: 'n1', data: { label: 'A' } }], edges: [{ id: 'e1', source: 'n1', target: 'n2' }] },
        variables: expect.objectContaining({
          host: { value: 'localhost', type: 'string' },
          count: { value: 5, type: 'integer', isExpression: true },
        }),
      }))
      expect(state.markSaved).toHaveBeenCalledOnce()
      expect(state.setPulseValidationNodeIds).toHaveBeenCalledWith([])
      expect(params.clearDraft).toHaveBeenCalledOnce()
    })

    it('includes all variables in save payload', async () => {
      const testVars = [
        { id: 'v1', name: 'local', value: 'a', type: 'string' },
        { id: 'v2', name: 'another', value: 'b', type: 'string' },
      ]
      setupStore({
        editingTestId: 'test-42',
        editingTestName: 'My Test',
        variables: testVars,
      })
      mockUpdateTest.mockResolvedValueOnce({ id: 'test-42' })
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      await act(async () => { await result.current.handleSaveClick() })

      const savedVars = mockUpdateTest.mock.calls[0][1].variables
      expect(savedVars).toHaveProperty('local')
      expect(savedVars).toHaveProperty('another')
    })

    it('handles generic 422 validation error with details', async () => {
      setupStore({
        editingTestId: 'test-42',
        editingTestName: 'My Test',
      })
      const apiError = {
        status: 422,
        details: [
          { path: 'nodes.0', node_id: 'n1', code: 'BAD', message: 'Bad param' },
        ],
      }
      mockUpdateTest.mockRejectedValueOnce(apiError)
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      await act(async () => { await result.current.handleSaveClick() })

      expect(params.setValidationErrors).toHaveBeenCalled()
      expect(params.setValidationFatal).toHaveBeenCalledWith(false)
      expect(params.setValidationMode).toHaveBeenCalledWith('save')
      expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
    })

    it('handles non-422 error with console warning', async () => {
      setupStore({
        editingTestId: 'test-42',
        editingTestName: 'My Test',
      })
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockUpdateTest.mockRejectedValueOnce(new Error('Network'))
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      await act(async () => { await result.current.handleSaveClick() })

      expect(consoleSpy).toHaveBeenCalledWith('Direct save failed:', expect.any(Error))
      consoleSpy.mockRestore()
    })

    it('raises the not-found dialog when the open test is gone from the server', async () => {
      const state = setupStore({ editingTestId: 'test-42', editingTestName: 'My Test' })
      useDeletedTestStore.setState({ info: null })
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockUpdateTest.mockRejectedValueOnce(
        Object.assign(new Error("Test with ID 'test-42' not found"), { status: 404 }),
      )
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      await act(async () => { await result.current.handleSaveClick() })

      expect(useDeletedTestStore.getState().info).toEqual({
        testId: 'test-42',
        testName: 'My Test',
      })
      expect(mockToastError).not.toHaveBeenCalled()
      expect(consoleSpy).not.toHaveBeenCalled()
      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
      // The work is still on the canvas: nothing was saved and nothing was cleared.
      expect(state.markSaved).not.toHaveBeenCalled()
      expect(params.clearDraft).not.toHaveBeenCalled()
      expect(result.current.isDirectSaving).toBe(false)
      consoleSpy.mockRestore()
    })

    it('keeps the toast when the save fails for any other reason', async () => {
      setupStore({ editingTestId: 'test-42', editingTestName: 'My Test' })
      useDeletedTestStore.setState({ info: null })
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockUpdateTest.mockRejectedValueOnce(
        Object.assign(new Error('Internal server error'), { status: 500 }),
      )
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      await act(async () => { await result.current.handleSaveClick() })

      expect(useDeletedTestStore.getState().info).toBeNull()
      expect(mockToastError).toHaveBeenCalledWith('Internal server error', 'Save Failed')
      expect(consoleSpy).toHaveBeenCalledWith('Direct save failed:', expect.any(Error))
      consoleSpy.mockRestore()
    })

    it('always resets isDirectSaving in finally block', async () => {
      setupStore({ editingTestId: 'test-42', editingTestName: 'Test' })
      mockUpdateTest.mockRejectedValueOnce(new Error('fail'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      await act(async () => { await result.current.handleSaveClick() })

      expect(result.current.isDirectSaving).toBe(false)
      vi.mocked(console.warn).mockRestore()
    })
  })

  describe('handleSave (from dialog)', () => {
    it('creates new test when payload has no testId', async () => {
      setupStore({
        variables: [{ id: 'v1', name: 'host', value: 'x', type: 'string' }],
      })
      mockCreateTest.mockResolvedValueOnce({ id: 'new-1', name: 'New Test' })
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      const payload = {
        name: 'New Test',
        description: 'desc',
        tags: ['tag1'],
        workflowData: { nodes: [{ id: 'n1', type: 'workflowNode', position: { x: 0, y: 0 }, data: {} }], edges: [] },
      }
      await act(async () => { await result.current.handleSave(payload) })

      expect(mockCreateTest).toHaveBeenCalledWith(expect.objectContaining({
        name: 'New Test',
        description: 'desc',
        tags: ['tag1'],
      }))
      expect(storeFns.setEditingTest).toHaveBeenCalledWith('new-1', 'New Test')
      expect(storeFns.markSaved).toHaveBeenCalledOnce()
      expect(result.current.showSaveDialog).toBe(false)
    })

    it('updates existing test when payload has testId', async () => {
      setupStore({ variables: [] })
      mockUpdateTest.mockResolvedValueOnce({ id: 'test-42' })
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      const payload = {
        name: 'Updated',
        description: '',
        tags: [],
        testId: 'test-42',
        workflowData: { nodes: [], edges: [] },
      }
      await act(async () => { await result.current.handleSave(payload) })

      expect(mockUpdateTest).toHaveBeenCalledWith('test-42', expect.objectContaining({
        name: 'Updated',
      }))
      // When payload has testId, setEditingTest should NOT be called (only for new tests)
      expect(storeFns.setEditingTest).not.toHaveBeenCalled()
    })

    it('executes save-and-close mode (clears and resets)', async () => {
      const state = setupStore({ variables: [] })
      mockCreateTest.mockResolvedValueOnce({ id: 'new-1', name: 'New' })
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      // Enable save-and-close mode
      act(() => { result.current.saveAndCloseModeRef.current = true })

      const payload = {
        name: 'New',
        description: '',
        tags: [],
        workflowData: { nodes: [], edges: [] },
      }
      await act(async () => { await result.current.handleSave(payload) })

      expect(params.resetWorkbenchRun).toHaveBeenCalledOnce()
      expect(state.clearEditingTest).toHaveBeenCalledOnce()
      expect(state.reset).toHaveBeenCalledOnce()
      expect(state.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
      expect(result.current.saveAndCloseModeRef.current).toBe(false)
    })

    it('loads pending test in save-and-close mode when pendingEditTestId is set', async () => {
      setupStore({ variables: [] })
      mockCreateTest.mockResolvedValueOnce({ id: 'new-1', name: 'New' })
      const params = { ...defaultParams(), pendingEditTestId: 'test-99' }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      act(() => { result.current.saveAndCloseModeRef.current = true })

      const payload = {
        name: 'New',
        description: '',
        tags: [],
        workflowData: { nodes: [], edges: [] },
      }
      await act(async () => { await result.current.handleSave(payload) })

      expect(params.setPendingEditTestId).toHaveBeenCalledWith(null)
      expect(params.loadTest).toHaveBeenCalledWith('test-99')
    })

    it('always resets isSaving in finally block', async () => {
      setupStore({ variables: [] })
      mockCreateTest.mockRejectedValueOnce(new Error('fail'))
      const { result } = renderSaveHook()

      const payload = {
        name: 'Test',
        description: '',
        tags: [],
        workflowData: { nodes: [], edges: [] },
      }
      await act(async () => {
        await result.current.handleSave(payload).catch(() => {})
      })

      expect(result.current.isSaving).toBe(false)
    })
  })

  describe('handleCloseSaveDialog', () => {
    it('closes dialog and resets mode state', () => {
      const { result, params } = renderSaveHook()

      act(() => { result.current.setShowSaveDialog(true) })
      act(() => { result.current.saveAndCloseModeRef.current = true })
      act(() => { result.current.setIsNewTestMode(true) })

      act(() => { result.current.handleCloseSaveDialog() })

      expect(result.current.showSaveDialog).toBe(false)
      expect(result.current.saveAndCloseModeRef.current).toBe(false)
      expect(result.current.isNewTestMode).toBe(false)
      expect(params.setPendingEditTestId).toHaveBeenCalledWith(null)
    })
  })

  describe('handleEditClick', () => {
    it('opens edit metadata dialog', () => {
      const { result } = renderSaveHook()

      act(() => { result.current.handleEditClick() })

      expect(result.current.showEditMetadataDialog).toBe(true)
    })
  })

  describe('handleCloseEditMetadataDialog', () => {
    it('closes edit metadata dialog', () => {
      const { result } = renderSaveHook()

      act(() => { result.current.handleEditClick() })
      expect(result.current.showEditMetadataDialog).toBe(true)

      act(() => { result.current.handleCloseEditMetadataDialog() })
      expect(result.current.showEditMetadataDialog).toBe(false)
    })
  })

  describe('handleEditMetadataSave', () => {
    it('calls updateTestMetadata and updates editing state', async () => {
      setupStore()
      mockUpdateTestMetadata.mockResolvedValueOnce({ id: 'test-42', name: 'Renamed' })
      const params = { ...defaultParams() }
      const { result } = renderHook(() => useTestSave(params), { wrapper })

      const payload = {
        name: 'Renamed',
        description: 'new desc',
        tags: ['tag1', 'tag2'],
        testId: 'test-42',
      }
      await act(async () => { await result.current.handleEditMetadataSave(payload) })

      expect(mockUpdateTestMetadata).toHaveBeenCalledWith('test-42', {
        name: 'Renamed',
        description: 'new desc',
        tags: ['tag1', 'tag2'],
      })
      expect(storeFns.setEditingTest).toHaveBeenCalledWith('test-42', 'Renamed')
    })

    it('sends undefined description when empty string', async () => {
      setupStore()
      mockUpdateTestMetadata.mockResolvedValueOnce({ id: 'test-42', name: 'X' })
      const { result } = renderHook(() => useTestSave(defaultParams()), { wrapper })

      await act(async () => {
        await result.current.handleEditMetadataSave({
          name: 'X', description: '', tags: [], testId: 'test-42',
        })
      })

      expect(mockUpdateTestMetadata).toHaveBeenCalledWith('test-42', expect.objectContaining({
        description: undefined,
      }))
    })
  })

  describe('state setters', () => {
    it('can toggle isDirectSaving', () => {
      const { result } = renderSaveHook()

      act(() => { result.current.setIsDirectSaving(true) })
      expect(result.current.isDirectSaving).toBe(true)

      act(() => { result.current.setIsDirectSaving(false) })
      expect(result.current.isDirectSaving).toBe(false)
    })

    it('can toggle isNewTestMode', () => {
      const { result } = renderSaveHook()

      act(() => { result.current.setIsNewTestMode(true) })
      expect(result.current.isNewTestMode).toBe(true)

      act(() => { result.current.setIsNewTestMode(false) })
      expect(result.current.isNewTestMode).toBe(false)
    })
  })
})

describe('useTestSave - a Save while drilled into a Function keeps the canvas tree whole', () => {
  const SEALED = 'wave:enc:v1:c2VhbGVk'
  const body = (nodes: unknown[]) => ({ workflow: { nodes, edges: [] }, inputs: [], outputs: [], variables: [] })
  const rootBlock = { id: 'root-block', data: { label: 'Root', config: { values: { host: 'h' } } } }
  const innerBlock = (password: string) => ({ id: 'inner', data: { label: 'Inner', config: { values: { password } } } })
  const fn = (password: string) => ({ id: 'sec_fn', data: { label: 'sec_fn', nodeType: 'function', functionLifecycle: 'local', localDefinition: body([innerBlock(password)]) } })

  it('writes the resynced sealed values into the whole tree, never the Test Blocks into the drilled body', async () => {
    vi.clearAllMocks()
    const setNodes = vi.fn()
    const setNodeTree = vi.fn()
    setupStore({
      editingTestId: 'test-1',
      editingTestName: 'zz',
      nodes: [rootBlock, fn('typed')],
      ...({ drillPath: [{ nodeId: 'sec_fn', label: 'sec_fn' }], setNodes, setNodeTree } as object),
    })
    mockUpdateTest.mockResolvedValueOnce({ id: 'test-1' })
    mockFetchTestWorkflow.mockResolvedValueOnce({ nodes: [rootBlock, fn(SEALED)], edges: [] })
    const { result } = renderHook(() => useTestSave(defaultParams()), { wrapper })

    await act(async () => { await result.current.handleSaveClick() })

    expect(setNodes).not.toHaveBeenCalled()
    expect(setNodeTree).toHaveBeenCalledTimes(1)
    const [tree] = setNodeTree.mock.calls[0] as [Array<{ id: string; data: { localDefinition?: { workflow: { nodes: unknown[] } } } }>]
    expect(tree.map((node) => node.id)).toEqual(['root-block', 'sec_fn'])
    expect(tree[1].data.localDefinition?.workflow.nodes).toEqual([innerBlock(SEALED)])
  })
})
