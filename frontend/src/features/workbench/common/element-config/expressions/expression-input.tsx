/**
 * ExpressionInput - a single-line CodeMirror editor for expressions and {{ }} templates (REQ-3.1.3.15).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { EditorView, placeholder as placeholderExt, ViewPlugin, tooltips } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { completionStatus, closeCompletion } from '@codemirror/autocomplete'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useCanvasReadOnly } from '@/features/workbench/common/canvas/read-only-context'
import { validateExpressions } from '@/features/workbench/lib/expression-validation/validation'
import {
  notCheckedMessage,
  useExpressionValidator,
} from '@/features/workbench/hooks/use-expression-validator'
import {
  createExpressionCompletionSource,
  createTemplateCompletionSource,
} from '@/features/workbench/lib/codemirror/expression-completion'
import { useTemplateValidation } from '@/features/workbench/hooks/use-template-validation'
import { useFunctionScope } from '@/features/functions/canvas/use-function-scope'
import { createExpressionHighlighter, type DecorationIssue } from '@/features/workbench/lib/codemirror/expression-decorations'
import { createValidationTooltip } from '@/features/workbench/lib/codemirror/expression-tooltips'
import {
  expressionEditorTheme,
  expressionHighlightTheme,
  autocompleteDropdownTheme,
} from '@/features/workbench/lib/codemirror/expression-theme'
import { autocompleteWidthSync } from '@/features/workbench/lib/codemirror/autocomplete-width-sync'
import { registerEscapeHandler } from '@/features/workbench/lib/codemirror/escape-handler'
import { buildInlineExpressionKeymap } from '@/features/workbench/lib/codemirror/expression-keymaps'
import { suggestionList } from '@/features/workbench/lib/codemirror/suggestion-list'

// ============================================
// Types
// ============================================

export type { AvailableVariable } from '@/features/workbench/lib/codemirror/type-inference'

import type { AvailableVariable } from '@/features/workbench/lib/codemirror/type-inference'

interface ExpressionInputProps {
  name: string
  value: string
  onChange: (value: string) => void
  availableVariables: AvailableVariable[]
  isInvalid?: boolean
  onBlur?: () => void
  placeholder?: string
  onOpenFullEditor?: () => void
  /** If true, filter out mutating methods and constructors (read-only context) */
  isFieldExpression?: boolean
  /** Template source: only the {{ }} regions are expressions, and line breaks are kept. */
  template?: boolean
}

const NO_ISSUES: ReturnType<typeof validateExpressions> = []

// Keymap builder re-exported from shared module (used in extensions below)

// ============================================
// Single-line Extension
// ============================================

/** An edit adds no line: inserted line breaks are dropped, while a stored multi-line expression keeps its own. */
export const singleLineExtension = EditorState.transactionFilter.of((tr) => {
  if (tr.newDoc.lines <= tr.startState.doc.lines) return tr
  const insertedBreaks: Array<{ from: number; to: number }> = []
  tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
    const text = inserted.toString()
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
      insertedBreaks.push({ from: fromB + i, to: fromB + i + 1 })
    }
  })
  return [tr, { changes: insertedBreaks, sequential: true }]
})

// ============================================
// Inline editor-specific footer hint
// ============================================

// Inline editor-specific footer hint (not shared - text differs per editor)
const inlineFooterTheme = EditorView.theme({
  '.cm-tooltip-autocomplete::after': {
    content: '"Esc - close  |  Ctrl+E - full editor"',
    display: 'block',
    padding: '6px 10px',
    borderTop: '1px solid #333',
    fontSize: '11px',
    color: '#888',
    backgroundColor: '#1c1c1c',
    borderRadius: '0 0 6px 6px',
    pointerEvents: 'none',
  },
})

// The hint shows a not-set field's default, so it takes the one Text Muted gray (FIELD-2).
const placeholderTheme = EditorView.theme({
  '.cm-placeholder': { color: 'var(--color-text-muted)' },
})

// ============================================
// Fix autocomplete scroll - global wheel handler for tooltip at body level
// ============================================

// Global wheel event handler - attached once to document
let wheelHandlerAttached = false

function setupGlobalWheelHandler() {
  if (wheelHandlerAttached) return
  wheelHandlerAttached = true

  document.addEventListener(
    'wheel',
    (event) => {
      // Find if the event target is within an autocomplete tooltip
      const target = event.target as HTMLElement
      const tooltip = target.closest('.cm-tooltip-autocomplete')
      if (!tooltip) return

      const ul = tooltip.querySelector('ul')
      if (!ul) return

      // Manually scroll the list
      ul.scrollTop += event.deltaY
      event.preventDefault()
      event.stopPropagation()
    },
    { passive: false, capture: true }
  )
}

// Plugin that ensures global wheel handler is set up on first editor mount
const autocompleteScrollFix = ViewPlugin.define(() => {
  setupGlobalWheelHandler()
  return {}
})

// ============================================
// Main Component
// ============================================

export function ExpressionInput({
  name,
  value,
  onChange,
  availableVariables,
  isInvalid,
  onBlur,
  placeholder,
  onOpenFullEditor,
  isFieldExpression = false,
  template = false,
}: Readonly<ExpressionInputProps>) {
  const readOnly = useCanvasReadOnly()
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const [isFocused, setIsFocused] = useState(false)
  // Without the parser nothing is checked, so the field says so rather than
  // rendering the clean look an empty issue list would otherwise give it.
  const { ready: treeSitterReady, failure: validatorFailure, retry: retryValidator } =
    useExpressionValidator()

  // Create Set of variable names for O(1) lookup in validation
  const availableVariableNames = useMemo(
    () => new Set(availableVariables.map((v) => v.name)),
    [availableVariables]
  )

  // Create Map of variable names to types for type-aware validation
  const variableTypes = useMemo(
    () => new Map(availableVariables.map((v) => [v.name, v.type])),
    [availableVariables]
  )

  // Local validation - handles comprehensions, lambdas, etc. (no backend needed)
  // Re-runs when treeSitterReady changes to enable validation after WASM loads
  const validationIssues = useMemo(
    () =>
      template
        ? NO_ISSUES
        : validateExpressions(value, availableVariableNames, variableTypes, isFieldExpression),
    [template, value, availableVariableNames, variableTypes, isFieldExpression, treeSitterReady]
  )

  // Check if there are any issues
  const hasExpressionIssues = validationIssues.length > 0

  // Convert to decoration format
  const decorationIssues: DecorationIssue[] = useMemo(
    () =>
      validationIssues.map((i) => ({
        from: i.from,
        to: i.to,
        severity: i.type === 'unknown_variable' ? 'warning' : 'error',
      })),
    [validationIssues]
  )

  // Create the expression highlighter with issues
  const expressionHighlighter = useMemo(
    () => createExpressionHighlighter(decorationIssues),
    [decorationIssues]
  )

  // Create validation hover tooltip
  const validationTooltip = useMemo(
    () => createValidationTooltip(validationIssues),
    [validationIssues]
  )

  // Inside a Function, hide every external scope (system / regression /
  // suite / test) and only surface declared inputs, declared outputs, and
  // Function-local variables in autocomplete.
  const functionScope = useFunctionScope()
  const scopedAvailableVariables = useMemo(() => {
    if (!functionScope.insideFunction) return availableVariables
    return availableVariables.filter((v) => functionScope.allowedVarNames.has(v.name))
  }, [availableVariables, functionScope])

  // Build autocomplete function using shared completion source
  const completionSource = useMemo(
    () =>
      template
        ? createTemplateCompletionSource(scopedAvailableVariables, true)
        : createExpressionCompletionSource(scopedAvailableVariables, isFieldExpression),
    [template, scopedAvailableVariables, isFieldExpression]
  )

  const { templateHighlighter, templateTooltip } = useTemplateValidation(
    template,
    value,
    scopedAvailableVariables
  )

  // Register Escape handler via global capture-phase listener (registered at
  // module load time, guaranteed before Radix's useEffect listener).
  useEffect(() => {
    return registerEscapeHandler((e) => {
      const view = editorRef.current?.view
      if (!view) return false
      if (!(e.target instanceof HTMLElement) || !view.dom.contains(e.target)) return false

      if (completionStatus(view.state) === 'active') {
        closeCompletion(view)
      } else {
        view.contentDOM.blur()
      }
      return true
    })
  }, [])

  // Build extensions
  const extensions = useMemo(
    () => [
      expressionEditorTheme,
      expressionHighlightTheme,
      autocompleteDropdownTheme,
      inlineFooterTheme,
      template ? [] : singleLineExtension,
      templateHighlighter ?? expressionHighlighter,
      templateTooltip ?? validationTooltip,
      autocompleteScrollFix,
      autocompleteWidthSync,
      placeholderTheme,
      placeholder ? placeholderExt(placeholder) : [],
      // Render tooltips at body level to escape dialog overflow
      tooltips({ parent: document.body }),
      // Read-only history canvas: block edits but keep selection/copy and
      // autocomplete/tooltips working so users can still inspect.
      /* v8 ignore next - COV-BRANCH-198 */
      readOnly ? EditorState.readOnly.of(true) : [],
      suggestionList({
        override: [completionSource],
        activateOnTyping: true,
        defaultKeymap: false, // We handle keys manually
      }),
      buildInlineExpressionKeymap(onOpenFullEditor),
      EditorView.updateListener.of((update) => {
        if (update.focusChanged) {
          setIsFocused(update.view.hasFocus)
          if (!update.view.hasFocus) {
            onBlur?.()
          }
        }
      }),
    ],
    [
      template,
      completionSource,
      placeholder,
      onBlur,
      onOpenFullEditor,
      expressionHighlighter,
      validationTooltip,
      templateHighlighter,
      templateTooltip,
      readOnly,
    ]
  )

  const unchecked = validatorFailure !== null

  return (
    <div
      data-testid={`param-input-${name}`}
      className={cn(
        'rounded-md border bg-background',
        'transition-shadow min-w-0 w-full max-w-full overflow-hidden',
        isFocused && 'ring-2 ring-ring',
        isInvalid && 'border-destructive',
        !isInvalid && (hasExpressionIssues || unchecked) && 'border-amber-500',
        !isInvalid && !hasExpressionIssues && !unchecked && 'border-input'
      )}
    >
      <CodeMirror
        ref={editorRef}
        value={value}
        onChange={onChange}
        extensions={extensions}
        basicSetup={false}
        theme="none"
        className="min-w-0 [&_.cm-editor]:min-w-0 [&_.cm-scroller]:min-w-0"
      />
      {/* The status region stays mounted so a screen reader hears the banner appear. */}
      <output className={unchecked ? 'block' : 'sr-only'}>
        {validatorFailure && (
          <div
            data-testid={`param-input-${name}-not-checked`}
            className="flex items-start gap-1.5 border-t border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-600"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span className="min-w-0 flex-1 break-words">{notCheckedMessage(validatorFailure)}</span>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={retryValidator}>
              Try Again
            </Button>
          </div>
        )}
      </output>
    </div>
  )
}
