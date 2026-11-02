/**
 * Tests for the promoted format core. The pure language + advisory-linter factory and the
 * YAML / XML parse linters move verbatim out of the Text Editor Modal into the
 * shared lib/codemirror home so the string watcher can reuse them.
 *
 * Contract under test:
 *   - createFormatExtensions(format) configures the matching CodeMirror language
 *     for json/yaml/xml and configures NOTHING for plain (base only)
 *   - yamlParseLinter / xmlParseLinter are advisory: empty input is clean, a
 *     parse failure yields one error diagnostic, the position is clamped to the
 *     document, and an empty reason falls back to a generic message
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.4.1.6: SQL database operations (SQL-10)
 * REQ-3.3.2.6: OpenSearch field-based filtering and queries (OS-12)
 */

import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { highlightingFor, language } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import jsYaml, { YAMLException } from 'js-yaml'

import {
  createFormatExtensions,
  sqlDialectFor,
  yamlParseLinter,
  xmlParseLinter,
  type ResolvedFormat,
  type SqlDatabaseType,
  type TextFormat,
} from '@/lib/codemirror/format-editor'

// A minimal CodeMirror view stand-in: the linters only read the document text
// (the line/column branch is jsdom-unreachable, COV-JSDOM-014).
function mockView(content: string) {
  const lines = content.split('\n')
  return {
    state: {
      doc: {
        toString: () => content,
        lines: lines.length,
        line: (n: number) => {
          let from = 0
          for (let i = 0; i < n - 1; i++) from += lines[i].length + 1
          return { from, length: (lines[n - 1] ?? '').length }
        },
      },
    },
  } as never
}

function languageOf(format: ResolvedFormat) {
  const state = EditorState.create({ doc: 'x', extensions: createFormatExtensions(format) })
  return state.facet(language)
}

// ===========================================================================
// createFormatExtensions
// ===========================================================================

describe('createFormatExtensions', () => {
  it('configures the JSON language for the json format', () => {
    expect(languageOf('json')).toBeTruthy()
    expect(createFormatExtensions('json').length).toBeGreaterThan(0)
  })

  it('configures the YAML language for the yaml format', () => {
    expect(languageOf('yaml')).toBeTruthy()
    expect(createFormatExtensions('yaml').length).toBeGreaterThan(0)
  })

  it('configures the XML language for the xml format', () => {
    expect(languageOf('xml')).toBeTruthy()
    expect(createFormatExtensions('xml').length).toBeGreaterThan(0)
  })

  it('returns the base only for plain (no language, no linter)', () => {
    expect(createFormatExtensions('plain')).toHaveLength(0)
    expect(languageOf('plain')).toBeFalsy()
  })

  it('configures the language with the dark highlight style when isDark is set', () => {
    const dark = createFormatExtensions('json', true)
    expect(dark.length).toBeGreaterThan(0)
    const state = EditorState.create({ doc: '{"a":1}', extensions: dark })
    expect(state.facet(language)).toBeTruthy()
  })
})

// ===========================================================================
// createFormatExtensions - python (PYRUN-13)
//
// The Python script body is a locked format. The language colors the script;
// json / yaml / xml each also get an advisory CodeMirror linter, python does not
// (its syntax check is host-composed from tree-sitter).
// ===========================================================================

describe('createFormatExtensions - python', () => {
  it('configures the Python language for the python format', () => {
    expect(languageOf('python')).toBeTruthy()
    expect(languageOf('python')?.name).toBe('python')
  })

  it('returns the language and the highlight style only (no advisory linter)', () => {
    expect(createFormatExtensions('python')).toHaveLength(2)
    // The json branch keeps its linter, so the two shapes differ by exactly it.
    expect(createFormatExtensions('json')).toHaveLength(3)
  })

  it('configures the Python language with the dark highlight style when isDark is set', () => {
    const dark = createFormatExtensions('python', true)
    expect(dark).toHaveLength(2)
    const state = EditorState.create({ doc: 'x = 1\n', extensions: dark })
    expect(state.facet(language)?.name).toBe('python')
  })
})

// ===========================================================================
// createFormatExtensions - sql (SQL-10): the highlight style only, no language, no linter
// ===========================================================================

// A computed specifier keeps this file loadable where the package is not installed.
const LANG_SQL = '@codemirror/lang-sql'
async function sqlDialects(): Promise<typeof import('@codemirror/lang-sql')> {
  return import(/* @vite-ignore */ LANG_SQL)
}

const SQL_TOKENS = [tags.keyword, tags.string, tags.number, tags.lineComment]

describe('sqlDialectFor', () => {
  it.each([
    ['postgresql', 'PostgreSQL'],
    ['mysql', 'MySQL'],
    ['oracle', 'PLSQL'],
    ['mssql', 'MSSQL'],
    ['sqlite', 'SQLite'],
  ] as const)('gives %s the %s dialect', async (databaseType: SqlDatabaseType, dialect) => {
    const dialects = await sqlDialects()

    expect(sqlDialectFor(databaseType)).toBe(dialects[dialect])
  })

  it('gives each Database type its own dialect', () => {
    const types: SqlDatabaseType[] = ['postgresql', 'mysql', 'oracle', 'mssql', 'sqlite']

    expect(new Set(types.map((type) => sqlDialectFor(type))).size).toBe(5)
  })
})

describe('createFormatExtensions - sql', () => {
  it('returns the highlight style only (no language, no advisory linter)', () => {
    expect(createFormatExtensions('sql')).toHaveLength(1)
    expect(languageOf('sql')).toBeFalsy()
  })

  it('returns the dark highlight style only when isDark is set', () => {
    const dark = createFormatExtensions('sql', true)

    expect(dark).toHaveLength(1)
    const state = EditorState.create({ doc: 'SELECT 1;', extensions: dark })
    expect(state.facet(language)).toBeFalsy()
  })

  it('uses a different highlight style on dark than on light', () => {
    const light = EditorState.create({ doc: '', extensions: createFormatExtensions('sql') })
    const dark = EditorState.create({ doc: '', extensions: createFormatExtensions('sql', true) })

    expect(highlightingFor(dark, [tags.keyword])).not.toBe(highlightingFor(light, [tags.keyword]))
  })

  it.each([false, true])('colors keywords, strings, numbers and comments (dark: %s)', (isDark) => {
    const state = EditorState.create({ doc: '', extensions: createFormatExtensions('sql', isDark) })

    for (const tag of SQL_TOKENS) {
      expect(highlightingFor(state, [tag])).toBeTruthy()
    }
  })
})

// ===========================================================================
// createFormatExtensions - OpenSearch query formats (OS-12): left to the host, as sql
// ===========================================================================

// Locked formats of the Query editor: a picked format and a resolved one alike.
const OPENSEARCH_FORMATS = ['dql', 'query-dsl', 'aggregation-json'] as const satisfies readonly (TextFormat &
  ResolvedFormat)[]

describe('createFormatExtensions - OpenSearch query formats', () => {
  it.each(OPENSEARCH_FORMATS)('returns the highlight style only for %s (no language, no advisory linter)', (format) => {
    expect(createFormatExtensions(format)).toHaveLength(1)
    expect(languageOf(format)).toBeFalsy()
  })

  it.each(OPENSEARCH_FORMATS)('returns the same shape as sql for %s', (format) => {
    expect(createFormatExtensions(format)).toHaveLength(createFormatExtensions('sql').length)
    expect(createFormatExtensions(format, true)).toHaveLength(createFormatExtensions('sql', true).length)
  })

  it.each(OPENSEARCH_FORMATS)('returns the dark highlight style only for %s when isDark is set', (format) => {
    const dark = createFormatExtensions(format, true)

    expect(dark).toHaveLength(1)
    expect(EditorState.create({ doc: '', extensions: dark }).facet(language)).toBeFalsy()
  })

  it.each(OPENSEARCH_FORMATS)('uses a different highlight style on dark than on light for %s', (format) => {
    const light = EditorState.create({ doc: '', extensions: createFormatExtensions(format) })
    const dark = EditorState.create({ doc: '', extensions: createFormatExtensions(format, true) })

    expect(highlightingFor(dark, [tags.keyword])).not.toBe(highlightingFor(light, [tags.keyword]))
  })

  it.each(OPENSEARCH_FORMATS.flatMap((format) => [[format, false] as const, [format, true] as const]))(
    'colors keywords, strings and numbers for %s (dark: %s)',
    (format, isDark) => {
      const state = EditorState.create({ doc: '', extensions: createFormatExtensions(format, isDark) })

      for (const tag of [tags.keyword, tags.string, tags.number]) {
        expect(highlightingFor(state, [tag])).toBeTruthy()
      }
    },
  )
})

// ===========================================================================
// yamlParseLinter
// ===========================================================================

describe('yamlParseLinter', () => {
  it('returns no diagnostics for valid YAML', () => {
    expect(yamlParseLinter()(mockView('name: test'))).toEqual([])
  })

  it('returns one error diagnostic for invalid YAML', () => {
    const diagnostics = yamlParseLinter()(mockView('!!!invalid yaml @#$'))
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('error')
    expect(typeof diagnostics[0].message).toBe('string')
    expect(diagnostics[0].message.length).toBeGreaterThan(0)
  })

  it('returns no diagnostics for empty content', () => {
    expect(yamlParseLinter()(mockView(''))).toEqual([])
  })

  it('returns no diagnostics for whitespace-only content', () => {
    expect(yamlParseLinter()(mockView('   \n  '))).toEqual([])
  })

  it('clamps the error position to the document length', () => {
    const original = jsYaml.load
    jsYaml.load = () => {
      throw new YAMLException('boom', { position: 9999 } as never)
    }
    try {
      const diagnostics = yamlParseLinter()(mockView('short'))
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0].from).toBeLessThanOrEqual('short'.length)
    } finally {
      jsYaml.load = original
    }
  })

  it('falls back to a generic message when the YAMLException reason is empty', () => {
    const original = jsYaml.load
    jsYaml.load = () => {
      throw new YAMLException('', { position: 2 } as never)
    }
    try {
      const diagnostics = yamlParseLinter()(mockView('bad yaml'))
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0].message).toBe('YAML syntax error')
    } finally {
      jsYaml.load = original
    }
  })

  it('returns no diagnostics when a non-YAMLException is thrown', () => {
    const original = jsYaml.load
    jsYaml.load = () => {
      throw new TypeError('unexpected')
    }
    try {
      expect(yamlParseLinter()(mockView('some content'))).toEqual([])
    } finally {
      jsYaml.load = original
    }
  })
})

// ===========================================================================
// xmlParseLinter
// ===========================================================================

describe('xmlParseLinter', () => {
  it('returns no diagnostics for valid XML', () => {
    expect(
      xmlParseLinter()(mockView('<root><child>text</child></root>')),
    ).toEqual([])
  })

  it('returns one error diagnostic for invalid XML', () => {
    const diagnostics = xmlParseLinter()(mockView('<root><unclosed>'))
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('error')
  })

  it('returns no diagnostics for empty content', () => {
    expect(xmlParseLinter()(mockView(''))).toEqual([])
  })

  it('returns no diagnostics for whitespace-only content', () => {
    expect(xmlParseLinter()(mockView('   \n  '))).toEqual([])
  })
})
