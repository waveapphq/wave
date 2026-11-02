/**
 * ExpressionInput - Function-scoped autocomplete.
 *
 * Contract:
 *   - When useFunctionScope().insideFunction is true, the autocomplete
 *     completion source is built from a filtered availableVariables list
 *     that contains only entries whose `name` is in
 *     useFunctionScope().allowedVarNames.
 *   - When useFunctionScope().insideFunction is false (or omitted), the
 *     full availableVariables list is used as-is (existing behavior).
 *
 * We assert at the unit-test boundary: the call into the completion-source
 * factory must receive the filtered list. The CodeMirror runtime itself is
 * mocked away because the autocomplete UI is exercised by Playwright; this
 * test isolates the wiring.
 *
 * REQ scope: REQ-3.1.1.5 (Function variable isolation at the authoring
 * surface).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// Capture invocations of createExpressionCompletionSource so the test can
// assert on the availableVariables it receives. Use vi.hoisted so the mock
// is initialized before the vi.mock factory runs (vi.mock is hoisted above
// imports).
const { createCompletionMock } = vi.hoisted(() => ({
  createCompletionMock: vi.fn<
    (availableVariables: unknown, isFieldExpression?: boolean) => () => unknown
  >(() => () => null),
}))
vi.mock('@/features/workbench/lib/codemirror/expression-completion', () => ({
  createExpressionCompletionSource: createCompletionMock,
}))

// Stub the CodeMirror React wrapper - we don't need a real editor here.
vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: () => null,
}))

// Stub heavy CodeMirror runtime modules so the component module loads.
vi.mock('@codemirror/view', () => ({
  EditorView: {
    theme: () => ({}),
    updateListener: { of: () => ({}) },
  },
  placeholder: () => ({}),
  ViewPlugin: { define: () => ({}) },
  tooltips: () => ({}),
}))
vi.mock('@codemirror/state', () => ({
  EditorState: {
    transactionFilter: { of: () => ({}) },
    readOnly: { of: () => ({}) },
  },
}))
vi.mock('@codemirror/autocomplete', () => ({
  autocompletion: () => ({}),
  completionStatus: () => 'inactive',
  closeCompletion: () => undefined,
}))

vi.mock('@/features/workbench/lib/expression-validation/validation', () => ({
  validateExpressions: () => [],
}))
vi.mock('@/features/workbench/lib/tree-sitter-init', () => ({
  initializeTreeSitter: () => Promise.resolve(),
  isInitialized: () => true,
}))
vi.mock('@/features/workbench/lib/codemirror/expression-decorations', () => ({
  createExpressionHighlighter: () => ({}),
}))
vi.mock('@/features/workbench/lib/codemirror/expression-tooltips', () => ({
  createValidationTooltip: () => ({}),
}))
vi.mock('@/features/workbench/lib/codemirror/expression-theme', () => ({
  expressionEditorTheme: {},
  expressionHighlightTheme: {},
  autocompleteDropdownTheme: {},
}))
vi.mock('@/features/workbench/lib/codemirror/autocomplete-width-sync', () => ({
  autocompleteWidthSync: {},
}))
vi.mock('@/features/workbench/lib/codemirror/escape-handler', () => ({
  registerEscapeHandler: () => () => undefined,
}))
vi.mock('@/features/workbench/lib/codemirror/expression-keymaps', () => ({
  buildInlineExpressionKeymap: () => ({}),
}))
vi.mock('@/features/workbench/common/canvas/read-only-context', () => ({
  useCanvasReadOnly: () => false,
}))

// useFunctionScope - the hook the modification reads from.
interface FunctionScope {
  insideFunction: boolean
  declaredInputNames: string[]
  declaredOutputNames: string[]
  allowedVarNames: Set<string>
}

const scopeStub: { current: FunctionScope } = {
  current: {
    insideFunction: false,
    declaredInputNames: [],
    declaredOutputNames: [],
    allowedVarNames: new Set(),
  },
}
vi.mock('@/features/functions/canvas/use-function-scope', () => ({
  useFunctionScope: () => scopeStub.current,
}))

import { ExpressionInput } from '@/features/workbench/common/element-config/expressions/expression-input'

interface AvailableVariable {
  name: string
  type: string
  source?: string
}

const AVAILABLE: AvailableVariable[] = [
  { name: 'user_id', type: 'string' },
  { name: 'count', type: 'integer' },
  { name: 'result', type: 'string' },
  { name: 'tmp', type: 'integer' },
  { name: 'system_user', type: 'string', source: 'System' },
]

beforeEach(() => {
  createCompletionMock.mockClear()
  scopeStub.current = {
    insideFunction: false,
    declaredInputNames: [],
    declaredOutputNames: [],
    allowedVarNames: new Set(),
  }
})

describe('ExpressionInput - autocomplete scope filtering', () => {
  it('passes the FULL availableVariables list to the completion source when not inside a Function', () => {
    render(
      <ExpressionInput
        name="test"
        value=""
        onChange={() => undefined}
        availableVariables={AVAILABLE}
      />,
    )

    expect(createCompletionMock).toHaveBeenCalled()
    const passed = createCompletionMock.mock.calls[0][0] as AvailableVariable[]
    const names = passed.map((v) => v.name).sort()
    expect(names).toEqual(['count', 'result', 'system_user', 'tmp', 'user_id'])
  })

  it('passes a FILTERED list to the completion source when inside a Function', () => {
    scopeStub.current = {
      insideFunction: true,
      declaredInputNames: ['user_id', 'count'],
      declaredOutputNames: ['result'],
      allowedVarNames: new Set(['user_id', 'count', 'result', 'tmp']),
    }

    render(
      <ExpressionInput
        name="test"
        value=""
        onChange={() => undefined}
        availableVariables={AVAILABLE}
      />,
    )

    expect(createCompletionMock).toHaveBeenCalled()
    const passed = createCompletionMock.mock.calls[0][0] as AvailableVariable[]
    const names = passed.map((v) => v.name).sort()
    expect(names).toEqual(['count', 'result', 'tmp', 'user_id'])
    // External (system) entry is filtered out.
    expect(names).not.toContain('system_user')
  })

  it('passes an empty list when inside a Function with no allowed names (defensive)', () => {
    scopeStub.current = {
      insideFunction: true,
      declaredInputNames: [],
      declaredOutputNames: [],
      allowedVarNames: new Set(),
    }

    render(
      <ExpressionInput
        name="test"
        value=""
        onChange={() => undefined}
        availableVariables={AVAILABLE}
      />,
    )

    expect(createCompletionMock).toHaveBeenCalled()
    const passed = createCompletionMock.mock.calls[0][0] as AvailableVariable[]
    expect(passed).toEqual([])
  })
})
