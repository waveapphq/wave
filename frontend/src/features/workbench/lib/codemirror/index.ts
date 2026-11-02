/**
 * CodeMirror Extensions - Public API
 *
 * Expression editor extensions, themes, keymaps, decorations,
 * and completion sources for the WAVE expression system.
 */

// Type inference and variable types
export type { AvailableVariable } from './type-inference'
export {
  hasRequiredParams,
  WAVE_TO_PYTHON,
  mapTypeToPython,
  inferExpressionType,
  getTypeBeforeDot,
} from './type-inference'

// Completion sources
export {
  createCallableApply,
  createFunctionApply,
  createMethodApply,
  createVariableApply,
  createSectionHeader,
  createExpressionCompletionSource,
  createTemplateCompletionSource,
} from './expression-completion'

// Decorations and highlighting
export type { DecorationIssue } from './expression-decorations'
export {
  expressionMark,
  unknownVariableMark,
  invalidFunctionMark,
  createExpressionHighlighter,
  createTemplateHighlighter,
} from './expression-decorations'

// Themes
export {
  expressionEditorTheme,
  expressionHighlightTheme,
  autocompleteDropdownTheme,
} from './expression-theme'

// Keymaps
export {
  autocompleteNavigationKeys,
  buildInlineExpressionKeymap,
  buildModalExpressionKeymap,
} from './expression-keymaps'

// Tooltips
export {
  validationTooltipSource,
  createValidationTooltip,
} from './expression-tooltips'

// Escape handling
export { registerEscapeHandler } from './escape-handler'
