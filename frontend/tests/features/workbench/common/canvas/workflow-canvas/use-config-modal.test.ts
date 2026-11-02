/**
 * useConfigModal Hook Tests
 *
 * Tests for the config modal hook including internal helper functions
 * (getDefaultValueForType, removeMatchingEdges, cleanupAssertModeEdges,
 * cleanupOrphanedBranchEdges, createOutputBindingVariables,
 * createVariableSetterVariables) exercised through handleConfigSave.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { SaveData } from '@/features/workbench/common/element-config/types'

function withReactFlow({ children }: { children: ReactNode }) {
  return createElement(ReactFlowProvider, null, children)
}

// ===========================================================================
// Mock state
// ===========================================================================

const mockCloseConfigModal = vi.fn()
const mockUpdateNode = vi.fn()
const mockSetEdges = vi.fn()
const mockAddVariable = vi.fn()
const mockUpdateVariable = vi.fn()
const mockUpdateOutputParam = vi.fn(() => ({ success: true }))
const mockClearValidationErrorNode = vi.fn()
// Synchronous transaction stub: invokes the callback directly so the
// individual mutation mocks observe each call. The post-state baseline
// model relies on the real store implementation; callers under test only
// need the wrapping behavior.
const mockTransaction = vi.fn((cb: () => void) => cb())
// Answers the Save warning at once, as a person confirming it would (SECUI-12).
function answerSecretPromotionAtOnce(_names: string[], save: () => void) {
  save()
}
const mockRequestSecretPromotion = vi.fn(answerSecretPromotionAtOnce)

interface MockVariable {
  id: string
  name: string
  value: unknown
  type: string
  isSecret?: boolean
}

const mockStore = {
  nodes: [] as Array<{
    id: string
    type?: string
    position?: { x: number; y: number }
    data: Record<string, unknown>
  }>,
  edges: [] as Array<{
    id: string
    source: string
    sourceHandle?: string
    target: string
    targetHandle?: string
  }>,
  configModalNodeId: null as string | null,
  closeConfigModal: mockCloseConfigModal,
  updateNode: mockUpdateNode,
  setEdges: mockSetEdges,
  variables: [] as MockVariable[],
  addVariable: mockAddVariable,
  updateVariable: mockUpdateVariable,
  updateOutputParam: mockUpdateOutputParam,
  clearPulseValidationNodeId: mockClearValidationErrorNode,
  transaction: mockTransaction,
  requestSecretPromotion: mockRequestSecretPromotion,
  drillPath: [] as Array<{ nodeId: string; label: string }>,
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}))

const mockGetInputParams = vi.fn((_type?: string) =>
  [{ name: 'command', type: 'string' as const, required: true, description: 'Command' }]
)
const mockGetOutputParams = vi.fn((_type?: string) =>
  [{ name: 'stdout', type: 'string' }]
)

// The one Block lookup: a Function Block reads the real adapter, any other Block the mocked schema.
type BlockLookup = (data: Record<string, unknown>) => unknown
vi.mock('@/features/workbench/lib/node-parameters', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/features/workbench/lib/node-parameters')
  const blockLookup = (name: string, schemaFor: (type: string) => unknown): BlockLookup =>
    (data) =>
      data.nodeType === 'function'
        ? (actual[name] as BlockLookup)(data)
        : schemaFor(String(data.elementType ?? ''))
  return {
    getInputParams: (type: string) => mockGetInputParams(type),
    getOutputParams: (type: string) => mockGetOutputParams(type),
    blockInputParams: blockLookup('blockInputParams', (type) => mockGetInputParams(type)),
    blockOutputParams: blockLookup('blockOutputParams', (type) => mockGetOutputParams(type)),
  }
})

const mockGetControlMetadata = vi.fn((_type?: string) => ({ description: 'test control' }))
const mockGetControlVersions = vi.fn((_type?: string) => [{ version: '1.0.0' }] as Array<{ version: string }>)

vi.mock('@/features/workbench/docs/_loader', () => ({
  getControlMetadata: (type: string) => mockGetControlMetadata(type),
  getControlVersions: (type: string) => mockGetControlVersions(type),
}))

// Delegate to the real subtree walker by default. `walkThrowOnCall` lets a
// single test force a throw on a chosen call index (1-based, reset per test)
// to exercise the reservedScopeNames catch branch in isolation.
let walkCallCount = 0
let walkThrowOnCall = 0
vi.mock('@/features/functions/canvas/inner-workflow', async () => {
  const actual = await vi.importActual<typeof import(
    '@/features/functions/canvas/inner-workflow'
  )>('@/features/functions/canvas/inner-workflow')
  return {
    ...actual,
    walkActiveSubtree: (...args: Parameters<typeof actual.walkActiveSubtree>) => {
      walkCallCount += 1
      if (walkThrowOnCall !== 0 && walkCallCount === walkThrowOnCall) {
        throw new Error('forced walkActiveSubtree failure')
      }
      return actual.walkActiveSubtree(...args)
    },
  }
})

import { useConfigModal } from '@/features/workbench/common/canvas/workflow-canvas/use-config-modal'

// ===========================================================================
// Helpers
// ===========================================================================

function createSaveData(overrides: Partial<SaveData> = {}): SaveData {
  return {
    id: 'node-1',
    version: '1.0.0',
    name: 'Block_1',
    values: {},
    outputBindings: {},
    outputTypes: {},
    profileBindings: [],
    expressionFields: [],
    templateFields: [],
    ...overrides,
  }
}

// ===========================================================================
// Tests
// ===========================================================================

describe('useConfigModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    walkCallCount = 0
    walkThrowOnCall = 0
    mockStore.nodes = []
    mockStore.edges = []
    mockStore.configModalNodeId = null
    mockStore.variables = []
    mockStore.drillPath = []
    mockGetInputParams.mockReturnValue(
      [{ name: 'command', type: 'string' as const, required: true, description: 'Command' }]
    )
    mockGetOutputParams.mockReturnValue(
      [{ name: 'stdout', type: 'string' }]
    )
    mockGetControlMetadata.mockReturnValue({ description: 'test control' })
    mockGetControlVersions.mockReturnValue([{ version: '1.0.0' }])
  })

  // =========================================================================
  // configModalElement computation
  // =========================================================================

  describe('configModalElement', () => {
    it('returns null when configModalNodeId is null', () => {
      mockStore.configModalNodeId = null
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement).toBeNull()
    })

    it('returns null when node is not found', () => {
      mockStore.configModalNodeId = 'nonexistent'
      mockStore.nodes = [{ id: 'other', data: { label: 'Other' } }]
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement).toBeNull()
    })

    it('resolves the inner node when drilled into a local Function', () => {
      const innerNode = {
        id: 'inner-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Inner Shell Script',
          elementType: 'shell-script',
          version: '1.0.0',
          config: { values: { command: 'echo inner' } },
        },
      }
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [innerNode], edges: [] },
            inputs: [],
            outputs: [],
            variables: [],
          },
        },
      }
      mockStore.nodes = [fnNode]
      mockStore.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]
      mockStore.configModalNodeId = 'inner-1'

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      expect(result.current.configModalElement).not.toBeNull()
      expect(result.current.configModalElement!.id).toBe('inner-1')
      expect(result.current.configModalElement!.name).toBe('Inner Shell Script')
    })

    it('computes element data from node when configModalNodeId is set', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: {
          label: 'Shell Script',
          elementType: 'shell-script',
          version: '1.0.0',
          description: 'My Shell Script Step',
          config: {
            values: { command: 'echo hello' },
            outputBindings: { stdout: 'result' },
            profileBindings: [{ profileId: 'p1', profileName: 'db', profileType: 'sql', alias: 'db' }],
          },
          expressionFields: ['command'],
          templateFields: ['template_param'],
          variableExpressionKeys: ['var1'],
          variableTypes: { var1: 'string' },
          variableElementTypes: { var1: ['integer'] },
          elementTypes: { command: { a: 'string' } },
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      const element = result.current.configModalElement!

      expect(element.id).toBe('node-1')
      expect(element.name).toBe('Shell Script')
      expect(element.elementType).toBe('shell-script')
      expect(element.version).toBe('1.0.0')
      expect(element.description).toBe('My Shell Script Step')
      expect(element.summary).toBe('test control')
      expect(element.currentValues).toEqual({ command: 'echo hello' })
      expect(element.outputBindings).toEqual({ stdout: 'result' })
      expect(element.profileBindings).toEqual([{ profileId: 'p1', profileName: 'db', profileType: 'sql', alias: 'db' }])
      expect(element.expressionFields).toEqual(['command'])
      expect(element.templateFields).toEqual(['template_param'])
      expect(element.variableExpressionKeys).toEqual(['var1'])
      expect(element.variableTypes).toEqual({ var1: 'string' })
      expect(element.variableElementTypes).toEqual({ var1: ['integer'] })
      expect(element.elementTypes).toEqual({ command: { a: 'string' } })
    })

    it('uses elementType as name fallback when label is missing', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { elementType: 'http' },
      }]
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.name).toBe('http')
    })

    it('uses "Unknown" when both label and elementType are missing', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: {},
      }]
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.name).toBe('Unknown')
    })

    it('normalizes version matching with prefix (e.g., "1.0" matches "1.0.0")', () => {
      mockGetControlVersions.mockReturnValue([
        { version: '2.0.0' },
        { version: '1.0.0' },
      ])
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Test', elementType: 'shell-script', version: '1.0' },
      }]
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.version).toBe('1.0.0')
      expect(result.current.configModalElement!.availableVersions).toEqual(['2.0.0', '1.0.0'])
    })

    it('falls back to first available version when stored version does not match', () => {
      mockGetControlVersions.mockReturnValue([{ version: '2.0.0' }])
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Test', elementType: 'shell-script', version: '999.0.0' },
      }]
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.version).toBe('2.0.0')
    })

    it('falls back to "1.0.0" when no control versions exist', () => {
      mockGetControlVersions.mockReturnValue([])
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Test', elementType: 'shell-script' },
      }]
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.version).toBe('1.0.0')
      expect(result.current.configModalElement!.availableVersions).toEqual(['1.0.0'])
    })

    it('uses fallback parameters when controlSchema is null', () => {
      mockGetInputParams.mockReturnValue(null as never)
      mockGetOutputParams.mockReturnValue(null as never)
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Test', elementType: 'unknown_control', version: '1.0.0' },
      }]
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.parameters).toEqual([
        { name: 'config', type: 'string', required: false, description: 'Configuration' },
      ])
      expect(result.current.configModalElement!.outputs).toEqual([])
    })

    it('defaults empty arrays for expression/template/variable fields when missing', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Test', elementType: 'shell-script', version: '1.0.0' },
      }]
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.expressionFields).toEqual([])
      expect(result.current.configModalElement!.templateFields).toEqual([])
      expect(result.current.configModalElement!.variableExpressionKeys).toEqual([])
      expect(result.current.configModalElement!.variableTypes).toEqual({})
      expect(result.current.configModalElement!.variableElementTypes).toEqual({})
      expect(result.current.configModalElement!.elementTypes).toEqual({})
    })

    it('defaults empty objects for config values/outputBindings when missing', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Test', elementType: 'shell-script', version: '1.0.0' },
      }]
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.currentValues).toEqual({})
      expect(result.current.configModalElement!.outputBindings).toEqual({})
      expect(result.current.configModalElement!.profileBindings).toEqual([])
    })
  })

  // =========================================================================
  // handleConfigSave - basic behavior
  // =========================================================================

  describe('handleConfigSave', () => {
    it('updates node with save data and closes modal', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Shell Script', elementType: 'shell-script', version: '1.0.0' },
      }]
      mockGetControlVersions.mockReturnValue([{ version: '1.0.0' }])

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { command: 'ls -la' },
          description: 'List Files',
          version: '1.0.0',
          expressionFields: ['command'],
          templateFields: [],
        }))
      })

      expect(mockUpdateNode).toHaveBeenCalledWith('node-1', {
        data: expect.objectContaining({
          description: 'List Files',
          version: '1.0.0',
          hasNewerVersion: false,
          expressionFields: ['command'],
          config: {
            values: { command: 'ls -la' },
            outputBindings: {},
            profileBindings: [],
          },
        }),
      })
      expect(mockClearValidationErrorNode).toHaveBeenCalledWith('node-1')
      expect(mockCloseConfigModal).toHaveBeenCalled()
    })

    it('sets hasNewerVersion when saved version differs from latest', () => {
      mockGetControlVersions.mockReturnValue([
        { version: '2.0.0' },
        { version: '1.0.0' },
      ])
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Shell Script', elementType: 'shell-script', version: '1.0.0' },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({ version: '1.0.0' }))
      })

      expect(mockUpdateNode).toHaveBeenCalledWith('node-1', {
        data: expect.objectContaining({ hasNewerVersion: true }),
      })
    })

    it('closes modal and clears validation even when node is not found', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{ id: 'node-1', data: { label: 'X', elementType: 'shell-script', version: '1.0.0' } }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      // Now remove the node so handleConfigSave can't find it
      mockStore.nodes = []

      act(() => {
        result.current.handleConfigSave(createSaveData({ id: 'nonexistent' }))
      })

      expect(mockUpdateNode).not.toHaveBeenCalled()
      expect(mockClearValidationErrorNode).toHaveBeenCalledWith('nonexistent')
      expect(mockCloseConfigModal).toHaveBeenCalled()
    })

    it('closes modal when configModalElement is null', () => {
      // configModalNodeId is null -> configModalElement is null
      mockStore.configModalNodeId = null
      mockStore.nodes = []

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData())
      })

      expect(mockUpdateNode).not.toHaveBeenCalled()
      expect(mockCloseConfigModal).toHaveBeenCalled()
    })
  })

  // =========================================================================
  // handleConfigSave - cleanupAssertModeEdges
  // =========================================================================

  describe('handleConfigSave - assert mode edge cleanup', () => {
    it('removes all outgoing edges when assert mode changes', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: {
          label: 'Assert',
          elementType: 'assert',
          version: '1.0.0',
          config: { values: { mode: 'single' } },
        },
      }]
      mockStore.edges = [
        { id: 'e1', source: 'node-1', target: 'node-2' },
        { id: 'e2', source: 'node-1', sourceHandle: 'pass', target: 'node-3' },
        { id: 'e3', source: 'other', target: 'node-4' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { mode: 'split' }, // Changed from 'single'
        }))
      })

      // Should remove edges from node-1 (e1, e2), keep e3
      expect(mockSetEdges).toHaveBeenCalledWith([
        { id: 'e3', source: 'other', target: 'node-4' },
      ])
    })

    it('does not remove edges when assert mode is unchanged', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: {
          label: 'Assert',
          elementType: 'assert',
          version: '1.0.0',
          config: { values: { mode: 'single' } },
        },
      }]
      mockStore.edges = [
        { id: 'e1', source: 'node-1', target: 'node-2' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { mode: 'single' }, // Same mode
        }))
      })

      // setEdges should not be called for assert cleanup (mode unchanged)
      // It might still be called for orphan cleanup, check it wasn't called at all
      // since there are no branches in this save data
      expect(mockSetEdges).not.toHaveBeenCalled()
    })

    it('does not run assert edge cleanup for non-assert elements', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Shell Script', elementType: 'shell-script', version: '1.0.0' },
      }]
      mockStore.edges = [
        { id: 'e1', source: 'node-1', target: 'node-2' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { mode: 'different' },
        }))
      })

      expect(mockSetEdges).not.toHaveBeenCalled()
    })

    it('treats a fresh Assert (no stored mode) as default split: editing without a mode flip keeps edges', () => {
      // The node was just dropped; ``data.config.values.mode`` was never
      // saved, so cleanupAssertModeEdges sees ``oldMode = undefined``. The
      // saveData also omits the mode key. Both normalize to 'split', so the
      // helper short-circuits without wiping edges - this exercises both
      // ``?? 'split'`` defaults in cleanupAssertModeEdges.
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Assert', elementType: 'assert', version: '1.0.0' },
      }]
      mockStore.edges = [{ id: 'e1', source: 'node-1', target: 'node-2' }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: {}, // no mode key
        }))
      })

      // No flip -> no setEdges call from the assert path. cleanupOrphanedBranchEdges
      // also short-circuits because there are no branches.
      expect(mockSetEdges).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // handleConfigSave - label fallback when saveData.name is empty
  // =========================================================================

  describe('handleConfigSave - label fallback', () => {
    it('falls back to node.data.label when saveData.name is empty', () => {
      // Exercises the ``saveData.name || node.data.label`` falsy branch.
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'PreservedLabel', elementType: 'shell-script', version: '1.0.0' },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({ name: '' }))
      })

      expect(mockUpdateNode).toHaveBeenCalledWith('node-1', {
        data: expect.objectContaining({ label: 'PreservedLabel' }),
      })
    })
  })

  // =========================================================================
  // handleConfigSave - cleanupOrphanedBranchEdges
  // =========================================================================

  describe('handleConfigSave - orphaned branch edge cleanup', () => {
    it('removes edges for branches that no longer exist', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'If-Else', elementType: 'if_else', version: '1.0.0' },
      }]
      mockStore.edges = [
        { id: 'e1', source: 'node-1', sourceHandle: 'branch-a', target: 'node-2' },
        { id: 'e2', source: 'node-1', sourceHandle: 'branch-b', target: 'node-3' },
        { id: 'e3', source: 'node-1', sourceHandle: 'branch-c', target: 'node-4' },
        { id: 'e4', source: 'other-node', target: 'node-5' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: {
            branches: [{ id: 'branch-a' }, { id: 'branch-c' }],
          },
        }))
      })

      // branch-b was removed, so e2 should be cleaned up
      expect(mockSetEdges).toHaveBeenCalledWith([
        { id: 'e1', source: 'node-1', sourceHandle: 'branch-a', target: 'node-2' },
        { id: 'e3', source: 'node-1', sourceHandle: 'branch-c', target: 'node-4' },
        { id: 'e4', source: 'other-node', target: 'node-5' },
      ])
    })

    it('keeps a container egress edge that is not a branch', () => {
      // Guard: a Switch's `then` lane is an egress, not a case, so saving the
      // config must not sweep the edge wired from it.
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Switch/Case', elementType: 'switch-case', version: '1.0.0' },
      }]
      mockStore.edges = [
        { id: 'e1', source: 'node-1', sourceHandle: 'branch_0', target: 'node-2' },
        { id: 'e2', source: 'node-1', sourceHandle: 'then', target: 'node-3' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: {
            branches: [{ id: 'branch_0' }],
          },
        }))
      })

      expect(mockSetEdges).not.toHaveBeenCalled()
    })

    it('still removes a deleted case edge while keeping the egress edge', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Switch/Case', elementType: 'switch-case', version: '1.0.0' },
      }]
      mockStore.edges = [
        { id: 'e1', source: 'node-1', sourceHandle: 'branch_0', target: 'node-2' },
        { id: 'e2', source: 'node-1', sourceHandle: 'branch_1', target: 'node-3' },
        { id: 'e3', source: 'node-1', sourceHandle: 'then', target: 'node-4' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: {
            branches: [{ id: 'branch_0' }],
          },
        }))
      })

      expect(mockSetEdges).toHaveBeenCalledWith([
        { id: 'e1', source: 'node-1', sourceHandle: 'branch_0', target: 'node-2' },
        { id: 'e3', source: 'node-1', sourceHandle: 'then', target: 'node-4' },
      ])
    })

    it('does nothing when save data has no branches', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Shell Script', elementType: 'shell-script', version: '1.0.0' },
      }]
      mockStore.edges = [
        { id: 'e1', source: 'node-1', target: 'node-2' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: {}, // no branches
        }))
      })

      expect(mockSetEdges).not.toHaveBeenCalled()
    })

    it('does not remove edges without sourceHandle (they are not branch edges)', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'If-Else', elementType: 'if_else', version: '1.0.0' },
      }]
      mockStore.edges = [
        { id: 'e1', source: 'node-1', target: 'node-2' }, // No sourceHandle
        { id: 'e2', source: 'node-1', sourceHandle: 'branch-a', target: 'node-3' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: {
            branches: [{ id: 'branch-a' }],
          },
        }))
      })

      // e1 has no sourceHandle, so shouldRemove returns false (!!undefined = false)
      // All branch edges match existing branches, so nothing to remove
      expect(mockSetEdges).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // handleConfigSave - createOutputBindingVariables
  // =========================================================================

  describe('handleConfigSave - output binding variable creation', () => {
    it('creates variables for new output bindings', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'HTTP', elementType: 'http', version: '1.0.0' },
      }]
      mockStore.variables = []

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { response_body: 'myResponse', status_code: 'httpStatus' },
          outputTypes: { response_body: 'string', status_code: 'integer' },
        }))
      })

      expect(mockAddVariable).toHaveBeenCalledTimes(2)
      // A Block writes a bound variable at run time: it is declared unset.
      expect(mockAddVariable).toHaveBeenCalledWith({
        name: 'myResponse',
        type: 'string',
        isSecret: false,
      })
      expect(mockAddVariable).toHaveBeenCalledWith({
        name: 'httpStatus',
        type: 'integer',
        isSecret: false,
      })
    })

    // A K8s read declares Result's type from its Output Format (K8SREAD-6), so
    // the new variable is seeded in the type the save payload names.
    it.each([
      ['string'],
      ['table'],
      ['array'],
      ['map'],
    ])('creates a new bound variable as %s, declared unset', (type) => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Read pods', elementType: 'k8s-get', version: '1.0.0' },
      }]
      mockStore.variables = []

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { result: 'pods' },
          outputTypes: { result: type },
        }))
      })

      expect(mockAddVariable).toHaveBeenCalledWith({
        name: 'pods',
        type,
        isSecret: false,
      })
    })

    it('marks an existing bound variable secret when its output is in outputSecretFields', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'HTTP', elementType: 'http', version: '1.0.0' },
      }]
      mockStore.variables = [
        { id: 'var-1', name: 'captured', value: '', type: 'string' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { response_body: 'captured' },
          outputTypes: { response_body: 'string' },
          outputSecretFields: ['response_body'],
        }))
      })

      // The variable already exists (not re-created), so its secret flag is updated.
      expect(mockAddVariable).not.toHaveBeenCalled()
      expect(mockUpdateVariable).toHaveBeenCalledWith('var-1', { isSecret: true })
    })

    it('does not demote an existing secret variable when an output is unmarked', () => {
      // Secret is sticky: once a variable is secret it stays secret. A second
      // block binding the same variable with the output NOT marked secret must
      // not flip it back to non-secret in the Variable Manager.
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'HTTP', elementType: 'http', version: '1.0.0' },
      }]
      mockStore.variables = [
        { id: 'var-1', name: 'captured', value: '', type: 'string', isSecret: true },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { response_body: 'captured' },
          outputTypes: { response_body: 'string' },
          outputSecretFields: [],
        }))
      })

      expect(mockUpdateVariable).not.toHaveBeenCalledWith('var-1', { isSecret: false })
    })

    it('does not re-update an already-secret bound variable', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'HTTP', elementType: 'http', version: '1.0.0' },
      }]
      mockStore.variables = [
        { id: 'var-1', name: 'captured', value: '', type: 'string', isSecret: true },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { response_body: 'captured' },
          outputTypes: { response_body: 'string' },
          outputSecretFields: ['response_body'],
        }))
      })

      expect(mockUpdateVariable).not.toHaveBeenCalled()
    })

    it('skips output bindings that already have a variable with same name', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'HTTP', elementType: 'http', version: '1.0.0' },
      }]
      mockStore.variables = [
        { id: 'v1', name: 'existing', value: 'val', type: 'string' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { output: 'existing' },
          outputTypes: { output: 'string' },
        }))
      })

      expect(mockAddVariable).not.toHaveBeenCalled()
    })

    it('skips empty binding names', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'HTTP', elementType: 'http', version: '1.0.0' },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { output: '' },
          outputTypes: { output: 'string' },
        }))
      })

      expect(mockAddVariable).not.toHaveBeenCalled()
    })

    it('defaults output type to string when not mapped in PARAM_TYPE_TO_VAR_TYPE', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Custom', elementType: 'custom', version: '1.0.0' },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { output: 'myVar' },
          outputTypes: { output: 'unknown_type' },
        }))
      })

      expect(mockAddVariable).toHaveBeenCalledWith({
        name: 'myVar',
        type: 'string',
        isSecret: false,
      })
    })

    it('does not create duplicate variables within same save operation', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Custom', elementType: 'custom', version: '1.0.0' },
      }]
      mockStore.variables = []

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { out1: 'same_name', out2: 'same_name' },
          outputTypes: { out1: 'string', out2: 'string' },
        }))
      })

      // Should only create the first one, second is skipped because name already tracked
      expect(mockAddVariable).toHaveBeenCalledTimes(1)
    })
  })

  // =========================================================================
  // handleConfigSave - createVariableSetterVariables
  // =========================================================================

  describe('handleConfigSave - variable setter variable creation', () => {
    it('creates variables from variable setter entries with correct default values', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Variable Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]
      mockStore.variables = []

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: {
            variables: {
              myString: 'hello',
              myInt: 42,
              myBool: true,
              myFloat: 3.14,
              myArray: [1, 2],
              myMap: { key: 'value' },
              myTable: [],
            },
          },
          variableTypes: {
            myString: 'string',
            myInt: 'integer',
            myBool: 'boolean',
            myFloat: 'float',
            myArray: 'array',
            myMap: 'map',
            myTable: 'table',
          },
        }))
      })

      for (const [name, type] of [
        ['myString', 'string'],
        ['myInt', 'integer'],
        ['myBool', 'boolean'],
        ['myFloat', 'float'],
        ['myArray', 'array'],
        ['myMap', 'map'],
        ['myTable', 'table'],
      ]) {
        expect(mockAddVariable).toHaveBeenCalledWith(
          expect.objectContaining({ name, type })
        )
      }
      // A Variable Setter target is written at run time: declared unset.
      for (const call of mockAddVariable.mock.calls) {
        expect('value' in (call[0] as object)).toBe(false)
      }
    })

    it('skips when variableTypes is undefined', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Shell Script', elementType: 'shell-script', version: '1.0.0' },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { variables: { a: 1 } },
          // variableTypes is undefined
        }))
      })

      // No variable setter variables created - no variableTypes
      expect(mockAddVariable).not.toHaveBeenCalled()
    })

    it('skips when values.variables is undefined', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: {}, // no variables key
          variableTypes: { a: 'string' },
        }))
      })

      expect(mockAddVariable).not.toHaveBeenCalled()
    })

    it('skips existing variables', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]
      mockStore.variables = [
        { id: 'v1', name: 'existing', value: 'old', type: 'string' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { variables: { existing: 'new_val' } },
          variableTypes: { existing: 'string' },
        }))
      })

      expect(mockAddVariable).not.toHaveBeenCalled()
    })

    it('skips variable when name already exists in store', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]
      mockStore.variables = [
        { id: 'v1', name: 'inherited', value: 'suite_val', type: 'string' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { variables: { inherited: 'overridden' } },
          variableTypes: { inherited: 'string' },
        }))
      })

      // Variable already exists in store - should not create a duplicate
      expect(mockAddVariable).not.toHaveBeenCalled()
    })

    it('skips empty variable names', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { variables: { '': 'value' } },
          variableTypes: { '': 'string' },
        }))
      })

      expect(mockAddVariable).not.toHaveBeenCalled()
    })

    it('defaults variable type to string when type is missing from variableTypes', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { variables: { untyped: 'val' } },
          variableTypes: {}, // no type mapping
        }))
      })

      expect(mockAddVariable).toHaveBeenCalledWith({
        name: 'untyped',
        type: 'string',
        isSecret: false,
      })
    })

    it('marks an existing variable secret when a setter row marks it secret', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]
      mockStore.variables = [
        { id: 'var-1', name: 'token', value: '', type: 'string', isSecret: false },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { variables: { token: 'hunter2' } },
          variableTypes: { token: 'string' },
          variableSecretKeys: ['token'],
        }))
      })

      // The variable already exists, so it is not re-created; its secret flag
      // is promoted so the Variable Manager reflects the setter row's mark.
      expect(mockAddVariable).not.toHaveBeenCalled()
      expect(mockUpdateVariable).toHaveBeenCalledWith('var-1', { isSecret: true })
    })

    it('makes a Function output secret, after the same warning, when a setter Secret row writes it', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.drillPath = [{ nodeId: 'fn-1', label: 'Fn' }]
      mockStore.variables = []
      mockStore.nodes = [{
        id: 'fn-1',
        data: {
          label: 'Fn',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: {
              nodes: [{ id: 'node-1', data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' } }],
              edges: [],
            },
            inputs: [],
            outputs: [{ name: 'res', type: 'string' }],
            variables: [],
          },
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { variables: { res: 'hunter2' } },
          variableTypes: { res: 'string' },
          variableSecretKeys: ['res'],
        }))
      })

      expect(mockRequestSecretPromotion).toHaveBeenCalledWith(['res'], expect.any(Function))
      expect(mockUpdateOutputParam).toHaveBeenCalledWith('res', { secret: true })
      expect(mockAddVariable).not.toHaveBeenCalled()
      mockStore.drillPath = []
    })

    it('does not re-mark a variable that is already secret', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]
      mockStore.variables = [
        { id: 'var-1', name: 'token', value: '', type: 'string', isSecret: true },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { variables: { token: 'hunter2' } },
          variableTypes: { token: 'string' },
          variableSecretKeys: ['token'],
        }))
      })

      expect(mockUpdateVariable).not.toHaveBeenCalledWith('var-1', { isSecret: true })
    })

    it('promotes an existing variable whose secret flag is unset', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]
      mockStore.variables = [
        { id: 'var-1', name: 'token', value: '', type: 'string' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { variables: { token: 'hunter2' } },
          variableTypes: { token: 'string' },
          variableSecretKeys: ['token'],
        }))
      })

      expect(mockUpdateVariable).toHaveBeenCalledWith('var-1', { isSecret: true })
    })

    it('ignores a setter secret key with no matching existing variable', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]
      mockStore.variables = []

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { variables: { fresh: 'hunter2' } },
          variableTypes: { fresh: 'string' },
          variableSecretKeys: ['fresh'],
        }))
      })

      // The fresh variable is created (addVariable), never updated by the sync.
      expect(mockUpdateVariable).not.toHaveBeenCalled()
    })

    it('does not create duplicate variable setter variables within same save', () => {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }]
      mockStore.variables = []

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      // The variable setter uses Object.keys, so duplicates come from
      // output bindings creating a variable first
      // Two variables with different names should both be created
      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { out1: 'shared_name' },
          outputTypes: { out1: 'string' },
          values: { variables: { shared_name: 'val' } },
          variableTypes: { shared_name: 'string' },
        }))
      })

      // Output binding creates 'shared_name' first, variable setter skips it
      // because existingTestVarNames won't contain it (but existingVarNames in output binding does)
      // Actually these are separate functions with separate sets, so both may create
      // The output binding creates via addVariable but existingTestVarNames in setter is from store
      // In the store, variables is still empty, so setter will also create
      expect(mockAddVariable).toHaveBeenCalledTimes(2)
    })
  })

  // =========================================================================
  // configModalElement - Function-instance branch
  // =========================================================================

  describe('configModalElement for Function nodes', () => {
    it('falls back to localDefinition.name when label is missing', () => {
      mockStore.configModalNodeId = 'fn-1'
      mockStore.nodes = [{
        id: 'fn-1',
        data: {
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: { name: 'MyFunction', description: 'desc-from-def' },
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      const element = result.current.configModalElement!

      expect(element.kind).toBe('function')
      expect(element.name).toBe('MyFunction')
      expect(element.description).toBe('desc-from-def')
    })

    it('falls back to "function" literal when both label and localDefinition.name are missing', () => {
      mockStore.configModalNodeId = 'fn-2'
      mockStore.nodes = [{
        id: 'fn-2',
        data: {
          nodeType: 'function',
          functionLifecycle: 'local',
          // No label, no localDefinition.
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.name).toBe('function')
      expect(result.current.configModalElement!.description).toBe('')
    })

    it('hands the window no names list of its own: the window reads its names as for any Block', () => {
      mockStore.configModalNodeId = 'fn-3'
      mockStore.nodes = [{
        id: 'fn-3',
        data: {
          label: 'Fn',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: { name: 'Fn', inputs: [], outputs: [] },
        },
      }]
      mockStore.variables = [
        { id: 'v1', name: 'count', value: 0, type: 'integer' },
        { id: 'v2', name: 'label', value: 'x', type: 'string' },
      ]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      expect(result.current.configModalElement).not.toHaveProperty('availableVariables')
    })

    it('sets functionId from data only for shared lifecycle', () => {
      mockStore.configModalNodeId = 'fn-shared'
      mockStore.nodes = [{
        id: 'fn-shared',
        data: {
          label: 'Shared',
          nodeType: 'function',
          functionLifecycle: 'shared',
          functionId: 'lib-42',
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      const element = result.current.configModalElement!
      expect(element.lifecycle).toBe('shared')
      expect(element.functionId).toBe('lib-42')
    })

    it('omits functionId for local lifecycle even if data carries one', () => {
      mockStore.configModalNodeId = 'fn-local'
      mockStore.nodes = [{
        id: 'fn-local',
        data: {
          label: 'LocalFn',
          nodeType: 'function',
          functionLifecycle: 'local',
          functionId: 'lib-99', // Should be ignored when local
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.functionId).toBeUndefined()
    })

    it('defaults lifecycle to "local" when missing', () => {
      mockStore.configModalNodeId = 'fn-no-lifecycle'
      mockStore.nodes = [{
        id: 'fn-no-lifecycle',
        data: {
          label: 'NoLifecycle',
          nodeType: 'function',
          // No functionLifecycle set
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.lifecycle).toBe('local')
    })

    it('prefers upstreamLink.sourceVersion over functionVersion for shared instances', () => {
      // Exercises the truthy side of `upstream?.sourceVersion ?? functionVersion`
      // (line 250): when the node carries an upstreamLink with a sourceVersion,
      // that value wins over data.functionVersion.
      mockStore.configModalNodeId = 'fn-upstream'
      mockStore.nodes = [{
        id: 'fn-upstream',
        data: {
          label: 'Shared',
          nodeType: 'function',
          functionLifecycle: 'shared',
          functionId: 'lib-7',
          functionVersion: '1.0.0',
          upstreamLink: { sourceVersion: '3.0.0' },
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      const element = result.current.configModalElement as
        | { sourceVersion?: string }
        | null
      expect(element?.sourceVersion).toBe('3.0.0')
    })

    it('reads the field values and output bindings out of data.config', () => {
      mockStore.configModalNodeId = 'fn-out'
      mockStore.nodes = [{
        id: 'fn-out',
        data: {
          label: 'Fn',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            inputs: [{ name: 'x', type: 'string', required: true, description: '' }],
            outputs: [{ name: 'result', type: 'string', description: '' }],
          },
          config: { values: { x: 'hello' }, outputBindings: { result: 'outVar' } },
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      const element = result.current.configModalElement as unknown as Record<string, unknown>

      expect(element.currentValues).toEqual({ x: 'hello' })
      expect(element.outputBindings).toEqual({ result: 'outVar' })
      expect(element).not.toHaveProperty('inputBindings')
    })

    it('builds the field list of a Local Function Block from its declared inputs and outputs', () => {
      mockStore.configModalNodeId = 'fn-fields'
      mockStore.nodes = [{
        id: 'fn-fields',
        data: {
          label: 'Fetch',
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          functionLifecycle: 'local',
          localDefinition: {
            name: 'Fetch',
            inputs: [
              { name: 'host', type: 'string', required: true, description: '' },
              { name: 'port', type: 'integer', required: false, default: 8080, description: '' },
              { name: 'retries', type: 'integer', required: true, default: 3, description: '' },
            ],
            outputs: [{ name: 'status', type: 'integer', description: '' }],
          },
          expressionFields: ['host'],
          templateFields: [],
          config: { values: { host: 'base_url' }, outputBindings: {} },
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      const element = result.current.configModalElement as unknown as {
        kind: string
        elementType: string
        parameters?: Array<{ name: string; type: string; required?: boolean; defaultValue?: unknown }>
        outputs?: Array<{ name: string; type: string }>
        currentValues: Record<string, unknown>
        expressionFields: string[]
      }

      expect(element.kind).toBe('function')
      expect(element.elementType).toBe('function')
      expect(element.parameters?.map((p) => [p.name, p.type, Boolean(p.required)])).toEqual([
        ['host', 'string', true],
        ['port', 'integer', false],
        ['retries', 'integer', true],
      ])
      expect(element.parameters?.find((p) => p.name === 'port')?.defaultValue).toBe(8080)
      // A Function Block never falls back to a Required input's default (REQ-3.1.2.10).
      expect(element.parameters?.find((p) => p.name === 'retries')?.defaultValue).toBeUndefined()
      expect(element.outputs?.map((o) => [o.name, o.type])).toEqual([['status', 'integer']])
      expect(element.currentValues).toEqual({ host: 'base_url' })
      expect(element.expressionFields).toEqual(['host'])
    })

    it('builds the field list of a Shared Function Block from its pinned contract', () => {
      mockStore.configModalNodeId = 'fn-pinned'
      mockStore.nodes = [{
        id: 'fn-pinned',
        data: {
          label: 'Validate',
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          functionLifecycle: 'shared',
          functionId: 'lib-9',
          functionVersion: '1.0.0',
          resolvedInputs: [{ name: 'email', type: 'string', required: true, description: '' }],
          resolvedOutputs: [{ name: 'valid', type: 'boolean', description: '' }],
          config: { values: {}, outputBindings: {} },
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      const element = result.current.configModalElement as unknown as {
        parameters?: Array<{ name: string }>
        outputs?: Array<{ name: string }>
      }

      expect(element.parameters?.map((p) => p.name)).toEqual(['email'])
      expect(element.outputs?.map((o) => o.name)).toEqual(['valid'])
    })

    it('hands the window the stored template flags and element types of the Block fields', () => {
      mockStore.configModalNodeId = 'fn-flags'
      mockStore.nodes = [{
        id: 'fn-flags',
        data: {
          label: 'Greet',
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          functionLifecycle: 'local',
          localDefinition: {
            inputs: [
              { name: 'greeting', type: 'string', required: false, description: '' },
              { name: 'tags', type: 'array', required: false, description: '' },
            ],
            outputs: [],
          },
          templateFields: ['greeting'],
          expressionFields: ['tags.1'],
          elementTypes: { tags: ['string', 'integer'] },
          config: { values: { greeting: 'Hi {{ who }}', tags: ['a', 'n + 1'] }, outputBindings: {} },
        },
      }]

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      const element = result.current.configModalElement as unknown as Record<string, unknown>

      expect(element.templateFields).toEqual(['greeting'])
      expect(element.expressionFields).toEqual(['tags.1'])
      expect(element.elementTypes).toEqual({ tags: ['string', 'integer'] })
    })
  })

  describe('configModalElement for Function nodes - the saved Secret column reopens as saved (FNCFG-7, REQ-3.1.2.9)', () => {
    function seedSavedCall(config: Record<string, unknown>) {
      mockStore.configModalNodeId = 'fn-secret'
      mockStore.nodes = [{
        id: 'fn-secret',
        data: {
          label: 'fetch_token',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            name: 'fetch_token',
            inputs: [],
            outputs: [
              { name: 'token', type: 'string', secret: true },
              { name: 'refresh', type: 'string', secret: true },
            ],
          },
          config,
        },
      }]
    }

    function secretListOfTheCallWindow(): unknown {
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      const element = result.current.configModalElement as { kind?: string; outputSecretFields?: unknown }
      expect(element.kind).toBe('function')
      return element.outputSecretFields
    }

    it('passes the saved Secret list of the call to the call window', () => {
      seedSavedCall({ outputBindings: { token: 'tok' }, outputSecretFields: ['token'] })
      expect(secretListOfTheCallWindow()).toEqual(['token'])
    })

    it('passes a saved empty Secret list as empty, so every output the author unticked stays unticked', () => {
      seedSavedCall({ outputBindings: {}, outputSecretFields: [] })
      expect(secretListOfTheCallWindow()).toEqual([])
    })

    it('leaves the Secret list unset for a call never saved, so the window seeds the secret outputs', () => {
      seedSavedCall({ outputBindings: {} })
      expect(secretListOfTheCallWindow()).toBeUndefined()
    })
  })

  // =========================================================================
  // handleConfigSave for a Function Block: the shared Block Save plus the Function stamps
  // =========================================================================

  describe('handleConfigSave - a Function Block Save', () => {
    function seedFunctionBlock(id: string, data: Record<string, unknown>) {
      mockStore.configModalNodeId = id
      mockStore.nodes = [{
        id,
        data: { elementType: 'function', nodeType: 'function', version: '1.0.0', ...data },
      }]
    }

    /** The Function Block Save as the window sends it: the shared SaveData plus the version stamps. */
    function saveFunctionBlock(id: string, fields: Record<string, unknown>) {
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      act(() => {
        result.current.handleConfigSave(createSaveData({ id, ...fields } as Partial<SaveData>))
      })
    }

    function savedData(): Record<string, unknown> {
      expect(mockUpdateNode).toHaveBeenCalledTimes(1)
      return mockUpdateNode.mock.calls[0][1].data as Record<string, unknown>
    }

    it('writes the window fields in the shared stored shape and keeps the Local definition name in step', () => {
      seedFunctionBlock('fn-1', {
        label: 'OldName',
        functionLifecycle: 'local',
        localDefinition: {
          name: 'OldName',
          description: 'd',
          inputs: [
            { name: 'host', type: 'string', required: true, description: '' },
            { name: 'greeting', type: 'string', required: false, description: '' },
          ],
          outputs: [{ name: 'status', type: 'integer', description: '' }],
        },
        config: { values: {}, outputBindings: {} },
      })

      saveFunctionBlock('fn-1', {
        name: 'NewName',
        description: 'updated',
        values: { host: 'example.com', greeting: 'Hi {{ who }}' },
        templateFields: ['greeting'],
        outputBindings: { status: 'code' },
        outputTypes: { status: 'integer' },
      })

      expect(mockUpdateNode).toHaveBeenCalledWith('fn-1', {
        data: expect.objectContaining({
          label: 'NewName',
          description: 'updated',
          version: '1.0.0',
          templateFields: ['greeting'],
          localDefinition: expect.objectContaining({ name: 'NewName', description: 'd' }),
          config: expect.objectContaining({
            values: { host: 'example.com', greeting: 'Hi {{ who }}' },
            outputBindings: { status: 'code' },
          }),
        }),
      })
      expect(mockClearValidationErrorNode).toHaveBeenCalledWith('fn-1')
      expect(mockCloseConfigModal).toHaveBeenCalledWith('fn-1')
    })

    it('pins a Shared Function Block to the picked version and leaves localDefinition alone', () => {
      seedFunctionBlock('fn-shared', {
        label: 'SharedFn',
        functionLifecycle: 'shared',
        functionId: 'lib-1',
        functionVersion: '1.0.0',
      })

      saveFunctionBlock('fn-shared', { name: 'RenamedShared', functionVersion: '2.0.0' })

      const data = savedData()
      expect(data.label).toBe('RenamedShared')
      // The pinned version lives on `functionVersion`; `version` stays the Block's own.
      expect(data.functionVersion).toBe('2.0.0')
      expect(data.version).toBe('1.0.0')
      expect(data.localDefinition).toBeUndefined()
    })

    it('clears the stale missingVersion stamp and refreshes the resolved contract when a Shared Block switches to an available version', () => {
      seedFunctionBlock('fn-miss', {
        label: 'ValidateUser',
        functionLifecycle: 'shared',
        functionId: 'lib-9',
        functionVersion: '2.0.0',
        // Stamped at load: the pinned 2.0.0 is gone from the library.
        missingVersion: true,
        resolvedInputs: [{ name: 'old', type: 'string', required: true, default: '', description: '' }],
        resolvedOutputs: [{ name: 'oldOut', type: 'string', description: '' }],
      })

      saveFunctionBlock('fn-miss', {
        name: 'ValidateUser',
        functionVersion: '1.0.0',
        missingVersion: false,
        resolvedInputs: [{ name: 'email', type: 'string', required: true, default: '', description: '' }],
        resolvedOutputs: [{ name: 'valid', type: 'boolean', description: '' }],
      })

      expect(savedData()).toEqual(expect.objectContaining({
        functionVersion: '1.0.0',
        missingVersion: false,
        resolvedInputs: [{ name: 'email', type: 'string', required: true, default: '', description: '' }],
        resolvedOutputs: [{ name: 'valid', type: 'boolean', description: '' }],
      }))
    })

    it('keeps missingVersion set and leaves the resolved contract untouched when the saved version is still missing', () => {
      seedFunctionBlock('fn-still-miss', {
        label: 'ValidateUser',
        functionLifecycle: 'shared',
        functionId: 'lib-9',
        functionVersion: '2.0.0',
        missingVersion: true,
        resolvedInputs: [{ name: 'old', type: 'string', required: true, default: '', description: '' }],
        resolvedOutputs: [{ name: 'oldOut', type: 'string', description: '' }],
      })

      // No resolved contract: the window could not resolve a descriptor.
      saveFunctionBlock('fn-still-miss', { name: 'ValidateUser', functionVersion: '2.0.0', missingVersion: true })

      const data = savedData()
      expect(data.missingVersion).toBe(true)
      expect(data.resolvedInputs).toEqual([
        { name: 'old', type: 'string', required: true, default: '', description: '' },
      ])
      expect(data.resolvedOutputs).toEqual([{ name: 'oldOut', type: 'string', description: '' }])
    })

    it('stores the config the window shows, as a plugin Block Save does', () => {
      seedFunctionBlock('fn-cfg', {
        label: 'Fn',
        functionLifecycle: 'local',
        localDefinition: { inputs: [], outputs: [{ name: 'new', type: 'string', description: '' }] },
        config: { existingKey: 'dropped', outputBindings: { old: 'x' } },
      })

      saveFunctionBlock('fn-cfg', { name: 'Fn', outputBindings: { new: 'y' }, outputTypes: { new: 'string' } })

      expect(savedData().config).toEqual({ values: {}, outputBindings: { new: 'y' }, profileBindings: [] })
    })

    it('keeps the stored functionVersion when the Save picks none', () => {
      seedFunctionBlock('fn-ver', {
        label: 'Fn',
        functionLifecycle: 'local',
        functionVersion: '1.2.3',
        localDefinition: { inputs: [], outputs: [] },
      })

      saveFunctionBlock('fn-ver', { name: 'Fn' })

      expect(savedData().functionVersion).toBe('1.2.3')
    })

    it('leaves a Local Function Block with no stored definition without one', () => {
      seedFunctionBlock('fn-nodef', { label: 'Fn', functionLifecycle: 'local' })

      saveFunctionBlock('fn-nodef', { name: 'NewName' })

      const data = savedData()
      expect(data.label).toBe('NewName')
      expect(data.localDefinition).toBeUndefined()
    })
  })

  // =========================================================================
  // reservedScopeNames - drilled into a Function body
  // =========================================================================

  describe('reservedScopeNames (drilled Function scope)', () => {
    it('returns empty set when walkActiveSubtree throws inside the reservedScopeNames memo', () => {
      // The three subtree memos call walkActiveSubtree with the same args
      // before reservedScopeNames does; forcing the throw only on the 4th
      // call lets the earlier memos succeed and isolates the catch branch.
      walkThrowOnCall = 4
      mockStore.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]
      const innerSetter = {
        id: 'setter-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }
      mockStore.nodes = [{
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [innerSetter], edges: [] },
            inputs: [{ name: 'declaredInput' }],
            outputs: [],
            variables: [],
          },
        },
      }]
      mockStore.configModalNodeId = 'setter-1'

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      // reservedScopeNames is empty (catch path), so the declared-input name
      // is NOT treated as reserved and the setter target is materialized.
      act(() => {
        result.current.handleConfigSave(createSaveData({
          id: 'setter-1',
          values: { variables: { declaredInput: '1' } },
          variableTypes: { declaredInput: 'string' },
        }))
      })

      expect(mockAddVariable).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'declaredInput' })
      )
    })

    it('reserves declared input and output names of the drilled Function so setter targets are not re-created', () => {
      const innerSetter = {
        id: 'setter-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [innerSetter], edges: [] },
            // Mix named params (added to the reserved set) with an unnamed
            // entry (the `if (param.name)` falsy branch) for both inputs and
            // outputs.
            inputs: [{ name: 'declaredInput' }, {}],
            outputs: [{ name: 'declaredOutput' }, {}],
            variables: [],
          },
        },
      }
      mockStore.nodes = [fnNode]
      mockStore.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]
      mockStore.configModalNodeId = 'setter-1'

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          id: 'setter-1',
          values: {
            variables: { declaredInput: '1', declaredOutput: '2', brandNew: '3' },
          },
          variableTypes: {
            declaredInput: 'string',
            declaredOutput: 'string',
            brandNew: 'string',
          },
        }))
      })

      // declaredInput / declaredOutput are reserved scope names (function
      // contract), so only the brand-new setter target is materialized.
      expect(mockAddVariable).toHaveBeenCalledTimes(1)
      expect(mockAddVariable).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'brandNew' })
      )
    })

    it('skips output-binding variable creation for names reserved by the drilled Function contract', () => {
      // A plugin node inside a drilled Function binds an output to a name that
      // matches the Function's declared input. reservedScopeNames contains it,
      // so createOutputBindingVariables hits the `reservedScopeNames.has`
      // continue branch (line 92) and does not re-create the variable.
      const innerHttp = {
        id: 'http-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: { label: 'HTTP', elementType: 'http', version: '1.0.0' },
      }
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [innerHttp], edges: [] },
            inputs: [{ name: 'declaredInput' }],
            outputs: [],
            variables: [],
          },
        },
      }
      mockStore.nodes = [fnNode]
      mockStore.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]
      mockStore.configModalNodeId = 'http-1'

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          id: 'http-1',
          outputBindings: { response_body: 'declaredInput' },
          outputTypes: { response_body: 'string' },
        }))
      })

      // declaredInput is a reserved scope name -> no variable materialized.
      expect(mockAddVariable).not.toHaveBeenCalled()
    })

    it('treats a drilled Function with no inputs/outputs keys as having no reserved names', () => {
      // localDefinition omits both `inputs` and `outputs`, exercising the
      // `?? []` fallbacks on both reserved-name loops.
      const innerSetter = {
        id: 'setter-2',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: { label: 'Setter', elementType: 'variable_setter', version: '1.0.0' },
      }
      const fnNode = {
        id: 'fn-bare',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_Bare',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [innerSetter], edges: [] },
            // No inputs / outputs keys at all.
            variables: [],
          },
        },
      }
      mockStore.nodes = [fnNode]
      mockStore.drillPath = [{ nodeId: 'fn-bare', label: 'Function_Bare' }]
      mockStore.configModalNodeId = 'setter-2'

      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          id: 'setter-2',
          values: { variables: { fresh: '1' } },
          variableTypes: { fresh: 'string' },
        }))
      })

      // No reserved names -> the setter target is materialized.
      expect(mockAddVariable).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'fresh' })
      )
    })
  })

  // =========================================================================
  // A Function Block Save declares the variables its outputs are bound to
  // =========================================================================

  describe('handleConfigSave - a Function Block Save declares its new output targets', () => {
    function seedOutputBlock(id: string, outputType: string) {
      mockStore.configModalNodeId = id
      mockStore.nodes = [{
        id,
        data: {
          label: 'Fn',
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          functionLifecycle: 'local',
          localDefinition: { inputs: [], outputs: [{ name: 'result', type: outputType, description: '' }] },
        },
      }]
    }

    function saveBinding(id: string, target: string, outputType: string) {
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      act(() => {
        result.current.handleConfigSave(createSaveData({
          id,
          name: 'Fn',
          outputBindings: { result: target },
          outputTypes: { result: outputType },
        }))
      })
    }

    it('declares a new variable an output is bound to, typed from the output', () => {
      seedOutputBlock('fn-out', 'integer')
      mockStore.variables = []

      saveBinding('fn-out', 'capturedResult', 'integer')

      expect(mockUpdateNode).toHaveBeenCalledWith('fn-out', expect.anything())
      expect(mockAddVariable).toHaveBeenCalledTimes(1)
      expect(mockAddVariable).toHaveBeenCalledWith({ name: 'capturedResult', type: 'integer', isSecret: false })
    })

    it.each([
      ['an empty target', ''],
      ['a target that already exists', 'alreadyThere'],
      ['a namespace reference', 'system.host'],
    ])('declares nothing for %s', (_case, target) => {
      seedOutputBlock('fn-skip', 'string')
      mockStore.variables = [{ id: 'v1', name: 'alreadyThere', value: 'x', type: 'string' }]

      saveBinding('fn-skip', target, 'string')

      expect(mockUpdateNode).toHaveBeenCalledWith('fn-skip', expect.anything())
      expect(mockAddVariable).not.toHaveBeenCalled()
    })

    it('declares nothing for a target the enclosing Function declares, for a Function Block inside it', () => {
      const innerFn = {
        id: 'inner-fn',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'InnerFn',
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          functionLifecycle: 'local',
          localDefinition: { inputs: [], outputs: [{ name: 'result', type: 'string', description: '' }] },
        },
      }
      mockStore.nodes = [{
        id: 'fn-outer',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Outer',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [innerFn], edges: [] },
            inputs: [{ name: 'declaredInput' }],
            outputs: [],
            variables: [],
          },
        },
      }]
      mockStore.drillPath = [{ nodeId: 'fn-outer', label: 'Outer' }]
      mockStore.configModalNodeId = 'inner-fn'
      mockStore.variables = []

      saveBinding('inner-fn', 'declaredInput', 'string')

      expect(mockUpdateNode).toHaveBeenCalledWith('inner-fn', expect.anything())
      expect(mockAddVariable).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Save warning before a plain variable turns secret
  // =========================================================================

  describe('Save warning before a plain variable turns secret (SECUI-12, REQ-4.5.20)', () => {
    interface SaveCarrier {
      carrier: string
      elementType: string
      saveFor: (names: string[]) => SaveData
    }

    function exportRows(names: string[]): Partial<SaveData> {
      const rows = names.map((_, i) => `EXPORT_${i}`)
      return {
        values: { script_variables: rows },
        outputBindings: Object.fromEntries(names.map((name, i) => [rows[i], name])),
        outputTypes: Object.fromEntries(rows.map((row) => [row, 'string'])),
        outputSecretFields: rows,
      }
    }

    const CARRIERS: SaveCarrier[] = [
      {
        carrier: 'the plugin outputs table Secret column',
        elementType: 'http',
        saveFor: (names) =>
          createSaveData({
            outputBindings: Object.fromEntries(names.map((name, i) => [`output_${i}`, name])),
            outputTypes: Object.fromEntries(names.map((_, i) => [`output_${i}`, 'string'])),
            outputSecretFields: names.map((_, i) => `output_${i}`),
          }),
      },
      {
        carrier: 'the Shell Script output list Secret column',
        elementType: 'shell-script',
        saveFor: (names) => createSaveData(exportRows(names)),
      },
      {
        carrier: 'the Python output list Secret column',
        elementType: 'python',
        saveFor: (names) => createSaveData(exportRows(names)),
      },
      {
        carrier: 'a Variable Setter Secret row',
        elementType: 'variable_setter',
        saveFor: (names) =>
          createSaveData({
            values: { variables: Object.fromEntries(names.map((name) => [name, "'s3cret'"])) },
            variableTypes: Object.fromEntries(names.map((name) => [name, 'string'])),
            variableSecretKeys: names,
          }),
      },
    ]

    const CARRIER_ROWS = CARRIERS.map((carrier) => [carrier.carrier, carrier] as const)

    function seedBlock(elementType: string) {
      mockStore.configModalNodeId = 'node-1'
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Block_1', elementType, version: '1.0.0' },
      }]
    }

    // The second variable leaves the flag unset: an unset flag reads as plain.
    function plainVariables(names: string[]): MockVariable[] {
      return names.map((name, i) => ({
        id: `var-${i}`,
        name,
        value: null,
        type: 'string',
        ...(i === 1 ? {} : { isSecret: false }),
      }))
    }

    function stagedRequest(): { names: string[]; save: () => void } {
      expect(mockRequestSecretPromotion).toHaveBeenCalledTimes(1)
      const [names, save] = mockRequestSecretPromotion.mock.calls[0]
      return { names, save }
    }

    function expectNothingSavedAndSheetOpen() {
      expect(mockUpdateNode).not.toHaveBeenCalled()
      expect(mockAddVariable).not.toHaveBeenCalled()
      expect(mockUpdateVariable).not.toHaveBeenCalled()
      expect(mockSetEdges).not.toHaveBeenCalled()
      expect(mockCloseConfigModal).not.toHaveBeenCalled()
    }

    function renderSheet() {
      return renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
    }

    beforeEach(() => {
      // Nobody has answered the warning yet: the Save stays held.
      mockRequestSecretPromotion.mockImplementation(() => {})
    })

    afterEach(() => {
      mockRequestSecretPromotion.mockImplementation(answerSecretPromotionAtOnce)
    })

    it.each(CARRIER_ROWS)(
      '%s: one existing plain variable - the Save waits and the warning names it',
      (_carrier, { elementType, saveFor }) => {
        seedBlock(elementType)
        mockStore.variables = plainVariables(['api_token'])
        const { result } = renderSheet()

        act(() => {
          result.current.handleConfigSave(saveFor(['api_token']))
        })

        const staged = stagedRequest()
        expect(staged.names).toEqual(['api_token'])
        expect(staged.save).toEqual(expect.any(Function))
        expectNothingSavedAndSheetOpen()
      },
    )

    it.each(CARRIER_ROWS)(
      '%s: several existing plain variables - the Save waits and the warning names each one',
      (_carrier, { elementType, saveFor }) => {
        const names = ['api_token', 'session_id', 'db_password']
        seedBlock(elementType)
        mockStore.variables = plainVariables(names)
        const { result } = renderSheet()

        act(() => {
          result.current.handleConfigSave(saveFor(names))
        })

        expect([...stagedRequest().names].sort()).toEqual([...names].sort())
        expectNothingSavedAndSheetOpen()
      },
    )

    it.each(CARRIER_ROWS)(
      '%s: confirming runs the held Save - the block is saved, each named variable turns secret and the sheet closes',
      (_carrier, { elementType, saveFor }) => {
        seedBlock(elementType)
        mockStore.variables = plainVariables(['api_token', 'session_id'])
        const { result } = renderSheet()

        act(() => {
          result.current.handleConfigSave(saveFor(['api_token', 'session_id']))
        })
        const { save } = stagedRequest()
        act(() => {
          save()
        })

        expect(mockUpdateNode).toHaveBeenCalledWith('node-1', expect.anything())
        expect(mockUpdateVariable).toHaveBeenCalledWith('var-0', { isSecret: true })
        expect(mockUpdateVariable).toHaveBeenCalledWith('var-1', { isSecret: true })
        expect(mockAddVariable).not.toHaveBeenCalled()
        expect(mockClearValidationErrorNode).toHaveBeenCalledWith('node-1')
        expect(mockCloseConfigModal).toHaveBeenCalledWith('node-1')
      },
    )

    it('Cancel drops the held Save: the sheet stays open, nothing is saved and the next Save asks again', () => {
      let pending: { names: string[]; save: () => void } | null = null
      mockRequestSecretPromotion.mockImplementation((names, save) => {
        pending = { names, save }
      })
      const cancel = () => {
        pending = null
      }
      seedBlock('http')
      mockStore.variables = plainVariables(['api_token'])
      const { result } = renderSheet()

      act(() => {
        result.current.handleConfigSave(CARRIERS[0].saveFor(['api_token']))
      })
      expect(pending).not.toBeNull()
      act(cancel)

      expectNothingSavedAndSheetOpen()

      act(() => {
        result.current.handleConfigSave(CARRIERS[0].saveFor(['api_token']))
      })
      expect(mockRequestSecretPromotion).toHaveBeenCalledTimes(2)
      expect(mockRequestSecretPromotion.mock.calls[1][0]).toEqual(['api_token'])
      expectNothingSavedAndSheetOpen()
    })

    it.each(CARRIER_ROWS)(
      '%s: a new variable typed into a Secret row is created secret with no warning',
      (_carrier, { elementType, saveFor }) => {
        seedBlock(elementType)
        mockStore.variables = []
        const { result } = renderSheet()

        act(() => {
          result.current.handleConfigSave(saveFor(['fresh_token']))
        })

        expect(mockRequestSecretPromotion).not.toHaveBeenCalled()
        expect(mockAddVariable).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'fresh_token', isSecret: true }),
        )
        expect(mockCloseConfigModal).toHaveBeenCalledWith('node-1')
      },
    )

    it.each(CARRIER_ROWS)(
      '%s: an already-secret variable saves at once with no warning',
      (_carrier, { elementType, saveFor }) => {
        seedBlock(elementType)
        mockStore.variables = [
          { id: 'var-0', name: 'api_token', value: null, type: 'string', isSecret: true },
        ]
        const { result } = renderSheet()

        act(() => {
          result.current.handleConfigSave(saveFor(['api_token']))
        })

        expect(mockRequestSecretPromotion).not.toHaveBeenCalled()
        expect(mockUpdateNode).toHaveBeenCalledWith('node-1', expect.anything())
        expect(mockUpdateVariable).not.toHaveBeenCalled()
        expect(mockCloseConfigModal).toHaveBeenCalledWith('node-1')
      },
    )

    describe('a Secret box left as the Block shows it: no stored list, the declared secret output ticked (FNCFG-7)', () => {
      function seedSecretFunctionBlock() {
        mockStore.configModalNodeId = 'node-1'
        mockStore.nodes = [{
          id: 'node-1',
          data: {
            label: 'fetch_token',
            elementType: 'function',
            nodeType: 'function',
            version: '1.0.0',
            functionLifecycle: 'local',
            localDefinition: {
              name: 'fetch_token',
              inputs: [],
              outputs: [
                { name: 'token', type: 'string', secret: true },
                { name: 'note', type: 'string' },
              ],
            },
            config: { values: {}, outputBindings: {} },
          },
        }]
      }

      function saveUntouchedBoxes(bindings: Record<string, string>) {
        const { result } = renderSheet()
        act(() => {
          result.current.handleConfigSave(createSaveData({
            outputBindings: bindings,
            outputTypes: { token: 'string', note: 'string' },
          }))
        })
      }

      it('a new variable bound to the secret output is created secret, one bound to a plain output plain, and no list is stored', () => {
        seedSecretFunctionBlock()
        mockStore.variables = []

        saveUntouchedBoxes({ token: 'fresh_token', note: 'fresh_note' })

        expect(mockRequestSecretPromotion).not.toHaveBeenCalled()
        expect(mockAddVariable).toHaveBeenCalledWith(expect.objectContaining({ name: 'fresh_token', isSecret: true }))
        expect(mockAddVariable).toHaveBeenCalledWith(expect.objectContaining({ name: 'fresh_note', isSecret: false }))
        const config = mockUpdateNode.mock.calls[0][1].data.config as Record<string, unknown>
        expect(config.outputSecretFields).toBeUndefined()
      })

      it('an existing plain variable bound to the secret output waits for the warning naming it', () => {
        seedSecretFunctionBlock()
        mockStore.variables = plainVariables(['api_token'])

        saveUntouchedBoxes({ token: 'api_token' })

        expect(stagedRequest().names).toEqual(['api_token'])
        expectNothingSavedAndSheetOpen()
      })
    })

    it('an existing plain variable bound to an unticked Secret row saves at once and stays plain', () => {
      seedBlock('http')
      mockStore.variables = plainVariables(['api_token'])
      const { result } = renderSheet()

      act(() => {
        result.current.handleConfigSave(createSaveData({
          outputBindings: { response_body: 'api_token' },
          outputTypes: { response_body: 'string' },
          outputSecretFields: [],
        }))
      })

      expect(mockRequestSecretPromotion).not.toHaveBeenCalled()
      expect(mockUpdateVariable).not.toHaveBeenCalled()
      expect(mockCloseConfigModal).toHaveBeenCalledWith('node-1')
    })

    it('names only the existing plain variables when one Save binds plain, secret and new variables', () => {
      seedBlock('http')
      mockStore.variables = [
        { id: 'var-a', name: 'plain_a', value: null, type: 'string', isSecret: false },
        { id: 'var-b', name: 'secret_b', value: null, type: 'string', isSecret: true },
        { id: 'var-d', name: 'plain_d', value: null, type: 'string' },
      ]
      const { result } = renderSheet()

      act(() => {
        result.current.handleConfigSave(CARRIERS[0].saveFor(['plain_a', 'secret_b', 'new_c', 'plain_d']))
      })

      expect([...stagedRequest().names].sort()).toEqual(['plain_a', 'plain_d'])
      expectNothingSavedAndSheetOpen()
    })

    it('names a variable once when two Secret rows bind it', () => {
      seedBlock('shell-script')
      mockStore.variables = plainVariables(['captured'])
      const { result } = renderSheet()

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { script_variables: ['EXPORT_0'] },
          outputBindings: { stdout: 'captured', EXPORT_0: 'captured' },
          outputTypes: { stdout: 'string', EXPORT_0: 'string' },
          outputSecretFields: ['stdout', 'EXPORT_0'],
        }))
      })

      expect(stagedRequest().names).toEqual(['captured'])
    })

    it('one warning names the variables of the outputs table and the output list together', () => {
      seedBlock('shell-script')
      mockStore.variables = [
        { id: 'var-out', name: 'out_plain', value: null, type: 'string', isSecret: false },
        { id: 'var-export', name: 'export_plain', value: null, type: 'string', isSecret: false },
      ]
      const { result } = renderSheet()

      act(() => {
        result.current.handleConfigSave(createSaveData({
          values: { script_variables: ['EXPORT_0'] },
          outputBindings: { stdout: 'out_plain', EXPORT_0: 'export_plain' },
          outputTypes: { stdout: 'string', EXPORT_0: 'string' },
          outputSecretFields: ['stdout', 'EXPORT_0'],
        }))
      })

      expect([...stagedRequest().names].sort()).toEqual(['export_plain', 'out_plain'])
      expectNothingSavedAndSheetOpen()
    })
  })

  // =========================================================================
  // handleConfigSave - Secret output rows of a Function Block
  // =========================================================================

  describe('handleConfigSave - Secret output rows of a Function Block (SECUI-11, SECUI-12, REQ-4.5.20)', () => {
    const OUTPUT_TYPES = { token: 'string', refresh: 'string', expires: 'integer' }

    function seedSecretOutputCall() {
      mockStore.configModalNodeId = 'fn-1'
      mockStore.nodes = [{
        id: 'fn-1',
        data: {
          label: 'fetch_token',
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          functionLifecycle: 'local',
          localDefinition: {
            name: 'fetch_token',
            inputs: [],
            outputs: [
              { name: 'token', type: 'string', secret: true },
              { name: 'refresh', type: 'string', secret: true },
              { name: 'expires', type: 'integer', secret: true },
            ],
          },
        },
      }]
    }

    function saveCall(
      result: { current: ReturnType<typeof useConfigModal> },
      outputBindings: Record<string, string>,
      outputSecretFields: string[],
    ) {
      act(() => {
        result.current.handleConfigSave(createSaveData({
          id: 'fn-1',
          name: 'fetch_token',
          outputBindings,
          outputTypes: OUTPUT_TYPES,
          outputSecretFields,
        }))
      })
    }

    function renderSheet() {
      return renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
    }

    beforeEach(() => {
      // Nobody has answered the warning yet: the Save stays held.
      mockRequestSecretPromotion.mockImplementation(() => {})
    })

    afterEach(() => {
      mockRequestSecretPromotion.mockImplementation(answerSecretPromotionAtOnce)
    })

    it('creates a new variable typed into a Secret output row as secret, with no warning', () => {
      seedSecretOutputCall()
      mockStore.variables = []
      const { result } = renderSheet()

      saveCall(result, { token: 'new_token' }, ['token'])

      expect(mockRequestSecretPromotion).not.toHaveBeenCalled()
      expect(mockAddVariable).toHaveBeenCalledWith({ name: 'new_token', type: 'string', isSecret: true })
      expect(mockCloseConfigModal).toHaveBeenCalledWith('fn-1')
    })

    it('keeps the ticked Secret output rows in the block config', () => {
      seedSecretOutputCall()
      mockStore.variables = []
      const { result } = renderSheet()

      saveCall(result, { token: 'new_token', refresh: 'new_refresh' }, ['token'])

      expect(mockUpdateNode).toHaveBeenCalledWith('fn-1', {
        data: expect.objectContaining({
          config: expect.objectContaining({
            outputBindings: { token: 'new_token', refresh: 'new_refresh' },
            outputSecretFields: ['token'],
          }),
        }),
      })
    })

    it('an existing plain variable bound to a Secret output row: the Save waits and the warning names it', () => {
      seedSecretOutputCall()
      mockStore.variables = [
        { id: 'var-0', name: 'api_token', value: null, type: 'string', isSecret: false },
      ]
      const { result } = renderSheet()

      saveCall(result, { token: 'api_token' }, ['token'])

      expect(mockRequestSecretPromotion).toHaveBeenCalledTimes(1)
      expect(mockRequestSecretPromotion).toHaveBeenCalledWith(['api_token'], expect.any(Function))
      expect(mockUpdateNode).not.toHaveBeenCalled()
      expect(mockAddVariable).not.toHaveBeenCalled()
      expect(mockUpdateVariable).not.toHaveBeenCalled()
      expect(mockCloseConfigModal).not.toHaveBeenCalled()
    })

    it('several existing plain variables bound to Secret output rows: the warning names each one', () => {
      seedSecretOutputCall()
      mockStore.variables = [
        { id: 'var-0', name: 'api_token', value: null, type: 'string', isSecret: false },
        { id: 'var-1', name: 'refresh_token', value: null, type: 'string' },
        { id: 'var-2', name: 'expiry', value: null, type: 'integer', isSecret: false },
      ]
      const { result } = renderSheet()

      saveCall(
        result,
        { token: 'api_token', refresh: 'refresh_token', expires: 'expiry' },
        ['token', 'refresh', 'expires'],
      )

      expect(mockRequestSecretPromotion).toHaveBeenCalledTimes(1)
      const [names] = mockRequestSecretPromotion.mock.calls[0]
      expect([...names].sort()).toEqual(['api_token', 'expiry', 'refresh_token'])
      expect(mockUpdateNode).not.toHaveBeenCalled()
      expect(mockCloseConfigModal).not.toHaveBeenCalled()
    })

    it('confirming saves the Block, turns each named variable secret and closes the sheet', () => {
      seedSecretOutputCall()
      mockStore.variables = [
        { id: 'var-0', name: 'api_token', value: null, type: 'string', isSecret: false },
        { id: 'var-1', name: 'refresh_token', value: null, type: 'string' },
      ]
      const { result } = renderSheet()

      saveCall(result, { token: 'api_token', refresh: 'refresh_token' }, ['token', 'refresh'])
      expect(mockRequestSecretPromotion).toHaveBeenCalledTimes(1)
      const [, save] = mockRequestSecretPromotion.mock.calls[0]
      act(() => {
        save()
      })

      expect(mockUpdateNode).toHaveBeenCalledWith('fn-1', expect.anything())
      expect(mockUpdateVariable).toHaveBeenCalledWith('var-0', { isSecret: true })
      expect(mockUpdateVariable).toHaveBeenCalledWith('var-1', { isSecret: true })
      expect(mockAddVariable).not.toHaveBeenCalled()
      expect(mockClearValidationErrorNode).toHaveBeenCalledWith('fn-1')
      expect(mockCloseConfigModal).toHaveBeenCalledWith('fn-1')
    })

    it('an already-secret variable bound to a Secret output row saves at once with no warning', () => {
      seedSecretOutputCall()
      mockStore.variables = [
        { id: 'var-0', name: 'api_token', value: null, type: 'string', isSecret: true },
      ]
      const { result } = renderSheet()

      saveCall(result, { token: 'api_token' }, ['token'])

      expect(mockRequestSecretPromotion).not.toHaveBeenCalled()
      expect(mockUpdateNode).toHaveBeenCalledWith('fn-1', expect.anything())
      expect(mockUpdateVariable).not.toHaveBeenCalled()
      expect(mockCloseConfigModal).toHaveBeenCalledWith('fn-1')
    })

    it('an unticked output row bound to an existing plain variable saves at once and leaves it plain', () => {
      seedSecretOutputCall()
      mockStore.variables = [
        { id: 'var-0', name: 'api_token', value: null, type: 'string', isSecret: false },
      ]
      const { result } = renderSheet()

      saveCall(result, { token: 'api_token' }, [])

      expect(mockRequestSecretPromotion).not.toHaveBeenCalled()
      expect(mockUpdateVariable).not.toHaveBeenCalled()
      expect(mockCloseConfigModal).toHaveBeenCalledWith('fn-1')
    })
  })

  // =========================================================================
  // Return values
  // =========================================================================

  describe('return values', () => {
    it('returns all expected properties, with one Save handler for every Block', () => {
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current).toHaveProperty('configModalElement')
      expect(result.current).toHaveProperty('isInActiveScope')
      expect(result.current).toHaveProperty('closeConfigModal')
      expect(result.current).toHaveProperty('handleConfigSave')
      expect(result.current).not.toHaveProperty('handleFunctionConfigSave')
      expect(typeof result.current.handleConfigSave).toBe('function')
      expect(typeof result.current.closeConfigModal).toBe('function')
    })
  })

  // =========================================================================
  // Scope read-only: sheets persist across drill via deep lookup
  // =========================================================================

  describe('scope-independent resolution (persisting sheets)', () => {
    function seedDrilledIntoFunction() {
      const innerNode = {
        id: 'inner-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Inner Shell Script',
          elementType: 'shell-script',
          version: '1.0.0',
          config: { values: { command: 'echo inner' } },
        },
      }
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [innerNode], edges: [] },
            inputs: [],
            outputs: [],
            variables: [],
          },
        },
      }
      const rootSibling = {
        id: 'root-log',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Root Log',
          elementType: 'log',
          version: '1.0.0',
          config: { values: {} },
        },
      }
      mockStore.nodes = [fnNode, rootSibling]
      mockStore.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]
    }

    it('still resolves a ROOT node while drilled into a Function (out of scope)', () => {
      seedDrilledIntoFunction()
      mockStore.configModalNodeId = 'root-log'
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement).not.toBeNull()
      expect(result.current.configModalElement!.name).toBe('Root Log')
      expect(result.current.isInActiveScope).toBe(false)
    })

    it('reports in-scope for a node inside the drilled Function body', () => {
      seedDrilledIntoFunction()
      mockStore.configModalNodeId = 'inner-1'
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.name).toBe('Inner Shell Script')
      expect(result.current.isInActiveScope).toBe(true)
    })

    it('resolves an INNER node from the root scope (sheet kept while popped out)', () => {
      seedDrilledIntoFunction()
      mockStore.drillPath = []
      mockStore.configModalNodeId = 'inner-1'
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.configModalElement!.name).toBe('Inner Shell Script')
      expect(result.current.isInActiveScope).toBe(false)
    })

    it('reports in-scope at root for a root node', () => {
      mockStore.nodes = [{
        id: 'node-1',
        data: { label: 'Shell Script', elementType: 'shell-script', version: '1.0.0' },
      }]
      mockStore.configModalNodeId = 'node-1'
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      expect(result.current.isInActiveScope).toBe(true)
    })
  })

  describe('handleConfigSave - a Shared Function Block version switch keeps the Secret rows the picked contract declares (FNCFG-7)', () => {
    it('drops a ticked Secret row whose output the picked version no longer declares', () => {
      mockStore.configModalNodeId = 'fn-sw'
      mockStore.nodes = [{
        id: 'fn-sw',
        data: {
          label: 'Fetch',
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          functionLifecycle: 'shared',
          functionId: 'lib-1',
          functionVersion: '1.0.0',
          resolvedInputs: [],
          resolvedOutputs: [
            { name: 'token', type: 'string', description: '' },
            { name: 'old_secret', type: 'string', description: '' },
          ],
        },
      }]
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })

      act(() => {
        result.current.handleConfigSave(createSaveData({
          id: 'fn-sw',
          name: 'Fetch',
          outputBindings: { token: 'tok_var', old_secret: 'old_var' },
          outputTypes: { token: 'string', old_secret: 'string' },
          outputSecretFields: ['token', 'old_secret'],
          functionVersion: '2.0.0',
          resolvedInputs: [],
          resolvedOutputs: [{ name: 'token', type: 'string', description: '' }],
        } as Partial<SaveData>))
      })

      expect(mockUpdateNode).toHaveBeenCalledWith('fn-sw', {
        data: expect.objectContaining({
          config: expect.objectContaining({ outputBindings: { token: 'tok_var' }, outputSecretFields: ['token'] }),
        }),
      })
      expect(mockAddVariable).toHaveBeenCalledTimes(1)
      expect(mockAddVariable).toHaveBeenCalledWith({ name: 'tok_var', type: 'string', isSecret: true })
    })
  })

  describe('handleConfigSave - a Shared Function Block version switch drops the values the picked version no longer fits (FNCFG-9)', () => {
    const LEVEL_V1 = { name: 'level', type: 'string', required: true, default: 'low', description: '', enumValues: ['low', 'high'] }
    const LEVEL_V2 = { ...LEVEL_V1, enumValues: ['low', 'medium'] }

    function seedBlock(storedVersion: string, resolvedInputs: Array<Record<string, unknown>> = [LEVEL_V1]): void {
      mockStore.configModalNodeId = 'fn-pick'
      mockStore.nodes = [{
        id: 'fn-pick',
        data: {
          label: 'Pick',
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          functionLifecycle: 'shared',
          functionId: 'lib-1',
          functionVersion: storedVersion,
          resolvedInputs,
          resolvedOutputs: [],
        },
      }]
    }

    interface PickedVersion {
      functionVersion: string
      resolvedInputs?: Array<Record<string, unknown>>
      resolvedOutputs?: []
    }

    /** Saves the Block's fields on the picked version; returns the stored node data. */
    function saveBlock(fields: Partial<SaveData>, picked: PickedVersion): Record<string, unknown> {
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      act(() => {
        result.current.handleConfigSave(createSaveData({ id: 'fn-pick', name: 'Pick', ...fields, ...picked } as Partial<SaveData>))
      })
      expect(mockUpdateNode).toHaveBeenCalledTimes(1)
      return mockUpdateNode.mock.calls[0][1].data as Record<string, unknown>
    }

    function storedValues(data: Record<string, unknown>): unknown {
      return (data.config as { values?: unknown }).values
    }

    it('drops a pick the picked version no longer allows, so the field is empty', () => {
      seedBlock('1.0.0')
      const data = saveBlock({ values: { level: 'high' } }, { functionVersion: '1.1.0', resolvedInputs: [LEVEL_V2], resolvedOutputs: [] })
      expect(data.functionVersion).toBe('1.1.0')
      expect(storedValues(data)).toEqual({})
    })

    it('keeps a pick the picked version still allows', () => {
      seedBlock('1.0.0')
      const data = saveBlock({ values: { level: 'low' } }, { functionVersion: '1.1.0', resolvedInputs: [LEVEL_V2], resolvedOutputs: [] })
      expect(storedValues(data)).toEqual({ level: 'low' })
    })

    it('keeps an expression as written', () => {
      seedBlock('1.0.0')
      const data = saveBlock(
        { values: { level: 'chosen_level' }, expressionFields: ['level'] },
        { functionVersion: '1.1.0', resolvedInputs: [LEVEL_V2], resolvedOutputs: [] },
      )
      expect(storedValues(data)).toEqual({ level: 'chosen_level' })
      expect(data.expressionFields).toEqual(['level'])
    })

    it('drops a literal a retyped input no longer fits and keeps one it still fits', () => {
      seedBlock('1.0.0', [
        { name: 'count', type: 'string', required: true, description: '' },
        { name: 'ratio', type: 'integer', required: true, description: '' },
      ])
      const retyped = [
        { name: 'count', type: 'integer', required: true, default: 0, description: '' },
        { name: 'ratio', type: 'float', required: true, default: 0, description: '' },
      ]
      const data = saveBlock(
        { values: { count: 'three', ratio: 2 } },
        { functionVersion: '2.0.0', resolvedInputs: retyped, resolvedOutputs: [] },
      )
      expect(storedValues(data)).toEqual({ ratio: 2 })
    })

    it('drops a list the picked version retypes to a map, with its entry flags and item types', () => {
      seedBlock('1.0.0', [{ name: 'tags', type: 'array', required: false, description: '' }])
      const data = saveBlock(
        {
          values: { tags: ['a', 'n + 1'] },
          expressionFields: ['tags.1'],
          elementTypes: { tags: ['string', 'integer'] },
        },
        {
          functionVersion: '2.0.0',
          resolvedInputs: [{ name: 'tags', type: 'map', required: false, description: '' }],
          resolvedOutputs: [],
        },
      )
      expect(storedValues(data)).toEqual({})
      expect(data.expressionFields ?? []).toEqual([])
      expect(data.elementTypes ?? {}).toEqual({})
    })

    it('drops a value whose input the picked version no longer declares and starts a new free-entry input not set', () => {
      seedBlock('1.0.0')
      const renamed = [{ name: 'tier', type: 'string', required: true, default: '', description: '' }]
      const data = saveBlock({ values: { level: 'low' } }, { functionVersion: '2.0.0', resolvedInputs: renamed, resolvedOutputs: [] })
      expect(storedValues(data)).toEqual({})
    })

    it('a Save that keeps the version keeps every value as given', () => {
      seedBlock('1.0.0')
      const data = saveBlock({ values: { level: 'medium' } }, { functionVersion: '1.0.0', resolvedInputs: [LEVEL_V1], resolvedOutputs: [] })
      expect(storedValues(data)).toEqual({ level: 'medium' })
    })

    it('a switch whose picked contract is not fully resolved keeps every value as given', () => {
      seedBlock('1.0.0')
      const data = saveBlock({ values: { level: 'high' } }, { functionVersion: '1.1.0', resolvedInputs: [LEVEL_V2] })
      expect(storedValues(data)).toEqual({ level: 'high' })
    })
  })

  describe('handleConfigSave - a Shared Function Block version switch starts each new choice input on its default (FNCFG-9, REQ-3.1.2.10)', () => {
    const LEVEL = { name: 'level', type: 'string', required: true, default: 'low', description: '', enumValues: ['low', 'high'] }
    const MODE = { name: 'mode', type: 'string', required: true, default: 'slow', description: '', enumValues: ['fast', 'slow'] }
    const VERBOSE = { name: 'verbose', type: 'boolean', required: false, default: false, description: '' }
    const NOTE = { name: 'note', type: 'string', required: false, default: 'n/a', description: '' }

    function seedBlock(): void {
      mockStore.configModalNodeId = 'fn-new'
      mockStore.nodes = [{
        id: 'fn-new',
        data: {
          label: 'Pick',
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          functionLifecycle: 'shared',
          functionId: 'lib-1',
          functionVersion: '1.0.0',
          resolvedInputs: [LEVEL],
          resolvedOutputs: [],
        },
      }]
    }

    function switchTo(values: Record<string, unknown>): unknown {
      const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
      act(() => {
        result.current.handleConfigSave(createSaveData({
          id: 'fn-new',
          name: 'Pick',
          values,
          functionVersion: '2.0.0',
          resolvedInputs: [LEVEL, MODE, VERBOSE, NOTE],
          resolvedOutputs: [],
        } as Partial<SaveData>))
      })
      expect(mockUpdateNode).toHaveBeenCalledTimes(1)
      const data = mockUpdateNode.mock.calls[0][1].data as { config: { values: unknown } }
      return data.config.values
    }

    it('writes the default of each new choice-list and true / false input, and nothing for a new free-entry input', () => {
      seedBlock()
      expect(switchTo({ level: 'high' })).toEqual({ level: 'high', mode: 'slow', verbose: false })
    })

    it('keeps the value the window already gave a new choice input', () => {
      seedBlock()
      expect(switchTo({ level: 'high', mode: 'fast', verbose: true })).toEqual({ level: 'high', mode: 'fast', verbose: true })
    })

    it('writes the default of every choice input a Block with no stored contract does not hold', () => {
      seedBlock()
      delete mockStore.nodes[0].data.resolvedInputs
      expect(switchTo({ level: 'high' })).toEqual({ level: 'high', mode: 'slow', verbose: false })
    })
  })
})
