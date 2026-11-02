/**
 * Sort Dropdown
 *
 * Variable Manager toolbar selector for the row order. Wraps the project's
 * shadcn `Select` to expose three options: Name A-Z (default), Name Z-A, Type.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SortKey } from './sort-variables'

interface SortDropdownProps {
  value: SortKey
  onValueChange: (value: SortKey) => void
}

const LABELS: Record<SortKey, string> = {
  'name-asc': 'Name A-Z',
  'name-desc': 'Name Z-A',
  type: 'Type',
}

export function SortDropdown({ value, onValueChange }: Readonly<SortDropdownProps>) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as SortKey)}>
      <SelectTrigger
        className="h-8 text-xs"
        aria-label="Sort variables"
        data-testid="sort-dropdown"
      >
        <SelectValue>{LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="name-asc">Name A-Z</SelectItem>
        <SelectItem value="name-desc">Name Z-A</SelectItem>
        <SelectItem value="type">Type</SelectItem>
      </SelectContent>
    </Select>
  )
}
