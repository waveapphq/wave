/** The one number rule every numeric field shares (REQ-3.1.3.14). */

export type NumberType = 'integer' | 'float'

/** Why a value is not a valid number: wrong form, or a valid number over its digit cap. */
export type NumberProblem = 'type' | 'integer-cap' | 'float-cap'

export interface NumericInputOptions {
  /** False refuses a leading minus (a field whose minimum is 0 or more). */
  negative?: boolean
}

export const MAX_INTEGER_DIGITS = 19
export const MAX_FLOAT_SIG_DIGITS = 28
// A char backstop only: 0.<28 significant digits> needs more chars than digits.
export const MAX_FLOAT_INPUT_CHARS = 40

export const PLAIN_INTEGER = /^-?\d+$/
export const PLAIN_FLOAT = /^-?\d+(?:\.\d+)?$/

// Keystroke partials: a lone minus or a trailing dot is still being typed.
const PARTIAL_INTEGER = /^-?\d*$/
const PARTIAL_FLOAT = /^-?\d*(?:\.\d*)?$/

const EXPONENT_FORM = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/
const ANY_SIGN: NumericInputOptions = {}

/** The text with its trailing zeros cut, in one pass. */
export function withoutTrailingZeros(text: string): string {
  let end = text.length
  while (end > 0 && text[end - 1] === '0') end -= 1
  return text.slice(0, end)
}

/** Plain digits for a JS number (never exponent notation); text is returned unchanged. */
export function plainNumberText(value: number | string): string {
  if (typeof value === 'string') return value
  const text = String(value)
  const parts = EXPONENT_FORM.exec(text)
  if (parts === null) return text
  const [, sign, lead, fraction, exponentText] = parts
  const digits = lead + (fraction ?? '')
  const exponent = Number(exponentText)
  return exponent >= 0
    ? sign + digits.padEnd(exponent + 1, '0')
    : `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`
}

/** Integer digit count, the sign aside. */
export function integerDigitCount(value: string | number): number {
  return plainNumberText(value).replace(/^-/, '').length
}

/** Significant digits: sign, dot and leading zeros dropped; trailing zeros count. */
export function floatSignificantDigits(value: string | number): number {
  return plainNumberText(value).replace(/^-/, '').replace('.', '').replace(/^0+/, '').length
}

/** Why a number text breaks the rule (no trimming), or null when it keeps it. */
export function numberTextProblem(text: string, type: NumberType): NumberProblem | null {
  if (type === 'integer') {
    if (!PLAIN_INTEGER.test(text)) return 'type'
    return integerDigitCount(text) > MAX_INTEGER_DIGITS ? 'integer-cap' : null
  }
  if (!PLAIN_FLOAT.test(text)) return 'type'
  return floatSignificantDigits(text) > MAX_FLOAT_SIG_DIGITS ? 'float-cap' : null
}

/** Why a JS number or a digit text is not a valid number of the type; anything else is 'type'. */
export function numberValueProblem(value: unknown, type: NumberType): NumberProblem | null {
  if (typeof value === 'string') return numberTextProblem(value, type)
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'type'
  if (type === 'integer' && !Number.isInteger(value)) return 'type'
  return numberTextProblem(plainNumberText(value), type)
}

/** The message a field shows for a number problem. */
export function numberProblemMessage(problem: NumberProblem, type: NumberType): string {
  if (problem === 'integer-cap') return `Maximum ${MAX_INTEGER_DIGITS} digits`
  if (problem === 'float-cap') return `Maximum ${MAX_FLOAT_SIG_DIGITS} significant digits`
  return type === 'integer' ? 'Must be an integer' : 'Must be a number'
}

/** The short form a location-prefixed strip line uses for a number problem. */
export function numberProblemShort(problem: NumberProblem, type: NumberType): string {
  if (problem === 'integer-cap') return `max ${MAX_INTEGER_DIGITS} digits`
  if (problem === 'float-cap') return `max ${MAX_FLOAT_SIG_DIGITS} significant digits`
  return `expected ${type}`
}

/** Whether a number box takes this in-progress text; false drops the keystroke. */
export function acceptsNumericInput(
  next: string,
  type: NumberType,
  options: NumericInputOptions = ANY_SIGN,
): boolean {
  if (options.negative === false && next.startsWith('-')) return false
  const partial = type === 'integer' ? PARTIAL_INTEGER : PARTIAL_FLOAT
  const maxChars = type === 'integer' ? MAX_INTEGER_DIGITS : MAX_FLOAT_INPUT_CHARS
  if (next.replace(/^[+-]/, '').length > maxChars || !partial.test(next)) return false
  return !(type === 'float' && floatSignificantDigits(next) > MAX_FLOAT_SIG_DIGITS)
}

/** The JS number a number text stands for, only when that number prints back as the same text. */
export function exactJsNumber(text: string, type: NumberType): number | undefined {
  if (numberTextProblem(text, type) !== null) return undefined
  const value = Number(text)
  if (String(value) !== text) return undefined
  return type === 'float' || Number.isSafeInteger(value) ? value : undefined
}

/** The wire / stored form of a number text: a JS number when exact, else the text. */
export function wireNumber(text: string, type: NumberType): number | string {
  const value = exactJsNumber(text, type)
  // Below 0.0001 the server's JSON writer prints a fraction with an exponent.
  if (value === undefined || (!Number.isInteger(value) && Math.abs(value) < 0.0001)) return text
  return value
}

interface DecimalParts {
  negative: boolean
  whole: string
  fraction: string
}

function decimalParts(value: number | string): DecimalParts {
  const text = plainNumberText(value)
  const [whole, fraction] = text.replace(/^-/, '').split('.')
  const digits = whole.replace(/^0+/, '')
  const decimals = withoutTrailingZeros(fraction ?? '')
  return {
    negative: text.startsWith('-') && (digits !== '' || decimals !== ''),
    whole: digits,
    fraction: decimals,
  }
}

function compareMagnitude(a: DecimalParts, b: DecimalParts): -1 | 0 | 1 {
  if (a.whole.length !== b.whole.length) return a.whole.length < b.whole.length ? -1 : 1
  if (a.whole !== b.whole) return a.whole < b.whole ? -1 : 1
  const width = Math.max(a.fraction.length, b.fraction.length)
  const left = a.fraction.padEnd(width, '0')
  const right = b.fraction.padEnd(width, '0')
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** Exact decimal order of two valid numbers, never through JS doubles. */
export function compareNumbers(a: number | string, b: number | string): -1 | 0 | 1 {
  const left = decimalParts(a)
  const right = decimalParts(b)
  if (left.negative !== right.negative) return left.negative ? -1 : 1
  return left.negative ? compareMagnitude(right, left) : compareMagnitude(left, right)
}

/** Whether two valid numbers are the same exact value (`1.5` and `1.50` are). */
export function sameNumber(a: number | string, b: number | string): boolean {
  return compareNumbers(a, b) === 0
}
