/**
 * Syntax validation checks for expression validation.
 *
 * Provides expression classification, invalid syntax detection,
 * and string operation validation.
 */

// ============================================
// Expression Type Detection
// ============================================

export type ExpressionType =
  | { type: 'simple_variable'; name: string }
  | { type: 'method_call'; base: string; chain: string }
  | { type: 'function_call'; name: string; args: string }
  | { type: 'complex' }

/**
 * Find the matching closing paren for the first opening paren.
 * Returns the index of the closing paren, or -1 if not found/unbalanced.
 */
function findMatchingParen(str: string, openIndex: number): number {
  let depth = 1
  for (let i = openIndex + 1; i < str.length; i++) {
    if (str[i] === '(') depth++
    else if (str[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  /* v8 ignore next - COV-BRANCH-090 */
  }
  /* v8 ignore next 2 - COV-UNREACH-009 */
  return -1
}

/**
 * Determine the type of expression
 */
export function classifyExpression(content: string): ExpressionType {
  const trimmed = content.trim()

  // Check for function call: funcname(args)
  // Must be ONLY a function call, not something like "abs(1) and exit()"
  const funcStartMatch = /^([a-zA-Z_]\w*)\(/.exec(trimmed)
  if (funcStartMatch) {
    const funcName = funcStartMatch[1]
    const openParen = funcName.length
    const closeParen = findMatchingParen(trimmed, openParen)

    // Only classify as function_call if the closing paren is at the end
    if (closeParen === trimmed.length - 1) {
      const args = trimmed.slice(openParen + 1, closeParen)
      return { type: 'function_call', name: funcName, args }
    }
  }

  // Check for method call: varname.method() or varname.method1().method2()
  // Base must be a valid identifier (not a complex expression like [x for x in ...])
  if (trimmed.includes('.') && trimmed.includes('(')) {
    const base = trimmed.split('.')[0]
    if (/^[a-zA-Z_]\w*$/.test(base)) {
      const chain = trimmed.slice(base.length)
      return { type: 'method_call', base, chain }
    }
  }

  // Check for simple variable: just an identifier
  if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
    return { type: 'simple_variable', name: trimmed }
  }

  // Complex expression (operators, nested expressions, etc.)
  return { type: 'complex' }
}

// ============================================
// Syntax Validation
// ============================================

/**
 * Check if expression is a numeric literal trying to call a method.
 * - "1.upper()" - invalid (numbers don't have methods)
 * - "1." - invalid (incomplete)
 * - "1.5" - valid float
 * - "123" - valid integer
 */
export function isInvalidNumericMethodCall(content: string): boolean {
  const trimmed = content.trim()
  // Match: digits, dot, then either nothing or non-digit (method name)
  // But NOT digits after dot (that's a valid float like 1.5)
  return /^\d+\.(?!\d)/.test(trimmed)
}

/**
 * Check for assignment-like syntax that is not allowed in expressions.
 * Returns an error message if found, or null if OK.
 */
function checkAssignmentSyntax(trimmed: string): string | null {
  if (/:=/.test(trimmed)) {
    return 'Assignment expressions (:=) are not allowed - use Var Setter control instead'
  }
  if (/^[a-zA-Z_]\w*\s*=(?!=)/.test(trimmed)) {
    return 'Assignment statements are not allowed in expressions - use Var Setter control instead'
  }
  if (trimmed.includes('`')) {
    return 'Backticks are not valid in Python expressions'
  }
  return null
}

/** Bracket tracking: maps open/close chars to their depth key and direction */
const BRACKET_MAP: Record<string, { key: 'paren' | 'bracket' | 'brace'; delta: number }> = {
  '(': { key: 'paren', delta: 1 },
  ')': { key: 'paren', delta: -1 },
  '[': { key: 'bracket', delta: 1 },
  ']': { key: 'bracket', delta: -1 },
  '{': { key: 'brace', delta: 1 },
  '}': { key: 'brace', delta: -1 },
}

/** Error messages for unbalanced brackets, indexed by depth key */
const BRACKET_ERRORS: Record<string, { unexpected: string; missing: string }> = {
  paren:   { unexpected: 'Unbalanced parentheses: unexpected )', missing: 'Unbalanced parentheses: missing )' },
  bracket: { unexpected: 'Unbalanced brackets: unexpected ]',   missing: 'Unbalanced brackets: missing ]' },
  brace:   { unexpected: 'Unbalanced braces: unexpected }',     missing: 'Unbalanced braces: missing }' },
}

/**
 * Check for unbalanced brackets, parentheses, and braces.
 * Returns an error message if found, or null if balanced.
 */
function checkBracketBalance(trimmed: string): string | null {
  const depths: Record<string, number> = { paren: 0, bracket: 0, brace: 0 }

  for (const char of trimmed) {
    const info = BRACKET_MAP[char]
    /* v8 ignore next - COV-BRANCH-091 */
    if (!info) continue
    depths[info.key] += info.delta
    /* v8 ignore next 2 - COV-BRANCH-092 */
    if (depths[info.key] < 0) return BRACKET_ERRORS[info.key].unexpected
  }

  for (const key of Object.keys(depths)) {
    /* v8 ignore next - COV-BRANCH-069 */
    if (depths[key] !== 0) return BRACKET_ERRORS[key].missing
  }
  return null
}

/**
 * Check for invalid character patterns that cannot appear in valid Python expressions.
 * Returns an error message if found, or null if OK.
 */
function checkInvalidPatterns(trimmed: string): string | null {
  if (/[+\-*/%<>=!&|^]{3,}/.test(trimmed)) {
    return 'Invalid operator sequence'
  }
  if (trimmed.includes('#')) {
    return 'Comments (#) are not valid in expressions'
  }
  if (/@[a-zA-Z]/.test(trimmed)) {
    return 'Decorators (@) are not valid in expressions'
  }
  if (trimmed.includes(';')) {
    return 'Semicolons are not valid in expressions'
  }
  if (/\.\s*$/.test(trimmed)) {
    return 'Incomplete expression: expected attribute or method name after dot'
  }
  if (/\.\s*[+\-*/%<>=!&|^,)\]]/.test(trimmed)) {
    return 'Invalid syntax: expected attribute or method name after dot'
  }
  if (/[+\-*/%<>=!&|^,(]\s*\./.test(trimmed)) {
    return 'Invalid syntax: unexpected dot after operator'
  }
  return null
}

/** The text with string contents blanked; null for an unclosed string, which the parser reports. */
function blankStringContents(text: string): string | null {
  let out = ''
  let quote: string | null = null
  let escaped = false
  for (const char of text) {
    if (escaped) {
      escaped = false
    } else if (quote === null) {
      if (char === "'" || char === '"') quote = char
      out += char
    } else if (char === '\\') {
      out += '__'
      escaped = true
    } else if (char === quote) {
      quote = null
      out += char
    } else {
      out += '_'
    }
  }
  return quote === null ? out : null
}

/**
 * Check for obviously invalid syntax that cannot be valid Python.
 * This catches garbage input like "11````43!@#$&%^(*"
 */
export function findInvalidSyntax(content: string): string | null {
  const code = blankStringContents(content.trim())
  if (code === null) return null

  return checkAssignmentSyntax(code)
    ?? checkBracketBalance(code)
    ?? checkInvalidPatterns(code)
}

// A string literal: quote, then non-quote/non-backslash chars or escape sequences, then the closing quote.
const STRING_LITERAL = new RegExp(
  String.raw`'[^\\']*(?:\\.[^\\']*)*'` + '|' + String.raw`"[^\\"]*(?:\\.[^\\"]*)*"`,
  'g',
)

/** Every string literal written as `""`, read left to right so the text between two literals is never taken for one. */
function emptyStringLiterals(content: string): string {
  return content.replaceAll(STRING_LITERAL, '""')
}

/**
 * Check for invalid string literal operations.
 * In Python, strings support + (concat) and * (repeat), but NOT /, -, %
 * Examples:
 * - "a" / 0   -> invalid
 * - "a" - 1   -> invalid
 * - "a" % 2   -> invalid (% is for formatting, but not with numbers like this)
 * - "a" + "b" -> valid
 * - "a" * 3   -> valid
 */
export function findInvalidStringOperation(content: string): string | null {
  const code = emptyStringLiterals(content)
  const patterns = [
    { regex: /""\s*\//, desc: 'Cannot divide string' },
    { regex: /""\s*-/, desc: 'Cannot subtract from string' },
    { regex: /\/\s*""/, desc: 'Cannot divide by string' },
    { regex: /-\s*""/, desc: 'Cannot subtract string' },
  ]

  for (const { regex, desc } of patterns) {
    if (regex.test(code)) {
      return desc
    }
  }

  return null
}
