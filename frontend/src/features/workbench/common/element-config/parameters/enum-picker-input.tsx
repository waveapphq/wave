/**
 * Searchable enum picker - the second rendering path of the shared enum
 * parameter (K8SREAD-5). A select-styled trigger opens a popover holding a
 * search box over the declared options, optionally partitioned by enumGroups.
 *
 * REQ-3.1.1.5: block parameter configuration forms
 */

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn, safeStringify } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  ENUM_GROUP_HEADING_CMDK_CLASSES,
  enumLabelOf,
  enumOptionBody,
} from './parameter-value-inputs'
import { parameterLabel, type Parameter } from './parameter-table-types'

// Mirrors SelectTrigger so the two enum paths read as one control (K8SREAD-5).
const TRIGGER_CLASSES =
  'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input ' +
  'bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus-visible:outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-ring [&>span]:line-clamp-1'

type Section = { heading?: string; values: ReadonlyArray<string | number> }

/** Plain case-insensitive substring over the label or the sublabel, checked separately. */
function matchesQuery(parameter: Parameter, opt: string | number, needle: string): boolean {
  if (!needle) return true
  if (enumLabelOf(parameter, opt).toLowerCase().includes(needle)) return true
  return parameter.enumSublabels?.[String(opt)]?.toLowerCase().includes(needle) ?? false
}

export function EnumPickerInput({
  parameter,
  effectiveValue,
  onChange,
  showRequiredError,
}: Readonly<{
  parameter: Parameter
  effectiveValue: unknown
  onChange: (value: unknown) => void
  showRequiredError: boolean
}>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = safeStringify(effectiveValue)
  const name = parameter.name
  const label = parameterLabel(parameter)
  const needle = query.trim().toLowerCase()
  const sections: Section[] = parameter.enumGroups ?? [{ values: parameter.enumValues! }]

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }

  const handleSelect = (opt: string | number) => {
    onChange(opt)
    handleOpenChange(false)
  }

  // A defaultValue matching no item leaves cmdk with no cursor at all.
  const cursorStart = parameter.enumValues!.some((opt) => String(opt) === selected)
    ? selected
    : undefined

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        aria-invalid={showRequiredError}
        data-testid={`enum-picker-trigger-${name}`}
        className={cn(
          TRIGGER_CLASSES,
          !selected && 'text-muted-foreground',
          showRequiredError && 'border-destructive',
        )}
      >
        <span translate="no">{selected ? enumLabelOf(parameter, selected) : 'Select…'}</span>
        <ChevronDown className="h-4 w-4 opacity-50" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        data-testid={`enum-picker-content-${name}`}
      >
        <Command shouldFilter={false} defaultValue={cursorStart}>
          <CommandInput
            placeholder="Search…"
            aria-label={`Search ${label}`}
            value={query}
            onValueChange={setQuery}
            data-testid={`enum-picker-search-${name}`}
            autoFocus
          />
          <CommandList data-testid={`enum-picker-list-${name}`}>
            <CommandEmpty data-testid={`enum-picker-empty-${name}`}>No matching options</CommandEmpty>
            {sections.map((section) => {
              const visible = section.values.filter((opt) => matchesQuery(parameter, opt, needle))
              if (visible.length === 0) return null
              return (
                <CommandGroup
                  key={section.heading ?? ''}
                  heading={section.heading}
                  className={
                    section.heading === undefined
                      ? undefined
                      : ENUM_GROUP_HEADING_CMDK_CLASSES
                  }
                  data-testid={
                    section.heading === undefined
                      ? undefined
                      : `enum-picker-group-${name}-${section.heading}`
                  }
                >
                  {visible.map((opt) => {
                    const chosen = String(opt) === selected
                    return (
                      <CommandItem
                        key={opt}
                        value={String(opt)}
                        chosen={chosen}
                        onSelect={() => handleSelect(opt)}
                        data-testid={`enum-picker-item-${name}-${opt}`}
                      >
                        {enumOptionBody(parameter, opt)}
                        {chosen && (
                          <Check
                            className="ml-auto h-4 w-4 text-current"
                            data-testid={`enum-picker-check-${name}`}
                          />
                        )}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
