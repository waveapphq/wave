/**
 * Kind Dropdown
 *
 * Value-editor sheet footer Literal/Template selector for a string value.
 * Mirrors FormatDropdown: a text-label trigger + chevron (icon-only glyph
 * triggers are rejected project-wide), a plain-text menu with a check on the
 * selected entry, opening upward.
 *
 * REQ-3.1.3.15: Template variables
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type ValueKind = 'literal' | 'template'

const KIND_LABELS: Record<ValueKind, string> = {
  literal: 'Literal',
  template: 'Template',
}

export interface KindDropdownProps {
  value: ValueKind
  onValueChange: (value: ValueKind) => void
}

export function KindDropdown({ value, onValueChange }: Readonly<KindDropdownProps>) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as ValueKind)}>
      <SelectTrigger
        className="h-7 w-auto shrink-0 gap-1 px-2 text-xs"
        aria-label="Kind"
        data-testid="kind-dropdown"
      >
        <SelectValue>{KIND_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent side="top">
        <SelectItem value="literal">Literal</SelectItem>
        <SelectItem value="template">Template</SelectItem>
      </SelectContent>
    </Select>
  )
}
