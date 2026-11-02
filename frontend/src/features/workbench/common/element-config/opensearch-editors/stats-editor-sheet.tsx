/**
 * StatsEditorSheet - the OpenSearch Stats editor: the shared list editor in the Edit value sheet, each row read
 * in words on its trigger and edited in its stat popover. Add appends a Sum with no field and opens its popover;
 * a row back from {x} takes that same entry. Save hands back the stored record rows and the rows held as {x}.
 *
 * Design: FIELD-10, OS-7
 * REQ-3.3.3.2: OpenSearch aggregations
 * REQ-3.1.3.20: Null is the only empty value
 */

import type { Ref } from 'react'

import type { SheetHandle } from '@/components/shared/draggable-sheet'
import { recordItems, recordRows, type RecordRow } from '@/features/workbench/lib/record-rows'
import { newStatEntry } from '@/features/workbench/lib/opensearch/stat-entries'
import {
  ValueEditorSheet,
  type ListEditorOptions,
} from '@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet'
import type { AvailableVariable } from '../expressions/expression-field'
import { makeExpressionEditor } from '../expressions/expression-entry-editor'
import { FieldSuggestContext, type FieldSuggestValue } from '../parameters/field-suggest-context'
import { StatEntryPopover } from '../parameters/stat-entry-popover'

const NO_VARIABLES: AvailableVariable[] = []

// Rows are numbered from one, as the stat triggers are.
const fromOne = (index: number) => String(index + 1)

export interface StatsEditorSheetProps {
  ref?: Ref<SheetHandle>
  /** The row label the editor was opened from. */
  label?: string
  rows: readonly RecordRow[]
  /** The rows held as {x}. */
  expressionRows: ReadonlySet<number>
  /** The Block's pulled fields, offered in each popover's Field box. */
  fields: FieldSuggestValue
  /** What a row held as {x} and a Custom (JSON) stat may read. */
  availableVariables?: AvailableVariable[]
  onSave: (rows: RecordRow[], expressionRows: Set<number>) => void
  onCancel: () => void
}

export function StatsEditorSheet({
  ref,
  label = 'Stats',
  rows,
  expressionRows,
  fields,
  availableVariables = NO_VARIABLES,
  onSave,
  onCancel,
}: Readonly<StatsEditorSheetProps>) {
  const listEditor: ListEditorOptions = {
    expressionEditor: makeExpressionEditor(availableVariables),
    expressionIndices: expressionRows,
    positionLabel: fromOne,
    newItem: newStatEntry,
    renderItemInput: (item) => (
      <StatEntryPopover
        index={item.index}
        value={item.value}
        onChange={item.onChange}
        defaultOpen={item.appended}
        availableVariables={availableVariables}
        testId={item.testId}
      />
    ),
  }
  return (
    <FieldSuggestContext value={fields}>
      <ValueEditorSheet
        ref={ref}
        label={label}
        name=""
        type="array"
        value={recordItems(rows)}
        isTemplate={false}
        allowTemplate={false}
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
