/**
 * Expression Tooltips Module
 *
 * Shared CodeMirror 6 hover tooltip for validation issues used by both
 * the inline expression editor (ExpressionInput) and the modal expression
 * editor for consistent validation tooltip display.
 *
 * Provides:
 * - A hover tooltip extension that shows styled tooltips for validation issues
 * - Error styling (red border, stop icon) for invalid/blocked function issues
 * - Warning styling (amber border, warning icon) for other issue types
 * - Suggestion highlighting in cyan when an issue includes a suggested fix
 */

import { hoverTooltip, type Tooltip, type EditorView } from '@codemirror/view'
import type { ValidationIssue } from '@/features/workbench/lib/expression-validation'

/**
 * Tooltip source function that checks whether the hover position falls within
 * any validation issue range and returns a styled Tooltip if so.
 *
 * Exported separately for direct unit testing. Production consumers should
 * use `createValidationTooltip` which wraps this in a `hoverTooltip` extension.
 */
export function validationTooltipSource(
  issues: ValidationIssue[]
): (_view: EditorView, pos: number) => Tooltip | null {
  return (_view: EditorView, pos: number): Tooltip | null => {
    for (const issue of issues) {
      if (pos >= issue.from && pos <= issue.to) {
        const isError = issue.type === 'invalid_function' || issue.type === 'blocked_function'
        const colorClass = isError ? 'cm-validation-tooltip-red' : 'cm-validation-tooltip-amber'
        const icon = isError ? '\u26D4' : '\u26A0\uFE0F'

        // Build message with optional suggestion highlighting
        let messageHtml = issue.message
        if (issue.suggestion) {
          // Highlight the suggestion in cyan
          messageHtml = messageHtml.replace(
            `'${issue.suggestion}'`,
            `<span class="cm-validation-tooltip-suggestion">${issue.suggestion}</span>`
          )
        }

        return {
          pos: issue.from,
          end: issue.to,
          above: true,
          create: () => {
            const dom = document.createElement('div')
            dom.className = `cm-validation-tooltip ${colorClass}`
            dom.innerHTML = `<span class="cm-validation-tooltip-icon">${icon}</span><span class="cm-validation-tooltip-message">${messageHtml}</span>`
            return { dom }
          },
        }
      }
    }

    return null
  }
}

/**
 * Creates a CodeMirror hover tooltip extension for validation issues.
 *
 * When the user hovers over a position that falls within a validation issue
 * range, a styled tooltip appears showing the issue message with:
 * - Error styling (red border, stop icon) for `invalid_function` / `blocked_function`
 * - Warning styling (amber border, warning icon) for other issue types
 * - Suggestion text highlighted in cyan when the issue includes a suggestion
 */
export function createValidationTooltip(issues: ValidationIssue[]) {
  return hoverTooltip(validationTooltipSource(issues), {
    hideOnChange: true,
    hoverTime: 200,
  })
}
