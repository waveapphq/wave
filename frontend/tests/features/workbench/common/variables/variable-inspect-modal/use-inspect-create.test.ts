/**
 * Tests for useInspectCreate, the state machine of the one variable window (Add and Edit).
 *
 * REQ-3.1.3.11: Variable Manager UI panel
 * REQ-3.1.3.20: Null is the only empty value
 * REQ-3.1.3.24: Set to null by hand
 * REQ-3.1.2.1: Create custom Functions with input parameters
 * REQ-3.1.2.4: Function validation before save
 * REQ-3.1.2.10: Inputs with no default
 * REQ-3.1.2.11: Enum inputs
 * REQ-3.1.3.13: Computed variables with expressions
 * REQ-3.1.3.15: Template variables
 * REQ-3.1.3.19: Declared element types for array and map values
 * REQ-3.2.1.6: Runtime variable override during pause
 */

import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react'

const { mockGetSessionVariables, mockSetVariableOverride } = vi.hoisted(() => ({
  mockGetSessionVariables: vi.fn(),
  mockSetVariableOverride: vi.fn(),
}))

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    getSessionVariables: mockGetSessionVariables,
    setVariableOverride: mockSetVariableOverride,
  },
}))

vi.mock('@/components/shared/variable-bodies/string-edit-body', () => ({
  StringEditBody: () => null,
}))

import {
  buildCurrentEditBody,
  useInspectCreate,
  type UseInspectCreateArgs,
  type VariableCreateMode,
  type VariableCreateSpec,
} from '@/features/workbench/common/variables/variable-inspect-modal/use-inspect-create'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import { ScalarEditBody } from '@/components/shared/variable-bodies/scalar-edit-body'
import { formatValue } from '@/lib/variable-format'
import type { ElementTypes } from '@/lib/variable-validation'

type DefinitionSink = (spec: VariableCreateSpec) => { success: boolean; error?: string }
type CurrentSink = (name: string, body: unknown, functionPath?: string[] | null) => void | Promise<void>

/** A Variable Manager row as the window receives it (inputs carry their declaration fields). */
type WindowRow = Variable & { required?: boolean; description?: string; enumValues?: unknown[] }

/** What the Current view shows when the window opens: live, else staged, else nothing. */
interface CurrentSeed {
  value: unknown
  hasValue: boolean
  elementTypes?: ElementTypes
  source?: unknown
}

interface SetupOverrides {
  mode?: VariableCreateMode
  checkNameExists?: (name: string, excludeId: string) => boolean
  validateExpressionCycle?: UseInspectCreateArgs['validateExpressionCycle']
}

const STORED_TABLE = {
  columns: [
    { name: 'n', type: 'integer' },
    { name: 'zip', type: 'string' },
  ],
  rows: [
    ['16', '02134'],
    ['17', '02135'],
  ],
}

function setup(overrides: SetupOverrides = {}) {
  const checkNameExists = vi.fn(overrides.checkNameExists ?? (() => false))
  const validateExpressionCycle = vi.fn(
    overrides.validateExpressionCycle ?? (() => null),
  )
  const onSaveDefinition = vi.fn<DefinitionSink>(() => ({ success: true }))
  const onSaveCurrent = vi.fn<CurrentSink>()
  const onSaved = vi.fn()
  const { result } = renderHook(() =>
    useInspectCreate({
      mode: overrides.mode ?? 'variable',
      runLocked: false,
      checkNameExists,
      validateExpressionCycle,
      onSaveDefinition,
      onSaveCurrent,
      onSaved,
    }),
  )
  return { result, checkNameExists, validateExpressionCycle }
}

interface EditSetup {
  mode?: VariableCreateMode
  row?: Partial<WindowRow>
  scope?: string[] | null
  current?: CurrentSeed
  secretUnlocked?: boolean
  definitionReadOnly?: boolean
  sessionId?: string | null
  runLocked?: boolean
  checkNameExists?: (name: string, excludeId: string) => boolean
  validateExpressionCycle?: UseInspectCreateArgs['validateExpressionCycle']
  onSaveDefinition?: DefinitionSink
  onSaveCurrent?: CurrentSink
}

/** Opens the window in Edit on one row; the edit target keeps one identity across renders. */
function setupEdit(overrides: EditSetup = {}) {
  const row: WindowRow = { id: 'v1', name: 'count', type: 'integer', value: 5, ...overrides.row }
  const editTarget = {
    row,
    scope: overrides.scope ?? null,
    current: overrides.current,
    secretUnlocked: overrides.secretUnlocked ?? false,
    definitionReadOnly: overrides.definitionReadOnly ?? false,
  }
  const checkNameExists = vi.fn(overrides.checkNameExists ?? (() => false))
  const validateExpressionCycle = vi.fn(overrides.validateExpressionCycle ?? (() => null))
  const onSaveDefinition = vi.fn<DefinitionSink>(overrides.onSaveDefinition ?? (() => ({ success: true })))
  const onSaveCurrent = vi.fn<CurrentSink>(overrides.onSaveCurrent ?? (() => undefined))
  const onSaved = vi.fn()
  const hook = renderHook(
    ({ runLocked }: { runLocked: boolean }) =>
      useInspectCreate({
        mode: overrides.mode ?? 'variable',
        editTarget,
        sessionId: overrides.sessionId ?? null,
        runLocked,
        checkNameExists,
        validateExpressionCycle,
        onSaveDefinition,
        onSaveCurrent,
        onSaved,
      }),
    { initialProps: { runLocked: overrides.runLocked ?? false } },
  )
  return { ...hook, row, onSaveDefinition, onSaveCurrent, onSaved, checkNameExists, validateExpressionCycle }
}

function inputRow(overrides: Partial<WindowRow> = {}): Partial<WindowRow> {
  return {
    id: 'param:input:region',
    name: 'region',
    type: 'string',
    value: 'eu',
    required: false,
    description: '',
    ...overrides,
  }
}

const ENV_ROW: Partial<WindowRow> = {
  id: 'param:input:env',
  name: 'env',
  type: 'string',
  value: 'dev',
  required: true,
  description: '',
  enumValues: ['dev', 'staging', 'prod'],
}

async function saveWindow(result: { current: { trySave: () => Promise<unknown> } }) {
  await act(async () => {
    await result.current.trySave()
  })
}

/** The one definition write of a Save. */
function savedSpec(onSaveDefinition: Mock<DefinitionSink>): VariableCreateSpec {
  expect(onSaveDefinition).toHaveBeenCalledTimes(1)
  return onSaveDefinition.mock.calls[0][0]
}

/** The one Current write of a Save; an absent or empty path is the Test scope. */
function currentWrite(onSaveCurrent: Mock<CurrentSink>) {
  expect(onSaveCurrent).toHaveBeenCalledTimes(1)
  const [name, body, path] = onSaveCurrent.mock.calls[0]
  return { name, body, scope: path == null || path.length === 0 ? null : path }
}

const TYPE_DEFAULTS = [
  ['string', ''],
  ['integer', 0],
  ['float', 0],
  ['boolean', false],
  ['array', []],
  ['map', {}],
  ['table', []],
] as const

beforeEach(() => {
  mockGetSessionVariables.mockReset()
  mockSetVariableOverride.mockReset()
})

describe('useInspectCreate - initial draft', () => {
  it('starts with an empty, literal, string draft', () => {
    const { result } = setup()
    expect(result.current.draftName).toBe('')
    expect(result.current.draftType).toBe('string')
    expect(result.current.draftKind).toBe('literal')
    expect(result.current.draftSecret).toBe(false)
  })

  it('is invalid until a name is entered (Create disabled on open)', () => {
    const { result } = setup()
    expect(result.current.isValid).toBe(false)
  })

  it.each(['variable', 'input', 'output'] as const)(
    'shows "Name is required" as soon as the %s Add window opens (FIELD-12)',
    (mode) => {
      const { result } = setup({ mode })
      expect(result.current.errors.name).toBe('Name is required')
      expect(result.current.saveDisabledReason).toBe('Name is required')
    },
  )

  it('defaults param metadata to optional / non-enum / no allowed values / empty description', () => {
    const { result } = setup({ mode: 'input' })
    expect(result.current.paramMeta).toEqual({
      required: false,
      createEnum: false,
      enumValues: [],
      description: '',
    })
  })

  it('opens Add on the Initial value with nothing being written', () => {
    const { result } = setup()
    expect(result.current.valueView).toBe('initial')
    expect(result.current.saving).toBe(false)
  })

  it('keeps Create disabled while the name is empty', () => {
    const { result } = setup()
    expect(result.current.saveDisabledReason).not.toBeNull()
    act(() => result.current.setDraftName('count'))
    expect(result.current.saveDisabledReason).toBeNull()
  })
})

describe('useInspectCreate - name validation', () => {
  it('becomes valid once a legal name is typed', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('count'))
    expect(result.current.errors.name).toBeNull()
    expect(result.current.isValid).toBe(true)
  })

  it('flags an empty name with the shared "Name is required" message', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('count'))
    act(() => result.current.setDraftName('   '))
    expect(result.current.errors.name).toBe('Name is required')
    expect(result.current.isValid).toBe(false)
  })

  it('flags a Python keyword name', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('class'))
    expect(result.current.errors.name).toBe('"class" is a Python keyword')
    expect(result.current.isValid).toBe(false)
  })

  it('flags an illegal identifier', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('1bad'))
    expect(result.current.errors.name).toBe(
      'Variable name must start with letter/underscore, contain only letters, numbers, underscores',
    )
    expect(result.current.isValid).toBe(false)
  })

  it('flags a duplicate name via checkNameExists and blocks validity', () => {
    const { result } = setup({ checkNameExists: () => true })
    act(() => result.current.setDraftName('taken'))
    expect(result.current.errors.name).toBe('A variable with this name already exists')
    expect(result.current.isValid).toBe(false)
  })

  it.each(['input', 'output'] as const)('a new %s refuses a name that starts with an underscore', (mode) => {
    const { result } = setup({ mode })
    act(() => result.current.setDraftName('_id'))
    expect(result.current.errors.name).toBe(
      'Parameter name must start with a letter, contain only letters, numbers, underscores',
    )
    expect(result.current.isValid).toBe(false)
  })

  it('a new variable may start with an underscore', () => {
    const { result } = setup({ mode: 'variable' })
    act(() => result.current.setDraftName('_id'))
    expect(result.current.errors.name).toBeNull()
    expect(result.current.isValid).toBe(true)
  })
})

describe('useInspectCreate - value-body validity gate', () => {
  it('blocks validity when the value body reports invalid', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('count'))
    act(() => result.current.setBodyValid(false))
    expect(result.current.isValid).toBe(false)
  })

  it('restores validity when the value body becomes valid again', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('count'))
    act(() => result.current.setBodyValid(false))
    act(() => result.current.setBodyValid(true))
    expect(result.current.isValid).toBe(true)
  })
})

describe('useInspectCreate - destructive type-switch gate', () => {
  function complexDraft() {
    const api = setup()
    act(() => {
      api.result.current.setDraftName('data')
      api.result.current.setDraftType('array')
    })
    act(() => api.result.current.setDraftValue(['a', 'b', 'c']))
    return api
  }

  it('gates a complex-source switch with a non-empty value instead of mutating type', () => {
    const { result } = complexDraft()
    act(() => result.current.setDraftType('map'))
    expect(result.current.draftType).toBe('array')
    expect(result.current.pendingTypeChange).toEqual({
      prevType: 'array',
      nextType: 'map',
      currentLength: 3,
    })
  })

  it('confirmTypeChange applies the pending type and resets the value to the new default', () => {
    const { result } = complexDraft()
    act(() => result.current.setDraftType('map'))
    act(() => result.current.confirmTypeChange())
    expect(result.current.draftType).toBe('map')
    expect(result.current.draftValue).toEqual({})
    expect(result.current.pendingTypeChange).toBeNull()
  })

  it('cancelTypeChange keeps the prior type and value', () => {
    const { result } = complexDraft()
    act(() => result.current.setDraftType('map'))
    act(() => result.current.cancelTypeChange())
    expect(result.current.draftType).toBe('array')
    expect(result.current.draftValue).toEqual(['a', 'b', 'c'])
    expect(result.current.pendingTypeChange).toBeNull()
  })

  it('does not gate an empty complex source - the switch applies immediately', () => {
    const { result } = setup()
    act(() => {
      result.current.setDraftName('data')
      result.current.setDraftType('array')
    })
    act(() => result.current.setDraftType('map'))
    expect(result.current.pendingTypeChange).toBeNull()
    expect(result.current.draftType).toBe('map')
  })

  it('counts a map keyset when gating a switch away from a non-empty map', () => {
    const api = setup()
    act(() => {
      api.result.current.setDraftName('data')
      api.result.current.setDraftType('map')
    })
    act(() => api.result.current.setDraftValue({ a: 1, b: 2 }))
    act(() => api.result.current.setDraftType('array'))
    expect(api.result.current.pendingTypeChange).toEqual({
      prevType: 'map',
      nextType: 'array',
      currentLength: 2,
    })
  })

  it('treats a non-object map value as empty, applying the switch without a gate', () => {
    const api = setup()
    act(() => {
      api.result.current.setDraftName('data')
      api.result.current.setDraftType('map')
    })
    act(() => api.result.current.setDraftValue(null)) // not a valid map object -> length 0
    act(() => api.result.current.setDraftType('array'))
    expect(api.result.current.pendingTypeChange).toBeNull()
    expect(api.result.current.draftType).toBe('array')
  })

  it('counts the rows of a table stored with its column types when gating a switch', () => {
    const api = setup()
    act(() => {
      api.result.current.setDraftName('data')
      api.result.current.setDraftType('table')
    })
    act(() => api.result.current.setDraftValue(STORED_TABLE))
    act(() => api.result.current.setDraftType('array'))
    expect(api.result.current.draftType).toBe('table')
    expect(api.result.current.pendingTypeChange).toEqual({
      prevType: 'table',
      nextType: 'array',
      currentLength: 2,
    })
  })

  it('counts the rows of a table of row objects when gating a switch', () => {
    const api = setup()
    act(() => {
      api.result.current.setDraftName('data')
      api.result.current.setDraftType('table')
    })
    act(() => api.result.current.setDraftValue([{ n: 1 }]))
    act(() => api.result.current.setDraftType('array'))
    expect(api.result.current.pendingTypeChange).toEqual({
      prevType: 'table',
      nextType: 'array',
      currentLength: 1,
    })
  })

  it('treats a null table value as empty when gating a switch', () => {
    const api = setup()
    act(() => {
      api.result.current.setDraftName('data')
      api.result.current.setDraftType('table')
    })
    act(() => api.result.current.setDraftValue(null)) // null holds no entries
    act(() => api.result.current.setDraftType('array'))
    expect(api.result.current.pendingTypeChange).toBeNull()
  })

  it('confirmTypeChange is a no-op when there is no pending change', () => {
    const { result } = setup()
    act(() => result.current.confirmTypeChange())
    expect(result.current.pendingTypeChange).toBeNull()
    expect(result.current.draftType).toBe('string')
  })

  it('a boolean draft starts as false (the type default)', () => {
    const { result } = setup()
    act(() => result.current.setDraftType('boolean'))
    expect(result.current.draftValue).toBe(false)
  })
})

describe('useInspectCreate - secret flag in the built spec', () => {
  it('marks a variable-mode spec secret when the draft is secret', () => {
    const { result } = setup({ mode: 'variable' })
    act(() => {
      result.current.setDraftName('token')
      result.current.setDraftSecret(true)
    })
    expect(result.current.buildSpec().secret).toBe(true)
  })

  it('marks an input-param spec secret when the draft is secret', () => {
    const { result } = setup({ mode: 'input' })
    act(() => {
      result.current.setDraftName('token')
      result.current.setDraftSecret(true)
    })
    expect(result.current.buildSpec().secret).toBe(true)
  })

  it('marks an output-param spec secret when the draft is secret', () => {
    const { result } = setup({ mode: 'output' })
    act(() => {
      result.current.setDraftName('token')
      result.current.setDraftSecret(true)
    })
    expect(result.current.buildSpec().secret).toBe(true)
  })

  it('does not gate scalar -> scalar switches (lossless, no prompt)', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('x'))
    act(() => result.current.setDraftType('integer'))
    expect(result.current.pendingTypeChange).toBeNull()
    expect(result.current.draftType).toBe('integer')
  })

  it('switches scalar -> complex without gating and seeds the complex default', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('x'))
    act(() => result.current.setDraftType('map'))
    expect(result.current.pendingTypeChange).toBeNull()
    expect(result.current.draftType).toBe('map')
    expect(result.current.draftValue).toEqual({})
  })
})

describe('useInspectCreate - expression-cycle gate', () => {
  it('sets the cycle error on expression blur and blocks validity', () => {
    const cycle = "Circular reference detected for variable 'a': a -> a"
    const { result, validateExpressionCycle } = setup({
      validateExpressionCycle: () => cycle,
    })
    act(() => {
      result.current.setDraftName('a')
      result.current.setDraftKind('expression')
    })
    act(() => result.current.setDraftValue('a + 1'))
    act(() => result.current.handleExpressionBlur())
    expect(validateExpressionCycle).toHaveBeenCalledWith({
      variableName: 'a',
      value: 'a + 1',
      isExpression: true,
    })
    expect(result.current.errors.cycle).toBe(cycle)
    expect(result.current.isValid).toBe(false)
  })

  it('does not run the cycle check for a literal kind', () => {
    const { result, validateExpressionCycle } = setup()
    act(() => result.current.setDraftName('a'))
    act(() => result.current.handleExpressionBlur())
    expect(validateExpressionCycle).not.toHaveBeenCalled()
    expect(result.current.errors.cycle).toBeNull()
  })

  it('clears the cycle error when the expression source is edited', () => {
    const { result } = setup({
      validateExpressionCycle: () => "Circular reference detected for variable 'a': a -> a",
    })
    act(() => {
      result.current.setDraftName('a')
      result.current.setDraftKind('expression')
    })
    act(() => result.current.handleExpressionBlur())
    expect(result.current.errors.cycle).not.toBeNull()
    act(() => result.current.setDraftValue('1 + 1'))
    expect(result.current.errors.cycle).toBeNull()
  })
})

describe('useInspectCreate - buildSpec for variable mode', () => {
  it('emits a literal string spec', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('greeting'))
    act(() => result.current.setDraftValue('hello'))
    expect(result.current.buildSpec()).toEqual({
      name: 'greeting',
      type: 'string',
      value: 'hello',
    })
  })

  it('emits an expression spec carrying isExpression', () => {
    const { result } = setup()
    act(() => {
      result.current.setDraftName('url')
      result.current.setDraftKind('expression')
    })
    act(() => result.current.setDraftValue("'http://' + host"))
    expect(result.current.buildSpec()).toEqual({
      name: 'url',
      type: 'string',
      value: "'http://' + host",
      isExpression: true,
    })
  })

  it('emits a template spec carrying isTemplate (string only)', () => {
    const { result } = setup()
    act(() => {
      result.current.setDraftName('msg')
      result.current.setDraftKind('template')
    })
    act(() => result.current.setDraftValue('Hi {{ name }}'))
    expect(result.current.buildSpec()).toEqual({
      name: 'msg',
      type: 'string',
      value: 'Hi {{ name }}',
      isTemplate: true,
    })
  })

  it('carries the secret flag only when marked', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('token'))
    act(() => result.current.setDraftValue('abc'))
    act(() => result.current.setDraftSecret(true))
    expect(result.current.buildSpec()).toEqual(
      expect.objectContaining({ name: 'token', secret: true }),
    )
  })

  it('creates an untouched string with the empty-text default', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('k8s_session'))
    expect(result.current.buildSpec()).toEqual({ name: 'k8s_session', type: 'string', value: '' })
  })

  it('includes the value after a single edit of the value body', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('greeting'))
    act(() => result.current.setDraftValue('hi'))
    expect('value' in result.current.buildSpec()).toBe(true)
  })

  it('an untouched draft creates with the type default for every type', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('blank'))
    const presets = [
      ['integer', 0],
      ['float', 0],
      ['array', []],
      ['map', {}],
      ['table', []],
    ] as const
    for (const [type, preset] of presets) {
      act(() => result.current.setDraftType(type))
      expect(result.current.buildSpec()).toEqual({ name: 'blank', type, value: preset })
    }
  })

  it('a type switch discards the edited value and presets the new type default', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('blank'))
    act(() => result.current.setDraftValue('typed'))
    act(() => result.current.setDraftType('integer'))
    expect(result.current.buildSpec()).toEqual({ name: 'blank', type: 'integer', value: 0 })
  })

  it('an untouched secret spec carries the flag and the type default', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('k8s_session'))
    act(() => result.current.setDraftSecret(true))
    expect(result.current.buildSpec()).toEqual({
      name: 'k8s_session',
      type: 'string',
      value: '',
      secret: true,
    })
  })

  it('emits an integer literal spec with the typed value', () => {
    const { result } = setup()
    act(() => {
      result.current.setDraftName('count')
      result.current.setDraftType('integer')
    })
    act(() => result.current.setDraftValue('42'))
    expect(result.current.buildSpec()).toEqual({
      name: 'count',
      type: 'integer',
      value: '42',
    })
  })

  it('creates a list with the element types the value field hands it (REQ-3.1.3.19)', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('items'))
    act(() => result.current.setDraftType('array'))
    act(() => result.current.setDraftValue(['02134', '7'], ['string', 'integer']))
    expect(result.current.buildSpec()).toEqual(
      expect.objectContaining({ name: 'items', type: 'array', value: ['02134', '7'], elementTypes: ['string', 'integer'] }),
    )
  })
})

describe('useInspectCreate - an untouched boolean draft', () => {
  function booleanDraft(mode: 'variable' | 'input' = 'variable') {
    const api = setup({ mode })
    act(() => api.result.current.setDraftName('enabled'))
    act(() => api.result.current.setDraftType('boolean'))
    return api
  }

  it('saves the option the true/false control shows without a click', () => {
    const { result } = booleanDraft()
    expect(result.current.draftValue).toBe(false)
    expect(result.current.buildSpec()).toEqual({
      name: 'enabled',
      type: 'boolean',
      value: false,
    })
  })

  it('lists the shown value instead of "not set"', () => {
    const { result } = booleanDraft()
    const spec = result.current.buildSpec()
    expect(spec.value).not.toBeUndefined()
    expect(formatValue(spec.value, 'boolean')).toBe('false')
    expect(formatValue(spec.value, 'boolean')).not.toBe('not set')
  })

  it('saves a picked true over the shown default', () => {
    const { result } = booleanDraft()
    act(() => result.current.setDraftValue(true))
    expect(result.current.buildSpec().value).toBe(true)
  })

  it('saves the shown option for a boolean parameter default too', () => {
    const { result } = booleanDraft('input')
    expect(result.current.buildSpec()).toEqual(
      expect.objectContaining({ type: 'boolean', value: false }),
    )
  })

  it('leaves a boolean expression source unset until it is written', () => {
    const { result } = booleanDraft()
    act(() => result.current.setDraftKind('expression'))
    const spec = result.current.buildSpec()
    expect('value' in spec).toBe(false)
    expect(spec.isExpression).toBe(true)
  })

  it('presets the new type default when the type moves off boolean', () => {
    const { result } = booleanDraft()
    act(() => result.current.setDraftType('string'))
    expect(result.current.buildSpec()).toEqual({ name: 'enabled', type: 'string', value: '' })
    act(() => result.current.setDraftType('integer'))
    expect(result.current.buildSpec()).toEqual({ name: 'enabled', type: 'integer', value: 0 })
  })
})

describe('useInspectCreate - buildSpec for input mode', () => {
  it('emits a literal default with required=false and an empty description by default', () => {
    const { result } = setup({ mode: 'input' })
    act(() => result.current.setDraftName('recipient'))
    act(() => result.current.setDraftValue('world'))
    expect(result.current.buildSpec()).toEqual({
      name: 'recipient',
      type: 'string',
      value: 'world',
      required: false,
      description: '',
    })
  })

  it('carries required and description when set', () => {
    const { result } = setup({ mode: 'input' })
    act(() => {
      result.current.setDraftName('recipient')
      result.current.setRequired(true)
      result.current.setDescription('Who receives it')
    })
    expect(result.current.buildSpec()).toEqual(
      expect.objectContaining({ required: true, description: 'Who receives it' }),
    )
  })

  it('locks Required on and carries the allowed values for an input with Create enum', () => {
    const { result } = setup({ mode: 'input' })
    act(() => {
      result.current.setDraftName('choices')
      result.current.setDraftType('integer')
    })
    act(() => result.current.setCreateEnum(true))
    act(() => result.current.setEnumValues([1, 2]))
    act(() => result.current.setRequired(false))
    const spec = result.current.buildSpec()
    expect(spec).toEqual(
      expect.objectContaining({ type: 'integer', required: true, enumValues: [1, 2] }),
    )
    expect(spec).not.toHaveProperty('enumValueType')
    expect(spec).not.toHaveProperty('createEnum')
  })

  it('does not emit isExpression/isTemplate for a parameter (literal-only)', () => {
    const { result } = setup({ mode: 'input' })
    act(() => result.current.setDraftName('p'))
    const spec = result.current.buildSpec()
    expect(spec).not.toHaveProperty('isExpression')
    expect(spec).not.toHaveProperty('isTemplate')
  })
})

describe('useInspectCreate - buildSpec for output mode', () => {
  it('emits a literal default with a description and no required flag', () => {
    const { result } = setup({ mode: 'output' })
    act(() => {
      result.current.setDraftName('result')
      result.current.setDescription('What it returns')
    })
    act(() => result.current.setDraftValue('done'))
    expect(result.current.buildSpec()).toEqual({
      name: 'result',
      type: 'string',
      value: 'done',
      description: 'What it returns',
    })
  })

  it('never carries createEnum for an output parameter', () => {
    const { result } = setup({ mode: 'output' })
    act(() => {
      result.current.setDraftName('result')
      result.current.setDraftType('array')
    })
    expect(result.current.buildSpec()).not.toHaveProperty('createEnum')
  })
})

describe('useInspectCreate - type-default preset (VMGR-95)', () => {
  const PRESETS = [
    ['string', ''],
    ['integer', 0],
    ['float', 0],
    ['boolean', false],
    ['array', []],
    ['map', {}],
    ['table', []],
  ] as const

  it.each(PRESETS)('starts the %s draft on its type default', (type, preset) => {
    const { result } = setup()
    act(() => result.current.setDraftType(type))
    expect(result.current.draftValue).toEqual(preset)
  })

  it.each(PRESETS)(
    'creates an untouched %s test variable or Function local with its type default',
    (type, preset) => {
      const { result } = setup({ mode: 'variable' })
      act(() => result.current.setDraftName('fresh'))
      act(() => result.current.setDraftType(type))
      expect(result.current.buildSpec()).toEqual({ name: 'fresh', type, value: preset })
    },
  )

  const PARAM_CASES = (['input', 'output'] as const).flatMap((mode) =>
    PRESETS.map(([type, preset]) => [type, mode, preset] as const),
  )

  it.each(PARAM_CASES)('creates an untouched %s %s parameter with its type default', (type, mode, preset) => {
    const { result } = setup({ mode })
    act(() => result.current.setDraftName('fresh'))
    act(() => result.current.setDraftType(type))
    const spec = result.current.buildSpec()
    expect('value' in spec).toBe(true)
    expect(spec).toEqual(expect.objectContaining({ name: 'fresh', type, value: preset }))
  })
})

describe('useInspectCreate - an emptied number box (VMGR-95)', () => {
  it.each(['integer', 'float'] as const)('keeps Create disabled when the %s box is emptied', (type) => {
    const { result } = setup()
    act(() => result.current.setDraftName('count'))
    act(() => result.current.setDraftType(type))
    render(
      createElement(ScalarEditBody, {
        value: result.current.draftValue,
        type,
        onChange: (value: unknown) => result.current.setDraftValue(value),
        onValidChange: (valid: boolean) => result.current.setBodyValid(valid),
      }),
    )
    const input = screen.getByTestId('scalar-edit-input')
    fireEvent.change(input, { target: { value: '7' } })
    expect(result.current.isValid).toBe(true)
    fireEvent.change(input, { target: { value: '' } })
    expect(result.current.bodyValid).toBe(false)
    expect(result.current.isValid).toBe(false)
  })
})

// The four creation windows: the test variable and the Function local share the variable mode.
const CREATE_WINDOWS = [
  ['test variable', 'variable'],
  ['Function local', 'variable'],
  ['input', 'input'],
  ['output', 'output'],
] as const

const ALL_TYPES = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as const

/** The exact spec each mode emits for an untouched name with Set to null ticked. */
function nullSpecFor(mode: 'variable' | 'input' | 'output', name: string, type: string) {
  if (mode === 'input') return { name, type, value: null, required: false, description: '' }
  if (mode === 'output') return { name, type, value: null, description: '' }
  return { name, type, value: null }
}

describe('useInspectCreate - Set to null (VMGR-97, REQ-3.1.3.24)', () => {
  it.each(CREATE_WINDOWS)('starts the %s window unticked with nothing forced or locked', (_window, mode) => {
    const { result } = setup({ mode })
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullForced).toBeNull()
    expect(result.current.nullDisabledByEnum).toBe(false)
    expect(result.current.enumLocksSecret).toBe(false)
    expect(result.current.secretLocksEnum).toBe(false)
  })

  // A true / false input's default never holds null; its lock has its own describe.
  const NULL_MATRIX = CREATE_WINDOWS.flatMap(([window, mode]) =>
    ALL_TYPES.filter((type) => mode !== 'input' || type !== 'boolean').map((type) => [window, type, mode] as const),
  )

  it.each(NULL_MATRIX)('%s window: a ticked %s creates a plain null with no kind flags', (_window, type, mode) => {
    const { result } = setup({ mode })
    act(() => result.current.setDraftName('nothing_yet'))
    act(() => result.current.setDraftType(type))
    act(() => result.current.setDraftNull(true))
    const spec = result.current.buildSpec()
    expect(spec).toEqual(nullSpecFor(mode, 'nothing_yet', type))
    expect(spec).not.toHaveProperty('isExpression')
    expect(spec).not.toHaveProperty('isTemplate')
  })

  it.each([
    ['test variable', 'expression', 'variable', 'a + 1'],
    ['test variable', 'template', 'variable', 'Hi {{ name }}'],
    ['Function local', 'expression', 'variable', 'a + 1'],
    ['output', 'expression', 'output', 'a + 1'],
    ['output', 'template', 'output', 'Hi {{ name }}'],
  ] as const)('%s window: Set to null wins over Kind %s and creates a plain null', (_window, kind, mode, source) => {
    const { result } = setup({ mode })
    act(() => result.current.setDraftName('msg'))
    act(() => result.current.setDraftKind(kind))
    act(() => result.current.setDraftValue(source))
    act(() => result.current.setDraftNull(true))
    expect(result.current.buildSpec()).toEqual(nullSpecFor(mode, 'msg', 'string'))
  })

  it.each([
    ['test variable', 'variable'],
    ['Function local', 'variable'],
    ['output', 'output'],
  ] as const)('%s window: unticking brings back the Kind and the source held before the tick', (_window, mode) => {
    const { result } = setup({ mode })
    act(() => result.current.setDraftName('msg'))
    act(() => result.current.setDraftKind('template'))
    act(() => result.current.setDraftValue('Hi {{ name }}'))
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(true)
    act(() => result.current.setDraftNull(false))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.draftKind).toBe('template')
    expect(result.current.draftValue).toBe('Hi {{ name }}')
    expect(result.current.buildSpec()).toEqual(
      expect.objectContaining({ name: 'msg', value: 'Hi {{ name }}', isTemplate: true }),
    )
  })

  it.each(CREATE_WINDOWS)('%s window: unticking brings back the value held before the tick', (_window, mode) => {
    const { result } = setup({ mode })
    act(() => result.current.setDraftName('count'))
    act(() => result.current.setDraftType('integer'))
    act(() => result.current.setDraftValue('42'))
    act(() => result.current.setDraftNull(true))
    act(() => result.current.setDraftNull(false))
    expect(result.current.draftValue).toBe('42')
    expect(result.current.buildSpec()).toEqual(expect.objectContaining({ type: 'integer', value: '42' }))
  })

  it.each(CREATE_WINDOWS)('%s window: a type switch while ticked keeps the null', (_window, mode) => {
    const { result } = setup({ mode })
    act(() => result.current.setDraftName('count'))
    act(() => result.current.setDraftNull(true))
    act(() => result.current.setDraftType('integer'))
    expect(result.current.draftNull).toBe(true)
    expect(result.current.draftType).toBe('integer')
    expect(result.current.buildSpec()).toEqual(nullSpecFor(mode, 'count', 'integer'))
  })

  it.each(CREATE_WINDOWS)('%s window: ticked makes the draft valid although the value body was invalid', (_window, mode) => {
    const { result } = setup({ mode })
    act(() => result.current.setDraftName('count'))
    act(() => result.current.setDraftType('integer'))
    act(() => result.current.setBodyValid(false))
    expect(result.current.isValid).toBe(false)
    act(() => result.current.setDraftNull(true))
    expect(result.current.isValid).toBe(true)
  })
})

describe('useInspectCreate - an emptied number box ticks Set to null on blur (VMGR-97)', () => {
  it.each(['integer', 'float'] as const)('keeps an emptied %s box invalid until it loses focus, then ticks Set to null', (type) => {
    const { result } = setup()
    act(() => result.current.setDraftName('count'))
    act(() => result.current.setDraftType(type))
    render(
      createElement(ScalarEditBody, {
        value: result.current.draftValue,
        type,
        onChange: (value: unknown) => result.current.setDraftValue(value),
        onValidChange: (valid: boolean) => result.current.setBodyValid(valid),
        onEmptyBlur: () => result.current.setDraftNull(true),
      }),
    )
    const input = screen.getByTestId('scalar-edit-input')
    fireEvent.change(input, { target: { value: '' } })
    expect(result.current.draftNull).toBe(false)
    expect(result.current.isValid).toBe(false)
    fireEvent.blur(input)
    expect(result.current.draftNull).toBe(true)
    expect(result.current.isValid).toBe(true)
    expect(result.current.buildSpec()).toEqual({ name: 'count', type, value: null })
  })
})

describe('useInspectCreate - input default rules (VMGR-103, VMGR-113, REQ-3.1.2.10)', () => {
  function inputDraft() {
    const api = setup({ mode: 'input' })
    act(() => api.result.current.setDraftName('recipient'))
    act(() => api.result.current.setDraftValue('world'))
    return api
  }

  it('a Required input keeps its default and locks Set to null off', () => {
    const { result } = inputDraft()
    act(() => result.current.setRequired(true))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullForced).toBeNull()
    expect(result.current.isValid).toBe(true)
    expect(result.current.buildSpec()).toEqual({
      name: 'recipient',
      type: 'string',
      value: 'world',
      required: true,
      description: '',
    })
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(false)
  })

  it('unticking Required gives back the default held before', () => {
    const { result } = inputDraft()
    act(() => result.current.setRequired(true))
    act(() => result.current.setRequired(false))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullForced).toBeNull()
    expect(result.current.buildSpec()).toEqual({
      name: 'recipient',
      type: 'string',
      value: 'world',
      required: false,
      description: '',
    })
  })

  it('a secret input forces Set to null and leaves the default out of the spec', () => {
    const { result } = inputDraft()
    act(() => result.current.setDraftSecret(true))
    expect(result.current.draftNull).toBe(true)
    expect(result.current.nullForced).toBe('secret')
    expect(result.current.buildSpec()).toEqual({
      name: 'recipient',
      type: 'string',
      required: false,
      description: '',
      secret: true,
    })
  })

  it('unticking Mark as secret gives back the default held before', () => {
    const { result } = inputDraft()
    act(() => result.current.setDraftSecret(true))
    act(() => result.current.setDraftSecret(false))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullForced).toBeNull()
    expect(result.current.buildSpec()).toEqual(expect.objectContaining({ value: 'world' }))
  })

  it('keeps Set to null forced while Mark as secret is ticked, and Required alone never forces it', () => {
    const { result } = inputDraft()
    act(() => result.current.setRequired(true))
    expect(result.current.draftNull).toBe(false)
    act(() => result.current.setDraftSecret(true))
    act(() => result.current.setRequired(false))
    expect(result.current.draftNull).toBe(true)
    expect(result.current.nullForced).toBe('secret')
    act(() => result.current.setDraftSecret(false))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullForced).toBeNull()
    expect(result.current.draftValue).toBe('world')
  })

  it('ticking Required unticks a hand-ticked Set to null and leaves no default', () => {
    const { result } = inputDraft()
    act(() => result.current.setDraftNull(true))
    act(() => result.current.setRequired(true))
    expect(result.current.draftNull).toBe(false)
    expect('value' in result.current.buildSpec()).toBe(false)
    act(() => result.current.setRequired(false))
    expect(result.current.draftNull).toBe(false)
  })

  it('a secret output keeps its default (SECUI-11)', () => {
    const { result } = setup({ mode: 'output' })
    act(() => result.current.setDraftName('token'))
    act(() => result.current.setDraftValue('fallback'))
    act(() => result.current.setDraftSecret(true))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullForced).toBeNull()
    expect(result.current.buildSpec()).toEqual({
      name: 'token',
      type: 'string',
      value: 'fallback',
      description: '',
      secret: true,
    })
  })

  it('a secret variable keeps its value', () => {
    const { result } = setup({ mode: 'variable' })
    act(() => result.current.setDraftName('token'))
    act(() => result.current.setDraftValue('abc'))
    act(() => result.current.setDraftSecret(true))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullForced).toBeNull()
    expect(result.current.buildSpec()).toEqual({ name: 'token', type: 'string', value: 'abc', secret: true })
  })
})

describe('useInspectCreate - Required transitions (VMGR-113, REQ-3.1.2.10)', () => {
  it.each(['string', 'integer', 'float', 'array', 'map', 'table'] as const)(
    'ticking Required on an untouched %s default in Add leaves the field empty with no default',
    (type) => {
      const { result } = setup({ mode: 'input' })
      act(() => result.current.setDraftName('host'))
      act(() => result.current.setDraftType(type))
      act(() => result.current.setRequired(true))
      const spec = result.current.buildSpec()
      expect('value' in spec).toBe(false)
      expect(spec.required).toBe(true)
      expect(result.current.draftNull).toBe(false)
      expect(result.current.isValid).toBe(true)
    },
  )

  it('ticking Required on a true/false input in Add keeps False picked', () => {
    const { result } = setup({ mode: 'input' })
    act(() => result.current.setDraftName('verbose'))
    act(() => result.current.setDraftType('boolean'))
    act(() => result.current.setRequired(true))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.buildSpec()).toEqual(
      expect.objectContaining({ type: 'boolean', value: false, required: true }),
    )
  })

  it('a type switch on a Required input leaves no default, except False for true/false', () => {
    const { result } = setup({ mode: 'input' })
    act(() => result.current.setDraftName('host'))
    act(() => result.current.setRequired(true))
    act(() => result.current.setDraftType('integer'))
    expect('value' in result.current.buildSpec()).toBe(false)
    act(() => result.current.setDraftType('boolean'))
    expect(result.current.buildSpec().value).toBe(false)
  })

  it('ticking Required in Edit keeps the saved default and locks Set to null off', () => {
    const { result } = setupEdit({ mode: 'input', scope: ['fn-1'], row: inputRow({ value: 'db' }) })
    act(() => result.current.setRequired(true))
    expect(result.current.buildSpec()).toEqual(expect.objectContaining({ value: 'db', required: true }))
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(false)
  })

  it('ticking Required while the default is null leaves an empty field with no default', () => {
    const { result } = setupEdit({ mode: 'input', scope: ['fn-1'], row: inputRow({ value: null }) })
    expect(result.current.draftNull).toBe(true)
    act(() => result.current.setRequired(true))
    expect(result.current.draftNull).toBe(false)
    expect('value' in result.current.buildSpec()).toBe(false)
  })

  it('ticking Required while a true/false default is null shows False', () => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow({ name: 'verbose', type: 'boolean', value: null }),
    })
    act(() => result.current.setRequired(true))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.draftValue).toBe(false)
    expect(result.current.buildSpec().value).toBe(false)
  })

  it('unticking Required leaves the field as it is and frees Set to null', () => {
    const { result } = setup({ mode: 'input' })
    act(() => result.current.setDraftName('host'))
    act(() => result.current.setDraftValue('db'))
    act(() => result.current.setRequired(true))
    act(() => result.current.setRequired(false))
    expect(result.current.buildSpec()).toEqual(expect.objectContaining({ value: 'db', required: false }))
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(true)
  })

  it('keeps Set to null off on both values of a Required input', () => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow({ value: 'db', required: true }),
    })
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(false)
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(false)
  })

  it('a Required input with no default is valid and saves none', () => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow({ name: 'must', value: undefined, required: true }),
    })
    expect(result.current.draftNull).toBe(false)
    expect(result.current.isValid).toBe(true)
    expect(result.current.saveDisabledReason).toBeNull()
    expect('value' in result.current.buildSpec()).toBe(false)
  })

  it('a Required true/false input with no stored default opens on False', () => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow({ name: 'verbose', type: 'boolean', value: undefined, required: true }),
    })
    expect(result.current.draftNull).toBe(false)
    expect(result.current.draftValue).toBe(false)
    expect(result.current.buildSpec().value).toBe(false)
  })

  it.each([
    ['integer', 3],
    ['string', 'db'],
  ] as const)('an emptied %s field on a Required input default removes the default', (type, value) => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow({ name: 'port', type, value, required: true }),
    })
    act(() => result.current.setDraftValue(''))
    expect(result.current.isValid).toBe(true)
    expect('value' in result.current.buildSpec()).toBe(false)
  })
})

describe("useInspectCreate - a true / false input's default never holds null (REQ-3.1.3.24, REQ-3.1.2.10)", () => {
  function booleanDraft(mode: VariableCreateMode) {
    const api = setup({ mode })
    act(() => api.result.current.setDraftName('verbose'))
    act(() => api.result.current.setDraftType('boolean'))
    return api
  }

  it('locks Set to null off on a new true / false input only; a true / false variable or output keeps it free', () => {
    const input = booleanDraft('input').result
    expect(input.current.draftNull).toBe(false)
    expect(input.current.nullLocked).toBe(true)
    expect(input.current.nullDisabledByEnum).toBe(true)
    act(() => input.current.setDraftNull(true))
    expect(input.current.draftNull).toBe(false)
    expect(input.current.buildSpec()).toEqual({
      name: 'verbose',
      type: 'boolean',
      value: false,
      required: false,
      description: '',
    })

    for (const mode of ['variable', 'output'] as const) {
      const { result } = booleanDraft(mode)
      expect(result.current.nullLocked).toBe(false)
      act(() => result.current.setDraftNull(true))
      expect(result.current.draftNull).toBe(true)
    }
  })

  it('keeps the secret hold over the true / false lock: a secret true / false input still has no default', () => {
    const { result } = booleanDraft('input')
    expect(result.current.nullLocked).toBe(true)
    expect(result.current.draftNull).toBe(false)
    act(() => result.current.setDraftSecret(true))
    expect(result.current.nullForced).toBe('secret')
    expect(result.current.draftNull).toBe(true)
    expect(result.current.buildSpec()).toEqual({
      name: 'verbose',
      type: 'boolean',
      required: false,
      description: '',
      secret: true,
    })
  })

  it('drops a Set to null ticked before the input type moved to true / false', () => {
    const { result } = setup({ mode: 'input' })
    act(() => result.current.setDraftName('verbose'))
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(true)
    act(() => result.current.setDraftType('boolean'))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullLocked).toBe(true)
    expect(result.current.buildSpec()).toEqual({
      name: 'verbose',
      type: 'boolean',
      value: false,
      required: false,
      description: '',
    })
  })

  it.each([
    ['null', null],
    ['no', undefined],
  ] as const)('opens a saved true / false input with %s default on False, Set to null off and locked', (_label, value) => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow({ name: 'verbose', type: 'boolean', value }),
    })
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullLocked).toBe(true)
    expect(result.current.draftValue).toBe(false)
    expect(result.current.buildSpec().value).toBe(false)
  })

  it('keeps Set to null off on the Default value of a saved true / false input', () => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow({ name: 'dry', type: 'boolean', value: true }),
    })
    expect(result.current.valueView).toBe('initial')
    expect(result.current.nullLocked).toBe(true)
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.buildSpec().value).toBe(true)
  })
})

describe('useInspectCreate - errors of a saved definition show on open (FIELD-12)', () => {
  it('runs the cycle check on a saved expression as the window opens and holds Save', async () => {
    const cycle = "Circular reference detected for variable 'api_url': api_url -> api_url"
    const { result, validateExpressionCycle, onSaveDefinition } = setupEdit({
      row: { name: 'api_url', type: 'string', value: "'v1/' + api_url", isExpression: true },
      validateExpressionCycle: () => cycle,
    })
    expect(validateExpressionCycle).toHaveBeenCalledWith({
      variableName: 'api_url',
      value: "'v1/' + api_url",
      isExpression: true,
    })
    expect(result.current.errors.cycle).toBe(cycle)
    expect(result.current.saveDisabledReason).toBe(cycle)
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
  })

  it('runs the cycle check on a saved output expression as the window opens', () => {
    const cycle = "Circular reference detected for variable 'total': total -> total"
    const { result } = setupEdit({
      mode: 'output',
      scope: ['fn-1'],
      row: { id: 'param:output:total', name: 'total', type: 'integer', value: 'total + 1', isExpression: true },
      validateExpressionCycle: () => cycle,
    })
    expect(result.current.errors.cycle).toBe(cycle)
    expect(result.current.isValid).toBe(false)
  })
})

describe('useInspectCreate - enum inputs (VMGR-112, VMGR-104, REQ-3.1.2.11)', () => {
  function enumDraft(type: 'string' | 'integer' | 'float' = 'string') {
    const api = setup({ mode: 'input' })
    act(() => api.result.current.setDraftName('level'))
    act(() => api.result.current.setDraftType(type))
    return api
  }

  it.each([
    ['string', ['low', 'high']],
    ['integer', [1, 2]],
    ['float', [1.5, 2]],
  ] as const)('creates a %s enum, Required, with its allowed values and the picked default', (type, values) => {
    const { result } = enumDraft(type)
    act(() => result.current.setCreateEnum(true))
    act(() => result.current.setEnumValues([...values]))
    act(() => result.current.setDraftValue(values[0]))
    expect(result.current.buildSpec()).toEqual({
      name: 'level',
      type,
      value: values[0],
      required: true,
      description: '',
      enumValues: [...values],
    })
  })

  it('ticking Create enum ticks Required, unticks Set to null, locks Mark as secret off and starts Allowed values empty', () => {
    const { result } = enumDraft()
    act(() => result.current.setCreateEnum(true))
    expect(result.current.paramMeta.required).toBe(true)
    expect(result.current.paramMeta.createEnum).toBe(true)
    expect(result.current.paramMeta.enumValues).toEqual([])
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullDisabledByEnum).toBe(true)
    expect(result.current.enumLocksSecret).toBe(true)
    expect(result.current.draftSecret).toBe(false)
  })

  it('keeps Create disabled until Allowed values has an item and a default is picked', () => {
    const { result } = enumDraft()
    act(() => result.current.setCreateEnum(true))
    expect(result.current.saveDisabledReason).not.toBeNull()
    act(() => result.current.setEnumValues(['low', 'high']))
    expect(result.current.saveDisabledReason).not.toBeNull()
    act(() => result.current.setDraftValue('low'))
    expect(result.current.saveDisabledReason).toBeNull()
  })

  it('keeps Required ticked while Create enum is set', () => {
    const { result } = enumDraft()
    act(() => result.current.setCreateEnum(true))
    act(() => result.current.setRequired(false))
    expect(result.current.paramMeta.required).toBe(true)
    expect(result.current.buildSpec().required).toBe(true)
  })

  it('unticking Create enum keeps Required ticked but free and the field holding the former default', () => {
    const { result } = enumDraft()
    act(() => result.current.setCreateEnum(true))
    act(() => result.current.setEnumValues(['low', 'high']))
    act(() => result.current.setDraftValue('low'))
    act(() => result.current.setCreateEnum(false))
    expect(result.current.paramMeta.required).toBe(true)
    expect(result.current.draftValue).toBe('low')
    expect(result.current.buildSpec()).toEqual({
      name: 'level',
      type: 'string',
      value: 'low',
      required: true,
      description: '',
    })
    act(() => result.current.setRequired(false))
    expect(result.current.buildSpec().required).toBe(false)
  })

  it('turns a ticked Set to null off and disables it while Create enum is set', () => {
    const { result } = enumDraft()
    act(() => result.current.setDraftNull(true))
    act(() => result.current.setCreateEnum(true))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullDisabledByEnum).toBe(true)
    act(() => result.current.setCreateEnum(false))
    expect(result.current.nullDisabledByEnum).toBe(false)
  })

  it('locks Mark as secret while Create enum is set', () => {
    const { result } = enumDraft()
    act(() => result.current.setCreateEnum(true))
    expect(result.current.enumLocksSecret).toBe(true)
    expect(result.current.secretLocksEnum).toBe(false)
    act(() => result.current.setCreateEnum(false))
    expect(result.current.enumLocksSecret).toBe(false)
  })

  it('locks Create enum while Mark as secret is set', () => {
    const { result } = enumDraft()
    act(() => result.current.setDraftSecret(true))
    expect(result.current.secretLocksEnum).toBe(true)
    expect(result.current.enumLocksSecret).toBe(false)
    act(() => result.current.setDraftSecret(false))
    expect(result.current.secretLocksEnum).toBe(false)
  })

  it('never creates a secret enum input', () => {
    const { result } = enumDraft()
    act(() => result.current.setCreateEnum(true))
    act(() => result.current.setEnumValues(['low']))
    act(() => result.current.setDraftValue('low'))
    act(() => result.current.setDraftSecret(true))
    expect(result.current.buildSpec()).not.toHaveProperty('secret')
  })

  it('offers Create enum only for a text, whole number or decimal input', () => {
    for (const type of ['boolean', 'array', 'map', 'table'] as const) {
      const { result } = setup({ mode: 'input' })
      act(() => result.current.setDraftName('opts'))
      act(() => result.current.setDraftType(type))
      act(() => result.current.setCreateEnum(true))
      expect(result.current.enumOn).toBe(false)
      expect(result.current.paramMeta.createEnum).toBe(false)
      expect(result.current.buildSpec()).not.toHaveProperty('enumValues')
      expect(result.current.buildSpec().required).toBe(false)
    }
  })
})

describe('useInspectCreate - a Type switch retypes the allowed values (VMGR-100)', () => {
  it('reads every allowed value again as the new type', () => {
    const { result } = setup({ mode: 'input' })
    act(() => result.current.setDraftName('level'))
    act(() => result.current.setCreateEnum(true))
    act(() => result.current.setEnumValues(['1', '7']))

    act(() => result.current.setDraftType('integer'))
    expect(result.current.paramMeta.enumValues).toEqual([1, 7])

    act(() => result.current.setDraftType('string'))
    expect(result.current.paramMeta.enumValues).toEqual(['1', '7'])
  })
})

describe('useInspectCreate - output Kind (VMGR-99, REQ-3.1.2.8)', () => {
  it('emits an output expression carrying isExpression', () => {
    const { result } = setup({ mode: 'output' })
    act(() => result.current.setDraftName('total'))
    act(() => result.current.setDraftKind('expression'))
    act(() => result.current.setDraftValue('a + b'))
    expect(result.current.buildSpec()).toEqual({
      name: 'total',
      type: 'string',
      value: 'a + b',
      isExpression: true,
      description: '',
    })
  })

  it('emits a String output template carrying isTemplate', () => {
    const { result } = setup({ mode: 'output' })
    act(() => result.current.setDraftName('greeting'))
    act(() => result.current.setDraftKind('template'))
    act(() => result.current.setDraftValue('Hi {{ name }}'))
    expect(result.current.buildSpec()).toEqual({
      name: 'greeting',
      type: 'string',
      value: 'Hi {{ name }}',
      isTemplate: true,
      description: '',
    })
  })

  it('runs the cycle check when an output expression loses focus', () => {
    const cycle = "Circular reference detected for variable 'total': total -> total"
    const { result, validateExpressionCycle } = setup({ mode: 'output', validateExpressionCycle: () => cycle })
    act(() => result.current.setDraftName('total'))
    act(() => result.current.setDraftKind('expression'))
    act(() => result.current.setDraftValue('total + 1'))
    act(() => result.current.handleExpressionBlur())
    expect(validateExpressionCycle).toHaveBeenCalledWith({
      variableName: 'total',
      value: 'total + 1',
      isExpression: true,
    })
    expect(result.current.errors.cycle).toBe(cycle)
    expect(result.current.isValid).toBe(false)
  })

  it('does not run the cycle check when a literal output loses focus', () => {
    const { result, validateExpressionCycle } = setup({ mode: 'output' })
    act(() => result.current.setDraftName('total'))
    act(() => result.current.setDraftValue('total + 1'))
    act(() => result.current.handleExpressionBlur())
    expect(validateExpressionCycle).not.toHaveBeenCalled()
    expect(result.current.errors.cycle).toBeNull()
    expect(result.current.isValid).toBe(true)
  })

  it('clears the cycle error when the output expression is edited', () => {
    const cycle = "Circular reference detected for variable 'total': total -> total"
    const { result } = setup({ mode: 'output', validateExpressionCycle: () => cycle })
    act(() => result.current.setDraftName('total'))
    act(() => result.current.setDraftKind('expression'))
    act(() => result.current.setDraftValue('total + 1'))
    act(() => result.current.handleExpressionBlur())
    expect(result.current.errors.cycle).toBe(cycle)
    act(() => result.current.setDraftValue('a + b'))
    expect(result.current.errors.cycle).toBeNull()
    expect(result.current.isValid).toBe(true)
  })
})

describe('useInspectCreate - Edit opens filled (VMGR-106, VMGR-108)', () => {
  it('fills the name, type, kind, secrecy and value from the row', () => {
    const { result } = setupEdit({
      row: { name: 'api_url', type: 'string', value: "'http://' + host", isExpression: true },
    })
    expect(result.current.draftName).toBe('api_url')
    expect(result.current.draftType).toBe('string')
    expect(result.current.draftKind).toBe('expression')
    expect(result.current.draftSecret).toBe(false)
    expect(result.current.draftValue).toBe("'http://' + host")
    expect(result.current.draftNull).toBe(false)
  })

  it('fills the Template kind of a template variable', () => {
    const { result } = setupEdit({ row: { name: 'msg', type: 'string', value: 'Hi {{ name }}', isTemplate: true } })
    expect(result.current.draftKind).toBe('template')
    expect(result.current.draftValue).toBe('Hi {{ name }}')
  })

  it('fills Mark as secret from a secret row', () => {
    const { result } = setupEdit({ row: { name: 'token', type: 'string', value: '********', isSecret: true } })
    expect(result.current.draftSecret).toBe(true)
  })

  it('fills an input with its Required tick, Description, allowed values and default', () => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: { ...ENV_ROW, description: 'Where it runs' },
    })
    expect(result.current.draftName).toBe('env')
    expect(result.current.draftType).toBe('string')
    expect(result.current.paramMeta).toEqual({
      required: true,
      createEnum: true,
      enumValues: ['dev', 'staging', 'prod'],
      description: 'Where it runs',
    })
    expect(result.current.draftValue).toBe('dev')
  })

  it('fills an output with its Kind and Description', () => {
    const { result } = setupEdit({
      mode: 'output',
      scope: ['fn-1'],
      row: { id: 'param:output:total', name: 'total', type: 'integer', value: 'a + b', isExpression: true, description: 'Sum' },
    })
    expect(result.current.draftKind).toBe('expression')
    expect(result.current.paramMeta.description).toBe('Sum')
  })

  it('fills the element types of a list or map', () => {
    const { result } = setupEdit({
      row: { name: 'conf', type: 'map', value: { n: '16' }, elementTypes: { n: 'integer' } },
    })
    expect(result.current.initialDraft.value).toEqual({ n: '16' })
    expect(result.current.initialDraft.elementTypes).toEqual({ n: 'integer' })
  })

  it('opens on the Initial value, valid, with Save enabled and nothing being written', () => {
    const { result } = setupEdit({ checkNameExists: () => true })
    expect(result.current.valueView).toBe('initial')
    expect(result.current.errors.name).toBeNull()
    expect(result.current.isValid).toBe(true)
    expect(result.current.saveDisabledReason).toBeNull()
    expect(result.current.saving).toBe(false)
  })
})

describe('useInspectCreate - the value switch keeps two drafts (VMGR-108)', () => {
  it('edits the Current value on the Current view and keeps the Initial value', () => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    expect(result.current.draftValue).toBe(5)
    act(() => result.current.setValueView('current'))
    expect(result.current.valueView).toBe('current')
    expect(result.current.draftValue).toBe(9)
    act(() => result.current.setDraftValue(12))
    act(() => result.current.setValueView('initial'))
    expect(result.current.draftValue).toBe(5)
    expect(result.current.initialDraft.value).toBe(5)
    expect(result.current.currentDraft.value).toBe(12)
    act(() => result.current.setValueView('current'))
    expect(result.current.draftValue).toBe(12)
  })

  it('seeds the Current value from the saved value when there is no live or staged one', () => {
    const { result } = setupEdit({ current: { value: undefined, hasValue: false } })
    expect(result.current.currentDraft.value).toBe(5)
    act(() => result.current.setValueView('current'))
    expect(result.current.draftValue).toBe(5)
  })

  it('seeds the Current value of an expression from its active source, never its result', () => {
    const { result } = setupEdit({
      row: { name: 'total', type: 'integer', value: 'a + 1', isExpression: true },
      current: { value: 7, hasValue: true, source: 'a + 2' },
    })
    act(() => result.current.setValueView('current'))
    expect(result.current.draftValue).toBe('a + 2')
    expect(result.current.initialDraft.value).toBe('a + 1')
  })

  it('seeds the Current element types from the run, and from the definition when nothing ran', () => {
    const live = setupEdit({
      row: { name: 'items', type: 'array', value: ['1'], elementTypes: ['string'] },
      current: { value: ['2'], hasValue: true, elementTypes: ['float'] },
    })
    expect(live.result.current.initialDraft.elementTypes).toEqual(['string'])
    expect(live.result.current.currentDraft.value).toEqual(['2'])
    expect(live.result.current.currentDraft.elementTypes).toEqual(['float'])

    const idle = setupEdit({ row: { name: 'items', type: 'array', value: ['1'], elementTypes: ['integer'] } })
    expect(idle.result.current.currentDraft.elementTypes).toEqual(['integer'])
  })

  it('shares the name, kind and secrecy between the two values', () => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftName('total'))
    act(() => result.current.setDraftSecret(true))
    act(() => result.current.setValueView('initial'))
    expect(result.current.draftName).toBe('total')
    expect(result.current.draftSecret).toBe(true)
  })

  it('runs the cycle check on an edited expression and blocks Save', async () => {
    const cycle = "Circular reference detected for variable 'a': a -> a"
    const { result, validateExpressionCycle, onSaveDefinition } = setupEdit({
      row: { name: 'a', type: 'integer', value: 'b + 1', isExpression: true },
      validateExpressionCycle: () => cycle,
    })
    act(() => result.current.setDraftValue('a + 1'))
    act(() => result.current.handleExpressionBlur())
    expect(validateExpressionCycle).toHaveBeenCalledWith({ variableName: 'a', value: 'a + 1', isExpression: true })
    expect(result.current.errors.cycle).toBe(cycle)
    expect(result.current.saveDisabledReason).not.toBeNull()
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
  })
})

describe('useInspectCreate - the full Current value of a list, map or table (REQ-3.2.2.18)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the full value from its own Function scope and seeds the Current view with it', async () => {
    mockGetSessionVariables.mockResolvedValue({
      items: { value: ['a', 'b', 'c'], type: 'array', elementTypes: ['string', 'string', 'integer'] },
    })
    const { result } = setupEdit({
      row: { id: 'v-items', name: 'items', type: 'array', value: ['a'] },
      scope: ['fn-1'],
      sessionId: 'sess-1',
      current: { value: { count: 3, changed: true }, hasValue: true },
    })
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockGetSessionVariables).toHaveBeenCalledWith('sess-1', ['items'], ['fn-1'])
    act(() => result.current.setValueView('current'))
    expect(result.current.draftValue).toEqual(['a', 'b', 'c'])
    expect(result.current.currentDraft.elementTypes).toEqual(['string', 'string', 'integer'])
    expect(result.current.dirty.current).toBe(false)
  })
})

describe('useInspectCreate - Set to null in Edit (VMGR-111, REQ-3.1.3.24)', () => {
  it.each(ALL_TYPES)('opens a wholly null %s with Set to null ticked', (type) => {
    const { result } = setupEdit({ row: { type, value: null } })
    expect(result.current.draftNull).toBe(true)
  })

  it.each([
    ['input', inputRow({ type: 'integer', value: null })],
    ['output', { id: 'param:output:total', name: 'total', type: 'integer', value: null, description: '' }],
  ] as const)('opens the null default of an optional %s with Set to null ticked', (mode, row) => {
    const { result } = setupEdit({ mode, scope: ['fn-1'], row })
    expect(result.current.draftNull).toBe(true)
  })

  it.each(TYPE_DEFAULTS)('unticking a saved null %s gives the type default', (type, preset) => {
    const { result } = setupEdit({ row: { type, value: null } })
    expect(result.current.draftNull).toBe(true)
    act(() => result.current.setDraftNull(false))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.draftValue).toEqual(preset)
  })

  it.each(TYPE_DEFAULTS)('opens a %s that carries no value like a null, and unticking gives the type default', (type, preset) => {
    const { result } = setupEdit({ row: { name: 'k8s_session', type, value: undefined } })
    expect(result.current.draftNull).toBe(true)
    act(() => result.current.setDraftNull(false))
    expect(result.current.draftValue).toEqual(preset)
  })

  it('unticking after a tick in this window brings back the value typed before it', () => {
    const { result } = setupEdit({ row: { value: null } })
    expect(result.current.draftNull).toBe(true)
    act(() => result.current.setDraftNull(false))
    expect(result.current.draftValue).toBe(0)
    act(() => result.current.setDraftValue('7'))
    act(() => result.current.setDraftNull(true))
    act(() => result.current.setDraftNull(false))
    expect(result.current.draftValue).toBe('7')
  })

  it('saves a ticked Initial value as a plain null', () => {
    const { result } = setupEdit()
    act(() => result.current.setDraftNull(true))
    expect(result.current.buildSpec()).toEqual(expect.objectContaining({ name: 'count', type: 'integer', value: null }))
    expect(result.current.buildSpec()).not.toHaveProperty('isExpression')
  })

  it('opens the Current view ticked on a null live value while the Initial value stays unticked', () => {
    const { result } = setupEdit({ current: { value: null, hasValue: true } })
    expect(result.current.draftNull).toBe(false)
    act(() => result.current.setValueView('current'))
    expect(result.current.draftNull).toBe(true)
    act(() => result.current.setDraftNull(false))
    expect(result.current.draftValue).toBe(0)
    act(() => result.current.setValueView('initial'))
    expect(result.current.draftValue).toBe(5)
  })

  it('a secret input ticks and locks Set to null on its default only, its Current value stays free', async () => {
    const { result, onSaveCurrent } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow({ id: 'param:input:tok', name: 'tok', value: undefined, isSecret: true }),
    })
    expect(result.current.draftNull).toBe(true)
    expect(result.current.nullForced).toBe('secret')
    act(() => result.current.setDraftNull(false))
    expect(result.current.draftNull).toBe(true)

    act(() => result.current.setValueView('current'))
    expect(result.current.draftNull).toBe(false)
    expect(result.current.nullForced).toBeNull()
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(true)

    await saveWindow(result)
    expect(currentWrite(onSaveCurrent)).toEqual({
      name: 'tok',
      body: { value: null, type: 'string' },
      scope: ['fn-1'],
    })
  })

  it('a Required secret input keeps Set to null off on its Current value', () => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow({ id: 'param:input:tok', name: 'tok', value: undefined, isSecret: true, required: true }),
    })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(false)
  })
})

describe('useInspectCreate - enum inputs in Edit (VMGR-112, REQ-3.1.2.11)', () => {
  function enumEdit(current?: CurrentSeed) {
    return setupEdit({ mode: 'input', scope: ['fn-1'], row: ENV_ROW, current })
  }

  it('keeps Set to null off on both values of an enum input', () => {
    const { result } = enumEdit({ value: 'staging', hasValue: true })
    expect(result.current.nullDisabledByEnum).toBe(true)
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(false)
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftNull(true))
    expect(result.current.draftNull).toBe(false)
  })

  it('picking a default sets a null Current value to it at once', () => {
    const { result } = enumEdit({ value: null, hasValue: true })
    act(() => result.current.setDraftValue('prod'))
    expect(result.current.currentDraft.value).toBe('prod')
  })

  it('picking a default sets a Current value that is not allowed to it at once', () => {
    const { result } = enumEdit({ value: 'qa', hasValue: true })
    act(() => result.current.setDraftValue('prod'))
    expect(result.current.currentDraft.value).toBe('prod')
  })

  it('asks for a Current value when the Current value is not an allowed one', () => {
    const { result } = enumEdit({ value: 'qa', hasValue: true })
    expect(result.current.saveDisabledReason).toBe('Current value is required')
    act(() => result.current.setValueView('current'))
    expect(result.current.enumValueError).toBe('Current value is required')
    act(() => result.current.setValueView('initial'))
    expect(result.current.enumValueError).toBeNull()
  })

  it('picking a default leaves an allowed Current value as it is', () => {
    const { result } = enumEdit({ value: 'staging', hasValue: true })
    act(() => result.current.setDraftValue('prod'))
    expect(result.current.initialDraft.value).toBe('prod')
    expect(result.current.currentDraft.value).toBe('staging')
  })

  it('editing Allowed values so the default is no longer allowed empties the default and disables Save', () => {
    const { result } = enumEdit()
    act(() => result.current.setEnumValues(['staging', 'prod']))
    expect(result.current.initialDraft.value).not.toBe('dev')
    expect(['staging', 'prod']).not.toContain(result.current.initialDraft.value)
    expect(result.current.saveDisabledReason).not.toBeNull()
    act(() => result.current.setDraftValue('prod'))
    expect(result.current.saveDisabledReason).toBeNull()
  })

  it('typing the default of an input that is not an enum leaves a null Current value as it is', () => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow(),
      current: { value: null, hasValue: true },
    })
    act(() => result.current.setDraftValue('us'))
    expect(result.current.initialDraft.value).toBe('us')
    expect(result.current.dirty).toEqual({ definition: true, current: false })
    act(() => result.current.setValueView('current'))
    expect(result.current.draftNull).toBe(true)
  })

  it('keeps Save disabled while the Current value is not an allowed value', () => {
    const { result } = enumEdit({ value: 'staging', hasValue: true })
    act(() => result.current.setEnumValues(['dev', 'prod']))
    expect(result.current.saveDisabledReason).not.toBeNull()
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue('prod'))
    expect(result.current.saveDisabledReason).toBeNull()
  })

  it('turning an input whose value is null into an enum keeps Save disabled until the default and the Current value are set', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: inputRow({ id: 'param:input:env', name: 'env', value: null }),
    })
    expect(result.current.draftNull).toBe(true)
    act(() => result.current.setCreateEnum(true))
    expect(result.current.draftNull).toBe(false)
    act(() => result.current.setValueView('current'))
    expect(result.current.draftNull).toBe(false)
    act(() => result.current.setValueView('initial'))
    expect(result.current.saveDisabledReason).not.toBeNull()
    act(() => result.current.setEnumValues(['dev', 'prod']))
    expect(result.current.saveDisabledReason).not.toBeNull()
    act(() => result.current.setDraftValue('dev'))
    expect(result.current.currentDraft.value).toBe('dev')
    expect(result.current.saveDisabledReason).toBeNull()

    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(
      expect.objectContaining({ name: 'env', type: 'string', value: 'dev', required: true, enumValues: ['dev', 'prod'] }),
    )
    expect(currentWrite(onSaveCurrent)).toEqual({
      name: 'env',
      body: { value: 'dev', type: 'string' },
      scope: ['fn-1'],
    })
  })
})

describe('useInspectCreate - an Add window\'s unsaved changes are what differs from its opening state', () => {
  it.each(['variable', 'input', 'output'] as const)('reports nothing unsaved when a %s Add window opens', (mode) => {
    const { result } = setup({ mode })
    expect(result.current.dirty).toEqual({ definition: false, current: false })
  })

  it('marks a typed name unsaved and clears it when the name is emptied again', () => {
    const { result } = setup()
    act(() => result.current.setDraftName('total'))
    expect(result.current.dirty.definition).toBe(true)
    act(() => result.current.setDraftName(''))
    expect(result.current.dirty.definition).toBe(false)
  })

  it('counts the type, Kind, Mark as secret and the value as changes', () => {
    const type = setup()
    act(() => type.result.current.setDraftType('integer'))
    expect(type.result.current.dirty.definition).toBe(true)

    const kind = setup()
    act(() => kind.result.current.setDraftKind('expression'))
    expect(kind.result.current.dirty.definition).toBe(true)

    const secret = setup()
    act(() => secret.result.current.setDraftSecret(true))
    expect(secret.result.current.dirty.definition).toBe(true)

    const value = setup()
    act(() => value.result.current.setDraftValue('hello'))
    expect(value.result.current.dirty.definition).toBe(true)
  })

  it('counts Required, Create enum, Allowed values and Description of an input as changes', () => {
    const required = setup({ mode: 'input' })
    act(() => required.result.current.setRequired(true))
    expect(required.result.current.dirty.definition).toBe(true)

    const createEnum = setup({ mode: 'input' })
    act(() => createEnum.result.current.setCreateEnum(true))
    expect(createEnum.result.current.dirty.definition).toBe(true)

    const allowed = setup({ mode: 'input' })
    act(() => allowed.result.current.setCreateEnum(true))
    act(() => allowed.result.current.setEnumValues(['dev']))
    expect(allowed.result.current.paramMeta.enumValues).toEqual(['dev'])
    expect(allowed.result.current.dirty.definition).toBe(true)

    const description = setup({ mode: 'input' })
    act(() => description.result.current.setDescription('Region code'))
    expect(description.result.current.dirty.definition).toBe(true)
  })
})

describe('useInspectCreate - unsaved changes are what differs from the saved state', () => {
  it('reports nothing unsaved when the window opens', () => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    expect(result.current.dirty).toEqual({ definition: false, current: false })
  })

  it('marks the definition unsaved for a changed name and clears it when the saved name is typed back', () => {
    const { result } = setupEdit()
    act(() => result.current.setDraftName('total'))
    expect(result.current.dirty.definition).toBe(true)
    act(() => result.current.setDraftName('count'))
    expect(result.current.dirty.definition).toBe(false)
  })

  it('marks only the definition unsaved for a changed Initial value', () => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setDraftValue(6))
    expect(result.current.dirty).toEqual({ definition: true, current: false })
  })

  it('marks only the Current value unsaved for a changed Current value, and clears it when typed back', () => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(12))
    expect(result.current.dirty).toEqual({ definition: false, current: true })
    act(() => result.current.setDraftValue(9))
    expect(result.current.dirty.current).toBe(false)
  })

  it('compares list and map values by their content', () => {
    const map = setupEdit({ row: { name: 'conf', type: 'map', value: { a: '1' } } })
    act(() => map.result.current.setDraftValue({ a: '1' }))
    expect(map.result.current.dirty.definition).toBe(false)

    const list = setupEdit({ row: { name: 'items', type: 'array', value: ['x'] } })
    act(() => list.result.current.setDraftValue(['x', 'y']))
    expect(list.result.current.dirty.definition).toBe(true)
  })

  it('counts Mark as secret, Kind and the type as definition changes', () => {
    const secret = setupEdit()
    act(() => secret.result.current.setDraftSecret(true))
    expect(secret.result.current.dirty.definition).toBe(true)

    const kind = setupEdit()
    act(() => kind.result.current.setDraftKind('expression'))
    act(() => kind.result.current.confirmKindChange())
    expect(kind.result.current.dirty.definition).toBe(true)

    const type = setupEdit()
    act(() => type.result.current.setDraftType('string'))
    act(() => type.result.current.confirmTypeChange())
    expect(type.result.current.dirty.definition).toBe(true)
  })

  it('counts Description, Required and Allowed values of an input as definition changes', () => {
    const description = setupEdit({ mode: 'input', scope: ['fn-1'], row: inputRow() })
    act(() => description.result.current.setDescription('Region code'))
    expect(description.result.current.dirty.definition).toBe(true)

    const required = setupEdit({ mode: 'input', scope: ['fn-1'], row: inputRow() })
    act(() => required.result.current.setRequired(true))
    expect(required.result.current.dirty.definition).toBe(true)

    const allowed = setupEdit({ mode: 'input', scope: ['fn-1'], row: ENV_ROW })
    act(() => allowed.result.current.setEnumValues(['dev', 'staging', 'prod', 'qa']))
    expect(allowed.result.current.dirty.definition).toBe(true)
  })

  it('counts a ticked Set to null on the Current view as a Current change, and clears it when unticked', () => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftNull(true))
    expect(result.current.dirty).toEqual({ definition: false, current: true })
    act(() => result.current.setDraftNull(false))
    expect(result.current.draftValue).toBe(9)
    expect(result.current.dirty).toEqual({ definition: false, current: false })
  })
})

describe('useInspectCreate - a type change in Edit resets both values (VMGR-108)', () => {
  it('asks to confirm and keeps the type and both values until confirmed', () => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setDraftType('string'))
    expect(result.current.pendingTypeChange).toEqual(
      expect.objectContaining({ prevType: 'integer', nextType: 'string' }),
    )
    expect(result.current.draftType).toBe('integer')
    expect(result.current.initialDraft.value).toBe(5)
    expect(result.current.currentDraft.value).toBe(9)
  })

  it.each([
    ['string', ''],
    ['map', {}],
    ['boolean', false],
  ] as const)('confirming a change to %s resets the Initial and the Current value to its default', (next, preset) => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setDraftType(next))
    act(() => result.current.confirmTypeChange())
    expect(result.current.draftType).toBe(next)
    expect(result.current.pendingTypeChange).toBeNull()
    expect(result.current.initialDraft.value).toEqual(preset)
    expect(result.current.currentDraft.value).toEqual(preset)
  })

  it('a type change from the Current view resets both values too', () => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftType('string'))
    act(() => result.current.confirmTypeChange())
    expect(result.current.initialDraft.value).toBe('')
    expect(result.current.currentDraft.value).toBe('')
  })

  it('canceling keeps the type and both values', () => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setDraftType('string'))
    act(() => result.current.cancelTypeChange())
    expect(result.current.draftType).toBe('integer')
    expect(result.current.pendingTypeChange).toBeNull()
    expect(result.current.initialDraft.value).toBe(5)
    expect(result.current.currentDraft.value).toBe(9)
  })

  it('counts the rows a change of a table stored with its column types would clear', () => {
    const { result } = setupEdit({ row: { name: 'vt', type: 'table', value: STORED_TABLE } })
    act(() => result.current.setDraftType('map'))
    expect(result.current.pendingTypeChange).toEqual({ prevType: 'table', nextType: 'map', currentLength: 2 })
  })

  it('counts the entries a list change would clear', () => {
    const { result } = setupEdit({ row: { name: 'items', type: 'array', value: ['a', 'b', 'c'] } })
    act(() => result.current.setDraftType('map'))
    expect(result.current.pendingTypeChange).toEqual({ prevType: 'array', nextType: 'map', currentLength: 3 })
  })
})

describe('useInspectCreate - Mark as secret in Edit (VMGR-109, REQ-3.1.3.5)', () => {
  it('seeds both values of a saved secret with the type empty value, never the mask', () => {
    const { result } = setupEdit({
      row: { name: 'items', type: 'array', value: '********', isSecret: true },
      current: { value: '********', hasValue: true },
    })
    expect(result.current.initialDraft.value).toEqual([])
    expect(result.current.currentDraft.value).toEqual([])
  })

  it('Save with nothing changed on a saved secret writes nothing, never the empty seed', async () => {
    const { result, onSaveDefinition, onSaveCurrent, onSaved } = setupEdit({
      row: { name: 'token', type: 'string', value: '********', isSecret: true },
      current: { value: '********', hasValue: true },
    })
    expect(result.current.dirty).toEqual({ definition: false, current: false })
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('seeds a secret set in this session, not yet saved, with its value', () => {
    const { result } = setupEdit({
      row: { name: 'token', type: 'string', value: 'abc', isSecret: true },
      secretUnlocked: true,
    })
    expect(result.current.draftValue).toBe('abc')
  })

  it('a typed value replaces a saved secret and is saved secret, never the mask', async () => {
    const { result, onSaveDefinition } = setupEdit({
      row: { name: 'token', type: 'string', value: '********', isSecret: true },
    })
    expect(result.current.draftValue).toBe('')
    act(() => result.current.setDraftValue('new-token'))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(
      expect.objectContaining({ name: 'token', value: 'new-token', secret: true }),
    )
  })

  it('turning Mark as secret on keeps the value and saves the variable secret', async () => {
    const { result, onSaveDefinition } = setupEdit({ row: { name: 'token', type: 'string', value: 'abc' } })
    act(() => result.current.setDraftSecret(true))
    expect(result.current.draftSecret).toBe(true)
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(
      expect.objectContaining({ name: 'token', value: 'abc', secret: true }),
    )
  })

  it('turning Mark as secret off on a saved secret clears the value to the type default, never the mask', async () => {
    const { result, onSaveDefinition } = setupEdit({
      row: { name: 'conf', type: 'map', value: '********', isSecret: true },
    })
    act(() => result.current.setDraftSecret(false))
    expect(result.current.draftSecret).toBe(false)
    expect(result.current.draftValue).toEqual({})
    await saveWindow(result)
    const spec = savedSpec(onSaveDefinition)
    expect(spec.value).toEqual({})
    expect(spec.secret ?? false).toBe(false)
  })
})

describe('useInspectCreate - Save in Edit (VMGR-108)', () => {
  it('Save with nothing changed writes nothing and closes the window', async () => {
    const { result, onSaveDefinition, onSaveCurrent, onSaved } = setupEdit({ current: { value: 9, hasValue: true } })
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('writes a changed Initial value to the definition only, then closes', async () => {
    const { result, onSaveDefinition, onSaveCurrent, onSaved } = setupEdit()
    act(() => result.current.setDraftValue(42))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ name: 'count', type: 'integer', value: 42 }))
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('writes an edited expression source as an expression', async () => {
    const { result, onSaveDefinition } = setupEdit({
      row: { name: 'api_url', type: 'string', value: "'http://' + host", isExpression: true },
    })
    act(() => result.current.setDraftValue("'https://' + host"))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(
      expect.objectContaining({ name: 'api_url', value: "'https://' + host", isExpression: true }),
    )
  })

  it('sends a rename and a value change in one definition write', async () => {
    const { result, onSaveDefinition } = setupEdit()
    act(() => result.current.setDraftName('renamed'))
    act(() => result.current.setDraftValue(42))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ name: 'renamed', value: 42 }))
  })

  it('renames from the Current view too', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftName('renamed'))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ name: 'renamed', value: 5 }))
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it('writes a changed Current value without touching the definition', async () => {
    const { result, onSaveDefinition, onSaveCurrent, onSaved } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(12))
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'count', body: { value: 12, type: 'integer' }, scope: null })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('sends a ticked Current value as a plain null', async () => {
    const { result, onSaveCurrent } = setupEdit({ scope: ['fn-1'], current: { value: 9, hasValue: true } })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftNull(true))
    await saveWindow(result)
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'count', body: { value: null, type: 'integer' }, scope: ['fn-1'] })
  })

  it('sends a ticked Current list as a plain null, without its element types', async () => {
    const { result, onSaveCurrent } = setupEdit({
      row: { name: 'items', type: 'array', value: ['1'], elementTypes: ['integer'] },
      current: { value: ['2'], hasValue: true, elementTypes: ['integer'] },
    })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftNull(true))
    await saveWindow(result)
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'items', body: { value: null, type: 'array' }, scope: null })
  })

  it('writes both values when both changed, the definition first', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setDraftValue(6))
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(12))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ value: 6 }))
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'count', body: { value: 12, type: 'integer' }, scope: null })
    expect(onSaveDefinition.mock.invocationCallOrder[0]).toBeLessThan(onSaveCurrent.mock.invocationCallOrder[0])
  })

  it('a refused definition write sends no Current value, shows the reason and keeps the window open', async () => {
    const { result, onSaveCurrent, onSaved } = setupEdit({
      current: { value: 9, hasValue: true },
      onSaveDefinition: () => ({ success: false, error: 'Name "total" already exists in this scope' }),
    })
    act(() => result.current.setDraftName('total'))
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(12))
    await saveWindow(result)
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(result.current.errors.submit).toBe('Name "total" already exists in this scope')
    expect(result.current.draftName).toBe('total')
    expect(result.current.currentDraft.value).toBe(12)
  })

  it('a refused definition write with no reason shows no text and sends no Current value', async () => {
    const { result, onSaveCurrent, onSaved } = setupEdit({
      current: { value: 9, hasValue: true },
      onSaveDefinition: () => ({ success: false }),
    })
    act(() => result.current.setDraftName('total'))
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(12))
    await saveWindow(result)
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(result.current.errors.submit).toBeNull()
  })

  it('does nothing while the value is invalid', async () => {
    const { result, onSaveDefinition, onSaveCurrent, onSaved } = setupEdit()
    act(() => result.current.setDraftValue(42))
    act(() => result.current.setBodyValid(false))
    expect(result.current.isValid).toBe(false)
    expect(result.current.saveDisabledReason).not.toBeNull()
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('does nothing while the name is taken', async () => {
    const { result, onSaveDefinition, checkNameExists } = setupEdit({ checkNameExists: () => true })
    act(() => result.current.setDraftName('taken'))
    expect(result.current.errors.name).toBe('A variable with this name already exists')
    expect(checkNameExists).toHaveBeenCalledWith('taken', 'v1')
    expect(result.current.isValid).toBe(false)
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
  })

  it('flags an emptied name with the shared message', () => {
    const { result } = setupEdit()
    expect(result.current.draftName).toBe('count')
    act(() => result.current.setDraftName('   '))
    expect(result.current.errors.name).toBe('Name is required')
    expect(result.current.isValid).toBe(false)
  })

  it('refuses renaming an input to a name that starts with an underscore', () => {
    const { result } = setupEdit({ mode: 'input', scope: ['fn-1'], row: inputRow() })
    act(() => result.current.setDraftName('_region'))
    expect(result.current.errors.name).toBe(
      'Parameter name must start with a letter, contain only letters, numbers, underscores',
    )
  })

  it('shows busy while a write is in flight and a second Save sends nothing', async () => {
    let land!: () => void
    const { result, onSaveCurrent, onSaved } = setupEdit({
      current: { value: 9, hasValue: true },
      onSaveCurrent: () =>
        new Promise<void>((resolve) => {
          land = resolve
        }),
    })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(12))
    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.trySave()
    })
    expect(result.current.saving).toBe(true)
    act(() => {
      void result.current.trySave()
    })
    expect(onSaveCurrent).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    await act(async () => {
      land()
      await pending
    })
    expect(result.current.saving).toBe(false)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('keeps the window open with both values when the Current write is rejected', async () => {
    const { result, onSaved } = setupEdit({
      current: { value: 9, hasValue: true },
      onSaveCurrent: () => Promise.reject(new Error('Session is not running')),
    })
    act(() => result.current.setDraftValue(6))
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(12))
    await saveWindow(result)
    expect(onSaved).not.toHaveBeenCalled()
    expect(result.current.saving).toBe(false)
    expect(result.current.currentDraft.value).toBe(12)
    expect(result.current.dirty.current).toBe(true)
  })

  it('locks Save while the run is running and keeps the draft until it stops', async () => {
    const { result, rerender, onSaveDefinition, onSaveCurrent, onSaved } = setupEdit()
    act(() => result.current.setDraftValue(42))
    rerender({ runLocked: true })
    expect(result.current.saveDisabledReason).toBe('Locked while the test is executing')
    expect(result.current.draftValue).toBe(42)
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    rerender({ runLocked: false })
    expect(result.current.saveDisabledReason).toBeNull()
    expect(result.current.draftValue).toBe(42)
  })

  it('writes the edited element types with the definition', async () => {
    const { result, onSaveDefinition } = setupEdit({ row: { name: 'conf', type: 'map', value: { n: '16' } } })
    act(() => result.current.setDraftValue({ n: '17' }, { n: 'integer' }))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(
      expect.objectContaining({ value: { n: '17' }, elementTypes: { n: 'integer' } }),
    )
  })

  it('sends the edited element types with the Current value', async () => {
    const { result, onSaveCurrent } = setupEdit({ row: { name: 'items', type: 'array', value: ['1'] } })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(['2'], ['float']))
    await saveWindow(result)
    expect(currentWrite(onSaveCurrent)).toEqual({
      name: 'items',
      body: { value: ['2'], type: 'array', elementTypes: ['float'] },
      scope: null,
    })
  })

  it('writes a table in the stored form the editor hands it, to the definition and to the Current value', async () => {
    const STORED = { columns: [{ name: 'id', type: 'integer' }], rows: [['7']] }
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      row: { name: 'rows', type: 'table', value: [{ id: '1' }] },
    })
    act(() => result.current.setDraftValue(STORED))
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(STORED))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ value: STORED }))
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'rows', body: { value: STORED, type: 'table' }, scope: null })
  })
})

describe('useInspectCreate - the Current write and its scope (VMGR-19, VMGR-63, REQ-3.2.1.6)', () => {
  it('writes a Function local Current value to its own Function while the run is paused', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      row: { id: 'loc-1', name: 'loc_n', type: 'integer', value: 1 },
      scope: ['fn-1'],
      sessionId: 'sess-1',
      current: { value: 4, hasValue: true },
    })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(12))
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'loc_n', body: { value: 12, type: 'integer' }, scope: ['fn-1'] })
  })

  it('writes a Function input Current value to its own Function', async () => {
    const { result, onSaveCurrent } = setupEdit({
      mode: 'input',
      scope: ['fn-1', 'fn-2'],
      row: inputRow(),
      sessionId: 'sess-1',
      current: { value: 'eu', hasValue: true },
    })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue('us'))
    await saveWindow(result)
    expect(currentWrite(onSaveCurrent)).toEqual({
      name: 'region',
      body: { value: 'us', type: 'string' },
      scope: ['fn-1', 'fn-2'],
    })
  })

  it('writes an expression Current value as its source', async () => {
    const { result, onSaveCurrent } = setupEdit({
      row: { name: 'total', type: 'integer', value: 'a + 1', isExpression: true },
      sessionId: 'sess-1',
      current: { value: 7, hasValue: true, source: 'a + 1' },
    })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue('a + 5'))
    await saveWindow(result)
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'total', body: { expression: 'a + 5', type: 'integer' }, scope: null })
  })

  it('a rename while the run lives writes the Current value under the new name, after the definition', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      sessionId: 'sess-1',
      current: { value: 9, hasValue: true },
    })
    act(() => result.current.setDraftName('total'))
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(12))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ name: 'total' }))
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'total', body: { value: 12, type: 'integer' }, scope: null })
    expect(onSaveDefinition.mock.invocationCallOrder[0]).toBeLessThan(onSaveCurrent.mock.invocationCallOrder[0])
  })

  it('a rename alone while the run lives writes no Current value', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      sessionId: 'sess-1',
      current: { value: 9, hasValue: true },
    })
    act(() => result.current.setDraftName('total'))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ name: 'total' }))
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it('a type change while the run lives writes the definition and skips the Current value', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      sessionId: 'sess-1',
      current: { value: 9, hasValue: true },
    })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftType('string'))
    act(() => result.current.confirmTypeChange())
    act(() => result.current.setDraftValue('ten'))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ type: 'string' }))
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it('a Mark as secret change while the run lives writes the definition and skips the Current value', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      row: { name: 'token', type: 'string', value: 'abc' },
      sessionId: 'sess-1',
      current: { value: 'abc', hasValue: true },
    })
    act(() => result.current.setDraftSecret(true))
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue('xyz'))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ name: 'token', secret: true }))
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it('before a run a type change writes the definition and stages no Current value', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      sessionId: null,
      current: { value: 9, hasValue: true },
    })
    act(() => result.current.setDraftType('string'))
    act(() => result.current.confirmTypeChange())
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ type: 'string' }))
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it('before a run a rename writes the staged Current value under the new name, after the definition', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      sessionId: null,
      current: { value: 9, hasValue: true },
    })
    act(() => result.current.setDraftName('total'))
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue(12))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual(expect.objectContaining({ name: 'total' }))
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'total', body: { value: 12, type: 'integer' }, scope: null })
    expect(onSaveDefinition.mock.invocationCallOrder[0]).toBeLessThan(onSaveCurrent.mock.invocationCallOrder[0])
  })
})

describe('buildCurrentEditBody - the Current body of each kind', () => {
  const map: Variable = { id: 'v1', name: 'conf', type: 'map', value: {} }
  const counter: Variable = { id: 'v2', name: 'n', type: 'integer', value: 5 }

  it('carries a literal value with its element types', () => {
    expect(buildCurrentEditBody(map, { n: '1' }, { n: 'integer' })).toEqual({
      value: { n: '1' },
      type: 'map',
      elementTypes: { n: 'integer' },
    })
  })

  it('carries a literal value alone when it has no element types', () => {
    expect(buildCurrentEditBody(map, { n: '1' })).toEqual({ value: { n: '1' }, type: 'map' })
  })

  it('re-arms an expression source without element types', () => {
    expect(buildCurrentEditBody({ ...map, isExpression: true }, 'src', { n: 'integer' })).toEqual({
      expression: 'src',
      type: 'map',
    })
  })

  it('re-arms a template source', () => {
    expect(buildCurrentEditBody({ ...map, isTemplate: true }, 'tpl', { n: 'integer' })).toEqual({
      template: 'tpl',
      type: 'map',
    })
  })

  it.each([
    ['literal', {}],
    ['expression', { isExpression: true }],
    ['template', { isTemplate: true }],
  ] as const)('sends a null as a plain null value for the %s kind', (_kind, flags) => {
    expect(buildCurrentEditBody({ ...counter, ...flags }, null)).toEqual({ value: null, type: 'integer' })
  })

  it('drops the element types of a null value', () => {
    expect(buildCurrentEditBody(map, null, { n: 'integer' })).toEqual({ value: null, type: 'map' })
  })
})

// ===========================================================================
// A read-only definition (a Function opened in View, a drilled-in Shared Function) takes only a Current value
// ===========================================================================

describe('useInspectCreate - a read-only definition takes only a Current value (REQ-3.1.2.10)', () => {
  it('opens on the Current view', () => {
    const { result } = setupEdit({ definitionReadOnly: true, current: { value: 9, hasValue: true } })
    expect(result.current.valueView).toBe('current')
    expect(result.current.currentDraft).toEqual(expect.objectContaining({ value: 9 }))
  })

  it('keeps the Initial view selectable, showing the saved value', () => {
    const { result } = setupEdit({ definitionReadOnly: true, current: { value: 9, hasValue: true } })
    act(() => result.current.setValueView('initial'))
    expect(result.current.valueView).toBe('initial')
    expect(result.current.draftValue).toBe(5)
  })

  it('ignores a change to the Initial value', () => {
    const { result } = setupEdit({ definitionReadOnly: true, current: { value: 9, hasValue: true } })
    act(() => result.current.setValueView('initial'))
    act(() => result.current.setDraftValue(42))
    expect(result.current.draftValue).toBe(5)
    expect(result.current.dirty.definition).toBe(false)
  })

  it.each([
    ['name', (r: ReturnType<typeof setupEdit>['result']) => r.current.setDraftName('renamed')],
    ['type', (r: ReturnType<typeof setupEdit>['result']) => r.current.setDraftType('string')],
    ['kind', (r: ReturnType<typeof setupEdit>['result']) => r.current.setDraftKind('expression')],
    ['secret mark', (r: ReturnType<typeof setupEdit>['result']) => r.current.setDraftSecret(true)],
  ] as const)('ignores a change to the %s', (_field, change) => {
    const { result } = setupEdit({ definitionReadOnly: true, current: { value: 9, hasValue: true } })
    act(() => {
      change(result)
    })
    expect(result.current.draftName).toBe('count')
    expect(result.current.draftType).toBe('integer')
    expect(result.current.draftKind).toBe('literal')
    expect(result.current.draftSecret).toBe(false)
    expect(result.current.dirty.definition).toBe(false)
  })

  it('ignores a change to an input declaration', () => {
    const { result } = setupEdit({
      mode: 'input',
      row: inputRow(),
      definitionReadOnly: true,
      current: { value: 'us', hasValue: true },
    })
    act(() => result.current.setRequired(true))
    act(() => result.current.setDescription('changed'))
    act(() => result.current.setCreateEnum(true))
    expect(result.current.paramMeta).toEqual(expect.objectContaining({ required: false, description: '', createEnum: false }))
    expect(result.current.dirty.definition).toBe(false)
  })

  it('saves a changed Current value and never writes the definition', async () => {
    const { result, onSaveDefinition, onSaveCurrent, onSaved } = setupEdit({
      definitionReadOnly: true,
      scope: ['fn-1'],
      current: { value: 9, hasValue: true },
    })
    act(() => result.current.setDraftValue(12))
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'count', body: { value: 12, type: 'integer' }, scope: ['fn-1'] })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('sets the Current value to null', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      definitionReadOnly: true,
      current: { value: 9, hasValue: true },
    })
    act(() => result.current.setDraftNull(true))
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'count', body: { value: null, type: 'integer' }, scope: null })
  })

  it('writes nothing when nothing changed', async () => {
    const { result, onSaveDefinition, onSaveCurrent, onSaved } = setupEdit({
      definitionReadOnly: true,
      current: { value: 9, hasValue: true },
    })
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledTimes(1)
  })
})

describe('useInspectCreate - a read-only definition keeps its declaration and stored secret', () => {
  it('ignores a change to the allowed values', () => {
    const { result } = setupEdit({
      mode: 'input',
      scope: ['fn-1'],
      row: ENV_ROW,
      definitionReadOnly: true,
      current: { value: 'dev', hasValue: true },
    })
    act(() => result.current.setEnumValues(['qa']))
    expect(result.current.paramMeta.enumValues).toEqual(['dev', 'staging', 'prod'])
    expect(result.current.dirty.definition).toBe(false)
  })

  it('keeps the stored secret masked when "Delete & Edit" is asked on the Initial value', () => {
    const { result } = setupEdit({
      row: { name: 'token', type: 'string', value: '********', isSecret: true },
      definitionReadOnly: true,
    })
    act(() => result.current.setValueView('initial'))
    act(() => result.current.clearSecret())
    expect(result.current.secretFace).toBe('masked')
    expect(result.current.dirty.definition).toBe(false)
  })
})

describe('useInspectCreate - "Delete & Edit" on the Current value (REQ-3.1.3.5)', () => {
  it('replaces only the Current value and leaves the stored definition masked', async () => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({
      row: { name: 'token', type: 'string', value: '********', isSecret: true },
      sessionId: 'sess-1',
      current: { value: '********', hasValue: true },
    })
    act(() => result.current.setValueView('current'))
    expect(result.current.secretFace).toBe('masked')
    act(() => result.current.clearSecret())
    expect(result.current.secretFace).toBe('write-only')
    expect(result.current.dirty).toEqual({ definition: false, current: false })
    act(() => result.current.setValueView('initial'))
    expect(result.current.secretFace).toBe('masked')
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftValue('n3w'))
    await saveWindow(result)
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(currentWrite(onSaveCurrent)).toEqual({ name: 'token', body: { value: 'n3w', type: 'string' }, scope: null })
  })
})

describe('useInspectCreate - a source with no value in Edit (REQ-3.1.3.13)', () => {
  it('opens an expression that has no source on an empty source, never on Set to null', () => {
    const { result } = setupEdit({ row: { name: 'total', type: 'integer', value: undefined, isExpression: true } })
    expect(result.current.draftKind).toBe('expression')
    expect(result.current.draftNull).toBe(false)
    expect(result.current.draftValue).toBe('')
  })
})

describe('useInspectCreate - a Kind change in Edit starts both values over (VMGR-108)', () => {
  const EXPR_ROW: Partial<WindowRow> = { name: 'expr_n', type: 'integer', value: 'n_int + 1', isExpression: true }
  const EXPR_CURRENT: CurrentSeed = { value: 43, hasValue: true, source: 'n_int + 1' }

  it('asks to confirm and keeps the Kind and both values until confirmed', () => {
    const { result } = setupEdit({ row: EXPR_ROW, current: EXPR_CURRENT })
    act(() => result.current.setDraftKind('literal'))
    expect(result.current.pendingKindChange).toEqual({
      prevKind: 'expression',
      nextKind: 'literal',
      type: 'integer',
      currentLength: 1,
    })
    expect(result.current.draftKind).toBe('expression')
    expect(result.current.initialDraft.value).toBe('n_int + 1')
    expect(result.current.currentDraft.value).toBe('n_int + 1')
  })

  it("confirming Literal starts the Initial and the Current value on the type's default, as a new variable does", () => {
    const { result } = setupEdit({ row: EXPR_ROW, current: EXPR_CURRENT })
    act(() => result.current.setDraftKind('literal'))
    act(() => result.current.confirmKindChange())
    expect(result.current.draftKind).toBe('literal')
    expect(result.current.pendingKindChange).toBeNull()
    expect(result.current.initialDraft).toMatchObject({ value: 0, isNull: false })
    expect(result.current.currentDraft).toMatchObject({ value: 0, isNull: false })
  })

  it('confirming Expression starts both values on an empty source', () => {
    const { result } = setupEdit({ current: { value: 9, hasValue: true } })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftKind('expression'))
    act(() => result.current.confirmKindChange())
    expect(result.current.initialDraft.value).toBe('')
    expect(result.current.currentDraft.value).toBe('')
  })

  it('canceling keeps the Kind and both values', () => {
    const { result } = setupEdit({ row: EXPR_ROW, current: EXPR_CURRENT })
    act(() => result.current.setDraftKind('literal'))
    act(() => result.current.cancelKindChange())
    expect(result.current.pendingKindChange).toBeNull()
    expect(result.current.draftKind).toBe('expression')
    expect(result.current.initialDraft.value).toBe('n_int + 1')
  })

  it('confirmKindChange is a no-op when nothing is pending', () => {
    const { result } = setupEdit()
    act(() => result.current.confirmKindChange())
    expect(result.current.draftKind).toBe('literal')
    expect(result.current.initialDraft.value).toBe(5)
  })

  it('a Kind change unticks Set to null on both values', () => {
    const { result } = setupEdit({ row: { value: null }, current: { value: null, hasValue: true } })
    expect(result.current.initialDraft.isNull).toBe(true)
    act(() => result.current.setDraftKind('expression'))
    act(() => result.current.confirmKindChange())
    expect(result.current.initialDraft).toMatchObject({ value: '', isNull: false })
    expect(result.current.currentDraft).toMatchObject({ value: '', isNull: false })
  })

  it('a type change in Edit unticks Set to null on both values', () => {
    const { result } = setupEdit({ row: { value: null }, current: { value: null, hasValue: true } })
    expect(result.current.currentDraft.isNull).toBe(true)
    act(() => result.current.setDraftType('string'))
    act(() => result.current.confirmTypeChange())
    expect(result.current.initialDraft).toMatchObject({ value: '', isNull: false })
    expect(result.current.currentDraft).toMatchObject({ value: '', isNull: false })
  })

  it.each([
    ['while the run lives', 'sess-1'],
    ['before a run', null],
  ] as const)('a Kind change %s writes the definition and skips the Current value', async (_when, sessionId) => {
    const { result, onSaveDefinition, onSaveCurrent } = setupEdit({ row: EXPR_ROW, sessionId, current: EXPR_CURRENT })
    act(() => result.current.setValueView('current'))
    act(() => result.current.setDraftKind('literal'))
    act(() => result.current.confirmKindChange())
    act(() => result.current.setDraftValue(7))
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual({ name: 'expr_n', type: 'integer', value: 0 })
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it('a Kind change on a saved secret clears the stored value on both views', async () => {
    const { result, onSaveDefinition } = setupEdit({
      row: { name: 'tok', type: 'integer', value: '********', isSecret: true, isExpression: true },
    })
    expect(result.current.secretFace).toBe('masked')
    act(() => result.current.setDraftKind('literal'))
    act(() => result.current.confirmKindChange())
    expect(result.current.secretFace).toBe('write-only')
    act(() => result.current.setValueView('current'))
    expect(result.current.secretFace).toBe('write-only')
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual({ name: 'tok', type: 'integer', value: 0, secret: true })
  })

  it('a type change on a saved secret clears the stored value on both views', async () => {
    const { result, onSaveDefinition } = setupEdit({
      row: { name: 'tok', type: 'string', value: '********', isSecret: true },
    })
    act(() => result.current.setDraftType('integer'))
    act(() => result.current.confirmTypeChange())
    expect(result.current.secretFace).toBe('write-only')
    act(() => result.current.setValueView('current'))
    expect(result.current.secretFace).toBe('write-only')
    await saveWindow(result)
    expect(savedSpec(onSaveDefinition)).toEqual({ name: 'tok', type: 'integer', value: 0, secret: true })
  })
})

describe('useInspectCreate - a Kind change in Add (VMGR-108)', () => {
  it('asks before clearing a list that holds entries', () => {
    const { result } = setup()
    act(() => result.current.setDraftType('array'))
    act(() => result.current.setDraftValue(['a', 'b']))
    act(() => result.current.setDraftKind('expression'))
    expect(result.current.pendingKindChange).toEqual({
      prevKind: 'literal',
      nextKind: 'expression',
      type: 'array',
      currentLength: 2,
    })
    act(() => result.current.confirmKindChange())
    expect(result.current.draftKind).toBe('expression')
    expect(result.current.draftValue).toBe('')
  })

  it('asks before clearing a table stored with its column types that holds rows', () => {
    const { result } = setup()
    act(() => result.current.setDraftType('table'))
    act(() => result.current.setDraftValue(STORED_TABLE))
    act(() => result.current.setDraftKind('expression'))
    expect(result.current.pendingKindChange).toEqual({
      prevKind: 'literal',
      nextKind: 'expression',
      type: 'table',
      currentLength: 2,
    })
  })

  it('switches at once on an empty list', () => {
    const { result } = setup()
    act(() => result.current.setDraftType('array'))
    act(() => result.current.setDraftKind('expression'))
    expect(result.current.pendingKindChange).toBeNull()
    expect(result.current.draftKind).toBe('expression')
  })

  it('switches a list expression back to Literal at once, on an empty list', () => {
    const { result } = setup()
    act(() => result.current.setDraftType('array'))
    act(() => result.current.setDraftKind('expression'))
    act(() => result.current.setDraftValue('items[1:]'))
    act(() => result.current.setDraftKind('literal'))
    expect(result.current.pendingKindChange).toBeNull()
    expect(result.current.draftKind).toBe('literal')
    expect(result.current.draftValue).toEqual([])
  })
})
