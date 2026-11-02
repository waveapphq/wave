/**
 * Tests for AST-based expression validation.
 *
 * These tests verify that tree-sitter based validation handles edge cases
 * that the previous regex-based validation struggled with.
 *
 * Requirements under test:
 * - Expression Validation categories and behavior
 * - AST-Based Parsing Architecture
 *
 * All expressions are raw Python (no ${...} wrapper).
 */

import { describe, it, expect } from 'vitest'
import { validateExpressions } from '@/features/workbench/lib/expression-validation'
import { isInitialized } from '@/features/workbench/lib/tree-sitter-init'
import { fastestRunMs } from '../../../utils/fastest-run'

// Note: tree-sitter is initialized globally in tests/setup.ts
// Only tests that specifically test initialization behavior should reset/reinit

describe('AST-based Expression Validation', () => {
  const availableVars = new Set(['username', 'count', 'items', 'config', 'data', 'matrix'])

  describe('Initialization Integration', () => {
    it('uses AST parsing when tree-sitter is initialized', () => {
      expect(isInitialized()).toBe(true)

      // Validation should work
      const issues = validateExpressions('username', availableVars)
      expect(issues).toHaveLength(0)
    })

    // Note: The "throws error when not initialized" test is in tree-sitter-init.test.ts
    // We don't test that here because resetParser() affects all parallel tests
  })

  describe('Complex Nested Comprehensions (regex struggled with these)', () => {
    it('correctly handles deeply nested list comprehension', () => {
      // Regex parser had difficulty with multiple levels of nesting
      const issues = validateExpressions(
        '[[y for y in x] for x in matrix]',
        availableVars
      )

      // x and y are local loop variables, matrix is external - should be valid
      expect(issues).toHaveLength(0)
    })

    it('correctly handles comprehension with multiple for clauses', () => {
      const issues = validateExpressions(
        '[a + b for a in items for b in items]',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('correctly handles comprehension with condition', () => {
      const issues = validateExpressions(
        '[x for x in items if x > 0]',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('correctly handles dict comprehension', () => {
      const issues = validateExpressions(
        '{k: v for k, v in config.items()}',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('correctly handles set comprehension', () => {
      const issues = validateExpressions(
        '{x for x in items}',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('correctly handles generator expression', () => {
      const issues = validateExpressions(
        'sum(x * 2 for x in items)',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('correctly handles comprehension with tuple unpacking', () => {
      const issues = validateExpressions(
        '[(k, v) for k, v in config.items()]',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('flags unknown variables outside comprehension scope', () => {
      const issues = validateExpressions(
        '[x * unknown for x in items]',
        availableVars
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('unknown')
    })
  })

  describe('Complex Lambda Expressions (regex struggled with these)', () => {
    it('correctly handles nested lambdas', () => {
      const issues = validateExpressions(
        '(lambda x: lambda y: x + y)(1)(2)',
        availableVars
      )

      // x and y are lambda parameters - valid
      expect(issues).toHaveLength(0)
    })

    it('correctly handles lambda with default argument', () => {
      const issues = validateExpressions(
        '(lambda x, y=count: x + y)(5)',
        availableVars
      )

      // count is used as default value, x and y are parameters
      expect(issues).toHaveLength(0)
    })

    it('correctly handles lambda in sorted key', () => {
      const issues = validateExpressions(
        'sorted(items, key=lambda item: item.name)',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('correctly handles lambda with *args', () => {
      const issues = validateExpressions(
        '(lambda *args: sum(args))(1, 2, 3)',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('correctly handles lambda with **kwargs', () => {
      const issues = validateExpressions(
        '(lambda **kwargs: len(kwargs))(a=1, b=2)',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('flags unknown variables in lambda body', () => {
      const issues = validateExpressions(
        '(lambda x: x + unknown)(5)',
        availableVars
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('unknown')
    })
  })

  describe('String Literal Handling (regex struggled with these)', () => {
    it('does not flag identifiers in regular string literals', () => {
      const issues = validateExpressions(
        '"username"',
        new Set()  // No variables available
      )

      // 'username' inside string is not a variable reference
      expect(issues).toHaveLength(0)
    })

    it('correctly handles f-string with variable', () => {
      const issues = validateExpressions(
        'f"Hello {username}!"',
        availableVars
      )

      // username inside f-string IS a reference
      expect(issues).toHaveLength(0)
    })

    it('flags unknown variable in f-string', () => {
      const issues = validateExpressions(
        'f"Hello {unknown}!"',
        availableVars
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('unknown')
    })

    it('handles escaped braces in f-strings', () => {
      const issues = validateExpressions(
        'f"{{literal}} {username}"',
        availableVars
      )

      // {{literal}} is escaped, username is a reference
      expect(issues).toHaveLength(0)
    })

    it('handles nested expressions in f-strings', () => {
      const issues = validateExpressions(
        'f"{username.upper()}"',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('handles string concatenation', () => {
      const issues = validateExpressions(
        '"prefix" + username + "suffix"',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('handles multiline strings', () => {
      const issues = validateExpressions(
        '"""line1\nline2"""',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })
  })

  describe('Method Chain Validation (enhanced with AST)', () => {
    it('validates long method chains correctly', () => {
      const issues = validateExpressions(
        'username.strip().lower().replace("a", "b").upper()',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('flags invalid method in chain', () => {
      const issues = validateExpressions(
        'username.strip().fake_method().upper()',
        availableVars
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('fake_method')
    })

    it('handles method call on function result', () => {
      const issues = validateExpressions(
        'str(count).zfill(5)',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('handles method call on comprehension result', () => {
      const issues = validateExpressions(
        '[x for x in items].count(0)',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('handles method call on string literal', () => {
      const issues = validateExpressions(
        '"hello".upper()',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('flags unknown variables in method arguments', () => {
      const issues = validateExpressions(
        'username.replace(OLD_VAR, NEW_VAR)',
        availableVars
      )

      expect(issues).toHaveLength(2)
      expect(issues.map(i => i.identifier).sort()).toEqual(['NEW_VAR', 'OLD_VAR'])
    })

    it('flags unknown variables in method call followed by expression', () => {
      const issues = validateExpressions(
        'my_var.upper(NO_VAR) - NO_VAR',
        new Set(['my_var'])
      )

      // NO_VAR appears twice but should only be flagged once (deduped)
      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('NO_VAR')
    })

    it('flags unknown variables in method call argument only', () => {
      const issues = validateExpressions(
        'my_var.replace(UNKNOWN, "b")',
        new Set(['my_var'])
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('UNKNOWN')
    })

    it('flags unknown variables in expression after method call', () => {
      const issues = validateExpressions(
        'my_var.upper() + UNKNOWN',
        new Set(['my_var'])
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('UNKNOWN')
    })

    it('validates variables in complex method chain with arguments', () => {
      const issues = validateExpressions(
        'data.strip().replace(old, new).lower()',
        new Set(['data', 'old', 'new'])
      )

      expect(issues).toHaveLength(0)
    })

    it('flags unknown in complex method chain arguments', () => {
      const issues = validateExpressions(
        'data.strip().replace(UNKNOWN, "x").lower()',
        new Set(['data'])
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('UNKNOWN')
    })
  })

  describe('Keyword Argument Detection (enhanced with AST)', () => {
    it('does not flag keyword argument names as unknown variables', () => {
      const issues = validateExpressions(
        'sorted(items, key=lambda x: x, reverse=True)',
        availableVars
      )

      // key and reverse are keyword args, not variable references
      expect(issues).toHaveLength(0)
    })

    it('handles nested function calls with keyword args', () => {
      const issues = validateExpressions(
        'max(items, key=lambda x: min(x, default=0))',
        availableVars
      )

      expect(issues).toHaveLength(0)
    })

    it('distinguishes keyword arg from equality comparison', () => {
      const issues = validateExpressions(
        'count == 5',
        availableVars
      )

      // count is a variable reference (equality check), not keyword arg
      expect(issues).toHaveLength(0)
    })
  })

  describe('Syntax Error Detection (AST advantage)', () => {
    it('detects unbalanced parentheses with precise position', () => {
      const issues = validateExpressions('func((x)', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Unbalanced')
      // AST should provide better position info
    })

    it('detects unterminated string in method argument', () => {
      // Mismatched quotes: 'N' is fine, but "nn' has opening " without closing "
      const issues = validateExpressions('my_var.replace(\'N\', "nn\')', new Set(['my_var']))

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Invalid Python syntax')
    })

    it('detects unterminated string with single quote', () => {
      const issues = validateExpressions("my_var.replace('abc)", new Set(['my_var']))

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Invalid Python syntax')
    })

    it('detects unterminated triple-quoted string', () => {
      const issues = validateExpressions('"""hello', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Invalid Python syntax')
    })

    it('detects assignment statement', () => {
      const issues = validateExpressions('x = 5', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Assignment')
    })

    it('detects walrus operator', () => {
      const issues = validateExpressions('(x := 5)', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Assignment')
    })

    it('detects invalid syntax precisely', () => {
      // Note: "a + + b" is valid Python (unary +), so we use actual invalid syntax
      // "@ b" doesn't match the decorator regex (requires @letter with no space)
      // so this falls through to AST validation which catches it as invalid syntax
      const issues = validateExpressions('a + @ b', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('Invalid Python syntax')
    })

    it('detects incomplete expression', () => {
      const issues = validateExpressions('a +', availableVars)

      expect(issues).toHaveLength(1)
    })

    it('handles syntax error in nested context', () => {
      const issues = validateExpressions('[x for x in ]', availableVars)

      expect(issues).toHaveLength(1)
    })
  })

  describe('Security Pattern Detection (AST advantage)', () => {
    it('detects dunder access in complex expression', () => {
      const issues = validateExpressions(
        'items.__class__.__mro__',
        availableVars
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('detects blocked function in nested call', () => {
      const issues = validateExpressions(
        'str(eval("code"))',
        availableVars
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('detects blocked function in lambda', () => {
      const issues = validateExpressions(
        '(lambda x: exec(x))("code")',
        availableVars
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('detects blocked function in comprehension', () => {
      const issues = validateExpressions(
        '[eval(x) for x in items]',
        availableVars
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })
  })

  describe('Position Accuracy (AST advantage)', () => {
    it('provides accurate positions for unknown variable', () => {
      const value = 'unknown'
      const issues = validateExpressions(value, availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].from).toBe(0)
      expect(issues[0].to).toBe(7) // length of 'unknown'
    })

    it('provides accurate positions for expression', () => {
      const value = 'foo + bar'
      const issues = validateExpressions(value, availableVars)

      expect(issues).toHaveLength(2)
      // Both issues span the entire expression since it's one raw expression
      expect(issues[0].from).toBe(0)
      expect(issues[0].to).toBe(value.length)
      expect(issues[1].from).toBe(0)
      expect(issues[1].to).toBe(value.length)
    })

    it('provides accurate positions in complex expression', () => {
      const value = 'len(unknown_var)'
      const issues = validateExpressions(value, availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('unknown_var')
      // AST should pinpoint the identifier within the expression
    })
  })

  describe('Type-aware Validation (existing, verify still works)', () => {
    it('validates methods against variable type', () => {
      const varTypes = new Map([['username', 'string']])

      // String method on string - valid
      const validIssues = validateExpressions(
        'username.upper()',
        availableVars,
        varTypes
      )
      expect(validIssues).toHaveLength(0)

      // List method on string - invalid
      const invalidIssues = validateExpressions(
        'username.append(1)',
        availableVars,
        varTypes
      )
      expect(invalidIssues).toHaveLength(1)
      expect(invalidIssues[0].message).toContain('append')
    })

    it('tracks type through method chain', () => {
      const varTypes = new Map([['username', 'string']])

      // isupper() returns bool, which doesn't have upper()
      const issues = validateExpressions(
        'username.isupper().upper()',
        availableVars,
        varTypes
      )

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('upper')
    })
  })

  describe('Variable Suggestion (existing, verify still works)', () => {
    it('suggests similar variable for typos', () => {
      const issues = validateExpressions('usernam', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].suggestion).toBe('username')
      expect(issues[0].message).toContain("Did you mean 'username'")
    })

    it('does not suggest when no similar variable exists', () => {
      const issues = validateExpressions('xyz', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].suggestion).toBeUndefined()
    })
  })

  describe('Edge Cases That Regex Struggled With', () => {
    it('handles parenthesized expression', () => {
      const issues = validateExpressions('(count + 1)', availableVars)
      expect(issues).toHaveLength(0)
    })

    it('handles double parentheses', () => {
      const issues = validateExpressions('((count))', availableVars)
      expect(issues).toHaveLength(0)
    })

    it('handles string with special characters', () => {
      const issues = validateExpressions('"hello\\nworld"', availableVars)
      expect(issues).toHaveLength(0)
    })

    it('handles raw string', () => {
      const issues = validateExpressions('r"hello\\nworld"', availableVars)
      expect(issues).toHaveLength(0)
    })

    it('handles bytes literal', () => {
      const issues = validateExpressions('b"bytes"', availableVars)
      expect(issues).toHaveLength(0)
    })

    it('handles complex ternary', () => {
      const issues = validateExpressions(
        'a if b else c if d else e',
        new Set(['a', 'b', 'c', 'd', 'e'])
      )
      expect(issues).toHaveLength(0)
    })

    it('handles subscript with negative index', () => {
      const issues = validateExpressions('items[-1]', availableVars)
      expect(issues).toHaveLength(0)
    })

    it('handles subscript with slice', () => {
      const issues = validateExpressions('items[1:3:2]', availableVars)
      expect(issues).toHaveLength(0)
    })

    it('handles attribute access on subscript', () => {
      const issues = validateExpressions('items[0].upper()', availableVars)
      expect(issues).toHaveLength(0)
    })

    it('handles star expression in call', () => {
      const issues = validateExpressions('max(*items)', availableVars)
      expect(issues).toHaveLength(0)
    })

    it('handles double star expression in call', () => {
      const issues = validateExpressions('dict(**config)', availableVars)
      expect(issues).toHaveLength(0)
    })

    it('handles comparison operators', () => {
      const issues = validateExpressions(
        'count >= 0 and count <= 100',
        availableVars
      )
      expect(issues).toHaveLength(0)
    })

    it('handles identity operators', () => {
      const issues = validateExpressions(
        'username is not None',
        availableVars
      )
      expect(issues).toHaveLength(0)
    })

    it('handles membership operators', () => {
      const issues = validateExpressions(
        'username in items',
        availableVars
      )
      expect(issues).toHaveLength(0)
    })

    it('handles bitwise operators', () => {
      const issues = validateExpressions(
        'count & 0xFF | 0x100 ^ 0x10',
        availableVars
      )
      expect(issues).toHaveLength(0)
    })

    it('handles shift operators', () => {
      const issues = validateExpressions(
        'count << 2 >> 1',
        availableVars
      )
      expect(issues).toHaveLength(0)
    })

    it('handles power operator', () => {
      const issues = validateExpressions(
        'count ** 2',
        availableVars
      )
      expect(issues).toHaveLength(0)
    })

    it('handles floor division', () => {
      const issues = validateExpressions(
        'count // 2',
        availableVars
      )
      expect(issues).toHaveLength(0)
    })

    it('handles modulo', () => {
      const issues = validateExpressions(
        'count % 2',
        availableVars
      )
      expect(issues).toHaveLength(0)
    })

    it('handles complex mixed expression', () => {
      const issues = validateExpressions(
        'sorted([x.strip() for x in items if len(x) > 0], key=lambda y: y.lower())',
        availableVars
      )
      expect(issues).toHaveLength(0)
    })
  })
})

describe('Expression Type Checking (Level 3)', () => {
  const availableVars = new Set(['my_var', 'count', 'name', 'items', 'data'])

  describe('Method Argument Count Validation', () => {
    it('flags .upper() called with arguments when it takes 0', () => {
      const varTypes = new Map([['my_var', 'str']])
      const issues = validateExpressions('my_var.upper(1)', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Method 'upper' takes 0 arguments, got 1")
    })

    it('flags .replace() called with 1 argument when it takes 2-3', () => {
      const varTypes = new Map([['my_var', 'str']])
      const issues = validateExpressions('my_var.replace("a")', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Method 'replace' takes 2-3 arguments, got 1")
    })

    it('flags .replace() called with too many arguments', () => {
      const varTypes = new Map([['my_var', 'str']])
      const issues = validateExpressions('my_var.replace("a", "b", 1, "extra")', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Method 'replace' takes 2-3 arguments, got 4")
    })

    it('allows .strip() with 0 arguments', () => {
      const varTypes = new Map([['my_var', 'str']])
      const issues = validateExpressions('my_var.strip()', availableVars, varTypes)

      expect(issues).toHaveLength(0)
    })

    it('allows .strip() with 1 argument', () => {
      const varTypes = new Map([['my_var', 'str']])
      const issues = validateExpressions('my_var.strip(" ")', availableVars, varTypes)

      expect(issues).toHaveLength(0)
    })

    it('allows .replace() with 2 arguments', () => {
      const varTypes = new Map([['my_var', 'str']])
      const issues = validateExpressions('my_var.replace("a", "b")', availableVars, varTypes)

      expect(issues).toHaveLength(0)
    })

    it('allows .replace() with 3 arguments', () => {
      const varTypes = new Map([['my_var', 'str']])
      const issues = validateExpressions('my_var.replace("a", "b", 1)', availableVars, varTypes)

      expect(issues).toHaveLength(0)
    })

    it('flags .split() called with too many arguments', () => {
      const varTypes = new Map([['my_var', 'str']])
      const issues = validateExpressions('my_var.split(",", 5, "extra")', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Method 'split' takes 0-2 arguments, got 3")
    })

    it('validates method arg count in complex expressions', () => {
      const varTypes = new Map([['data', 'str']])
      const issues = validateExpressions('data.strip().upper(1).lower()', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Method 'upper' takes 0 arguments, got 1")
    })

    it('validates list method arg counts', () => {
      const varTypes = new Map([['items', 'list']])
      const issues = validateExpressions('items.count()', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Method 'count' takes 1 argument, got 0")
    })

    it('skips arg count validation when type is unknown', () => {
      // When we don't know the type, we can't validate arg counts
      const issues = validateExpressions('my_var.upper(1)', availableVars)

      // Should still pass since we don't know if my_var supports upper with 1 arg
      expect(issues).toHaveLength(0)
    })
  })

  describe('Operator Type Checking', () => {
    it('flags string - int operation', () => {
      const varTypes = new Map([['my_var', 'str']])
      const issues = validateExpressions('my_var - 1', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Cannot use '-' with str and int")
    })

    it('flags string - int after method call', () => {
      const varTypes = new Map([['my_var', 'str']])
      const issues = validateExpressions('my_var.upper() - 1', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Cannot use '-' with str and int")
    })

    it('flags int - string literal operation', () => {
      // Note: String literals are caught by the regex-based findInvalidStringOperation check
      // before the AST-based type checker runs, so the message is from that check
      const varTypes = new Map([['count', 'int']])
      const issues = validateExpressions('count - "hello"', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe('Cannot subtract string')
    })

    it('flags int - string variable operation', () => {
      // When both operands are variables, the AST-based type checker runs
      const varTypes = new Map([['count', 'int'], ['name', 'str']])
      const issues = validateExpressions('count - name', new Set(['count', 'name']), varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Cannot use '-' with int and str")
    })

    it('allows int + int operation', () => {
      const varTypes = new Map([['count', 'int']])
      const issues = validateExpressions('count + 1', availableVars, varTypes)

      expect(issues).toHaveLength(0)
    })

    it('allows string + string operation', () => {
      const varTypes = new Map([['name', 'str']])
      const issues = validateExpressions('name + " suffix"', availableVars, varTypes)

      expect(issues).toHaveLength(0)
    })

    it('allows string * int operation (repetition)', () => {
      const varTypes = new Map([['name', 'str']])
      const issues = validateExpressions('name * 3', availableVars, varTypes)

      expect(issues).toHaveLength(0)
    })

    it('flags string / int operation', () => {
      const varTypes = new Map([['name', 'str']])
      const issues = validateExpressions('name / 2', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Cannot use '/' with str and int")
    })

    it('flags list - list operation', () => {
      const varTypes = new Map([['items', 'list']])
      const issues = validateExpressions('items - items', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Cannot use '-' with list and list")
    })

    it('allows list + list operation', () => {
      const varTypes = new Map([['items', 'list']])
      const issues = validateExpressions('items + items', availableVars, varTypes)

      expect(issues).toHaveLength(0)
    })

    it('flags string + int (type mismatch)', () => {
      const varTypes = new Map([['name', 'str']])
      const issues = validateExpressions('name + 1', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Cannot use '+' with str and int - use str() to convert")
    })

    it('skips type checking when types are unknown', () => {
      // No type info provided
      const issues = validateExpressions('my_var - 1', availableVars)

      // Should pass since we don't know my_var's type
      expect(issues).toHaveLength(0)
    })

    it('validates nested binary operations', () => {
      const varTypes = new Map([['count', 'int'], ['name', 'str']])
      const issues = validateExpressions('count + 1 - name', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      // (count + 1) is int, name is str, so int - str is invalid
      expect(issues[0].message).toBe("Cannot use '-' with int and str")
    })

    it('allows float operations', () => {
      const varTypes = new Map([['my_var', 'float']])
      const issues = validateExpressions('my_var + 1.5', availableVars, varTypes)

      expect(issues).toHaveLength(0)
    })

    it('allows int and float mixed arithmetic', () => {
      const varTypes = new Map([['count', 'int']])
      const issues = validateExpressions('count + 1.5', availableVars, varTypes)

      expect(issues).toHaveLength(0)
    })

    it('flags dict arithmetic operations', () => {
      const varTypes = new Map([['data', 'dict']])
      const issues = validateExpressions('data + 1', availableVars, varTypes)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe("Cannot use '+' with dict and int")
    })
  })
})

describe('AST Validation Performance', () => {
  // tree-sitter is initialized globally in tests/setup.ts

  it('validates typical expressions in under 10ms', async () => {
    const availableVars = new Set(['username', 'count', 'items', 'config'])

    const expressions = [
      'username',
      'username.upper()',
      'len(items)',
      'count + 1',
      '[x for x in items]',
      'sorted(items, key=lambda x: x.name)',
    ]

    for (const expr of expressions) {
      // Per design doc: subsequent validations < 10ms
      expect(await fastestRunMs(() => validateExpressions(expr, availableVars)), expr).toBeLessThan(10)
    }
  })

  it('handles a complex expression efficiently', async () => {
    const availableVars = new Set(['a', 'b', 'c', 'd', 'e'])

    expect(await fastestRunMs(() => validateExpressions('a + b + c + d + e', availableVars))).toBeLessThan(50)
  })
})
