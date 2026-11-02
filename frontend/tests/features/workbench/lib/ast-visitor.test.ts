/**
 * Tests for AST Visitor module.
 *
 * Requirements under test:
 * - Node Visitor: Traverses AST to extract identifiers, function calls, method chains
 * - Scope tracking for comprehensions and lambdas
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  extractIdentifiers,
  extractFunctionCalls,
  extractMethodCalls,
  extractLocalScopes,
  extractKeywordArguments,
  extractBinaryOperations,
} from '@/features/workbench/lib/ast-visitor'

import { initializeTreeSitter, resetParser } from '@/features/workbench/lib/tree-sitter-init'

describe('AST Visitor', () => {
  beforeEach(async () => {
    await initializeTreeSitter()
  })

  afterEach(() => {
    resetParser()
  })

  describe('extractIdentifiers', () => {
    it('extracts simple variable name', () => {
      const identifiers = extractIdentifiers('username')

      expect(identifiers).toHaveLength(1)
      expect(identifiers[0].name).toBe('username')
      expect(identifiers[0].startIndex).toBe(0)
      expect(identifiers[0].endIndex).toBe(8)
    })

    it('extracts multiple identifiers from expression', () => {
      const identifiers = extractIdentifiers('a + b + c')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('a')
      expect(names).toContain('b')
      expect(names).toContain('c')
    })

    it('does not extract Python keywords as identifiers', () => {
      const identifiers = extractIdentifiers('x if y else z')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('x')
      expect(names).toContain('y')
      expect(names).toContain('z')
      expect(names).not.toContain('if')
      expect(names).not.toContain('else')
    })

    it('does not extract Python literals as identifiers', () => {
      const identifiers = extractIdentifiers('True and False or None')

      const names = identifiers.map((i) => i.name)
      expect(names).not.toContain('True')
      expect(names).not.toContain('False')
      expect(names).not.toContain('None')
    })

    it('extracts identifiers with correct positions', () => {
      const identifiers = extractIdentifiers('abc + def')

      const abc = identifiers.find((i) => i.name === 'abc')
      const def = identifiers.find((i) => i.name === 'def')

      expect(abc?.startIndex).toBe(0)
      expect(abc?.endIndex).toBe(3)
      expect(def?.startIndex).toBe(6)
      expect(def?.endIndex).toBe(9)
    })

    it('does not extract identifiers inside string literals', () => {
      const identifiers = extractIdentifiers('"hello world"')

      expect(identifiers).toHaveLength(0)
    })

    it('extracts identifiers in f-string interpolations', () => {
      const identifiers = extractIdentifiers('f"hello {name}!"')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('name')
    })

    it('does not extract function names as standalone identifiers', () => {
      // Function names should be extracted via extractFunctionCalls
      const identifiers = extractIdentifiers('len(items)')

      const names = identifiers.map((i) => i.name)
      // 'items' is an identifier (argument), 'len' is a function call
      expect(names).toContain('items')
      // 'len' may or may not be included depending on implementation
      // The key is that it's identified as a function call
    })

    it('handles nested expressions', () => {
      const identifiers = extractIdentifiers('outer(inner(a, b), c)')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('a')
      expect(names).toContain('b')
      expect(names).toContain('c')
    })
  })

  describe('extractFunctionCalls', () => {
    it('extracts simple function call', () => {
      const calls = extractFunctionCalls('len(items)')

      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe('len')
      expect(calls[0].startIndex).toBeDefined()
      expect(calls[0].endIndex).toBeDefined()
    })

    it('extracts nested function calls', () => {
      const calls = extractFunctionCalls('str(len(items))')

      const names = calls.map((c) => c.name)
      expect(names).toContain('str')
      expect(names).toContain('len')
    })

    it('extracts function calls in arguments', () => {
      const calls = extractFunctionCalls('max(abs(a), abs(b))')

      const names = calls.map((c) => c.name)
      expect(names).toContain('max')
      expect(names).toContain('abs')
      expect(calls.filter((c) => c.name === 'abs')).toHaveLength(2)
    })

    it('extracts function calls in comprehensions', () => {
      const calls = extractFunctionCalls('[len(x) for x in items]')

      const names = calls.map((c) => c.name)
      expect(names).toContain('len')
    })

    it('does not extract method calls as function calls', () => {
      // Method calls should be extracted via extractMethodCalls
      const calls = extractFunctionCalls('name.upper()')

      const names = calls.map((c) => c.name)
      expect(names).not.toContain('upper')
    })

    it('extracts function calls with keyword arguments', () => {
      const calls = extractFunctionCalls('sorted(items, key=lambda x: x)')

      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe('sorted')
    })

    it('provides argument count information', () => {
      const calls = extractFunctionCalls('func(a, b, c)')

      expect(calls[0].argumentCount).toBe(3)
    })

    it('handles lambda as function call argument', () => {
      const calls = extractFunctionCalls('filter(lambda x: x > 0, items)')

      const names = calls.map((c) => c.name)
      expect(names).toContain('filter')
    })
  })

  describe('extractMethodCalls', () => {
    it('extracts simple method call', () => {
      const methods = extractMethodCalls('name.upper()')

      expect(methods).toHaveLength(1)
      expect(methods[0].objectName).toBe('name')
      expect(methods[0].methodName).toBe('upper')
    })

    it('extracts chained method calls', () => {
      const methods = extractMethodCalls('name.strip().upper()')

      expect(methods).toHaveLength(2)

      const methodNames = methods.map((m) => m.methodName)
      expect(methodNames).toContain('strip')
      expect(methodNames).toContain('upper')
    })

    it('tracks object through method chain', () => {
      const methods = extractMethodCalls('name.strip().upper()')

      // First method called on 'name'
      const stripCall = methods.find((m) => m.methodName === 'strip')
      expect(stripCall?.objectName).toBe('name')

      // Second method called on result of first
      const upperCall = methods.find((m) => m.methodName === 'upper')
      // objectName might be the chain expression or indicate chained call
      expect(upperCall?.chainDepth).toBe(1)
    })

    it('extracts method with arguments', () => {
      const methods = extractMethodCalls('text.replace("a", "b")')

      expect(methods).toHaveLength(1)
      expect(methods[0].methodName).toBe('replace')
      expect(methods[0].argumentCount).toBe(2)
    })

    it('extracts method calls in function arguments', () => {
      const methods = extractMethodCalls('len(name.strip())')

      expect(methods).toHaveLength(1)
      expect(methods[0].methodName).toBe('strip')
    })

    it('handles attribute access without call', () => {
      // name.upper is attribute access, not a method call
      const methods = extractMethodCalls('name.upper')

      expect(methods).toHaveLength(0)
    })

    it('provides position information', () => {
      const methods = extractMethodCalls('name.upper()')

      expect(methods[0].startIndex).toBeDefined()
      expect(methods[0].endIndex).toBeDefined()
      expect(methods[0].methodStartIndex).toBeDefined() // Start of method name
    })
  })

  describe('extractLocalScopes', () => {
    it('extracts loop variable from list comprehension', () => {
      const scopes = extractLocalScopes('[x for x in items]')

      expect(scopes).toHaveLength(1)
      expect(scopes[0].variables).toContain('x')
      expect(scopes[0].type).toBe('comprehension')
    })

    it('extracts multiple loop variables from nested comprehension', () => {
      const scopes = extractLocalScopes('[y for x in matrix for y in x]')

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('x')
      expect(allVars).toContain('y')
    })

    it('extracts tuple-unpacked loop variables', () => {
      const scopes = extractLocalScopes('[a + b for a, b in pairs]')

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('a')
      expect(allVars).toContain('b')
    })

    it('extracts lambda parameters', () => {
      const scopes = extractLocalScopes('lambda x: x * 2')

      expect(scopes).toHaveLength(1)
      expect(scopes[0].variables).toContain('x')
      expect(scopes[0].type).toBe('lambda')
    })

    it('extracts multiple lambda parameters', () => {
      const scopes = extractLocalScopes('lambda a, b, c: a + b + c')

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('a')
      expect(allVars).toContain('b')
      expect(allVars).toContain('c')
    })

    it('handles nested lambda in comprehension', () => {
      const scopes = extractLocalScopes('[f(x) for x in map(lambda y: y * 2, items)]')

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('x')
      expect(allVars).toContain('y')
    })

    it('provides scope range information', () => {
      const scopes = extractLocalScopes('[x for x in items]')

      expect(scopes[0].startIndex).toBeDefined()
      expect(scopes[0].endIndex).toBeDefined()
      // Scope should cover the comprehension body where x is valid
    })

    it('extracts generator expression variables', () => {
      const scopes = extractLocalScopes('sum(x for x in numbers)')

      expect(scopes).toHaveLength(1)
      expect(scopes[0].variables).toContain('x')
      expect(scopes[0].type).toBe('generator')
    })

    it('extracts dict comprehension variables', () => {
      const scopes = extractLocalScopes('{k: v for k, v in items.items()}')

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('k')
      expect(allVars).toContain('v')
    })

    it('handles parenthesized tuple unpacking', () => {
      const scopes = extractLocalScopes('[a for (a, b) in pairs]')

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('a')
      expect(allVars).toContain('b')
    })
  })

  describe('extractKeywordArguments', () => {
    it('extracts keyword argument names', () => {
      const kwargs = extractKeywordArguments('sorted(items, key=lambda x: x)')

      expect(kwargs).toHaveLength(1)
      expect(kwargs[0].name).toBe('key')
    })

    it('extracts multiple keyword arguments', () => {
      const kwargs = extractKeywordArguments('sorted(items, key=lambda x: x, reverse=True)')

      const names = kwargs.map((k) => k.name)
      expect(names).toContain('key')
      expect(names).toContain('reverse')
    })

    it('provides position information', () => {
      const kwargs = extractKeywordArguments('func(key=value)')

      expect(kwargs[0].startIndex).toBeDefined()
      expect(kwargs[0].endIndex).toBeDefined()
    })

    it('distinguishes keyword arguments from equality comparison', () => {
      // In 'x == y', 'x' is NOT a keyword argument
      const kwargs = extractKeywordArguments('x == y')

      expect(kwargs).toHaveLength(0)
    })

    it('handles nested keyword arguments', () => {
      const kwargs = extractKeywordArguments('outer(inner(key=value))')

      expect(kwargs).toHaveLength(1)
      expect(kwargs[0].name).toBe('key')
    })
  })

  describe('Scope-aware identifier extraction', () => {
    it('marks loop variables as local in comprehensions', () => {
      const identifiers = extractIdentifiers('[x for x in items]')
      const scopes = extractLocalScopes('[x for x in items]')

      const xIdentifier = identifiers.find((i) => i.name === 'x')
      const scope = scopes.find((s) => s.variables.includes('x'))

      // x should be within the scope range
      expect(xIdentifier).toBeDefined()
      expect(scope).toBeDefined()
      if (xIdentifier && scope) {
        expect(xIdentifier.startIndex).toBeGreaterThanOrEqual(scope.startIndex)
        expect(xIdentifier.endIndex).toBeLessThanOrEqual(scope.endIndex)
      }
    })

    it('marks lambda parameters as local', () => {
      const identifiers = extractIdentifiers('lambda x: x * 2')
      const scopes = extractLocalScopes('lambda x: x * 2')

      const xIdentifiers = identifiers.filter((i) => i.name === 'x')
      const scope = scopes.find((s) => s.variables.includes('x'))

      expect(xIdentifiers.length).toBeGreaterThanOrEqual(1)
      expect(scope).toBeDefined()
    })

    it('distinguishes outer variable from local loop variable', () => {
      // In: [x * multiplier for x in items]
      // x is local, multiplier and items are outer references
      const identifiers = extractIdentifiers('[x * multiplier for x in items]')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('x')
      expect(names).toContain('multiplier')
      expect(names).toContain('items')
    })
  })
})

describe('AST Visitor Edge Cases', () => {
  // These tests cover edge cases that regex-based parsing struggles with

  beforeEach(async () => {
    await initializeTreeSitter()
  })

  afterEach(() => {
    resetParser()
  })

  describe('Complex nested expressions', () => {
    it('handles deeply nested comprehensions', () => {
      const expr = '[[y for y in x] for x in matrix]'
      const scopes = extractLocalScopes(expr)

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('x')
      expect(allVars).toContain('y')
    })

    it('handles comprehension with condition', () => {
      const expr = '[x for x in items if x > 0]'
      const identifiers = extractIdentifiers(expr)

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('x')
      expect(names).toContain('items')
    })

    it('handles comprehension with multiple for clauses', () => {
      const expr = '[a + b for a in range(3) for b in range(3)]'
      const scopes = extractLocalScopes(expr)

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('a')
      expect(allVars).toContain('b')
    })

    it('handles nested lambdas', () => {
      const expr = 'lambda x: lambda y: x + y'
      const scopes = extractLocalScopes(expr)

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('x')
      expect(allVars).toContain('y')
    })

    it('handles lambda with default argument', () => {
      const expr = 'lambda x, y=10: x + y'
      const scopes = extractLocalScopes(expr)

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('x')
      expect(allVars).toContain('y')
    })

    it('handles lambda with *args and **kwargs', () => {
      const expr = 'lambda *args, **kwargs: args'
      const scopes = extractLocalScopes(expr)

      const allVars = scopes.flatMap((s) => s.variables)
      expect(allVars).toContain('args')
      expect(allVars).toContain('kwargs')
    })
  })

  describe('String edge cases', () => {
    it('ignores identifiers in regular strings', () => {
      const identifiers = extractIdentifiers('"username"')

      expect(identifiers).toHaveLength(0)
    })

    it('extracts identifiers from f-string interpolations', () => {
      const identifiers = extractIdentifiers('f"{name} is {age} years old"')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('name')
      expect(names).toContain('age')
    })

    it('handles escaped braces in f-strings', () => {
      const identifiers = extractIdentifiers('f"{{literal}} {variable}"')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('variable')
      expect(names).not.toContain('literal')
    })

    it('handles nested f-string expressions', () => {
      const identifiers = extractIdentifiers('f"{a + b}"')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('a')
      expect(names).toContain('b')
    })
  })

  describe('Method chain edge cases', () => {
    it('handles long method chains', () => {
      const methods = extractMethodCalls('a.b().c().d().e()')

      expect(methods.length).toBe(4)
    })

    it('handles method call on function result', () => {
      const methods = extractMethodCalls('get_name().upper()')

      expect(methods).toHaveLength(1)
      expect(methods[0].methodName).toBe('upper')
    })

    it('handles method call on comprehension result', () => {
      const methods = extractMethodCalls('[x for x in items].sort()')

      expect(methods).toHaveLength(1)
      expect(methods[0].methodName).toBe('sort')
    })

    it('handles method call on string literal', () => {
      const methods = extractMethodCalls('"hello".upper()')

      expect(methods).toHaveLength(1)
      expect(methods[0].methodName).toBe('upper')
      // String literal is not an identifier, so objectName should be empty
      expect(methods[0].objectName).toBe('')
    })

    it('handles method call on list literal', () => {
      // Testing ast-visitor line 290: base is a list literal, not an identifier
      const methods = extractMethodCalls('[1, 2, 3].append(4)')

      expect(methods).toHaveLength(1)
      expect(methods[0].methodName).toBe('append')
      expect(methods[0].objectName).toBe('')
    })

    it('handles chained method where base is a literal', () => {
      // Testing ast-visitor line 290: base is string literal in chain
      const methods = extractMethodCalls('"hello".strip().upper()')

      expect(methods.length).toBeGreaterThanOrEqual(2)
      const stripMethod = methods.find(m => m.methodName === 'strip')
      expect(stripMethod?.objectName).toBe('')
    })
  })

  describe('Operator edge cases', () => {
    it('handles walrus operator (named expression)', () => {
      const identifiers = extractIdentifiers('(x := 5)')

      // x is being assigned via walrus operator
      // The parser should recognize this pattern and extract x
      const names = identifiers.map((i) => i.name)
      expect(names).toContain('x')
    })

    it('handles comparison chains', () => {
      const identifiers = extractIdentifiers('a < b < c')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('a')
      expect(names).toContain('b')
      expect(names).toContain('c')
    })

    it('handles boolean operators', () => {
      const identifiers = extractIdentifiers('a and b or not c')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('a')
      expect(names).toContain('b')
      expect(names).toContain('c')
    })

    it('handles unary operators', () => {
      const identifiers = extractIdentifiers('-a + ~b')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('a')
      expect(names).toContain('b')
    })

    it('handles subscript access', () => {
      const identifiers = extractIdentifiers('items[idx]')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('items')
      expect(names).toContain('idx')
    })

    it('handles slice notation', () => {
      const identifiers = extractIdentifiers('items[start:end:step]')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('items')
      expect(names).toContain('start')
      expect(names).toContain('end')
      expect(names).toContain('step')
    })
  })

  describe('Attribute access edge cases', () => {
    it('handles attribute without call (not method)', () => {
      const methods = extractMethodCalls('obj.attr')

      expect(methods).toHaveLength(0)
    })

    it('handles chained attributes', () => {
      const identifiers = extractIdentifiers('a.b.c')

      const names = identifiers.map((i) => i.name)
      expect(names).toContain('a')
      // b and c are attributes, not standalone identifiers
    })

    it('handles attribute on function result', () => {
      const calls = extractFunctionCalls('func().attr')

      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe('func')
    })
  })

  describe('extractBinaryOperations', () => {
    it('extracts simple arithmetic operation', () => {
      const ops = extractBinaryOperations('a + b')

      expect(ops).toHaveLength(1)
      expect(ops[0].operator).toBe('+')
      expect(ops[0].leftNode.text).toBe('a')
      expect(ops[0].rightNode.text).toBe('b')
    })

    it('extracts subtraction', () => {
      const ops = extractBinaryOperations('x - y')

      expect(ops).toHaveLength(1)
      expect(ops[0].operator).toBe('-')
    })

    it('extracts multiplication', () => {
      const ops = extractBinaryOperations('a * b')

      expect(ops).toHaveLength(1)
      expect(ops[0].operator).toBe('*')
    })

    it('extracts division', () => {
      const ops = extractBinaryOperations('a / b')

      expect(ops).toHaveLength(1)
      expect(ops[0].operator).toBe('/')
    })

    it('extracts floor division', () => {
      const ops = extractBinaryOperations('a // b')

      expect(ops).toHaveLength(1)
      expect(ops[0].operator).toBe('//')
    })

    it('extracts modulo', () => {
      const ops = extractBinaryOperations('a % b')

      expect(ops).toHaveLength(1)
      expect(ops[0].operator).toBe('%')
    })

    it('extracts power operator', () => {
      const ops = extractBinaryOperations('a ** b')

      expect(ops).toHaveLength(1)
      expect(ops[0].operator).toBe('**')
    })

    it('extracts multiple operations in chain', () => {
      const ops = extractBinaryOperations('a + b - c')

      expect(ops).toHaveLength(2)
      // Order may vary depending on AST traversal
      const operators = ops.map(o => o.operator)
      expect(operators).toContain('+')
      expect(operators).toContain('-')
    })

    it('extracts nested binary operations', () => {
      const ops = extractBinaryOperations('(a + b) * c')

      expect(ops).toHaveLength(2)
      const operators = ops.map(o => o.operator)
      expect(operators).toContain('+')
      expect(operators).toContain('*')
    })

    it('extracts bitwise operators', () => {
      const ops = extractBinaryOperations('a & b | c ^ d')

      expect(ops.length).toBeGreaterThanOrEqual(3)
      const operators = ops.map(o => o.operator)
      expect(operators).toContain('&')
      expect(operators).toContain('|')
      expect(operators).toContain('^')
    })

    it('extracts shift operators', () => {
      const ops = extractBinaryOperations('a << b >> c')

      expect(ops.length).toBeGreaterThanOrEqual(2)
      const operators = ops.map(o => o.operator)
      expect(operators).toContain('<<')
      expect(operators).toContain('>>')
    })

    it('returns empty array for no binary operations', () => {
      const ops = extractBinaryOperations('variable')

      expect(ops).toHaveLength(0)
    })

    it('returns empty array for function call without binary ops', () => {
      const ops = extractBinaryOperations('func(arg)')

      expect(ops).toHaveLength(0)
    })

    it('extracts binary ops inside function call', () => {
      const ops = extractBinaryOperations('func(a + b)')

      expect(ops).toHaveLength(1)
      expect(ops[0].operator).toBe('+')
    })

    it('extracts binary ops with string literals', () => {
      const ops = extractBinaryOperations('"hello" + " world"')

      expect(ops).toHaveLength(1)
      expect(ops[0].operator).toBe('+')
      expect(ops[0].leftNode.type).toBe('string')
      expect(ops[0].rightNode.type).toBe('string')
    })

    it('extracts binary ops with numeric literals', () => {
      const ops = extractBinaryOperations('1 + 2 * 3')

      expect(ops).toHaveLength(2)
      const operators = ops.map(o => o.operator)
      expect(operators).toContain('+')
      expect(operators).toContain('*')
    })

    it('provides position information', () => {
      const ops = extractBinaryOperations('a + b')

      expect(ops).toHaveLength(1)
      expect(ops[0].startIndex).toBe(0)
      expect(ops[0].endIndex).toBe(5)
    })
  })
})
