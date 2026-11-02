/**
 * WindowValueField - the variable window's value: one same-height field per type, kind and state (VMGR-110, VMGR-111, VMGR-113).
 *
 * REQ-3.1.3.6: Return values from plugins
 * REQ-3.1.3.5: Secret variable masking in logs
 * REQ-3.1.3.13: Computed variables with expressions and runtime evaluation
 * REQ-3.1.3.14: Exact numeric precision for integer and float variables
 * REQ-3.1.3.15: Template variables
 * REQ-3.1.3.19: Declared element types for array and map values
 * REQ-3.1.3.24: Set to null by hand
 * REQ-3.5.5.1: Data table support
 */

import {
  use,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { Clock, Lock, Maximize2, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { useSheetOpener } from '@/components/shared/draggable-sheet'
import { SheetFrozenContext } from '@/components/shared/sheet-layer'
import {
  describedByOf,
  FieldErrorContext,
  FieldNoteContext,
} from '@/components/shared/fields/field-error-context'
import { typedListItem, type ListItemType } from '@/components/shared/variable-bodies/array-edit-body'
import { NullButton, NullText } from '@/components/shared/variable-bodies/body-parts'
import { ScalarEditBody, type NumberBoxEvents } from '@/components/shared/variable-bodies/scalar-edit-body'
import { MaskedSecretControl } from '@/components/shared/variable-bodies/value-field'
import { CanvasReadOnlyProvider } from '@/features/workbench/common/canvas/read-only-context'
import {
  ExpressionField,
  type AvailableVariable,
} from '@/features/workbench/common/element-config/expressions/expression-field'
import { EnumInput } from '@/features/workbench/common/element-config/parameters/parameter-value-inputs'
import {
  comboboxBoxProps,
  matchingItems,
  SuggestionPopover,
  type SuggestionList,
} from '@/features/workbench/common/element-config/shared/variable-combobox-base'
import { describeJsonError } from '@/lib/codemirror/json-data-editor'
import { pythonLiteral } from '@/lib/python-literal-text'
import { isSealedMapCredential, isStoredSecretValue } from '@/lib/secret-envelope'
import { cn, safeStringify } from '@/lib/utils'
import { getDefaultValueForType } from '@/lib/variable-defaults'
import {
  EMPTY_STRING_LOOK_CLASS,
  EMPTY_STRING_TEXT,
  getValueColorClass,
  HELD_DEFAULT_LOOK_CLASS,
  isNullValue,
  NULL_LOOK_CLASS,
  NULL_TEXT,
  sameStoredValue,
  valueToText,
} from '@/lib/variable-format'
import { numberProblemMessage, numberValueProblem, type NumberType } from '@/lib/number-rule'
import { tableDictToRowObjects, toStoredTable } from '@/lib/variable-table-model'
import type { VariableType } from '@/lib/variable-types'
import {
  arrayErrorMessages,
  deriveTableSchema,
  formatValue,
  mapEntryErrorMessages,
  parseArrayCode,
  parseMapCode,
  parseTableCodeText,
  resolveArrayTypes,
  resolveMapTypes,
  scanDuplicateMapMemberKeys,
  serializeArrayForCode,
  serializeMapForCode,
  serializeTableForCode,
  tableErrorMessages,
  tableSchemaFromCode,
  validateTableCodeValue,
  type ElementTypes,
  type TableColumnSchema,
  type ValueType,
} from '@/lib/variable-validation'
import { ValueEditorSheet } from './value-editor-sheet'

/** Set to null: free, ticked (the value is null) or held off by a rule. */
export type WindowNullState = 'off' | 'ticked' | 'locked-off'
/** A secret value: none, masked (a stored secret, replaced but never shown) or write-only (cleared, typed afresh). */
export type WindowSecretState = 'none' | 'masked' | 'write-only'
export type WindowValueKind = 'literal' | 'expression' | 'template'

export interface WindowValueFieldProps {
  type: VariableType
  kind: WindowValueKind
  value: unknown
  /** Every edit, with the element types a list or map carries (none for a typed list). */
  onChange: (value: unknown, elementTypes?: ElementTypes) => void
  elementTypes?: ElementTypes
  nullState: WindowNullState
  secret: WindowSecretState
  /** A list whose items all take this type (an enum input's allowed values). */
  itemType?: ListItemType
  /** The variable name, for the expression box and the larger editor. */
  name: string
  availableVariables: AvailableVariable[]
  /** The value's problems in strip order after each edit, [] when valid or when a value arrives from outside. */
  onValidation: (messages: string[]) => void
  /** An emptied number box lost focus while Set to null is free. */
  onEmptyBlur?: () => void
  onExpressionBlur?: () => void
  /** The pencil of a masked secret: the host confirms, then clears the value. */
  onEditSecret?: () => void
  /** 'unset': emptied text or number means no value (a Required input's Default view). */
  blank?: 'refuse' | 'unset'
  /** The id of the text or number box, for the caption label that names and focuses it. */
  id?: string
  /** The caption the host shows, naming the enum select, the masked control and the held null field. */
  label?: string
  /** The caption's id, naming the true / false group. */
  labeledBy?: string
  /** Set to null is held on by a rule (a secret input's default): the null field is read-only and says why. */
  nullReason?: string
  /** An enum input's allowed values: the value is a select of them. */
  enumValues?: readonly unknown[]
  /** Outlines the enum select in red with this message under it. */
  enumError?: string
  /** Which field of the window this is; sets its test ids and its input's form name. */
  field?: 'value' | 'allowed-values'
  /** Shown, never changed: a read-only definition's Initial value. */
  readOnly?: boolean
  /** The id of the message under a text field that says why its text is refused. */
  errorId?: string
}

const FIELD_IDS = {
  value: { field: 'window-value-field', openEditor: 'open-value-editor-button', inputName: 'variable-value' },
  'allowed-values': {
    field: 'allowed-values-field',
    openEditor: 'open-allowed-values-editor-button',
    inputName: 'allowed-values',
  },
} as const

const TEXT_FIELD_TYPES: ReadonlySet<VariableType> = new Set<VariableType>(['string', 'array', 'map', 'table'])
const NUMBER_TOKENS: ReadonlySet<ValueType> = new Set<ValueType>(['integer', 'float'])

const BOX_CLASS = 'flex h-9 w-full min-w-0 items-center rounded-md border border-input bg-background px-3 text-sm'
const TEXT_INPUT_CLASS = cn(
  BOX_CLASS,
  'truncate py-1.5 font-mono shadow-sm transition-colors',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring read-only:cursor-default',
)
const LINE_BREAK_MARK = '…'
// The expression box is one 36px field here (VMGR-110): 6px padding around a 22px line inside its 1px border.
const SOURCE_BOX_CLASS = 'w-full min-w-0 [&_.cm-content]:!py-1.5 [&_.cm-scroller]:!leading-[22px]'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


/** A list, map or table written out as one line of JSON, exact digits kept (REQ-3.1.3.14). */
function lineText(
  type: VariableType,
  value: unknown,
  elementTypes: ElementTypes | undefined,
  itemType: ListItemType | undefined,
): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (type === 'table') return serializeTableForCode(value, deriveTableSchema(value), 'line')
  if (type === 'array' && Array.isArray(value)) {
    const types = itemType === undefined ? resolveArrayTypes(value, elementTypes) : value.map(() => itemType)
    return serializeArrayForCode(value, types, 'line')
  }
  if (type === 'map' && isPlainObject(value)) {
    return serializeMapForCode(value, resolveMapTypes(value, elementTypes), undefined, 'line')
  }
  return JSON.stringify(value)
}

interface ParsedText {
  /** Absent while the text cannot become a value of the type. */
  next?: { value: unknown; elementTypes?: ElementTypes }
  problems: string[]
}

function parseListText(text: string, itemType: ListItemType | undefined): ParsedText {
  const { items, types } = parseArrayCode(text)
  if (itemType === undefined) {
    return { next: { value: items, elementTypes: types }, problems: arrayErrorMessages(items, types) }
  }
  // A number written into a typed list reads as its item type; the list stores no element types and its host checks it.
  const value = items.map((item, index) =>
    NUMBER_TOKENS.has(types[index]) ? typedListItem(item as string, itemType) : item,
  )
  return { next: { value }, problems: [] }
}

function parseMapText(text: string): ParsedText {
  const { value, types } = parseMapCode(text)
  const duplicates = scanDuplicateMapMemberKeys(text).map((key) => `Duplicate key "${key}"`)
  const entries = mapEntryErrorMessages(
    Object.entries(value).map(([key, entry]) => ({
      key,
      value: formatValue(entry),
      // A null value fits any element type (REQ-3.1.3.19).
      type: isNullValue(entry) ? 'string' : types[key],
    })),
  )
  return { next: { value, elementTypes: types }, problems: [...duplicates, ...entries] }
}

// Text that adds or drops a column is refused (VMGR-71); a table with no columns takes them from the typed rows.
function parseTableText(text: string, columns: TableColumnSchema[]): ParsedText {
  const rows = parseTableCodeText(text)
  const schema = columns.length > 0 ? columns : tableSchemaFromCode(text)
  const problems = tableErrorMessages(validateTableCodeValue(rows, schema))
  return problems.length > 0 ? { problems } : { next: { value: toStoredTable(rows, schema) }, problems }
}

function parseLineText(
  type: VariableType,
  text: string,
  columns: TableColumnSchema[],
  itemType: ListItemType | undefined,
  blank: 'refuse' | 'unset',
): ParsedText {
  if (blank === 'unset' && text.trim() === '') return { next: { value: '' }, problems: [] }
  try {
    if (type === 'array') return parseListText(text, itemType)
    if (type === 'map') return parseMapText(text)
    return parseTableText(text, columns)
  } catch (error) {
    return { problems: [describeJsonError(text, error)] }
  }
}

/** The problems of a stored value, as the window shows them the moment it opens (FIELD-12). */
function storedProblems(
  type: VariableType,
  value: unknown,
  elementTypes: ElementTypes | undefined,
  itemType: ListItemType | undefined,
): string[] {
  if (value === undefined || value === null || value === '') return []
  if (type === 'array' && Array.isArray(value)) {
    return arrayErrorMessages(value, itemType === undefined ? resolveArrayTypes(value, elementTypes) : value.map(() => itemType))
  }
  if (type === 'map' && isPlainObject(value)) {
    const types = resolveMapTypes(value, elementTypes)
    return mapEntryErrorMessages(
      Object.entries(value).map(([key, entry]) => ({
        key,
        value: formatValue(entry),
        type: isNullValue(entry) ? 'string' : types[key],
      })),
    )
  }
  if (type === 'table') return tableErrorMessages(validateTableCodeValue(tableDictToRowObjects(value), deriveTableSchema(value)))
  if (NUMBER_TOKENS.has(type as ValueType)) {
    const problem = numberValueProblem(value, type as NumberType)
    if (problem === null) return []
    return [problem === 'type' ? `Enter a valid ${type} value` : numberProblemMessage(problem, type as NumberType)]
  }
  return []
}

/** The value as the field last saw it: a change from outside writes the text out again. */
interface Snapshot {
  type: VariableType
  value: unknown
  elementTypes: ElementTypes | undefined
  itemType: ListItemType | undefined
  /** Counts the values that came from outside. */
  epoch: number
  text: string
  /** The columns of the table the field received; typed rows may not change them. */
  columns: TableColumnSchema[]
}

function snapshotOf(
  type: VariableType,
  value: unknown,
  elementTypes: ElementTypes | undefined,
  itemType: ListItemType | undefined,
  epoch: number,
): Snapshot {
  return {
    type,
    value,
    elementTypes,
    itemType,
    epoch,
    text: lineText(type, value, elementTypes, itemType),
    columns: type === 'table' ? deriveTableSchema(value) : [],
  }
}

/** Wraps an expand control so an editor that opens from it, such as a popover, anchors there. */
type ExpandTrigger = (expand: ReactElement) => ReactElement

const AS_IS: ExpandTrigger = (expand) => expand

interface ExpandControlProps {
  onClick: () => void
  testId: string
  trigger?: ExpandTrigger
  /** The field's visible label: a Block window holds one expand per row, so each names its field. */
  label?: string
  /** Drawn off while the value is null, so the field keeps its width. */
  disabled?: boolean
}

function expandName(label: string | undefined): string {
  return label === undefined ? 'Open editor' : `Open editor for ${label}`
}

function OpenEditorButton({ onClick, testId, trigger = AS_IS, label, disabled = false }: Readonly<ExpandControlProps>) {
  return (
    <ConditionalTooltip content="Open editor">
      {trigger(
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="!h-8 !w-8 shrink-0"
          aria-label={expandName(label)}
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </Button>,
      )}
    </ConditionalTooltip>
  )
}

// One grayed null field; a held one is a read-only field that says why below it.
function NullValueField({
  id,
  name,
  label,
  reason,
}: Readonly<{ id?: string; name: string; label?: string; reason?: string }>) {
  if (reason === undefined) {
    return (
      <div data-testid="create-null-field" className={BOX_CLASS}>
        <NullText />
      </div>
    )
  }
  return (
    <ConditionalTooltip content={reason} disabled wide side="bottom">
      <input
        type="text"
        readOnly
        id={id}
        name={name}
        data-testid="create-null-field"
        aria-label={label}
        aria-disabled="true"
        autoComplete="off"
        translate="no"
        value={NULL_TEXT}
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          BOX_CLASS,
          NULL_LOOK_CLASS,
          'cursor-not-allowed caret-transparent opacity-50 selection:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
        )}
      />
    </ConditionalTooltip>
  )
}

interface EnumFieldProps {
  id?: string
  type: VariableType
  value: unknown
  enumValues: readonly unknown[]
  name: string
  label?: string
  error?: string
  readOnly: boolean
  onPick: (value: unknown) => void
}

/** A value as its one-line field shows it: text as it is, a number in plain digits; nothing else reads as text. */
function fieldText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? valueToText(value) : ''
}

// The plain enum select every plugin row uses; its pick reads back as the input type (REQ-3.1.2.11).
function EnumValueField({
  id,
  type,
  value,
  enumValues,
  name,
  label,
  error,
  readOnly,
  onPick,
}: Readonly<EnumFieldProps>) {
  const errorId = useId()
  return (
    <div className="w-full min-w-0 space-y-1.5">
      <FieldErrorContext value={error === undefined ? undefined : errorId}>
        <div data-testid="enum-value-select">
          <EnumInput
            id={id}
            parameter={{ name, label, type, required: true, enumValues: enumValues.map(valueToText) }}
            effectiveValue={value}
            onChange={(picked) => onPick(typedListItem(String(picked), type as ListItemType))}
            showRequiredError={error !== undefined}
            lockedDisplayText={readOnly ? fieldText(value) : undefined}
            valueClassName={cn('font-mono', getValueColorClass(type))}
          />
        </div>
      </FieldErrorContext>
      {error !== undefined && (
        <p id={errorId} className="text-xs text-destructive" role="alert" data-testid="create-enum-default-error">
          {error}
        </p>
      )}
    </div>
  )
}

type Face = 'null' | 'masked' | 'source' | 'enum' | 'number' | 'text'

// The expression box reads the canvas read-only flag; a read-only value sets it for its own box only.
function SourceField({ readOnly, children }: Readonly<{ readOnly: boolean; children: ReactNode }>) {
  return readOnly ? <CanvasReadOnlyProvider value>{children}</CanvasReadOnlyProvider> : children
}

function faceOf(
  props: Pick<WindowValueFieldProps, 'type' | 'kind' | 'nullState' | 'secret' | 'enumValues'>,
): Face {
  if (props.nullState === 'ticked') return 'null'
  if (props.secret === 'masked') return 'masked'
  if (props.kind !== 'literal') return 'source'
  if (props.enumValues !== undefined) return 'enum'
  return TEXT_FIELD_TYPES.has(props.type) ? 'text' : 'number'
}

interface LineInputProps {
  id?: string
  name: string
  type: VariableType
  text: string
  readOnly: boolean
  errorId?: string
  onText: (text: string) => void
}

// A text with line breaks shows its first line cut with "…", read-only: line breaks are edited in the larger editor.
function LineInput({ id, name, type, text, readOnly, errorId, onText }: Readonly<LineInputProps>) {
  const lineBreak = text.includes('\n')
  return (
    <input
      type="text"
      id={id}
      name={name}
      aria-invalid={errorId === undefined ? undefined : true}
      aria-describedby={errorId}
      autoComplete="off"
      spellCheck={false}
      translate="no"
      readOnly={readOnly || lineBreak}
      title={lineBreak ? text : undefined}
      value={lineBreak ? `${text.split('\n')[0]}${LINE_BREAK_MARK}` : text}
      onChange={(event) => onText(event.target.value)}
      className={cn(TEXT_INPUT_CLASS, getValueColorClass(type))}
    />
  )
}

export function WindowValueField({
  type,
  kind,
  value,
  onChange,
  elementTypes,
  nullState,
  secret,
  itemType,
  name,
  availableVariables,
  onValidation,
  onEmptyBlur,
  onExpressionBlur,
  onEditSecret,
  blank = 'refuse',
  id,
  label,
  labeledBy,
  nullReason,
  enumValues,
  enumError,
  field = 'value',
  readOnly = false,
  errorId,
}: Readonly<WindowValueFieldProps>) {
  const fieldIds = FIELD_IDS[field]
  const opener = useSheetOpener()
  const [snapshot, setSnapshot] = useState(() => snapshotOf(type, value, elementTypes, itemType, 0))
  const fromOutside =
    snapshot.type !== type ||
    snapshot.itemType !== itemType ||
    !sameStoredValue(snapshot.value, value) ||
    !sameStoredValue(snapshot.elementTypes, elementTypes)
  if (fromOutside) setSnapshot(snapshotOf(type, value, elementTypes, itemType, snapshot.epoch + 1))

  // A value from outside replaces whatever the field was refusing.
  const clearProblems = useEffectEvent(() => onValidation([]))
  useEffect(() => {
    if (snapshot.epoch > 0) clearProblems()
  }, [snapshot.epoch])

  // A stored value is checked as the window opens (FIELD-12).
  const reportStoredProblems = useEffectEvent(() => {
    if (kind !== 'literal' || secret !== 'none' || nullState === 'ticked' || enumValues !== undefined) return
    const problems = storedProblems(type, value, elementTypes, itemType)
    if (problems.length > 0) onValidation(problems)
  })
  useEffect(() => {
    reportStoredProblems()
  }, [])

  // An edit made here: the value it sends back is not a change from outside.
  const emit = (next: unknown, nextTypes?: ElementTypes, text = snapshot.text) => {
    setSnapshot((current) => ({ ...current, value: next, elementTypes: nextTypes, text }))
    onChange(next, nextTypes)
  }
  const emitValid = (next: unknown) => {
    emit(next)
    onValidation([])
  }
  const typeLineText = (text: string) => {
    const parsed = parseLineText(type, text, snapshot.columns, itemType, blank)
    if (parsed.next === undefined) setSnapshot((current) => ({ ...current, text }))
    else emit(parsed.next.value, parsed.next.elementTypes, text)
    onValidation(parsed.problems)
  }

  const face = faceOf({ type, kind, nullState, secret, enumValues })
  return (
    <div data-testid={fieldIds.field} className="flex w-full min-w-0 items-center gap-2">
      {face === 'null' && (
        <>
          <NullValueField id={id} name={fieldIds.inputName} label={label} reason={nullReason} />
          {!readOnly && TEXT_FIELD_TYPES.has(type) && (
            <OpenEditorButton onClick={opener.show} testId={fieldIds.openEditor} disabled />
          )}
        </>
      )}
      {face === 'masked' && (
        <MaskedSecretControl fieldName={label} onClick={onEditSecret} disabled={readOnly} className="!h-9" />
      )}
      {face === 'source' && (
        <SourceField readOnly={readOnly}>
          <div className={SOURCE_BOX_CLASS}>
            <ExpressionField
              name={name}
              value={fieldText(value)}
              onChange={emitValid}
              onBlur={kind === 'expression' ? onExpressionBlur : undefined}
              availableVariables={availableVariables}
              template={kind === 'template'}
            />
          </div>
        </SourceField>
      )}
      {face === 'enum' && enumValues !== undefined && (
        <EnumValueField
          id={id}
          type={type}
          value={value}
          enumValues={enumValues}
          name={name}
          label={label}
          error={enumError}
          readOnly={readOnly}
          onPick={emitValid}
        />
      )}
      {face === 'number' && (
        <div className="w-full min-w-0">
          <ScalarEditBody
            key={snapshot.epoch}
            id={id}
            name={fieldIds.inputName}
            labeledBy={labeledBy}
            value={value ?? ''}
            type={type}
            size="field"
            blank={blank}
            readOnly={readOnly}
            onChange={(next) => emit(next)}
            onValidChange={(valid) => onValidation(valid ? [] : [`Enter a valid ${type} value`])}
            onEmptyBlur={nullState === 'off' ? onEmptyBlur : undefined}
          />
        </div>
      )}
      {face === 'text' && (
        <>
          <LineInput
            id={id}
            name={fieldIds.inputName}
            type={type}
            text={type === 'string' ? fieldText(value) : snapshot.text}
            readOnly={readOnly}
            errorId={errorId}
            onText={type === 'string' ? emitValid : typeLineText}
          />
          {!readOnly && <OpenEditorButton onClick={opener.show} testId={fieldIds.openEditor} />}
        </>
      )}
      {opener.open && (
        <ValueEditorSheet
          ref={opener.ref}
          label={label ?? name}
          name={name}
          type={type}
          value={value ?? getDefaultValueForType(type)}
          isTemplate={false}
          allowTemplate={false}
          elementTypes={elementTypes}
          itemType={itemType}
          availableVariables={availableVariables}
          onSave={(next, _isTemplate, _exprKeys, nextTypes) => onChange(next, nextTypes)}
          onClose={opener.hide}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The one value field of a Block row (FIELD-1 .. FIELD-6, REQ-3.1.1.5)
// ---------------------------------------------------------------------------

export type BlockFieldMode = 'literal' | 'expression'
export type BlockFieldIcon = 'clock' | 'lock'

export interface BlockValueFieldProps {
  value: unknown
  type: VariableType
  /** False while the field holds nothing: a default shows gray, or null on a field that takes one. */
  isSet: boolean
  defaultValue?: unknown
  mode: BlockFieldMode
  /** The field takes a whole null: the null button shows while it has no default. */
  nullable: boolean
  /** The field has a full editor, opened by the expand button. */
  hasEditor: boolean
  /** The name stem of the field's test ids (`param-expand-<testId>`, ...). */
  testId: string
  /** The visible label: names the text box and the null button. */
  label?: string
  onChange: (value: unknown, elementTypes?: ElementTypes) => void
  /** Back to not set: the default shows again. */
  onUnset: () => void
  onNull: () => void
  /** The host opens the field's editor; in {x} mode the field opens the expression editor itself. */
  onExpand: () => void
  /** The entries held as {x}: a list item's index or a map key. */
  expressionEntries?: readonly string[]
  elementTypes?: ElementTypes
  leftIcon?: BlockFieldIcon
  /** The left icon's hint, which also names it (a credential's protection). */
  leftIconLabel?: string
  readOnly?: boolean
  /** The hint an empty box shows (a Port box's port, an example Index pattern); never over `null` or `<empty string>`. */
  placeholder?: string
  /** Names the text box offers in a list under it; a pick is the user's value. */
  suggestions?: SuggestionList
  availableVariables?: AvailableVariable[]
  /** The pencil of a masked secret: the host confirms, then clears the value. */
  onEditSecret?: () => void
  /** A stored secret shown in the clear while secret unmasking is on; it is replaced through the editor. */
  revealedText?: string
  /** Status icons the host draws inside the field (advisories, a credential's state). */
  adornment?: ReactNode
  /** The problems of a list, map or table line that does not read as one yet, [] once it does. */
  onValidation?: (messages: string[]) => void
  /** Literal mode: wraps the expand so the editor it opens can anchor there (the time picker). */
  renderExpandTrigger?: ExpandTrigger
  /** A path: while the box has no focus a long value shows its end, the file name (TDATA-8). */
  showsEnd?: boolean
}

const DEFAULT_KEY_HINT = 'Not set, so the default is used. Type to use your own value.'
const ENTRIES_KEY_HINT = 'Has {{ }} entries. Open the editor to change it.'
const RESET_LABEL = 'Reset to default'
const EXPRESSION_ENTRY_CLASS = 'text-cyan-400'
const NO_ENTRIES: readonly string[] = []
const NO_AVAILABLE: AvailableVariable[] = []
const BLOCK_NUMBER_TYPES: ReadonlySet<VariableType> = new Set<VariableType>(['integer', 'float'])
const BLOCK_CONTROL_CLASS =
  'h-full w-full min-w-0 truncate bg-transparent px-3 py-1.5 font-mono text-sm outline-none read-only:cursor-default placeholder:italic placeholder:text-[color:var(--color-text-muted)]'
// The number body keeps its own exact-digit rules; inside the group it draws no box of its own.
const BLOCK_NUMBER_SLOT_CLASS =
  'flex-1 [&>div]:w-full [&_input]:h-full [&_input]:border-0 [&_input]:bg-transparent [&_input]:shadow-none [&_input]:focus-visible:ring-0'
const BLOCK_GROUP_CLASS =
  'bg-background has-[input:focus-visible]:ring-1 has-[input:focus-visible]:ring-ring has-[input[aria-invalid=true]]:border-destructive'
const OVERLAY_CLASS = 'pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center overflow-hidden px-3 font-mono text-sm'
// A status mark drawn at the field's right end (a credential advisory) keeps the text clear of it.
const MARK_CLEARANCE_CLASS = 'pr-8'

type BlockFace = 'source' | 'masked' | 'line' | 'number' | 'text'

interface LineSegment {
  /** Where the segment starts in the line; keys it. */
  at: number
  text: string
  expression: boolean
}

type LinePart = Omit<LineSegment, 'at'>

/** The parts of several entries, comma-separated. */
function joinedParts(entries: LinePart[][]): LinePart[] {
  return entries.flatMap((entry, index) => (index > 0 ? [{ text: ', ', expression: false }, ...entry] : entry))
}

/** The {x} keys of one list item's own map, from entries such as `0.value` (a Parts row). */
function itemEntries(entries: ReadonlySet<string>, index: number): Set<string> {
  const prefix = `${index}.`
  return new Set([...entries].filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length)))
}

/** One list item: `{{ expr }}` when it is {x}, a map with its own {x} keys drawn bare, else its literal JSON. */
function itemParts(item: unknown, index: number, type: ValueType, entries: ReadonlySet<string>): LinePart[] {
  if (entries.has(String(index))) return [{ text: `{{ ${String(item)} }}`, expression: true }]
  const own = isPlainObject(item) ? itemEntries(entries, index) : null
  if (own !== null && own.size > 0) {
    return [
      { text: '{', expression: false },
      ...joinedParts(entryParts(item as Record<string, unknown>, undefined, own)),
      { text: '}', expression: false },
    ]
  }
  return [{ text: serializeArrayForCode([item], [type], 'line').slice(1, -1), expression: false }]
}

/** One entry of a list or map line: its literal JSON, or `{{ expr }}` for an {x} entry. */
function entryParts(
  value: unknown[] | Record<string, unknown>,
  elementTypes: ElementTypes | undefined,
  entries: ReadonlySet<string>,
): LinePart[][] {
  if (Array.isArray(value)) {
    const types = resolveArrayTypes(value, elementTypes)
    return value.map((item, index) => itemParts(item, index, types[index], entries))
  }
  const types = resolveMapTypes(value, elementTypes)
  return Object.keys(value).map((key) =>
    entries.has(key)
      ? [
          { text: `${JSON.stringify(key)}: `, expression: false },
          { text: `{{ ${String(value[key])} }}`, expression: true },
        ]
      : [
          {
            text: serializeMapForCode({ [key]: value[key] }, { [key]: types[key] }, undefined, 'line').slice(1, -1),
            expression: false,
          },
        ],
  )
}

/** One-line JSON of a list or map whose {x} entries draw as `{{ expr }}`, split into colored parts (FIELD-6). */
function entrySegments(
  type: VariableType,
  value: unknown,
  elementTypes: ElementTypes | undefined,
  entries: ReadonlySet<string>,
): LineSegment[] | null {
  const list = type === 'array' && Array.isArray(value)
  if (!list && !(type === 'map' && isPlainObject(value))) return null
  const parts: LinePart[] = [
    { text: list ? '[' : '{', expression: false },
    ...joinedParts(entryParts(value as unknown[] | Record<string, unknown>, elementTypes, entries)),
    { text: list ? ']' : '}', expression: false },
  ]
  const segments: LineSegment[] = []
  let at = 0
  for (const part of parts) {
    const last = segments.at(-1)
    if (last && !last.expression && !part.expression) last.text += part.text
    else segments.push({ at, ...part })
    at += part.text.length
  }
  return segments
}

function isDeleteKey(key: string): boolean {
  return key === 'Delete' || key === 'Backspace'
}

// Windows AltGr arrives as Ctrl+Alt and Mac Option as Alt, both writing the key's character.
function isTypingKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.metaKey && (!event.ctrlKey || event.altKey)
}

function isSelectAllKey(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a'
}

function selectsAll(input: HTMLInputElement): boolean {
  return input.value !== '' && input.selectionStart === 0 && input.selectionEnd === input.value.length
}

function blockFaceOf(
  mode: BlockFieldMode,
  type: VariableType,
  masked: boolean,
  drawnLine: boolean,
): BlockFace {
  if (mode === 'expression') return 'source'
  if (masked) return 'masked'
  if (drawnLine) return 'line'
  return BLOCK_NUMBER_TYPES.has(type) ? 'number' : 'text'
}

/** The left icon inside the field: a clock (time) or a lock (secret), with its own hint when given. */
// The clock and the lock share the left slot (FIELD-1): one size and one gray, whether or not a hint wraps the glyph.
const FIELD_ICON_CLASS = 'size-4 shrink-0 text-[color:var(--color-text-muted)]'

function FieldIcon({ icon, label }: Readonly<{ icon: BlockFieldIcon; label?: string }>) {
  const glyph =
    icon === 'clock' ? (
      <Clock className={FIELD_ICON_CLASS} aria-hidden="true" />
    ) : (
      <Lock className={FIELD_ICON_CLASS} aria-hidden="true" />
    )
  return (
    <InputGroupAddon align="inline-start">
      {label === undefined ? (
        glyph
      ) : (
        <ConditionalTooltip content={label} side="bottom" align="start" wide>
          <span aria-label={label} className="inline-flex items-center">
            {glyph}
          </span>
        </ConditionalTooltip>
      )}
    </InputGroupAddon>
  )
}

const EXPAND_LOOK_CLASS =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

/** Expand in a frozen window: a frozen fieldset disables every button, so a link to the field opens its editor read-only (FIELD-1). */
function FrozenExpandLink({
  onClick,
  testId,
  target,
  trigger = AS_IS,
  label,
}: Readonly<ExpandControlProps & { target: string }>) {
  return (
    <ConditionalTooltip content="Open editor">
      {trigger(
        <a
          href={`#${target}`}
          aria-label={expandName(label)}
          data-testid={testId}
          className={EXPAND_LOOK_CLASS}
          onClick={(event) => {
            event.preventDefault()
            onClick()
          }}
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </a>,
      )}
    </ConditionalTooltip>
  )
}

const RESET_BUTTON_CLASS = cn(
  'inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 transition-colors',
  'text-[color:var(--color-text-muted)] hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500',
)

/** The reset icon inside the field (FIELD-3): small and Text Muted, like the null button's glyph. */
function ResetButton({ testId, onClick }: Readonly<{ testId: string; onClick: () => void }>) {
  return (
    <ConditionalTooltip content={RESET_LABEL}>
      <button
        type="button"
        aria-label={RESET_LABEL}
        data-testid={`param-reset-${testId}`}
        onClick={onClick}
        className={RESET_BUTTON_CLASS}
      >
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </ConditionalTooltip>
  )
}

/** The {x} hint of a default: its Python literal, a table as its rows like the literal line (REQ-3.5.5.1). */
function defaultHint(defaultValue: unknown, type: VariableType): string {
  return pythonLiteral(type === 'table' ? tableDictToRowObjects(defaultValue) : defaultValue, type)
}

/** What a screen reader hears beside the box for a state drawn over it or in gray (FIELD-2, FIELD-4, FIELD-5). */
function stateTextOf(showsNull: boolean, emptyText: boolean, showsDefault: boolean): string | null {
  if (showsNull) return NULL_TEXT
  if (emptyText) return 'empty string'
  return showsDefault ? 'not set, the default is used' : null
}

/** The text drawn over a control: a marker such as `null`, or a line in its colors. */
function Overlay({
  children,
  className,
  clearOfMark,
}: Readonly<{ children: ReactNode; className: string; clearOfMark: boolean }>) {
  // One inline run inside the flex box: a flex item would trim the space beside a segment and cut with no "…".
  return (
    <span translate="no" className={cn(OVERLAY_CLASS, clearOfMark && MARK_CLEARANCE_CLASS)}>
      <span className={cn('min-w-0 truncate', className)}>{children}</span>
    </span>
  )
}

/** Which face the field draws: {x}, a masked stored secret, a drawn line, a number box or a text box. */
function blockFaceState(field: {
  mode: BlockFieldMode
  type: VariableType
  value: unknown
  leftIcon: BlockFieldIcon | undefined
  revealedText: string | undefined
  expressionEntries: readonly string[]
  elementTypes: ElementTypes | undefined
}) {
  const literal = field.mode === 'literal'
  const storedSecret =
    literal && field.leftIcon === 'lock' && (isStoredSecretValue(field.value) || isSealedMapCredential(field.value))
  const masked = storedSecret && field.revealedText === undefined
  const segments =
    literal && !storedSecret && field.expressionEntries.length > 0
      ? entrySegments(field.type, field.value, field.elementTypes, new Set(field.expressionEntries))
      : null
  return { literal, masked, segments, face: blockFaceOf(field.mode, field.type, masked, storedSecret || segments !== null) }
}

/** What the field shows while it holds nothing of the user's: the gray default (FIELD-2), null (FIELD-5) or empty text (FIELD-4). */
function blockShowState(field: {
  literal: boolean
  isSet: boolean
  hasDefault: boolean
  typedText: string | null
  value: unknown
  nullable: boolean
  type: VariableType
  defaultValue: unknown
  placeholder: string | undefined
}) {
  const notSetDefault = field.literal && !field.isSet && field.hasDefault
  const showsDefault = notSetDefault && field.typedText === null
  const showsNull = field.literal && !notSetDefault && (field.value === null || (!field.isSet && field.nullable))
  const emptyText = field.literal && field.isSet && field.type === 'string' && field.value === ''
  // A gray default of empty text draws as held empty text does (FIELD-4); a declared hint wins (SQL-8).
  const emptyDefault =
    showsDefault && field.type === 'string' && field.defaultValue === '' && field.placeholder === undefined
  return { notSetDefault, showsDefault, showsNull, emptyText, emptyDefault }
}

/** The reset icon shows on a user value that has a default; the null button where a whole null is allowed (FIELD-3, FIELD-5). */
function blockButtons(field: {
  readOnly: boolean
  masked: boolean
  hasDefault: boolean
  isSet: boolean
  literal: boolean
  nullable: boolean
}) {
  const editable = !field.readOnly && !field.masked
  return {
    showsReset: editable && field.hasDefault && field.isSet,
    showsNullButton: editable && field.literal && field.nullable && !field.hasDefault,
  }
}

/** The text the field works on: a string as is, a list, map or table line as typed so far. */
function blockText(type: VariableType, shownValue: unknown, draftText: string, face: BlockFace) {
  const text = type === 'string' ? fieldText(shownValue) : draftText
  return { text, lineBreak: face === 'text' && text.includes('\n') }
}

/** A list, map or table line keeps the text typed so far while it does not read as a value yet;
 *  a value or a new default from outside replaces it, and typed text over the default gives way. */
function useLineDraft(opts: {
  type: VariableType
  shownValue: unknown
  elementTypes: ElementTypes | undefined
  notSetDefault: boolean
  typedText: string | null
  setTypedText: (text: string | null) => void
  onValidation: ((messages: string[]) => void) | undefined
}) {
  const { type, shownValue, elementTypes, notSetDefault, typedText, setTypedText, onValidation } = opts
  const [draft, setDraft] = useState(() => snapshotOf(type, shownValue, elementTypes, undefined, 0))
  const fromOutside =
    draft.type !== type || !sameStoredValue(draft.value, shownValue) || !sameStoredValue(draft.elementTypes, elementTypes)
  if (fromOutside) setDraft(snapshotOf(type, shownValue, elementTypes, undefined, draft.epoch + 1))
  if (typedText !== null && (!notSetDefault || fromOutside)) setTypedText(null)
  const clearProblems = useEffectEvent(() => onValidation?.([]))
  useEffect(() => {
    if (draft.epoch > 0) clearProblems()
  }, [draft.epoch])
  return [draft, setDraft] as const
}

/** `null` or `<empty string>` over an empty box while it has no focus (FIELD-4, FIELD-5). */
function stateMarker(opts: {
  focused: boolean
  showsNull: boolean
  emptyText: boolean
  emptyDefault: boolean
  clearOfMark: boolean
}): ReactNode {
  if (opts.focused) return null
  if (opts.showsNull) {
    return (
      <Overlay className={NULL_LOOK_CLASS} clearOfMark={opts.clearOfMark}>
        {NULL_TEXT}
      </Overlay>
    )
  }
  if (!opts.emptyText && !opts.emptyDefault) return null
  return (
    <Overlay className={EMPTY_STRING_LOOK_CLASS} clearOfMark={opts.clearOfMark}>
      {EMPTY_STRING_TEXT}
    </Overlay>
  )
}

/** The reset icon and the null button inside the field at its right end. */
function FieldButtons({
  showsReset,
  showsNullButton,
  showsNull,
  name,
  testId,
  onUnset,
  onNull,
}: Readonly<{
  showsReset: boolean
  showsNullButton: boolean
  showsNull: boolean
  name: string
  testId: string
  onUnset: () => void
  onNull: () => void
}>) {
  if (!showsReset && !showsNullButton) return null
  return (
    <InputGroupAddon align="inline-end">
      {showsReset && <ResetButton testId={testId} onClick={onUnset} />}
      {showsNullButton && <NullButton label={name} pressed={showsNull} onClick={onNull} testId={`param-null-${testId}`} />}
    </InputGroupAddon>
  )
}

/** The {x} face: the expression box, the reset icon kept clear of its text. */
function SourceFace({
  testId,
  name,
  value,
  isSet,
  defaultValue,
  type,
  readOnly,
  showsReset,
  invalid,
  availableVariables,
  editorOpen,
  onEditorOpenChange,
  onChange,
  onUnset,
}: Readonly<{
  testId: string
  name: string
  value: unknown
  isSet: boolean
  defaultValue: unknown
  type: VariableType
  readOnly: boolean
  showsReset: boolean
  invalid: boolean
  availableVariables: AvailableVariable[]
  editorOpen: boolean
  onEditorOpenChange: (open: boolean) => void
  onChange: (value: unknown) => void
  onUnset: () => void
}>) {
  return (
    <>
      <SourceField readOnly={readOnly}>
        <div className={cn(SOURCE_BOX_CLASS, showsReset && '[&_.cm-content]:!pr-8')}>
          <ExpressionField
            name={testId}
            displayName={name}
            value={isSet ? safeStringify(value) : ''}
            onChange={(text) => onChange(text)}
            availableVariables={availableVariables}
            isInvalid={invalid}
            placeholder={!isSet && defaultValue !== undefined ? defaultHint(defaultValue, type) : undefined}
            editorOpen={editorOpen}
            onEditorOpenChange={onEditorOpenChange}
          />
        </div>
      </SourceField>
      {showsReset && (
        <span className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2">
          <ResetButton testId={testId} onClick={onUnset} />
        </span>
      )}
    </>
  )
}

/** A drawn line: each {x} entry in its own look (FIELD-6), or a revealed stored secret. */
function LineOverlay({
  segments,
  lineText,
  type,
  clearOfMark,
}: Readonly<{ segments: LineSegment[] | null; lineText: string; type: VariableType; clearOfMark: boolean }>) {
  return (
    <Overlay className={getValueColorClass(type)} clearOfMark={clearOfMark}>
      {segments === null
        ? lineText
        : segments.map((segment) => (
            <span key={segment.at} className={segment.expression ? EXPRESSION_ENTRY_CLASS : undefined}>
              {segment.text}
            </span>
          ))}
    </Overlay>
  )
}

/** The value field's own expand, or the read-only window's link to the editor, or the empty column. */
function ExpandColumn({
  shows,
  frozen,
  literal,
  testId,
  shellId,
  label,
  renderExpandTrigger,
  onExpand,
}: Readonly<{
  shows: boolean
  frozen: boolean | undefined
  literal: boolean
  testId: string
  shellId: string
  label: string | undefined
  renderExpandTrigger: ExpandTrigger | undefined
  onExpand: () => void
}>) {
  if (!shows) return <span aria-hidden="true" className="w-8 shrink-0" />
  const trigger = literal ? renderExpandTrigger : undefined
  if (frozen) {
    return <FrozenExpandLink onClick={onExpand} testId={`param-expand-${testId}`} target={shellId} trigger={trigger} label={label} />
  }
  return <OpenEditorButton onClick={onExpand} testId={`param-expand-${testId}`} trigger={trigger} label={label} />
}

// A key or paste equal to the gray default is taken as typed: the caret goes after it, so the next key adds to it.
function caretToEnd(box: HTMLInputElement): void {
  box.setSelectionRange(box.value.length, box.value.length)
}

/** The text an input with no key or paste before it put in the box (a fill, a drop, autofill); null for a deletion. */
function insertedText(event: Event, boxText: string): string | null {
  if (!(event instanceof InputEvent)) return boxText
  if (/^(delete|history)/.test(event.inputType)) return null
  const inserted = event.data ?? event.dataTransfer?.getData('text/plain') ?? ''
  return inserted === '' ? boxText : inserted
}

export function BlockValueField({
  value,
  type,
  isSet,
  defaultValue,
  mode,
  nullable,
  hasEditor,
  testId,
  label,
  onChange,
  onUnset,
  onNull,
  onExpand,
  expressionEntries = NO_ENTRIES,
  elementTypes,
  leftIcon,
  leftIconLabel,
  readOnly = false,
  placeholder,
  suggestions,
  availableVariables = NO_AVAILABLE,
  onEditSecret,
  revealedText,
  adornment,
  onValidation,
  renderExpandTrigger,
  showsEnd = false,
}: Readonly<BlockValueFieldProps>) {
  const errorId = use(FieldErrorContext)
  const noteId = use(FieldNoteContext)
  const frozen = use(SheetFrozenContext)
  const shellId = useId()
  const [focused, setFocused] = useState(false)
  const [keyHint, setKeyHint] = useState<string | null>(null)
  const [expressionEditorOpen, setExpressionEditorOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const boxRef = useRef<HTMLInputElement>(null)
  // Set by the key or paste that replaces the gray default; any other edit of the default is refused.
  const replacingDefault = useRef(false)
  // Held from a keydown to its keyup: an input inside a key press follows the key's own rule.
  const keyHeld = useRef(false)
  // Text typed over the gray default that does not read as a value yet: drawn as typed, never gray (FIELD-2).
  const [typedText, setTypedText] = useState<string | null>(null)
  const name = label ?? testId
  const hasDefault = defaultValue !== undefined
  const { literal, masked, segments, face } = blockFaceState({
    mode,
    type,
    value,
    leftIcon,
    revealedText,
    expressionEntries,
    elementTypes,
  })
  const { notSetDefault, showsDefault, showsNull, emptyText, emptyDefault } = blockShowState({
    literal,
    isSet,
    hasDefault,
    typedText,
    value,
    nullable,
    type,
    defaultValue,
    placeholder,
  })
  const { showsReset, showsNullButton } = blockButtons({ readOnly, masked, hasDefault, isSet, literal, nullable })
  const shownValue = notSetDefault ? defaultValue : value
  const [draft, setDraft] = useLineDraft({
    type,
    shownValue,
    elementTypes,
    notSetDefault,
    typedText,
    setTypedText,
    onValidation,
  })
  const { text, lineBreak } = blockText(type, shownValue, draft.text, face)

  // While the gray default shows, only a key, paste or input that replaces all of it changes the field (FIELD-2).
  const takesChange = () => {
    if (showsDefault && !replacingDefault.current) return false
    replacingDefault.current = false
    return true
  }

  const unset = () => {
    if (typedText !== null) {
      setTypedText(null)
      setDraft(snapshotOf(type, shownValue, elementTypes, undefined, draft.epoch + 1))
    }
    onUnset()
  }

  const typeText = (typed: string) => {
    if (!takesChange()) return
    if (type === 'string') {
      onChange(typed)
      return
    }
    if (typed.trim() === '') {
      onValidation?.([])
      unset()
      return
    }
    const parsed = parseLineText(type, typed, draft.columns, undefined, 'refuse')
    if (parsed.next === undefined) {
      setDraft((current) => ({ ...current, text: typed }))
      if (notSetDefault) setTypedText(typed)
    } else {
      const next = parsed.next
      setDraft((current) => ({ ...current, value: next.value, elementTypes: next.elementTypes, text: typed }))
      onChange(next.value, next.elementTypes)
    }
    onValidation?.(parsed.problems)
  }

  const typeNumber = (next: unknown) => {
    if (!takesChange()) return
    if (next === '') unset()
    else onChange(next)
  }

  const keepNumberText = (typed: string) => {
    if (takesChange() && notSetDefault) setTypedText(typed)
  }

  // The box sees no change when the new text equals the gray default, yet it is the user's value (FIELD-2).
  const takeDefaultText = (typed: string) => {
    replacingDefault.current = true
    if (face === 'number') typeNumber(typed)
    else typeText(typed)
  }

  const handleLineKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isSelectAllKey(event)) {
      event.preventDefault()
      event.currentTarget.select()
    } else if (segments !== null && (isDeleteKey(event.key) || isTypingKey(event))) {
      event.preventDefault()
      setKeyHint(ENTRIES_KEY_HINT)
    }
  }

  // The gray default is never edited in part: a key replaces all of it, Delete only explains.
  const handleDefaultKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const box = event.currentTarget
    if (isDeleteKey(event.key)) {
      event.preventDefault()
      setKeyHint(DEFAULT_KEY_HINT)
    } else if (isTypingKey(event) && event.key === box.value) {
      event.preventDefault()
      caretToEnd(box)
      takeDefaultText(event.key)
    } else if (isTypingKey(event)) {
      replacingDefault.current = true
      box.select()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    replacingDefault.current = false
    keyHeld.current = true
    if (readOnly) return
    if (face === 'line') handleLineKey(event)
    else if (showsDefault) handleDefaultKey(event)
    else if (isDeleteKey(event.key) && selectsAll(event.currentTarget)) {
      event.preventDefault()
      unset()
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (readOnly) return
    if (face === 'line') {
      event.preventDefault()
      if (segments !== null) setKeyHint(ENTRIES_KEY_HINT)
      return
    }
    if (!showsDefault) return
    const box = event.currentTarget
    const pasted = event.clipboardData.getData('text/plain')
    if (pasted === box.value || (lineBreak && pasted === text)) {
      event.preventDefault()
      caretToEnd(box)
      takeDefaultText(pasted)
    } else {
      replacingDefault.current = true
      box.select()
    }
  }

  // Runs before the box's change handler: what an input no key or paste started put in replaces the whole default (FIELD-2).
  const handleInput = (event: { currentTarget: HTMLInputElement; nativeEvent: Event }) => {
    if (readOnly || !showsDefault || replacingDefault.current || keyHeld.current) return
    if (event.nativeEvent instanceof InputEvent && event.nativeEvent.isComposing) return
    const box = event.currentTarget
    const defaultText = face === 'number' ? safeStringify(shownValue) : lineValue(showsNull, lineBreak, text)
    const inserted = insertedText(event.nativeEvent, box.value)
    if (inserted === null) {
      box.value = defaultText
      return
    }
    box.value = inserted
    caretToEnd(box)
    if (inserted === defaultText || (lineBreak && inserted === text)) takeDefaultText(inserted)
    else replacingDefault.current = true
  }

  const boxEvents = {
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    onInput: handleInput,
    onKeyUp: () => {
      keyHeld.current = false
    },
    onCut: (event: ClipboardEvent<HTMLInputElement>) => {
      if (showsDefault) event.preventDefault()
    },
    onFocus: () => setFocused(true),
    onBlur: () => {
      keyHeld.current = false
      setFocused(false)
      setKeyHint(null)
    },
  }

  // A cut line copies whole: the box holds only its first line (VMGR-110).
  const copyWholeLine = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!selectsAll(event.currentTarget)) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', text)
  }

  const expand = () => {
    if (!literal) setExpressionEditorOpen(true)
    onExpand()
  }

  const clearOfMark = adornment !== undefined
  const marker = stateMarker({ focused, showsNull, emptyText, emptyDefault, clearOfMark })
  const stateText = stateTextOf(showsNull, emptyText, showsDefault)
  const stateId = stateText === null ? undefined : `${shellId}-state`
  const describedBy = describedByOf(errorId, noteId, stateId)
  const rightButtons = (
    <FieldButtons
      showsReset={showsReset}
      showsNullButton={showsNullButton}
      showsNull={showsNull}
      name={name}
      testId={testId}
      onUnset={onUnset}
      onNull={onNull}
    />
  )
  const icon = leftIcon && <FieldIcon icon={leftIcon} label={leftIconLabel} />

  let control: ReactNode
  if (face === 'source') {
    control = (
      <SourceFace
        testId={testId}
        name={name}
        value={value}
        isSet={isSet}
        defaultValue={defaultValue}
        type={type}
        readOnly={readOnly}
        showsReset={showsReset}
        invalid={errorId !== undefined}
        availableVariables={availableVariables}
        editorOpen={expressionEditorOpen}
        onEditorOpenChange={setExpressionEditorOpen}
        onChange={onChange}
        onUnset={onUnset}
      />
    )
  } else {
    control = (
      <BoxFace
        face={face}
        type={type}
        text={text}
        lineBreak={lineBreak}
        segments={segments}
        revealedText={revealedText}
        name={name}
        testId={testId}
        readOnly={readOnly}
        placeholder={placeholder}
        suggestions={suggestions}
        showsDefault={showsDefault}
        showsNull={showsNull}
        hideHint={showsNull || emptyText || emptyDefault}
        clearOfMark={clearOfMark}
        errorId={errorId}
        describedBy={describedBy}
        numberDescribedBy={describedByOf(noteId, stateId)}
        numberValue={showsNull ? '' : (typedText ?? shownValue ?? '')}
        boxRef={boxRef}
        listOpen={listOpen}
        onListOpenChange={setListOpen}
        boxEvents={boxEvents}
        onCopyLine={copyWholeLine}
        onType={typeText}
        onNumber={typeNumber}
        onInvalidNumber={keepNumberText}
        onValidation={onValidation}
        onPick={(picked) => onChange(picked)}
        onEditSecret={onEditSecret}
        icon={icon}
        marker={marker}
        rightButtons={rightButtons}
        showsEnd={showsEnd && !focused}
      />
    )
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <ConditionalTooltip
        content={<span data-testid={`param-tooltip-${testId}`}>{keyHint ?? DEFAULT_KEY_HINT}</span>}
        open={keyHint !== null}
        onOpenChange={(open) => {
          if (!open) setKeyHint(null)
        }}
      >
        <div id={shellId} className="relative min-w-0 flex-1">
          {control}
          {adornment}
          <StateNote id={stateId} text={stateText} />
          <span className="sr-only" aria-live="polite" data-testid={`param-key-hint-${testId}`}>
            {keyHint ?? ''}
          </span>
        </div>
      </ConditionalTooltip>
      <ExpandColumn
        shows={!literal || (hasEditor && (face === 'text' || face === 'line'))}
        frozen={frozen}
        literal={literal}
        testId={testId}
        shellId={shellId}
        label={label}
        renderExpandTrigger={renderExpandTrigger}
        onExpand={expand}
      />
    </div>
  )
}

/** What a screen reader hears of a not-set, null or empty field. */
function StateNote({ id, text }: Readonly<{ id: string | undefined; text: string | null }>) {
  if (id === undefined) return null
  return (
    <span id={id} className="sr-only">
      {text}
    </span>
  )
}

interface BoxFaceProps {
  face: BlockFace
  type: VariableType
  text: string
  lineBreak: boolean
  segments: LineSegment[] | null
  revealedText: string | undefined
  name: string
  testId: string
  readOnly: boolean
  placeholder: string | undefined
  suggestions: SuggestionList | undefined
  showsDefault: boolean
  showsNull: boolean
  hideHint: boolean
  clearOfMark: boolean
  errorId: string | undefined
  describedBy: string | undefined
  numberDescribedBy: string | undefined
  numberValue: unknown
  boxRef: RefObject<HTMLInputElement | null>
  listOpen: boolean
  onListOpenChange: (open: boolean) => void
  boxEvents: NumberBoxEvents
  onCopyLine: (event: ClipboardEvent<HTMLInputElement>) => void
  onType: (text: string) => void
  onNumber: (value: unknown) => void
  onInvalidNumber: (text: string) => void
  onValidation: ((messages: string[]) => void) | undefined
  onPick: (picked: string) => void
  onEditSecret: (() => void) | undefined
  icon: ReactNode
  marker: ReactNode
  rightButtons: ReactNode
  /** Scroll the box to the end of its text (a path's file name). */
  showsEnd: boolean
}

/** Every face but {x} in one field group, so a masked secret's place passes to the box that replaces it. */
function BoxFace(props: Readonly<BoxFaceProps>) {
  const { face, readOnly, lineBreak, suggestions, listOpen, onListOpenChange, boxRef, showsDefault, showsNull, text } = props
  const list = face === 'text' && !readOnly && !lineBreak ? suggestions : undefined
  const group = (
    <InputGroup className={BLOCK_GROUP_CLASS}>
      {props.icon}
      <FaceBox {...props} list={list} />
      {face !== 'masked' && props.rightButtons}
    </InputGroup>
  )
  if (!list) return group
  return (
    <SuggestionPopover
      open={listOpen}
      onOpenChange={onListOpenChange}
      boxRef={boxRef}
      // The gray default is not typed text, so it never narrows the list.
      items={matchingItems(list.items, showsDefault || showsNull ? '' : text, list.unfiltered)}
      footer={list.footer}
      emptyText={list.emptyText}
      onPick={props.onPick}
    >
      {group}
    </SuggestionPopover>
  )
}

/** The control inside the group: the masked pencil, the number box or the text box. */
function FaceBox(props: Readonly<BoxFaceProps & { list: SuggestionList | undefined }>) {
  if (props.face === 'masked') {
    return (
      <MaskedSecretControl
        secretAffordance="field"
        onClick={props.onEditSecret}
        disabled={props.readOnly}
        aria-describedby={props.describedBy}
        className="!h-full flex-1 rounded-none border-0 bg-transparent shadow-none"
      />
    )
  }
  if (props.face === 'number') return <NumberBox {...props} />
  return <TextBox {...props} />
}

/** The exact-digit number box (REQ-3.1.3.14). */
function NumberBox({
  type,
  numberValue,
  showsDefault,
  showsNull,
  placeholder,
  name,
  testId,
  errorId,
  numberDescribedBy,
  readOnly,
  boxEvents,
  onNumber,
  onInvalidNumber,
  onValidation,
  marker,
}: Readonly<BoxFaceProps>) {
  return (
    <div className={cn('relative flex min-w-0 self-stretch', BLOCK_NUMBER_SLOT_CLASS)}>
      <ScalarEditBody
        value={numberValue}
        type={type}
        size="field"
        muted={showsDefault}
        inputTestId={`param-input-${testId}`}
        name={testId}
        ariaLabel={name}
        placeholder={showsDefault || showsNull ? undefined : placeholder}
        errorId={errorId}
        describedBy={numberDescribedBy}
        readOnly={readOnly}
        blank="unset"
        inputEvents={boxEvents}
        onChange={onNumber}
        onValidChange={(valid) => onValidation?.(valid ? [] : [`Enter a valid ${type} value`])}
        onInvalidText={onInvalidNumber}
      />
      {marker}
    </div>
  )
}

/** The text box, or a drawn line over a read-only box. */
function TextBox({
  face,
  type,
  text,
  lineBreak,
  segments,
  revealedText,
  name,
  testId,
  readOnly,
  placeholder,
  suggestions,
  showsDefault,
  showsNull,
  hideHint,
  clearOfMark,
  errorId,
  describedBy,
  boxRef,
  listOpen,
  onListOpenChange,
  boxEvents,
  onCopyLine,
  onType,
  marker,
  list,
  showsEnd,
}: Readonly<BoxFaceProps & { list: SuggestionList | undefined }>) {
  const line = face === 'line'
  const shown = line ? '' : lineValue(showsNull, lineBreak, text)
  // After the browser's own blur handling, which moves the text back to its start.
  useEffect(() => {
    if (!showsEnd) return
    const box = boxRef.current as HTMLInputElement
    const frame = requestAnimationFrame(() => {
      box.scrollLeft = box.scrollWidth
    })
    return () => cancelAnimationFrame(frame)
  }, [showsEnd, shown, boxRef])
  // A drawn line is the {x} entries line, else a revealed stored secret.
  const lineText = segments === null ? (revealedText ?? '') : segments.map((segment) => segment.text).join('')
  const combo = list && comboboxBoxProps(listOpen, onListOpenChange)
  return (
    <div className="relative flex min-w-0 flex-1 self-stretch">
      <input
        ref={boxRef}
        type="text"
        data-slot="input-group-control"
        data-testid={suggestions && `param-input-${testId}`}
        {...combo}
        name={testId}
        aria-label={name}
        aria-invalid={errorId === undefined ? undefined : true}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        translate="no"
        readOnly={readOnly || line || (lineBreak && !showsDefault)}
        title={lineBreak ? text : undefined}
        {...boxEvents}
        // The list's own keys first, then the field's (FIELD-2).
        onKeyDown={(event) => {
          combo?.onKeyDown(event)
          boxEvents.onKeyDown?.(event)
        }}
        onCopy={lineBreak ? onCopyLine : undefined}
        placeholder={hideHint ? undefined : placeholder}
        value={line ? lineText : shown}
        onChange={(event) => {
          onType(event.target.value)
          if (list) onListOpenChange(true)
        }}
        className={cn(
          BLOCK_CONTROL_CLASS,
          showsDefault ? HELD_DEFAULT_LOOK_CLASS : getValueColorClass(type),
          // After the value color, so the merge keeps the box clear under the overlay.
          line && 'text-transparent caret-transparent',
          clearOfMark && MARK_CLEARANCE_CLASS,
          // A path cut at its start shows no ellipsis at its end.
          showsEnd && 'text-clip',
        )}
      />
      {line && <LineOverlay segments={segments} lineText={lineText} type={type} clearOfMark={clearOfMark} />}
      {marker}
    </div>
  )
}

/** What a text box holds: nothing under a null marker, the first line of a many-line text. */
function lineValue(showsNull: boolean, lineBreak: boolean, text: string): string {
  if (showsNull) return ''
  return lineBreak ? `${text.split('\n')[0]}${LINE_BREAK_MARK}` : text
}
