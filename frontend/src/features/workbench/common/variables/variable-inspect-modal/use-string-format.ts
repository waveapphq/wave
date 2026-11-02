/**
 * useStringFormat - the read-only string Format view of a watcher, reset to Auto on open.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import type { Extension } from '@codemirror/state'

import type { TextFormat, ResolvedFormat } from '@/lib/codemirror/format-editor'
import { useTemplateExtensions } from '@/features/workbench/hooks/use-template-extensions'
import { useTransientFormat } from './use-transient-format'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import type { InspectMode } from './mode-dropdown'

// Only a real string survives: a mismatched runtime object would otherwise stringify to '[object Object]'.
function resolveShownString(
  mode: InspectMode,
  hasRuntimeValue: boolean,
  runtimeValue: unknown,
  definitionValue: unknown,
): string {
  const value = mode === 'current' && hasRuntimeValue ? runtimeValue : definitionValue
  return typeof value === 'string' ? value : ''
}

export interface StringFormatControl {
  format: TextFormat
  detectedFormat: ResolvedFormat
  showFormatControl: boolean
  resolvedFormat: ResolvedFormat
  stringFormat: ResolvedFormat | undefined
  stringExtraExtensions: Extension[] | undefined
  onFormatChange: (next: TextFormat) => void
}

export interface UseStringFormatParams {
  variable: Variable
  isExpression: boolean
  isComplex: boolean
  /** The variable is a template kind: its {{ }} source carries the template highlight stack. */
  isTemplate: boolean
  mode: InspectMode
  hasRuntimeValue: boolean
  runtimeValue: unknown
  availableVariables: AvailableVariable[]
}

export function useStringFormat({
  variable,
  isExpression,
  isComplex,
  isTemplate,
  mode,
  hasRuntimeValue,
  runtimeValue,
  availableVariables,
}: UseStringFormatParams): StringFormatControl {
  const isLiteralString = !isComplex && !isExpression && !isTemplate && variable.type === 'string'
  const showFormatControl = isLiteralString && mode !== 'compare'
  // A template highlights its {{ }} source, never the rendered runtime output.
  const shownStr = resolveShownString(mode, hasRuntimeValue && !isTemplate, runtimeValue, variable.value)

  const { format, setFormat, detectedFormat, resolvedFormat } = useTransientFormat(shownStr, showFormatControl)

  const stringExtraExtensions = useTemplateExtensions(isTemplate, shownStr, availableVariables)
  const stringFormat = showFormatControl ? resolvedFormat : undefined

  return {
    format,
    detectedFormat,
    showFormatControl,
    resolvedFormat,
    stringFormat,
    stringExtraExtensions,
    onFormatChange: setFormat,
  }
}
