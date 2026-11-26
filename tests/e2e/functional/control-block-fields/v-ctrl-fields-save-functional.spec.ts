/**
 * V-CTRL-FIELDS-SAVE: the one save check refuses broken control Blocks with the run's own texts
 * Design Decisions: FIELDERR-1, FIELDERR-2, FIELDERR-3, CSV-12
 * REQ: REQ-3.5.0.3, REQ-3.5.1.5, REQ-3.1.3.19
 *
 * Inline bodies, no fixture: each case is one control Block wired from Start, named `zz-ctrl-fields-save-<n>`.
 *
 * Pass Criteria:
 * 1. `POST /tests` with an `if` that has no condition answers 422 `if branch must have conditions`.
 * 2. A Switch with no case, a Parallel with one lane, a lane limit of 0 and a For step of 0 are refused with
 *    `at least one case branch is required`, `Parallel requires at least 2 branches`, `Parallel branch time limit
 *    must be a positive integer` and `step must not be zero`; a While max of 0 and a section limit of 0 with the
 *    shared floor texts `Setting 'max_iterations' of block 'while' must be at least 1, got 0` and
 *    `Setting 'time_limit' of block 'parallel' must be at least 1, got 0`.
 * 3. A condition row with no variable: `Required parameter 'branches.0.conditions.0.variable' is missing`.
 * 4. A Template on an integer compare value: `TEMPLATE_NOT_STRING` `The value compared with 'count' is integer; a
 *    template builds text, so it needs type string`.
 * 5. An undeclared name in a condition variable, a compare value {x}, an expression item, a filter item and a Setter
 *    {x} row: `Variable 'ghost' is used in 1 block(s) but not declared in variable manager`.
 * 6. A compare value {x} that changes data is refused with `EXPRESSION_CHANGES_DATA` naming the Block and the
 *    field; an export of a valid Test holding it is blocked at `POST /tests/import/validate` and refused at
 *    `POST /tests/import` with `Cannot import test '<name>'. The append method changes data. ...`.
 * 7. An unknown element type in a Setter row record: `INVALID_ELEMENT_TYPES` `Invalid element types for setting
 *    'variables.limits' of block 'variable-setter': unknown element type 'decimal' for key 'max' (must be one of:
 *    array, boolean, float, integer, map, string)`.
 * 8. `POST /tests/{id}/validate?context=load` with an unsaved broken workflow lists the `REQUIRED_PARAM_*` items
 *    as warnings and none as errors; `context=run` lists them as errors.
 * 9. A Function save with a blank {x} Setter row is refused: 422 `Function has 1 validation error(s)`.
 * 10. In the workbench, a compare value {x} `errors.append(1)` shows only the amber finding and the window saves;
 *    the Test Save shows `Cannot Save Test` with the backend's `EXPRESSION_CHANGES_DATA` text and stores nothing.
 * 11. A CSV filter item on an operator its column's type does not offer (`contains` on an integer column) is
 *    refused with the run's own text: `INVALID_CONDITION` `Unknown filter operator: 'contains'`.
 * 12. A place marked both expression and Template (a Log message, a Setter row, a Setter list entry) is refused:
 *    `INVALID_SETTING_VALUE` `Setting '<place>' of block '<block>' cannot be both an expression and a template`.
 * 13. A Parallel whose two lanes share one id: `INVALID_CONTROL_STRUCTURE` `duplicate branch id: 'lane-1'`.
 * 14. A Break in no loop body: `BREAK_OUTSIDE_LOOP` `break/continue is only valid inside a loop body`; a Continue
 *    in a For body aimed at a loop that does not hold it: `BREAK_OUTSIDE_LOOP`
 *    `break/continue target 'loop-b' is not an enclosing loop`.
 * 15. A key a condition item, a branch or a lane does not hold is refused at its place: `UNKNOWN_SETTING`
 *    `Block 'if-else' has no setting 'branches.0.conditions.0.shade'` and `Block 'parallel' has no setting
 *    'branches.1.shade'`.
 * 16. A For `step` given null: `INVALID_SETTING_VALUE` `Setting 'step' of block 'for' cannot be null`.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { openConditionBody, referenceToggle } from '../../helpers/condition-builder'
import { settingsNote, saveButton } from '../../helpers/config-sheet'
import { replaceCode } from '../../helpers/fn-block'
import { openTest, validateTest } from '../../helpers/fn-seed'
import {
  createTest,
  deleteFunctionQuietly,
  deleteTestQuietly,
  expectTestRefused,
  functionBody,
  postJson,
  storedNode,
  type Finding,
} from '../../helpers/number-rule'
import { switchWarning } from '../../helpers/value-field'
import { openBlockSheet, saveBlockSheet, saveBtn } from '../../helpers/workbench'

type Json = Record<string, any>

const CHECK = 'Check status'
const READ_ONLY =
  'The append method changes data. An expression can only read data, not change it. ' +
  'To change a variable, add a Variable Setter Block.'
const COMPARE_FIELD = 'branches.0.conditions.0.reference_value'
const GHOST: Finding = ['UNDECLARED_VARIABLE', "Variable 'ghost' is used in 1 block(s) but not declared in variable manager"]

const COUNT = { count: { type: 'integer', value: 0, scope: 'test' } }
const STATUS = {
  status: { type: 'string', value: 'ready', scope: 'test' },
  errors: { type: 'array', value: [], scope: 'test', elementTypes: [] },
}

const token = (): string => `${Date.now()}-${randomUUID().slice(0, 6)}`

function controlNode(elementType: string, values: Json, data: Json = {}, nodeType = 'control'): Json {
  return {
    id: 'ctl',
    type: 'workflowNode',
    position: { x: 300, y: 160 },
    data: {
      label: CHECK,
      elementType,
      nodeType,
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      config: { values, outputBindings: {}, profileBindings: [] },
      ...data,
    },
  }
}

function logNode(id: string, message: string): Json {
  return {
    id,
    type: 'workflowNode',
    position: { x: 300, y: 300 },
    data: {
      label: id,
      elementType: 'log',
      nodeType: 'plugin',
      version: '1.0.0',
      expressionFields: ['message'],
      templateFields: [],
      config: { values: { message, level: 'INFO' }, outputBindings: {}, profileBindings: [] },
    },
  }
}

/** A Test body whose first node is wired from Start; `edges` wire the rest. */
function testBody(n: number, nodes: Json[], variables: Json = {}, edges: Json[] = []): Json {
  return {
    name: `zz-ctrl-fields-save-${n}-${token()}`,
    version: '1.0.0',
    description: 'Control field save probe',
    workflow: { nodes, edges: [{ id: 'e-start', source: 'start-node', target: nodes[0].id }, ...edges] },
    variables,
    metadata: {},
  }
}

function literal(variable: string, valueType: string, operator: string, reference?: unknown, flags: Json = {}): Json {
  const item: Json = { id: 'c1', type: 'literal', variable, value_type: valueType, operator, ...flags }
  if (reference !== undefined) item.reference_value = reference
  return item
}

function ifElse(conditions: Json[]): Json {
  return controlNode('if-else', {
    branches: [
      { id: 'b-if', type: 'if', label: '', conditions },
      { id: 'b-else', type: 'else', label: '' },
    ],
  })
}

function lanes(...limits: Array<number | null>): Json[] {
  return limits.map((limit, index) => {
    const lane: Json = { id: `lane-${index + 1}`, name: `Lane ${index + 1}` }
    if (limit !== null) lane.time_limit = limit
    return lane
  })
}

function setter(rows: Json, data: Json = {}): Json {
  return controlNode('variable-setter', { variables: rows }, data)
}

function csvParser(conditions: Json[]): Json {
  return controlNode(
    'csv-parser',
    {
      operation: 'parse',
      csv_content: 'amount\n1\n',
      filters: [{ id: 'flt-1', column: { mode: 'name', value: 'amount' }, asType: 'integer', conditions }],
    },
    {},
    'plugin',
  )
}

/** A node with `place` in both its expression and its Template marks. */
function bothMarks(node: Json, place: string): Json {
  return { ...node, data: { ...node.data, expressionFields: [place], templateFields: [place] } }
}

function withId(node: Json, id: string): Json {
  return { ...node, id }
}

function bothMarksFinding(place: string, block: string): Finding {
  return ['INVALID_SETTING_VALUE', `Setting '${place}' of block '${block}' cannot be both an expression and a template`]
}

/** The `code` and `message` of each entry of a findings list. */
function findingsOf(entries: Json[]): Finding[] {
  return entries.map((entry) => [String(entry.code), String(entry.message)] as Finding)
}

function requiredParts(entries: Json[]): Finding[] {
  return findingsOf(entries.filter((entry) => String(entry.code).startsWith('REQUIRED_PARAM_'))).sort()
}

async function testsNamed(request: APIRequestContext, name: string): Promise<Json[]> {
  const response = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}&per_page=100`)
  expect(response.status(), 'GET /tests answered').toBe(200)
  return ((await response.json()).data as Json[]).filter((entry) => entry.name === name)
}

test.describe('V-CTRL-FIELDS-SAVE: control Blocks the save check refuses', () => {
  const tests: string[] = []
  const functions: string[] = []

  test.beforeEach(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of tests.splice(0)) await deleteTestQuietly(request, id)
    for (const id of functions.splice(0)) await deleteFunctionQuietly(request, id)
  })

  test('POST /tests refuses control structure, condition rows, undeclared names and element types with exact texts', async ({
    request,
  }) => {
    test.setTimeout(120_000)
    const cases: Array<[string, Json, Finding[]]> = [
      ['1. an if with no condition', testBody(1, [ifElse([])]), [['REQUIRED_PARAM_EMPTY', 'if branch must have conditions']]],
      [
        '2. a Switch with no case',
        testBody(2, [controlNode('switch-case', { branches: [{ id: 'b-default', type: 'default', label: '', conditions: [] }] })]),
        [['INVALID_CONTROL_STRUCTURE', 'at least one case branch is required']],
      ],
      [
        '2. a Parallel with one lane',
        testBody(2, [controlNode('parallel', { branches: lanes(null), join: 'all' })]),
        [['INVALID_CONTROL_STRUCTURE', 'Parallel requires at least 2 branches']],
      ],
      [
        '2. a lane limit of 0',
        testBody(2, [controlNode('parallel', { branches: lanes(5000, 0), join: 'all' })]),
        [['INVALID_SETTING_VALUE', 'Parallel branch time limit must be a positive integer']],
      ],
      [
        '2. a For step of 0',
        testBody(2, [controlNode('for', { mode: 'count', count: 3, step: 0 })]),
        [['INVALID_SETTING_VALUE', 'step must not be zero']],
      ],
      [
        '2. a While max of 0',
        testBody(
          2,
          [controlNode('while', { mode: 'while-do', conditions: [literal('count', 'integer', 'less_than', '3')], max_iterations: 0 })],
          COUNT,
        ),
        [['SETTING_BELOW_MINIMUM', "Setting 'max_iterations' of block 'while' must be at least 1, got 0"]],
      ],
      [
        '2. a section limit of 0',
        testBody(2, [controlNode('parallel', { branches: lanes(null, null), join: 'all', time_limit: 0 })]),
        [['SETTING_BELOW_MINIMUM', "Setting 'time_limit' of block 'parallel' must be at least 1, got 0"]],
      ],
      [
        '3. a condition row with no variable',
        testBody(3, [ifElse([{ id: 'c1', type: 'literal', value_type: 'integer', operator: 'equals', reference_value: '1' }])]),
        [['REQUIRED_PARAM_MISSING', "Required parameter 'branches.0.conditions.0.variable' is missing"]],
      ],
      [
        '4. a Template on an integer compare value',
        testBody(
          4,
          [ifElse([literal('count', 'integer', 'equals', '{{ limit }}', { reference_is_template: true })])],
          { ...COUNT, limit: { type: 'integer', value: 3, scope: 'test' } },
        ),
        [['TEMPLATE_NOT_STRING', "The value compared with 'count' is integer; a template builds text, so it needs type string"]],
      ],
      ['5. an undeclared condition variable', testBody(5, [ifElse([literal('ghost', 'integer', 'equals', '1')])]), [GHOST]],
      [
        '5. an undeclared name in a compare value {x}',
        testBody(5, [ifElse([literal('count', 'integer', 'equals', 'ghost + 1', { reference_is_expression: true })])], COUNT),
        [GHOST],
      ],
      [
        '5. an undeclared name in an expression item',
        testBody(5, [ifElse([{ id: 'e1', type: 'expression', expression: 'ghost > 1' }])]),
        [GHOST],
      ],
      [
        '5. an undeclared name in a filter item',
        testBody(5, [csvParser([literal('_cell', 'integer', 'greater_than', 'ghost', { reference_is_expression: true })])]),
        [GHOST],
      ],
      [
        '5. an undeclared name in a Setter {x} row',
        testBody(5, [setter({ out: 'ghost + 1' }, { expressionFields: ['variables.out'] })], {
          out: { type: 'integer', value: 0, scope: 'test' },
        }),
        [GHOST],
      ],
      [
        '6. a compare value {x} that changes data',
        testBody(6, [ifElse([literal('status', 'string', 'equals', 'errors.append(1)', { reference_is_expression: true })])], STATUS),
        [['EXPRESSION_CHANGES_DATA', `${READ_ONLY} Block: ${CHECK}. Field: ${COMPARE_FIELD}.`]],
      ],
      [
        '7. an unknown element type in a Setter row record',
        testBody(7, [setter({ limits: { max: 5 } }, { elementTypes: { 'variables.limits': { max: 'decimal' } } })], {
          limits: { type: 'map', value: {}, scope: 'test' },
        }),
        [
          [
            'INVALID_ELEMENT_TYPES',
            "Invalid element types for setting 'variables.limits' of block 'variable-setter': unknown element type " +
              "'decimal' for key 'max' (must be one of: array, boolean, float, integer, map, string)",
          ],
        ],
      ],
      [
        '11. a filter operator its column type does not offer',
        testBody(11, [csvParser([literal('_cell', 'integer', 'contains', '1')])]),
        [['INVALID_CONDITION', "Unknown filter operator: 'contains'"]],
      ],
      [
        '12. a Log message marked both {x} and Template',
        testBody(12, [bothMarks(logNode('ctl', "'ok'"), 'message')]),
        [bothMarksFinding('message', 'log')],
      ],
      [
        '12. a Setter row marked both {x} and Template',
        testBody(12, [bothMarks(setter({ greeting: "'hi'" }), 'variables.greeting')], {
          greeting: { type: 'string', value: '', scope: 'test' },
        }),
        [bothMarksFinding('variables.greeting', 'variable-setter')],
      ],
      [
        '12. a Setter list entry marked both {x} and Template',
        testBody(
          12,
          [bothMarks(setter({ hosts: ["'a'"] }, { elementTypes: { 'variables.hosts': ['string'] } }), 'variables.hosts.0')],
          { hosts: { type: 'array', value: [], scope: 'test', elementTypes: [] } },
        ),
        [bothMarksFinding('variables.hosts.0', 'variable-setter')],
      ],
      [
        '13. a Parallel whose two lanes share one id',
        testBody(13, [controlNode('parallel', { branches: [{ id: 'lane-1', name: 'Lane 1' }, { id: 'lane-1', name: 'Lane 2' }], join: 'all' })]),
        [['INVALID_CONTROL_STRUCTURE', "duplicate branch id: 'lane-1'"]],
      ],
      [
        '14. a Break in no loop body',
        testBody(14, [controlNode('break', { target_loop: 'loop-a' })]),
        [['BREAK_OUTSIDE_LOOP', 'break/continue is only valid inside a loop body']],
      ],
      [
        '14. a Continue aimed at a loop that does not hold it',
        testBody(
          14,
          [
            withId(controlNode('for', { mode: 'count', count: 2 }), 'loop-a'),
            withId(controlNode('continue', { target_loop: 'loop-b' }), 'cont'),
            withId(controlNode('for', { mode: 'count', count: 2 }), 'loop-b'),
          ],
          {},
          [
            { id: 'e-body', source: 'loop-a', target: 'cont', sourceHandle: 'body' },
            { id: 'e-then', source: 'loop-a', target: 'loop-b', sourceHandle: 'then' },
          ],
        ),
        [['BREAK_OUTSIDE_LOOP', "break/continue target 'loop-b' is not an enclosing loop"]],
      ],
      [
        '15. an unknown key in a condition item',
        testBody(15, [ifElse([literal('status', 'string', 'equals', 'ready', { shade: 'blue' })])], STATUS),
        [['UNKNOWN_SETTING', "Block 'if-else' has no setting 'branches.0.conditions.0.shade'"]],
      ],
      [
        '15. an unknown key in a lane',
        testBody(15, [controlNode('parallel', { branches: [{ id: 'lane-1', name: 'Lane 1' }, { id: 'lane-2', name: 'Lane 2', shade: 1 }], join: 'all' })]),
        [['UNKNOWN_SETTING', "Block 'parallel' has no setting 'branches.1.shade'"]],
      ],
      [
        '16. a For step given null',
        testBody(16, [controlNode('for', { mode: 'count', count: 3, step: null })]),
        [['INVALID_SETTING_VALUE', "Setting 'step' of block 'for' cannot be null"]],
      ],
    ]
    for (const [what, body, expected] of cases) {
      await test.step(`${what} is refused`, async () => {
        await expectTestRefused(request, body, expected)
      })
    }
  })

  test('6. an import holding a compare value {x} that changes data is blocked and refused', async ({ request }) => {
    const valid = testBody(6, [ifElse([literal('status', 'string', 'equals', 'ready')])], STATUS)
    const validId = await createTest(request, valid)
    tests.push(validId)
    const exported = await request.get(`${BACKEND_URL}/tests/${validId}/export?format=json&secrets=mask`)
    expect(exported.status(), 'the JSON export answered').toBe(200)
    const document = JSON.parse(await exported.text()) as Json
    const name = `zz-ctrl-fields-save-6-import-${token()}`
    document.name = name
    const row = (document.workflow.nodes as Json[]).find((node) => node.id === 'ctl')?.data.config.values.branches[0].conditions[0]
    expect(row, 'the export holds the condition row').toBeTruthy()
    row.reference_value = 'errors.append(1)'
    row.reference_is_expression = true
    const file = { name: 'changing-condition.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) }
    const reason = `${READ_ONLY} Block: ${CHECK}. Field: ${COMPARE_FIELD}.`

    await test.step('POST /tests/import/validate blocks the Test with the read-only finding', async () => {
      const response = await request.post(`${BACKEND_URL}/tests/import/validate`, { multipart: { file } })
      expect(response.status()).toBe(200)
      const answer = (await response.json()) as Json
      expect(answer.success).toBe(true)
      const results = answer.data.tests as Json[]
      expect(results.map((result) => [result.name, result.status])).toEqual([[name, 'fatal']])
      expect(findingsOf(results[0].fatal_errors)).toEqual([['EXPRESSION_CHANGES_DATA', reason]])
      expect(answer.data).toMatchObject({ total: 1, importable: 0, blocked: 1 })
    })

    await test.step('POST /tests/import refuses it and stores nothing', async () => {
      const response = await request.post(`${BACKEND_URL}/tests/import`, { multipart: { file, conflict_resolutions: '{}' } })
      expect(response.status()).toBe(422)
      const answer = (await response.json()) as Json
      expect(answer.success).toBe(false)
      expect(answer.error.code).toBe('EXPRESSION_CHANGES_DATA')
      expect(answer.error.message).toBe(`Cannot import test '${name}'. ${reason}`)
      expect(await testsNamed(request, name)).toEqual([])
    })
  })

  test('8. validate on load lists the missing condition parts as warnings; on run as errors', async ({ request }) => {
    const testId = await createTest(request, testBody(8, [logNode('log-ok', "'ok'")]))
    tests.push(testId)
    const unsaved = {
      workflow: {
        nodes: [
          controlNode('if-else', {
            branches: [
              { id: 'b-if', type: 'if', label: '', conditions: [] },
              {
                id: 'b-elif',
                type: 'else_if',
                label: '',
                conditions: [{ id: 'c1', type: 'literal', value_type: 'integer', operator: 'equals', reference_value: '1' }],
              },
              { id: 'b-else', type: 'else', label: '' },
            ],
          }),
        ],
        edges: [{ id: 'e-start', source: 'start-node', target: 'ctl' }],
      },
      variables: {},
    }
    const expected: Finding[] = [
      ['REQUIRED_PARAM_EMPTY', 'if branch must have conditions'],
      ['REQUIRED_PARAM_MISSING', "Required parameter 'branches.1.conditions.0.variable' is missing"],
    ]

    const load = await postJson(request, `/tests/${testId}/validate?context=load`, unsaved)
    expect(load.status, JSON.stringify(load.body)).toBe(200)
    expect(load.body.data.errors).toEqual([])
    expect(requiredParts(load.body.data.warnings)).toEqual(expected)

    const run = await postJson(request, `/tests/${testId}/validate?context=run`, unsaved)
    expect(run.status, JSON.stringify(run.body)).toBe(422)
    const result = run.body.error.details[0] as Json
    expect(requiredParts(result.errors)).toEqual(expected)
    expect(requiredParts(result.warnings)).toEqual([])
  })

  test('9. a Function save with a blank {x} Setter row is refused', async ({ request }) => {
    const name = `zz-ctrl-fields-save-9-${randomUUID().slice(0, 8)}`
    const body = functionBody(name, {
      outputs: [{ name: 'out', type: 'string' }],
      workflow: {
        nodes: [setter({ out: '' }, { expressionFields: ['variables.out'] })],
        edges: [{ id: 'e-start', source: 'start-node', target: 'ctl' }],
      },
    })
    const answer = await postJson(request, '/functions', body)
    if (answer.status < 300) functions.push(answer.body?.data?.id)
    expect(answer.status, JSON.stringify(answer.body)).toBe(422)
    expect(answer.body.error.message).toBe('Function has 1 validation error(s)')
    expect(answer.findings).toEqual([['REQUIRED_PARAM_EMPTY', "'out' in 'variables' is required"]])
  })

  test('10. the workbench Save of a compare value {x} that changes data shows the backend refusal', async ({ page, request }) => {
    test.setTimeout(180_000)
    const testId = await createTest(
      request,
      testBody(
        10,
        [ifElse([literal('status', 'string', 'equals', 'ready')]), logNode('log-if', "'if'"), logNode('log-else', "'else'")],
        STATUS,
        [
          { id: 'e-if', source: 'ctl', target: 'log-if', sourceHandle: 'b-if' },
          { id: 'e-else', source: 'ctl', target: 'log-else', sourceHandle: 'b-else' },
        ],
      ),
    )
    tests.push(testId)
    expect((await validateTest(request, testId)).errors).toEqual([])
    await openTest(page, testId)

    await test.step('the window shows only the amber finding and saves', async () => {
      const sheet = await openBlockSheet(page, 'ctl')
      const body = await openConditionBody(sheet, 'if-else', 'b-if')
      await referenceToggle(body, '0').click()
      const dialog = switchWarning(page)
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Clear', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await replaceCode(page, body.locator('[data-testid="param-input-assert-value-0"] .cm-content'), 'errors.append(1)')
      await expect(body.locator('[data-testid="param-warning-assert-value-0"]')).toHaveText(
        "Method 'append' modifies data and is not allowed in field expressions",
        { timeout: 15_000 },
      )
      await expect(body.locator('[data-testid="param-error-assert-value-0"]')).toHaveCount(0)
      await expect(settingsNote(sheet)).toHaveCount(0)
      await expect(saveButton(sheet)).toBeEnabled()
      await saveBlockSheet(sheet)
    })

    await test.step('the Test Save shows the backend text and the stored row is unchanged', async () => {
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      const dialog = page.locator('[data-testid="validation-error-dialog"]')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(dialog.getByRole('heading', { name: 'Cannot Save Test', exact: true })).toBeVisible()
      await expect(dialog.locator('[data-testid="validation-error-list"]')).toContainText(
        `${READ_ONLY} Block: ${CHECK}. Field: ${COMPARE_FIELD}.`,
      )
      await dialog.locator('[data-testid="validation-close-btn"]').click()
      await expect(dialog).toHaveCount(0)
      const row = (await storedNode(request, testId, 'ctl')).data.config.values.branches[0].conditions[0]
      expect(row).toEqual({ id: 'c1', type: 'literal', variable: 'status', value_type: 'string', operator: 'equals', reference_value: 'ready' })
    })
  })
})
