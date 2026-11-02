/**
 * ExpressionInput - template mode: a Template value's {{ }} source field (VMGR-74, REQ-3.1.3.15).
 *
 * The CodeMirror runtime is stubbed; the test asserts which completion source, checks and
 * extensions the field is built with.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const stubs = vi.hoisted(() => ({
  extensions: [] as unknown[],
  expressionCompletion: vi.fn((..._args: unknown[]) => 'expression-completion'),
  templateCompletion: vi.fn((..._args: unknown[]) => 'template-completion'),
  validateExpressions: vi.fn((..._args: unknown[]) => [] as unknown[]),
  templateValidation: vi.fn((active: boolean, ..._rest: unknown[]) => ({
    templateHighlighter: active ? 'template-highlighter' : null,
    templateTooltip: active ? 'template-tooltip' : null,
  })),
}))

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: ({ extensions }: { extensions: unknown[] }) => {
    stubs.extensions = extensions
    return null
  },
}))
vi.mock('@codemirror/view', () => ({
  EditorView: {
    theme: () => 'editor-theme',
    updateListener: { of: () => 'update-listener' },
  },
  placeholder: () => 'placeholder',
  ViewPlugin: { define: () => 'view-plugin' },
  tooltips: () => 'tooltips',
}))
vi.mock('@codemirror/state', () => ({
  EditorState: {
    transactionFilter: { of: () => 'single-line' },
    readOnly: { of: () => 'read-only' },
  },
}))
vi.mock('@codemirror/autocomplete', () => ({
  completionStatus: () => 'inactive',
  closeCompletion: () => undefined,
}))
vi.mock('@/features/workbench/lib/codemirror/expression-completion', () => ({
  createExpressionCompletionSource: stubs.expressionCompletion,
  createTemplateCompletionSource: stubs.templateCompletion,
}))
vi.mock('@/features/workbench/hooks/use-template-validation', () => ({
  useTemplateValidation: stubs.templateValidation,
}))
vi.mock('@/features/workbench/lib/expression-validation/validation', () => ({
  validateExpressions: stubs.validateExpressions,
}))
vi.mock('@/features/workbench/hooks/use-expression-validator', () => ({
  useExpressionValidator: () => ({ ready: true, failure: null, retry: () => undefined }),
  notCheckedMessage: () => '',
}))
vi.mock('@/features/workbench/lib/codemirror/expression-decorations', () => ({
  createExpressionHighlighter: () => 'expression-highlighter',
}))
vi.mock('@/features/workbench/lib/codemirror/expression-tooltips', () => ({
  createValidationTooltip: () => 'expression-tooltip',
}))
vi.mock('@/features/workbench/lib/codemirror/expression-theme', () => ({
  expressionEditorTheme: 'expression-editor-theme',
  expressionHighlightTheme: 'expression-highlight-theme',
  autocompleteDropdownTheme: 'autocomplete-theme',
}))
vi.mock('@/features/workbench/lib/codemirror/autocomplete-width-sync', () => ({
  autocompleteWidthSync: 'width-sync',
}))
vi.mock('@/features/workbench/lib/codemirror/escape-handler', () => ({
  registerEscapeHandler: () => () => undefined,
}))
vi.mock('@/features/workbench/lib/codemirror/expression-keymaps', () => ({
  buildInlineExpressionKeymap: () => 'inline-keymap',
}))
vi.mock('@/features/workbench/lib/codemirror/suggestion-list', () => ({
  suggestionList: () => 'suggestion-list',
}))
vi.mock('@/features/functions/canvas/use-function-scope', () => ({
  useFunctionScope: () => ({ insideFunction: false, allowedVarNames: new Set<string>() }),
}))

import { ExpressionInput } from '@/features/workbench/common/element-config/expressions/expression-input'

const VARIABLES = [
  { name: 'user', type: 'string' },
  { name: 'count', type: 'integer' },
]

function renderInput(template: boolean, value = 'Hello {{ user }}') {
  render(
    <ExpressionInput
      name="greeting"
      value={value}
      onChange={() => undefined}
      availableVariables={VARIABLES}
      template={template}
    />,
  )
  return screen.getByTestId('param-input-greeting')
}

beforeEach(() => {
  stubs.extensions = []
  stubs.expressionCompletion.mockClear()
  stubs.templateCompletion.mockClear()
  stubs.validateExpressions.mockReset()
  stubs.validateExpressions.mockReturnValue([])
  stubs.templateValidation.mockClear()
})

describe('ExpressionInput - template mode (REQ-3.1.3.15)', () => {
  it('completes the in-scope variables inside {{ }} only', () => {
    renderInput(true)
    expect(stubs.templateCompletion).toHaveBeenCalledWith(VARIABLES, true)
    expect(stubs.expressionCompletion).not.toHaveBeenCalled()
  })

  it('checks and highlights only the {{ }} regions of the text it shows', () => {
    renderInput(true)
    expect(stubs.templateValidation).toHaveBeenLastCalledWith(true, 'Hello {{ user }}', VARIABLES)
    expect(stubs.extensions).toContain('template-highlighter')
    expect(stubs.extensions).toContain('template-tooltip')
    expect(stubs.extensions).not.toContain('expression-highlighter')
    expect(stubs.extensions).not.toContain('expression-tooltip')
  })

  it('never checks the whole text as one Python expression, so valid template text keeps the plain border', () => {
    stubs.validateExpressions.mockReturnValue([
      { type: 'syntax_error', from: 0, to: 5, message: 'Invalid syntax', identifier: 'Hello' },
    ])
    const box = renderInput(true)
    expect(stubs.validateExpressions).not.toHaveBeenCalled()
    expect(box).toHaveClass('border-input')
    expect(box).not.toHaveClass('border-amber-500')
  })

  it('keeps the line breaks of a template', () => {
    renderInput(true, 'Dear {{ user }},\nthanks')
    expect(stubs.extensions).not.toContain('single-line')
  })
})

describe('ExpressionInput - expression mode keeps its own checks', () => {
  it('completes, checks and highlights the whole text as one expression on one line', () => {
    stubs.validateExpressions.mockReturnValue([
      { type: 'syntax_error', from: 0, to: 5, message: 'Invalid syntax', identifier: 'Hello' },
    ])
    const box = renderInput(false)
    expect(stubs.expressionCompletion).toHaveBeenCalled()
    expect(stubs.templateCompletion).not.toHaveBeenCalled()
    expect(stubs.templateValidation).toHaveBeenLastCalledWith(false, 'Hello {{ user }}', VARIABLES)
    expect(stubs.extensions).toEqual(
      expect.arrayContaining(['single-line', 'expression-highlighter', 'expression-tooltip']),
    )
    expect(stubs.extensions).not.toContain('template-highlighter')
    expect(box).toHaveClass('border-amber-500')
  })
})
