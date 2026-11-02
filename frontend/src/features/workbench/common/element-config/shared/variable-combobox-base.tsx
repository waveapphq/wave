/**
 * VariableComboboxBase - Shared base for variable combobox components.
 *
 * Provides the common Popover + Input + CommandList structure used by both
 * OutputBindingCombobox (output parameters) and VariableRefCombobox (input
 * variable-reference parameters). Callers supply pre-filtered variables
 * and optional header/footer slots.
 */

import { useState, useRef, useMemo, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'
import { TextField } from '@/components/shared/fields/text-field'
import { MAX_VARIABLE_NAME_LENGTH } from '@/lib/field-constraints'
import { TYPE_PILL_CLASS, getTypePillColorClass } from '@/lib/variable-format'
import { cn } from '@/lib/utils'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export interface ComboboxVariable {
  name: string
  type: string
  /** Where the variable comes from. A label for the reader and the origin the
   *  Variable Setter's read-only guards key off - never on its own a badge. */
  source?: string
  /** A node output writes this variable. The only thing the OUT badge means. */
  isOutputBinding?: boolean
}

/** The names a text box offers in a list under it, with the lines the list shows around them. */
export interface SuggestionList {
  items: ComboboxVariable[]
  /** The line a list with no row shows; null shows none. */
  emptyText: string | null
  footer?: ReactNode
  /** The list already answers the typed text (a pattern's matches), so typing never narrows it. */
  unfiltered?: boolean
}

/** The rows a typed text shows: all while it is empty or names one (or a known name), else those holding it. */
export function matchingItems(
  items: ComboboxVariable[],
  query: string,
  unfiltered = false,
  knownNames?: ReadonlySet<string>,
): ComboboxVariable[] {
  if (unfiltered || !query) return items
  if (items.some((v) => v.name === query)) return items
  if (knownNames?.has(query)) return items
  const lower = query.toLowerCase()
  return items.filter((v) => v.name.toLowerCase().includes(lower))
}

/** What makes a text box the combobox of its list: a click or Ctrl+Space opens it, Escape shuts an open one. */
export function comboboxBoxProps(listOpen: boolean, setOpen: (open: boolean) => void) {
  return {
    role: 'combobox',
    'aria-expanded': listOpen,
    'aria-autocomplete': 'list' as const,
    onClick: () => setOpen(true),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === ' ' && e.ctrlKey) {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape' && listOpen) {
        e.preventDefault()
        setOpen(false)
      }
    },
  }
}

/** The list under a text box: its rows, its empty line and footer; a pick hands the row's name back. */
export function SuggestionPopover({
  open,
  onOpenChange,
  boxRef,
  items,
  header,
  footer,
  emptyText,
  onPick,
  children,
}: Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The text box: a press on it keeps the list open, and a pick gives it focus back. */
  boxRef: RefObject<HTMLElement | null>
  items: readonly ComboboxVariable[]
  header?: ReactNode
  footer?: ReactNode
  emptyText: string | null
  onPick: (name: string) => void
  /** The one element the list hangs under. */
  children: ReactElement
}>) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        className="p-0"
        style={{
          width: 'var(--radix-popover-trigger-width)',
          minWidth: '320px',
        }}
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          // Don't close when the user clicks back on the anchor input.
          /* v8 ignore next - COV-BRANCH-003 */
          if (e.target === boxRef.current || boxRef.current?.contains(e.target as Node)) {
            e.preventDefault()
          }
        }}
      >
        <Command>
          <CommandList>
            {emptyText !== null && <CommandEmpty>{emptyText}</CommandEmpty>}
            {header}
            {items.map((v) => (
              <CommandItem
                key={v.name}
                value={v.name}
                onSelect={() => {
                  onPick(v.name)
                  onOpenChange(false)
                  boxRef.current?.focus()
                }}
                className="flex items-center gap-2"
              >
                <ConditionalTooltip content={v.name} wide>
                  <span translate="no" className="font-mono text-sm flex-1 min-w-0 truncate">
                    {v.name}
                  </span>
                </ConditionalTooltip>
                <span
                  className={cn(TYPE_PILL_CLASS, getTypePillColorClass(v.type))}
                >
                  {v.type}
                </span>
                {v.isOutputBinding && (
                  <Badge variant="success" className="text-[10px] px-1 py-0 h-4 shrink-0">
                    OUT
                  </Badge>
                )}
              </CommandItem>
            ))}
          </CommandList>
          {footer}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function VariableComboboxBase({
  value,
  onChange,
  variables,
  placeholder = 'variable_name',
  header,
  footer,
  allVariableNames,
  existingOnly,
  invalid,
  suppressPopover,
  maxLength,
  unfiltered,
  emptyText = 'No matching variables',
  inputClassName,
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: Readonly<{
  value: string
  onChange: (value: string) => void
  variables: ComboboxVariable[]
  placeholder?: string
  header?: ReactNode
  footer?: ReactNode
  'data-testid'?: string
  /** When provided, treats `value` as a binding pointer: if value names any
   * known variable (compatible or not), the dropdown shows the full
   * `variables` list rather than substring-filtering it. Wrong-type bindings
   * still resolve to a known name, so the user sees all compatible options
   * to switch to. */
  allVariableNames?: ReadonlySet<string>
  /** Reject free-text: typing only filters the dropdown; the value changes
   * only when an option is picked, so it can never name a non-existent variable. */
  existingOnly?: boolean
  /** Outline the anchor: nothing is bound yet and the owner cannot save. */
  invalid?: boolean
  /** Keep the list shut while the typed name is rejected, so the caller's
   * inline error under the input stays visible. */
  suppressPopover?: boolean
  /** Free-text cap; null lifts it. Absent: the variable name cap, none for existingOnly. */
  maxLength?: number | null
  /** The list already answers the typed text (a pattern's matches), so typing never narrows it. */
  unfiltered?: boolean
  /** The line a list with no row shows; null shows none. */
  emptyText?: string | null
  /** Classes the text box adds to its mono base, for a caller whose row reads differently. */
  inputClassName?: string
  'aria-describedby'?: string
  'aria-label'?: string
}>) {
  const [open, setOpen] = useState(false)
  // In existingOnly mode, typed text is a transient filter (never the value);
  // null means "show the bound value".
  const [search, setSearch] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const query = existingOnly ? (search ?? value) : value
  // existingOnly text is a transient filter, never a name, so it takes no cap
  const defaultCap = existingOnly ? undefined : MAX_VARIABLE_NAME_LENGTH
  const cap = maxLength === undefined ? defaultCap : (maxLength ?? undefined)
  const listOpen = open && !suppressPopover

  const filtered = useMemo(
    () => matchingItems(variables, query, unfiltered, allVariableNames),
    [variables, query, allVariableNames, unfiltered],
  )

  return (
    <SuggestionPopover
      open={listOpen}
      onOpenChange={(next) => {
        setOpen(next)
        // Discard an unmatched free-text filter when the dropdown closes.
        if (!next) setSearch(null)
      }}
      boxRef={inputRef}
      items={filtered}
      header={header}
      footer={footer}
      emptyText={emptyText}
      onPick={onChange}
    >
      <div>
        <TextField
          ref={inputRef}
          {...comboboxBoxProps(listOpen, setOpen)}
          data-testid={dataTestId}
          aria-invalid={invalid}
          aria-describedby={ariaDescribedBy}
          aria-label={ariaLabel}
          value={query}
          onChange={(val) => {
            if (existingOnly) {
              setSearch(val)
            } else {
              onChange(val)
            }
            /* v8 ignore next - COV-BRANCH-002 */
            if (!open) setOpen(true)
          }}
          placeholder={placeholder}
          maxLength={cap}
          className={cn('font-mono', inputClassName)}
        />
      </div>
    </SuggestionPopover>
  )
}
