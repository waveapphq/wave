/**
 * Variable Setter Editor - REQ-3.4.1.14
 *
 * Custom inline variable editing UI for the Variable Setter control. Each row
 * lists a target variable; its value edits inline (numeric / boolean scalar or
 * expression) or via the shared "Edit value" sheet (string + array / map / table).
 */

import { useState, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { VariableType } from '@/lib/variable-types'
import type { ElementTypes } from '@/lib/variable-validation'
import { ValueEditorSheet } from '@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet'
import { useProtectedValueConfirm } from '@/components/shared/variable-bodies/protected-value-field'
import {
  RowRemovalQuestion,
  useRowRemovalGuard,
} from '@/components/shared/child-editors/row-removal-guard'
import { openEditorAfterRemoval } from '@/lib/child-editors'
import type { VariableRow, VariableSetterEditorProps } from './types'
import { nextRowKey, useRowOperations } from './use-row-operations'
import { VariableRowComponent } from './variable-row'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type { VariableSetterEditorProps } from './types'

const NO_ELEMENT_TYPES: Record<string, ElementTypes> = {}

export function VariableSetterEditor({
  variables,
  expressionKeys,
  templateKeys,
  secretKeys,
  variableTypes,
  variableElementTypes = NO_ELEMENT_TYPES,
  availableVariables,
  onVariablesChange,
  onExpressionKeysChange,
  onTemplateKeysChange,
  onSecretKeysChange,
  onTypesChange,
  onElementTypesChange,
  onValidChange,
}: Readonly<VariableSetterEditorProps>) {
  // Build row state from props
  const [rows, setRows] = useState<VariableRow[]>(() => {
    const exprSet = new Set(expressionKeys)
    const tmplSet = new Set(templateKeys)
    const secretSet = new Set(secretKeys)
    const entries = Object.entries(variables)
    if (entries.length === 0) {
      return [
        { key: nextRowKey(), name: '', value: '', type: 'string', isExpression: false, isTemplate: false, isSecret: false },
      ]
    }
    return entries.map(([name, value]) => ({
      key: nextRowKey(),
      name,
      value,
      type: variableTypes[name] ?? 'string',
      elementTypes: variableElementTypes[name],
      isExpression: exprSet.has(name),
      isTemplate: tmplSet.has(name),
      isSecret: secretSet.has(name),
    }))
  })

  // Clear-and-edit confirm for a row's masked secret value (write-only replace).
  const secretConfirm = useProtectedValueConfirm()
  const rowGuard = useRowRemovalGuard()

  const {
    validationState,
    touchedRows,
    editingValueRow,
    setEditingValueRow,
    valueSheetRef,
    openAutocomplete,
    setOpenAutocomplete,
    revalidate,
    handleNameChange,
    handleNameBlur,
    handleTypeChange,
    handleValueChange,
    handleExpressionToggle,
    handleSecretToggle,
    handleClearSecretValue,
    handleDelete,
    handleSheetSave,
    handleEditValue,
    getFilteredSuggestions,
    isExistingVariable,
  } = useRowOperations(rows, setRows, {
    availableVariables,
    onVariablesChange,
    onExpressionKeysChange,
    onTemplateKeysChange,
    onSecretKeysChange,
    onTypesChange,
    onElementTypesChange,
    onValidChange,
  })

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

  // Run initial validation on mount so parent knows if form starts invalid
  const didInitialValidate = useRef(false)
  useEffect(() => {
    if (!didInitialValidate.current) {
      didInitialValidate.current = true
      revalidate(rows)
    }
  })

  const handleRowDelete = (rowIndex: number) =>
    rowGuard.request([rows[rowIndex].name], () => {
      // The editor of a row that goes closes with it; the rows after it keep theirs.
      setEditingValueRow((editing) => openEditorAfterRemoval(editing, rowIndex))
      handleDelete(rowIndex)
    })

  const handleAdd = () => {
    const updated = [
      ...rows,
      { key: nextRowKey(), name: '', value: '', type: 'string', isExpression: false, isTemplate: false, isSecret: false },
    ]
    focusRowIndex.current = updated.length - 1
    setRows(updated)
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

      {/* Column headers - align with VariableRowComponent's columns so the Secret
          checkbox column is labeled (parity with the profile / entity variable table). */}
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <div className="flex-1 min-w-[120px]">Name</div>
        <div className="w-[100px]">Type</div>
        <div className="w-8 text-center">Secret</div>
        <div className="flex-1 min-w-[140px] pl-2">Value</div>
        <div className="w-8" aria-hidden="true" />
        <div className="w-8" aria-hidden="true" />
      </div>

      {/* Variable rows */}
      {rows.map((row, index) => (
        <VariableRowComponent
          key={row.key}
          row={row}
          index={index}
          totalRows={rows.length}
          validation={validationState[row.key]}
          isTouched={touchedRows.has(row.key)}
          isExisting={isExistingVariable(row.name)}
          isAutocompleteOpen={openAutocomplete === index}
          availableVariables={availableVariables}
          filteredSuggestions={getFilteredSuggestions(row.name, index)}
          nameInputRef={(el) => {
            if (index === 0) firstNameRef.current = el
            if (el && focusRowIndex.current === index) {
              el.focus()
              focusRowIndex.current = null
            }
          }}
          onNameChange={handleNameChange}
          onNameBlur={handleNameBlur}
          onTypeChange={handleTypeChange}
          onValueChange={handleValueChange}
          onExpressionToggle={handleExpressionToggle}
          onSecretToggle={handleSecretToggle}
          onDelete={handleRowDelete}
          onOpenAutocomplete={setOpenAutocomplete}
          onEditValue={handleEditValue}
          onEditSecret={(rowIndex) => secretConfirm.open(() => handleClearSecretValue(rowIndex))}
        />
      ))}

      {/* Shared "Edit value" sheet for string + array / map / table rows */}
      {editingValueRow !== null && (
        <ValueEditorSheet
          ref={valueSheetRef}
          key={rows[editingValueRow].key}
          label={rows[editingValueRow].name}
          name={rows[editingValueRow].name}
          type={rows[editingValueRow].type as VariableType}
          value={rows[editingValueRow].value}
          isTemplate={rows[editingValueRow].isTemplate === true}
          elementTypes={rows[editingValueRow].elementTypes}
          availableVariables={availableVariables.map((v) => ({ name: v.name, type: v.type }))}
          onSave={(value, isTemplate, _exprKeys, elementTypes) =>
            handleSheetSave(editingValueRow, value, isTemplate, elementTypes)
          }
          onClose={() => setEditingValueRow(null)}
        />
      )}

      <RowRemovalQuestion guard={rowGuard} />

      {secretConfirm.dialog}
    </div>
  )
}
