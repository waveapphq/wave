/**
 * Tests for validate-identifiers.ts - validateSimpleVariable and validateMethodCall.
 *
 * These functions validate identifier-based expression types:
 * - simple_variable: bare identifier (e.g., "my_var")
 * - method_call: variable with method chain (e.g., "my_var.upper()")
 *
 * Tree-sitter is initialized globally in tests/setup.ts (required by AST extractors).
 */

import { describe, it, expect } from 'vitest'
import {
  validateSimpleVariable,
  validateMethodCall,
} from '@/features/workbench/lib/expression-validation/validate-identifiers'
import { buildValidationContext } from '@/features/workbench/lib/expression-validation/validation-context'
import type { ValidationContext } from '@/features/workbench/lib/expression-validation/validation-context'
import type { ValidationIssue } from '@/features/workbench/lib/expression-validation/types'

// Note: tree-sitter is initialized globally in tests/setup.ts

// ============================================
// Helpers
// ============================================

/** Build a ValidationContext with sensible defaults for testing. */
function makeCtx(
  vars: string[],
  opts?: {
    variableTypes?: Map<string, string>
    isFieldExpression?: boolean
  },
): ValidationContext {
  return buildValidationContext(
    new Set(vars),
    opts?.variableTypes,
    opts?.isFieldExpression,
  )
}

// Default position range for tests (0-based, covers a typical short expression)
const FROM = 0
const TO = 10

// ============================================
// validateSimpleVariable
// ============================================

describe('validateSimpleVariable', () => {
  describe('valid variable references', () => {
    it('returns no issues for a known variable', () => {
      const ctx = makeCtx(['username', 'count'])
      const classification = { type: 'simple_variable' as const, name: 'username' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('returns no issues for another known variable', () => {
      const ctx = makeCtx(['alpha', 'beta', 'gamma'])
      const classification = { type: 'simple_variable' as const, name: 'gamma' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })
  })

  describe('Python literals (True, False, None)', () => {
    it('returns no issues for True', () => {
      const ctx = makeCtx([])
      const classification = { type: 'simple_variable' as const, name: 'True' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('returns no issues for False', () => {
      const ctx = makeCtx([])
      const classification = { type: 'simple_variable' as const, name: 'False' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('returns no issues for None', () => {
      const ctx = makeCtx([])
      const classification = { type: 'simple_variable' as const, name: 'None' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })
  })

  describe('undefined variable detection', () => {
    it('returns unknown_variable issue for undefined variable', () => {
      const ctx = makeCtx(['username', 'count'])
      const classification = { type: 'simple_variable' as const, name: 'totally_unknown' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('unknown_variable')
      expect(issues[0].identifier).toBe('totally_unknown')
      expect(issues[0].message).toContain("'totally_unknown' is not defined")
      expect(issues[0].from).toBe(FROM)
      expect(issues[0].to).toBe(TO)
    })

    it('suggests a similar variable name when a close match exists', () => {
      const ctx = makeCtx(['username', 'count'])
      const classification = { type: 'simple_variable' as const, name: 'usernam' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('unknown_variable')
      expect(issues[0].suggestion).toBe('username')
      expect(issues[0].message).toContain("Did you mean 'username'")
    })

    it('does not suggest when no similar variable exists', () => {
      const ctx = makeCtx(['username', 'count'])
      const classification = { type: 'simple_variable' as const, name: 'zzzzzzzzz' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].suggestion).toBeUndefined()
      expect(issues[0].message).not.toContain('Did you mean')
    })
  })

  describe('Python keyword detection', () => {
    it('returns invalid_function issue for "class"', () => {
      const ctx = makeCtx([])
      const classification = { type: 'simple_variable' as const, name: 'class' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain("'class' is a Python keyword")
      expect(issues[0].identifier).toBe('class')
    })

    it('returns invalid_function issue for "import"', () => {
      const ctx = makeCtx([])
      const classification = { type: 'simple_variable' as const, name: 'import' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain("'import' is a Python keyword")
    })

    it('returns invalid_function issue for "pass"', () => {
      const ctx = makeCtx([])
      const classification = { type: 'simple_variable' as const, name: 'pass' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain("'pass' is a Python keyword")
    })

    it('returns invalid_function issue for "return"', () => {
      const ctx = makeCtx([])
      const classification = { type: 'simple_variable' as const, name: 'return' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
    })

    it('returns invalid_function issue for "while"', () => {
      const ctx = makeCtx([])
      const classification = { type: 'simple_variable' as const, name: 'while' }

      const issues = validateSimpleVariable(classification, FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('Python keyword')
    })
  })
})

// ============================================
// validateMethodCall
// ============================================

describe('validateMethodCall', () => {
  describe('valid method calls', () => {
    it('returns no issues for a valid string method', () => {
      const ctx = makeCtx(['name'])
      const classification = { type: 'method_call' as const, base: 'name', chain: '.upper()' }

      const issues = validateMethodCall(classification, 'name.upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('returns no issues for chained valid methods', () => {
      const ctx = makeCtx(['name'])
      const classification = { type: 'method_call' as const, base: 'name', chain: '.strip().upper()' }

      const issues = validateMethodCall(classification, 'name.strip().upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('returns no issues for a method with arguments', () => {
      const ctx = makeCtx(['name'])
      const classification = { type: 'method_call' as const, base: 'name', chain: ".replace('a', 'b')" }

      const issues = validateMethodCall(classification, "name.replace('a', 'b')", FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })
  })

  describe('unknown base variable', () => {
    it('returns unknown_variable for undefined base', () => {
      const ctx = makeCtx(['other'])
      const classification = { type: 'method_call' as const, base: 'missing', chain: '.upper()' }

      const issues = validateMethodCall(classification, 'missing.upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('unknown_variable')
      expect(issues[0].identifier).toBe('missing')
      expect(issues[0].message).toContain("'missing' is not defined")
    })

    it('suggests a similar variable for base typo', () => {
      const ctx = makeCtx(['username'])
      const classification = { type: 'method_call' as const, base: 'usernam', chain: '.upper()' }

      const issues = validateMethodCall(classification, 'usernam.upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('unknown_variable')
      expect(issues[0].suggestion).toBe('username')
      expect(issues[0].message).toContain("Did you mean 'username'")
    })

    it('returns no suggestion when base has no similar match', () => {
      const ctx = makeCtx(['username'])
      const classification = { type: 'method_call' as const, base: 'zzz', chain: '.upper()' }

      const issues = validateMethodCall(classification, 'zzz.upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('unknown_variable')
      expect(issues[0].suggestion).toBeUndefined()
      expect(issues[0].message).toBe("Variable 'zzz' is not defined")
    })
  })

  describe('Python keyword as base', () => {
    it('returns invalid_function when base is a keyword like "class"', () => {
      const ctx = makeCtx([])
      const classification = { type: 'method_call' as const, base: 'class', chain: '.upper()' }

      const issues = validateMethodCall(classification, 'class.upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain("'class' is a Python keyword")
      expect(issues[0].identifier).toBe('class')
    })

    it('returns invalid_function when base is "pass"', () => {
      const ctx = makeCtx([])
      const classification = { type: 'method_call' as const, base: 'pass', chain: ".encode('!')" }

      const issues = validateMethodCall(classification, "pass.encode('!')", FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain("'pass' is a Python keyword")
    })
  })

  describe('invalid method detection', () => {
    it('returns invalid_function for unknown method without type info', () => {
      const ctx = makeCtx(['name'])
      const classification = { type: 'method_call' as const, base: 'name', chain: '.fake_method()' }

      const issues = validateMethodCall(classification, 'name.fake_method()', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].identifier).toBe('fake_method')
      expect(issues[0].message).toContain("'fake_method' is not a valid method")
    })

    it('returns invalid_function for method invalid on specific type', () => {
      const varTypes = new Map([['name', 'string']])
      const ctx = makeCtx(['name'], { variableTypes: varTypes })
      const classification = { type: 'method_call' as const, base: 'name', chain: '.append(1)' }

      const issues = validateMethodCall(classification, 'name.append(1)', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].identifier).toBe('append')
      expect(issues[0].message).toContain("'append' is not a valid method")
      expect(issues[0].message).toContain("type 'string'")
    })

    it('returns invalid_function for string method on array type', () => {
      const varTypes = new Map([['items', 'array']])
      const ctx = makeCtx(['items'], { variableTypes: varTypes })
      const classification = { type: 'method_call' as const, base: 'items', chain: '.upper()' }

      const issues = validateMethodCall(classification, 'items.upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain("'upper' is not a valid method")
    })
  })

  describe('blocked method in field expression context', () => {
    it('blocks list.append() in field expression', () => {
      const varTypes = new Map([['items', 'array']])
      const ctx = makeCtx(['items'], { variableTypes: varTypes, isFieldExpression: true })
      const classification = { type: 'method_call' as const, base: 'items', chain: '.append(1)' }

      const issues = validateMethodCall(classification, 'items.append(1)', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message).toContain('append')
      expect(issues[0].message).toContain('not allowed in field expressions')
    })

    it('blocks list.pop() in field expression', () => {
      const varTypes = new Map([['items', 'array']])
      const ctx = makeCtx(['items'], { variableTypes: varTypes, isFieldExpression: true })
      const classification = { type: 'method_call' as const, base: 'items', chain: '.pop()' }

      const issues = validateMethodCall(classification, 'items.pop()', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('blocks dict.update() in field expression', () => {
      const varTypes = new Map([['config', 'object']])
      const ctx = makeCtx(['config'], { variableTypes: varTypes, isFieldExpression: true })
      const classification = { type: 'method_call' as const, base: 'config', chain: '.update(config)' }

      const issues = validateMethodCall(classification, 'config.update(config)', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message).toContain('update')
      expect(issues[0].message).toContain('not allowed in field expressions')
    })

    it('allows non-mutating methods in field expression', () => {
      const varTypes = new Map([['name', 'string']])
      const ctx = makeCtx(['name'], { variableTypes: varTypes, isFieldExpression: true })
      const classification = { type: 'method_call' as const, base: 'name', chain: '.upper()' }

      const issues = validateMethodCall(classification, 'name.upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('allows mutating method when isFieldExpression is false', () => {
      const varTypes = new Map([['items', 'array']])
      const ctx = makeCtx(['items'], { variableTypes: varTypes, isFieldExpression: false })
      const classification = { type: 'method_call' as const, base: 'items', chain: '.append(1)' }

      const issues = validateMethodCall(classification, 'items.append(1)', FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('uses global FIELD_ALLOWED_METHOD_NAMES when no type info', () => {
      // Variable is defined but no type info - falls back to global sets
      const ctx = makeCtx(['data'], { isFieldExpression: true })
      const classification = { type: 'method_call' as const, base: 'data', chain: '.append(1)' }

      const issues = validateMethodCall(classification, 'data.append(1)', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message).toContain('append')
      expect(issues[0].message).toContain('not allowed in field expressions')
    })
  })

  describe('method argument count validation', () => {
    it('returns issue when too many args for upper()', () => {
      const varTypes = new Map([['name', 'string']])
      const ctx = makeCtx(['name'], { variableTypes: varTypes })
      const classification = { type: 'method_call' as const, base: 'name', chain: '.upper(1)' }

      const issues = validateMethodCall(classification, 'name.upper(1)', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].identifier).toBe('upper')
      expect(issues[0].message).toContain('upper')
    })

    it('allows correct arg count for replace()', () => {
      const varTypes = new Map([['name', 'string']])
      const ctx = makeCtx(['name'], { variableTypes: varTypes })
      const classification = { type: 'method_call' as const, base: 'name', chain: ".replace('a', 'b')" }

      const issues = validateMethodCall(classification, "name.replace('a', 'b')", FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })
  })

  describe('return type tracking through chains', () => {
    it('detects invalid method on chained return type', () => {
      const varTypes = new Map([['name', 'string']])
      const ctx = makeCtx(['name'], { variableTypes: varTypes })
      // isupper() returns bool; upper() is not valid on bool
      const classification = { type: 'method_call' as const, base: 'name', chain: '.isupper().upper()' }

      const issues = validateMethodCall(classification, 'name.isupper().upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('upper')
      expect(issues[0].message).toContain("type 'bool'")
    })

    it('allows valid chained methods with matching return types', () => {
      const varTypes = new Map([['name', 'string']])
      const ctx = makeCtx(['name'], { variableTypes: varTypes })
      // upper() returns string; strip() is valid on string
      const classification = { type: 'method_call' as const, base: 'name', chain: '.upper().strip()' }

      const issues = validateMethodCall(classification, 'name.upper().strip()', FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })
  })

  describe('binary operation type checking in method expressions', () => {
    it('detects invalid binary operation in method call expression', () => {
      const varTypes = new Map([['name', 'string']])
      const ctx = makeCtx(['name'], { variableTypes: varTypes })
      // Expression with string division - invalid operation
      const classification = { type: 'method_call' as const, base: 'name', chain: '.upper()' }

      // This expression has the method call but also an invalid binary operation
      const issues = validateMethodCall(
        classification,
        'name.upper() / 0',
        FROM,
        TO,
        ctx,
      )

      // validateBinaryOperations catches string / number
      expect(issues.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('identifier validation in method expressions', () => {
    it('detects unknown identifier used as argument in method call', () => {
      const ctx = makeCtx(['name'])
      const classification = { type: 'method_call' as const, base: 'name', chain: '.replace(unknown_var, "b")' }

      const issues = validateMethodCall(
        classification,
        'name.replace(unknown_var, "b")',
        FROM,
        TO,
        ctx,
      )

      // unknown_var is not in availableVariableNames, allowedBuiltinNames, or blockedBuiltinNames
      const unknownIssue = issues.find(
        (i: ValidationIssue) => i.identifier === 'unknown_var',
      )
      expect(unknownIssue).toBeDefined()
      expect(unknownIssue!.type).toBe('unknown_variable')
    })

    it('allows known variable used as argument in method call', () => {
      const ctx = makeCtx(['name', 'replacement'])
      const classification = { type: 'method_call' as const, base: 'name', chain: '.replace(replacement, "b")' }

      const issues = validateMethodCall(
        classification,
        'name.replace(replacement, "b")',
        FROM,
        TO,
        ctx,
      )

      expect(issues).toHaveLength(0)
    })

    it('skips keyword argument names as identifiers', () => {
      const ctx = makeCtx(['data'])
      const classification = { type: 'method_call' as const, base: 'data', chain: '.get("key", default=0)' }

      const issues = validateMethodCall(
        classification,
        'data.get("key", default=0)',
        FROM,
        TO,
        ctx,
      )

      // 'default' is a keyword argument name, not a variable
      const defaultIssue = issues.find(
        (i: ValidationIssue) => i.identifier === 'default',
      )
      expect(defaultIssue).toBeUndefined()
    })
  })

  describe('valid methods for various types', () => {
    it('allows list methods on array type', () => {
      const varTypes = new Map([['items', 'array']])
      const ctx = makeCtx(['items'], { variableTypes: varTypes })
      const classification = { type: 'method_call' as const, base: 'items', chain: '.append(1)' }

      const issues = validateMethodCall(classification, 'items.append(1)', FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('allows dict methods on object type', () => {
      const varTypes = new Map([['config', 'object']])
      const ctx = makeCtx(['config'], { variableTypes: varTypes })
      const classification = { type: 'method_call' as const, base: 'config', chain: '.keys()' }

      const issues = validateMethodCall(classification, 'config.keys()', FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('allows methods without type info (uses global ALLOWED_METHOD_NAMES)', () => {
      const ctx = makeCtx(['data'])
      const classification = { type: 'method_call' as const, base: 'data', chain: '.upper()' }

      const issues = validateMethodCall(classification, 'data.upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('handles method call with no type info and empty variableTypes map', () => {
      const ctx = makeCtx(['name'], { variableTypes: new Map() })
      const classification = { type: 'method_call' as const, base: 'name', chain: '.upper()' }

      // Empty map means no type info, no binary operation type check triggered
      const issues = validateMethodCall(classification, 'name.upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('handles method call with variableTypes but variable not in map', () => {
      const varTypes = new Map([['other', 'string']])
      const ctx = makeCtx(['name'], { variableTypes: varTypes })
      const classification = { type: 'method_call' as const, base: 'name', chain: '.upper()' }

      // name is not in varTypes, so currentType is undefined - uses global ALLOWED_METHOD_NAMES
      const issues = validateMethodCall(classification, 'name.upper()', FROM, TO, ctx)

      expect(issues).toHaveLength(0)
    })

    it('deduplicates seen identifiers', () => {
      // Expression that references the same unknown variable multiple times
      const ctx = makeCtx(['name'])
      const classification = { type: 'method_call' as const, base: 'name', chain: '.replace(x, x)' }

      const issues = validateMethodCall(
        classification,
        'name.replace(x, x)',
        FROM,
        TO,
        ctx,
      )

      // x should only be reported once due to deduplication
      const xIssues = issues.filter(
        (i: ValidationIssue) => i.identifier === 'x',
      )
      expect(xIssues).toHaveLength(1)
    })
  })
})
