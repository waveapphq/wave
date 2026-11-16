/**
 * Variable Setter Editor - Row Operations Hook
 *
 * Row changes (name, type, secret, value, modes, add, delete) written to the Block's shared slots in one
 * `onSlotsChange`, the row checks reported through `onValidChange`, and the name suggestions.
 * REQ-3.4.1.14, REQ-3.1.3.19
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEntryChange } from '@/components/shared/variable-bodies/entry-change-questions'
import { getDefaultValueForType } from '@/lib/variable-defaults'
import type { VariableType } from '@/lib/variable-types'
import type { ElementTypes } from '@/lib/variable-validation'
import type { AvailableVariable, RowProblems, SetterSlots, VariableRow } from './types'
import { rowProblems } from './validation'

let rowIdCounter = 0

export function nextRowKey(): string {
  return `row-${++rowIdCounter}`
}

/** The row an empty or emptied Setter shows: no name, on null (VARSET-10). */
export function newSetterRow(): VariableRow {
  return { key: nextRowKey(), name: '', value: null, type: 'string', isExpression: false }
}

/** The {x} flags a row writes: the whole row at its place, or its entries `<place>.<key>`. */
function rowExpressionFields(row: VariableRow, place: string): string[] {
  return row.isExpression ? [place] : (row.entryExpressions ?? []).map((key) => `${place}.${key}`)
}

/** A literal list or map row stores its element types beside its value (REQ-3.1.3.19). */
function rowElementTypes(row: VariableRow): ElementTypes | undefined {
  const typedRow = !row.isExpression && (row.type === 'array' || row.type === 'map')
  return typedRow ? row.elementTypes : undefined
}

/** What the rows write: values and flags at the `variables.<row>` places, and the types picked for the rows. */
export function slotsOf(rows: readonly VariableRow[]): SetterSlots {
  const slots: SetterSlots = {
    variables: {},
    expressionFields: [],
    templateFields: [],
    elementTypes: {},
    secretFields: [],
    rowTypes: {},
  }
  for (const row of rows) {
    if (!row.name) continue
    const place = `variables.${row.name}`
    // A literal dropped at open holds no value until one is given (FNCFG-9).
    if (row.value !== undefined) slots.variables[row.name] = row.value
    slots.rowTypes[row.name] = row.type
    slots.expressionFields.push(...rowExpressionFields(row, place))
    if (row.isTemplate) slots.templateFields.push(place)
    const elementTypes = rowElementTypes(row)
    if (elementTypes !== undefined) slots.elementTypes[place] = elementTypes
    if (row.isSecret) slots.secretFields.push(place)
  }
  return slots
}

/** The row on another type: a literal starts on the type default (VARSET-9), an expression is kept as written. */
function retyped(row: VariableRow, type: string): VariableRow {
  return {
    ...row,
    type,
    value: row.isExpression ? row.value : getDefaultValueForType(type as VariableType),
    isTemplate: false,
    entryExpressions: [],
    elementTypes: undefined,
    // A true / false value is never secret (SECUI-2).
    isSecret: type === 'boolean' ? false : row.isSecret,
  }
}

/** A row's new value: not set is null (REQ-3.1.3.21); an emptied literal number starts on its type default. */
function rowValueOf(row: VariableRow, value: unknown): unknown {
  if (value === undefined) return null
  const isNumber = row.type === 'integer' || row.type === 'float'
  const literalNumber = isNumber && !row.isExpression && row.isTemplate !== true
  return value === '' && literalNumber ? getDefaultValueForType(row.type as VariableType) : value
}

function problemsOf(rows: readonly VariableRow[], availableVariables: AvailableVariable[]): RowProblems[] {
  const allNames = rows.map((row) => row.name)
  return rows.map((row, index) => rowProblems(row, allNames, index, availableVariables))
}

interface UseRowOperationsArgs {
  availableVariables: AvailableVariable[]
  onSlotsChange: (next: SetterSlots) => void
  onValidChange: (valid: boolean) => void
}

export function useRowOperations(
  rows: VariableRow[],
  setRows: (rows: VariableRow[]) => void,
  { availableVariables, onSlotsChange, onValidChange }: UseRowOperationsArgs,
) {
  // One event can change a row twice (a mode and its value): each change builds on the one before it.
  const latestRows = useRef(rows)
  useEffect(() => {
    latestRows.current = rows
  }, [rows])
  // The value fields' own findings (a list line that does not read), by row key.
  const cellErrors = useRef(new Map<string, string | null>())
  const autocompleteCloseRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(autocompleteCloseRef.current), [])
  const [openAutocomplete, setOpenAutocomplete] = useState<number | null>(null)
  const entryChange = useEntryChange()

  const revalidate = useCallback(
    (current: VariableRow[]) => {
      const rowsValid = problemsOf(current, availableVariables).every(
        (problems) => problems.name === null && problems.value === null,
      )
      const cellsValid = current.every((row) => !cellErrors.current.get(row.key))
      onValidChange(rowsValid && cellsValid)
    },
    [availableVariables, onValidChange],
  )

  const commit = (next: VariableRow[]) => {
    latestRows.current = next
    setRows(next)
    revalidate(next)
    onSlotsChange(slotsOf(next))
  }

  const updateRow = (index: number, change: (row: VariableRow) => VariableRow) => {
    const next = [...latestRows.current]
    next[index] = change(next[index])
    commit(next)
  }

  const handleCellValidation = useCallback(
    (rowKey: string, error: string | null) => {
      const errors = cellErrors.current
      if ((errors.get(rowKey) ?? null) === error) return
      errors.set(rowKey, error)
      revalidate(latestRows.current)
    },
    [revalidate],
  )

  const handleNameChange = (index: number, newName: string) => {
    const row = latestRows.current[index]
    // The type of an existing variable is read from its declaration, never a stored copy (VARSET-5).
    const existing = availableVariables.find((v) => v.name === newName)
    if (!existing) {
      updateRow(index, (current) => ({ ...current, name: newName }))
      return
    }
    const apply = () => updateRow(index, (current) => ({ ...retyped(current, existing.type), name: newName }))
    if (existing.type === row.type || row.isExpression) {
      apply()
      return
    }
    entryChange.requestType(row.type as VariableType, existing.type as VariableType, row.value, apply)
  }

  const handleNameBlur = (_index: number) => {
    // Delay closing so that a click on a popover suggestion can fire first
    clearTimeout(autocompleteCloseRef.current)
    autocompleteCloseRef.current = setTimeout(() => setOpenAutocomplete(null), 150)
  }

  const handleTypeChange = (index: number, newType: string) => {
    const row = latestRows.current[index]
    const apply = () => updateRow(index, (current) => retyped(current, newType))
    if (row.isExpression) {
      apply()
      return
    }
    entryChange.requestType(row.type as VariableType, newType as VariableType, row.value, apply)
  }

  const handleSecretToggle = (index: number) =>
    updateRow(index, (current) => ({ ...current, isSecret: current.isSecret !== true }))

  const handleRowValue = (index: number, value: unknown) =>
    updateRow(index, (current) => ({ ...current, value: rowValueOf(current, value) }))

  const handleRowModes = (index: number, patch: Partial<VariableRow>) =>
    updateRow(index, (current) => ({ ...current, ...patch }))

  const handleDelete = (index: number) => {
    const left = latestRows.current.filter((_, i) => i !== index)
    commit(left.length === 0 ? [newSetterRow()] : left)
  }

  const handleAdd = () => {
    const next = [...latestRows.current, newSetterRow()]
    latestRows.current = next
    setRows(next)
    revalidate(next)
  }

  // Filtered autocomplete suggestions
  const getFilteredSuggestions = (input: string, currentIndex: number): AvailableVariable[] => {
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
      suggestions = suggestions.filter((v) => v.name.toLowerCase().includes(lower))
    }

    return suggestions
  }

  // Check if a variable is from the existing store (not new)
  const isExistingVariable = (name: string): boolean => availableVariables.some((v) => v.name === name)

  return {
    problems: problemsOf(rows, availableVariables),
    entryChange,
    openAutocomplete,
    setOpenAutocomplete,
    revalidate,
    handleCellValidation,
    handleNameChange,
    handleNameBlur,
    handleTypeChange,
    handleSecretToggle,
    handleRowValue,
    handleRowModes,
    handleDelete,
    handleAdd,
    getFilteredSuggestions,
    isExistingVariable,
  }
}
