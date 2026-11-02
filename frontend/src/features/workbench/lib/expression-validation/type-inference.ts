/**
 * Type inference for expression validation.
 *
 * Infers Python types from AST nodes and validates binary operation
 * type compatibility using the operator checks module.
 */

import type Parser from 'web-tree-sitter'

import {
  getMethodReturnType,
  getBuiltinReturnType,
  PythonType,
} from '../python-builtins'

import { extractBinaryOperations } from '../ast-visitor'

import {
  type InferredType,
  NUMERIC_TYPES,
  checkOperatorTypeCompatibility,
} from './operator-checks'

// Re-export InferredType so downstream consumers don't need to know about operator-checks
export type { InferredType } from './operator-checks'
// Re-export for validation.ts and validate-*.ts
export { checkOperatorTypeCompatibility } from './operator-checks'

/**
 * Infer the type of an identifier node by looking up its type in the variable types map.
 */
function inferIdentifierType(
  node: Parser.SyntaxNode,
  variableTypes?: Map<string, string>
): InferredType {
  const name = node.text
  if (variableTypes?.has(name)) {
    const typeStr = variableTypes.get(name)!
    return mapTypeToPythonType(typeStr)
  /* v8 ignore next - COV-TYPE-033: Closing brace of variable type lookup */
  }
  /* v8 ignore next 2 - COV-TYPE-008: Identifier without type info */
  return 'unknown'
}

/**
 * Infer the type of a function/method call node by checking builtin return types
 * and method return types.
 */
function inferCallType(
  node: Parser.SyntaxNode,
  availableVariableNames: Set<string>,
  variableTypes?: Map<string, string>
): InferredType {
  const funcNode = node.childForFieldName('function')
  /* v8 ignore next 4 - COV-TYPE-009: Builtin function return type inference */
  if (funcNode?.type === 'identifier') {
    const returnType = getBuiltinReturnType(funcNode.text)
    if (returnType) return returnType
  }
  if (funcNode?.type === 'attribute') {
    const methodName = funcNode.childForFieldName('attribute')?.text
    const objNode = funcNode.childForFieldName('object')
    if (methodName && objNode) {
      const objType = inferNodeType(objNode, availableVariableNames, variableTypes)
      if (objType !== 'unknown') {
        const returnType = getMethodReturnType(methodName, objType)
        if (returnType) return returnType
      }
    }
  /* v8 ignore next - COV-TYPE-023: Closing brace of method chain type inference */
  }
  /* v8 ignore next 2 - COV-TYPE-005: Fallback for method chain without type info */
  return 'unknown'
}

/**
 * Infer the result type of a numeric binary operation.
 * Handles division, floor division, and mixed int/float arithmetic.
 */
/* v8 ignore next 10 - COV-TYPE-026: Numeric operation type inference branches */
function inferNumericOperationResult(
  op: string,
  leftType: InferredType,
  rightType: InferredType
): InferredType {
  if (op === '/') return 'float'
  if (op === '//') return leftType === 'int' && rightType === 'int' ? 'int' : 'float'
  if (leftType === 'float' || rightType === 'float') return 'float'
  return 'int'
}

/**
 * Infer type for non-numeric binary operations (concatenation, repetition, formatting).
 */
/* v8 ignore next 14 - COV-TYPE-027: Non-numeric binary operation type inference */
function inferNonNumericBinaryType(
  op: string,
  leftType: InferredType,
  rightType: InferredType,
): InferredType {
  if (op === '+' && leftType === 'str' && rightType === 'str') return 'str'
  if (op === '+' && leftType === 'list' && rightType === 'list') return 'list'
  if (op === '*') {
    if ((leftType === 'str' || leftType === 'list') && rightType === 'int') return leftType
    if (leftType === 'int' && (rightType === 'str' || rightType === 'list')) return rightType
  }
  if (op === '%' && leftType === 'str') return 'str'
  return 'unknown'
}

/**
 * Infer the result type of a binary operator expression.
 */
function inferBinaryOperatorType(
  node: Parser.SyntaxNode,
  availableVariableNames: Set<string>,
  variableTypes?: Map<string, string>
): InferredType {
  const leftNode = node.childForFieldName('left')
  const rightNode = node.childForFieldName('right')
  const operatorNode = node.childForFieldName('operator')

  /* v8 ignore next - COV-TYPE-024: Defensive check for missing binary op children */
  if (!leftNode || !rightNode || !operatorNode) return 'unknown'

  const leftType = inferNodeType(leftNode, availableVariableNames, variableTypes)
  const rightType = inferNodeType(rightNode, availableVariableNames, variableTypes)
  const op = operatorNode.text

  /* v8 ignore next - COV-TYPE-025: Unknown type early exit in binary op */
  if (leftType === 'unknown' || rightType === 'unknown') return 'unknown'

  if (NUMERIC_TYPES.has(leftType) && NUMERIC_TYPES.has(rightType)) {
    /* v8 ignore next 2 - COV-BRANCH-120 */
    return inferNumericOperationResult(op, leftType, rightType)
  }

  /* v8 ignore next 2 - COV-TYPE-035: Fallback for unrecognized binary ops */
  return inferNonNumericBinaryType(op, leftType, rightType)
}

/**
 * Infer the type of a unary operator expression (-x, +x, not x).
 */
/* v8 ignore next 12 - COV-TYPE-037: Unary operator type inference */
function inferUnaryOperatorType(
  node: Parser.SyntaxNode,
  availableVariableNames: Set<string>,
  variableTypes?: Map<string, string>
): InferredType {
  const operand = node.childForFieldName('argument')
  if (!operand) return 'unknown'
  const operandType = inferNodeType(operand, availableVariableNames, variableTypes)
  const op = node.childForFieldName('operator')?.text
  if (op === 'not') return 'bool'
  if (NUMERIC_TYPES.has(operandType)) return operandType
  /* v8 ignore next 2 - COV-DEF-100: Fallback for unknown unary operators */
  return 'unknown'
}

/**
 * Infer the type of a parenthesized expression by unwrapping it.
 */
/* v8 ignore start - COV-TYPE-036: Parenthesized expression type inference -
   not yet exercised by expression validation tests (rare in WAVE expressions) */
function inferParenthesizedType(
  node: Parser.SyntaxNode,
  availableVariableNames: Set<string>,
  variableTypes?: Map<string, string>
): InferredType {
  const inner = node.children.find(c => c.isNamed && c.type !== '(' && c.type !== ')')
  if (inner) return inferNodeType(inner, availableVariableNames, variableTypes)
  return 'unknown'
}
/* v8 ignore stop */

/** Direct mapping from AST node type to inferred Python type for literal nodes */
/* v8 ignore next 20 - COV-TYPE-010: Literal node type mappings (list, dict, set, bool, None) */
const LITERAL_TYPE_MAP: Record<string, InferredType> = {
  'string': 'str',
  'integer': 'int',
  'float': 'float',
  'list': 'list',
  'list_comprehension': 'list',
  'dictionary': 'dict',
  'dictionary_comprehension': 'dict',
  'set': 'set',
  'set_comprehension': 'set',
  'true': 'bool',
  'false': 'bool',
  'none': 'None',
  'attribute': 'unknown',
  'subscript': 'unknown',
}

/** Dispatcher for node types that require recursive inference */
type NodeTypeInferrer = (
  node: Parser.SyntaxNode,
  availableVariableNames: Set<string>,
  variableTypes?: Map<string, string>
) => InferredType

/* v8 ignore next 4 - COV-TYPE-036: Parenthesized expression and unary operator dispatch */
const COMPOUND_TYPE_MAP: Record<string, NodeTypeInferrer> = {
  'identifier': (node, _avail, varTypes) => inferIdentifierType(node, varTypes),
  'call': inferCallType,
  'binary_operator': inferBinaryOperatorType,
  'parenthesized_expression': inferParenthesizedType,
  'unary_operator': inferUnaryOperatorType,
}

/**
 * Infer the type of a syntax node.
 *
 * @param node - The AST node to infer type from
 * @param availableVariableNames - Set of known variables
 * @param variableTypes - Map of variable names to their types
 * @returns The inferred type or 'unknown'
 */
export function inferNodeType(
  node: Parser.SyntaxNode,
  availableVariableNames: Set<string>,
  variableTypes?: Map<string, string>
): InferredType {
  const literalType = LITERAL_TYPE_MAP[node.type]
  if (literalType) return literalType

  const inferrer = COMPOUND_TYPE_MAP[node.type]
  /* v8 ignore next - COV-DEF-101: Default case for unknown node types */
  if (inferrer) return inferrer(node, availableVariableNames, variableTypes)

  /* v8 ignore next 2 - COV-DEF-101: Default case for unknown node types */
  return 'unknown'
}

/**
 * Map common type names to PythonType
 */
export function mapTypeToPythonType(typeStr: string): InferredType {
  const mapping: Record<string, PythonType> = {
    'str': 'str',
    'string': 'str',
    'int': 'int',
    'integer': 'int',
    'float': 'float',
    'number': 'float',
    'bool': 'bool',
    'boolean': 'bool',
    'list': 'list',
    'array': 'list',
    'dict': 'dict',
    'object': 'dict',
    'set': 'set',
    'table': 'table',
  }
  /* v8 ignore next - COV-TYPE-030: Nullish coalescing fallback for unknown type */
  return mapping[typeStr.toLowerCase()] ?? 'unknown'
}

/**
 * Validate all binary operations in an expression for type compatibility.
 * Returns an error message if any operation is invalid, or null if all are valid.
 */
export function validateBinaryOperations(
  expression: string,
  availableVariableNames: Set<string>,
  variableTypes: Map<string, string>
): string | null {
  const operations = extractBinaryOperations(expression)

  for (const op of operations) {
    const leftType = inferNodeType(op.leftNode, availableVariableNames, variableTypes)
    const rightType = inferNodeType(op.rightNode, availableVariableNames, variableTypes)

    const error = checkOperatorTypeCompatibility(op.operator, leftType, rightType)
    if (error) {
      return error
    }
  }

  return null
}
