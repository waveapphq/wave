/** The Python literal text of WAVE values, as the expression placeholder shows a default (REQ-3.1.3.14). */

import { numberTextProblem, PLAIN_INTEGER, plainNumberText } from '@/lib/number-rule'

/** A Python string literal of a text. */
export function pythonString(text: string): string {
  const body = text
    .replaceAll('\\', '\\\\')
    .replaceAll("'", String.raw`\'`)
    .replaceAll('\n', String.raw`\n`)
    .replaceAll('\r', String.raw`\r`)
    .replaceAll('\t', String.raw`\t`)
  return `'${body}'`
}

function pythonNumber(text: string, type: string | undefined): string {
  return type === 'float' && PLAIN_INTEGER.test(text) ? `${text}.0` : text
}

/** Digit text a number type holds is that number (REQ-3.1.3.14). */
function isNumberText(value: string, type: string | undefined): boolean {
  return (type === 'integer' || type === 'float') && numberTextProblem(value, type) === null
}

/** The Python literal of a value: 'low', 1, 2.5, True, None, lists and dicts; `type` 'float' prints 2 as 2.0. */
export function pythonLiteral(value: unknown, type?: string): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return pythonNumber(plainNumberText(value), type)
  if (typeof value === 'string') return isNumberText(value, type) ? pythonNumber(value, type) : pythonString(value)
  if (Array.isArray(value)) return `[${value.map((item) => pythonLiteral(item)).join(', ')}]`
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, item]) => `${pythonString(key)}: ${pythonLiteral(item)}`,
  )
  return `{${entries.join(', ')}}`
}
