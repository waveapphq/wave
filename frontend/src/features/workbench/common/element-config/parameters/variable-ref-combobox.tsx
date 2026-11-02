/**
 * VariableRefCombobox - Variable reference combobox for input parameters.
 *
 * Shows available variables on Ctrl+Space, filtered by allowed types.
 * Used by ForEach collection parameter and future variable-reference parameters.
 *
 * Delegates rendering to VariableComboboxBase - this component handles
 * type-based filtering via allowedTypes.
 */

import { useMemo } from 'react'
import {
  VariableComboboxBase,
  type ComboboxVariable,
} from '../shared/variable-combobox-base'
import { useFunctionScope } from '@/features/functions/canvas/use-function-scope'

export function VariableRefCombobox({
  value,
  onChange,
  allowedTypes,
  availableVariables,
  existingOnly,
}: Readonly<{
  value: string
  onChange: (value: string) => void
  allowedTypes: string[]
  availableVariables: ComboboxVariable[]
  /** Reject free-text names: the value must be chosen from the dropdown. */
  existingOnly?: boolean
}>) {
  const functionScope = useFunctionScope()
  // Filter to only allowed types, then sort alphabetically.
  // Inside a Function additionally hide every external scope (system /
  // regression / suite / test) - only declared inputs, declared outputs,
  // and Function-local variables remain selectable.
  const compatibleVariables = useMemo(() => {
    const typeSet = new Set(allowedTypes)
    const filtered = availableVariables.filter((v) => {
      if (!typeSet.has(v.type)) return false
      if (functionScope.insideFunction && !functionScope.allowedVarNames.has(v.name)) return false
      return true
    })
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }, [availableVariables, allowedTypes, functionScope])

  return (
    <VariableComboboxBase
      value={value}
      onChange={onChange}
      variables={compatibleVariables}
      existingOnly={existingOnly}
    />
  )
}
