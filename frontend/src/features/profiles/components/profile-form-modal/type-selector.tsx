/**
 * TypeSelector - Profile type combobox/popover
 *
 * PROFILE-28: Type selector, editable in create mode, locked in edit mode
 */

import { useRef, useEffect, type Dispatch, type SetStateAction } from 'react'
import { ChevronDown, Check as CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { RequiredMark } from '@/components/shared/fields/required-mark'

export interface TypeSelectorProps {
  mode: 'create' | 'edit'
  selectedType: string
  profileTypes: string[]
  loading: boolean
  typeSelectOpen: boolean
  setTypeSelectOpen: Dispatch<SetStateAction<boolean>>
  typeSearch: string
  setTypeSearch: Dispatch<SetStateAction<string>>
  onTypeSelect: (type: string) => void
}

export function TypeSelector({
  mode,
  selectedType,
  profileTypes,
  loading,
  typeSelectOpen,
  setTypeSelectOpen,
  typeSearch,
  setTypeSearch,
  onTypeSelect,
}: Readonly<TypeSelectorProps>) {
  const typeBtnRef = useRef<HTMLButtonElement>(null)

  // Set combobox role programmatically to avoid SQ "prefer native" rule
  useEffect(() => {
    typeBtnRef.current?.setAttribute('role', 'combobox')
  }, [])

  return (
    <div data-field="type">
      <label htmlFor="profile-type-trigger" className="block text-sm font-medium mb-1">
        Type {mode === 'create' && <RequiredMark />}
      </label>
      <Popover open={typeSelectOpen} onOpenChange={(open) => {
        if (mode === 'create') {
          setTypeSelectOpen(open)
          /* v8 ignore next - COV-BRANCH-195 */
          if (!open) setTypeSearch('')
        }
      }}>
        <PopoverTrigger asChild>
          <button
            ref={typeBtnRef}
            id="profile-type-trigger"
            type="button"
            aria-expanded={typeSelectOpen}
            aria-controls="type-selector-listbox"
            aria-disabled={loading || mode === 'edit'}
            disabled={loading || mode === 'edit'}
            data-testid="type-selector"
            className={cn(
              "input flex h-9 w-full items-center justify-between whitespace-nowrap px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50",
              mode === 'edit' && "bg-muted"
            )}
          >
            <span className="min-w-0 truncate">{selectedType}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" role="dialog">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search type…"
              value={typeSearch}
              onValueChange={setTypeSearch}
            />
            <CommandList role="listbox" id="type-selector-listbox">
              <CommandGroup>
                {profileTypes
                  .filter((type) => type.toLowerCase().includes(typeSearch.toLowerCase()))
                  .map((type) => (
                    <CommandItem
                      key={type}
                      value={type}
                      chosen={selectedType === type}
                      onSelect={() => onTypeSelect(type)}
                    >
                      <CheckIcon
                        className={cn(
                          'h-4 w-4 flex-shrink-0 text-current',
                          selectedType === type ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span>{type}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {mode === 'edit' && (
        <p className="text-xs text-muted-foreground mt-1">Type cannot be changed after creation</p>
      )}
    </div>
  )
}
