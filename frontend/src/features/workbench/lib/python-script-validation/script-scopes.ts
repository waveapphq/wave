/**
 * Python scope analysis over a tree-sitter parse of a script body (PYRUN-13).
 *
 * REQ-3.4.1.2: Python script execution
 */

import type Parser from 'web-tree-sitter'

type SyntaxNode = Parser.SyntaxNode

type ScopeKind = 'module' | 'function' | 'class' | 'comprehension'

interface Scope {
  kind: ScopeKind
  parent: Scope | null
  bindings: Set<string>
  /** Global and nonlocal declarations. */
  declared: Set<string>
  /** Names Python itself provides in this scope. */
  implicit: ReadonlySet<string>
}

/** One name the script reads. The line is 1-based. */
export interface ScriptNameRead {
  name: string
  from: number
  to: number
  line: number
  callTarget: boolean
}

export interface ScriptScopes {
  /** In document order. */
  reads: ScriptNameRead[]
  /** Every name the script binds, in any scope. */
  boundNames: ReadonlySet<string>
  starImport: boolean
  /** The script reaches a namespace in a way no text analysis can follow. */
  dynamicNamespace: boolean
  /** The read finds a binding of the script in a scope Python searches for it. */
  isBound: (read: ScriptNameRead) => boolean
  /** The script's names the read can see, innermost scope first. */
  visibleNames: (read: ScriptNameRead) => string[]
}

const NO_NAMES: ReadonlySet<string> = new Set()
const CLASS_BODY_NAMES: ReadonlySet<string> = new Set(['__module__', '__qualname__', '__firstlineno__'])
const METHOD_NAMES: ReadonlySet<string> = new Set(['__class__'])
const DYNAMIC_NAMESPACE_NAMES: ReadonlySet<string> = new Set([
  'globals',
  'locals',
  'vars',
  'exec',
  'eval',
  '__builtins__',
  '__import__',
])
const COMPREHENSIONS: ReadonlySet<string> = new Set([
  'list_comprehension',
  'set_comprehension',
  'dictionary_comprehension',
  'generator_expression',
])
const TARGET_CONTAINERS: ReadonlySet<string> = new Set([
  'pattern_list',
  'tuple_pattern',
  'list_pattern',
  'tuple',
  'list',
  'parenthesized_expression',
  'list_splat_pattern',
  'list_splat',
  'expression_list',
  'as_pattern_target',
])
const PATTERN_LITERALS: ReadonlySet<string> = new Set([
  'string',
  'concatenated_string',
  'integer',
  'float',
  'true',
  'false',
  'none',
  'complex_pattern',
])

function newScope(kind: ScopeKind, parent: Scope | null, implicit: ReadonlySet<string>): Scope {
  return { kind, parent, bindings: new Set(), declared: new Set(), implicit }
}

function insideClass(scope: Scope): boolean {
  for (let current: Scope | null = scope; current; current = current.parent) {
    if (current.kind === 'class') return true
  }
  return false
}

function namedIdentifiers(node: SyntaxNode): SyntaxNode[] {
  return node.namedChildren.filter((child) => child.type === 'identifier')
}

function catchesNameError(clause: SyntaxNode): boolean {
  return clause.namedChildren
    .filter((child) => child.type !== 'block')
    .some((child) =>
      child.type === 'identifier'
        ? child.text === 'NameError'
        : child.descendantsOfType('identifier').some((id) => id.text === 'NameError'),
    )
}

class ScopeWalker {
  readonly module = newScope('module', null, NO_NAMES)
  readonly reads: ScriptNameRead[] = []
  readonly scopeOfRead = new Map<ScriptNameRead, Scope>()
  readonly boundNames = new Set<string>()
  starImport = false
  dynamicNamespace = false
  private guardDepth = 0

  bind(scope: Scope, name: string): void {
    scope.bindings.add(name)
    this.boundNames.add(name)
  }

  readName(node: SyntaxNode, scope: Scope, callTarget = false): void {
    const name = node.text
    if (DYNAMIC_NAMESPACE_NAMES.has(name)) this.dynamicNamespace = true
    if (this.guardDepth > 0) return
    const read: ScriptNameRead = {
      name,
      from: node.startIndex,
      to: node.endIndex,
      line: node.startPosition.row + 1,
      callTarget,
    }
    this.reads.push(read)
    this.scopeOfRead.set(read, scope)
  }

  visitChildren(node: SyntaxNode, scope: Scope): void {
    for (const child of node.children) this.visit(child, scope)
  }

  visit(node: SyntaxNode, scope: Scope): void {
    switch (node.type) {
      case 'identifier':
        this.readName(node, scope)
        return
      case 'type':
        return
      case 'call':
        this.visitCall(node, scope)
        return
      case 'attribute':
        this.visitField(node, 'object', scope)
        return
      case 'keyword_argument':
        this.visitField(node, 'value', scope)
        return
      case 'function_definition':
        this.visitFunction(node, scope)
        return
      case 'lambda':
        this.visitLambda(node, scope)
        return
      case 'class_definition':
        this.visitClass(node, scope)
        return
      case 'assignment':
      case 'augmented_assignment':
      case 'for_statement':
      case 'as_pattern':
        this.visitWithTargets(node, scope)
        return
      case 'named_expression':
        this.visitWalrus(node, scope)
        return
      case 'delete_statement':
        for (const child of node.namedChildren) this.bindTarget(child, scope)
        return
      case 'import_statement':
      case 'import_from_statement':
      case 'future_import_statement':
        this.visitImport(node, scope)
        return
      case 'global_statement':
        for (const id of namedIdentifiers(node)) {
          scope.declared.add(id.text)
          this.bind(this.module, id.text)
        }
        return
      case 'nonlocal_statement':
        for (const id of namedIdentifiers(node)) scope.declared.add(id.text)
        return
      case 'type_alias_statement':
        this.visitTypeAlias(node, scope)
        return
      case 'try_statement':
        this.visitTry(node, scope)
        return
      case 'case_clause':
        this.visitCase(node, scope)
        return
      default:
        if (COMPREHENSIONS.has(node.type)) {
          this.visitComprehension(node, scope)
          return
        }
        this.visitChildren(node, scope)
    }
  }

  visitField(node: SyntaxNode, field: string, scope: Scope): void {
    for (const child of node.childrenForFieldName(field)) this.visit(child, scope)
  }

  visitCall(node: SyntaxNode, scope: Scope): void {
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index) as SyntaxNode
      if (node.fieldNameForChild(index) === 'function' && child.type === 'identifier') {
        this.readName(child, scope, true)
      } else {
        this.visit(child, scope)
      }
    }
  }

  /** Visits every child, binding the ones in a target field instead of reading them. */
  visitWithTargets(node: SyntaxNode, scope: Scope): void {
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index) as SyntaxNode
      const field = node.fieldNameForChild(index)
      if (field === 'left' || field === 'alias') {
        this.bindTarget(child, scope)
      } else {
        this.visit(child, scope)
      }
    }
  }

  bindTarget(node: SyntaxNode, scope: Scope): void {
    if (node.type === 'identifier') {
      this.bind(scope, node.text)
    } else if (TARGET_CONTAINERS.has(node.type)) {
      for (const child of node.namedChildren) this.bindTarget(child, scope)
    } else {
      this.visit(node, scope)
    }
  }

  visitWalrus(node: SyntaxNode, scope: Scope): void {
    let target = scope
    while (target.kind === 'comprehension' && target.parent) target = target.parent
    for (const name of node.childrenForFieldName('name')) this.bind(target, name.text)
    this.visitField(node, 'value', scope)
  }

  bindTypeParameters(node: SyntaxNode | null): void {
    if (!node) return
    for (const id of node.descendantsOfType('identifier')) this.bind(this.module, id.text)
  }

  visitParameters(node: SyntaxNode | null, outer: Scope, inner: Scope): void {
    if (!node) return
    for (const child of node.namedChildren) this.bindParameter(child, outer, inner)
  }

  bindParameter(node: SyntaxNode, outer: Scope, inner: Scope): void {
    switch (node.type) {
      case 'identifier':
        this.bind(inner, node.text)
        return
      case 'default_parameter':
      case 'typed_default_parameter':
        for (const name of node.childrenForFieldName('name')) this.bindParameter(name, outer, inner)
        this.visitField(node, 'value', outer)
        return
      case 'type':
        return
      default:
        for (const child of node.namedChildren) this.bindParameter(child, outer, inner)
    }
  }

  visitFunction(node: SyntaxNode, scope: Scope): void {
    for (const name of node.childrenForFieldName('name')) this.bind(scope, name.text)
    this.bindTypeParameters(node.childForFieldName('type_parameters'))
    const inner = newScope('function', scope, insideClass(scope) ? METHOD_NAMES : NO_NAMES)
    this.visitParameters(node.childForFieldName('parameters'), scope, inner)
    this.visitField(node, 'body', inner)
  }

  visitLambda(node: SyntaxNode, scope: Scope): void {
    const inner = newScope('function', scope, insideClass(scope) ? METHOD_NAMES : NO_NAMES)
    this.visitParameters(node.childForFieldName('parameters'), scope, inner)
    this.visitField(node, 'body', inner)
  }

  visitClass(node: SyntaxNode, scope: Scope): void {
    for (const name of node.childrenForFieldName('name')) this.bind(scope, name.text)
    this.bindTypeParameters(node.childForFieldName('type_parameters'))
    this.visitField(node, 'superclasses', scope)
    this.visitField(node, 'body', newScope('class', scope, CLASS_BODY_NAMES))
  }

  /** The first iterable is read where the comprehension sits; everything else inside it. */
  visitComprehension(node: SyntaxNode, scope: Scope): void {
    const inner = newScope('comprehension', scope, NO_NAMES)
    let first = true
    for (const child of node.namedChildren) {
      if (child.type === 'for_in_clause') {
        this.visitField(child, 'right', first ? scope : inner)
        for (const left of child.childrenForFieldName('left')) this.bindTarget(left, inner)
        first = false
      } else {
        this.visit(child, inner)
      }
    }
  }

  visitImport(node: SyntaxNode, scope: Scope): void {
    const moduleName = node.childForFieldName('module_name')
    if (moduleName?.text === 'builtins') this.dynamicNamespace = true
    if (node.namedChildren.some((child) => child.type === 'wildcard_import')) this.starImport = true
    for (const name of node.childrenForFieldName('name')) {
      if (name.type === 'aliased_import') {
        const alias = name.childForFieldName('alias') as SyntaxNode
        if ((name.childForFieldName('name') as SyntaxNode).text === 'builtins') {
          this.dynamicNamespace = true
        }
        this.bind(scope, alias.text)
      } else {
        if (name.text === 'builtins') this.dynamicNamespace = true
        this.bind(scope, name.namedChildren[0].text)
      }
    }
  }

  /** The alias name binds where the statement sits; its value is never evaluated there. */
  visitTypeAlias(node: SyntaxNode, scope: Scope): void {
    const head = node.namedChildren[0]
    const [name, ...parameters] = head.descendantsOfType('identifier')
    this.bind(scope, name.text)
    for (const parameter of parameters) this.bind(this.module, parameter.text)
  }

  visitTry(node: SyntaxNode, scope: Scope): void {
    const guarded = node.namedChildren.some(
      (child) => child.type === 'except_clause' && catchesNameError(child),
    )
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index) as SyntaxNode
      const guard = guarded && node.fieldNameForChild(index) === 'body'
      if (guard) this.guardDepth += 1
      this.visit(child, scope)
      if (guard) this.guardDepth -= 1
    }
  }

  visitCase(node: SyntaxNode, scope: Scope): void {
    for (const child of node.children) {
      if (child.type === 'case_pattern') {
        this.visitPattern(child, scope)
      } else {
        this.visit(child, scope)
      }
    }
  }

  visitPattern(node: SyntaxNode, scope: Scope): void {
    switch (node.type) {
      case 'dotted_name':
        this.visitDottedPattern(node, scope)
        return
      case 'identifier':
        this.bind(scope, node.text)
        return
      case 'class_pattern':
        for (const child of node.namedChildren) {
          if (child.type === 'dotted_name') {
            this.readName(child.namedChildren[0], scope)
          } else {
            this.visitPattern(child, scope)
          }
        }
        return
      case 'keyword_pattern':
        for (const child of node.namedChildren.slice(1)) this.visitPattern(child, scope)
        return
      case 'dict_pattern':
        this.visitDictPattern(node, scope)
        return
      default:
        if (PATTERN_LITERALS.has(node.type)) return
        for (const child of node.namedChildren) this.visitPattern(child, scope)
    }
  }

  /** A single name captures; a dotted name reads its first part as a value. */
  visitDottedPattern(node: SyntaxNode, scope: Scope): void {
    const parts = node.namedChildren
    if (parts.length === 1) {
      this.bind(scope, parts[0].text)
    } else {
      this.readName(parts[0], scope)
    }
  }

  visitDictPattern(node: SyntaxNode, scope: Scope): void {
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index) as SyntaxNode
      if (!child.isNamed) continue
      if (node.fieldNameForChild(index) !== 'key') {
        this.visitPattern(child, scope)
      } else if (child.type === 'dotted_name' && child.namedChildren.length > 1) {
        this.readName(child.namedChildren[0], scope)
      }
    }
  }
}

function lookup(scopeOfRead: ReadonlyMap<ScriptNameRead, Scope>, read: ScriptNameRead): Scope[] {
  const searched: Scope[] = []
  let origin = true
  for (let scope: Scope | null | undefined = scopeOfRead.get(read); scope; scope = scope.parent) {
    if (origin || scope.kind !== 'class') searched.push(scope)
    origin = false
  }
  return searched
}

export function analyzeScriptScopes(root: SyntaxNode): ScriptScopes {
  const walker = new ScopeWalker()
  walker.visit(root, walker.module)
  const reads = [...walker.reads].sort((left, right) => left.from - right.from)

  return {
    reads,
    boundNames: walker.boundNames,
    starImport: walker.starImport,
    dynamicNamespace: walker.dynamicNamespace,
    isBound: (read) =>
      lookup(walker.scopeOfRead, read).some(
        (scope) =>
          scope.bindings.has(read.name) ||
          scope.declared.has(read.name) ||
          scope.implicit.has(read.name),
      ),
    visibleNames: (read) => {
      const names = new Set<string>()
      for (const scope of lookup(walker.scopeOfRead, read)) {
        for (const name of scope.bindings) names.add(name)
      }
      return [...names]
    },
  }
}
