/**
 * EntityFilters - Shared filter bar for entity list pages.
 *
 * Provides: search input with debounce, configurable filter popovers
 * (multi-select or single-select), tags multi-select, columns toggle,
 * clear filters, and optional actions slot.
 *
 * Used by: SuitesFilters, RegressionsFilters, TestsFilters, ProfilesFilters
 */

/* v8 ignore next - COV-V8-006: V8 coverage merge non-deterministically drops this import across forks pool */
import { useState, useCallback, useRef, type ReactNode } from 'react'
import { pluralize } from '@/lib/pluralize'
import { SearchInput } from '@/components/ui/search-input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@/components/ui/command'
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@/components/ui/dropdown'
import { Icon, ChevronDownIcon, CheckIcon } from '@/components/ui/icon'
import { CheckboxIndicator } from '@/components/ui/checkbox'

export interface Column {
  id: string
  label: string
  visible: boolean
}

/** An option in a filter popover. */
export interface FilterOption {
  value: string
  label: string
}

/**
 * Describes a filter popover field with its current selection state.
 *
 * - `mode: 'multi'` - checkbox-style multi-select, popover stays open
 * - `mode: 'single'` - radio-style single-select, closes on pick
 */
export interface FilterField {
  /** Unique key matching the filter state property */
  key: string
  /** Button label when nothing is selected */
  placeholder: string
  /** Pluralized label for count display (e.g. "statuses", "suites", "tags") */
  countLabel: string
  /** Singular form for count === 1 (e.g. "status", "suite") */
  countLabelSingular?: string
  /** data-testid for the trigger button */
  testId: string
  /** aria-label for accessibility */
  ariaLabel: string
  /** Tailwind width class for the trigger button */
  buttonWidth: string
  /** Search placeholder inside popover */
  searchPlaceholder: string
  /** Empty state message when search yields no results */
  emptyMessage: string
  /** The available options */
  options: FilterOption[]
  /** Selection mode */
  mode: 'multi' | 'single'
  /** Current selected values (multi-select) */
  selectedValues?: string[]
  /** Current selected value (single-select) */
  selectedValue?: string
  /** Optional message when source options array is empty */
  emptySourceMessage?: string
}

export interface EntityFiltersProps {
  /** Search input configuration */
  search: {
    id: string
    name: string
    placeholder: string
    ariaLabel: string
    defaultValue: string
  }
  /** Filter fields to render as popovers (between search and tags) */
  fields: FilterField[]
  /** Tags filter options (omit or pass empty to hide the tags filter) */
  allTags?: string[]
  /** Currently selected tag values */
  selectedTags?: string[]
  /** Column visibility configuration */
  columns: Column[]
  /** Whether any filters are active (controls Clear Filters visibility) */
  hasActiveFilters: boolean
  /** Global disabled state */
  disabled?: boolean
  /** Optional actions slot (e.g. Mass Action button) */
  actions?: ReactNode
  /** Optional additional filter pills rendered after the standard fields (e.g. date range). */
  extraFields?: ReactNode
  /** Called when search value changes (debounced) */
  onSearchChange: (value: string) => void
  /** Called when a filter field value changes */
  onFieldChange: (key: string, value: string | string[]) => void
  /** Called when tag selection changes */
  onTagsChange?: (tags: string[]) => void
  /** Called when column visibility changes */
  onColumnToggle: (columnId: string, visible: boolean) => void
  /** Called when Clear Filters is clicked */
  onClearAll: () => void
}

const DEBOUNCE_MS = 300

export function EntityFilters({
  search,
  fields,
  allTags,
  selectedTags = [],
  columns,
  hasActiveFilters,
  disabled = false,
  actions,
  extraFields,
  onSearchChange,
  onFieldChange,
  onTagsChange,
  onColumnToggle,
  onClearAll,
}: Readonly<EntityFiltersProps>) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagSearch, setTagSearch] = useState('')

  // Tags filter is shown when allTags is defined (even if empty, shown as disabled).
  // Only hidden when the entity has no concept of tags (executions).
  const showTags = allTags !== undefined
  const tagList = allTags ?? []

  const handleSearchClear = useCallback(() => {
    if (searchInputRef.current) {
      searchInputRef.current.value = ''
    }
    onSearchChange('')
  }, [onSearchChange])

  const handleClearAll = useCallback(() => {
    if (searchInputRef.current) {
      searchInputRef.current.value = ''
    }
    onClearAll()
  }, [onClearAll])

  const handleTagToggle = useCallback(
    (tag: string) => {
      const newTags = selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...selectedTags, tag]
      onTagsChange?.(newTags)
    },
    [selectedTags, onTagsChange]
  )

  const filteredTags = tagSearch
    ? tagList.filter((tag) => tag.toLowerCase().includes(tagSearch.toLowerCase()))
    : tagList

  return (
    <div data-testid="filters-section" className="flex flex-wrap items-center gap-3">
      <SearchInput
        ref={searchInputRef}
        id={search.id}
        name={search.name}
        data-testid="search-input"
        placeholder={search.placeholder}
        aria-label={search.ariaLabel}
        defaultValue={search.defaultValue}
        onSearch={onSearchChange}
        onClear={handleSearchClear}
        debounceMs={DEBOUNCE_MS}
        disabled={disabled}
        size="sm"
        className="w-64"
      />

      {fields.map((field) => (
        <FilterPopover
          key={field.key}
          field={field}
          disabled={disabled}
          onFieldChange={onFieldChange}
        />
      ))}

      {extraFields}

      {/* Tags Filter (hidden when no tags exist) */}
      {showTags && <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="filter-tags"
            aria-label="Filter by tags"
            aria-disabled={disabled}
            disabled={disabled}
            className="flex h-9 w-[120px] items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>
              {selectedTags.length > 0
                ? pluralize(selectedTags.length, 'tag')
                : 'Tags'}
            </span>
            <Icon icon={ChevronDownIcon} size="sm" className="ml-2 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-0" role="dialog">
          <Command>
            <CommandInput
              placeholder="Search tags…"
              value={tagSearch}
              onValueChange={setTagSearch}
            />
            <CommandList>
              <CommandEmpty>No tags found.</CommandEmpty>
              {filteredTags.map((tag) => (
                <CommandItem key={tag} value={tag} onSelect={() => handleTagToggle(tag)}>
                  <div className="flex items-center gap-2">
                    {selectedTags.includes(tag) && <Icon icon={CheckIcon} size="sm" />}
                    <span className={selectedTags.includes(tag) ? '' : 'ml-5'}>{tag}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>}

      <div className="flex-1" />

      {hasActiveFilters && (
        <Button variant="outline" size="sm" onClick={handleClearAll} className="text-warning border-warning hover:bg-warning/10">
          Clear Filters
        </Button>
      )}

      {actions}

      <Dropdown placement="bottom-end">
        <DropdownTrigger
          data-testid="columns-button"
          disabled={disabled}
          aria-disabled={disabled}
          className={`flex h-9 items-center gap-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-subtle'}`}
        >
          Columns
          <Icon icon={ChevronDownIcon} size="sm" className="opacity-50" />
        </DropdownTrigger>
        <DropdownMenu>
          {columns.map((column) => (
            <DropdownItem
              key={column.id}
              role="menuitemcheckbox"
              aria-checked={column.visible}
              closeOnSelect={false}
              onSelect={() => onColumnToggle(column.id, !column.visible)}
            >
              <div className="flex items-center gap-2">
                <CheckboxIndicator checked={column.visible} />
                {column.label}
              </div>
            </DropdownItem>
          ))}
        </DropdownMenu>
      </Dropdown>
    </div>
  )
}

/** Internal component for a single filter popover field. */
function FilterPopover({
  field,
  disabled,
  onFieldChange,
}: Readonly<{
  field: FilterField
  disabled: boolean
  onFieldChange: (key: string, value: string | string[]) => void
}>) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = search
    ? field.options.filter((opt) => opt.label.toLowerCase().includes(search.toLowerCase()))
    : field.options

  const isSelected = (value: string): boolean => {
    if (field.mode === 'single') {
      return field.selectedValue === value
    }
    return (field.selectedValues ?? []).includes(value)
  }

  const getButtonLabel = (): string => {
    if (field.mode === 'single') {
      if (!field.selectedValue) return field.placeholder
      const selected = field.options.find((opt) => opt.value === field.selectedValue)
      return selected ? selected.label : field.selectedValue
    }
    const count = (field.selectedValues ?? []).length
    if (count === 0) return field.placeholder
    const label = count === 1 ? (field.countLabelSingular ?? field.countLabel) : field.countLabel
    return `${count} ${label}`
  }

  const handleSelect = (value: string) => {
    if (field.mode === 'single') {
      const newValue = field.selectedValue === value ? '' : value
      onFieldChange(field.key, newValue)
      setOpen(false)
      setSearch('')
    } else {
      const current = field.selectedValues ?? []
      const newValues = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      onFieldChange(field.key, newValues)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={field.testId}
          aria-label={field.ariaLabel}
          aria-disabled={disabled}
          disabled={disabled}
          className={`flex h-9 ${field.buttonWidth} items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span>{getButtonLabel()}</span>
          <Icon icon={ChevronDownIcon} size="sm" className="ml-2 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" role="dialog">
        <Command>
          <CommandInput
            placeholder={field.searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {field.emptySourceMessage && field.options.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {field.emptySourceMessage}
              </div>
            )}
            {filtered.length === 0 && field.options.length > 0 && (
              <CommandEmpty>{field.emptyMessage}</CommandEmpty>
            )}
            {filtered.map((opt) => (
              <CommandItem
                key={opt.value}
                value={opt.value}
                onSelect={() => handleSelect(opt.value)}
              >
                <div className="flex items-center gap-2">
                  {isSelected(opt.value) && <Icon icon={CheckIcon} size="sm" />}
                  <span className={isSelected(opt.value) ? '' : 'ml-5'}>{opt.label}</span>
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
