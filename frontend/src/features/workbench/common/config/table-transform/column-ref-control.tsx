/**
 * ColumnRefControl - a Name/Index mode selector plus a value field for a column reference.
 */

import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TextField } from '@/components/shared/fields/text-field'
import { VariableComboboxBase } from '@/features/workbench/common/element-config/shared/variable-combobox-base'
import { acceptsNumericInput } from '@/lib/number-rule'
import type { ColumnRef, ColumnRefMode, SchemaColumn } from './types'

const MODE_PLACEHOLDERS: Record<ColumnRefMode, string> = {
  name: 'column name',
  index: '0',
}

const INDEX_RULE = { negative: false } as const

/** An index ref is a 0-based whole number: the box drops a key the number rule refuses. */
function takesText(mode: ColumnRefMode, value: string): boolean {
  return mode !== 'index' || acceptsNumericInput(value, 'integer', INDEX_RULE)
}

export interface ColumnRefControlProps {
  mode: ColumnRefMode
  value: string
  hasHeader: boolean
  onChange: (ref: ColumnRef) => void
  schemaColumns?: SchemaColumn[]
}

export function ColumnRefControl({
  mode,
  value,
  hasHeader,
  onChange,
  schemaColumns,
}: Readonly<ColumnRefControlProps>) {
  const [text, setText] = useState(value)
  const hasSchema = schemaColumns !== undefined

  return (
    <div className="flex items-center gap-2">
      <Select
        value={mode}
        onValueChange={(next) => {
          // A name and an index are not interchangeable: clear the value on switch.
          setText('')
          onChange({ mode: next as ColumnRefMode, value: '' })
        }}
        disabled={!hasHeader}
      >
        <SelectTrigger
          data-testid="column-ref-mode"
          className="h-8 w-[92px] shrink-0"
          aria-label="Column reference mode"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="index">Index</SelectItem>
        </SelectContent>
      </Select>

      {hasSchema ? (
        <VariableComboboxBase
          data-testid="column-ref-combobox"
          value={value}
          onChange={(name) => onChange({ mode, value: name })}
          variables={schemaColumns.map((col) => ({ name: col.name, type: col.type }))}
          placeholder="column"
        />
      ) : (
        <TextField
          data-testid="column-ref-value"
          aria-label="Column reference"
          inputMode={mode === 'index' ? 'numeric' : undefined}
          value={text}
          onChange={(next) => {
            if (!takesText(mode, next)) return
            setText(next)
            onChange({ mode, value: next })
          }}
          placeholder={MODE_PLACEHOLDERS[mode]}
        />
      )}
    </div>
  )
}
