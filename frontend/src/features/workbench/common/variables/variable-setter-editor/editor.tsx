/**
 * Variable Setter Editor - REQ-3.4.1.14
 *
 * The Variable Setter's rows: each lists a target variable and sets its value on the one value field of a
 * Block (FIELD-1). The rows read and write the Block's shared slots; a row's type is its declared variable's.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EntryChangeQuestions } from '@/components/shared/variable-bodies/entry-change-questions'
import {
  RowRemovalQuestion,
  useRowRemovalGuard,
} from '@/components/shared/child-editors/row-removal-guard'
import { entryFlagsFor } from '@/features/workbench/lib/node-parameters/field-modes'
import { literalFits } from '@/features/workbench/lib/saved-block-fields'
import type { SecretSaveTarget } from '@/features/workbench/common/variables/variable-inspect-modal/secret-visibility-notice'
import type { AvailableVariable, SetterSlots, VariableRow } from './types'
import { newSetterRow, nextRowKey, useRowOperations } from './use-row-operations'
import { VariableRowComponent } from './variable-row'

export interface VariableSetterEditorProps {
  slots: SetterSlots
  availableVariables: AvailableVariable[]
  onSlotsChange: (next: SetterSlots) => void
  onValidChange: (valid: boolean) => void
  /** Whose save seals a typed secret: the Test, or the Function a library Function view shows. */
  secretSaveTarget?: SecretSaveTarget
}

/** The row on its variable's declared type: a literal that no longer fits it has no value, never another one (FNCFG-9). */
function onDeclaredType(row: VariableRow, type: string): VariableRow {
  const kept = row.isExpression || row.isTemplate === true || literalFits(row.value, { name: row.name, type })
  if (kept) return { ...row, type }
  return { ...row, type, value: undefined, entryExpressions: [], elementTypes: undefined }
}

/** One stored row: its flags from the `variables.<row>` places, its type from its declared variable (VARSET-5). */
function storedRow(
  name: string,
  stored: unknown,
  slots: SetterSlots,
  availableVariables: AvailableVariable[],
): VariableRow {
  const place = `variables.${name}`
  const row: VariableRow = {
    key: nextRowKey(),
    name,
    value: stored,
    type: slots.rowTypes[name] ?? 'string',
    isExpression: slots.expressionFields.includes(place),
    isTemplate: slots.templateFields.includes(place),
    isSecret: slots.secretFields.includes(place),
    entryExpressions: entryFlagsFor(place, slots.expressionFields),
    elementTypes: slots.elementTypes[place],
  }
  const declared = availableVariables.find((v) => v.name === name)
  return declared === undefined ? row : onDeclaredType(row, declared.type)
}

function rowsAtOpen(slots: SetterSlots, availableVariables: AvailableVariable[]): VariableRow[] {
  const entries = Object.entries(slots.variables)
  if (entries.length === 0) return [newSetterRow()]
  return entries.map(([name, stored]) => storedRow(name, stored, slots, availableVariables))
}

/** The rows on their variables' types as declared now, so a retype in the Variable Manager reaches an open row (VARSET-5). */
function declaredRows(rows: VariableRow[], availableVariables: AvailableVariable[]): VariableRow[] {
  return rows.map((row) => {
    const declared = availableVariables.find((v) => v.name === row.name)
    return declared === undefined || declared.type === row.type ? row : onDeclaredType(row, declared.type)
  })
}

export function VariableSetterEditor({
  slots,
  availableVariables,
  onSlotsChange,
  onValidChange,
  secretSaveTarget,
}: Readonly<VariableSetterEditorProps>) {
  const [heldRows, setRows] = useState<VariableRow[]>(() => rowsAtOpen(slots, availableVariables))
  const rows = useMemo(() => declaredRows(heldRows, availableVariables), [heldRows, availableVariables])
  const rowGuard = useRowRemovalGuard()
  const ops = useRowOperations(rows, setRows, { availableVariables, onSlotsChange, onValidChange })

  // Auto-focus: first empty row on mount, or newly added row
  const firstNameRef = useRef<HTMLTextAreaElement>(null)
  const didAutoFocus = useRef(false)
  const focusRowIndex = useRef<number | null>(null)
  useEffect(() => {
    if (!didAutoFocus.current && firstNameRef.current && rows.length > 0 && !rows[0].name) {
      firstNameRef.current.focus()
      didAutoFocus.current = true
    }
  }, [rows])

  // The rows' messages show from the moment the window opens and follow the declarations, so Save does too.
  const { revalidate } = ops
  useEffect(() => {
    revalidate(rows)
  }, [revalidate, rows])

  // A row that goes takes its value field's sheets with it, asking first while they hold unsaved changes.
  const handleRowDelete = (rowIndex: number) =>
    rowGuard.request([rows[rowIndex].name], () => ops.handleDelete(rowIndex))

  const handleAdd = () => {
    focusRowIndex.current = rows.length
    ops.handleAdd()
  }

  return (
    <div className="space-y-2">
      {/* Header with add button */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Variables</span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAdd}
          data-testid="varset-add-button"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {/* Column headers over the row's columns: name, type, secret, value, expand, {x}, delete. */}
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <div className="w-[189px] shrink-0">Name</div>
        <div className="w-[100px] shrink-0">Type</div>
        <div className="flex w-8 shrink-0 justify-center whitespace-nowrap">Secret</div>
        <div className="min-w-0 flex-1 pl-1">Value</div>
        <div className="w-8 shrink-0" aria-hidden="true" />
        <div className="w-8 shrink-0" aria-hidden="true" />
        <div className="w-8 shrink-0" aria-hidden="true" />
      </div>

      {rows.map((row, index) => (
        <VariableRowComponent
          key={row.key}
          row={row}
          index={index}
          totalRows={rows.length}
          nameProblem={ops.problems[index].name}
          valueMessage={ops.problems[index].value}
          isExisting={ops.isExistingVariable(row.name)}
          isAutocompleteOpen={ops.openAutocomplete === index}
          availableVariables={availableVariables}
          filteredSuggestions={ops.getFilteredSuggestions(row.name, index)}
          nameInputRef={(el) => {
            if (index === 0) firstNameRef.current = el
            if (el && focusRowIndex.current === index) {
              el.focus()
              focusRowIndex.current = null
            }
          }}
          secretSaveTarget={secretSaveTarget}
          onNameChange={ops.handleNameChange}
          onNameBlur={ops.handleNameBlur}
          onTypeChange={ops.handleTypeChange}
          onSecretToggle={ops.handleSecretToggle}
          onRowValue={ops.handleRowValue}
          onRowModes={ops.handleRowModes}
          onCellValidation={ops.handleCellValidation}
          onDelete={handleRowDelete}
          onOpenAutocomplete={ops.setOpenAutocomplete}
        />
      ))}

      <RowRemovalQuestion guard={rowGuard} />

      <EntryChangeQuestions change={ops.entryChange} subject="variable" />
    </div>
  )
}
