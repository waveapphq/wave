/**
 * ExpressionEditorModal - template mode: the full editor of a Template value's {{ }} source (VMGR-74, REQ-3.1.3.15).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'

vi.mock('@/features/workbench/hooks/use-expression-validator', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/workbench/hooks/use-expression-validator')>()
  return {
    ...actual,
    useExpressionValidator: () => ({ ready: true, failure: null, retry: () => undefined }),
  }
})

import { ExpressionEditorModal } from '@/features/workbench/common/element-config/expressions/expression-editor-modal'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-input'

const VARIABLES: AvailableVariable[] = [{ name: 'user', type: 'string' }]
// Whole-text Python checks refuse this; as a template it is plain text plus one {{ }} part.
const TEMPLATE_TEXT = "Hi {{ user }}, eval('x') is just text"

function editorView(): EditorView {
  const editor = document.querySelector('.cm-editor')
  if (!editor) throw new Error('CodeMirror editor not found')
  const view = EditorView.findFromDOM(editor as HTMLElement)
  if (!view) throw new Error('CodeMirror view not found')
  return view
}

function renderModal(template: boolean, onChange = vi.fn()) {
  render(
    <ExpressionEditorModal
      open
      onOpenChange={vi.fn()}
      value={TEMPLATE_TEXT}
      onChange={onChange}
      availableVariables={VARIABLES}
      singleLine={!template}
      title="Edit greeting"
      template={template}
    />,
  )
  return onChange
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ExpressionEditorModal - template mode (REQ-3.1.3.15)', () => {
  it('says it edits template text', async () => {
    renderModal(true)
    expect(
      await screen.findByText(
        /^Edit template text; each \{\{ \}\} part is a Python expression with highlighting and autocomplete$/,
      ),
    ).toBeInTheDocument()
  })

  it('never checks the whole text as one Python expression, so Apply stays enabled', async () => {
    renderModal(true)
    const issues = await screen.findByTestId('expression-editor-issues')
    expect(issues).toBeEmptyDOMElement()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()
  })

  it('applies a template written over several lines with its line breaks', async () => {
    const user = userEvent.setup()
    const onChange = renderModal(true)
    await screen.findByTestId('expression-editor-modal')
    const view = editorView()
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Dear {{ user }},\nthanks' } })
    })
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith('Dear {{ user }},\nthanks')
  })

  it('checks the same text as one Python expression outside template mode', async () => {
    renderModal(false)
    await waitFor(() =>
      expect(screen.getByTestId('expression-editor-issues')).toHaveTextContent(/eval.*is not supported/i),
    )
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })
})
