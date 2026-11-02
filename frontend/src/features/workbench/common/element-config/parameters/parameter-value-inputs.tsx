/**
 * Type-specific value input widgets for literal-mode parameters.
 *
 * Every free-entry widget draws the one value field (REQ-3.1.1.5, FIELD-1) and opens
 * its editor from the field's expand; ParameterRow keeps layout and validation.
 */

import { use, type ReactNode } from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn, safeStringify } from '@/lib/utils'
import { isSealedMapCredential, isStoredSecretValue } from '@/lib/secret-envelope'
import { FieldErrorContext } from '@/components/shared/fields/field-error-context'
import { useProtectedValueConfirm } from '@/components/shared/variable-bodies/protected-value-field'
import { SheetFrozenContext } from '@/components/shared/sheet-layer'
import { useSheetOpener, type SheetOpener } from '@/components/shared/draggable-sheet'
import { BlockValueField } from '@/features/workbench/common/variables/variable-inspect-modal/window-value-field'
import { ValueEditorSheet } from '@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet'
import { PartsEditorSheet, type Part } from '../parts-editor/parts-editor-sheet'
import { FieldsEditorSheet } from '../opensearch-editors/fields-editor-sheet'
import { StatsEditorSheet } from '../opensearch-editors/stats-editor-sheet'
import { recordItems, recordRows, type RecordRow } from '@/features/workbench/lib/record-rows'
import { FieldSuggestContext } from './field-suggest-context'
import { ListItemNounContext } from '@/components/shared/variable-bodies/list-item-noun-context'
import { UnsecuredCredentialAdvisory } from '@/components/shared/variable-bodies/map-edit-body'
import { useFieldSuggestions } from './field-suggestions'
import { CipherPickerSheet } from '../cipher-picker/cipher-picker-sheet'
import { resolveTlsRange } from '../cipher-picker/tls-inventory'
import { resolveKeyPolicy } from '@/features/workbench/lib/node-parameters/key-policy'
import {
  partsExprIndicesFor,
  withPartsExprIndices,
} from '@/features/workbench/lib/node-parameters/indexed-expression-fields'
import {
  analyzeCredentialExpression,
  mapEntryCredentialAdvisory,
} from '@/features/workbench/lib/expression-validation/credential-advisory'
import { CredentialRevealContext } from '../use-credential-reveal'
import type { AvailableVariable } from '../expressions/expression-field'
import { makeExpressionEditor } from '../expressions/expression-entry-editor'
import type { SqlDatabaseType, TextFormat } from '@/lib/codemirror/format-editor'
import type { ScriptIssue } from '@/features/workbench/lib/python-script-validation/script-issues'
import type { SqlCatalogRequest } from '@/features/workbench/api/sql-tools'
import type { OpenSearchFieldsRequest } from '@/features/workbench/api/opensearch-tools'
import type { ElementTypes } from '@/lib/variable-validation'
import type { VariableType } from '@/lib/variable-types'
import {
  type MapParamExtras,
  type Parameter,
  EMPTY_MAP,
  EMPTY_ARRAY,
  parameterLabel,
} from './parameter-table-types'

// Map / Array params have no template autocomplete scope.
const EMPTY_AVAILABLE: AvailableVariable[] = []
const EMPTY_STRING_ARRAY: string[] = []

/** What a script body (python, sql, dql, query-dsl) needs beyond an ordinary string param (PYRUN-13/19/21, SQL-10..13, OS-12). */
export interface ScriptEditorProps {
  nodeId?: string
  inputVariables?: AvailableVariable[]
  inputVariableTypes?: Record<string, string>
  exportNames?: string[]
  interpreter?: string
  onRun?: (draft: string) => void
  onStop?: () => void
  runBusy?: boolean
  runAllowed?: boolean
  runBlockedNote?: string | null
  onRenameSymbol?: (oldName: string, newName: string) => void
  onSyntaxIssues?: (issues: ScriptIssue[]) => void
  /** The debug session is paused at this very block, so Run repeats it (PYRUN-21). */
  runPausedHere?: boolean
  databaseType?: SqlDatabaseType
  parameterNames?: readonly string[] | null
  sqlCatalogRequest?: SqlCatalogRequest | null
  openSearchFieldsRequest?: OpenSearchFieldsRequest | null
  /** The Index pattern the query check findings name. */
  openSearchIndex?: string
}

const NO_SCRIPT_EDITOR: ScriptEditorProps = {}

// PYRUN-13, SQL-10, OS-12: the formats that turn the Edit value sheet into a script editor a row runs.
const SCRIPT_FORMATS: ReadonlySet<string> = new Set(['python', 'sql', 'dql', 'query-dsl'])

// Exact approved tooltip copy for the credential-field status icon (SECFLD-1..4).
export const CREDENTIAL_LITERAL_TOOLTIP =
  'This value is stored protected - after saving, it can be replaced, and viewed only ' +
  'while secret unmasking is enabled in Settings.'
export const CREDENTIAL_SECRET_EXPR_TOOLTIP = 'Value protected - references a secret variable.'
export function credentialUnprotectedExprTooltip(variableName: string): string {
  return (
    `Variable ${variableName} is not a secret - its value is stored and displayed unprotected. ` +
    `Mark it secret in the Variable Manager to protect it.`
  )
}

export interface CredentialStatus {
  kind: 'protected' | 'alert'
  label: string
}

export const CREDENTIAL_LITERAL_EXPR_TOOLTIP =
  'This expression contains literal text - its value is stored and displayed unprotected. ' +
  'Use a secret variable or an auth helper instead.'

/** The credential-field status for a value slot: gray lock when the value is
 *  protected (literal, or an expression built purely from secret variables),
 *  amber alert when the expression carries unprotected material (a literal or
 *  a non-secret variable, anywhere in the tree), none when the
 *  expression resolves to nothing known (REQ-3.1.3.18). */
export function resolveCredentialStatus(
  isCredential: boolean,
  isExpressionMode: boolean,
  effectiveValue: unknown,
  availableVariables: AvailableVariable[],
): CredentialStatus | null {
  if (!isCredential) return null
  if (!isExpressionMode) return { kind: 'protected', label: CREDENTIAL_LITERAL_TOOLTIP }
  const analysis = analyzeCredentialExpression(
    safeStringify(effectiveValue),
    availableVariables.map((v) => ({ name: v.name, isSecret: v.isSecret === true })),
  )
  if (analysis.unprotected) {
    return {
      kind: 'alert',
      label: analysis.nonSecretVariable
        ? credentialUnprotectedExprTooltip(analysis.nonSecretVariable)
        : CREDENTIAL_LITERAL_EXPR_TOOLTIP,
    }
  }
  if (analysis.referencesSecret) return { kind: 'protected', label: CREDENTIAL_SECRET_EXPR_TOOLTIP }
  return null
}

/** Non-interactive status icon in the credential field's right slot: not in the
 *  tab order; its tooltip copy doubles as the accessible label (SECFLD-1..4). */
export function CredentialStatusIcon({ kind, label }: Readonly<CredentialStatus>) {
  return (
    <ConditionalTooltip
      content={label}
      side="bottom"
      align="end"
      wide
    >
      <span
        aria-label={label}
        className="absolute right-2 top-1/2 -translate-y-1/2 z-10 inline-flex items-center"
      >
        {kind === 'alert' ? (
          <AlertTriangle className="h-[15px] w-[15px] text-amber-500" aria-hidden="true" />
        ) : (
          <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )}
      </span>
    </ConditionalTooltip>
  )
}

/** How the row's one value field stands (REQ-3.1.1.5): what it holds, its default and its null rule. */
export interface BlockFieldState {
  /** False while the field holds nothing: its default shows gray, or null when it takes one. */
  isSet: boolean
  defaultValue?: unknown
  nullable: boolean
  readOnly: boolean
  /** Back to not set, with the field's flags. */
  onUnset: () => void
  onNull: () => void
  /** Status icons the row draws inside the field. */
  adornment?: ReactNode
  /** A list, map or table line that does not read as a value yet. */
  onValidation?: (messages: string[]) => void
}

/** The standing of a widget used on its own: set once it holds a value, no default, no null. */
function standaloneField(value: unknown, onChange: (value: unknown) => void): BlockFieldState {
  return {
    isSet: value !== undefined,
    nullable: false,
    readOnly: false,
    onUnset: () => onChange(undefined),
    onNull: () => onChange(null),
  }
}

/** What the field's editor opens on: the value it holds, else its default filled in (FIELD-2). */
function editorValue(field: BlockFieldState, value: unknown, fallback: unknown): unknown {
  if (field.isSet && value !== null && value !== undefined) return value
  if (!field.isSet && field.defaultValue !== undefined) return field.defaultValue
  return fallback
}

/** A list field's rows for its editor: the opened value when it is a list, else none. */
function openedRows(field: BlockFieldState, value: unknown): unknown[] {
  const opened = editorValue(field, value, EMPTY_ARRAY)
  return Array.isArray(opened) ? opened : EMPTY_ARRAY
}

/** The field's props every free-entry widget shares. */
function fieldProps(parameter: Parameter, field: BlockFieldState) {
  return {
    mode: 'literal' as const,
    isSet: field.isSet,
    defaultValue: field.defaultValue,
    nullable: field.nullable,
    readOnly: field.readOnly,
    testId: parameter.name,
    label: parameterLabel(parameter),
    onUnset: field.onUnset,
    onNull: field.onNull,
    adornment: field.adornment,
    onValidation: field.onValidation,
  }
}

/** Declared credential literal (REQ-3.1.3.18): a STORED (sealed) value is masked write-only - dots and
 *  Delete & Edit - while a value typed this session stays in the one value field until the config is saved.
 *  With the credential-inputs unmask on, an unedited stored value shows its revealed plaintext. Templates
 *  are suppressed so a credential literal is always sealable. */
export function CredentialValueInput({
  parameter,
  effectiveValue,
  onChange,
  sheet,
  field,
}: Readonly<{
  parameter: Parameter
  effectiveValue: unknown
  onChange: (value: unknown) => void
  sheet: SheetOpener
  field: BlockFieldState
}>) {
  const revealed = use(CredentialRevealContext)
  const confirm = useProtectedValueConfirm()
  // A stored value reads back sealed (block config) or as the mask (a Function Block's secret input).
  const sealed = isStoredSecretValue(effectiveValue)
  // Reveal applies only to an UNEDITED stored secret; once edited, the field shows the new plaintext.
  const revealOverride = sealed ? revealed[parameter.name] : undefined
  const type = parameter.type as VariableType
  return (
    <>
      <BlockValueField
        {...fieldProps(parameter, field)}
        type={type}
        value={effectiveValue}
        hasEditor={type === 'string'}
        leftIcon="lock"
        leftIconLabel={CREDENTIAL_LITERAL_TOOLTIP}
        revealedText={revealOverride}
        onEditSecret={() => confirm.open(() => onChange(''))}
        onChange={(next) => onChange(next)}
        onExpand={sheet.show}
      />
      {sheet.open && (
        <ValueEditorSheet
          ref={sheet.ref}
          label={parameterLabel(parameter)}
          name={parameter.name}
          type="string"
          // A sealed value has no expand until it is revealed.
          value={revealOverride ?? safeStringify(effectiveValue)}
          isTemplate={false}
          allowTemplate={false}
          allowedFormats={parameter.allowedFormats as TextFormat[]}
          availableVariables={EMPTY_AVAILABLE}
          onSave={(next) => onChange(next)}
          onClose={sheet.hide}
        />
      )}
      {confirm.dialog}
    </>
  )
}

/** Display label of an enum option: the schema enumLabels entry, else the value as text. */
export function enumLabelOf(parameter: Parameter, opt: string | number): string {
  const text = String(opt)
  return parameter.enumLabels?.[text] ?? text
}

/** The allowed value a picked option's text stands for: a number choice reads back as its number (REQ-3.1.2.11). */
export function enumValueOf(values: ReadonlyArray<string | number>, text: string): string | number {
  return values.find((value) => String(value) === text) ?? text
}

/** Enum option body shared by the plain select and the searchable picker (K8SREAD-4). */
export function enumOptionBody(parameter: Parameter, opt: string | number): ReactNode {
  const label = enumLabelOf(parameter, opt)
  const sublabel = parameter.enumSublabels?.[String(opt)]
  return sublabel ? (
    <span className="flex min-w-0 items-baseline gap-2">
      <span translate="no" className="truncate">
        {label}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{sublabel}</span>
    </span>
  ) : (
    <span translate="no">{label}</span>
  )
}

/** Group heading band shared by both enum paths (K8SREAD-5); -mx-1 spans the list's p-1 padding. */
const ENUM_GROUP_HEADING_CLASSES =
  '-mx-1 bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'

// Same tokens through cmdk's heading variant; literal so Tailwind emits them.
export const ENUM_GROUP_HEADING_CMDK_CLASSES =
  '[&_[cmdk-group-heading]]:-mx-1 [&_[cmdk-group-heading]]:bg-muted [&_[cmdk-group-heading]]:px-3 ' +
  '[&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold ' +
  '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider ' +
  '[&_[cmdk-group-heading]]:text-muted-foreground'

/** Plain enum select: enumLabels, enumSublabels and enumGroups (K8SREAD-5) shape the menu; every option stays offered. */
export function EnumInput({
  parameter,
  effectiveValue,
  onChange,
  showRequiredError,
  lockedDisplayText,
  valueClassName,
  id,
}: Readonly<{
  parameter: Parameter
  effectiveValue: unknown
  onChange: (value: unknown) => void
  showRequiredError: boolean
  /** Renders the select disabled, reading this text in place of the value (HTTP-13). */
  lockedDisplayText?: string
  /** The look of the picked value (the variable window draws it in its type's value color). */
  valueClassName?: string
  /** The trigger's id, so a caption label names and focuses it. */
  id?: string
}>) {
  const errorId = use(FieldErrorContext)
  /* v8 ignore next - COV-BRANCH-111 */
  const selected = safeStringify(effectiveValue)
  const allowed = parameter.enumValues ?? []
  // Radix keeps the empty text for "nothing picked", so it is never an item; a repeated value is one item.
  const renderItems = (values: ReadonlyArray<string | number>) =>
    [...new Set(values.map(String))].filter((opt) => opt !== '').map((opt) => (
      <SelectItem key={opt} value={opt}>
        {enumOptionBody(parameter, opt)}
      </SelectItem>
    ))
  const locked = lockedDisplayText !== undefined
  // Always text, never undefined: a first pick on an empty select must not portal the item text into it.
  const selectedLabel = selected ? enumLabelOf(parameter, selected) : ''
  return (
    <Select value={selected} onValueChange={(text) => onChange(enumValueOf(allowed, text))} disabled={locked}>
      <SelectTrigger
        id={id}
        aria-label={parameterLabel(parameter)}
        aria-invalid={showRequiredError}
        aria-describedby={errorId}
        // The locked row carries the fade; the trigger's own would double it.
        className={cn(showRequiredError && 'border-destructive', locked && 'disabled:opacity-100')}
      >
        <SelectValue placeholder={lockedDisplayText ?? 'Select…'}>
          {/* The value part takes no class of its own, so a look wraps the picked text. */}
          {valueClassName && selectedLabel !== '' ? (
            <span className={valueClassName}>{selectedLabel}</span>
          ) : (
            (lockedDisplayText ?? selectedLabel)
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {parameter.enumGroups
          ? parameter.enumGroups.map((group) => (
              <SelectGroup key={group.heading}>
                <SelectLabel className={ENUM_GROUP_HEADING_CLASSES}>{group.heading}</SelectLabel>
                {renderItems(group.values)}
              </SelectGroup>
            ))
          : renderItems(allowed)}
      </SelectContent>
    </Select>
  )
}

/** Boolean checkbox; `locked` renders it disabled (lockedWhen forces the value). It holds a real value, never a gray tick (FIELD-8). */
export function BooleanInput({
  ariaLabel,
  effectiveValue,
  onChange,
  locked = false,
}: Readonly<{
  ariaLabel: string
  effectiveValue: unknown
  onChange: (value: unknown) => void
  locked?: boolean
}>) {
  return (
    <Checkbox
      aria-label={ariaLabel}
      checked={Boolean(effectiveValue)}
      disabled={locked}
      className={cn(locked && 'cursor-not-allowed opacity-50')}
      onCheckedChange={(checked) => onChange(checked)}
    />
  )
}

/** A number row (REQ-3.1.3.14): the shared exact-number body inside the one value field; its default is real gray text. */
export function NumberValueInput({
  parameter,
  value,
  onChange,
  field,
}: Readonly<{
  parameter: Parameter
  value: unknown
  onChange: (value: unknown) => void
  field: BlockFieldState
}>) {
  return (
    <BlockValueField
      {...fieldProps(parameter, field)}
      type={parameter.type as VariableType}
      value={value}
      hasEditor={false}
      placeholder={parameter.placeholder}
      onChange={(next) => onChange(next)}
      onExpand={NO_EXPAND}
    />
  )
}

const NO_EXPAND = () => {}

/** Map keys whose dotted "<param>.<key>" entry appears in expressionFields. */
function mapExprKeysFor(paramName: string, expressionFields: string[]): string[] {
  const prefix = `${paramName}.`
  return expressionFields.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length))
}

/** Rewrite expressionFields so this param's dotted entries (map keys or list indices) equal exprKeys
 *  (other params' entries and the bare whole-param entry are preserved). */
function withDottedExprKeys(paramName: string, expressionFields: string[], exprKeys: string[]): string[] {
  const prefix = `${paramName}.`
  const kept = expressionFields.filter((f) => !f.startsWith(prefix))
  return [...kept, ...exprKeys.map((key) => `${paramName}.${key}`)]
}

function isPlainMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A text-only list item or map value as the text it reads as. */
function itemAsText(item: unknown): string {
  if (item === null || item === undefined) return ''
  return typeof item === 'string' ? item : safeStringify(item)
}

/** The per-entry unsecured-credential check of a map setting with a credential-key catalog, else none. */
function mapCredentialAdvisory(
  credentialCatalog: boolean | undefined,
  credentialCatalogKeys: string[] | undefined,
  availableVariables: AvailableVariable[],
): ((key: string, value: string, isExpr: boolean) => boolean) | undefined {
  if (!credentialCatalog || !credentialCatalogKeys?.length) return undefined
  const variables = availableVariables.map((v) => ({ name: v.name, isSecret: v.isSecret === true }))
  return (key, value, isExpr) => mapEntryCredentialAdvisory(key, value, credentialCatalogKeys, variables, isExpr)
}

/** Whether a map line holds an entry its editor flags as an unsecured credential (HTTP-4, SECFLD-2). */
export function mapLineCredentialAdvisory(
  parameter: Parameter,
  value: unknown,
  expressionFields: string[],
  credentialCatalogKeys: string[] | undefined,
  availableVariables: AvailableVariable[],
): boolean {
  const advisory = mapCredentialAdvisory(parameter.credentialCatalog, credentialCatalogKeys, availableVariables)
  if (advisory === undefined || !isPlainMap(value)) return false
  const exprKeys = mapExprKeysFor(parameter.name, expressionFields)
  return Object.entries(value).some(([key, entry]) => advisory(key, itemAsText(entry), exprKeys.includes(key)))
}

/** The map editor's advisory in the field's right slot; `beside` keeps it clear of another icon there. */
export function UnsecuredCredentialIcon({ beside }: Readonly<{ beside: boolean }>) {
  return (
    <UnsecuredCredentialAdvisory
      className={cn('absolute top-1/2 z-10 -translate-y-1/2', beside ? 'right-7' : 'right-2')}
    />
  )
}

/** A text-only map: every value as its text. */
function mapAsText(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, itemAsText(entry)]))
}

/** Map field + shared "Edit value" sheet (param maps stay string->string unless the schema declares typed
 *  values, whose element types store beside the value - REQ-3.1.3.19; each value is a literal or a whole-value
 *  expression tracked via dotted expressionFields). Schema opts thread the key policy, scaffolds, note, and
 *  credential advisory; the host threads generated rows and missing-header advisories. A map credential holding
 *  a stored value shows the shared masked control instead - no keys - and its "Edit Protected Value?" confirm
 *  clears the map and opens the empty editor. */
export function MapInput({
  parameter,
  effectiveValue,
  onChange,
  availableVariables,
  credentialCatalogKeys,
  mapExtras,
  expressionFields,
  onExpressionFieldsChange,
  elementTypes,
  onElementTypesChange,
  sheet: rowSheet,
  field,
}: Readonly<{
  parameter: Parameter
  effectiveValue: unknown
  onChange: (value: unknown) => void
  allValues?: Record<string, unknown>
  availableVariables?: AvailableVariable[]
  credentialCatalogKeys?: string[]
  mapExtras?: MapParamExtras
  expressionFields?: string[]
  onExpressionFieldsChange?: (fields: string[]) => void
  elementTypes?: ElementTypes
  onElementTypesChange?: (types: ElementTypes | undefined) => void
  sheet?: SheetOpener
  field?: BlockFieldState
}>) {
  const ownSheet = useSheetOpener()
  const sheet = rowSheet ?? ownSheet
  const clearConfirm = useProtectedValueConfirm()
  const secret = parameter.secret === true
  // A STORED map credential is write-only: neither its keys nor how many it has reach the editor.
  const masked = secret && isSealedMapCredential(effectiveValue)
  const state = field ?? standaloneField(effectiveValue, onChange)

  const vars = availableVariables ?? EMPTY_AVAILABLE
  const paramName = parameter.name
  const label = parameterLabel(parameter)
  const typed = parameter.typedValues === true
  const fields = expressionFields ?? EMPTY_STRING_ARRAY
  const exprKeys = mapExprKeysFor(paramName, fields)
  const credentialAdvisory = mapCredentialAdvisory(parameter.credentialCatalog, credentialCatalogKeys, vars)
  const mapEntryOptions = {
    quickInserts: parameter.quickInserts,
    note: parameter.editorNote,
    keyPolicy: parameter.keyPolicy ? resolveKeyPolicy(parameter.keyPolicy) : undefined,
    credentialAdvisory,
    generatedRows: mapExtras?.generatedRows,
    missingHeaderAdvisories: mapExtras?.missingHeaderAdvisories,
    expressionEditor: makeExpressionEditor(vars),
    expressionKeys: exprKeys,
  }
  const sheetValue = masked ? EMPTY_MAP : editorValue(state, effectiveValue, EMPTY_MAP)

  // Confirmed clear-and-retype: the stored map is dropped, its per-key expression
  // entries with it, and the empty editor opens on the same click.
  const handleConfirmClear = () => {
    onChange({})
    onExpressionFieldsChange?.(withDottedExprKeys(paramName, fields, []))
    onElementTypesChange?.(undefined)
    sheet.show()
  }

  return (
    <>
      <BlockValueField
        {...fieldProps(parameter, state)}
        type="map"
        value={effectiveValue}
        hasEditor
        leftIcon={secret ? 'lock' : undefined}
        expressionEntries={exprKeys}
        elementTypes={typed ? elementTypes : undefined}
        onEditSecret={() => clearConfirm.open(handleConfirmClear)}
        onChange={(next, nextTypes) => {
          // A map field's line always parses to a map.
          onChange(typed ? next : mapAsText(next as Record<string, unknown>))
          if (typed) onElementTypesChange?.(nextTypes)
        }}
        onExpand={sheet.show}
      />
      {sheet.open && (
        <ValueEditorSheet
          ref={sheet.ref}
          label={label}
          name=""
          type="map"
          value={sheetValue}
          isTemplate={false}
          allowTemplate={false}
          stringValuesOnly={!typed}
          elementTypes={typed ? elementTypes : undefined}
          mapEntryOptions={mapEntryOptions}
          availableVariables={EMPTY_AVAILABLE}
          onSave={(newValue, _isTemplate, savedKeys, newElementTypes) => {
            onChange(newValue)
            onExpressionFieldsChange?.(withDottedExprKeys(paramName, fields, savedKeys ?? []))
            if (typed) onElementTypesChange?.(newElementTypes)
          }}
          onClose={sheet.hide}
        />
      )}
      {clearConfirm.dialog}
    </>
  )
}

/** Indices of a list whose dotted "<param>.<i>" entry appears in expressionFields. */
function listExprIndicesFor(paramName: string, expressionFields: string[]): string[] {
  const pattern = new RegExp(String.raw`^${paramName}\.(\d+)$`)
  return expressionFields.flatMap((field) => pattern.exec(field)?.[1] ?? [])
}

/** List field + "Edit value" sheet; a text-only list saves items as text, and Save rewrites the `<param>.<i>` {x} flags. */
export function ArrayInput({
  parameter,
  effectiveValue,
  onChange,
  availableVariables,
  expressionFields = EMPTY_STRING_ARRAY,
  onExpressionFieldsChange,
  elementTypes,
  onElementTypesChange,
  sheet,
  field,
}: Readonly<{
  parameter: Parameter
  effectiveValue: unknown
  onChange: (value: unknown) => void
  availableVariables: AvailableVariable[]
  expressionFields?: string[]
  onExpressionFieldsChange: (fields: string[]) => void
  /** A typed list's item types, which the editor reports beside its items (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
  onElementTypesChange?: (types: ElementTypes | undefined) => void
  sheet: SheetOpener
  field: BlockFieldState
}>) {
  const typedValues = parameter.typedValues === true
  const exprIndices = listExprIndicesFor(parameter.name, expressionFields)
  const save = (next: unknown, nextTypes?: ElementTypes) => {
    onChange(typedValues || !Array.isArray(next) ? next : next.map(itemAsText))
    if (typedValues) onElementTypesChange?.(nextTypes)
  }
  return (
    <>
      <BlockValueField
        {...fieldProps(parameter, field)}
        type="array"
        value={effectiveValue}
        hasEditor
        expressionEntries={exprIndices}
        elementTypes={typedValues ? elementTypes : undefined}
        onChange={save}
        onExpand={sheet.show}
      />
      {sheet.open && (
        <ValueEditorSheet
          ref={sheet.ref}
          label={parameterLabel(parameter)}
          name=""
          type="array"
          value={editorValue(field, effectiveValue, EMPTY_ARRAY)}
          isTemplate={false}
          allowTemplate={false}
          stringValuesOnly={!typedValues}
          elementTypes={typedValues ? elementTypes : undefined}
          listEditor={{
            expressionEditor: makeExpressionEditor(availableVariables),
            expressionIndices: exprIndices.map(Number),
            codeView: true,
          }}
          availableVariables={EMPTY_AVAILABLE}
          onSave={(newValue, _isTemplate, savedIndices, newElementTypes) => {
            save(newValue, newElementTypes)
            onExpressionFieldsChange(withDottedExprKeys(parameter.name, expressionFields, savedIndices ?? []))
          }}
          onClose={sheet.hide}
        />
      )}
    </>
  )
}

/** How a record-row list names and numbers its rows. */
type OrderedList = NonNullable<Parameter['orderedList']>

/** A record-row list's opened editor: what it shows and how it hands its Save back. */
interface RecordListSheetProps {
  parameter: Parameter
  orderedList: OrderedList
  sheet: SheetOpener
  rows: readonly RecordRow[]
  expressionRows: ReadonlySet<number>
  availableVariables: AvailableVariable[]
  onSave: (rows: RecordRow[], expressionRows: Iterable<number>) => void
}

/** Fields and Stats open their own hosts, Arguments the shared list editor; each names its rows by the setting's noun (SHRUN-4). */
function RecordListSheet({
  parameter,
  orderedList,
  sheet,
  rows,
  expressionRows,
  availableVariables,
  onSave,
}: Readonly<RecordListSheetProps>) {
  const suggestions = use(FieldSuggestContext)
  const label = parameterLabel(parameter)
  const { positionPrefix, entry, itemNoun } = orderedList
  const shared = { ref: sheet.ref, label, rows, expressionRows, availableVariables, onSave, onCancel: sheet.hide }
  let editor: ReactNode
  if (entry === 'field') editor = <FieldsEditorSheet {...shared} suggestions={suggestions} />
  else if (entry === 'stat') editor = <StatsEditorSheet {...shared} fields={suggestions} />
  else {
    editor = (
      <ValueEditorSheet
        ref={sheet.ref}
        label={label}
        name=""
        type="array"
        value={recordItems(rows)}
        isTemplate={false}
        allowTemplate={false}
        stringValuesOnly
        listEditor={{
          expressionEditor: makeExpressionEditor(availableVariables),
          expressionIndices: expressionRows,
          positionLabel: (index) => `${positionPrefix}${index + 1}`,
        }}
        availableVariables={availableVariables}
        onSave={(items, _isTemplate, exprKeys) => onSave(recordRows(items as unknown[]), exprKeys.map(Number))}
        onClose={sheet.hide}
      />
    )
  }
  return <ListItemNounContext value={itemNoun}>{editor}</ListItemNounContext>
}

/** A list stored as record rows `[{value: x}]` (Arguments, Out arguments, Fields, Stats): one line of its
 *  values, edited in its list editor; each row's {x} flag is the dotted `<param>.<i>.value` (FIELD-10). */
export function RecordListInput({
  parameter,
  orderedList,
  effectiveValue,
  onChange,
  availableVariables,
  expressionFields,
  onExpressionFieldsChange,
  sheet,
  field,
}: Readonly<{
  parameter: Parameter
  orderedList: OrderedList
  effectiveValue: unknown
  onChange: (value: unknown) => void
  availableVariables: AvailableVariable[]
  expressionFields: string[]
  onExpressionFieldsChange: (fields: string[]) => void
  sheet: SheetOpener
  field: BlockFieldState
}>) {
  const items = (rows: unknown): unknown => (Array.isArray(rows) ? recordItems(rows) : rows)
  const expressionRows = partsExprIndicesFor(parameter.name, expressionFields)
  const itemDefault = field.defaultValue === undefined ? undefined : items(field.defaultValue)
  return (
    <>
      <BlockValueField
        {...fieldProps(parameter, { ...field, defaultValue: itemDefault })}
        type="array"
        value={items(effectiveValue)}
        hasEditor
        expressionEntries={[...expressionRows].map(String)}
        onChange={(next) => onChange(Array.isArray(next) ? recordRows(next) : next)}
        onExpand={sheet.show}
      />
      {sheet.open && (
        <RecordListSheet
          parameter={parameter}
          orderedList={orderedList}
          sheet={sheet}
          rows={openedRows(field, effectiveValue) as RecordRow[]}
          expressionRows={expressionRows}
          availableVariables={availableVariables}
          onSave={(rows, savedRows) => {
            onChange(rows)
            onExpressionFieldsChange(withPartsExprIndices(parameter.name, expressionFields, [...savedRows]))
          }}
        />
      )}
    </>
  )
}

/** Table field + shared "Edit value" sheet with the variable window's table editor (REQ-3.5.5.1). */
export function TableInput({
  parameter,
  effectiveValue,
  onChange,
  sheet,
  field,
}: Readonly<{
  parameter: Parameter
  effectiveValue: unknown
  onChange: (value: unknown) => void
  sheet: SheetOpener
  field: BlockFieldState
}>) {
  return (
    <>
      <BlockValueField
        {...fieldProps(parameter, field)}
        type="table"
        value={effectiveValue}
        hasEditor
        onChange={(next) => onChange(next)}
        onExpand={sheet.show}
      />
      {sheet.open && (
        <ValueEditorSheet
          ref={sheet.ref}
          label={parameterLabel(parameter)}
          name=""
          type="table"
          value={editorValue(field, effectiveValue, EMPTY_ARRAY)}
          isTemplate={false}
          allowTemplate={false}
          availableVariables={EMPTY_AVAILABLE}
          onSave={(newValue) => onChange(newValue)}
          onClose={sheet.hide}
        />
      )}
    </>
  )
}

/** Parts field + bespoke multipart Parts sheet. Each text-part value is a literal or a whole-value
 *  expression tracked via dotted expressionFields; the line draws an {x} value as a bare `{{ expr }}`. */
export function PartsInput({
  parameter,
  effectiveValue,
  onChange,
  availableVariables,
  expressionFields,
  onExpressionFieldsChange,
  sheet,
  field,
}: Readonly<{
  parameter: Parameter
  effectiveValue: unknown
  onChange: (value: unknown) => void
  availableVariables: AvailableVariable[]
  expressionFields: string[]
  onExpressionFieldsChange: (fields: string[]) => void
  sheet: SheetOpener
  field: BlockFieldState
}>) {
  const paramName = parameter.name
  const exprIndices = partsExprIndicesFor(paramName, expressionFields)
  return (
    <>
      <BlockValueField
        {...fieldProps(parameter, field)}
        type="array"
        value={effectiveValue}
        hasEditor
        expressionEntries={[...exprIndices].map((index) => `${index}.value`)}
        onChange={(next) => onChange(next)}
        onExpand={sheet.show}
      />
      {sheet.open && (
        <PartsEditorSheet
          ref={sheet.ref}
          label={parameterLabel(parameter)}
          value={openedRows(field, effectiveValue) as Part[]}
          expressionEditor={makeExpressionEditor(availableVariables)}
          expressionIndices={exprIndices}
          onSave={(newParts, savedIndices) => {
            onChange(newParts)
            onExpressionFieldsChange(withPartsExprIndices(paramName, expressionFields, savedIndices))
          }}
          onClose={sheet.hide}
        />
      )}
    </>
  )
}

/** Cipher Suites field + bespoke TLS cipher picker sheet. The value is an ordered list of OpenSSL cipher
 *  names (unset = the default list, [] = none); the draft TLS version range filters the picker, which opens
 *  a not-set field in its default state (every suite of the range, the gray default) and keeps it not set. */
export function CipherSuitesInput({
  parameter,
  effectiveValue,
  onChange,
  allValues,
  allParameters,
  sheet,
  field,
}: Readonly<{
  parameter: Parameter
  effectiveValue: unknown
  onChange: (value: unknown) => void
  allValues?: Record<string, unknown>
  allParameters?: Parameter[]
  sheet: SheetOpener
  field: BlockFieldState
}>) {
  const list = field.isSet && Array.isArray(effectiveValue) ? (effectiveValue as string[]) : undefined
  const range = resolveTlsRange(allValues, allParameters)
  const save = (next: string[] | undefined) => {
    // The picker's default state saves undefined: a not-set field stays not set (FIELD-2).
    if (!field.isSet && next === undefined) return
    onChange(next)
  }
  return (
    <>
      <BlockValueField
        {...fieldProps(parameter, field)}
        type="array"
        value={effectiveValue}
        hasEditor
        // A list field's line always parses to a list.
        onChange={(next) => onChange((next as unknown[]).map(itemAsText))}
        onExpand={sheet.show}
      />
      {sheet.open && (
        <CipherPickerSheet
          ref={sheet.ref}
          label={parameterLabel(parameter)}
          value={list}
          minVersion={range.min}
          maxVersion={range.max}
          onSave={save}
          onClose={sheet.hide}
        />
      )}
    </>
  )
}

/** String field: the one value field, with the names it suggests, and the "Edit value" sheet behind its expand. */
export function StringInput({
  parameter,
  effectiveValue,
  onChange,
  availableVariables,
  templateFields,
  onTemplateFieldsChange,
  sheet: rowSheet,
  field,
  runPausedHere = false,
  ...scriptEditor
}: Readonly<
  {
    parameter: Parameter
    effectiveValue: unknown
    onChange: (value: unknown) => void
    availableVariables: AvailableVariable[]
    templateFields: string[]
    onTemplateFieldsChange: (fields: string[]) => void
    /** The owning row's Edit value sheet state; without it the input keeps its own. */
    sheet?: SheetOpener
    field?: BlockFieldState
  } & ScriptEditorProps
>) {
  const inheritedFrozen = use(SheetFrozenContext)
  const ownSheet = useSheetOpener()
  const sheet = rowSheet ?? ownSheet
  const state = field ?? standaloneField(effectiveValue, onChange)
  const suggestions = useFieldSuggestions(parameter.fieldSuggest)
  const isTemplate = templateFields.includes(parameter.name)
  // The sheet enters a script mode on the format alone, so the script props follow the same gate.
  const lockedFormat =
    parameter.allowedFormats?.length === 1 ? parameter.allowedFormats[0] : undefined
  const scriptBody = lockedFormat !== undefined && SCRIPT_FORMATS.has(lockedFormat)
  // PYRUN-21, SQL-13: the read-only freeze leaves alone the open script editor of the
  // block a debug run is paused at, and the one whose own run is in flight, so Stop works.
  const liveWhileFrozen = scriptBody && (runPausedHere || scriptEditor.runBusy === true)

  return (
    <>
      <BlockValueField
        {...fieldProps(parameter, state)}
        type="string"
        value={effectiveValue}
        hasEditor
        placeholder={parameter.placeholder}
        suggestions={suggestions}
        showsEnd={parameter.fileReference !== undefined}
        onChange={(next) => onChange(next)}
        onExpand={sheet.show}
      />
      {sheet.open && (
        <SheetFrozenContext value={liveWhileFrozen ? false : inheritedFrozen}>
          <ValueEditorSheet
            ref={sheet.ref}
            label={parameterLabel(parameter)}
            name={parameter.name}
            type="string"
            value={safeStringify(editorValue(state, effectiveValue, ''))}
            isTemplate={isTemplate}
            // SQL-10: a SQL body takes Template kind even on a row that takes no expression.
            allowTemplate={!parameter.noExpression || lockedFormat === 'sql'}
            allowedFormats={parameter.allowedFormats as TextFormat[]}
            availableVariables={availableVariables}
            {...(scriptBody ? scriptEditor : NO_SCRIPT_EDITOR)}
            onSave={(newValue, newIsTemplate) => {
              onChange(newValue)
              const updatedFields = newIsTemplate
                ? [...templateFields, parameter.name]
                : templateFields.filter((n) => n !== parameter.name)
              onTemplateFieldsChange(updatedFields)
            }}
            onClose={sheet.hide}
          />
        </SheetFrozenContext>
      )}
    </>
  )
}
