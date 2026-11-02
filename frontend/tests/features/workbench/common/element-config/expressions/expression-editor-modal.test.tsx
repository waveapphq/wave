/**
 * Expression Editor Modal Tests
 *
 * Tests for the CodeMirror 6-based Python expression editor modal (Ctrl+E full editor).
 * In single-line mode it uses the inline field's one single-line filter, so a stored
 * multi-line expression keeps its line breaks after an edit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'

// The parser load is the hook's own contract (tested in
// tests/features/workbench/hooks/use-expression-validator.test.ts); here it is
// driven directly so the modal's not-checked state can be rendered on demand.
const validator = vi.hoisted(() => ({
  current: {
    ready: true,
    failure: null as { message: string } | null,
    retry: vi.fn(),
  },
}))

vi.mock('@/features/workbench/hooks/use-expression-validator', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/workbench/hooks/use-expression-validator')>()
  return { ...actual, useExpressionValidator: () => validator.current }
})

// Counts the edits that pass through the inline field's one exported single-line filter.
const sharedFilter = vi.hoisted(() => ({ edits: 0 }))

vi.mock(
  '@/features/workbench/common/element-config/expressions/expression-input',
  async (importOriginal) => {
    const actual =
      await importOriginal<typeof import('@/features/workbench/common/element-config/expressions/expression-input')>()
    const { EditorState } = await import('@codemirror/state')
    return {
      ...actual,
      singleLineExtension: [
        actual.singleLineExtension,
        EditorState.transactionFilter.of((tr) => {
          if (tr.docChanged) sharedFilter.edits += 1
          return tr
        }),
      ],
    }
  },
)

import { ExpressionEditorModal } from '@/features/workbench/common/element-config/expressions/expression-editor-modal'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-input'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the CodeMirror EditorView instance from the DOM.
 */
function getEditorView(): EditorView | null {
  const cmEditor = document.querySelector('.cm-editor')
  if (!cmEditor) return null
  return EditorView.findFromDOM(cmEditor as HTMLElement) ?? null
}

/**
 * Replace all content in the CodeMirror editor, triggering onChange.
 */
function setEditorContent(content: string) {
  const view = getEditorView()
  if (!view) throw new Error('CodeMirror EditorView not found in DOM')
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  })
}

// ============================================================================
// Test Suite
// ============================================================================

describe('ExpressionEditorModal', () => {
  const defaultVariables: AvailableVariable[] = [
    { name: 'endpoint', type: 'string', description: 'API endpoint' },
    { name: 'api_key', type: 'string' },
    { name: 'count', type: 'integer' },
    { name: 'items', type: 'list', description: 'List of items' },
    { name: 'config', type: 'dict' },
  ]

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    value: '',
    onChange: vi.fn(),
    availableVariables: defaultVariables,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    validator.current = { ready: true, failure: null, retry: vi.fn() }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // Rendering
  // ==========================================================================

  describe('Rendering', () => {
    it('renders modal when open', async () => {
      render(<ExpressionEditorModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
      })
    })

    it('does not render modal when closed', () => {
      render(<ExpressionEditorModal {...defaultProps} open={false} />)

      expect(screen.queryByTestId('expression-editor-modal')).not.toBeInTheDocument()
    })

    it('displays the default fallback title when none is provided', async () => {
      // The default fallback is "Edit expression". Call sites pass meaningful
      // names like "Edit url" / "Edit assertion" instead.
      render(<ExpressionEditorModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('Edit expression')).toBeInTheDocument()
      })
    })

    it('displays custom title when provided', async () => {
      render(<ExpressionEditorModal {...defaultProps} title="Edit Condition" />)

      await waitFor(() => {
        expect(screen.getByText('Edit Condition')).toBeInTheDocument()
      })
    })

    it('shows keyboard shortcut hints', async () => {
      render(<ExpressionEditorModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('Autocomplete')).toBeInTheDocument()
        expect(screen.getAllByText('Apply').length).toBeGreaterThan(0)
        expect(screen.getByText('Close')).toBeInTheDocument()
      })
    })

    it('renders Apply and Cancel buttons', async () => {
      render(<ExpressionEditorModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Apply/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()
      })
    })

    it('renders CodeMirror editor', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(document.querySelector('.cm-editor')).toBeInTheDocument()
      })
    })
  })

  // ==========================================================================
  // Validation Display
  // ==========================================================================

  describe('Validation Display', () => {
    it('shows error message for blocked functions', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="eval('code')" />)

      await waitFor(() => {
        expect(screen.getByText(/eval.*is not supported/i)).toBeInTheDocument()
      })
    })

    it('shows warning message for unknown variables', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="unknown_var" />)

      await waitFor(() => {
        expect(screen.getByText(/Variable 'unknown_var' is not defined/)).toBeInTheDocument()
      })
    })

    it('shows no warnings for valid expressions', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
      })

      expect(screen.queryByText(/is not defined/)).not.toBeInTheDocument()
      expect(screen.queryByText(/is not supported/)).not.toBeInTheDocument()
    })

    it('keeps a polite live region for validation messages while there are none', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      const region = await screen.findByTestId('expression-editor-issues')
      expect(region).toHaveAttribute('aria-live', 'polite')
      expect(region).toBeEmptyDOMElement()
    })

    it('puts a validation message inside the live region', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="eval('code')" />)

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-issues')).toHaveTextContent(/eval.*is not supported/i)
      })
    })

    it('shows suggestion for similar variable names', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoinnt" />)

      await waitFor(() => {
        expect(screen.getByText(/Did you mean 'endpoint'/)).toBeInTheDocument()
      })
    })

    it('disables Apply button when errors exist', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="eval('code')" />)

      await waitFor(() => {
        const applyButton = screen.getByRole('button', { name: /Apply/ })
        expect(applyButton).toBeDisabled()
      })
    })

    it('enables Apply button when only warnings exist', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="unknown_var" />)

      await waitFor(() => {
        const applyButton = screen.getByRole('button', { name: /Apply/ })
        expect(applyButton).not.toBeDisabled()
      })
    })

    it('enables Apply button when no issues exist', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        const applyButton = screen.getByRole('button', { name: /Apply/ })
        expect(applyButton).not.toBeDisabled()
      })
    })
  })

  // ==========================================================================
  // Validation Unavailable
  // ==========================================================================

  describe('Validation Unavailable', () => {
    it('shows no not-checked notice while the validator is loaded', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('expression-editor-not-checked')).not.toBeInTheDocument()
    })

    it('says the expression is not checked when the validator failed to load', async () => {
      validator.current = { ready: false, failure: { message: 'Failed to fetch' }, retry: vi.fn() }
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-not-checked')).toHaveTextContent(
          'Not checked - could not load expression validation. Failed to fetch',
        )
      })
    })

    it('Try Again loads the validator again', async () => {
      const user = userEvent.setup()
      const retry = vi.fn()
      validator.current = { ready: false, failure: { message: 'Failed to fetch' }, retry }
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-not-checked')).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: 'Try Again' }))

      expect(retry).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Apply and Cancel Actions
  // ==========================================================================

  describe('Apply and Cancel Actions', () => {
    it('calls onChange and onOpenChange when Apply clicked', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onOpenChange = vi.fn()

      render(
        <ExpressionEditorModal
          {...defaultProps}
          value="endpoint"
          onChange={onChange}
          onOpenChange={onOpenChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Apply/ })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Apply/ }))

      expect(onChange).toHaveBeenCalledWith('endpoint')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('calls onApply callback after applying', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onApply = vi.fn()

      render(
        <ExpressionEditorModal
          {...defaultProps}
          value="endpoint"
          onApply={onApply}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Apply/ })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Apply/ }))

      // onApply is called after a 250ms delay (past the Radix Dialog
      // exit animation, so the inline editor's aria-hidden ancestors
      // have been un-hidden before refocus)
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(onApply).toHaveBeenCalled()
    })

    it('calls onOpenChange when Cancel clicked without changes', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      const onChange = vi.fn()

      render(
        <ExpressionEditorModal
          {...defaultProps}
          value="endpoint"
          onOpenChange={onOpenChange}
          onChange={onChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Cancel/ }))

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Unsaved Changes Dialog
  // ==========================================================================

  describe('Unsaved Changes Dialog', () => {
    it('shows discard dialog when canceling with changes', async () => {
      const user = userEvent.setup()

      render(<ExpressionEditorModal {...defaultProps} value="original" />)

      // Wait for editor to mount
      await waitFor(() => {
        expect(document.querySelector('.cm-editor')).toBeInTheDocument()
      })

      // Change editor content
      act(() => {
        setEditorContent('modified value')
      })

      // Click Cancel
      await user.click(screen.getByRole('button', { name: /Cancel/ }))

      await waitFor(() => {
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
      })
    })

    it('Keep Editing closes dialog but modal stays open', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onOpenChange = vi.fn()

      render(
        <ExpressionEditorModal {...defaultProps} value="original" onOpenChange={onOpenChange} />
      )

      await waitFor(() => {
        expect(document.querySelector('.cm-editor')).toBeInTheDocument()
      })

      act(() => {
        setEditorContent('modified value')
      })

      await user.click(screen.getByRole('button', { name: /Cancel/ }))

      await waitFor(() => {
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Keep Editing/ }))

      await act(async () => {
        vi.advanceTimersByTime(100)
      })

      // Discard dialog should be closed but modal still open
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
      expect(onOpenChange).not.toHaveBeenCalled()
    })

    it('Discard closes everything', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onOpenChange = vi.fn()
      const onApply = vi.fn()

      render(
        <ExpressionEditorModal
          {...defaultProps}
          value="original"
          onOpenChange={onOpenChange}
          onApply={onApply}
        />
      )

      await waitFor(() => {
        expect(document.querySelector('.cm-editor')).toBeInTheDocument()
      })

      act(() => {
        setEditorContent('modified value')
      })

      await user.click(screen.getByRole('button', { name: /Cancel/ }))

      await waitFor(() => {
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Discard/ }))

      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onApply).toHaveBeenCalled()
    })

    it('Apply Changes in discard dialog applies and closes', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onOpenChange = vi.fn()

      render(
        <ExpressionEditorModal
          {...defaultProps}
          value="original"
          onChange={onChange}
          onOpenChange={onOpenChange}
        />
      )

      await waitFor(() => {
        expect(document.querySelector('.cm-editor')).toBeInTheDocument()
      })

      // Change to a valid expression
      act(() => {
        setEditorContent('endpoint')
      })

      await user.click(screen.getByRole('button', { name: /Cancel/ }))

      await waitFor(() => {
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Apply Changes/ }))

      expect(onChange).toHaveBeenCalledWith('endpoint')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('Apply Changes disabled in discard dialog when errors exist', async () => {
      const user = userEvent.setup()

      render(<ExpressionEditorModal {...defaultProps} value="original" />)

      await waitFor(() => {
        expect(document.querySelector('.cm-editor')).toBeInTheDocument()
      })

      // Change to expression with blocked function (error)
      act(() => {
        setEditorContent('eval("code")')
      })

      // Wait for validation to show errors
      await waitFor(() => {
        expect(screen.getByText(/eval.*is not supported/i)).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Cancel/ }))

      await waitFor(() => {
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
      })

      // Apply Changes should be disabled because there's an error
      const applyChangesButton = screen.getAllByRole('button', { name: /Apply/ })[0]
      expect(applyChangesButton).toBeDisabled()
    })
  })

  // ==========================================================================
  // Keyboard Shortcuts
  // ==========================================================================

  describe('Keyboard Shortcuts', () => {
    it('Ctrl+Enter applies changes', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onOpenChange = vi.fn()

      render(
        <ExpressionEditorModal
          {...defaultProps}
          value="endpoint"
          onChange={onChange}
          onOpenChange={onOpenChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
      })

      // Dispatch Ctrl+Enter keydown on the dialog content
      await user.keyboard('{Control>}{Enter}{/Control}')

      expect(onChange).toHaveBeenCalledWith('endpoint')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('Ctrl+Enter does NOT apply when errors exist', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <ExpressionEditorModal {...defaultProps} value="eval('code')" onChange={onChange} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
      })

      // Wait for validation to identify the error
      await waitFor(() => {
        expect(screen.getByText(/eval.*is not supported/i)).toBeInTheDocument()
      })

      await user.keyboard('{Control>}{Enter}{/Control}')

      expect(onChange).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Keymap Handlers
  // ==========================================================================

  describe('Keymap Handlers', () => {
    /**
     * Dispatch a keydown event directly on CodeMirror's content DOM.
     * This triggers CodeMirror's internal key dispatch system.
     */
    function dispatchKeyOnEditor(key: string, opts: KeyboardEventInit = {}) {
      const view = getEditorView()
      if (!view) throw new Error('Editor not found')
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...opts,
      })
      view.contentDOM.dispatchEvent(event)
      return event
    }

    it('Enter in single-line mode does not insert newline', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" singleLine={true} />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      const view = getEditorView()!
      const before = view.state.doc.toString()

      act(() => { dispatchKeyOnEditor('Enter') })

      expect(view.state.doc.toString()).toBe(before)
    })

    it('Tab key dispatch does not throw', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" singleLine={true} />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      act(() => { dispatchKeyOnEditor('Tab') })
    })

    it('Shift-Tab key dispatch does not throw', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" singleLine={true} />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      act(() => { dispatchKeyOnEditor('Tab', { shiftKey: true }) })
    })

    it('Enter in multi-line mode allows newlines', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="line1" singleLine={false} />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      act(() => { dispatchKeyOnEditor('Enter') })
    })

    it('ArrowDown without autocomplete is a no-op', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      act(() => { dispatchKeyOnEditor('ArrowDown') })
    })

    it('ArrowUp without autocomplete is a no-op', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      act(() => { dispatchKeyOnEditor('ArrowUp') })
    })

    it('PageDown without autocomplete is a no-op', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      act(() => { dispatchKeyOnEditor('PageDown') })
    })

    it('PageUp without autocomplete is a no-op', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      act(() => { dispatchKeyOnEditor('PageUp') })
    })

    it('Ctrl+Space dispatches on editor', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      act(() => { dispatchKeyOnEditor(' ', { ctrlKey: true }) })
    })

    it('strips newlines from pasted content in single-line mode', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="existing" singleLine={true} />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      const view = getEditorView()!
      act(() => {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: 'line1\nline2\nline3' },
        })
      })

      expect(view.state.doc.lines).toBe(1)
      expect(view.state.doc.toString()).toBe('line1line2line3')
    })
  })

  // ==========================================================================
  // Stored multi-line expressions
  // ==========================================================================

  describe('Stored multi-line expressions in single-line mode', () => {
    const STORED = 'total +\n  count'

    it('keeps the line breaks of a stored multi-line expression after the first edit', async () => {
      render(<ExpressionEditorModal {...defaultProps} value={STORED} singleLine={true} />)

      await waitFor(() => {
        expect(getEditorView()?.state.doc.toString()).toBe(STORED)
      })

      const view = getEditorView()!
      act(() => {
        view.dispatch({ changes: { from: view.state.doc.length, insert: '1' }, userEvent: 'input.type' })
      })

      expect(view.state.doc.toString()).toBe(`${STORED}1`)
    })

    it('applies the edited multi-line expression with its line breaks', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<ExpressionEditorModal {...defaultProps} value={STORED} onChange={onChange} singleLine={true} />)

      await waitFor(() => {
        expect(getEditorView()?.state.doc.toString()).toBe(STORED)
      })
      const view = getEditorView()!
      act(() => {
        view.dispatch({ changes: { from: view.state.doc.length, insert: '1' }, userEvent: 'input.type' })
      })
      await user.click(screen.getByRole('button', { name: /Apply/ }))

      expect(onChange).toHaveBeenCalledWith(`${STORED}1`)
    })

    it("runs its edits through the inline field's exported single-line filter", async () => {
      sharedFilter.edits = 0
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" singleLine={true} />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })
      const view = getEditorView()!
      act(() => {
        view.dispatch({ changes: { from: view.state.doc.length, insert: 's' }, userEvent: 'input.type' })
      })

      expect(sharedFilter.edits).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Escape Handler
  // ==========================================================================

  describe('Escape Handler', () => {
    it('Escape closes modal when no unsaved changes', async () => {
      const onOpenChange = vi.fn()

      render(
        <ExpressionEditorModal
          {...defaultProps}
          value="endpoint"
          onOpenChange={onOpenChange}
        />
      )

      await waitFor(() => {
        const view = getEditorView()
        expect(view).not.toBeNull()
      })

      const view = getEditorView()!

      act(() => {
        view.contentDOM.focus()
        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
        Object.defineProperty(event, 'target', { value: view.contentDOM })
        document.dispatchEvent(event)
      })

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('Escape handler skips when target is outside editor', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="endpoint" />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      const stopSpy = vi.fn()

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
        Object.defineProperty(event, 'target', { value: document.body })
        event.stopImmediatePropagation = stopSpy
        document.dispatchEvent(event)
      })

      // Handler returns false (target not in editor) so stopImmediatePropagation is not called
      expect(stopSpy).not.toHaveBeenCalled()
    })

    it('Escape shows discard dialog when there are unsaved changes', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="original" />)

      await waitFor(() => {
        expect(getEditorView()).not.toBeNull()
      })

      act(() => {
        setEditorContent('modified')
      })

      const view = getEditorView()!

      act(() => {
        view.contentDOM.focus()
        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
        Object.defineProperty(event, 'target', { value: view.contentDOM })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
      })
    })
  })

  // ==========================================================================
  // Validation Edge Cases
  // ==========================================================================

  describe('Validation Edge Cases', () => {
    it('empty expression is valid', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="" />)

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
      })

      expect(screen.queryByText(/is not defined/)).not.toBeInTheDocument()
      expect(screen.queryByText(/is not supported/)).not.toBeInTheDocument()
    })

    it('whitespace-only is valid', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="   " />)

      await waitFor(() => {
        expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
      })

      expect(screen.queryByText(/is not defined/)).not.toBeInTheDocument()
      expect(screen.queryByText(/is not supported/)).not.toBeInTheDocument()
    })

    it('revalidates on editor content change', async () => {
      render(<ExpressionEditorModal {...defaultProps} value="" />)

      await waitFor(() => {
        expect(document.querySelector('.cm-editor')).toBeInTheDocument()
      })

      // Initially no validation messages
      expect(screen.queryByText(/is not defined/)).not.toBeInTheDocument()

      // Change to expression with unknown variable (warning)
      act(() => {
        setEditorContent('unknown_var')
      })

      await waitFor(() => {
        expect(screen.getByText(/Variable 'unknown_var' is not defined/)).toBeInTheDocument()
      })

      // Change to valid expression
      act(() => {
        setEditorContent('endpoint')
      })

      await waitFor(() => {
        expect(screen.queryByText(/is not defined/)).not.toBeInTheDocument()
      })
    })

    it('revalidates on value prop change', async () => {
      const { rerender } = render(
        <ExpressionEditorModal {...defaultProps} open={true} value="endpoint" />
      )

      await waitFor(() => {
        expect(screen.queryByText(/is not defined/)).not.toBeInTheDocument()
      })

      // Change to value with unknown variable (warning)
      rerender(
        <ExpressionEditorModal {...defaultProps} open={true} value="unknown_var" />
      )

      await waitFor(() => {
        expect(screen.getByText(/Variable 'unknown_var' is not defined/)).toBeInTheDocument()
      })
    })
  })

  // ==========================================================================
  // Initial Value Sync
  // ==========================================================================

  describe('Initial Value Sync', () => {
    it('syncs local value when modal opens', async () => {
      const { rerender } = render(
        <ExpressionEditorModal {...defaultProps} open={false} value="initial" />
      )

      // Modal is closed
      expect(screen.queryByTestId('expression-editor-modal')).not.toBeInTheDocument()

      // Open the modal with updated value
      rerender(<ExpressionEditorModal {...defaultProps} open={true} value="updated" />)

      await waitFor(() => {
        const view = getEditorView()
        expect(view).not.toBeNull()
        expect(view!.state.doc.toString()).toBe('updated')
      })
    })

    it('revalidates when value prop changes while open', async () => {
      const { rerender } = render(
        <ExpressionEditorModal {...defaultProps} open={true} value="endpoint" />
      )

      await waitFor(() => {
        expect(screen.queryByText(/is not defined/)).not.toBeInTheDocument()
        expect(screen.queryByText(/is not supported/)).not.toBeInTheDocument()
      })

      // Change to value with unknown variable (warning)
      rerender(
        <ExpressionEditorModal {...defaultProps} open={true} value="unknown_var" />
      )

      await waitFor(() => {
        expect(screen.getByText(/Variable 'unknown_var' is not defined/)).toBeInTheDocument()
      })
    })
  })
})
