/**
 * Tests for the promoted format-detection + pretty-print utilities. detectFormat
 * and formatContent move verbatim out of the Text Editor Modal into
 * lib/codemirror so the string watcher reuses them. These exercise the pure
 * functions directly with the real js-yaml + xml-formatter stack (no mocks).
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect } from 'vitest'

import { detectFormat, formatContent, validateFormatSyntax } from '@/lib/codemirror/format-utils'

// ===========================================================================
// detectFormat
// ===========================================================================

describe('detectFormat', () => {
  it('detects an empty string as plain', () => {
    expect(detectFormat('')).toBe('plain')
  })

  it('detects whitespace-only content as plain', () => {
    expect(detectFormat('   \n  ')).toBe('plain')
  })

  it('detects a JSON object as json', () => {
    expect(detectFormat('{"a": 1}')).toBe('json')
  })

  it('detects a JSON array as json', () => {
    expect(detectFormat('[1, 2, 3]')).toBe('json')
  })

  it('falls back to plain for invalid JSON that starts with a brace', () => {
    expect(detectFormat('{not valid json')).toBe('plain')
  })

  it('detects content with an XML declaration as xml', () => {
    expect(detectFormat('<?xml version="1.0"?><root/>')).toBe('xml')
  })

  it('detects content that starts with a tag as xml', () => {
    expect(detectFormat('<root><item>x</item></root>')).toBe('xml')
  })

  it('detects content that starts with --- as yaml', () => {
    expect(detectFormat('---\nname: test')).toBe('yaml')
  })

  it('detects key: value lines as yaml', () => {
    expect(detectFormat('name: test\nvalue: 123')).toBe('yaml')
  })

  it('detects a single Word: line as yaml (the documented prose false positive)', () => {
    expect(detectFormat('Note: this is prose')).toBe('yaml')
  })

  it('does not treat a leading-colon line as a yaml key (key index 0)', () => {
    expect(detectFormat(': just text')).toBe('plain')
  })

  it('does not treat a non-word key as yaml', () => {
    expect(detectFormat('foo-bar: x')).toBe('plain')
  })

  it('detects free prose as plain', () => {
    expect(detectFormat('just some regular text')).toBe('plain')
  })
})

// ===========================================================================
// formatContent - plain
// ===========================================================================

describe('formatContent - plain', () => {
  it('leaves plain content unchanged', () => {
    expect(formatContent('just text', 'plain')).toBe('just text')
  })
})

// ===========================================================================
// formatContent - json
// ===========================================================================

describe('formatContent - json', () => {
  it('pretty-prints valid JSON with two-space indentation', () => {
    expect(formatContent('{"key":"value","nested":{"a":1}}', 'json')).toBe(
      '{\n  "key": "value",\n  "nested": {\n    "a": 1\n  }\n}',
    )
  })

  it('converts YAML to JSON when JSON.parse fails but the YAML loader succeeds', () => {
    expect(formatContent('name: test', 'json')).toBe('{\n  "name": "test"\n}')
  })

  it('returns the content unchanged when neither JSON nor YAML parses', () => {
    expect(formatContent('{not valid json', 'json')).toBe('{not valid json')
  })
})

// ===========================================================================
// formatContent - xml
// ===========================================================================

describe('formatContent - xml', () => {
  it('pretty-prints valid XML with two-space indentation', () => {
    expect(formatContent('<root><child>text</child></root>', 'xml')).toBe(
      '<root>\n  <child>text</child>\n</root>',
    )
  })

  it('keeps text-only elements inline (preserves XPath text nodes)', () => {
    expect(
      formatContent('<root><item id="1">Alpha</item><item id="2">Beta</item></root>', 'xml'),
    ).toBe('<root>\n  <item id="1">Alpha</item>\n  <item id="2">Beta</item>\n</root>')
  })

  it('returns the content unchanged for non-XML input', () => {
    expect(formatContent('not xml at all', 'xml')).toBe('not xml at all')
  })
})

// ===========================================================================
// formatContent - yaml
// ===========================================================================

describe('formatContent - yaml', () => {
  it('converts JSON to YAML', () => {
    expect(formatContent('{"name":"test"}', 'yaml')).toBe('name: test')
  })

  it('formats consistently-indented YAML on the first parse attempt', () => {
    expect(formatContent('  name: test\n  value: 123', 'yaml')).toBe(
      'name: test\nvalue: 123',
    )
  })

  it('dedents inconsistently-indented YAML on the fallback attempt', () => {
    expect(formatContent('  name: test\n    value: 123', 'yaml')).toBe(
      'name: test\nvalue: 123',
    )
  })

  it('returns the content unchanged when the YAML is completely unparsable', () => {
    expect(formatContent('!!!invalid yaml @#$', 'yaml')).toBe('!!!invalid yaml @#$')
  })
})

// ===========================================================================
// formatContent - numbers keep every digit as written (REQ-3.1.3.14)
// ===========================================================================

describe('formatContent - numbers kept as written', () => {
  it('never rounds a long number or drops a trailing zero in JSON', () => {
    expect(formatContent('{"id": 12345678901234567890, "rate": 1.50, "n": [1e400, -0]}', 'json')).toBe(
      '{\n  "id": 12345678901234567890,\n  "rate": 1.50,\n  "n": [\n    1e400,\n    -0\n  ]\n}',
    )
  })

  it('never rounds a long number or drops a trailing zero in YAML', () => {
    expect(formatContent('id: 12345678901234567890\nrate: 1.50\nmask: 0x1F\nlimit: .inf', 'yaml')).toBe(
      'id: 12345678901234567890\nrate: 1.50\nmask: 0x1F\nlimit: .inf',
    )
  })

  it('keeps a number written as a map key as its text, quoted', () => {
    expect(formatContent('1: one\nname: x', 'yaml')).toBe("'1': one\nname: x")
  })

  it('keeps a long number when JSON text is written out as YAML', () => {
    expect(formatContent('{"id": 12345678901234567890, "small": 0.0000001}', 'yaml')).toBe(
      'id: 12345678901234567890\nsmall: 0.0000001',
    )
  })

  it('keeps a long number when YAML text is written out as JSON, and writes YAML-only numbers as their value', () => {
    expect(
      formatContent('id: 12345678901234567890\nmask: 0x1F\nlimit: .inf\nlist: [1.50]\nwhen: 2026-10-24\nnone: ~', 'json'),
    ).toBe(
      '{\n  "id": 12345678901234567890,\n  "mask": 31,\n  "limit": null,\n  "list": [\n    1.50\n  ],\n  "when": "2026-10-24T00:00:00.000Z",\n  "none": null\n}',
    )
  })
})

// ===========================================================================
// validateFormatSyntax: blocking literal validity for a locked DATA
// format. Returns null when the text is well-formed for the format (or the
// format is non-blocking: plain / yaml / empty), else a human message. JSON
// reuses describeJsonError (json-data-editor); XML reuses the DOMParser
// parsererror path mirrored from xmlParseLinter (format-editor).
//
// REQ-3.6.2.2 (JSON), REQ-3.6.2.4 (XML well-formedness)
// ===========================================================================

describe('validateFormatSyntax - json', () => {
  it('returns null for valid JSON', () => {
    expect(validateFormatSyntax('{"a": 1}', 'json')).toBeNull()
  })

  it('returns null for a valid JSON array', () => {
    expect(validateFormatSyntax('[1, 2, 3]', 'json')).toBeNull()
  })

  it('returns a line-prefixed message for invalid JSON', () => {
    const message = validateFormatSyntax('{bad', 'json')
    expect(message).not.toBeNull()
    // describeJsonError prefixes the 1-based line when the position is known.
    expect(message).toMatch(/^Line 1:/)
  })

  it('returns null for empty content (nothing to validate)', () => {
    expect(validateFormatSyntax('', 'json')).toBeNull()
  })

  it('returns null for whitespace-only content', () => {
    expect(validateFormatSyntax('   \n  ', 'json')).toBeNull()
  })
})

describe('validateFormatSyntax - xml', () => {
  it('returns null for well-formed XML', () => {
    expect(validateFormatSyntax('<root><child>text</child></root>', 'xml')).toBeNull()
  })

  it('returns a message for malformed XML', () => {
    const message = validateFormatSyntax('<root><unclosed>', 'xml')
    expect(message).not.toBeNull()
    expect(typeof message).toBe('string')
    expect(message!.length).toBeGreaterThan(0)
  })

  it('returns null for empty content', () => {
    expect(validateFormatSyntax('', 'xml')).toBeNull()
  })

  it('returns null for whitespace-only content', () => {
    expect(validateFormatSyntax('   \n  ', 'xml')).toBeNull()
  })
})

describe('validateFormatSyntax - non-blocking formats', () => {
  it('returns null for plain text regardless of content', () => {
    expect(validateFormatSyntax('{not even close to valid', 'plain')).toBeNull()
  })

  it('returns null for yaml (advisory only, never blocking)', () => {
    expect(validateFormatSyntax('!!!invalid yaml @#$', 'yaml')).toBeNull()
  })
})

// ===========================================================================
// python (PYRUN-13): the Python script body's format is locked, never
// detected, never pretty-printed, and never blocks Save.
// ===========================================================================

const PYTHON_SAMPLES: [string, string][] = [
  ['a function definition', 'def main():\n    print("hi")\n'],
  ['imports and assignments', 'import os\n\ncount = 0\ncount += 1\n'],
  ['a class with a docstring', 'class Report:\n    """One line."""\n'],
  ['a comment-only script', '# nothing to see here\n'],
  ['an annotated assignment', 'limit: int = 3\n'],
  ['a dict literal', 'data = {\n    "a": 1,\n}\n'],
  ['an f-string with braces', 'name = "wave"\nprint(f"hello {name}")\n'],
]

describe('detectFormat - python', () => {
  it.each(PYTHON_SAMPLES)('never returns python for %s', (_label, source) => {
    expect(detectFormat(source)).not.toBe('python')
  })

  it('detects a Python function definition as plain', () => {
    expect(detectFormat('def main():\n    print("hi")\n')).toBe('plain')
  })

  it('detects a Python annotated assignment as yaml, never python', () => {
    expect(detectFormat('limit: int = 3\n')).toBe('yaml')
  })

  it('never returns python for an empty script', () => {
    expect(detectFormat('')).toBe('plain')
  })
})

describe('formatContent - python', () => {
  it('leaves a Python script exactly as typed (no pretty-print)', () => {
    const source = 'def main():\n      print("hi")\n\n\nmain()\n'
    expect(formatContent(source, 'python')).toBe(source)
  })

  it('leaves a script that also parses as JSON unchanged', () => {
    expect(formatContent('{"key":"value","nested":{"a":1}}', 'python')).toBe(
      '{"key":"value","nested":{"a":1}}',
    )
  })

  it('leaves a script that also looks like YAML unchanged', () => {
    expect(formatContent('  limit: int = 3\n', 'python')).toBe('  limit: int = 3\n')
  })

  it('leaves an empty script unchanged', () => {
    expect(formatContent('', 'python')).toBe('')
  })
})

describe('validateFormatSyntax - python', () => {
  it('returns no issue for a valid Python script', () => {
    expect(validateFormatSyntax('x = 1\n', 'python')).toBeNull()
  })

  it('returns no issue for a Python script with a syntax error (it never blocks Save)', () => {
    expect(validateFormatSyntax('def main(:\n    pass\n', 'python')).toBeNull()
  })

  it('returns no issue for empty content', () => {
    expect(validateFormatSyntax('', 'python')).toBeNull()
  })

  it('returns no issue for whitespace-only content', () => {
    expect(validateFormatSyntax('   \n  ', 'python')).toBeNull()
  })
})

// ===========================================================================
// sql (SQL-10): never detected, never pretty-printed, never blocking. REQ-3.4.1.6
// ===========================================================================

const SQL_SAMPLES: [string, string][] = [
  ['a query with a placeholder', 'SELECT id, total\nFROM orders\nWHERE customer_id = :customer;\n'],
  ['a keyword-only line', 'SELECT 1\n'],
  ['a comment and a statement', '-- nightly check\nDELETE FROM sessions WHERE expired;\n'],
  ['a SET statement', 'SET search_path TO reporting;\n'],
  ['an insert with a JSON literal', "INSERT INTO events (data) VALUES ('{\"a\": 1}');\n"],
  ['a SQL Server batch', 'USE shop\nGO\nSELECT TOP 5 * FROM orders\nGO\n'],
  ['an Oracle block', 'BEGIN\n  refresh_totals;\nEND;\n/\n'],
]

describe('detectFormat - sql', () => {
  it.each(SQL_SAMPLES)('never returns sql for %s', (_label, source) => {
    expect(detectFormat(source)).not.toBe('sql')
  })
})

describe('formatContent - sql', () => {
  it('leaves a SQL script exactly as typed (no pretty-print)', () => {
    const source = 'select id,\n      total   from orders\n\n\nwhere id = :id;\n'
    expect(formatContent(source, 'sql')).toBe(source)
  })

  it('leaves a script that also parses as JSON unchanged', () => {
    expect(formatContent('{"key":"value","nested":{"a":1}}', 'sql')).toBe(
      '{"key":"value","nested":{"a":1}}',
    )
  })

  it('leaves a script that also looks like YAML unchanged', () => {
    expect(formatContent('  status: open\n', 'sql')).toBe('  status: open\n')
  })

  it('leaves an empty script unchanged', () => {
    expect(formatContent('', 'sql')).toBe('')
  })
})

describe('validateFormatSyntax - sql', () => {
  it('returns no issue for a valid SQL script', () => {
    expect(validateFormatSyntax('SELECT 1;', 'sql')).toBeNull()
  })

  it('returns no issue for broken SQL (it never blocks Save)', () => {
    expect(validateFormatSyntax('INVALID_KEYWORD id FROM WHERE (;', 'sql')).toBeNull()
  })

  it('returns no issue for a script that is malformed JSON', () => {
    expect(validateFormatSyntax('{bad', 'sql')).toBeNull()
  })

  it('returns no issue for empty content', () => {
    expect(validateFormatSyntax('', 'sql')).toBeNull()
  })

  it('returns no issue for whitespace-only content', () => {
    expect(validateFormatSyntax('   \n  ', 'sql')).toBeNull()
  })
})
