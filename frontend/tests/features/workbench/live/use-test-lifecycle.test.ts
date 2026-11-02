/**
 * Tests for useTestLifecycle hook
 *
 * Verifies test lifecycle orchestration: draft persistence, URL-driven test
 * loading (?editTest, ?newTest), session recovery, pending test switching,
 * and auto-save behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import {
  useTestLifecycle,
  toNamespaceEntries,
  reportTestRefreshFailure,
} from '@/features/workbench/live/use-test-lifecycle'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { usePageBlockStore } from '@/stores/page-block-store'
import { SAVE_RESYNC_OWNER } from '@/features/workbench/live/save-utils'
import { fetchSystemVariables } from '@/features/settings/api/global-variables/crud'
import { convertSystemVariables } from '@/features/workbench/live/variable-helpers'
import { createSimpleRouterWrapper } from '../../../utils/router-test-utils'

// ---------------------------------------------------------------------------
// Mock: toast (a failed refresh is reported where the user is looking)
// ---------------------------------------------------------------------------
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const error = vi.fn()
  return {
    ...(await importOriginal<typeof import('@/components/ui/toast')>()),
    useToast: () => ({ error }),
  }
})

// ---------------------------------------------------------------------------
// Mock: workflow store
// ---------------------------------------------------------------------------
vi.mock('@/features/workbench/stores/workflow-store')

// ---------------------------------------------------------------------------
// Mock: useDraftPersistence
// ---------------------------------------------------------------------------
const mockSaveDraft = vi.fn()
const mockClearDraft = vi.fn()
let mockDraft: Record<string, unknown> | null = null

vi.mock('@/features/workbench/hooks/use-draft-persistence', () => ({
  useDraftPersistence: () => ({
    draft: mockDraft,
    saveDraft: mockSaveDraft,
    clearDraft: mockClearDraft,
    hasDraft: mockDraft !== null,
    loadDraft: vi.fn().mockReturnValue(mockDraft),
  }),
}))

// ---------------------------------------------------------------------------
// Mock: useLoadTest
// ---------------------------------------------------------------------------
const mockLoadTest = vi.fn().mockResolvedValue(undefined)
let mockIsLoadingTest = false

// The real reconcileOutputBindingVariables is kept: the restore path calls it.
vi.mock('@/features/workbench/live/use-load-test', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/live/use-load-test')>()),
  useLoadTest: () => ({
    isLoadingTest: mockIsLoadingTest,
    loadTest: mockLoadTest,
  }),
}))

// ---------------------------------------------------------------------------
// Mock: variable-helpers
// ---------------------------------------------------------------------------
vi.mock('@/features/workbench/live/variable-helpers', () => ({
  convertSystemVariables: vi.fn().mockReturnValue([]),
}))

// ---------------------------------------------------------------------------
// Mock: @/features/settings/api/global-variables
// ---------------------------------------------------------------------------
vi.mock('@/features/settings/api/global-variables/crud', () => ({
  fetchSystemVariables: vi.fn().mockResolvedValue({}),
}))

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------
const storeFns = {
  isDirty: false,
  dirtyConfigNodeIds: [] as string[],
  nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
  edges: [] as Array<{ id: string; source: string; target: string }>,
  viewport: { x: 0, y: 0, zoom: 1 },
  reset: vi.fn(),
  setNodes: vi.fn(),
  setEdges: vi.fn(),
  requestFitView: vi.fn(),
  editingTestId: null as string | null,
  setVariables: vi.fn(),
  addVariable: vi.fn(),
  setNamespaceVariables: vi.fn(),
  variables: [] as Array<{ id: string; name: string; value: unknown; type: string; scope: string }>,
  functionViewMode: null as { functionId: string; version: string; editable: boolean } | null,
}

const OPEN_VIEW = { functionId: 'fn-outer', version: '1.0.0', editable: false }
const VIEW_ROOT = [{ id: 'view-shared-root', data: { label: 'Outer', editMode: true } }]

// Also mock getState for effects that access store directly
const mockGetState = vi.fn(() => ({
  variables: storeFns.variables,
  nodes: storeFns.nodes,
}))

function setupStore(overrides: Partial<typeof storeFns> = {}) {
  const state = { ...storeFns, ...overrides }
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: typeof state) => unknown)(state)
  })
  // Mock the static getState method
  ;(useWorkflowStore as unknown as { getState: typeof mockGetState }).getState = mockGetState
  return state
}

// ---------------------------------------------------------------------------
// Params helpers
// ---------------------------------------------------------------------------
function defaultParams() {
  return {
    setValidationErrors: vi.fn(),
    setValidationFatal: vi.fn(),
    setValidationMode: vi.fn(),
    setShowValidationErrorDialog: vi.fn(),
    workbenchStatus: 'idle',
    isSessionRecoveryComplete: true,
    recoveredTestId: null as string | null,
    setShowSwitchTestDialog: vi.fn(),
    setIsNewTestMode: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useTestLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // afterEach restores every mock, so the promise loadTest returns is re-armed here.
    mockLoadTest.mockResolvedValue(undefined)
    mockDraft = null
    mockIsLoadingTest = false
    storeFns.isDirty = false
    storeFns.dirtyConfigNodeIds = []
    storeFns.nodes = []
    storeFns.edges = []
    storeFns.viewport = { x: 0, y: 0, zoom: 1 }
    storeFns.editingTestId = null
    storeFns.variables = []
    storeFns.functionViewMode = null
    storeFns.reset = vi.fn()
    storeFns.setNodes = vi.fn()
    storeFns.setEdges = vi.fn()
    storeFns.requestFitView = vi.fn()
    storeFns.setVariables = vi.fn()
    storeFns.addVariable = vi.fn()
    storeFns.setNamespaceVariables = vi.fn()
    usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
    vi.mocked(fetchSystemVariables).mockResolvedValue({})
    vi.mocked(convertSystemVariables).mockReturnValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('returns correct initial values', () => {
      setupStore()
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      const { result } = renderHook(() => useTestLifecycle(params), { wrapper })

      expect(result.current.draft).toBeNull()
      expect(typeof result.current.saveDraft).toBe('function')
      expect(typeof result.current.clearDraft).toBe('function')
      expect(result.current.isLoadingTest).toBe(false)
      expect(result.current.pendingEditTestId).toBeNull()
      expect(typeof result.current.setPendingEditTestId).toBe('function')
      expect(typeof result.current.loadTest).toBe('function')
    })
  })

  describe('draft restoration', () => {
    it('restores draft nodes and edges on mount when draft exists', () => {
      mockDraft = {
        nodes: [{ id: 'n1', type: 'workflowNode', position: { x: 10, y: 20 }, data: { label: 'A' } }],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        viewport: { x: 50, y: 50, zoom: 1.5 },
        testId: null,
        testName: null,
        isDirty: true,
        variables: [],
      }
      setupStore()
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(storeFns.setNodes).toHaveBeenCalled()
      expect(storeFns.setEdges).toHaveBeenCalled()
      expect(storeFns.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
    })

    it('restores draft variables on mount', () => {
      const vars = [{ id: 'v1', name: 'host', value: 'localhost', type: 'string' }]
      mockDraft = {
        nodes: [{ id: 'n1', type: 'workflowNode', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        testId: null,
        testName: null,
        isDirty: false,
        variables: vars,
      }
      setupStore()
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(storeFns.setVariables).toHaveBeenCalledWith(vars)
    })

    // A draft stores the variable types its Blocks declared when it was written,
    // so a Block whose output type changed since leaves the bound variable stale
    // and the config panel shows a misconfiguration badge that never clears.
    it('repairs a bound variable whose Block output type changed since the draft was written', () => {
      const draftNodes = [
        {
          id: 'n-apply',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            elementType: 'k8s-apply',
            version: '1.0.0',
            config: { outputBindings: { summary: 'apply_summary' } },
          },
        },
      ]
      mockDraft = {
        nodes: draftNodes,
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        testId: null,
        testName: null,
        isDirty: true,
        variables: [
          { id: 'v-summary', name: 'apply_summary', value: null, type: 'array', scope: 'test' },
        ],
      }
      // Honor the real store contract: each setter replaces the whole collection,
      // so the repair pass reads back what restore just wrote.
      const setNodes = vi.fn((next: unknown) => {
        storeFns.nodes = next as typeof storeFns.nodes
      })
      const setVariables = vi.fn((next: unknown) => {
        storeFns.variables = next as typeof storeFns.variables
      })
      setupStore({ setNodes, setVariables })
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      // The Block declares `summary` as a table, so the restored variable is
      // retyped instead of staying on the draft's stale `array`.
      expect(storeFns.variables).toEqual([
        { id: 'v-summary', name: 'apply_summary', value: null, type: 'table', scope: 'test' },
      ])
      // A repair the user did not make must not mark the canvas dirty.
      expect(setVariables).toHaveBeenLastCalledWith(
        [{ id: 'v-summary', name: 'apply_summary', value: null, type: 'table', scope: 'test' }],
        { skipDirty: true },
      )
    })

    // The guard ref is per-mount but the workflow store is module-scoped and
    // survives, so a remount (leaving the workbench and coming back, or the
    // connection monitor re-keying the route boundary) restores a draft over a
    // store that already holds those variables. An appending setter throws
    // "already exists in this scope" from inside a passive effect, which takes
    // down the whole tree and leaves Retry re-crashing on the same store.
    it('restores over a store that already holds the draft variables without throwing', () => {
      const vars = [{ id: 'v1', name: 'm1', value: 'x', type: 'string' }]
      mockDraft = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        testId: null,
        testName: null,
        isDirty: true,
        variables: vars,
      }
      // Mirrors the real store contract: appending a name already in scope throws.
      const addVariable = vi.fn((v: { name: string }) => {
        throw new Error(`Name "${v.name}" already exists in this scope`)
      })
      setupStore({
        addVariable,
        variables: vars as typeof storeFns.variables,
      })
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()

      expect(() => renderHook(() => useTestLifecycle(params), { wrapper })).not.toThrow()
      expect(addVariable).not.toHaveBeenCalled()
      expect(storeFns.setVariables).toHaveBeenCalledWith(vars)
    })

    // The restore effect re-fires on `draft` changes from the auto-save effect. It marks
    // its ref true on first run regardless of draft availability, so already-stored
    // variables are never duplicated via addVariable.
    it('does not re-restore variables when draft updates after initial null mount', async () => {
      mockDraft = null
      setupStore()
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      const { rerender } = renderHook(() => useTestLifecycle(params), { wrapper })

      expect(storeFns.setVariables).not.toHaveBeenCalled()

      // Simulate the auto-save effect populating the draft: a user creating a variable
      // triggers saveDraft, which updates `draft`, which re-fires the restore effect.
      mockDraft = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        testId: null,
        testName: null,
        isDirty: true,
        variables: [{ id: 'v-pre-existing', name: 'x', value: 1, type: 'integer' }],
      }
      rerender()

      // Restore must NOT run again: it would clobber live edits with the
      // snapshot the auto-save effect just wrote.
      expect(storeFns.setVariables).not.toHaveBeenCalled()
    })

    // A mirroring tab shows another holder's canvas live. Restoring this tab's
    // own draft over it replaces the holder's nodes, edges and variables with
    // work that is not on screen.
    it('does not restore its own draft over a mirrored canvas', () => {
      const holderNodes = [{ id: 'holder-n1', data: { label: 'Holder step' } }]
      const holderEdges = [{ id: 'holder-e1', source: 'holder-n1', target: 'holder-n2' }]
      const holderVars = [
        { id: 'hv1', name: 'holderVar', value: 'holder', type: 'string', scope: 'test' },
      ]
      const mirrored = {
        nodes: holderNodes as typeof storeFns.nodes,
        edges: holderEdges as typeof storeFns.edges,
        variables: holderVars as typeof storeFns.variables,
      }
      // Honor the real store contract: each setter replaces the whole collection.
      const setNodes = vi.fn((next: unknown) => {
        mirrored.nodes = next as typeof storeFns.nodes
      })
      const setEdges = vi.fn((next: unknown) => {
        mirrored.edges = next as typeof storeFns.edges
      })
      const setVariables = vi.fn((next: unknown) => {
        mirrored.variables = next as typeof storeFns.variables
      })

      mockDraft = {
        nodes: [{ id: 'mine-n1', type: 'workflowNode', position: { x: 0, y: 0 }, data: {} }],
        edges: [{ id: 'mine-e1', source: 'mine-n1', target: 'mine-n2' }],
        viewport: { x: 0, y: 0, zoom: 1 },
        testId: null,
        testName: null,
        isDirty: true,
        variables: [{ id: 'mv1', name: 'myVar', value: 'mine', type: 'string' }],
      }
      setupStore({
        nodes: mirrored.nodes,
        edges: mirrored.edges,
        variables: mirrored.variables,
        setNodes,
        setEdges,
        setVariables,
      })
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = { ...defaultParams(), isMirroring: true }
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(setNodes).not.toHaveBeenCalled()
      expect(setEdges).not.toHaveBeenCalled()
      expect(setVariables).not.toHaveBeenCalled()
      // The holder's canvas is still what this tab shows.
      expect(mirrored.nodes).toEqual(holderNodes)
      expect(mirrored.edges).toEqual(holderEdges)
      expect(mirrored.variables).toEqual(holderVars)
      // This tab's own draft is left alone, ready for when it stops mirroring.
      expect(mockClearDraft).not.toHaveBeenCalled()
    })

    it('shows switch dialog when editTest param arrives with dirty draft', () => {
      mockDraft = {
        nodes: [{ id: 'n1', type: 'workflowNode', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        testId: null,
        testName: null,
        isDirty: true,
        variables: [],
      }
      setupStore()
      const wrapper = createSimpleRouterWrapper(['/workbench?editTest=test-42'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      // editTest with a dirty draft triggers the switch dialog
      expect(params.setShowSwitchTestDialog).toHaveBeenCalledWith(true)
    })
  })

  describe('?newTest handling', () => {
    it('resets canvas, clears draft, and opens save dialog for ?newTest=true', () => {
      setupStore()
      const wrapper = createSimpleRouterWrapper(['/workbench?newTest=true'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(storeFns.reset).toHaveBeenCalled()
      expect(mockClearDraft).toHaveBeenCalled()
      expect(storeFns.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
      expect(params.setIsNewTestMode).toHaveBeenCalledWith(true)
    })

    function renderNewTest(params: ReturnType<typeof defaultParams> & { isMirroring?: boolean }) {
      const wrapper = createSimpleRouterWrapper(['/workbench?newTest=true'])
      return renderHook(() => ({ lifecycle: useTestLifecycle(params), location: useLocation() }), { wrapper })
    }

    function expectAskedAndKept(
      params: ReturnType<typeof defaultParams>,
      view: ReturnType<typeof renderNewTest>,
    ): void {
      expect(params.setShowSwitchTestDialog).toHaveBeenCalledOnce()
      expect(params.setShowSwitchTestDialog).toHaveBeenCalledWith(true)
      expect(view.result.current.lifecycle.pendingEditTestId).toBeNull()
      expect(storeFns.reset).not.toHaveBeenCalled()
      expect(mockClearDraft).not.toHaveBeenCalled()
      expect(params.setIsNewTestMode).not.toHaveBeenCalled()
      // The request is used up, so Keep Editing or a later save never starts a new test by surprise.
      expect(view.result.current.location.search).toBe('')
    }

    it('asks first over a library View that holds an edit-mode draft, and keeps the View', () => {
      setupStore({ isDirty: true, functionViewMode: OPEN_VIEW, nodes: VIEW_ROOT })
      const params = defaultParams()
      const view = renderNewTest(params)

      expectAskedAndKept(params, view)
    })

    it('asks first over a dirty test, and keeps it', () => {
      setupStore({ isDirty: true, editingTestId: 'test-42', nodes: [{ id: 'n1', data: {} }] })
      const params = defaultParams()
      const view = renderNewTest(params)

      expectAskedAndKept(params, view)
    })

    it('asks first when a config sheet holds unsaved edits', () => {
      setupStore({ dirtyConfigNodeIds: ['n1'] })
      const params = defaultParams()
      const view = renderNewTest(params)

      expectAskedAndKept(params, view)
    })

    it('asks first while a run is on the canvas', () => {
      setupStore()
      const params = { ...defaultParams(), workbenchStatus: 'paused' }
      const view = renderNewTest(params)

      expectAskedAndKept(params, view)
    })

    it('starts the new test at once in a mirroring tab, which holds no work of its own', () => {
      setupStore({ isDirty: true })
      const params = { ...defaultParams(), isMirroring: true }
      renderNewTest(params)

      expect(params.setShowSwitchTestDialog).not.toHaveBeenCalled()
      expect(storeFns.reset).toHaveBeenCalledOnce()
      expect(params.setIsNewTestMode).toHaveBeenCalledWith(true)
    })
  })

  describe('library View open on a plain /workbench', () => {
    const TEST_DRAFT = {
      nodes: [{ id: 'draft-marker', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Draft' } }],
      edges: [{ id: 'e1', source: 'start-node', target: 'draft-marker' }],
      viewport: { x: 0, y: 0, zoom: 1 },
      testId: null,
      testName: null,
      isDirty: true,
      variables: [{ id: 'v1', name: 'draftVar', value: 1, type: 'integer' }],
    }

    it('never auto-saves the View as a Test draft', () => {
      setupStore({ functionViewMode: OPEN_VIEW, nodes: VIEW_ROOT, isDirty: true })
      renderHook(() => useTestLifecycle(defaultParams()), { wrapper: createSimpleRouterWrapper(['/workbench']) })

      expect(mockSaveDraft).not.toHaveBeenCalled()
    })

    it('never restores a Test draft over the View', () => {
      mockDraft = TEST_DRAFT
      setupStore({ functionViewMode: OPEN_VIEW, nodes: VIEW_ROOT, isDirty: true })
      renderHook(() => useTestLifecycle(defaultParams()), { wrapper: createSimpleRouterWrapper(['/workbench']) })

      expect(storeFns.setNodes).not.toHaveBeenCalled()
      expect(storeFns.setEdges).not.toHaveBeenCalled()
      expect(storeFns.setVariables).not.toHaveBeenCalled()
    })

    it('leaves the View where it was instead of refitting it', () => {
      setupStore({ functionViewMode: OPEN_VIEW, nodes: VIEW_ROOT })
      renderHook(() => useTestLifecycle(defaultParams()), { wrapper: createSimpleRouterWrapper(['/workbench']) })

      expect(storeFns.requestFitView).not.toHaveBeenCalled()
    })
  })

  describe('?editTest handling', () => {
    it('loads test directly when canvas is clean', () => {
      setupStore({ isDirty: false })
      const wrapper = createSimpleRouterWrapper(['/workbench?editTest=test-42'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(mockLoadTest).toHaveBeenCalledWith('test-42')
    })

    it('shows switch dialog when canvas is dirty', () => {
      setupStore({ isDirty: true })
      const wrapper = createSimpleRouterWrapper(['/workbench?editTest=test-42'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(params.setShowSwitchTestDialog).toHaveBeenCalledWith(true)
    })

    it('shows switch dialog when workbench is not idle', () => {
      setupStore({ isDirty: false })
      const wrapper = createSimpleRouterWrapper(['/workbench?editTest=test-42'])
      const params = { ...defaultParams(), workbenchStatus: 'running' }
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(params.setShowSwitchTestDialog).toHaveBeenCalledWith(true)
    })

    it('opens straight away in a mirroring tab, whatever the mirrored draft carries', () => {
      // The canvas is showing the holder's draft, not this tab's work: there is
      // nothing here to save or discard, and this tab cannot save it anyway.
      setupStore({ isDirty: true })
      const wrapper = createSimpleRouterWrapper(['/workbench?editTest=test-42'])
      const params = { ...defaultParams(), isMirroring: true, workbenchStatus: 'running' }
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(params.setShowSwitchTestDialog).not.toHaveBeenCalled()
      expect(mockLoadTest).toHaveBeenCalledWith('test-42')
    })

    it('skips loading when editTest matches current editingTestId and the canvas is hydrated', () => {
      setupStore({
        editingTestId: 'test-42',
        nodes: [{ id: 'n1', data: {} }],
      })
      const wrapper = createSimpleRouterWrapper(['/workbench?editTest=test-42'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(mockLoadTest).not.toHaveBeenCalled()
      expect(params.setShowSwitchTestDialog).not.toHaveBeenCalled()
    })

    it('loads when editTest matches the persisted editingTestId but the canvas is empty (regression guard)', () => {
      // Fresh page load rehydrates only the persisted id; skipping loadTest
      // here left the workbench on "Preparing workbench…" forever.
      setupStore({ editingTestId: 'test-42' })
      const wrapper = createSimpleRouterWrapper(['/workbench?editTest=test-42'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(mockLoadTest).toHaveBeenCalledWith('test-42')
      expect(params.setShowSwitchTestDialog).not.toHaveBeenCalled()
    })

    it('waits for session recovery before processing editTest', () => {
      setupStore()
      const wrapper = createSimpleRouterWrapper(['/workbench?editTest=test-42'])
      const params = { ...defaultParams(), isSessionRecoveryComplete: false }
      renderHook(() => useTestLifecycle(params), { wrapper })

      // Should not load yet because session recovery is not complete
      expect(mockLoadTest).not.toHaveBeenCalled()
    })
  })

  describe('pendingEditTestId', () => {
    it('can set and clear pending test id', () => {
      setupStore()
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      const { result } = renderHook(() => useTestLifecycle(params), { wrapper })

      act(() => { result.current.setPendingEditTestId('test-99') })
      expect(result.current.pendingEditTestId).toBe('test-99')

      act(() => { result.current.setPendingEditTestId(null) })
      expect(result.current.pendingEditTestId).toBeNull()
    })
  })

  describe('auto-save draft', () => {
    it('saves draft when nodes exist and no editingTestId', () => {
      setupStore({
        nodes: [{ id: 'n1', data: { label: 'A' } }],
        editingTestId: null,
      })
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(mockSaveDraft).toHaveBeenCalled()
    })

    it('does not auto-save draft when editingTestId is set', () => {
      setupStore({
        nodes: [{ id: 'n1', data: { label: 'A' } }],
        editingTestId: 'test-42',
      })
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(mockSaveDraft).not.toHaveBeenCalled()
    })
  })

  describe('session recovery', () => {
    it('loads test from recovered test id when available', () => {
      setupStore({ editingTestId: null })
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = { ...defaultParams(), recoveredTestId: 'recovered-1' }
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(mockLoadTest).toHaveBeenCalledWith('recovered-1', { silentNotFound: true })
    })

    it('skips session recovery when recoveredTestId matches editingTestId', () => {
      // When editingTestId matches recoveredTestId, session recovery is skipped.
      // However, the persisted-test restoration effect will still reload if nodes are empty.
      setupStore({ editingTestId: 'test-42', nodes: [{ id: 'n1', data: {} }] })
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = { ...defaultParams(), recoveredTestId: 'test-42' }
      renderHook(() => useTestLifecycle(params), { wrapper })

      // With nodes present, neither session recovery nor persisted-test restore fires
      expect(mockLoadTest).not.toHaveBeenCalled()
    })

    it('skips recovery when editTest param is present', () => {
      setupStore({ editingTestId: null })
      const wrapper = createSimpleRouterWrapper(['/workbench?editTest=test-99'])
      const params = { ...defaultParams(), recoveredTestId: 'recovered-1' }
      renderHook(() => useTestLifecycle(params), { wrapper })

      // editTest param should take priority over session recovery
      // mockLoadTest may be called for editTest, but NOT for recovered-1
      const recoveryCall = mockLoadTest.mock.calls.find(
        (call: unknown[]) => call[0] === 'recovered-1'
      )
      expect(recoveryCall).toBeUndefined()
    })
  })

  describe('persisted test restoration', () => {
    it('restores persisted test when editingTestId exists but canvas is empty', () => {
      setupStore({ editingTestId: 'test-42', nodes: [] })
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(mockLoadTest).toHaveBeenCalledWith('test-42')
    })
  })

  describe('initial fitView', () => {
    it('requests fitView for blank canvas on mount', () => {
      setupStore({ editingTestId: null, nodes: [] })
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      renderHook(() => useTestLifecycle(params), { wrapper })

      expect(storeFns.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
    })
  })

  describe('system namespace variables', () => {
    function mount() {
      setupStore()
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      return renderHook(() => useTestLifecycle(params), { wrapper })
    }

    it('stores the system namespace when the read succeeds', async () => {
      vi.mocked(fetchSystemVariables).mockResolvedValue({
        api_host: { type: 'string', value: 'x', secret: false },
      })
      vi.mocked(convertSystemVariables).mockReturnValue([{ name: 'api_host', type: 'string' }])

      await act(async () => {
        mount()
      })

      expect(storeFns.setNamespaceVariables).toHaveBeenCalledWith('system', [
        { name: 'api_host', type: 'string' },
      ])
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('leaves the stored namespace alone when the server reports none', async () => {
      vi.mocked(fetchSystemVariables).mockResolvedValue({})

      await act(async () => {
        mount()
      })

      expect(storeFns.setNamespaceVariables).not.toHaveBeenCalledWith('system', [])
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('ignores a system variables read that lands after the canvas is gone', async () => {
      let releaseRead: (value: Record<string, never>) => void = () => {}
      vi.mocked(fetchSystemVariables).mockReturnValue(
        new Promise((resolve) => {
          releaseRead = resolve
        })
      )
      vi.mocked(convertSystemVariables).mockReturnValue([{ name: 'api_host', type: 'string' }])

      const { unmount } = mount()
      unmount()

      await act(async () => {
        releaseRead({})
        await Promise.resolve()
      })

      expect(storeFns.setNamespaceVariables).not.toHaveBeenCalledWith('system', [
        { name: 'api_host', type: 'string' },
      ])
    })

    it('blocks the page instead of overwriting the namespace when the read fails', async () => {
      vi.mocked(fetchSystemVariables).mockRejectedValue(new Error('System vars API down'))

      await act(async () => {
        mount()
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load system variables')
      expect(block?.detail.message).toBe('System vars API down')
      expect(storeFns.setNamespaceVariables).not.toHaveBeenCalledWith('system', [])
    })

    it('clears the block and stores the namespace when the retry succeeds', async () => {
      vi.mocked(fetchSystemVariables)
        .mockRejectedValueOnce(new Error('System vars API down'))
        .mockResolvedValueOnce({ api_host: { type: 'string', value: 'x', secret: false } })
      vi.mocked(convertSystemVariables).mockReturnValue([{ name: 'api_host', type: 'string' }])

      await act(async () => {
        mount()
      })
      await act(async () => {
        await usePageBlockStore.getState().block!.retry()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      expect(storeFns.setNamespaceVariables).toHaveBeenCalledWith('system', [
        { name: 'api_host', type: 'string' },
      ])
    })

    it('keeps the block with the newest reason when the retry fails again', async () => {
      vi.mocked(fetchSystemVariables)
        .mockRejectedValueOnce(new Error('System vars API down'))
        .mockRejectedValueOnce(new Error('Still down'))

      await act(async () => {
        mount()
      })
      await act(async () => {
        await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow('Still down')
      })

      expect(usePageBlockStore.getState().block?.detail.message).toBe('Still down')
    })
  })

  describe('save re-sync reports', () => {
    function mount() {
      setupStore()
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const params = defaultParams()
      return renderHook(() => useTestLifecycle(params), { wrapper })
    }

    function reportResync() {
      usePageBlockStore.getState().setBlock({
        owner: SAVE_RESYNC_OWNER,
        label: 'saved test',
        detail: { message: 'Secret store unavailable' },
        retry: vi.fn().mockResolvedValue(undefined),
      })
    }

    it('drops a save re-sync report after the canvas is gone', async () => {
      let canvas!: ReturnType<typeof mount>
      await act(async () => {
        canvas = mount()
      })

      canvas.unmount()
      act(() => reportResync())

      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('takes save re-sync reports again on a remounted canvas', async () => {
      let canvas!: ReturnType<typeof mount>
      await act(async () => {
        canvas = mount()
      })
      canvas.unmount()

      await act(async () => {
        canvas = mount()
      })
      act(() => reportResync())

      expect(usePageBlockStore.getState().block?.title).toBe('Could not load saved test')
      canvas.unmount()
    })
  })
})

describe('toNamespaceEntries', () => {
  it('passes through standard types unchanged', () => {
    const result = toNamespaceEntries([
      { name: 'host', type: 'string' },
      { name: 'port', type: 'integer' },
      { name: 'enabled', type: 'boolean' },
    ])

    expect(result).toEqual([
      { name: 'host', type: 'string' },
      { name: 'port', type: 'integer' },
      { name: 'enabled', type: 'boolean' },
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(toNamespaceEntries([])).toEqual([])
  })
})

describe('reportTestRefreshFailure', () => {
  function makeSink() {
    return { deleted: vi.fn(), stale: vi.fn() }
  }

  it('reports the open test as deleted on a 404', () => {
    const sink = makeSink()

    reportTestRefreshFailure({ status: 404 }, sink)

    expect(sink.deleted).toHaveBeenCalledTimes(1)
    expect(sink.stale).not.toHaveBeenCalled()
  })

  it('reports every other failure as a refresh that did not happen', () => {
    const sink = makeSink()

    reportTestRefreshFailure(new Error('Internal Server Error'), sink)

    expect(sink.stale).toHaveBeenCalledWith('Internal Server Error')
    expect(sink.deleted).not.toHaveBeenCalled()
  })

  it('reports a failure with no status and no message', () => {
    const sink = makeSink()

    reportTestRefreshFailure(null, sink)

    expect(sink.stale).toHaveBeenCalledWith('Request failed')
    expect(sink.deleted).not.toHaveBeenCalled()
  })
})
