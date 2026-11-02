/**
 * useScriptSyntaxIssues: the debounced live checks behind a Python, SQL or OpenSearch query body.
 *
 * REQ-3.4.1.2, REQ-3.4.1.6, REQ-3.4.2.2, REQ-3.3.2.6; PYRUN-13, SQL-10, OS-12
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

interface SeededError {
  row: number
  column: number
  endColumn: number
  text: string
  /** A missing token reports itself by name rather than as a generic ERROR node. */
  missing?: string
}

const mocks = vi.hoisted(() => {
  const seeded = new Map<string, SeededError[]>()

  function buildTree(source: string) {
    const lines = source.split('\n')
    const offsetOf = (row: number, column: number): number => {
      let offset = 0
      for (let index = 0; index < row; index += 1) {
        offset += (lines[index] ?? '').length + 1
      }
      return offset + column
    }
    const errors = seeded.get(source) ?? []
    const root: Record<string, unknown> = {
      type: 'module',
      isNamed: true,
      isMissing: false,
      isError: false,
      hasError: errors.length > 0,
      text: source,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: lines.length - 1, column: (lines[lines.length - 1] ?? '').length },
      startIndex: 0,
      endIndex: source.length,
      parent: null,
      children: [],
    }
    const children = errors.map((error) => ({
      type: error.missing ?? 'ERROR',
      isNamed: true,
      isMissing: Boolean(error.missing),
      isError: !error.missing,
      hasError: true,
      text: error.text,
      startPosition: { row: error.row, column: error.column },
      endPosition: { row: error.row, column: error.endColumn },
      startIndex: offsetOf(error.row, error.column),
      endIndex: offsetOf(error.row, error.endColumn),
      parent: root,
      children: [] as unknown[],
      descendantsOfType: () => [] as unknown[],
    }))
    root.children = children
    root.descendantsOfType = (types: string | string[]): unknown[] => {
      const wanted = Array.isArray(types) ? types : [types]
      return children.filter((child) => wanted.includes(child.type))
    }
    return { rootNode: root }
  }

  const parse = vi.fn((source: string) => buildTree(source))
  const parser = { parse }

  return {
    seeded,
    parse,
    parser,
    initializeTreeSitter: vi.fn(() => Promise.resolve(parser)),
    getParser: vi.fn(() => parser),
    isInitialized: vi.fn(() => true),
    resetParser: vi.fn(),
    setNodeSyntaxIssues: vi.fn(),
    checkPythonScript: vi.fn((_root: unknown, _inputs: unknown): unknown[] => []),
    checkSqlScript: vi.fn((_doc: string, _input: unknown): unknown[] => []),
    checkSql: vi.fn(
      (_body: unknown, _signal?: AbortSignal): Promise<{ issues: unknown[] }> =>
        Promise.resolve({ issues: [] }),
    ),
    checkOpenSearch: vi.fn(
      (_body: unknown, _signal?: AbortSignal): Promise<{ issues: unknown[] }> =>
        Promise.resolve({ issues: [] }),
    ),
  }
})

vi.mock('@/features/workbench/lib/python-script-validation/check-script', () => ({
  checkPythonScript: (root: unknown, inputs: unknown) => mocks.checkPythonScript(root, inputs),
}))

vi.mock('@/features/workbench/lib/sql-script-validation/check-sql', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/features/workbench/lib/sql-script-validation/check-sql')
  >()),
  checkSqlScript: (doc: string, input: unknown) => mocks.checkSqlScript(doc, input),
}))

vi.mock('@/features/workbench/api/sql-tools', () => ({
  checkSql: (body: unknown, signal?: AbortSignal) => mocks.checkSql(body, signal),
  startCatalog: vi.fn(),
  getCatalog: vi.fn(),
  cancelCatalog: vi.fn(),
}))

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: (body: unknown, signal?: AbortSignal) => mocks.checkOpenSearch(body, signal),
  suggestOpenSearch: vi.fn(),
  startFields: vi.fn(),
  getFields: vi.fn(),
  cancelFields: vi.fn(),
}))

vi.mock('@/features/workbench/lib/tree-sitter-init', () => ({
  TreeSitterError: class TreeSitterError extends Error {},
  initializeTreeSitter: () => mocks.initializeTreeSitter(),
  getParser: () => mocks.getParser(),
  isInitialized: () => mocks.isInitialized(),
  resetParser: () => mocks.resetParser(),
}))

vi.mock('@/features/workbench/stores/workflow-store', () => {
  const state = {
    nodeSyntaxIssues: new Map<string, Array<{ line: number; message: string }>>(),
    setNodeSyntaxIssues: mocks.setNodeSyntaxIssues,
  }
  const useWorkflowStore = Object.assign(
    (selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state),
    {
      getState: () => state,
      setState: () => undefined,
      subscribe: () => () => undefined,
    },
  )
  return { useWorkflowStore }
})

import {
  useScriptSyntaxIssues,
  type ScriptSyntaxOptions,
} from '@/features/workbench/hooks/use-script-syntax-issues'
import type { ScriptInputs } from '@/features/workbench/lib/python-script-validation/check-script'
import type {
  ScriptMode,
  ScriptWarning,
} from '@/features/workbench/lib/python-script-validation/script-issues'
import type { SqlCheckIssue } from '@/features/workbench/api/sql-tools'
import type { OpenSearchCheckIssue } from '@/features/workbench/api/opensearch-tools'
import type { AvailableVariable } from '@/features/workbench/lib/codemirror/type-inference'
import { SAMPLE_SCRIPT, SAMPLE_TABLES } from '../sql-fixtures'
import { SAMPLE_AGGREGATION_JSON, SAMPLE_DQL, SAMPLE_QUERY_DSL } from '../opensearch-fixtures'

// ============================================
// Test Helpers
// ============================================

const NODE_ID = 'python-node-1'
const DEBOUNCE_MS = 150

const CLEAN_SCRIPT = 'a = 1\nb = 2\nc = 3\nd = 4'
const ONE_ERROR_SCRIPT = 'a = 1\nb = (\nc = 3\nd = 4'
const TWO_ERROR_SCRIPT = 'a = 1\nb = (\nc = 3\nd = )'

type SyntaxIssue = { line: number; message: string }

/** One entry per syntax error, in line order, each with a message the strip can show. */
function expectIssues(issues: readonly SyntaxIssue[], lines: number[]): void {
  expect(issues.map((issue) => issue.line)).toEqual(lines)
  for (const issue of issues) {
    expect(typeof issue.message).toBe('string')
    expect(issue.message.trim()).not.toBe('')
  }
}

function lastStoreWrite(): [string, SyntaxIssue[]] {
  const calls = mocks.setNodeSyntaxIssues.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1] as [string, SyntaxIssue[]]
}

function seedOneError(): void {
  mocks.seeded.set(ONE_ERROR_SCRIPT, [{ row: 1, column: 0, endColumn: 5, text: 'b = (' }])
}

function seedTwoErrors(): void {
  mocks.seeded.set(TWO_ERROR_SCRIPT, [
    { row: 1, column: 0, endColumn: 5, text: 'b = (' },
    { row: 3, column: 0, endColumn: 5, text: 'd = )' },
  ])
}

function renderIssues(script: string, nodeId = NODE_ID) {
  return renderHook(
    ({ value }: { value: string }) => useScriptSyntaxIssues(nodeId, value, 'python'),
    { initialProps: { value: script } },
  )
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function deferred<T>() {
  let settle: (value: T) => void = () => undefined
  let fail: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, resolve: (value: T) => settle(value), reject: (reason: unknown) => fail(reason) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.seeded.clear()
  mocks.isInitialized.mockReturnValue(true)
  mocks.getParser.mockReturnValue(mocks.parser)
  mocks.initializeTreeSitter.mockImplementation(() => Promise.resolve(mocks.parser))
  mocks.checkPythonScript.mockImplementation(() => [])
  mocks.checkSqlScript.mockImplementation(() => [])
  mocks.checkSql.mockImplementation(() => Promise.resolve({ issues: [] }))
  mocks.checkOpenSearch.mockImplementation(() => Promise.resolve({ issues: [] }))
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================
// Python issues
// ============================================

describe('useScriptSyntaxIssues in Python mode', () => {
  it('reports one issue for a script with one syntax error', async () => {
    seedOneError()
    const { result } = renderIssues(ONE_ERROR_SCRIPT)

    await advance(DEBOUNCE_MS)

    expectIssues(result.current, [2])
  })

  it('reports one issue per syntax error', async () => {
    seedTwoErrors()
    const { result } = renderIssues(TWO_ERROR_SCRIPT)

    await advance(DEBOUNCE_MS)

    expectIssues(result.current, [2, 4])
  })

  it('reports nothing for a script that parses', async () => {
    const { result } = renderIssues(CLEAN_SCRIPT)

    await advance(DEBOUNCE_MS)

    expect(result.current).toEqual([])
  })

  it('reports nothing before the first parse has run', () => {
    seedOneError()
    const { result } = renderIssues(ONE_ERROR_SCRIPT)

    expect(result.current).toEqual([])
  })

  it('parses the script it was given', async () => {
    seedOneError()
    renderIssues(ONE_ERROR_SCRIPT)

    await advance(DEBOUNCE_MS)

    expect(mocks.parse).toHaveBeenCalledTimes(1)
    expect(mocks.parse.mock.calls[0][0]).toBe(ONE_ERROR_SCRIPT)
  })

  it('never runs the SQL checks', async () => {
    renderIssues(CLEAN_SCRIPT)

    await advance(1000)

    expect(mocks.checkSqlScript).not.toHaveBeenCalled()
    expect(mocks.checkSql).not.toHaveBeenCalled()
  })
})

// ============================================
// Python debounce
// ============================================

describe('useScriptSyntaxIssues Python debounce', () => {
  it('does no work before 150 ms have passed', async () => {
    seedOneError()
    const { result } = renderIssues(ONE_ERROR_SCRIPT)

    await advance(DEBOUNCE_MS - 1)

    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()
    expect(result.current).toEqual([])
  })

  it('parses once 150 ms have passed', async () => {
    seedOneError()
    const { result } = renderIssues(ONE_ERROR_SCRIPT)

    await advance(DEBOUNCE_MS - 1)
    await advance(1)

    expect(mocks.parse).toHaveBeenCalledTimes(1)
    expectIssues(result.current, [2])
  })

  it('restarts the wait when the script changes again', async () => {
    seedOneError()
    seedTwoErrors()
    const { result, rerender } = renderIssues(ONE_ERROR_SCRIPT)

    await advance(100)
    rerender({ value: TWO_ERROR_SCRIPT })
    await advance(100)

    expect(mocks.parse).not.toHaveBeenCalled()

    await advance(50)

    expect(mocks.parse).toHaveBeenCalledTimes(1)
    expect(mocks.parse.mock.calls[0][0]).toBe(TWO_ERROR_SCRIPT)
    expectIssues(result.current, [2, 4])
  })
})

// ============================================
// Python store writes
// ============================================

describe('useScriptSyntaxIssues Python store writes', () => {
  it('writes the same list through setNodeSyntaxIssues', async () => {
    seedOneError()
    const { result } = renderIssues(ONE_ERROR_SCRIPT)

    await advance(DEBOUNCE_MS)

    const [nodeId, issues] = lastStoreWrite()
    expect(nodeId).toBe(NODE_ID)
    expectIssues(issues, [2])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenLastCalledWith(NODE_ID, result.current)
  })

  it('writes under the node id it was given', async () => {
    seedTwoErrors()
    renderIssues(TWO_ERROR_SCRIPT, 'python-node-2')

    await advance(DEBOUNCE_MS)

    const [nodeId, issues] = lastStoreWrite()
    expect(nodeId).toBe('python-node-2')
    expectIssues(issues, [2, 4])
  })

  it('clears the store field when the script parses again', async () => {
    seedOneError()
    const { result, rerender } = renderIssues(ONE_ERROR_SCRIPT)

    await advance(DEBOUNCE_MS)

    const [nodeId, issues] = lastStoreWrite()
    expect(nodeId).toBe(NODE_ID)
    expectIssues(issues, [2])

    rerender({ value: CLEAN_SCRIPT })
    await advance(DEBOUNCE_MS)

    expect(mocks.setNodeSyntaxIssues).toHaveBeenLastCalledWith(NODE_ID, [])
    expect(result.current).toEqual([])
  })
})

// ============================================
// Python async parse
// ============================================

describe('useScriptSyntaxIssues Python in-flight parse', () => {
  it('lets a later edit supersede a parse still in flight', async () => {
    seedOneError()
    seedTwoErrors()
    const gate = deferred<typeof mocks.parser>()
    mocks.initializeTreeSitter.mockReturnValueOnce(gate.promise)

    const { result, rerender } = renderIssues(ONE_ERROR_SCRIPT)

    await advance(DEBOUNCE_MS)

    rerender({ value: TWO_ERROR_SCRIPT })
    await advance(DEBOUNCE_MS)

    gate.resolve(mocks.parser)
    await advance(0)

    expectIssues(result.current, [2, 4])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenLastCalledWith(NODE_ID, result.current)
  })
})

// ============================================
// Python message text and parser failure
// ============================================

const MISSING_SCRIPT = 'a = 1\nb = (2\nc = 3'

describe('useScriptSyntaxIssues Python message text', () => {
  it('names the token a missing-token error reports', async () => {
    mocks.seeded.set(MISSING_SCRIPT, [
      { row: 1, column: 6, endColumn: 6, text: '', missing: ')' },
    ])

    const { result } = renderIssues(MISSING_SCRIPT)
    await advance(DEBOUNCE_MS)

    expect(result.current).toEqual([{ line: 2, message: "Missing ')'" }])
  })
})

describe('useScriptSyntaxIssues Python parser failure', () => {
  it('reports nothing when the parser cannot load', async () => {
    seedOneError()
    mocks.initializeTreeSitter.mockRejectedValueOnce(new Error('wasm unavailable'))

    const { result } = renderIssues(ONE_ERROR_SCRIPT)
    await advance(DEBOUNCE_MS)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenLastCalledWith(NODE_ID, [])
  })
})

// ============================================
// Python check warnings
// ============================================

const INPUTS: ScriptInputs = { names: ['threshold'], types: { threshold: 'float' } }

const PUTS_WARNING = {
  line: 2,
  message: "Function 'puts' is not recognized",
  severity: 'warning' as const,
  from: 6,
  to: 10,
  type: 'invalid_function' as const,
}

describe('useScriptSyntaxIssues Python check warnings', () => {
  it('checks a script that parses with the Input Variables it was given', async () => {
    renderHook(() => useScriptSyntaxIssues(NODE_ID, CLEAN_SCRIPT, 'python', { inputs: INPUTS }))

    await advance(DEBOUNCE_MS)

    expect(mocks.checkPythonScript).toHaveBeenCalledTimes(1)
    const [root, inputs] = mocks.checkPythonScript.mock.calls[0] as unknown as [{ text: string }, unknown]
    expect(root.text).toBe(CLEAN_SCRIPT)
    expect(inputs).toBe(INPUTS)
  })

  it('checks with no Input Variables when none are given', async () => {
    renderIssues(CLEAN_SCRIPT)

    await advance(DEBOUNCE_MS)

    expect(mocks.checkPythonScript.mock.calls[0]?.[1]).toEqual({ names: [], types: {} })
  })

  it('returns the warnings and writes them to the store', async () => {
    mocks.checkPythonScript.mockImplementation(() => [PUTS_WARNING])
    const { result } = renderIssues(CLEAN_SCRIPT)

    await advance(DEBOUNCE_MS)

    expect(result.current).toEqual([PUTS_WARNING])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenLastCalledWith(NODE_ID, [PUTS_WARNING])
  })

  it('never checks a script with a syntax error, and reports the syntax error alone', async () => {
    seedOneError()
    mocks.checkPythonScript.mockImplementation(() => [PUTS_WARNING])
    const { result } = renderIssues(ONE_ERROR_SCRIPT)

    await advance(DEBOUNCE_MS)

    expect(mocks.checkPythonScript).not.toHaveBeenCalled()
    expectIssues(result.current, [2])
    expect(result.current.some((issue: SyntaxIssue) => 'severity' in issue)).toBe(false)
  })

  it('checks again when the Input Variables change', async () => {
    const other: ScriptInputs = { names: ['limit'], types: {} }
    const { rerender } = renderHook(
      ({ inputs }: { inputs: ScriptInputs }) =>
        useScriptSyntaxIssues(NODE_ID, CLEAN_SCRIPT, 'python', { inputs }),
      { initialProps: { inputs: INPUTS } },
    )

    await advance(DEBOUNCE_MS)
    rerender({ inputs: other })
    await advance(DEBOUNCE_MS)

    expect(mocks.checkPythonScript).toHaveBeenCalledTimes(2)
    expect(mocks.checkPythonScript.mock.calls[1]?.[1]).toBe(other)
  })

  it('does not check again for a new options object holding the same Input Variables', async () => {
    const { rerender } = renderHook(
      ({ inputs }: { inputs: ScriptInputs }) =>
        useScriptSyntaxIssues(NODE_ID, CLEAN_SCRIPT, 'python', { inputs }),
      { initialProps: { inputs: INPUTS } },
    )

    await advance(DEBOUNCE_MS)
    rerender({ inputs: INPUTS })
    await advance(DEBOUNCE_MS)

    expect(mocks.checkPythonScript).toHaveBeenCalledTimes(1)
  })
})

// ============================================
// SQL mode
// ============================================

const SQL_NODE = 'sql-node-1'
const SQL_DEBOUNCE_MS = 300
const PARAMETER_NAMES: readonly string[] = ['customer', 'status', 'limit']
const NO_VARIABLES: readonly AvailableVariable[] = []

const SQL_OPTIONS: ScriptSyntaxOptions = {
  databaseType: 'postgresql',
  parameterNames: PARAMETER_NAMES,
  tables: null,
  variables: NO_VARIABLES,
  template: false,
}

const UNUSED_LIMIT: ScriptWarning = {
  line: 0,
  message: "Parameter 'limit' is defined but not used in the SQL",
  severity: 'warning',
  from: 0,
  to: 0,
}

const CUSTOMER_AT = SAMPLE_SCRIPT.indexOf(':customer')
const UNDEFINED_CUSTOMER: ScriptWarning = {
  line: 3,
  message: "Parameter 'customer' is used in the SQL but not defined",
  severity: 'warning',
  from: CUSTOMER_AT,
  to: CUSTOMER_AT + ':customer'.length,
}

const SERVER_ISSUE: SqlCheckIssue = {
  line: 2,
  col: 6,
  message: 'Invalid expression / Unexpected token',
}

const LINE_2_AT = SAMPLE_SCRIPT.indexOf('FROM orders')
const SERVER_WARNING: ScriptWarning = {
  line: 2,
  message: 'Invalid expression / Unexpected token',
  severity: 'warning',
  from: LINE_2_AT,
  to: LINE_2_AT + 'FROM orders'.length,
}

const EDITED_SCRIPT = `${SAMPLE_SCRIPT}\nLIMIT :limit`
const TEMPLATE_SCRIPT = 'SELECT * FROM {{ table_name }}\nWHERE id = :customer'

// ============================================
// No script mode
// ============================================

describe('useScriptSyntaxIssues with no script mode', () => {
  it('never loads the parser, asks the server or writes for a sheet that is not a script body', async () => {
    seedOneError()

    const { result } = renderHook(
      ({ value }: { value: string }) => useScriptSyntaxIssues(NODE_ID, value, null),
      { initialProps: { value: ONE_ERROR_SCRIPT } },
    )
    await advance(1000)

    expect(result.current).toEqual([])
    expect(mocks.initializeTreeSitter).not.toHaveBeenCalled()
    expect(mocks.checkPythonScript).not.toHaveBeenCalled()
    expect(mocks.checkSqlScript).not.toHaveBeenCalled()
    expect(mocks.checkSql).not.toHaveBeenCalled()
    expect(mocks.checkOpenSearch).not.toHaveBeenCalled()
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()
  })

  it('never runs the SQL checks with SQL options given', async () => {
    renderHook(() => useScriptSyntaxIssues(SQL_NODE, SAMPLE_SCRIPT, null, SQL_OPTIONS))
    await advance(1000)

    expect(mocks.checkSqlScript).not.toHaveBeenCalled()
    expect(mocks.checkSql).not.toHaveBeenCalled()
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()
  })
})

interface SqlProps {
  value: string
  mode: ScriptMode | null
  options: ScriptSyntaxOptions
}

function renderSql(value = SAMPLE_SCRIPT, options: ScriptSyntaxOptions = SQL_OPTIONS) {
  return renderHook(
    ({ value: doc, mode, options: opts }: SqlProps) =>
      useScriptSyntaxIssues(SQL_NODE, doc, mode, opts),
    { initialProps: { value, mode: 'sql', options } as SqlProps },
  )
}

function sqlInputOf(call: number): unknown {
  return mocks.checkSqlScript.mock.calls[call]?.[1]
}

describe('useScriptSyntaxIssues in SQL mode: debounce', () => {
  it('does no work before 300 ms have passed', async () => {
    mocks.checkSqlScript.mockImplementation(() => [UNUSED_LIMIT])
    const { result } = renderSql()

    await advance(SQL_DEBOUNCE_MS - 1)

    expect(mocks.checkSqlScript).not.toHaveBeenCalled()
    expect(mocks.checkSql).not.toHaveBeenCalled()
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()
    expect(result.current).toEqual([])
  })

  it('runs the local checks and the server check once at 300 ms', async () => {
    renderSql()

    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.checkSqlScript).toHaveBeenCalledTimes(1)
    expect(mocks.checkSqlScript).toHaveBeenCalledWith(SAMPLE_SCRIPT, {
      databaseType: 'postgresql',
      parameterNames: PARAMETER_NAMES,
      tables: null,
      variables: NO_VARIABLES,
      template: false,
    })
    expect(mocks.checkSql).toHaveBeenCalledTimes(1)
    expect(mocks.checkSql).toHaveBeenCalledWith(
      { database_type: 'postgresql', script: SAMPLE_SCRIPT },
      expect.any(AbortSignal),
    )
  })

  it('restarts the wait when the script changes again', async () => {
    const { rerender } = renderSql()

    await advance(200)
    rerender({ value: EDITED_SCRIPT, mode: 'sql', options: SQL_OPTIONS })
    await advance(200)

    expect(mocks.checkSqlScript).not.toHaveBeenCalled()
    expect(mocks.checkSql).not.toHaveBeenCalled()

    await advance(100)

    expect(mocks.checkSqlScript).toHaveBeenCalledTimes(1)
    expect(mocks.checkSqlScript.mock.calls[0]?.[0]).toBe(EDITED_SCRIPT)
    expect(mocks.checkSql).toHaveBeenCalledTimes(1)
    expect(mocks.checkSql.mock.calls[0]?.[0]).toEqual({
      database_type: 'postgresql',
      script: EDITED_SCRIPT,
    })
  })

  it('checks with the defaults when no options are given', async () => {
    renderHook(() => useScriptSyntaxIssues(SQL_NODE, SAMPLE_SCRIPT, 'sql'))

    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.checkSqlScript).toHaveBeenCalledWith(SAMPLE_SCRIPT, {
      databaseType: 'postgresql',
      parameterNames: null,
      tables: null,
      variables: [],
      template: false,
    })
    expect(mocks.checkSql).toHaveBeenCalledWith(
      { database_type: 'postgresql', script: SAMPLE_SCRIPT },
      expect.any(AbortSignal),
    )
  })

  it('asks the server in the dialect of the Database type', async () => {
    renderSql(SAMPLE_SCRIPT, { ...SQL_OPTIONS, databaseType: 'mysql' })

    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.checkSql).toHaveBeenCalledWith(
      { database_type: 'mysql', script: SAMPLE_SCRIPT },
      expect.any(AbortSignal),
    )
    expect(sqlInputOf(0)).toEqual(expect.objectContaining({ databaseType: 'mysql' }))
  })

  it('never parses Python or runs the Python checks', async () => {
    renderSql()

    await advance(1000)

    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.checkPythonScript).not.toHaveBeenCalled()
  })
})

describe('useScriptSyntaxIssues in SQL mode: the published list', () => {
  it('merges local and server findings in line order, line 0 first', async () => {
    mocks.checkSqlScript.mockImplementation(() => [UNUSED_LIMIT, UNDEFINED_CUSTOMER])
    mocks.checkSql.mockImplementation(() => Promise.resolve({ issues: [SERVER_ISSUE] }))
    const { result } = renderSql()

    await advance(SQL_DEBOUNCE_MS)

    expect(result.current).toEqual([UNUSED_LIMIT, SERVER_WARNING, UNDEFINED_CUSTOMER])
  })

  it('turns a server issue into a warning over its whole line', async () => {
    mocks.checkSql.mockImplementation(() => Promise.resolve({ issues: [SERVER_ISSUE] }))
    const { result } = renderSql()

    await advance(SQL_DEBOUNCE_MS)

    expect(result.current).toEqual([SERVER_WARNING])
  })

  it('lists a local finding ahead of a server finding on the same line', async () => {
    const local: ScriptWarning = { ...SERVER_WARNING, message: "Table 'orders' is not in the loaded tables" }
    mocks.checkSqlScript.mockImplementation(() => [local])
    mocks.checkSql.mockImplementation(() => Promise.resolve({ issues: [SERVER_ISSUE] }))
    const { result } = renderSql()

    await advance(SQL_DEBOUNCE_MS)

    expect(result.current).toEqual([local, SERVER_WARNING])
  })

  it('writes the same list through setNodeSyntaxIssues, once', async () => {
    mocks.checkSqlScript.mockImplementation(() => [UNUSED_LIMIT])
    mocks.checkSql.mockImplementation(() => Promise.resolve({ issues: [SERVER_ISSUE] }))
    const { result } = renderSql()

    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledTimes(1)
    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledWith(SQL_NODE, [UNUSED_LIMIT, SERVER_WARNING])
    expect(result.current).toEqual([UNUSED_LIMIT, SERVER_WARNING])
  })

  it('publishes nothing while the server check is still out', async () => {
    mocks.checkSqlScript.mockImplementation(() => [UNUSED_LIMIT])
    const pending = deferred<{ issues: SqlCheckIssue[] }>()
    mocks.checkSql.mockReturnValueOnce(pending.promise)
    const { result } = renderSql()

    await advance(SQL_DEBOUNCE_MS)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()

    pending.resolve({ issues: [] })
    await advance(0)

    expect(result.current).toEqual([UNUSED_LIMIT])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledWith(SQL_NODE, [UNUSED_LIMIT])
  })

  it('keeps the local findings when the server check answers no issues', async () => {
    mocks.checkSqlScript.mockImplementation(() => [UNUSED_LIMIT, UNDEFINED_CUSTOMER])
    mocks.checkSql.mockImplementation(() => Promise.resolve({ issues: [] }))
    const { result } = renderSql()

    await advance(SQL_DEBOUNCE_MS)

    expect(result.current).toEqual([UNUSED_LIMIT, UNDEFINED_CUSTOMER])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenLastCalledWith(SQL_NODE, [
      UNUSED_LIMIT,
      UNDEFINED_CUSTOMER,
    ])
  })

  it('publishes an empty list for a clean script', async () => {
    const { result } = renderSql()

    await advance(SQL_DEBOUNCE_MS)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenLastCalledWith(SQL_NODE, [])
  })

  it('reports every SQL issue as a warning', async () => {
    mocks.checkSqlScript.mockImplementation(() => [UNUSED_LIMIT, UNDEFINED_CUSTOMER])
    mocks.checkSql.mockImplementation(() => Promise.resolve({ issues: [SERVER_ISSUE] }))
    const { result } = renderSql()

    await advance(SQL_DEBOUNCE_MS)

    expect(result.current).toHaveLength(3)
    for (const issue of result.current) {
      expect(issue).toEqual(expect.objectContaining({ severity: 'warning' }))
    }
  })
})

describe('useScriptSyntaxIssues in SQL mode: a stale server answer', () => {
  it('aborts the pending server check on an edit and never publishes its answer', async () => {
    mocks.checkSqlScript.mockImplementation((doc: string) =>
      doc === EDITED_SCRIPT ? [UNDEFINED_CUSTOMER] : [UNUSED_LIMIT],
    )
    const first = deferred<{ issues: SqlCheckIssue[] }>()
    mocks.checkSql.mockReturnValueOnce(first.promise)
    const { result, rerender } = renderSql()

    await advance(SQL_DEBOUNCE_MS)
    const signal = mocks.checkSql.mock.calls[0]?.[1] as AbortSignal
    expect(signal.aborted).toBe(false)

    rerender({ value: EDITED_SCRIPT, mode: 'sql', options: SQL_OPTIONS })

    expect(signal.aborted).toBe(true)

    first.resolve({ issues: [SERVER_ISSUE] })
    await advance(0)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()

    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.checkSql).toHaveBeenCalledTimes(2)
    expect(mocks.checkSql.mock.calls[1]?.[0]).toEqual({
      database_type: 'postgresql',
      script: EDITED_SCRIPT,
    })
    expect(result.current).toEqual([UNDEFINED_CUSTOMER])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledTimes(1)
    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledWith(SQL_NODE, [UNDEFINED_CUSTOMER])
  })

  it('aborts the pending server check when an option changes', async () => {
    const first = deferred<{ issues: SqlCheckIssue[] }>()
    mocks.checkSql.mockReturnValueOnce(first.promise)
    const { rerender } = renderSql()

    await advance(SQL_DEBOUNCE_MS)
    const signal = mocks.checkSql.mock.calls[0]?.[1] as AbortSignal

    rerender({
      value: SAMPLE_SCRIPT,
      mode: 'sql',
      options: { ...SQL_OPTIONS, parameterNames: ['customer', 'status'] },
    })

    expect(signal.aborted).toBe(true)

    first.resolve({ issues: [SERVER_ISSUE] })
    await advance(0)

    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()
  })

  it('never publishes an answer that arrives after the mode is switched off', async () => {
    const first = deferred<{ issues: SqlCheckIssue[] }>()
    mocks.checkSql.mockReturnValueOnce(first.promise)
    const { result, rerender } = renderSql()

    await advance(SQL_DEBOUNCE_MS)
    rerender({ value: SAMPLE_SCRIPT, mode: null, options: SQL_OPTIONS })
    first.resolve({ issues: [SERVER_ISSUE] })
    await advance(SQL_DEBOUNCE_MS)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()
  })
})

describe('useScriptSyntaxIssues in SQL mode: {{ }} bodies', () => {
  it('never asks the server about a body holding {{', async () => {
    mocks.checkSqlScript.mockImplementation(() => [UNUSED_LIMIT])
    const { result } = renderSql(TEMPLATE_SCRIPT)

    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.checkSql).not.toHaveBeenCalled()
    expect(mocks.checkSqlScript).toHaveBeenCalledWith(TEMPLATE_SCRIPT, expect.objectContaining({ template: false }))
    expect(result.current).toEqual([UNUSED_LIMIT])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledWith(SQL_NODE, [UNUSED_LIMIT])
  })

  it('never loads the expression parser in Literal kind, even with {{ in the body', async () => {
    renderSql(TEMPLATE_SCRIPT)

    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.initializeTreeSitter).not.toHaveBeenCalled()
  })

  it('never loads the expression parser in Template kind while the body holds no {{', async () => {
    renderSql(SAMPLE_SCRIPT, { ...SQL_OPTIONS, template: true })

    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.initializeTreeSitter).not.toHaveBeenCalled()
    expect(mocks.checkSqlScript).toHaveBeenCalledWith(SAMPLE_SCRIPT, expect.objectContaining({ template: true }))
    expect(mocks.checkSql).toHaveBeenCalledTimes(1)
  })

  it('waits for the expression parser before the local checks in Template kind with {{', async () => {
    mocks.checkSqlScript.mockImplementation(() => [UNUSED_LIMIT])
    const gate = deferred<typeof mocks.parser>()
    mocks.initializeTreeSitter.mockReturnValueOnce(gate.promise)
    const { result } = renderSql(TEMPLATE_SCRIPT, { ...SQL_OPTIONS, template: true })

    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.initializeTreeSitter).toHaveBeenCalledTimes(1)
    expect(mocks.checkSqlScript).not.toHaveBeenCalled()

    gate.resolve(mocks.parser)
    await advance(0)

    expect(mocks.checkSqlScript).toHaveBeenCalledTimes(1)
    expect(mocks.checkSqlScript).toHaveBeenCalledWith(TEMPLATE_SCRIPT, expect.objectContaining({ template: true }))
    expect(mocks.checkSql).not.toHaveBeenCalled()
    expect(result.current).toEqual([UNUSED_LIMIT])
  })

  it('still runs the local checks when the expression parser cannot load', async () => {
    mocks.checkSqlScript.mockImplementation(() => [UNUSED_LIMIT])
    mocks.initializeTreeSitter.mockRejectedValueOnce(new Error('wasm unavailable'))
    const { result } = renderSql(TEMPLATE_SCRIPT, { ...SQL_OPTIONS, template: true })

    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.checkSqlScript).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual([UNUSED_LIMIT])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledWith(SQL_NODE, [UNUSED_LIMIT])
  })
})

describe('useScriptSyntaxIssues in SQL mode: changed options', () => {
  it.each([
    ['Parameters entries', { parameterNames: ['customer'] }],
    ['Parameters turned into an expression', { parameterNames: null }],
    ['loaded tables', { tables: SAMPLE_TABLES }],
    ['variables', { variables: [{ name: 'region', type: 'string' }] }],
    ['the kind', { template: true }],
    ['the Database type', { databaseType: 'oracle' }],
  ] as Array<[string, Partial<ScriptSyntaxOptions>]>)(
    'checks again after a change of %s',
    async (_change, change) => {
      const { rerender } = renderSql()

      await advance(SQL_DEBOUNCE_MS)
      rerender({ value: SAMPLE_SCRIPT, mode: 'sql', options: { ...SQL_OPTIONS, ...change } })
      await advance(SQL_DEBOUNCE_MS)

      expect(mocks.checkSqlScript).toHaveBeenCalledTimes(2)
      expect(sqlInputOf(1)).toEqual({
        databaseType: 'postgresql',
        parameterNames: PARAMETER_NAMES,
        tables: null,
        variables: NO_VARIABLES,
        template: false,
        ...change,
      })
    },
  )

  it('asks the server again in the new dialect when the Database type changes', async () => {
    const { rerender } = renderSql()

    await advance(SQL_DEBOUNCE_MS)
    rerender({ value: SAMPLE_SCRIPT, mode: 'sql', options: { ...SQL_OPTIONS, databaseType: 'mssql' } })
    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.checkSql).toHaveBeenLastCalledWith(
      { database_type: 'mssql', script: SAMPLE_SCRIPT },
      expect.any(AbortSignal),
    )
  })

  it('does not check again for a new options object holding the same values', async () => {
    const { rerender } = renderSql()

    await advance(SQL_DEBOUNCE_MS)
    rerender({ value: SAMPLE_SCRIPT, mode: 'sql', options: { ...SQL_OPTIONS } })
    await advance(SQL_DEBOUNCE_MS)

    expect(mocks.checkSqlScript).toHaveBeenCalledTimes(1)
    expect(mocks.checkSql).toHaveBeenCalledTimes(1)
  })
})

describe('useScriptSyntaxIssues leaving SQL mode', () => {
  it('returns nothing and writes nothing once the mode is switched off', async () => {
    mocks.checkSqlScript.mockImplementation(() => [UNUSED_LIMIT])
    const { result, rerender } = renderSql()

    await advance(SQL_DEBOUNCE_MS)
    expect(result.current).toEqual([UNUSED_LIMIT])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledTimes(1)

    rerender({ value: EDITED_SCRIPT, mode: null, options: SQL_OPTIONS })
    await advance(1000)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledTimes(1)
    expect(mocks.checkSqlScript).toHaveBeenCalledTimes(1)
  })
})

// ============================================
// OpenSearch modes (OS-12)
// ============================================

const OS_NODE = 'opensearch-node-1'
const OS_DEBOUNCE_MS = 300
const FIELDS_JOB = 'job-fields-1'

const OS_OPTIONS: ScriptSyntaxOptions = {
  template: true,
  openSearch: { index: 'filebeat-*', fieldsJobId: FIELDS_JOB },
}

const UNKNOWN_FIELD_DQL = 'log.invalid: ERROR and service.name: "checkout"'
const UNKNOWN_FIELD: OpenSearchCheckIssue = {
  line: 1,
  col: 1,
  length: 11,
  message: 'Unknown field log.invalid in filebeat-*',
}
const UNKNOWN_FIELD_WARNING: ScriptWarning = {
  line: 1,
  message: 'Unknown field log.invalid in filebeat-*',
  severity: 'warning',
  from: 0,
  to: 11,
}

interface OpenSearchProps {
  value: string
  mode: ScriptMode | null
  options: ScriptSyntaxOptions
}

function renderOpenSearch(
  value = UNKNOWN_FIELD_DQL,
  mode: ScriptMode = 'dql' as ScriptMode,
  options: ScriptSyntaxOptions = OS_OPTIONS,
) {
  return renderHook(
    ({ value: doc, mode: current, options: opts }: OpenSearchProps) =>
      useScriptSyntaxIssues(OS_NODE, doc, current, opts),
    { initialProps: { value, mode, options } as OpenSearchProps },
  )
}

function openSearchBodyOf(call: number): unknown {
  return mocks.checkOpenSearch.mock.calls[call]?.[0]
}

describe('useScriptSyntaxIssues in OpenSearch modes: debounce and request', () => {
  it('does no work before 300 ms have passed', async () => {
    mocks.checkOpenSearch.mockImplementation(() => Promise.resolve({ issues: [UNKNOWN_FIELD] }))
    const { result } = renderOpenSearch()

    await advance(OS_DEBOUNCE_MS - 1)

    expect(mocks.checkOpenSearch).not.toHaveBeenCalled()
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()
    expect(result.current).toEqual([])
  })

  it('asks the check endpoint once at 300 ms with the body, kind, fields job and index', async () => {
    renderOpenSearch()

    await advance(OS_DEBOUNCE_MS)

    expect(mocks.checkOpenSearch).toHaveBeenCalledTimes(1)
    expect(mocks.checkOpenSearch).toHaveBeenCalledWith(
      {
        language: 'dql',
        text: UNKNOWN_FIELD_DQL,
        template: true,
        fields_job_id: FIELDS_JOB,
        index: 'filebeat-*',
      },
      expect.any(AbortSignal),
    )
  })

  it.each([
    ['dql', 'dql', SAMPLE_DQL],
    ['query-dsl', 'query_dsl', SAMPLE_QUERY_DSL],
    ['aggregation-json', 'aggregation', SAMPLE_AGGREGATION_JSON],
  ])('checks the %s mode in the %s language', async (mode, language, doc) => {
    renderOpenSearch(doc, mode as ScriptMode)

    await advance(OS_DEBOUNCE_MS)

    expect(openSearchBodyOf(0)).toEqual(expect.objectContaining({ language, text: doc }))
  })

  it('sends template false for a Literal body', async () => {
    renderOpenSearch(SAMPLE_DQL, 'dql' as ScriptMode, { ...OS_OPTIONS, template: false })

    await advance(OS_DEBOUNCE_MS)

    expect(openSearchBodyOf(0)).toEqual(expect.objectContaining({ template: false }))
  })

  it('still asks the server about a Template body holding {{ }}', async () => {
    const doc = 'service.name: {{ svc }} and log.level: ERROR'
    renderOpenSearch(doc)

    await advance(OS_DEBOUNCE_MS)

    expect(mocks.checkOpenSearch).toHaveBeenCalledTimes(1)
    expect(openSearchBodyOf(0)).toEqual(expect.objectContaining({ text: doc, template: true }))
  })

  it('sends no fields job while nothing is loaded', async () => {
    renderOpenSearch(SAMPLE_DQL, 'dql' as ScriptMode, {
      ...OS_OPTIONS,
      openSearch: { index: 'filebeat-*', fieldsJobId: null },
    })

    await advance(OS_DEBOUNCE_MS)

    expect(openSearchBodyOf(0)).toEqual(expect.objectContaining({ fields_job_id: null, index: 'filebeat-*' }))
  })

  it('checks with a blank index, no fields job and Literal kind when no options are given', async () => {
    renderHook(() => useScriptSyntaxIssues(OS_NODE, SAMPLE_DQL, 'dql' as ScriptMode))

    await advance(OS_DEBOUNCE_MS)

    expect(mocks.checkOpenSearch).toHaveBeenCalledWith(
      { language: 'dql', text: SAMPLE_DQL, template: false, fields_job_id: null, index: '' },
      expect.any(AbortSignal),
    )
  })

  it('restarts the wait when the body changes again', async () => {
    const { rerender } = renderOpenSearch(SAMPLE_DQL)

    await advance(200)
    rerender({ value: UNKNOWN_FIELD_DQL, mode: 'dql' as ScriptMode, options: OS_OPTIONS })
    await advance(200)

    expect(mocks.checkOpenSearch).not.toHaveBeenCalled()

    await advance(100)

    expect(mocks.checkOpenSearch).toHaveBeenCalledTimes(1)
    expect(openSearchBodyOf(0)).toEqual(expect.objectContaining({ text: UNKNOWN_FIELD_DQL }))
  })

  it('never runs the Python or SQL checks', async () => {
    renderOpenSearch()

    await advance(1000)

    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.checkPythonScript).not.toHaveBeenCalled()
    expect(mocks.checkSqlScript).not.toHaveBeenCalled()
    expect(mocks.checkSql).not.toHaveBeenCalled()
  })

  it('is never asked by the Python or SQL checks', async () => {
    renderIssues(CLEAN_SCRIPT)
    renderSql()

    await advance(1000)

    expect(mocks.checkOpenSearch).not.toHaveBeenCalled()
  })
})

describe('useScriptSyntaxIssues in OpenSearch modes: the published list', () => {
  it('turns each finding into a warning over its span', async () => {
    mocks.checkOpenSearch.mockImplementation(() => Promise.resolve({ issues: [UNKNOWN_FIELD] }))
    const { result } = renderOpenSearch()

    await advance(OS_DEBOUNCE_MS)

    expect(result.current).toEqual([UNKNOWN_FIELD_WARNING])
  })

  it('writes the same list through setNodeSyntaxIssues, once', async () => {
    mocks.checkOpenSearch.mockImplementation(() => Promise.resolve({ issues: [UNKNOWN_FIELD] }))
    const { result } = renderOpenSearch()

    await advance(OS_DEBOUNCE_MS)

    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledTimes(1)
    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledWith(OS_NODE, [UNKNOWN_FIELD_WARNING])
    expect(result.current).toEqual([UNKNOWN_FIELD_WARNING])
  })

  it('places a finding on a later line from its line and column', async () => {
    const doc = 'log.level: ERROR\nand log.invalid: INFO'
    mocks.checkOpenSearch.mockImplementation(() =>
      Promise.resolve({ issues: [{ ...UNKNOWN_FIELD, line: 2, col: 5 }] }),
    )
    const { result } = renderOpenSearch(doc)

    await advance(OS_DEBOUNCE_MS)

    const at = doc.indexOf('log.invalid')
    expect(result.current).toEqual([{ ...UNKNOWN_FIELD_WARNING, line: 2, from: at, to: at + 11 }])
  })

  it('reports every finding as a warning, a syntax finding included', async () => {
    const doc = 'log.invalid: ERROR and ) x'
    const syntax: OpenSearchCheckIssue = {
      line: 1,
      col: 24,
      length: 1,
      message: 'Expected "(", NOT, field name, value, whitespace but ")" found.',
    }
    mocks.checkOpenSearch.mockImplementation(() => Promise.resolve({ issues: [UNKNOWN_FIELD, syntax] }))
    const { result } = renderOpenSearch(doc)

    await advance(OS_DEBOUNCE_MS)

    expect(result.current).toHaveLength(2)
    for (const issue of result.current) {
      expect(issue).toEqual(expect.objectContaining({ severity: 'warning' }))
    }
    expect(result.current[1]).toEqual({
      line: 1,
      message: syntax.message,
      severity: 'warning',
      from: 23,
      to: 24,
    })
  })

  it('keeps the findings in line order', async () => {
    const doc = SAMPLE_QUERY_DSL
    const lines = doc.split('\n')
    const issues: OpenSearchCheckIssue[] = [
      { line: 2, col: 3, length: 6, message: 'first' },
      { line: 6, col: 11, length: 11, message: 'second' },
    ]
    mocks.checkOpenSearch.mockImplementation(() => Promise.resolve({ issues }))
    const { result } = renderOpenSearch(doc, 'query-dsl' as ScriptMode)

    await advance(OS_DEBOUNCE_MS)

    const lineStart = (line: number) => lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0)
    expect(result.current).toEqual([
      { line: 2, message: 'first', severity: 'warning', from: lineStart(2) + 2, to: lineStart(2) + 8 },
      { line: 6, message: 'second', severity: 'warning', from: lineStart(6) + 10, to: lineStart(6) + 21 },
    ])
  })

  it('publishes an empty list for a clean body', async () => {
    const { result } = renderOpenSearch(SAMPLE_DQL)

    await advance(OS_DEBOUNCE_MS)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenLastCalledWith(OS_NODE, [])
  })

  it('publishes nothing while the check is still out', async () => {
    const pending = deferred<{ issues: OpenSearchCheckIssue[] }>()
    mocks.checkOpenSearch.mockReturnValueOnce(pending.promise)
    const { result } = renderOpenSearch()

    await advance(OS_DEBOUNCE_MS)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()

    pending.resolve({ issues: [UNKNOWN_FIELD] })
    await advance(0)

    expect(result.current).toEqual([UNKNOWN_FIELD_WARNING])
  })

  it('reports nothing when the check request fails', async () => {
    mocks.checkOpenSearch.mockImplementation(() => Promise.reject(new Error('Network request failed')))
    const { result } = renderOpenSearch()

    await advance(OS_DEBOUNCE_MS)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenLastCalledWith(OS_NODE, [])
  })
})

describe('useScriptSyntaxIssues in OpenSearch modes: positions in characters', () => {
  it('places a finding after a wide character by its characters, not its code units', async () => {
    // The emoji is one character and two UTF-16 code units.
    const doc = 'message: "😀" and log.invalid: x'
    const at = doc.indexOf('log.invalid')
    mocks.checkOpenSearch.mockImplementation(() =>
      Promise.resolve({ issues: [{ ...UNKNOWN_FIELD, col: Array.from(doc.slice(0, at)).length + 1 }] }),
    )
    const { result } = renderOpenSearch(doc)

    await advance(OS_DEBOUNCE_MS)

    expect(Array.from(doc.slice(0, at)).length).toBe(at - 1)
    expect(result.current).toEqual([{ ...UNKNOWN_FIELD_WARNING, from: at, to: at + 11 }])
  })

  it('spans a wide character inside a finding by its code units', async () => {
    const doc = 'tag: "a😀b" and x'
    const at = doc.indexOf('"a😀b"')
    mocks.checkOpenSearch.mockImplementation(() =>
      Promise.resolve({ issues: [{ line: 1, col: at + 1, length: 5, message: 'Unknown value' }] }),
    )
    const { result } = renderOpenSearch(doc)

    await advance(OS_DEBOUNCE_MS)

    expect(result.current).toEqual([
      { line: 1, message: 'Unknown value', severity: 'warning', from: at, to: at + '"a😀b"'.length },
    ])
  })

  it('places a finding on a later line after a wide character on an earlier line', async () => {
    const doc = 'message: "😀 🚀"\nand log.invalid: x'
    const at = doc.indexOf('log.invalid')
    mocks.checkOpenSearch.mockImplementation(() =>
      Promise.resolve({ issues: [{ ...UNKNOWN_FIELD, line: 2, col: 5 }] }),
    )
    const { result } = renderOpenSearch(doc)

    await advance(OS_DEBOUNCE_MS)

    expect(result.current).toEqual([{ ...UNKNOWN_FIELD_WARNING, line: 2, from: at, to: at + 11 }])
  })
})

describe('useScriptSyntaxIssues in OpenSearch modes: a stale answer', () => {
  it('aborts the pending check on an edit and never publishes its answer', async () => {
    const first = deferred<{ issues: OpenSearchCheckIssue[] }>()
    mocks.checkOpenSearch.mockReturnValueOnce(first.promise)
    const { result, rerender } = renderOpenSearch()

    await advance(OS_DEBOUNCE_MS)
    const signal = mocks.checkOpenSearch.mock.calls[0]?.[1] as AbortSignal
    expect(signal.aborted).toBe(false)

    rerender({ value: SAMPLE_DQL, mode: 'dql' as ScriptMode, options: OS_OPTIONS })

    expect(signal.aborted).toBe(true)

    first.resolve({ issues: [UNKNOWN_FIELD] })
    await advance(0)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()

    await advance(OS_DEBOUNCE_MS)

    expect(mocks.checkOpenSearch).toHaveBeenCalledTimes(2)
    expect(openSearchBodyOf(1)).toEqual(expect.objectContaining({ text: SAMPLE_DQL }))
    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).toHaveBeenCalledWith(OS_NODE, [])
  })

  it('returns nothing and writes nothing once the mode is switched off', async () => {
    const first = deferred<{ issues: OpenSearchCheckIssue[] }>()
    mocks.checkOpenSearch.mockReturnValueOnce(first.promise)
    const { result, rerender } = renderOpenSearch()

    await advance(OS_DEBOUNCE_MS)
    rerender({ value: UNKNOWN_FIELD_DQL, mode: null, options: OS_OPTIONS })
    first.resolve({ issues: [UNKNOWN_FIELD] })
    await advance(1000)

    expect(result.current).toEqual([])
    expect(mocks.setNodeSyntaxIssues).not.toHaveBeenCalled()
  })
})

describe('useScriptSyntaxIssues in OpenSearch modes: changed options', () => {
  it.each([
    ['the index', { openSearch: { index: 'metrics-*', fieldsJobId: FIELDS_JOB } }, { index: 'metrics-*' }],
    ['the fields job', { openSearch: { index: 'filebeat-*', fieldsJobId: 'job-fields-2' } }, { fields_job_id: 'job-fields-2' }],
    ['the kind', { template: false }, { template: false }],
  ] as Array<[string, Partial<ScriptSyntaxOptions>, Record<string, unknown>]>)(
    'checks again after a change of %s',
    async (_change, change, sent) => {
      const { rerender } = renderOpenSearch()

      await advance(OS_DEBOUNCE_MS)
      rerender({ value: UNKNOWN_FIELD_DQL, mode: 'dql' as ScriptMode, options: { ...OS_OPTIONS, ...change } })
      await advance(OS_DEBOUNCE_MS)

      expect(mocks.checkOpenSearch).toHaveBeenCalledTimes(2)
      expect(openSearchBodyOf(1)).toEqual({
        language: 'dql',
        text: UNKNOWN_FIELD_DQL,
        template: true,
        fields_job_id: FIELDS_JOB,
        index: 'filebeat-*',
        ...sent,
      })
    },
  )

  it('checks again in the new language when the mode changes', async () => {
    const { rerender } = renderOpenSearch(SAMPLE_QUERY_DSL, 'query-dsl' as ScriptMode)

    await advance(OS_DEBOUNCE_MS)
    rerender({ value: SAMPLE_QUERY_DSL, mode: 'aggregation-json' as ScriptMode, options: OS_OPTIONS })
    await advance(OS_DEBOUNCE_MS)

    expect(openSearchBodyOf(1)).toEqual(expect.objectContaining({ language: 'aggregation' }))
  })

  it('does not check again for a new options object holding the same values', async () => {
    const { rerender } = renderOpenSearch()

    await advance(OS_DEBOUNCE_MS)
    rerender({
      value: UNKNOWN_FIELD_DQL,
      mode: 'dql' as ScriptMode,
      options: { template: true, openSearch: { index: 'filebeat-*', fieldsJobId: FIELDS_JOB } },
    })
    await advance(OS_DEBOUNCE_MS)

    expect(mocks.checkOpenSearch).toHaveBeenCalledTimes(1)
  })
})
