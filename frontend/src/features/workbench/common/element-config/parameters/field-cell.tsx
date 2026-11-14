/**
 * The field cell: the one field with its expand and {x} columns, Browse, the switch warning, its own sheets and
 * the message lines under it, in a table cell or a flex row. Its host hands it the modes of where its {x},
 * Template, entry {x} and element types live (REQ-3.1.1.5).
 * - CANVAS-138-141: Variable reference syntax and highlighting
 * - CANVAS-146: Enum fields: {x} toggle for Value/Expression mode
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { FolderOpen } from 'lucide-react'
import { cn, safeStringify } from '@/lib/utils'
import { holdsUnsavedSecret, isSealedMapCredential, isStoredSecretValue } from '@/lib/secret-envelope'
import type { VariableType } from '@/lib/variable-types'
import { splitReference } from '@/lib/file-references'
import { literalNumberProblem, numberBoundError } from '@/features/workbench/lib/validation/number-bounds'
import { isValueNonEmpty } from '@/features/workbench/lib/validation/compute-node-issues'
import { validateExpressions } from '@/features/workbench/lib/expression-validation/validation'
import { useExpressionValidator } from '@/features/workbench/hooks/use-expression-validator'
import { describeTimeValue } from '@/features/workbench/lib/opensearch/time-values'
import { entryFlagsFor, type FieldModes } from '@/features/workbench/lib/node-parameters/field-modes'
import { FieldErrorContext, FieldNoteContext } from '@/components/shared/fields/field-error-context'
import { ExpressionToggle } from '@/components/shared/fields/expression-toggle'
import type { SheetOpener } from '@/components/shared/draggable-sheet'
import { UnsavedChangesDialog } from '@/components/shared/child-editors/unsaved-changes-dialog'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { SwitchModeDialog, type SwitchModeDirection } from '@/components/shared/dialogs/switch-mode-dialog'
import { BlockValueField } from '@/features/workbench/common/variables/variable-inspect-modal/window-value-field'
import {
  secretStaysVisibleText,
  type SecretSaveTarget,
} from '@/features/workbench/common/variables/variable-inspect-modal/secret-visibility-notice'
import type { ElementTypes } from '@/lib/variable-validation'
import { emptyValueOf, expressionIsHeld, hasEmptyValue } from '@/lib/value-loss'
import type { AvailableVariable } from '../expressions/expression-field'
import { OutputBindingCombobox } from '../outputs/output-binding-combobox'
import {
  type MapParamExtras,
  type MissingHeaderAdvisory,
  type Parameter,
  isParameterRequired,
  isValidUrl,
  matchesCondition,
  parameterLabel,
} from './parameter-table-types'
import {
  EnumInput,
  BooleanInput,
  NumberValueInput,
  MapInput,
  PartsInput,
  CipherSuitesInput,
  ArrayInput,
  RecordListInput,
  TableInput,
  StringInput,
  CredentialValueInput,
  CredentialStatusIcon,
  UnsecuredCredentialIcon,
  enumLabelOf,
  mapLineCredentialAdvisory,
  resolveCredentialStatus,
  type BlockFieldState,
  type ScriptEditorProps,
} from './parameter-value-inputs'
import { ContentTypeAdvisoryIcon, needsContentTypeAdvisory } from './content-type-advisory'
import { ExpectedHeadersAdvisoryIcon, unmetHeaderAdvisories } from './expected-headers-advisory'
import { VariableRefCombobox } from './variable-ref-combobox'
import { EnumPickerInput } from './enum-picker-input'
import { FileReferencePickerSheet } from './file-reference-picker-sheet'
import { useFieldSheets } from './use-field-sheets'
import { TimeValueInput } from './time-value-input'
import { useCipherSuitesStanding } from '../cipher-picker/tls-inventory'

// Every cell pads alike so the message hangs under the field and the row keeps its alignment (FIELDERR-2).
const MESSAGE_ROW_CELL_PADDING = 'px-2 pt-2 pb-7'
// Room for two amber lines under the field.
const TWO_LINE_ROW_CELL_PADDING = 'px-2 pt-2 pb-11'
const FIELD_MESSAGE_CLASS = 'absolute inset-x-0 top-full mt-1 truncate text-xs'

// An empty icon column keeps the expand and {x} columns of every row in line (FIELD-1).
const ICON_COLUMN_CLASS = 'w-8 shrink-0'

const NO_FIELDS: string[] = []
// The control a field draws for its value, whatever its face.
const VALUE_BOX_SELECTOR = 'input, textarea, [contenteditable="true"], button'

/** What the cell is given: the field, its value, and the modes of where its {x} and Template live. */
export interface FieldCellProps {
  mode: 'input' | 'output'
  parameter: Parameter
  value: unknown
  onChange: (value: unknown) => void
  modes: FieldModes
  availableVariables: AvailableVariable[]
  /** A window message for the field (FIELD-13), shown under it as its error. */
  fieldError?: string
  onValidationChange?: (name: string, error: string | null) => void
  toggleTestId?: string
  allValues?: Record<string, unknown>
  allParameters?: Parameter[]
  /** The {x} flags of the settings beside it: a bound or a preset that reads a sibling skips one in {x}. */
  allExpressionFields?: readonly string[]
  /** Plugin credential-key catalog for map-entry advisories (lowercase keys). */
  credentialCatalogKeys?: string[]
  /** Generated-row + advisory extras for this map param. */
  mapExtras?: MapParamExtras
  /** The block runs on the execution host: no Browse. */
  runsOnRemoteHost?: boolean
  /** Read-only canvas: no Browse. */
  readOnly?: boolean
  /** The open test, for the file-reference picker; null while the test is unsaved. */
  testId?: string | null
  /** Python and SQL blocks only: what their script body carries into the editor sheet. */
  scriptEditor?: ScriptEditorProps
  /** What saving seals a credential typed here: the Test, or the Function a View shows. */
  secretSaveTarget?: SecretSaveTarget
  /** What a screen reader hears in place of an empty label (a Setter row with no name yet). */
  accessibleName?: string
}

/** Options for selecting the appropriate literal-mode input widget */
interface LiteralInputOptions {
  parameter: Parameter
  /** parameter.label ?? parameter.name - the field's visible name. */
  displayLabel: string
  /** What the field holds (a lockedWhen match pins it); a free-entry field shows its default when it holds nothing. */
  value: unknown
  /** What a choice, true / false or variable picker shows: the value, else its default. */
  effectiveValue: unknown
  onChange: (value: unknown) => void
  errorMessage: string | null
  availableVariables: AvailableVariable[]
  templateFields: string[]
  onTemplateFieldsChange: (fields: string[]) => void
  /** The field's own {x} flags - map/parts inputs add dotted per-key entries. */
  expressionFields: string[]
  onExpressionFieldsChange: (fields: string[]) => void
  /** Currently selected type from selectableType dropdown */
  selectedType?: string
  allValues?: Record<string, unknown>
  allParameters?: Parameter[]
  credentialCatalogKeys?: string[]
  /** A descriptor lock holds: the control renders disabled */
  locked: boolean
  /** The lockedOnRemoteHost lock while it holds: the disabled control reads its text */
  remoteLock?: { displayText: string }
  mapExtras?: MapParamExtras
  /** Python and SQL blocks only: what their script body carries into the editor sheet. */
  scriptEditor?: ScriptEditorProps
  /** A typed map setting's element types and their change sink (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
  onElementTypesChange?: (types: ElementTypes | undefined) => void
  /** The field's Edit value sheet, which it opens one at a time with the file picker. */
  valueSheet: SheetOpener
  /** How the one value field stands: set or not, its default, its null rule (REQ-3.1.1.5). */
  field: BlockFieldState
}

/** Literal-mode variable picker; a selectableType row offers only the selected type. */
function selectVariableRefInput(opts: LiteralInputOptions, variableRef: { types: string[] }): ReactNode {
  const { parameter, selectedType, effectiveValue, onChange, availableVariables } = opts
  const effectiveAllowedTypes = parameter.selectableType && selectedType ? [selectedType] : variableRef.types
  return (
    <VariableRefCombobox
      value={safeStringify(effectiveValue)}
      onChange={(val) => onChange(val)}
      allowedTypes={effectiveAllowedTypes}
      availableVariables={availableVariables}
      existingOnly={parameter.variableRefExistingOnly}
    />
  )
}

/** Literal-mode enum widget: the searchable picker when the descriptor asks for it, else the plain select. */
function selectEnumInput(opts: LiteralInputOptions): ReactNode {
  const { parameter, effectiveValue, onChange, errorMessage, remoteLock } = opts
  const enumProps = { parameter, effectiveValue, onChange, showRequiredError: errorMessage !== null }
  if (parameter.enumSearchable) return <EnumPickerInput {...enumProps} />
  // The lock text is a prop only while the lock holds, so both enum inputs keep one contract.
  return remoteLock ? (
    <EnumInput {...enumProps} lockedDisplayText={remoteLock.displayText} />
  ) : (
    <EnumInput {...enumProps} />
  )
}

/** The literal widget draws the one value field with its expand column; the cell keeps it empty for the others. */
function drawsValueField(parameter: Parameter): boolean {
  if (parameter.secret && parameter.type !== 'map') return true
  return !(parameter.variableRef || parameter.enumValues || parameter.type === 'boolean')
}

const OWN_EDITOR_SECRET_TYPES: ReadonlySet<string> = new Set(['map', 'array', 'table'])

/** Select the appropriate literal-mode input widget based on parameter type */
function selectLiteralInput(opts: LiteralInputOptions): ReactNode {
  const { parameter, displayLabel, value, effectiveValue, onChange, availableVariables, templateFields, onTemplateFieldsChange, expressionFields, onExpressionFieldsChange, allValues, credentialCatalogKeys, locked, mapExtras, field, valueSheet } = opts
  // A map, list or table credential keeps its own editor, whose masked face covers the stored case.
  if (parameter.secret && !OWN_EDITOR_SECRET_TYPES.has(parameter.type)) {
    return <CredentialValueInput parameter={parameter} effectiveValue={value} onChange={onChange} sheet={valueSheet} field={field} />
  }
  if (parameter.variableRef) return selectVariableRefInput(opts, parameter.variableRef)
  if (parameter.enumValues) return selectEnumInput(opts)
  if (parameter.type === 'boolean') return <BooleanInput ariaLabel={field.accessibleName ?? displayLabel} effectiveValue={effectiveValue} onChange={onChange} locked={locked} />
  if (parameter.type === 'integer' || parameter.type === 'float') {
    return <NumberValueInput parameter={parameter} value={value} onChange={onChange} field={field} />
  }
  if (parameter.type === 'map') {
    return (
      <MapInput
        parameter={parameter}
        effectiveValue={value}
        onChange={onChange}
        allValues={allValues}
        availableVariables={availableVariables}
        credentialCatalogKeys={credentialCatalogKeys}
        mapExtras={mapExtras}
        expressionFields={expressionFields}
        onExpressionFieldsChange={onExpressionFieldsChange}
        elementTypes={opts.elementTypes}
        onElementTypesChange={opts.onElementTypesChange}
        sheet={valueSheet}
        field={field}
      />
    )
  }
  if (parameter.type === 'array') return selectArrayInput(opts)
  if (parameter.type === 'table' && !parameter.fileReference) {
    return <TableInput parameter={parameter} effectiveValue={value} onChange={onChange} sheet={valueSheet} field={field} />
  }
  if (parameter.timeValue) {
    return <TimeValueInput parameter={parameter} value={value} onChange={onChange} field={field} />
  }
  return <StringInput parameter={parameter} effectiveValue={value} onChange={onChange} availableVariables={availableVariables} templateFields={templateFields} onTemplateFieldsChange={onTemplateFieldsChange} sheet={valueSheet} field={field} {...opts.scriptEditor} />
}

/** Literal-mode widget for array params: record rows, parts editor, cipher picker, or a plain list. */
function selectArrayInput(opts: LiteralInputOptions): ReactNode {
  const { parameter, value, onChange, availableVariables, allValues, allParameters, expressionFields, onExpressionFieldsChange, field, valueSheet } = opts
  if (parameter.orderedList) {
    return (
      <RecordListInput
        parameter={parameter}
        orderedList={parameter.orderedList}
        effectiveValue={value}
        onChange={onChange}
        availableVariables={availableVariables}
        expressionFields={expressionFields}
        onExpressionFieldsChange={onExpressionFieldsChange}
        sheet={valueSheet}
        field={field}
      />
    )
  }
  if (parameter.partsEditor) {
    return (
      <PartsInput
        parameter={parameter}
        effectiveValue={value}
        onChange={onChange}
        availableVariables={availableVariables}
        expressionFields={expressionFields}
        onExpressionFieldsChange={onExpressionFieldsChange}
        sheet={valueSheet}
        field={field}
      />
    )
  }
  if (parameter.cipherPicker) {
    return <CipherSuitesInput parameter={parameter} effectiveValue={value} onChange={onChange} allValues={allValues} allParameters={allParameters} sheet={valueSheet} field={field} />
  }
  return (
    <ArrayInput
      parameter={parameter}
      effectiveValue={value}
      onChange={onChange}
      availableVariables={availableVariables}
      expressionFields={expressionFields}
      onExpressionFieldsChange={onExpressionFieldsChange}
      elementTypes={opts.elementTypes}
      onElementTypesChange={opts.onElementTypesChange}
      sheet={valueSheet}
      field={field}
    />
  )
}

/** The type a selectableType row shows: an explicit choice, else the bound
 *  variable's type, else the first option. */
function resolveSelectedType(opts: {
  parameter: Parameter
  allValues: Record<string, unknown> | undefined
  isExpressionMode: boolean
  effectiveValue: unknown
  availableVariables: AvailableVariable[]
}): string | undefined {
  const { parameter, allValues, isExpressionMode, effectiveValue, availableVariables } = opts
  const selectable = parameter.selectableType
  if (!selectable) return undefined
  const stored = allValues?.[`${parameter.name}_type`] as string | undefined
  if (stored) return stored
  const fallback = selectable.options[0]
  if (isExpressionMode || !parameter.variableRef) return fallback
  const bound = availableVariables.find((v) => v.name === safeStringify(effectiveValue))
  const options: readonly string[] = selectable.options
  return bound && options.includes(bound.type) ? bound.type : fallback
}

/** Literal selectableType + variableRef: the bound variable's type must match. */
function typeMismatchMessage(opts: {
  parameter: Parameter
  selectedType?: string
  isExpressionMode: boolean
  isEmpty: boolean
  effectiveValue: unknown
  availableVariables: AvailableVariable[]
}): string | null {
  const { parameter, selectedType, isExpressionMode, isEmpty, effectiveValue, availableVariables } = opts
  if (!selectedType || !parameter.variableRef || isExpressionMode || isEmpty) return null
  const varName = safeStringify(effectiveValue)
  const selectedVar = availableVariables.find((v) => v.name === varName)
  if (selectedVar && selectedVar.type !== selectedType) {
    return `Variable "${varName}" is type ${selectedVar.type}, expected ${selectedType}`
  }
  return null
}

const URL_FORMAT_ERROR = 'URL must start with http:// or https://'

interface RowErrorOptions {
  mode: 'input' | 'output'
  parameter: Parameter
  displayLabel: string
  effectiveValue: unknown
  /** What fills a required field: the value, else a default that holds something. */
  requiredValue: unknown
  /** The first problem of a list, map or table line that does not read as a value yet. */
  lineProblem: string | null
  /** A typed cipher the TLS versions cannot offer (FIELD-10). */
  cipherProblem: string | null
  /** The field holds {x} or a Template: its text is never read as a literal value. */
  isSourceMode: boolean
  isRequired: boolean
  selectedType: string | undefined
  availableVariables: AvailableVariable[]
  allValues: Record<string, unknown> | undefined
  /** The values a declared bound reads: the host's, else the field's own. */
  boundValues: Record<string, unknown>
  allParameters: Parameter[] | undefined
  /** The {x} flags a declared bound reads: the field's own and its siblings'. */
  boundExpressionFields: ReadonlySet<string>
}

/** A literal option the visible row does not offer, named with the value its gate reads (SQL-6). */
function unofferedOptionMessage(opts: RowErrorOptions & { isEmpty: boolean }): string | null {
  const { parameter, allParameters } = opts
  const gate = parameter.showWhen
  const gateParameter = gate && allParameters?.find((p) => p.name === gate.field)
  const value = safeStringify(opts.effectiveValue)
  if (
    opts.isSourceMode ||
    opts.isEmpty ||
    !gateParameter ||
    !parameter.enumValues ||
    parameter.enumValues.some((allowed) => String(allowed) === value)
  ) {
    return null
  }
  const gateValue = safeStringify(opts.allValues?.[gateParameter.name])
  return `${opts.displayLabel} '${enumLabelOf(parameter, value)}' is not available on ${enumLabelOf(gateParameter, gateValue)}`
}

/** A literal From / To that is not a time (OS-4). */
function timeValueError({ parameter, displayLabel, effectiveValue, isSourceMode }: RowErrorOptions): string | null {
  if (!parameter.timeValue || isSourceMode) return null
  return describeTimeValue(effectiveValue, { label: displayLabel, defaultValue: parameter.defaultValue }).error
}

/** A value the field holds or does not need: its URL, time, bounds, type, then the offered options. */
function valueFinding(opts: RowErrorOptions, isEmpty: boolean): string | null {
  const { parameter, effectiveValue, isSourceMode } = opts
  const url = typeof effectiveValue === 'string' ? effectiveValue.trim() : ''
  if (parameter.name === 'url' && !isSourceMode && url !== '' && !isValidUrl(url)) {
    return URL_FORMAT_ERROR
  }
  return (
    (isSourceMode ? null : (opts.lineProblem ?? opts.cipherProblem)) ??
    timeValueError(opts) ??
    literalNumberProblem(parameter.type, effectiveValue, isSourceMode) ??
    numberBoundError(parameter, opts.boundValues, opts.allParameters ?? [parameter], opts.boundExpressionFields) ??
    typeMismatchMessage({
      parameter,
      selectedType: opts.selectedType,
      isExpressionMode: isSourceMode,
      isEmpty,
      effectiveValue,
      availableVariables: opts.availableVariables,
    }) ??
    unofferedOptionMessage({ ...opts, isEmpty })
  )
}

/** The field's save-blocking error; an explicit null fills a field that takes null (REQ-3.1.3.21). */
function rowErrorState(opts: RowErrorOptions): string | null {
  // An output's box holds the name of the variable it writes, never a value of its type (CANVAS-131).
  if (opts.mode === 'output') return null
  const { parameter, requiredValue, isRequired } = opts
  const isEmpty =
    requiredValue === undefined ||
    requiredValue === '' ||
    (requiredValue === null && parameter.acceptsNull !== true)
  const requiredBlocked = isRequired && isEmpty
  // Every Save-blocking reason shows at once, required-empty included (FIELDERR-3).
  return requiredBlocked ? (parameter.requiredMessage ?? `${opts.displayLabel} is required`) : valueFinding(opts, isEmpty)
}

/** The first finding of an expression field's own check (FIELDERR-3). */
function firstExpressionFinding(value: unknown, availableVariables: AvailableVariable[]): string | null {
  const names = new Set(availableVariables.map((v) => v.name))
  const types = new Map(availableVariables.map((v) => [v.name, v.type]))
  return validateExpressions(safeStringify(value), names, types, true)[0]?.message ?? null
}

interface BrowseStateOptions {
  parameter: Parameter
  mode: 'input' | 'output'
  isExpressionMode: boolean
  readOnly: boolean
  runsOnRemoteHost: boolean
  effectiveValue: unknown
}

/** Browse button and the whole-path title of a file-reference field (TDATA-8). */
function browseState(opts: BrowseStateOptions): {
  fileReference: Parameter['fileReference']
  showBrowse: boolean
  browseHint: string
  literalValue: string
  tailVisible: boolean
} {
  const { parameter, mode, isExpressionMode, readOnly, runsOnRemoteHost, effectiveValue } = opts
  const fileReference = mode === 'input' ? parameter.fileReference : undefined
  const literalValue = typeof effectiveValue === 'string' ? effectiveValue : ''
  const artifactsOnly = fileReference === 'save-as' || parameter.fileReferenceArtifactsOnly
  return {
    fileReference,
    // Browse shows on a literal field of an editable local block (TDATA-8).
    showBrowse: fileReference !== undefined && !isExpressionMode && !readOnly && !runsOnRemoteHost,
    browseHint: artifactsOnly ? 'Browse Artifacts' : 'Browse Test Data and Artifacts',
    literalValue,
    tailVisible: fileReference !== undefined && !isExpressionMode && literalValue !== '',
  }
}

interface RowLocks {
  /** The lockedWhen entry while its field matches: the field's value is forced to its value */
  pin?: { value: unknown }
  /** The lockedOnRemoteHost entry while the block runs there: the row grays out and a Save stores nothing (HTTP-13) */
  remoteLock?: { displayText: string }
  /** Either lock holds: the control renders disabled */
  locked: boolean
}

/** The descriptor locks that hold for a field. */
function rowLocks(
  parameter: Parameter,
  allValues: Record<string, unknown> | undefined,
  allParameters: Parameter[] | undefined,
  runsOnRemoteHost: boolean,
): RowLocks {
  const { lockedWhen, lockedOnRemoteHost } = parameter
  const pin =
    lockedWhen && matchesCondition(lockedWhen, allValues ?? {}, allParameters) ? lockedWhen : undefined
  const remoteLock = runsOnRemoteHost ? lockedOnRemoteHost : undefined
  return { pin, remoteLock, locked: pin !== undefined || remoteLock !== undefined }
}

const WILDCARD_CHARS = /[*?[]/

/** Save-as Name preset for a Destination field: the sibling Source's name, unless it is a wildcard. */
function destinationPresetName(
  parameter: Parameter,
  allValues: Record<string, unknown> | undefined,
  expressionFields: readonly string[],
): string | undefined {
  if (parameter.name !== 'destination' || expressionFields.includes('source')) return undefined
  const source = allValues?.source
  if (typeof source !== 'string') return undefined
  const { name } = splitReference(source)
  return WILDCARD_CHARS.test(name) ? undefined : name
}

/** A declared default the field can show; a null default holds nothing (REQ-3.1.1.5). */
function shownDefaultOf(parameter: Parameter): unknown {
  return parameter.defaultValue === null ? undefined : parameter.defaultValue
}

/** Text, list, map and table fields have an empty value to switch to (FIELD-7). */
function offersEmptyValue(parameter: Parameter): boolean {
  if (parameter.enumValues || parameter.variableRef) return false
  return hasEmptyValue(parameter.type)
}

/** The field offers null: it takes null, is not secret and shows no default. */
function takesNull(parameter: Parameter, shownDefault: unknown): boolean {
  return parameter.acceptsNull === true && !parameter.secret && shownDefault === undefined
}

/** A null on a field that takes null holds nothing to lose, so {x} comes at once (FIELD-5). */
function holdsLiteralValue(value: unknown, nullable: boolean): boolean {
  return value !== undefined && !(value === null && nullable)
}

/** The side columns of an input row: the empty expand slot, the {x} toggle, or its empty slot (FIELD-1). */
function rowColumns(mode: 'input' | 'output', parameter: Parameter, isExpressionMode: boolean) {
  const input = mode === 'input'
  return {
    keepsExpandColumn: input && !isExpressionMode && !drawsValueField(parameter),
    offersExpressionToggle: input && !parameter.noExpression,
    emptyToggleSlot: input && parameter.noExpression === true,
  }
}

/** What a switch of mode leaves in the field (FIELD-7). */
type SwitchOutcome = 'default' | 'empty' | 'discard'

interface RowInputOptions extends LiteralInputOptions {
  mode: 'input' | 'output'
  isExpressionMode: boolean
  fieldErrorId: string
  fieldError?: string
  /** Status icons drawn inside an {x} field (a credential's state). */
  expressionAdornment?: ReactNode
}

/** The field's value widget: output binding, the {x} field, or the literal input. */
function selectRowInput(opts: RowInputOptions): ReactNode {
  const { parameter, displayLabel, value, onChange, availableVariables, field } = opts
  if (opts.mode === 'output') {
    return (
      <OutputBindingCombobox
        value={safeStringify(opts.effectiveValue)}
        onChange={onChange}
        parameterType={parameter.type}
        availableVariables={availableVariables}
        errorId={opts.fieldError ? opts.fieldErrorId : undefined}
        ariaLabel={`Assign ${displayLabel} to`}
      />
    )
  }
  if (opts.isExpressionMode) {
    return (
      <BlockValueField
        mode="expression"
        type={parameter.type as VariableType}
        value={value}
        isSet={field.isSet}
        defaultValue={field.defaultValue}
        nullable={false}
        hasEditor
        testId={parameter.name}
        label={displayLabel}
        accessibleName={field.accessibleName}
        readOnly={field.readOnly}
        placeholder={parameter.noExpression ? parameter.placeholder : undefined}
        availableVariables={availableVariables}
        adornment={opts.expressionAdornment}
        onChange={(next) => onChange(next)}
        onUnset={field.onUnset}
        onNull={field.onNull}
        onExpand={NO_ACTION}
      />
    )
  }
  return selectLiteralInput(opts)
}

const NO_ACTION = () => {}

interface RowAdvisoryOptions {
  mode: 'input' | 'output'
  parameter: Parameter
  isExpressionMode: boolean
  current: unknown
  allValues?: Record<string, unknown>
  mapExtras?: MapParamExtras
  expressionFields: string[]
  credentialCatalogKeys?: string[]
  availableVariables: AvailableVariable[]
}

/** An input field's advisories: a JSON body with no Content-Type, missing expected headers, a plain-text credential. */
function rowAdvisories(opts: RowAdvisoryOptions): {
  contentTypeAdvisory: boolean
  expectedHeaderAdvisories: MissingHeaderAdvisory[]
  unsecuredCredential: boolean
} {
  const { parameter, current } = opts
  const input = opts.mode === 'input'
  return {
    unsecuredCredential: mapLineCredentialAdvisory(
      parameter,
      current,
      opts.expressionFields,
      opts.credentialCatalogKeys,
      opts.availableVariables,
    ),
    // Literal values only.
    contentTypeAdvisory:
      input &&
      parameter.contentTypeAdvisory === true &&
      !opts.isExpressionMode &&
      needsContentTypeAdvisory(current, opts.allValues),
    // Body headers off and no manual row.
    expectedHeaderAdvisories:
      input && parameter.type === 'map'
        ? unmetHeaderAdvisories(opts.mapExtras?.missingHeaderAdvisories, current)
        : [],
  }
}

/** The status icons drawn inside the field, or nothing. */
function rowAdornment(opts: {
  credentialStatus: ReturnType<typeof resolveCredentialStatus>
  contentTypeAdvisory: boolean
  expectedHeaderAdvisories: MissingHeaderAdvisory[]
  unsecuredCredential: boolean
}): ReactNode {
  const { credentialStatus, contentTypeAdvisory, expectedHeaderAdvisories, unsecuredCredential } = opts
  const expectedHeaders = expectedHeaderAdvisories.length > 0
  if (!credentialStatus && !contentTypeAdvisory && !expectedHeaders && !unsecuredCredential) return undefined
  return (
    <>
      {credentialStatus && <CredentialStatusIcon {...credentialStatus} />}
      {contentTypeAdvisory && <ContentTypeAdvisoryIcon />}
      {unsecuredCredential && <UnsecuredCredentialIcon beside={expectedHeaders} />}
      {expectedHeaders && <ExpectedHeadersAdvisoryIcon advisories={expectedHeaderAdvisories} />}
    </>
  )
}

/** A stored credential literal is discarded by the switch, so it is confirmed first (REQ-3.1.3.18). */
function dropsStoredCredential(
  pressed: boolean,
  isCredentialInput: boolean,
  current: unknown,
): boolean {
  return pressed && isCredentialInput && (isStoredSecretValue(current) || isSealedMapCredential(current))
}

/** What the field shows and checks: a lockedWhen pin holds a value; no secret field shows a default (SECUI-13);
 *  a not-set field uses its default, which fills a required one only when it holds something. */
function rowValueStanding(opts: {
  parameter: Parameter
  value: unknown
  pin: { value: unknown } | undefined
  cipherDefault: unknown
  isExpressionMode: boolean
}) {
  const { parameter, value, pin, cipherDefault, isExpressionMode } = opts
  if (pin) return { fieldValue: pin.value, shownDefault: undefined, effectiveValue: pin.value, requiredValue: pin.value, isSet: true }
  const shownDefault = parameter.secret ? undefined : (cipherDefault ?? shownDefaultOf(parameter))
  const filledDefault =
    shownDefault !== undefined && isValueNonEmpty(shownDefault, parameter.type) ? shownDefault : undefined
  return {
    fieldValue: value,
    shownDefault,
    effectiveValue: value ?? parameter.defaultValue,
    // An explicit null fills a field that takes null (REQ-3.1.3.21).
    requiredValue: value === null && parameter.acceptsNull === true ? null : (value ?? filledDefault),
    isSet: isExpressionMode ? expressionIsHeld(value) : value !== undefined,
  }
}

/** The field's amber line and error line; an input field's message from the window (FIELD-13) is its own error. */
function rowMessages(opts: {
  mode: 'input' | 'output'
  expressionWarning: string | null
  credentialLiteral: boolean
  value: unknown
  secretSaveTarget: SecretSaveTarget
  rowNote: string | null
  errorMessage: string | null
  fieldError: string | undefined
}) {
  // A credential literal stays plain text until the Test (or Function) save seals it (REQ-3.1.3.18).
  const unsavedSecretNote =
    opts.credentialLiteral && holdsUnsavedSecret(opts.value) ? secretStaysVisibleText(opts.secretSaveTarget) : null
  // The note naming a mistake comes first, the unsaved-secret line under it (OS-2, SECFLD-1).
  const warnings =
    opts.expressionWarning === null
      ? [opts.rowNote, unsavedSecretNote].filter((note): note is string => note !== null)
      : [opts.expressionWarning]
  const input = opts.mode === 'input'
  const rowError = opts.errorMessage ?? (input ? (opts.fieldError ?? null) : null)
  const bindingError = input ? undefined : opts.fieldError
  const hasMessage = rowError !== null || warnings.length > 0 || Boolean(bindingError)
  let cellPadding = hasMessage ? MESSAGE_ROW_CELL_PADDING : 'p-2'
  if (warnings.length > 1) cellPadding = TWO_LINE_ROW_CELL_PADDING
  return { warnings, rowError, bindingError, hasMessage, cellPadding }
}

/** The flat flags the literal inputs read: the whole field `name` and its entries `name.<key>` (FIELD-6). */
function flatExpressionFields(name: string, modes: FieldModes): string[] {
  const entries = modes.entryExpressions.map((key) => `${name}.${key}`)
  return modes.expression ? [name, ...entries] : entries
}

/** The control the field draws now, looked up when asked: a masked face gives way to a box. */
function valueBoxIn(wrapper: RefObject<HTMLDivElement | null>): RefObject<HTMLElement | null> {
  return {
    // A sheet closing with its field (a window or row that goes) finds no box.
    get current() {
      const shell = wrapper.current
      return shell === null ? null : shell.querySelector<HTMLElement>(VALUE_BOX_SELECTOR)
    },
  }
}

interface SwitchDialogState {
  direction: SwitchModeDirection
  hasDefault: boolean
  offersEmpty: boolean
  onCancel: () => void
  onClearDefault: () => void
  onClearEmpty: () => void
}

interface FilePickerState {
  open: boolean
  ref: SheetOpener['ref']
  label: string
  mode: NonNullable<Parameter['fileReference']>
  artifactsOnly: boolean | undefined
  initialValue: string
  presetName: string | undefined
  testId: string | null
  onChoose: (chosen: string) => void
  onClose: () => void
}

/** Everything the cell draws, built by `useFieldCell`. */
export interface FieldCellState {
  parameter: Parameter
  mode: 'input' | 'output'
  /** parameter.label ?? parameter.name - the field's visible name. */
  displayLabel: string
  isRequired: boolean
  /** The type a selectableType row shows. */
  selectedType: string | undefined
  /** The lockedOnRemoteHost entry while the block runs there (HTTP-13). */
  remoteLock: { displayText: string } | undefined
  /** The padding a table row gives every cell, so the message hangs under the field (FIELDERR-2). */
  cellPadding: string
  /** The cell shows a line under the field. */
  hasMessage: boolean
  widget: ReactNode
  valueWrapperRef: RefObject<HTMLDivElement | null>
  /** The whole path, while a long one shows its end (TDATA-8). */
  title: string | undefined
  keepsExpandColumn: boolean
  browseHint: string | null
  onBrowse: () => void
  expressionToggle: {
    testId: string
    pressed: boolean
    disabled: boolean
    label: string
    onPressedChange: (pressed: boolean) => void
  } | null
  emptyToggleSlot: boolean
  rowError: string | null
  warnings: string[]
  bindingError: string | undefined
  errorId: string
  warningId: string
  fieldErrorId: string
  filePicker: FilePickerState | null
  unsavedQuestion: ReturnType<typeof useFieldSheets>['question']
  switchDialog: SwitchDialogState | null
  credentialDrop: { label: string; onConfirm: () => void; onClose: () => void } | null
}

/** Everything one field does: locks, value standing, checks, messages, the switch, its sheets and flag cleanup. */
export function useFieldCell({
  mode,
  parameter,
  value,
  onChange,
  modes,
  availableVariables,
  fieldError,
  onValidationChange,
  toggleTestId = 'expression-toggle',
  allValues,
  allParameters,
  allExpressionFields,
  credentialCatalogKeys,
  mapExtras,
  runsOnRemoteHost = false,
  readOnly = false,
  testId = null,
  scriptEditor,
  secretSaveTarget = 'test',
  accessibleName,
}: Readonly<FieldCellProps>): FieldCellState {
  const isExpressionMode = modes.expression
  const displayLabel = parameterLabel(parameter)
  const fieldErrorId = useId()
  const expressionFields = flatExpressionFields(parameter.name, modes)
  const templateFields = modes.template ? [parameter.name] : NO_FIELDS
  const siblingExpressionFields = (allExpressionFields ?? NO_FIELDS).filter((flag) => flag !== parameter.name)

  const { pin, remoteLock, locked } = rowLocks(parameter, allValues, allParameters, runsOnRemoteHost)

  // Declared credential input field: status icon in the value slot (REQ-3.1.3.18)
  const isCredentialInput = mode === 'input' && parameter.secret === true
  // A literal credential's own lock carries its status; an {x} credential shows what its expression reads.
  const credentialStatus = resolveCredentialStatus(
    isCredentialInput && isExpressionMode,
    isExpressionMode,
    value,
    availableVariables,
  )

  const { contentTypeAdvisory, expectedHeaderAdvisories, unsecuredCredential } = rowAdvisories({
    mode,
    parameter,
    isExpressionMode,
    current: value ?? parameter.defaultValue,
    allValues,
    mapExtras,
    expressionFields,
    credentialCatalogKeys,
    availableVariables,
  })

  // Confirm before discarding a stored credential literal on switch to expression
  const [showCredentialDropConfirm, setShowCredentialDropConfirm] = useState(false)
  const [switchAsk, setSwitchAsk] = useState<SwitchModeDirection | null>(null)
  const [lineProblems, setLineProblems] = useState<string[]>([])

  // Cipher Suites shows the list the run sends for the TLS versions while unset (FIELD-10).
  const cipherStanding = useCipherSuitesStanding(parameter, value, allValues, allParameters)
  const { fieldValue, shownDefault, effectiveValue, requiredValue, isSet } = rowValueStanding({
    parameter,
    value,
    pin,
    cipherDefault: cipherStanding.defaultList,
    isExpressionMode,
  })

  const { fileReference, showBrowse, browseHint, literalValue, tailVisible } = browseState({
    parameter,
    mode,
    isExpressionMode,
    readOnly,
    runsOnRemoteHost,
    effectiveValue,
  })
  const fieldSheets = useFieldSheets(displayLabel)
  const valueWrapperRef = useRef<HTMLDivElement>(null)
  const valueBox = useMemo(() => valueBoxIn(valueWrapperRef), [])
  // A long path shows its end, where the file name is (TDATA-8).
  useEffect(() => {
    const input = tailVisible ? (valueWrapperRef.current as HTMLDivElement).querySelector('input') : null
    if (input) input.scrollLeft = input.scrollWidth
  }, [tailVisible])

  const selectedType = resolveSelectedType({
    parameter,
    allValues,
    isExpressionMode,
    effectiveValue,
    availableVariables,
  })

  // Validation - evaluate requiredWhen / requiredWhenAll if present
  const isRequired = isParameterRequired(parameter, allValues, allParameters)
  const validationError = rowErrorState({
    mode,
    parameter,
    displayLabel,
    effectiveValue,
    requiredValue,
    lineProblem: lineProblems[0] ?? null,
    cipherProblem: cipherStanding.outOfRange,
    // A Template is checked as written source, as an {x} is (REQ-3.1.3.15).
    isSourceMode: isExpressionMode || modes.template,
    isRequired,
    selectedType,
    availableVariables,
    allValues,
    // Outside a table a declared bound reads the field's own value.
    boundValues: allValues ?? { [parameter.name]: value },
    allParameters,
    boundExpressionFields: new Set([...siblingExpressionFields, ...expressionFields, ...templateFields]),
  })
  const errorId = useId()

  // An expression's own finding never blocks Save; it shows amber under the field (FIELDERR-3).
  const checksExpression = mode === 'input' && isExpressionMode
  const expressionText = isSet ? value : ''
  const { ready: validatorReady } = useExpressionValidator(checksExpression)
  const expressionWarning = useMemo(
    () => (checksExpression ? firstExpressionFinding(expressionText, availableVariables) : null),
    // validatorReady re-runs the check once the parser has loaded.
    [checksExpression, expressionText, availableVariables, validatorReady],
  )
  const rowNote =
    parameter.rowNote?.({
      value,
      isExpression: isExpressionMode,
      allValues: allValues ?? {},
      now: new Date(),
    }) ?? null
  const { warnings, rowError, bindingError, hasMessage, cellPadding } = rowMessages({
    mode,
    expressionWarning,
    credentialLiteral: isCredentialInput && !isExpressionMode,
    value,
    secretSaveTarget,
    rowNote,
    errorMessage: validationError,
    fieldError,
  })
  const warningId = useId()

  useEffect(() => {
    if (onValidationChange) {
      onValidationChange(parameter.name, validationError)
    }
  }, [validationError, onValidationChange, parameter.name])

  // The field's own flags go with its value: entry {x}, the Template mark, element types.
  const clearOwnFlags = () => {
    if (modes.entryExpressions.length > 0) modes.setEntryExpressions([])
    if (modes.template) modes.setTemplate(false)
    if (modes.elementTypes !== undefined) modes.setElementTypes(undefined)
    setLineProblems([])
  }

  const nullable = takesNull(parameter, shownDefault)
  const adornment = rowAdornment({ credentialStatus, contentTypeAdvisory, expectedHeaderAdvisories, unsecuredCredential })
  const field: BlockFieldState = {
    isSet,
    defaultValue: shownDefault,
    nullable,
    readOnly: locked,
    onUnset: () => {
      onChange(undefined)
      if (!isExpressionMode) clearOwnFlags()
    },
    onNull: () => {
      onChange(null)
      clearOwnFlags()
    },
    adornment,
    onValidation: setLineProblems,
    required: isRequired,
    returnFocus: valueBox,
    accessibleName,
  }

  // Choice lists and true / false always hold a value, so leaving {x} writes the default (FIELD-8).
  const holdsChoice = parameter.enumValues !== undefined || parameter.type === 'boolean'

  const switchMode = (pressed: boolean, outcome: SwitchOutcome) => {
    setSwitchAsk(null)
    setShowCredentialDropConfirm(false)
    modes.setExpression(pressed)
    setLineProblems([])
    // Switching never carries a value in (FIELD-7).
    if (outcome === 'empty') onChange(emptyValueOf(parameter.type, pressed))
    else if (outcome === 'discard') onChange('')
    else if (!pressed && holdsChoice) onChange(parameter.defaultValue)
    else if (value !== undefined) onChange(undefined)
  }

  const holdsLiteral = holdsLiteralValue(value, nullable)

  const handleToggleExpression = (pressed: boolean) => {
    // Confirm before the switch discards a stored protected value (REQ-3.1.3.18).
    if (dropsStoredCredential(pressed, isCredentialInput, value)) {
      setShowCredentialDropConfirm(true)
      return
    }
    const held = pressed ? holdsLiteral : expressionIsHeld(value)
    if (held) setSwitchAsk(pressed ? 'to-expression' : 'to-plain')
    else switchMode(pressed, 'default')
  }

  const widget = selectRowInput({
    mode,
    isExpressionMode,
    fieldError,
    fieldErrorId,
    parameter,
    displayLabel,
    value: fieldValue,
    effectiveValue,
    onChange,
    errorMessage: validationError,
    availableVariables,
    templateFields,
    onTemplateFieldsChange: (next) => modes.setTemplate(next.includes(parameter.name)),
    expressionFields,
    onExpressionFieldsChange: (next) => modes.setEntryExpressions(entryFlagsFor(parameter.name, next)),
    selectedType,
    allValues,
    allParameters,
    credentialCatalogKeys,
    locked,
    remoteLock,
    mapExtras,
    scriptEditor,
    elementTypes: modes.elementTypes,
    onElementTypesChange: modes.setElementTypes,
    valueSheet: fieldSheets.value,
    field,
    expressionAdornment: adornment,
  })
  const columns = rowColumns(mode, parameter, isExpressionMode)

  return {
    parameter,
    mode,
    displayLabel,
    isRequired,
    selectedType,
    remoteLock,
    cellPadding,
    hasMessage,
    widget,
    valueWrapperRef,
    title: tailVisible ? literalValue : undefined,
    keepsExpandColumn: columns.keepsExpandColumn,
    browseHint: showBrowse ? browseHint : null,
    onBrowse: fieldSheets.picker.show,
    expressionToggle: columns.offersExpressionToggle
      ? {
          testId: toggleTestId,
          pressed: isExpressionMode,
          disabled: locked,
          label: `${accessibleName ?? displayLabel} expression mode`,
          // Switching kinds takes the literal editors away (A row the surface takes away).
          onPressedChange: (pressed) => fieldSheets.takeAway(() => handleToggleExpression(pressed)),
        }
      : null,
    emptyToggleSlot: columns.emptyToggleSlot,
    rowError,
    warnings,
    bindingError,
    errorId,
    warningId,
    fieldErrorId,
    filePicker:
      fieldSheets.picker.open && fileReference !== undefined
        ? {
            open: true,
            ref: fieldSheets.picker.ref,
            label: displayLabel,
            mode: fileReference,
            artifactsOnly: parameter.fileReferenceArtifactsOnly,
            initialValue: literalValue,
            presetName: destinationPresetName(parameter, allValues, siblingExpressionFields),
            testId,
            onChoose: (chosen) => onChange(chosen),
            onClose: fieldSheets.picker.hide,
          }
        : null,
    unsavedQuestion: fieldSheets.question,
    switchDialog:
      switchAsk === null
        ? null
        : {
            direction: switchAsk,
            hasDefault: shownDefault !== undefined,
            offersEmpty: offersEmptyValue(parameter),
            onCancel: () => setSwitchAsk(null),
            onClearDefault: () => switchMode(switchAsk === 'to-expression', 'default'),
            onClearEmpty: () => switchMode(switchAsk === 'to-expression', 'empty'),
          },
    credentialDrop: showCredentialDropConfirm
      ? {
          label: displayLabel,
          onConfirm: () => switchMode(true, 'discard'),
          onClose: () => setShowCredentialDropConfirm(false),
        }
      : null,
  }
}

/** The field, its expand, Browse and {x} columns, the lines under it, and its sheets and dialogs (FIELD-1). */
export function FieldCellView({ state }: Readonly<{ state: FieldCellState }>) {
  const { parameter, expressionToggle, filePicker, switchDialog, credentialDrop } = state
  return (
    <>
      <div className="relative flex items-center gap-2">
        <div ref={state.valueWrapperRef} className="relative flex-1 min-w-0" title={state.title}>
          <FieldErrorContext value={state.rowError === null ? undefined : state.errorId}>
            <FieldNoteContext value={state.warnings.length === 0 ? undefined : state.warningId}>
              {state.widget}
            </FieldNoteContext>
          </FieldErrorContext>
        </div>
        {state.keepsExpandColumn && <span aria-hidden="true" className={ICON_COLUMN_CLASS} />}

        {state.browseHint !== null && (
          <ConditionalTooltip content={state.browseHint}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-testid={`param-browse-${parameter.name}`}
              aria-label={`Browse files for ${state.displayLabel}`}
              onClick={state.onBrowse}
              className="shrink-0"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </ConditionalTooltip>
        )}

        {expressionToggle && (
          <ExpressionToggle
            data-testid={expressionToggle.testId}
            pressed={expressionToggle.pressed}
            onPressedChange={expressionToggle.onPressedChange}
            disabled={expressionToggle.disabled}
            label={expressionToggle.label}
          />
        )}
        {state.emptyToggleSlot && <span aria-hidden="true" className={ICON_COLUMN_CLASS} />}

        {state.rowError !== null && (
          <p
            id={state.errorId}
            role="alert"
            data-testid={`param-error-${parameter.name}`}
            className={cn(FIELD_MESSAGE_CLASS, 'text-destructive')}
          >
            {state.rowError}
          </p>
        )}
        {state.warnings.length > 0 && (
          <div
            id={state.warningId}
            data-testid={`param-warning-${parameter.name}`}
            className={cn(FIELD_MESSAGE_CLASS, 'text-warning')}
          >
            {state.warnings.map((text) => (
              <p key={text} className="truncate">
                {text}
              </p>
            ))}
          </div>
        )}
        {/* Output binding type mismatch error */}
        {state.bindingError && (
          <p
            role="alert"
            id={state.fieldErrorId}
            data-testid={`field-error-${parameter.name}`}
            className={cn(FIELD_MESSAGE_CLASS, 'text-destructive')}
          >
            {state.bindingError}
          </p>
        )}
      </div>

      {filePicker && (
        <FileReferencePickerSheet
          ref={filePicker.ref}
          open={filePicker.open}
          label={filePicker.label}
          mode={filePicker.mode}
          artifactsOnly={filePicker.artifactsOnly}
          initialValue={filePicker.initialValue}
          presetName={filePicker.presetName}
          testId={filePicker.testId}
          onChoose={filePicker.onChoose}
          onClose={filePicker.onClose}
        />
      )}

      <UnsavedChangesDialog {...state.unsavedQuestion} />

      {switchDialog && (
        <SwitchModeDialog
          open
          direction={switchDialog.direction}
          hasDefault={switchDialog.hasDefault}
          offersEmpty={switchDialog.offersEmpty}
          onCancel={switchDialog.onCancel}
          onClearDefault={switchDialog.onClearDefault}
          onClearEmpty={switchDialog.onClearEmpty}
        />
      )}

      {credentialDrop && (
        <ConfirmationDialog
          isOpen
          variant="discard"
          title="Discard protected value?"
          description={`The protected value stored in ${credentialDrop.label} will be discarded when you switch to an expression. The field will then reference a variable instead.`}
          confirmLabel="Switch to expression"
          onConfirm={credentialDrop.onConfirm}
          onClose={credentialDrop.onClose}
        />
      )}
    </>
  )
}
