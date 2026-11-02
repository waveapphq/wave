/**
 * useTemplateExtensions - the host-composed {{ }} template CodeMirror stack
 * (autocomplete + highlight + validation tooltip), shared by the inspect modal's
 * string Format control and the variable create modal so both render template
 * source identically. Returns undefined when inactive (a non-template string
 * body passes no extra extensions).
 *
 * REQ-3.1.3.15: Template variables
 */

import { useMemo } from 'react'
import type { Extension } from '@codemirror/state'

import { createTemplateCompletionSource } from '@/features/workbench/lib/codemirror/expression-completion'
import { useTemplateValidation } from '@/features/workbench/hooks/use-template-validation'
import { buildTemplateExtensions } from '@/features/workbench/lib/codemirror/template-editor'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'

export function useTemplateExtensions(
  active: boolean,
  sourceText: string,
  availableVariables: AvailableVariable[],
): Extension[] | undefined {
  const completionSource = useMemo(
    () => createTemplateCompletionSource(availableVariables, true),
    [availableVariables],
  )
  const { templateHighlighter, templateTooltip } = useTemplateValidation(
    active,
    sourceText,
    availableVariables,
  )
  return useMemo(
    () =>
      active
        ? buildTemplateExtensions({
            completionSource,
            templateHighlighter,
            templateTooltip,
            // body-parent so the {{}} autocomplete escapes the sheet's clipped edges.
            tooltipParent: document.body,
          })
        : undefined,
    [active, completionSource, templateHighlighter, templateTooltip],
  )
}
