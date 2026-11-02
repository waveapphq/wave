/**
 * Validation wording shared by the expression field and the Python script checks.
 *
 * REQ-3.4.1.2: Python script execution
 */

export function unknownVariableMessage(
  name: string,
  suggestion?: string,
  label = 'Variable',
): string {
  return suggestion
    ? `${label} '${name}' not defined. Did you mean '${suggestion}'?`
    : `${label} '${name}' is not defined`
}

export function unknownFunctionMessage(name: string): string {
  return `Function '${name}' is not recognized`
}

export function invalidMethodMessage(method: string, type?: string): string {
  const typeInfo = type ? ` for type '${type}'` : ''
  return `'${method}' is not a valid method${typeInfo}`
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}

/** A max of -1 means no upper bound. */
export function expectedArgCount(min: number, max: number): string {
  if (max === -1) {
    return min === 0 ? '0 or more arguments' : `at least ${min} argument${plural(min)}`
  }
  if (min === max) return `${min} argument${plural(min)}`
  return `${min}-${max} arguments`
}

export function methodArgCountMessage(method: string, expected: string, got: number): string {
  return `Method '${method}' takes ${expected}, got ${got}`
}

export function operatorTypeMessage(operator: string, left: string, right: string): string {
  const message = `Cannot use '${operator}' with ${left} and ${right}`
  const mixesStrAndInt =
    (left === 'str' && right === 'int') || (left === 'int' && right === 'str')
  return operator === '+' && mixesStrAndInt ? `${message} - use str() to convert` : message
}
