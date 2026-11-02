/**
 * CatalogPopover - the search over a loaded catalog of a script editor: one row per item whose name holds the
 * query, its detail beside the name and its children under it (SQL-12, OS-13).
 *
 * REQ-3.4.1.6: SQL database operations
 * REQ-3.3.2.6: OpenSearch query editor
 */

import { useState, type ReactNode } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/** One entry of a catalog: a table with its columns as children, or a field with its types as the detail. */
export interface CatalogItem {
  name: string
  detail: string
  children?: CatalogItem[]
}

export interface CatalogPopoverNouns {
  searchLabel: string
  searchPlaceholder: string
  emptyText: string
  noMatchText: string
  /** The popover's accessible name. */
  listLabel: string
}

export interface CatalogPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: readonly CatalogItem[]
  nouns: CatalogPopoverNouns
  onInsert: (name: string) => void
  /** Fired once the popover is gone, so the host can take focus back. */
  onClosed?: () => void
  /** The trigger's tooltip; none when empty. */
  tooltip?: ReactNode
  /** The trigger (the chip button), rendered through PopoverTrigger asChild. */
  children: ReactNode
}

/** The name with the part that matched underlined, as the name writes it. */
function ItemName({ name, needle }: Readonly<{ name: string; needle: string }>) {
  const at = needle === '' ? -1 : name.toLowerCase().indexOf(needle)
  if (at < 0) return name
  return (
    <>
      {name.slice(0, at)}
      <span data-testid="tables-popover-match" className="underline underline-offset-2">
        {name.slice(at, at + needle.length)}
      </span>
      {name.slice(at + needle.length)}
    </>
  )
}

/** Owns the query, so closing the popover clears it. */
function CatalogSearch({
  items,
  nouns,
  onPick,
}: Readonly<{ items: readonly CatalogItem[]; nouns: CatalogPopoverNouns; onPick: (name: string) => void }>) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  // Only the name filters, so the underline always shows why a row is listed.
  const kept = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.name.toLowerCase().includes(needle))

  return (
    <Command shouldFilter={false}>
      <CommandInput
        aria-label={nouns.searchLabel}
        placeholder={nouns.searchPlaceholder}
        spellCheck={false}
        autoComplete="off"
        value={query}
        onValueChange={setQuery}
        autoFocus
      />
      <CommandList>
        <CommandEmpty>{items.length === 0 ? nouns.emptyText : nouns.noMatchText}</CommandEmpty>
        {/* Keyed by position: two schemas may hold tables of the same name. */}
        {kept.map(({ item, index }) => (
          <CommandItem
            key={index}
            value={String(index)}
            onSelect={() => onPick(item.name)}
            data-testid={`tables-popover-item-${item.name}`}
            className="flex-col items-start gap-0.5"
          >
            <span className="flex w-full items-baseline gap-2">
              <span className="min-w-0 flex-1 break-all font-mono text-[13px] leading-[18px]" translate="no">
                <ItemName name={item.name} needle={needle} />
              </span>
              {item.detail === '' ? null : (
                <span
                  data-testid={`tables-popover-detail-${item.name}`}
                  className="shrink-0 font-mono text-[11px] leading-4 text-muted-foreground"
                  translate="no"
                >
                  {item.detail}
                </span>
              )}
            </span>
            {item.children ? (
              <span
                data-testid={`tables-popover-columns-${item.name}`}
                className="w-full truncate whitespace-pre font-mono text-[11px] leading-4 text-muted-foreground"
                translate="no"
              >
                {item.children.map((child) => child.name).join('  ')}
              </span>
            ) : null}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  )
}

export function CatalogPopover({
  open,
  onOpenChange,
  items,
  nouns,
  onInsert,
  onClosed,
  tooltip,
  children,
}: Readonly<CatalogPopoverProps>) {
  const handlePick = (name: string) => {
    onInsert(name)
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <ConditionalTooltip content={tooltip} wide>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      </ConditionalTooltip>
      <PopoverContent
        data-testid="tables-popover"
        aria-label={nouns.listLabel}
        side="top"
        align="start"
        // The host decides where focus lands: a pick continues typing in the editor.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onClosed?.()
        }}
        className="w-[22rem] max-w-[90vw] p-0"
      >
        <CatalogSearch items={items} nouns={nouns} onPick={handlePick} />
      </PopoverContent>
    </Popover>
  )
}
