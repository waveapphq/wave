/**
 * Tests for save-logic - validateOutputBindings, buildSaveData, computeHasChanges
 * and normalizeConditionLists.
 *
 * Covers the branches where the inline gate in useConfigModalState would
 * normally prevent buildSaveData from being called - the defensive
 * server-side check still has to behave correctly. Control fields and the
 * Variable Setter rows reach Save and the change check through the shared
 * values and flag lists, like every other Block field (REQ-3.1.1.5).
 */

import { describe, it, expect } from 'vitest'
import { validateOutputBindings, buildSaveData, computeHasChanges } from '@/features/workbench/common/element-config/save-logic'
import { getInputParams, getOutputParams } from '@/features/workbench/lib/node-parameters'
import { resolveOutputType } from '@/features/workbench/lib/node-parameters/output-type'
import type { Parameter, EnrichedVariable, SaveData } from '@/features/workbench/common/element-config/types'
import type { ElementTypes } from '@/lib/variable-validation'
import type { Parameter as TableParameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'

const intOutput = { name: 'status_code', type: 'integer' as Parameter['type'], required: false as const }
const strOutput = { name: 'body', type: 'string' as Parameter['type'], required: false as const }

const variables: EnrichedVariable[] = [
  { id: 'v1', name: 'count', value: 0, type: 'integer' },
  { id: 'v2', name: 'msg', value: '', type: 'string' },
]

const caseConditions = [{ id: 'cond-1', type: 'expression' as const, expression: 'status == 200' }]

// Switch branch records: case entries carry conditions + break, the
// trailing default entry carries neither.
const caseBranches = [
  { id: 'branch_0', type: 'case' as const, label: '', conditions: caseConditions, break: true },
  { id: 'branch_1', type: 'case' as const, label: 'Slow', conditions: caseConditions, break: false },
  { id: 'branch_2', type: 'default' as const, label: '' },
]

describe('validateOutputBindings', () => {
  it('returns empty errors when bindings match types', () => {
    const errors = validateOutputBindings(
      [intOutput, strOutput],
      { status_code: 'count', body: 'msg' },
      variables,
    )
    expect(errors).toEqual({})
  })

  it('reports a type mismatch error', () => {
    const errors = validateOutputBindings(
      [intOutput],
      { status_code: 'msg' },
      variables,
    )
    expect(errors.status_code).toMatch(/Type mismatch/)
  })

  it('rejects a namespace pointer ahead of any type check', () => {
    const errors = validateOutputBindings(
      [intOutput],
      { status_code: 'system.foo' },
      variables,
    )
    expect(errors.status_code).toMatch(/namespace or profile reference/)
  })

  it('rejects an invalid Python identifier', () => {
    const errors = validateOutputBindings(
      [intOutput],
      { status_code: '123bad' },
      variables,
    )
    expect(errors.status_code).toMatch(/not a valid variable name/)
  })

  it('rejects a reserved namespace name', () => {
    const errors = validateOutputBindings(
      [intOutput],
      { status_code: 'system' },
      variables,
    )
    expect(errors.status_code).toMatch(/read-only namespace/)
  })

  it('skips empty bindings (no error)', () => {
    const errors = validateOutputBindings(
      [intOutput],
      { status_code: '' },
      variables,
    )
    expect(errors).toEqual({})
  })
})

describe('buildSaveData', () => {
  const baseCtx = {
    elementId: 'node-1',
    elementType: 'http-client',
    selectedVersion: '1.0.0',
    values: {},
    outputParameters: [intOutput],
    versionParameters: [] as Parameter[],
    name: 'Block_1',
    description: '',
    profileBindings: [],
    expressionFields: [],
    templateFields: [],
    outputSecretFields: [],
    variables,
    isXmlParser: false,
    isJsonParser: false,
  }

  describe('a number row stores the JSON number its digits stand for (REQ-3.1.3.14)', () => {
    const NUMBER_ROWS: Parameter[] = [
      { name: 'count', type: 'integer', required: false },
      { name: 'ratio', type: 'float', required: false },
      { name: 'label', type: 'string', required: false },
      { name: 'twin', type: 'integer', required: false },
      { name: 'twin', type: 'float', required: false },
      { name: 'mixed', type: 'integer', required: false },
      { name: 'mixed', type: 'string', required: false },
    ]

    const savedValues = (
      values: Record<string, unknown>,
      flags: { expressionFields?: string[]; templateFields?: string[] } = {},
    ) =>
      buildSaveData({ ...baseCtx, ...flags, values, versionParameters: NUMBER_ROWS, outputBindings: {} }).data
        ?.values

    it('stores typed integer and float digits as numbers', () => {
      expect(savedValues({ count: '5000', ratio: '2.5' })).toEqual({ count: 5000, ratio: 2.5 })
    })

    it('keeps digits a JS number would print another way as written', () => {
      expect(savedValues({ count: '007', ratio: '2.50' })).toEqual({ count: '007', ratio: '2.50' })
      expect(savedValues({ ratio: '0.0000001' })).toEqual({ ratio: '0.0000001' })
      expect(savedValues({ ratio: '1000000000000000000000' })).toEqual({ ratio: '1000000000000000000000' })
    })

    it('reads a name whose descriptors are an integer and a float as a float', () => {
      expect(savedValues({ twin: '1.5' })).toEqual({ twin: 1.5 })
    })

    it('keeps digits no JS number holds exactly as written', () => {
      expect(savedValues({ count: '9007199254740993', ratio: '0.1000000000000000055511151231' })).toEqual({
        count: '9007199254740993',
        ratio: '0.1000000000000000055511151231',
      })
    })

    it('leaves text rows, rows of mixed types and rows the schema does not declare as written', () => {
      expect(savedValues({ label: '42', mixed: '7', stray: '3' })).toEqual({ label: '42', mixed: '7', stray: '3' })
    })

    it('leaves an expression or a template as written', () => {
      expect(savedValues({ count: '5', ratio: '2' }, { expressionFields: ['count'], templateFields: ['ratio'] })).toEqual(
        { count: '5', ratio: '2' },
      )
    })
  })

  describe('element types (REQ-3.1.3.19)', () => {
    it('saves the element types of the typed settings still present and literal', () => {
      const result = buildSaveData({
        ...baseCtx,
        outputBindings: {},
        values: { driver_options: { n: '16' }, headers: 'expr' },
        expressionFields: ['headers'],
        settingElementTypes: {
          driver_options: { n: 'integer' },
          headers: { a: 'string' },
          gone: ['integer'],
        },
      })
      expect(result.data?.elementTypes).toEqual({ driver_options: { n: 'integer' } })
    })

    it('saves no element types when no typed setting remains', () => {
      const result = buildSaveData({ ...baseCtx, outputBindings: {} })
      expect(result.data?.elementTypes).toBeUndefined()
    })

    it('saves a Variable Setter literal row\'s element types, never an expression row\'s', () => {
      const result = buildSaveData({
        ...baseCtx,
        outputBindings: {},
        values: { variables: { m: { n: '1' }, e: 'x + 1' } },
        expressionFields: ['variables.e'],
        settingElementTypes: {
          'variables.m': { n: 'integer' },
          'variables.e': { a: 'string' },
          'variables.gone': [],
        },
      })
      expect(result.data?.elementTypes).toEqual({ 'variables.m': { n: 'integer' } })
    })

    it('saves no Setter element types when the Setter holds no variables', () => {
      const result = buildSaveData({
        ...baseCtx,
        outputBindings: {},
        settingElementTypes: { 'variables.m': { n: 'integer' } },
      })
      expect(result.data?.elementTypes).toBeUndefined()
    })
  })

  it('returns null data with errors when bindings are invalid', () => {
    const result = buildSaveData({
      ...baseCtx,
      outputBindings: { status_code: 'system.foo' },
    })
    expect(result.data).toBeNull()
    expect(result.errors.status_code).toMatch(/namespace/)
  })

  it('returns SaveData when bindings are clean', () => {
    const result = buildSaveData({
      ...baseCtx,
      outputBindings: { status_code: 'count' },
    })
    expect(result.data).not.toBeNull()
    expect(result.errors).toEqual({})
  })

  // The type a K8s read declares follows its Output Format (K8SREAD-6); the
  // save payload has to carry the resolved type, since it seeds new variables.
  describe('outputTypes carry the resolved output type', () => {
    const getResult = (getOutputParams('k8s-get') ?? []).find((o) => o.name === 'result')!

    const savedResultType = (values: Record<string, unknown>) =>
      buildSaveData({
        ...baseCtx,
        elementType: 'k8s-get',
        values,
        outputParameters: [{
          name: 'result',
          type: resolveOutputType(
            getResult.type,
            getResult.typeWhen,
            values,
            getInputParams('k8s-get'),
          ) as Parameter['type'],
          required: false as const,
        }],
        outputBindings: {},
      }).data?.outputTypes.result

    it('is string for a JSON-mode Get', () => {
      expect(savedResultType({ output_format: 'json' })).toBe('string')
    })

    it('is table for a Table-mode Get', () => {
      expect(savedResultType({ output_format: 'table' })).toBe('table')
    })

    it('is map for the default Name read', () => {
      expect(savedResultType({})).toBe('map')
    })
  })

  // REQ-3.1.3.16: the per-block reveal set persists in SaveData, like
  // outputSecretFields.
  it('emits unmaskedSecretFields in SaveData', () => {
    const result = buildSaveData({
      ...baseCtx,
      outputBindings: { status_code: 'count' },
      unmaskedSecretFields: ['authorization', 'cookie'],
    } as unknown as Parameters<typeof buildSaveData>[0])
    const saved = result.data as (typeof result.data & { unmaskedSecretFields?: string[] }) | null
    expect(saved?.unmaskedSecretFields).toEqual(['authorization', 'cookie'])
  })

  it('emits an empty unmaskedSecretFields when no field is revealed', () => {
    const result = buildSaveData({
      ...baseCtx,
      outputBindings: { status_code: 'count' },
      unmaskedSecretFields: [],
    } as unknown as Parameters<typeof buildSaveData>[0])
    const saved = result.data as (typeof result.data & { unmaskedSecretFields?: string[] }) | null
    expect(saved?.unmaskedSecretFields).toEqual([])
  })

  // REQ-3.1.3.5: the per-block run-output tri-state persists in SaveData.
  it('emits the secretMasking tri-state in SaveData', () => {
    const result = buildSaveData({
      ...baseCtx,
      outputBindings: { status_code: 'count' },
      secretMasking: 'reveal',
    } as unknown as Parameters<typeof buildSaveData>[0])
    const saved = result.data as (typeof result.data & { secretMasking?: string }) | null
    expect(saved?.secretMasking).toBe('reveal')
  })

  it('defaults secretMasking to "system" when unset', () => {
    const result = buildSaveData({
      ...baseCtx,
      outputBindings: { status_code: 'count' },
    })
    const saved = result.data as (typeof result.data & { secretMasking?: string }) | null
    expect(saved?.secretMasking).toBe('system')
  })

  // REQ-3.5.1.20: the Switch case list persists under values.branches,
  // exactly as the If/Else branch list does, through the shared values.
  it('writes the switch branches into values.branches as the window holds them', () => {
    const result = buildSaveData({
      ...baseCtx,
      elementType: 'switch-case',
      outputBindings: { status_code: 'count' },
      versionParameters: getInputParams('switch-case') ?? [],
      values: { branches: caseBranches },
    })
    expect(result.data?.values.branches).toEqual([
      { id: 'branch_0', type: 'case', label: '', conditions: caseConditions, break: true },
      { id: 'branch_1', type: 'case', label: 'Slow', conditions: caseConditions, break: false },
      { id: 'branch_2', type: 'default', label: '' },
    ])
  })

  it('preserves the break flags and the default entry keys unnormalized', () => {
    const result = buildSaveData({
      ...baseCtx,
      elementType: 'switch-case',
      outputBindings: { status_code: 'count' },
      versionParameters: getInputParams('switch-case') ?? [],
      values: { branches: caseBranches },
    })
    const saved = result.data?.values.branches as Array<Record<string, unknown>>
    expect(saved[0].break).toBe(true)
    expect(saved[1].break).toBe(false)
    expect(Object.keys(saved[2])).toEqual(['id', 'type', 'label'])
  })

  it('writes no branch list for a Block whose values hold none', () => {
    const result = buildSaveData({
      ...baseCtx,
      outputBindings: { status_code: 'count' },
    })
    expect(result.data?.values).not.toHaveProperty('branches')
  })

  // Parallel's lanes and join mode live in the shared values; the Save writes each lane limit
  // in the number wire form (REQ-3.2.3.6, REQ-3.2.3.7, REQ-3.1.3.14).
  describe('Parallel write-back', () => {
    const PARALLEL = getInputParams('parallel') ?? []

    const parallelSave = (values: Record<string, unknown>, flags: { expressionFields?: string[] } = {}) =>
      buildSaveData({ ...baseCtx, elementType: 'parallel', outputBindings: {}, versionParameters: PARALLEL, values, ...flags }).data

    const LANES = [
      { id: 'branch_1', name: 'ingest', time_limit: 30000 },
      { id: 'branch_2', name: 'probe' },
    ]

    it('writes the lanes into values.branches with each limit in the number wire form', () => {
      const saved = parallelSave({
        branches: [
          { id: 'branch_1', name: 'ingest', time_limit: '30000' },
          { id: 'branch_2', name: 'probe', time_limit: '060' },
          { id: 'branch_3', name: '', time_limit: '9007199254740993' },
          { id: 'branch_4', name: '', time_limit: 250 },
        ],
      })

      expect(saved?.values.branches).toEqual([
        { id: 'branch_1', name: 'ingest', time_limit: 30000 },
        { id: 'branch_2', name: 'probe', time_limit: '060' },
        { id: 'branch_3', name: '', time_limit: '9007199254740993' },
        { id: 'branch_4', name: '', time_limit: 250 },
      ])
    })

    it('omits an unset lane limit rather than writing null', () => {
      // Guard: a null limit would read back as a configured limit of zero.
      const saved = parallelSave({
        branches: [LANES[0], { id: 'branch_2', name: 'probe', time_limit: undefined }],
      })?.values.branches as Array<Record<string, unknown>>

      expect(Object.keys(saved[1])).toEqual(['id', 'name'])
    })

    it('keeps an {x} lane limit as written, with its flag', () => {
      const saved = parallelSave(
        { branches: [{ id: 'branch_1', name: 'ingest', time_limit: 'slow_ms' }, LANES[1]] },
        { expressionFields: ['branches.0.time_limit'] },
      )

      expect(saved?.values.branches).toEqual([
        { id: 'branch_1', name: 'ingest', time_limit: 'slow_ms' },
        { id: 'branch_2', name: 'probe' },
      ])
      expect(saved?.expressionFields).toEqual(['branches.0.time_limit'])
    })

    it('writes the join mode into values.join, and Wait for all while the person never picked one', () => {
      expect(parallelSave({ branches: LANES, join: 'first' })?.values.join).toBe('first')
      expect(parallelSave({ branches: LANES })?.values.join).toBe('all')
    })

    it('leaves branches and join unset for a Block that neither holds nor declares them', () => {
      const result = buildSaveData({ ...baseCtx, outputBindings: {}, values: {} })

      expect(result.data?.values).not.toHaveProperty('branches')
      expect(result.data?.values).not.toHaveProperty('join')
    })

    it('keeps the section time limit as an ordinary parameter value', () => {
      expect(parallelSave({ branches: LANES, time_limit: 60000 })?.values.time_limit).toBe(60000)
    })

    it('writes no branch key at all when the window holds no lanes', () => {
      // Guard: a Save must never write an undefined branch list.
      const saved = parallelSave({})?.values

      expect(Object.hasOwn(saved ?? {}, 'branches')).toBe(false)
    })

    // Stored data the window never writes is stored back as it is; the save check names it.
    it('stores a lane list that is not a list as it is', () => {
      expect(parallelSave({ branches: 'ingest, probe' })?.values.branches).toBe('ingest, probe')
    })

    it('stores a lane that is not an object as it is, beside the lanes it shapes', () => {
      const saved = parallelSave({ branches: [null, 'probe', { id: 'branch_3', name: 'ingest', time_limit: '500' }] })

      expect(saved?.values.branches).toEqual([null, 'probe', { id: 'branch_3', name: 'ingest', time_limit: 500 }])
    })
  })

  // Wait Until's conditions, mode and scope checkbox live in the shared values (REQ-3.5.4.3).
  describe('Wait Until write-back', () => {
    const WAIT_CONDITIONS = [{ id: 'c-1', type: 'expression' as const, expression: 'ready' }]
    const WAIT = getInputParams('wait-until') ?? []

    const waitSave = (values: Record<string, unknown>) =>
      buildSaveData({
        ...baseCtx,
        elementType: 'wait-until',
        outputBindings: { status_code: 'count' },
        versionParameters: WAIT,
        values: { timeout: 30000, conditions: WAIT_CONDITIONS, ...values },
      }).data?.values

    it('writes the conditions back into values', () => {
      expect(waitSave({})?.conditions).toEqual(WAIT_CONDITIONS)
    })

    it('writes the wait mode back into values', () => {
      expect(waitSave({ mode: 'watch' })?.mode).toBe('watch')
    })

    it('writes the fail-current-scope choice back into values', () => {
      expect(waitSave({ fail_current_scope: true })?.fail_current_scope).toBe(true)
    })

    it('writes no conditions for a Block whose values hold none', () => {
      const result = buildSaveData({
        ...baseCtx,
        outputBindings: { status_code: 'count' },
      })
      expect(result.data?.values).not.toHaveProperty('conditions')
    })
  })

  // A choice or true / false the person never touched is saved with its declared default (REQ-3.1.1.5).
  describe('untouched control choices are saved with their declared defaults', () => {
    it.each([
      ['assert', { assertions: [] }, { mode: 'split', fail_current_scope: false }],
      ['wait-until', { timeout: 30000, conditions: [] }, { mode: 'retry', fail_current_scope: false }],
      ['while', { conditions: [] }, { mode: 'while-do' }],
      ['parallel', { branches: [] }, { join: 'all' }],
      ['for', { count: 3 }, { mode: 'count' }],
    ])('saves the defaults of an untouched %s', (elementType, values, defaults) => {
      const saved = buildSaveData({
        ...baseCtx,
        elementType,
        outputBindings: {},
        versionParameters: getInputParams(elementType) ?? [],
        values,
      }).data?.values

      expect(saved).toMatchObject(defaults)
    })

    it('keeps the choice the person made over the default', () => {
      const saved = buildSaveData({
        ...baseCtx,
        elementType: 'assert',
        outputBindings: {},
        versionParameters: getInputParams('assert') ?? [],
        values: { assertions: [], mode: 'single', fail_current_scope: true },
      }).data?.values

      expect(saved).toMatchObject({ mode: 'single', fail_current_scope: true })
    })
  })

  // A compare value its operator hides is dropped at Save, also on rows a recipe or an import wrote (REQ-3.5.1.5).
  describe('condition rows at Save', () => {
    const UNARY_HOLDING = {
      id: 'c-1',
      type: 'literal' as const,
      variable: 'ready',
      value_type: 'boolean',
      operator: 'is_true',
      reference_value: 'yes',
      reference_is_expression: true,
      reference_is_template: false,
    }
    const BINARY = {
      id: 'c-2',
      type: 'literal' as const,
      variable: 'status',
      value_type: 'integer',
      operator: 'equals',
      reference_value: '200',
      reference_is_expression: false,
    }
    const UNARY_CLEAN = { id: 'c-1', type: 'literal', variable: 'ready', value_type: 'boolean', operator: 'is_true' }

    it('drops the compare value and both flags of an If/Else row whose operator takes none', () => {
      const branches = [
        { id: 'branch_0', type: 'if', label: '', conditions: [UNARY_HOLDING, { type: 'operator', value: 'and' }, BINARY] },
        { id: 'branch_1', type: 'else', label: '' },
      ]
      const saved = buildSaveData({
        ...baseCtx,
        elementType: 'if-else',
        outputBindings: {},
        versionParameters: getInputParams('if-else') ?? [],
        values: { branches },
      }).data?.values.branches as Array<{ conditions?: unknown[] }>

      expect(saved[0].conditions).toEqual([UNARY_CLEAN, { type: 'operator', value: 'and' }, BINARY])
      expect(branches[0].conditions?.[0]).toEqual(UNARY_HOLDING)
    })

    it('drops them inside an Assert group a recipe wrote, which the window never touched', () => {
      const saved = buildSaveData({
        ...baseCtx,
        elementType: 'assert',
        outputBindings: {},
        versionParameters: getInputParams('assert') ?? [],
        values: { assertions: [{ id: 'g-1', type: 'group', items: [UNARY_HOLDING, BINARY] }] },
      }).data?.values.assertions

      expect(saved).toEqual([{ id: 'g-1', type: 'group', items: [UNARY_CLEAN, BINARY] }])
    })
  })

  // The Variable Setter saves on the shared stored shape: flags, entry types and secret marks
  // at `variables.<row>`; no row type on the Block (REQ-3.4.1.14, REQ-3.1.3.19).
  describe('the Variable Setter on the shared stored shape', () => {
    const SETTER = getInputParams('variable-setter') ?? []
    const ROWS = {
      greeting: 'hi',
      next_attempt: 'attempt + 1',
      summary: 'Run {{ run_id }} done',
      api_token: 'sealed-token',
      host_list: ['web-1', 'web-2', 'peer_host'],
      last_error: null,
    }

    const setterSave = (overrides: Partial<Parameters<typeof buildSaveData>[0]> & { secretFields?: string[] }) =>
      buildSaveData({
        ...baseCtx,
        elementType: 'variable-setter',
        outputBindings: {},
        versionParameters: SETTER,
        values: { variables: ROWS },
        ...overrides,
      } as Parameters<typeof buildSaveData>[0]).data as (SaveData & { secretFields?: string[] }) | null

    it('writes the rows, their flags, entry types and secret mark on the shared lists', () => {
      const saved = setterSave({
        expressionFields: ['variables.next_attempt', 'variables.host_list.2'],
        templateFields: ['variables.summary'],
        settingElementTypes: { 'variables.host_list': ['string', 'string', 'string'] },
        secretFields: ['variables.api_token'],
      })

      expect(saved?.values.variables).toEqual(ROWS)
      expect(saved?.expressionFields).toEqual(['variables.next_attempt', 'variables.host_list.2'])
      expect(saved?.templateFields).toEqual(['variables.summary'])
      expect(saved?.elementTypes).toEqual({ 'variables.host_list': ['string', 'string', 'string'] })
      expect(saved?.secretFields).toEqual(['variables.api_token'])
    })

    it('writes no Setter list of its own and no row type beside the shared lists', () => {
      const saved = setterSave({
        expressionFields: ['variables.next_attempt'],
        secretFields: ['variables.api_token'],
      })

      expect(Object.keys(saved ?? {}).filter((key) => key.startsWith('variable'))).toEqual([])
    })

    it('keeps a row\'s entry types while one entry is {x}, and drops them once the whole row is {x} or gone', () => {
      const types: Record<string, ElementTypes> = {
        'variables.host_list': ['string', 'string', 'string'],
        'variables.next_attempt': ['integer'],
        'variables.gone': { a: 'string' },
      }

      expect(
        setterSave({ expressionFields: ['variables.host_list.2', 'variables.next_attempt'], settingElementTypes: types })
          ?.elementTypes,
      ).toEqual({ 'variables.host_list': ['string', 'string', 'string'] })
      expect(
        setterSave({ expressionFields: ['variables.host_list'], settingElementTypes: types, values: { variables: { host_list: 'hosts()' } } })
          ?.elementTypes,
      ).toBeUndefined()
    })

    it('drops the flags of a row that is gone', () => {
      const saved = setterSave({
        expressionFields: ['variables.next_attempt', 'variables.gone', 'variables.host_list.7'],
        templateFields: ['variables.summary', 'variables.farewell'],
      })

      expect(saved?.expressionFields).toEqual(['variables.next_attempt'])
      expect(saved?.templateFields).toEqual(['variables.summary'])
    })

    it('keeps a row set to null', () => {
      expect(setterSave({})?.values.variables).toMatchObject({ last_error: null })
    })

    // A row's type is its declared variable's type; a literal number row keeps every digit it was given (REQ-3.1.3.14).
    it('writes a literal number row in the number wire form of its declared variable\'s type', () => {
      const declared: EnrichedVariable[] = [
        { id: 'v-retries', name: 'retries', value: 0, type: 'integer' },
        { id: 'v-padded', name: 'padded', value: 0, type: 'integer' },
        { id: 'v-ratio', name: 'ratio', value: 0, type: 'float' },
        { id: 'v-label', name: 'label', value: '', type: 'string' },
        { id: 'v-next', name: 'next_try', value: 0, type: 'integer' },
        { id: 'v-last', name: 'last_code', value: 0, type: 'integer' },
      ]
      const saved = setterSave({
        variables: declared,
        values: {
          variables: { retries: '30000', padded: '060', ratio: '2.5', label: '42', next_try: 'retries + 1', last_code: null },
        },
        expressionFields: ['variables.next_try'],
      })

      expect(saved?.values.variables).toEqual({
        retries: 30000,
        padded: '060',
        ratio: 2.5,
        label: '42',
        next_try: 'retries + 1',
        last_code: null,
      })
    })

    // A new target's row is typed by the type picked for it; the canvas declares only the targets Save keeps.
    it('writes a new target row in the number wire form of its picked type and keeps only the picked types of kept rows', () => {
      const saved = setterSave({
        values: { variables: { fresh: '42', label: '7' } },
        newTargetTypes: { fresh: 'integer', label: 'string', gone: 'float' },
      })

      expect(saved?.values.variables).toEqual({ fresh: 42, label: '7' })
      expect(saved?.newTargetTypes).toEqual({ fresh: 'integer', label: 'string' })
    })

    it('stores Setter rows that are not a record as they are and keeps no picked type', () => {
      const saved = setterSave({ values: { variables: ['fresh'] }, newTargetTypes: { fresh: 'integer' } })

      expect(saved?.values.variables).toEqual(['fresh'])
      expect(saved?.newTargetTypes).toEqual({})
    })

    it('keeps no picked type when the Save holds no Setter rows', () => {
      expect(setterSave({ values: {}, newTargetTypes: { fresh: 'integer' } })?.newTargetTypes).toEqual({})
    })
  })

  // SHRUN-6: a variable export rides in the output parameters typed by the
  // variable it is bound to, the type chosen in the row when that variable
  // does not exist yet, and no type at all while it is unbound. The rows are
  // written with no cast, so an empty type has to be a legal output-parameter type.
  describe('variable export rows', () => {
    const boundRow = { name: 'COUNT', type: 'integer', required: false as const }
    const untypedRow = { name: 'TOTAL', type: '', required: false as const }
    const chosenRow = { name: 'TOTAL', type: 'table', required: false as const }

    it('reports no type error for a row with no type', () => {
      const result = buildSaveData({
        ...baseCtx,
        outputParameters: [intOutput, untypedRow],
        outputBindings: { status_code: 'count', TOTAL: 'msg' },
      })

      expect(result.errors).toEqual({})
      expect(result.data).not.toBeNull()
    })

    it('carries the bound variable type into outputTypes', () => {
      const result = buildSaveData({
        ...baseCtx,
        outputParameters: [intOutput, boundRow],
        outputBindings: { COUNT: 'count' },
      })

      expect(result.data?.outputTypes.COUNT).toBe('integer')
    })

    it('carries an empty type for an unbound row', () => {
      const result = buildSaveData({
        ...baseCtx,
        outputParameters: [intOutput, untypedRow],
        outputBindings: {},
      })

      expect(result.data?.outputTypes.TOTAL).toBe('')
    })

    it('carries the chosen type for a row bound to a new variable name', () => {
      const result = buildSaveData({
        ...baseCtx,
        outputParameters: [intOutput, chosenRow],
        outputBindings: { TOTAL: 'fresh_total' },
      })

      expect(result.errors).toEqual({})
      expect(result.data?.outputTypes.TOTAL).toBe('table')
    })
  })

  // Save stores what the Block holds and the value each shown choice row displays; the run fills every
  // unset free-entry row from its current default (REQ-3.1.1.5, FIELD-8).
  describe('SQL block defaults (REQ-3.4.1.6, SQL-8)', () => {
    const savedValues = (values: Record<string, unknown>) => {
      const versionParameters: Parameter[] = getInputParams('sql-client') ?? []
      expect(versionParameters, 'sql-client descriptors').toHaveLength(38)
      return buildSaveData({
        ...baseCtx,
        elementType: 'sql-client',
        values,
        versionParameters,
        outputBindings: {},
      }).data?.values
    }

    it.each([
      ['postgresql', false],
      ['mysql', false],
      ['oracle', false],
      ['mssql', true],
    ])('stores the TLS the %s row shows, %s', (databaseType, tls) => {
      expect(savedValues({ database_type: databaseType })?.tls).toBe(tls)
    })

    it('stores no TLS on SQLite, where both TLS rows are hidden', () => {
      expect(savedValues({ database_type: 'sqlite' })).not.toHaveProperty('tls')
    })

    it('stores the shown choices of a Block that holds none: PostgreSQL, Run SQL, TLS off', () => {
      expect(savedValues({})).toEqual({
        operation: 'run_sql',
        database_type: 'postgresql',
        script_type: 'source',
        stop_on_error: true,
        tls: false,
        on_error: 'fail',
      })
    })

    it('keeps an explicit TLS false on SQL Server', () => {
      expect(savedValues({ database_type: 'mssql', tls: false })?.tls).toBe(false)
    })

    it('keeps an explicit TLS true on PostgreSQL', () => {
      expect(savedValues({ database_type: 'postgresql', tls: true })?.tls).toBe(true)
    })

    it.each(['postgresql', 'mysql', 'oracle', 'mssql', 'sqlite'])(
      'saves no port key when Port is left blank on %s',
      (databaseType) => {
        expect(savedValues({ database_type: databaseType })).not.toHaveProperty('port')
      },
    )

    it('stores the Stop on error Run SQL shows', () => {
      expect(savedValues({ operation: 'run_sql' })?.stop_on_error).toBe(true)
    })

    it('stores the Stop on error Load table shows with Commit each batch on', () => {
      expect(savedValues({ operation: 'load_table', commit_each_batch: true })?.stop_on_error).toBe(true)
    })

    it('stores no Stop on error on Load table with Commit each batch off, where it is hidden', () => {
      expect(savedValues({ operation: 'load_table', commit_each_batch: false })).not.toHaveProperty('stop_on_error')
    })
  })

  // A hidden row without retainOnHide is kept as stored at save, and an unset one stores nothing.
  describe('a name whose descriptors are all hidden saves as a hidden row without retainOnHide (SQL-8)', () => {
    const MODE: Parameter = {
      name: 'mode',
      type: 'string',
      required: false,
      enumValues: ['a', 'b', 'c'],
      defaultValue: 'a',
    }
    const SINGLE: Parameter = {
      name: 'single',
      type: 'integer',
      required: false,
      defaultValue: 7,
      showWhen: { field: 'mode', values: ['a'] },
    }
    const TWIN_A: Parameter = {
      name: 'twin',
      type: 'boolean',
      required: false,
      defaultValue: false,
      showWhen: { field: 'mode', values: ['a'] },
    }
    const TWIN_B: Parameter = {
      name: 'twin',
      type: 'boolean',
      required: false,
      defaultValue: true,
      showWhen: { field: 'mode', values: ['b'] },
    }
    const GATED = [MODE, SINGLE, TWIN_A, TWIN_B]

    const saved = (versionParameters: Parameter[], values: Record<string, unknown>) =>
      buildSaveData({ ...baseCtx, values, versionParameters, outputBindings: {} }).data?.values

    const sqlSaved = (values: Record<string, unknown>) => {
      const versionParameters: Parameter[] = getInputParams('sql-client') ?? []
      expect(versionParameters, 'sql-client descriptors').toHaveLength(38)
      return buildSaveData({ ...baseCtx, elementType: 'sql-client', values, versionParameters, outputBindings: {} }).data?.values
    }

    it('keeps the stored value of a hidden row', () => {
      expect(saved(GATED, { mode: 'c', single: 3 })?.single).toBe(3)
    })

    it('saves nothing for an unset hidden row', () => {
      expect(saved(GATED, { mode: 'c' })).not.toHaveProperty('single')
    })

    it('keeps the stored value of a name whose descriptors are all hidden', () => {
      expect(saved(GATED, { mode: 'c', twin: true })?.twin).toBe(true)
    })

    it('saves nothing for an unset name whose descriptors are all hidden', () => {
      expect(saved(GATED, { mode: 'c' })).toEqual({ mode: 'c' })
    })

    it('keeps a stored Stop on error on Call procedure, where both of its rows are hidden', () => {
      expect(sqlSaved({ operation: 'call_procedure', stop_on_error: false })?.stop_on_error).toBe(false)
    })

    it('saves nothing for an unset Stop on error on Call procedure', () => {
      expect(sqlSaved({ operation: 'call_procedure' })).not.toHaveProperty('stop_on_error')
    })

    it('keeps a stored TLS on SQLite, where both TLS rows are hidden', () => {
      expect(sqlSaved({ database_type: 'sqlite', tls: true })?.tls).toBe(true)
    })

    it('keeps a stored Port on SQLite, where every Port row is hidden', () => {
      expect(sqlSaved({ database_type: 'sqlite', port: 5432 })?.port).toBe(5432)
    })

    it('keeps a stored Max rows on Load table, a hidden row of its own', () => {
      expect(sqlSaved({ operation: 'load_table', max_rows: 50 })?.max_rows).toBe(50)
    })

    it('saves nothing for an unset Max rows on Load table', () => {
      expect(sqlSaved({ operation: 'load_table' })).not.toHaveProperty('max_rows')
    })
  })

  // HTTP-13: a row that reads "Remote host's settings" stores nothing at Save, like a hidden row.
  describe('a row locked on the remote host stores nothing (HTTP-13, SHELL-10)', () => {
    const LOCKED_MODE: TableParameter = {
      name: 'route',
      type: 'string',
      required: false,
      enumValues: ['direct', 'relay'],
      defaultValue: 'direct',
      lockedOnRemoteHost: { displayText: "Remote host's settings" },
    }
    const LOCKED_NO_DEFAULT: TableParameter = {
      name: 'gateway',
      type: 'string',
      required: false,
      lockedOnRemoteHost: { displayText: "Remote host's settings" },
    }
    const FREE: TableParameter = {
      name: 'retries',
      type: 'integer',
      required: false,
      defaultValue: 3,
    }
    const SYNTHETIC = [LOCKED_MODE, LOCKED_NO_DEFAULT, FREE] as Parameter[]

    const httpParameters = (): Parameter[] => {
      const versionParameters: Parameter[] = getInputParams('http-client') ?? []
      expect(versionParameters.map((p) => p.name)).toContain('proxy_mode')
      return versionParameters
    }

    const httpSave = (values: Record<string, unknown>, runsOnRemoteHost?: boolean) =>
      buildSaveData({
        ...baseCtx,
        values,
        versionParameters: httpParameters(),
        outputBindings: {},
        runsOnRemoteHost,
      }).data

    const syntheticSave = (overrides: Partial<Parameters<typeof buildSaveData>[0]>) =>
      buildSaveData({
        ...baseCtx,
        versionParameters: SYNTHETIC,
        outputBindings: {},
        runsOnRemoteHost: true,
        ...overrides,
      }).data

    it.each(['off', 'wave-setting'])(
      'stores no Proxy choice for an HTTP block on a remote host while %s is stored',
      (stored) => {
        expect(httpSave({ proxy_mode: stored }, true)?.values).not.toHaveProperty('proxy_mode')
      },
    )

    it('stores the WAVE setting the Proxy row shows on the WAVE host, and nothing on a remote host', () => {
      expect(httpSave({})?.values.proxy_mode).toBe('wave-setting')
      expect(httpSave({}, true)?.values).not.toHaveProperty('proxy_mode')
    })

    it.each([false, undefined])(
      'keeps the stored Proxy choice of an HTTP block on the WAVE host (runsOnRemoteHost %s)',
      (runsOnRemoteHost) => {
        expect(httpSave({ proxy_mode: 'off' }, runsOnRemoteHost)?.values.proxy_mode).toBe('off')
      },
    )

    it('keeps every other stored value of the HTTP block on a remote host', () => {
      const stored = {
        url: 'https://api.corp.example/health',
        method: 'POST',
        allow_redirects: false,
        max_redirects: 2,
        proxy_mode: 'off',
      }
      const { proxy_mode: _locked, ...unlocked } = stored
      const local = httpSave(stored, false)?.values
      const remote = httpSave(stored, true)?.values

      expect(local).toMatchObject(stored)
      expect(remote).toMatchObject(unlocked)
      expect(remote).not.toHaveProperty('proxy_mode')
    })

    it('leaves the dialog draft as it was', () => {
      const values = { proxy_mode: 'off' }

      httpSave(values, true)

      expect(values).toEqual({ proxy_mode: 'off' })
    })

    it('stores nothing for any locked row and keeps the rows that carry no lock', () => {
      const saved = syntheticSave({ values: { route: 'relay', retries: 9 } })

      expect(saved?.values).toEqual({ retries: 9 })
    })

    it('stores no key for a locked row that has no default, as a new block does', () => {
      const saved = syntheticSave({ values: { gateway: 'gw.corp.example' } })

      expect(saved?.values).not.toHaveProperty('gateway')
      expect(buildSaveData({
        ...baseCtx,
        versionParameters: SYNTHETIC,
        outputBindings: {},
        values: {},
      }).data?.values).not.toHaveProperty('gateway')
    })

    it('takes a locked row out of the expression rows, whole or per key, and keeps the others', () => {
      const saved = syntheticSave({
        values: { route: 'pick_route()', gateway: { a: 'x' }, retries: 'count', router: 'pick()' },
        expressionFields: ['route', 'gateway.a', 'retries', 'router'],
      })

      expect(saved?.values).not.toHaveProperty('route')
      expect(saved?.values).not.toHaveProperty('gateway')
      expect(saved?.expressionFields).toEqual(['retries', 'router'])
    })

    it('takes a locked row out of the template rows and keeps the others', () => {
      const saved = syntheticSave({
        values: { route: '${route}', retries: 4, note: 'hello {{ name }}' },
        templateFields: ['route', 'note'],
      })

      expect(saved?.templateFields).toEqual(['note'])
    })

    it('keeps the expression and template rows of a locked row on the WAVE host', () => {
      const saved = syntheticSave({
        runsOnRemoteHost: false,
        values: { route: 'pick_route()', gateway: 'gw' },
        expressionFields: ['route'],
        templateFields: ['gateway'],
      })

      expect(saved?.values).toMatchObject({ route: 'pick_route()', gateway: 'gw' })
      expect(saved?.expressionFields).toEqual(['route'])
      expect(saved?.templateFields).toEqual(['gateway'])
    })
  })

  // A shown choice list or true / false always holds a value; a Save writes what the row displays (FIELD-8, SHELL-10).
  describe('a shown choice row stores the value it displays (FIELD-8, SHELL-10)', () => {
    const MODE: TableParameter = {
      name: 'mode',
      type: 'string',
      required: false,
      enumValues: ['a', 'b'],
      defaultValue: 'a',
    }
    const FLAG: TableParameter = { name: 'flag', type: 'boolean', required: false, defaultValue: true }
    const GATED: TableParameter = {
      name: 'gated',
      type: 'boolean',
      required: false,
      defaultValue: false,
      showWhen: { field: 'mode', values: ['b'] },
    }
    const PINNED: TableParameter = {
      name: 'pinned',
      type: 'boolean',
      required: false,
      defaultValue: false,
      lockedWhen: { field: 'mode', values: ['b'], value: true },
    }
    const NO_DEFAULT: TableParameter = { name: 'level', type: 'string', required: true, enumValues: ['low', 'high'] }
    const NULL_DEFAULT: TableParameter = {
      name: 'tier',
      type: 'string',
      required: false,
      enumValues: ['x', 'y'],
      defaultValue: null,
    }
    const FREE: TableParameter = { name: 'retries', type: 'integer', required: false, defaultValue: 3 }
    const TWIN_A: TableParameter = { name: 'twin', type: 'string', required: false, enumValues: ['p'], defaultValue: 'p' }
    const TWIN_B: TableParameter = { name: 'twin', type: 'string', required: false, enumValues: ['q'], defaultValue: 'q' }
    const ROWS = [MODE, FLAG, GATED, PINNED, NO_DEFAULT, NULL_DEFAULT, FREE, TWIN_A, TWIN_B] as Parameter[]

    const save = (overrides: Partial<Parameters<typeof buildSaveData>[0]>) =>
      buildSaveData({ ...baseCtx, versionParameters: ROWS, outputBindings: {}, ...overrides }).data

    it('stores the default each shown choice row displays, and nothing for a free-entry row', () => {
      expect(save({ values: {} })?.values).toEqual({ mode: 'a', flag: true, pinned: false, twin: 'p' })
    })

    it('keeps the value the Block holds over the default', () => {
      expect(save({ values: { mode: 'b', flag: false, twin: 'q' } })?.values).toMatchObject({ mode: 'b', flag: false, twin: 'q' })
    })

    it('stores a row that shows once its gate opens, and the value a pin shows', () => {
      expect(save({ values: { mode: 'b' } })?.values).toMatchObject({ gated: false, pinned: true })
    })

    it('stores nothing for a row its gate hides', () => {
      expect(save({ values: { mode: 'a' } })?.values).not.toHaveProperty('gated')
    })

    it('stores nothing for a choice row that shows no value: no default, or a null default', () => {
      const values = save({ values: {} })?.values
      expect(values).not.toHaveProperty('level')
      expect(values).not.toHaveProperty('tier')
    })

    it('writes no displayed value into a row in expression or template mode', () => {
      const values = save({ values: {}, expressionFields: ['mode'], templateFields: ['flag'] })?.values
      expect(values).not.toHaveProperty('mode')
      expect(values).not.toHaveProperty('flag')
    })

    it('stores nothing for a row the remote host locks', () => {
      const locked: TableParameter = { ...MODE, lockedOnRemoteHost: { displayText: "Remote host's settings" } }
      expect(save({ values: {}, versionParameters: [locked] as Parameter[], runsOnRemoteHost: true })?.values).toEqual({})
    })

    it('Netcat: Check hides CRLF line endings, Close after sending and Send; Talk stores what they show', () => {
      const versionParameters: Parameter[] = getInputParams('netcat') ?? []
      const netcat = (mode: string) =>
        buildSaveData({ ...baseCtx, elementType: 'netcat', values: { host: 'h', port: 1, mode }, versionParameters, outputBindings: {} }).data?.values
      const check = netcat('check')
      for (const name of ['crlf', 'close_after_send', 'send']) expect(check).not.toHaveProperty(name)
      expect(netcat('talk')).toMatchObject({ send: 'text', crlf: false, close_after_send: false })
    })

    it('leaves the dialog draft as it was', () => {
      const values = { flag: false }
      save({ values })
      expect(values).toEqual({ flag: false })
    })
  })

  // An unset field is absent everywhere: no value, no flag, no item types (REQ-3.1.1.5).
  describe('flags with no value are dropped at Save (REQ-3.1.1.5)', () => {
    const flagSave = (overrides: Partial<Parameters<typeof buildSaveData>[0]>) =>
      buildSaveData({ ...baseCtx, outputBindings: {}, ...overrides }).data

    it('drops a whole expression flag whose field holds no value and keeps the others', () => {
      const saved = flagSave({
        values: { timeout: 'limit * 2' },
        expressionFields: ['url', 'timeout'],
      })

      expect(saved?.expressionFields).toEqual(['timeout'])
      expect(saved?.values).toEqual({ timeout: 'limit * 2' })
    })

    it.each([
      ['empty', ''],
      ['only spaces', '   '],
    ])('stores neither the text nor the flag of a whole expression left %s', (_label, text) => {
      const saved = flagSave({
        values: { url: text, timeout: 'limit * 2' },
        expressionFields: ['url', 'timeout'],
      })

      expect(saved?.values).toEqual({ timeout: 'limit * 2' })
      expect(saved?.expressionFields).toEqual(['timeout'])
    })

    it.each([
      ['holds no value', {}],
      ['holds empty text', { query: '' }],
      ['holds only spaces', { query: '   ' }],
    ])('drops a whole Template flag whose field %s and keeps the others', (_label, values) => {
      const saved = flagSave({
        values: { ...values, body: 'hello {{ name }}' },
        templateFields: ['query', 'body'],
      })

      expect(saved?.templateFields).toEqual(['body'])
    })

    it('drops a dotted expression flag whose entry the field does not hold', () => {
      const saved = flagSave({
        values: {
          headers: { 'X-Id': 'trace_id()' },
          arguments: [{ value: 'a' }, { value: 'count + 1' }],
        },
        expressionFields: [
          'headers.X-Id',
          'headers.X-Gone',
          'arguments.1.value',
          'arguments.3.value',
          'params.page',
        ],
      })

      expect(saved?.expressionFields).toEqual(['headers.X-Id', 'arguments.1.value'])
    })

    it('drops a dotted Template flag whose entry the field does not hold', () => {
      const saved = flagSave({
        values: { body: { greeting: 'hi {{ name }}' } },
        templateFields: ['body.greeting', 'body.farewell', 'note.text'],
      })

      expect(saved?.templateFields).toEqual(['body.greeting'])
    })
  })

  // The schema seed of a secret output is shown, never stored until a Secret box changes (REQ-3.1.2.9, K8SCON-4).
  describe('output secret list', () => {
    const secretSave = (overrides: Record<string, unknown>) =>
      buildSaveData({
        ...baseCtx,
        outputBindings: {},
        ...overrides,
      } as Parameters<typeof buildSaveData>[0]).data?.outputSecretFields

    it('writes the secret list only once a Secret box moved off the schema seed', () => {
      expect(secretSave({ outputSecretFields: ['session'], seededOutputSecretFields: ['session'] })).toBeUndefined()
      expect(secretSave({ outputSecretFields: [], seededOutputSecretFields: [] })).toBeUndefined()
      expect(secretSave({ outputSecretFields: [], seededOutputSecretFields: ['session'] })).toEqual([])
      expect(
        secretSave({ outputSecretFields: ['session', 'token'], seededOutputSecretFields: ['session'] }),
      ).toEqual(['session', 'token'])
      // A Block that stores a list shows no seed: its list is written as it stands.
      expect(secretSave({ outputSecretFields: ['session'] })).toEqual(['session'])
      expect(secretSave({ outputSecretFields: [] })).toEqual([])
    })
  })

  describe('typed list item types (REQ-3.1.3.19)', () => {
    const TAGS = {
      name: 'tags',
      type: 'array',
      required: false,
      typedValues: true,
      defaultValue: ['a'],
    } as Parameter

    const typedSave = (values: Record<string, unknown>, expressionFields: string[] = []) =>
      buildSaveData({
        ...baseCtx,
        outputBindings: {},
        versionParameters: [TAGS],
        values,
        expressionFields,
        settingElementTypes: { tags: ['string', 'integer'] },
      }).data

    it('writes the item types of a typed list the Block holds and none for one left at its default', () => {
      expect(typedSave({ tags: ['x', 'count + 1'] }, ['tags.1'])?.elementTypes).toEqual({
        tags: ['string', 'integer'],
      })
      const unset = typedSave({})
      expect(unset?.values).toEqual({})
      expect(unset?.elementTypes).toBeUndefined()
    })
  })
})

describe('computeHasChanges', () => {
  // The HasChangesContext's typing says name + elementName are strings, but
  // hasScalarChanges defends with ``(ctx.name ?? '').trim()``. At runtime,
  // sparse callers can pass undefined; this exercises that defensive ``??``.
  const baseChangesCtx = {
    selectedVersion: '1.0.0',
    elementVersion: '1.0.0',
    name: '',
    elementName: '',
    description: '',
    elementDescription: undefined as string | undefined,
    values: {},
    elementCurrentValues: {},
    outputBindings: {},
    elementOutputBindings: {},
    profileBindings: [],
    elementProfileBindings: undefined as unknown,
    expressionFields: [],
    elementExpressionFields: undefined as unknown,
    templateFields: [],
    elementTemplateFields: undefined as unknown,
    outputSecretFields: [],
    elementOutputSecretFields: undefined as unknown,
    secretFields: [] as string[],
    elementSecretFields: undefined as unknown,
  }

  it('reads a changed element type of a Setter row or a typed setting as a change', () => {
    expect(
      computeHasChanges({
        ...baseChangesCtx,
        settingElementTypes: { 'variables.m': { n: 'integer' } },
        elementSettingElementTypes: { 'variables.m': { n: 'string' } },
      } as never),
    ).toBe(true)
    expect(
      computeHasChanges({
        ...baseChangesCtx,
        settingElementTypes: { driver_options: { n: 'integer' } },
      } as never),
    ).toBe(true)
    expect(
      computeHasChanges({
        ...baseChangesCtx,
        settingElementTypes: { driver_options: { n: 'integer' } },
        elementSettingElementTypes: { driver_options: { n: 'integer' } },
      } as never),
    ).toBe(false)
  })

  // A parallel that holds no lanes and no join mode yet opens unchanged.
  it('reports no change for a parallel whose lanes and join are absent', () => {
    const ctx = {
      ...baseChangesCtx,
      values: {},
      elementCurrentValues: {},
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(false)
  })

  it('reports a change when the join moved off the stored default', () => {
    const ctx = {
      ...baseChangesCtx,
      values: { join: 'first' },
      elementCurrentValues: {},
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(true)
  })

  it('reports a change when a lane limit or its {x} flag changed', () => {
    const lanes = [
      { id: 'branch_1', name: 'ingest', time_limit: 30000 },
      { id: 'branch_2', name: 'probe' },
    ]
    const stored = { ...baseChangesCtx, elementCurrentValues: { branches: lanes }, elementExpressionFields: [] }
    expect(
      computeHasChanges({
        ...stored,
        values: { branches: [{ ...lanes[0], time_limit: 500 }, lanes[1]] },
      } as unknown as Parameters<typeof computeHasChanges>[0]),
    ).toBe(true)
    expect(
      computeHasChanges({
        ...stored,
        values: { branches: lanes },
        expressionFields: ['branches.1.time_limit'],
      } as unknown as Parameters<typeof computeHasChanges>[0]),
    ).toBe(true)
    expect(
      computeHasChanges({ ...stored, values: { branches: lanes } } as unknown as Parameters<typeof computeHasChanges>[0]),
    ).toBe(false)
  })

  it('treats both names as empty when undefined (no change reported)', () => {
    const ctx = {
      ...baseChangesCtx,
      name: undefined as unknown as string,
      elementName: undefined as unknown as string,
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(false)
  })

  it('reports a change when only one side of name is undefined-vs-non-empty', () => {
    const ctx = {
      ...baseChangesCtx,
      name: 'Renamed',
      elementName: undefined as unknown as string,
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(true)
  })

  it('reports a change when description differs (covers description branch)', () => {
    const ctx = {
      ...baseChangesCtx,
      description: 'new',
      elementDescription: 'old',
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(true)
  })

  it('reports a change when a Setter row became a Template (covers the template-fields branch)', () => {
    const ctx = {
      ...baseChangesCtx,
      templateFields: ['variables.welcome'],
      elementTemplateFields: [],
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(true)
  })

  it('reports a change when outputSecretFields differ (covers the output-secret branch)', () => {
    const ctx = {
      ...baseChangesCtx,
      outputSecretFields: ['token_out'],
      elementOutputSecretFields: [],
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(true)
  })

  it('reports a change when a Setter row\'s secret mark differs (covers the secret-fields branch)', () => {
    const ctx = {
      ...baseChangesCtx,
      secretFields: ['variables.api_token'],
      elementSecretFields: [],
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(true)
  })

  it('reports no change when the Setter secret marks match the stored ones', () => {
    const ctx = {
      ...baseChangesCtx,
      secretFields: ['variables.api_token'],
      elementSecretFields: ['variables.api_token'],
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(false)
  })

  // REQ-3.1.3.16: revealing/hiding a block's credential field is an unsaved
  // change.
  it('reports a change when unmaskedSecretFields differ (covers the reveal-set branch)', () => {
    const ctx = {
      ...baseChangesCtx,
      unmaskedSecretFields: ['authorization'],
      elementUnmaskedSecretFields: [],
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(true)
  })

  // REQ-3.1.3.5: changing the per-block run-output tri-state is an unsaved
  // change.
  it('reports a change when secretMasking differs (covers the tri-state branch)', () => {
    const ctx = {
      ...baseChangesCtx,
      secretMasking: 'reveal',
      elementSecretMasking: 'system',
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(true)
  })

  // REQ-3.5.1.20: toggling Break on a case is an unsaved change, read from the
  // case list in values like every other field.
  it('reports a change when the switch branches differ from the saved config', () => {
    const ctx = {
      ...baseChangesCtx,
      values: { branches: [{ ...caseBranches[0], break: false }, caseBranches[1], caseBranches[2]] },
      elementCurrentValues: { branches: caseBranches },
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(true)
  })

  it('reports no change when the switch branches match the saved config', () => {
    const ctx = {
      ...baseChangesCtx,
      values: { branches: caseBranches },
      elementCurrentValues: { branches: caseBranches },
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(false)
  })

  it('reports a change when the element carries no saved branches yet', () => {
    const ctx = {
      ...baseChangesCtx,
      values: { branches: [caseBranches[0]] },
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(true)
  })

  it('reports no change when neither the window nor the element has branches', () => {
    const ctx = {
      ...baseChangesCtx,
      values: {},
      elementCurrentValues: {},
    } as unknown as Parameters<typeof computeHasChanges>[0]
    expect(computeHasChanges(ctx)).toBe(false)
  })

  describe('Wait Until dirty detection', () => {
    const WAIT_CONDITIONS = [{ id: 'c-1', type: 'expression' as const, expression: 'ready' }]

    const waitCtx = (values: Record<string, unknown>, elementCurrentValues: Record<string, unknown> = {}) =>
      ({
        ...baseChangesCtx,
        values,
        elementCurrentValues,
      }) as unknown as Parameters<typeof computeHasChanges>[0]

    it('reports a change when a condition is added', () => {
      expect(computeHasChanges(waitCtx({ conditions: WAIT_CONDITIONS }))).toBe(true)
    })

    it('reports a change when the wait mode is switched', () => {
      expect(computeHasChanges(waitCtx({ mode: 'watch' }))).toBe(true)
    })

    it('reports a change when fail current scope is ticked', () => {
      expect(computeHasChanges(waitCtx({ fail_current_scope: true }))).toBe(true)
    })

    it('reports no change when the window matches the saved node', () => {
      const saved = { conditions: WAIT_CONDITIONS, mode: 'watch', fail_current_scope: true }
      expect(computeHasChanges(waitCtx({ ...saved }, saved))).toBe(false)
    })

    it('opens a wait whose mode was never set unchanged', () => {
      // A node the author never touched must not open its sheet already dirty.
      expect(computeHasChanges(waitCtx({}))).toBe(false)
    })
  })
})

// A compare value its operator hides goes at Save, at every list place a Block holds (REQ-3.5.1.5).
describe('normalizeConditionLists', () => {
  const UNARY = {
    id: 'c-1',
    type: 'literal',
    variable: 'ready',
    value_type: 'boolean',
    operator: 'is_false',
    reference_value: null,
    reference_is_expression: false,
  }
  const UNARY_TEMPLATE = {
    id: 'c-2',
    type: 'literal',
    variable: 'body',
    value_type: 'string',
    operator: 'is_not_null',
    reference_value: 'Hello {{ name }}',
    reference_is_template: true,
  }
  const BINARY = {
    id: 'c-3',
    type: 'literal',
    variable: 'status',
    value_type: 'integer',
    operator: 'equals',
    reference_value: 'expected_status',
    reference_is_expression: true,
  }
  const NOT_SET = { id: 'c-4', type: 'literal', variable: 'region', value_type: 'string', operator: 'equals' }
  const EXPRESSION = { id: 'c-5', type: 'expression', expression: 'status == 200' }
  const AND = { type: 'operator', value: 'and' }

  /** The row with none of the three compare value keys. */
  function clean(row: Record<string, unknown>): Record<string, unknown> {
    const { reference_value: _value, reference_is_expression: _expression, reference_is_template: _template, ...rest } = row
    return rest
  }

  /** The Save step under test, read from its module inside each case; the Block type picks its condition lists. */
  async function normalize(elementType: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
    const saveLogic = (await import('@/features/workbench/common/element-config/save-logic')) as unknown as {
      normalizeConditionLists: (elementType: string, values: Record<string, unknown>) => Record<string, unknown>
    }
    return saveLogic.normalizeConditionLists(elementType, values)
  }

  it('drops the compare value and both flags under an operator that takes none', async () => {
    const rows = (await normalize('assert', { assertions: [UNARY, UNARY_TEMPLATE] })).assertions as Record<string, unknown>[]

    expect(rows).toEqual([clean(UNARY), clean(UNARY_TEMPLATE)])
    for (const row of rows) {
      expect(row).not.toHaveProperty('reference_value')
      expect(row).not.toHaveProperty('reference_is_expression')
      expect(row).not.toHaveProperty('reference_is_template')
    }
  })

  it('keeps a row whose operator takes a value as it is, an unset compare value included', async () => {
    const rows = (await normalize('while', { conditions: [BINARY, NOT_SET] })).conditions as Record<string, unknown>[]

    expect(rows).toEqual([BINARY, NOT_SET])
    expect(rows[1]).not.toHaveProperty('reference_value')
  })

  it('reaches rows inside groups at every depth', async () => {
    const values = {
      assertions: [{ id: 'g-1', type: 'group', items: [BINARY, AND, { id: 'g-2', type: 'group', items: [UNARY] }] }],
    }

    expect((await normalize('assert', values)).assertions).toEqual([
      { id: 'g-1', type: 'group', items: [BINARY, AND, { id: 'g-2', type: 'group', items: [clean(UNARY)] }] },
    ])
  })

  const FILTER = (rows: unknown[]) => ({
    filters: [{ id: 'b1', column: { mode: 'name', value: 'ok' }, asType: 'boolean', conditions: rows }],
  })
  const FILTER_ROWS = (v: Record<string, unknown>) => (v.filters as { conditions?: unknown[] }[])[0].conditions

  it.each([
    ['an Assert list', 'assert', (rows: unknown[]) => ({ assertions: rows }), (v: Record<string, unknown>) => v.assertions],
    ['a While list', 'while', (rows: unknown[]) => ({ conditions: rows }), (v: Record<string, unknown>) => v.conditions],
    ['a Wait Until list', 'wait-until', (rows: unknown[]) => ({ conditions: rows }), (v: Record<string, unknown>) => v.conditions],
    [
      'an If/Else branch',
      'if-else',
      (rows: unknown[]) => ({
        branches: [
          { id: 'branch_0', type: 'if', label: '', conditions: rows },
          { id: 'branch_1', type: 'else', label: '' },
        ],
      }),
      (v: Record<string, unknown>) => (v.branches as { conditions?: unknown[] }[])[0].conditions,
    ],
    [
      'a Switch case',
      'switch-case',
      (rows: unknown[]) => ({
        branches: [
          { id: 'branch_0', type: 'case', label: 'Fast', conditions: rows, break: true },
          { id: 'branch_1', type: 'default', label: '' },
        ],
      }),
      (v: Record<string, unknown>) => (v.branches as { conditions?: unknown[] }[])[0].conditions,
    ],
    ['a CSV filter', 'csv-parser', FILTER, FILTER_ROWS],
    ['an Excel filter', 'excel-parser', FILTER, FILTER_ROWS],
  ])('cleans the rows of %s', async (_place, elementType, build, read) => {
    expect(read(await normalize(elementType, build([UNARY, AND, BINARY])))).toEqual([clean(UNARY), AND, BINARY])
  })

  it.each<[string, Record<string, unknown>]>([
    ['wait-until', { conditions: [EXPRESSION, AND, BINARY], timeout: 30000, message: 'gave up' }],
    [
      'switch-case',
      {
        branches: [
          { id: 'branch_0', type: 'case', label: '', conditions: [EXPRESSION], break: false },
          { id: 'branch_1', type: 'default', label: '' },
        ],
      },
    ],
  ])('leaves expression rows, the default branch and every other value of a %s alone', async (elementType, values) => {
    expect(await normalize(elementType, values)).toEqual(values)
  })

  it('leaves a stored group whose items are not a list as it is, cleaning the rows beside it', async () => {
    const values = { assertions: [UNARY, AND, { id: 'g-1', type: 'group', items: 'ready' }, AND, { id: 'g-2', type: 'group' }] }

    expect((await normalize('assert', values)).assertions).toEqual([
      clean(UNARY),
      AND,
      { id: 'g-1', type: 'group', items: 'ready' },
      AND,
      { id: 'g-2', type: 'group' },
    ])
  })

  it('leaves the values it is given as they were', async () => {
    const values = { assertions: [UNARY, BINARY] }

    await normalize('assert', values)

    expect(values.assertions[0]).toEqual(UNARY)
  })
})
