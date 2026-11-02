/**
 * AST Visitor Types
 *
 * Type definitions for AST visitor extraction results.
 */

import type Parser from 'web-tree-sitter'

export interface IdentifierInfo {
  name: string
  startIndex: number
  endIndex: number
}

export interface FunctionCallInfo {
  name: string
  startIndex: number
  endIndex: number
  argumentCount: number
}

export interface MethodCallInfo {
  objectName: string
  methodName: string
  startIndex: number
  endIndex: number
  methodStartIndex: number
  argumentCount: number
  chainDepth: number
}

export interface LocalScope {
  type: 'comprehension' | 'lambda' | 'generator'
  variables: string[]
  startIndex: number
  endIndex: number
}

export interface KeywordArgumentInfo {
  name: string
  startIndex: number
  endIndex: number
}

export interface BinaryOpInfo {
  operator: string           // '+', '-', '*', '/', '//', '%', '**', etc.
  leftNode: Parser.SyntaxNode
  rightNode: Parser.SyntaxNode
  startIndex: number
  endIndex: number
}
