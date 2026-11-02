/**
 * V-MCP-RECIPE-NULL-PARAMS: recipe Function parameters with no default, kind outputs and null
 * checks with no value type
 * Wireframe: none (tool surface; no UI of its own)
 * Design Decisions: VMGR-99, VMGR-103
 * REQ: REQ-5.2.7.3, REQ-5.2.7.5, REQ-5.2.7.6, REQ-3.1.2.8, REQ-3.1.2.9, REQ-3.1.3.21, REQ-3.1.3.25
 *
 * Seed: none. Every Test is created over the live MCP endpoint by `create_test_from_recipe`, read
 * back with `get_test_recipe` and run tracked with `start_execution`; the stored Test is read with
 * GET /tests/{id} and the run lines with GET /executions/history/{id}. Each Test is deleted after.
 *
 * Pass Criteria:
 * 1. A Function input marked secret with a default is refused by `validate_recipe` and by
 *    `create_test_from_recipe` with exactly one finding: `SECRET_INPUT_DEFAULT`,
 *    "Secret input 'tok' cannot have a default", fix "Remove the default; the Function Block
 *    gives the value"; nothing is stored. The same recipe with no default creates.
 * 2. `default: null` on an input and on an output stores no default; the run prints `who=null`
 *    from the unbound input and `res_out=null` from the unwritten output captured into a variable
 *    that held 7 before the call.
 * 3. An output written `expr:` is stored `isExpression` and one written `template:` is stored
 *    `isTemplate`, each with its source in `default`; `get_test_recipe` reads both forms back and the
 *    Function step as `- function: kind_outputs` with `settings` and `capture`; the run prints
 *    `total=42 label=id-21` and no "no block writes it" WARN for either output; an amend of the readback
 *    with `count: 5` changes the same Function Block, and the run prints `total=10 label=id-5`.
 * 4. A Function input written with `expr:` or `template:` is refused with `INPUT_KIND_NOT_ALLOWED`,
 *    "Input '<name>' cannot use expr or template; an input default is a plain value", fix
 *    "Give the input a plain default and compute the value inside the Function", once per input.
 * 5. An `is_null` comparison with no `value_type` stores the declared type of its variable for
 *    every type (string, integer, float, boolean, array, map, table), and inside a Function for its
 *    input, output and local; the run takes the then path on null and the else path on a held value.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { deleteTest, getTest, runToken } from '../../helpers/element-types'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

const TERMINAL = ['passed', 'failed', 'stopped', 'skipped']

interface Finding {
  step: string
  code: string
  problem: string
  fix: string
}

interface HistoryLog {
  level?: string
  message?: string
}

type StoredParam = Record<string, unknown> & { name: string }

/** The findings of a tool answer as `[step, code, problem, fix]` rows. */
function rows(payload: Record<string, any>): string[][] {
  return ((payload.findings ?? []) as Finding[]).map((f) => [f.step, f.code, f.problem, f.fix])
}

/** Create a Test from a recipe and return its id; the answer must say created. */
function createFromRecipe(recipe: string): string {
  const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
  expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
  return created.payload.test_id as string
}

/** Run the Test tracked over MCP; returns the verdict and every non-DEBUG run line. */
async function runOverMcp(
  request: APIRequestContext,
  testId: string,
): Promise<{ verdict: string; lines: HistoryLog[] }> {
  const started = callTool(MCP_PORT, 'start_execution', {
    entity_type: 'test',
    ref: testId,
    environment: E2E_ENV_NAME,
  })
  expect(started.isError, JSON.stringify(started.payload)).toBe(false)
  const executionId = started.payload.execution_id as string
  let verdict = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        verdict = (((await resp.json()).data ?? {}) as { status?: string }).status ?? ''
        return TERMINAL.includes(verdict)
      },
      { timeout: 90_000, message: `execution ${executionId} reaches a terminal state` },
    )
    .toBe(true)
  const history = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(history.ok(), `GET /executions/history/${executionId}: ${history.status()}`).toBeTruthy()
  const logs = (((await history.json()).data ?? {}) as { logs?: HistoryLog[] }).logs ?? []
  return { verdict, lines: logs.filter((line) => (line.level ?? '').toUpperCase() !== 'DEBUG') }
}

const messagesOf = (lines: HistoryLog[]): string[] => lines.map((line) => line.message ?? '')

/** The `localDefinition` of the stored Local Function named `name`. */
async function storedLocalFunction(
  request: APIRequestContext,
  testId: string,
  name: string,
): Promise<{ inputs: StoredParam[]; outputs: StoredParam[] }> {
  const nodes = (await getTest(request, testId)).workflow.nodes as Array<Record<string, any>>
  const fn = nodes.find((node) => node.data?.localDefinition?.name === name)
  expect(fn, `the Local Function ${name} is stored`).toBeTruthy()
  return fn!.data.localDefinition
}

const paramNamed = (params: StoredParam[], name: string): StoredParam => {
  const found = params.find((param) => param.name === name)
  expect(found, `the parameter ${name} is stored`).toBeTruthy()
  return found!
}

/** Every stored `is_null` condition item, by the variable it checks. */
/** The Function Blocks of a stored Test's flow. */
function functionBlocks(stored: Record<string, any>): Array<Record<string, any>> {
  return ((stored.workflow?.nodes ?? []) as Array<Record<string, any>>).filter((node) => node.data?.elementType === 'function')
}

function storedIsNullTypes(value: unknown, found: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(value)) {
    for (const item of value) storedIsNullTypes(item, found)
  } else if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    if (item.operator === 'is_null' && typeof item.variable === 'string') {
      found[item.variable] = item.value_type
    }
    for (const nested of Object.values(item)) storedIsNullTypes(nested, found)
  }
  return found
}

function secretInputRecipe(name: string, withDefault: boolean): string {
  const tok = withDefault
    ? '{name: tok, type: string, secret: true, default: abc}'
    : '{name: tok, type: string, secret: true}'
  return `test:
  name: ${name}
  description: A secret Function input
functions:
  - name: secret_in
    inputs:
      - ${tok}
    flow:
      - block: log
        settings:
          message: token given
flow:
  - function: secret_in
    settings: {tok: abc}
`
}

function nullDefaultsRecipe(name: string): string {
  return `test:
  name: ${name}
  description: default null on an input and an output
variables:
  res_out: {type: integer, value: 7}
functions:
  - name: null_defaults
    inputs:
      - {name: who, type: string, default: null}
    outputs:
      - {name: res, type: integer, default: null}
    flow:
      - block: log
        settings:
          message: "who={{ who }}"
flow:
  - block: log
    settings:
      message: "before={{ res_out }}"
  - function: null_defaults
    capture: {res: res_out}
  - block: log
    settings:
      message: "res_out={{ res_out }}"
`
}

function kindOutputsRecipe(name: string): string {
  return `test:
  name: ${name}
  description: outputs written as an expression and a template
variables:
  t_total: {type: integer}
  t_label: {type: string}
functions:
  - name: kind_outputs
    inputs:
      - {name: count, type: integer, required: true}
    outputs:
      - {name: total, type: integer, expr: "count * 2"}
      - {name: label, type: string, template: "id-{{ count }}"}
    flow:
      - block: log
        settings:
          message: "count={{ count }}"
flow:
  - function: kind_outputs
    settings: {count: 21}
    capture: {total: t_total, label: t_label}
  - block: log
    settings:
      message: "total={{ t_total }} label={{ t_label }}"
`
}

function kindInputsRecipe(name: string): string {
  return `test:
  name: ${name}
  description: inputs written in the output kind form
functions:
  - name: kind_inputs
    inputs:
      - {name: n, type: integer, expr: "1 + 1"}
      - {name: s, type: string, template: "x-{{ n }}"}
    flow:
      - block: log
        settings:
          message: "n={{ n }} s={{ s }}"
flow:
  - function: kind_inputs
    settings: {n: 1, s: a}
`
}

const CHECKED_TYPES: ReadonlyArray<{ type: string; held: string }> = [
  { type: 'string', held: 'abc' },
  { type: 'integer', held: '3' },
  { type: 'float', held: '1.5' },
  { type: 'boolean', held: 'true' },
  { type: 'array', held: '[1, 2]' },
  { type: 'map', held: '{k: 1}' },
  { type: 'table', held: '[{c: 1}]' },
]

/** One If on `variable` is null: the then path logs `<variable>=null`, the else path `<variable>=held`. */
function isNullStep(variable: string, indent: string): string {
  return [
    `${indent}- if:`,
    `${indent}    when: {variable: ${variable}, operator: is_null}`,
    `${indent}    then:`,
    `${indent}      - block: log`,
    `${indent}        settings:`,
    `${indent}          message: ${variable}=null`,
    `${indent}    else:`,
    `${indent}      - block: log`,
    `${indent}        settings:`,
    `${indent}          message: ${variable}=held`,
  ].join('\n')
}

/** Function scope names and the types their checks must store. */
const FUNCTION_SCOPE = { fin: 'integer', fout: 'map', fvar: 'table' } as const

function isNullRecipe(name: string): string {
  const variables = CHECKED_TYPES.flatMap(({ type, held }) => [
    `  n_${type}: {type: ${type}}`,
    `  h_${type}: {type: ${type}, value: ${held}}`,
  ])
  const checks = CHECKED_TYPES.flatMap(({ type }) => [
    isNullStep(`n_${type}`, '  '),
    isNullStep(`h_${type}`, '  '),
  ])
  return [
    'test:',
    `  name: ${name}`,
    '  description: is_null with no value_type on every type',
    'variables:',
    ...variables,
    'functions:',
    '  - name: scope_probe',
    '    inputs:',
    '      - {name: fin, type: integer}',
    '    outputs:',
    '      - {name: fout, type: map}',
    '    variables:',
    '      fvar: {type: table}',
    '    flow:',
    ...Object.keys(FUNCTION_SCOPE).map((variable) => isNullStep(variable, '      ')),
    'flow:',
    ...checks,
    '  - function: scope_probe',
    '',
  ].join('\n')
}

test.describe('V-MCP-RECIPE-NULL-PARAMS: no defaults, kind outputs and typeless null checks in recipes', () => {
  const created: string[] = []

  test.beforeEach(async ({ page, request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const id of created.splice(0)) await deleteTest(request, id)
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a secret input with a default is refused', async ({ request }) => {
    test.setTimeout(180_000)
    const name = `zz-mcp-null-params-secret-${runToken()}`
    // Per VMGR-103: a secret input has no default; the Function Block gives the value.
    const expected = [
      [
        'functions[secret_in].inputs.tok',
        'SECRET_INPUT_DEFAULT',
        "Secret input 'tok' cannot have a default",
        'Remove the default; the Function Block gives the value',
      ],
    ]

    await test.step('validate_recipe names the input', () => {
      const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe: secretInputRecipe(name, true) })
      expect(verdict.payload.valid, JSON.stringify(verdict.payload)).toBe(false)
      expect(rows(verdict.payload), JSON.stringify(verdict.payload)).toEqual(expected)
    })

    await test.step('create_test_from_recipe refuses it and stores nothing', async () => {
      const refused = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: secretInputRecipe(name, true) })
      expect(refused.payload.created, JSON.stringify(refused.payload)).toBe(false)
      expect(rows(refused.payload), JSON.stringify(refused.payload)).toEqual(expected)
      const list = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}`)
      expect(list.ok(), `GET /tests?search= failed: ${list.status()}`).toBeTruthy()
      expect((await list.json()).data ?? [], 'no Test of the refused recipe is stored').toHaveLength(0)
    })

    await test.step('the same input with no default creates', () => {
      created.push(createFromRecipe(secretInputRecipe(name, false)))
    })
  })

  test('default: null means no default', async ({ request }) => {
    test.setTimeout(180_000)
    const testId = createFromRecipe(nullDefaultsRecipe(`zz-mcp-null-params-default-${runToken()}`))
    created.push(testId)

    await test.step('the input and the output are stored with no default', async () => {
      const fn = await storedLocalFunction(request, testId, 'null_defaults')
      expect(paramNamed(fn.inputs, 'who').default ?? null, JSON.stringify(fn.inputs)).toBeNull()
      expect(paramNamed(fn.outputs, 'res').default ?? null, JSON.stringify(fn.outputs)).toBeNull()
    })

    await test.step('the run reads null from the unbound input and the unwritten output', async () => {
      const { verdict, lines } = await runOverMcp(request, testId)
      const messages = messagesOf(lines)
      expect(verdict, messages.join('\n')).toBe('passed')
      expect(messages, 'the caller variable held 7 before the call').toContain('before=7')
      // Per REQ-3.1.3.21: an optional input with no default bound to nothing reaches the body as null.
      expect(messages, messages.join('\n')).toContain('who=null')
      // An output nothing writes returns its default, and null is no default.
      expect(messages, messages.join('\n')).toContain('res_out=null')
    })
  })

  test('an output written as an expression or a template runs evaluated', async ({ request }) => {
    test.setTimeout(180_000)
    const testId = createFromRecipe(kindOutputsRecipe(`zz-mcp-null-params-kind-${runToken()}`))
    created.push(testId)

    await test.step('the outputs are stored with their kind and source', async () => {
      const fn = await storedLocalFunction(request, testId, 'kind_outputs')
      // Per VMGR-99: an output keeps its kind the way a Function-local variable does.
      expect(paramNamed(fn.outputs, 'total')).toMatchObject({
        type: 'integer',
        isExpression: true,
        default: 'count * 2',
      })
      expect(paramNamed(fn.outputs, 'label')).toMatchObject({
        type: 'string',
        isTemplate: true,
        default: 'id-{{ count }}',
      })
    })

    let readback = ''
    await test.step('get_test_recipe reads both forms back and the Function step in its one shape', () => {
      const answer = callTool(MCP_PORT, 'get_test_recipe', { test_ref: testId })
      expect(answer.payload.expressible, JSON.stringify(answer.payload)).toBe(true)
      readback = String(answer.payload.recipe ?? '')
      expect(readback, readback).toMatch(/expr: ['"]?count \* 2['"]?/)
      expect(readback, readback).toMatch(/template: ['"]?id-\{\{ count \}\}['"]?/)
      expect(readback, readback).toMatch(/^\s*- function: kind_outputs$/m)
      expect(readback, readback).toMatch(/^\s+settings:\n\s+count: 21$/m)
      expect(readback, readback).toMatch(/^\s+capture:$/m)
      expect(readback, 'no call step in the readback').not.toMatch(/\bcall:/)
    })

    await test.step('the run returns the evaluated outputs', async () => {
      const { verdict, lines } = await runOverMcp(request, testId)
      const messages = messagesOf(lines)
      expect(verdict, messages.join('\n')).toBe('passed')
      expect(messages, messages.join('\n')).toContain('total=42 label=id-21')
      // Per REQ-3.1.2.8: an expression or template output counts as written.
      for (const output of ['total', 'label']) {
        expect(messages, messages.join('\n')).not.toContain(
          `Function 'kind_outputs' declares output '${output}' but no block writes it`,
        )
      }
    })

    await test.step('an amend of the readback changes the same Function Block', async () => {
      const before = functionBlocks(await getTest(request, testId))
      expect(before.map((block) => block.data.config?.values), 'the created Block holds count').toEqual([{ count: 21 }])
      const amended = callTool(MCP_PORT, 'amend_test_from_recipe', {
        test_ref: testId,
        recipe: readback.replace(/^(\s+count:) 21$/m, '$1 5'),
      })
      expect(amended.payload.amended, JSON.stringify(amended.payload)).toBe(true)
      const after = functionBlocks(await getTest(request, testId))
      expect(after.map((block) => block.data.label), 'the same Function Block').toEqual(before.map((block) => block.data.label))
      expect(after.map((block) => block.data.config?.values)).toEqual([{ count: 5 }])
      const { verdict, lines } = await runOverMcp(request, testId)
      const messages = messagesOf(lines)
      expect(verdict, messages.join('\n')).toBe('passed')
      expect(messages, messages.join('\n')).toContain('total=10 label=id-5')
    })
  })

  test('a recipe Function input refuses the output kind form', () => {
    test.setTimeout(120_000)
    const recipe = kindInputsRecipe(`zz-mcp-null-params-kind-input-${runToken()}`)
    const fix = 'Give the input a plain default and compute the value inside the Function'
    const expected = ['n', 's'].map((input) => [
      `functions[kind_inputs].inputs.${input}`,
      'INPUT_KIND_NOT_ALLOWED',
      `Input '${input}' cannot use expr or template; an input default is a plain value`,
      fix,
    ])
    const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe })
    expect(verdict.payload.valid, JSON.stringify(verdict.payload)).toBe(false)
    expect(rows(verdict.payload), JSON.stringify(verdict.payload)).toEqual(expected)
  })

  test('is null on a comparison with no value type works on every type', async ({ request }) => {
    test.setTimeout(240_000)
    const testId = createFromRecipe(isNullRecipe(`zz-mcp-null-params-is-null-${runToken()}`))
    created.push(testId)

    await test.step('each check stores the declared type of its variable', async () => {
      const stored = storedIsNullTypes(await getTest(request, testId))
      const expected: Record<string, string> = { ...FUNCTION_SCOPE }
      for (const { type } of CHECKED_TYPES) {
        expected[`n_${type}`] = type
        expected[`h_${type}`] = type
      }
      expect(stored).toEqual(expected)
    })

    await test.step('null takes the then path and a held value the else path', async () => {
      const { verdict, lines } = await runOverMcp(request, testId)
      const messages = messagesOf(lines)
      expect(verdict, messages.join('\n')).toBe('passed')
      const answers = messages.filter((message) => /^\w+=(null|held)$/.test(message)).sort()
      const expected = [
        ...CHECKED_TYPES.flatMap(({ type }) => [`n_${type}=null`, `h_${type}=held`]),
        ...Object.keys(FUNCTION_SCOPE).map((variable) => `${variable}=null`),
      ].sort()
      expect(answers, messages.join('\n')).toEqual(expected)
    })
  })
})
