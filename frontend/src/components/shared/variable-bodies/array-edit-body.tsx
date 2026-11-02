/**
 * ArrayEditBody - the shared list editor (controlled). Each item carries a
 * per-element type pill (like a table column): an existing item keeps its declared
 * type while its text is edited; a new item takes boolean / array / map from what is
 * typed until a type is picked, and digits never make a number. Numbers are kept as
 * exact text (precision), so the Code view prints them as real number literals.
 * A list typed by one Value Type (an enum's allowed values) shows that type read-only.
 * Every item is the one 32px row box with the null button inside; a stored null item
 * shows the null chip, the button pressed, and stays null until a value is entered;
 * an invalid item is flagged, never blocked.
 *
 * A host may add per-item {x} through an injected expression editor, its own row
 * input in place of the text box, position labels, the editor a text, List or Map
 * item opens from expand, and the value Add appends. An {x} item's expand opens its
 * expression editor (FIELD-1, FIELD-10, FIELD-13). A fixed item type shows as a
 * read-only pill at any level. A type change, or a switch into or
 * out of {x}, leaves the type's default and asks first when that clears a value (FIELD-7).
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.19: Declared element types
 * REQ-3.1.3.20: Null is the only empty value
 */

import { Fragment, use, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

import { Button } from '@/components/ui/button'
import { ChevronUpIcon, ChevronDownIcon, TrashIcon, PlusIcon } from '@/components/ui/icon'
import { RowRemovalQuestion, useRowRemovalGuard } from '@/components/shared/child-editors/row-removal-guard'
import { ExpressionToggle } from '@/components/shared/fields/expression-toggle'
import { useScrollOnAppend } from '@/components/shared/variable-bodies/use-scroll-on-append'
import { cn } from '@/lib/utils'
import { openEditorAfterRemoval } from '@/lib/child-editors'
import { getValueColorClass, isNullValue } from '@/lib/variable-format'
import {
  arrayErrorMessages,
  defaultItemText,
  describeCellError,
  entryText,
  formatValue,
  inferRuntimeType,
  inferTypeFromText,
  parseItemValue,
  type ValueType,
} from '@/lib/variable-validation'
import { ScalarTypeSelect, VALUE_TYPES } from '@/components/shared/variable-bodies/scalar-type-select'
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
import type { MapExpressionEditorProps } from '@/components/shared/variable-bodies/map-edit-body'
import { useStableKeys } from '@/components/shared/variable-bodies/use-stable-keys'
import { ListItemNounContext } from '@/components/shared/variable-bodies/list-item-noun-context'
import { numberEntryProps, takesEntryText } from '@/lib/number-entry'
import { wireNumber } from '@/lib/number-rule'

const ARRAY_GRID_CLASS = 'grid items-center gap-2 px-2.5'

interface ListColumns {
  expand: boolean
  /** The Type column's look; none for a host row input with no fixed type. */
  type: TypeLook | null
  expr: boolean
}

/** One track list for the header band and every row: index, value, expand, type, {x}, reorder, delete. */
function listGridColumns({ expand, type, expr }: ListColumns): string {
  const tracks = ['1.5rem', 'minmax(0,1fr)']
  if (expand) tracks.push('1.75rem')
  if (type !== null) tracks.push(typeTrack(type))
  if (expr) tracks.push('2rem')
  tracks.push('3rem', '1.75rem')
  return tracks.join(' ')
}

const NO_ITEMS: unknown[] = []
const NO_INDICES: ReadonlySet<number> = new Set()

const OPPOSITE = { up: 'down', down: 'up' } as const
type Direction = keyof typeof OPPOSITE

/** The one Value Type every item of a typed list takes. */
export type ListItemType = 'string' | 'integer' | 'float'

/** An item of a typed list read as its Value Type: a number in its wire form, text the rule refuses as typed. */
export function typedListItem(text: string, itemType: ListItemType): unknown {
  const parsed = parseItemValue(text, itemType)
  return itemType === 'string' ? parsed : wireNumber(parsed as string, itemType)
}

/** What a host's row input receives for one literal item. */
export interface ArrayItemInputProps {
  value: unknown
  index: number
  /** Writes the item as given; its type is kept. */
  onChange: (value: unknown) => void
  ariaLabel: string
  testId: string
  /** The item Add just appended, so an input that opens a popover can open on it. */
  appended: boolean
}

export interface ArrayEditBodyProps {
  /** A whole null shows no items (the hosts open a null value on its type default). */
  value: unknown[] | null
  types: ValueType[]
  onChange: (value: unknown[], types: ValueType[]) => void
  onValidChange: (valid: boolean) => void
  /** Visual-strip messages (index-prefixed); host renders the strip. */
  onValidation?: (messages: string[]) => void
  /** Every item is text, its pill read-only (a block list setting without typed values). */
  stringValuesOnly?: boolean
  /** Every item takes this Value Type, its pill read-only (VMGR-100, VMGR-104). */
  itemType?: ListItemType
  /** The {x} column: an item held as {x} is edited through this slot and is never checked against its type. */
  expressionEditor?: (props: MapExpressionEditorProps) => ReactNode
  /** The items held as {x}. */
  expressionIndices?: ReadonlySet<number>
  /** Reports the {x} items after a toggle, a removal or a move. */
  onExpressionIndicesChange?: (indices: Set<number>) => void
  /** The host's row input in place of the text box; such a list shows a Type column only for a fixed item type. */
  renderItemInput?: (props: ArrayItemInputProps) => ReactNode
  /** The label each row shows and its controls are named by (default: the 0-based index). */
  positionLabel?: (index: number) => string
  /** The editor a literal text, List or Map item opens from its expand. */
  textEditor?: (props: ItemTextEditorProps) => ReactNode
  /** The nested level of this list: 1 opened from the field, one more per List or Map item it was opened from. */
  level?: number
  /** The value Add appends, a null item takes from its chip and an item takes leaving {x} (default: the type default). */
  newItem?: () => unknown
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

/** Re-base an index set when the item at `removed` is deleted. */
function dropIndex(indices: ReadonlySet<number>, removed: number): Set<number> {
  const next = new Set<number>()
  for (const i of indices) {
    if (i < removed) next.add(i)
    else if (i > removed) next.add(i - 1)
  }
  return next
}

function swapIndex(indices: ReadonlySet<number>, a: number, b: number): Set<number> {
  const next = new Set(indices)
  const hasA = indices.has(a)
  const hasB = indices.has(b)
  next.delete(a)
  next.delete(b)
  if (hasA) next.add(b)
  if (hasB) next.add(a)
  return next
}

/** Where an open item editor sits once two items trade places. */
function swappedIndex(open: number | null, a: number, b: number): number | null {
  if (open === a) return b
  if (open === b) return a
  return open
}

function replaceAt<T>(list: T[], index: number, item: T): T[] {
  return list.map((current, i) => (i === index ? item : current))
}

function findControl(root: HTMLElement | null, testId: string): HTMLElement | null {
  return root?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null
}

/** Focus goes to the item that took the removed one's place (its editor when {x}), else to Add. */
function focusAfterRemoval(root: HTMLElement | null, index: number, count: number, exprs: ReadonlySet<number>) {
  if (index >= count) {
    findControl(root, 'array-add-item')?.focus()
  } else if (exprs.has(index)) {
    findControl(root, `array-expr-value-${index}`)?.querySelector<HTMLElement>('.cm-content')?.focus()
  } else {
    ;(findControl(root, `array-edit-input-${index}`) ?? findControl(root, `array-edit-null-${index}`))?.focus()
  }
}

/** Focus stays on the same arrow at the item's new position, or the other one when that turned off. */
function focusMovedArrow(root: HTMLElement | null, direction: Direction, target: number) {
  const same = findControl(root, `array-move-${direction}-${target}`)
  const arrow = same?.getAttribute('aria-disabled') === 'true' ? OPPOSITE[direction] : direction
  findControl(root, `array-move-${arrow}-${target}`)?.focus()
}

/** Focus goes to the appended item, unless a row input's popover already took it. */
function focusAppended(root: HTMLElement | null, index: number) {
  const active = document.activeElement
  if (active === null || active === document.body || root?.contains(active)) {
    findControl(root, `array-edit-input-${index}`)?.focus()
  }
}

/** The text an {x} item shows in the expression slot. */
function expressionText(element: unknown): string {
  return isNullValue(element) ? '' : formatValue(element)
}

interface ReorderButtonProps {
  testId: string
  label: string
  disabled: boolean
  onAction: () => void
  children: ReactNode
}

function ReorderButton({ testId, label, disabled, onAction, children }: Readonly<ReorderButtonProps>) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={disabled ? undefined : onAction}
      className={cn(
        'p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {children}
    </button>
  )
}

interface ItemCellProps {
  element: unknown
  index: number
  /** `<Noun> <label the row shows>` (`Item 2`, `Argument $2`): every control of the row is named by it. */
  name: string
  type: ValueType
  isExpr: boolean
  appended: boolean
  expressionEditor: ArrayEditBodyProps['expressionEditor']
  renderItemInput: ArrayEditBodyProps['renderItemInput']
  /** The {x} item's full editor is open. */
  editorOpen: boolean
  onEditorOpenChange: (index: number, open: boolean) => void
  onText: (index: number, text: string) => void
  onItem: (index: number, value: unknown) => void
  onNull: (index: number) => void
  onEnterValue: (index: number, type: ValueType) => void
}

/** The item in its row box: the null chip, the host's row input, or the text box, the null button inside. */
function ItemBox({
  element,
  index,
  name,
  type,
  appended,
  renderItemInput,
  onText,
  onItem,
  onNull,
  onEnterValue,
}: Readonly<ItemCellProps>) {
  const isNull = isNullValue(element)
  let control: ReactNode
  if (isNull) {
    control = (
      <NullChip
        label={name}
        testId={`array-edit-null-${index}`}
        onEnterValue={() => onEnterValue(index, type)}
        className={ENTRY_CONTROL_CLASS}
      />
    )
  } else if (renderItemInput) {
    control = renderItemInput({
      value: element,
      index,
      onChange: (next) => onItem(index, next),
      ariaLabel: `${name} value`,
      testId: `array-edit-input-${index}`,
      appended,
    })
  } else {
    const error = describeCellError(entryText(element), type)
    control = (
      <input
        data-testid={`array-edit-input-${index}`}
        aria-label={`${name} value`}
        aria-invalid={error ? 'true' : undefined}
        autoComplete="off"
        spellCheck={false}
        {...numberEntryProps(type)}
        value={entryText(element)}
        onChange={(event) => {
          if (takesEntryText(event.target.value, type)) onText(index, event.target.value)
        }}
        className={cn(ENTRY_CONTROL_CLASS, 'font-mono', error ? 'text-destructive' : getValueColorClass(type))}
      />
    )
  }
  return (
    <EntryBox
      nullButton={{
        label: name,
        pressed: isNull,
        onClick: isNull ? () => onEnterValue(index, type) : () => onNull(index),
        testId: `array-edit-input-${index}-null`,
      }}
    >
      {control}
    </EntryBox>
  )
}

/** The value cell: the {x} slot, or the item in its row box. */
function ItemCell(props: Readonly<ItemCellProps>) {
  const { element, index, name, isExpr, expressionEditor, editorOpen, onEditorOpenChange, onItem } = props
  if (isExpr && expressionEditor) {
    return expressionEditor({
      value: expressionText(element),
      onChange: (text) => onItem(index, text),
      ariaLabel: `${name} value`,
      testId: `array-expr-value-${index}`,
      editorOpen,
      onEditorOpenChange: (open) => onEditorOpenChange(index, open),
    })
  }
  return <ItemBox {...props} />
}

interface ItemTypeCellProps {
  index: number
  name: string
  type: ValueType
  isExpr: boolean
  look: TypeLook
  onType: (index: number, prev: ValueType, next: ValueType) => void
}

/** The item's type: the fixed type's cell, none while {x}, or the picker. */
function ItemTypeCell({ index, name, type, isExpr, look, onType }: Readonly<ItemTypeCellProps>) {
  if (look === 'fixed') return <FixedTypeCell type={type} part={isExpr ? 'blank' : 'pill'} testId={`array-type-${index}`} />
  if (isExpr) return <span />
  return (
    <ScalarTypeSelect
      value={type}
      onChange={(next) => onType(index, type, next)}
      options={VALUE_TYPES}
      testId={`array-type-${index}`}
      label={`${name} type`}
    />
  )
}

/** The Type column: one fixed type, the picker, or none beside a host row input. */
function itemTypeLook(fixedType: ValueType | undefined, hostInput: boolean): TypeLook | null {
  if (fixedType !== undefined) return 'fixed'
  return hostInput ? null : 'picker'
}

/** The Type header: a fixed type's header holds an unseen pill so it is as wide as the rows' pills. */
function TypeHeader({ fixedType }: Readonly<{ fixedType: ValueType | undefined }>) {
  if (fixedType === undefined) return <span className={EDIT_HEADER_LABEL}>Type</span>
  return <FixedTypeCell type={fixedType} part="header" />
}

export function ArrayEditBody({
  value,
  types,
  onChange,
  onValidChange,
  onValidation,
  stringValuesOnly = false,
  itemType,
  expressionEditor,
  expressionIndices,
  onExpressionIndicesChange,
  renderItemInput,
  positionLabel,
  textEditor,
  newItem,
  level = 1,
}: Readonly<ArrayEditBodyProps>) {
  const items = value ?? NO_ITEMS
  // A text-only or typed list fixes every item's type; any other list types each item.
  const fixedType = itemType ?? (stringValuesOnly ? 'string' : undefined)
  const exprs = expressionEditor ? (expressionIndices ?? NO_INDICES) : NO_INDICES
  const [manual, setManual] = useState<Set<number>>(() => new Set(items.keys()))
  // The open entry editor's item, what it opened as, and a count that gives each newly opened editor its own identity.
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [openType, setOpenType] = useState<EntryEditorType>('string')
  const [openSeq, setOpenSeq] = useState(0)
  // The {x} item whose full expression editor is open.
  const [exprOpenIndex, setExprOpenIndex] = useState<number | null>(null)
  const [appendedIndex, setAppendedIndex] = useState<number | null>(null)
  const itemKeys = useStableKeys(items.length)
  const { listRef, markAppended } = useScrollOnAppend(items.length)
  const rootRef = useRef<HTMLDivElement>(null)
  const guard = useRowRemovalGuard()
  const change = useEntryChange(newItem)

  const noun = use(ListItemNounContext)
  const nounLabel = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`
  const shown = (index: number) => positionLabel?.(index) ?? String(index)
  const itemName = (index: number) => `${nounLabel} ${shown(index)}`

  const report = (nextValue: unknown[], nextTypes: ValueType[], nextExprs: ReadonlySet<number>) => {
    // An {x} item is text to its expression; its type applies only once it leaves {x}.
    const checked = nextTypes.map((type, i) => (nextExprs.has(i) ? 'string' : type))
    const messages = arrayErrorMessages(nextValue, checked)
    onValidChange(messages.length === 0)
    onValidation?.(messages)
  }

  const emit = (nextValue: unknown[], nextTypes: ValueType[], nextExprs: ReadonlySet<number> = exprs) => {
    onChange(nextValue, nextTypes)
    report(nextValue, nextTypes, nextExprs)
  }

  const setText = (index: number, text: string) => {
    // An edit keeps a hand-picked type; any other item takes the type its text reads as.
    const pickedType = manual.has(index) ? types[index] : undefined
    const type = fixedType ?? pickedType ?? inferTypeFromText(text)
    const parsed = fixedType === undefined ? parseItemValue(text, type) : typedListItem(text, fixedType)
    emit(items.with(index, parsed), replaceAt(types, index, type))
  }

  const setItem = (index: number, next: unknown) => emit(items.with(index, next), types)

  // The host's own empty entry, else the type default.
  const emptyItem = (type: ValueType) => (newItem ? newItem() : parseItemValue(defaultItemText(type), type))

  // A new type leaves its default, so the item is valid at once.
  const setType = (index: number, prev: ValueType, next: ValueType) =>
    change.requestType(prev, next, items[index], () => {
      setManual((manualSet) => new Set(manualSet).add(index))
      emit(items.with(index, emptyItem(next)), replaceAt(types, index, next))
    })

  const enterValue = (index: number, type: ValueType) => setItem(index, emptyItem(type))

  // Switching never carries a value across (FIELD-7): into {x} empty, out of it the default.
  const toggleExpression = (index: number, type: ValueType, pressed: boolean) =>
    change.requestSwitch(pressed, type, items[index], (clear) => {
      const next = new Set(exprs)
      if (pressed) next.add(index)
      else next.delete(index)
      onExpressionIndicesChange?.(next)
      emit(items.with(index, pressed ? expressionStart(type, clear) : emptyItem(type)), types, next)
    })

  // flushSync lets each handler focus the control the re-render produces.
  const removeAt = (index: number) => {
    const nextItems = items.filter((_, i) => i !== index)
    const nextExprs = dropIndex(exprs, index)
    setManual((prev) => dropIndex(prev, index))
    setOpenIndex((open) => openEditorAfterRemoval(open, index))
    setAppendedIndex(null)
    flushSync(() => {
      emit(nextItems, types.filter((_, i) => i !== index), nextExprs)
      if (exprs.size > 0) onExpressionIndicesChange?.(nextExprs)
    })
    focusAfterRemoval(rootRef.current, index, nextItems.length, nextExprs)
  }

  // An item whose open editor holds unsaved changes asks before it goes.
  const requestRemove = (index: number) => guard.request([itemName(index)], () => removeAt(index))

  const move = (index: number, direction: Direction) => {
    const target = direction === 'up' ? index - 1 : index + 1
    const nextExprs = swapIndex(exprs, index, target)
    setManual((prev) => swapIndex(prev, index, target))
    setOpenIndex((open) => swappedIndex(open, index, target))
    setAppendedIndex(null)
    flushSync(() => {
      emit(swap(items, index, target), swap(types, index, target), nextExprs)
      if (exprs.size > 0) onExpressionIndicesChange?.(nextExprs)
    })
    focusMovedArrow(rootRef.current, direction, target)
  }

  const add = () => {
    const index = items.length
    const added = newItem ? newItem() : ''
    markAppended()
    setAppendedIndex(index)
    flushSync(() => emit([...items, added], [...types, fixedType ?? inferRuntimeType(added)]))
    focusAppended(rootRef.current, index)
  }

  // Opening another item's editor takes the open one away, asking first while it holds changes.
  const openTextEditor = (index: number, type: ValueType) => {
    if (openIndex === index) return
    const open = () => {
      setOpenIndex(index)
      setOpenType(entryEditorType(type))
      setOpenSeq((seq) => seq + 1)
    }
    if (openIndex === null) open()
    else guard.request([itemName(openIndex)], open)
  }

  const typeLook = itemTypeLook(fixedType, renderItemInput !== undefined)
  const exprColumn = expressionEditor !== undefined
  const expandColumn = textEditor !== undefined || exprColumn
  const gridStyle = {
    gridTemplateColumns: listGridColumns({ expand: expandColumn, type: typeLook, expr: exprColumn }),
  }
  const openItem = openIndex !== null && openIndex < items.length ? openIndex : null

  return (
    <div ref={rootRef} data-testid="array-edit-body" className="flex h-full min-h-0 flex-col gap-2">
      <RowRemovalQuestion guard={guard} />
      <EntryChangeQuestions change={change} subject="item" />
      <div ref={listRef} className="min-h-0 grow scroll-pt-9 overflow-auto overscroll-contain rounded-lg border">
        <div
          className={cn(ARRAY_GRID_CLASS, 'sticky top-0 z-10 border-b border-border bg-muted py-1.5')}
          style={gridStyle}
        >
          <span className={cn(EDIT_HEADER_LABEL, 'text-right')}>#</span>
          <span className={EDIT_HEADER_LABEL}>Value</span>
          {expandColumn && <span />}
          {typeLook !== null && <TypeHeader fixedType={fixedType} />}
          {exprColumn && <span />}
          <span />
          <span />
        </div>
        {items.map((element, index) => {
          const type = fixedType ?? types[index] ?? 'string'
          const isExpr = exprs.has(index)
          const name = itemName(index)
          return (
            <div
              key={itemKeys[index]}
              className={cn(ARRAY_GRID_CLASS, 'border-b border-border/60 py-1.5 last:border-b-0')}
              style={gridStyle}
            >
              {/* The controls carry the position in their names. */}
              <span
                data-testid="array-edit-index"
                aria-hidden="true"
                className="text-right font-mono text-xs text-muted-foreground"
              >
                {shown(index)}
              </span>
              <ItemCell
                element={element}
                index={index}
                name={name}
                type={type}
                isExpr={isExpr}
                appended={index === appendedIndex}
                expressionEditor={expressionEditor}
                renderItemInput={renderItemInput}
                editorOpen={exprOpenIndex === index}
                onEditorOpenChange={(at, open) => setExprOpenIndex(open ? at : null)}
                onText={setText}
                onItem={setItem}
                onNull={(at) => setItem(at, null)}
                onEnterValue={enterValue}
              />
              {expandColumn && (
                <EntryExpand
                  testId={`array-expand-${index}`}
                  rowName={name}
                  text={isNullValue(element) ? null : entryText(element)}
                  type={type}
                  isExpr={isExpr}
                  level={level}
                  onExpandEntry={
                    textEditor && renderItemInput === undefined ? () => openTextEditor(index, type) : undefined
                  }
                  onExpandExpression={() => setExprOpenIndex(index)}
                />
              )}
              {typeLook !== null && (
                <ItemTypeCell
                  index={index}
                  name={name}
                  type={type}
                  isExpr={isExpr}
                  look={typeLook}
                  onType={setType}
                />
              )}
              {exprColumn && (
                <ExpressionToggle
                  data-testid={`array-expr-toggle-${index}`}
                  pressed={isExpr}
                  onPressedChange={(next) => toggleExpression(index, type, next)}
                  label={`${name} expression mode`}
                />
              )}
              <div className="flex items-center justify-end">
                <ReorderButton
                  testId={`array-move-up-${index}`}
                  label={`Move ${noun} ${shown(index)} up`}
                  disabled={index === 0}
                  onAction={() => move(index, 'up')}
                >
                  <ChevronUpIcon size={14} />
                </ReorderButton>
                <ReorderButton
                  testId={`array-move-down-${index}`}
                  label={`Move ${noun} ${shown(index)} down`}
                  disabled={index === items.length - 1}
                  onAction={() => move(index, 'down')}
                >
                  <ChevronDownIcon size={14} />
                </ReorderButton>
              </div>
              <button
                type="button"
                data-testid={`array-remove-${index}`}
                aria-label={`Remove ${noun} ${shown(index)}`}
                onClick={() => requestRemove(index)}
                className="justify-self-end rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          )
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="array-add-item"
        className="h-7 shrink-0 self-start px-2 text-xs text-indigo-500 hover:text-indigo-600"
        onClick={add}
      >
        <PlusIcon size={12} className="mr-1" />
        Add {noun}
      </Button>
      {textEditor && openItem !== null && (
        <Fragment key={openSeq}>
          {textEditor({
            label: itemName(openItem),
            type: openType,
            value: entryText(items[openItem]),
            onSave: (text) => setItem(openItem, text),
            onClose: () => setOpenIndex(null),
          })}
        </Fragment>
      )}
    </div>
  )
}
