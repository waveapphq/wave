/**
 * Expression Completion Module
 *
 * Shared autocomplete completion source used by both the inline expression editor
 * (CodeMirror) and the modal expression editor for consistent autocomplete behavior.
 *
 * This module provides:
 * - Smart cursor placement after function/method/variable insertion
 * - Section headers for autocomplete dropdown grouping
 * - A factory that creates a CompletionSource with variable/builtin/method completions
 */

import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { hasRequiredParams, getTypeBeforeDot, type AvailableVariable } from './type-inference'
import {
  ALLOWED_BUILTINS,
  FIELD_ALLOWED_BUILTINS,
  PYTHON_BUILTINS,
  getMethodsForType,
  getFieldMethodsForType,
  type PythonBuiltin,
} from '@/features/workbench/lib/python-builtins'

// Re-export AvailableVariable for convenience
export type { AvailableVariable } from './type-inference'

// ============================================
// Apply Functions (smart cursor placement)
// ============================================

/**
 * Create an apply function for callable completions (functions or methods).
 * Inserts `name()` with cursor positioned inside parens (if hasParams=true)
 * or after closing paren (if hasParams=false).
 */
export function createCallableApply(name: string, hasParams: boolean) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const sel = view.state.selection.main
    const replaceFrom = sel.empty ? from : Math.min(from, sel.from)
    const replaceTo = sel.empty ? to : Math.max(to, sel.to)
    const insertText = `${name}()`
    const cursorPos = replaceFrom + name.length + (hasParams ? 1 : 2)

    view.dispatch({
      changes: { from: replaceFrom, to: replaceTo, insert: insertText },
      selection: EditorSelection.cursor(cursorPos),
    })
  }
}

/** @deprecated Use createCallableApply instead - kept as alias for compatibility */
export const createFunctionApply = createCallableApply

/** @deprecated Use createCallableApply instead - kept as alias for compatibility */
export const createMethodApply = createCallableApply

/**
 * Create an apply function for variables.
 * Inserts the variable name and positions cursor after it.
 */
export function createVariableApply(name: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const sel = view.state.selection.main
    const replaceFrom = sel.empty ? from : Math.min(from, sel.from)
    const replaceTo = sel.empty ? to : Math.max(to, sel.to)
    view.dispatch({
      changes: { from: replaceFrom, to: replaceTo, insert: name },
      selection: EditorSelection.cursor(replaceFrom + name.length),
    })
  }
}

// ============================================
// Section Headers
// ============================================

/**
 * Create a styled section header element for autocomplete dropdown.
 * Returns an HTMLElement with class 'cm-completionSection'.
 */
export function createSectionHeader(name: string): HTMLElement {
  const header = document.createElement('div')
  header.className = 'cm-completionSection'
  header.textContent = name
  return header
}

// ============================================
// Completion Source Factory
// ============================================

// ============================================
// Core Completion Logic (shared by all modes)
// ============================================

/**
 * Core completion logic shared between expression mode (entire document is
 * an expression) and template mode (only text between {{ }} is an expression).
 *
 * @param exprContent - The expression text before the cursor
 * @param pos - Cursor position in the document (for replacement offsets)
 * @param exprStartOffset - Where the expression starts in the document
 * @param variables - Available variables
 * @param isFieldExpression - If true, excludes mutating methods and constructors
 * @param showInfo - If true, includes description in the info panel
 */
/** Build dotted profile field completions for dot context */
function _buildDottedFieldOptions(
  dottedVars: AvailableVariable[],
  showInfo: boolean,
): Completion[] {
  const fieldsSection = { name: 'Fields', rank: 0, header: () => createSectionHeader('Fields') }
  return dottedVars.map((v) => ({
    label: v.name,
    type: 'variable' as const,
    detail: v.source ? `${v.type} \u2190 ${v.source}` : v.type,
    info: showInfo ? v.description : undefined,
    section: fieldsSection,
    apply: createVariableApply(v.name),
  }))
}

/** Build type-specific method completions for dot context */
function _buildMethodOptions(
  exprType: string,
  isFieldExpression: boolean,
  showInfo: boolean,
): Completion[] {
  const methods = isFieldExpression ? getFieldMethodsForType(exprType) : getMethodsForType(exprType)
  if (methods.length === 0) return []

  const methodsSection = {
    name: 'Methods',
    rank: 1,
    header: () => createSectionHeader(`Methods for ${exprType}`),
  }
  const options: Completion[] = []
  for (const m of methods) {
    for (const sig of m.signatures) {
      options.push({
        label: m.name,
        type: 'method',
        detail: sig,
        info: showInfo ? m.description : undefined,
        section: methodsSection,
        apply: createCallableApply(m.name, hasRequiredParams(sig)),
      })
    }
  }
  return options
}

/** Handle dot-context completions (methods and dotted profile fields) */
function _getDotCompletions(
  exprContent: string,
  pos: number,
  exprStartOffset: number,
  variables: AvailableVariable[],
  isFieldExpression: boolean,
  showInfo: boolean,
  dotContext: RegExpExecArray,
): CompletionResult | null {
  const methodPrefix = dotContext[1]
  const beforeDot = exprContent.slice(0, exprContent.lastIndexOf('.'))

  const dottedPrefix = exprContent.toLowerCase()
  const dottedVars = variables.filter(
    (v) => v.name.includes('.') && v.name.toLowerCase().startsWith(dottedPrefix)
  )

  const exprType = getTypeBeforeDot(beforeDot, variables)

  const options: Completion[] = [
    ..._buildDottedFieldOptions(dottedVars, showInfo),
    ...(exprType ? _buildMethodOptions(exprType, isFieldExpression, showInfo) : []),
  ]

  if (options.length === 0) return null

  const completionFrom = dottedVars.length > 0 ? exprStartOffset : pos - methodPrefix.length
  return { from: completionFrom, options }
}

/** The builtin catalog a context may offer. A script is not sandboxed, an expression is. */
function _selectBuiltins(isFieldExpression: boolean, includeBlocked: boolean): PythonBuiltin[] {
  if (isFieldExpression) return FIELD_ALLOWED_BUILTINS
  return includeBlocked ? PYTHON_BUILTINS : ALLOWED_BUILTINS
}

/** Build top-level completions (variables + builtins) */
function _getTopLevelCompletions(
  from: number,
  variables: AvailableVariable[],
  isFieldExpression: boolean,
  showInfo: boolean,
  includeBlocked: boolean,
): CompletionResult {
  const options: Completion[] = []
  const variablesSection = { name: 'Variables', rank: 0, header: () => createSectionHeader('Variables') }
  const namespacesSection = { name: 'Namespaces', rank: 1, header: () => createSectionHeader('Namespaces') }
  const profilesSection = { name: 'Profiles', rank: 2, header: () => createSectionHeader('Profiles') }
  const functionsSection = { name: 'Functions', rank: 3, header: () => createSectionHeader('Functions') }

  const seenNames = new Set<string>()
  variables.forEach((v) => {
    if (v.name.includes('.')) return
    if (seenNames.has(v.name)) return
    seenNames.add(v.name)
    const isProfile = v.source?.startsWith('Profile:')
    const isNamespace =
      v.source?.startsWith('System') ||
      v.source === 'Suite' || v.source?.startsWith('Suite:') ||
      v.source === 'Regression' || v.source?.startsWith('Regression:')
    let section = variablesSection
    if (isNamespace) section = namespacesSection
    else if (isProfile) section = profilesSection
    options.push({
      label: v.name,
      type: 'variable',
      detail: v.source ? `${v.type} \u2190 ${v.source}` : v.type,
      info: showInfo ? v.description : undefined,
      section,
      apply: createVariableApply(v.name),
    })
  })

  const builtins = _selectBuiltins(isFieldExpression, includeBlocked)
  builtins.forEach((b) => {
    options.push({
      label: b.name,
      type: 'function',
      detail: b.signature,
      info: showInfo ? b.description : undefined,
      section: functionsSection,
      apply: createCallableApply(b.name, hasRequiredParams(b.signature)),
    })
  })

  return { from, options }
}

/**
 * If the cursor sits inside a Python f-string interpolation (`f'... {expr|}'`
 * or `f"... {expr|}"`), return just the slice from the opening `{` to the
 * cursor so that downstream completion logic operates on the embedded
 * expression instead of the whole f-string. Otherwise return the input
 * unchanged.
 */
function sliceFStringSegment(before: string): { content: string; offset: number } {
  // Find the latest unclosed f-string opener. Walk left over the input;
  // a match means there's an `f'` or `f"` whose matching quote hasn't been
  // typed yet. Quote style/length doesn't matter for our purposes.
  const fStringMatch = /\bf(['"])(?:\\.|(?!\1).)*$/.exec(before)
  if (!fStringMatch) return { content: before, offset: 0 }

  const fStringStart = fStringMatch.index + 2 // skip the `f` and the opening quote
  const inside = before.slice(fStringStart)
  const lastOpen = inside.lastIndexOf('{')
  if (lastOpen === -1) return { content: before, offset: 0 }

  const segment = inside.slice(lastOpen + 1)
  if (segment.includes('}')) return { content: before, offset: 0 } // brace already closed

  return { content: segment, offset: fStringStart + lastOpen + 1 }
}

function _getCompletions(
  exprContent: string,
  pos: number,
  exprStartOffset: number,
  variables: AvailableVariable[],
  isFieldExpression: boolean,
  showInfo: boolean,
  includeBlocked: boolean,
): CompletionResult | null {
  // Get trailing word characters as current token for filtering
  let tokenEnd = exprContent.length
  while (tokenEnd > 0) {
    const c = exprContent.codePointAt(tokenEnd - 1)!
    const isWord = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    if (!isWord) break
    tokenEnd--
  }
  const currentToken = exprContent.slice(tokenEnd)
  const from = pos - currentToken.length

  // Check for method context (after a dot)
  const dotContext = /\.(\w*)$/.exec(exprContent)
  if (dotContext) {
    return _getDotCompletions(exprContent, pos, exprStartOffset, variables, isFieldExpression, showInfo, dotContext)
  }

  return _getTopLevelCompletions(from, variables, isFieldExpression, showInfo, includeBlocked)
}

// ============================================
// Completion Source Factories
// ============================================

/** Options that change which catalog entries a completion source offers. */
export interface ExpressionCompletionOptions {
  /** Offer the builtins the expression engine blocks. A Python script is not sandboxed. */
  includeBlockedBuiltins?: boolean
}

/**
 * Create a CompletionSource for expression editing (entire document is an expression).
 *
 * Provides autocomplete completions based on:
 * - Available variables (with deduplication and scope info)
 * - Profile alias variables (grouped in a separate section)
 * - Python builtin functions (filtered by isFieldExpression)
 * - Type-specific methods after dot (e.g., str.upper(), list.append())
 * - Dotted profile field variables (e.g., my_srv.host after typing my_srv.)
 * - Method chain type tracing (e.g., endpoint.upper(). shows str methods)
 *
 * @param variables - Available variables in the expression context
 * @param isFieldExpression - If true, excludes mutating methods and constructors
 * @param showInfo - If true, includes description in the info panel (docs tooltip)
 * @param options - Catalog options; by default the blocked builtins stay hidden
 * @returns A CompletionSource function for CodeMirror autocompletion
 */
export function createExpressionCompletionSource(
  variables: AvailableVariable[],
  isFieldExpression: boolean,
  showInfo: boolean = false,
  options: ExpressionCompletionOptions = {}
): (context: CompletionContext) => CompletionResult | null {
  const includeBlocked = options.includeBlockedBuiltins === true
  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context
    const doc = state.doc.toString()
    const before = doc.slice(0, pos)
    const { content, offset } = sliceFStringSegment(before)
    return _getCompletions(content, pos, offset, variables, isFieldExpression, showInfo, includeBlocked)
  }
}

/**
 * Create a CompletionSource for template editing (only text inside {{ }} is
 * an expression). Uses the exact same completion logic as expression mode.
 *
 * Activates only when the cursor is inside an unclosed {{ }} marker.
 * Outside of {{ }}, returns null (no completions).
 *
 * @param variables - Available variables in the expression context
 * @param showInfo - If true, includes description in the info panel (docs tooltip)
 * @returns A CompletionSource function for CodeMirror autocompletion
 */
export function createTemplateCompletionSource(
  variables: AvailableVariable[],
  showInfo: boolean = false
): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context
    const doc = state.doc.toString()
    const before = doc.slice(0, pos)

    // Find the nearest unclosed {{ before cursor
    const openIdx = before.lastIndexOf('{{')
    if (openIdx === -1) return null

    // Check there's no }} between {{ and cursor (cursor must be inside the marker)
    const afterOpen = before.slice(openIdx + 2)
    if (afterOpen.includes('}}')) return null

    // Extract expression content between {{ and cursor
    const exprContent = afterOpen
    const exprStartOffset = openIdx + 2

    // Template mode always uses full builtins (not field-restricted)
    return _getCompletions(exprContent, pos, exprStartOffset, variables, false, showInfo, false)
  }
}
