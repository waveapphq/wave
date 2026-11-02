/**
 * Code view of string-only maps (REQ-3.4.1.4).
 *
 * Each value is a LITERAL or a whole-value EXPRESSION. The Code view is
 * valid-JSON-shaped: a quoted string is a literal (a literal `{{ }}` inside
 * quotes stays literal), a bare `{{ expr }}` (unquoted value) is an expression
 * carrying the raw expression text; expression-ness is a sidecar set of keys.
 * A value that is neither a quoted string nor a bare {{ }} is rejected with an
 * exact message, and the source-level duplicate-member scan flags what the
 * Visual view flags.
 */
import { describe, it, expect } from 'vitest'
import {
  maskBareExpressionsForLint,
  parseStringMapCode,
  scanDuplicateMapMemberKeys,
  serializeStringMapForCode,
} from '@/lib/variable-validation'

const NON_STRING = (key: string) =>
  `Key "${key}": value must be a quoted string or a {{ expression }}`

describe('serializeStringMapForCode (literal vs expression)', () => {
  it('quotes a literal and renders an expression key as a bare {{ }} value', () => {
    const text = serializeStringMapForCode(
      { Authorization: "'Bearer ' + token", Accept: 'application/json' },
      new Set(['Authorization']),
    )
    expect(text).toBe('{\n  "Authorization": {{ \'Bearer \' + token }},\n  "Accept": "application/json"\n}')
  })

  it('keeps a literal that contains {{ }} chars quoted (not an expression)', () => {
    const text = serializeStringMapForCode({ 'X-Note': '{{ not an expr }}' }, new Set())
    expect(text).toBe('{\n  "X-Note": "{{ not an expr }}"\n}')
  })

  it('never emits an object form for expression values', () => {
    const text = serializeStringMapForCode({ 'X-Api-Key': 'api_key' }, new Set(['X-Api-Key']))
    expect(text).not.toContain('$expr')
    expect(text).toBe('{\n  "X-Api-Key": {{ api_key }}\n}')
  })

  it('serializes an empty map as {}', () => {
    expect(serializeStringMapForCode({}).trim()).toBe('{}')
  })
})

describe('parseStringMapCode (literal vs expression round trip)', () => {
  it('parses the section-18 example: literal, bare expression, and literal braces', () => {
    const parsed = parseStringMapCode(
      '{\n  "key": "val1",\n  "other": {{ my_var }},\n  "key2": "{{ literal braces, not expr }}"\n}',
    )
    expect(parsed.value).toEqual({
      key: 'val1',
      other: 'my_var',
      key2: '{{ literal braces, not expr }}',
    })
    expect(parsed.exprKeys).toEqual(['other'])
    expect(parsed.errors).toEqual([])
  })

  it('round-trips literals and expressions through serialize -> parse', () => {
    const value = { Authorization: "'Bearer ' + token", 'X-Trace-Id': 'wave-1' }
    const exprKeys = new Set(['Authorization'])
    const parsed = parseStringMapCode(serializeStringMapForCode(value, exprKeys))
    expect(parsed.value).toEqual(value)
    expect(parsed.exprKeys).toEqual(['Authorization'])
    expect(parsed.errors).toEqual([])
  })

  it('parses a plain string member verbatim as a literal', () => {
    const parsed = parseStringMapCode('{"Accept": "text/html"}')
    expect(parsed.value).toEqual({ Accept: 'text/html' })
    expect(parsed.exprKeys).toEqual([])
    expect(parsed.errors).toEqual([])
  })

  it('parses a literal whose string contains an escaped quote', () => {
    const parsed = parseStringMapCode('{"X-Note": "a\\"b"}')
    expect(parsed.value).toEqual({ 'X-Note': 'a"b' })
    expect(parsed.exprKeys).toEqual([])
    expect(parsed.errors).toEqual([])
  })

  it('captures a bare expression that itself contains single braces', () => {
    const parsed = parseStringMapCode('{"X": {{ obj["k"] }}}')
    expect(parsed.value).toEqual({ X: 'obj["k"]' })
    expect(parsed.exprKeys).toEqual(['X'])
    expect(parsed.errors).toEqual([])
  })

  it.each([
    ['a number', '{"port": 8080}', 'port'],
    ['a boolean', '{"flag": true}', 'flag'],
    ['null', '{"empty": null}', 'empty'],
    ['an object', '{"X-Custom": {"foo": 1}}', 'X-Custom'],
    ['the legacy $expr object form', '{"Authorization": {"$expr": "bearer(t)"}}', 'Authorization'],
    ['an array', '{"X-Custom": ["a", "b"]}', 'X-Custom'],
  ])('rejects %s with the exact message', (_label, text, key) => {
    const parsed = parseStringMapCode(text)
    expect(parsed.errors).toEqual([NON_STRING(key)])
    expect(parsed.value).toEqual({})
    expect(parsed.exprKeys).toEqual([])
  })

  it('collects one error per offending member, in member order, keeping valid ones', () => {
    const parsed = parseStringMapCode('{"A": 1, "B": "ok", "C": {{ expr }}, "D": false}')
    expect(parsed.errors).toEqual([NON_STRING('A'), NON_STRING('D')])
    expect(parsed.value).toEqual({ B: 'ok', C: 'expr' })
    expect(parsed.exprKeys).toEqual(['C'])
  })

  it('refuses a non-object root with "Must be a JSON object"', () => {
    expect(() => parseStringMapCode('["not", "a", "map"]')).toThrow(/^Must be a JSON object$/)
  })

  it('throws on invalid JSON (the caller renders the syntax error)', () => {
    expect(() => parseStringMapCode('{"broken": ')).toThrow()
  })

  it('throws on an unterminated bare expression', () => {
    expect(() => parseStringMapCode('{"X": {{ oops }')).toThrow()
  })
})

describe('maskBareExpressionsForLint (syntax check sees {{ }} as a string)', () => {
  const isValidJson = (text: string) => {
    try {
      JSON.parse(text)
      return true
    } catch {
      return false
    }
  }

  it('masks a bare expression to a same-length quoted string so the JSON validates', () => {
    const text = '{"123": "12323", "dsad": {{ abs(-1) }}}'
    const masked = maskBareExpressionsForLint(text)
    expect(masked.length).toBe(text.length)
    expect(isValidJson(text)).toBe(false)
    expect(isValidJson(masked)).toBe(true)
  })

  it('treats an empty {{}} as a valid string', () => {
    const masked = maskBareExpressionsForLint('{"k": {{}}}')
    expect(masked).toBe('{"k": "xx"}')
    expect(isValidJson(masked)).toBe(true)
  })

  it('leaves a literal {{ }} inside a quoted string untouched', () => {
    const text = '{"k": "{{ literal }}"}'
    expect(maskBareExpressionsForLint(text)).toBe(text)
  })

  it('still leaves genuinely broken JSON broken (an unterminated {{)', () => {
    expect(isValidJson(maskBareExpressionsForLint('{"k": {{ oops }'))).toBe(false)
  })
})

describe('scanDuplicateMapMemberKeys (source-level duplicate scan)', () => {
  it('finds a top-level duplicate member JSON.parse would swallow', () => {
    expect(scanDuplicateMapMemberKeys('{"A": "1", "A": "2"}')).toEqual(['A'])
  })

  it('returns an empty list when all members are unique', () => {
    expect(scanDuplicateMapMemberKeys('{"A": "1", "B": "2"}')).toEqual([])
  })

  it('groups case-insensitively when asked (header semantics)', () => {
    expect(
      scanDuplicateMapMemberKeys('{"Authorization": "1", "authorization": "2"}', true),
    ).toEqual(['Authorization'])
  })

  it('keeps case-different keys distinct by default', () => {
    expect(scanDuplicateMapMemberKeys('{"A": "1", "a": "2"}')).toEqual([])
  })

  it('ignores keys nested inside object values (top-level members only)', () => {
    expect(
      scanDuplicateMapMemberKeys('{"A": {"x": "1"}, "B": {"x": "2"}}'),
    ).toEqual([])
  })

  it('is not fooled by key-like text inside string values', () => {
    expect(scanDuplicateMapMemberKeys('{"A": "\\"A\\": 1", "B": "2"}')).toEqual([])
  })

  it('reports each duplicated key once, in first-seen order', () => {
    expect(
      scanDuplicateMapMemberKeys('{"B": "1", "A": "2", "B": "3", "A": "4", "B": "5"}'),
    ).toEqual(['B', 'A'])
  })

  it('allows whitespace between a key and its colon', () => {
    expect(scanDuplicateMapMemberKeys('{"A" : "1", "A": "2"}')).toEqual(['A'])
  })

  it('does not report a trailing key string cut off before its colon (mid-typing)', () => {
    expect(scanDuplicateMapMemberKeys('{"A": "1", "A"')).toEqual([])
    expect(scanDuplicateMapMemberKeys('{"A": "1", "A"  ')).toEqual([])
  })
})
