/**
 * MapEditBody - controlled map edit body. Each entry is key + a per-value type
 * pill + value, held positionally so a new row can be empty and duplicate keys
 * surface. An existing row keeps its declared type while its text is edited; a
 * new row takes boolean / array / map from what is typed until a type is picked,
 * and digits never make a number. Numbers are kept as exact text (precision).
 * A stored null value shows the null chip and stays null until a value is
 * entered; an invalid value is flagged, not blocked.
 *
 * Opt-in extensions (all data-driven; the editor stays plugin-ignorant):
 * quick-insert scaffold menus, an info note, a declarative key policy, a
 * host-supplied credential advisory, host-supplied READ-ONLY generated rows,
 * and a host-injected per-row EXPRESSION editor (the {x} affordance, beside the
 * type pill in a typed map). Expression-ness is a sidecar set of keys reported
 * through onExpressionKeysChange; a literal value is stored verbatim (a literal
 * `{{ }}` is never evaluated); an expression row shows no type.
 * Every part of a row is the one 32px row box; every value outside {x} takes the
 * null button inside its box. A text value opens the host's string editor from
 * its expand, a List or Map value its own editor one level deeper, an {x} value
 * its expression editor (FIELD-1, FIELD-10, FIELD-13). A string-only map shows its
 * one type as a read-only pill at any level. A type change,
 * or a switch into or out of {x}, leaves the type's default and asks first when that
 * clears a value (FIELD-7).
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.19: Declared element types
 * REQ-3.1.3.20: Null is the only empty value
 */

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { TrashIcon, PlusIcon } from '@/components/ui/icon'
import { ExpressionToggle } from '@/components/shared/fields/expression-toggle'
import { RowRemovalQuestion, useRowRemovalGuard } from '@/components/shared/child-editors/row-removal-guard'
import { cn } from '@/lib/utils'
import { openEditorAfterRemoval } from '@/lib/child-editors'
import { getValueColorClass, isNullValue } from '@/lib/variable-format'
import {
  defaultItemText,
  describeCellError,
  entryText,
  inferStoredElementType,
  inferTypeFromText,
  mapEntryErrorMessages,
  mapKeyPolicyFlaggedIndexes,
  parseItemValue,
  type ResolvedMapKeyPolicy,
  type ValueType,
} from '@/lib/variable-validation'
import type { QuickInsertItem, QuickInsertMenu } from '@/lib/quick-inserts'
import { ScalarTypeSelect, VALUE_TYPES } from '@/components/shared/variable-bodies/scalar-type-select'
import { useScrollOnAppend } from '@/components/shared/variable-bodies/use-scroll-on-append'
import {
  EDIT_HEADER_LABEL,
  ENTRY_CONTROL_CLASS,
  EntryBox,
  EntryExpand,
  entryEditorType,
  FixedTypeCell,
  NullChip,
  typeTrack,
  type EntryEditorType,
  type ItemTextEditorProps,
  type TypeLook,
} from '@/components/shared/variable-bodies/body-parts'
import {
  EntryChangeQuestions,
  expressionStart,
  useEntryChange,
} from '@/components/shared/variable-bodies/entry-change-questions'
import { useStableKeys } from '@/components/shared/variable-bodies/use-stable-keys'
import { numberEntryProps, takesEntryText } from '@/lib/number-entry'

// The Key and Value boxes share the row's free width in this ratio; every other track is fixed.
const KEY_VALUE_TRACKS = 'minmax(0,1fr) minmax(0,1.4fr)'

const MAP_GRID_CLASS = 'grid items-center gap-2 px-2.5'

interface MapColumns {
  expand: boolean
  type: TypeLook
  expr: boolean
}

// A string-only map's one type.
const FIXED_MAP_TYPE: ValueType = 'string'

/** One track list for the header band and every row: key, value, expand, type, {x}, delete. */
function mapGridColumns({ expand, type, expr }: MapColumns): string {
  const tracks = [KEY_VALUE_TRACKS]
  if (expand) tracks.push('1.75rem')
  tracks.push(typeTrack(type))
  if (expr) tracks.push('2rem')
  tracks.push('1.75rem')
  return tracks.join(' ')
}

const ADVISORY_TOOLTIP =
  'This credential is not protected - it is stored and displayed in plain text. ' +
  'Switch this value to an expression that references a secret variable instead.'

const READONLY_INPUT_CLASS =
  'h-8 w-full min-w-0 rounded-md border border-transparent bg-muted/40 px-2 py-1 ' +
  'font-mono text-sm text-muted-foreground focus-visible:outline-none'

/** Props the host-injected per-row expression editor receives. */
export interface MapExpressionEditorProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  testId: string
  /** The entry's full expression editor, opened by the row's expand (FIELD-1); absent, the slot keeps its own. */
  editorOpen?: boolean
  onEditorOpenChange?: (open: boolean) => void
}

/** A read-only generated row the host derives from the node config (composed
 *  auth header / auto body header). Deleting syncs the owning config flag off;
 *  a locked delete renders disabled with the tooltip. */
export interface GeneratedMapRow {
  key: string
  value: string
  /** Masked display (the composed value is a run secret). */
  masked?: boolean
  onDelete?: () => void
  deleteLocked?: boolean
  deleteLockedTooltip?: string
}

export interface MapEditBodyProps {
  /** A whole null shows no entries (the hosts open a null value on its type default). */
  value: Record<string, unknown> | null
  types: Record<string, ValueType>
  onChange: (value: Record<string, unknown>, types: Record<string, ValueType>) => void
  onValidChange: (valid: boolean) => void
  /** Visual-strip messages (key / Element #i prefixed); host renders the strip. */
  onValidation?: (messages: string[]) => void
  /** Force every value to the string type, its pill read-only, so a
   *  parameter map (HTTP headers / query params) stays string->string. */
  stringValuesOnly?: boolean
  /** Host-injected expression editor: renders the per-row {x} toggle and, while
   *  a row is an expression, the row's value input through this slot. */
  expressionEditor?: (props: MapExpressionEditorProps) => ReactNode
  /** Keys whose values are expressions (seeds the per-row toggle). */
  expressionKeys?: ReadonlySet<string>
  /** Reports the rebuilt expression-key set after any row edit/toggle/rename. */
  onExpressionKeysChange?: (keys: Set<string>) => void
  /** Read-only generated rows rendered above the editable entries; they join
   *  the duplicate-key rule. */
  generatedRows?: GeneratedMapRow[]
  /** Scaffold menus rendered beside "+ Add entry". */
  quickInserts?: QuickInsertMenu[]
  /** One muted info line above the grid. */
  note?: string
  /** Declarative key checks (case-insensitive duplicates, blocked keys). */
  keyPolicy?: ResolvedMapKeyPolicy
  /** Host-supplied advisory: true renders the amber in-field icon (non-blocking).
   *  Receives whether the row is an expression so the host can apply the
   *  credential walk to expressions and the plaintext rule to literals. */
  credentialAdvisory?: (key: string, value: string, isExpr: boolean) => boolean
  /** The editor a literal text, List or Map value opens from its expand. */
  textEditor?: (props: ItemTextEditorProps) => ReactNode
  /** The nested level of this map: 1 opened from the field, one more per List or Map entry it was opened from. */
  level?: number
}

interface Entry {
  key: string
  /** The value's text; null for a stored null value, shown as the null chip. */
  value: string | null
  type: ValueType
  manual: boolean
  isExpr: boolean
}

interface EntryState {
  keyError: boolean
  error: string | null
  advisory: boolean
}

const NO_ENTRIES: Record<string, unknown> = {}

/** A row's flags: a missing, duplicated or refused key; the value's error; the credential advisory. */
function entryState(
  entry: Entry,
  keyFlagged: boolean,
  inExprEditor: boolean,
  credentialAdvisory: MapEditBodyProps['credentialAdvisory'],
): EntryState {
  // A null value fits any type and holds no credential text.
  if (entry.value === null) {
    return { keyError: keyFlagged || entry.key.trim() === '', error: null, advisory: false }
  }
  const trimmedKey = entry.key.trim()
  const hasValue = entry.value.trim() !== ''
  const fullyEmpty = trimmedKey === '' && !hasValue
  const checked = !fullyEmpty && !inExprEditor
  return {
    keyError: (trimmedKey === '' && hasValue) || keyFlagged,
    error: checked ? describeCellError(entry.value, entry.type) : null,
    advisory: !fullyEmpty && (credentialAdvisory?.(entry.key, entry.value, entry.isExpr) ?? false),
  }
}

interface EntryTypeCellProps {
  entry: Entry
  index: number
  inExprEditor: boolean
  look: TypeLook
  onType: (index: number, type: ValueType) => void
}

/** The row's type pill; an expression row has no type, its result is the value. */
function EntryTypeCell({ entry, index, inExprEditor, look, onType }: Readonly<EntryTypeCellProps>) {
  if (look === 'fixed') {
    return <FixedTypeCell type={FIXED_MAP_TYPE} part={inExprEditor ? 'blank' : 'pill'} testId={`map-type-${index}`} />
  }
  if (inExprEditor) return <span />
  return (
    <ScalarTypeSelect
      value={entry.type}
      onChange={(next) => onType(index, next)}
      options={VALUE_TYPES}
      testId={`map-type-${index}`}
      label={`Entry ${index} value type`}
    />
  )
}

function seedEntries(
  value: Record<string, unknown>,
  types: Record<string, ValueType>,
  stringValuesOnly: boolean,
  expressionKeys: ReadonlySet<string>,
): Entry[] {
  return Object.entries(value).map(([key, entryValue]) => ({
    key,
    value: isNullValue(entryValue) ? null : entryText(entryValue),
    // An existing value is typed by its stored shape: a real nested array / map,
    // OR one held as verbatim JSON text (a saved nested value), is that type; a
    // non-JSON bracketed string (e.g. "[x]") stays a string. A string-only map
    // pins every value to string regardless of the stored shape.
    type: stringValuesOnly ? 'string' : (types[key] ?? inferStoredElementType(entryValue)),
    manual: true,
    isExpr: expressionKeys.has(key),
  }))
}

function buildObject(entries: Entry[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const entry of entries) {
    if (entry.key.trim() !== '') {
      result[entry.key] = entry.value === null ? null : parseItemValue(entry.value, entry.type)
    }
  }
  return result
}

function buildTypes(entries: Entry[]): Record<string, ValueType> {
  const result: Record<string, ValueType> = {}
  for (const entry of entries) {
    if (entry.key.trim() !== '') result[entry.key] = entry.type
  }
  return result
}

/** The expression-key set derived from the current entries (named keys only). */
function buildExprKeys(entries: Entry[]): Set<string> {
  const keys = new Set<string>()
  for (const entry of entries) {
    if (entry.isExpr && entry.key.trim() !== '') keys.add(entry.key)
  }
  return keys
}

/** Entries as the validator reads them: an expression row's text is checked as
 *  text, and a null value, which fits any type, as the text `null`. */
function checked(entries: Entry[]): { key: string; value: string; type: ValueType }[] {
  return entries.map((entry) => ({
    key: entry.key,
    value: entry.value ?? 'null',
    type: entry.isExpr || entry.value === null ? 'string' : entry.type,
  }))
}

interface EntryValueProps {
  entry: Entry
  index: number
  inExprEditor: boolean
  error: string | null
  advisory: boolean
  expressionEditor: MapEditBodyProps['expressionEditor']
  /** The {x} value's full editor is open. */
  editorOpen: boolean
  onEditorOpenChange: (index: number, open: boolean) => void
  onValue: (index: number, text: string) => void
  onNull: (index: number) => void
  onEnterValue: (index: number) => void
}

/** A row's value: the host's expression editor, or the row box holding the null chip or the literal input. */
function EntryValue(props: Readonly<EntryValueProps>) {
  const { inExprEditor, expressionEditor } = props
  if (inExprEditor && expressionEditor) return <EntryExpressionValue {...props} expressionEditor={expressionEditor} />
  return <EntryLiteralValue {...props} />
}

/** An {x} value in the host's expression editor, the advisory kept clear of the text. */
function EntryExpressionValue({
  entry,
  index,
  advisory,
  expressionEditor,
  editorOpen,
  onEditorOpenChange,
  onValue,
}: Readonly<EntryValueProps & { expressionEditor: NonNullable<MapEditBodyProps['expressionEditor']> }>) {
  return (
    <div className={cn('relative min-w-0', advisory && '[&_.cm-content]:!pr-8')}>
      {expressionEditor({
        value: entry.value ?? '',
        onChange: (next) => onValue(index, next),
        ariaLabel: `Entry ${index} value`,
        testId: `map-expr-value-${index}`,
        editorOpen,
        onEditorOpenChange: (open) => onEditorOpenChange(index, open),
      })}
      {advisory && (
        <span className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2">
          <UnsecuredCredentialAdvisory />
        </span>
      )}
    </div>
  )
}

/** A literal value: the row box with the null chip or the text input, the null button inside. */
function EntryLiteralValue({ entry, index, error, advisory, onValue, onNull, onEnterValue }: Readonly<EntryValueProps>) {
  const text = entry.value
  const isNull = text === null
  return (
    <EntryBox
      adornment={advisory && <UnsecuredCredentialAdvisory />}
      nullButton={{
        label: entry.key.trim() === '' ? `Entry ${index}` : entry.key,
        pressed: isNull,
        onClick: isNull ? () => onEnterValue(index) : () => onNull(index),
        testId: `map-edit-value-${index}-null`,
      }}
    >
      {isNull ? (
        <NullChip
          label={entry.key}
          testId={`map-edit-null-${index}`}
          onEnterValue={() => onEnterValue(index)}
          className={ENTRY_CONTROL_CLASS}
        />
      ) : (
        <input
          data-testid={`map-edit-value-${index}`}
          aria-label={`Entry ${index} value`}
          aria-invalid={error ? 'true' : undefined}
          autoComplete="off"
          spellCheck={false}
          {...numberEntryProps(entry.type)}
          value={text}
          onChange={(event) => {
            if (takesEntryText(event.target.value, entry.type)) onValue(index, event.target.value)
          }}
          className={cn(ENTRY_CONTROL_CLASS, 'font-mono', error ? 'text-destructive' : getValueColorClass(entry.type))}
        />
      )}
    </EntryBox>
  )
}

/** Non-interactive amber advisory for a credential held as plain text (HTTP-4, SECFLD-2). */
export function UnsecuredCredentialAdvisory({ className }: Readonly<{ className?: string }>) {
  return (
    <ConditionalTooltip
      content={ADVISORY_TOOLTIP}
      side="bottom"
      align="end"
      wide
    >
      <span aria-label="Unsecured credential" className={cn('inline-flex items-center', className)}>
        <AlertTriangle className="h-[15px] w-[15px] text-amber-500" aria-hidden="true" />
      </span>
    </ConditionalTooltip>
  )
}

/** One read-only generated row: muted key/value, delete syncs the config off. */
function GeneratedRow({
  row,
  index,
  columns,
}: Readonly<{
  row: GeneratedMapRow
  index: number
  columns: MapColumns
}>) {
  const removeButton = (
    <button
      type="button"
      data-testid={`map-generated-remove-${index}`}
      aria-label={`Remove generated entry ${index}`}
      disabled={row.deleteLocked}
      onClick={row.onDelete}
      className={cn(
        'justify-self-end rounded-sm p-1 text-muted-foreground',
        row.deleteLocked
          ? 'cursor-not-allowed opacity-50'
          : 'hover:bg-muted hover:text-destructive',
      )}
    >
      <TrashIcon size={14} />
    </button>
  )
  return (
    <div
      className={cn(MAP_GRID_CLASS, 'border-b border-border/60 bg-muted/20 py-1.5')}
      style={{ gridTemplateColumns: mapGridColumns(columns) }}
    >
      <input
        data-testid={`map-generated-key-${index}`}
        aria-label={`Generated entry ${index} key`}
        aria-readonly="true"
        readOnly
        tabIndex={-1}
        value={row.key}
        className={READONLY_INPUT_CLASS}
      />
      <input
        data-testid={`map-generated-value-${index}`}
        aria-label={`Generated entry ${index} value`}
        aria-readonly="true"
        readOnly
        tabIndex={-1}
        value={row.value}
        className={cn(READONLY_INPUT_CLASS, row.masked && 'tracking-widest')}
      />
      {columns.expand && <span />}
      {columns.type === 'fixed' ? <FixedTypeCell type={FIXED_MAP_TYPE} part="blank" /> : <span />}
      {columns.expr && <span />}
      {row.deleteLockedTooltip ? (
        <ConditionalTooltip
          content={row.deleteLockedTooltip}
          side="bottom"
          align="end"
          wide
        >
          <span className="justify-self-end inline-flex">{removeButton}</span>
        </ConditionalTooltip>
      ) : (
        removeButton
      )}
    </div>
  )
}

export function MapEditBody({
  value,
  types,
  onChange,
  onValidChange,
  onValidation,
  stringValuesOnly = false,
  expressionEditor,
  expressionKeys,
  onExpressionKeysChange,
  generatedRows,
  quickInserts,
  note,
  keyPolicy,
  credentialAdvisory,
  textEditor,
  level = 1,
}: Readonly<MapEditBodyProps>) {
  const [entries, setEntries] = useState<Entry[]>(() =>
    seedEntries(value ?? NO_ENTRIES, types, stringValuesOnly, expressionKeys ?? new Set()),
  )
  // The open entry editor's entry, what it opened as, and a count that gives each newly opened editor its own identity.
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [openType, setOpenType] = useState<EntryEditorType>('string')
  const [openSeq, setOpenSeq] = useState(0)
  // The {x} entry whose full expression editor is open.
  const [exprOpenIndex, setExprOpenIndex] = useState<number | null>(null)
  const guard = useRowRemovalGuard()
  const change = useEntryChange()
  const entryKeys = useStableKeys(entries.length)
  const { listRef, markAppended } = useScrollOnAppend(entries.length)

  // Generated rows join the duplicate rule as virtual leading entries.
  const generated = generatedRows ?? []
  const generatedEntries = generated.map((row) => ({
    key: row.key,
    value: '',
    type: 'string' as ValueType,
  }))

  const emit = (next: Entry[]) => {
    setEntries(next)
    onChange(buildObject(next), buildTypes(next))
    onExpressionKeysChange?.(buildExprKeys(next))
    const messages = mapEntryErrorMessages([...generatedEntries, ...checked(next)], undefined, keyPolicy)
    onValidChange(messages.length === 0)
    onValidation?.(messages)
  }
  const updateKey = (index: number, key: string) =>
    emit(entries.map((entry, i) => (i === index ? { ...entry, key } : entry)))
  const updateValue = (index: number, text: string) =>
    emit(
      entries.map((entry, i) =>
        i === index
          ? {
              ...entry,
              value: text,
              type: stringValuesOnly || entry.manual ? entry.type : inferTypeFromText(text),
            }
          : entry,
      ),
    )
  // A new type leaves its default, so the entry is valid at once.
  const updateType = (index: number, type: ValueType) => {
    const entry = entries[index]
    change.requestType(entry.type, type, entry.value, () =>
      emit(entries.with(index, { ...entry, type, manual: true, value: defaultItemText(type) })),
    )
  }
  const enterValue = (index: number) =>
    emit(entries.with(index, { ...entries[index], value: defaultItemText(entries[index].type) }))
  // Switching never carries a value across (FIELD-7): into {x} empty, out of it the default.
  const toggleExpr = (index: number, pressed: boolean) => {
    const entry = entries[index]
    change.requestSwitch(pressed, entry.type, entry.value, (clear) =>
      emit(
        entries.with(index, {
          ...entry,
          isExpr: pressed,
          value: pressed ? expressionStart(entry.type, clear) : defaultItemText(entry.type),
        }),
      ),
    )
  }
  const setNull = (index: number) => emit(entries.with(index, { ...entries[index], value: null }))
  // A saved text stays text, whatever it reads like.
  const saveText = (index: number, text: string) => emit(entries.with(index, { ...entries[index], value: text }))
  const removeAt = (index: number) => {
    setOpenIndex((open) => openEditorAfterRemoval(open, index))
    emit(entries.filter((_, i) => i !== index))
  }
  // An entry whose open editor holds unsaved changes asks before it goes.
  const requestRemove = (index: number) => guard.request([entries[index].key], () => removeAt(index))

  // Opening another entry's editor takes the open one away, asking first while it holds changes.
  const openTextEditor = (index: number, type: ValueType) => {
    if (openIndex === index) return
    const open = () => {
      setOpenIndex(index)
      setOpenType(entryEditorType(type))
      setOpenSeq((seq) => seq + 1)
    }
    if (openIndex === null) open()
    else guard.request([entries[openIndex].key], open)
  }

  // Surface load-time validation (e.g. a duplicate against a generated row) on mount;
  // emit() otherwise only fires on user edits. Errors-only keeps clean configs unchanged.
  useEffect(() => {
    const messages = mapEntryErrorMessages([...generatedEntries, ...checked(entries)], undefined, keyPolicy)
    if (messages.length > 0) {
      onValidChange(false)
      onValidation?.(messages)
    }
    // Mount-only: report load-time validation once (inputs are the initial render's).
  }, [])

  const insertQuickItem = (item: QuickInsertItem) => {
    emit([
      ...entries,
      { key: item.key, value: item.value, type: 'string', manual: false, isExpr: false },
    ])
  }

  const keyCounts = new Map<string, number>()
  for (const row of generated) keyCounts.set(row.key, (keyCounts.get(row.key) ?? 0) + 1)
  for (const entry of entries) {
    const key = entry.key.trim()
    if (key !== '') keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
  }
  const duplicateKeys = new Set(
    [...keyCounts].filter(([, count]) => count > 1).map(([key]) => key),
  )
  const policyFlaggedAll = keyPolicy
    ? mapKeyPolicyFlaggedIndexes([...generatedEntries, ...entries], keyPolicy)
    : new Set<number>()
  const policyFlagged = new Set(
    [...policyFlaggedAll]
      .filter((index) => index >= generated.length)
      .map((index) => index - generated.length),
  )

  const exprColumn = expressionEditor !== undefined
  const columns: MapColumns = {
    expand: textEditor !== undefined || exprColumn,
    type: stringValuesOnly ? 'fixed' : 'picker',
    expr: exprColumn,
  }
  const gridStyle = { gridTemplateColumns: mapGridColumns(columns) }

  const addEntry = () => {
    markAppended()
    emit([...entries, { key: '', value: '', type: 'string', manual: false, isExpr: false }])
  }

  const addEntryButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid="map-add-entry"
      className={cn(
        'h-7 shrink-0 self-start whitespace-nowrap px-2 text-xs',
        quickInserts?.length
          ? 'font-semibold text-foreground hover:text-foreground'
          : 'text-indigo-500 hover:text-indigo-600',
      )}
      onClick={addEntry}
    >
      <PlusIcon size={12} className="mr-1" />
      Add entry
    </Button>
  )

  return (
    <div data-testid="map-edit-body" className="flex h-full min-h-0 flex-col gap-2">
      <RowRemovalQuestion guard={guard} />
      <EntryChangeQuestions change={change} subject="entry" />
      {note && (
        <p className="shrink-0 text-[11px] leading-snug text-muted-foreground">{note}</p>
      )}
      <div ref={listRef} className="min-h-0 grow scroll-pt-9 overflow-auto overscroll-contain rounded-lg border">
        <div
          className={cn(MAP_GRID_CLASS, 'sticky top-0 z-10 border-b border-border bg-muted py-1.5')}
          style={gridStyle}
        >
          <span className={EDIT_HEADER_LABEL}>Key</span>
          <span className={EDIT_HEADER_LABEL}>Value</span>
          {columns.expand && <span />}
          {columns.type === 'fixed' ? (
            <FixedTypeCell type={FIXED_MAP_TYPE} part="header" />
          ) : (
            <span className={EDIT_HEADER_LABEL}>Type</span>
          )}
          {exprColumn && <span />}
          <span />
        </div>
        {generated.map((row, index) => (
          <GeneratedRow key={`${row.key}-${index}`} row={row} index={index} columns={columns} />
        ))}
        {entries.map((entry, index) => {
          const inExprEditor = exprColumn && entry.isExpr
          const keyFlagged = duplicateKeys.has(entry.key.trim()) || policyFlagged.has(index)
          const { keyError, error, advisory } = entryState(entry, keyFlagged, inExprEditor, credentialAdvisory)
          return (
            <div
              key={entryKeys[index]}
              className={cn(MAP_GRID_CLASS, 'border-b border-border/60 py-1.5 last:border-b-0')}
              style={gridStyle}
            >
              <EntryBox>
                <input
                  data-testid={`map-edit-key-${index}`}
                  aria-label={`Entry ${index} key`}
                  aria-invalid={keyError ? 'true' : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  value={entry.key}
                  onChange={(event) => updateKey(index, event.target.value)}
                  className={cn(ENTRY_CONTROL_CLASS, 'font-mono', keyError && 'text-destructive')}
                />
              </EntryBox>
              <EntryValue
                entry={entry}
                index={index}
                inExprEditor={inExprEditor}
                error={error}
                advisory={advisory}
                expressionEditor={expressionEditor}
                editorOpen={exprOpenIndex === index}
                onEditorOpenChange={(at, open) => setExprOpenIndex(open ? at : null)}
                onValue={updateValue}
                onNull={setNull}
                onEnterValue={enterValue}
              />
              {columns.expand && (
                <EntryExpand
                  testId={`map-expand-${index}`}
                  rowName={`Entry ${index}`}
                  text={entry.value}
                  type={entry.type}
                  isExpr={inExprEditor}
                  level={level}
                  onExpandEntry={textEditor ? () => openTextEditor(index, entry.type) : undefined}
                  onExpandExpression={() => setExprOpenIndex(index)}
                />
              )}
              <EntryTypeCell
                entry={entry}
                index={index}
                inExprEditor={inExprEditor}
                look={columns.type}
                onType={updateType}
              />
              {exprColumn && (
                <ExpressionToggle
                  data-testid={`map-expr-toggle-${index}`}
                  pressed={entry.isExpr}
                  onPressedChange={(pressed) => toggleExpr(index, pressed)}
                  label={`Entry ${index} expression mode`}
                />
              )}
              <button
                type="button"
                data-testid={`map-remove-${index}`}
                aria-label={`Remove entry ${index}`}
                onClick={() => requestRemove(index)}
                className="justify-self-end rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          )
        })}
      </div>
      {quickInserts?.length ? (
        <div className="flex shrink-0 items-center gap-3">
          {addEntryButton}
          {quickInserts.map((menu) => (
            <DropdownMenu key={menu.label}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 whitespace-nowrap px-2 text-xs font-semibold text-indigo-500 hover:text-indigo-600"
                >
                  {menu.label}
                  <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {menu.items.map((item) => (
                  <DropdownMenuItem
                    key={item.label}
                    onSelect={() => insertQuickItem(item)}
                  >
                    <span className="flex flex-col">
                      <span>{item.label}</span>
                      {item.sublabel && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {item.sublabel}
                        </span>
                      )}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </div>
      ) : (
        addEntryButton
      )}
      {textEditor && openIndex !== null && openIndex < entries.length && (
        <Fragment key={openSeq}>
          {textEditor({
            label: entries[openIndex].key,
            type: openType,
            value: entries[openIndex].value ?? '',
            onSave: (text) => saveText(openIndex, text),
            onClose: () => setOpenIndex(null),
          })}
        </Fragment>
      )}
    </div>
  )
}
