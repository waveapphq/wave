/**
 * TimeValueInput - the From / To literal field: the one value field with the clock icon inside, the value as
 * written or the row default in gray while not set; its expand opens the time picker (OS-4, FIELD-9,
 * REQ-3.3.2.3).
 */

import { use, useId, useState } from 'react'
import { describedByOf, FieldNoteContext } from '@/components/shared/fields/field-error-context'
import { SheetFrozenContext } from '@/components/shared/sheet-layer'
import { safeStringify } from '@/lib/utils'
import { describeTimeValue } from '@/features/workbench/lib/opensearch/time-values'
import { BlockValueField } from '@/features/workbench/common/variables/variable-inspect-modal/window-value-field'
import { parameterLabel, type Parameter } from './parameter-table-types'
import type { BlockFieldState } from './parameter-value-inputs'
import { TimePickerPopover } from './time-picker-popover'

const currentTime = () => new Date()

export function TimeValueInput({
  parameter,
  value,
  onChange,
  field,
  now = currentTime,
}: Readonly<{
  parameter: Parameter
  value: unknown
  onChange: (value: unknown) => void
  field: BlockFieldState
  now?: () => Date
}>) {
  const noteId = use(FieldNoteContext)
  // A frozen window keeps expand; the picker it opens shows the time and writes nothing.
  const frozen = use(SheetFrozenContext) === true
  const hintId = useId()
  const [open, setOpen] = useState(false)
  const label = parameterLabel(parameter)
  const defaultValue = field.defaultValue === undefined ? '' : safeStringify(field.defaultValue)
  const { hint } = describeTimeValue(value, { label, defaultValue })

  const save = (next: string) => {
    setOpen(false)
    // A not-set field saved with the draft it opened on stays not set (FIELD-9).
    if (field.isSet || next !== defaultValue) onChange(next)
  }

  return (
    <div className="min-w-0">
      <FieldNoteContext value={describedByOf(noteId, hint === null ? undefined : hintId)}>
        <BlockValueField
          mode="literal"
          type="string"
          value={value}
          isSet={field.isSet}
          defaultValue={field.defaultValue}
          nullable={field.nullable}
          readOnly={field.readOnly}
          hasEditor
          leftIcon="clock"
          testId={parameter.name}
          label={label}
          adornment={field.adornment}
          onChange={(next) => onChange(next)}
          onUnset={field.onUnset}
          onNull={field.onNull}
          onExpand={() => setOpen(true)}
          renderExpandTrigger={(expand) => (
            <TimePickerPopover
              label={label}
              value={value}
              defaultValue={defaultValue}
              now={now}
              readOnly={frozen || field.readOnly}
              open={open}
              onOpenChange={setOpen}
              onSave={save}
              onCancel={() => setOpen(false)}
            >
              {expand}
            </TimePickerPopover>
          )}
        />
      </FieldNoteContext>
      {hint !== null && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
