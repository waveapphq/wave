/**
 * Expression Editor Modal (Full Editor - Ctrl+E)
 *
 * CodeMirror 6-based Python expression editor with:
 * - Python syntax highlighting
 * - Autocomplete for workflow variables and Python builtins
 * - Real-time validation with error/warning highlighting and tooltips
 * - Type-aware method completion
 * - Keyboard shortcuts
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, AlertCircle } from 'lucide-react'
import { usePersistedModalWidth } from './use-persisted-modal-width'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { EditorView, lineNumbers, tooltips } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { suggestionList } from '@/features/workbench/lib/codemirror/suggestion-list'
import { singleLineExtension, type AvailableVariable } from './expression-input'
import { validateExpressions } from '@/features/workbench/lib/expression-validation/validation'
import type { ValidationIssue } from '@/features/workbench/lib/expression-validation/types'
import {
  notCheckedMessage,
  useExpressionValidator,
} from '@/features/workbench/hooks/use-expression-validator'
import {
  createExpressionCompletionSource,
  createTemplateCompletionSource,
} from '@/features/workbench/lib/codemirror/expression-completion'
import { useTemplateValidation } from '@/features/workbench/hooks/use-template-validation'
import { createExpressionHighlighter, type DecorationIssue } from '@/features/workbench/lib/codemirror/expression-decorations'
import { createValidationTooltip } from '@/features/workbench/lib/codemirror/expression-tooltips'
import {
  expressionEditorTheme,
  expressionHighlightTheme,
  autocompleteDropdownTheme,
  tooltipHostReset,
} from '@/features/workbench/lib/codemirror/expression-theme'
import { autocompleteWidthSync } from '@/features/workbench/lib/codemirror/autocomplete-width-sync'
import { buildModalExpressionKeymap } from '@/features/workbench/lib/codemirror/expression-keymaps'
import { useModalEscapeHandler } from '@/features/workbench/hooks/use-modal-escape'
import { useCanvasReadOnly } from '@/features/workbench/common/canvas/read-only-context'

// ============================================
// Types
// ============================================

interface ExpressionEditorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (value: string) => void
  availableVariables: AvailableVariable[]
  singleLine?: boolean
  title?: string
  /** If true, filter out mutating methods and constructors (read-only context). Defaults to true. */
  isFieldExpression?: boolean
  /** Called after applying changes - use to refocus the original field */
  onApply?: () => void
  /** Template source: only the {{ }} regions are checked and completed (REQ-3.1.3.15). */
  template?: boolean
}

interface ValidatedIssue {
  type: 'error' | 'warning'
  message: string
  identifier: string
  from: number
}

// ============================================
// CodeMirror Extensions
// ============================================

/** Modal-specific footer hint for autocomplete dropdown */
const modalFooterTheme = EditorView.theme({
  '.cm-tooltip-autocomplete::after': {
    content: '"Esc - close  |  Ctrl+Enter - apply"',
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

// ============================================
// Component
// ============================================

const DEFAULT_MODAL_WIDTH = 768
const MODAL_WIDTH_STORAGE_KEY = 'wave.expression-editor-modal.width'
const FALLBACK_TITLE = 'Edit expression'

export function ExpressionEditorModal({
  open,
  onOpenChange,
  value,
  onChange,
  availableVariables,
  singleLine = true,
  title,
  isFieldExpression = true,
  onApply,
  template = false,
}: Readonly<ExpressionEditorModalProps>) {
  const resolvedTitle = title?.trim() ? title : FALLBACK_TITLE
  const [modalWidth, setModalWidth] = usePersistedModalWidth(
    MODAL_WIDTH_STORAGE_KEY,
    DEFAULT_MODAL_WIDTH,
  )
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      resizeStartRef.current = { startX: e.clientX, startWidth: modalWidth }
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
    },
    [modalWidth],
  )
  const handleResizeMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const start = resizeStartRef.current
      if (!start) return
      const delta = e.clientX - start.startX
      setModalWidth(start.startWidth + delta)
    },
    [setModalWidth],
  )
  const handleResizeEnd = useCallback(() => {
    resizeStartRef.current = null
  }, [])
  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setModalWidth(modalWidth - 16)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setModalWidth(modalWidth + 16)
      }
    },
    [modalWidth, setModalWidth],
  )
  const readOnly = useCanvasReadOnly()
  const [localValue, setLocalValue] = useState(value)
  const [rawValidationIssues, setRawValidationIssues] = useState<ValidationIssue[]>([])
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  // Without the parser the editor checks nothing, so it says so instead of
  // showing the clean look an empty issue list would otherwise give it.
  const {
    ready: treeSitterReady,
    failure: validatorFailure,
    retry: retryValidator,
  } = useExpressionValidator()

  // Derive display issues (for error/warning messages below editor)
  const validationIssues: ValidatedIssue[] = useMemo(
    () =>
      rawValidationIssues.map((issue) => ({
        type: (issue.type === 'blocked_function' || issue.type === 'invalid_function'
          ? 'error'
          : 'warning'),
        message: issue.message + (issue.suggestion ? ` Did you mean '${issue.suggestion}'?` : ''),
        identifier: issue.identifier,
        from: issue.from,
      })),
    [rawValidationIssues]
  )

  // Compute errors and warnings
  const errors = useMemo(() => validationIssues.filter((i) => i.type === 'error'), [validationIssues])
  const warnings = useMemo(() => validationIssues.filter((i) => i.type === 'warning'), [validationIssues])
  const hasErrors = errors.length > 0

  // Convert validation issues for decorations (inline highlighting)
  const decorationIssues: DecorationIssue[] = useMemo(
    () =>
      rawValidationIssues.map((i) => ({
        from: i.from,
        to: i.to,
        severity: i.type === 'unknown_variable' ? 'warning' : 'error',
      })),
    [rawValidationIssues]
  )

  /** Run validation and update raw issues state */
  const runValidation = useCallback(
    (content: string) => {
      // A template's {{ }} regions are checked by the template highlighter, never as one expression.
      if (template || !content.trim()) {
        setRawValidationIssues([])
        return
      }
      const variableNames = new Set(availableVariables.map((v) => v.name))
      const variableTypes = new Map(availableVariables.map((v) => [v.name, v.type]))
      setRawValidationIssues(validateExpressions(content, variableNames, variableTypes, isFieldExpression))
    },
    [availableVariables, isFieldExpression, template]
  )

  // Sync local value when prop changes, or re-validate when tree-sitter becomes ready
  useEffect(() => {
    if (open) {
      setLocalValue(value)
      runValidation(value)
    }
  }, [value, open, availableVariables, isFieldExpression, treeSitterReady, runValidation])

  // Create expression highlighter with issues
  const expressionHighlighter = useMemo(
    () => createExpressionHighlighter(decorationIssues),
    [decorationIssues]
  )

  // Create validation hover tooltip
  const validationTooltip = useMemo(
    () => createValidationTooltip(rawValidationIssues),
    [rawValidationIssues]
  )

  // Shared completion source
  const completionSource = useMemo(
    () =>
      template
        ? createTemplateCompletionSource(availableVariables, true)
        : createExpressionCompletionSource(availableVariables, isFieldExpression, true),
    [template, availableVariables, isFieldExpression]
  )

  const { templateHighlighter, templateTooltip } = useTemplateValidation(
    template && open,
    localValue,
    availableVariables
  )

  /**
   * Handle value change in editor
   */
  const handleEditorChange = useCallback(
    (newValue: string) => {
      setLocalValue(newValue)
      runValidation(newValue)
    },
    [runValidation]
  )

  /**
   * Apply changes and close
   */
  /* v8 ignore start - COV-CONTAINER-028 */
  const handleApply = useCallback(() => {
    onChange(localValue)
    onOpenChange(false)
    // Focus back to original field after a short delay
    setTimeout(() => onApply?.(), 250)
  }, [localValue, onChange, onOpenChange, onApply])
  /* v8 ignore stop */

  /**
   * Cancel and close
   */
  /* v8 ignore start - COV-CONTAINER-029 */
  const handleCancel = useCallback(() => {
    setLocalValue(value)
    onOpenChange(false)
    // Focus back to original field after a short delay
    setTimeout(() => onApply?.(), 250)
  }, [value, onOpenChange, onApply])
  /* v8 ignore stop */

  /**
   * Check if changes were made
   */
  const hasChanges = localValue !== value

  /**
   * Try to close the modal, showing discard dialog if there are unsaved changes
   */
  const tryClose = useCallback(() => {
    if (hasChanges) {
      setShowDiscardDialog(true)
    } else {
      handleCancel()
    }
  }, [hasChanges, handleCancel])

  /**
   * Keep editing - close discard dialog and refocus editor
   */
  const handleKeepEditing = useCallback(() => {
    setShowDiscardDialog(false)
    setTimeout(() => editorRef.current?.view?.focus(), 50)
  }, [])

  /**
   * Discard changes and close
   */
  const handleDiscard = useCallback(() => {
    setShowDiscardDialog(false)
    setLocalValue(value)
    onOpenChange(false)
    // Focus back to simple field
    setTimeout(() => onApply?.(), 250)
  }, [value, onOpenChange, onApply])

  // Escape handler: close autocomplete or trigger tryClose
  useModalEscapeHandler(open, editorRef, tryClose)

  // Build CodeMirror extensions
  const extensions = useMemo(
    () => [
      expressionEditorTheme,
      expressionHighlightTheme,
      autocompleteDropdownTheme,
      autocompleteWidthSync,
      modalFooterTheme,
      templateHighlighter ?? expressionHighlighter,
      templateTooltip ?? validationTooltip,
      singleLine ? [] : lineNumbers(),
      singleLine ? singleLineExtension : [],
      tooltipHostReset,
      tooltips({ parent: document.body }),
      EditorView.contentAttributes.of({ 'aria-label': resolvedTitle }),
      // Read-only history canvas: block edits but keep selection/copy and
      // autocomplete/tooltips working so users can still inspect.
      /* v8 ignore next - COV-BRANCH-199 */
      readOnly ? EditorState.readOnly.of(true) : [],
      suggestionList({
        override: [completionSource],
        activateOnTyping: true,
        defaultKeymap: false,
      }),
      // Handle Ctrl+Enter with DOM event handlers for proper stopPropagation
      // (Escape is handled by useModalEscapeHandler hook)
      EditorView.domEventHandlers({
        keydown(event) {
          // Ctrl+Enter: apply changes
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            if (!hasErrors && !readOnly) {
              handleApply()
            }
            event.stopPropagation()
            event.preventDefault()
            return true
          }
          return false
        },
      }),
      // Autocomplete navigation keymaps (shared with inline editor)
      buildModalExpressionKeymap(singleLine),
    ],
    [
      completionSource,
      expressionHighlighter,
      validationTooltip,
      templateHighlighter,
      templateTooltip,
      singleLine,
      hasErrors,
      handleApply,
      readOnly,
      resolvedTitle,
    ]
  )

  /**
   * Intercept dialog close attempts to check for unsaved changes
   */
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      /* v8 ignore start - COV-RADIX-010 */
      if (newOpen) {
        onOpenChange(true)
      } else {
        tryClose()
      }
    },
    /* v8 ignore stop */
    [tryClose, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="p-0"
        style={{ width: `${modalWidth}px`, maxWidth: '90vw' }}
        data-testid="expression-editor-modal"
        hideCloseButton
        preventCloseOnClickOutside
        onCloseAutoFocus={(event) => {
          // Prevent Radix from restoring focus while the dialog's
          // `.cm-content` is still inside the about-to-be-aria-hidden
          // subtree. The `onApply` setTimeout in the close handlers
          // refocuses the originating expression field afterwards.
          event.preventDefault()
        }}
      >
        {/* Right-edge horizontal resize handle */}
        <button
          type="button"
          data-testid="expression-editor-modal-resize-handle"
          aria-label="Resize editor width"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onKeyDown={handleResizeKeyDown}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
        />
        <div className="p-6 space-y-4 min-w-0">
        <DialogHeader>
          <DialogTitle>{resolvedTitle}</DialogTitle>
          <DialogDescription>
            {template
              ? 'Edit template text; each {{ }} part is a Python expression with highlighting and autocomplete'
              : 'Edit Python expression with syntax highlighting and autocomplete'}
          </DialogDescription>
        </DialogHeader>

        {/* CodeMirror Editor */}
        <div
          className={`border rounded-lg min-w-0 w-full max-w-full overflow-hidden relative ${
            (() => {
              if (hasErrors) return 'border-destructive'
              if (warnings.length > 0) return 'border-amber-500/50'
              return 'border-border'
            })()
          }`}
        >
          <CodeMirror
            ref={editorRef}
            value={localValue}
            onChange={handleEditorChange}
            extensions={extensions}
            basicSetup={false}
            theme="none"
            className="min-w-0 [&_.cm-editor]:min-w-0 [&_.cm-scroller]:min-w-0"
            height={singleLine ? '80px' : '250px'}
            autoFocus
          />
        </div>

        {/* Validation unavailable: the status region stays mounted so a screen reader hears the banner appear */}
        <output className={validatorFailure ? 'block' : 'sr-only'}>
          {validatorFailure && (
            <div
              data-testid="expression-editor-not-checked"
              className="flex items-start gap-2 text-sm text-amber-500 bg-amber-500/10 rounded px-3 py-1.5"
            >
              <AlertTriangle aria-hidden="true" className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span className="min-w-0 flex-1">{notCheckedMessage(validatorFailure)}</span>
              <Button variant="link" size="sm" className="h-auto p-0 text-sm" onClick={retryValidator}>
                Try Again
              </Button>
            </div>
          )}
        </output>

        {/* Validation Messages: the live region stays mounted so a screen reader hears each new message */}
        <div
          data-testid="expression-editor-issues"
          aria-live="polite"
          className={errors.length > 0 || warnings.length > 0 ? 'space-y-1.5 max-h-24 overflow-y-auto' : 'sr-only'}
        >
          {errors.map((error) => (
            <div
              key={`error-${error.identifier}-${error.from}`}
              className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded px-3 py-1.5"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error.message}</span>
            </div>
          ))}
          {warnings.map((warning) => (
            <div
              key={`warning-${warning.identifier}-${warning.from}`}
              className="flex items-start gap-2 text-sm text-amber-500 bg-amber-500/10 rounded px-3 py-1.5"
            >
              <AlertTriangle aria-hidden="true" className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{warning.message}</span>
            </div>
          ))}
        </div>

        {/* Keyboard shortcuts */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Ctrl</kbd>
            <span className="mx-0.5">+</span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Space</kbd>
            <span className="ml-1">Autocomplete</span>
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Ctrl</kbd>
            <span className="mx-0.5">+</span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Enter</kbd>
            <span className="ml-1">Apply</span>
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Esc</kbd>
            <span className="ml-1">Close</span>
          </span>
        </div>

        <DialogFooter>
          {/* v8 ignore next 3 - COV-BRANCH-200 */}
          <Button variant="outline" onClick={readOnly ? handleCancel : tryClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button onClick={handleApply} disabled={hasErrors}>
              Apply
            </Button>
          )}
        </DialogFooter>
        </div>
      </DialogContent>

      {/* Unsaved changes confirmation dialog */}
      <Dialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <DialogContent
          className="max-w-md"
          onCloseAutoFocus={(event) => {
            // Don't let Radix restore focus into the outer modal's
            // CodeMirror - if we're here because Discard was clicked,
            // the outer modal itself is closing next and restoring
            // focus into its `.cm-content` would put focus inside the
            // soon-to-be-aria-hidden subtree (browser logs a warning).
            // We handle the post-close focus ourselves via onApply.
            event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes. What would you like to do?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleKeepEditing}>
              Keep Editing
            </Button>
            <Button variant="destructive" onClick={handleDiscard}>
              Discard
            </Button>
            <Button
              onClick={() => {
                setShowDiscardDialog(false)
                handleApply()
              }}
              disabled={hasErrors}
            >
              Apply Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
