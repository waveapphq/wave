/**
 * Live checks of a Python script body beyond its syntax (PYRUN-13).
 *
 * REQ-3.4.1.2: Python script execution
 */

import type Parser from 'web-tree-sitter'

import {
  expectedArgCount,
  invalidMethodMessage,
  methodArgCountMessage,
  operatorTypeMessage,
  unknownFunctionMessage,
  unknownVariableMessage,
} from '@/features/workbench/lib/expression-validation/messages'
import { findSimilarVariable } from '@/features/workbench/lib/expression-validation/similarity'
import type { ValidationIssueType } from '@/features/workbench/lib/expression-validation/types'
import { analyzeScriptScopes, type ScriptNameRead, type ScriptScopes } from './script-scopes'
import { RUNTIME_BUILTIN_NAMES } from './runtime-builtin-names'
import { inputRuntimeType, type InputRuntimeType } from './input-runtime-types'
import { alwaysRaisesTypeError, type OperandKind } from './operator-rules'
import type { ScriptWarning } from './script-issues'

type SyntaxNode = Parser.SyntaxNode

/** A Python check warning; its type is the expression field's issue type, which picks the underline. */
export type PythonScriptWarning = ScriptWarning & {
  type: Extract<ValidationIssueType, 'unknown_variable' | 'invalid_function'>
}

export interface ScriptInputs {
  names: readonly string[]
  /** The WAVE type of each Input Variable whose type is known. */
  types: Readonly<Record<string, string>>
}

/** The bridge's own globals, plus the annotation names whose presence differs between Python versions. */
const MODULE_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  '__name__',
  '__file__',
  '__doc__',
  '__package__',
  '__builtins__',
  '__annotations__',
  '__annotate__',
])

const LITERAL_KINDS: ReadonlyMap<string, OperandKind> = new Map([
  ['true', 'bool'],
  ['false', 'bool'],
  ['none', 'NoneType'],
  ['list', 'list'],
  ['tuple', 'tuple'],
  ['dictionary', 'dict'],
  ['set', 'set'],
])

function warningAt(
  node: { startIndex: number; endIndex: number; startPosition: { row: number } },
  message: string,
  type: PythonScriptWarning['type'],
): PythonScriptWarning {
  return {
    line: node.startPosition.row + 1,
    message,
    severity: 'warning',
    from: node.startIndex,
    to: node.endIndex,
    type,
  }
}

function unknownNameWarning(
  read: ScriptNameRead,
  scopes: ScriptScopes,
  inputs: ScriptInputs,
): PythonScriptWarning {
  const place = { startIndex: read.from, endIndex: read.to, startPosition: { row: read.line - 1 } }
  if (read.callTarget) {
    return warningAt(place, unknownFunctionMessage(read.name), 'invalid_function')
  }
  const candidates = new Set([...scopes.visibleNames(read), ...inputs.names, ...RUNTIME_BUILTIN_NAMES])
  const suggestion = findSimilarVariable(read.name, candidates)
  return warningAt(place, unknownVariableMessage(read.name, suggestion), 'unknown_variable')
}

function unknownNameWarnings(scopes: ScriptScopes, inputs: ScriptInputs): PythonScriptWarning[] {
  const inputNames = new Set(inputs.names)
  return scopes.reads
    .filter(
      (read) =>
        !scopes.isBound(read) &&
        !inputNames.has(read.name) &&
        !MODULE_GLOBAL_NAMES.has(read.name) &&
        !RUNTIME_BUILTIN_NAMES.has(read.name),
    )
    .map((read) => unknownNameWarning(read, scopes, inputs))
}

/** Input Variables the script never rebinds, so every read of one is the value the bridge set. */
function typedInputs(inputs: ScriptInputs, scopes: ScriptScopes): Map<string, InputRuntimeType> {
  const typed = new Map<string, InputRuntimeType>()
  for (const name of inputs.names) {
    const waveType = Object.hasOwn(inputs.types, name) ? inputs.types[name] : undefined
    const runtime = waveType === undefined ? undefined : inputRuntimeType(waveType)
    if (runtime && !scopes.boundNames.has(name)) typed.set(name, runtime)
  }
  return typed
}

/** Null when an unpacked argument hides the count. */
function argumentCount(args: SyntaxNode): number | null {
  if (args.type === 'generator_expression') return 1
  const values = args.namedChildren.filter((child) => child.type !== 'comment')
  if (values.some((child) => child.type === 'list_splat' || child.type === 'dictionary_splat')) {
    return null
  }
  return values.length
}

function methodWarning(
  call: SyntaxNode,
  typed: ReadonlyMap<string, InputRuntimeType>,
): PythonScriptWarning | null {
  const callee = call.childForFieldName('function')
  if (callee?.type !== 'attribute') return null
  const object = callee.childForFieldName('object')
  const method = callee.childForFieldName('attribute')
  const runtime = object?.type === 'identifier' ? typed.get(object.text) : undefined
  if (!runtime || !method) return null
  if (!runtime.methods.has(method.text)) {
    return warningAt(method, invalidMethodMessage(method.text, runtime.name), 'invalid_function')
  }
  const range = runtime.methods.get(method.text) ?? null
  const count = argumentCount(call.childForFieldName('arguments') as SyntaxNode)
  if (range === null || count === null) return null
  const [min, max] = range
  if (count >= min && (max === -1 || count <= max)) return null
  return warningAt(
    method,
    methodArgCountMessage(method.text, expectedArgCount(min, max), count),
    'invalid_function',
  )
}

/** The first child of a string is its opening quote with any prefix letters; only the prefix can hold a b. */
function stringKind(node: SyntaxNode): OperandKind {
  return /b/i.test(node.namedChildren[0].text) ? 'bytes' : 'str'
}

function numberKind(node: SyntaxNode, plain: OperandKind): OperandKind {
  return /j$/i.test(node.text) ? 'complex' : plain
}

function operandKind(
  node: SyntaxNode,
  typed: ReadonlyMap<string, InputRuntimeType>,
): OperandKind | undefined {
  switch (node.type) {
    case 'identifier':
      return typed.get(node.text)?.name
    case 'integer':
      return numberKind(node, 'int')
    case 'float':
      return numberKind(node, 'float')
    case 'string':
      return stringKind(node)
    case 'concatenated_string':
      return stringKind(node.namedChildren[0])
    case 'parenthesized_expression':
      return operandKind(
        node.namedChildren.find((child) => child.type !== 'comment') as SyntaxNode,
        typed,
      )
    case 'unary_operator': {
      const operator = (node.childForFieldName('operator') as SyntaxNode).text
      const argument = node.childForFieldName('argument') as SyntaxNode
      const numeric = argument.type === 'integer' || argument.type === 'float'
      return numeric && operator !== '~' ? operandKind(argument, typed) : undefined
    }
    default:
      return LITERAL_KINDS.get(node.type)
  }
}

function operatorWarning(
  node: SyntaxNode,
  typed: ReadonlyMap<string, InputRuntimeType>,
): PythonScriptWarning | null {
  const operator = node.childForFieldName('operator') as SyntaxNode
  const left = operandKind(node.childForFieldName('left') as SyntaxNode, typed)
  const right = operandKind(node.childForFieldName('right') as SyntaxNode, typed)
  if (!left || !right) return null
  if (!alwaysRaisesTypeError(operator.text, left, right)) return null
  return warningAt(operator, operatorTypeMessage(operator.text, left, right), 'invalid_function')
}

function nodeWarning(
  node: SyntaxNode,
  typed: ReadonlyMap<string, InputRuntimeType>,
): PythonScriptWarning | null {
  if (node.type === 'call') return methodWarning(node, typed)
  if (node.type === 'binary_operator') return operatorWarning(node, typed)
  return null
}

function typedWarnings(
  node: SyntaxNode,
  typed: ReadonlyMap<string, InputRuntimeType>,
  warnings: PythonScriptWarning[],
): void {
  if (node.type === 'type') return
  const warning = nodeWarning(node, typed)
  if (warning) warnings.push(warning)
  for (const child of node.namedChildren) typedWarnings(child, typed, warnings)
}

/** The script must parse: a tree with syntax errors has no trustworthy scopes. */
export function checkPythonScript(root: SyntaxNode, inputs: ScriptInputs): PythonScriptWarning[] {
  const scopes = analyzeScriptScopes(root)
  if (scopes.starImport || scopes.dynamicNamespace) return []
  const warnings = unknownNameWarnings(scopes, inputs)
  typedWarnings(root, typedInputs(inputs, scopes), warnings)
  return warnings.sort((left, right) => left.from - right.from)
}
