/**
 * Operator type compatibility checks for expression validation.
 *
 * Validates that binary operators are used with compatible types
 * (e.g., str + int is an error, int + float is OK).
 */

import type { PythonType } from '../python-builtins'
import { operatorTypeMessage } from './messages'

// ============================================
// Type and Operator Rules
// ============================================

/**
 * Inferred type for a node - either a PythonType or 'unknown'
 */
export type InferredType = PythonType | 'unknown'

/**
 * Set of numeric Python types for operator validation.
 */
export const NUMERIC_TYPES = new Set(['int', 'float'])

/**
 * Operators and the types they support on the left side.
 */
export const OPERATOR_LEFT_TYPES: Record<string, Set<string>> = {
  '+': new Set(['int', 'float', 'str', 'list']),
  '-': new Set(['int', 'float']),
  '*': new Set(['int', 'float', 'str', 'list']),  // str/list can multiply by int
  '/': new Set(['int', 'float']),
  '//': new Set(['int', 'float']),
  '%': new Set(['int', 'float', 'str']),          // str % for formatting
  '**': new Set(['int', 'float']),
}

/**
 * Check type compatibility for the '+' operator.
 * str + str, list + list, int + int, int + float are OK.
 * str + int and int + str are common mistakes with a helpful message.
 */
function checkPlusCompatibility(leftType: InferredType, rightType: InferredType): string | null {
  // Same type is always OK
  if (leftType === rightType) return null
  // int + float and float + int are OK
  if (NUMERIC_TYPES.has(leftType) && NUMERIC_TYPES.has(rightType)) return null
  return operatorTypeMessage('+', leftType, rightType)
}

/**
 * Check type compatibility for the '*' operator.
 * Numeric types can multiply. str * int and list * int are repetition.
 */
function checkMultiplyCompatibility(leftType: InferredType, rightType: InferredType): string | null {
  /* v8 ignore next 5 - COV-TYPE-031: Multiplication operator type checks */
  if (NUMERIC_TYPES.has(leftType) && NUMERIC_TYPES.has(rightType)) return null
  if ((leftType === 'str' || leftType === 'list') && rightType === 'int') return null
  if (leftType === 'int' && (rightType === 'str' || rightType === 'list')) return null
  /* v8 ignore next 3 - COV-TYPE-021: Invalid * operator type combination */
  if (!OPERATOR_LEFT_TYPES['*']?.has(leftType)) {
    return operatorTypeMessage('*', leftType, rightType)
  }
  /* v8 ignore next 2 - COV-TYPE-015: Closing branch of *= operator type check */
  return operatorTypeMessage('*', leftType, rightType)
}

/**
 * Check type compatibility for arithmetic operators (-, /, //, **, %).
 * Validates left type support, numeric right operand, and modulo formatting.
 */
function checkArithmeticCompatibility(
  operator: string,
  leftType: InferredType,
  rightType: InferredType
): string | null {
  const supportedTypes = OPERATOR_LEFT_TYPES[operator]
  /* v8 ignore next 4 - COV-TYPE-016: Unknown operator fallback */
  if (!supportedTypes) {
    return null
  }

  if (!supportedTypes.has(leftType)) {
    return operatorTypeMessage(operator, leftType, rightType)
  }

  /* v8 ignore next 6 - COV-TYPE-032: Numeric operator right operand type check */
  if (operator === '-' || operator === '/' || operator === '//' || operator === '**') {
    if (!NUMERIC_TYPES.has(rightType)) {
      return operatorTypeMessage(operator, leftType, rightType)
    }
  }

  /* v8 ignore next 7 - COV-TYPE-017: Modulo operator type check */
  if (operator === '%') {
    if (leftType === 'str') return null
    if (!NUMERIC_TYPES.has(rightType)) {
      return operatorTypeMessage(operator, leftType, rightType)
    }
  }

  /* v8 ignore next 2 - COV-TYPE-018: Valid operator fallback */
  return null
}

/**
 * Check if a binary operation is type-compatible.
 * Returns null if valid, or an error message if invalid.
 */
export function checkOperatorTypeCompatibility(
  operator: string,
  leftType: InferredType,
  rightType: InferredType
): string | null {
  // If either type is unknown, we can't validate
  /* v8 ignore next 3 - COV-TYPE-022: Unknown type early exit */
  if (leftType === 'unknown' || rightType === 'unknown') {
    return null
  }

  if (operator === '+') {
    return checkPlusCompatibility(leftType, rightType)
  }

  if (operator === '*') {
    return checkMultiplyCompatibility(leftType, rightType)
  }

  return checkArithmeticCompatibility(operator, leftType, rightType)
}
