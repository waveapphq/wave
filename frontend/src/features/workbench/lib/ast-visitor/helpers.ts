/**
 * AST Visitor Helpers
 *
 * Internal helper functions for traversing and inspecting tree-sitter Python AST nodes.
 * These are not part of the public API - they are used by the extractor functions.
 */

import type Parser from 'web-tree-sitter'
import { getParser } from '../tree-sitter-init'

// ============================================
// Constants
// ============================================

export const PYTHON_LITERALS = new Set(['True', 'False', 'None'])

// ============================================
// Core Helpers
// ============================================

/**
 * Parse expression and return the root node.
 */
export function parseExpression(expression: string): Parser.SyntaxNode | null {
  const parser = getParser()
  /* v8 ignore next 3 - COV-AST-005: Parser null check when tree-sitter not initialized */
  if (!parser) {
    return null
  }
  const tree = parser.parse(expression)
  return tree.rootNode
}

/**
 * Recursively visit all nodes in the AST and call the visitor function.
 */
export function visitNodes(
  node: Parser.SyntaxNode,
  visitor: (node: Parser.SyntaxNode) => void
): void {
  visitor(node)
  for (const child of node.children) {
    visitNodes(child, visitor)
  }
}

/**
 * Check if a node is inside a string literal (but not an f-string interpolation).
 */
export function isInsideStringLiteral(node: Parser.SyntaxNode): boolean {
  let current: Parser.SyntaxNode | null = node.parent
  while (current) {
    // If we hit an interpolation, we're in f-string expression territory (valid)
    if (current.type === 'interpolation') {
      return false
    }
    /* v8 ignore next 4 - COV-AST-001: String literal identifiers filtered before visiting */
    if (current.type === 'string') {
      return true
    }
    current = current.parent
  }
  return false
}

/**
 * Compare two tree-sitter nodes for equality.
 * Tree-sitter nodes can't be compared with === directly.
 */
export function nodesEqual(
  a: Parser.SyntaxNode | null | undefined,
  b: Parser.SyntaxNode | null | undefined
): boolean {
  /* v8 ignore next - COV-AST-013: Null check for tree-sitter node comparison */
  if (!a || !b) return false
  return a.equals(b)
}

// ============================================
// Node Inspection Helpers
// ============================================

/**
 * Check if an identifier is a method being called.
 */
export function isMethodBeingCalled(node: Parser.SyntaxNode): boolean {
  const parent = node.parent
  /* v8 ignore next - COV-AST-014: Parent null check - all identifiers have parents in valid expressions */
  if (!parent) return false

  // Method call: obj.method(...)
  // The method name is the 'attribute' field of an 'attribute' node
  // that is the 'function' of a 'call' node
  if (parent.type === 'attribute') {
    const attrField = parent.childForFieldName('attribute')
    if (nodesEqual(attrField, node)) {
      const grandparent = parent.parent
      if (grandparent?.type === 'call') {
        const funcNode = grandparent.childForFieldName('function')
        return nodesEqual(funcNode, parent)
      }
    }
  }

  return false
}

/**
 * Check if an identifier is an attribute access (not method call).
 */
export function isAttributeAccess(node: Parser.SyntaxNode): boolean {
  const parent = node.parent
  /* v8 ignore next - COV-AST-014: Parent null check - all identifiers have parents in valid expressions */
  if (!parent) return false

  if (parent.type === 'attribute') {
    const attrField = parent.childForFieldName('attribute')
    return nodesEqual(attrField, node) && !isMethodBeingCalled(node)
  }

  return false
}

// ============================================
// Extraction Helpers
// ============================================

/**
 * Extract variables from a for_in_clause node.
 */
export function extractForClauseVariables(node: Parser.SyntaxNode): string[] {
  const variables: string[] = []
  const left = node.childForFieldName('left')

  if (left) {
    if (left.type === 'identifier') {
      variables.push(left.text)
    /* v8 ignore next 3 - COV-AST-015: Pattern list branch for tuple unpacking variations */
    } else if (
      left.type === 'tuple_pattern' ||
      left.type === 'pattern_list' ||
      /* v8 ignore next - COV-AST-002: 'tuple' type kept for completeness but tree-sitter uses tuple_pattern */
      left.type === 'tuple'
    ) {
      // Tuple unpacking: for a, b in ... or for (a, b) in ...
      for (const child of left.children) {
        if (child.type === 'identifier') {
          variables.push(child.text)
        }
      }
    }
  }

  return variables
}

/** Types that contain a nested identifier for *args or **kwargs */
const SPLAT_TYPES = new Set([
  'list_splat_pattern',
  'list_splat',
  'dictionary_splat_pattern',
  'dictionary_splat',
])

/** Extract identifiers from a splat node (*args or **kwargs) */
function extractSplatIdentifiers(node: Parser.SyntaxNode): string[] {
  const ids: string[] = []
  for (const subchild of node.children) {
    if (subchild.type === 'identifier') {
      ids.push(subchild.text)
    }
  }
  return ids
}

/**
 * Extract parameters from lambda parameters node.
 */
export function extractLambdaParams(paramsNode: Parser.SyntaxNode): string[] {
  const params: string[] = []

  for (const child of paramsNode.children) {
    if (child.type === 'identifier') {
      params.push(child.text)
    } else if (child.type === 'default_parameter') {
      const name = child.childForFieldName('name')
      if (name?.type === 'identifier') {
        params.push(name.text)
      }
    } else if (SPLAT_TYPES.has(child.type)) {
      params.push(...extractSplatIdentifiers(child))
    }
  }

  return params
}

// ============================================
// Method Chain Helpers
// ============================================

/**
 * Get the chain depth for a method call (how many calls before this one).
 */
export function getChainDepth(node: Parser.SyntaxNode): number {
  let depth = 0
  let current: Parser.SyntaxNode | null = node

  // Walk up to find the call node
  while (current && current.type !== 'call') {
    current = current.parent
  }

  /* v8 ignore next - COV-AST-016: Current null when method not in call context */
  if (!current) return 0

  // Now walk down the function chain
  let func: Parser.SyntaxNode | null = current.childForFieldName('function')
  while (func) {
    if (func.type === 'attribute') {
      const obj = func.childForFieldName('object')
      if (obj?.type === 'call') {
        depth++
        func = obj.childForFieldName('function')
      } else {
        break
      }
    } else {
      break
    }
  }

  return depth
}

/**
 * Get the base object name for a method chain.
 */
export function getBaseObjectName(node: Parser.SyntaxNode): string {
  // Walk up to find the call node
  let current: Parser.SyntaxNode | null = node
  while (current && current.type !== 'call') {
    current = current.parent
  }

  /* v8 ignore next - COV-AST-016: Current null when method not in call context */
  if (!current) return ''

  // Walk down to find the base object
  let func: Parser.SyntaxNode | null = current.childForFieldName('function')
  while (func) {
    if (func.type === 'attribute') {
      const obj = func.childForFieldName('object')
      if (obj?.type === 'call') {
        func = obj.childForFieldName('function')
      } else if (obj?.type === 'identifier') {
        return obj.text
      } else {
        // Base is something else (string literal, list, etc.)
        return ''
      }
    } else if (func.type === 'identifier') {
      return func.text
    /* v8 ignore next 3 - COV-AST-003: Defensive branch for unexpected AST node types */
    } else {
      break
    }
  /* v8 ignore next - COV-AST-017: While loop close brace branch */
  }
  /* v8 ignore next 2 - COV-AST-004: Defensive return for empty method chain base */
  return ''
}
