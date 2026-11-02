/**
 * Tests for client-side JSONPath evaluator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JSONPath } from 'jsonpath-plus'
import { evaluateJsonPath, validateJsonPathSyntax } from '@/features/workbench/lib/jsonpath-evaluator'
import { JsonNumberText } from '@/lib/variable-format'

vi.mock('jsonpath-plus', () => ({ JSONPath: vi.fn() }))

/** The matches the query library hands back: each value with the JSON pointer of its node. */
function matches(...found: Array<[unknown, string]>): never {
  return found.map(([value, pointer]) => ({ value, pointer })) as never
}

describe('evaluateJsonPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('successful evaluations', () => {
    it('returns string result for a single string match', () => {
      vi.mocked(JSONPath).mockReturnValue(matches(['hello', '/key']))
      const result = evaluateJsonPath('{"key": "hello"}', '$.key')
      expect(result.success).toBe(true)
      expect(result.type).toBe('string')
      expect(result.value).toBe('hello')
    })

    it('returns integer result for a whole number', () => {
      vi.mocked(JSONPath).mockReturnValue(matches([42, '/n']))
      const result = evaluateJsonPath('{"n": 42}', '$.n')
      expect(result.success).toBe(true)
      expect(result.type).toBe('integer')
      expect(result.value).toEqual(new JsonNumberText('42'))
    })

    it('returns float result for a fractional number', () => {
      vi.mocked(JSONPath).mockReturnValue(matches([3.14, '/n']))
      const result = evaluateJsonPath('{"n": 3.14}', '$.n')
      expect(result.success).toBe(true)
      expect(result.type).toBe('float')
      expect(result.value).toEqual(new JsonNumberText('3.14'))
    })

    it('returns boolean result', () => {
      vi.mocked(JSONPath).mockReturnValue(matches([true, '/flag']))
      const result = evaluateJsonPath('{"flag": true}', '$.flag')
      expect(result.success).toBe(true)
      expect(result.type).toBe('boolean')
      expect(result.value).toBe(true)
    })

    it('returns null result', () => {
      vi.mocked(JSONPath).mockReturnValue(matches([null, '/val']))
      const result = evaluateJsonPath('{"val": null}', '$.val')
      expect(result.success).toBe(true)
      expect(result.type).toBe('null')
      expect(result.value).toBeNull()
    })

    it('returns map result for object', () => {
      vi.mocked(JSONPath).mockReturnValue(matches([{ a: 1, b: 2 }, '/nested']))
      const result = evaluateJsonPath('{"nested": {"a":1,"b":2}}', '$.nested')
      expect(result.success).toBe(true)
      expect(result.type).toBe('map')
      expect(result.value).toEqual({ a: new JsonNumberText('1'), b: new JsonNumberText('2') })
    })

    it('returns array result for empty matches', () => {
      vi.mocked(JSONPath).mockReturnValue([] as never)
      const result = evaluateJsonPath('{"key": "val"}', '$.missing')
      expect(result.success).toBe(true)
      expect(result.type).toBe('array')
      expect(result.value).toEqual([])
    })

    it('returns array result for multiple matches', () => {
      vi.mocked(JSONPath).mockReturnValue(matches(['a', '/items/0'], ['b', '/items/1'], ['c', '/items/2']))
      const result = evaluateJsonPath('{"items": ["a","b","c"]}', '$.items[*]')
      expect(result.success).toBe(true)
      expect(result.type).toBe('array')
      expect(result.value).toEqual(['a', 'b', 'c'])
    })

    it('returns array result for a single array value', () => {
      vi.mocked(JSONPath).mockReturnValue(matches([[1, 2, 3], '/list']))
      const result = evaluateJsonPath('{"list": [1,2,3]}', '$.list')
      expect(result.success).toBe(true)
      expect(result.type).toBe('array')
      expect(result.value).toEqual([new JsonNumberText('1'), new JsonNumberText('2'), new JsonNumberText('3')])
    })

    it('returns string type for undefined value (detectJsonType fallback)', () => {
      vi.mocked(JSONPath).mockReturnValue(matches([undefined, '/key']))
      const result = evaluateJsonPath('{"key": "val"}', '$.key')
      expect(result.success).toBe(true)
      expect(result.type).toBe('string')
      expect(result.value).toBeUndefined()
    })
  })

  // A pasted sample never loses a typed digit in the result (REQ-3.1.3.14).
  describe('exact numbers', () => {
    beforeEach(async () => {
      const actual = await vi.importActual<typeof import('jsonpath-plus')>('jsonpath-plus')
      vi.mocked(JSONPath).mockImplementation(actual.JSONPath as never)
    })

    it('shows a long integer and a decimal as written', () => {
      const result = evaluateJsonPath('{"id": 12345678901234567890, "rate": 1.50}', '$.id')
      expect(result).toEqual({ success: true, type: 'integer', value: new JsonNumberText('12345678901234567890') })
      expect(evaluateJsonPath('{"id": 1, "rate": 1.50}', '$.rate').value).toEqual(new JsonNumberText('1.50'))
    })

    it('keeps the numbers of a matched node and of a key with a slash or tilde in its name', () => {
      const result = evaluateJsonPath('{"a/b": {"c~d": [12345678901234567891]}}', "$['a/b']")
      expect(result.value).toEqual({ 'c~d': [new JsonNumberText('12345678901234567891')] })
    })

    it('filters by the numbers it reads and still shows the exact match', () => {
      const result = evaluateJsonPath('{"rows": [{"n": 1}, {"n": 12345678901234567892}]}', '$.rows[?(@.n > 5)].n')
      expect(result.value).toEqual(new JsonNumberText('12345678901234567892'))
    })

    it('reads a JS number by its shape where the browser gives no number source text', () => {
      const realParse = JSON.parse
      vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?: (key: string, value: unknown) => unknown) =>
        realParse(text, reviver === undefined ? undefined : (key: string, value: unknown) => reviver(key, value)),
      )
      expect(evaluateJsonPath('{"n": 7, "r": 2.5}', '$.n')).toEqual({ success: true, type: 'integer', value: 7 })
      expect(evaluateJsonPath('{"n": 7, "r": 2.5}', '$.r')).toEqual({ success: true, type: 'float', value: 2.5 })
      vi.restoreAllMocks()
    })

    it('shows a property name a query returns as the name', () => {
      expect(evaluateJsonPath('{"total": 3}', '$.*~').value).toBe('total')
    })
  })

  describe('error handling', () => {
    it('returns JSON Parse Error for invalid JSON input', () => {
      const result = evaluateJsonPath('{not valid json', '$.key')
      expect(result.success).toBe(false)
      expect(result.error).toBe('JSON Parse Error')
      expect(result.detail).toBeTruthy()
      // JSONPath should not be called when JSON parsing fails
      expect(vi.mocked(JSONPath)).not.toHaveBeenCalled()
    })

    it('returns Invalid JSONPath error when JSONPath throws', () => {
      vi.mocked(JSONPath).mockImplementation(() => {
        throw new Error('bad path')
      })
      const result = evaluateJsonPath('{"key": 1}', '$[invalid')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid JSONPath')
      expect(result.detail).toBe('bad path')
    })

    it('handles non-Error exceptions from JSONPath', () => {
      vi.mocked(JSONPath).mockImplementation(() => {
        throw 'string error' // eslint-disable-line no-throw-literal
      })
      const result = evaluateJsonPath('{"key": 1}', '$[invalid')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid JSONPath')
      expect(result.detail).toBe('string error')
    })

    it('handles non-Error exceptions from JSON.parse', () => {
      const origParse = JSON.parse
      vi.spyOn(JSON, 'parse').mockImplementation(() => {
        throw 42 // eslint-disable-line no-throw-literal
      })
      const result = evaluateJsonPath('{}', '$.key')
      expect(result.success).toBe(false)
      expect(result.error).toBe('JSON Parse Error')
      expect(result.detail).toBe('42')
      JSON.parse = origParse
      vi.restoreAllMocks()
    })
  })
})

describe('validateJsonPathSyntax', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for empty expression', () => {
    expect(validateJsonPathSyntax('')).toBeNull()
  })

  it('returns null for whitespace-only expression', () => {
    expect(validateJsonPathSyntax('   ')).toBeNull()
    expect(validateJsonPathSyntax('\t\n')).toBeNull()
  })

  it('returns null for valid expression (JSONPath does not throw)', () => {
    vi.mocked(JSONPath).mockReturnValue([] as never)
    expect(validateJsonPathSyntax('$.store.book[*]')).toBeNull()
    expect(vi.mocked(JSONPath)).toHaveBeenCalledWith({
      path: '$.store.book[*]',
      json: {},
      resultType: 'value',
    })
  })

  it('returns error message for invalid expression', () => {
    vi.mocked(JSONPath).mockImplementation(() => {
      throw new Error('Unexpected token')
    })
    const result = validateJsonPathSyntax('$[invalid')
    expect(result).toBe('Unexpected token')
  })

  it('returns null when JSON content is malformed (skips validation)', () => {
    expect(validateJsonPathSyntax('$.key', '{broken json')).toBeNull()
    // JSONPath should still be called with fallback empty object
    // Actually, malformed JSON causes early return null before JSONPath
    // Wait - looking at the source: if JSON parse fails, it returns null immediately
    // So JSONPath should NOT be called
    expect(vi.mocked(JSONPath)).not.toHaveBeenCalled()
  })

  it('uses provided JSON content for context', () => {
    vi.mocked(JSONPath).mockReturnValue([] as never)
    const jsonContent = '{"store": {"book": []}}'
    validateJsonPathSyntax('$.store.book[*]', jsonContent)
    expect(vi.mocked(JSONPath)).toHaveBeenCalledWith({
      path: '$.store.book[*]',
      json: { store: { book: [] } },
      resultType: 'value',
    })
  })

  it('uses empty object when no JSON content provided', () => {
    vi.mocked(JSONPath).mockReturnValue([] as never)
    validateJsonPathSyntax('$.key')
    expect(vi.mocked(JSONPath)).toHaveBeenCalledWith({
      path: '$.key',
      json: {},
      resultType: 'value',
    })
  })

  it('handles non-Error exceptions', () => {
    vi.mocked(JSONPath).mockImplementation(() => {
      throw 'not an error object' // eslint-disable-line no-throw-literal
    })
    const result = validateJsonPathSyntax('$.bad')
    expect(result).toBe('Invalid JSONPath expression')
  })
})
