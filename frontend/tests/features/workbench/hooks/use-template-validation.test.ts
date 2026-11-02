/**
 * useTemplateValidation tests.
 *
 * The {{ }} template validation hook (shared by the inspect-modal string watcher
 * and the "Edit value" sheet's template kind). Covers the tree-sitter init effect
 * + the {{ }} region scan; the heavy CodeMirror / tree-sitter deps are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const initializeTreeSitter = vi.fn<() => Promise<unknown>>(() => Promise.resolve({}))
let initialized = false

vi.mock('@/features/workbench/lib/tree-sitter-init', () => ({
  isInitialized: () => initialized,
  initializeTreeSitter: () => initializeTreeSitter(),
}))
vi.mock('@/features/workbench/lib/codemirror/expression-decorations', () => ({
  createTemplateHighlighter: vi.fn(() => ({ extension: 'highlighter' })),
}))
vi.mock('@/features/workbench/lib/codemirror/expression-tooltips', () => ({
  createValidationTooltip: vi.fn(() => ({ extension: 'tooltip' })),
}))
vi.mock('@/features/workbench/lib/expression-validation', () => ({
  // One unknown_variable (severity 'warning') + one error-severity type so both
  // branches of the decoration-severity ternary are exercised.
  validateExpressions: vi.fn(() => [
    { from: 0, to: 4, type: 'unknown_variable', message: 'unknown' },
    { from: 5, to: 9, type: 'invalid_function', message: 'bad' },
  ]),
}))

import { createTemplateHighlighter } from '@/features/workbench/lib/codemirror/expression-decorations'
import { createValidationTooltip } from '@/features/workbench/lib/codemirror/expression-tooltips'
import { validateExpressions } from '@/features/workbench/lib/expression-validation'
import { useTemplateValidation } from '@/features/workbench/hooks/use-template-validation'

const VARS = [{ name: 'name', type: 'string' }] as never

beforeEach(() => {
  vi.clearAllMocks()
  initializeTreeSitter.mockResolvedValue({})
})

describe('useTemplateValidation', () => {
  it('initializes tree-sitter when entering template mode uninitialized', async () => {
    initialized = false
    renderHook(() => useTemplateValidation(true, 'Hi {{ name }}', VARS))
    await waitFor(() => expect(initializeTreeSitter).toHaveBeenCalled())
  })

  it('does not re-initialize tree-sitter when already initialized', () => {
    initialized = true
    renderHook(() => useTemplateValidation(true, 'Hi {{ name }}', VARS))
    expect(initializeTreeSitter).not.toHaveBeenCalled()
  })

  it('builds the highlighter + tooltip extensions and validates {{ }} regions', () => {
    initialized = true
    const { result } = renderHook(() => useTemplateValidation(true, 'Hi {{ name }}', VARS))
    expect(result.current.templateHighlighter).not.toBeNull()
    expect(result.current.templateTooltip).not.toBeNull()
  })

  it('returns null extensions and skips validation when not in template mode', () => {
    initialized = true
    const { result } = renderHook(() => useTemplateValidation(false, 'Hi {{ name }}', undefined))
    expect(result.current.templateHighlighter).toBeNull()
    expect(result.current.templateTooltip).toBeNull()
  })
})

describe('useTemplateValidation - validator could not load', () => {
  beforeEach(() => {
    initialized = false
    initializeTreeSitter.mockRejectedValue(new Error('Tree-sitter failed to load: 404'))
  })

  it('marks every {{ }} region as not checked instead of leaving it clean', async () => {
    renderHook(() => useTemplateValidation(true, 'Hi {{ name }} and {{ other }}', VARS))

    await waitFor(() => {
      const issues = vi.mocked(createValidationTooltip).mock.lastCall?.[0] ?? []
      expect(issues).toHaveLength(2)
      expect(issues[0]).toMatchObject({
        type: 'not_validated',
        from: 5,
        to: 11,
        message:
          'Not checked - could not load expression validation. Tree-sitter failed to load: 404',
        identifier: 'name',
      })
      expect(issues[1]).toMatchObject({ type: 'not_validated', identifier: 'other' })
    })
  })

  it('underlines the unchecked regions as warnings, not as errors', async () => {
    renderHook(() => useTemplateValidation(true, 'Hi {{ name }}', VARS))

    await waitFor(() => {
      const decorations = vi.mocked(createTemplateHighlighter).mock.lastCall?.[0] ?? []
      expect(decorations).toEqual([{ from: 5, to: 11, severity: 'warning' }])
    })
  })

  it('stops asking the unloaded validator whether the expression is valid', async () => {
    const { rerender } = renderHook(
      ({ text }: { text: string }) => useTemplateValidation(true, text, VARS),
      { initialProps: { text: 'Hi {{ name }}' } },
    )

    await waitFor(() => {
      const issues = vi.mocked(createValidationTooltip).mock.lastCall?.[0] ?? []
      expect(issues).toMatchObject([{ type: 'not_validated' }])
    })
    vi.mocked(validateExpressions).mockClear()
    rerender({ text: 'Hi {{ other }}' })

    expect(validateExpressions).not.toHaveBeenCalled()
  })
})
