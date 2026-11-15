/**
 * The control structure rules the window holds Save on and the canvas lists, worded as the save check
 * words them, and the window lines the field list cannot express.
 *
 * REQ-3.5.0.3, REQ-3.5.1.1, REQ-3.5.1.20, REQ-3.1.1.3, REQ-3.5.1.15, REQ-3.5.1.17
 */

import { describe, it, expect } from 'vitest'

import { controlFieldMessages, controlProblems } from '@/features/workbench/lib/validation/control-checks'

type Item = Record<string, unknown>

/** A literal row; a field left out is not stored (an unset compare value has no key). */
function literal(fields: Item = {}): Item {
  return { id: 'row', type: 'literal', variable: 'status', value_type: 'string', operator: 'equals', ...fields }
}

const DONE = literal({ reference_value: 'ready' })
const AND: Item = { type: 'operator', value: 'and' }

function lanes(...limits: Item[]): Item[] {
  return limits.map((extra, index) => ({ id: `lane_${index}`, name: `Lane ${index}`, ...extra }))
}

function ifElse(ifConditions: Item[], elseIfConditions?: Item[]): Item {
  const branches: Item[] = [{ id: 'b0', type: 'if', label: '', conditions: ifConditions }]
  if (elseIfConditions) branches.push({ id: 'b1', type: 'else_if', label: '', conditions: elseIfConditions })
  branches.push({ id: 'b9', type: 'else', label: '' })
  return { branches }
}

describe('controlProblems - an empty top-level list belongs to the shared required rule', () => {
  it.each<[string, Item]>([
    ['assert', { assertions: [], mode: 'split' }],
    ['assert', { mode: 'split' }],
    ['while', { mode: 'while-do', conditions: [] }],
    ['wait-until', { conditions: [], timeout: 5000 }],
    ['if-else', { branches: [] }],
    ['switch-case', { branches: [] }],
  ])('reports nothing for a %s Block with no list rows (%j)', (elementType, values) => {
    expect(controlProblems(elementType, values, [])).toEqual([])
  })
})

describe('controlProblems - incomplete condition rows, worded as the save check', () => {
  it('names a row with no variable key as missing', () => {
    const row = literal({ reference_value: 'ready' })
    delete row.variable

    expect(controlProblems('assert', { assertions: [row] }, [])).toEqual([
      { field: 'assertions.0.variable', message: "Required parameter 'assertions.0.variable' is missing" },
    ])
  })

  it('names a row with a blank variable as empty', () => {
    expect(controlProblems('assert', { assertions: [literal({ variable: '', reference_value: 'ready' })] }, [])).toEqual([
      { field: 'assertions.0.variable', message: "Required parameter 'assertions.0.variable' is empty" },
    ])
  })

  // The canvas lists every finding the save check gives for a row, the variable first.
  it('names the variable and the compare value of a fresh row, as Save does', () => {
    expect(controlProblems('assert', { assertions: [literal({ variable: '' })] }, [])).toEqual([
      { field: 'assertions.0.variable', message: "Required parameter 'assertions.0.variable' is empty" },
      { field: 'assertions.0.reference_value', message: "Required parameter 'assertions.0.reference_value' is missing" },
    ])
  })

  it.each<[string, Item]>([
    ['no compare value key', {}],
    ['a null compare value', { reference_value: null }],
  ])('names %s under a binary operator as missing', (_case, fields) => {
    expect(controlProblems('assert', { assertions: [literal(fields)] }, [])).toEqual([
      { field: 'assertions.0.reference_value', message: "Required parameter 'assertions.0.reference_value' is missing" },
    ])
  })

  it.each<[string, Item]>([
    ['a blank {x} value', { reference_value: '   ', reference_is_expression: true }],
    ['a blank Template', { reference_value: '', reference_is_template: true }],
    ['empty text on a number compare', { variable: 'count', value_type: 'integer', reference_value: '' }],
  ])('names %s under a binary operator as empty', (_case, fields) => {
    expect(controlProblems('assert', { assertions: [literal(fields)] }, [])).toEqual([
      { field: 'assertions.0.reference_value', message: "Required parameter 'assertions.0.reference_value' is empty" },
    ])
  })

  // Empty text typed on purpose is a value and compares with empty text (FIELD-4, FIELD-15).
  it.each(['', '   '])('takes literal text on a text compare as a value, empty text included (%j)', (text) => {
    expect(controlProblems('assert', { assertions: [literal({ reference_value: text })] }, [])).toEqual([])
  })

  it('names an integer compare value the number rule refuses with the save check text', () => {
    const row = literal({ variable: 'count', value_type: 'integer', reference_value: 'abc' })

    expect(controlProblems('assert', { assertions: [row] }, [])).toEqual([
      { field: 'assertions.0.reference_value', message: "The value compared with 'count' is not a valid integer" },
    ])
  })

  it('names a float compare value the number rule refuses with the save check text', () => {
    const row = literal({ variable: 'ratio', value_type: 'float', reference_value: 'abc' })

    expect(controlProblems('while', { conditions: [row] }, [])).toEqual([
      { field: 'conditions.0.reference_value', message: "The value compared with 'ratio' is not a valid float" },
    ])
  })

  it('names a filter compare value the number rule refuses as the cell', () => {
    const row = literal({ variable: '_cell', value_type: 'integer', reference_value: 'abc' })
    const values = { filters: [{ id: 'f0', column: { mode: 'name', value: 'qty' }, asType: 'integer', conditions: [row] }] }

    expect(controlProblems('csv-parser', values, [])).toEqual([
      { field: 'filters.0.conditions.0.reference_value', message: 'The value compared with the cell is not a valid integer' },
    ])
  })

  it('names a blank expression row as empty', () => {
    const values = { conditions: [{ id: 'e0', type: 'expression', expression: '  ' }], timeout: 5000 }

    expect(controlProblems('wait-until', values, [])).toEqual([
      { field: 'conditions.0.expression', message: "Required parameter 'conditions.0.expression' is empty" },
    ])
  })

  it('names an empty group as empty', () => {
    expect(controlProblems('assert', { assertions: [DONE, AND, { id: 'g0', type: 'group', items: [] }] }, [])).toEqual([
      { field: 'assertions.2.items', message: "Required parameter 'assertions.2.items' is empty" },
    ])
  })

  it('names a row inside a group by its place in the group, AND / OR items counted', () => {
    const values = {
      assertions: [{ id: 'g0', type: 'group', items: [DONE, AND, literal({ variable: '', reference_value: 'ready' })] }],
    }

    expect(controlProblems('assert', values, [])).toEqual([
      { field: 'assertions.0.items.2.variable', message: "Required parameter 'assertions.0.items.2.variable' is empty" },
    ])
  })

  it('reports the findings in list order', () => {
    const values = {
      assertions: [
        DONE,
        AND,
        literal({ variable: '', reference_value: 'ready' }),
        AND,
        { id: 'e0', type: 'expression', expression: '' },
      ],
    }

    expect(controlProblems('assert', values, [])).toEqual([
      { field: 'assertions.2.variable', message: "Required parameter 'assertions.2.variable' is empty" },
      { field: 'assertions.4.expression', message: "Required parameter 'assertions.4.expression' is empty" },
    ])
  })

  it('reaches the rows of If and Else If branches and of Switch cases', () => {
    const blank = literal({ reference_value: '', reference_is_expression: true })

    expect(controlProblems('if-else', ifElse([DONE], [blank]), [])).toEqual([
      {
        field: 'branches.1.conditions.0.reference_value',
        message: "Required parameter 'branches.1.conditions.0.reference_value' is empty",
      },
    ])
    expect(
      controlProblems('switch-case', { branches: [{ id: 'c0', type: 'case', label: '', conditions: [blank], break: true }] }, []),
    ).toEqual([
      {
        field: 'branches.0.conditions.0.reference_value',
        message: "Required parameter 'branches.0.conditions.0.reference_value' is empty",
      },
    ])
  })

  it.each<[string, Item]>([
    ['assert', { assertions: [DONE], mode: 'split' }],
    ['while', { mode: 'while-do', conditions: [DONE] }],
    ['wait-until', { conditions: [DONE, AND, { id: 'e0', type: 'expression', expression: 'ok' }], timeout: 5000 }],
    ['if-else', ifElse([DONE], [DONE])],
  ])('reports nothing for a complete %s Block', (elementType, values) => {
    expect(controlProblems(elementType, values, [])).toEqual([])
  })

  it('asks no value under an operator that takes none', () => {
    const row = literal({ variable: 'done', value_type: 'boolean', operator: 'is_true' })

    expect(controlProblems('assert', { assertions: [row] }, [])).toEqual([])
  })

  it('names an integer compare value over the digit cap with the save check text', () => {
    const row = literal({ variable: 'count', value_type: 'integer', reference_value: '12345678901234567890' })

    expect(controlProblems('assert', { assertions: [row] }, [])).toEqual([
      { field: 'assertions.0.reference_value', message: "The value compared with 'count' allows at most 19 digits, got 20" },
    ])
  })

  it('names a float compare value over the significant digit cap with the save check text', () => {
    const row = literal({ variable: 'ratio', value_type: 'float', reference_value: `0.${'1'.repeat(29)}` })

    expect(controlProblems('while', { conditions: [row] }, [])).toEqual([
      {
        field: 'conditions.0.reference_value',
        message: "The value compared with 'ratio' allows at most 28 significant digits, got 29",
      },
    ])
  })
})

// Stored data the window never writes: the check names what Save names and passes over what it cannot read.
describe('controlProblems - condition items the window never writes', () => {
  it('names an expression row with no expression key as missing', () => {
    const values = { conditions: [{ id: 'e0', type: 'expression' }], timeout: 5000 }

    expect(controlProblems('wait-until', values, [])).toEqual([
      { field: 'conditions.0.expression', message: "Required parameter 'conditions.0.expression' is missing" },
    ])
  })

  it.each<[string, Item]>([
    ['no item list', { id: 'g0', type: 'group' }],
    ['an item list that is not a list', { id: 'g0', type: 'group', items: 'ready' }],
  ])('names a group with %s as empty', (_case, groupItem) => {
    expect(controlProblems('assert', { assertions: [groupItem] }, [])).toEqual([
      { field: 'assertions.0.items', message: "Required parameter 'assertions.0.items' is empty" },
    ])
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['text', 'status == 200'],
    ['a list', [DONE]],
    ['an item of a type the check does not know', { id: 'x0', type: 'note', text: 'later' }],
  ])('passes over %s between two joined conditions', (_case, item) => {
    expect(controlProblems('assert', { assertions: [DONE, AND, item] }, [])).toEqual([])
  })
})

// REQ-3.5.1.5: rows are joined by AND / OR; a stored list that does not alternate gets one finding at its first break.
describe('controlProblems - condition items joined by and / or, worded as the save check', () => {
  const OR: Item = { type: 'operator', value: 'or' }
  const STRAY_JOIN = "'and' and 'or' go between two conditions"
  const notJoined = (place: string) => `Condition items in '${place}' must be joined by 'and' or 'or'`
  const second = literal({ id: 'row-2', reference_value: 'done' })
  const third = literal({ id: 'row-3', reference_value: 'gone' })
  const cell = (id: string): Item =>
    literal({ id, variable: '_cell', value_type: 'integer', operator: 'greater_than', reference_value: '5' })
  const filterOf = (conditions: Item[]): Item => ({
    id: 'f0',
    column: { mode: 'name', value: 'qty' },
    asType: 'integer',
    conditions,
  })

  it.each<[string, string, Item, string, string]>([
    ['at the top level', 'while', { mode: 'while-do', conditions: [DONE, second, third] }, 'conditions', 'conditions.1'],
    [
      'inside a group',
      'assert',
      { assertions: [DONE, AND, { id: 'g0', type: 'group', items: [second, third] }], mode: 'split' },
      'assertions.2.items',
      'assertions.2.items.1',
    ],
    ['in an If branch', 'if-else', ifElse([DONE, second]), 'branches.0.conditions', 'branches.0.conditions.1'],
    [
      'in a filter',
      'csv-parser',
      { filters: [filterOf([cell('c1'), cell('c2')])] },
      'filters.0.conditions',
      'filters.0.conditions.1',
    ],
  ])('names condition items side by side %s once, at the second item', (_case, elementType, values, place, field) => {
    expect(controlProblems(elementType, values, [])).toEqual([{ field, message: notJoined(place) }])
  })

  it.each<[string, Item[], string]>([
    ['first', [AND, DONE], 'conditions.0'],
    ['last', [DONE, OR], 'conditions.1'],
    ['next to another marker', [DONE, AND, OR, second], 'conditions.2'],
  ])('names an and / or marker %s once, at that marker', (_case, conditions, field) => {
    expect(controlProblems('wait-until', { conditions, timeout: 5000 }, [])).toEqual([{ field, message: STRAY_JOIN }])
  })

  it('reports nothing for a list joined at every depth', () => {
    const values = {
      assertions: [
        DONE,
        AND,
        { id: 'g0', type: 'group', items: [second, OR, third] },
        OR,
        { id: 'e0', type: 'expression', expression: 'count > 1' },
      ],
      mode: 'split',
    }

    expect(controlProblems('assert', values, [])).toEqual([])
    expect(controlProblems('csv-parser', { filters: [filterOf([cell('c1'), AND, cell('c2')])] }, [])).toEqual([])
  })
})

describe('controlProblems - If / Else and Switch branches with no row', () => {
  it('names an If branch with no row', () => {
    expect(controlProblems('if-else', ifElse([]), [])).toEqual([
      { field: 'branches.0.conditions', message: 'if branch must have conditions' },
    ])
  })

  it('names an Else If branch with no row', () => {
    expect(controlProblems('if-else', ifElse([DONE], []), [])).toEqual([
      { field: 'branches.1.conditions', message: 'else_if branch must have conditions' },
    ])
  })

  it('names a Switch case with no row and leaves the default alone', () => {
    const values = {
      branches: [
        { id: 'c0', type: 'case', label: '', conditions: [DONE], break: true },
        { id: 'c1', type: 'case', label: '', conditions: [], break: true },
        { id: 'd0', type: 'default', label: '' },
      ],
    }

    expect(controlProblems('switch-case', values, [])).toEqual([
      { field: 'branches.1.conditions', message: 'case branch must have conditions' },
    ])
  })

  it('asks no row of a stored branch that is not an object or names no branch type', () => {
    const values = {
      branches: [
        null,
        'if',
        { id: 'b2', label: '', conditions: [] },
        { id: 'b3', type: 7, label: '', conditions: [] },
        { id: 'b4', type: 'else_if', label: '', conditions: [] },
      ],
    }

    expect(controlProblems('if-else', values, [])).toEqual([
      { field: 'branches.4.conditions', message: 'else_if branch must have conditions' },
    ])
  })
})

describe('controlProblems - Parallel lanes', () => {
  it('names a section with one lane', () => {
    expect(controlProblems('parallel', { branches: lanes({}), join: 'all' }, [])).toEqual([
      { field: 'branches', message: 'Parallel requires at least 2 branches' },
    ])
  })

  // The two-lane rule reads any value that is not a list of two lanes, as the save check does.
  it.each<[string, Item]>([
    ['no lanes', { branches: [], join: 'all' }],
    ['no lane list', { join: 'all' }],
  ])('names a section with %s as fewer than two lanes', (_case, values) => {
    expect(controlProblems('parallel', values, [])).toEqual([
      { field: 'branches', message: 'Parallel requires at least 2 branches' },
    ])
  })

  it('reports nothing for two lanes with no limit, a null limit or a limit of 1', () => {
    expect(controlProblems('parallel', { branches: lanes({}, { time_limit: null }) }, [])).toEqual([])
    expect(controlProblems('parallel', { branches: lanes({ time_limit: 1 }, { time_limit: 30000 }) }, [])).toEqual([])
  })

  it.each<[string, unknown]>([
    ['0', 0],
    ['-5', -5],
    ['the digit text 0', '0'],
  ])('names a literal lane limit of %s with the lane bound text', (_case, limit) => {
    expect(controlProblems('parallel', { branches: lanes({ time_limit: 30000 }, { time_limit: limit }) }, [])).toEqual([
      { field: 'branches.1.time_limit', message: 'Time Limit must be at least 1' },
    ])
  })

  it.each(['', '   '])('names a blank {x} lane limit (%j)', (text) => {
    expect(
      controlProblems('parallel', { branches: lanes({ time_limit: text }, {}) }, ['branches.0.time_limit']),
    ).toEqual([
      { field: 'branches.0.time_limit', message: "Required parameter 'branches.0.time_limit' is empty" },
    ])
  })

  it.each<[string, Item]>([
    ['no limit key', {}],
    ['a null limit', { time_limit: null }],
  ])('names an {x} lane limit with %s as empty', (_case, lane) => {
    expect(controlProblems('parallel', { branches: lanes(lane, {}) }, ['branches.0.time_limit'])).toEqual([
      { field: 'branches.0.time_limit', message: "Required parameter 'branches.0.time_limit' is empty" },
    ])
  })

  it('passes over a stored lane that is not an object, counting it toward the two lanes', () => {
    expect(controlProblems('parallel', { branches: [null, 'probe', { id: 'lane_2', time_limit: 0 }] }, [])).toEqual([
      { field: 'branches.2.time_limit', message: 'Time Limit must be at least 1' },
    ])
  })

  it('skips a lane limit held as {x}, whatever it holds', () => {
    const flags = ['branches.0.time_limit', 'branches.1.time_limit']

    expect(controlProblems('parallel', { branches: lanes({ time_limit: 'limit_ms' }, { time_limit: '0' }) }, flags)).toEqual([])
  })
})

describe('controlProblems - For step and the declared floors', () => {
  it('names a literal step of 0', () => {
    expect(controlProblems('for', { mode: 'count', count: 3, step: 0 }, [])).toEqual([
      { field: 'step', message: 'Step must not be zero' },
    ])
  })

  it('skips a step held as {x}', () => {
    expect(controlProblems('for', { mode: 'count', count: 3, step: '0' }, ['step'])).toEqual([])
  })

  it('reports nothing for a step of 2 or a step left at its default', () => {
    expect(controlProblems('for', { mode: 'count', count: 3, step: 2 }, [])).toEqual([])
    expect(controlProblems('for', { mode: 'count', count: 3 }, [])).toEqual([])
  })

  it('leaves the For count and While max iterations floors to the declared minimum', () => {
    expect(controlProblems('for', { mode: 'count', count: -1, step: 1 }, [])).toEqual([])
    expect(controlProblems('while', { mode: 'while-do', conditions: [DONE], max_iterations: 0 }, [])).toEqual([])
    expect(controlProblems('parallel', { branches: lanes({}, {}), time_limit: 0 }, [])).toEqual([])
  })

  it('reports nothing for a Block with no control rules', () => {
    expect(controlProblems('log', { message: '' }, [])).toEqual([])
  })
})

describe('controlFieldMessages - the window lines the field list cannot express', () => {
  it('gives the For step row its line at 0', () => {
    expect(controlFieldMessages('for', { mode: 'count', count: 3, step: 0 }, [])).toEqual({ step: 'Step must not be zero' })
  })

  it('gives no step line for a step of 1 or a step held as {x}', () => {
    expect(controlFieldMessages('for', { mode: 'count', count: 3, step: 1 }, [])).toEqual({})
    expect(controlFieldMessages('for', { mode: 'count', count: 3, step: '0' }, ['step'])).toEqual({})
  })

  it('gives a blank {x} lane limit its required line at the lane place', () => {
    expect(
      controlFieldMessages('parallel', { branches: lanes({}, { time_limit: '' }) }, ['branches.1.time_limit']),
    ).toEqual({ 'branches.1.time_limit': 'Time Limit is required' })
  })

  it('leaves a set {x} lane limit and the literal lane floor to the cell', () => {
    expect(
      controlFieldMessages('parallel', { branches: lanes({ time_limit: 'limit_ms' }, {}) }, ['branches.0.time_limit']),
    ).toEqual({})
    expect(controlFieldMessages('parallel', { branches: lanes({ time_limit: 0 }, {}) }, [])).toEqual({})
  })

  it('gives no lane line for a stored lane that is not an object or a lane list that is not a list', () => {
    expect(controlFieldMessages('parallel', { branches: [null, {}] }, ['branches.0.time_limit'])).toEqual({})
    expect(controlFieldMessages('parallel', { branches: 'lanes' }, ['branches.0.time_limit'])).toEqual({})
  })

  it('leaves the condition row lines to the rows', () => {
    expect(controlFieldMessages('assert', { assertions: [literal({ variable: '' })] }, [])).toEqual({})
  })
})
