/**
 * View Dropdown
 *
 * Inspect modal footer View selector, right of Mode. Text-label trigger +
 * chevron (icon-only glyph triggers are rejected project-wide); menu is
 * plain text with a check on the selected entry and opens upward. The host
 * passes the per-watcher-kind options and disables the trigger while the
 * Initial mode forces the Expression display.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { AlertTriangle } from 'lucide-react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export type InspectView =
  | 'visual'
  | 'code'
  | 'literal'
  | 'expression'
  | 'rendered'
  | 'template'

const LABELS: Record<InspectView, string> = {
  visual: 'Visual',
  code: 'Code',
  // An expression's "literal" view is its last-computed value; changing the
  // source does not re-evaluate until the next reference.
  literal: 'Last Evaluated',
  expression: 'Expression',
  // A template's "rendered" view is its realized string; "template" is the
  // {{ }} source (REQ-3.1.3.15), mirroring the expression literal/source pair.
  rendered: 'Rendered',
  template: 'Template',
}

export interface ViewDropdownProps {
  value: InspectView
  onValueChange: (value: InspectView) => void
  options: InspectView[]
  disabled?: boolean
  /** Options rendered as disabled menu items (e.g. Visual while Code JSON is invalid). */
  disabledOptions?: InspectView[]
  /** Tooltip shown on each disabled item explaining why it is locked. */
  disabledOptionTooltip?: string
}

export function ViewDropdown({
  value,
  onValueChange,
  options,
  disabled,
  disabledOptions,
  disabledOptionTooltip,
}: Readonly<ViewDropdownProps>) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onValueChange(v as InspectView)}
      disabled={disabled}
    >
      <SelectTrigger
        className="h-7 w-auto gap-1 px-2 text-xs"
        aria-label="Inspect view"
        data-testid="view-dropdown"
      >
        <SelectValue>{LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent side="top">
        {options.map((option) => {
          const itemDisabled = disabledOptions?.includes(option) ?? false
          return (
            <SelectItem
              key={option}
              value={option}
              disabled={itemDisabled}
              // Override the disabled item's dimming + pointer-events-none so the
              // alert icon stays full-strength and the tooltip still fires on
              // hover; the lock is conveyed by the muted label, not a grayed row.
              className={
                itemDisabled
                  ? 'cursor-help data-[disabled]:pointer-events-auto data-[disabled]:opacity-100'
                  : undefined
              }
            >
              {itemDisabled ? (
                // A locked option (e.g. Visual while the Code JSON is invalid)
                // carries a visible alert icon right here, so the reason is obvious
                // the moment the user opens the menu to switch back.
                <ConditionalTooltip content={disabledOptionTooltip} disabled side="right" wide>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-muted-foreground">{LABELS[option]}</span>
                    <AlertTriangle
                      data-testid="view-locked-alert"
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400"
                    />
                  </span>
                </ConditionalTooltip>
              ) : (
                LABELS[option]
              )}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
