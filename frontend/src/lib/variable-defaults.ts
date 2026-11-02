/**
 * The type default a new variable value starts on.
 *
 * REQ-3.1.3.20: Null is the only empty value
 */

import type { VariableType } from '@/lib/variable-types'

/** The type's default value; arrays, maps and tables are fresh instances callers may mutate. */
export function getDefaultValueForType(varType: VariableType): unknown {
  if (varType === 'boolean') return false
  if (varType === 'integer' || varType === 'float') return 0
  if (varType === 'array' || varType === 'table') return []
  if (varType === 'map') return {}
  return ''
}
