/**
 * Expression Field
 *
 * A complete expression editing field that combines:
 * - ExpressionInput: Inline editing with smart autocomplete
 * - ExpressionEditorModal: Full editor modal for complex expressions
 *
 * This component provides the full "micro-IDE" experience for Python expressions.
 */

import { useState, useCallback, useRef } from 'react'
import { ExpressionInput, type AvailableVariable } from './expression-input'
import { ExpressionEditorModal } from './expression-editor-modal'

interface ExpressionFieldProps {
  /** Technical identifier - used for the input testid and autocomplete state key. Stable. */
  name: string
  /** User-facing name shown in the modal title. Falls back to `name`. */
  displayName?: string
  value: string
  onChange: (value: string) => void
  availableVariables: AvailableVariable[]
  isInvalid?: boolean
  onBlur?: () => void
  placeholder?: string
  /** If true, editor will be single-line mode */
  singleLine?: boolean
  /** If true, filter out mutating methods and constructors (read-only context). Defaults to true. */
  isFieldExpression?: boolean
  /** Template source ({{ }} regions); its full editor takes line breaks (REQ-3.1.3.15). */
  template?: boolean
  /** Controlled open of the full editor, so a host button can open it (FIELD-1). */
  editorOpen?: boolean
  onEditorOpenChange?: (open: boolean) => void
}

export function ExpressionField({
  name,
  displayName,
  value,
  onChange,
  availableVariables,
  isInvalid,
  onBlur,
  placeholder,
  singleLine = true,
  isFieldExpression = true,
  template = false,
  editorOpen,
  onEditorOpenChange,
}: Readonly<ExpressionFieldProps>) {
  const userFacingName = displayName ?? name
  const [ownEditorOpen, setOwnEditorOpen] = useState(false)
  const isEditorOpen = editorOpen ?? ownEditorOpen
  const setIsEditorOpen = useCallback(
    (open: boolean) => {
      setOwnEditorOpen(open)
      onEditorOpenChange?.(open)
    },
    [onEditorOpenChange],
  )
  const inputContainerRef = useRef<HTMLDivElement>(null)

  /* v8 ignore start - COV-CONTAINER-015 */
  const handleOpenFullEditor = useCallback(() => {
    setIsEditorOpen(true)
  }, [setIsEditorOpen])

  // Focus back to the input field after the modal's exit animation
  // completes. The Radix Dialog keeps aria-hidden on sibling subtrees
  // (which include this inline editor's ancestors) until the exit
  // animation finishes (~200 ms); refocusing sooner lands in an
  // aria-hidden subtree and trips the browser's focus-in-hidden
  // warning.
  const handleApply = useCallback(() => {
    const cmEditor = inputContainerRef.current?.querySelector('.cm-content') as HTMLElement | null
    cmEditor?.focus()
  }, [])
  /* v8 ignore stop */

  return (
    <>
      <div ref={inputContainerRef} className="w-full min-w-0">
        <ExpressionInput
          name={name}
          value={value}
          onChange={onChange}
          availableVariables={availableVariables}
          isInvalid={isInvalid}
          onBlur={onBlur}
          placeholder={placeholder}
          onOpenFullEditor={handleOpenFullEditor}
          isFieldExpression={isFieldExpression}
          template={template}
        />
      </div>

      <ExpressionEditorModal
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        value={value}
        onChange={onChange}
        availableVariables={availableVariables}
        singleLine={singleLine && !template}
        title={userFacingName.trim() ? `Edit ${userFacingName}` : undefined}
        isFieldExpression={isFieldExpression}
        onApply={handleApply}
        template={template}
      />
    </>
  )
}

// Re-export types for convenience
export type { AvailableVariable } from './expression-input'
