/**
 * The issue list of a script editor: syntax errors and check warnings.
 *
 * Contract under test (PYRUN-13, SQL-10):
 *   - an issue reads "Line {n}: {message}", whatever its kind; a warning at line 0,
 *     which belongs to no line, reads as its bare message
 *   - a check warning is told apart from a syntax error by its warning severity
 *   - a merged list reads in line order, line 0 first, a syntax error before a warning
 *     on the same line
 *
 * REQ-3.4.1.2: Python script execution
 * REQ-3.4.1.6: SQL database operations
 */

import { describe, it, expect } from 'vitest'

import {
  isScriptWarning,
  mergeScriptIssues,
  scriptIssueText,
  type ScriptSyntaxError,
  type ScriptWarning,
} from '@/features/workbench/lib/python-script-validation/script-issues'
import type { PythonScriptWarning } from '@/features/workbench/lib/python-script-validation/check-script'

const WARNING: PythonScriptWarning = {
  line: 4,
  message: "Function 'puts' is not recognized",
  severity: 'warning',
  from: 30,
  to: 34,
  type: 'invalid_function',
}

const UNUSED_ENTRY: ScriptWarning = {
  line: 0,
  message: "Parameter 'limit' is defined but not used in the SQL",
  severity: 'warning',
  from: 0,
  to: 0,
}

const SESSION_END: ScriptWarning = {
  line: 6,
  message: 'SET search_path ends the script; its effect ends with the block',
  severity: 'warning',
  from: 110,
  to: 139,
}

describe('scriptIssueText', () => {
  it('reads Line {n}: {message}', () => {
    expect(scriptIssueText({ line: 7, message: 'Unexpected token' })).toBe(
      'Line 7: Unexpected token',
    )
  })

  it('keeps the message as the parser worded it', () => {
    expect(scriptIssueText({ line: 1, message: "Missing ')'" })).toBe("Line 1: Missing ')'")
  })

  it('reads one string per issue for the validation strip', () => {
    const issues: ScriptSyntaxError[] = [
      { line: 2, message: 'Unexpected token' },
      { line: 5, message: 'Unexpected token' },
    ]

    expect(issues.map((issue) => scriptIssueText(issue))).toEqual([
      'Line 2: Unexpected token',
      'Line 5: Unexpected token',
    ])
  })

  it('reads a check warning the same way', () => {
    expect(scriptIssueText(WARNING)).toBe("Line 4: Function 'puts' is not recognized")
  })

  it('reads a SQL warning the same way', () => {
    expect(scriptIssueText(SESSION_END)).toBe(
      'Line 6: SET search_path ends the script; its effect ends with the block',
    )
  })

  it('reads a warning at line 0 as its bare message', () => {
    expect(scriptIssueText(UNUSED_ENTRY)).toBe(
      "Parameter 'limit' is defined but not used in the SQL",
    )
  })
})

describe('isScriptWarning', () => {
  it('recognizes a Python check warning', () => {
    expect(isScriptWarning(WARNING)).toBe(true)
  })

  it('recognizes a SQL warning', () => {
    expect(isScriptWarning(UNUSED_ENTRY)).toBe(true)
  })

  it('reads a syntax error as no warning', () => {
    expect(isScriptWarning({ line: 4, message: 'Syntax error' })).toBe(false)
  })
})

describe('mergeScriptIssues', () => {
  it('lists syntax errors and warnings in line order', () => {
    const merged = mergeScriptIssues(
      [
        { line: 9, message: "'(' was never closed" },
        { line: 2, message: 'invalid syntax' },
      ],
      [{ ...WARNING, line: 5 }, { ...WARNING, line: 1 }],
    )

    expect(merged.map((issue) => issue.line)).toEqual([1, 2, 5, 9])
  })

  it('keeps a syntax error ahead of a warning on the same line', () => {
    const merged = mergeScriptIssues([{ line: 4, message: 'invalid syntax' }], [WARNING])

    expect(merged.map(scriptIssueText)).toEqual([
      'Line 4: invalid syntax',
      "Line 4: Function 'puts' is not recognized",
    ])
  })

  it('lists a warning at line 0 first', () => {
    const merged = mergeScriptIssues([], [SESSION_END, UNUSED_ENTRY])

    expect(merged).toEqual([UNUSED_ENTRY, SESSION_END])
    expect(merged.map(scriptIssueText)).toEqual([
      "Parameter 'limit' is defined but not used in the SQL",
      'Line 6: SET search_path ends the script; its effect ends with the block',
    ])
  })

  it('keeps warnings of one line in the order they were given', () => {
    const second: ScriptWarning = { ...SESSION_END, message: 'Invalid expression / Unexpected token' }

    expect(mergeScriptIssues([], [SESSION_END, second])).toEqual([SESSION_END, second])
  })

  it('merges nothing into an empty list', () => {
    expect(mergeScriptIssues([], [])).toEqual([])
  })
})
