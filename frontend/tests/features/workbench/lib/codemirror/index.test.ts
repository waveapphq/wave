/**
 * CodeMirror Extensions Public API Tests
 *
 * The expression editor barrel exposes each extension, theme, keymap, decoration
 * and completion source exactly as its own module defines it.
 *
 * Module: frontend/src/features/workbench/lib/codemirror/index.ts
 */

import { describe, it, expect } from 'vitest'
import * as codemirror from '@/features/workbench/lib/codemirror/index'
import * as typeInference from '@/features/workbench/lib/codemirror/type-inference'
import * as expressionCompletion from '@/features/workbench/lib/codemirror/expression-completion'
import * as expressionDecorations from '@/features/workbench/lib/codemirror/expression-decorations'
import * as expressionTheme from '@/features/workbench/lib/codemirror/expression-theme'
import * as expressionKeymaps from '@/features/workbench/lib/codemirror/expression-keymaps'
import * as expressionTooltips from '@/features/workbench/lib/codemirror/expression-tooltips'
import * as escapeHandler from '@/features/workbench/lib/codemirror/escape-handler'

type ModuleCase = [name: string, source: Record<string, unknown>, exportNames: string[]]

const MODULE_CASES: ModuleCase[] = [
  ['type-inference', typeInference, [
    'hasRequiredParams',
    'WAVE_TO_PYTHON',
    'mapTypeToPython',
    'inferExpressionType',
    'getTypeBeforeDot',
  ]],
  ['expression-completion', expressionCompletion, [
    'createCallableApply',
    'createFunctionApply',
    'createMethodApply',
    'createVariableApply',
    'createSectionHeader',
    'createExpressionCompletionSource',
    'createTemplateCompletionSource',
  ]],
  ['expression-decorations', expressionDecorations, [
    'expressionMark',
    'unknownVariableMark',
    'invalidFunctionMark',
    'createExpressionHighlighter',
    'createTemplateHighlighter',
  ]],
  ['expression-theme', expressionTheme, [
    'expressionEditorTheme',
    'expressionHighlightTheme',
    'autocompleteDropdownTheme',
  ]],
  ['expression-keymaps', expressionKeymaps, [
    'autocompleteNavigationKeys',
    'buildInlineExpressionKeymap',
    'buildModalExpressionKeymap',
  ]],
  ['expression-tooltips', expressionTooltips, [
    'validationTooltipSource',
    'createValidationTooltip',
  ]],
  ['escape-handler', escapeHandler, ['registerEscapeHandler']],
]

const barrel: Record<string, unknown> = codemirror

describe('codemirror barrel', () => {
  it.each(MODULE_CASES)('re-exports the %s module', (_name, source, exportNames) => {
    for (const exportName of exportNames) {
      expect(source[exportName], exportName).toBeDefined()
      expect(barrel[exportName], exportName).toBe(source[exportName])
    }
  })

  it('exposes nothing beyond those exports', () => {
    const expected = MODULE_CASES.flatMap(([, , exportNames]) => exportNames)
    expect(new Set(Object.keys(codemirror))).toEqual(new Set(expected))
    expect(Object.keys(codemirror)).toHaveLength(expected.length)
  })
})
