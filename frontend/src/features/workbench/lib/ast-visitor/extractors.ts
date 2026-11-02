/**
 * AST Visitor Extractors
 *
 * Public API functions for extracting information from Python expressions
 * using tree-sitter AST parsing.
 */

import type {
  IdentifierInfo,
  FunctionCallInfo,
  MethodCallInfo,
  LocalScope,
  KeywordArgumentInfo,
  BinaryOpInfo,
} from './types'
import {
  PYTHON_LITERALS,
  parseExpression,
  visitNodes,
  isInsideStringLiteral,
  isMethodBeingCalled,
  isAttributeAccess,
  extractForClauseVariables,
  extractLambdaParams,
  getChainDepth,
  getBaseObjectName,
} from './helpers'

/**
 * Extract all identifiers from a Python expression.
 * Excludes Python keywords, literals, function names, and method names.
 */
export function extractIdentifiers(expression: string): IdentifierInfo[] {
  const rootNode = parseExpression(expression)
  /* v8 ignore next - COV-AST-005: Parser null check when tree-sitter not initialized */
  if (!rootNode) return []

  const identifiers: IdentifierInfo[] = []
  const seen = new Set<string>()

  visitNodes(rootNode, (node) => {
    if (node.type !== 'identifier') return

    const name = node.text

    // Skip Python literals (True, False, None)
    // Note: Python keywords (if, else, for, etc.) have their own node types
    // in tree-sitter, so they won't appear as 'identifier' nodes.
    /* v8 ignore next - COV-AST-009: Python literal skip branch */
    if (PYTHON_LITERALS.has(name)) return

    // Skip if inside string literal
    /* v8 ignore next - COV-AST-001: String literal identifiers filtered before visiting */
    if (isInsideStringLiteral(node)) return

    // Skip method names being called (e.g., 'upper' in items[0].upper())
    if (isMethodBeingCalled(node)) return

    // Skip attributes (but include the base object)
    if (isAttributeAccess(node)) return

    // Create unique key for deduplication
    const key = `${name}:${node.startIndex}`
    /* v8 ignore next - COV-AST-010: Deduplication branch */
    if (seen.has(key)) return
    seen.add(key)

    identifiers.push({
      name,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    })
  })

  return identifiers
}

/**
 * Extract all function calls from a Python expression.
 * Does not include method calls (obj.method()).
 */
export function extractFunctionCalls(expression: string): FunctionCallInfo[] {
  const rootNode = parseExpression(expression)
  /* v8 ignore next - COV-AST-005: Parser null check when tree-sitter not initialized */
  if (!rootNode) return []

  const calls: FunctionCallInfo[] = []

  visitNodes(rootNode, (node) => {
    if (node.type !== 'call') return

    const funcNode = node.childForFieldName('function')
    /* v8 ignore next - COV-AST-011: Defensive check for missing function node */
    if (!funcNode) return

    // Only direct function calls (identifier), not method calls (attribute)
    if (funcNode.type !== 'identifier') return

    const argsNode = node.childForFieldName('arguments')
    let argCount = 0
    if (argsNode) {
      // Count actual arguments, not punctuation
      for (const child of argsNode.children) {
        if (
          child.type !== '(' &&
          child.type !== ')' &&
          child.type !== ',' &&
          child.isNamed
        ) {
          argCount++
        }
      }
    }

    calls.push({
      name: funcNode.text,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      argumentCount: argCount,
    })
  })

  return calls
}

/**
 * Extract all method calls from a Python expression.
 */
export function extractMethodCalls(expression: string): MethodCallInfo[] {
  const rootNode = parseExpression(expression)
  /* v8 ignore next - COV-AST-005: Parser null check when tree-sitter not initialized */
  if (!rootNode) return []

  const methods: MethodCallInfo[] = []

  visitNodes(rootNode, (node) => {
    if (node.type !== 'call') return

    const funcNode = node.childForFieldName('function')
    if (funcNode?.type !== 'attribute') return

    const objNode = funcNode.childForFieldName('object')
    const attrNode = funcNode.childForFieldName('attribute')

    /* v8 ignore next - COV-AST-012: Defensive check for missing attribute node */
    if (!attrNode) return

    const methodName = attrNode.text
    const objectName = objNode?.type === 'identifier' ? objNode.text : ''
    const chainDepth = getChainDepth(attrNode)

    const argsNode = node.childForFieldName('arguments')
    let argCount = 0
    if (argsNode) {
      for (const child of argsNode.children) {
        if (
          child.type !== '(' &&
          child.type !== ')' &&
          child.type !== ',' &&
          child.isNamed
        ) {
          argCount++
        }
      }
    }

    methods.push({
      objectName: chainDepth > 0 ? getBaseObjectName(attrNode) : objectName,
      methodName,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      methodStartIndex: attrNode.startIndex,
      argumentCount: argCount,
      chainDepth,
    })
  })

  return methods
}

// Comprehension types that share the same extraction pattern
const COMPREHENSION_TYPES = new Set([
  'list_comprehension',
  'dictionary_comprehension',
  'set_comprehension',
])

/** Extract for-clause variables from a comprehension or generator node */
function extractForClauseVarsFromNode(node: { children: { type: string }[] }): string[] {
  const variables: string[] = []
  for (const child of node.children) {
    if (child.type === 'for_in_clause') {
      variables.push(...extractForClauseVariables(child as Parameters<typeof extractForClauseVariables>[0]))
    }
  }
  return variables
}

/**
 * Extract local scopes (comprehensions, lambdas) and their variables.
 */
export function extractLocalScopes(expression: string): LocalScope[] {
  const rootNode = parseExpression(expression)
  /* v8 ignore next - COV-AST-005: Parser null check when tree-sitter not initialized */
  if (!rootNode) return []

  const scopes: LocalScope[] = []

  visitNodes(rootNode, (node) => {
    if (COMPREHENSION_TYPES.has(node.type)) {
      scopes.push({
        type: 'comprehension',
        variables: extractForClauseVarsFromNode(node),
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      })
      return
    }

    if (node.type === 'generator_expression') {
      scopes.push({
        type: 'generator',
        variables: extractForClauseVarsFromNode(node),
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      })
      return
    }

    // Lambda expression
    // Note: tree-sitter has both 'lambda' keyword node and 'lambda' expression node.
    // Only the expression node has the 'parameters' field and isNamed === true.
    if (node.type === 'lambda' && node.isNamed) {
      const paramsNode = node.childForFieldName('parameters')
      // Only process if this is a lambda expression (has parameters field),
      // not the lambda keyword
      /* v8 ignore next 2 - COV-AST-006: Lambda expression guard branches */
      if (paramsNode !== null || node.childForFieldName('body') !== null) {
        const variables: string[] = paramsNode ? extractLambdaParams(paramsNode) : []
        scopes.push({
          type: 'lambda',
          variables,
          startIndex: node.startIndex,
          endIndex: node.endIndex,
        })
      }
    }
  })

  return scopes
}

/**
 * Extract keyword argument names from function calls.
 */
export function extractKeywordArguments(expression: string): KeywordArgumentInfo[] {
  const rootNode = parseExpression(expression)
  /* v8 ignore next - COV-AST-005: Parser null check when tree-sitter not initialized */
  if (!rootNode) return []

  const kwargs: KeywordArgumentInfo[] = []

  visitNodes(rootNode, (node) => {
    if (node.type !== 'keyword_argument') return

    const nameNode = node.childForFieldName('name')
    /* v8 ignore next - COV-AST-007: Defensive check for missing name node */
    if (!nameNode) return

    kwargs.push({
      name: nameNode.text,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    })
  })

  return kwargs
}

/**
 * Extract all binary operations from a Python expression.
 * Binary operations include arithmetic (+, -, *, /, //, %, **),
 * bitwise (&, |, ^, <<, >>), and comparison operators.
 */
export function extractBinaryOperations(expression: string): BinaryOpInfo[] {
  const rootNode = parseExpression(expression)
  /* v8 ignore next - COV-AST-005: Parser null check when tree-sitter not initialized */
  if (!rootNode) return []

  const operations: BinaryOpInfo[] = []

  visitNodes(rootNode, (node) => {
    if (node.type !== 'binary_operator') return

    const leftNode = node.childForFieldName('left')
    const rightNode = node.childForFieldName('right')
    const operatorNode = node.childForFieldName('operator')

    /* v8 ignore next - COV-AST-008: Defensive check for missing binary op children */
    if (!leftNode || !rightNode || !operatorNode) return

    operations.push({
      operator: operatorNode.text,
      leftNode,
      rightNode,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    })
  })

  return operations
}
