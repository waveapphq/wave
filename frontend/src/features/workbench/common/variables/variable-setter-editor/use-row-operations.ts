/**
 * Variable Setter Editor - Row Operations Hook
 *
 * Custom hook encapsulating all row CRUD operations, validation,
 * propagation (variables / types / expression keys / template keys),
 * the value-editor sheet open/save state, and autocomplete filtering.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { openOrRefocus, type SheetHandle } from '@/components/shared/draggable-sheet'
import { getDefaultValueForType } from '@/lib/variable-defaults'
import type { VariableType } from '@/lib/variable-types'
import type { ElementTypes } from '@/lib/variable-validation'
import type { VariableRow, AvailableVariable, RowValidation } from './types'
import { validateRow } from './validation'

// ---------------------------------------------------------------------------
// Row key generator
// ---------------------------------------------------------------------------

let rowIdCounter = 0
function nextRowKey(): string {
  return `row-${++rowIdCounter}`
}

export { nextRowKey }

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseRowOperationsArgs {
  availableVariables: AvailableVariable[]
  onVariablesChange: (variables: Record<string, unknown>) => void
  onExpressionKeysChange: (keys: string[]) => void
  onTemplateKeysChange: (keys: string[]) => void
  onSecretKeysChange: (keys: string[]) => void
  onTypesChange: (types: Record<string, string>) => void
  onElementTypesChange?: (types: Record<string, ElementTypes>) => void
  onValidChange?: (valid: boolean) => void
}

/** A literal array / map row's element types, stored beside its value (REQ-3.1.3.19). */
function rowElementTypes(row: VariableRow): ElementTypes | undefined {
  if (row.isExpression || (row.type !== 'array' && row.type !== 'map')) return undefined
  return row.elementTypes
}

export function useRowOperations(
  rows: VariableRow[],
  setRows: React.Dispatch<React.SetStateAction<VariableRow[]>>,
  {
    availableVariables,
    onVariablesChange,
    onExpressionKeysChange,
    onTemplateKeysChange,
    onSecretKeysChange,
    onTypesChange,
    onElementTypesChange,
    onValidChange,
  }: UseRowOperationsArgs,
) {
  // Validation state per row
  const [validationState, setValidationState] = useState<Record<string, RowValidation>>({})
  const [touchedRows, setTouchedRows] = useState<Set<string>>(new Set())

  // The row whose value is open in the "Edit value" sheet (string / complex).
  const [editingValueRow, setEditingValueRow] = useState<number | null>(null)
  const valueSheetRef = useRef<SheetHandle>(null)
  const autocompleteCloseRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(autocompleteCloseRef.current), [])

  // Autocomplete state per row
  const [openAutocomplete, setOpenAutocomplete] = useState<number | null>(null)

  // Propagate changes to parent. Values are carried verbatim (the inline scalar
  // body emits exact text; the sheet emits already-typed values), so there is no
  // parse/coerce step here - the backend coerces the stored string to the type.
  const propagate = useCallback(
    (updatedRows: VariableRow[]) => {
      const newVars: Record<string, unknown> = {}
      const newTypes: Record<string, string> = {}
      const newElementTypes: Record<string, ElementTypes> = {}
      const newExprKeys: string[] = []
      const newTmplKeys: string[] = []
      const newSecretKeys: string[] = []
      for (const row of updatedRows) {
        if (row.name) {
          newVars[row.name] = row.value
          newTypes[row.name] = row.type
          const elementTypes = rowElementTypes(row)
          if (elementTypes !== undefined) newElementTypes[row.name] = elementTypes
          if (row.isExpression) newExprKeys.push(row.name)
          if (row.isTemplate) newTmplKeys.push(row.name)
          if (row.isSecret) newSecretKeys.push(row.name)
        }
      }
      onVariablesChange(newVars)
      onTypesChange(newTypes)
      onElementTypesChange?.(newElementTypes)
      onExpressionKeysChange(newExprKeys)
      onTemplateKeysChange(newTmplKeys)
      onSecretKeysChange(newSecretKeys)
    },
    [
      onVariablesChange,
      onTypesChange,
      onElementTypesChange,
      onExpressionKeysChange,
      onTemplateKeysChange,
      onSecretKeysChange,
    ],
  )

  // Validate all rows
  const revalidate = useCallback(
    (currentRows: VariableRow[]) => {
      const allNames = currentRows.map((r) => r.name)
      const newState: Record<string, RowValidation> = {}
      let hasError = false
      for (let i = 0; i < currentRows.length; i++) {
        const row = currentRows[i]
        const result = validateRow(row, allNames, i, availableVariables)
        newState[row.key] = result
        if (result.error) hasError = true
      }
      setValidationState(newState)
      onValidChange?.(!hasError)
    },
    [availableVariables, onValidChange],
  )

  // --- Row operations ---

  const handleNameChange = useCallback(
    (index: number, newName: string) => {
      const updated = [...rows]
      updated[index] = { ...updated[index], name: newName }

      // Check if selecting an existing variable
      const existing = availableVariables.find((v) => v.name === newName)
      if (existing) {
        updated[index].type = existing.type
        // VARSET-9: the value starts on the type default, so the Edit-value sheet's body never sees a mismatch.
        updated[index].value = getDefaultValueForType(existing.type as VariableType)
        updated[index].elementTypes = undefined
      }

      setRows(updated)
      revalidate(updated)
      propagate(updated)
    },
    [rows, availableVariables, propagate, revalidate, setRows],
  )

  const handleNameBlur = useCallback(
    (index: number) => {
      const row = rows[index]
      setTouchedRows((prev) => new Set(prev).add(row.key))
      revalidate(rows)
      // Delay closing so that a click on a popover suggestion can fire first
      clearTimeout(autocompleteCloseRef.current)
      autocompleteCloseRef.current = setTimeout(() => setOpenAutocomplete(null), 150)
    },
    [rows, revalidate],
  )

  const handleTypeChange = useCallback(
    (index: number, newType: string) => {
      const updated = [...rows]
      // A type change presets its default and drops the template kind (only a string can be a template).
      updated[index] = {
        ...updated[index],
        type: newType,
        value: getDefaultValueForType(newType as VariableType),
        isTemplate: false,
        elementTypes: undefined,
      }
      setRows(updated)
      revalidate(updated)
      propagate(updated)
    },
    [rows, propagate, revalidate, setRows],
  )

  const handleValueChange = useCallback(
    (index: number, newValue: unknown) => {
      const updated = [...rows]
      updated[index] = { ...updated[index], value: newValue }
      // An edited value shows its own problem at once (`-` names `Enter a valid integer value`).
      setTouchedRows((prev) => new Set(prev).add(updated[index].key))
      setRows(updated)
      revalidate(updated)
      propagate(updated)
    },
    [rows, propagate, revalidate, setRows],
  )

  const handleExpressionToggle = useCallback(
    (index: number) => {
      const updated = [...rows]
      // Expression and template are mutually exclusive: toggling the { } mode
      // clears any template kind on the row.
      updated[index] = {
        ...updated[index],
        isExpression: !updated[index].isExpression,
        isTemplate: false,
      }
      setRows(updated)
      revalidate(updated)
      propagate(updated)
    },
    [rows, propagate, revalidate, setRows],
  )

  const handleSecretToggle = useCallback(
    (index: number) => {
      const updated = [...rows]
      updated[index] = { ...updated[index], isSecret: !updated[index].isSecret }
      setRows(updated)
      propagate(updated)
    },
    [rows, propagate, setRows],
  )

  // Clear-and-edit a masked secret: drop the sealed value (write-only replace) and
  // reopen the type-appropriate editor for a fresh entry.
  const handleClearSecretValue = useCallback(
    (index: number) => {
      const row = rows[index]
      const updated = [...rows]
      updated[index] = {
        ...updated[index],
        value: getDefaultValueForType(row.type as VariableType),
        elementTypes: undefined,
      }
      setRows(updated)
      revalidate(updated)
      propagate(updated)
      if (row.type !== 'integer' && row.type !== 'float' && row.type !== 'boolean') {
        setEditingValueRow(index)
      }
    },
    [rows, propagate, revalidate, setRows],
  )

  const handleDelete = useCallback(
    (index: number) => {
      const updated = rows.filter((_, i) => i !== index)

      // If deleting the last row, keep one empty row
      if (updated.length === 0) {
        updated.push({
          key: nextRowKey(),
          name: '',
          value: '',
          type: 'string',
          isExpression: false,
          isTemplate: false,
        })
      }

      setRows(updated)
      propagate(updated)
      revalidate(updated)
    },
    [rows, propagate, revalidate, setRows],
  )

  // Save from the "Edit value" sheet: write the value (and its template kind for
  // a string row) back to the row, then propagate. Closes the sheet.
  const handleSheetSave = useCallback(
    (rowIndex: number, value: unknown, isTemplate: boolean, elementTypes?: ElementTypes) => {
      const updated = [...rows]
      updated[rowIndex] = { ...updated[rowIndex], value, isTemplate, elementTypes }
      setRows(updated)
      revalidate(updated)
      propagate(updated)
    },
    [rows, propagate, revalidate, setRows],
  )

  const handleEditValue = useCallback(
    (rowIndex: number) =>
      openOrRefocus(editingValueRow !== null, valueSheetRef, () => setEditingValueRow(rowIndex)),
    [editingValueRow],
  )

  // Filtered autocomplete suggestions
  const getFilteredSuggestions = useCallback(
    (input: string, currentIndex: number): AvailableVariable[] => {
      // Deduplicate by name
      const byName = new Map<string, AvailableVariable>()
      for (const v of availableVariables) {
        if (!byName.has(v.name)) {
          byName.set(v.name, v)
        }
      }

      // Exclude variables already present in other setter rows
      const usedNames = new Set(
        rows
          .filter((_, i) => i !== currentIndex)
          .map((r) => r.name)
          .filter(Boolean),
      )

      // The NAME field is for declaring/picking a *settable* variable.
      // Profile aliases (sourced as "Profile: ...") and dotted profile fields
      // ("alias.field") are read-only references and don't belong here -
      // they remain available in the value-field expression editor.
      // Function INPUTS are read-only (the caller binds them) and are
      // filtered out. Function OUTPUTS remain - the setter assigns them
      // as the value the Function returns.
      let suggestions = Array.from(byName.values()).filter((v) => {
        if (usedNames.has(v.name)) return false
        if (v.name.includes('.')) return false
        if (v.source?.startsWith('Profile:')) return false
        if (v.source === 'Function input') return false
        return true
      })

      // Filter by typed input
      if (input) {
        const lower = input.toLowerCase()
        suggestions = suggestions.filter((v) =>
          v.name.toLowerCase().includes(lower),
        )
      }

      return suggestions
    },
    [availableVariables, rows],
  )

  // Check if a variable is from the existing store (not new)
  const isExistingVariable = useCallback(
    (name: string): boolean => {
      return availableVariables.some((v) => v.name === name)
    },
    [availableVariables],
  )

  return {
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
  }
}
