/**
 * FieldsEditorSheet - the OpenSearch Fields editor: the shared list editor in the Edit value sheet, each row
 * edited in the field box that suggests the pulled fields. Move, remove, Add, per-row {x} and the null button
 * come from the shared editor; Save hands back the stored record rows and the rows held as {x}.
 *
 * Design: FIELD-10, OS-6, OS-13
 * REQ-3.3.2.6: OpenSearch field-based filtering and queries
 * REQ-3.1.3.20: Null is the only empty value
 */

import type { Ref } from 'react'

import type { SheetHandle } from '@/components/shared/draggable-sheet'
import { safeStringify } from '@/lib/utils'
import { recordItems, recordRows, type RecordRow } from '@/features/workbench/lib/record-rows'
import {
  ValueEditorSheet,
  type ListEditorOptions,
} from '@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet'
import type { AvailableVariable } from '../expressions/expression-field'
import { makeExpressionEditor } from '../expressions/expression-entry-editor'
import { FieldSuggestContext, type FieldSuggestValue } from '../parameters/field-suggest-context'
import { FieldSuggestInput } from '../parameters/field-suggest-input'

const NO_VARIABLES: AvailableVariable[] = []

// Rows are numbered from one, as the Results columns are.
const fromOne = (index: number) => String(index + 1)

export interface FieldsEditorSheetProps {
  ref?: Ref<SheetHandle>
  /** The row label the editor was opened from. */
  label?: string
  rows: readonly RecordRow[]
  /** The rows held as {x}. */
  expressionRows: ReadonlySet<number>
  /** The Block's pulled fields, offered on every row. */
  suggestions: FieldSuggestValue
  /** What a row held as {x} may read. */
  availableVariables?: AvailableVariable[]
  onSave: (rows: RecordRow[], expressionRows: Set<number>) => void
  onCancel: () => void
}

export function FieldsEditorSheet({
  ref,
  label = 'Fields',
  rows,
  expressionRows,
  suggestions,
  availableVariables = NO_VARIABLES,
  onSave,
  onCancel,
}: Readonly<FieldsEditorSheetProps>) {
  const listEditor: ListEditorOptions = {
    expressionEditor: makeExpressionEditor(availableVariables),
    expressionIndices: expressionRows,
    positionLabel: fromOne,
    renderItemInput: (item) => (
      <FieldSuggestInput
        value={safeStringify(item.value)}
        onChange={item.onChange}
        source="fields"
        ariaLabel={item.ariaLabel}
        testId={item.testId}
      />
    ),
  }
  return (
    <FieldSuggestContext value={suggestions}>
      <ValueEditorSheet
        ref={ref}
        label={label}
        name=""
        type="array"
        value={recordItems(rows)}
        isTemplate={false}
        allowTemplate={false}
        stringValuesOnly
        listEditor={listEditor}
        availableVariables={availableVariables}
        onSave={(items, _isTemplate, exprKeys) =>
          onSave(recordRows(items as unknown[]), new Set(exprKeys.map(Number)))
        }
        onClose={onCancel}
      />
    </FieldSuggestContext>
  )
}
