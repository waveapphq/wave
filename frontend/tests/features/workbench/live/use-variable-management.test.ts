/**
 * Tests for useVariableManagement hook
 *
 * Verifies output binding analysis, variable CRUD operations, delete confirmation
 * with binding cleanup, scalar variable save with rename, runtime values
 * passthrough, and create variable dialog state management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVariableManagement, type VariableManagementResult } from '@/features/workbench/live/use-variable-management'
import { instancesWithoutBody, tracksSecretsAt } from '@/features/workbench/lib/function-scope-rows'
import { useWorkflowStore, type WorkflowVariable } from '@/features/workbench/stores/workflow-store'
import { workbenchApi } from '@/features/workbench/api/workbench'
import {
  mergeStagedIntoRunVariables,
  stagedFunctionVariables,
  type StagedOverride,
} from '@/features/workbench/live/staged-overrides'
import type { DrillEntry } from '@/features/functions/canvas/inner-workflow'
import { scopedVariableKey } from '@/features/workbench/lib/variable-scope-key'
import type { VariableCreateSpec } from '@/features/workbench/common/variables/variable-inspect-modal/use-inspect-create'

// ---------------------------------------------------------------------------
// Mock: workflow store
// ---------------------------------------------------------------------------
vi.mock('@/features/workbench/stores/workflow-store')

// ---------------------------------------------------------------------------
// Mock: useVariableUpdates (runtime values overlay)
// ---------------------------------------------------------------------------
let mockRuntimeValues = new Map<string, unknown>()
let mockRecentlyChangedPaths = new Set<string>()
const mockForgetRuntimeValue = vi.fn()

vi.mock('@/features/workbench/hooks/use-variable-updates', () => ({
  useVariableUpdates: () => ({
    values: mockRuntimeValues,
    recentlyChangedPaths: mockRecentlyChangedPaths,
    forget: mockForgetRuntimeValue,
  }),
}))

// ---------------------------------------------------------------------------
// Mock: workbench API (Current-edit override endpoint)
// ---------------------------------------------------------------------------
vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    setVariableOverride: vi.fn().mockResolvedValue({ name: 'count', value: 5, pending: false }),
  },
}))

// ---------------------------------------------------------------------------
// Mock: toast (the Current-edit failure report)
// ---------------------------------------------------------------------------
const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: mockToastError }),
}))

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------
const makeVariable = (overrides: Partial<WorkflowVariable> & { id: string; name: string }): WorkflowVariable => ({
  type: 'string',
  value: '',
  ...overrides,
})

interface StoreState {
  nodes: unknown[]
  variables: WorkflowVariable[]
  namespaceVariables: { system: Array<{ name: string; type: string; sources?: string[] }>; suite: Array<{ name: string; type: string; sources?: string[] }>; regression: Array<{ name: string; type: string; sources?: string[] }> }
  addVariable: ReturnType<typeof vi.fn>
  updateVariable: ReturnType<typeof vi.fn>
  removeVariable: ReturnType<typeof vi.fn>
  setNodes: ReturnType<typeof vi.fn>
  renameVariable: ReturnType<typeof vi.fn>
  transaction: ReturnType<typeof vi.fn>
  drillPath: Array<{ nodeId: string; label: string }>
  getActiveVariables: ReturnType<typeof vi.fn>
  addInputParam: ReturnType<typeof vi.fn>
  addOutputParam: ReturnType<typeof vi.fn>
  removeInputParam: ReturnType<typeof vi.fn>
  removeOutputParam: ReturnType<typeof vi.fn>
  updateInputParam: ReturnType<typeof vi.fn>
  updateOutputParam: ReturnType<typeof vi.fn>
  isCurrentScopeReadOnly: ReturnType<typeof vi.fn>
  getSavedVariables: ReturnType<typeof vi.fn>
  getSavedNodes: ReturnType<typeof vi.fn>
  functionViewMode?: { functionId: string; version: string; editable: boolean } | null
  functionViewBaseline?: { nodeId: string; body: unknown } | null
}

// Synchronous transaction stub: invokes the callback so the individual
// mutation mocks observe each call. The post-state baseline model lives
// in the real store; callers under test only need the wrapping behavior.
const makeMockTransaction = () =>
  vi.fn((cb: () => void) => {
    try {
      cb()
    } catch {
      // Match real transaction: rollback (here a no-op against mocks) then rethrow
      throw new Error('transaction rollback')
    }
  })

const defaultStoreFns: StoreState = {
  nodes: [],
  variables: [],
  namespaceVariables: { system: [], suite: [], regression: [] },
  addVariable: vi.fn(),
  updateVariable: vi.fn(),
  removeVariable: vi.fn(),
  setNodes: vi.fn(),
  renameVariable: vi.fn().mockReturnValue({ success: true }),
  transaction: makeMockTransaction(),
  drillPath: [],
  getActiveVariables: vi.fn().mockReturnValue([]),
  addInputParam: vi.fn(),
  addOutputParam: vi.fn(),
  removeInputParam: vi.fn(),
  removeOutputParam: vi.fn(),
  updateInputParam: vi.fn().mockReturnValue({ success: true }),
  updateOutputParam: vi.fn().mockReturnValue({ success: true }),
  isCurrentScopeReadOnly: vi.fn().mockReturnValue(false),
  getSavedVariables: vi.fn().mockReturnValue([]),
  getSavedNodes: vi.fn().mockReturnValue([]),
}

let currentStore: StoreState

function setupStore(overrides: Partial<StoreState> = {}) {
  currentStore = { ...defaultStoreFns, ...overrides }
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: typeof currentStore) => unknown)(currentStore)
  })
  // displayVariables's useMemo body reads useWorkflowStore.getState().nodes
  // for the drilled-in branch. Provide a getState shim so that path doesn't
  // crash even when drillPath is empty (the branch is gated on
  // drillPath.length > 0 but TypeScript / runtime resolution still needs
  // .getState available).
  ;(useWorkflowStore as unknown as { getState: () => typeof currentStore }).getState = () => currentStore
  return currentStore
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
const mockRegisterVariableHandler = vi.fn()

function renderVarManagement(sessionId: string | null = null) {
  return renderHook(() => useVariableManagement(sessionId, mockRegisterVariableHandler))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useVariableManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
    // Reset store defaults (each fn gets a fresh spy)
    defaultStoreFns.nodes = []
    defaultStoreFns.variables = []
    defaultStoreFns.addVariable = vi.fn()
    defaultStoreFns.updateVariable = vi.fn()
    defaultStoreFns.removeVariable = vi.fn()
    defaultStoreFns.setNodes = vi.fn()
    defaultStoreFns.renameVariable = vi.fn().mockReturnValue({ success: true })
    defaultStoreFns.transaction = makeMockTransaction()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('returns empty computed data and closed dialogs', () => {
      setupStore()
      const { result } = renderVarManagement()

      expect(result.current.outputBoundVarNames.size).toBe(0)
      expect(result.current.outputBoundVarSources.size).toBe(0)
      expect(result.current.inputRefCounts.size).toBe(0)
      expect(result.current.workflowReferencedVarNames.size).toBe(0)
      expect(result.current.availableVariablesForManager).toEqual([])
      expect(result.current.displayVariables).toEqual([])
      expect(result.current.runtimeValues.size).toBe(0)
      expect(result.current.pendingDeleteVarId).toBeNull()
      expect(result.current.pendingDeleteDescription).toBe('')
      expect(result.current.recentlyChangedPaths.size).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Output binding analysis
  // -------------------------------------------------------------------------
  describe('output binding analysis', () => {
    it('collects output-bound variable names from node config', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'HTTP Request',
              config: {
                outputBindings: { response_body: 'result_var', status: 'status_var' },
              },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.outputBoundVarNames).toEqual(new Set(['result_var', 'status_var']))
      expect(result.current.outputBoundVarSources.get('result_var')).toEqual(['HTTP Request'])
      expect(result.current.outputBoundVarSources.get('status_var')).toEqual(['HTTP Request'])
    })

    it('names the writing block by its Name, never by its Description', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'My Node',
              description: 'Loads the seed rows before the checks run',
              config: {
                outputBindings: { out: 'my_var' },
              },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.outputBoundVarSources.get('my_var')).toEqual(['My Node'])
    })

    it('skips empty binding values', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Node',
              config: {
                outputBindings: { out1: 'bound_var', out2: '' },
              },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.outputBoundVarNames).toEqual(new Set(['bound_var']))
    })

    it('aggregates multiple sources for the same variable name', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Node A',
              config: { outputBindings: { out: 'shared_var' } },
            },
          },
          {
            id: 'n2',
            data: {
              label: 'Node B',
              config: { outputBindings: { result: 'shared_var' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.outputBoundVarSources.get('shared_var')).toEqual(['Node A', 'Node B'])
    })

    it('handles nodes without config', () => {
      setupStore({
        nodes: [{ id: 'n1', data: { label: 'No Config' } }],
      })
      const { result } = renderVarManagement()

      expect(result.current.outputBoundVarNames.size).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Input reference counting
  // -------------------------------------------------------------------------
  describe('input reference counting', () => {
    it('counts identifier references in expression fields', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Node',
              expressionFields: ['query'],
              config: {
                values: { query: 'my_var + other_var' },
              },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.inputRefCounts.get('my_var')).toBe(1)
      expect(result.current.inputRefCounts.get('other_var')).toBe(1)
    })

    it('does not count non-expression fields', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Node',
              expressionFields: ['expr_field'],
              config: {
                values: { literal_field: 'my_var', expr_field: 'counted_var' },
              },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.inputRefCounts.has('my_var')).toBe(false)
      expect(result.current.inputRefCounts.get('counted_var')).toBe(1)
    })

    it('ignores non-string values', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Node',
              expressionFields: ['num_field'],
              config: {
                values: { num_field: 42 },
              },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.inputRefCounts.size).toBe(0)
    })

    it('handles nodes without values in config', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Node',
              expressionFields: ['field'],
              config: {},
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.inputRefCounts.size).toBe(0)
    })

    it('handles nodes without expressionFields', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Node',
              config: {
                values: { query: 'some_var' },
              },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      // 'query' is not in expressionFields (which defaults to []), so no refs
      expect(result.current.inputRefCounts.size).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // workflowReferencedVarNames
  // -------------------------------------------------------------------------
  describe('workflowReferencedVarNames', () => {
    it('combines output-bound and input-referenced variable names', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Producer',
              config: { outputBindings: { out: 'produced_var' } },
            },
          },
          {
            id: 'n2',
            data: {
              label: 'Consumer',
              expressionFields: ['expr'],
              config: { values: { expr: 'consumed_var' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames).toEqual(
        new Set(['produced_var', 'consumed_var'])
      )
    })

    it('counts a variable a template field interpolates', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Open SSH',
              templateFields: ['host', 'username'],
              config: { values: { host: '"{{ ssh_host }}"', username: '"{{ ssh_user }}"' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames).toEqual(
        new Set(['ssh_host', 'ssh_user'])
      )
    })

    it('counts every variable in a template field that interpolates more than one', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Path',
              templateFields: ['path'],
              config: { values: { path: '/home/{{ owner }}/{{ suffix }}.txt' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames).toEqual(new Set(['owner', 'suffix']))
    })

    it('ignores the literal text around a template marker', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Path',
              templateFields: ['path'],
              config: { values: { path: '/home/wave/{{ suffix }}.txt' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.has('wave')).toBe(false)
      expect(result.current.workflowReferencedVarNames.has('home')).toBe(false)
      expect(result.current.workflowReferencedVarNames.has('suffix')).toBe(true)
    })

    it('ignores an unterminated template marker', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Path',
              templateFields: ['path'],
              config: { values: { path: '/home/{{ suffix' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.size).toBe(0)
    })

    it('counts a field declared both templated and expression only once per use', () => {
      setupStore({
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Both',
              expressionFields: ['value'],
              templateFields: ['value'],
              config: { values: { value: '{{ shared }}' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.has('shared')).toBe(true)
    })

    // -----------------------------------------------------------------------
    // Cross-variable expression references
    // -----------------------------------------------------------------------
    it('includes names referenced from another variable\'s computed expression', () => {
      // `total` is a computed variable whose expression references `myvar`.
      // `myvar` is referenced by no node, but it is referenced by `total`.
      // Both must appear in workflowReferencedVarNames so the Unused badge
      // does not fire for `myvar`.
      const vars = [
        makeVariable({ id: 'v1', name: 'myvar', type: 'integer', value: 1 }),
        makeVariable({
          id: 'v2',
          name: 'total',
          type: 'integer',
          value: 'myvar + 1',
          isExpression: true,
        }),
      ]
      setupStore({ variables: vars, nodes: [] })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.has('myvar')).toBe(true)
    })

    it('includes names referenced via expressions through multiple identifiers', () => {
      // `total` references both `a` and `b` in its expression.
      const vars = [
        makeVariable({ id: 'v1', name: 'a', type: 'integer', value: 1 }),
        makeVariable({ id: 'v2', name: 'b', type: 'integer', value: 2 }),
        makeVariable({
          id: 'v3',
          name: 'total',
          type: 'integer',
          value: 'a + b',
          isExpression: true,
        }),
      ]
      setupStore({ variables: vars, nodes: [] })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.has('a')).toBe(true)
      expect(result.current.workflowReferencedVarNames.has('b')).toBe(true)
    })

    it('does not list variables referenced only by themselves as referenced from elsewhere', () => {
      // A self-referencing computed variable should not list itself as a
      // cross-variable reference. The Unused badge logic has a separate
      // self-reference check; this set is for cross-reference only.
      const vars = [
        makeVariable({
          id: 'v1',
          name: 'a',
          type: 'integer',
          value: 'a + 1',
          isExpression: true,
        }),
      ]
      setupStore({ variables: vars, nodes: [] })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.has('a')).toBe(false)
    })

    it('combines node-side references with cross-variable expression references', () => {
      // `myvar` is referenced by both a workflow node parameter AND by
      // another variable's expression. The set must contain it (de-duped).
      const vars = [
        makeVariable({ id: 'v1', name: 'myvar', type: 'integer', value: 1 }),
        makeVariable({
          id: 'v2',
          name: 'derived',
          type: 'integer',
          value: 'myvar * 2',
          isExpression: true,
        }),
      ]
      setupStore({
        variables: vars,
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Consumer',
              expressionFields: ['expr'],
              config: { values: { expr: 'myvar + 1' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.has('myvar')).toBe(true)
    })

    it('ignores expressions on non-isExpression variables (literal value text)', () => {
      // A variable whose `value` happens to look like an expression but
      // whose isExpression flag is false MUST NOT contribute references.
      // Literal strings and numbers are not parsed.
      const vars = [
        makeVariable({ id: 'v1', name: 'myvar', type: 'integer', value: 1 }),
        makeVariable({
          id: 'v2',
          name: 'literal',
          type: 'string',
          value: 'myvar + 1',
          isExpression: false,
        }),
      ]
      setupStore({ variables: vars, nodes: [] })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.has('myvar')).toBe(false)
    })

    it('ignores Python builtins in expression text', () => {
      // Identifiers like `len`, `str`, `int` are builtins, not user variables;
      // they must not pollute the referenced-names set.
      const vars = [
        makeVariable({ id: 'v1', name: 'items', type: 'array', value: [1, 2] }),
        makeVariable({
          id: 'v2',
          name: 'count',
          type: 'integer',
          value: 'len(items)',
          isExpression: true,
        }),
      ]
      setupStore({ variables: vars, nodes: [] })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.has('items')).toBe(true)
      expect(result.current.workflowReferencedVarNames.has('len')).toBe(false)
    })

    it('ignores the sandbox table types and counts a variable named like a builtin the sandbox leaves out', () => {
      const vars = [
        makeVariable({ id: 'v1', name: 'id', type: 'integer', value: 1 }),
        makeVariable({
          id: 'v2',
          name: 'rows',
          type: 'table',
          value: "Table(['k']) if id else None",
          isExpression: true,
        }),
      ]
      setupStore({ variables: vars, nodes: [] })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.has('id')).toBe(true)
      expect(result.current.workflowReferencedVarNames.has('Table')).toBe(false)
    })

    it('ignores Python keywords (and, or, not, if, else, etc.)', () => {
      // Keywords must not contribute to the referenced-names set.
      const vars = [
        makeVariable({ id: 'v1', name: 'flag', type: 'boolean', value: true }),
        makeVariable({
          id: 'v2',
          name: 'result',
          type: 'boolean',
          value: 'flag and not False',
          isExpression: true,
        }),
      ]
      setupStore({ variables: vars, nodes: [] })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.has('flag')).toBe(true)
      expect(result.current.workflowReferencedVarNames.has('and')).toBe(false)
      expect(result.current.workflowReferencedVarNames.has('not')).toBe(false)
    })

    it('handles expression text with no extractable identifiers (literals only)', () => {
      // Pure-numeric expression has no identifiers; the regex match returns
      // null and the loop must skip without polluting the set.
      const vars = [
        makeVariable({ id: 'v1', name: 'a', type: 'integer', value: 1 }),
        makeVariable({
          id: 'v2',
          name: 'b',
          type: 'integer',
          value: '1 + 2',
          isExpression: true,
        }),
      ]
      setupStore({ variables: vars, nodes: [] })
      const { result } = renderVarManagement()

      expect(result.current.workflowReferencedVarNames.size).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // availableVariablesForManager
  // -------------------------------------------------------------------------
  describe('availableVariablesForManager', () => {
    it('maps workflow variables with source from output bindings', () => {
      const vars = [
        makeVariable({ id: 'v1', name: 'bound_var' }),
        makeVariable({ id: 'v2', name: 'unbound_var' }),
      ]
      setupStore({
        variables: vars,
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Source Node',
              config: { outputBindings: { out: 'bound_var' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      expect(result.current.availableVariablesForManager).toEqual([
        { name: 'bound_var', type: 'string', source: 'Source Node' },
        { name: 'unbound_var', type: 'string', source: undefined },
      ])
    })

    it('includes suite namespace entries in availableVariablesForManager', () => {
      setupStore({
        namespaceVariables: {
          system: [],
          suite: [
            { name: 'base_url', type: 'string', sources: ['Auth Suite'] },
            { name: 'timeout', type: 'integer', sources: ['Auth Suite', 'API Suite'] },
          ],
          regression: [],
        },
      })
      const { result } = renderVarManagement()

      const suiteTopLevel = result.current.availableVariablesForManager.find(
        (v) => v.name === 'suite'
      )
      expect(suiteTopLevel).toBeDefined()
      expect(suiteTopLevel!.type).toBe('object')

      const dottedUrl = result.current.availableVariablesForManager.find(
        (v) => v.name === 'suite.base_url'
      )
      expect(dottedUrl).toBeDefined()
      expect(dottedUrl!.source).toBe('Suite')

      const dottedTimeout = result.current.availableVariablesForManager.find(
        (v) => v.name === 'suite.timeout'
      )
      expect(dottedTimeout).toBeDefined()
      expect(dottedTimeout!.source).toBe('Suite')
    })

    it('includes profile aliases bound to any node, including dotted field entries', () => {
      setupStore({
        nodes: [
          {
            id: 'log-1',
            data: {
              label: 'Log',
              config: {
                profileBindings: [
                  {
                    profileId: 'prof-1',
                    profileName: 'Staging API',
                    alias: 'cpr',
                    fields: [
                      { name: 'host', type: 'string' },
                      { name: 'port', type: 'integer' },
                    ],
                  },
                ],
              },
            },
          },
          // A node without bindings - covers the `if (!bindings) continue` branch.
          {
            id: 'log-2',
            data: {
              label: 'Log 2',
              config: {},
            },
          },
          // A node whose binding has no alias - covers the `if (!b.alias) continue` branch.
          {
            id: 'log-3',
            data: {
              label: 'Log 3',
              config: {
                profileBindings: [{ profileId: 'prof-2', profileName: 'Other' }],
              },
            },
          },
          // A binding without profileName/fields - covers the `?? ''` and
          // `?? []` defaults in the alias/source mapping.
          {
            id: 'log-4',
            data: {
              label: 'Log 4',
              config: {
                profileBindings: [{ profileId: 'prof-3', alias: 'minimal' }],
              },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      const top = result.current.availableVariablesForManager.find((v) => v.name === 'cpr')
      expect(top).toBeDefined()
      expect(top!.source).toBe('Profile: Staging API')

      const dottedHost = result.current.availableVariablesForManager.find(
        (v) => v.name === 'cpr.host',
      )
      expect(dottedHost).toBeDefined()
      expect(dottedHost!.source).toBe('Profile: Staging API')

      const dottedPort = result.current.availableVariablesForManager.find(
        (v) => v.name === 'cpr.port',
      )
      expect(dottedPort).toBeDefined()

      // The aliasless binding contributed nothing.
      expect(
        result.current.availableVariablesForManager.find((v) => v.name === ''),
      ).toBeUndefined()

      // The minimal binding (no profileName, no fields) is still tracked but
      // with an empty source string and no dotted entries.
      const minimal = result.current.availableVariablesForManager.find(
        (v) => v.name === 'minimal',
      )
      expect(minimal).toBeDefined()
      expect(minimal!.source).toBe('Profile: ')
      expect(
        result.current.availableVariablesForManager.find((v) => v.name === 'minimal.host'),
      ).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // displayVariables (definition only) and runtimeValues (overlay map)
  // -------------------------------------------------------------------------
  describe('displayVariables and runtimeValues', () => {
    it('returns workflow variables unchanged regardless of runtime values', () => {
      const vars = [makeVariable({ id: 'v1', name: 'my_var', value: 'original' })]
      setupStore({ variables: vars })
      const { result } = renderVarManagement()

      expect(result.current.displayVariables).toBe(vars)
    })

    it('exposes runtimeValues as a separate map (panel applies overlay per row)', () => {
      const vars = [
        makeVariable({ id: 'v1', name: 'var_a', value: 'original_a' }),
        makeVariable({ id: 'v2', name: 'var_b', value: 'original_b' }),
      ]
      mockRuntimeValues = new Map([['var_a', 'runtime_a']])
      setupStore({ variables: vars })
      const { result } = renderVarManagement()

      // displayVariables stays as definitions
      expect(result.current.displayVariables[0].value).toBe('original_a')
      expect(result.current.displayVariables[1].value).toBe('original_b')
      // runtimeValues carries the runtime overlay separately
      expect(result.current.runtimeValues.get('var_a')).toBe('runtime_a')
      expect(result.current.runtimeValues.has('var_b')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // handleCreateVariable
  // -------------------------------------------------------------------------
  describe('handleCreateVariable', () => {
    it('delegates to addVariable on the store', () => {
      const store = setupStore()
      const { result } = renderVarManagement()

      const newVar = { name: 'new_var', type: 'string' as const, value: 'hello' }

      let saveResult: { success: boolean; error?: string } | undefined
      act(() => {
        saveResult = result.current.handleCreateVariable(newVar)
      })

      expect(store.addVariable).toHaveBeenCalledWith(newVar)
      expect(saveResult).toEqual({ success: true })
    })

    it('returns {success:false, error} when addVariable throws (e.g. name collision in scope)', () => {
      const store = setupStore({
        addVariable: vi.fn().mockImplementation(() => {
          throw new Error('Name "dup" already exists in this scope')
        }),
      })
      const { result } = renderVarManagement()

      let saveResult: { success: boolean; error?: string } | undefined
      act(() => {
        saveResult = result.current.handleCreateVariable({
          name: 'dup',
          type: 'string' as const,
          value: 'x',
        })
      })

      expect(store.addVariable).toHaveBeenCalled()
      expect(saveResult).toEqual({
        success: false,
        error: 'Name "dup" already exists in this scope',
      })
    })

    it('returns {success:false, error: stringified throwable} when addVariable throws a non-Error', () => {
      setupStore({
        addVariable: vi.fn().mockImplementation(() => {
          throw 'string-error'
        }),
      })
      const { result } = renderVarManagement()

      let saveResult: { success: boolean; error?: string } | undefined
      act(() => {
        saveResult = result.current.handleCreateVariable({
          name: 'x',
          type: 'string' as const,
          value: 'v',
        })
      })

      expect(saveResult).toEqual({ success: false, error: 'string-error' })
    })

    it('returns a cycle error and does not add the variable when the create introduces a self-reference', () => {
      // The new variable references itself in its computed expression. The
      // cycle gate must reject before addVariable is called so the in-store
      // state never sees the malformed entry.
      const store = setupStore()
      const { result } = renderVarManagement()

      const cycleVar = {
        name: 'a',
        type: 'integer' as const,
        value: 'a + 1',
        isExpression: true,
      }

      let saveResult: { success: boolean; error?: string } | undefined
      act(() => {
        saveResult = result.current.handleCreateVariable(cycleVar)
      })

      expect(saveResult).toEqual({
        success: false,
        error: "Circular reference detected for variable 'a': a -> a",
      })
      expect(store.addVariable).not.toHaveBeenCalled()
    })

    it('returns a cycle error when creating a variable that closes a chain with an existing variable', () => {
      // Existing variable b is a literal. Adding a computed `b + 1` for
      // b would replace it - but here we add a new variable referencing b
      // and b references the new one, forming a cycle through merge.
      const existing = [
        makeVariable({
          id: 'v1',
          name: 'b',
          type: 'integer',
          value: 'a + 1',
          isExpression: true,
        }),
      ]
      const store = setupStore({ variables: existing })
      const { result } = renderVarManagement()

      const newVar = {
        name: 'a',
        type: 'integer' as const,
        value: 'b + 1',
        isExpression: true,
      }

      let saveResult: { success: boolean; error?: string } | undefined
      act(() => {
        saveResult = result.current.handleCreateVariable(newVar)
      })

      expect(saveResult?.success).toBe(false)
      expect(saveResult?.error).toMatch(
        /^Circular reference detected for variable '(a|b)':/,
      )
      expect(store.addVariable).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // validateExpressionCycle
  // -------------------------------------------------------------------------
  describe('validateExpressionCycle', () => {
    it('returns null when isExpression is false', () => {
      setupStore()
      const { result } = renderVarManagement()

      const cycleResult = result.current.validateExpressionCycle({
        variableName: 'x',
        value: 'x + 1',
        isExpression: false,
      })

      expect(cycleResult).toBeNull()
    })

    it('returns null when value is not a string', () => {
      setupStore()
      const { result } = renderVarManagement()

      const cycleResult = result.current.validateExpressionCycle({
        variableName: 'x',
        value: 42,
        isExpression: true,
      })

      expect(cycleResult).toBeNull()
    })

    it('detects a self-reference in CREATE flow (variableId undefined)', () => {
      setupStore()
      const { result } = renderVarManagement()

      const cycleResult = result.current.validateExpressionCycle({
        variableName: 'a',
        value: 'a + 1',
        isExpression: true,
      })

      expect(cycleResult).toBe(
        "Circular reference detected for variable 'a': a -> a",
      )
    })

    it('detects a self-reference in EDIT flow (variableId provided, replaces existing)', () => {
      const existing = [
        makeVariable({
          id: 'v1',
          name: 'a',
          type: 'integer',
          value: 1,
          isExpression: false,
        }),
      ]
      setupStore({ variables: existing })
      const { result } = renderVarManagement()

      // Same id, but now isExpression=true with self-reference
      const cycleResult = result.current.validateExpressionCycle({
        variableId: 'v1',
        variableName: 'a',
        value: 'a + 1',
        isExpression: true,
      })

      expect(cycleResult).toBe(
        "Circular reference detected for variable 'a': a -> a",
      )
    })

    it('returns null in EDIT flow when the change is acyclic', () => {
      const existing = [
        makeVariable({
          id: 'v1',
          name: 'a',
          type: 'integer',
          value: 1,
          isExpression: false,
        }),
      ]
      setupStore({ variables: existing })
      const { result } = renderVarManagement()

      const cycleResult = result.current.validateExpressionCycle({
        variableId: 'v1',
        variableName: 'a',
        value: '1 + 1',
        isExpression: true,
      })

      expect(cycleResult).toBeNull()
    })

    it('returns null in CREATE flow when the new variable is acyclic', () => {
      const existing = [
        makeVariable({ id: 'v1', name: 'b', type: 'integer', value: 5 }),
      ]
      setupStore({ variables: existing })
      const { result } = renderVarManagement()

      const cycleResult = result.current.validateExpressionCycle({
        variableName: 'a',
        value: 'b + 1',
        isExpression: true,
      })

      expect(cycleResult).toBeNull()
    })

    it('detects a cycle in EDIT flow with multiple existing variables (preserves untouched ones)', () => {
      // Two variables; edit one to introduce a cycle. The other variable
      // is preserved as-is in the post-edit list, exercising the
      // "no replace" branch of the validator's variable map.
      const existing = [
        makeVariable({
          id: 'v1',
          name: 'b',
          type: 'integer',
          value: 'a + 1',
          isExpression: true,
        }),
        makeVariable({
          id: 'v2',
          name: 'a',
          type: 'integer',
          value: 1,
          isExpression: false,
        }),
      ]
      setupStore({ variables: existing })
      const { result } = renderVarManagement()

      // Edit v2 (a) to reference b - this closes a cycle a -> b -> a.
      const cycleResult = result.current.validateExpressionCycle({
        variableId: 'v2',
        variableName: 'a',
        value: 'b + 1',
        isExpression: true,
      })

      expect(cycleResult).toBe(
        "Circular reference detected for variable 'a': a -> b -> a",
      )
    })
  })

  // -------------------------------------------------------------------------
  // handleVariableDelete
  // -------------------------------------------------------------------------
  describe('handleVariableDelete', () => {
    it('prompts confirmation even when not bound or referenced (always-confirm contract)', () => {
      const vars = [makeVariable({ id: 'v1', name: 'lonely_var' })]
      const store = setupStore({ variables: vars })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })

      // No store mutation yet - user must confirm in the dialog first.
      expect(store.removeVariable).not.toHaveBeenCalled()
      expect(result.current.pendingDeleteVarId).toBe('v1')
      expect(result.current.pendingDeleteDescription).toContain('cannot be undone')
    })

    it('does nothing for nonexistent variable', () => {
      const store = setupStore({ variables: [] })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('nonexistent')
      })

      expect(store.removeVariable).not.toHaveBeenCalled()
    })

    it('prompts confirmation for output-bound variable', () => {
      const vars = [makeVariable({ id: 'v1', name: 'bound_var' })]
      const store = setupStore({
        variables: vars,
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'HTTP Request',
              config: { outputBindings: { response: 'bound_var' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })

      // Should NOT immediately remove
      expect(store.removeVariable).not.toHaveBeenCalled()

      // Should set pending delete state
      expect(result.current.pendingDeleteVarId).toBe('v1')
      expect(result.current.pendingDeleteDescription).toContain('1 block')
      expect(result.current.pendingDeleteDescription).toContain('HTTP Request')
      expect(result.current.pendingDeleteDescription).toContain('bindings will be cleared')
    })

    it('prompts confirmation for input-referenced variable', () => {
      const vars = [makeVariable({ id: 'v1', name: 'ref_var' })]
      const store = setupStore({
        variables: vars,
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Consumer',
              expressionFields: ['expr'],
              config: { values: { expr: 'ref_var + 1' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })

      expect(store.removeVariable).not.toHaveBeenCalled()
      expect(result.current.pendingDeleteVarId).toBe('v1')
      expect(result.current.pendingDeleteDescription).toContain('references will become unresolved')
    })

    it('uses plural form for multiple output-bound blocks', () => {
      const vars = [makeVariable({ id: 'v1', name: 'multi_bound' })]
      setupStore({
        variables: vars,
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Node A',
              config: { outputBindings: { out: 'multi_bound' } },
            },
          },
          {
            id: 'n2',
            data: {
              label: 'Node B',
              config: { outputBindings: { result: 'multi_bound' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })

      expect(result.current.pendingDeleteDescription).toContain('2 blocks')
      expect(result.current.pendingDeleteDescription).toContain('Node A, Node B')
    })

    it('describes input-param delete with usedCount > 1 (plural "blocks")', () => {
      // Two inner references -> "2 blocks" copy variant.
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: {
              nodes: [
                {
                  id: 'inner-log-a',
                  data: {
                    label: 'Log A',
                    expressionFields: ['message'],
                    config: { values: { message: 'user_id' } },
                  },
                },
                {
                  id: 'inner-log-b',
                  data: {
                    label: 'Log B',
                    expressionFields: ['message'],
                    config: { values: { message: 'user_id' } },
                  },
                },
              ],
              edges: [],
            },
            inputs: [{ name: 'user_id', type: 'string' }],
            outputs: [],
            variables: [],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('param:input:user_id')
      })

      expect(result.current.pendingDeleteDescription).toContain('2 blocks')
      expect(result.current.pendingDeleteDescription).toContain('references will become unresolved')
    })

    it('describes plain variable delete with usedCount > 1 (plural "blocks")', () => {
      // Two root-level log nodes referencing the same variable.
      const vars = [makeVariable({ id: 'v1', name: 'shared_ref' })]
      setupStore({
        variables: vars,
        nodes: [
          {
            id: 'log-a',
            data: {
              label: 'Log A',
              expressionFields: ['message'],
              config: { values: { message: 'shared_ref' } },
            },
          },
          {
            id: 'log-b',
            data: {
              label: 'Log B',
              expressionFields: ['message'],
              config: { values: { message: 'shared_ref' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })

      expect(result.current.pendingDeleteDescription).toContain('2 blocks')
      expect(result.current.pendingDeleteDescription).toContain('references will become unresolved')
    })

    it('describes input-param delete with usedCount === 1 (singular "block")', () => {
      // Single inner reference -> "1 block" copy variant.
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: {
              nodes: [
                {
                  id: 'inner-log-a',
                  data: {
                    label: 'Log',
                    expressionFields: ['message'],
                    config: { values: { message: 'user_id' } },
                  },
                },
              ],
              edges: [],
            },
            inputs: [{ name: 'user_id', type: 'string' }],
            outputs: [],
            variables: [],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('param:input:user_id')
      })

      expect(result.current.pendingDeleteDescription).toContain('1 block ')
      expect(result.current.pendingDeleteDescription).not.toContain('1 blocks ')
      expect(result.current.pendingDeleteDescription).toContain('references will become unresolved')
    })

    it('describes output-param delete with boundCount > 1 (plural "blocks")', () => {
      // Two inner nodes bind the same output -> "2 blocks" copy variant.
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: {
              nodes: [
                {
                  id: 'inner-1',
                  data: { label: 'Plugin A', config: { outputBindings: { x: 'result' } } },
                },
                {
                  id: 'inner-2',
                  data: { label: 'Plugin B', config: { outputBindings: { y: 'result' } } },
                },
              ],
              edges: [],
            },
            inputs: [],
            outputs: [{ name: 'result', type: 'integer' }],
            variables: [],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('param:output:result')
      })

      expect(result.current.pendingDeleteDescription).toContain('2 blocks')
      expect(result.current.pendingDeleteDescription).toContain('Plugin A')
      expect(result.current.pendingDeleteDescription).toContain('Plugin B')
    })

    it('describes output-param delete with usedCount > 1 (plural "blocks")', () => {
      // Two inner expressions reference the output name -> "2 blocks".
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: {
              nodes: [
                {
                  id: 'log-a',
                  data: {
                    label: 'Log A',
                    expressionFields: ['message'],
                    config: { values: { message: 'result' } },
                  },
                },
                {
                  id: 'log-b',
                  data: {
                    label: 'Log B',
                    expressionFields: ['message'],
                    config: { values: { message: 'result' } },
                  },
                },
              ],
              edges: [],
            },
            inputs: [],
            outputs: [{ name: 'result', type: 'integer' }],
            variables: [],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('param:output:result')
      })

      expect(result.current.pendingDeleteDescription).toContain('2 blocks')
      expect(result.current.pendingDeleteDescription).toContain('references will become unresolved')
    })

    it('describes plain variable delete with usedCount === 1 (singular "block")', () => {
      // Single inner reference to a root variable -> "1 block" copy.
      const vars = [makeVariable({ id: 'v1', name: 'one_used' })]
      setupStore({
        variables: vars,
        nodes: [
          {
            id: 'log-1',
            data: {
              label: 'Log',
              expressionFields: ['message'],
              config: { values: { message: 'one_used' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })

      expect(result.current.pendingDeleteDescription).toContain('1 block ')
      expect(result.current.pendingDeleteDescription).not.toContain('1 blocks ')
    })

    it('prompts confirmation for a Function input parameter (deferred removeInputParam call)', () => {
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            inputs: [{ name: 'user_id', type: 'string' }],
            outputs: [],
            variables: [],
          },
        },
      }
      const store = setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('param:input:user_id')
      })

      // No store mutation yet - the dialog must be confirmed first.
      expect(store.removeInputParam).not.toHaveBeenCalled()
      expect(store.removeVariable).not.toHaveBeenCalled()
      expect(store.removeOutputParam).not.toHaveBeenCalled()
      expect(result.current.pendingDeleteVarId).toBe('param:input:user_id')
    })

    it('prompts confirmation for a Function output parameter (deferred removeOutputParam call)', () => {
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            inputs: [],
            outputs: [{ name: 'result', type: 'integer' }],
            variables: [],
          },
        },
      }
      const store = setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('param:output:result')
      })

      expect(store.removeOutputParam).not.toHaveBeenCalled()
      expect(store.removeVariable).not.toHaveBeenCalled()
      expect(store.removeInputParam).not.toHaveBeenCalled()
      expect(result.current.pendingDeleteVarId).toBe('param:output:result')
    })

    it('prompts confirmation for a Function-local variable (deferred removeVariable call)', () => {
      const localVar = makeVariable({ id: 'lv1', name: 'tmp', type: 'integer', value: 0 })
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            inputs: [],
            outputs: [],
            variables: [localVar],
          },
        },
      }
      const store = setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([localVar]),
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('lv1')
      })

      expect(store.removeVariable).not.toHaveBeenCalled()
      expect(store.removeInputParam).not.toHaveBeenCalled()
      expect(store.removeOutputParam).not.toHaveBeenCalled()
      expect(result.current.pendingDeleteVarId).toBe('lv1')
    })

    it('describes output-param delete with boundCount > 0 ("bindings will be cleared")', () => {
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: {
              nodes: [
                {
                  id: 'inner-1',
                  data: { label: 'Source Plugin', config: { outputBindings: { x: 'result' } } },
                },
              ],
              edges: [],
            },
            inputs: [],
            outputs: [{ name: 'result', type: 'integer' }],
            variables: [],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('param:output:result')
      })

      expect(result.current.pendingDeleteDescription).toContain('1 block')
      expect(result.current.pendingDeleteDescription).toContain('Source Plugin')
      expect(result.current.pendingDeleteDescription).toContain('bindings will be cleared')
    })

    it('describes plain variable delete with usedCount > 0 ("references will become unresolved")', () => {
      const vars = [makeVariable({ id: 'v1', name: 'ref_var' })]
      setupStore({
        variables: vars,
        nodes: [
          {
            id: 'log-1',
            data: {
              label: 'Log',
              expressionFields: ['message'],
              config: { values: { message: 'ref_var' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })

      expect(result.current.pendingDeleteDescription).toContain('used by')
      expect(result.current.pendingDeleteDescription).toContain('references will become unresolved')
    })

    it('describes plain variable delete with no refs ("permanently removed")', () => {
      const vars = [makeVariable({ id: 'v1', name: 'unused' })]
      setupStore({ variables: vars, nodes: [] })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })

      expect(result.current.pendingDeleteDescription).toBe(
        'This action cannot be undone. The variable will be permanently removed.',
      )
    })

    it('describes output-param delete with usedCount > 0 but no bindings ("references will become unresolved")', () => {
      // Output param `result` is referenced from an expression field on an
      // inner plugin (no outputBindings consumer). boundCount=0 + usedCount=1.
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: {
              nodes: [
                {
                  id: 'inner-log',
                  data: {
                    label: 'Log',
                    expressionFields: ['message'],
                    config: { values: { message: 'result' } },
                  },
                },
              ],
              edges: [],
            },
            inputs: [],
            outputs: [{ name: 'result', type: 'integer' }],
            variables: [],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('param:output:result')
      })

      expect(result.current.pendingDeleteDescription).toContain('used by')
      expect(result.current.pendingDeleteDescription).toContain('references will become unresolved')
    })

    it('describes output-param delete with no refs ("permanently removed from the Function")', () => {
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            inputs: [],
            outputs: [{ name: 'spare', type: 'integer' }],
            variables: [],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('param:output:spare')
      })

      expect(result.current.pendingDeleteDescription).toBe(
        'This action cannot be undone. The output parameter will be permanently removed from the Function.',
      )
    })
  })

  // -------------------------------------------------------------------------
  // confirmVariableDelete
  // -------------------------------------------------------------------------
  describe('confirmVariableDelete', () => {
    it('does nothing when pendingDeleteVarId is null', () => {
      const store = setupStore()
      const { result } = renderVarManagement()

      act(() => {
        result.current.confirmVariableDelete()
      })

      expect(store.removeVariable).not.toHaveBeenCalled()
    })

    it('removes variable and clears pending state', () => {
      const vars = [makeVariable({ id: 'v1', name: 'bound_var' })]
      const store = setupStore({
        variables: vars,
        nodes: [
          {
            id: 'n1',
            data: {
              label: 'Source',
              config: { outputBindings: { out: 'bound_var' } },
            },
          },
        ],
      })
      const { result } = renderVarManagement()

      // Trigger pending delete
      act(() => {
        result.current.handleVariableDelete('v1')
      })
      expect(result.current.pendingDeleteVarId).toBe('v1')

      // Confirm delete
      act(() => {
        result.current.confirmVariableDelete()
      })

      expect(store.removeVariable).toHaveBeenCalledWith('v1')
      expect(result.current.pendingDeleteVarId).toBeNull()
      expect(result.current.pendingDeleteDescription).toBe('')
    })

    it('cleans output bindings in nodes referencing the deleted variable', () => {
      const vars = [makeVariable({ id: 'v1', name: 'clean_me' })]
      const nodesWithBindings = [
        {
          id: 'n1',
          data: {
            label: 'Bound Node',
            config: {
              outputBindings: { response: 'clean_me', status: 'keep_me' },
            },
          },
        },
        {
          id: 'n2',
          data: {
            label: 'Unrelated',
            config: {
              outputBindings: { out: 'keep_me' },
            },
          },
        },
      ]
      const store = setupStore({ variables: vars, nodes: nodesWithBindings })
      const { result } = renderVarManagement()

      // Trigger + confirm
      act(() => {
        result.current.handleVariableDelete('v1')
      })
      act(() => {
        result.current.confirmVariableDelete()
      })

      expect(store.setNodes).toHaveBeenCalledOnce()
      const updatedNodes = store.setNodes.mock.calls[0][0]
      // First node: binding for 'clean_me' cleared to ''
      expect(updatedNodes[0].data.config.outputBindings.response).toBe('')
      expect(updatedNodes[0].data.config.outputBindings.status).toBe('keep_me')
      // Second node unchanged
      expect(updatedNodes[1].data.config.outputBindings.out).toBe('keep_me')
    })

    it('handles self-bound entries (query aliases) by removing query and type', () => {
      const vars = [makeVariable({ id: 'v1', name: 'query_alias' })]
      const nodesWithSelfBound = [
        {
          id: 'n1',
          data: {
            label: 'XML Parser',
            config: {
              outputBindings: { query_alias: 'query_alias' },
              values: {
                queries: { query_alias: '//xpath', other_query: '//other' },
                query_output_types: { query_alias: 'string', other_query: 'integer' },
              },
            },
          },
        },
      ]
      const store = setupStore({ variables: vars, nodes: nodesWithSelfBound })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })
      act(() => {
        result.current.confirmVariableDelete()
      })

      expect(store.setNodes).toHaveBeenCalledOnce()
      const updated = store.setNodes.mock.calls[0][0]
      // Self-bound entry should be removed entirely from bindings
      expect(updated[0].data.config.outputBindings).toEqual({})
      // Query and type should be removed from values
      expect(updated[0].data.config.values.queries).toEqual({ other_query: '//other' })
      expect(updated[0].data.config.values.query_output_types).toEqual({ other_query: 'integer' })
    })

    it('removes a self-bound query that declares no output types', () => {
      const vars = [makeVariable({ id: 'v1', name: 'query_alias' })]
      const parser = {
        id: 'n1',
        data: {
          label: 'JSON Parser',
          config: {
            outputBindings: { query_alias: 'query_alias' },
            values: { queries: { query_alias: '$.x', other_query: '$.y' } },
          },
        },
      }
      const store = setupStore({ variables: vars, nodes: [parser] })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })
      act(() => {
        result.current.confirmVariableDelete()
      })

      const updated = store.setNodes.mock.calls[0][0]
      expect(updated[0].data.config.values.queries).toEqual({ other_query: '$.y' })
      expect(updated[0].data.config.values.query_output_types).toEqual({})
    })

    it('clears a same-named script variable binding instead of removing it', () => {
      const vars = [makeVariable({ id: 'v1', name: 'STATUS' })]
      const nodesWithSameName = [
        {
          id: 'n1',
          data: {
            label: 'Shell Script',
            config: {
              outputBindings: { STATUS: 'STATUS', stdout: 'log_text' },
              values: { script: 'STATUS=ok' },
            },
          },
        },
      ]
      const store = setupStore({ variables: vars, nodes: nodesWithSameName })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })
      act(() => {
        result.current.confirmVariableDelete()
      })

      expect(store.setNodes).toHaveBeenCalledOnce()
      const updated = store.setNodes.mock.calls[0][0]
      // The script variable name is the block's own: the row stays, unbound
      expect(updated[0].data.config.outputBindings).toEqual({ STATUS: '', stdout: 'log_text' })
      expect(updated[0].data.config.values).toEqual({ script: 'STATUS=ok' })
    })

    it('clears a same-named binding that is not one of the node query aliases', () => {
      const vars = [makeVariable({ id: 'v1', name: 'STATUS' })]
      const nodesWithOtherAlias = [
        {
          id: 'n1',
          data: {
            label: 'JSON Parser',
            config: {
              outputBindings: { STATUS: 'STATUS' },
              values: { queries: { other_query: '$.y' } },
            },
          },
        },
      ]
      const store = setupStore({ variables: vars, nodes: nodesWithOtherAlias })
      const { result } = renderVarManagement()

      act(() => {
        result.current.handleVariableDelete('v1')
      })
      act(() => {
        result.current.confirmVariableDelete()
      })

      expect(store.setNodes).toHaveBeenCalledOnce()
      const updated = store.setNodes.mock.calls[0][0]
      expect(updated[0].data.config.outputBindings).toEqual({ STATUS: '' })
      expect(updated[0].data.config.values.queries).toEqual({ other_query: '$.y' })
    })

  })

  // -------------------------------------------------------------------------
  // Dialog state management
  // -------------------------------------------------------------------------
  describe('pending-delete state management', () => {
    it('setPendingDeleteVarId and setPendingDeleteDescription update state', () => {
      setupStore()
      const { result } = renderVarManagement()

      act(() => {
        result.current.setPendingDeleteVarId('v1')
        result.current.setPendingDeleteDescription('About to delete')
      })

      expect(result.current.pendingDeleteVarId).toBe('v1')
      expect(result.current.pendingDeleteDescription).toBe('About to delete')
    })

    it('cancelPendingDelete clears all three pending-delete fields', () => {
      setupStore()
      const { result } = renderVarManagement()

      act(() => {
        result.current.setPendingDeleteVarId('v1')
        result.current.setPendingDeleteVarName('myvar')
        result.current.setPendingDeleteDescription('About to delete')
      })
      expect(result.current.pendingDeleteVarId).toBe('v1')
      expect(result.current.pendingDeleteVarName).toBe('myvar')
      expect(result.current.pendingDeleteDescription).toBe('About to delete')

      act(() => {
        result.current.cancelPendingDelete()
      })
      expect(result.current.pendingDeleteVarId).toBeNull()
      expect(result.current.pendingDeleteVarName).toBe('')
      expect(result.current.pendingDeleteDescription).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // recentlyChangedPaths passthrough
  // -------------------------------------------------------------------------
  describe('recentlyChangedPaths', () => {
    it('passes through from useVariableUpdates', () => {
      mockRecentlyChangedPaths = new Set(['var_a', 'var_b'])
      setupStore()
      const { result } = renderVarManagement()

      expect(result.current.recentlyChangedPaths).toEqual(new Set(['var_a', 'var_b']))
    })
  })

  // -------------------------------------------------------------------------
  // Drilled-in displayVariables synthesis
  // -------------------------------------------------------------------------
  describe('displayVariables under drill', () => {
    it('synthesizes input + output Variable rows from the Function localDefinition', () => {
      const fnNode = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            inputs: [{ name: 'user_id', type: 'string' }],
            outputs: [{ name: 'result', type: 'string' }],
            variables: [{ id: 'lv1', name: 'tmp', value: 0, type: 'integer' }],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
        getActiveVariables: vi.fn().mockReturnValue([
          { id: 'lv1', name: 'tmp', value: 0, type: 'integer' },
        ]),
      })
      const { result } = renderVarManagement()

      const names = result.current.displayVariables.map((v) => v.name).sort()
      expect(names).toEqual(['result', 'tmp', 'user_id'])
    })

    it('returns empty list when drillPath references a missing node (defensive)', () => {
      setupStore({
        nodes: [],
        drillPath: [{ nodeId: 'ghost', label: 'Ghost' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()
      expect(result.current.displayVariables).toEqual([])
    })

    it('returns empty list when a drill entry is a non-Function node (walkActiveSubtree throws)', () => {
      setupStore({
        nodes: [
          { id: 'plug-1', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Log', nodeType: 'plugin', elementType: 'log' } },
        ],
        drillPath: [{ nodeId: 'plug-1', label: 'Log' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()
      expect(result.current.displayVariables).toEqual([])
    })

    it('defaults param type to "string" when spec.type is missing or non-string', () => {
      const fnNode = {
        id: 'fn-3',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_3',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            // type missing entirely → rawType falls back to 'string'.
            inputs: [{ name: 'no_type' }, { name: 'numeric_type', type: 42 }],
            outputs: [],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-3', label: 'Function_3' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()
      const byName = new Map(result.current.displayVariables.map((v) => [v.name, v.type]))
      expect(byName.get('no_type')).toBe('string')
      expect(byName.get('numeric_type')).toBe('string')
    })

    it('treats getActiveVariables() returning null as empty list (defensive)', () => {
      const fnNode = {
        id: 'fn-4',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_4',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            inputs: [{ name: 'x', type: 'string' }],
            outputs: [],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-4', label: 'Function_4' }],
        // Force null to exercise the `?? []` fallback.
        getActiveVariables: vi.fn().mockReturnValue(null),
      })
      const { result } = renderVarManagement()
      expect(result.current.displayVariables.map((v) => v.name)).toEqual(['x'])
    })

    it('handles param specs with non-standard types by defaulting to string', () => {
      const fnNode = {
        id: 'fn-2',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_2',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            // Mix: integer matches WorkflowVariable['type'], 'datetime' does not.
            // Param specs missing `name` are filtered out entirely.
            inputs: [
              { name: 'count', type: 'integer' },
              { name: 'when', type: 'datetime' },
              { type: 'string' },
            ],
            outputs: [],
          },
        },
      }
      setupStore({
        nodes: [fnNode],
        drillPath: [{ nodeId: 'fn-2', label: 'Function_2' }],
        getActiveVariables: vi.fn().mockReturnValue([]),
      })
      const { result } = renderVarManagement()
      const byName = new Map(result.current.displayVariables.map((v) => [v.name, v.type]))
      expect(byName.get('count')).toBe('integer')
      expect(byName.get('when')).toBe('string')
      expect(byName.size).toBe(2)
    })
  })

  describe('handleCreateParameter routing', () => {
    it('delegates to addVariable in variable mode (preserves cycle-detection path)', () => {
      const store = setupStore()
      const { result } = renderVarManagement()
      const res = result.current.handleCreateParameter('variable', {
        name: 'x',
        type: 'string',
        value: 'hello',
      })
      expect(res.success).toBe(true)
      expect(store.addVariable).toHaveBeenCalledWith({
        name: 'x',
        type: 'string',
        value: 'hello',
        isSecret: undefined,
      })
      expect(store.addInputParam).not.toHaveBeenCalled()
      expect(store.addOutputParam).not.toHaveBeenCalled()
    })

    it('writes to addInputParam in input mode with the required flag and keeps its default (VMGR-113)', () => {
      const store = setupStore()
      const { result } = renderVarManagement()
      const res = result.current.handleCreateParameter('input', {
        name: 'username',
        type: 'string',
        value: 'admin',
        required: true,
      })
      expect(res.success).toBe(true)
      expect(store.addInputParam).toHaveBeenCalledWith({
        name: 'username',
        type: 'string',
        required: true,
        default: 'admin',
      })
    })

    it('gives a parameter its type default when the create dialog left the body untouched', () => {
      const store = setupStore()
      const { result } = renderVarManagement()
      result.current.handleCreateParameter('input', {
        name: 'recipient',
        type: 'array',
      })
      expect(store.addInputParam).toHaveBeenCalledWith({
        name: 'recipient',
        type: 'array',
        default: [],
      })
    })

    it('writes to addOutputParam in output mode (no required flag emitted)', () => {
      const store = setupStore()
      const { result } = renderVarManagement()
      const res = result.current.handleCreateParameter('output', {
        name: 'result',
        type: 'integer',
        value: 0,
      })
      expect(res.success).toBe(true)
      expect(store.addOutputParam).toHaveBeenCalledWith({
        name: 'result',
        type: 'integer',
        default: 0,
      })
    })

    it('attaches secret=true to ParamSpec when the dialog flagged it, with no default (VMGR-103)', () => {
      const store = setupStore()
      const { result } = renderVarManagement()
      result.current.handleCreateParameter('input', {
        name: 'token',
        type: 'string',
        value: '',
        secret: true,
      })
      expect(store.addInputParam).toHaveBeenCalledWith({
        name: 'token',
        type: 'string',
        secret: true,
      })
    })

    it('forwards isTemplate to addVariable for a template variable', () => {
      const store = setupStore()
      const { result } = renderVarManagement()
      result.current.handleCreateParameter('variable', {
        name: 'greeting_tmpl',
        type: 'string',
        value: 'Hi {{ name }}',
        isTemplate: true,
      })
      expect(store.addVariable).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'greeting_tmpl', isTemplate: true }),
      )
    })

    it('threads the description onto an input ParamSpec', () => {
      const store = setupStore()
      const { result } = renderVarManagement()
      result.current.handleCreateParameter('input', {
        name: 'base_path',
        type: 'string',
        value: '/api',
        description: 'Base path for all requests',
      })
      expect(store.addInputParam).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Base path for all requests' }),
      )
    })

    it('stores an enum input as its value type with its allowed values and default (VMGR-112)', () => {
      const store = setupStore()
      const { result } = renderVarManagement()
      result.current.handleCreateParameter('input', {
        name: 'levels',
        type: 'string',
        value: 'a',
        required: true,
        enumValues: ['a', 'b'],
      })
      expect(store.addInputParam).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'string', required: true, enumValues: ['a', 'b'], default: 'a' }),
      )
      expect(store.addInputParam.mock.calls[0][0]).not.toHaveProperty('enumValueType')
    })

    it('returns success=false with the thrown error when the param store action throws', () => {
      const store = setupStore({
        addInputParam: vi.fn().mockImplementation(() => {
          throw new Error('Cannot add input parameter outside a Function')
        }),
      })
      const { result } = renderVarManagement()
      const res = result.current.handleCreateParameter('input', {
        name: 'x',
        type: 'string',
        value: '',
      })
      expect(res.success).toBe(false)
      expect(res.error).toBe('Cannot add input parameter outside a Function')
      expect(store.addInputParam).toHaveBeenCalled()
    })

    it('returns success=false with a string-coerced message when the thrown value is not an Error', () => {
      setupStore({
        addOutputParam: vi.fn().mockImplementation(() => {
          throw 'string-error'
        }),
      })
      const { result } = renderVarManagement()
      const res = result.current.handleCreateParameter('output', {
        name: 'r',
        type: 'string',
        value: '',
      })
      expect(res.success).toBe(false)
      expect(res.error).toBe('string-error')
    })
  })

  describe('a result the next block run evaluates again is dropped at the edit (REQ-3.2.1.5)', () => {
    const host = makeVariable({ id: 'v-host', name: 'host', value: 'b' })
    const url = makeVariable({ id: 'v-url', name: 'url', value: "'http://' + host", isExpression: true })
    const page = makeVariable({ id: 'v-page', name: 'page', value: '{{ url }}/host', isTemplate: true })
    const evaluated: Array<[string, unknown]> = [
      ['url', 'http://b'],
      ['page', 'http://b/host'],
    ]

    function afterARun(live = evaluated, nodes: unknown[] = []) {
      mockRuntimeValues = new Map<string, unknown>(live)
      setupStore({ variables: [host, url, page], nodes })
      return renderHook(() => useVariableManagement('sess-1', mockRegisterVariableHandler))
    }

    function editWithThePencil(hook: ReturnType<typeof afterARun>, variables: WorkflowVariable[]) {
      currentStore.variables = variables
      hook.rerender()
    }

    const dropped = () => mockForgetRuntimeValue.mock.calls.map(([name]) => name)

    it('drops the results that read a variable edited with the pencil', () => {
      const hook = afterARun()

      editWithThePencil(hook, [{ ...host, value: 'c' }, url, page])

      expect(dropped()).toEqual(['url', 'page'])
    })

    it('drops the result of a source edited with the pencil, and the one that reads it', () => {
      const hook = afterARun()

      editWithThePencil(hook, [host, { ...url, value: "'https://' + host" }, page])

      expect(dropped()).toEqual(['url', 'page'])
    })

    it('reads a template only inside its markers', () => {
      const hook = afterARun([['page', 'http://b/host']])

      editWithThePencil(hook, [{ ...host, value: 'c' }, url, page])

      expect(dropped()).toEqual([])
    })

    it('keeps the results when the edited variable holds a value the session gave it', () => {
      const hook = afterARun([...evaluated, ['host', 'from-a-block']])

      editWithThePencil(hook, [{ ...host, value: 'c' }, url, page])

      expect(dropped()).toEqual([])
    })

    it('keeps a value a block may have written into an expression variable', () => {
      const setter = {
        id: 'set',
        data: { elementType: 'variable-setter', config: { values: { variables: { url: "'x'" } } } },
      }
      const hook = afterARun(evaluated, [setter])

      editWithThePencil(hook, [{ ...host, value: 'c' }, url, page])

      expect(dropped()).toEqual([])
    })

    it('drops nothing while the variables stay as they are', () => {
      const hook = afterARun()

      hook.rerender()

      expect(dropped()).toEqual([])
    })
  })
})

describe('useVariableManagement - unsaved secret ids', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  it('marks a secret as unsaved when it is new or its value differs from the baseline', () => {
    setupStore({
      variables: [
        makeVariable({ id: 'new', name: 'new_secret', isSecret: true, value: 'a' }),
        makeVariable({ id: 'edited', name: 'edited_secret', isSecret: true, value: 'b2' }),
        makeVariable({ id: 'plain', name: 'plain', isSecret: false, value: 'c' }),
      ],
      getSavedVariables: vi
        .fn()
        .mockReturnValue([
          makeVariable({ id: 'edited', name: 'edited_secret', isSecret: true, value: 'b1' }),
        ]),
    })
    const { result } = renderVarManagement()
    expect(result.current.unsavedSecretIds.has('new_secret')).toBe(true) // absent from the baseline
    expect(result.current.unsavedSecretIds.has('edited_secret')).toBe(true) // value differs
    expect(result.current.unsavedSecretIds.has('plain')).toBe(false) // not a secret
  })

  it('never locks an unset secret - there is no stored value to protect', () => {
    const unset: WorkflowVariable = { id: 'unset', name: 'k8s_session', type: 'string', isSecret: true }
    setupStore({
      variables: [unset],
      getSavedVariables: vi.fn().mockReturnValue([unset]),
    })
    const { result } = renderVarManagement()
    expect(result.current.unsavedSecretIds.has('k8s_session')).toBe(true)
  })

  it('still locks a saved secret that holds a value', () => {
    const saved = makeVariable({ id: 'filled', name: 'token', isSecret: true, value: 'sk-1' })
    setupStore({
      variables: [saved],
      getSavedVariables: vi.fn().mockReturnValue([saved]),
    })
    const { result } = renderVarManagement()
    expect(result.current.unsavedSecretIds.has('token')).toBe(false)
  })
})

describe('useVariableManagement - changed secret ids (the "stays visible until you save" strip)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  it('marks a secret changed when it is new or its value differs from the saved Test', () => {
    setupStore({
      variables: [
        makeVariable({ id: 'new', name: 'new_secret', isSecret: true, value: 'a' }),
        makeVariable({ id: 'new_null', name: 'new_null', isSecret: true, value: null }),
        makeVariable({ id: 'edited', name: 'edited_secret', isSecret: true, value: 'b2' }),
        makeVariable({ id: 'plain', name: 'plain', isSecret: false, value: 'c' }),
      ],
      getSavedVariables: vi
        .fn()
        .mockReturnValue([
          makeVariable({ id: 'edited', name: 'edited_secret', isSecret: true, value: 'b1' }),
          makeVariable({ id: 'plain', name: 'plain', isSecret: false, value: 'c0' }),
        ]),
    })
    const { result } = renderVarManagement()
    expect([...result.current.changedSecretIds].sort()).toEqual(['edited_secret', 'new_null', 'new_secret'])
  })

  it('never marks an untouched saved null secret changed, while it stays unlocked', () => {
    const bound = makeVariable({ id: 'ssh', name: 'ssh_session', isSecret: true, value: null })
    setupStore({
      variables: [bound],
      getSavedVariables: vi.fn().mockReturnValue([{ ...bound }]),
    })
    const { result } = renderVarManagement()
    expect(result.current.changedSecretIds.has('ssh_session')).toBe(false)
    expect(result.current.unsavedSecretIds.has('ssh_session')).toBe(true)
  })

  it('drops a secret from the changed set once the Test is saved (the saved value equals it)', () => {
    const edited = makeVariable({ id: 'edited', name: 'token', isSecret: true, value: 'sk-2' })
    setupStore({
      variables: [edited],
      getSavedVariables: vi.fn().mockReturnValue([{ ...edited }]),
    })
    const { result } = renderVarManagement()
    expect(result.current.changedSecretIds.has('token')).toBe(false)
  })
})

describe('useVariableManagement - Function secrets follow the Test rule (keyed by scope)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  const PATH = ['fn-1']
  const key = (name: string) => scopedVariableKey(name, PATH)

  function localFunction(body: { variables?: WorkflowVariable[]; inputs?: unknown[]; outputs?: unknown[] }, lifecycle = 'local') {
    return {
      id: 'fn-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Fn',
        nodeType: 'function',
        functionLifecycle: lifecycle,
        localDefinition: {
          workflow: { nodes: [], edges: [] },
          inputs: body.inputs ?? [],
          outputs: body.outputs ?? [],
          variables: body.variables ?? [],
        },
      },
    }
  }

  const CURRENT = localFunction({
    variables: [
      makeVariable({ id: 'l1', name: 'loc_new', isSecret: true, value: 'x' }),
      makeVariable({ id: 'l2', name: 'loc_edit', isSecret: true, value: 'b2' }),
      makeVariable({ id: 'l3', name: 'loc_same', isSecret: true, value: 's' }),
      makeVariable({ id: 'l4', name: 'loc_null', isSecret: true, value: null }),
    ],
    inputs: [{ name: 'in_s', type: 'string', secret: true }],
    outputs: [{ name: 'out_s', type: 'string', secret: true, default: 'o2' }],
  })
  const SAVED = localFunction({
    variables: [
      makeVariable({ id: 'l2', name: 'loc_edit', isSecret: true, value: 'b1' }),
      makeVariable({ id: 'l3', name: 'loc_same', isSecret: true, value: 's' }),
      makeVariable({ id: 'l4', name: 'loc_null', isSecret: true, value: null }),
    ],
    inputs: [{ name: 'in_s', type: 'string', secret: true }],
    outputs: [{ name: 'out_s', type: 'string', secret: true, default: 'o1' }],
  })

  it('unlocks and marks changed a new or edited secret local or output of a Local Function against the saved Test', () => {
    setupStore({ nodes: [CURRENT], getSavedNodes: vi.fn().mockReturnValue([SAVED]) })
    const { result } = renderVarManagement()
    expect([...result.current.changedSecretIds].sort()).toEqual([key('loc_edit'), key('loc_new'), key('out_s')].sort())
    expect(result.current.unsavedSecretIds.has(key('loc_new'))).toBe(true)
    expect(result.current.unsavedSecretIds.has(key('out_s'))).toBe(true)
  })

  it('keeps a saved untouched secret local locked, and unlocks a null one and a secret input with no strip', () => {
    setupStore({ nodes: [CURRENT], getSavedNodes: vi.fn().mockReturnValue([SAVED]) })
    const { result } = renderVarManagement()
    expect(result.current.unsavedSecretIds.has(key('loc_same'))).toBe(false)
    expect(result.current.unsavedSecretIds.has(key('loc_null'))).toBe(true)
    expect(result.current.unsavedSecretIds.has(key('in_s'))).toBe(true)
    expect(result.current.changedSecretIds.has(key('loc_null'))).toBe(false)
    expect(result.current.changedSecretIds.has(key('in_s'))).toBe(false)
  })

  it('locks them again once the Test is saved (the saved Function body equals them)', () => {
    setupStore({ nodes: [CURRENT], getSavedNodes: vi.fn().mockReturnValue([CURRENT]) })
    const { result } = renderVarManagement()
    expect(result.current.changedSecretIds.size).toBe(0)
    expect(result.current.unsavedSecretIds.has(key('loc_new'))).toBe(false)
    expect(result.current.unsavedSecretIds.has(key('loc_null'))).toBe(true)
  })

  it('unlocks a secret output that has no default, and counts it unchanged when its saved one has none', () => {
    const noDefault = localFunction({ outputs: [{ name: 'out_none', type: 'string', secret: true }] })
    setupStore({ nodes: [noDefault], getSavedNodes: vi.fn().mockReturnValue([noDefault]) })
    const { result } = renderVarManagement()
    expect(result.current.unsavedSecretIds.has(key('out_none'))).toBe(true)
    expect(result.current.changedSecretIds.has(key('out_none'))).toBe(false)
  })

  it('treats every secret of a Local Function added since the last save as new', () => {
    setupStore({ nodes: [CURRENT], getSavedNodes: vi.fn().mockReturnValue([]) })
    const { result } = renderVarManagement()
    expect(result.current.changedSecretIds.has(key('loc_same'))).toBe(true)
  })
})

describe('useVariableManagement - the run-start baseline covers every scope (VMGR-19)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  it('snapshots the literals of a Function the canvas does not show when the run starts', () => {
    const fn = {
      id: 'fn-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Fn',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [], edges: [] },
          inputs: [{ name: 'region', type: 'string', default: 'eu' }],
          outputs: [],
          variables: [
            makeVariable({ id: 'l1', name: 'loc_n', type: 'integer', value: 5 }),
            makeVariable({ id: 'l2', name: 'loc_expr', value: 'loc_n * 2', isExpression: true }),
          ],
        },
      },
    }
    setupStore({ nodes: [fn], variables: [makeVariable({ id: 'v1', name: 'count', type: 'integer', value: 1 })] })
    const { result } = renderVarManagement('sess-1')
    expect(result.current.runStartSnapshot.get('count')).toBe(1)
    expect(result.current.runStartSnapshot.get(scopedVariableKey('loc_n', ['fn-1']))).toBe(5)
    expect(result.current.runStartSnapshot.get(scopedVariableKey('region', ['fn-1']))).toBe('eu')
    expect(result.current.runStartSnapshot.has(scopedVariableKey('loc_expr', ['fn-1']))).toBe(false)
  })
})

describe('useVariableManagement - Shared draft and library View secrets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  const BODY_SAVED = {
    workflow: { nodes: [], edges: [] },
    inputs: [],
    outputs: [],
    variables: [makeVariable({ id: 's1', name: 'tok_same', isSecret: true, value: 's' })],
  }
  const BODY_NOW = {
    ...BODY_SAVED,
    variables: [
      makeVariable({ id: 's1', name: 'tok_same', isSecret: true, value: 's' }),
      makeVariable({ id: 's2', name: 'tok_new', isSecret: true, value: 'x' }),
    ],
  }
  function sharedNode(id: string, data: Record<string, unknown>) {
    return { id, type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Fn', nodeType: 'function', functionLifecycle: 'shared', ...data } }
  }

  it('compares a Shared draft in a Test to its body in the saved Test (sealed with the Test save)', () => {
    setupStore({
      nodes: [sharedNode('sh-1', { editMode: true, draft: BODY_SAVED, localDefinition: BODY_NOW })],
      getSavedNodes: vi.fn().mockReturnValue([sharedNode('sh-1', { editMode: true, draft: BODY_SAVED })]),
    })
    const { result } = renderVarManagement()
    expect([...result.current.changedSecretIds]).toEqual([scopedVariableKey('tok_new', ['sh-1'])])
    expect(result.current.unsavedSecretIds.has(scopedVariableKey('tok_same', ['sh-1']))).toBe(false)
  })

  it('keeps a read-only Shared instance locked: only a null secret unlocks', () => {
    setupStore({ nodes: [sharedNode('sh-1', { localDefinition: BODY_NOW })] })
    const { result } = renderVarManagement()
    expect(result.current.changedSecretIds.size).toBe(0)
    expect(result.current.unsavedSecretIds.size).toBe(0)
  })

  it('compares the library View body to the body the View loaded, keyed without the View root', () => {
    setupStore({
      functionViewMode: { functionId: 'f1', version: '1.0.0', editable: false },
      nodes: [sharedNode('view-shared-root', { editMode: true, localDefinition: BODY_NOW })],
      functionViewBaseline: { nodeId: 'view-shared-root', body: BODY_SAVED },
    })
    const { result } = renderVarManagement()
    expect([...result.current.changedSecretIds]).toEqual(['tok_new'])
    expect(result.current.unsavedSecretIds.has('tok_same')).toBe(false)
  })

  it('reads a library View baseline that holds no Block list', () => {
    const { workflow: _workflow, ...savedWithoutBlocks } = BODY_SAVED
    setupStore({
      functionViewMode: { functionId: 'f1', version: '1.0.0', editable: false },
      nodes: [sharedNode('view-shared-root', { editMode: true, localDefinition: BODY_NOW })],
      functionViewBaseline: { nodeId: 'view-shared-root', body: savedWithoutBlocks },
    })
    const { result } = renderVarManagement()
    expect([...result.current.changedSecretIds]).toEqual(['tok_new'])
  })

  it('locks the library View secrets once the published body becomes its baseline', () => {
    setupStore({
      functionViewMode: { functionId: 'f1', version: '1.1.0', editable: false },
      nodes: [sharedNode('view-shared-root', { localDefinition: BODY_NOW })],
      functionViewBaseline: { nodeId: 'view-shared-root', body: BODY_NOW },
    })
    const { result } = renderVarManagement()
    expect(result.current.changedSecretIds.size).toBe(0)
    expect(result.current.unsavedSecretIds.has('tok_new')).toBe(false)
  })

  it('locks a secret local two levels deep in the library View once the published body is the baseline', () => {
    // A body read back from the library carries no ids, so the published one gets new ones.
    const innerFn = (value: string, id = 'l-tok') => ({
      id: 'fn-inner',
      data: {
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [], edges: [] },
          inputs: [],
          outputs: [],
          variables: [makeVariable({ id, name: 'tok', isSecret: true, value })],
        },
      },
    })
    const viewBody = (value: string, id?: string) => ({ workflow: { nodes: [innerFn(value, id)], edges: [] }, inputs: [], outputs: [], variables: [] })
    const key = scopedVariableKey('tok', ['fn-inner'])
    setupStore({
      functionViewMode: { functionId: 'f1', version: '1.0.0', editable: false },
      nodes: [sharedNode('view-shared-root', { localDefinition: viewBody('sk-new') })],
      functionViewBaseline: { nodeId: 'view-shared-root', body: viewBody('sk-old', 'var-tok-loaded') },
    })
    const before = renderVarManagement()
    expect(before.result.current.changedSecretIds.has(key)).toBe(true)
    before.unmount()

    setupStore({
      functionViewMode: { functionId: 'f1', version: '1.1.0', editable: false },
      nodes: [sharedNode('view-shared-root', { localDefinition: viewBody('sk-new') })],
      functionViewBaseline: { nodeId: 'view-shared-root', body: viewBody('sk-new', 'var-tok-published') },
    })
    const after = renderVarManagement()
    expect(after.result.current.changedSecretIds.has(key)).toBe(false)
    expect(after.result.current.unsavedSecretIds.has(key)).toBe(false)
  })

  it('tracks a Local Function, a Shared draft and the library View root; never a read-only Shared instance', () => {
    const nodes = [
      { id: 'loc', data: { nodeType: 'function', functionLifecycle: 'local', localDefinition: BODY_NOW } },
      sharedNode('draft', { editMode: true, localDefinition: BODY_NOW }),
      sharedNode('pinned', { localDefinition: BODY_NOW }),
      sharedNode('view-shared-root', { localDefinition: BODY_NOW }),
    ]
    expect(tracksSecretsAt(nodes, [], null)).toBe(true)
    expect(tracksSecretsAt(nodes, ['loc'], null)).toBe(true)
    expect(tracksSecretsAt(nodes, ['draft'], null)).toBe(true)
    expect(tracksSecretsAt(nodes, ['pinned'], null)).toBe(false)
    expect(tracksSecretsAt(nodes, ['view-shared-root'], 'view-shared-root')).toBe(true)
    expect(tracksSecretsAt(nodes, ['view-shared-root'], null)).toBe(false)
  })
})

describe('useVariableManagement - element types (REQ-3.1.3.19)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
  })

  it('snapshots each literal\'s element types at run start and clears them on Reset', () => {
    setupStore({
      variables: [
        makeVariable({ id: 'm', name: 'm', type: 'map', value: { n: '1' }, elementTypes: { n: 'integer' } }),
        makeVariable({ id: 's', name: 's', type: 'string', value: 'x' }),
        makeVariable({ id: 'e', name: 'e', type: 'map', value: 'src', isExpression: true, elementTypes: {} }),
      ],
    })
    const { result, rerender } = renderHook(
      ({ sid }: { sid: string | null }) => useVariableManagement(sid, mockRegisterVariableHandler),
      { initialProps: { sid: 'sess-1' as string | null } },
    )
    expect([...result.current.runStartElementTypes.entries()]).toEqual([['m', { n: 'integer' }]])

    rerender({ sid: null })
    expect(result.current.runStartElementTypes.size).toBe(0)
  })

  it('creates a variable and a parameter with the element types the create modal picked', () => {
    const store = setupStore()
    const { result } = renderVarManagement()
    act(() => {
      result.current.handleCreateParameter('variable', {
        name: 'm',
        type: 'map',
        value: { n: '16' },
        elementTypes: { n: 'integer' },
      })
      result.current.handleCreateParameter('input', {
        name: 'limits',
        type: 'array',
        value: ['1.0'],
        elementTypes: ['float'],
      })
    })
    expect(store.addVariable).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'm', elementTypes: { n: 'integer' } }),
    )
    expect(store.addInputParam).toHaveBeenCalledWith({
      name: 'limits',
      type: 'array',
      default: ['1.0'],
      elementTypes: ['float'],
    })
  })

  it('shows a Function parameter default with its element types, and ignores a malformed sidecar', () => {
    const fnNode = {
      id: 'fn-9',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Function_9',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [], edges: [] },
          inputs: [{ name: 'limits', type: 'map', default: { n: '1' }, elementTypes: { n: 'integer' } }],
          outputs: [{ name: 'out', type: 'array', default: [], elementTypes: 'bogus' }],
          variables: [],
        },
      },
    }
    setupStore({
      nodes: [fnNode],
      drillPath: [{ nodeId: 'fn-9', label: 'Function_9' }],
      getActiveVariables: vi.fn().mockReturnValue([]),
    })
    const { result } = renderVarManagement()
    const byName = new Map(result.current.displayVariables.map((v) => [v.name, v]))
    expect(byName.get('limits')?.elementTypes).toEqual({ n: 'integer' })
    expect(byName.get('out')).not.toHaveProperty('elementTypes')
  })
})

describe('useVariableManagement - Function parameter rows holding null (VMGR-93)', () => {
  const PARAM_TYPES: ReadonlyArray<WorkflowVariable['type']> = [
    'string',
    'integer',
    'float',
    'boolean',
    'array',
    'map',
    'table',
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  function drilledRows(inputs: unknown[], outputs: unknown[]): Map<string, WorkflowVariable> {
    const fnNode = {
      id: 'fn-null',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Function_Null',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs, outputs, variables: [] },
      },
    }
    setupStore({
      nodes: [fnNode],
      drillPath: [{ nodeId: 'fn-null', label: 'Function_Null' }],
      getActiveVariables: vi.fn().mockReturnValue([]),
    })
    const { result } = renderVarManagement()
    return new Map(result.current.displayVariables.map((v) => [v.id, v]))
  }

  it.each(PARAM_TYPES)('keeps a null default as null for a %s input and output row', (type) => {
    const rows = drilledRows(
      [{ name: 'fn_in', type, default: null }],
      [{ name: 'fn_out', type, default: null }],
    )

    expect(rows.get('param:input:fn_in')?.value).toBeNull()
    expect(rows.get('param:output:fn_out')?.value).toBeNull()
  })

  it.each(PARAM_TYPES)('reads null, never empty text, for a %s parameter declared with no default', (type) => {
    const rows = drilledRows([{ name: 'fn_in', type }], [{ name: 'fn_out', type }])

    expect(rows.get('param:input:fn_in')?.value).toBeNull()
    expect(rows.get('param:output:fn_out')?.value).toBeNull()
  })

  it.each<[WorkflowVariable['type'], unknown]>([
    ['string', ''],
    ['integer', 0],
    ['float', 0],
    ['boolean', false],
    ['array', []],
    ['map', {}],
    ['table', []],
  ])('keeps an empty %s default as that value, not null', (type, stored) => {
    const rows = drilledRows([{ name: 'fn_in', type, default: stored }], [])

    expect(rows.get('param:input:fn_in')?.value).toStrictEqual(stored)
  })

  it.each<['input' | 'output', WorkflowVariable['type'], unknown]>([
    ['input', 'string', ''],
    ['input', 'integer', 0],
    ['input', 'float', 0],
    ['input', 'boolean', false],
    ['input', 'array', []],
    ['input', 'map', {}],
    ['input', 'table', []],
    ['output', 'string', ''],
    ['output', 'integer', 0],
    ['output', 'float', 0],
    ['output', 'boolean', false],
    ['output', 'array', []],
    ['output', 'map', {}],
    ['output', 'table', []],
  ])('presets the type default for a new %s %s parameter left untouched', (mode, type, preset) => {
    const store = setupStore()
    const { result } = renderVarManagement()

    act(() => {
      result.current.handleCreateParameter(mode, { name: 'fresh', type })
    })

    const add = mode === 'input' ? store.addInputParam : store.addOutputParam
    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][0]).toStrictEqual({ name: 'fresh', type, default: preset })
  })
})

// ---------------------------------------------------------------------------
// Every reference a saved block makes counts toward Unused (VMGR-105)
// ---------------------------------------------------------------------------

describe('useVariableManagement - every reference counts toward Unused (VMGR-105)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  function literalRow(variable: string, extra: Record<string, unknown> = {}) {
    return {
      id: `row-${variable}`,
      type: 'literal',
      variable,
      value_type: 'boolean',
      operator: 'is_true',
      reference_value: null,
      reference_is_expression: false,
      ...extra,
    }
  }

  function savedBlock(data: Record<string, unknown>) {
    return { id: 'n1', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Block', ...data } }
  }

  function checkBlock(elementType: string, values: Record<string, unknown>) {
    return savedBlock({ nodeType: 'control', elementType, config: { values } })
  }

  function referencedAtRoot(nodes: unknown[]): Set<string> {
    setupStore({ nodes })
    const { result } = renderVarManagement()
    return result.current.workflowReferencedVarNames
  }

  it.each<[string, ReturnType<typeof savedBlock>]>([
    ['Assert', checkBlock('assert', { assertions: [literalRow('checked_var')] })],
    [
      'If/Else',
      checkBlock('if-else', {
        branches: [
          { id: 'b1', type: 'if', label: '', conditions: [literalRow('checked_var')] },
          { id: 'b2', type: 'else', label: '' },
        ],
      }),
    ],
    [
      'Switch',
      checkBlock('switch-case', {
        branches: [
          { id: 'c1', type: 'case', label: '', conditions: [literalRow('checked_var')], break: true },
          { id: 'd1', type: 'default', label: '' },
        ],
      }),
    ],
    ['While', checkBlock('while', { conditions: [literalRow('checked_var')] })],
    ['Wait Until', checkBlock('wait-until', { conditions: [literalRow('checked_var')] })],
  ])('counts a variable a %s condition reads', (_block, node) => {
    expect(referencedAtRoot([node]).has('checked_var')).toBe(true)
  })

  it('counts a variable an Assert compare-to expression reads', () => {
    const node = checkBlock('assert', {
      assertions: [
        literalRow('count', {
          value_type: 'integer',
          operator: 'less_than',
          reference_value: 'limit_var * 2',
          reference_is_expression: true,
        }),
      ],
    })

    expect(referencedAtRoot([node]).has('limit_var')).toBe(true)
  })

  it('counts a variable an expression condition row reads', () => {
    const node = checkBlock('assert', {
      assertions: [{ id: 'e1', type: 'expression', expression: 'total_var > 3' }],
    })

    expect(referencedAtRoot([node]).has('total_var')).toBe(true)
  })

  it('counts a variable a nested condition group reads', () => {
    const node = checkBlock('assert', {
      assertions: [
        {
          id: 'g1',
          type: 'group',
          items: [literalRow('first_flag'), { type: 'operator', value: 'and' }, literalRow('grouped_var')],
        },
      ],
    })

    expect(referencedAtRoot([node]).has('grouped_var')).toBe(true)
  })

  it('counts a variable a Variable Setter expression row reads', () => {
    const node = savedBlock({
      nodeType: 'control',
      elementType: 'variable-setter',
      variableExpressionKeys: ['next_try'],
      variableTypes: { next_try: 'integer' },
      config: { values: { variables: { next_try: 'attempt_var + 1' } } },
    })

    expect(referencedAtRoot([node]).has('attempt_var')).toBe(true)
  })

  it('counts a variable a Variable Setter template row reads', () => {
    const node = savedBlock({
      nodeType: 'control',
      elementType: 'variable-setter',
      variableTemplateKeys: ['welcome'],
      variableTypes: { welcome: 'string' },
      config: { values: { variables: { welcome: 'Hi {{ guest_var }}' } } },
    })

    expect(referencedAtRoot([node]).has('guest_var')).toBe(true)
  })

  it('counts the target a Variable Setter writes', () => {
    const node = savedBlock({
      nodeType: 'control',
      elementType: 'variable-setter',
      variableTypes: { status_var: 'string' },
      config: { values: { variables: { status_var: 'done' } } },
    })

    expect(referencedAtRoot([node]).has('status_var')).toBe(true)
  })

  it('counts a variable a nested Function Block field reads', () => {
    const innerBlock = savedBlock({
      label: 'Inner',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      expressionFields: ['level'],
      config: { values: { level: 'outer_local' }, outputBindings: {} },
      localDefinition: {
        workflow: { nodes: [], edges: [] },
        inputs: [{ name: 'level', type: 'string' }],
        outputs: [],
        variables: [],
      },
    })
    const outer = {
      id: 'fn-outer',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Outer',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [innerBlock], edges: [] },
          inputs: [],
          outputs: [],
          variables: [{ id: 'lv1', name: 'outer_local', type: 'string', value: 'x' }],
        },
      },
    }
    setupStore({
      nodes: [outer],
      drillPath: [{ nodeId: 'fn-outer', label: 'Outer' }],
      getActiveVariables: vi.fn().mockReturnValue([]),
    })
    const { result } = renderVarManagement()

    expect(result.current.workflowReferencedVarNames.has('outer_local')).toBe(true)
  })

  it('counts a variable a map entry expression reads', () => {
    const node = savedBlock({
      elementType: 'http-request',
      expressionFields: ['headers.Authorization'],
      config: { values: { headers: { Authorization: 'token_var', Accept: 'application/json' } } },
    })

    expect(referencedAtRoot([node]).has('token_var')).toBe(true)
  })

  it('counts the variable a For Each collection setting names', () => {
    const node = checkBlock('for-each', { collection: 'items_var' })

    expect(referencedAtRoot([node]).has('items_var')).toBe(true)
  })

  it('does not count a name a nested Function body reads at the outer scope', () => {
    const innerLog = savedBlock({
      elementType: 'log',
      expressionFields: ['message'],
      config: { values: { message: 'inner_only' } },
    })
    const callBlock = savedBlock({
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      config: { outputBindings: {} },
      localDefinition: { workflow: { nodes: [innerLog], edges: [] }, inputs: [], outputs: [], variables: [] },
    })

    expect(referencedAtRoot([callBlock]).has('inner_only')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The +Add spec becomes the stored parameter (VMGR-97, VMGR-99, VMGR-103, VMGR-104)
// ---------------------------------------------------------------------------

describe('useVariableManagement - the parameter a creation window describes', () => {
  type FunctionPath = Array<{ nodeId: string; label: string }>
  type CreateSpec = Parameters<VariableManagementResult['handleCreateParameter']>[1] & {
    enumValues?: unknown[]
  }
  type CreateWithPath = (
    mode: 'input' | 'output' | 'variable',
    spec: CreateSpec,
    functionPath?: FunctionPath,
  ) => { success: boolean; error?: string }

  const PARAM_TYPES: ReadonlyArray<WorkflowVariable['type']> = [
    'string',
    'integer',
    'float',
    'boolean',
    'array',
    'map',
    'table',
  ]
  const PATH_A: FunctionPath = [{ nodeId: 'fn-a', label: 'Function_A' }]

  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  function renderCreate() {
    const store = setupStore({ drillPath: [{ nodeId: 'fn-b', label: 'Function_B' }] })
    const { result } = renderVarManagement()
    const create = (mode: 'input' | 'output' | 'variable', spec: CreateSpec, functionPath?: FunctionPath) =>
      (result.current.handleCreateParameter as unknown as CreateWithPath)(mode, spec, functionPath)
    return { store, create }
  }

  it.each(PARAM_TYPES.flatMap((type) => [['input', type] as const, ['output', type] as const]))(
    'keeps a null default on the %s parameter of type %s',
    (mode, type) => {
      const { store, create } = renderCreate()

      create(mode, { name: 'fresh', type, value: null })

      const add = mode === 'input' ? store.addInputParam : store.addOutputParam
      expect(add.mock.calls[0][0]).toStrictEqual({ name: 'fresh', type, default: null })
    },
  )

  it('carries Kind Expression onto an output parameter', () => {
    const { store, create } = renderCreate()

    create('output', { name: 'sum', type: 'integer', value: 'a + b', isExpression: true })

    expect(store.addOutputParam.mock.calls[0][0]).toStrictEqual({
      name: 'sum',
      type: 'integer',
      default: 'a + b',
      isExpression: true,
    })
  })

  it('carries Kind Template onto a String output parameter', () => {
    const { store, create } = renderCreate()

    create('output', { name: 'greeting', type: 'string', value: 'Hi {{ who }}', isTemplate: true })

    expect(store.addOutputParam.mock.calls[0][0]).toStrictEqual({
      name: 'greeting',
      type: 'string',
      default: 'Hi {{ who }}',
      isTemplate: true,
    })
  })

  it('stores an enum input as its value type, Required, with its allowed values and its default', () => {
    const { store, create } = renderCreate()

    create('input', {
      name: 'level',
      type: 'integer',
      required: true,
      enumValues: [1, 2],
      value: 2,
    })

    expect(store.addInputParam.mock.calls[0][0]).toStrictEqual({
      name: 'level',
      type: 'integer',
      required: true,
      enumValues: [1, 2],
      default: 2,
    })
  })

  it('stores an enum input Required even when the window sent no Required flag', () => {
    const { store, create } = renderCreate()

    create('input', { name: 'stage', type: 'string', enumValues: ['dev', 'prod'], value: 'dev' })

    expect(store.addInputParam.mock.calls[0][0]).toStrictEqual({
      name: 'stage',
      type: 'string',
      required: true,
      enumValues: ['dev', 'prod'],
      default: 'dev',
    })
  })

  it('keeps False as the default of a Required true/false input', () => {
    const { store, create } = renderCreate()

    create('input', { name: 'dry_run', type: 'boolean', required: true, value: false })

    expect(store.addInputParam.mock.calls[0][0]).toStrictEqual({
      name: 'dry_run',
      type: 'boolean',
      required: true,
      default: false,
    })
  })

  it.each(PARAM_TYPES)('gives a Required %s input no default', (type) => {
    const { store, create } = renderCreate()

    create('input', { name: 'needed', type, required: true })

    expect(store.addInputParam.mock.calls[0][0]).toStrictEqual({ name: 'needed', type, required: true })
  })

  it.each(PARAM_TYPES)('gives a secret %s input no default', (type) => {
    const { store, create } = renderCreate()

    create('input', { name: 'token', type, secret: true })

    expect(store.addInputParam.mock.calls[0][0]).toStrictEqual({ name: 'token', type, secret: true })
  })

  const SENT_VALUES: ReadonlyArray<[WorkflowVariable['type'], unknown]> = [
    ['string', 'admin'],
    ['integer', 5],
    ['float', 1.5],
    ['boolean', true],
    ['array', ['a']],
    ['map', { k: 'v' }],
    ['table', [{ id: 1 }]],
  ]

  it.each(SENT_VALUES)('keeps the value sent with a Required %s input as its default', (type, value) => {
    const { store, create } = renderCreate()

    create('input', { name: 'needed', type, value, required: true })

    expect(store.addInputParam.mock.calls[0][0]).toStrictEqual({ name: 'needed', type, required: true, default: value })
  })

  it.each(SENT_VALUES)('drops the value sent with a secret %s input, so it has no default', (type, value) => {
    const { store, create } = renderCreate()

    create('input', { name: 'token', type, value, secret: true })

    expect(store.addInputParam.mock.calls[0][0]).toStrictEqual({ name: 'token', type, secret: true })
  })

  it('keeps the default of a secret output', () => {
    const { store, create } = renderCreate()

    create('output', { name: 'issued_token', type: 'string', value: 's3cret', secret: true })

    expect(store.addOutputParam.mock.calls[0][0]).toStrictEqual({
      name: 'issued_token',
      type: 'string',
      default: 's3cret',
      secret: true,
    })
  })

  it.each<['input' | 'output', 'addInputParam' | 'addOutputParam']>([
    ['input', 'addInputParam'],
    ['output', 'addOutputParam'],
  ])('writes a new %s parameter into the Function path its window was opened in', (mode, action) => {
    const { store, create } = renderCreate()

    expect(create(mode, { name: 'from_a', type: 'string', value: 'x' }, PATH_A)).toEqual({ success: true })

    expect(store[action]).toHaveBeenCalledTimes(1)
    expect(store[action].mock.calls[0][1]).toEqual(PATH_A)
  })

  it('writes a new Function local variable into the Function path its window was opened in', () => {
    const { store, create } = renderCreate()

    expect(create('variable', { name: 'tmp', type: 'integer', value: 1 }, PATH_A)).toEqual({ success: true })

    expect(store.addVariable).toHaveBeenCalledTimes(1)
    expect(store.addVariable.mock.calls[0][0]).toEqual(expect.objectContaining({ name: 'tmp', value: 1 }))
    expect(store.addVariable.mock.calls[0][1]).toEqual(PATH_A)
  })
})

// ---------------------------------------------------------------------------
// Parameter rows carry the output kind and the secret flag (VMGR-99, SECUI-10, SECUI-11)
// ---------------------------------------------------------------------------

describe('useVariableManagement - Function parameter rows carry kind and secret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  function drilledParamRows(inputs: unknown[], outputs: unknown[]): Map<string, WorkflowVariable> {
    const fnNode = {
      id: 'fn-kind',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Function_Kind',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs, outputs, variables: [] },
      },
    }
    setupStore({
      nodes: [fnNode],
      drillPath: [{ nodeId: 'fn-kind', label: 'Function_Kind' }],
      getActiveVariables: vi.fn().mockReturnValue([]),
    })
    const { result } = renderVarManagement()
    return new Map(result.current.displayVariables.map((v) => [v.id, v]))
  }

  it('marks a secret output row secret so its default is masked', () => {
    const rows = drilledParamRows([], [{ name: 'issued_token', type: 'string', default: '********', secret: true }])

    expect(rows.get('param:output:issued_token')?.isSecret).toBe(true)
  })

  it('marks a secret input row secret', () => {
    const rows = drilledParamRows([{ name: 'api_key', type: 'string', secret: true }], [])

    expect(rows.get('param:input:api_key')?.isSecret).toBe(true)
  })

  it('flags an output with Kind Expression so its row shows the expression badge', () => {
    const rows = drilledParamRows([], [{ name: 'sum', type: 'integer', default: 'a + b', isExpression: true }])

    expect(rows.get('param:output:sum')).toEqual(
      expect.objectContaining({ value: 'a + b', isExpression: true }),
    )
    expect(rows.get('param:output:sum')?.isTemplate).toBeFalsy()
  })

  it('flags an output with Kind Template so its row shows the template badge', () => {
    const rows = drilledParamRows([], [{ name: 'greeting', type: 'string', default: 'Hi {{ who }}', isTemplate: true }])

    expect(rows.get('param:output:greeting')).toEqual(
      expect.objectContaining({ value: 'Hi {{ who }}', isTemplate: true }),
    )
    expect(rows.get('param:output:greeting')?.isExpression).toBeFalsy()
  })

  it('leaves a plain parameter row without kind or secret flags', () => {
    const rows = drilledParamRows([{ name: 'plain_in', type: 'string', default: 'a' }], [])
    const row = rows.get('param:input:plain_in')

    expect(row?.isSecret).toBeFalsy()
    expect(row?.isExpression).toBeFalsy()
    expect(row?.isTemplate).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// A creation window checks the scope it creates in, not the scope shown (VMGR-102)
// ---------------------------------------------------------------------------

describe('useVariableManagement - a creation window checks the scope it creates in (VMGR-102)', () => {
  type Path = Array<{ nodeId: string; label: string }>
  const PATH_A: Path = [{ nodeId: 'fn-a', label: 'Function_A' }]
  const PATH_SHARED: Path = [{ nodeId: 'fn-shared', label: 'Shared_Fn' }]
  const READ_ONLY = 'Read-only scope: structural edits are disabled'

  function functionNode(id: string, data: Record<string, unknown>, body: Record<string, unknown>) {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: id,
        nodeType: 'function',
        functionLifecycle: 'local',
        ...data,
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [], ...body },
      },
    }
  }

  const LOCAL_A = functionNode(
    'fn-a',
    {},
    {
      variables: [makeVariable({ id: 'l-b', name: 'b', type: 'integer', value: 'a + 1', isExpression: true })],
      outputs: [{ name: 'total', type: 'integer', default: 'c * 2', isExpression: true }],
    },
  )
  const EMPTY_A = functionNode('fn-a', {}, {})
  const SHARED = functionNode('fn-shared', { functionLifecycle: 'shared' }, {})
  const SHARED_IN_EDIT = functionNode('fn-shared', { functionLifecycle: 'shared', editMode: true }, {})
  const ROOT_B = makeVariable({ id: 'v-b', name: 'b', type: 'integer', value: 'a + 1', isExpression: true })

  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  function render(overrides: Partial<StoreState>) {
    const store = setupStore(overrides)
    const { result } = renderVarManagement()
    return { store, result }
  }

  const computedLocal = (name: string, value: string) => ({ name, type: 'integer' as const, value, isExpression: true })

  it("refuses a variable closing a cycle with a local of the window's Function while the Test root is shown", () => {
    const { store, result } = render({ nodes: [LOCAL_A] })

    const res = result.current.handleCreateParameter('variable', computedLocal('a', 'b + 1'), PATH_A)

    expect(res).toEqual({ success: false, error: "Circular reference detected for variable 'a': a -> b -> a" })
    expect(store.addVariable).not.toHaveBeenCalled()
  })

  it("refuses a variable closing a cycle through an Expression output of the window's Function", () => {
    const { store, result } = render({ nodes: [LOCAL_A] })

    const res = result.current.handleCreateParameter('variable', computedLocal('c', 'total + 1'), PATH_A)

    expect(res).toEqual({ success: false, error: "Circular reference detected for variable 'c': c -> total -> c" })
    expect(store.addVariable).not.toHaveBeenCalled()
  })

  it('checks a root window used after drilling in against the Test root, not the Function shown', () => {
    const { store, result } = render({ nodes: [LOCAL_A], drillPath: PATH_A })

    const res = result.current.handleCreateParameter('variable', computedLocal('a', 'b + 1'), [])

    expect(res).toEqual({ success: true })
    expect(store.addVariable.mock.calls[0][1]).toEqual([])
  })

  it('checks a window in a Function against that Function, not the Test root variables', () => {
    const { store, result } = render({ nodes: [EMPTY_A], variables: [ROOT_B] })

    const res = result.current.handleCreateParameter('variable', computedLocal('a', 'b + 1'), PATH_A)

    expect(res).toEqual({ success: true })
    expect(store.addVariable.mock.calls[0][1]).toEqual(PATH_A)
  })

  it('checks a create with no window path against the drilled scope', () => {
    const { store, result } = render({ nodes: [LOCAL_A], drillPath: PATH_A })

    const res = result.current.handleCreateVariable(computedLocal('a', 'b + 1'))

    expect(res).toEqual({ success: false, error: "Circular reference detected for variable 'a': a -> b -> a" })
    expect(store.addVariable).not.toHaveBeenCalled()
  })

  it('lets a window in an editable Function create while the scope shown is read-only', () => {
    const { store, result } = render({
      nodes: [LOCAL_A, SHARED],
      drillPath: PATH_SHARED,
      isCurrentScopeReadOnly: vi.fn().mockReturnValue(true),
    })

    const res = result.current.handleCreateParameter('input', { name: 'host', type: 'string', value: 'x' }, PATH_A)

    expect(res).toEqual({ success: true })
    expect(store.addInputParam).toHaveBeenCalledWith({ name: 'host', type: 'string', default: 'x' }, PATH_A)
  })

  it('refuses a window whose Function is read-only while the scope shown is editable', () => {
    const { store, result } = render({ nodes: [SHARED] })

    const variable = result.current.handleCreateParameter('variable', { name: 'v', type: 'string', value: 'x' }, PATH_SHARED)
    const output = result.current.handleCreateParameter('output', { name: 'o', type: 'string', value: 'x' }, PATH_SHARED)

    expect(variable).toEqual({ success: false, error: READ_ONLY })
    expect(output).toEqual({ success: false, error: READ_ONLY })
    expect(store.addVariable).not.toHaveBeenCalled()
    expect(store.addOutputParam).not.toHaveBeenCalled()
  })

  it('lets a window in a Shared Function in edit mode create', () => {
    const { store, result } = render({ nodes: [SHARED_IN_EDIT] })

    const res = result.current.handleCreateParameter('variable', { name: 'v', type: 'string', value: 'x' }, PATH_SHARED)

    expect(res).toEqual({ success: true })
    expect(store.addVariable.mock.calls[0][1]).toEqual(PATH_SHARED)
  })

  it('still refuses a create with no window path in a read-only scope shown', () => {
    const { store, result } = render({ isCurrentScopeReadOnly: vi.fn().mockReturnValue(true) })

    expect(result.current.handleCreateParameter('variable', { name: 'v', type: 'string', value: 'x' })).toEqual({
      success: false,
      error: READ_ONLY,
    })
    expect(store.addVariable).not.toHaveBeenCalled()
  })

  it('checks a typed expression against the locals and Expression outputs of the drilled Function', () => {
    const { result } = render({ nodes: [LOCAL_A], drillPath: PATH_A, variables: [ROOT_B] })

    expect(result.current.validateExpressionCycle({ variableName: 'a', value: 'b + 1', isExpression: true })).toBe(
      "Circular reference detected for variable 'a': a -> b -> a",
    )
    expect(
      result.current.validateExpressionCycle({ variableId: 'l-b', variableName: 'b', value: '1 + 1', isExpression: true }),
    ).toBeNull()
    expect(
      result.current.validateExpressionCycle({
        variableId: 'param:output:total',
        variableName: 'total',
        value: 'total + 1',
        isExpression: true,
      }),
    ).toBe("Circular reference detected for variable 'total': total -> total")
  })

  it("checks a creation window's typed expression against the window's own scope", () => {
    const { result } = render({ nodes: [LOCAL_A], drillPath: [], variables: [] })
    const typed = { variableName: 'a', value: 'b + 1', isExpression: true }

    expect(result.current.validateExpressionCycle({ ...typed, functionPath: PATH_A })).toBe(
      "Circular reference detected for variable 'a': a -> b -> a",
    )
    expect(result.current.validateExpressionCycle(typed)).toBeNull()
  })

  it('checks a root window used inside a Function against the Test root variables', () => {
    const { result } = render({ nodes: [LOCAL_A], drillPath: PATH_A, variables: [] })

    expect(
      result.current.validateExpressionCycle({ variableName: 'a', value: 'b + 1', isExpression: true, functionPath: [] }),
    ).toBeNull()
  })

  it('does not check a typed expression in a Function against the Test root variables', () => {
    const { result } = render({ nodes: [EMPTY_A], drillPath: PATH_A, variables: [ROOT_B] })

    expect(result.current.validateExpressionCycle({ variableName: 'a', value: 'b + 1', isExpression: true })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// An untouched Expression or Template output holds no default
// ---------------------------------------------------------------------------

describe('useVariableManagement - an untouched computed output stores no default', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  it.each([
    ['Expression', { isExpression: true }],
    ['Template', { isTemplate: true }],
  ] as const)('adds a Kind %s output with no source and no default', (_kind, flags) => {
    const store = setupStore({ drillPath: [{ nodeId: 'fn-a', label: 'Function_A' }] })
    const { result } = renderVarManagement()

    result.current.handleCreateParameter('output', { name: 'computed', type: 'string', ...flags })

    expect(store.addOutputParam.mock.calls[0][0]).toStrictEqual({ name: 'computed', type: 'string', ...flags })
  })
})

// ---------------------------------------------------------------------------
// A CSV / Excel filter row reads the variables of its compare-to side
// ---------------------------------------------------------------------------

describe('useVariableManagement - a filter row counts toward Unused (VMGR-105)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeValues = new Map()
    mockRecentlyChangedPaths = new Set()
  })

  it('counts a variable a CSV filter compare-to expression reads, never the cell', () => {
    const csv = {
      id: 'csv-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Parse',
        nodeType: 'plugin',
        elementType: 'csv-parser',
        config: {
          values: {
            filters: [
              {
                id: 'f1',
                column: { mode: 'name', value: 'amount' },
                asType: 'integer',
                conditions: [
                  {
                    id: 'c1',
                    type: 'literal',
                    variable: '_cell',
                    value_type: 'integer',
                    operator: 'greater_than',
                    reference_value: 'min_amount',
                    reference_is_expression: true,
                  },
                ],
              },
            ],
          },
        },
      },
    }
    setupStore({ nodes: [csv] })
    const { result } = renderVarManagement()

    expect(result.current.workflowReferencedVarNames.has('min_amount')).toBe(true)
    expect(result.current.workflowReferencedVarNames.has('_cell')).toBe(false)
    expect(result.current.inputRefCounts.get('min_amount')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The one variable window: rows, the definition save and the Current value
// ---------------------------------------------------------------------------

const PATH_FN_A: DrillEntry[] = [{ nodeId: 'fn-a', label: 'Function_A' }]
const PATH_FN_B: DrillEntry[] = [{ nodeId: 'fn-b', label: 'Function_B' }]

type ParamRow = WorkflowVariable & { required?: boolean; description?: string; enumValues?: unknown[] }

interface FunctionBody {
  inputs?: unknown[]
  outputs?: unknown[]
  variables?: WorkflowVariable[]
  nodes?: unknown[]
}

/** A Local Function Block whose body declares the given inputs, outputs, locals and inner Blocks. */
function localFunctionNode(id: string, body: FunctionBody = {}) {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        workflow: { nodes: body.nodes ?? [], edges: [] },
        inputs: body.inputs ?? [],
        outputs: body.outputs ?? [],
        variables: body.variables ?? [],
      },
    },
  }
}

/** What a run would carry from the staged values: Test-scope variables and the Function entries. */
function runSeed(staged: Map<string, StagedOverride>) {
  return {
    variables: mergeStagedIntoRunVariables({}, staged),
    function_variables: stagedFunctionVariables(staged),
  }
}

/** The scope a Current write went to; an absent path is the root canvas scope. */
function sentPath(call: unknown[]): unknown {
  return call[3] ?? []
}

function resetHookMocks() {
  vi.clearAllMocks()
  mockRuntimeValues = new Map()
  mockRecentlyChangedPaths = new Set()
}

const COUNT_ROW = makeVariable({ id: 'v-count', name: 'count', type: 'integer', value: 1 })
const WHO_INPUT = makeVariable({ id: 'param:input:who', name: 'who', type: 'string', value: null })

describe('useVariableManagement - parameter rows carry Required, Description and allowed values (REQ-3.1.1.5)', () => {
  beforeEach(resetHookMocks)

  function rowsOf(inputs: unknown[], outputs: unknown[] = []): Map<string, ParamRow> {
    setupStore({ nodes: [localFunctionNode('fn-a', { inputs, outputs })], drillPath: PATH_FN_A })
    const { result } = renderVarManagement()
    return new Map(result.current.displayVariables.map((row) => [row.id, row as ParamRow]))
  }

  it('fills each input row from its own declaration only', () => {
    const rows = rowsOf([
      { name: 'level', type: 'integer', required: true, enumValues: [1, 2, 3], default: 2, description: 'Service tier' },
      { name: 'note', type: 'string', default: '' },
      { name: 'odd', type: 'string', description: 42, enumValues: 'dev' },
    ])

    expect(rows.get('param:input:level')).toEqual(
      expect.objectContaining({
        type: 'integer',
        value: 2,
        required: true,
        description: 'Service tier',
        enumValues: [1, 2, 3],
      }),
    )
    const plain = rows.get('param:input:note')
    expect(plain?.required).toBeFalsy()
    expect(plain?.description).toBeUndefined()
    expect(plain?.enumValues).toBeUndefined()
    const malformed = rows.get('param:input:odd')
    expect(malformed?.description).toBeUndefined()
    expect(malformed?.enumValues).toBeUndefined()
  })

  it('shows the default a Required input keeps', () => {
    const rows = rowsOf([{ name: 'region', type: 'string', required: true, default: 'eu-1' }])

    expect(rows.get('param:input:region')).toEqual(expect.objectContaining({ value: 'eu-1', required: true }))
  })

  it('fills an output row with its Description', () => {
    const rows = rowsOf([], [{ name: 'total', type: 'integer', default: 0, description: 'Sum of the items' }])

    expect(rows.get('param:output:total')?.description).toBe('Sum of the items')
  })
})

describe('useVariableManagement - the window saves a whole definition (REQ-3.1.3.11, REQ-3.1.2.1)', () => {
  beforeEach(resetHookMocks)

  function renderWindow(overrides: Partial<StoreState> = {}) {
    const store = setupStore({ variables: [COUNT_ROW], ...overrides })
    const { result } = renderVarManagement()
    const save = (target: WorkflowVariable, spec: VariableCreateSpec, functionPath?: DrillEntry[]) => {
      let outcome: { success: boolean; error?: string } | undefined
      act(() => {
        outcome = result.current.handleVariableWindowSave(target, spec, functionPath)
      })
      return outcome
    }
    return { store, save }
  }

  const patchOf = (action: ReturnType<typeof vi.fn>, call = 0) => action.mock.calls[call][1] as Record<string, unknown>

  describe('a Test variable or a Function local', () => {
    it('saves the value in one history entry, with no rename', () => {
      const { store, save } = renderWindow()

      expect(save(COUNT_ROW, { name: 'count', type: 'integer', value: 7 })).toEqual({ success: true })

      expect(store.transaction).toHaveBeenCalledTimes(1)
      expect(store.updateVariable).toHaveBeenCalledTimes(1)
      expect(store.updateVariable.mock.calls[0][0]).toBe('v-count')
      expect(patchOf(store.updateVariable)).toEqual(expect.objectContaining({ type: 'integer', value: 7 }))
      expect(store.renameVariable).not.toHaveBeenCalled()
    })

    it('renames first, then writes the rest, inside the same history entry', () => {
      const steps: string[] = []
      const { store, save } = renderWindow({
        transaction: vi.fn((write: () => void) => {
          steps.push('open')
          write()
          steps.push('close')
        }),
        renameVariable: vi.fn(() => {
          steps.push('rename')
          return { success: true }
        }),
        updateVariable: vi.fn(() => {
          steps.push('update')
        }),
      })

      expect(save(COUNT_ROW, { name: 'total', type: 'integer', value: 1 })).toEqual({ success: true })

      expect(steps).toEqual(['open', 'rename', 'update', 'close'])
      expect(store.renameVariable.mock.calls[0].slice(0, 2)).toEqual(['v-count', 'total'])
    })

    it('returns the store refusal of a rename and writes nothing else', () => {
      const { store, save } = renderWindow({
        renameVariable: vi.fn().mockReturnValue({ success: false, error: 'Name "total" already exists in this scope' }),
      })

      expect(save(COUNT_ROW, { name: 'total', type: 'integer', value: 1 })).toEqual({
        success: false,
        error: 'Name "total" already exists in this scope',
      })
      expect(store.updateVariable).not.toHaveBeenCalled()
    })

    it.each<[string, WorkflowVariable, Partial<VariableCreateSpec>, { isExpression: boolean; isTemplate: boolean }]>([
      ['Literal', makeVariable({ id: 'v-url', name: 'url', value: "'a' + 'b'", isExpression: true }), {}, { isExpression: false, isTemplate: false }],
      ['Expression', makeVariable({ id: 'v-url', name: 'url', value: '{{ a }}', isTemplate: true }), { isExpression: true }, { isExpression: true, isTemplate: false }],
      ['Template', makeVariable({ id: 'v-url', name: 'url', value: "'a' + 'b'", isExpression: true }), { isTemplate: true }, { isExpression: false, isTemplate: true }],
    ])('writes Kind %s over the Kind the variable had', (_kind, start, kind, expected) => {
      const { store, save } = renderWindow({ variables: [start] })

      save(start, { name: 'url', type: 'string', value: 'x', ...kind })

      const patch = patchOf(store.updateVariable)
      expect(patch).toHaveProperty('isExpression')
      expect(patch).toHaveProperty('isTemplate')
      expect(Boolean(patch.isExpression)).toBe(expected.isExpression)
      expect(Boolean(patch.isTemplate)).toBe(expected.isTemplate)
    })

    it.each([true, false])('writes Mark as secret %s', (secret) => {
      const token = makeVariable({ id: 'v-token', name: 'token', value: 'a', isSecret: !secret })
      const { store, save } = renderWindow({ variables: [token] })

      save(token, { name: 'token', type: 'string', value: 'a', secret })

      const patch = patchOf(store.updateVariable)
      expect(patch).toHaveProperty('isSecret')
      expect(Boolean(patch.isSecret)).toBe(secret)
    })

    it('saves Set to null as a null value', () => {
      const { store, save } = renderWindow()

      save(COUNT_ROW, { name: 'count', type: 'integer', value: null })

      expect(patchOf(store.updateVariable)).toHaveProperty('value', null)
    })

    it('drops the element types on a type change and keeps the ones the window sends', () => {
      const list = makeVariable({ id: 'v-list', name: 'list', type: 'array', value: ['1'], elementTypes: ['integer'] })
      const { store, save } = renderWindow({ variables: [list] })

      save(list, { name: 'list', type: 'string', value: 'x' })
      save(list, { name: 'list', type: 'array', value: [1.5], elementTypes: ['float'] })

      expect(patchOf(store.updateVariable, 0)).toHaveProperty('elementTypes', undefined)
      expect(patchOf(store.updateVariable, 1)).toEqual(expect.objectContaining({ type: 'array', elementTypes: ['float'] }))
    })

    it("refuses a value closing a cycle in the window's own Function and writes nothing", () => {
      const a = makeVariable({ id: 'l-a', name: 'a', type: 'integer', value: 1 })
      const b = makeVariable({ id: 'l-b', name: 'b', type: 'integer', value: 'a + 1', isExpression: true })
      const { store, save } = renderWindow({ nodes: [localFunctionNode('fn-a', { variables: [a, b] })] })

      expect(save(a, { name: 'a', type: 'integer', value: 'b + 1', isExpression: true }, PATH_FN_A)).toEqual({
        success: false,
        error: "Circular reference detected for variable 'a': a -> b -> a",
      })
      expect(store.updateVariable).not.toHaveBeenCalled()
      expect(store.renameVariable).not.toHaveBeenCalled()
    })

    it('checks a Test variable against the Test root while the canvas shows a Function', () => {
      const a = makeVariable({ id: 'v-a', name: 'a', type: 'integer', value: 1 })
      const b = makeVariable({ id: 'v-b', name: 'b', type: 'integer', value: 'a + 1', isExpression: true })
      const { store, save } = renderWindow({ variables: [a, b], nodes: [localFunctionNode('fn-a')], drillPath: PATH_FN_A })

      expect(save(a, { name: 'a', type: 'integer', value: 'b + 1', isExpression: true }, [])).toEqual({
        success: false,
        error: "Circular reference detected for variable 'a': a -> b -> a",
      })
      expect(store.updateVariable).not.toHaveBeenCalled()
    })

    it("writes a Function local in the window's Function while the canvas shows the Test root", () => {
      const tmp = makeVariable({ id: 'l-tmp', name: 'tmp', type: 'integer', value: 1 })
      const { store, save } = renderWindow({ nodes: [localFunctionNode('fn-a', { variables: [tmp] })] })

      expect(save(tmp, { name: 'tmp2', type: 'integer', value: 3 }, PATH_FN_A)).toEqual({ success: true })

      expect(store.renameVariable).toHaveBeenCalledWith('l-tmp', 'tmp2', PATH_FN_A)
      expect(store.updateVariable.mock.calls[0][0]).toBe('l-tmp')
      expect(store.updateVariable.mock.calls[0][2]).toEqual(PATH_FN_A)
    })

    it('writes a Test variable at the Test root while the canvas shows a Function', () => {
      const { store, save } = renderWindow({ nodes: [localFunctionNode('fn-a')], drillPath: PATH_FN_A })

      save(COUNT_ROW, { name: 'count', type: 'integer', value: 2 }, [])

      expect(store.updateVariable.mock.calls[0][0]).toBe('v-count')
      expect(store.updateVariable.mock.calls[0][2]).toEqual([])
    })
  })

  describe('a Function input or output, through the parameter path', () => {
    const TOTAL_OUTPUT = makeVariable({ id: 'param:output:total', name: 'total', type: 'integer', value: 0 })

    it("saves an input default in its own Function, never as a variable", () => {
      const { store, save } = renderWindow()

      expect(save(WHO_INPUT, { name: 'who', type: 'string', value: 'ann' }, PATH_FN_A)).toEqual({ success: true })

      expect(store.updateInputParam).toHaveBeenCalledWith('who', expect.objectContaining({ default: 'ann' }), PATH_FN_A)
      expect(store.updateVariable).not.toHaveBeenCalled()
      expect(store.renameVariable).not.toHaveBeenCalled()
    })

    it('renames an input through the parameter path, so its readers and Function Blocks follow', () => {
      const { store, save } = renderWindow()

      expect(save(WHO_INPUT, { name: 'person', type: 'string', value: null }, PATH_FN_A)).toEqual({ success: true })

      expect(store.updateInputParam).toHaveBeenCalledWith('who', expect.objectContaining({ name: 'person' }), PATH_FN_A)
      expect(store.renameVariable).not.toHaveBeenCalled()
    })

    it('renames an output through the parameter path', () => {
      const { store, save } = renderWindow()

      expect(save(TOTAL_OUTPUT, { name: 'sum', type: 'integer', value: 0 }, PATH_FN_A)).toEqual({ success: true })

      expect(store.updateOutputParam).toHaveBeenCalledWith('total', expect.objectContaining({ name: 'sum' }), PATH_FN_A)
      expect(store.renameVariable).not.toHaveBeenCalled()
    })

    it('writes the Description, Required tick, allowed values and default of an enum input', () => {
      const level = makeVariable({ id: 'param:input:level', name: 'level', type: 'integer', value: 1 })
      const { store, save } = renderWindow()

      save(
        level,
        { name: 'level', type: 'integer', required: true, enumValues: [1, 2, 3], value: 2, description: 'Service tier' },
        PATH_FN_A,
      )

      expect(store.updateInputParam).toHaveBeenCalledWith(
        'level',
        expect.objectContaining({ type: 'integer', required: true, enumValues: [1, 2, 3], default: 2, description: 'Service tier' }),
        PATH_FN_A,
      )
      expect(patchOf(store.updateInputParam)).not.toHaveProperty('enumValueType')
    })

    it('keeps the default of a Required input', () => {
      const { store, save } = renderWindow()

      save(WHO_INPUT, { name: 'who', type: 'string', required: true, value: 'eu-1' }, PATH_FN_A)

      expect(patchOf(store.updateInputParam)).toEqual(expect.objectContaining({ required: true, default: 'eu-1' }))
    })

    it('removes the default of a Required input whose field was emptied', () => {
      const { store, save } = renderWindow()

      save(WHO_INPUT, { name: 'who', type: 'string', required: true }, PATH_FN_A)

      const patch = patchOf(store.updateInputParam)
      expect(patch.required).toBe(true)
      expect(patch).toHaveProperty('default', undefined)
    })

    it('keeps a Required true/false input on the side picked', () => {
      const flag = makeVariable({ id: 'param:input:dry_run', name: 'dry_run', type: 'boolean', value: true })
      const { store, save } = renderWindow()

      save(flag, { name: 'dry_run', type: 'boolean', required: true, value: false }, PATH_FN_A)

      expect(patchOf(store.updateInputParam)).toEqual(
        expect.objectContaining({ type: 'boolean', required: true, default: false }),
      )
    })

    it('saves Set to null as a null default of an input that is not Required', () => {
      const { store, save } = renderWindow()

      save(WHO_INPUT, { name: 'who', type: 'string', value: null }, PATH_FN_A)

      expect(patchOf(store.updateInputParam)).toHaveProperty('default', null)
    })

    it('drops the default of a secret input', () => {
      const { store, save } = renderWindow()

      save(WHO_INPUT, { name: 'who', type: 'string', secret: true, value: null }, PATH_FN_A)

      const patch = patchOf(store.updateInputParam)
      expect(patch.secret).toBe(true)
      expect(patch).toHaveProperty('default', undefined)
    })

    it('drops the allowed values when Create enum is turned off', () => {
      const level = makeVariable({ id: 'param:input:level', name: 'level', type: 'string', value: 'dev' })
      const { store, save } = renderWindow()

      save(level, { name: 'level', type: 'string', required: true, value: 'dev' }, PATH_FN_A)

      expect(patchOf(store.updateInputParam)).toHaveProperty('enumValues', undefined)
    })

    it('clears the Required tick when it is turned off', () => {
      const { store, save } = renderWindow()

      save(WHO_INPUT, { name: 'who', type: 'string', required: false, value: 'ann' }, PATH_FN_A)

      const patch = patchOf(store.updateInputParam)
      expect(patch).toHaveProperty('required')
      expect(patch.required).toBeFalsy()
    })

    it("drops an input's element types when its type changes", () => {
      const limits = makeVariable({ id: 'param:input:limits', name: 'limits', type: 'array', value: ['1'], elementTypes: ['integer'] })
      const { store, save } = renderWindow()

      save(limits, { name: 'limits', type: 'string', value: 'x' }, PATH_FN_A)

      const patch = patchOf(store.updateInputParam)
      expect(patch).toEqual(expect.objectContaining({ type: 'string', default: 'x' }))
      expect(patch).toHaveProperty('elementTypes', undefined)
    })

    it('writes the Kind, Description and secret mark of an output', () => {
      const { store, save } = renderWindow()

      save(
        TOTAL_OUTPUT,
        { name: 'total', type: 'integer', value: 'a + b', isExpression: true, description: 'Sum', secret: true },
        PATH_FN_A,
      )

      expect(store.updateOutputParam).toHaveBeenCalledWith(
        'total',
        expect.objectContaining({ default: 'a + b', isExpression: true, description: 'Sum', secret: true }),
        PATH_FN_A,
      )
    })

    it('writes Kind Template over the Expression Kind of an output', () => {
      const greeting = makeVariable({ id: 'param:output:greeting', name: 'greeting', value: "'Hi'", isExpression: true })
      const { store, save } = renderWindow()

      save(greeting, { name: 'greeting', type: 'string', value: 'Hi {{ who }}', isTemplate: true }, PATH_FN_A)

      const patch = patchOf(store.updateOutputParam)
      expect(patch).toEqual(expect.objectContaining({ default: 'Hi {{ who }}', isTemplate: true }))
      expect(patch).toHaveProperty('isExpression', undefined)
    })

    it('refuses an Expression output that reads itself and writes nothing', () => {
      const fnA = localFunctionNode('fn-a', { outputs: [{ name: 'total', type: 'integer', default: 0 }] })
      const { store, save } = renderWindow({ nodes: [fnA] })

      expect(save(TOTAL_OUTPUT, { name: 'total', type: 'integer', value: 'total + 1', isExpression: true }, PATH_FN_A)).toEqual({
        success: false,
        error: "Circular reference detected for variable 'total': total -> total",
      })
      expect(store.updateOutputParam).not.toHaveBeenCalled()
    })

    it('returns the refusal of the parameter path', () => {
      const { save } = renderWindow({
        updateInputParam: vi.fn().mockReturnValue({ success: false, error: 'Name "x" already exists in this Function' }),
      })

      expect(save(WHO_INPUT, { name: 'x', type: 'string', value: 'v' }, PATH_FN_A)).toEqual({
        success: false,
        error: 'Name "x" already exists in this Function',
      })
    })
  })
})

describe("useVariableManagement - a Current value lands in its window's own scope (REQ-3.2.1.6)", () => {
  const SEVEN = { value: '7', type: 'integer' } as const
  const NINE = { value: '9', type: 'integer' } as const
  const TMP = makeVariable({ id: 'l-tmp', name: 'tmp', type: 'integer', value: 1 })
  // Function fn-a, holding fn-b; each declares its own local 'tmp'.
  const FUNCTION_TREE = [localFunctionNode('fn-a', { variables: [TMP], nodes: [localFunctionNode('fn-b', { variables: [TMP] })] })]

  beforeEach(resetHookMocks)

  async function setCurrent(
    result: { current: VariableManagementResult },
    name: string,
    body: StagedOverride,
    functionPath?: DrillEntry[],
  ) {
    await act(async () => {
      await result.current.handleVariableCurrentEdit(name, body, functionPath)
    })
  }

  it('sends a Test variable value to the session in the root scope', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result } = renderVarManagement('sess-1')

    await setCurrent(result, 'count', NINE)

    const call = vi.mocked(workbenchApi.setVariableOverride).mock.calls[0]
    expect(call.slice(0, 3)).toEqual(['sess-1', 'count', NINE])
    expect(sentPath(call)).toEqual([])
    expect(result.current.appliedOverrides.get('count')).toEqual(NINE)
  })

  it('sends a Function local value with its instance path, though the canvas shows the Test root', async () => {
    setupStore({ variables: [COUNT_ROW], nodes: FUNCTION_TREE })
    const { result } = renderVarManagement('sess-1')

    await setCurrent(result, 'tmp', NINE, PATH_FN_A)

    const call = vi.mocked(workbenchApi.setVariableOverride).mock.calls[0]
    expect(call.slice(0, 3)).toEqual(['sess-1', 'tmp', NINE])
    expect(sentPath(call)).toEqual(['fn-a'])
  })

  it('sends a nested instance path from the Test canvas inward', async () => {
    setupStore({ nodes: FUNCTION_TREE })
    const { result } = renderVarManagement('sess-1')

    await setCurrent(result, 'tmp', NINE, [...PATH_FN_A, ...PATH_FN_B])

    expect(sentPath(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0])).toEqual(['fn-a', 'fn-b'])
  })

  it('sends a null Current value as null', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result } = renderVarManagement('sess-1')

    await setCurrent(result, 'count', { value: null, type: 'integer' })

    expect(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0][2]).toEqual({ value: null, type: 'integer' })
  })

  it('stages a Function value before a run in its own scope, apart from a same-named Test variable', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result } = renderVarManagement(null)

    await setCurrent(result, 'count', SEVEN)
    await setCurrent(result, 'count', NINE, PATH_FN_A)

    expect(vi.mocked(workbenchApi.setVariableOverride)).not.toHaveBeenCalled()
    expect(runSeed(result.current.readStagedOverrides())).toEqual({
      variables: { count: { type: 'integer', value: '7' } },
      function_variables: [{ function_path: ['fn-a'], variables: { count: { type: 'integer', value: '9' } } }],
    })
  })

  it('stages a null Current value before a run', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result } = renderVarManagement(null)

    await setCurrent(result, 'count', { value: null, type: 'integer' })

    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ count: { type: 'integer', value: null } })
  })

  it('never shows a Function local Current value on a same-named Test variable row', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result } = renderVarManagement('sess-1')

    await setCurrent(result, 'count', NINE, PATH_FN_A)

    expect(result.current.appliedOverrides.size).toBe(1)
    expect(result.current.appliedOverrides.get('count')).toBeUndefined()
  })

  it('shows no override and reports the reason naming the variable when the write is rejected', async () => {
    setupStore({ nodes: FUNCTION_TREE })
    vi.mocked(workbenchApi.setVariableOverride).mockRejectedValueOnce(new Error('Session is not running'))
    const { result } = renderVarManagement('sess-1')

    await act(async () => {
      await expect(result.current.handleVariableCurrentEdit('tmp', NINE, PATH_FN_A)).rejects.toThrow(
        'Session is not running',
      )
    })

    expect(result.current.appliedOverrides.size).toBe(0)
    expect(mockToastError).toHaveBeenCalledWith('"tmp" is unchanged: Session is not running', 'Current Value Not Saved')
  })

  it('applyVariableOverride rejects without reporting, so its caller owns the message', async () => {
    setupStore({ nodes: FUNCTION_TREE })
    vi.mocked(workbenchApi.setVariableOverride).mockRejectedValueOnce(new Error('Bad Gateway'))
    const { result } = renderVarManagement('sess-1')

    await act(async () => {
      await expect(result.current.applyVariableOverride('tmp', NINE, PATH_FN_A)).rejects.toThrow('Bad Gateway')
    })

    expect(result.current.appliedOverrides.size).toBe(0)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('clears applied overrides and the run-start snapshot when the session ends (Reset)', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result, rerender } = renderHook(
      ({ sid }: { sid: string | null }) => useVariableManagement(sid, mockRegisterVariableHandler),
      { initialProps: { sid: 'sess-1' as string | null } },
    )
    await setCurrent(result, 'count', NINE)
    expect(result.current.appliedOverrides.size).toBe(1)
    expect(result.current.runStartSnapshot.size).toBeGreaterThan(0)

    rerender({ sid: null })

    expect(result.current.appliedOverrides.size).toBe(0)
    expect(result.current.runStartSnapshot.size).toBe(0)
  })

  describe('the results that read a variable given a Current value are due again (REQ-3.2.1.5)', () => {
    const host = makeVariable({ id: 'v-host', name: 'host', value: 'b' })
    const url = makeVariable({ id: 'v-url', name: 'url', value: "'http://' + host", isExpression: true })
    const page = makeVariable({ id: 'v-page', name: 'page', value: '{{ url }}/host', isTemplate: true })

    function afterARun() {
      mockRuntimeValues = new Map<string, unknown>([
        ['url', 'http://b'],
        ['page', 'http://b/host'],
      ])
      setupStore({ variables: [host, url, page] })
      return renderVarManagement('sess-1')
    }

    const forgotten = () => mockForgetRuntimeValue.mock.calls.map(([name]) => name)

    it('drops the results that read a variable given a literal value', async () => {
      const { result } = afterARun()

      await act(async () => {
        await result.current.applyVariableOverride('host', { value: 'c', type: 'string' })
      })

      expect(forgotten()).toEqual(['url', 'page'])
    })

    it('drops a re-armed source once, with the results that read it', async () => {
      const { result } = afterARun()

      await act(async () => {
        await result.current.applyVariableOverride('url', { expression: "'https://' + host", type: 'string' })
      })

      expect(forgotten()).toEqual(['url', 'page'])
    })

    it('forgets the value a re-armed template rendered', async () => {
      const { result } = afterARun()

      await act(async () => {
        await result.current.applyVariableOverride('page', { template: '{{ url }}/home', type: 'string' })
      })

      expect(forgotten()).toEqual(['page'])
    })

    it('forgets only the value a re-armed Function local held in its own scope', async () => {
      const { result } = afterARun()

      await act(async () => {
        await result.current.applyVariableOverride('url', { expression: "'https://' + host", type: 'string' }, PATH_FN_A)
      })

      expect(forgotten()).toEqual([scopedVariableKey('url', ['fn-a'])])
    })

    it('forgets nothing when the write is rejected', async () => {
      vi.mocked(workbenchApi.setVariableOverride).mockRejectedValueOnce(new Error('Bad Gateway'))
      const { result } = afterARun()

      await act(async () => {
        await result.current.applyVariableOverride('url', { expression: "'https://' + host", type: 'string' }).catch(() => undefined)
      })

      expect(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0]?.slice(0, 2)).toEqual(['sess-1', 'url'])
      expect(mockForgetRuntimeValue).not.toHaveBeenCalled()
    })
  })
})

describe('useVariableManagement - a staged Current value follows its variable (REQ-3.2.1.6)', () => {
  const FIVE = { value: 5, type: 'integer' } as const
  const ANN = { value: 'ann', type: 'string' } as const
  const TMP_LOCAL = makeVariable({ id: 'l-tmp', name: 'tmp', type: 'integer', value: 1 })

  beforeEach(resetHookMocks)

  async function stageCurrent(
    result: { current: VariableManagementResult },
    name: string,
    body: StagedOverride,
    functionPath?: DrillEntry[],
  ) {
    await act(async () => {
      await result.current.handleVariableCurrentEdit(name, body, functionPath)
    })
  }

  function saveWindow(
    result: { current: VariableManagementResult },
    target: WorkflowVariable,
    spec: VariableCreateSpec,
    functionPath?: DrillEntry[],
  ) {
    act(() => {
      result.current.handleVariableWindowSave(target, spec, functionPath)
    })
  }

  /** A store whose rename and update change the Test variables, as the real store does. */
  function storeThatWrites(variables: WorkflowVariable[]) {
    const replace = (id: string, change: Partial<WorkflowVariable>) => {
      currentStore.variables = currentStore.variables.map((v) => (v.id === id ? { ...v, ...change } : v))
    }
    return setupStore({
      variables,
      renameVariable: vi.fn((id: string, name: string) => {
        replace(id, { name })
        return { success: true }
      }),
      updateVariable: vi.fn((id: string, patch: Partial<WorkflowVariable>) => replace(id, patch)),
    })
  }

  it('keeps the staged values while the definitions change before a run', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result, rerender } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE)

    currentStore.variables = [COUNT_ROW, makeVariable({ id: 'v-other', name: 'other' })]
    rerender()

    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ count: { type: 'integer', value: 5 } })
    expect(result.current.appliedOverrides.get('count')).toEqual(FIVE)
  })

  it('keeps the Current value one Save stages along with its definition change', async () => {
    storeThatWrites([COUNT_ROW])
    const { result, rerender } = renderVarManagement(null)

    await act(async () => {
      result.current.handleVariableWindowSave(COUNT_ROW, { name: 'count', type: 'integer', value: 2 })
      await result.current.handleVariableCurrentEdit('count', FIVE)
    })
    rerender()

    expect(currentStore.variables[0]?.value).toBe(2)
    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ count: { type: 'integer', value: 5 } })
  })

  it('keeps the moved value once the store holds the renamed variable', async () => {
    storeThatWrites([COUNT_ROW])
    const { result, rerender } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE)

    saveWindow(result, COUNT_ROW, { name: 'total', type: 'integer', value: 1 })
    rerender()

    expect(currentStore.variables.map((v) => v.name)).toEqual(['total'])
    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ total: { type: 'integer', value: 5 } })
  })

  it('moves the staged value of a Test variable with a rename', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE)

    saveWindow(result, COUNT_ROW, { name: 'total', type: 'integer', value: 1 })

    expect(runSeed(result.current.readStagedOverrides())).toEqual({
      variables: { total: { type: 'integer', value: 5 } },
      function_variables: [],
    })
  })

  it('drops the staged value of a variable whose type changed', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE)

    saveWindow(result, COUNT_ROW, { name: 'count', type: 'string', value: '1' })

    expect(runSeed(result.current.readStagedOverrides())).toEqual({ variables: {}, function_variables: [] })
  })

  it.each([
    ['an expression', { isExpression: true, value: "'http://' + host" }],
    ['a template', { isTemplate: true, value: 'http://{{ host }}' }],
  ] as const)('drops the staged value of %s variable saved as a literal', async (_kind, source) => {
    const url = makeVariable({ id: 'v-url', name: 'url', type: 'string', ...source })
    setupStore({ variables: [url] })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'url', ANN)

    saveWindow(result, url, { name: 'url', type: 'string', value: '' })

    expect(runSeed(result.current.readStagedOverrides())).toEqual({ variables: {}, function_variables: [] })
  })

  it('keeps the staged value of an expression variable saved as an expression', async () => {
    const url = makeVariable({ id: 'v-url', name: 'url', type: 'string', value: "'http://' + host", isExpression: true })
    setupStore({ variables: [url] })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'url', ANN)

    saveWindow(result, url, { name: 'url', type: 'string', value: "'https://' + host", isExpression: true })

    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ url: { type: 'string', value: 'ann' } })
  })

  it('keeps the staged value under its name when the rename is refused', async () => {
    setupStore({
      variables: [COUNT_ROW],
      renameVariable: vi.fn().mockReturnValue({ success: false, error: 'Name "total" already exists in this scope' }),
    })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE)

    saveWindow(result, COUNT_ROW, { name: 'total', type: 'integer', value: 1 })

    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ count: { type: 'integer', value: 5 } })
  })

  it('moves the staged value of a Function local with a rename, inside its Function', async () => {
    setupStore({ nodes: [localFunctionNode('fn-a', { variables: [TMP_LOCAL] })] })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'tmp', FIVE, PATH_FN_A)

    saveWindow(result, TMP_LOCAL, { name: 'tmp2', type: 'integer', value: 1 }, PATH_FN_A)

    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([
      { function_path: ['fn-a'], variables: { tmp2: { type: 'integer', value: 5 } } },
    ])
  })

  it('drops the staged value of a Function input whose type changed', async () => {
    setupStore({ nodes: [localFunctionNode('fn-a', { inputs: [{ name: 'who', type: 'string' }] })] })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'who', ANN, PATH_FN_A)

    saveWindow(result, WHO_INPUT, { name: 'who', type: 'integer', value: 0 }, PATH_FN_A)

    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([])
  })

  it('moves the staged value of a Function output with a rename', async () => {
    const total = makeVariable({ id: 'param:output:total', name: 'total', type: 'integer', value: 0 })
    setupStore({ nodes: [localFunctionNode('fn-a', { outputs: [{ name: 'total', type: 'integer', default: 0 }] })] })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'total', FIVE, PATH_FN_A)

    saveWindow(result, total, { name: 'sum', type: 'integer', value: 0 }, PATH_FN_A)

    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([
      { function_path: ['fn-a'], variables: { sum: { type: 'integer', value: 5 } } },
    ])
  })

  it('moves the staged value of a Function input with a rename', async () => {
    setupStore({ nodes: [localFunctionNode('fn-a', { inputs: [{ name: 'who', type: 'string' }] })] })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'who', ANN, PATH_FN_A)

    saveWindow(result, WHO_INPUT, { name: 'person', type: 'string', value: null }, PATH_FN_A)

    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([
      { function_path: ['fn-a'], variables: { person: { type: 'string', value: 'ann' } } },
    ])
  })

  it('drops the staged value of a deleted Test variable and keeps a same-named Function local value', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE)
    await stageCurrent(result, 'count', FIVE, PATH_FN_A)

    act(() => {
      result.current.handleVariableDelete('v-count')
    })
    act(() => {
      result.current.confirmVariableDelete()
    })

    expect(runSeed(result.current.readStagedOverrides())).toEqual({
      variables: {},
      function_variables: [{ function_path: ['fn-a'], variables: { count: { type: 'integer', value: 5 } } }],
    })
  })

  it('drops the staged value of a deleted Function local in the Function shown and keeps the Test values', async () => {
    setupStore({
      variables: [COUNT_ROW],
      nodes: [localFunctionNode('fn-a', { variables: [TMP_LOCAL] })],
      drillPath: PATH_FN_A,
    })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE, [])
    await stageCurrent(result, 'tmp', FIVE, PATH_FN_A)

    act(() => {
      result.current.handleVariableDelete('l-tmp')
    })
    act(() => {
      result.current.confirmVariableDelete()
    })

    expect(runSeed(result.current.readStagedOverrides())).toEqual({
      variables: { count: { type: 'integer', value: 5 } },
      function_variables: [],
    })
  })

  it('drops the staged value of a deleted Function input in the Function shown', async () => {
    setupStore({
      nodes: [localFunctionNode('fn-a', { inputs: [{ name: 'who', type: 'string' }] })],
      drillPath: PATH_FN_A,
    })
    const { result } = renderVarManagement(null)
    await stageCurrent(result, 'who', ANN, PATH_FN_A)

    act(() => {
      result.current.handleVariableDelete('param:input:who')
    })
    act(() => {
      result.current.confirmVariableDelete()
    })

    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([])
  })

  it('drops the staged values of a deleted Function Block and keeps those of the Blocks still there', async () => {
    const fnA = localFunctionNode('fn-a', { variables: [TMP_LOCAL] })
    const fnB = localFunctionNode('fn-b', { variables: [TMP_LOCAL] })
    setupStore({ variables: [COUNT_ROW], nodes: [fnA, fnB] })
    const { result, rerender } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE)
    await stageCurrent(result, 'tmp', FIVE, PATH_FN_A)
    await stageCurrent(result, 'tmp', FIVE, PATH_FN_B)

    currentStore.nodes = [fnB]
    rerender()

    expect(runSeed(result.current.readStagedOverrides())).toEqual({
      variables: { count: { type: 'integer', value: 5 } },
      function_variables: [{ function_path: ['fn-b'], variables: { tmp: { type: 'integer', value: 5 } } }],
    })
  })

  it('drops the staged value of a Function Block deleted inside a Local Function and keeps the outer one', async () => {
    const inner = localFunctionNode('fn-inner', { variables: [TMP_LOCAL] })
    setupStore({ nodes: [localFunctionNode('fn-a', { variables: [TMP_LOCAL], nodes: [inner] })] })
    const { result, rerender } = renderVarManagement(null)
    await stageCurrent(result, 'tmp', FIVE, PATH_FN_A)
    await stageCurrent(result, 'tmp', FIVE, [...PATH_FN_A, { nodeId: 'fn-inner', label: 'fn-inner' }])

    currentStore.nodes = [localFunctionNode('fn-a', { variables: [TMP_LOCAL] })]
    rerender()

    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([
      { function_path: ['fn-a'], variables: { tmp: { type: 'integer', value: 5 } } },
    ])
  })

  it('keeps the staged value of a Function Block inside a Shared Function in edit mode after the author drills back out', async () => {
    const inner = localFunctionNode('inner-fn', { variables: [TMP_LOCAL] })
    const shared = (localDefinition?: unknown) => ({
      id: 'shared-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Greet',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: 'fn-1',
        functionVersion: '1.0.0',
        editMode: true,
        ...(localDefinition === undefined ? {} : { localDefinition }),
      },
    })
    const drilled: DrillEntry[] = [
      { nodeId: 'shared-1', label: 'Greet' },
      { nodeId: 'inner-fn', label: 'inner-fn' },
    ]
    setupStore({
      nodes: [shared({ workflow: { nodes: [inner], edges: [] }, inputs: [], outputs: [], variables: [] })],
      drillPath: drilled,
    })
    const { result, rerender } = renderVarManagement(null)
    await stageCurrent(result, 'tmp', FIVE, drilled)

    // Drilling out unloads the Shared body the canvas showed while drilled in.
    currentStore.nodes = [shared()]
    currentStore.drillPath = []
    rerender()

    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([
      { function_path: ['shared-1', 'inner-fn'], variables: { tmp: { type: 'integer', value: 5 } } },
    ])
  })
})

describe('useVariableManagement - a Function input keeps its staged Current value through Reset (FNCFG-8, REQ-3.1.2.10)', () => {
  const PATH_ALONE: DrillEntry[] = [{ nodeId: 'fn-alone', label: 'Greet' }]
  const ANN = { value: 'ann', type: 'string' } as const
  const FIVE = { value: 5, type: 'integer' } as const

  beforeEach(resetHookMocks)

  function drilledIntoFunction() {
    setupStore({
      variables: [COUNT_ROW],
      nodes: [
        localFunctionNode('fn-alone', {
          inputs: [{ name: 'who', type: 'string', required: true }],
          variables: [makeVariable({ id: 'l-tmp', name: 'tmp', type: 'integer', value: 1 })],
        }),
      ],
      drillPath: PATH_ALONE,
    })
    return renderHook(
      ({ sid }: { sid: string | null }) => useVariableManagement(sid, mockRegisterVariableHandler),
      { initialProps: { sid: null as string | null } },
    )
  }

  async function stageAll(result: { current: VariableManagementResult }) {
    await act(async () => {
      await result.current.handleVariableCurrentEdit('who', ANN, PATH_ALONE)
      await result.current.handleVariableCurrentEdit('tmp', FIVE, PATH_ALONE)
      await result.current.handleVariableCurrentEdit('count', FIVE, [])
    })
  }

  it('keeps the value set on a Function input before a run, after that run and its Reset', async () => {
    const { result, rerender } = drilledIntoFunction()
    await stageAll(result)

    rerender({ sid: 'sess-1' })
    rerender({ sid: null })

    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([
      { function_path: ['fn-alone'], variables: { who: { type: 'string', value: 'ann' } } },
    ])
    expect(result.current.appliedOverrides.size).toBe(1)
  })

  it('clears a same-named Test variable value on Reset while the Function input keeps its own', async () => {
    const { result, rerender } = drilledIntoFunction()
    await act(async () => {
      await result.current.handleVariableCurrentEdit('who', ANN, PATH_ALONE)
      await result.current.handleVariableCurrentEdit('who', { value: 'bob', type: 'string' }, [])
    })

    rerender({ sid: 'sess-1' })
    rerender({ sid: null })

    expect(runSeed(result.current.readStagedOverrides())).toEqual({
      variables: {},
      function_variables: [{ function_path: ['fn-alone'], variables: { who: { type: 'string', value: 'ann' } } }],
    })
    expect(result.current.appliedOverrides.get('who')).toBeUndefined()
  })

  it('still clears the values staged on a Function local and on a Test variable on Reset', async () => {
    const { result, rerender } = drilledIntoFunction()
    await stageAll(result)

    rerender({ sid: 'sess-1' })
    rerender({ sid: null })

    const seed = runSeed(result.current.readStagedOverrides())
    expect(seed.variables).toEqual({})
    expect(seed.function_variables).toHaveLength(1)
    expect(seed.function_variables[0]?.variables).not.toHaveProperty('tmp')
  })
})

describe('useVariableManagement - a library View Function is the root scope of its own run (REQ-3.1.2.10)', () => {
  const VIEW_ROOT: DrillEntry = { nodeId: 'view-shared-root', label: 'Greet' }
  const INNER: DrillEntry = { nodeId: 'inner-fn', label: 'inner-fn' }
  const ANN = { value: 'ann', type: 'string' } as const
  const FIVE = { value: 5, type: 'integer' } as const

  beforeEach(resetHookMocks)

  function libraryView(sessionId: string | null) {
    const inner = localFunctionNode('inner-fn', {
      variables: [makeVariable({ id: 'l-tries', name: 'tries', type: 'integer', value: 1 })],
    })
    const root = {
      id: 'view-shared-root',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Greet',
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: 'fn-1',
        functionVersion: '1.2.0',
        localDefinition: {
          workflow: { nodes: [inner], edges: [] },
          inputs: [{ name: 'who', type: 'string' }],
          outputs: [],
          variables: [],
        },
      },
    }
    const viewMode = { functionViewMode: { functionId: 'fn-1', version: '1.2.0', editable: false } }
    setupStore({ nodes: [root], drillPath: [VIEW_ROOT], ...(viewMode as Partial<StoreState>) })
    return renderVarManagement(sessionId)
  }

  async function setCurrent(
    result: { current: VariableManagementResult },
    name: string,
    body: StagedOverride,
    functionPath: DrillEntry[],
  ) {
    await act(async () => {
      await result.current.handleVariableCurrentEdit(name, body, functionPath)
    })
  }

  it("sends the Function's own variable to its session in the root scope", async () => {
    const { result } = libraryView('sess-1')

    await setCurrent(result, 'who', ANN, [VIEW_ROOT])

    const call = vi.mocked(workbenchApi.setVariableOverride).mock.calls[0]
    expect(call.slice(0, 3)).toEqual(['sess-1', 'who', ANN])
    expect(sentPath(call)).toEqual([])
  })

  it("stages the Function's own variable as a variable of its run alone", async () => {
    const { result } = libraryView(null)

    await setCurrent(result, 'who', ANN, [VIEW_ROOT])

    expect(runSeed(result.current.readStagedOverrides())).toEqual({
      variables: { who: { type: 'string', value: 'ann' } },
      function_variables: [],
    })
  })

  it('addresses a Function Block inside the library View Function from that Function inward', async () => {
    const { result } = libraryView('sess-1')

    await setCurrent(result, 'tries', FIVE, [VIEW_ROOT, INNER])

    expect(sentPath(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0])).toEqual(['inner-fn'])
  })

  it('keeps the staged value of a Function Block inside the library View Function while it is there', async () => {
    const { result, rerender } = libraryView(null)
    await setCurrent(result, 'tries', FIVE, [VIEW_ROOT, INNER])

    currentStore.nodes = [...currentStore.nodes]
    rerender()

    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([
      { function_path: ['inner-fn'], variables: { tries: { type: 'integer', value: 5 } } },
    ])
  })
})

describe('useVariableManagement - a variable renamed while a run lives keeps the name the run declared (VMGR-19)', () => {
  const NINE = { value: '9', type: 'integer' } as const

  beforeEach(resetHookMocks)

  function liveRun(variables: WorkflowVariable[] = [COUNT_ROW], store: Partial<StoreState> = {}) {
    setupStore({ variables, ...store })
    return renderHook(
      ({ sid }: { sid: string | null }) => useVariableManagement(sid, mockRegisterVariableHandler),
      { initialProps: { sid: 'sess-1' as string | null } },
    )
  }

  function saveWindow(
    result: { current: VariableManagementResult },
    target: WorkflowVariable,
    spec: VariableCreateSpec,
    functionPath?: DrillEntry[],
  ) {
    act(() => {
      result.current.handleVariableWindowSave(target, spec, functionPath)
    })
  }

  async function setCurrent(
    result: { current: VariableManagementResult },
    name: string,
    functionPath?: DrillEntry[],
  ) {
    await act(async () => {
      await result.current.handleVariableCurrentEdit(name, NINE, functionPath)
    })
  }

  const sentNames = () => vi.mocked(workbenchApi.setVariableOverride).mock.calls.map((call) => call[1])

  /** A rename the store keeps, as the real store does. */
  const renameInStore = vi.fn((id: string, name: string) => {
    currentStore.variables = currentStore.variables.map((v) => (v.id === id ? { ...v, name } : v))
    return { success: true }
  })

  it('writes the Current value of a renamed Test variable under the name the run declared', async () => {
    const { result } = liveRun()

    saveWindow(result, COUNT_ROW, { name: 'total', type: 'integer', value: 1 })
    await setCurrent(result, 'total')

    expect(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0].slice(0, 3)).toEqual(['sess-1', 'count', NINE])
    expect(result.current.appliedOverrides.get('total')).toEqual(NINE)
  })

  it('keeps the name the run declared through a second rename', async () => {
    const { result } = liveRun()

    saveWindow(result, COUNT_ROW, { name: 'total', type: 'integer', value: 1 })
    saveWindow(result, { ...COUNT_ROW, name: 'total' }, { name: 'sum', type: 'integer', value: 1 })
    await setCurrent(result, 'sum')

    expect(sentNames()).toEqual(['count'])
  })

  it('writes the Current value of a renamed Function input under the name the run declared, in its scope', async () => {
    const { result } = liveRun([], { nodes: [localFunctionNode('fn-a', { inputs: [{ name: 'who', type: 'string' }] })] })

    saveWindow(result, WHO_INPUT, { name: 'person', type: 'string', value: null }, PATH_FN_A)
    await act(async () => {
      await result.current.handleVariableCurrentEdit('person', { value: 'ann', type: 'string' }, PATH_FN_A)
    })

    const call = vi.mocked(workbenchApi.setVariableOverride).mock.calls[0]
    expect(call[1]).toBe('who')
    expect(sentPath(call)).toEqual(['fn-a'])
  })

  it('writes a variable saved under its own name with that name', async () => {
    const { result } = liveRun()

    saveWindow(result, COUNT_ROW, { name: 'count', type: 'integer', value: 2 })
    await setCurrent(result, 'count')

    expect(sentNames()).toEqual(['count'])
  })

  it('writes under the new name once the session ends and the next run declares it', async () => {
    const { result, rerender } = liveRun([COUNT_ROW], { renameVariable: renameInStore })
    saveWindow(result, COUNT_ROW, { name: 'total', type: 'integer', value: 1 })

    rerender({ sid: null })
    rerender({ sid: 'sess-2' })
    await setCurrent(result, 'total')

    expect(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0].slice(0, 2)).toEqual(['sess-2', 'total'])
  })

  it('writes a variable renamed before the run under its new name', async () => {
    setupStore({ variables: [COUNT_ROW], renameVariable: renameInStore })
    const { result, rerender } = renderHook(
      ({ sid }: { sid: string | null }) => useVariableManagement(sid, mockRegisterVariableHandler),
      { initialProps: { sid: null as string | null } },
    )
    saveWindow(result, COUNT_ROW, { name: 'total', type: 'integer', value: 1 })

    rerender({ sid: 'sess-1' })
    await setCurrent(result, 'total')

    expect(sentNames()).toEqual(['total'])
  })
})

describe('useVariableManagement - a new Expression output gets the create-time cycle check locals get', () => {
  beforeEach(() => resetHookMocks())

  it('refuses an output that closes a cycle with a local, and adds nothing', () => {
    const local = makeVariable({ id: 'l1', name: 'a', value: 'res + 1', isExpression: true })
    setupStore({ nodes: [localFunctionNode('fn-a', { variables: [local] })] })
    const { result } = renderVarManagement()

    let res!: { success: boolean; error?: string }
    act(() => {
      res = result.current.handleCreateParameter(
        'output',
        { name: 'res', type: 'string', value: 'a + 1', isExpression: true },
        PATH_FN_A,
      )
    })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/^Circular reference detected for variable '(a|res)':/)
    expect(currentStore.addOutputParam).not.toHaveBeenCalled()
  })
})

describe('useVariableManagement - deleting inside a Function clears the bindings the dialog names', () => {
  beforeEach(() => resetHookMocks())

  const innerBlock = (writes: string) => ({ id: 'inner', data: { label: 'Inner', config: { outputBindings: { out: writes, other: 'keep' } } } })
  // setNodes writes the drilled scope: it must get that scope's Blocks, never the whole tree.
  const innerBindings = (scopeNodes: unknown[]) => {
    const blocks = scopeNodes as Array<{ id: string; data: { config: { outputBindings: Record<string, string> } } }>
    expect(blocks.map((block) => block.id)).toEqual(['inner'])
    return blocks[0].data.config.outputBindings
  }

  it('clears an inner Block binding to a deleted Function local, in one undo step', () => {
    const local = makeVariable({ id: 'l-loc', name: 'loc', value: '1' })
    setupStore({ nodes: [localFunctionNode('fn-a', { variables: [local], nodes: [innerBlock('loc')] })], drillPath: PATH_FN_A })
    const { result } = renderVarManagement()

    act(() => result.current.handleVariableDelete('l-loc'))
    act(() => result.current.confirmVariableDelete())

    expect(currentStore.transaction).toHaveBeenCalledTimes(1)
    expect(innerBindings(currentStore.setNodes.mock.calls[0][0])).toEqual({ out: '', other: 'keep' })
    expect(currentStore.removeVariable).toHaveBeenCalledWith('l-loc')
  })

  it('clears an inner Block binding to a deleted output before removing the output', () => {
    setupStore({
      nodes: [localFunctionNode('fn-a', { outputs: [{ name: 'res', type: 'string' }], nodes: [innerBlock('res')] })],
      drillPath: PATH_FN_A,
    })
    const { result } = renderVarManagement()

    act(() => result.current.handleVariableDelete('param:output:res'))
    act(() => result.current.confirmVariableDelete())

    expect(innerBindings(currentStore.setNodes.mock.calls[0][0])).toEqual({ out: '', other: 'keep' })
    expect(currentStore.removeOutputParam).toHaveBeenCalledWith('res')
  })

  it('writes no nodes when nothing is bound to the deleted name', () => {
    const local = makeVariable({ id: 'l-loc', name: 'loc', value: '1' })
    setupStore({ nodes: [localFunctionNode('fn-a', { variables: [local], nodes: [innerBlock('other_var')] })], drillPath: PATH_FN_A })
    const { result } = renderVarManagement()

    act(() => result.current.handleVariableDelete('l-loc'))
    act(() => result.current.confirmVariableDelete())

    expect(currentStore.setNodes).not.toHaveBeenCalled()
    expect(currentStore.removeVariable).toHaveBeenCalledWith('l-loc')
  })
})

describe('useVariableManagement - evaluated results inside a Function go stale like the Test ones (REQ-3.2.1.5)', () => {
  beforeEach(() => resetHookMocks())

  const host = makeVariable({ id: 'l-host', name: 'host', value: 'b' })
  const url = makeVariable({ id: 'l-url', name: 'url', value: "'http://' + host", isExpression: true })
  const key = (name: string) => scopedVariableKey(name, ['fn-a'])
  const forgotten = () => mockForgetRuntimeValue.mock.calls.map(([name]) => name)

  function afterARunInsideTheFunction() {
    mockRuntimeValues = new Map<string, unknown>([[key('url'), 'http://b']])
    setupStore({ nodes: [localFunctionNode('fn-a', { variables: [host, url] })], drillPath: PATH_FN_A })
    return renderHook(() => useVariableManagement('sess-1', mockRegisterVariableHandler))
  }

  it('drops the result of a computed local when a local it reads is edited with the pencil', () => {
    const hook = afterARunInsideTheFunction()

    currentStore.nodes = [localFunctionNode('fn-a', { variables: [{ ...host, value: 'c' }, url] })]
    hook.rerender()

    expect(forgotten()).toEqual([key('url')])
  })

  it('drops the result of a computed local when a local it reads gets a Current value', async () => {
    const { result } = afterARunInsideTheFunction()

    await act(async () => {
      await result.current.applyVariableOverride('host', { value: 'c', type: 'string' }, PATH_FN_A)
    })

    expect(forgotten()).toEqual([key('url')])
  })

  it('keeps a same-named Test result when a Function local is edited', () => {
    mockRuntimeValues = new Map<string, unknown>([['url', 'http://root'], [key('url'), 'http://b']])
    setupStore({
      variables: [makeVariable({ id: 'v-url', name: 'url', value: "'http://' + host", isExpression: true })],
      nodes: [localFunctionNode('fn-a', { variables: [host, url] })],
      drillPath: PATH_FN_A,
    })
    const hook = renderHook(() => useVariableManagement('sess-1', mockRegisterVariableHandler))

    currentStore.nodes = [localFunctionNode('fn-a', { variables: [{ ...host, value: 'c' }, url] })]
    hook.rerender()

    expect(forgotten()).toEqual([key('url')])
  })
})

describe('useVariableManagement - a variable added since the run started waits for the next run (REQ-3.2.1.6)', () => {
  const TRUE = { value: true, type: 'boolean' } as const
  const NINE = { value: 9, type: 'integer' } as const
  const BS_ROW = makeVariable({ id: 'v-bs', name: 'bs', type: 'boolean', value: false, isSecret: true })
  const TMP_LOCAL = makeVariable({ id: 'l-tmp', name: 'tmp', type: 'integer', value: 1 })
  const EXTRA_LOCAL = makeVariable({ id: 'l-extra', name: 'extra', type: 'integer', value: 2 })

  beforeEach(resetHookMocks)

  function liveRun(initial: Partial<StoreState>) {
    setupStore(initial)
    return renderHook(
      ({ sid }: { sid: string | null }) => useVariableManagement(sid, mockRegisterVariableHandler),
      { initialProps: { sid: 'sess-1' as string | null } },
    )
  }

  async function setCurrent(
    result: { current: VariableManagementResult },
    name: string,
    body: StagedOverride,
    functionPath?: DrillEntry[],
  ) {
    await act(async () => {
      await result.current.handleVariableCurrentEdit(name, body, functionPath)
    })
  }

  it('stages the Current value of a Test variable added while the run lives, and sends nothing to the run', async () => {
    const { result, rerender } = liveRun({ variables: [COUNT_ROW] })
    currentStore.variables = [COUNT_ROW, BS_ROW]
    rerender({ sid: 'sess-1' })

    await setCurrent(result, 'bs', TRUE)

    expect(vi.mocked(workbenchApi.setVariableOverride)).not.toHaveBeenCalled()
    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ bs: { type: 'boolean', value: true } })
    expect(result.current.appliedOverrides.get('bs')).toEqual(TRUE)
  })

  it('still sends a Test variable the run declared', async () => {
    const { result, rerender } = liveRun({ variables: [COUNT_ROW] })
    currentStore.variables = [COUNT_ROW, BS_ROW]
    rerender({ sid: 'sess-1' })

    await setCurrent(result, 'count', NINE)

    expect(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0].slice(0, 3)).toEqual(['sess-1', 'count', NINE])
    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({})
  })

  it('stages a variable added while the run lives under its new name after a rename', async () => {
    const { result, rerender } = liveRun({ variables: [COUNT_ROW] })
    currentStore.variables = [COUNT_ROW, BS_ROW]
    rerender({ sid: 'sess-1' })
    act(() => {
      result.current.handleVariableWindowSave(BS_ROW, { name: 'flag', type: 'boolean', value: false, secret: true })
    })

    await setCurrent(result, 'flag', TRUE)

    expect(vi.mocked(workbenchApi.setVariableOverride)).not.toHaveBeenCalled()
    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ flag: { type: 'boolean', value: true } })
  })

  it('sends the variable to the next run once that run declared it', async () => {
    const { result, rerender } = liveRun({ variables: [COUNT_ROW] })
    currentStore.variables = [COUNT_ROW, BS_ROW]
    rerender({ sid: 'sess-1' })
    rerender({ sid: 'sess-2' })

    await setCurrent(result, 'bs', TRUE)

    expect(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0].slice(0, 3)).toEqual(['sess-2', 'bs', TRUE])
  })

  it('stages the Current value of a Function local added while the run lives, in its own scope', async () => {
    const { result, rerender } = liveRun({ nodes: [localFunctionNode('fn-a', { variables: [TMP_LOCAL] })] })
    currentStore.nodes = [localFunctionNode('fn-a', { variables: [TMP_LOCAL, EXTRA_LOCAL] })]
    rerender({ sid: 'sess-1' })

    await setCurrent(result, 'extra', NINE, PATH_FN_A)
    await setCurrent(result, 'tmp', NINE, PATH_FN_A)

    const calls = vi.mocked(workbenchApi.setVariableOverride).mock.calls
    expect(calls.map((call) => call[1])).toEqual(['tmp'])
    expect(sentPath(calls[0])).toEqual(['fn-a'])
    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([
      { function_path: ['fn-a'], variables: { extra: { type: 'integer', value: 9 } } },
    ])
  })
})

describe('useVariableManagement - the live run takes only what it declared (VMGR-19, REQ-3.2.1.6)', () => {
  const NINE = { value: 9, type: 'integer' } as const
  const TMP = makeVariable({ id: 'l-tmp', name: 'tmp', type: 'integer', value: 1 })
  const GREETING = makeVariable({ id: 'v-greet', name: 'greeting', type: 'string', value: 'hello' })

  beforeEach(resetHookMocks)

  function liveRun(initial: Partial<StoreState>) {
    setupStore(initial)
    return renderHook(
      ({ sid }: { sid: string | null }) => useVariableManagement(sid, mockRegisterVariableHandler),
      { initialProps: { sid: 'sess-1' as string | null } },
    )
  }

  async function setCurrent(
    result: { current: VariableManagementResult },
    name: string,
    body: StagedOverride,
    functionPath?: DrillEntry[],
  ) {
    await act(async () => {
      await result.current.handleVariableCurrentEdit(name, body, functionPath)
    })
  }

  const sent = () => vi.mocked(workbenchApi.setVariableOverride).mock.calls.map((call) => call[1])

  it('stages a new variable that took the name of one renamed since the run started', async () => {
    const renameInStore = vi.fn((id: string, name: string) => {
      currentStore.variables = currentStore.variables.map((v) => (v.id === id ? { ...v, name } : v))
      return { success: true }
    })
    const { result, rerender } = liveRun({ variables: [COUNT_ROW], renameVariable: renameInStore })
    act(() => {
      result.current.handleVariableWindowSave(COUNT_ROW, { name: 'total', type: 'integer', value: 1 })
    })
    currentStore.variables = [...currentStore.variables, makeVariable({ id: 'v-new', name: 'count', type: 'integer', value: 0 })]
    rerender({ sid: 'sess-1' })

    await setCurrent(result, 'count', NINE)
    await setCurrent(result, 'total', NINE)

    expect(sent()).toEqual(['count'])
    expect(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0][2]).toEqual(NINE)
    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ count: { type: 'integer', value: 9 } })
  })

  it('stages a value of another type than the run declared', async () => {
    const { result } = liveRun({ variables: [COUNT_ROW] })

    await setCurrent(result, 'count', { value: 'nine', type: 'string' })

    expect(sent()).toEqual([])
    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ count: { type: 'string', value: 'nine' } })
  })

  it('stages a source of another kind than the run declared, and sends a plain value or null', async () => {
    const { result } = liveRun({ variables: [GREETING] })

    await setCurrent(result, 'greeting', { expression: "'hi'", type: 'string' })
    await setCurrent(result, 'greeting', { value: null, type: 'string' })

    expect(sent()).toEqual(['greeting'])
    expect(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0][2]).toEqual({ value: null, type: 'string' })
  })

  it('sends a source of the kind the run declared', async () => {
    const url = makeVariable({ id: 'v-url', name: 'url', type: 'string', value: "'a'", isExpression: true })
    const page = makeVariable({ id: 'v-page', name: 'page', type: 'string', value: 'Hi {{ url }}', isTemplate: true })
    const { result } = liveRun({ variables: [url, page] })

    await setCurrent(result, 'url', { expression: "'b'", type: 'string' })
    await setCurrent(result, 'page', { template: 'Bye {{ url }}', type: 'string' })
    await setCurrent(result, 'page', { expression: "'c'", type: 'string' })

    expect(sent()).toEqual(['url', 'page'])
  })

  it('stages a value for a Function Block added since the run started', async () => {
    const { result, rerender } = liveRun({ nodes: [] })
    currentStore.nodes = [localFunctionNode('fn-a', { variables: [TMP] })]
    rerender({ sid: 'sess-1' })

    await setCurrent(result, 'tmp', NINE, PATH_FN_A)

    expect(sent()).toEqual([])
    expect(runSeed(result.current.readStagedOverrides()).function_variables).toEqual([
      { function_path: ['fn-a'], variables: { tmp: { type: 'integer', value: 9 } } },
    ])
  })

  it('sends a value inside a Shared Function whose body the tree does not hold, for the run to check', async () => {
    const shared = {
      id: 'shared-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: { label: 'Greet', nodeType: 'function', functionLifecycle: 'shared', functionId: 'fn-1', functionVersion: '1.0.0' },
    }
    const { result } = liveRun({ nodes: [shared] })

    await setCurrent(result, 'tmp', NINE, [{ nodeId: 'shared-1', label: 'Greet' }, { nodeId: 'inner', label: 'inner' }])

    expect(sent()).toEqual(['tmp'])
    expect(sentPath(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0])).toEqual(['shared-1', 'inner'])
  })
})

describe('useVariableManagement - Current values follow an undo or redo of their definition (REQ-3.2.1.6)', () => {
  const FIVE = { value: 5, type: 'integer' } as const
  const TOTAL_ROW = makeVariable({ id: 'v-count', name: 'total', type: 'integer', value: 1 })

  beforeEach(resetHookMocks)

  async function stageCurrent(result: { current: VariableManagementResult }, name: string, body: StagedOverride) {
    await act(async () => {
      await result.current.handleVariableCurrentEdit(name, body)
    })
  }

  it('moves a staged value back with an undone rename', async () => {
    setupStore({ variables: [TOTAL_ROW] })
    const { result, rerender } = renderVarManagement(null)
    await stageCurrent(result, 'total', FIVE)

    currentStore.variables = [COUNT_ROW]
    rerender()

    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ count: { type: 'integer', value: 5 } })
    expect(result.current.appliedOverrides.get('count')).toEqual(FIVE)
  })

  it('drops a staged value whose variable an undo removed', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result, rerender } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE)

    currentStore.variables = []
    rerender()

    expect(runSeed(result.current.readStagedOverrides())).toEqual({ variables: {}, function_variables: [] })
  })

  it('keeps a staged value when another variable of the same name replaced the removed one', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result, rerender } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE)

    currentStore.variables = [makeVariable({ id: 'v-other', name: 'count', type: 'integer', value: 2 })]
    rerender()

    expect(runSeed(result.current.readStagedOverrides()).variables).toEqual({ count: { type: 'integer', value: 5 } })
  })

  it.each([
    ['type', { type: 'string' as const }],
    ['kind', { isExpression: true, value: '1 + 1' }],
  ])('drops a staged value whose %s an undo changed', async (_what, change) => {
    setupStore({ variables: [COUNT_ROW] })
    const { result, rerender } = renderVarManagement(null)
    await stageCurrent(result, 'count', FIVE)

    currentStore.variables = [{ ...COUNT_ROW, ...change }]
    rerender()

    expect(runSeed(result.current.readStagedOverrides())).toEqual({ variables: {}, function_variables: [] })
  })

  it('follows a rename undone while a run lives back to the name the run declared', async () => {
    setupStore({ variables: [COUNT_ROW] })
    const { result, rerender } = renderHook(
      ({ sid }: { sid: string | null }) => useVariableManagement(sid, mockRegisterVariableHandler),
      { initialProps: { sid: 'sess-1' as string | null } },
    )
    currentStore.variables = [TOTAL_ROW]
    rerender({ sid: 'sess-1' })
    currentStore.variables = [COUNT_ROW]
    rerender({ sid: 'sess-1' })

    await stageCurrent(result, 'count', FIVE)

    expect(vi.mocked(workbenchApi.setVariableOverride).mock.calls.map((call) => call[1])).toEqual(['count'])
  })
})

describe('useVariableManagement - a Function body written without a Block list', () => {
  const NINE = { value: 9, type: 'integer' } as const
  const BARE = {
    id: 'fn-a',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'fn-a',
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: { variables: [makeVariable({ id: 'l-tmp', name: 'tmp', type: 'integer', value: 1 })] },
    },
  }

  beforeEach(resetHookMocks)

  it('still declares its locals to the run, so their Current value goes to the live run', async () => {
    setupStore({ nodes: [BARE] })
    const { result } = renderVarManagement('sess-1')

    await act(async () => {
      await result.current.handleVariableCurrentEdit('tmp', NINE, PATH_FN_A)
    })

    expect(vi.mocked(workbenchApi.setVariableOverride).mock.calls[0].slice(0, 3)).toEqual(['sess-1', 'tmp', NINE])
  })

  it('tracks no Function inside it and holds no Shared body', () => {
    expect(tracksSecretsAt([BARE], ['fn-a', 'fn-b'], null)).toBe(false)
    expect(instancesWithoutBody([BARE])).toEqual([])
  })
})
