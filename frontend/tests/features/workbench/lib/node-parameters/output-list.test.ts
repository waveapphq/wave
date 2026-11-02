/**
 * Tests for the author-declared output list (SHRUN-6, PYRUN-14, REQ-3.4.1.1, REQ-3.4.2.2).
 *
 * A block may declare a parameter whose rows each name an extra output bound to
 * one WAVE variable. This module holds the pure half: seeding the edit rows from
 * what was stored, merging them back at save, the per-row name errors and the
 * canvas issues.
 */

import { describe, it, expect } from 'vitest'

import {
  followRowBindings,
  seedOutputListRows,
  mergeOutputList,
  outputListRowErrors,
  outputListFieldErrors,
  outputListNodeIssues,
} from '@/features/workbench/lib/node-parameters/output-list'
import type { OutputListRowState } from '@/features/workbench/lib/node-parameters/types'

const PARAM = 'script_variables'

const SHELL_SCRIPT_POLICY = {
  nameHeading: 'Script Variable',
  bindingHeading: 'WAVE Variable',
  itemNoun: 'variable export',
  addLabel: 'Add variable export',
  namePattern: '^[A-Za-z_][A-Za-z0-9_]*$',
  nameRuleMessage:
    'Name must start with a letter or underscore, and contain only letters, numbers, and underscores',
  invalidNameMessage: "Invalid script variable name: '{name}'",
  clashMessage: "Script variable '{name}' has the name of a block output",
  duplicateMessage: "Script variable '{name}' is listed more than once",
}

const OUTPUT_NAMES = ['stdout', 'stderr', 'exit_code', 'success', 'error', 'reason']

function row(
  name: string,
  binding = '',
  secret = false,
  type: OutputListRowState['type'] = 'string',
): OutputListRowState {
  return { name, binding, secret, type }
}

function shellScriptSchema() {
  return [
    { name: 'script', type: 'string', required: true },
    { name: PARAM, type: 'array', required: false, outputList: SHELL_SCRIPT_POLICY },
  ]
}

/** Python's exports policy is Shell Script's plus the body the warning reads. */
const PYTHON_POLICY = { ...SHELL_SCRIPT_POLICY, assignedIn: 'script' }

function pythonSchema() {
  return [
    { name: 'script', type: 'string', required: false },
    { name: PARAM, type: 'array', required: false, outputList: PYTHON_POLICY },
  ]
}

function sourceValues(script: string, exports: string[]): Record<string, unknown> {
  return { script_type: 'source', script, [PARAM]: exports }
}

describe('seedOutputListRows', () => {
  it('seeds one row per stored name, in stored order', () => {
    const rows = seedOutputListRows(PARAM, { [PARAM]: ['COUNT', 'HOST'] }, {}, [])
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['COUNT', 'HOST'])
  })

  it('seeds the binding and the secret box of each row', () => {
    const rows = seedOutputListRows(
      PARAM,
      { [PARAM]: ['COUNT', 'TOKEN'] },
      { COUNT: 'Counter', stdout: 'OutText' },
      ['TOKEN', 'stderr'],
    )
    expect(rows).toEqual([
      { name: 'COUNT', binding: 'Counter', secret: false, type: 'string' },
      { name: 'TOKEN', binding: '', secret: true, type: 'string' },
    ])
  })

  it('seeds every row with the string type, bound or not', () => {
    const rows = seedOutputListRows(PARAM, { [PARAM]: ['COUNT', 'HOST'] }, { COUNT: 'Counter' }, [])
    expect(rows.map((r) => r.type)).toEqual(['string', 'string'])
  })

  it('seeds no rows when the parameter was never stored', () => {
    expect(seedOutputListRows(PARAM, {}, {}, [])).toEqual([])
  })

  it('seeds no rows for a stored value that is not an array', () => {
    expect(seedOutputListRows(PARAM, { [PARAM]: 'COUNT' }, {}, [])).toEqual([])
    expect(seedOutputListRows(PARAM, { [PARAM]: { COUNT: 1 } }, {}, [])).toEqual([])
    expect(seedOutputListRows(PARAM, { [PARAM]: null }, {}, [])).toEqual([])
  })

  it('seeds a non-string item as its string form', () => {
    expect(seedOutputListRows(PARAM, { [PARAM]: [3] }, { '3': 'Three' }, ['3'])).toEqual([
      { name: '3', binding: 'Three', secret: true, type: 'string' },
    ])
  })
})

describe('followRowBindings', () => {
  const row = (name: string, binding: string): OutputListRowState => ({ name, binding, secret: false, type: 'string' })

  it('takes the binding the canvas cleared on a row that still holds the stored one', () => {
    expect(followRowBindings([row('COUNT', 'count')], { COUNT: 'count' }, { COUNT: '' })).toEqual([row('COUNT', '')])
  })

  it('keeps a binding the row itself changed', () => {
    expect(followRowBindings([row('COUNT', 'total')], { COUNT: 'count' }, { COUNT: '' })).toEqual([row('COUNT', 'total')])
  })

  it('returns the same rows when the canvas changed none of their bindings', () => {
    const rows = [row('COUNT', 'count'), row('NEW', '')]
    expect(followRowBindings(rows, { COUNT: 'count', other: 'a' }, { COUNT: 'count', other: '' })).toBe(rows)
  })
})

describe('mergeOutputList', () => {
  function base() {
    return {
      values: { script: 'echo hi', [PARAM]: ['COUNT'] },
      outputBindings: { COUNT: 'Counter', stdout: 'OutText' },
      outputSecretFields: ['COUNT', 'stderr'],
      hadStoredKey: true,
    }
  }

  function seeded() {
    const input = base()
    return seedOutputListRows(PARAM, input.values, input.outputBindings, input.outputSecretFields)
  }

  it('is the identity while the rows equal their seed', () => {
    const input = base()
    const merged = mergeOutputList(PARAM, seeded(), seeded(), OUTPUT_NAMES, input)

    expect(JSON.stringify(merged.values)).toBe(JSON.stringify(input.values))
    expect(JSON.stringify(merged.outputBindings)).toBe(JSON.stringify(input.outputBindings))
    expect(merged.outputSecretFields).toEqual(input.outputSecretFields)
  })

  it('is still the identity when only a row type differs from its seed', () => {
    const input = base()
    const rows = seeded().map((r) => ({ ...r, type: 'table' as const }))
    const merged = mergeOutputList(PARAM, rows, seeded(), OUTPUT_NAMES, input)

    expect(merged.values).toBe(input.values)
    expect(merged.outputBindings).toBe(input.outputBindings)
    expect(merged.outputSecretFields).toBe(input.outputSecretFields)
  })

  it('writes nothing about the row type', () => {
    const rows = [row('COUNT', 'Counter', false, 'table'), row('HOST', 'HostName', true, 'integer')]
    const merged = mergeOutputList(PARAM, rows, seeded(), OUTPUT_NAMES, base())

    expect(merged.values[PARAM]).toEqual(['COUNT', 'HOST'])
    expect(JSON.stringify(merged)).not.toMatch(/table|integer/)
  })

  it('writes the row names into the parameter, in row order', () => {
    const rows = [row('HOST'), row('COUNT')]
    const merged = mergeOutputList(PARAM, rows, seeded(), OUTPUT_NAMES, base())

    expect(merged.values[PARAM]).toEqual(['HOST', 'COUNT'])
  })

  it('keeps the other stored values', () => {
    const merged = mergeOutputList(PARAM, [], seeded(), OUTPUT_NAMES, base())

    expect(merged.values.script).toBe('echo hi')
  })

  it('omits the parameter when there are no rows and none were stored', () => {
    const input = { ...base(), values: { script: 'echo hi' }, hadStoredKey: false }
    const merged = mergeOutputList(PARAM, [], [], OUTPUT_NAMES, input)

    expect(PARAM in merged.values).toBe(false)
  })

  it('writes an empty list when the last row is removed from a stored list', () => {
    const merged = mergeOutputList(PARAM, [], seeded(), OUTPUT_NAMES, base())

    expect(merged.values[PARAM]).toEqual([])
  })

  it('binds one key per row with a binding', () => {
    const rows = [row('COUNT', 'Counter'), row('HOST', 'HostName')]
    const merged = mergeOutputList(PARAM, rows, seeded(), OUTPUT_NAMES, base())

    expect(merged.outputBindings.COUNT).toBe('Counter')
    expect(merged.outputBindings.HOST).toBe('HostName')
  })

  it('binds no key for an unbound row', () => {
    const merged = mergeOutputList(PARAM, [row('COUNT')], seeded(), OUTPUT_NAMES, base())

    expect('COUNT' in merged.outputBindings).toBe(false)
  })

  it('keeps a binding that names a block output', () => {
    const merged = mergeOutputList(PARAM, [], seeded(), OUTPUT_NAMES, base())

    expect(merged.outputBindings.stdout).toBe('OutText')
  })

  it('drops the binding of a removed row', () => {
    const merged = mergeOutputList(PARAM, [], seeded(), OUTPUT_NAMES, base())

    expect('COUNT' in merged.outputBindings).toBe(false)
  })

  it('marks one secret entry per ticked row', () => {
    const rows = [row('COUNT', 'Counter', true), row('HOST', 'HostName')]
    const merged = mergeOutputList(PARAM, rows, seeded(), OUTPUT_NAMES, base())

    expect(merged.outputSecretFields).toContain('COUNT')
    expect(merged.outputSecretFields).not.toContain('HOST')
  })

  it('keeps a secret entry that names a block output', () => {
    const merged = mergeOutputList(PARAM, [], seeded(), OUTPUT_NAMES, base())

    expect(merged.outputSecretFields).toEqual(['stderr'])
  })

  it('drops the secret entry of an unticked row', () => {
    const merged = mergeOutputList(PARAM, [row('COUNT', 'Counter')], seeded(), OUTPUT_NAMES, base())

    expect(merged.outputSecretFields).not.toContain('COUNT')
  })
})

describe('outputListRowErrors', () => {
  it('returns one entry per row', () => {
    const errors = outputListRowErrors(
      [row('COUNT'), row('HOST')],
      SHELL_SCRIPT_POLICY,
      OUTPUT_NAMES,
    )
    expect(errors).toEqual([undefined, undefined])
  })

  it('rejects a name that fails the pattern', () => {
    expect(outputListRowErrors([row('x y')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES)).toEqual([
      "Invalid script variable name: 'x y'",
    ])
  })

  it('rejects an empty name', () => {
    expect(outputListRowErrors([row('')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES)).toEqual([
      "Invalid script variable name: ''",
    ])
  })

  it('names the row exactly as typed, untrimmed', () => {
    expect(outputListRowErrors([row(' A')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES)).toEqual([
      "Invalid script variable name: ' A'",
    ])
  })

  it('rejects a name that is a block output', () => {
    expect(outputListRowErrors([row('stdout')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES)).toEqual([
      "Script variable 'stdout' has the name of a block output",
    ])
  })

  it('rejects a name that is one of the hidden block outputs', () => {
    expect(
      outputListRowErrors([row('error'), row('reason')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES),
    ).toEqual([
      "Script variable 'error' has the name of a block output",
      "Script variable 'reason' has the name of a block output",
    ])
  })

  it('flags every row of a repeated name', () => {
    expect(
      outputListRowErrors([row('A'), row('B'), row('A')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES),
    ).toEqual([
      "Script variable 'A' is listed more than once",
      undefined,
      "Script variable 'A' is listed more than once",
    ])
  })

  it('flags all three rows of a name used three times', () => {
    expect(
      outputListRowErrors([row('A'), row('A'), row('A')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES),
    ).toEqual([
      "Script variable 'A' is listed more than once",
      "Script variable 'A' is listed more than once",
      "Script variable 'A' is listed more than once",
    ])
  })

  it('does not flag two names that differ only in case', () => {
    expect(
      outputListRowErrors([row('COUNT'), row('count')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES),
    ).toEqual([undefined, undefined])
  })

  it('flags only the name that is exactly repeated', () => {
    expect(
      outputListRowErrors(
        [row('COUNT'), row('count'), row('COUNT')],
        SHELL_SCRIPT_POLICY,
        OUTPUT_NAMES,
      ),
    ).toEqual([
      "Script variable 'COUNT' is listed more than once",
      undefined,
      "Script variable 'COUNT' is listed more than once",
    ])
  })

  it('reports the pattern before the repeat', () => {
    expect(
      outputListRowErrors([row('x y'), row('x y')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES),
    ).toEqual([
      "Invalid script variable name: 'x y'",
      "Invalid script variable name: 'x y'",
    ])
  })

  it('reports the block output before the repeat', () => {
    expect(
      outputListRowErrors([row('stdout'), row('stdout')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES),
    ).toEqual([
      "Script variable 'stdout' has the name of a block output",
      "Script variable 'stdout' has the name of a block output",
    ])
  })
})

describe('outputListFieldErrors', () => {
  const RULE =
    'Name must start with a letter or underscore, and contain only letters, numbers, and underscores'

  it('returns one entry per row', () => {
    expect(
      outputListFieldErrors([row('COUNT'), row('HOST')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES),
    ).toEqual([undefined, undefined])
  })

  it('asks for a name when the name is empty', () => {
    expect(outputListFieldErrors([row('')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES)).toEqual([
      'Name is required',
    ])
  })

  it('states the name rule for a name that fails the pattern, without repeating the name', () => {
    expect(
      outputListFieldErrors([row('x y'), row(' A'), row('1X')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES),
    ).toEqual([RULE, RULE, RULE])
  })

  it('says a block output already has the name', () => {
    expect(
      outputListFieldErrors([row('stdout'), row('reason')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES),
    ).toEqual(['A block output already has this name', 'A block output already has this name'])
  })

  it('says another row has the name, on every row of a repeated name', () => {
    expect(
      outputListFieldErrors([row('A'), row('B'), row('A')], SHELL_SCRIPT_POLICY, OUTPUT_NAMES),
    ).toEqual([
      'Another variable export has this name',
      undefined,
      'Another variable export has this name',
    ])
  })

  it('keeps the check order: empty, pattern, block output, repeat', () => {
    expect(
      outputListFieldErrors(
        [row(''), row(''), row('x y'), row('x y'), row('stdout'), row('stdout')],
        SHELL_SCRIPT_POLICY,
        OUTPUT_NAMES,
      ),
    ).toEqual([
      'Name is required',
      'Name is required',
      RULE,
      RULE,
      'A block output already has this name',
      'A block output already has this name',
    ])
  })
})

describe('outputListNodeIssues', () => {
  it('raises no issue for valid names', () => {
    const issues = outputListNodeIssues(
      shellScriptSchema(),
      { [PARAM]: ['COUNT', 'HOST'] },
      OUTPUT_NAMES,
    )
    expect(issues).toEqual([])
  })

  it('raises one issue per offending row, in row order', () => {
    const issues = outputListNodeIssues(
      shellScriptSchema(),
      { [PARAM]: ['x y', 'COUNT', 'stdout'] },
      OUTPUT_NAMES,
    )
    expect(issues).toEqual([
      {
        code: 'OUTPUT_LIST_NAME',
        severity: 'error',
        paramName: PARAM,
        message: "Invalid script variable name: 'x y'",
      },
      {
        code: 'OUTPUT_LIST_NAME',
        severity: 'error',
        paramName: PARAM,
        message: "Script variable 'stdout' has the name of a block output",
      },
    ])
  })

  it('raises one issue per colliding row of a repeated name', () => {
    const issues = outputListNodeIssues(shellScriptSchema(), { [PARAM]: ['A', 'A'] }, OUTPUT_NAMES)

    expect(issues).toEqual([
      {
        code: 'OUTPUT_LIST_NAME',
        severity: 'error',
        paramName: PARAM,
        message: "Script variable 'A' is listed more than once",
      },
      {
        code: 'OUTPUT_LIST_NAME',
        severity: 'error',
        paramName: PARAM,
        message: "Script variable 'A' is listed more than once",
      },
    ])
  })

  it('checks a non-string item by its string form', () => {
    const issues = outputListNodeIssues(shellScriptSchema(), { [PARAM]: [3] }, OUTPUT_NAMES)

    expect(issues).toEqual([
      {
        code: 'OUTPUT_LIST_NAME',
        severity: 'error',
        paramName: PARAM,
        message: "Invalid script variable name: '3'",
      },
    ])
  })

  it('raises no issue for a stored value that is not an array', () => {
    expect(outputListNodeIssues(shellScriptSchema(), { [PARAM]: 'COUNT' }, OUTPUT_NAMES)).toEqual([])
    expect(outputListNodeIssues(shellScriptSchema(), { [PARAM]: null }, OUTPUT_NAMES)).toEqual([])
  })

  it('raises no issue when the parameter was never stored', () => {
    expect(outputListNodeIssues(shellScriptSchema(), {}, OUTPUT_NAMES)).toEqual([])
  })

  it('raises no issue for a schema that declares no output list', () => {
    const schema = [{ name: 'command', type: 'string', required: true }]

    expect(outputListNodeIssues(schema, { [PARAM]: ['stdout'] }, OUTPUT_NAMES)).toEqual([])
  })
})

describe('outputListNodeIssues - severity', () => {
  it('marks a name error an error, so it still blocks the block', () => {
    const issues = outputListNodeIssues(shellScriptSchema(), { [PARAM]: ['x y'] }, OUTPUT_NAMES)

    expect(issues.map((issue) => issue.severity)).toEqual(['error'])
  })

  it('marks every name error of a repeated name an error', () => {
    const issues = outputListNodeIssues(shellScriptSchema(), { [PARAM]: ['A', 'A'] }, OUTPUT_NAMES)

    expect(issues.map((issue) => issue.severity)).toEqual(['error', 'error'])
  })
})

describe('outputListNodeIssues - unassigned exports (PYRUN-14)', () => {
  it('warns about an export the script never assigns', () => {
    const issues = outputListNodeIssues(
      pythonSchema(),
      sourceValues('x = 1\n', ['COUNT']),
      OUTPUT_NAMES,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0].paramName).toBe(PARAM)
    expect(issues[0].message).toBe("Script never sets 'COUNT'")
  })

  it('leaves the warning a warning, so it never marks the block invalid', () => {
    const issues = outputListNodeIssues(
      pythonSchema(),
      sourceValues('x = 1\n', ['COUNT']),
      OUTPUT_NAMES,
    )

    expect(issues.map((issue) => issue.severity)).toEqual(['warning'])
  })

  it('warns once per unassigned row, in row order', () => {
    const issues = outputListNodeIssues(
      pythonSchema(),
      sourceValues('x = 1\n', ['COUNT', 'TOTAL']),
      OUTPUT_NAMES,
    )

    expect(issues.map((issue) => issue.message)).toEqual([
      "Script never sets 'COUNT'",
      "Script never sets 'TOTAL'",
    ])
  })

  it('raises no warning for an export the script assigns at top level', () => {
    expect(
      outputListNodeIssues(pythonSchema(), sourceValues('COUNT = 1\n', ['COUNT']), OUTPUT_NAMES),
    ).toEqual([])
  })

  it('counts a tuple target as an assignment', () => {
    expect(
      outputListNodeIssues(
        pythonSchema(),
        sourceValues('COUNT, HOST = 1, "h"\n', ['COUNT', 'HOST']),
        OUTPUT_NAMES,
      ),
    ).toEqual([])
  })

  it('counts an indented assignment', () => {
    expect(
      outputListNodeIssues(
        pythonSchema(),
        sourceValues('if True:\n    COUNT = 1\n', ['COUNT']),
        OUTPUT_NAMES,
      ),
    ).toEqual([])
  })

  it('does not count an assignment that only appears inside a string', () => {
    const script = 'DOC = """\nCOUNT = 1\n"""\n'
    const issues = outputListNodeIssues(pythonSchema(), sourceValues(script, ['COUNT']), OUTPUT_NAMES)

    expect(issues.map((issue) => issue.message)).toEqual(["Script never sets 'COUNT'"])
  })

  it('reads a quote of the other kind as part of the string, not as a new one', () => {
    const script = 'DOC = "it\'s here"\nCOUNT = 2\n'

    expect(
      outputListNodeIssues(pythonSchema(), sourceValues(script, ['COUNT']), OUTPUT_NAMES),
    ).toEqual([])
  })

  it('does not count an assignment inside a string that quotes the other kind', () => {
    const script = 'DOC = \'say "COUNT = 1"\'\nTOTAL = 2\n'
    const issues = outputListNodeIssues(
      pythonSchema(),
      sourceValues(script, ['COUNT', 'TOTAL']),
      OUTPUT_NAMES,
    )

    expect(issues.map((issue) => issue.message)).toEqual(["Script never sets 'COUNT'"])
  })

  it('does not count an assignment inside a string that escapes its own quote', () => {
    const script = 'DOC = "esc \\" COUNT = 1"\n'
    const issues = outputListNodeIssues(
      pythonSchema(),
      sourceValues(script, ['COUNT']),
      OUTPUT_NAMES,
    )

    expect(issues.map((issue) => issue.message)).toEqual(["Script never sets 'COUNT'"])
  })

  it('does not count an assignment to a name that merely starts with the export name', () => {
    const issues = outputListNodeIssues(
      pythonSchema(),
      sourceValues('COUNTER = 1\n', ['COUNT']),
      OUTPUT_NAMES,
    )

    expect(issues.map((issue) => issue.message)).toEqual(["Script never sets 'COUNT'"])
  })

  it('raises no warning in File mode', () => {
    const values = {
      script_type: 'file',
      script_file: 'testdata://job.py',
      script: 'x = 1\n',
      [PARAM]: ['COUNT'],
    }

    expect(outputListNodeIssues(pythonSchema(), values, OUTPUT_NAMES)).toEqual([])
  })

  it('raises no warning for an output list that names no body', () => {
    expect(
      outputListNodeIssues(
        shellScriptSchema(),
        { script_type: 'source', script: 'echo hi', [PARAM]: ['COUNT'] },
        OUTPUT_NAMES,
      ),
    ).toEqual([])
  })

  it('reports the name error and never the warning for an unusable name', () => {
    const issues = outputListNodeIssues(
      pythonSchema(),
      sourceValues('x = 1\n', ['x y']),
      OUTPUT_NAMES,
    )

    expect(issues.map((issue) => issue.message)).toEqual(["Invalid script variable name: 'x y'"])
  })
})
