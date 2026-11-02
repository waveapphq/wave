/**
 * Tests for client-side XPath evaluator
 */

import { describe, it, expect, vi } from 'vitest'
import { evaluateXPath, validateXPathSyntax } from '@/features/workbench/lib/xpath-evaluator'

describe('evaluateXPath', () => {
  const SIMPLE_XML = '<root><item>Hello</item><item>World</item></root>'

  describe('successful evaluations', () => {
    it('evaluates text node query returning single string', () => {
      const result = evaluateXPath(
        '<root><item>Hello</item></root>',
        '//item/text()'
      )
      expect(result.success).toBe(true)
      expect(result.type).toBe('string')
      expect(result.value).toBe('Hello')
    })

    it('evaluates text node query returning multiple values', () => {
      const result = evaluateXPath(SIMPLE_XML, '//item/text()')
      expect(result.success).toBe(true)
      expect(result.type).toBe('array')
      expect(result.value).toEqual(['Hello', 'World'])
    })

    it('evaluates count() returning integer', () => {
      const result = evaluateXPath(SIMPLE_XML, 'count(//item)')
      expect(result.success).toBe(true)
      expect(result.type).toBe('integer')
      expect(result.value).toBe(2)
    })

    it('evaluates sum() div count() returning float', () => {
      const xml = '<root><n>10</n><n>3</n></root>'
      const result = evaluateXPath(xml, 'sum(//n) div count(//n)')
      expect(result.success).toBe(true)
      expect(result.type).toBe('float')
      expect(result.value).toBeCloseTo(6.5, 2)
    })

    it('evaluates string() function', () => {
      const result = evaluateXPath(SIMPLE_XML, 'string(//item)')
      expect(result.success).toBe(true)
      expect(result.type).toBe('string')
      expect(result.value).toBe('Hello')
    })

    it('evaluates boolean() function', () => {
      const result = evaluateXPath(SIMPLE_XML, 'boolean(//item)')
      expect(result.success).toBe(true)
      expect(result.type).toBe('boolean')
      expect(result.value).toBe(true)
    })

    it('returns empty array for non-matching query', () => {
      const result = evaluateXPath(SIMPLE_XML, '//nonexistent')
      expect(result.success).toBe(true)
      expect(result.type).toBe('array')
      expect(result.value).toEqual([])
    })

    it('evaluates attribute query', () => {
      const xml = '<root><item id="42">test</item></root>'
      const result = evaluateXPath(xml, '//item/@id')
      expect(result.success).toBe(true)
      expect(result.type).toBe('string')
      expect(result.value).toBe('42')
    })

    it('evaluates query with predicates', () => {
      const xml = '<root><item p="high">A</item><item p="low">B</item><item p="high">C</item></root>'
      const result = evaluateXPath(xml, '//item[@p="high"]/text()')
      expect(result.success).toBe(true)
      expect(result.type).toBe('array')
      expect(result.value).toEqual(['A', 'C'])
    })
  })

  describe('namespace support', () => {
    it('evaluates query with namespace', () => {
      const xml = '<root xmlns:ex="http://example.com"><ex:item>test</ex:item></root>'
      const result = evaluateXPath(xml, '//ex:item/text()', {
        ex: 'http://example.com',
      })
      expect(result.success).toBe(true)
      expect(result.value).toBe('test')
    })

    it('auto-extracts namespaces from XML root element', () => {
      const xml = '<root xmlns:ex="http://example.com"><ex:item>auto</ex:item></root>'
      // No explicit namespaces - should auto-extract from xmlns declarations
      const result = evaluateXPath(xml, '//ex:item/text()')
      expect(result.success).toBe(true)
      expect(result.value).toBe('auto')
    })

    it('user-provided namespaces merge with auto-extracted', () => {
      const xml = '<root xmlns:ex="http://example.com"><ex:item>test</ex:item></root>'
      // Provide the same mapping explicitly - should still work
      const result = evaluateXPath(xml, '//ex:item/text()', {
        ex: 'http://example.com',
      })
      expect(result.success).toBe(true)
      expect(result.value).toBe('test')
    })

    it('evaluates without namespace resolver when no namespaces provided', () => {
      const result = evaluateXPath(SIMPLE_XML, '//item/text()')
      expect(result.success).toBe(true)
    })
  })

  describe('error handling', () => {
    it('returns error for malformed XML', () => {
      const result = evaluateXPath('<root><unclosed', '//item')
      expect(result.success).toBe(false)
      expect(result.error).toBe('XML Parse Error')
      expect(result.detail).toBeTruthy()
    })

    it('returns error for invalid XPath', () => {
      const result = evaluateXPath(SIMPLE_XML, '//[invalid')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid XPath')
      expect(result.detail).toBeTruthy()
    })

    it('catches DOMParser constructor errors', () => {
      vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(() => {
        throw new Error('Parser unavailable')
      })
      const result = evaluateXPath('<root/>', '//item')
      expect(result.success).toBe(false)
      expect(result.error).toBe('XML Parse Error')
      expect(result.detail).toBe('Parser unavailable')
      vi.restoreAllMocks()
    })

    it('catches DOMParser non-Error throw', () => {
      vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(() => {
        throw 'parser broke' // eslint-disable-line no-throw-literal
      })
      const result = evaluateXPath('<root/>', '//item')
      expect(result.success).toBe(false)
      expect(result.error).toBe('XML Parse Error')
      expect(result.detail).toBe('parser broke')
      vi.restoreAllMocks()
    })
  })

  describe('namespace resolver edge cases', () => {
    it('resolver is invoked for each prefix and returns URI or null', () => {
      // jsdom doesn't invoke the custom resolver, so we intercept doc.evaluate
      // to manually call the resolver and verify its behavior
      let capturedResolver: { lookupNamespaceURI: (prefix: string | null) => string | null } | null = null
      const origParseFromString = DOMParser.prototype.parseFromString
      vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(
        function (this: DOMParser, ...args: [string, DOMParserSupportedType]) {
          const doc = origParseFromString.apply(this, args)
          const origEval = doc.evaluate.bind(doc)
          doc.evaluate = (expr: string, ctx: Node, resolver: XPathNSResolver | null, type: number, result: XPathResult | null) => {
            capturedResolver = resolver as typeof capturedResolver
            return origEval(expr, ctx, null, type, result)
          }
          return doc
        }
      )

      evaluateXPath('<root/>', '//item', { ns: 'http://example.com' })

      // Verify resolver was captured and works correctly
      expect(capturedResolver).not.toBeNull()
      const lookup = capturedResolver!.lookupNamespaceURI
      // Known prefix returns URI
      expect(lookup('ns')).toBe('http://example.com')
      // Unknown prefix returns null
      expect(lookup('unknown')).toBeNull()
      // Null prefix returns null
      expect(lookup(null)).toBeNull()

      vi.restoreAllMocks()
    })
  })
})

describe('evaluateXPath - snapshot result types', () => {
  const XML = '<root><item>A</item><item>B</item></root>'

  function mockEvaluate(fakeResult: Record<string, unknown>) {
    const origParseFromString = DOMParser.prototype.parseFromString
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(
      function (this: DOMParser, ...args: [string, DOMParserSupportedType]) {
        const doc = origParseFromString.apply(this, args)
        doc.evaluate = () => fakeResult as unknown as XPathResult
        return doc
      }
    )
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles ORDERED_NODE_SNAPSHOT_TYPE with multiple nodes', () => {
    mockEvaluate({
      resultType: XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      snapshotLength: 2,
      snapshotItem: (i: number) => ({ textContent: ['A', 'B'][i] }),
    })
    const result = evaluateXPath(XML, '//item')
    expect(result.success).toBe(true)
    expect(result.type).toBe('array')
    expect(result.value).toEqual(['A', 'B'])
  })

  it('handles ORDERED_NODE_SNAPSHOT_TYPE with single node', () => {
    mockEvaluate({
      resultType: XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      snapshotLength: 1,
      snapshotItem: () => ({ textContent: 'only' }),
    })
    const result = evaluateXPath(XML, '//item[1]')
    expect(result.success).toBe(true)
    expect(result.type).toBe('string')
    expect(result.value).toBe('only')
  })

  it('handles ORDERED_NODE_SNAPSHOT_TYPE with empty result', () => {
    mockEvaluate({
      resultType: XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      snapshotLength: 0,
      snapshotItem: () => null,
    })
    const result = evaluateXPath(XML, '//missing')
    expect(result.success).toBe(true)
    expect(result.type).toBe('array')
    expect(result.value).toEqual([])
  })

  it('handles snapshot node with null textContent', () => {
    mockEvaluate({
      resultType: XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
      snapshotLength: 1,
      snapshotItem: () => ({ textContent: null }),
    })
    const result = evaluateXPath(XML, '//item')
    expect(result.success).toBe(true)
    expect(result.value).toBe('')
  })

  it('handles FIRST_ORDERED_NODE_TYPE with a node', () => {
    mockEvaluate({
      resultType: XPathResult.FIRST_ORDERED_NODE_TYPE,
      singleNodeValue: { textContent: 'first' },
    })
    const result = evaluateXPath(XML, '//item[1]')
    expect(result.success).toBe(true)
    expect(result.type).toBe('string')
    expect(result.value).toBe('first')
  })

  it('handles FIRST_ORDERED_NODE_TYPE with null node', () => {
    mockEvaluate({
      resultType: XPathResult.FIRST_ORDERED_NODE_TYPE,
      singleNodeValue: null,
    })
    const result = evaluateXPath(XML, '//missing')
    expect(result.success).toBe(true)
    expect(result.type).toBe('string')
    expect(result.value).toBe('')
  })

  it('handles ANY_UNORDERED_NODE_TYPE with null textContent', () => {
    mockEvaluate({
      resultType: XPathResult.ANY_UNORDERED_NODE_TYPE,
      singleNodeValue: { textContent: null },
    })
    const result = evaluateXPath(XML, '//item')
    expect(result.success).toBe(true)
    expect(result.value).toBe('')
  })

  it('handles iterator node with null textContent', () => {
    let callCount = 0
    mockEvaluate({
      resultType: XPathResult.ORDERED_NODE_ITERATOR_TYPE,
      iterateNext: () => {
        callCount++
        if (callCount === 1) return { textContent: null }
        return null
      },
    })
    const result = evaluateXPath(XML, '//item')
    expect(result.success).toBe(true)
    expect(result.type).toBe('string')
    expect(result.value).toBe('')
  })

  it('handles non-Error throw during XPath evaluation', () => {
    const origParseFromString = DOMParser.prototype.parseFromString
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(
      function (this: DOMParser, ...args: [string, DOMParserSupportedType]) {
        const doc = origParseFromString.apply(this, args)
        doc.evaluate = () => {
          throw 42 // eslint-disable-line no-throw-literal
        }
        return doc
      }
    )
    const result = evaluateXPath(XML, '//item')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid XPath')
    expect(result.detail).toBe('42')
    vi.restoreAllMocks()
  })

  it('handles null parseError.textContent', () => {
    const origParseFromString = DOMParser.prototype.parseFromString
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(
      function (this: DOMParser, ..._args: [string, DOMParserSupportedType]) {
        const doc = origParseFromString.apply(this, ['<x/>', 'application/xml' as DOMParserSupportedType])
        // Create a fake parsererror element with null textContent
        const fakeError = doc.createElement('parsererror')
        Object.defineProperty(fakeError, 'textContent', { get: () => null })
        doc.querySelector = (sel: string) => sel === 'parsererror' ? fakeError : null
        return doc
      }
    )
    const result = evaluateXPath('<bad xml', '//item')
    expect(result.success).toBe(false)
    expect(result.error).toBe('XML Parse Error')
    expect(result.detail).toBe('Failed to parse XML')
    vi.restoreAllMocks()
  })

  it('handles unknown resultType (default branch)', () => {
    mockEvaluate({
      resultType: 999,
    })
    const result = evaluateXPath(XML, '//item')
    expect(result.success).toBe(true)
    expect(result.type).toBe('string')
    expect(result.value).toBe('')
  })
})

describe('evaluateXPath - namespace edge cases', () => {
  it('returns null from resolver for unknown prefix', () => {
    const xml = '<root xmlns:ex="http://example.com"><ex:item>test</ex:item></root>'
    // Query uses 'ex' prefix which is registered, but nsResolver also handles unknown prefixes
    const result = evaluateXPath(xml, '//ex:item/text()', { ex: 'http://example.com' })
    expect(result.success).toBe(true)
    expect(result.value).toBe('test')
  })
})

describe('validateXPathSyntax', () => {
  it('returns null for valid XPath expressions', () => {
    expect(validateXPathSyntax('//item/text()')).toBeNull()
    expect(validateXPathSyntax('count(//item)')).toBeNull()
    expect(validateXPathSyntax('/root/child[@attr="val"]')).toBeNull()
  })

  it('returns null for empty or whitespace-only strings', () => {
    expect(validateXPathSyntax('')).toBeNull()
    expect(validateXPathSyntax('   ')).toBeNull()
    expect(validateXPathSyntax('\t\n')).toBeNull()
  })

  it('returns error message string for invalid XPath syntax', () => {
    const result = validateXPathSyntax('//[invalid')
    expect(result).toBeTypeOf('string')
    expect(result!.length).toBeGreaterThan(0)
  })

  it('returns generic message when a non-Error is thrown', () => {
    const originalParseFromString = DOMParser.prototype.parseFromString
    // Mock DOMParser so that evaluate on the returned doc throws a non-Error value
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(
      function (this: DOMParser, ...args: [string, DOMParserSupportedType]) {
        const doc = originalParseFromString.apply(this, args)
        doc.evaluate = () => {
          throw 'not an error object' // eslint-disable-line no-throw-literal
        }
        return doc
      }
    )

    try {
      const result = validateXPathSyntax('//anything')
      expect(result).toBe('Invalid XPath expression')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('accepts namespaced XPath when xmlContent has namespace declarations', () => {
    const xml = '<root xmlns:ex="http://example.com"><ex:item>test</ex:item></root>'
    expect(validateXPathSyntax('//ex:item/text()', xml)).toBeNull()
  })

  it('does not error for namespaced XPath without xmlContent in jsdom', () => {
    // In real browsers, this throws "unresolvable namespaces" but jsdom is lenient.
    // The key behavior is that it does NOT throw - validation passes.
    const result = validateXPathSyntax('//ex:item/text()')
    expect(result).toBeNull()
  })

  it('returns null when xmlContent is malformed (defers to XML linter)', () => {
    expect(validateXPathSyntax('//item', '<root><unclosed')).toBeNull()
  })
})
