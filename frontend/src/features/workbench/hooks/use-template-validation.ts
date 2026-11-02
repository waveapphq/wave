/**
 * Template validation hook shared by the Text Editor Modal and the inspect-modal
 * string watcher.
 *
 * Validates {{expr}} regions in template mode, producing decoration issues
 * (underlines) and validation tooltips using the shared expression validator.
 */

import { useMemo } from 'react'
import type { Extension } from '@codemirror/state'
import { createTemplateHighlighter, type DecorationIssue } from '@/features/workbench/lib/codemirror/expression-decorations'
import { createValidationTooltip } from '@/features/workbench/lib/codemirror/expression-tooltips'
import { validateExpressions, type ValidationIssue } from '@/features/workbench/lib/expression-validation'
import {
  notCheckedMessage,
  useExpressionValidator,
} from '@/features/workbench/hooks/use-expression-validator'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'

export interface UseTemplateValidationResult {
  templateHighlighter: Extension | null
  templateTooltip: Extension | null
}

export function useTemplateValidation(
  isTemplateMode: boolean,
  localValue: string,
  availableVariables: AvailableVariable[] | undefined,
): UseTemplateValidationResult {
  // Without the parser no {{ }} region is checked, and the template says so
  // rather than rendering the clean look an empty issue list would give it.
  const { ready: treeSitterReady, failure: validatorFailure } =
    useExpressionValidator(isTemplateMode)

  // Validate expressions inside {{ }} regions (same validator as expression fields)
  const availableVarNames = useMemo(
    () => new Set((availableVariables ?? []).map((v) => v.name)),
    [availableVariables]
  )
  const variableTypes = useMemo(
    () => new Map((availableVariables ?? []).map((v) => [v.name, v.type])),
    [availableVariables]
  )

  // Validate expressions inside {{ }} regions - keep full ValidationIssue[] for tooltips
  const templateValidationIssues: ValidationIssue[] = useMemo(() => {
    if (!isTemplateMode) return []
    const issues: ValidationIssue[] = []
    let searchFrom = 0
    while (searchFrom < localValue.length) {
      const openIdx = localValue.indexOf('{{', searchFrom)
      if (openIdx === -1) break
      const contentStart = openIdx + 2
      const closeIdx = localValue.indexOf('}}', contentStart)
      /* v8 ignore next - COV-DEF-105 */
      if (closeIdx === -1) break
      const exprContent = localValue.slice(contentStart, closeIdx)
      searchFrom = closeIdx + 2
      /* v8 ignore next - COV-DEF-106 */
      if (exprContent.length === 0) continue
      const exprOffset = contentStart
      if (validatorFailure) {
        issues.push({
          type: 'not_validated',
          from: exprOffset,
          to: exprOffset + exprContent.length,
          message: notCheckedMessage(validatorFailure),
          identifier: exprContent.trim(),
        })
        continue
      }
      // Validate using the same function as expression fields
      const exprIssues = validateExpressions(exprContent, availableVarNames, variableTypes, false)
      // Map positions from expression-local to document-global
      for (const issue of exprIssues) {
        issues.push({
          ...issue,
          from: issue.from + exprOffset,
          to: issue.to + exprOffset,
        })
      }
    }
    return issues
  }, [
    isTemplateMode,
    localValue,
    availableVarNames,
    variableTypes,
    treeSitterReady,
    validatorFailure,
  ])

  // Derive decoration issues from validation issues (for underlines)
  const templateDecorationIssues: DecorationIssue[] = useMemo(
    () => templateValidationIssues.map((i) => ({
      from: i.from,
      to: i.to,
      severity: i.type === 'invalid_function' || i.type === 'blocked_function' ? 'error' : 'warning',
    })),
    [templateValidationIssues]
  )

  // Template highlighter (cyan highlights + validation underlines inside {{ }})
  const templateHighlighter = useMemo(
    () => isTemplateMode ? createTemplateHighlighter(templateDecorationIssues) : null,
    [isTemplateMode, templateDecorationIssues]
  )

  // Hover tooltips for validation issues (same as expression field)
  const templateTooltip = useMemo(
    () => isTemplateMode ? createValidationTooltip(templateValidationIssues) : null,
    [isTemplateMode, templateValidationIssues]
  )

  return { templateHighlighter, templateTooltip }
}
