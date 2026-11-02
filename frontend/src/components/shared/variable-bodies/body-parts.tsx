/**
 * Shared fragments for the value bodies: the common props contract, the
 * 500-entry Visual cap, the muted overflow line, the centered empty-value line,
 * the inline null text, the null chip that leaves null, the one ∅ button, the
 * one row box of the list, map and table editors, and their entry expand.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.19: Declared element types
 * REQ-3.1.3.20: Null is the only empty value (VMGR-93, VMGR-94)
 */

import { use, useId, type ReactNode } from 'react'
import { Maximize2 } from 'lucide-react'

import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { SheetFrozenContext } from '@/components/shared/sheet-layer'
import { cn } from '@/lib/utils'
import { NULL_LOOK_CLASS, PRESSED_LOOK_CLASS } from '@/lib/variable-format'
import { ScalarTypePill } from '@/components/shared/variable-bodies/scalar-type-select'
import {
  opensNestedEditor,
  type ElementTypes,
  type NestedType,
  type ValueType,
} from '@/lib/variable-validation'

export interface ComplexBodyProps {
  value: unknown
  variant: 'current' | 'initial'
  /** Declared array item / map value types, rendered over the stored shape (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

export const VISUAL_CAP = 500

/** Quiet uppercase label for the array / map edit grids' header band. */
export const EDIT_HEADER_LABEL =
  'text-[10px] font-medium uppercase tracking-wider text-muted-foreground'

const NULL_LABEL = 'null'

export function BodyOverflowLine({ hiddenCount }: Readonly<{ hiddenCount: number }>) {
  return (
    <div
      data-testid="body-overflow-line"
      className="px-1 py-2 font-mono text-xs text-muted-foreground"
    >
      + {hiddenCount} more - switch to Code view
    </div>
  )
}

/** The text `null` in the one null look, inheriting its host's font size. */
export function NullText() {
  return (
    <span translate="no" className={NULL_LOOK_CLASS}>
      {NULL_LABEL}
    </span>
  )
}

export function BodyEmptyLine({ label }: Readonly<{ label: string }>) {
  // Fills a block or flex-column host so the line stays centered both ways at any size.
  return (
    <div className="flex h-full w-full flex-1 items-center justify-center text-xs">
      {label === NULL_LABEL ? (
        <NullText />
      ) : (
        <span className="font-mono italic text-muted-foreground">{label}</span>
      )}
    </div>
  )
}

interface NullChipProps {
  /** Accessible name stem; the chip reads `<label> (null)`. */
  label: string
  onEnterValue: () => void
  testId?: string
  /** Host look, such as the control of a row box. */
  className?: string
}

/** A stored null in an editable cell; clicking it enters the type default. */
export function NullChip({ label, onEnterValue, testId, className }: Readonly<NullChipProps>) {
  return (
    <ConditionalTooltip content="Click to enter a value">
      <button
        type="button"
        translate="no"
        data-testid={testId}
        // A field with no name yet reads the visible text alone.
        aria-label={label.trim() === '' ? undefined : `${label} (null)`}
        onClick={() => onEnterValue()}
        className={cn(
          'w-full rounded-sm border bg-background px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500',
          NULL_LOOK_CLASS,
          className,
        )}
      >
        {NULL_LABEL}
      </button>
    </ConditionalTooltip>
  )
}

interface NullButtonProps {
  /** Accessible name stem; the button reads `Set <label> to null`. */
  label: string
  pressed: boolean
  onClick: () => void
  testId?: string
}

/** The one ∅ (FIELD-5): sets a value to null, pressed while the value is null. */
export function NullButton({ label, pressed, onClick, testId }: Readonly<NullButtonProps>) {
  return (
    <ConditionalTooltip content="Set to null">
      <button
        type="button"
        translate="no"
        data-testid={testId}
        aria-label={`Set ${label} to null`}
        aria-pressed={pressed}
        onClick={onClick}
        className={cn(
          'shrink-0 rounded-sm px-1 text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500',
          'text-muted-foreground hover:text-foreground',
          PRESSED_LOOK_CLASS,
        )}
      >
        {'∅'}
      </button>
    </ConditionalTooltip>
  )
}

/** A list or map editor opens at most this many levels deep, the one opened from the field counted as 1. */
export const MAX_NESTED_LEVELS = 10

const NESTED_LIMIT_NOTE = `Up to ${MAX_NESTED_LEVELS} nested levels`

/** What an entry opens from its expand: its text, or its List or Map one level deeper. */
export type EntryEditorType = 'string' | NestedType

/** The editor an entry of this type opens. */
export function entryEditorType(type: ValueType): EntryEditorType {
  return type === 'array' || type === 'map' ? type : 'string'
}

/** What a list or map editor hands its host's entry editor while a text, List or Map entry is expanded. */
export interface ItemTextEditorProps {
  /** The entry's label as its row names it; an open editor's unsaved changes are matched by it. */
  label: string
  /** What the entry opened as; it stays while the editor is open. */
  type: EntryEditorType
  /** The entry's text: a List or Map entry's is its JSON. */
  value: string
  onSave: (text: string) => void
  onClose: () => void
}

const ENTRY_BOX_CLASS = cn(
  'h-8 overflow-hidden bg-background shadow-none dark:bg-background',
  // Rings while the entry's own control has keyboard focus, never for the ∅ beside it.
  'has-[:focus-visible:not([aria-pressed])]:ring-1 has-[:focus-visible:not([aria-pressed])]:ring-ring',
  'has-[[aria-invalid=true]]:border-destructive',
  // A control whose popover is open keeps the box in its focus look.
  'has-[[data-state=open]]:border-primary has-[[data-state=open]]:ring-1 has-[[data-state=open]]:ring-primary',
)

/** A control inside the row box: flat and clear, it fills the box, which draws the border and the focus ring. */
export const ENTRY_CONTROL_CLASS =
  'h-full w-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 py-0 text-sm shadow-none outline-none focus-visible:outline-none focus-visible:ring-0'

// The {x} entry box is the same 32px row box: 4px around a 22px line inside its 1px border.
export const ENTRY_SOURCE_BOX_CLASS = 'w-full min-w-0 [&_.cm-content]:!py-1 [&_.cm-scroller]:!leading-[22px]'

interface EntryBoxProps {
  children: ReactNode
  /** Shown inside the box at its right end, before the ∅. */
  adornment?: ReactNode
  /** The entry's ∅ inside the box at its right end (FIELD-13), pressed while the entry is null. */
  nullButton?: NullButtonProps
}

/** The one row box of the list, map and table editors (FIELD-1): 32px, its ∅ inside at the right end. */
export function EntryBox({ children, adornment, nullButton }: Readonly<EntryBoxProps>) {
  return (
    <InputGroup className={ENTRY_BOX_CLASS}>
      {children}
      {(Boolean(adornment) || nullButton !== undefined) && (
        <InputGroupAddon align="inline-end" className="py-0">
          {adornment}
          {nullButton && <NullButton {...nullButton} />}
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

const EXPAND_LABEL = 'Open editor'

const EXPAND_CLASS = cn(
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500',
)

const EXPAND_LIVE_CLASS = 'hover:bg-muted hover:text-foreground'

interface ItemExpandButtonProps {
  onClick: () => void
  testId: string
  /** The row the entry sits on (`Item 2`, `Entry 0`): the button's name says which entry it opens. */
  rowName: string
  /** Drawn off: the entry has nothing its editor can open on now. */
  disabled?: boolean
  /** Why it is off, shown as its tooltip. */
  disabledNote?: string
}

/** The expand of an entry in the list and map editors: opens the entry's own editor. */
function ItemExpandButton({ onClick, testId, rowName, disabled = false, disabledNote }: Readonly<ItemExpandButtonProps>) {
  const frozen = use(SheetFrozenContext) === true
  const linkId = useId()
  const name = `${EXPAND_LABEL} for ${rowName}`
  const glyph = <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
  if (disabled) {
    const off = (
      <button
        type="button"
        data-testid={testId}
        aria-label={name}
        disabled
        className={cn(EXPAND_CLASS, 'cursor-not-allowed opacity-50')}
      >
        {glyph}
      </button>
    )
    // A disabled button takes no hover, so its reason sits on a wrapper.
    return disabledNote === undefined ? (
      off
    ) : (
      <ConditionalTooltip content={disabledNote} disabled>
        <span className="inline-flex">{off}</span>
      </ConditionalTooltip>
    )
  }
  if (frozen) {
    // A frozen sheet disables every button, so a link opens the entry's editor read-only (FIELD-1).
    return (
      <ConditionalTooltip content={EXPAND_LABEL}>
        <a
          id={linkId}
          href={`#${linkId}`}
          data-testid={testId}
          aria-label={name}
          className={cn(EXPAND_CLASS, EXPAND_LIVE_CLASS)}
          onClick={(event) => {
            event.preventDefault()
            onClick()
          }}
        >
          {glyph}
        </a>
      </ConditionalTooltip>
    )
  }
  return (
    <ConditionalTooltip content={EXPAND_LABEL}>
      <button
        type="button"
        data-testid={testId}
        aria-label={name}
        onClick={onClick}
        className={cn(EXPAND_CLASS, EXPAND_LIVE_CLASS)}
      >
        {glyph}
      </button>
    </ConditionalTooltip>
  )
}

interface EntryExpandProps {
  testId: string
  /** The row's name, so the expand says which entry it opens. */
  rowName: string
  /** The entry's text; null while the entry is null. */
  text: string | null
  type: ValueType
  isExpr: boolean
  /** The nested level of the editor the entry sits in. */
  level: number
  /** Opens the entry's own editor; absent, the host gives none or draws the entry through its own input. */
  onExpandEntry?: () => void
  onExpandExpression: () => void
}

/** The expand track of a list or map entry: {x} opens its expression editor, text the string editor, a List or Map its own editor one level deeper. */
export function EntryExpand({
  testId,
  rowName,
  text,
  type,
  isExpr,
  level,
  onExpandEntry,
  onExpandExpression,
}: Readonly<EntryExpandProps>) {
  if (isExpr) return <ItemExpandButton testId={testId} rowName={rowName} onClick={onExpandExpression} />
  if (onExpandEntry === undefined) return <span />
  // A null entry keeps its expand, drawn off, so the column never gaps.
  if (type === 'string') {
    return <ItemExpandButton testId={testId} rowName={rowName} onClick={onExpandEntry} disabled={text === null} />
  }
  if (type !== 'array' && type !== 'map') return <span />
  const atLimit = level >= MAX_NESTED_LEVELS
  return (
    <ItemExpandButton
      testId={testId}
      rowName={rowName}
      onClick={onExpandEntry}
      disabled={atLimit || text === null || !opensNestedEditor(text, type)}
      disabledNote={atLimit ? NESTED_LIMIT_NOTE : undefined}
    />
  )
}

/** How an editor draws its Type column: a picker per entry, or one fixed type for all as a read-only pill. */
export type TypeLook = 'picker' | 'fixed'

/** The Type track: the picker's width, or as wide as a fixed type's pill so {x} sits one gap after it. */
export function typeTrack(look: TypeLook): string {
  return look === 'fixed' ? 'max-content' : '5rem'
}

/** An unseen pill that gives a fixed type's cell the pill's width. */
function PillSizer({ type, className }: Readonly<{ type: ValueType; className?: string }>) {
  return (
    <span aria-hidden="true" className={cn('invisible', className)}>
      <ScalarTypePill value={type} />
    </span>
  )
}

interface FixedTypeCellProps {
  type: ValueType
  /** The pill, the header label over an unseen pill, or an unseen pill alone (an {x} or generated row). */
  part: 'pill' | 'header' | 'blank'
  testId?: string
}

/** A cell of a fixed type's Type track: each holds the pill, seen or not, so the header and every row share one width. */
export function FixedTypeCell({ type, part, testId }: Readonly<FixedTypeCellProps>) {
  if (part === 'pill') return <ScalarTypePill value={type} testId={testId} />
  if (part === 'blank') return <PillSizer type={type} />
  return (
    <span className="grid">
      <PillSizer type={type} className="col-start-1 row-start-1" />
      <span className={cn(EDIT_HEADER_LABEL, 'col-start-1 row-start-1 self-center')}>Type</span>
    </span>
  )
}
