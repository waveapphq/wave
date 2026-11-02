/**
 * Credential-argument advisory analysis (the amber "unsecured credential"
 * walk). Any string literal or non-secret variable reference inside a
 * credential expression is unprotected material; expressions built purely
 * from secret variables stay silent. A map entry value is a literal (any
 * non-empty plaintext under a credential key is unprotected) or a whole-value
 * expression (the same credential walk applies).
 */

import type Parser from 'web-tree-sitter'
import {
  PYTHON_LITERALS,
  isAttributeAccess,
  isMethodBeingCalled,
  nodesEqual,
  parseExpression,
  visitNodes,
} from '../ast-visitor/helpers'

export interface CredentialAdvisoryVariable {
  name: string
  isSecret: boolean
}

export interface CredentialExpressionAnalysis {
  /** A string literal or non-secret variable reference was found. */
  unprotected: boolean
  /** At least one known secret variable is referenced. */
  referencesSecret: boolean
  /** At least one known variable (secret or not) is referenced. */
  referencesKnown: boolean
  /** The first non-secret variable referenced, when any. */
  nonSecretVariable: string | null
}

const SILENT: CredentialExpressionAnalysis = {
  unprotected: false,
  referencesSecret: false,
  referencesKnown: false,
  nonSecretVariable: null,
}

/** A string node carries literal text when any non-structural child (content or
 *  escape, not quotes / interpolations) has text. */
function stringHasLiteralContent(node: Parser.SyntaxNode): boolean {
  return node.children.some(
    (child) =>
      child.type !== 'string_start' &&
      child.type !== 'string_end' &&
      child.type !== 'interpolation' &&
      child.text.length > 0,
  )
}

/** The function name of a direct call (a call target is not a reference). */
function isFunctionBeingCalled(node: Parser.SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'call') return false
  return nodesEqual(parent.childForFieldName('function'), node)
}

/** A keyword argument's name (never a variable reference). */
function isKeywordArgumentName(node: Parser.SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'keyword_argument') return false
  return nodesEqual(parent.childForFieldName('name'), node)
}

/** Walk the expression tree and classify its credential material. */
export function analyzeCredentialExpression(
  expression: string,
  variables: CredentialAdvisoryVariable[],
): CredentialExpressionAnalysis {
  if (!expression.trim()) return SILENT
  const root = parseExpression(expression)
  if (!root) return SILENT
  const byName = new Map(variables.map((v) => [v.name, v.isSecret]))
  const result: CredentialExpressionAnalysis = { ...SILENT }
  visitNodes(root, (node) => {
    if (node.type === 'string') {
      if (stringHasLiteralContent(node)) result.unprotected = true
      return
    }
    if (node.type !== 'identifier') return
    const name = node.text
    if (PYTHON_LITERALS.has(name)) return
    if (isFunctionBeingCalled(node) || isMethodBeingCalled(node)) return
    if (isAttributeAccess(node) || isKeywordArgumentName(node)) return
    const isSecret = byName.get(name)
    if (isSecret === undefined) return // unresolved refs belong to validation
    result.referencesKnown = true
    if (isSecret) {
      result.referencesSecret = true
    } else {
      result.unprotected = true
      result.nonSecretVariable ??= name
    }
  })
  return result
}

/** True when a credential expression carries unprotected material. */
export function credentialExpressionAdvisory(
  expression: string,
  variables: CredentialAdvisoryVariable[],
): boolean {
  return analyzeCredentialExpression(expression, variables).unprotected
}

/** Advisory for one map entry under a credential-catalog key: a LITERAL value
 *  fires whenever it holds (non-empty) plaintext; an EXPRESSION value fires only
 *  when it carries raw literal / non-secret material - a pure secret-variable
 *  expression stays calm. */
export function mapEntryCredentialAdvisory(
  key: string,
  value: string,
  credentialKeys: string[],
  variables: CredentialAdvisoryVariable[],
  isExpr: boolean,
): boolean {
  if (!credentialKeys.includes(key.trim().toLowerCase())) return false
  if (value.trim() === '') return false
  return isExpr ? credentialExpressionAdvisory(value, variables) : true
}
