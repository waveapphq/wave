/**
 * Format Dropdown
 *
 * Inspect modal footer Format selector for literal string watchers, occupying
 * the (otherwise empty) View slot right of the Mode pill. Text-label trigger +
 * chevron (icon-only glyph triggers are rejected project-wide); menu is plain
 * text with a check on the selected entry and opens upward, mirroring the
 * ViewDropdown. Auto surfaces the detected format as a suffix (`Auto (JSON)`).
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
import type { TextFormat, ResolvedFormat } from '@/lib/codemirror/format-editor'

// Template is a value kind, not a transient format: its {{ }} highlight
// lives on the template kind's source body, not in this literal-string selector.
const EXPLICIT_LABELS: Record<Exclude<TextFormat, 'auto' | 'template'>, string> = {
  plain: 'Plain',
  json: 'JSON',
  xml: 'XML',
  yaml: 'YAML',
  python: 'Python',
  sql: 'SQL',
  dql: 'DQL',
  'query-dsl': 'Query DSL',
  'aggregation-json': 'JSON',
}

// Fixed menu order; Template is a value kind and script formats are locked-only (PYRUN-13, SQL-10, OS-12).
const MENU_FORMATS: Exclude<TextFormat, 'template'>[] = ['auto', 'plain', 'json', 'xml', 'yaml']

export interface FormatDropdownProps {
  value: TextFormat
  onValueChange: (value: TextFormat) => void
  /** The format Auto detected, shown as the Auto suffix (`Auto (JSON)`). */
  detectedFormat: ResolvedFormat
  disabled?: boolean
  /** Restricts the menu to a parameter's permitted formats (a JSON-only Body param
   *  shows only JSON, etc.). Omitted -> the full menu. */
  allowedFormats?: TextFormat[]
}

export function FormatDropdown({
  value,
  onValueChange,
  detectedFormat,
  disabled,
  allowedFormats,
}: Readonly<FormatDropdownProps>) {
  const autoLabel =
    detectedFormat === 'plain' ? 'Auto' : `Auto (${detectedFormat.toUpperCase()})`
  // 'template' never reaches this literal-string selector (Template is a
  // value kind), so the non-auto value is always a data format.
  const triggerLabel =
    value === 'auto'
      ? autoLabel
      : EXPLICIT_LABELS[value as Exclude<TextFormat, 'auto' | 'template'>]
  const labelFor = (format: Exclude<TextFormat, 'template'>) =>
    format === 'auto' ? autoLabel : EXPLICIT_LABELS[format]
  // A single allowed format LOCKS the picker: disabled, pinned to that
  // format, no Auto - a strict json_content / xml_content / url must never misdetect.
  const lockedFormats = allowedFormats?.length === 1 ? allowedFormats : null
  // 'auto' is the live-detect mode, not a restrictable data format - always offer it
  // when unlocked (a controlled Select whose value is filtered out of its items thrashes).
  const menuFormats = MENU_FORMATS.filter((format) =>
    lockedFormats
      ? lockedFormats.includes(format)
      : format === 'auto' || !allowedFormats || allowedFormats.includes(format),
  )
  return (
    <Select
      value={value}
      onValueChange={(v) => onValueChange(v as TextFormat)}
      disabled={disabled || !!lockedFormats}
    >
      <SelectTrigger
        className="h-7 w-auto shrink-0 gap-1 px-2 text-xs"
        aria-label="Format"
        data-testid="format-dropdown"
      >
        <SelectValue>{triggerLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent side="top">
        {menuFormats.map((format) => (
          <SelectItem key={format} value={format}>
            {labelFor(format)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
