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
import type { AssertionItem } from '../config/assertion-builder'
import type { ConditionBranch } from '../config/condition-branch-editor'
import type { CaseBranch } from '../config/case-branch-editor'
import type { ParallelBranch } from '../config/parallel-branch-editor'
import { compareToValuesValid } from '../config/assertion-builder/tree-helpers'
import type { TableFilterBlock } from '../config/table-transform/types'
import type { SecretMaskingSetting } from '@/features/workbench/lib/node-parameters/secret-reveal'
import type { InputParam } from '@/features/workbench/lib/node-parameters/types'
import type { ElementData, SaveData, OutputTableParameter } from './types'
import {
  assembleSaveData,
  buildSaveData,
  computeHasChanges,
  validateOutputBindings,
  type SaveContext,
} from './save-logic'
import { replayListWrite, replayRecordWrite } from '@/lib/child-editors'
import { followRecord } from '@/lib/draft-follow'
import { useStoredFollow } from '@/hooks/use-stored-follow'
import { isParameterVisible, type Parameter } from './parameters/parameter-table-types'
import type { AvailableVariable } from './expressions/expression-field'
import { useEnrichedVariables } from './use-enriched-variables'
import { useOutputList } from './use-output-list'
import type { ElementTypes } from '@/lib/variable-validation'

const NO_ELEMENT_TYPES: Record<string, ElementTypes> = {}

/** Parameters managed by custom editors (excluded from generic required-field checks). */
function getManagedParamNames(
  isAssert: boolean,
  isIfElse: boolean,
  isWhile: boolean,
  isSwitch: boolean,
  isWaitUntil: boolean,
  isParallel: boolean,
): Set<string> {
  const names = new Set<string>()
  if (isAssert) { names.add('assertions'); names.add('mode') }
  if (isIfElse || isSwitch || isParallel) names.add('branches')
  if (isWhile) names.add('conditions')
  if (isWaitUntil) { names.add('conditions'); names.add('mode') }
  if (isParallel) names.add('join')
  return names
}

/** True when a visible required parameter outside the managed set has neither a value nor a default. */
function hasEmptyRequiredValue(
  parameters: Parameter[],
  values: Record<string, unknown>,
  managed: Set<string>,
): boolean {
  const requiredParams = parameters.filter(
    (p) => p.required && isParameterVisible(p, values, parameters) && !managed.has(p.name)
  )
  return requiredParams.some((param) => {
    const effectiveValue = values[param.name] ?? param.defaultValue
    return effectiveValue === undefined || effectiveValue === null || effectiveValue === ''
  })
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

/** The text a blank {x} entry shows: a list row counted from 1, a map key by name (FIELD-13). */
function blankEntryMessage(setting: string, held: unknown, key: string): string {
  return Array.isArray(held) ? `Row ${Number(key) + 1} in '${setting}' is required` : `'${key}' in '${setting}' is required`
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

/** Branch rows as the editor holds them: storage writes `time_limit`. */
function toEditorBranches(stored: unknown): ParallelBranch[] {
  if (!Array.isArray(stored)) return []
  return stored.map((entry) => {
    const branch = entry as Record<string, unknown>
    const limit = branch.time_limit ?? branch.timeLimit
    return {
      id: asText(branch.id),
      name: asText(branch.name),
      ...(typeof limit === 'number' || typeof limit === 'string' ? { timeLimit: limit } : {}),
    }
  })
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
  // The Block changed on the canvas under the open sheet (a deleted variable's binding cleared): untouched fields follow.
  useStoredFollow({ values: element.currentValues, outputBindings: element.outputBindings }, (base, next) => {
    setValues((draft) => followRecord(base.values, draft, next.values))
    setOutputBindings((draft) => followRecord(base.outputBindings, draft, next.outputBindings))
  })
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
  const [openedTemplateFields] = useState(() => initialTemplateFields(element))
  const [templateFields, setTemplateFields] = useReplayedField(
    replayRef,
    'templateFields',
    replayListWrite,
    openedTemplateFields
  )
  const [variableExpressionKeys, setVariableExpressionKeys] = useState<string[]>(
    element.variableExpressionKeys ?? []
  )
  const [variableTemplateKeys, setVariableTemplateKeys] = useState<string[]>(
    element.variableTemplateKeys ?? []
  )
  const [variableSecretKeys, setVariableSecretKeys] = useState<string[]>(
    element.variableSecretKeys ?? []
  )
  const [variableTypes, setVariableTypes] = useState<Record<string, string>>(
    element.variableTypes ?? {}
  )
  const [variableElementTypes, setVariableElementTypes] = useState<Record<string, ElementTypes>>(
    element.variableElementTypes ?? NO_ELEMENT_TYPES
  )
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

  const isXmlParser = element.elementType === 'xml-parser'
  const [xmlQueryValid, setXmlQueryValid] = useState(true)

  const isJsonParser = element.elementType === 'json-parser'
  const [jsonQueryValid, setJsonQueryValid] = useState(true)

  const isAssert = element.elementType === 'assert'
  const [assertValid, setAssertValid] = useState(true)
  const [assertAssertions, setAssertAssertions] = useState<AssertionItem[]>(
    () =>
      (values.assertions as AssertionItem[] | undefined) ??
      []
  )
  const [assertMode, setAssertMode] = useState<'single' | 'split'>(
    () => (values.mode as 'single' | 'split' | undefined) ?? 'split'
  )
  const [assertFailCurrentScope, setAssertFailCurrentScope] = useState<boolean>(
    () => (values.fail_current_scope as boolean | undefined) ?? false
  )

  const isIfElse = element.elementType === 'if-else'
  const [ifElseBranches, setIfElseBranches] = useState<ConditionBranch[]>(
    () => (values.branches as ConditionBranch[] | undefined) ?? []
  )
  const [ifElseValid, setIfElseValid] = useState(true)

  const isSwitch = element.elementType === 'switch-case'
  const [switchBranches, setSwitchBranches] = useState<CaseBranch[]>(
    () => (values.branches as CaseBranch[] | undefined) ?? []
  )
  const [switchValid, setSwitchValid] = useState(true)

  const isBreakOrContinue = element.elementType === 'break' || element.elementType === 'continue'

  const isWhile = element.elementType === 'while'
  const [whileConditions, setWhileConditions] = useState<AssertionItem[]>(
    () => (values.conditions as AssertionItem[] | undefined) ?? []
  )
  const [whileValid, setWhileValid] = useState(true)

  const isWaitUntil = element.elementType === 'wait-until'
  const [waitConditions, setWaitConditions] = useState<AssertionItem[]>(
    () => (values.conditions as AssertionItem[] | undefined) ?? []
  )
  const [waitMode, setWaitMode] = useState<'retry' | 'watch'>(
    () => (values.mode as 'retry' | 'watch' | undefined) ?? 'retry'
  )
  const [waitFailCurrentScope, setWaitFailCurrentScope] = useState<boolean>(
    () => (values.fail_current_scope as boolean | undefined) ?? false
  )
  const [waitValid, setWaitValid] = useState(true)

  const isParallel = element.elementType === 'parallel'
  const [parallelBranches, setParallelBranches] = useState<ParallelBranch[]>(
    () => toEditorBranches(values.branches)
  )
  const [parallelJoin, setParallelJoin] = useState<'all' | 'first'>(
    () => (values.join as 'all' | 'first' | undefined) ?? 'all'
  )
  const [parallelValid, setParallelValid] = useState(true)

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

  // Filter parameters for display (exclude editor-managed params)
  const displayParameters = useMemo(() => {
    // An output list is edited under Output Variables, never in the input table.
    const tableParameters = versionParameters.filter((p) => p.outputList === undefined)
    if (isAssert) {
      return tableParameters.filter(
        (p) => p.name !== 'assertions' && p.name !== 'mode' && p.name !== 'fail_current_scope'
      )
    }
    if (isIfElse || isSwitch || isParallel) {
      return tableParameters.filter((p) => p.name !== 'branches' && p.name !== 'join')
    }
    if (isWhile) {
      return tableParameters.filter((p) => p.name !== 'conditions')
    }
    if (isWaitUntil) {
      return tableParameters.filter(
        (p) => p.name !== 'conditions' && p.name !== 'mode' && p.name !== 'fail_current_scope'
      )
    }
    if (transformParameter) {
      // sorts / filters render in the Transform sections, not the table.
      return tableParameters.filter((p) => p.name !== 'sorts' && p.name !== 'filters')
    }
    if (!isXmlParser && !isJsonParser) return tableParameters
    // output_mode renders as the Output Mode radio section, queries as the Queries
    // section - none belongs in the Input Parameters table.
    return tableParameters.filter(
      (p) => p.name !== 'queries' && p.name !== 'query_output_types' && p.name !== 'output_mode'
    )
  }, [isAssert, isIfElse, isSwitch, isParallel, isWhile, isWaitUntil, transformParameter, isXmlParser, isJsonParser, versionParameters])

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

  // A blank {x} entry of a shown row holds the Save, naming the entry (FIELD-13).
  const entryErrors = useMemo(() => {
    const shown = new Set(
      displayParameters.filter((p) => isParameterVisible(p, values, versionParameters)).map((p) => p.name),
    )
    return blankEntryErrors(values, expressionFields, shown)
  }, [displayParameters, values, versionParameters, expressionFields])

  // A filter whose compare-to value its as Type refuses holds the Save (REQ-3.1.3.14).
  const filtersValid = useMemo(
    () =>
      ((values.filters as TableFilterBlock[] | undefined) ?? []).every((block) =>
        compareToValuesValid(block.conditions ?? []),
      ),
    [values.filters],
  )

  // Required fields filled and every field-level check passing, optionally setting one field aside.
  const isFormValidBesides = useCallback((besides?: string) => {
    if (fieldErrorNames.some((field) => field !== besides)) return false
    if (Object.keys(entryErrors).some((field) => field !== besides)) return false
    if (!outputBindingsValid) return false
    if (!outputList.valid) return false
    const editorChecks = [
      isVariableSetter && !varSetterValid,
      isXmlParser && !xmlQueryValid,
      isJsonParser && !jsonQueryValid,
      isAssert && !assertValid,
      isIfElse && !ifElseValid,
      isSwitch && !switchValid,
      isWhile && !whileValid,
      isWaitUntil && !waitValid,
      isParallel && !parallelValid,
      showTransformSections && !filtersValid,
    ]
    if (editorChecks.some(Boolean)) return false
    const managed = getManagedParamNames(isAssert, isIfElse, isWhile, isSwitch, isWaitUntil, isParallel)
    const checked = versionParameters.filter((p) => p.name !== besides)
    return !hasEmptyRequiredValue(checked, values, managed)
  }, [versionParameters, values, fieldErrorNames, entryErrors, outputBindingsValid, outputList.valid, isVariableSetter, varSetterValid, isXmlParser, xmlQueryValid, isJsonParser, jsonQueryValid, isAssert, assertValid, isIfElse, ifElseValid, isSwitch, switchValid, isWhile, whileValid, isWaitUntil, waitValid, isParallel, parallelValid, showTransformSections, filtersValid])
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
    templateFields, elementTemplateFields: openedTemplateFields,
    outputSecretFields: mergedSecretFields, elementOutputSecretFields: element.outputSecretFields ?? schemaSecretOutputNames(element),
    unmaskedSecretFields, elementUnmaskedSecretFields: element.unmaskedSecretFields,
    secretMasking, elementSecretMasking: element.secretMasking,
    variableExpressionKeys, elementVariableExpressionKeys: element.variableExpressionKeys,
    variableTemplateKeys, elementVariableTemplateKeys: element.variableTemplateKeys,
    variableSecretKeys, elementVariableSecretKeys: element.variableSecretKeys,
    variableTypes, elementVariableTypes: element.variableTypes,
    variableElementTypes, elementVariableElementTypes: element.variableElementTypes,
    settingElementTypes: settingElementTypesRecord, elementSettingElementTypes: element.elementTypes,
    isAssert, assertAssertions, assertMode, assertFailCurrentScope,
    isIfElse, ifElseBranches,
    isSwitch, switchBranches,
    isWhile, whileConditions,
    isWaitUntil, waitConditions, waitMode, waitFailCurrentScope,
    isParallel, parallelBranches, parallelJoin,
  }), [selectedVersion, element.version, name, element.name, description, element.description, mergedValues, element.currentValues, mergedBindings, element.outputBindings, profileBindings, element.profileBindings, expressionFields, element.expressionFields, templateFields, openedTemplateFields, mergedSecretFields, element.outputSecretFields, unmaskedSecretFields, element.unmaskedSecretFields, secretMasking, element.secretMasking, variableExpressionKeys, element.variableExpressionKeys, variableTemplateKeys, element.variableTemplateKeys, variableSecretKeys, element.variableSecretKeys, variableTypes, element.variableTypes, variableElementTypes, element.variableElementTypes, settingElementTypesRecord, element.elementTypes, isAssert, assertAssertions, assertMode, assertFailCurrentScope, isIfElse, ifElseBranches, isSwitch, switchBranches, isWhile, whileConditions, isWaitUntil, waitConditions, waitMode, waitFailCurrentScope, isParallel, parallelBranches, parallelJoin])

  const saveContextFor = useCallback((fields: ChildWrittenFields): SaveContext => {
    const merged = mergeOutputList(fields.values)
    return {
      elementId: element.id, selectedVersion, values: merged.values, outputBindings: merged.outputBindings,
      outputParameters: bindingParameters, versionParameters, name, description, profileBindings: fields.profileBindings,
      expressionFields: fields.expressionFields, templateFields: fields.templateFields, outputSecretFields: merged.outputSecretFields,
      seededOutputSecretFields: seededSecretFields(element), unmaskedSecretFields, secretMasking, variables: enrichedVariables,
      isVariableSetter, isXmlParser, isJsonParser, isAssert, isIfElse, isSwitch, isWhile, isWaitUntil, isParallel,
      assertAssertions, assertMode, assertFailCurrentScope, ifElseBranches,
      switchBranches, whileConditions,
      waitConditions, waitMode, waitFailCurrentScope,
      parallelBranches, parallelJoin,
      variableExpressionKeys, variableTemplateKeys, variableSecretKeys, variableTypes,
      variableElementTypes, settingElementTypes: settingElementTypesRecord,
      runsOnRemoteHost,
    }
  }, [element, versionParameters, mergeOutputList, bindingParameters, selectedVersion, name, description, enrichedVariables, unmaskedSecretFields, secretMasking, isVariableSetter, isXmlParser, isJsonParser, variableExpressionKeys, variableTemplateKeys, variableSecretKeys, variableTypes, variableElementTypes, settingElementTypesRecord, runsOnRemoteHost, isAssert, assertAssertions, assertMode, assertFailCurrentScope, isIfElse, ifElseBranches, isSwitch, switchBranches, isWhile, whileConditions, isWaitUntil, waitConditions, waitMode, waitFailCurrentScope, isParallel, parallelBranches, parallelJoin])

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
    outputSecretFields, setOutputSecretFields,
    unmaskedSecretFields, setUnmaskedSecretFields,
    secretMasking, setSecretMasking,
    variableExpressionKeys, setVariableExpressionKeys,
    variableTemplateKeys, setVariableTemplateKeys,
    variableSecretKeys, setVariableSecretKeys,
    variableTypes, setVariableTypes,
    variableElementTypes, setVariableElementTypes,
    settingElementTypes: settingElementTypesRecord, setSettingElementTypes,
    isVariableSetter, isXmlParser, isJsonParser, showTransformSections, transformOnBoundTable, isAssert, isIfElse, isBreakOrContinue, isWhile, isSwitch, isWaitUntil, isParallel,
    setVarSetterValid, setXmlQueryValid, setJsonQueryValid, setAssertValid, setIfElseValid, setWhileValid, setSwitchValid, setWaitValid, setParallelValid,
    assertAssertions, setAssertAssertions,
    assertMode, setAssertMode,
    assertFailCurrentScope, setAssertFailCurrentScope,
    ifElseBranches, setIfElseBranches,
    switchBranches, setSwitchBranches,
    parallelBranches, setParallelBranches,
    parallelJoin, setParallelJoin,
    whileConditions, setWhileConditions,
    waitConditions, setWaitConditions,
    waitMode, setWaitMode,
    waitFailCurrentScope, setWaitFailCurrentScope,
    enrichedVariables, displayParameters, outputParameters,
    outputList: outputListState,
    selectedVersionDetails, versionParameters,
    handleInputChange, handleOutputChange, handleFieldValidationChange,
    handleSave, previewSave, tryClose, handleKeepEditing,
    hasChanges,
    interpreter, inputVariables, inputVariableTypes, exportNames, onRenameSymbol,
  }
}
