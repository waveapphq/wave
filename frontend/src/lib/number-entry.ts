/** The keystroke rule every list item, map value and table cell box of a number type shares (REQ-3.1.3.14). */

import { acceptsNumericInput, MAX_FLOAT_INPUT_CHARS, MAX_INTEGER_DIGITS } from '@/lib/number-rule'

/** The input attributes of a box holding a value of this type: a number keyboard and a length stop. */
export function numberEntryProps(type: string): { inputMode?: 'numeric' | 'decimal'; maxLength?: number } {
  if (type === 'integer') return { inputMode: 'numeric', maxLength: MAX_INTEGER_DIGITS + 1 }
  if (type === 'float') return { inputMode: 'decimal', maxLength: MAX_FLOAT_INPUT_CHARS + 1 }
  return {}
}

/** Whether a box of this type takes the text: a number type drops a key the number rule refuses. */
export function takesEntryText(next: string, type: string): boolean {
  if (type !== 'integer' && type !== 'float') return true
  return acceptsNumericInput(next, type)
}
