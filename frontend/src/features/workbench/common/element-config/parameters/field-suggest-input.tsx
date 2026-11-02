/**
 * FieldSuggestInput - a field or index name box, suggested from the block's pulled fields (OS-13, REQ-3.3.2.5,
 * REQ-3.3.2.6). Free text is always accepted; outside an OpenSearch sheet it is a plain text box.
 */

import { use } from 'react'
import { TextField } from '@/components/shared/fields/text-field'
import { ENTRY_CONTROL_CLASS } from '@/components/shared/variable-bodies/body-parts'
import { cn } from '@/lib/utils'
import { getValueColorClass } from '@/lib/variable-format'
import { FieldErrorContext } from '@/components/shared/fields/field-error-context'
import type { FieldSuggestPolicy } from '@/features/workbench/lib/node-parameters/types'
import { VariableComboboxBase } from '../shared/variable-combobox-base'
import { useFieldSuggestions } from './field-suggestions'

/** `row`: the control of a list row box (FIELD-1); `plain`: a form box, as inside the stat popover. */
type BoxLook = 'row' | 'plain'

const BOX_CLASSES: Record<BoxLook, string> = {
  // Nested in the combobox anchor, it sets the row box's inner height itself (32px less the border).
  row: cn(
    ENTRY_CONTROL_CLASS,
    'h-[30px] py-[3px] font-mono placeholder:italic placeholder:text-muted-foreground/70',
    getValueColorClass('string'),
  ),
  plain: 'font-mono',
}

export function FieldSuggestInput({
  value,
  onChange,
  source,
  types,
  placeholder,
  ariaLabel,
  invalid,
  testId,
  look = 'row',
}: Readonly<{
  value: string
  onChange: (value: string) => void
  source: FieldSuggestPolicy['source']
  types?: FieldSuggestPolicy['types']
  placeholder?: string
  ariaLabel: string
  invalid?: boolean
  testId?: string
  look?: BoxLook
}>) {
  const suggestions = useFieldSuggestions({ source, types })
  const errorId = use(FieldErrorContext)
  const box =
    suggestions === undefined ? (
      <TextField
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        aria-describedby={errorId}
        data-testid={testId}
        className={BOX_CLASSES[look]}
      />
    ) : (
      <VariableComboboxBase
        value={value}
        onChange={onChange}
        variables={suggestions.items}
        placeholder={placeholder ?? ''}
        footer={suggestions.footer}
        emptyText={suggestions.emptyText}
        invalid={invalid}
        maxLength={null}
        unfiltered={suggestions.unfiltered}
        inputClassName={BOX_CLASSES[look]}
        aria-label={ariaLabel}
        aria-describedby={errorId}
        data-testid={testId}
      />
    )
  // In the row box the field fills the room left of the null button.
  return look === 'row' ? <div className="min-w-0 flex-1">{box}</div> : box
}
