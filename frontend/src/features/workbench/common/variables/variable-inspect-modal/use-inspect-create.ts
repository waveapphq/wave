/**
 * useInspectCreate - the state machine of the one variable window: Add opens it empty, Edit opens it filled from a row.
 *
 * REQ-3.1.3.11: Variable Manager UI panel
 * REQ-3.1.3.20: Null is the only empty value
 * REQ-3.1.3.24: Set to null by hand
 * REQ-3.1.2.1: Create custom Functions with input parameters
 * REQ-3.1.2.10: Inputs with no default
 * REQ-3.1.2.11: Enum inputs
 * REQ-3.1.3.13: Computed variables with expressions
 * REQ-3.1.3.15: Template variables
 * REQ-3.1.3.19: Declared element types for array and map values
 * REQ-3.2.1.6: Runtime variable override during pause
 */

import { useRef, useState } from 'react'

import { typedListItem, type ListItemType } from '@/components/shared/variable-bodies/array-edit-body'
import { isEnumInput } from '@/features/functions/lib/enum-input'
import type { WorkbenchVariableOverrideBody } from '@/features/workbench/api/workbench'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import { validateVariableName } from '@/features/workbench/hooks/use-variable-name-validation'
import { getDefaultValueForType } from '@/lib/variable-defaults'
import { isNullValue, isSummaryEnvelope, sameStoredValue, valueToText } from '@/lib/variable-format'
import { toTableRenderModel } from '@/lib/variable-table-model'
import type { VariableType } from '@/lib/variable-types'
import type { ElementTypes } from '@/lib/variable-validation'
import { validateEnumValues } from './create-param-fields'
import { useFullVariableValue, type UseFullVariableValueResult } from './use-full-variable-value'

/** The window's kind of variable: a Test variable or Function local, or a Function input / output. */
export type VariableCreateMode = 'variable' | 'input' | 'output'

/** Value kind of a variable or an output; an input is always a literal. */
export type VariableCreateKind = 'literal' | 'expression' | 'template'

/** Which value the window edits (VMGR-108). */
export type WindowValueView = 'initial' | 'current'

/** Why Set to null is held on: a secret input has no default (VMGR-114). */
export type NullForcedBy = 'secret'

/** How a secret value shows: not secret, masked (stored, replaced but never shown) or write-only (cleared). */
export type WindowSecretFace = 'none' | 'masked' | 'write-only'

/** Function-parameter declaration fields (input / output modes). */
export interface ParamMeta {
  required: boolean
  createEnum: boolean
  enumValues: unknown[]
  description: string
}

/** A type switch awaiting confirmation. */
export interface PendingCreateTypeChange {
  prevType: VariableType
  nextType: VariableType
  currentLength: number
}

/** A Kind switch awaiting confirmation. */
export interface PendingCreateKindChange {
  prevKind: VariableCreateKind
  nextKind: VariableCreateKind
  type: VariableType
  currentLength: number
}

/** The definition the window writes: a new variable on Create, the whole changed definition on Save. */
export type VariableCreateSpec = {
  name: string
  type: VariableType
  /** Absent for an untouched source, a secret input and a Required input with no default; null when Set to null. */
  value?: unknown
  isExpression?: boolean
  isTemplate?: boolean
  secret?: boolean
  required?: boolean
  description?: string
  /** An enum input's allowed values, each of the input's type (REQ-3.1.2.11). */
  enumValues?: unknown[]
  /** Array / map with a value: each element's declared type (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

/** What the Current view shows when the window opens: live, else staged, else nothing. */
export interface WindowCurrentSeed {
  value: unknown
  hasValue: boolean
  elementTypes?: ElementTypes
  /** An expression's or template's active Current source. */
  source?: unknown
}

/** The row an Edit window opens on, with the scope it lives in and what its Current view shows. */
export interface WindowEditTarget {
  row: Variable
  /** Node ids of the Function instance the row lives in; null or empty at the Test root. */
  scope: string[] | null
  /** The row lives in a Function, also at a library View's root where its scope is empty. */
  inFunction?: boolean
  current?: WindowCurrentSeed
  /** A secret set in this session and not yet saved shows its own value. */
  secretUnlocked?: boolean
  /** The saved Test does not hold this secret's value yet (new, or a changed value). */
  secretChanged?: boolean
  /** Only the Current value can be changed. */
  definitionReadOnly?: boolean
}

/** One of the two values the window edits. */
export interface WindowValueDraft {
  value: unknown
  elementTypes?: ElementTypes
  isNull: boolean
}

/** A Save attempt: written, or the reason it was not (a refused or rejected write). */
export type WindowSaveOutcome = { saved: true } | { saved: false; problem: unknown }

export type DefinitionSaveResult = { success: boolean; error?: string }

export interface UseInspectCreateArgs {
  mode: VariableCreateMode
  /** Absent in Add. */
  editTarget?: WindowEditTarget
  sessionId?: string | null
  runLocked: boolean
  checkNameExists: (name: string, excludeId: string) => boolean
  validateExpressionCycle: (params: {
    variableName: string
    value: unknown
    isExpression: boolean
  }) => string | null
  onSaveDefinition: (spec: VariableCreateSpec) => DefinitionSaveResult
  onSaveCurrent: (
    name: string,
    body: WorkbenchVariableOverrideBody,
    functionPath?: string[],
  ) => void | Promise<void>
  /** Every write landed, or nothing needed writing. */
  onSaved: () => void
}

export interface UseInspectCreate {
  mode: VariableCreateMode
  definitionReadOnly: boolean
  valueView: WindowValueView
  setValueView: (view: WindowValueView) => void
  draftName: string
  draftType: VariableType
  draftKind: VariableCreateKind
  /** The shown view's value and element types. */
  draftValue: unknown
  draftElementTypes: ElementTypes | undefined
  initialDraft: WindowValueDraft
  currentDraft: WindowValueDraft
  /** Mark as secret as it applies: never on while Create enum is set. */
  draftSecret: boolean
  /** Set to null of the shown view as it applies. */
  draftNull: boolean
  nullForced: NullForcedBy | null
  /** Set to null cannot be changed on the shown view. */
  nullLocked: boolean
  nullDisabledByEnum: boolean
  enumLocksSecret: boolean
  secretLocksEnum: boolean
  enumOn: boolean
  paramMeta: ParamMeta
  /** On a Required input's Default view an emptied field means no default (VMGR-113). */
  blankMeansNoDefault: boolean
  secretFace: WindowSecretFace
  /** The saved secret holds a value that unticking Mark as secret deletes. */
  holdsSavedSecret: boolean
  /** Save turns a saved plain variable secret (VMGR-109). */
  makesSecret: boolean
  /** The saved name while a valid new one is typed. */
  renamedFrom: string | null
  isValid: boolean
  bodyValid: boolean
  /** Remounts the value field when the value it edits is replaced. */
  valueFieldKey: string
  allowedValuesKey: string
  valueProblems: string[]
  /** The Allowed values problem, shown under the list. */
  enumError: string | null
  /** The enum select of the shown view holds no allowed value. */
  enumValueError: string | null
  errors: { name: string | null; cycle: string | null; submit: string | null }
  pendingTypeChange: PendingCreateTypeChange | null
  pendingKindChange: PendingCreateKindChange | null
  dirty: { definition: boolean; current: boolean }
  /** The Initial value (an input's Default) differs from the one the window opened on, or its stored secret was cleared. */
  initialValueChanged: boolean
  saveDisabledReason: string | null
  saving: boolean
  setDraftName: (name: string) => void
  setDraftType: (type: VariableType) => void
  setDraftKind: (kind: VariableCreateKind) => void
  setDraftValue: (value: unknown, elementTypes?: ElementTypes) => void
  setBodyValid: (valid: boolean) => void
  setValueProblems: (messages: string[]) => void
  setAllowedValuesProblems: (messages: string[]) => void
  setDraftSecret: (secret: boolean) => void
  setDraftNull: (next: boolean) => void
  setRequired: (required: boolean) => void
  setCreateEnum: (createEnum: boolean) => void
  setEnumValues: (values: unknown[]) => void
  setDescription: (description: string) => void
  /** "Delete & Edit": the stored secret of the shown view is replaced by an empty value. */
  clearSecret: () => void
  confirmTypeChange: () => void
  cancelTypeChange: () => void
  confirmKindChange: () => void
  cancelKindChange: () => void
  handleExpressionBlur: () => void
  buildSpec: () => VariableCreateSpec
  /** A Save that reports why it did not write. */
  trySave: () => Promise<WindowSaveOutcome>
  /** Returns the window to the saved state it opened on. */
  reset: () => void
}

export const RUN_LOCK_REASON = 'Locked while the test is executing'
const ENUM_DEFAULT_REQUIRED = 'Default value is required'
const ENUM_CURRENT_REQUIRED = 'Current value is required'
const INVALID_VALUE = 'Enter a valid value'

// The shared validator only checks duplicates for a truthy id; Add has no row to exclude.
const CREATE_EXCLUDE_ID = '__create__'

const COMPLEX_TYPES = new Set<VariableType>(['array', 'map', 'table'])
const ENUM_TYPES = new Set<VariableType>(['string', 'integer', 'float'])

/** An input of this type can be an enum (VMGR-112). */
export function isEnumerableType(type: VariableType): boolean {
  return ENUM_TYPES.has(type)
}

/** The Current body of a variable's kind: null as a plain null, a source re-armed, a literal with its element types. */
export function buildCurrentEditBody(
  variable: Variable,
  value: unknown,
  elementTypes?: ElementTypes,
): WorkbenchVariableOverrideBody {
  if (isNullValue(value)) return { value: null, type: variable.type }
  if (variable.isTemplate) return { template: valueToText(value), type: variable.type }
  if (variable.isExpression) return { expression: valueToText(value), type: variable.type }
  return elementTypes === undefined
    ? { value, type: variable.type }
    : { value, type: variable.type, elementTypes }
}

interface ValueState {
  value: unknown
  elementTypes?: ElementTypes
  nullTicked: boolean
}

interface DefinitionDraft {
  name: string
  type: VariableType
  kind: VariableCreateKind
  secret: boolean
  required: boolean
  createEnum: boolean
  enumValues: unknown[]
  description: string
}

interface WindowState {
  definition: DefinitionDraft
  initial: ValueState
  /** Null while untouched: the Current value follows its seed, a late full read included. */
  current: ValueState | null
  /** An Add source untouched by the person is created without a value. */
  valueEdited: boolean
  /** "Delete & Edit" replaced the stored secret, per view. */
  secretCleared: Record<WindowValueView, boolean>
  /** Counts the times the values were replaced from the saved state. */
  epoch: number
}

interface Problems {
  key: string
  messages: string[]
}

const NO_PROBLEMS: Problems = { key: '', messages: [] }

function sameValueState(left: ValueState, right: ValueState): boolean {
  if (left.nullTicked !== right.nullTicked) return false
  return left.nullTicked || (sameStoredValue(left.value, right.value) && sameStoredValue(left.elementTypes ?? null, right.elementTypes ?? null))
}

function sameDefinition(left: DefinitionDraft, right: DefinitionDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** The value a kind starts from: a literal the type default, a source empty text. */
function startValueFor(type: VariableType, kind: VariableCreateKind): unknown {
  return kind === 'literal' ? getDefaultValueForType(type) : ''
}

/** A Required input with no default: an empty field, a true/false one False (VMGR-113). */
function emptyDefault(type: VariableType): unknown {
  return type === 'boolean' ? false : ''
}

/** Entry count of a value a type change clears: list length, table rows, map keys, one for a scalar. */
function valueLength(value: unknown, type: VariableType): number {
  if (type === 'map') {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>).length
      : 0
  }
  if (type === 'table') return toTableRenderModel(value).rows.length
  if (COMPLEX_TYPES.has(type)) return Array.isArray(value) ? value.length : 0
  return 1
}

/** A Type switch reads every allowed value again as the new type. */
function retypeList(list: unknown[], type: VariableType): unknown[] {
  return list.map((item) => typedListItem(valueToText(item), type as ListItemType))
}

// An empty text is never a pick, even while the list being typed holds one.
function allowsValue(enumValues: unknown[], draft: ValueState): boolean {
  return !draft.nullTicked && draft.value !== '' && enumValues.some((allowed) => sameStoredValue(allowed, draft.value))
}

function kindOfRow(mode: VariableCreateMode, row: Variable): VariableCreateKind {
  if (mode === 'input') return 'literal'
  if (row.isTemplate) return 'template'
  return row.isExpression ? 'expression' : 'literal'
}

function isSavedSecret(target: WindowEditTarget): boolean {
  return !!target.row.isSecret && !target.secretUnlocked
}

/** The Initial value an Edit window opens on; a saved secret opens on its type's empty value, never the mask. */
function initialSeed(mode: VariableCreateMode, target: WindowEditTarget): ValueState {
  const { row } = target
  if (isSavedSecret(target)) return { value: getDefaultValueForType(row.type), nullTicked: false }
  if (kindOfRow(mode, row) !== 'literal') return { value: row.value ?? '', nullTicked: false }
  if (!isNullValue(row.value)) return { value: row.value, elementTypes: row.elementTypes, nullTicked: false }
  // REQ-3.1.3.20: no value opens like a null; a Required input opens with no default, a true / false input on False.
  if (mode === 'input' && (row.required || isEnumInput(row) || row.type === 'boolean')) {
    return { value: emptyDefault(row.type), nullTicked: false }
  }
  return { value: getDefaultValueForType(row.type), nullTicked: true }
}

/** The Current value an Edit window opens on: an expression's active source, the live or staged value, else Initial. */
function currentSeed(
  mode: VariableCreateMode,
  target: WindowEditTarget,
  full: Pick<UseFullVariableValueResult, 'fullValue' | 'fullElementTypes'>,
): ValueState {
  const base = initialSeed(mode, target)
  const { row, current } = target
  if (isSavedSecret(target)) return base
  if (kindOfRow(mode, row) !== 'literal') {
    return current?.source === undefined ? base : { value: current.source, nullTicked: false }
  }
  if (!current?.hasValue) return base
  // A live list, map or table arrives as a summary: edit its full read (REQ-3.2.2.18).
  if (isSummaryEnvelope(current.value)) {
    return { value: full.fullValue, elementTypes: full.fullElementTypes, nullTicked: false }
  }
  if (isNullValue(current.value)) return { value: getDefaultValueForType(row.type), nullTicked: true }
  return { value: current.value, elementTypes: current.elementTypes, nullTicked: false }
}

const ADD_DEFINITION: DefinitionDraft = {
  name: '',
  type: 'string',
  kind: 'literal',
  secret: false,
  required: false,
  createEnum: false,
  enumValues: [],
  description: '',
}

function seedState(mode: VariableCreateMode, target: WindowEditTarget | undefined, epoch: number): WindowState {
  const cleared = { initial: false, current: false }
  if (target === undefined) {
    return {
      definition: ADD_DEFINITION,
      initial: { value: startValueFor('string', 'literal'), nullTicked: false },
      current: null,
      valueEdited: false,
      secretCleared: cleared,
      epoch,
    }
  }
  const { row } = target
  const enumInput = mode === 'input' && isEnumInput(row)
  return {
    definition: {
      name: row.name,
      type: row.type,
      kind: kindOfRow(mode, row),
      secret: !!row.isSecret,
      required: mode === 'input' && (!!row.required || enumInput),
      createEnum: enumInput,
      enumValues: row.enumValues ?? [],
      description: row.description ?? '',
    },
    initial: initialSeed(mode, target),
    current: null,
    valueEdited: true,
    secretCleared: cleared,
    epoch,
  }
}

/** Ticking Required (VMGR-113): a null default or an untouched Add preset becomes no default. */
function requireDefault(state: WindowState, isEdit: boolean): ValueState {
  const { initial } = state
  const untouchedPreset = !isEdit && !state.valueEdited
  if (!initial.nullTicked && !untouchedPreset) return initial
  return { value: emptyDefault(state.definition.type), nullTicked: false }
}

function valueDraftOf(state: ValueState): WindowValueDraft {
  return { value: state.value, elementTypes: state.elementTypes, isNull: state.nullTicked }
}

/** A true / false input's default is never null (REQ-3.1.2.10), like an enum input's. */
function locksBooleanDefault(mode: VariableCreateMode, type: VariableType): boolean {
  return mode === 'input' && type === 'boolean'
}

/** What the definition switches on: enum, secret and Required, and the kind of its value. */
function definitionFlags(mode: VariableCreateMode, def: DefinitionDraft) {
  const enumOn = mode === 'input' && ENUM_TYPES.has(def.type) && def.createEnum
  const kind: VariableCreateKind = mode === 'input' ? 'literal' : def.kind
  return { enumOn, secretOn: def.secret && !enumOn, requiredOn: mode === 'input' && (def.required || enumOn), kind }
}

interface NullContext {
  input: boolean
  secretOn: boolean
  requiredOn: boolean
  /** The shown value is a true / false input's default. */
  booleanDefault: boolean
  onCurrentView: boolean
  readOnly: boolean
  shown: ValueState
  initial: ValueState
  current: ValueState
}

/** Set to null per view: a secret input has no default (VMGR-114); Required and enum hold it off on both values, a true / false input on its default. */
function nullFlags(c: NullContext) {
  const nullForced: NullForcedBy | null = c.input && c.secretOn && !c.onCurrentView ? 'secret' : null
  return {
    nullForced,
    nullLocked: nullForced !== null || c.requiredOn || c.booleanDefault || (c.readOnly && !c.onCurrentView),
    draftNull: nullForced !== null || (!c.requiredOn && c.shown.nullTicked),
    initialNull: (c.input && c.secretOn) || (!c.requiredOn && c.initial.nullTicked),
    currentNull: !c.requiredOn && c.current.nullTicked,
  }
}

function problemsFor(state: Problems, key: string): string[] {
  return state.key === key ? state.messages : []
}

/** The Allowed values problem, and the shown value's when it is no allowed value. */
function enumErrors(
  enumOn: boolean,
  def: DefinitionDraft,
  allowedValuesProblems: string[],
  view: { shown: ValueState; onCurrentView: boolean },
) {
  if (!enumOn) return { enumError: null, enumValueError: null }
  const enumError = allowedValuesProblems[0] ?? validateEnumValues(def.enumValues, def.type as ListItemType)
  if (allowsValue(def.enumValues, view.shown)) return { enumError, enumValueError: null }
  return { enumError, enumValueError: view.onCurrentView ? ENUM_CURRENT_REQUIRED : ENUM_DEFAULT_REQUIRED }
}

interface InvalidContext {
  nameError: string | null
  enumOn: boolean
  enumError: string | null
  enumValues: unknown[]
  initial: ValueState
  /** The Current value in Edit; null in Add. */
  current: ValueState | null
  draftNull: boolean
  valueProblems: string[]
  cycleError: string | null
}

/** The first reason Save is held: the name, the enum rules, then the shown value. */
function invalidReasonOf(c: InvalidContext): string | null {
  if (c.nameError !== null) return c.nameError
  if (c.enumOn) {
    if (c.enumError !== null) return c.enumError
    if (!allowsValue(c.enumValues, c.initial)) return ENUM_DEFAULT_REQUIRED
    if (c.current !== null && !allowsValue(c.enumValues, c.current)) return ENUM_CURRENT_REQUIRED
  }
  if (c.draftNull) return null
  return c.valueProblems[0] ?? c.cycleError
}

/** What differs from the state the window opened on: the Initial value, the definition, the Current value. */
function unsavedOf(
  state: WindowState,
  opening: WindowState,
  context: { seededCurrent: ValueState; readOnly: boolean; isEdit: boolean },
) {
  const initialValueChanged = state.secretCleared.initial || !sameValueState(state.initial, opening.initial)
  const definitionChanged = initialValueChanged || !sameDefinition(state.definition, opening.definition)
  return {
    initialValueChanged,
    definitionDirty: !context.readOnly && definitionChanged,
    currentDirty: context.isEdit && state.current !== null && !sameValueState(state.current, context.seededCurrent),
  }
}

function holdsStoredSecret(target: WindowEditTarget | undefined): boolean {
  return target !== undefined && isSavedSecret(target) && !isNullValue(target.row.value)
}

function secretFaceOf(holdsSecret: boolean, cleared: boolean): WindowSecretFace {
  if (!holdsSecret) return 'none'
  return cleared ? 'write-only' : 'masked'
}

/** The saved name a valid rename in Edit replaces; null when there is none to show. */
function renamedFromOf(target: WindowEditTarget | undefined, name: string, blocked: boolean): string | null {
  if (target === undefined || blocked || name === target.row.name) return null
  return target.row.name
}

export function useInspectCreate({
  mode,
  editTarget,
  sessionId,
  runLocked,
  checkNameExists,
  validateExpressionCycle,
  onSaveDefinition,
  onSaveCurrent,
  onSaved,
}: UseInspectCreateArgs): UseInspectCreate {
  const isEdit = editTarget !== undefined
  const readOnly = !!editTarget?.definitionReadOnly
  const [state, setState] = useState<WindowState>(() => seedState(mode, editTarget, 0))
  const [valueView, setValueView] = useState<WindowValueView>(readOnly ? 'current' : 'initial')
  // A saved expression is checked as the window opens (FIELD-12); later checks run on blur.
  const openingCycle = () => {
    const opening = seedState(mode, editTarget, 0)
    if (opening.definition.kind !== 'expression') return null
    return validateExpressionCycle({ variableName: opening.definition.name, value: opening.initial.value, isExpression: true })
  }
  const [cycleError, setCycleError] = useState<string | null>(openingCycle)
  const [pendingTypeChange, setPendingTypeChange] = useState<PendingCreateTypeChange | null>(null)
  const [pendingKindChange, setPendingKindChange] = useState<PendingCreateKindChange | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [valueProblemState, setValueProblemState] = useState<Problems>(NO_PROBLEMS)
  const [allowedProblemState, setAllowedProblemState] = useState<Problems>(NO_PROBLEMS)

  const row = editTarget?.row
  // The state the window opened on: the saved variable in Edit, the empty form in Add.
  const openingState = seedState(mode, editTarget, 0)
  const full = useFullVariableValue({
    sessionId,
    variableName: row?.name ?? '',
    runtimeValue: editTarget?.current?.value,
    hasRuntimeValue: editTarget?.current?.hasValue ?? false,
    isComplex: row !== undefined && COMPLEX_TYPES.has(row.type) && kindOfRow(mode, row) === 'literal',
    functionPath: editTarget?.scope ?? undefined,
  })

  const def = state.definition
  const { enumOn, secretOn, requiredOn, kind } = definitionFlags(mode, def)
  const seededCurrent = editTarget ? currentSeed(mode, editTarget, full) : state.initial
  const currentState = state.current ?? seededCurrent
  const onCurrentView = isEdit && valueView === 'current'
  const shown = onCurrentView ? currentState : state.initial
  const booleanDefault = locksBooleanDefault(mode, def.type) && !onCurrentView
  const { nullForced, nullLocked, draftNull, initialNull, currentNull } = nullFlags({
    input: mode === 'input',
    secretOn,
    requiredOn,
    booleanDefault,
    onCurrentView,
    readOnly,
    shown,
    initial: state.initial,
    current: currentState,
  })

  const valueFieldKey = `${valueView}:${draftNull}:${def.type}:${kind}:${state.epoch}`
  const allowedValuesKey = `${def.type}:${enumOn}:${state.epoch}`
  const valueProblems = problemsFor(valueProblemState, valueFieldKey)
  const bodyValid = valueProblems.length === 0

  const nameError = readOnly
    ? null
    : validateVariableName(def.name, {
        nameExists: checkNameExists,
        variableId: row?.id ?? CREATE_EXCLUDE_ID,
        variableName: row?.name,
        parameter: mode !== 'variable',
      })
  const { enumError, enumValueError } = enumErrors(enumOn, def, problemsFor(allowedProblemState, allowedValuesKey), {
    shown,
    onCurrentView,
  })
  const invalidReason = invalidReasonOf({
    nameError,
    enumOn,
    enumError,
    enumValues: def.enumValues,
    initial: state.initial,
    current: isEdit ? currentState : null,
    draftNull,
    valueProblems,
    cycleError,
  })
  const saveDisabledReason = isEdit && runLocked ? RUN_LOCK_REASON : invalidReason

  const { initialValueChanged, definitionDirty, currentDirty } = unsavedOf(state, openingState, {
    seededCurrent,
    readOnly,
    isEdit,
  })

  const holdsSavedSecret = holdsStoredSecret(editTarget)
  const secretFace = secretFaceOf(secretOn && holdsSavedSecret, state.secretCleared[onCurrentView ? 'current' : 'initial'])

  const updateValue = (view: WindowValueView, next: ValueState) =>
    setState((prev) => (view === 'current' ? { ...prev, current: next } : { ...prev, initial: next }))

  const setDraftName = (name: string) => {
    if (readOnly) return
    setState((prev) => ({ ...prev, definition: { ...prev.definition, name } }))
  }

  // In Edit a Type or Kind change starts both values over as a new variable's, a stored secret too (VMGR-108).
  const clearedSecret = (prev: WindowState) => (holdsSavedSecret ? { initial: true, current: true } : prev.secretCleared)

  const applyType = (next: VariableType) => {
    setState((prev) => {
      const prevDef = prev.definition
      const enumNext = mode === 'input' && ENUM_TYPES.has(next) && prevDef.createEnum
      const requiredNext = mode === 'input' && (prevDef.required || enumNext)
      return {
        ...prev,
        definition: {
          ...prevDef,
          type: next,
          kind: 'literal',
          enumValues: enumNext ? retypeList(prevDef.enumValues, next) : prevDef.enumValues,
        },
        initial: {
          value: requiredNext ? emptyDefault(next) : getDefaultValueForType(next),
          nullTicked: isEdit || locksBooleanDefault(mode, next) ? false : prev.initial.nullTicked,
        },
        current: isEdit ? { value: getDefaultValueForType(next), nullTicked: false } : prev.current,
        valueEdited: false,
        secretCleared: clearedSecret(prev),
      }
    })
    setCycleError(null)
  }

  const setDraftType = (next: VariableType) => {
    if (readOnly) return
    const currentLength = valueLength(state.initial.value, def.type)
    // In Edit every type change asks; in Add only a list, map or table that holds entries.
    if (isEdit || (COMPLEX_TYPES.has(def.type) && currentLength > 0)) {
      setPendingTypeChange({ prevType: def.type, nextType: next, currentLength })
      return
    }
    applyType(next)
  }

  const confirmTypeChange = () => {
    if (!pendingTypeChange) return
    applyType(pendingTypeChange.nextType)
    setPendingTypeChange(null)
  }

  const cancelTypeChange = () => setPendingTypeChange(null)

  // A kind switch starts the values over, so an expression never shows the literal preset.
  const applyKind = (next: VariableCreateKind) => {
    setState((prev) => {
      const value = startValueFor(prev.definition.type, next)
      return {
        ...prev,
        definition: { ...prev.definition, kind: next },
        initial: { value, nullTicked: isEdit ? false : prev.initial.nullTicked },
        current: isEdit ? { value, nullTicked: false } : prev.current,
        valueEdited: false,
        secretCleared: clearedSecret(prev),
      }
    })
    setCycleError(null)
  }

  // A Kind switch asks as a Type switch does: in Edit always, in Add only for a list, map or table with entries.
  const setDraftKind = (next: VariableCreateKind) => {
    if (readOnly) return
    const currentLength = valueLength(state.initial.value, def.type)
    if (isEdit || (def.kind === 'literal' && COMPLEX_TYPES.has(def.type) && currentLength > 0)) {
      setPendingKindChange({ prevKind: def.kind, nextKind: next, type: def.type, currentLength })
      return
    }
    applyKind(next)
  }

  const confirmKindChange = () => {
    if (!pendingKindChange) return
    applyKind(pendingKindChange.nextKind)
    setPendingKindChange(null)
  }

  const cancelKindChange = () => setPendingKindChange(null)

  const setDraftValue = (value: unknown, elementTypes?: ElementTypes) => {
    if (readOnly && !onCurrentView) return
    setCycleError(null)
    if (onCurrentView) {
      updateValue('current', { value, elementTypes, nullTicked: false })
      return
    }
    setState((prev) => {
      const next = { ...prev, initial: { value, elementTypes, nullTicked: false }, valueEdited: true }
      // Picking the default sets a Current value that is null or not allowed to it.
      const current = prev.current ?? seededCurrent
      if (isEdit && enumOn && !allowsValue(prev.definition.enumValues, current)) {
        next.current = { value, nullTicked: false }
      }
      return next
    })
  }

  const setValueProblems = (messages: string[]) => setValueProblemState({ key: valueFieldKey, messages })

  const setBodyValid = (valid: boolean) => setValueProblems(valid ? [] : [INVALID_VALUE])

  const setAllowedValuesProblems = (messages: string[]) =>
    setAllowedProblemState({ key: allowedValuesKey, messages })

  const setDraftNull = (next: boolean) => {
    if (nullLocked) return
    updateValue(onCurrentView ? 'current' : 'initial', { ...shown, nullTicked: next })
  }

  const setDraftSecret = (next: boolean) => {
    if (readOnly || (next && enumOn)) return
    // Mark as secret off on a saved secret clears its value to the type's default (VMGR-109).
    const clears = !next && editTarget !== undefined && isSavedSecret(editTarget)
    setState((prev) => ({
      ...prev,
      definition: { ...prev.definition, secret: next },
      initial: clears ? { value: getDefaultValueForType(prev.definition.type), nullTicked: false } : prev.initial,
    }))
  }

  const setRequired = (next: boolean) => {
    if (readOnly || (!next && enumOn)) return
    setState((prev) => ({
      ...prev,
      definition: { ...prev.definition, required: next },
      initial: next ? requireDefault(prev, isEdit) : prev.initial,
    }))
  }

  const setCreateEnum = (next: boolean) => {
    if (readOnly || mode !== 'input' || !ENUM_TYPES.has(def.type) || (next && secretOn)) return
    setState((prev) =>
      next
        ? {
            ...prev,
            definition: { ...prev.definition, createEnum: true, required: true, enumValues: [] },
            initial: requireDefault(prev, isEdit),
          }
        : { ...prev, definition: { ...prev.definition, createEnum: false } },
    )
  }

  const setEnumValues = (values: unknown[]) => {
    if (readOnly) return
    setState((prev) => ({
      ...prev,
      definition: { ...prev.definition, enumValues: values },
      // A default the list no longer holds returns to the empty select.
      initial: values.some((allowed) => sameStoredValue(allowed, prev.initial.value))
        ? prev.initial
        : { value: '', nullTicked: false },
    }))
  }

  const setDescription = (description: string) => {
    if (readOnly) return
    setState((prev) => ({ ...prev, definition: { ...prev.definition, description } }))
  }

  const clearSecret = () => {
    if (readOnly && !onCurrentView) return
    const view: WindowValueView = onCurrentView ? 'current' : 'initial'
    const empty = { value: getDefaultValueForType(def.type), nullTicked: false }
    setState((prev) => ({
      ...prev,
      initial: view === 'initial' ? empty : prev.initial,
      current: view === 'current' ? empty : prev.current,
      secretCleared: { ...prev.secretCleared, [view]: true },
    }))
  }

  const handleExpressionBlur = () => {
    if (kind !== 'expression') return
    setCycleError(validateExpressionCycle({ variableName: def.name, value: shown.value, isExpression: true }))
  }

  const buildSpec = (): VariableCreateSpec => {
    const spec: VariableCreateSpec = { name: def.name.trim(), type: def.type, ...specValue() }
    if (mode === 'input') spec.required = requiredOn
    if (mode !== 'variable') spec.description = def.description
    if (enumOn) spec.enumValues = def.enumValues
    if (secretOn) spec.secret = true
    return spec
  }

  // The Initial value part of a spec: nothing for a secret input or a Required input with no default.
  function specValue(): Pick<VariableCreateSpec, 'value' | 'isExpression' | 'isTemplate' | 'elementTypes'> {
    if (mode === 'input' && secretOn) return {}
    if (initialNull) return { value: null }
    const { value, elementTypes } = state.initial
    if (requiredOn && value === '') return {}
    if (kind === 'literal') return elementTypes === undefined ? { value } : { value, elementTypes }
    const source = state.valueEdited ? { value } : {}
    return kind === 'expression' ? { ...source, isExpression: true } : { ...source, isTemplate: true }
  }

  // The Current write of a Save, or null when there is none to send.
  const currentWrite = (): { name: string; body: WorkbenchVariableOverrideBody; scope?: string[] } | null => {
    if (editTarget === undefined || !currentDirty) return null
    const saved = editTarget.row
    const sessionLive = !!sessionId
    // VMGR-19: a live run keeps its own type, kind and secrecy; a retype or a Kind change drops the staged value too.
    const reshaped = def.type !== saved.type || kind !== kindOfRow(mode, saved)
    if (reshaped || (sessionLive && def.secret !== !!saved.isSecret)) return null
    const variable = { ...saved, isExpression: kind === 'expression', isTemplate: kind === 'template' }
    const scope = editTarget.scope
    return {
      // The definition write runs first, so the host already maps the new name to the one the run declared.
      name: def.name.trim(),
      body: buildCurrentEditBody(variable, currentNull ? null : currentState.value, currentState.elementTypes),
      scope: scope && scope.length > 0 ? scope : undefined,
    }
  }

  const trySave = async (): Promise<WindowSaveOutcome> => {
    if (savingRef.current) return { saved: false, problem: new Error('A save is already in progress') }
    if (saveDisabledReason !== null) return { saved: false, problem: new Error(saveDisabledReason) }
    const writeDefinition = !isEdit || definitionDirty
    const current = currentWrite()
    if (!writeDefinition && current === null) {
      onSaved()
      return { saved: true }
    }
    savingRef.current = true
    setSaving(true)
    setSubmitError(null)
    // The host reports a rejected Current write; the window stays open with its drafts.
    const outcome = await writeSave(writeDefinition, current).catch(
      (error: unknown): WindowSaveOutcome => ({ saved: false, problem: error }),
    )
    savingRef.current = false
    setSaving(false)
    return outcome
  }

  const writeSave = async (
    writeDefinition: boolean,
    current: ReturnType<typeof currentWrite>,
  ): Promise<WindowSaveOutcome> => {
    if (writeDefinition) {
      const result = onSaveDefinition(buildSpec())
      if (!result.success) {
        setSubmitError(result.error ?? null)
        return { saved: false, problem: new Error(result.error ?? `"${def.name.trim()}" was not saved`) }
      }
    }
    if (current !== null) await onSaveCurrent(current.name, current.body, current.scope)
    onSaved()
    return { saved: true }
  }

  const reset = () => {
    setState((prev) => seedState(mode, editTarget, prev.epoch + 1))
    setCycleError(openingCycle())
    setPendingTypeChange(null)
    setPendingKindChange(null)
    setSubmitError(null)
  }

  return {
    mode,
    definitionReadOnly: readOnly,
    valueView,
    setValueView,
    draftName: def.name,
    draftType: def.type,
    draftKind: kind,
    draftValue: shown.value,
    draftElementTypes: shown.elementTypes,
    initialDraft: valueDraftOf(state.initial),
    currentDraft: valueDraftOf(currentState),
    draftSecret: secretOn,
    draftNull,
    nullForced,
    nullLocked,
    nullDisabledByEnum: enumOn || booleanDefault,
    enumLocksSecret: enumOn,
    secretLocksEnum: mode === 'input' && secretOn,
    enumOn,
    paramMeta: { required: requiredOn, createEnum: enumOn, enumValues: def.enumValues, description: def.description },
    blankMeansNoDefault: requiredOn && !enumOn && !onCurrentView && !readOnly,
    secretFace,
    holdsSavedSecret,
    makesSecret: isEdit && !readOnly && secretOn && !row?.isSecret,
    renamedFrom: renamedFromOf(editTarget, def.name, readOnly || nameError !== null),
    isValid: invalidReason === null,
    bodyValid,
    valueFieldKey,
    allowedValuesKey,
    valueProblems,
    enumError,
    enumValueError,
    errors: { name: nameError, cycle: cycleError, submit: submitError },
    pendingTypeChange,
    pendingKindChange,
    dirty: { definition: definitionDirty, current: currentDirty },
    initialValueChanged,
    saveDisabledReason,
    saving,
    setDraftName,
    setDraftType,
    setDraftKind,
    setDraftValue,
    setBodyValid,
    setValueProblems,
    setAllowedValuesProblems,
    setDraftSecret,
    setDraftNull,
    setRequired,
    setCreateEnum,
    setEnumValues,
    setDescription,
    clearSecret,
    confirmTypeChange,
    cancelTypeChange,
    confirmKindChange,
    cancelKindChange,
    handleExpressionBlur,
    buildSpec,
    trySave,
    reset,
  }
}
