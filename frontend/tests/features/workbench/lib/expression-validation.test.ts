/**
 * Tests for expression validation utility.
 *
 * Tests requirements:
 * - Unknown variable detection
 * - Invalid function detection
 * - Blocked function detection
 * - Position accuracy
 * - Edge cases (nested, chained methods)
 *
 * All expressions are raw Python (no ${...} wrapper).
 */

import { describe, it, expect } from 'vitest'
import { validateExpressions, hasValidationIssues } from '@/features/workbench/lib/expression-validation'

// Note: tree-sitter is initialized globally in tests/setup.ts

describe('Expression Validation', () => {
  const availableVars = new Set(['username', 'count', 'items', 'config'])

  describe('Unknown Variable Detection', () => {
    it('detects unknown simple variable', () => {
      const issues = validateExpressions('unknown', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('unknown_variable')
      expect(issues[0].identifier).toBe('unknown')
      expect(issues[0].message).toContain('not defined')
    })

    it('suggests similar variable for typos', () => {
      const issues = validateExpressions('usernam', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('unknown_variable')
      expect(issues[0].suggestion).toBe('username')
      expect(issues[0].message).toContain("Did you mean 'username'")
    })

    it('suggests similar variable for single char typo', () => {
      const issues = validateExpressions('conut', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].suggestion).toBe('count')
    })

    it('does not suggest when no similar variable exists', () => {
      const issues = validateExpressions('completely_different', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].suggestion).toBeUndefined()
      expect(issues[0].message).not.toContain('Did you mean')
    })

    it('detects known variable as valid', () => {
      const issues = validateExpressions('username', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('detects multiple unknown variables in expression', () => {
      // With raw mode, entire value is one expression. Use a Python expression with both unknowns.
      const issues = validateExpressions('foo + bar', availableVars)

      expect(issues).toHaveLength(2)
      expect(issues[0].identifier).toBe('foo')
      expect(issues[1].identifier).toBe('bar')
    })

    it('detects unknown base variable in method call', () => {
      const issues = validateExpressions('unknown.upper()', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('unknown_variable')
      expect(issues[0].identifier).toBe('unknown')
    })

    it('allows known variable with method call', () => {
      const issues = validateExpressions('username.upper()', availableVars)

      expect(issues).toHaveLength(0)
    })
  })

  describe('Invalid Function Detection', () => {
    it('detects invalid function not in allowed builtins', () => {
      const issues = validateExpressions('fake_function(x)', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].identifier).toBe('fake_function')
    })

    it('allows valid builtin function', () => {
      const issues = validateExpressions('len(username)', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('allows abs function', () => {
      const issues = validateExpressions('abs(count)', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('allows str function', () => {
      const issues = validateExpressions('str(count)', availableVars)

      expect(issues).toHaveLength(0)
    })

    // Comprehensive tests for ALL allowed builtin functions
    describe('all allowed builtin functions', () => {
      // Conversion functions
      it('allows int function', () => {
        expect(validateExpressions('int("5")', availableVars)).toHaveLength(0)
      })

      it('allows float function', () => {
        expect(validateExpressions('float("3.14")', availableVars)).toHaveLength(0)
      })

      it('allows bool function', () => {
        expect(validateExpressions('bool(count)', availableVars)).toHaveLength(0)
      })

      it('allows list function', () => {
        expect(validateExpressions('list(items)', availableVars)).toHaveLength(0)
      })

      it('allows dict function', () => {
        expect(validateExpressions('dict(config)', availableVars)).toHaveLength(0)
      })

      it('allows set function', () => {
        expect(validateExpressions('set(items)', availableVars)).toHaveLength(0)
      })

      it('allows type function', () => {
        expect(validateExpressions('type(count)', availableVars)).toHaveLength(0)
      })

      // Math functions
      it('allows round function', () => {
        expect(validateExpressions('round(3.14159, 2)', availableVars)).toHaveLength(0)
      })

      it('allows min function', () => {
        expect(validateExpressions('min(1, 2, 3)', availableVars)).toHaveLength(0)
      })

      it('allows max function', () => {
        expect(validateExpressions('max(1, 2, 3)', availableVars)).toHaveLength(0)
      })

      it('allows sum function', () => {
        expect(validateExpressions('sum(items)', availableVars)).toHaveLength(0)
      })

      // Sequence functions
      it('allows sorted function', () => {
        expect(validateExpressions('sorted(items)', availableVars)).toHaveLength(0)
      })

      it('allows reversed function', () => {
        expect(validateExpressions('list(reversed(items))', availableVars)).toHaveLength(0)
      })

      it('allows range function', () => {
        expect(validateExpressions('list(range(5))', availableVars)).toHaveLength(0)
      })

      it('allows filter function', () => {
        expect(validateExpressions('list(filter(lambda x: x > 0, items))', availableVars)).toHaveLength(0)
      })

      it('allows map function', () => {
        expect(validateExpressions('list(map(lambda x: x * 2, items))', availableVars)).toHaveLength(0)
      })

      it('allows slice function', () => {
        expect(validateExpressions('items[slice(1, 3)]', availableVars)).toHaveLength(0)
      })

      // Logic functions
      it('allows all function', () => {
        expect(validateExpressions('all(items)', availableVars)).toHaveLength(0)
      })

      it('allows any function', () => {
        expect(validateExpressions('any(items)', availableVars)).toHaveLength(0)
      })

      // String formatting
      it('allows format function', () => {
        expect(validateExpressions('format(count, "d")', availableVars)).toHaveLength(0)
      })
    })

    describe('blocked functions (noise removed)', () => {
      it('blocks tuple function', () => {
        const issues = validateExpressions('tuple(items)', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks pow function', () => {
        const issues = validateExpressions('pow(2, 3)', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks divmod function', () => {
        const issues = validateExpressions('divmod(10, 3)', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks enumerate function', () => {
        const issues = validateExpressions('list(enumerate(items))', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks zip function', () => {
        const issues = validateExpressions('list(zip(items, items))', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks chr function', () => {
        const issues = validateExpressions('chr(65)', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks ord function', () => {
        const issues = validateExpressions('ord("A")', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks bin function', () => {
        const issues = validateExpressions('bin(10)', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks hex function', () => {
        const issues = validateExpressions('hex(255)', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks oct function', () => {
        const issues = validateExpressions('oct(8)', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks ascii function', () => {
        const issues = validateExpressions('ascii("hello")', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })

      it('blocks repr function', () => {
        const issues = validateExpressions('repr(count)', availableVars)
        expect(issues).toHaveLength(1)
        expect(issues[0].type).toBe('blocked_function')
      })
    })
  })

  describe('Blocked Function Detection', () => {
    it('detects blocked eval function', () => {
      const issues = validateExpressions("eval('code')", availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message.toLowerCase()).toContain('not supported')
    })

    it('detects blocked exec function', () => {
      const issues = validateExpressions("exec('code')", availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('detects blocked __import__', () => {
      const issues = validateExpressions("__import__('os')", availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].identifier).toBe('__')
    })

    it('detects blocked dunder patterns', () => {
      const issues = validateExpressions('x.__class__', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('detects blocked open function', () => {
      const issues = validateExpressions("open('file.txt')", availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('allows exit as variable name (not in backend whitelist anyway)', () => {
      // exit/quit are NOT blocked - they're not dangerous because they're
      // not in the backend's SAFE_BUILTINS whitelist
      const varsWithExit = new Set([...availableVars, 'exit'])
      const issues = validateExpressions('exit', varsWithExit)

      expect(issues).toHaveLength(0)
    })

    it('allows quit as variable name (not in backend whitelist anyway)', () => {
      const varsWithQuit = new Set([...availableVars, 'quit'])
      const issues = validateExpressions('quit', varsWithQuit)

      expect(issues).toHaveLength(0)
    })
  })

  describe('Python Keyword Detection', () => {
    it('detects pass as keyword in simple variable', () => {
      const issues = validateExpressions('pass', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('Python keyword')
    })

    it('detects pass as keyword in method call', () => {
      const issues = validateExpressions("pass.encode('!')", availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('Python keyword')
      expect(issues[0].identifier).toBe('pass')
    })

    it('detects class as keyword', () => {
      const issues = validateExpressions('class', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Python keyword')
    })

    it('detects return as keyword', () => {
      const issues = validateExpressions('return', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Python keyword')
    })

    it('allows True/False/None as they are valid expressions', () => {
      // True, False, None are valid Python expressions (not statement keywords)
      expect(validateExpressions('True', availableVars)).toHaveLength(0)
      expect(validateExpressions('False', availableVars)).toHaveLength(0)
      expect(validateExpressions('None', availableVars)).toHaveLength(0)
    })
  })

  describe('Position Accuracy', () => {
    it('returns correct positions for raw expression', () => {
      const issues = validateExpressions('unknown', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].from).toBe(0)
      expect(issues[0].to).toBe(7) // length of 'unknown'
    })

    it('returns positions spanning the entire expression', () => {
      const expr = 'unknown + 1'
      const issues = validateExpressions(expr, availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].from).toBe(0)
      expect(issues[0].to).toBe(expr.length)
    })
  })

  describe('Complex Expressions', () => {
    it('detects unknown identifier in complex expression', () => {
      const issues = validateExpressions('len(unknown)', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('unknown')
    })

    it('suggests similar variable for typo in function argument', () => {
      const issues = validateExpressions('len(usernam)', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('unknown_variable')
      expect(issues[0].identifier).toBe('usernam')
      expect(issues[0].suggestion).toBe('username')
      expect(issues[0].message).toContain("Did you mean 'username'")
    })

    it('allows known variables in complex expression', () => {
      const issues = validateExpressions('len(username)', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('handles expression with operators', () => {
      const issues = validateExpressions('count + 1', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('detects unknown variable in arithmetic expression', () => {
      const issues = validateExpressions('unknown + 1', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('unknown')
    })

    it('skips Python keywords in complex expressions', () => {
      const issues = validateExpressions('count if count > 0 else 0', availableVars)

      // Should not flag 'if', 'else' as unknown
      expect(issues).toHaveLength(0)
    })
  })

  describe('Comprehension Scopes', () => {
    it('recognizes loop variable in list comprehension', () => {
      const issues = validateExpressions('[x * x for x in range(5)]', availableVars)

      // x is a loop variable, should not be flagged
      expect(issues).toHaveLength(0)
    })

    it('recognizes loop variable with tuple unpacking', () => {
      // Test tuple unpacking like iterating dict.items(): [(k, v) for k, v in items]
      const issues = validateExpressions('[(k, v) for k, v in items]', new Set(['items']))

      expect(issues).toHaveLength(0)
    })

    it('recognizes loop variable in generator expression', () => {
      const issues = validateExpressions('sum(x * 2 for x in numbers)', new Set(['numbers']))

      expect(issues).toHaveLength(0)
    })

    it('recognizes tuple unpacking in comprehension', () => {
      const issues = validateExpressions('[a + b for a, b in pairs]', new Set(['pairs']))

      expect(issues).toHaveLength(0)
    })

    it('recognizes nested comprehension variables', () => {
      const issues = validateExpressions('[x + y for x in range(3) for y in range(3)]', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('still flags unknown external variables in comprehension', () => {
      const issues = validateExpressions('[x * multiplier for x in items]', new Set(['items']))

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('multiplier')
    })
  })

  describe('Lambda Scopes', () => {
    it('recognizes lambda parameter', () => {
      const issues = validateExpressions('list(map(lambda x: x * 2, items))', new Set(['items']))

      expect(issues).toHaveLength(0)
    })

    it('recognizes multiple lambda parameters', () => {
      const issues = validateExpressions('sorted(data, key=lambda a, b: a + b)', new Set(['data']))

      expect(issues).toHaveLength(0)
    })
  })

  describe('Keyword Argument Names', () => {
    it('skips keyword argument name "key" in sorted', () => {
      // 'key' is a keyword argument name, not a variable - should not be flagged
      const issues = validateExpressions('sorted(items, key=lambda x: x)', new Set(['items']))

      expect(issues).toHaveLength(0)
    })

    it('skips keyword argument name "reverse" in sorted', () => {
      // 'reverse' is a keyword argument name - should not be flagged as unknown
      const issues = validateExpressions('sorted(items, reverse=True)', new Set(['items']))

      expect(issues).toHaveLength(0)
    })

    it('skips keyword argument name "default" in get', () => {
      // 'default' is a keyword argument name - should not be flagged
      const issues = validateExpressions('config.get("key", default=0)', new Set(['config']))

      expect(issues).toHaveLength(0)
    })
  })

  describe('Blocked Functions in Complex Expressions', () => {
    it('detects blocked function call in complex expression', () => {
      // Using eval as a function call in a complex expression
      const issues = validateExpressions('x if eval("code") else y', new Set(['x', 'y']))

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].identifier).toBe('eval')
    })

    it('allows blocked function name as identifier (design decision)', () => {
      // Per design: "Only blocks actual function calls: open(...), eval(...), etc."
      // Variable names like exit_code, eval_result should be allowed
      // Using exec as identifier (not as function call) is valid
      const issues = validateExpressions('exec + 1', new Set(['exec']))

      // Should only fail because exec is unknown variable, not because it's blocked
      expect(issues).toHaveLength(0)
    })

    it('allows blocked name as variable when in available vars', () => {
      // Variable named eval is allowed - only eval() function call is blocked
      const issues = validateExpressions('x if eval else y', new Set(['x', 'y', 'eval']))

      expect(issues).toHaveLength(0)
    })
  })

  describe('Numeric Literal Validation', () => {
    it('rejects number followed by dot', () => {
      const issues = validateExpressions('1.', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('Incomplete expression: expected attribute or method name after dot')
    })

    it('rejects number with method call', () => {
      const issues = validateExpressions('123.upper()', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Numbers cannot have methods')
    })

    it('allows plain numbers without dot', () => {
      // 5 is a valid expression (evaluates to 5)
      const issues = validateExpressions('5', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('allows float literals', () => {
      // 1.5 is a valid float
      const issues = validateExpressions('1.5', availableVars)

      expect(issues).toHaveLength(0)
    })
  })

  describe('Invalid String Operations', () => {
    it('detects string divided by number', () => {
      const issues = validateExpressions('"a" / 0', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Cannot divide string')
    })

    it('detects division by string', () => {
      const issues = validateExpressions('1 / "a"', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Cannot divide by string')
    })

    it('detects string subtraction', () => {
      const issues = validateExpressions('"a" - 1', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Cannot subtract from string')
    })

    it('detects subtraction of string', () => {
      const issues = validateExpressions('1 - "a"', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Cannot subtract string')
    })

    it('allows string concatenation with +', () => {
      const issues = validateExpressions('"a" + "b"', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('allows string repetition with *', () => {
      const issues = validateExpressions('"a" * 3', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('reads the text between two string literals as code, never as a string', () => {
      expect(validateExpressions('"a" + "-b"', availableVars)).toHaveLength(0)
      expect(validateExpressions("'a' + '/b'", availableVars)).toHaveLength(0)
      expect(validateExpressions('(\n    "red"\n    + "-green"\n) + "-blue"', availableVars)).toHaveLength(0)
    })

    it('still finds a string operation after other string literals', () => {
      const issues = validateExpressions('"a" + "-b" - 1', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toBe('Cannot subtract from string')
    })

    it('detects invalid string ops in complex expressions', () => {
      // This is the user's example
      const issues = validateExpressions('username.isupper() - 1/1 + "a"/0', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Cannot divide string')
    })
  })

  describe('Syntax Validation', () => {
    it('detects backticks as invalid', () => {
      const issues = validateExpressions('11````43', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Backticks')
    })

    it('detects unbalanced parentheses', () => {
      const issues = validateExpressions('func((x)', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Unbalanced')
    })

    it('detects semicolons as invalid', () => {
      const issues = validateExpressions('x; y', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Semicolons')
    })

    it('detects comments as invalid', () => {
      const issues = validateExpressions('x # comment', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Comments')
    })

    it('detects assignment statement as invalid', () => {
      const issues = validateExpressions('inc = 1', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Assignment statements are not allowed')
      expect(issues[0].message).toContain('Var Setter')
    })

    it('detects assignment with variable as invalid', () => {
      const issues = validateExpressions('count = count + 1', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Assignment statements are not allowed')
    })

    it('detects walrus operator as invalid', () => {
      const issues = validateExpressions('(x := 5)', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Assignment expressions (:=)')
      expect(issues[0].message).toContain('Var Setter')
    })

    it('allows equality comparison (not assignment)', () => {
      const issues = validateExpressions('count == 1', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('allows keyword arguments in function calls', () => {
      const issues = validateExpressions('sorted(items, key=lambda x: x)', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('detects dot followed by operator as invalid syntax', () => {
      const issues = validateExpressions('username. + 1', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('Invalid syntax: expected attribute or method name after dot')
    })

    it('detects operator followed by dot as invalid syntax', () => {
      const issues = validateExpressions('1 + .something', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('Invalid syntax: unexpected dot after operator')
    })

    it('detects multiple operators in a row as invalid', () => {
      const issues = validateExpressions('1 +++ 2', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('Invalid operator sequence')
    })

    it('detects decorators as invalid', () => {
      const issues = validateExpressions('@decorator', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('Decorators (@) are not valid')
    })
  })

  describe('text inside a string literal is never read as code', () => {
    it.each([
      ["username == '@timestamp'", 'an @ (a field name such as @timestamp)'],
      ['username == "@admin"', 'an @ in double quotes'],
      ["username + '#1'", 'a #'],
      ["username + ';'", 'a ;'],
      ["username + ')'", 'an unbalanced parenthesis'],
      ["username + ']'", 'an unbalanced bracket'],
      ["username + '}'", 'an unbalanced brace'],
      ["username + '==='", 'an operator run'],
      ["username + 'a.'", 'a trailing dot'],
      ["username + '.,'", 'a dot before a comma'],
      ["username + '(.'", 'a dot after an opening parenthesis'],
      ["username + 'it\\'s @x'", 'an escaped quote before an @'],
    ])('accepts %s (%s)', (expression) => {
      expect(validateExpressions(expression, availableVars)).toEqual([])
    })

    it('still reports a string cut off after a backslash', () => {
      expect(validateExpressions("username + 'a\\", availableVars)).not.toEqual([])
    })

    it('still flags an @ outside the string', () => {
      const issues = validateExpressions("username @x + '@y'", availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Decorators (@) are not valid')
    })

    it('still flags an unbalanced parenthesis outside the string', () => {
      const issues = validateExpressions("len(username + ')'", availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('Unbalanced parentheses: missing )')
    })
  })

  describe('Function Call Validation in Complex Expressions', () => {
    it('detects unknown function in complex expression', () => {
      const issues = validateExpressions('abs(1) and exit()', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain("'exit'")
      expect(issues[0].message).toContain('is not recognized')
    })

    it('allows known function in complex expression', () => {
      const issues = validateExpressions('abs(1) and len(username)', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('allows variable that looks like function name', () => {
      // 'exit' without parens is just a variable reference
      const varsWithExit = new Set([...availableVars, 'exit'])
      const issues = validateExpressions('abs(1) and exit', varsWithExit)

      expect(issues).toHaveLength(0)
    })
  })

  describe('Method Validation', () => {
    it('allows valid string methods', () => {
      const issues = validateExpressions('username.upper()', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('allows chained valid methods', () => {
      const issues = validateExpressions('username.strip().upper()', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('detects invalid method name', () => {
      const issues = validateExpressions('username.hello()', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('hello')
      expect(issues[0].message).toContain('not a valid method')
    })

    it('detects invalid method in chain', () => {
      const issues = validateExpressions('username.strip().foo()', availableVars)

      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('foo')
    })

    it('allows valid list methods', () => {
      const issues = validateExpressions('items.append(1)', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('allows valid dict methods', () => {
      const issues = validateExpressions('config.keys()', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('allows methods with arguments', () => {
      const issues = validateExpressions("username.replace('a', 'b')", availableVars)

      expect(issues).toHaveLength(0)
    })

    it('validates methods against variable type when types provided', () => {
      const varTypes = new Map([['username', 'string']])
      // upper() is valid for strings
      expect(validateExpressions('username.upper()', availableVars, varTypes)).toHaveLength(0)

      // append() is NOT valid for strings (it's a list method)
      const issues = validateExpressions('username.append(1)', availableVars, varTypes)
      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('append')
      expect(issues[0].message).toContain("type 'string'")
    })

    it('validates list methods correctly', () => {
      const varTypes = new Map([['items', 'array']])
      // append() is valid for lists
      expect(validateExpressions('items.append(1)', availableVars, varTypes)).toHaveLength(0)

      // upper() is NOT valid for lists (it's a string method)
      const issues = validateExpressions('items.upper()', availableVars, varTypes)
      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('upper')
    })

    it('validates dict methods correctly', () => {
      const varTypes = new Map([['config', 'object']])
      // keys() is valid for dicts
      expect(validateExpressions('config.keys()', availableVars, varTypes)).toHaveLength(0)

      // upper() is NOT valid for dicts
      const issues = validateExpressions('config.upper()', availableVars, varTypes)
      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('upper')
    })

    it('tracks return type through method chains', () => {
      const varTypes = new Map([['username', 'string']])

      // isupper() returns bool, so abs() is not valid for bool
      const issues = validateExpressions('username.isupper().upper()', availableVars, varTypes)
      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('upper')
      expect(issues[0].message).toContain("type 'bool'")
    })

    it('allows valid chained methods that return same type', () => {
      const varTypes = new Map([['username', 'string']])

      // upper() returns str, strip() is valid for str
      expect(validateExpressions('username.upper().strip()', availableVars, varTypes)).toHaveLength(0)
    })
  })

  describe('Edge Cases', () => {
    it('handles empty expression gracefully', () => {
      const issues = validateExpressions('', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('handles whitespace-only expression', () => {
      const issues = validateExpressions('  ', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('handles chained methods on known variable', () => {
      const issues = validateExpressions('username.strip().upper()', availableVars)

      expect(issues).toHaveLength(0)
    })

    it('handles method with arguments', () => {
      const issues = validateExpressions("username.replace('a', 'b')", availableVars)

      expect(issues).toHaveLength(0)
    })

    it('handles nested function calls', () => {
      const issues = validateExpressions('str(len(items))', availableVars)

      expect(issues).toHaveLength(0)
    })
  })

  describe('hasValidationIssues helper', () => {
    it('returns true when issues exist', () => {
      expect(hasValidationIssues('unknown', availableVars)).toBe(true)
    })

    it('returns false when no issues', () => {
      expect(hasValidationIssues('username', availableVars)).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(hasValidationIssues('', availableVars)).toBe(false)
    })

    it('returns false for valid expression', () => {
      expect(hasValidationIssues('count + 1', availableVars)).toBe(false)
    })
  })
})

// =============================================================================
// Field Expression Validation (isFieldExpression=true blocks mutations)
// =============================================================================

describe('Field Expression Validation (mutation blocking)', () => {
  const availableVars = new Set(['my_list', 'my_dict', 'my_str', 'my_set'])
  const variableTypes = new Map([
    ['my_list', 'list'],
    ['my_dict', 'dict'],
    ['my_str', 'str'],
    ['my_set', 'set'],
  ])

  describe('blocks mutating methods in method_call case', () => {
    it('blocks list.append()', () => {
      const issues = validateExpressions('my_list.append(1)', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message).toContain('append')
      expect(issues[0].message).toContain('not allowed in field expressions')
    })

    it('blocks list.pop()', () => {
      const issues = validateExpressions('my_list.pop()', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message).toContain('pop')
    })

    it('blocks list.sort()', () => {
      const issues = validateExpressions('my_list.sort()', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('blocks list.clear()', () => {
      const issues = validateExpressions('my_list.clear()', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('blocks dict.pop()', () => {
      const issues = validateExpressions('my_dict.pop("key")', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('blocks dict.update()', () => {
      const issues = validateExpressions('my_dict.update(my_dict)', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('blocks set.add()', () => {
      const issues = validateExpressions('my_set.add(1)', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })
  })

  describe('allows non-mutating methods in field expressions', () => {
    it('allows str.upper()', () => {
      const issues = validateExpressions('my_str.upper()', availableVars, variableTypes, true)
      expect(issues).toHaveLength(0)
    })

    it('allows str.split()', () => {
      const issues = validateExpressions('my_str.split(",")', availableVars, variableTypes, true)
      expect(issues).toHaveLength(0)
    })

    it('allows dict.keys()', () => {
      const issues = validateExpressions('my_dict.keys()', availableVars, variableTypes, true)
      expect(issues).toHaveLength(0)
    })

    it('allows dict.get()', () => {
      const issues = validateExpressions('my_dict.get("key")', availableVars, variableTypes, true)
      expect(issues).toHaveLength(0)
    })

    it('allows list indexing (not a method call)', () => {
      const issues = validateExpressions('my_list[0]', availableVars, variableTypes, true)
      expect(issues).toHaveLength(0)
    })
  })

  describe('allows mutating methods when isFieldExpression is false', () => {
    it('allows list.append() in non-field context', () => {
      const issues = validateExpressions('my_list.append(1)', availableVars, variableTypes, false)
      expect(issues).toHaveLength(0)
    })

    it('allows dict.update() in non-field context', () => {
      const issues = validateExpressions('my_dict.update(my_dict)', availableVars, variableTypes, false)
      expect(issues).toHaveLength(0)
    })
  })

  describe('blocks field-blocked constructors', () => {
    it('blocks list() constructor in field expression', () => {
      const issues = validateExpressions('list(my_str)', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message).toContain('list')
      expect(issues[0].message).toContain('not allowed in field expressions')
    })

    it('blocks dict() constructor in field expression', () => {
      const issues = validateExpressions('dict()', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('blocks set() constructor in field expression', () => {
      const issues = validateExpressions('set(my_list)', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
    })

    it('allows str() constructor in field expression (not mutable)', () => {
      const issues = validateExpressions('str(my_list)', availableVars, variableTypes, true)
      expect(issues).toHaveLength(0)
    })

    it('allows int() constructor in field expression (not mutable)', () => {
      const issues = validateExpressions('int(my_str)', availableVars, variableTypes, true)
      expect(issues).toHaveLength(0)
    })
  })

  describe('blocks mutating methods in complex case', () => {
    it('blocks append in string literal method chain', () => {
      // '1,2,3'.split(',') is complex case; but split returns list...
      // Actually "'hello'.upper()" is complex because base is a literal
      // Let's use a literal-based expression with mutating method
      const issues = validateExpressions("','.join(my_list).split(',').clear()", availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message).toContain('clear')
    })

    it('blocks field-blocked constructor in complex expression', () => {
      // Complex expression (has operator) with list() constructor
      const issues = validateExpressions('my_list + list(my_str)', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message).toContain('list')
      expect(issues[0].message).toContain('not allowed in field expressions')
    })

    it('validates method arg count in complex expression', () => {
      // Complex expression (operator makes base non-identifier, so classified as 'complex')
      // upper() takes 0 args, passing 1 is invalid
      const issues = validateExpressions('1 + my_str.upper(1)', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('invalid_function')
      expect(issues[0].message).toContain('upper')
    })
  })

  describe('blocks mutating methods inside function calls (function_call case)', () => {
    it('blocks mutating method inside function call in field expression', () => {
      // sorted(my_list.append(1)) is classified as function_call
      // The inner method call .append() is mutating and blocked in field expressions
      const issues = validateExpressions('len(my_list.append(1))', availableVars, variableTypes, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message).toContain('append')
      expect(issues[0].message).toContain('not allowed in field expressions')
    })
  })

  describe('blocks mutating methods on untyped variables (method_call case)', () => {
    it('uses FIELD_ALLOWED_METHOD_NAMES fallback when variable has no type info', () => {
      // Variable in availableVars but NOT in variableTypes - currentType is undefined
      // Falls back to global FIELD_ALLOWED_METHOD_NAMES set
      const untypedVars = new Set(['data'])
      const issues = validateExpressions('data.append(1)', untypedVars, undefined, true)
      expect(issues).toHaveLength(1)
      expect(issues[0].type).toBe('blocked_function')
      expect(issues[0].message).toContain('append')
      expect(issues[0].message).toContain('not allowed in field expressions')
    })
  })
})

// =============================================================================
// Field Expression Helpers (read-only context)
// =============================================================================

import {
  FIELD_ALLOWED_BUILTINS,
  FIELD_ALLOWED_METHODS,
  FIELD_ALLOWED_METHOD_NAMES,
  getFieldMethodsForType,
  getFieldMethodNamesForType,
  ALLOWED_BUILTINS,
  ALL_METHODS,
  getMethodsForType,
} from '@/features/workbench/lib/python-builtins'

describe('Field Expression Helpers (read-only context)', () => {
  describe('FIELD_ALLOWED_BUILTINS', () => {
    it('excludes list constructor', () => {
      const listBuiltin = FIELD_ALLOWED_BUILTINS.find((b) => b.name === 'list')
      expect(listBuiltin).toBeUndefined()
    })

    it('excludes dict constructor', () => {
      const dictBuiltin = FIELD_ALLOWED_BUILTINS.find((b) => b.name === 'dict')
      expect(dictBuiltin).toBeUndefined()
    })

    it('excludes set constructor', () => {
      const setBuiltin = FIELD_ALLOWED_BUILTINS.find((b) => b.name === 'set')
      expect(setBuiltin).toBeUndefined()
    })

    it('includes non-mutating functions like len, str, abs', () => {
      const lenBuiltin = FIELD_ALLOWED_BUILTINS.find((b) => b.name === 'len')
      const strBuiltin = FIELD_ALLOWED_BUILTINS.find((b) => b.name === 'str')
      const absBuiltin = FIELD_ALLOWED_BUILTINS.find((b) => b.name === 'abs')

      expect(lenBuiltin).toBeDefined()
      expect(strBuiltin).toBeDefined()
      expect(absBuiltin).toBeDefined()
    })

    it('includes generally blocked functions like open, eval', () => {
      // These should not be in FIELD_ALLOWED_BUILTINS because they are generally blocked
      const openBuiltin = FIELD_ALLOWED_BUILTINS.find((b) => b.name === 'open')
      const evalBuiltin = FIELD_ALLOWED_BUILTINS.find((b) => b.name === 'eval')

      expect(openBuiltin).toBeUndefined()
      expect(evalBuiltin).toBeUndefined()
    })

    it('has fewer builtins than ALLOWED_BUILTINS', () => {
      // Field-allowed should exclude list, dict, set constructors
      expect(FIELD_ALLOWED_BUILTINS.length).toBeLessThan(ALLOWED_BUILTINS.length)
    })
  })

  describe('getFieldMethodsForType', () => {
    it('excludes mutating list methods', () => {
      const listMethods = getFieldMethodsForType('list')
      const mutatingMethods = ['append', 'extend', 'insert', 'remove', 'pop', 'clear', 'sort', 'reverse']

      for (const methodName of mutatingMethods) {
        const found = listMethods.find((m) => m.name === methodName)
        expect(found).toBeUndefined()
      }
    })

    it('includes non-mutating list methods', () => {
      const listMethods = getFieldMethodsForType('list')
      const nonMutatingMethods = ['index', 'count', 'copy']

      for (const methodName of nonMutatingMethods) {
        const found = listMethods.find((m) => m.name === methodName)
        expect(found).toBeDefined()
      }
    })

    it('excludes mutating dict methods', () => {
      const dictMethods = getFieldMethodsForType('dict')
      const mutatingMethods = ['pop', 'popitem', 'setdefault', 'update', 'clear']

      for (const methodName of mutatingMethods) {
        const found = dictMethods.find((m) => m.name === methodName)
        expect(found).toBeUndefined()
      }
    })

    it('includes non-mutating dict methods', () => {
      const dictMethods = getFieldMethodsForType('dict')
      const nonMutatingMethods = ['keys', 'values', 'items', 'get', 'copy']

      for (const methodName of nonMutatingMethods) {
        const found = dictMethods.find((m) => m.name === methodName)
        expect(found).toBeDefined()
      }
    })

    it('excludes mutating set methods', () => {
      const setMethods = getFieldMethodsForType('set')
      const mutatingMethods = ['add', 'remove', 'discard', 'pop', 'clear']

      for (const methodName of mutatingMethods) {
        const found = setMethods.find((m) => m.name === methodName)
        expect(found).toBeUndefined()
      }
    })

    it('includes non-mutating set methods', () => {
      const setMethods = getFieldMethodsForType('set')
      const nonMutatingMethods = ['union', 'intersection', 'difference', 'issubset', 'issuperset', 'copy']

      for (const methodName of nonMutatingMethods) {
        const found = setMethods.find((m) => m.name === methodName)
        expect(found).toBeDefined()
      }
    })

    it('excludes mutating table methods', () => {
      const tableMethods = getFieldMethodsForType('table')
      const mutatingMethods = [
        'set_cell', 'set_row', 'clear', 'add_row', 'insert_row', 'remove_row',
        'add_col', 'insert_col', 'remove_col',
      ]

      for (const methodName of mutatingMethods) {
        const found = tableMethods.find((m) => m.name === methodName)
        expect(found).toBeUndefined()
      }
    })

    it('includes non-mutating table methods', () => {
      const tableMethods = getFieldMethodsForType('table')
      const nonMutatingMethods = [
        'row_count', 'col_count', 'cell_count', 'col_names', 'col_types',
        'row', 'col', 'cell', 'to_list', 'to_dict',
      ]

      for (const methodName of nonMutatingMethods) {
        const found = tableMethods.find((m) => m.name === methodName)
        expect(found).toBeDefined()
      }
    })

    it('has fewer methods than getMethodsForType', () => {
      // Field methods should exclude mutating methods
      expect(getFieldMethodsForType('list').length).toBeLessThan(getMethodsForType('list').length)
      expect(getFieldMethodsForType('dict').length).toBeLessThan(getMethodsForType('dict').length)
      expect(getFieldMethodsForType('set').length).toBeLessThan(getMethodsForType('set').length)
      expect(getFieldMethodsForType('table').length).toBeLessThan(getMethodsForType('table').length)
    })
  })

  describe('getFieldMethodNamesForType', () => {
    it('returns Set of method names', () => {
      const names = getFieldMethodNamesForType('list')

      expect(names instanceof Set).toBe(true)
      expect(names.has('index')).toBe(true)
      expect(names.has('count')).toBe(true)
      expect(names.has('append')).toBe(false)
    })
  })

  describe('FIELD_ALLOWED_METHODS', () => {
    it('excludes mutating methods', () => {
      const mutatingMethodNames = ['append', 'pop', 'clear', 'set_cell', 'add_row']

      for (const methodName of mutatingMethodNames) {
        const found = FIELD_ALLOWED_METHODS.find((m) => m.name === methodName)
        expect(found).toBeUndefined()
      }
    })

    it('has fewer methods than ALL_METHODS', () => {
      expect(FIELD_ALLOWED_METHODS.length).toBeLessThan(ALL_METHODS.length)
    })
  })

  describe('FIELD_ALLOWED_METHOD_NAMES', () => {
    it('is a Set', () => {
      expect(FIELD_ALLOWED_METHOD_NAMES instanceof Set).toBe(true)
    })

    it('includes non-mutating methods', () => {
      expect(FIELD_ALLOWED_METHOD_NAMES.has('upper')).toBe(true)
      expect(FIELD_ALLOWED_METHOD_NAMES.has('keys')).toBe(true)
      expect(FIELD_ALLOWED_METHOD_NAMES.has('row_count')).toBe(true)
    })

    it('excludes mutating methods', () => {
      expect(FIELD_ALLOWED_METHOD_NAMES.has('append')).toBe(false)
      expect(FIELD_ALLOWED_METHOD_NAMES.has('pop')).toBe(false)
      expect(FIELD_ALLOWED_METHOD_NAMES.has('set_cell')).toBe(false)
    })
  })
})

// =============================================================================
// Table query operations in expressions
// =============================================================================

describe('Table query operations are offered and accepted in expressions', () => {
  const tableVars = new Set(['orders'])
  const tableTypes = new Map([['orders', 'table']])

  it.each(['filter', 'order_by'])('offers %s on the table type', (name) => {
    expect(getMethodsForType('table').some((m) => m.name === name)).toBe(true)
  })

  it.each(['filter', 'order_by'])('keeps %s available in field expressions', (name) => {
    expect(getFieldMethodsForType('table').some((m) => m.name === name)).toBe(true)
  })

  it('offers the operators on the column step that filter returns', () => {
    const names = getMethodsForType('column').map((m) => m.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'equals', 'not_equals', 'less_than', 'greater_than', 'less_or_equal',
        'greater_or_equal', 'contains', 'does_not_contain', 'starts_with',
        'ends_with', 'matches_regex', 'is_true', 'is_false', 'is_empty', 'is_not_empty',
      ]),
    )
  })

  it('keeps every column-step operator available in field expressions', () => {
    expect(getFieldMethodsForType('column')).toHaveLength(
      getMethodsForType('column').length,
    )
  })

  it('offers no table method on the column step, since it is not a table yet', () => {
    const names = getMethodsForType('column').map((m) => m.name)
    expect(names).not.toContain('row_count')
    expect(names).not.toContain('filter')
  })

  it('accepts a column step followed by its operator', () => {
    expect(
      validateExpressions("orders.filter('qty').greater_than(5)", tableVars, tableTypes, true),
    ).toEqual([])
  })

  it('accepts a value-less operator on the column step', () => {
    expect(
      validateExpressions("orders.filter('score').is_not_empty()", tableVars, tableTypes, true),
    ).toEqual([])
  })

  it('accepts filters chained through into order_by, since each operator returns a table', () => {
    expect(
      validateExpressions(
        "orders.filter('name').starts_with('A').filter('age').greater_than(25).order_by('name', 'age')",
        tableVars,
        tableTypes,
        true,
      ),
    ).toEqual([])
  })

  it('rejects a table method called directly on the column step', () => {
    const issues = validateExpressions("orders.filter('qty').row_count()", tableVars, tableTypes, true)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toBe("'row_count' is not a valid method for type 'column'")
  })

  it('accepts an order_by call with one key and with several', () => {
    expect(validateExpressions("orders.order_by('sku')", tableVars, tableTypes, true)).toEqual([])
    expect(
      validateExpressions("orders.order_by('sku', 'qty')", tableVars, tableTypes, true),
    ).toEqual([])
  })

  it('rejects a filter call with the wrong argument count', () => {
    const issues = validateExpressions("orders.filter('qty', 'x')", tableVars, tableTypes, true)
    expect(issues).toHaveLength(1)
    expect(issues[0].type).toBe('invalid_function')
    expect(issues[0].message).toBe("Method 'filter' takes 1 argument, got 2")
  })

  it('still rejects a method the table type does not have', () => {
    const issues = validateExpressions("orders.sort('sku')", tableVars, tableTypes, true)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toBe("'sort' is not a valid method for type 'table'")
  })
})

describe('is null and not null on the table filter column step (REQ-3.1.3.25)', () => {
  const tableVars = new Set(['orders'])
  const tableTypes = new Map([['orders', 'table']])
  const NULL_OPERATORS = ['is_null', 'is_not_null']

  it.each(NULL_OPERATORS)('offers %s on the column step that filter returns', (name) => {
    expect(getMethodsForType('column').map((m) => m.name)).toContain(name)
  })

  it.each(NULL_OPERATORS)('offers %s on the column step in field expressions', (name) => {
    expect(getFieldMethodsForType('column').map((m) => m.name)).toContain(name)
  })

  it.each(NULL_OPERATORS)("accepts orders.filter('x').%s() with no issue", (name) => {
    expect(
      validateExpressions(`orders.filter('x').${name}()`, tableVars, tableTypes, true),
    ).toEqual([])
  })

  it.each(NULL_OPERATORS)('chains %s into order_by, since it returns a table', (name) => {
    expect(
      validateExpressions(
        `orders.filter('x').${name}().filter('y').greater_than(1).order_by('y')`,
        tableVars,
        tableTypes,
        true,
      ),
    ).toEqual([])
  })

  it.each(NULL_OPERATORS)('refuses a compare-to value on %s', (name) => {
    const issues = validateExpressions(`orders.filter('x').${name}(1)`, tableVars, tableTypes, true)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toBe(`Method '${name}' takes 0 arguments, got 1`)
  })
})

describe('string literals holding characters outside the basic plane', () => {
  const vars = new Set(['username'])

  it.each([
    ["username + '\u{1F600} @x'", 'an emoji before an @'],
    ["username + 'it\\\u{1F600} @x'", 'an escaped emoji before an @'],
  ])('accepts %s (%s)', (expression) => {
    expect(validateExpressions(expression, vars)).toEqual([])
  })

  it('still flags an @ outside a string that holds an emoji', () => {
    const issues = validateExpressions("username @x + '\u{1F600}'", vars)

    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('Decorators (@) are not valid')
  })
})

describe('the sandbox table types in expressions', () => {
  it.each([
    ["Table([('k', 'integer')])", false],
    ["Table(['a', 'b']).col_names()[1]", true],
    ["TableRowView([7], ['k'])['k']", true],
    ["ColumnType('float').value", true],
  ])('%s carries no issue (field expression: %s)', (expression, isField) => {
    expect(validateExpressions(expression, new Set(), undefined, isField)).toEqual([])
  })

  it('still refuses a Python builtin the sandbox leaves out', () => {
    expect(validateExpressions('print(1)', new Set()).map((issue) => issue.type)).toEqual(['blocked_function'])
  })
})
