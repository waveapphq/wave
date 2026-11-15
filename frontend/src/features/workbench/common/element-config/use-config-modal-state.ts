/**
 * useConfigModalState - State management hook for ElementConfigModal
 *
 * Extracts all useState, useCallback, useMemo, and useRef logic from the
 * main component to keep index.tsx as a thin orchestrator.
 */

import { useState, useCallback, useMemo, useRef, type RefObject, type SetStateAction } from 'react'
import { blockInputParams, blockOutputParams } from '@/features/workbench/lib/node-parameters'
import { gateHaltScopeForContext } from '@/features/workbench/lib/node-parameters/scope-context'
import { pythonInputVariableDoc } from '@/features/workbench/lib/python-input-variable-docs'
import { resolveOutputType } from '@/features/workbench/lib/node-parameters/output-type'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type { ProfileBinding } from './dialogs/profile-binding-modal'
import type { SecretMaskingSetting } from '@/features/workbench/lib/node-parameters/secret-reveal'
import type { InputParam } from '@/features/workbench/lib/node-parameters/types'
import { blankEntryMessage } from '@/features/workbench/lib/node-parameters/field-modes'
import { controlFieldMessages, controlProblems } from '@/features/workbench/lib/validation/control-checks'
import { isValueNonEmpty } from '@/features/workbench/lib/validation/compute-node-issues'
import type { ElementData, SaveData, OutputTableParameter } from './types'
import {
  assembleSaveData,
  buildSaveData,
  computeHasChanges,
  validateOutputBindings,
  type SaveContext,
} from './save-logic'
import { replayListWrite, replayRecordWrite } from '@/lib/child-editors'
import { followRecord, followValue, sameStored } from '@/lib/draft-follow'
import { useStoredFollow } from '@/hooks/use-stored-follow'
import { isParameterRequired, isParameterVisible, type Parameter } from './parameters/parameter-table-types'
import type { AvailableVariable } from './expressions/expression-field'
import { useEnrichedVariables } from './use-enriched-variables'
import { useOutputList } from './use-output-list'
import type { ElementTypes } from '@/lib/variable-validation'

const NO_ELEMENT_TYPES: Record<string, ElementTypes> = {}
const NO_FIELDS: string[] = []

/** The fields each Block draws outside the parameter table, in its own section or editor. */
const DRAWN_OUTSIDE_TABLE: Readonly<Partial<Record<string, readonly string[]>>> = {
  assert: ['assertions', 'mode', 'fail_current_scope'],
  'if-else': ['branches'],
  'switch-case': ['branches'],
  parallel: ['branches', 'join'],
  while: ['conditions'],
  'wait-until': ['conditions', 'mode', 'fail_current_scope'],
  'for-each': ['collection_type'],
  'variable-setter': ['variables'],
}

const TRANSFORM_FIELDS = ['sorts', 'filters']
const QUERY_PARSER_FIELDS = ['queries', 'query_output_types', 'output_mode']

/** The windows that open wide, so a condition row, a Setter row or a lane row fits (REQ-3.1.1.5, FIELD-16). */
const WIDE_WINDOW_TYPES = new Set(['if-else', 'switch-case', 'assert', 'while', 'wait-until', 'variable-setter', 'parallel'])

/** A field value holds something, as the canvas required rule reads it; blank text never does. */
function fillsField(value: unknown, type: string): boolean {
  if (typeof value === 'string' && value.trim() === '') return false
  return isValueNonEmpty(value, type)
}

/** True when a visible required field holds nothing: an explicit null fills a field that takes null (REQ-3.1.3.21). */
function hasEmptyRequiredValue(
  checked: Parameter[],
  parameters: Parameter[],
  values: Record<string, unknown>,
  asWritten: ReadonlySet<string>,
): boolean {
  return checked.some((param) => {
    if (!isParameterVisible(param, values, parameters) || !isParameterRequired(param, values, parameters)) return false
    const value = values[param.name]
    if (value === null && param.acceptsNull) return false
    if (value === undefined || value === null) {
      return param.defaultValue === undefined || param.defaultValue === null || !fillsField(param.defaultValue, param.type)
    }
    // An {x} or Template field holds its text, whatever the field's type.
    return !fillsField(value, asWritten.has(param.name) ? 'string' : param.type)
  })
}

/** The values a control check reads: a hidden Transform's filters hold nothing back. */
function checkedControlValues(values: Record<string, unknown>, transformShown: boolean): Record<string, unknown> {
  if (transformShown || !Object.hasOwn(values, 'filters')) return values
  const { filters: _hidden, ...rest } = values
  return rest
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A value that is nothing but one `{{name}}` reference (PYRUN-19). */
const BARE_VARIABLE_REFERENCE = /^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/

function mapEntries(source: unknown): [string, unknown][] {
  return Object.entries((source ?? {}) as object)
}

/** The map with `oldName` re-keyed in place, or null when it holds no such key. */
function renamedMapKey(
  source: unknown,
  oldName: string,
  newName: string,
): Record<string, unknown> | null {
  const entries = mapEntries(source)
  if (!entries.some(([key]) => key === oldName)) return null
  return Object.fromEntries(
    entries.map(([key, value]) => [key === oldName ? newName : key, value]),
  )
}

/** The Block data the one field lookup reads for the window's element at a version. */
function lookupData(element: ElementData, version: string): Record<string, unknown> {
  return { elementType: element.elementType, nodeType: element.nodeType, version }
}

/** Outputs the schema marks secret; seeds the instance list when none is stored (K8SCON-4). */
function schemaSecretOutputNames(element: ElementData): string[] {
  const outputs = blockOutputParams(lookupData(element, element.version)) ?? element.outputs
  return outputs.filter((out) => out.secret === true).map((out) => out.name)
}

/** The Secret boxes' seed while the Block stores no list; none once it stores one. */
function seededSecretFields(element: ElementData): string[] | undefined {
  return element.outputSecretFields === undefined ? schemaSecretOutputNames(element) : undefined
}

/** The fields an open child editor writes into, replayed apart from the form for a Run. */
interface ChildWrittenFields {
  values: Record<string, unknown>
  templateFields: string[]
  expressionFields: string[]
  profileBindings: ProfileBinding[]
}

interface ChildReplay {
  base: ChildWrittenFields
  draft: ChildWrittenFields
}

/** A child's write with nothing to fold: the whole value replaces the draft's. */
function replayWholeWrite<T>(_base: T, _draft: T, next: T): T {
  return next
}

/** A form field whose writes land on the replay draft, not the form, while a Run
 *  replays the open child editors. */
function useReplayedField<K extends keyof ChildWrittenFields>(
  replayRef: RefObject<ChildReplay | null>,
  field: K,
  fold: (
    base: ChildWrittenFields[K],
    draft: ChildWrittenFields[K],
    next: ChildWrittenFields[K],
  ) => ChildWrittenFields[K],
  initial: ChildWrittenFields[K],
): [ChildWrittenFields[K], (update: SetStateAction<ChildWrittenFields[K]>) => void] {
  const [value, setValue] = useState<ChildWrittenFields[K]>(initial)
  const write = useCallback(
    (update: SetStateAction<ChildWrittenFields[K]>) => {
      const replay = replayRef.current
      if (replay === null) {
        setValue(update)
        return
      }
      replay.draft[field] =
        typeof update === 'function'
          ? (update as (prev: ChildWrittenFields[K]) => ChildWrittenFields[K])(replay.draft[field])
          : fold(replay.base[field], replay.draft[field], update)
    },
    [replayRef, field, fold],
  )
  return [value, write]
}

function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/** The saved Template rows plus each blank `templateByDefault` row the author gave no kind (OS-5). */
function initialTemplateFields(element: ElementData): string[] {
  const saved = element.templateFields ?? []
  const expression = element.expressionFields ?? []
  const parameters: readonly Pick<InputParam, 'name' | 'templateByDefault'>[] =
    blockInputParams(lookupData(element, element.version)) ?? element.parameters
  const seeded = parameters
    .filter(
      (p) =>
        p.templateByDefault &&
        isBlankValue(element.currentValues[p.name]) &&
        !saved.includes(p.name) &&
        !expression.includes(p.name),
    )
    .map((p) => p.name)
  return [...new Set([...saved, ...seeded])]
}

/** The text an entry flag names: a list row (or a field of its record row), else a map value by its whole key. */
function entryText(held: unknown, entry: readonly string[]): unknown {
  if (Array.isArray(held)) {
    const row: unknown = held[Number(entry[0])]
    return entry.length === 1 ? row : (row as Record<string, unknown> | undefined)?.[entry.slice(1).join('.')]
  }
  return (held as Record<string, unknown> | undefined)?.[entry.join('.')]
}

/** The first blank {x} entry of each shown field: an entry has no default to fall back on (FIELD-13). */
function blankEntryErrors(
  values: Record<string, unknown>,
  expressionFields: readonly string[],
  shown: ReadonlySet<string>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const flag of expressionFields) {
    const [setting, ...entry] = flag.split('.')
    if (entry.length === 0 || !shown.has(setting) || setting in errors) continue
    const text = entryText(values[setting], entry)
    if (typeof text === 'string' && text.trim() === '') {
      errors[setting] = blankEntryMessage(setting, values[setting], entry[0])
    }
  }
  return errors
}

export function useConfigModalState(
  element: ElementData,
  onSave: (data: SaveData) => void,
  onClose: () => void,
  /** The block runs on the execution host: a Save stores nothing for its remote-locked rows (HTTP-13). */
  runsOnRemoteHost = false,
) {
  const [selectedVersion, setSelectedVersion] = useState(element.version)
  const [name, setName] = useState(element.name ?? '')
  const [description, setDescription] = useState(element.description ?? '')
  // While a Run replays the open child editors, their writes land here instead of the form.
  const replayRef = useRef<ChildReplay | null>(null)
  const [values, setValues] = useReplayedField(
    replayRef,
    'values',
    replayRecordWrite,
    element.currentValues,
  )
  const [outputBindings, setOutputBindings] = useState<Record<string, string>>(
    element.outputBindings
  )
  const [fieldErrorNames, setFieldErrorNames] = useState<string[]>([])
  const [showChangelog, setShowChangelog] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [profileBindings, setProfileBindings] = useReplayedField(
    replayRef,
    'profileBindings',
    replayWholeWrite,
    element.profileBindings ?? []
  )
  // A stored list (even empty - a deliberate reveal) wins over the schema seed.
  const [outputSecretFields, setOutputSecretFields] = useState<string[]>(
    () => element.outputSecretFields ?? schemaSecretOutputNames(element)
  )
  const [unmaskedSecretFields, setUnmaskedSecretFields] = useState<string[]>(
    element.unmaskedSecretFields ?? []
  )
  const [secretMasking, setSecretMasking] = useState<SecretMaskingSetting>(
    element.secretMasking ?? 'system'
  )
  const [expressionFields, setExpressionFields] = useReplayedField(
    replayRef,
    'expressionFields',
    replayListWrite,
    element.expressionFields ?? []
  )
  // The seeded kinds are the baseline, so opening a blank templateByDefault row is not a change.
  const storedTemplateFields = useMemo(() => initialTemplateFields(element), [element])
  const [templateFields, setTemplateFields] = useReplayedField(
    replayRef,
    'templateFields',
    replayListWrite,
    storedTemplateFields
  )
  // The Variable Setter rows marked secret, `variables.<row>`, stored under config (REQ-3.4.1.14).
  const [secretFields, setSecretFields] = useState<string[]>(element.secretFields ?? [])
  // The type each Setter row picked: the canvas declares a new target with it; never stored.
  const [setterRowTypes, setSetterRowTypes] = useState<Record<string, string>>({})
  // Bumped when the canvas changes the stored Setter, so its editor rebuilds its rows.
  const [setterRevision, setSetterRevision] = useState(0)
  const [settingElementTypesRecord, setSettingElementTypesRecord] = useState<
    Record<string, ElementTypes>
  >(element.elementTypes ?? NO_ELEMENT_TYPES)
  const setSettingElementTypes = useCallback(
    (name: string, types: ElementTypes | undefined) =>
      setSettingElementTypesRecord((prev) => {
        const { [name]: _dropped, ...rest } = prev
        return types === undefined ? rest : { ...rest, [name]: types }
      }),
    [],
  )
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const isVariableSetter = element.elementType === 'variable-setter'
  const [varSetterValid, setVarSetterValid] = useState(true)

  // The Block changed on the canvas under the open window: untouched fields, control lists, Setter rows and their flags follow.
  useStoredFollow(
    {
      values: element.currentValues,
      outputBindings: element.outputBindings,
      expressionFields: element.expressionFields ?? NO_FIELDS,
      templateFields: storedTemplateFields,
      elementTypes: element.elementTypes ?? NO_ELEMENT_TYPES,
      secretFields: element.secretFields ?? NO_FIELDS,
    },
    (base, next) => {
      if (isVariableSetter) {
        // The Setter's marks name its rows, so rows and marks follow together or not at all.
        const draft = {
          values, outputBindings, expressionFields, templateFields, elementTypes: settingElementTypesRecord, secretFields,
        }
        if (!sameStored(draft, base)) return
        setValues(next.values)
        setExpressionFields(next.expressionFields)
        setTemplateFields(next.templateFields)
        setSettingElementTypesRecord(next.elementTypes)
        setSecretFields(next.secretFields)
        setSetterRevision((revision) => revision + 1)
        return
      }
      setValues((draft) => followRecord(base.values, draft, next.values))
      setOutputBindings((draft) => followRecord(base.outputBindings, draft, next.outputBindings))
      setExpressionFields((draft) => followValue(base.expressionFields, draft, next.expressionFields))
      setTemplateFields((draft) => followValue(base.templateFields, draft, next.templateFields))
      setSettingElementTypesRecord((draft) => followRecord(base.elementTypes, draft, next.elementTypes))
      setSecretFields((draft) => followValue(base.secretFields, draft, next.secretFields))
    },
  )

  const isXmlParser = element.elementType === 'xml-parser'
  const [xmlQueryValid, setXmlQueryValid] = useState(true)

  const isJsonParser = element.elementType === 'json-parser'
  const [jsonQueryValid, setJsonQueryValid] = useState(true)

  const isAssert = element.elementType === 'assert'
  const isIfElse = element.elementType === 'if-else'
  const isSwitch = element.elementType === 'switch-case'
  const isBreakOrContinue = element.elementType === 'break' || element.elementType === 'continue'
  const isWhile = element.elementType === 'while'
  const isWaitUntil = element.elementType === 'wait-until'
  const isParallel = element.elementType === 'parallel'
  const wideWindow = WIDE_WINDOW_TYPES.has(element.elementType)

  // Get available variables enriched with output source info + profile bindings
  const enrichedVariables = useEnrichedVariables(profileBindings)

  // The active canvas is a Function body when drilled in or in Function View;
  // the Halt `function` scope is only offered there (see gateHaltScopeForContext).
  const drilled = useWorkflowStore((s) => s.drillPath.length > 0)
  const functionView = useWorkflowStore((s) => s.functionViewMode !== null)

  // Get version-specific parameters
  const versionParameters = useMemo(() => {
    const params = blockInputParams(lookupData(element, selectedVersion)) ?? element.parameters
    return gateHaltScopeForContext(element.elementType, params, { drilled, functionView })
  }, [element, selectedVersion, drilled, functionView])

  // A schema that declares `sorts` drives the Transform sections instead of the
  // parameter table; the sections render while that param is visible.
  const transformParameter = useMemo(
    () => versionParameters.find((p) => p.name === 'sorts'),
    [versionParameters]
  )
  const showTransformSections =
    transformParameter !== undefined &&
    isParameterVisible(transformParameter, values, versionParameters)

  // A bound table always carries column names, so the header input only decides
  // whether that row is written out - it never removes the names.
  const transformOnBoundTable = useMemo(
    () =>
      versionParameters.some(
        (p) => p.type === 'table' && p.name === 'table' && isParameterVisible(p, values, versionParameters)
      ),
    [versionParameters, values]
  )

  // The table leaves out every field the window draws in its own section or editor.
  const displayParameters = useMemo(() => {
    const outside = new Set([
      ...(DRAWN_OUTSIDE_TABLE[element.elementType] ?? []),
      ...(transformParameter ? TRANSFORM_FIELDS : []),
      ...(isXmlParser || isJsonParser ? QUERY_PARSER_FIELDS : []),
    ])
    // An output list is edited under Output Variables, never in the input table.
    return versionParameters.filter((p) => p.outputList === undefined && !outside.has(p.name))
  }, [element.elementType, transformParameter, isXmlParser, isJsonParser, versionParameters])

  // Get version-specific outputs
  const versionOutputs = useMemo(
    () => blockOutputParams(lookupData(element, selectedVersion)) ?? element.outputs,
    [element, selectedVersion],
  )

  // Author-declared export rows, held apart and merged into the form state at save.
  const outputList = useOutputList(
    element, versionParameters, versionOutputs, values, outputBindings, outputSecretFields, enrichedVariables,
  )
  const { values: mergedValues, outputBindings: mergedBindings, outputSecretFields: mergedSecretFields } =
    outputList.merged
  const { mergeValues: mergeOutputList } = outputList

  // Convert outputs to parameter format for the table
  const outputParameters: OutputTableParameter[] = useMemo(() => {
    const isQueryParser = isXmlParser || isJsonParser
    const queryOutputMode = isQueryParser ? String((values.output_mode as string | undefined) ?? 'combined') : ''
    const isIndividual = queryOutputMode === 'individual'

    // An output the schema gates on an input (a converter's operation) is offered
    // for binding only while that input matches.
    return versionOutputs
      .filter((out) => !(isIndividual && out.name === 'results'))
      .filter((out) => isParameterVisible(out, values, versionParameters))
      .map((out) => ({
        name: out.name,
        label: out.label,
        type: resolveOutputType(out.type, out.typeWhen, values, versionParameters) as OutputTableParameter['type'],
        description: out.description,
        required: false as const,
      }))
  }, [versionOutputs, versionParameters, isXmlParser, isJsonParser, values])

  // Fixed outputs plus one entry per export row, typed by its bound variable.
  const bindingParameters = useMemo(
    () => [...outputParameters, ...outputList.bindingParameters],
    [outputParameters, outputList.bindingParameters],
  )

  // Track field-level validation by field, so a Run can set its own script aside.
  const handleFieldValidationChange = useCallback(
    (state: { isValid: boolean; errors: Record<string, string> }) => {
      setFieldErrorNames(Object.keys(state.errors))
    },
    []
  )

  // Live output-binding type errors. Recomputes as the user picks variables;
  // surfaced inline under each parameter row and gates the Save button.
  const outputErrors = useMemo(
    () => validateOutputBindings(bindingParameters, mergedBindings, enrichedVariables),
    [bindingParameters, mergedBindings, enrichedVariables],
  )
  const outputBindingsValid = Object.keys(outputErrors).length === 0

  // A blank {x} entry of a shown row holds the Save, naming the entry (FIELD-13); so do the
  // control lines the field list cannot say (a For step of 0, a blank {x} lane limit).
  const entryErrors = useMemo(() => {
    const shown = new Set(
      displayParameters.filter((p) => isParameterVisible(p, values, versionParameters)).map((p) => p.name),
    )
    return {
      ...blankEntryErrors(values, expressionFields, shown),
      ...controlFieldMessages(element.elementType, values, expressionFields),
    }
  }, [displayParameters, values, versionParameters, expressionFields, element.elementType])

  // Condition rows, branches and lanes the shared control check refuses hold the Save (REQ-3.5.0.3).
  const controlValid = useMemo(
    () =>
      controlProblems(
        element.elementType,
        checkedControlValues(values, showTransformSections),
        expressionFields,
      ).length === 0,
    [element.elementType, values, showTransformSections, expressionFields],
  )

  // Required fields filled and every field-level check passing, optionally setting one field aside.
  const isFormValidBesides = useCallback((besides?: string) => {
    if (fieldErrorNames.some((field) => field !== besides)) return false
    if (Object.keys(entryErrors).some((field) => field !== besides)) return false
    if (!outputBindingsValid || !outputList.valid || !controlValid) return false
    const editorChecks = [
      isVariableSetter && !varSetterValid,
      isXmlParser && !xmlQueryValid,
      isJsonParser && !jsonQueryValid,
    ]
    if (editorChecks.some(Boolean)) return false
    const checked = versionParameters.filter((p) => p.name !== besides)
    const asWritten = new Set([...expressionFields, ...templateFields])
    return !hasEmptyRequiredValue(checked, versionParameters, values, asWritten)
  }, [versionParameters, values, expressionFields, templateFields, fieldErrorNames, entryErrors, outputBindingsValid, outputList.valid, controlValid, isVariableSetter, varSetterValid, isXmlParser, xmlQueryValid, isJsonParser, jsonQueryValid])
  const isFormValid = isFormValidBesides()

  // Get details for the currently selected version
  const selectedVersionDetails = useMemo(() => {
    if (!element.versions) return undefined
    const versionEntry = element.versions.find((v) => v.version === selectedVersion)
    return versionEntry?.details
  }, [element.versions, selectedVersion])

  const handleInputChange = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }, [setValues])

  /* v8 ignore start - COV-CONTAINER-016 */
  const handleOutputChange = useCallback((name: string, value: unknown) => {
    setOutputBindings((prev) => ({ ...prev, [name]: String(value) }))
  }, [])
  /* v8 ignore stop */

  // Track if there are unsaved changes
  const hasChanges = useMemo(() => computeHasChanges({
    selectedVersion, elementVersion: element.version,
    name, elementName: element.name,
    description, elementDescription: element.description,
    values: mergedValues, elementCurrentValues: element.currentValues,
    outputBindings: mergedBindings, elementOutputBindings: element.outputBindings,
    profileBindings, elementProfileBindings: element.profileBindings,
    expressionFields, elementExpressionFields: element.expressionFields,
    templateFields, elementTemplateFields: storedTemplateFields,
    secretFields, elementSecretFields: element.secretFields,
    outputSecretFields: mergedSecretFields, elementOutputSecretFields: element.outputSecretFields ?? schemaSecretOutputNames(element),
    unmaskedSecretFields, elementUnmaskedSecretFields: element.unmaskedSecretFields,
    secretMasking, elementSecretMasking: element.secretMasking,
    settingElementTypes: settingElementTypesRecord, elementSettingElementTypes: element.elementTypes,
  }), [selectedVersion, element, name, description, mergedValues, mergedBindings, profileBindings, expressionFields, templateFields, storedTemplateFields, secretFields, mergedSecretFields, unmaskedSecretFields, secretMasking, settingElementTypesRecord])

  const saveContextFor = useCallback((fields: ChildWrittenFields): SaveContext => {
    const merged = mergeOutputList(fields.values)
    return {
      elementId: element.id, elementType: element.elementType, selectedVersion, values: merged.values,
      outputBindings: merged.outputBindings, outputParameters: bindingParameters, versionParameters, name, description,
      profileBindings: fields.profileBindings, expressionFields: fields.expressionFields, templateFields: fields.templateFields,
      outputSecretFields: merged.outputSecretFields, seededOutputSecretFields: seededSecretFields(element),
      unmaskedSecretFields, secretMasking, variables: enrichedVariables, secretFields,
      newTargetTypes: isVariableSetter ? setterRowTypes : undefined,
      settingElementTypes: settingElementTypesRecord, runsOnRemoteHost,
    }
  }, [element, versionParameters, mergeOutputList, bindingParameters, selectedVersion, name, description, enrichedVariables, unmaskedSecretFields, secretMasking, secretFields, isVariableSetter, setterRowTypes, settingElementTypesRecord, runsOnRemoteHost])

  const handleSave = useCallback(() => {
    const result = buildSaveData(saveContextFor({ values, templateFields, expressionFields, profileBindings }))
    /* v8 ignore next - COV-DEF-017 */
    if (!result.data) return
    onSave(result.data)
  }, [saveContextFor, values, templateFields, expressionFields, profileBindings, onSave])

  /** What Save would save once the open child editors wrote into the form, without touching it. */
  const previewSave = useCallback(
    (replayChildren: () => void, overrides: Record<string, unknown>): SaveData => {
      const base = { values, templateFields, expressionFields, profileBindings }
      const replay: ChildReplay = { base, draft: { ...base } }
      replayRef.current = replay
      try {
        replayChildren()
      } finally {
        replayRef.current = null
      }
      const context = saveContextFor(replay.draft)
      return assembleSaveData({ ...context, values: { ...context.values, ...overrides } })
    },
    [values, templateFields, expressionFields, profileBindings, saveContextFor],
  )

  const tryClose = useCallback((childChanges: boolean) => {
    if (hasChanges || childChanges) {
      previousFocusRef.current = document.activeElement as HTMLElement | null
      setShowUnsavedDialog(true)
    } else {
      onClose()
    }
  }, [hasChanges, onClose])

  /* v8 ignore start - COV-CONTAINER-017 */
  const handleKeepEditing = useCallback(() => {
    setShowUnsavedDialog(false)
    setTimeout(() => previousFocusRef.current?.focus(), 50)
  }, [])
  /* v8 ignore stop */

  // PYRUN-19: what the Python editor needs from the draft. The interpreter row
  // travels raw - the server never sees a resolved path from here.
  const interpreter = asText(values.interpreter)

  // An Input Variable's type is known only when its value references a variable.
  const inputBindings = useMemo(
    () =>
      mapEntries(values.input_vars).map(([name, raw]) => {
        const referenced = BARE_VARIABLE_REFERENCE.exec(asText(raw))?.[1]
        const bound = enrichedVariables.find((variable) => variable.name === referenced)
        return { name, knownType: bound?.type, boundValue: bound?.value }
      }),
    [values.input_vars, enrichedVariables],
  )

  const inputVariables = useMemo<AvailableVariable[]>(
    () =>
      inputBindings.map(({ name, knownType, boundValue }) => {
        const type = knownType ?? 'string'
        return { name, type, description: pythonInputVariableDoc(type, boundValue) }
      }),
    [inputBindings],
  )

  const inputVariableTypes = useMemo(() => {
    const types: Record<string, string> = {}
    for (const { name, knownType } of inputBindings) {
      if (knownType !== undefined) types[name] = knownType
    }
    return types
  }, [inputBindings])

  const exportNames = useMemo(
    () => outputList.rows.map((row) => row.name),
    [outputList.rows],
  )

  const { setRows: setOutputListRows } = outputList
  const onRenameSymbol = useCallback(
    (oldName: string, newName: string) => {
      setValues((prev) => {
        const renamed = renamedMapKey(prev.input_vars, oldName, newName)
        return renamed === null ? prev : { ...prev, input_vars: renamed }
      })
      setOutputListRows((rows) =>
        rows.some((row) => row.name === oldName)
          ? rows.map((row) => (row.name === oldName ? { ...row, name: newName } : row))
          : rows,
      )
    },
    [setValues, setOutputListRows],
  )

  const outputListState = useMemo(
    () =>
      outputList.policy === undefined
        ? undefined
        : {
            policy: outputList.policy,
            rows: outputList.rows,
            onRowsChange: outputList.setRows,
            rowErrors: outputList.rowErrors,
            bindingErrors: outputList.bindingErrors,
          },
    [outputList.policy, outputList.rows, outputList.setRows, outputList.rowErrors, outputList.bindingErrors],
  )

  return {
    selectedVersion, setSelectedVersion,
    name, setName,
    description, setDescription,
    values, setValues,
    outputBindings, outputErrors, entryErrors,
    isFormValid, isFormValidBesides,
    showChangelog, setShowChangelog,
    showDetails, setShowDetails,
    showUnsavedDialog, setShowUnsavedDialog,
    showProfileModal, setShowProfileModal,
    profileBindings, setProfileBindings,
    expressionFields, setExpressionFields,
    templateFields, setTemplateFields,
    secretFields, setSecretFields,
    setterRowTypes, setSetterRowTypes, setterRevision,
    outputSecretFields, setOutputSecretFields,
    unmaskedSecretFields, setUnmaskedSecretFields,
    secretMasking, setSecretMasking,
    settingElementTypes: settingElementTypesRecord, setSettingElementTypes,
    isVariableSetter, isXmlParser, isJsonParser, showTransformSections, transformOnBoundTable, isAssert, isIfElse, isBreakOrContinue, isWhile, isSwitch, isWaitUntil, isParallel,
    wideWindow,
    setVarSetterValid, setXmlQueryValid, setJsonQueryValid,
    enrichedVariables, displayParameters, outputParameters,
    outputList: outputListState,
    selectedVersionDetails, versionParameters,
    handleInputChange, handleOutputChange, handleFieldValidationChange,
    handleSave, previewSave, tryClose, handleKeepEditing,
    hasChanges,
    interpreter, inputVariables, inputVariableTypes, exportNames, onRenameSymbol,
  }
}
