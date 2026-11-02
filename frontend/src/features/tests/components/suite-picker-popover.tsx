/**
 * SuitePickerPopover - Shared popover for selecting a suite.
 *
 * Used by both TestsBulkActions and TestsRowActions for
 * "Add to Suite" / "Remove from Suite" actions.
 */

import { useState, useMemo } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@/components/ui/command'
import { Icon } from '@/components/ui/icon'
import type { FolderPlus } from 'lucide-react'

export interface SuitePickerSuite {
  id: string
  name: string
}

export interface SuitePickerPopoverProps {
  label: string
  icon: typeof FolderPlus
  testId: string
  suites: SuitePickerSuite[]
  onSelect: (suiteId: string) => void
  disabled?: boolean
}

export function SuitePickerPopover({
  label,
  icon,
  testId,
  suites,
  onSelect,
  disabled = false,
}: Readonly<SuitePickerPopoverProps>) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filteredSuites = useMemo(() => {
    if (!search.trim()) return suites
    const s = search.toLowerCase()
    return suites.filter(suite => suite.name.toLowerCase().includes(s))
  }, [suites, search])

  const handleSelect = (suiteId: string) => {
    if (!disabled) {
      setPopoverOpen(false)
      onSelect(suiteId)
    }
  }

  const disabledClass = disabled ? 'text-muted' : ''

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid={testId}
          className={`dropdown-item flex items-center w-full px-3 py-2 text-sm cursor-pointer outline-none ${disabledClass} ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-subtle focus:bg-subtle'}`}
        >
          <Icon icon={icon} size="sm" className="mr-2" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search suites…"
            value={search}
            onValueChange={setSearch}
            data-testid={`${testId}-search-input`}
          />
          <CommandList>
            <CommandEmpty>No suites found.</CommandEmpty>
            {filteredSuites.map((suite) => (
              <CommandItem
                key={suite.id}
                value={suite.name}
                onSelect={() => handleSelect(suite.id)}
              >
                {suite.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
