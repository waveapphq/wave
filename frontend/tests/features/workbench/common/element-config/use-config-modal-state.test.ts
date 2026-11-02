/**
 * useConfigModalState - pure state-logic tests.
 *
 * Covers two contracts:
 * - Output parameter derivation (SSH-5): a node's outputs convert into
 *   the table's outputParameters, carrying each output's description so the
 *   output rows render their (i) tooltip. An output that declares `typeWhen`
 *   resolves its type against the current field values (K8SREAD-6).
 * - Per-block reveal-set state (REQ-3.1.3.16): the hook loads
 *   `unmaskedSecretFields` from the element, exposes a setter, folds it into
 *   `hasChanges`, and writes it back through onSave - mirroring the existing
 *   `outputSecretFields` load/save thread.
 * - Switch/Case editor state (REQ-3.5.1.20): the hook owns the case
 *   branch list, keeps `branches` out of the generic parameter table and the
 *   required-field check, and gates Save on the case editor's validity -
 *   mirroring the If/Else thread it sits beside.
 * - Variable-export rows (SHRUN-6, REQ-3.4.1.1): the hook owns the Shell
 *   Script export list, keeps it out of the Input Parameters table, folds its
 *   errors into Save, and merges its rows into the saved values, bindings,
 *   secret names and output types. A row bound to a variable that does not
 *   exist yet carries the type chosen in the row; an existing variable's type
 *   wins over that choice; the choice itself is never saved.
 *
 * - Template kind by default (OS-5): a row that declares `templateByDefault`
 *   opens in Template kind while its saved value is blank and the author has
 *   chosen no kind for it; a row the author set to Literal with text stays Literal
 *   (REQ-3.3.2.6).
 *
 * The workflow store and enriched-variables hook are mocked so this stays a
 * pure state-logic test with no store or API dependency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({ drillPath: [], functionViewMode: null }),
}))

const mockEnrichedVariables: { current: unknown[] } = { current: [] }

vi.mock('@/features/workbench/common/element-config/use-enriched-variables', () => ({
  useEnrichedVariables: () => mockEnrichedVariables.current,
}))

// A test sets these to stand in for the shared Block field lookup; unset, the real lookup answers.
const blockFields: { inputs?: unknown[]; outputs?: unknown[] } = {}

vi.mock('@/features/workbench/lib/node-parameters', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const lookup = (name: string, override: () => unknown[] | undefined) =>
    (...args: unknown[]) =>
      override() ?? (actual[name] as ((...rest: unknown[]) => unknown) | undefined)?.(...args)
  return {
    ...actual,
    blockInputParams: lookup('blockInputParams', () => blockFields.inputs),
    blockOutputParams: lookup('blockOutputParams', () => blockFields.outputs),
  }
})

import { useConfigModalState } from '@/features/workbench/common/element-config/use-config-modal-state'
import type { ElementData, SaveData } from '@/features/workbench/common/element-config/types'

type ConfigState = ReturnType<typeof useConfigModalState> & {
  unmaskedSecretFields: string[]
  setUnmaskedSecretFields: (fields: string[]) => void
}

interface SwitchBranch {
  id: string
  type: 'case' | 'default'
  label: string
  conditions?: unknown[]
  break?: boolean
}

type SwitchState = ReturnType<typeof useConfigModalState> & {
  isSwitch: boolean
  switchBranches: SwitchBranch[]
  setSwitchBranches: (branches: SwitchBranch[]) => void
  setSwitchValid: (valid: boolean) => void
}

const savedBranches: SwitchBranch[] = [
  { id: 'branch_0', type: 'case', label: 'Fast', conditions: [], break: true },
  { id: 'branch_1', type: 'case', label: 'Slow', conditions: [], break: false },
  { id: 'branch_2', type: 'default', label: '' },
]

interface ParallelBranch {
  id: string
  name: string
  timeLimit?: number | string
}

type ParallelState = ReturnType<typeof useConfigModalState> & {
  isParallel: boolean
  parallelBranches: ParallelBranch[]
  parallelJoin: 'all' | 'first'
  setParallelBranches: (branches: ParallelBranch[]) => void
  setParallelJoin: (join: 'all' | 'first') => void
  setParallelValid: (valid: boolean) => void
}

const savedParallelBranches: ParallelBranch[] = [
  { id: 'branch_1', name: 'ingest', timeLimit: 30000 },
  { id: 'branch_2', name: 'probe' },
]

function makeElement(overrides: Partial<ElementData> = {}): ElementData {
  return {
    id: 'node-1',
    name: 'HTTP',
    elementType: 'http-client',
    version: '1.0.0',
    availableVersions: ['1.0.0'],
    parameters: [],
    outputs: [],
    currentValues: {},
    outputBindings: {},
    ...overrides,
  }
}

function renderState(outputs: ElementData['outputs']) {
  // Unregistered type: the hook falls back to element.outputs, so this
  // exercises the derivation itself independent of any plugin schema.
  return renderHook(() =>
    useConfigModalState(
      makeElement({ elementType: 'derivation-probe', outputs }),
      vi.fn(),
      vi.fn(),
    ),
  )
}

function renderControl(elementType: string, currentValues: Record<string, unknown> = {}) {
  return renderHook(() =>
    useConfigModalState(makeElement({ elementType, currentValues }), vi.fn(), vi.fn()),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEnrichedVariables.current = []
  blockFields.inputs = undefined
  blockFields.outputs = undefined
})

describe('outputParameters derivation', () => {
  it('carries the output description into the table parameters', () => {
    const { result } = renderState([
      {
        name: 'session_id',
        label: 'Session ID',
        type: 'string',
        description: 'Handle for Execute / Close / Parent Session',
      },
    ])

    expect(result.current.outputParameters).toHaveLength(1)
    expect(result.current.outputParameters[0].description).toBe(
      'Handle for Execute / Close / Parent Session',
    )
  })

  it('keeps name, label, and type alongside the description', () => {
    const { result } = renderState([
      {
        name: 'connected',
        label: 'Connected',
        type: 'boolean',
        description: 'Keepalive-refreshed liveness signal',
      },
    ])

    const derived = result.current.outputParameters[0]
    expect(derived.name).toBe('connected')
    expect(derived.label).toBe('Connected')
    expect(derived.type).toBe('boolean')
    expect(derived.required).toBe(false)
  })

  it('leaves description undefined for outputs that declare none', () => {
    const { result } = renderState([
      { name: 'hop_count', label: 'Hop Count', type: 'integer' },
    ])

    expect(result.current.outputParameters[0].description).toBeUndefined()
  })

  it('derives one table parameter per output', () => {
    const { result } = renderState([
      { name: 'stdout', label: 'Stdout', type: 'string', description: 'Command standard output' },
      { name: 'stderr', label: 'Stderr', type: 'string', description: 'Command standard error' },
      { name: 'exit_code', label: 'Exit Code', type: 'integer', description: 'Command exit code' },
    ])

    expect(result.current.outputParameters.map((o) => o.name)).toEqual([
      'stdout',
      'stderr',
      'exit_code',
    ])
    for (const derived of result.current.outputParameters) {
      expect(derived.description).toBeTruthy()
    }
  })
})

describe('outputParameters resolved type (K8SREAD-6)', () => {
  function renderGet(
    currentValues: Record<string, unknown>,
    outputBindings: Record<string, string> = {},
  ) {
    return renderHook(() =>
      useConfigModalState(
        makeElement({ elementType: 'k8s-get', currentValues, outputBindings }),
        vi.fn(),
        vi.fn(),
      ),
    )
  }

  function resultType(currentValues: Record<string, unknown>): string {
    const { result } = renderGet(currentValues)
    return result.current.outputParameters.find((o) => o.name === 'result')!.type
  }

  it('follows Output Format and Search by on the Result row', () => {
    expect(resultType({})).toBe('map')
    expect(resultType({ output_format: 'table' })).toBe('table')
    expect(resultType({ output_format: 'yaml' })).toBe('string')
    expect(resultType({ output_format: 'map', search_by: 'list' })).toBe('array')
  })

  it('leaves the fixed outputs alone', () => {
    const { result } = renderGet({ output_format: 'table' })
    const byName = Object.fromEntries(result.current.outputParameters.map((o) => [o.name, o.type]))

    expect(byName.names).toBe('array')
    expect(byName.count).toBe('integer')
    expect(byName.success).toBe('boolean')
  })

  it('reports the mismatch inline when the format leaves a bound variable behind', () => {
    mockEnrichedVariables.current = [{ id: 'v1', name: 'pods', value: {}, type: 'map' }]

    const { result } = renderGet({ output_format: 'map' }, { result: 'pods' })
    expect(result.current.outputErrors.result).toBeUndefined()

    act(() => result.current.handleInputChange('output_format', 'table'))

    expect(result.current.outputErrors.result).toBe(
      'Type mismatch: "pods" is map, expected table',
    )
    expect(result.current.outputBindings.result).toBe('pods')
    expect(result.current.isFormValid).toBe(false)
  })
})

describe('useConfigModalState unmaskedSecretFields (REQ-3.1.3.16)', () => {
  it('initializes unmaskedSecretFields from the element', () => {
    const { result } = renderHook(() =>
      useConfigModalState(
        makeElement({ unmaskedSecretFields: ['authorization'] } as Partial<ElementData>),
        vi.fn(),
        vi.fn(),
      ),
    )
    expect((result.current as ConfigState).unmaskedSecretFields).toEqual(['authorization'])
  })

  it('defaults unmaskedSecretFields to an empty array when the element omits it', () => {
    const { result } = renderHook(() => useConfigModalState(makeElement(), vi.fn(), vi.fn()))
    expect((result.current as ConfigState).unmaskedSecretFields).toEqual([])
  })

  it('setUnmaskedSecretFields updates state and marks the form changed', () => {
    const { result } = renderHook(() => useConfigModalState(makeElement(), vi.fn(), vi.fn()))
    expect(result.current.hasChanges).toBe(false)

    act(() => (result.current as ConfigState).setUnmaskedSecretFields(['authorization']))

    expect((result.current as ConfigState).unmaskedSecretFields).toEqual(['authorization'])
    expect(result.current.hasChanges).toBe(true)
  })

  it('writes the current unmaskedSecretFields back through onSave', () => {
    const onSave = vi.fn()
    const { result } = renderHook(() =>
      useConfigModalState(
        makeElement({ unmaskedSecretFields: ['cookie'] } as Partial<ElementData>),
        onSave,
        vi.fn(),
      ),
    )

    act(() => result.current.handleSave())

    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0] as SaveData & { unmaskedSecretFields?: string[] }
    expect(saved.unmaskedSecretFields).toEqual(['cookie'])
  })
})

describe('schema-secret output seeding', () => {
  // OutputParameter gains `secret` in the same change that seeds from it.
  type SchemaSecretOutput = ElementData['outputs'][number] & { secret?: boolean }

  const connectOutputs: SchemaSecretOutput[] = [
    {
      name: 'session',
      label: 'K8s Session',
      type: 'string',
      description: 'Cluster context consumed by the operational blocks',
      secret: true,
    },
    {
      name: 'cluster_version',
      label: 'Cluster Version',
      type: 'string',
      description: 'Reported server version',
    },
  ]

  function renderSecretOutputs(overrides: Partial<ElementData> = {}) {
    return renderHook(() =>
      useConfigModalState(
        makeElement({ elementType: 'derivation-probe', outputs: connectOutputs, ...overrides }),
        vi.fn(),
        vi.fn(),
      ),
    )
  }

  it('seeds outputSecretFields from the schema-secret output when the element stores no list', () => {
    const { result } = renderSecretOutputs()

    expect(result.current.outputSecretFields).toEqual(['session'])
  })

  it('keeps a stored explicit uncheck over the schema seed (deliberate reveal)', () => {
    const { result } = renderSecretOutputs({ outputSecretFields: [] })

    expect(result.current.outputSecretFields).toEqual([])
  })

  it('persists an in-session uncheck of the seeded secret output through save', () => {
    const onSave = vi.fn()
    const { result } = renderHook(() =>
      useConfigModalState(
        makeElement({ elementType: 'derivation-probe', outputs: connectOutputs }),
        onSave,
        vi.fn(),
      ),
    )

    expect(result.current.outputSecretFields).toEqual(['session'])
    act(() => result.current.setOutputSecretFields([]))
    act(() => result.current.handleSave())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect((onSave.mock.calls[0][0] as SaveData).outputSecretFields).toEqual([])
  })

  // The seed is shown but stored only once a Secret box changes (REQ-3.1.2.9).
  it('saves and previews no secret list while the seeded Secret box is untouched', () => {
    const onSave = vi.fn()
    const { result } = renderHook(() =>
      useConfigModalState(
        makeElement({ elementType: 'derivation-probe', outputs: connectOutputs }),
        onSave,
        vi.fn(),
      ),
    )

    expect(result.current.outputSecretFields).toEqual(['session'])
    let draft: SaveData | undefined
    act(() => {
      draft = result.current.previewSave(() => {}, {})
    })
    act(() => result.current.handleSave())

    expect(draft?.outputSecretFields).toBeUndefined()
    expect((onSave.mock.calls[0][0] as SaveData).outputSecretFields).toBeUndefined()
  })

  it('saves no secret list once the Secret box is back on the seed, and keeps a stored list as it is', () => {
    const renderWithSave = (overrides: Partial<ElementData>, onSave: (data: SaveData) => void) =>
      renderHook(() =>
        useConfigModalState(
          makeElement({ elementType: 'derivation-probe', outputs: connectOutputs, ...overrides }),
          onSave,
          vi.fn(),
        ),
      ).result

    const seededSave = vi.fn()
    const seeded = renderWithSave({}, seededSave)
    act(() => seeded.current.setOutputSecretFields([]))
    act(() => seeded.current.setOutputSecretFields(['session']))
    expect(seeded.current.hasChanges).toBe(false)
    act(() => seeded.current.handleSave())
    expect((seededSave.mock.calls[0][0] as SaveData).outputSecretFields).toBeUndefined()

    const storedSave = vi.fn()
    const stored = renderWithSave({ outputSecretFields: ['session'] }, storedSave)
    act(() => stored.current.handleSave())
    expect((storedSave.mock.calls[0][0] as SaveData).outputSecretFields).toEqual(['session'])
  })
})

describe('csv-parser transform params and operation-specific outputs', () => {
  function renderCsv(currentValues: Record<string, unknown> = {}) {
    return renderHook(() =>
      useConfigModalState(
        makeElement({ elementType: 'csv-parser', version: '1.0.0', availableVersions: ['1.0.0'], currentValues }),
        vi.fn(),
        vi.fn(),
      ),
    )
  }

  it('excludes sorts and filters from the displayed input parameters', () => {
    const { result } = renderCsv()

    const names = result.current.displayParameters.map((p) => p.name)
    expect(names).not.toContain('sorts')
    expect(names).not.toContain('filters')
  })

  it('drops the csv_content output in parse mode', () => {
    const { result } = renderCsv({ operation: 'parse' })

    const names = result.current.outputParameters.map((o) => o.name)
    expect(names).toContain('table')
    expect(names).not.toContain('csv_content')
  })

  it('holds Save while a filter compares a number column to a value that is no number (REQ-3.1.3.14)', () => {
    const filters = (value: string) => [
      {
        id: 'b1',
        column: { mode: 'name', value: 'score' },
        asType: 'integer',
        conditions: [
          {
            id: 'c1',
            type: 'literal',
            variable: '_cell',
            value_type: 'integer',
            operator: 'equals',
            reference_value: value,
            reference_is_expression: false,
          },
        ],
      },
    ]
    const held = renderCsv({ operation: 'parse', csv_content: 'score\n1\n', filters: filters('abc') })
    expect(held.result.current.isFormValid).toBe(false)
    const taken = renderCsv({ operation: 'parse', csv_content: 'score\n1\n', filters: filters('5') })
    expect(taken.result.current.isFormValid).toBe(true)
  })

  it('drops the table outputs in serialize mode', () => {
    const { result } = renderCsv({ operation: 'serialize' })

    const names = result.current.outputParameters.map((o) => o.name)
    expect(names).toContain('csv_content')
    expect(names).not.toContain('table')
    expect(names).not.toContain('row_count')
    expect(names).not.toContain('schema')
  })
})

describe('useConfigModalState switch-case state (REQ-3.5.1.20)', () => {
  it('flags a switch-case element as a switch', () => {
    const { result } = renderControl('switch-case')
    expect((result.current as SwitchState).isSwitch).toBe(true)
  })

  it('leaves other element types unflagged', () => {
    for (const elementType of ['if-else', 'while', 'assert', 'http-client']) {
      const { result } = renderControl(elementType)
      expect((result.current as SwitchState).isSwitch).toBe(false)
    }
  })

  it('initializes switchBranches from the element config', () => {
    const { result } = renderControl('switch-case', { branches: savedBranches })
    expect((result.current as SwitchState).switchBranches).toEqual(savedBranches)
  })

  it('defaults switchBranches to an empty array for a fresh switch node', () => {
    const { result } = renderControl('switch-case')
    expect((result.current as SwitchState).switchBranches).toEqual([])
  })

  it('setSwitchBranches updates state and marks the form changed', () => {
    const { result } = renderControl('switch-case')
    expect(result.current.hasChanges).toBe(false)

    act(() => (result.current as SwitchState).setSwitchBranches(savedBranches))

    expect((result.current as SwitchState).switchBranches).toEqual(savedBranches)
    expect(result.current.hasChanges).toBe(true)
  })

  // Guard: the hook never threaded the case list into the save path.
  it('carries an edited case list into the saved values', () => {
    const onSave = vi.fn()
    const { result } = renderHook(() =>
      useConfigModalState(makeElement({ elementType: 'switch-case' }), onSave, vi.fn()),
    )

    act(() => (result.current as SwitchState).setSwitchBranches(savedBranches))
    act(() => result.current.handleSave())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect((onSave.mock.calls[0][0] as SaveData).values.branches).toEqual(savedBranches)
  })

  it('leaves branches out of the saved values for a non-switch element', () => {
    const onSave = vi.fn()
    const { result } = renderHook(() =>
      useConfigModalState(makeElement({ elementType: 'http-client' }), onSave, vi.fn()),
    )

    act(() => result.current.handleSave())

    expect((onSave.mock.calls[0][0] as SaveData).values).not.toHaveProperty('branches')
  })

  it('excludes the branches parameter from the displayed input parameters', () => {
    const { result } = renderControl('switch-case')

    const names = result.current.displayParameters.map((p) => p.name)
    expect(names).not.toContain('branches')
    expect(names).toEqual([])
  })

  it('reports the form valid for a fresh switch node with no branches configured', () => {
    const { result } = renderControl('switch-case')
    expect(result.current.isFormValid).toBe(true)
  })

  it('blocks the form while the case editor reports invalid', () => {
    const { result } = renderControl('switch-case')

    act(() => (result.current as SwitchState).setSwitchValid(false))

    expect(result.current.isFormValid).toBe(false)
  })

  it('restores form validity when the case editor reports valid again', () => {
    const { result } = renderControl('switch-case')

    act(() => (result.current as SwitchState).setSwitchValid(false))
    expect(result.current.isFormValid).toBe(false)

    act(() => (result.current as SwitchState).setSwitchValid(true))
    expect(result.current.isFormValid).toBe(true)
  })
})

describe('useConfigModalState parallel state (REQ-3.2.3.6, REQ-3.2.3.7)', () => {
  it('flags a parallel element as a parallel', () => {
    const { result } = renderControl('parallel')
    expect((result.current as ParallelState).isParallel).toBe(true)
  })

  it('leaves other element types unflagged', () => {
    for (const elementType of ['switch-case', 'if-else', 'while', 'http-client']) {
      const { result } = renderControl(elementType)
      expect((result.current as ParallelState).isParallel).toBe(false)
    }
  })

  it('initializes parallelBranches from the element config', () => {
    const { result } = renderControl('parallel', { branches: savedParallelBranches })
    expect((result.current as ParallelState).parallelBranches).toEqual(savedParallelBranches)
  })

  it('defaults parallelBranches to an empty array for a fresh node', () => {
    const { result } = renderControl('parallel')
    expect((result.current as ParallelState).parallelBranches).toEqual([])
  })

  it('reads a branch limit stored in either spelling', () => {
    // Storage writes `time_limit`; a record still carrying the editor's
    // `timeLimit` must read back with its limit rather than as unlimited.
    const { result } = renderControl('parallel', {
      branches: [
        { id: 'branch_1', name: 'ingest', timeLimit: 30000 },
        { id: 'branch_2', name: 'probe', time_limit: 500 },
      ],
    })

    expect((result.current as ParallelState).parallelBranches).toEqual([
      { id: 'branch_1', name: 'ingest', timeLimit: 30000 },
      { id: 'branch_2', name: 'probe', timeLimit: 500 },
    ])
  })

  it('reads a branch limit stored as its exact digit text (REQ-3.1.3.14)', () => {
    const { result } = renderControl('parallel', {
      branches: [
        { id: 'branch_1', name: 'ingest', time_limit: '9007199254740993' },
        { id: 'branch_2', name: 'probe', time_limit: true },
      ],
    })

    expect((result.current as ParallelState).parallelBranches).toEqual([
      { id: 'branch_1', name: 'ingest', timeLimit: '9007199254740993' },
      { id: 'branch_2', name: 'probe' },
    ])
  })

  it('reads a branch record with no id or name as blank rather than dropping it', () => {
    // Guard: a malformed row must still occupy its lane so the count is right.
    const { result } = renderControl('parallel', {
      branches: [{ time_limit: 250 }, { id: 'branch_2', name: 'probe' }],
    })

    expect((result.current as ParallelState).parallelBranches).toEqual([
      { id: '', name: '', timeLimit: 250 },
      { id: 'branch_2', name: 'probe' },
    ])
  })

  it('initializes the join mode from the element config', () => {
    const { result } = renderControl('parallel', { join: 'first' })
    expect((result.current as ParallelState).parallelJoin).toBe('first')
  })

  it('defaults the join mode to all', () => {
    const { result } = renderControl('parallel')
    expect((result.current as ParallelState).parallelJoin).toBe('all')
  })

  it('setParallelBranches updates state and marks the form changed', () => {
    const { result } = renderControl('parallel')
    expect(result.current.hasChanges).toBe(false)

    act(() => (result.current as ParallelState).setParallelBranches(savedParallelBranches))

    expect((result.current as ParallelState).parallelBranches).toEqual(savedParallelBranches)
    expect(result.current.hasChanges).toBe(true)
  })

  it('setParallelJoin updates state and marks the form changed', () => {
    const { result } = renderControl('parallel')

    act(() => (result.current as ParallelState).setParallelJoin('first'))

    expect((result.current as ParallelState).parallelJoin).toBe('first')
    expect(result.current.hasChanges).toBe(true)
  })

  it('carries the branch list and the join mode into the saved values', () => {
    const onSave = vi.fn()
    const { result } = renderHook(() =>
      useConfigModalState(makeElement({ elementType: 'parallel' }), onSave, vi.fn()),
    )

    act(() => (result.current as ParallelState).setParallelBranches(savedParallelBranches))
    act(() => (result.current as ParallelState).setParallelJoin('first'))
    act(() => result.current.handleSave())

    // Storage spells the branch limit `time_limit`; the editor holds `timeLimit`.
    const values = (onSave.mock.calls[0][0] as SaveData).values
    expect(values.branches).toEqual([
      { id: 'branch_1', name: 'ingest', time_limit: 30000 },
      { id: 'branch_2', name: 'probe' },
    ])
    expect(values.join).toBe('first')
  })

  it('leaves the join mode out of the saved values for a non-parallel element', () => {
    const onSave = vi.fn()
    const { result } = renderHook(() =>
      useConfigModalState(makeElement({ elementType: 'http-client' }), onSave, vi.fn()),
    )

    act(() => result.current.handleSave())

    expect((onSave.mock.calls[0][0] as SaveData).values).not.toHaveProperty('join')
  })

  it('excludes the branches parameter from the displayed input parameters', () => {
    // PARALLEL-5: only the section time limit is a parameter row.
    const { result } = renderControl('parallel')

    expect(result.current.displayParameters.map((p) => p.name)).not.toContain('branches')
  })

  it('blocks the form while the branch editor reports invalid', () => {
    const { result } = renderControl('parallel')

    act(() => (result.current as ParallelState).setParallelValid(false))

    expect(result.current.isFormValid).toBe(false)
  })

  it('restores form validity when the branch editor reports valid again', () => {
    const { result } = renderControl('parallel')

    act(() => (result.current as ParallelState).setParallelValid(false))
    expect(result.current.isFormValid).toBe(false)

    act(() => (result.current as ParallelState).setParallelValid(true))
    expect(result.current.isFormValid).toBe(true)
  })
})

describe('useConfigModalState sibling control editors stay unchanged', () => {
  it('keeps the if-else branches parameter managed and out of the table', () => {
    const { result } = renderControl('if-else')

    expect(result.current.isIfElse).toBe(true)
    expect(result.current.displayParameters.map((p) => p.name)).toEqual([])
    expect(result.current.isFormValid).toBe(true)
    expect((result.current as SwitchState).isSwitch).toBe(false)
  })

  it('blocks the form while the if-else editor reports invalid', () => {
    const { result } = renderControl('if-else')

    act(() => result.current.setIfElseValid(false))

    expect(result.current.isFormValid).toBe(false)
  })

  it('keeps the assert parameters managed and out of the table', () => {
    const { result } = renderControl('assert')

    expect(result.current.isAssert).toBe(true)
    expect(result.current.displayParameters.map((p) => p.name)).toEqual([])
    expect(result.current.isFormValid).toBe(true)
    expect((result.current as SwitchState).isSwitch).toBe(false)
  })

  it('blocks the form while the assert editor reports invalid', () => {
    const { result } = renderControl('assert')

    act(() => result.current.setAssertValid(false))

    expect(result.current.isFormValid).toBe(false)
  })

  it('keeps the while conditions managed and out of the table', () => {
    const { result } = renderControl('while')

    expect(result.current.isWhile).toBe(true)
    expect(result.current.displayParameters.map((p) => p.name)).toEqual([
      'mode',
      'max_iterations',
      'timeout',
    ])
    expect(result.current.isFormValid).toBe(true)
    expect((result.current as SwitchState).isSwitch).toBe(false)
  })

  it('blocks the form while the while editor reports invalid', () => {
    const { result } = renderControl('while')

    act(() => result.current.setWhileValid(false))

    expect(result.current.isFormValid).toBe(false)
  })
})

describe('useConfigModalState wait-until state (REQ-3.5.4.3)', () => {
  const savedConditions = [{ id: 'c-1', type: 'expression', expression: 'ready' }]

  type WaitState = ReturnType<typeof useConfigModalState> & {
    isWaitUntil: boolean
    waitConditions: unknown[]
    waitMode: 'retry' | 'watch'
    waitFailCurrentScope: boolean
    setWaitConditions: (items: unknown[]) => void
    setWaitMode: (mode: 'retry' | 'watch') => void
    setWaitFailCurrentScope: (value: boolean) => void
    setWaitValid: (valid: boolean) => void
  }

  const renderWait = (currentValues: Record<string, unknown> = {}) => {
    const { result } = renderControl('wait-until', currentValues)
    return { result: result as unknown as { current: WaitState } }
  }

  it('flags a wait-until element as a wait', () => {
    expect(renderWait().result.current.isWaitUntil).toBe(true)
  })

  it('leaves other element types unflagged', () => {
    for (const elementType of ['while', 'assert', 'delay', 'http-client']) {
      const { result } = renderControl(elementType)
      expect((result.current as WaitState).isWaitUntil).toBe(false)
    }
  })

  it('shows only the three authored fields in the parameter table', () => {
    // WAIT-2: the condition, the mode and the scope checkbox have their own
    // affordances and must not double as parameter rows.
    const names = renderWait().result.current.displayParameters.map((p) => p.name)

    expect(names).toEqual(['timeout', 'check_interval', 'message'])
  })

  it('initializes the conditions from the element config', () => {
    expect(renderWait({ conditions: savedConditions }).result.current.waitConditions).toEqual(
      savedConditions,
    )
  })

  it('defaults a fresh wait to no conditions', () => {
    expect(renderWait().result.current.waitConditions).toEqual([])
  })

  it('defaults a fresh wait to Retry mode', () => {
    expect(renderWait().result.current.waitMode).toBe('retry')
  })

  it('initializes the mode from the element config', () => {
    expect(renderWait({ mode: 'watch' }).result.current.waitMode).toBe('watch')
  })

  it('defaults fail current scope to off', () => {
    expect(renderWait().result.current.waitFailCurrentScope).toBe(false)
  })

  it('initializes fail current scope from the element config', () => {
    expect(renderWait({ fail_current_scope: true }).result.current.waitFailCurrentScope).toBe(true)
  })

  it('marks the form changed once a condition is added', () => {
    const { result } = renderWait()
    expect(result.current.hasChanges).toBe(false)

    act(() => result.current.setWaitConditions(savedConditions))

    expect(result.current.waitConditions).toEqual(savedConditions)
    expect(result.current.hasChanges).toBe(true)
  })

  it('marks the form changed once the mode is switched', () => {
    const { result } = renderWait()

    act(() => result.current.setWaitMode('watch'))

    expect(result.current.hasChanges).toBe(true)
  })

  it('carries the wait editors into the saved values', () => {
    const onSave = vi.fn()
    const rendered = renderHook(() =>
      useConfigModalState(makeElement({ elementType: 'wait-until' }), onSave, vi.fn()),
    )
    const result = rendered.result as unknown as { current: WaitState }

    act(() => result.current.setWaitConditions(savedConditions))
    act(() => result.current.setWaitMode('watch'))
    act(() => result.current.setWaitFailCurrentScope(true))
    act(() => result.current.handleSave())

    const saved = (onSave.mock.calls[0][0] as SaveData).values
    expect(saved.conditions).toEqual(savedConditions)
    expect(saved.mode).toBe('watch')
    expect(saved.fail_current_scope).toBe(true)
  })

  it('blocks the form while the condition editor reports invalid', () => {
    const { result } = renderWait()

    act(() => result.current.setWaitValid(false))

    expect(result.current.isFormValid).toBe(false)
  })

  it('does not block the form on the managed parameters alone', () => {
    // `conditions` and `mode` are required in the schema but edited outside the
    // table, so the generic required-field check must skip them.
    const { result } = renderWait({ timeout: 30000 })

    expect(result.current.isFormValid).toBe(true)
  })

  it('blocks the form while the required timeout is unset', () => {
    const { result } = renderWait()

    expect(result.current.isFormValid).toBe(false)
  })
})

describe('useConfigModalState variable exports (SHRUN-6, REQ-3.4.1.1)', () => {
  interface OutputListRow {
    name: string
    binding: string
    secret: boolean
    type: string
  }

  type OutputListState = ReturnType<typeof useConfigModalState> & {
    outputList?: {
      rows: OutputListRow[]
      onRowsChange: (rows: OutputListRow[]) => void
      rowErrors: (string | undefined)[]
      bindingErrors: (string | undefined)[]
    }
  }

  const renderShell = (
    elementType: string,
    overrides: Partial<ElementData> = {},
    onSave: () => void = vi.fn(),
  ) => {
    const { result } = renderHook(() =>
      useConfigModalState(
        makeElement({
          elementType,
          name: 'Run',
          currentValues: { script: 'echo hi' },
          ...overrides,
        }),
        onSave,
        vi.fn(),
      ),
    )
    return { result: result as unknown as { current: OutputListState } }
  }

  // A sheet opened on a saved export: the row is seeded from the three stores
  // it was written to (the list, the binding and the secret names).
  const savedExport: Partial<ElementData> = {
    currentValues: { script: 'echo hi', script_variables: ['COUNT'] },
    outputBindings: { COUNT: 'count' },
    outputSecretFields: ['COUNT'],
  }

  beforeEach(() => {
    mockEnrichedVariables.current = [{ id: 'v1', name: 'count', value: 0, type: 'integer' }]
  })

  it('keeps the export list out of the Input Parameters table', () => {
    const { result } = renderShell('shell-script')

    const names = result.current.displayParameters.map((p) => p.name)
    expect(names).toContain('script')
    expect(names).not.toContain('script_variables')
  })

  it('seeds the rows from the saved export and opens the sheet clean', () => {
    const { result } = renderShell('shell-script', savedExport)

    expect(result.current.outputList?.rows).toEqual([
      { name: 'COUNT', binding: 'count', secret: true, type: 'string' },
    ])
    expect(result.current.hasChanges).toBe(false)
  })

  it('marks the sheet changed once a row is edited', () => {
    const { result } = renderShell('shell-script', savedExport)

    act(() =>
      result.current.outputList!.onRowsChange([
        { name: 'TOTAL', binding: 'count', secret: true, type: 'string' },
      ]),
    )

    expect(result.current.hasChanges).toBe(true)
  })

  it('keeps Save enabled for a named row bound to an existing variable', () => {
    const { result } = renderShell('shell-script')

    act(() =>
      result.current.outputList!.onRowsChange([
        { name: 'COUNT', binding: 'count', secret: false, type: 'string' },
      ]),
    )

    expect(result.current.outputList!.rowErrors[0]).toBeUndefined()
    expect(result.current.isFormValid).toBe(true)
  })

  it('blocks Save on an invalid export name', () => {
    const { result } = renderShell('shell-script')

    act(() =>
      result.current.outputList!.onRowsChange([
        { name: 'a b', binding: 'count', secret: false, type: 'string' },
      ]),
    )

    expect(result.current.outputList!.rowErrors[0]).toBe(
      'Name must start with a letter or underscore, and contain only letters, numbers, and underscores',
    )
    expect(result.current.isFormValid).toBe(false)
  })

  it('blocks Save for a just-added empty row', () => {
    const { result } = renderShell('shell-script')

    act(() =>
      result.current.outputList!.onRowsChange([{ name: '', binding: '', secret: false, type: 'string' }]),
    )

    expect(result.current.isFormValid).toBe(false)
  })

  it('rejects a namespace or profile reference in the WAVE Variable column', () => {
    const { result } = renderShell('shell-script')

    act(() =>
      result.current.outputList!.onRowsChange([
        { name: 'COUNT', binding: 'env.x', secret: false, type: 'string' },
      ]),
    )

    expect(result.current.outputList!.bindingErrors[0]).toBe(
      "'env.x' is a namespace or profile reference; pick or create a test-local variable instead",
    )
    expect(result.current.isFormValid).toBe(false)
  })

  it('saves the merged binding, secret name, export list and bound type', () => {
    const onSave = vi.fn()
    const { result } = renderShell('shell-script', {}, onSave)

    act(() =>
      result.current.outputList!.onRowsChange([
        { name: 'COUNT', binding: 'count', secret: true, type: 'string' },
      ]),
    )
    act(() => result.current.handleSave())

    const saved = onSave.mock.calls[0][0] as SaveData
    expect(saved.values.script_variables).toEqual(['COUNT'])
    expect(saved.outputBindings.COUNT).toBe('count')
    expect(saved.outputSecretFields).toEqual(['COUNT'])
    expect(saved.outputTypes.COUNT).toBe('integer')
  })

  it('saves a variable that does not exist yet with the type chosen in the row', () => {
    const onSave = vi.fn()
    const { result } = renderShell('shell-script', {}, onSave)

    act(() =>
      result.current.outputList!.onRowsChange([
        { name: 'TOTAL', binding: 'fresh_total', secret: false, type: 'table' },
      ]),
    )
    expect(result.current.isFormValid).toBe(true)
    act(() => result.current.handleSave())

    const saved = onSave.mock.calls[0][0] as SaveData
    expect(saved.outputBindings.TOTAL).toBe('fresh_total')
    expect(saved.outputTypes.TOTAL).toBe('table')
    expect(saved.values.script_variables).toEqual(['TOTAL'])
    expect(JSON.stringify(saved.values)).not.toContain('table')
  })

  it('lets an existing variable type win over the type chosen in the row', () => {
    const onSave = vi.fn()
    const { result } = renderShell('shell-script', {}, onSave)

    act(() =>
      result.current.outputList!.onRowsChange([
        { name: 'COUNT', binding: 'count', secret: false, type: 'table' },
      ]),
    )
    expect(result.current.isFormValid).toBe(true)
    act(() => result.current.handleSave())

    const saved = onSave.mock.calls[0][0] as SaveData
    expect(saved.outputTypes.COUNT).toBe('integer')
  })

  it('saves no type for a row that is not bound', () => {
    const onSave = vi.fn()
    const { result } = renderShell('shell-script', {}, onSave)

    act(() =>
      result.current.outputList!.onRowsChange([
        { name: 'COUNT', binding: '', secret: false, type: 'table' },
      ]),
    )
    act(() => result.current.handleSave())

    const saved = onSave.mock.calls[0][0] as SaveData
    expect(saved.outputTypes.COUNT).toBe('')
    expect('COUNT' in saved.outputBindings).toBe(false)
  })

  it('offers no export list on Shell Exec', () => {
    const { result } = renderShell('shell-exec', { currentValues: { command: 'ls -1' } })

    expect(result.current.displayParameters.map((p) => p.name)).toContain('command')
    expect(result.current.outputList).toBeUndefined()
  })
})

describe('useConfigModalState Python editor rename and interpreter (PYRUN-19)', () => {
  interface OutputListRow {
    name: string
    binding: string
    secret: boolean
    type: string
  }

  type PythonState = ReturnType<typeof useConfigModalState> & {
    onRenameSymbol: (oldName: string, newName: string) => void
    /** The interpreter row exactly as typed; every python-tools request carries it. */
    interpreter: string
    inputVariables: { name: string; type: string; description: string }[]
    inputVariableTypes: Record<string, string>
    exportNames: string[]
    outputList?: {
      rows: OutputListRow[]
      onRowsChange: (rows: OutputListRow[]) => void
    }
  }

  const renderPython = (
    overrides: Partial<ElementData> = {},
    onSave: () => void = vi.fn(),
  ) => {
    const { result } = renderHook(() =>
      useConfigModalState(
        makeElement({
          elementType: 'python',
          name: 'Python',
          currentValues: {
            script_type: 'source',
            script: 'ceiling = float(limit)',
            interpreter: '{{py}} -X utf8',
            input_vars: { limit: '{{threshold}}', label: 'run-a' },
            script_variables: ['COUNT', 'TOTAL'],
          },
          outputBindings: { COUNT: 'count', TOTAL: 'total' },
          outputSecretFields: ['COUNT'],
          ...overrides,
        }),
        onSave,
        vi.fn(),
      ),
    )
    return { result: result as unknown as { current: PythonState } }
  }

  beforeEach(() => {
    mockEnrichedVariables.current = [
      { id: 'v1', name: 'count', value: 0, type: 'integer' },
      { id: 'v2', name: 'total', value: 0, type: 'integer' },
      { id: 'v3', name: 'threshold', value: 1, type: 'float' },
    ]
  })

  it('renames an input variable key in place and keeps its value', () => {
    const { result } = renderPython()

    act(() => result.current.onRenameSymbol('limit', 'ceiling'))

    const inputVars = result.current.values.input_vars as Record<string, string>
    expect(Object.keys(inputVars)).toEqual(['ceiling', 'label'])
    expect(inputVars.ceiling).toBe('{{threshold}}')
    expect(inputVars.label).toBe('run-a')
  })

  it('renames an export row and keeps its binding, its secret flag and the other row', () => {
    const { result } = renderPython()

    act(() => result.current.onRenameSymbol('COUNT', 'TALLY'))

    expect(result.current.outputList!.rows).toEqual([
      { name: 'TALLY', binding: 'count', secret: true, type: 'string' },
      { name: 'TOTAL', binding: 'total', secret: false, type: 'string' },
    ])
  })

  it('marks the config sheet changed once a rename lands', () => {
    const { result } = renderPython()
    expect(result.current.hasChanges).toBe(false)

    act(() => result.current.onRenameSymbol('limit', 'ceiling'))

    expect(result.current.hasChanges).toBe(true)
  })

  it('saves a renamed export through the existing merge path', () => {
    const onSave = vi.fn()
    const { result } = renderPython({}, onSave)

    act(() => result.current.onRenameSymbol('COUNT', 'TALLY'))
    act(() => result.current.handleSave())

    const saved = onSave.mock.calls[0][0] as SaveData
    expect(saved.values.script_variables).toEqual(['TALLY', 'TOTAL'])
    expect(saved.outputBindings.TALLY).toBe('count')
    expect('COUNT' in saved.outputBindings).toBe(false)
    expect(saved.outputSecretFields).toContain('TALLY')
    expect(saved.outputSecretFields).not.toContain('COUNT')
  })

  it('leaves the draft alone for a name that is neither an input variable nor an export', () => {
    const { result } = renderPython()

    act(() => result.current.onRenameSymbol('temp', 'temperature'))

    expect(result.current.values.input_vars).toEqual({ limit: '{{threshold}}', label: 'run-a' })
    expect(result.current.outputList!.rows.map((row) => row.name)).toEqual(['COUNT', 'TOTAL'])
    expect(result.current.hasChanges).toBe(false)
  })

  it('exposes the interpreter row text unresolved', () => {
    const { result } = renderPython()

    expect(result.current.interpreter).toBe('{{py}} -X utf8')
  })

  it('exposes an empty interpreter when the row is not set', () => {
    const { result } = renderPython({
      currentValues: { script_type: 'source', script: 'pass' },
      outputBindings: {},
      outputSecretFields: [],
    })

    expect(result.current.interpreter).toBe('')
  })

  it('types each Input Variable from the variable its value references', () => {
    const { result } = renderPython()

    expect(result.current.inputVariables).toEqual([
      { name: 'limit', type: 'float', description: 'Input Variable. Arrives as a Decimal.' },
      { name: 'label', type: 'string', description: 'Input Variable. Arrives as a str.' },
    ])
  })

  it('documents a table Input Variable with the columns of the variable it references', () => {
    mockEnrichedVariables.current = [
      {
        id: 'v4',
        name: 'sensors',
        type: 'table',
        value: [
          { sensor: 'north', temp_c: 28.4, taken_at: '2026-09-18T08:00:00Z' },
          { sensor: 'south', temp_c: 31.2, taken_at: '2026-09-18T08:05:00Z' },
        ],
      },
    ]
    const { result } = renderPython({
      currentValues: {
        script_type: 'source',
        script: 'pass',
        input_vars: { readings: '{{sensors}}' },
      },
      outputBindings: {},
      outputSecretFields: [],
    })

    expect(result.current.inputVariables).toEqual([
      {
        name: 'readings',
        type: 'table',
        description:
          'Input Variable. Arrives as a table with 3 columns: sensor, temp_c, taken_at. ' +
          'Rows are dicts; iterate, index, len(); .columns and .rows.',
      },
    ])
  })

  it('documents a table Input Variable without columns when the variable has no value', () => {
    mockEnrichedVariables.current = [{ id: 'v4', name: 'sensors', type: 'table' }]
    const { result } = renderPython({
      currentValues: {
        script_type: 'source',
        script: 'pass',
        input_vars: { readings: '{{sensors}}' },
      },
      outputBindings: {},
      outputSecretFields: [],
    })

    expect(result.current.inputVariables[0].description).toBe(
      'Input Variable. Arrives as a table. Rows are dicts; iterate, index, len(); .columns and .rows.',
    )
  })

  it('knows the type of an Input Variable only when its value references a variable', () => {
    const { result } = renderPython({
      currentValues: {
        script_type: 'source',
        script: 'pass',
        input_vars: {
          limit: '{{threshold}}',
          label: 'run-a',
          doubled: '{{ threshold * 2 }}',
          ghost: '{{missing}}',
          number: 5,
        },
      },
      outputBindings: {},
      outputSecretFields: [],
    })

    expect(result.current.inputVariableTypes).toEqual({ limit: 'float' })
  })

  it('lists no Input Variables when the block declares none', () => {
    const { result } = renderPython({
      currentValues: { script_type: 'source', script: 'pass' },
      outputBindings: {},
      outputSecretFields: [],
    })

    expect(result.current.inputVariables).toEqual([])
  })

  it('exposes the export names a rename may reach', () => {
    const { result } = renderPython()

    expect(result.current.exportNames).toEqual(['COUNT', 'TOTAL'])
  })

  it('leaves a block without Input Variables alone on a rename', () => {
    const { result } = renderPython({
      currentValues: { script_type: 'source', script: 'pass' },
      outputBindings: {},
      outputSecretFields: [],
    })

    act(() => result.current.onRenameSymbol('limit', 'ceiling'))

    expect(result.current.values.input_vars).toBeUndefined()
    expect(result.current.hasChanges).toBe(false)
  })
})

// A Run replays the open editors' writes apart from the form: whatever they
// write - a whole map or an update of what is there - lands in the preview only.
describe('previewSave - the writes an open editor replays', () => {
  function renderPreview() {
    return renderHook(() =>
      useConfigModalState(
        makeElement({
          elementType: 'preview-probe',
          parameters: [
            { name: 'body', label: 'Body', type: 'string', required: false },
            { name: 'url', label: 'URL', type: 'string', required: false },
          ],
          currentValues: { body: 'saved', url: "base_url + '/x'" },
          templateFields: ['body'],
          expressionFields: ['url'],
          profileBindings: [
            { profileId: 'p1', profileName: 'Prod', profileType: 'http', alias: 'api' },
          ],
        }),
        vi.fn(),
        vi.fn(),
      ),
    )
  }

  const BINDING = { profileId: 'p2', profileName: 'Lab', profileType: 'http', alias: 'lab' }

  it('takes a whole-value write of every field it replays', () => {
    const { result } = renderPreview()

    let draft: SaveData | undefined
    act(() => {
      draft = result.current.previewSave(() => {
        result.current.setValues({ body: 'replayed', url: 'mirror_url' })
        result.current.setTemplateFields([])
        result.current.setExpressionFields(['url', 'body'])
        result.current.setProfileBindings([BINDING])
      }, {})
    })

    expect(draft?.values).toMatchObject({ body: 'replayed', url: 'mirror_url' })
    expect(draft?.templateFields).toEqual([])
    expect(draft?.expressionFields).toEqual(['url', 'body'])
    expect(draft?.profileBindings).toEqual([BINDING])
  })

  it('takes an update of what is already there', () => {
    const { result } = renderPreview()

    let draft: SaveData | undefined
    act(() => {
      draft = result.current.previewSave(() => {
        result.current.setValues((prev) => ({ ...prev, body: 'updated', extra: 'more {{ x }}' }))
        result.current.setTemplateFields((prev) => [...prev, 'extra'])
        result.current.setExpressionFields((prev) => prev.filter((field) => field !== 'url'))
        result.current.setProfileBindings((prev) => [...prev, BINDING])
      }, {})
    })

    expect(draft?.values).toMatchObject({ body: 'updated' })
    expect(draft?.templateFields).toEqual(['body', 'extra'])
    expect(draft?.expressionFields).toEqual([])
    expect(draft?.profileBindings).toHaveLength(2)
  })

  it('leaves the form itself untouched, and the override wins', () => {
    const { result } = renderPreview()

    let draft: SaveData | undefined
    act(() => {
      draft = result.current.previewSave(() => {
        result.current.setValues({ body: 'replayed' })
      }, { body: 'from the editor' })
    })

    expect(draft?.values).toMatchObject({ body: 'from the editor' })
    expect(result.current.values).toEqual({ body: 'saved', url: "base_url + '/x'" })
    expect(result.current.hasChanges).toBe(false)
  })

  it('drops a flag the replay leaves with no value, as Save does', () => {
    const { result } = renderPreview()

    let draft: SaveData | undefined
    act(() => {
      draft = result.current.previewSave(() => {
        result.current.setValues((prev) => ({ ...prev, url: '' }))
        result.current.setTemplateFields((prev) => [...prev, 'extra'])
      }, {})
    })

    expect(draft?.templateFields).toEqual(['body'])
    expect(draft?.expressionFields).toEqual([])
    expect(draft?.values).toEqual({ body: 'saved' })
  })
})

describe('useConfigModalState element types (REQ-3.1.3.19)', () => {
  it('starts from the element\'s stored element types', () => {
    const { result } = renderHook(() =>
      useConfigModalState(
        makeElement({
          elementTypes: { driver_options: { n: 'integer' } },
          variableElementTypes: { m: ['float'] },
        }),
        vi.fn(),
        vi.fn(),
      ),
    )
    expect(result.current.settingElementTypes).toEqual({ driver_options: { n: 'integer' } })
    expect(result.current.variableElementTypes).toEqual({ m: ['float'] })
    expect(result.current.hasChanges).toBe(false)
  })

  it('sets and clears one setting\'s element types, marking the form changed', () => {
    const { result } = renderHook(() => useConfigModalState(makeElement(), vi.fn(), vi.fn()))
    expect(result.current.settingElementTypes).toEqual({})

    act(() => result.current.setSettingElementTypes('driver_options', { n: 'integer' }))
    expect(result.current.settingElementTypes).toEqual({ driver_options: { n: 'integer' } })
    expect(result.current.hasChanges).toBe(true)

    act(() => result.current.setSettingElementTypes('driver_options', undefined))
    expect(result.current.settingElementTypes).toEqual({})
  })

  it('writes the typed setting\'s element types back through onSave', () => {
    const onSave = vi.fn()
    const { result } = renderHook(() =>
      useConfigModalState(
        makeElement({ currentValues: { driver_options: { n: '16' } } }),
        onSave,
        vi.fn(),
      ),
    )
    act(() => result.current.setSettingElementTypes('driver_options', { n: 'integer' }))
    act(() => result.current.handleSave())
    expect((onSave.mock.calls[0][0] as SaveData).elementTypes).toEqual({
      driver_options: { n: 'integer' },
    })
  })
})

describe('useConfigModalState Template kind by default (OS-5)', () => {
  const QUERY_ROW = {
    name: 'query',
    label: 'Query',
    type: 'string' as const,
    required: false,
    templateByDefault: true as const,
  }
  const INDEX_ROW = { name: 'index', label: 'Index pattern', type: 'string' as const, required: false }

  function renderQuery(overrides: Partial<ElementData> = {}, onSave = vi.fn()) {
    return renderHook(() =>
      useConfigModalState(
        makeElement({
          elementType: 'template-default-probe',
          parameters: [INDEX_ROW, QUERY_ROW],
          ...overrides,
        }),
        onSave,
        vi.fn(),
      ),
    )
  }

  it.each([
    ['missing', {}],
    ['empty', { query: '' }],
    ['whitespace', { query: '   ' }],
  ])('opens a %s query in Template kind', (_label, currentValues) => {
    const { result } = renderQuery({ currentValues })
    expect(result.current.templateFields).toEqual(['query'])
  })

  it('keeps a query the author set to Literal with text in Literal kind', () => {
    const { result } = renderQuery({ currentValues: { query: 'log.level: ERROR' }, templateFields: [] })
    expect(result.current.templateFields).toEqual([])
  })

  it('leaves a blank query in expression mode alone', () => {
    const { result } = renderQuery({ currentValues: { query: '' }, expressionFields: ['query'] })
    expect(result.current.templateFields).toEqual([])
    expect(result.current.expressionFields).toEqual(['query'])
  })

  it('lists a query already in Template kind once', () => {
    const { result } = renderQuery({ currentValues: {}, templateFields: ['query'] })
    expect(result.current.templateFields).toEqual(['query'])
  })

  it('lists the query once when two twin rows share the wire name', () => {
    const { result } = renderQuery({
      currentValues: {},
      parameters: [INDEX_ROW, QUERY_ROW, { ...QUERY_ROW }],
    })
    expect(result.current.templateFields).toEqual(['query'])
  })

  it('keeps the other Template rows', () => {
    const { result } = renderQuery({ currentValues: {}, templateFields: ['index'] })
    expect([...result.current.templateFields].sort()).toEqual(['index', 'query'])
  })

  it('seeds no row that does not ask for it', () => {
    const { result } = renderQuery({ currentValues: {} })
    expect(result.current.templateFields).not.toContain('index')
  })

  it('reports no change when the sheet opens with the seeded kind', () => {
    const { result } = renderQuery({ currentValues: {} })
    expect(result.current.hasChanges).toBe(false)
  })

  it('saves a query typed after opening in Template kind', () => {
    const onSave = vi.fn()
    const { result } = renderQuery({ currentValues: {} }, onSave)

    act(() => result.current.setValues({ query: 'service.name: {{ svc }}' }))
    act(() => result.current.handleSave())

    const saved = onSave.mock.calls[0][0] as SaveData
    expect(saved.values).toMatchObject({ query: 'service.name: {{ svc }}' })
    expect(saved.templateFields).toEqual(['query'])
  })

  it.each([
    ['a missing', {}],
    ['an empty', { query: '' }],
  ])('saves no Template flag for %s query left blank', (_label, currentValues) => {
    const onSave = vi.fn()
    const { result } = renderQuery({ currentValues }, onSave)
    expect(result.current.templateFields).toEqual(['query'])

    act(() => result.current.handleSave())

    expect((onSave.mock.calls[0][0] as SaveData).templateFields).toEqual([])
  })

  it.each([
    ['a number', 42],
    ['a boolean', false],
  ])('keeps a query holding %s in Literal kind', (_label, query) => {
    const { result } = renderQuery({ currentValues: { query } })
    expect(result.current.templateFields).toEqual([])
  })
})

describe('Save on a remote host (HTTP-13, SHELL-10)', () => {
  // The registered HTTP block: its Proxy row is locked while the block runs on a remote host.
  function renderHttp(
    currentValues: Record<string, unknown>,
    onSave: (data: SaveData) => void,
    runsOnRemoteHost?: boolean,
  ) {
    const element = makeElement({ currentValues: { url: 'https://api.corp.example', ...currentValues } })
    return renderHook(() => useConfigModalState(element, onSave, vi.fn(), runsOnRemoteHost))
  }

  function savedBy(onSave: ReturnType<typeof vi.fn>): SaveData {
    expect(onSave).toHaveBeenCalledTimes(1)
    return onSave.mock.calls[0][0] as SaveData
  }

  it('stores no Proxy choice while the block runs on a remote host, and keeps what the block holds', () => {
    const onSave = vi.fn()
    const { result } = renderHttp({ proxy_mode: 'off' }, onSave, true)

    act(() => result.current.handleSave())

    const values = savedBy(onSave).values
    expect(values.url).toBe('https://api.corp.example')
    expect(values).not.toHaveProperty('proxy_mode')
  })

  it('stores the WAVE setting the Proxy row shows when a block on the WAVE host holds no Proxy choice (FIELD-8)', () => {
    const onSave = vi.fn()
    const { result } = renderHttp({}, onSave, false)

    act(() => result.current.handleSave())

    expect(savedBy(onSave).values.proxy_mode).toBe('wave-setting')
  })

  it.each([false, undefined])(
    'keeps the stored Proxy choice while the block runs on the WAVE host (%s)',
    (runsOnRemoteHost) => {
      const onSave = vi.fn()
      const { result } = renderHttp({ proxy_mode: 'off' }, onSave, runsOnRemoteHost)

      act(() => result.current.handleSave())

      expect(savedBy(onSave).values.proxy_mode).toBe('off')
    },
  )

  it('leaves the draft and its unsaved-changes state alone until Save', () => {
    const { result } = renderHttp({ proxy_mode: 'off' }, vi.fn(), true)

    expect(result.current.values.proxy_mode).toBe('off')
    expect(result.current.hasChanges).toBe(false)
  })

  it('previews no Proxy choice, as a Save stores none', () => {
    const { result } = renderHttp({ proxy_mode: 'off' }, vi.fn(), true)

    let draft: SaveData | undefined
    act(() => {
      draft = result.current.previewSave(() => {}, {})
    })

    expect(draft?.values.url).toBe('https://api.corp.example')
    expect(draft?.values).not.toHaveProperty('proxy_mode')
  })
})

describe('An open sheet follows its Block changed on the canvas', () => {
  interface ExportRow {
    name: string
    binding: string
    secret: boolean
    type: string
  }

  type FollowState = ReturnType<typeof useConfigModalState> & {
    outputList?: { rows: ExportRow[] }
  }

  function renderOpenSheet(element: ElementData) {
    const { result, rerender } = renderHook(
      ({ block }: { block: ElementData }) => useConfigModalState(block, vi.fn(), vi.fn()),
      { initialProps: { block: element } },
    )
    return {
      result: result as unknown as { current: FollowState },
      storeChanges: (block: ElementData) => rerender({ block }),
    }
  }

  it('keeps a binding the person changed in the sheet when the canvas clears the stored one', () => {
    const element = makeElement({ outputBindings: { status_code: 'code', body: 'text' } })
    const { result, storeChanges } = renderOpenSheet(element)
    act(() => result.current.handleOutputChange('status_code', 'other_code'))

    storeChanges({ ...element, outputBindings: { status_code: '', body: 'text' } })

    expect(result.current.outputBindings).toEqual({ status_code: 'other_code', body: 'text' })
  })

  it('clears an export row bound to the cleared variable and stays unchanged', () => {
    mockEnrichedVariables.current = [{ id: 'v1', name: 'count', value: 0, type: 'integer' }]
    const element = makeElement({
      elementType: 'shell-script',
      currentValues: { script: 'echo hi', script_variables: ['COUNT'] },
      outputBindings: { COUNT: 'count' },
    })
    const { result, storeChanges } = renderOpenSheet(element)

    storeChanges({ ...element, outputBindings: { COUNT: '' } })

    expect(result.current.outputList?.rows).toEqual([
      { name: 'COUNT', binding: '', secret: false, type: 'string' },
    ])
    expect(result.current.hasChanges).toBe(false)
  })

  it('drops a parser query named after the cleared variable with its binding and stays unchanged', () => {
    const element = makeElement({
      elementType: 'json-parser',
      currentValues: {
        json_content: '{"n": 1}',
        output_mode: 'individual',
        queries: { count: '$.n', label: '$.l' },
        query_output_types: { count: 'integer', label: 'string' },
      },
      outputBindings: { count: 'count', label: 'label' },
    })
    const { result, storeChanges } = renderOpenSheet(element)

    storeChanges({
      ...element,
      currentValues: {
        ...element.currentValues,
        queries: { label: '$.l' },
        query_output_types: { label: 'string' },
      },
      outputBindings: { label: 'label' },
    })

    expect(result.current.values.queries).toEqual({ label: '$.l' })
    expect(result.current.outputBindings).toEqual({ label: 'label' })
    expect(result.current.hasChanges).toBe(false)
  })
})

// Every Block, Function Blocks included, reads its rows from the one Block field lookup (REQ-3.1.1.5).
describe('rows from the shared Block field lookup', () => {
  const FUNCTION_INPUTS = [
    { name: 'region', label: 'region', type: 'string', required: true },
    { name: 'retries', label: 'retries', type: 'integer', required: false, defaultValue: 3 },
  ]
  const FUNCTION_OUTPUTS = [{ name: 'report', label: 'report', type: 'map' }]

  function renderFunctionBlock(overrides: Partial<ElementData> = {}) {
    blockFields.inputs = FUNCTION_INPUTS
    blockFields.outputs = FUNCTION_OUTPUTS
    return renderHook(() =>
      useConfigModalState(
        makeElement({ elementType: 'function', name: 'enrich', parameters: [], outputs: [], ...overrides }),
        vi.fn(),
        vi.fn(),
      ),
    )
  }

  it('lists the input rows and the outputs the lookup gives for the Block', () => {
    const { result } = renderFunctionBlock()

    expect(result.current.displayParameters.map((p) => p.name)).toEqual(['region', 'retries'])
    expect(result.current.outputParameters.map((o) => o.name)).toEqual(['report'])
  })

  it('holds the Save while a Required input has no value (REQ-3.1.2.4)', () => {
    const { result } = renderFunctionBlock()
    expect(result.current.isFormValid).toBe(false)

    act(() => result.current.handleInputChange('region', 'eu-west-1'))

    expect(result.current.isFormValid).toBe(true)
  })

  it('holds the Save while an output is bound to a variable of another type', () => {
    mockEnrichedVariables.current = [{ id: 'v1', name: 'summary', value: '', type: 'string' }]
    const { result } = renderFunctionBlock({
      currentValues: { region: 'eu-west-1' },
      outputBindings: { report: 'summary' },
    })

    expect(result.current.outputErrors.report).toBe('Type mismatch: "summary" is string, expected map')
    expect(result.current.isFormValid).toBe(false)
  })

  it('seeds the Secret box of a secret output the lookup gives (REQ-3.1.2.9)', () => {
    blockFields.inputs = FUNCTION_INPUTS
    blockFields.outputs = [...FUNCTION_OUTPUTS, { name: 'token', label: 'token', type: 'string', secret: true }]
    const { result } = renderHook(() =>
      useConfigModalState(makeElement({ elementType: 'function', parameters: [], outputs: [] }), vi.fn(), vi.fn()),
    )

    expect(result.current.outputSecretFields).toEqual(['token'])
    expect(result.current.hasChanges).toBe(false)
  })
})

// An {x} entry left blank has no default to fall back on (FIELD-13).
describe('a blank {x} entry holds the Save', () => {
  type EntryState = ReturnType<typeof useConfigModalState> & {
    entryErrors?: Record<string, string>
  }

  const HEADERS = { name: 'headers', label: 'Headers', type: 'map' as const, required: false }
  const ARGUMENTS = { name: 'arguments', label: 'Arguments', type: 'array' as const, required: false }

  function renderEntries(overrides: Partial<ElementData>) {
    const { result } = renderHook(() =>
      useConfigModalState(
        makeElement({ elementType: 'entry-probe', parameters: [HEADERS, ARGUMENTS], ...overrides }),
        vi.fn(),
        vi.fn(),
      ),
    )
    return result as unknown as { current: EntryState }
  }

  it('names a blank {x} map entry and holds the Save until it is filled', () => {
    const result = renderEntries({
      currentValues: { headers: { 'X-Id': 'trace_id()', Accept: '' } },
      expressionFields: ['headers.X-Id'],
    })
    expect(result.current.isFormValid).toBe(true)

    act(() => result.current.setValues({ headers: { 'X-Id': '', Accept: '' } }))

    expect(result.current.entryErrors?.headers).toMatch(/^'X-Id' in 'headers' is required$/)
    expect(result.current.isFormValid).toBe(false)

    act(() => result.current.setValues({ headers: { 'X-Id': 'trace_id()', Accept: '' } }))

    expect(result.current.entryErrors?.headers).toBeUndefined()
    expect(result.current.isFormValid).toBe(true)
  })

  it('names a stored blank {x} list row, counted from 1, as soon as the window opens', () => {
    const result = renderEntries({
      currentValues: { arguments: [{ value: 'a' }, { value: '  ' }] },
      expressionFields: ['arguments.1.value'],
    })

    expect(result.current.entryErrors?.arguments).toMatch(/^Row 2 in 'arguments' is required$/)
    expect(result.current.isFormValid).toBe(false)
  })

  it('names a blank {x} item of a plain list, counted from 1', () => {
    const result = renderEntries({
      parameters: [{ name: 'tags', label: 'Tags', type: 'array', required: false }],
      currentValues: { tags: ['a', ' '] },
      expressionFields: ['tags.1'],
    })

    expect(result.current.entryErrors).toEqual({ tags: "Row 2 in 'tags' is required" })
    expect(result.current.isFormValid).toBe(false)
  })

  it('raises nothing for an {x} entry whose field holds no value', () => {
    const result = renderEntries({ currentValues: {}, expressionFields: ['headers.X-Id'] })

    expect(result.current.entryErrors).toEqual({})
    expect(result.current.isFormValid).toBe(true)
  })

  it('leaves a blank literal entry and a whole blank {x} field alone', () => {
    const result = renderEntries({
      currentValues: { headers: '', arguments: [{ value: '' }] },
      expressionFields: ['headers'],
    })

    expect(result.current.entryErrors).toEqual({})
    expect(result.current.isFormValid).toBe(true)
  })
})

// A reset click brings the gray default back and is a change the Save stores as nothing (FIELD-3, SAVE-1).
describe('a reset counts as a change for the Save', () => {
  const OWNER = { name: 'owner', label: 'Owner', type: 'string' as const, required: false, defaultValue: 'wave' }
  const URL_ROW = {
    name: 'url',
    label: 'URL',
    type: 'string' as const,
    required: false,
    defaultValue: 'https://example.test',
  }

  function renderReset(overrides: Partial<ElementData>, onSave: (data: SaveData) => void) {
    return renderHook(() =>
      useConfigModalState(
        makeElement({ elementType: 'reset-probe', parameters: [OWNER, URL_ROW], ...overrides }),
        onSave,
        vi.fn(),
      ),
    )
  }

  it('turns on Save after a literal reset, and the Save stores nothing for the field', () => {
    const onSave = vi.fn()
    const { result } = renderReset({ currentValues: { owner: 'alice' } }, onSave)
    expect(result.current.hasChanges).toBe(false)

    act(() => result.current.handleInputChange('owner', undefined))

    expect(result.current.hasChanges).toBe(true)
    expect(result.current.isFormValid).toBe(true)
    act(() => result.current.handleSave())
    expect((onSave.mock.calls[0][0] as SaveData).values).toEqual({})
  })

  it('turns on Save after a reset in {x} mode, and the Save stores neither the text nor the flag', () => {
    const onSave = vi.fn()
    const { result } = renderReset(
      { currentValues: { url: "base_url + '/x'" }, expressionFields: ['url'] },
      onSave,
    )

    act(() => result.current.handleInputChange('url', ''))

    expect(result.current.expressionFields).toEqual(['url'])
    expect(result.current.hasChanges).toBe(true)
    act(() => result.current.handleSave())
    const saved = onSave.mock.calls[0][0] as SaveData
    expect(saved.values).toEqual({})
    expect(saved.expressionFields).toEqual([])
  })
})
