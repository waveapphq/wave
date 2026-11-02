/**
 * Tests for useValidation hook
 *
 * Verifies validation error dialog state management, close behavior
 * (load vs save mode), delete-fatal-test API integration, and fix-all
 * workflow update logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useValidation } from '@/features/workbench/live/use-validation'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type { ValidationError } from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
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
const mockDeleteTest = vi.fn()
const mockFixTest = vi.fn()

vi.mock('@/features/tests/api/crud', () => ({
  deleteTest: (...args: unknown[]) => mockDeleteTest(...args),
}))
vi.mock('@/features/tests/api/validation', () => ({
  fixTest: (...args: unknown[]) => mockFixTest(...args),
}))

// ---------------------------------------------------------------------------
// Mock: variable-helpers
// ---------------------------------------------------------------------------
const mockConvertBackendVariables = vi.fn().mockReturnValue([])
vi.mock('@/features/workbench/live/variable-helpers', () => ({
  convertBackendVariables: (...args: unknown[]) => mockConvertBackendVariables(...args),
}))

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------
const storeFns = {
  reset: vi.fn(),
  setNodes: vi.fn(),
  setEdges: vi.fn(),
  markSaved: vi.fn(),
  setPulseValidationNodeIds: vi.fn(),
  requestFitView: vi.fn(),
  setEditingTest: vi.fn(),
  clearEditingTest: vi.fn(),
  setVariables: vi.fn(),
  addVariable: vi.fn(),
  editingTestId: null as string | null,
}

function setupStore(overrides: Partial<typeof storeFns> = {}) {
  const state = { ...storeFns, ...overrides }
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: typeof state) => unknown)(state)
  })
  return state
}

/** Each variable Fix All handed to addVariable, in call order. */
function addedVariables(state: typeof storeFns): unknown[] {
  return state.addVariable.mock.calls.map(([variable]) => variable)
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
const wrapper = createSimpleRouterWrapper(['/tests/test-1/edit'])

function renderValidation(clearDraft = vi.fn()) {
  return {
    clearDraft,
    ...renderHook(() => useValidation(clearDraft), { wrapper }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store defaults
    storeFns.editingTestId = null
    storeFns.reset = vi.fn()
    storeFns.setNodes = vi.fn()
    storeFns.setEdges = vi.fn()
    storeFns.markSaved = vi.fn()
    storeFns.setPulseValidationNodeIds = vi.fn()
    storeFns.requestFitView = vi.fn()
    storeFns.setEditingTest = vi.fn()
    storeFns.clearEditingTest = vi.fn()
    storeFns.setVariables = vi.fn()
    storeFns.addVariable = vi.fn()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('has no errors, not fatal, dialog closed', () => {
      setupStore()
      const { result } = renderValidation()

      expect(result.current.showValidationErrorDialog).toBe(false)
      expect(result.current.validationErrors).toEqual([])
      expect(result.current.validationFatal).toBe(false)
      expect(result.current.validationMode).toBe('load')
      expect(result.current.isFixingTest).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // State setters
  // -------------------------------------------------------------------------
  describe('state setters', () => {
    it('setValidationErrors updates error list', () => {
      setupStore()
      const { result } = renderValidation()

      act(() => {
        result.current.setValidationErrors([
          { path: '/block/1', code: 'MISSING_PARAM', message: 'Parameter X required' },
        ])
      })

      expect(result.current.validationErrors).toHaveLength(1)
      expect(result.current.validationErrors[0].code).toBe('MISSING_PARAM')
    })

    it('setValidationFatal updates fatal flag', () => {
      setupStore()
      const { result } = renderValidation()

      act(() => {
        result.current.setValidationFatal(true)
      })

      expect(result.current.validationFatal).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // handleValidationClose
  // -------------------------------------------------------------------------
  describe('handleValidationClose', () => {
    it('in load mode (non-fatal) just closes the dialog and keeps the test loaded with regular alerts', () => {
      // Per user spec: Cancel on a non-fatal Load validation dialog keeps the
      // test on canvas. Per-node alerts come from `computeNodeIssues`
      // (regular, not pulsing). No navigation, no reset, no pulse.
      const state = setupStore()
      const { result, clearDraft } = renderValidation()

      act(() => {
        result.current.setShowValidationErrorDialog(true)
        result.current.setValidationErrors([
          { path: '/block/1', code: 'ERR', message: 'something' },
        ])
        result.current.setValidationFatal(false)
      })

      act(() => {
        result.current.handleValidationClose()
      })

      expect(result.current.showValidationErrorDialog).toBe(false)
      expect(result.current.validationErrors).toEqual([])
      expect(result.current.validationFatal).toBe(false)
      expect(result.current.validationMode).toBe('load')

      expect(state.reset).not.toHaveBeenCalled()
      expect(clearDraft).not.toHaveBeenCalled()
      expect(state.clearEditingTest).not.toHaveBeenCalled()
      expect(mockNavigate).not.toHaveBeenCalled()
      expect(state.setPulseValidationNodeIds).not.toHaveBeenCalled()
    })

    it('in load mode (fatal) resets state and navigates to /tests', () => {
      // Fatal load means the test cannot be opened in the workbench. Cancel
      // must take the user somewhere usable.
      const state = setupStore()
      const { result, clearDraft } = renderValidation()

      act(() => {
        result.current.setShowValidationErrorDialog(true)
        result.current.setValidationErrors([
          { path: '/block/1', code: 'MISSING_WORKFLOW', message: 'fatal' },
        ])
        result.current.setValidationFatal(true)
      })

      act(() => {
        result.current.handleValidationClose()
      })

      expect(result.current.showValidationErrorDialog).toBe(false)
      expect(result.current.validationErrors).toEqual([])
      expect(result.current.validationFatal).toBe(false)
      expect(state.reset).toHaveBeenCalled()
      expect(clearDraft).toHaveBeenCalled()
      expect(state.clearEditingTest).toHaveBeenCalled()
      expect(mockNavigate).toHaveBeenCalledWith('/tests')
      expect(state.setPulseValidationNodeIds).not.toHaveBeenCalled()
    })

    it('in save mode just closes dialog without navigating', () => {
      const state = setupStore()
      const { result, clearDraft } = renderValidation()

      // Switch to save mode
      act(() => {
        result.current.setValidationMode('save')
        result.current.setShowValidationErrorDialog(true)
      })

      act(() => {
        result.current.handleValidationClose()
      })

      // Dialog state should be cleared
      expect(result.current.showValidationErrorDialog).toBe(false)
      expect(result.current.validationErrors).toEqual([])
      expect(result.current.validationFatal).toBe(false)

      // Should NOT navigate or reset
      expect(state.reset).not.toHaveBeenCalled()
      expect(clearDraft).not.toHaveBeenCalled()
      expect(state.clearEditingTest).not.toHaveBeenCalled()
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('on save-mode close, populates pulse set with the affected node ids (deduped)', () => {
      const state = setupStore()
      const { result } = renderValidation()

      act(() => {
        result.current.setValidationMode('save')
        result.current.setValidationErrors([
          { path: 'a', node_id: 'n1', code: 'E', message: 'm', severity: 'error' },
          { path: 'b', node_id: 'n1', code: 'E', message: 'm', severity: 'error' },
          { path: 'c', code: 'E', message: 'm', severity: 'error' }, // node_id missing
          { path: 'd', node_id: 'n2', code: 'E', message: 'm', severity: 'error' },
        ])
        result.current.setShowValidationErrorDialog(true)
      })

      act(() => {
        result.current.handleValidationClose()
      })

      expect(state.setPulseValidationNodeIds).toHaveBeenCalledWith(['n1', 'n2'])
    })
  })

  // -------------------------------------------------------------------------
  // handleDeleteFatalTest
  // -------------------------------------------------------------------------
  describe('handleDeleteFatalTest', () => {
    it('calls deleteTest API and navigates to /tests', async () => {
      const state = setupStore({ editingTestId: 'test-42' })
      mockDeleteTest.mockResolvedValue(undefined)
      const { result, clearDraft } = renderValidation()

      // Open dialog to verify it gets closed
      act(() => {
        result.current.setShowValidationErrorDialog(true)
        result.current.setValidationFatal(true)
      })

      await act(async () => {
        await result.current.handleDeleteFatalTest()
      })

      expect(mockDeleteTest).toHaveBeenCalledWith('test-42')
      expect(result.current.showValidationErrorDialog).toBe(false)
      expect(result.current.validationErrors).toEqual([])
      expect(result.current.validationFatal).toBe(false)
      expect(state.reset).toHaveBeenCalledOnce()
      expect(clearDraft).toHaveBeenCalledOnce()
      expect(state.clearEditingTest).toHaveBeenCalledOnce()
      expect(mockNavigate).toHaveBeenCalledWith('/tests')
      expect(mockToastSuccess).toHaveBeenCalledWith('Test has been deleted.', 'Test Deleted')
    })

    it('handles API error gracefully', async () => {
      setupStore({ editingTestId: 'test-42' })
      mockDeleteTest.mockRejectedValue(new Error('Network error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = renderValidation()

      await act(async () => {
        await result.current.handleDeleteFatalTest()
      })

      expect(mockToastError).toHaveBeenCalledWith('Failed to delete test.', 'Delete Failed')
      expect(consoleSpy).toHaveBeenCalled()

      // Should NOT navigate on error
      expect(mockNavigate).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('does nothing when editingTestId is null', async () => {
      setupStore({ editingTestId: null })
      const { result } = renderValidation()

      await act(async () => {
        await result.current.handleDeleteFatalTest()
      })

      expect(mockDeleteTest).not.toHaveBeenCalled()
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // handleFixAll
  // -------------------------------------------------------------------------
  describe('handleFixAll', () => {
    const fixResult = {
      test: {
        name: 'Fixed Test',
        metadata: { parent_suite: 'suite-1' },
        workflow: {
          nodes: [{ id: 'n1', type: 'custom', position: { x: 0, y: 0 }, data: {} }],
          edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        },
        variables: {
          myVar: { type: 'string', value: 'hello' },
        },
      },
      warnings: [],
    }

    it('calls fixTest API and updates workflow', async () => {
      const state = setupStore({ editingTestId: 'test-99' })
      mockFixTest.mockResolvedValue(fixResult)
      mockConvertBackendVariables.mockReturnValue([
        { id: 'v1', name: 'myVar', type: 'string', value: 'hello' },
      ])
      const { result, clearDraft } = renderValidation()

      // Open dialog
      act(() => {
        result.current.setShowValidationErrorDialog(true)
        result.current.setValidationErrors([
          { path: '/block/1', code: 'ERR', message: 'broken' },
        ])
      })

      await act(async () => {
        await result.current.handleFixAll()
      })

      // API called
      expect(mockFixTest).toHaveBeenCalledWith('test-99')

      // Canvas updated
      expect(state.reset).toHaveBeenCalledOnce()
      expect(state.setEditingTest).toHaveBeenCalledWith('test-99', 'Fixed Test')
      expect(state.setNodes).toHaveBeenCalledWith(fixResult.test.workflow.nodes, { skipDirty: true })
      expect(state.setEdges).toHaveBeenCalledWith(fixResult.test.workflow.edges, { skipDirty: true })

      // Variables loaded
      expect(mockConvertBackendVariables).toHaveBeenCalledWith(fixResult.test.variables)
      expect(state.setVariables).toHaveBeenCalledWith(
        [{ id: 'v1', name: 'myVar', type: 'string', value: 'hello' }],
        { skipDirty: true },
      )

      // Post-fix cleanup
      expect(state.markSaved).toHaveBeenCalledOnce()
      expect(state.setPulseValidationNodeIds).toHaveBeenCalledWith([])
      expect(clearDraft).toHaveBeenCalledOnce()
      expect(state.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })

      // Dialog closed
      expect(result.current.showValidationErrorDialog).toBe(false)
      expect(result.current.validationErrors).toEqual([])
      expect(result.current.validationFatal).toBe(false)
      expect(result.current.isFixingTest).toBe(false)

      expect(mockToastSuccess).toHaveBeenCalledWith(
        'All issues have been automatically fixed.',
        'Test Fixed',
      )
    })

    it('handles empty workflow gracefully', async () => {
      const state = setupStore({ editingTestId: 'test-99' })
      mockFixTest.mockResolvedValue({
        test: {
          name: 'Empty Test',
          metadata: { parent_suite: null },
          workflow: { nodes: [], edges: [] },
          variables: {},
        },
        warnings: [],
      })
      const { result } = renderValidation()

      await act(async () => {
        await result.current.handleFixAll()
      })

      // setNodes/setEdges should NOT be called for empty arrays
      expect(state.setNodes).not.toHaveBeenCalled()
      expect(state.setEdges).not.toHaveBeenCalled()

      // setVariables called with empty array for no variables
      expect(state.setVariables).toHaveBeenCalledWith([], { skipDirty: true })
    })

    it('handles missing workflow property', async () => {
      const state = setupStore({ editingTestId: 'test-99' })
      mockFixTest.mockResolvedValue({
        test: {
          name: 'No Workflow',
          metadata: {},
          variables: {},
        },
        warnings: [],
      })
      const { result } = renderValidation()

      await act(async () => {
        await result.current.handleFixAll()
      })

      // Should use fallback { nodes: [], edges: [] }
      expect(state.setNodes).not.toHaveBeenCalled()
      expect(state.setEdges).not.toHaveBeenCalled()
    })

    it('handles API error gracefully', async () => {
      setupStore({ editingTestId: 'test-99' })
      mockFixTest.mockRejectedValue(new Error('Server error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = renderValidation()

      await act(async () => {
        await result.current.handleFixAll()
      })

      expect(mockToastError).toHaveBeenCalledWith(
        'Failed to apply automatic fixes. Please try again.',
        'Fix Failed',
      )
      expect(result.current.isFixingTest).toBe(false)
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('does nothing when editingTestId is null', async () => {
      setupStore({ editingTestId: null })
      const { result } = renderValidation()

      await act(async () => {
        await result.current.handleFixAll()
      })

      expect(mockFixTest).not.toHaveBeenCalled()
    })

    it('does not show warning toast when there are no post-fix warnings', async () => {
      setupStore({ editingTestId: 'test-99' })
      mockFixTest.mockResolvedValue({
        test: {
          name: 'Test',
          metadata: {},
          workflow: { nodes: [], edges: [] },
          variables: {},
        },
        warnings: [],
      })
      const { result } = renderValidation()

      await act(async () => {
        await result.current.handleFixAll()
      })

      expect(mockToastWarning).not.toHaveBeenCalled()
    })

    describe('save / run / debug modes - inline FE fix', () => {
      it('adds missing variables holding null, with no value key, without calling fixTest (REQ-3.1.3.20)', async () => {
        const state = setupStore({ editingTestId: 'test-99' })
        const { result } = renderValidation()

        act(() => {
          result.current.setValidationMode('save')
          result.current.setShowValidationErrorDialog(true)
          result.current.setValidationErrors([
            {
              path: 'variables.test1',
              code: 'UNDECLARED_VARIABLE',
              message: "Variable 'test1' is used in 1 block(s) but not declared in variable manager",
              fix_action: 'Add variable to manager (type: integer)',
            },
            {
              path: 'variables.test2',
              code: 'UNDECLARED_VARIABLE',
              message: "Variable 'test2' is used in 1 block(s) but not declared in variable manager",
              fix_action: 'Add variable to manager (type: string)',
            },
          ])
        })

        await act(async () => {
          await result.current.handleFixAll()
        })

        expect(mockFixTest).not.toHaveBeenCalled()
        expect(state.addVariable).toHaveBeenCalledTimes(2)
        expect(addedVariables(state)).toStrictEqual([
          { name: 'test1', type: 'integer' },
          { name: 'test2', type: 'string' },
        ])

        // Dialog is closed; the user must click Save again to commit.
        expect(result.current.showValidationErrorDialog).toBe(false)
        expect(result.current.validationErrors).toEqual([])
        // Per spec: Fix clears the pulse left over from a prior Cancel attempt.
        expect(state.setPulseValidationNodeIds).toHaveBeenCalledWith([])
        // Toast tells the user the next step.
        expect(mockToastSuccess).toHaveBeenCalledWith(
          expect.stringContaining('Added 2 missing variable(s)'),
          'Variables Added',
        )
      })

      it('falls back to string when the BE fix_action does not name a known type', async () => {
        const state = setupStore({ editingTestId: 'test-99' })
        const { result } = renderValidation()

        act(() => {
          result.current.setValidationMode('run')
          result.current.setValidationErrors([
            {
              path: 'variables.weird',
              code: 'UNDECLARED_VARIABLE',
              message: 'broken',
              fix_action: 'Remove references (type conflict)',
            },
          ])
        })

        await act(async () => {
          await result.current.handleFixAll()
        })

        expect(addedVariables(state)).toStrictEqual([{ name: 'weird', type: 'string' }])
      })

      it.each(['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'])(
        'creates a %s variable holding null, with no value key (REQ-3.1.3.20)',
        async (typeName) => {
          const state = setupStore({ editingTestId: 'test-99' })
          const { result } = renderValidation()

          act(() => {
            result.current.setValidationMode('save')
            result.current.setValidationErrors([
              {
                path: `variables.fix_${typeName}`,
                code: 'UNDECLARED_VARIABLE',
                message: `Variable 'fix_${typeName}' is used but not declared`,
                fix_action: `Add variable to manager (type: ${typeName})`,
              },
            ])
          })

          await act(async () => {
            await result.current.handleFixAll()
          })

          expect(addedVariables(state)).toStrictEqual([{ name: `fix_${typeName}`, type: typeName }])
        },
      )

      it('deduplicates by variable name when the same var is flagged twice', async () => {
        const state = setupStore({ editingTestId: 'test-99' })
        const { result } = renderValidation()

        act(() => {
          result.current.setValidationMode('save')
          result.current.setValidationErrors([
            {
              path: 'variables.dup',
              code: 'UNDECLARED_VARIABLE',
              message: 'first',
              fix_action: 'Add variable to manager (type: string)',
            },
            {
              path: 'variables.dup',
              code: 'UNDECLARED_VARIABLE',
              message: 'second',
              fix_action: 'Add variable to manager (type: string)',
            },
          ])
        })

        await act(async () => {
          await result.current.handleFixAll()
        })

        expect(state.addVariable).toHaveBeenCalledTimes(1)
      })

      it('ignores non-UNDECLARED errors when collecting fixes', async () => {
        const state = setupStore({ editingTestId: 'test-99' })
        const { result } = renderValidation()

        act(() => {
          result.current.setValidationMode('save')
          result.current.setValidationErrors([
            {
              path: 'variables.foo',
              code: 'REQUIRED_PARAM_MISSING',
              message: 'irrelevant',
              fix_action: 'Add variable to manager (type: integer)',
            },
          ])
        })

        await act(async () => {
          await result.current.handleFixAll()
        })

        expect(state.addVariable).not.toHaveBeenCalled()
      })

      it('debug mode picks the "debug" verb in the post-fix toast', async () => {
        const state = setupStore({ editingTestId: 'test-99' })
        const { result } = renderValidation()

        act(() => {
          result.current.setValidationMode('debug')
          result.current.setValidationErrors([
            {
              path: 'variables.dbgvar',
              code: 'UNDECLARED_VARIABLE',
              message: 'm',
              fix_action: 'Add variable to manager (type: integer)',
            },
          ])
        })

        await act(async () => {
          await result.current.handleFixAll()
        })

        expect(addedVariables(state)).toStrictEqual([{ name: 'dbgvar', type: 'integer' }])
        expect(mockToastSuccess).toHaveBeenCalledWith(
          expect.stringContaining('Click Debug again to commit'),
          'Variables Added',
        )
      })

      it('ignores UNDECLARED_VARIABLE errors whose path is missing or not in the variables.* namespace', async () => {
        // Defensive: malformed BE payloads (path missing or pointing
        // elsewhere) shouldn't crash collectUndeclaredVarFixes and shouldn't
        // declare any variables.
        const state = setupStore({ editingTestId: 'test-99' })
        const { result } = renderValidation()

        act(() => {
          result.current.setValidationMode('save')
          result.current.setValidationErrors([
            // Missing path -> err.path ?? '' branch
            { code: 'UNDECLARED_VARIABLE', message: 'no path' } as never,
            // Path outside variables.* namespace -> startsWith branch
            { path: 'nodes.fn-1', code: 'UNDECLARED_VARIABLE', message: 'wrong ns' },
            // Empty name after slice -> if (!name) branch
            { path: 'variables.', code: 'UNDECLARED_VARIABLE', message: 'empty name' },
            // Missing fix_action -> err.fix_action ?? '' branch
            { path: 'variables.ok', code: 'UNDECLARED_VARIABLE', message: 'no fix_action' },
          ])
        })

        await act(async () => {
          await result.current.handleFixAll()
        })

        // Only the path=variables.ok survives; its missing fix_action falls back to type='string'.
        expect(state.addVariable).toHaveBeenCalledTimes(1)
        expect(addedVariables(state)).toStrictEqual([{ name: 'ok', type: 'string' }])
      })
    })
  })

  // -------------------------------------------------------------------------
  // canFixAll
  // -------------------------------------------------------------------------
  describe('canFixAll', () => {
    it('is false in load mode when no issue carries a fix_action (content issues only)', () => {
      setupStore()
      const { result } = renderValidation()

      act(() => {
        result.current.setValidationMode('load')
        result.current.setValidationErrors([
          { path: 'p', code: 'MISSING_FUNCTION_VERSION', message: 'gone' },
          { path: 'q', code: 'REQUIRED_PARAM_MISSING', message: 'missing' },
        ])
      })

      expect(result.current.canFixAll).toBe(false)
    })

    it('is true in load mode when at least one issue carries a fix_action', () => {
      setupStore()
      const { result } = renderValidation()

      act(() => {
        result.current.setValidationMode('load')
        result.current.setValidationErrors([
          { path: 'p', code: 'MISSING_FUNCTION_VERSION', message: 'gone' },
          { path: 'r', code: 'DANGLING_EDGE', message: 'dangling', fix_action: 'Remove dangling edge' },
        ])
      })

      expect(result.current.canFixAll).toBe(true)
    })

    it('is false in save mode with no UNDECLARED_VARIABLE errors', () => {
      setupStore()
      const { result } = renderValidation()

      act(() => {
        result.current.setValidationMode('save')
        result.current.setValidationErrors([
          { path: 'p', code: 'SOMETHING_ELSE', message: 'm' },
        ])
      })

      expect(result.current.canFixAll).toBe(false)
    })

    it('is true in save mode when at least one UNDECLARED_VARIABLE error is present', () => {
      setupStore()
      const { result } = renderValidation()

      act(() => {
        result.current.setValidationMode('save')
        result.current.setValidationErrors([
          { path: 'variables.test1', code: 'UNDECLARED_VARIABLE', message: 'm' },
        ])
      })

      expect(result.current.canFixAll).toBe(true)
    })

    it('is true in run mode when at least one UNDECLARED_VARIABLE error is present', () => {
      setupStore()
      const { result } = renderValidation()

      act(() => {
        result.current.setValidationMode('run')
        result.current.setValidationErrors([
          { path: 'variables.x', code: 'UNDECLARED_VARIABLE', message: 'm' },
        ])
      })

      expect(result.current.canFixAll).toBe(true)
    })
  })
  // -------------------------------------------------------------------------
  // Severity on the live validation path (PYRUN-14)
  // -------------------------------------------------------------------------
  describe('issue severity', () => {
    function closeInSaveMode(errors: ValidationError[]) {
      const state = setupStore()
      const { result } = renderValidation()

      act(() => {
        result.current.setValidationMode('save')
        result.current.setValidationErrors(errors)
        result.current.setShowValidationErrorDialog(true)
      })

      const listed = result.current.validationErrors.length

      act(() => {
        result.current.handleValidationClose()
      })

      return { state, listed }
    }

    it('pulses the blocks of the error-severity issues only', () => {
      const { state } = closeInSaveMode([
        { path: 'a', node_id: 'n1', code: 'E', message: 'm', severity: 'error' },
        { path: 'b', node_id: 'n2', code: 'W', message: 'm', severity: 'warning' },
      ])

      expect(state.setPulseValidationNodeIds).toHaveBeenCalledWith(['n1'])
    })

    it('pulses nothing when every issue is a warning', () => {
      const { state } = closeInSaveMode([
        { path: 'a', node_id: 'n1', code: 'W', message: 'm', severity: 'warning' },
        { path: 'b', node_id: 'n2', code: 'W', message: 'm', severity: 'warning' },
      ])

      expect(state.setPulseValidationNodeIds).toHaveBeenCalledWith([])
    })

    it('still lists a warning in the dialog while it is open', () => {
      const { listed } = closeInSaveMode([
        { path: 'a', node_id: 'n1', code: 'E', message: 'm', severity: 'error' },
        { path: 'b', node_id: 'n2', code: 'W', message: 'm', severity: 'warning' },
      ])

      expect(listed).toBe(2)
    })

    it('treats an issue with no severity as an error', () => {
      const { state } = closeInSaveMode([
        { path: 'a', node_id: 'n1', code: 'E', message: 'm' },
        { path: 'b', node_id: 'n2', code: 'W', message: 'm', severity: 'warning' },
      ])

      expect(state.setPulseValidationNodeIds).toHaveBeenCalledWith(['n1'])
    })

    it('still pulses a block that carries an error beside a warning', () => {
      const { state } = closeInSaveMode([
        { path: 'a', node_id: 'n1', code: 'W', message: 'm', severity: 'warning' },
        { path: 'b', node_id: 'n1', code: 'E', message: 'm', severity: 'error' },
      ])

      expect(state.setPulseValidationNodeIds).toHaveBeenCalledWith(['n1'])
    })
  })
})
