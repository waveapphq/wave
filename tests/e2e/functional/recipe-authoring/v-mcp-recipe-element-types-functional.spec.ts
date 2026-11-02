/**
 * V-MCP-RECIPE-ELEMENT-TYPES-FUNCTIONAL: a recipe declares the type of every map / list
 * element - on a variable, on a Variable Setter row and on a typed block setting - and
 * the created Test, its readback, an amend of that readback and a run all keep them.
 * Wireframes: none (tool-surface behavior; no UI of its own)
 * REQ: REQ-3.1.3.19, REQ-5.2.7.16, REQ-3.4.1.6
 *
 * Pass Criteria:
 * 1. create_test_from_recipe accepts `element_types` on variable declarations and beside a
 *    step's settings / set rows; an element without one takes its YAML type.
 * 2. The created Test stores numbers as exact text with a complete element-type sidecar
 *    on the variables, on the Variable Setter node and on the SQL block's Driver options
 *    (GET /tests/{id}); a 19-digit integer and `1.0` keep their exact text.
 * 3. get_test_recipe reads the element types back and writes the declared numbers as plain
 *    YAML numbers (`big: 1234567890123456789`, `ratio: 1.0`), the readback validates clean,
 *    and amending the Test with it keeps every number it stored (REQ-3.1.3.14).
 * 4. A tracked run reads every element as its declared type: numbers add, numeric-looking
 *    text concatenates, a declared-string bracketed text stays text, nested leaves keep
 *    their JSON types, and SQLite receives the whole-number Driver option.
 * 5. A float element written as `.nan` or `.inf` is text, so it is refused by type, named by
 *    its key or item (REQ-3.1.3.14).
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/recipe-authoring/v-mcp-recipe-element-types-functional.spec.ts
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { deleteTest, getNode, getTest, runToken } from '../../helpers/element-types'

const MCP_PORT = Number(BACKEND_PORT) + 765

const NON_FINITE_RECIPE = `test:
  name: Non-finite elements
variables:
  m: {type: map, value: {x: .nan}, element_types: {x: float}}
  a: {type: array, value: [1.5, .inf], element_types: [float, float]}
  done: {type: boolean}
flow:
  - set: {done: true}
`

const PROBE =
  "f\"RECIPE r={limits['retries'] + 1} ratio={limits['ratio'] * 2} big={limits['big'] + 1} " +
  "zip={limits['zip'] + '-x'} ver={limits['ver'] == '1.10'} flag={not limits['flag']} " +
  "tag0={limits['tags'][0] + 1} txt={type(limits['txt']) == str} p0={ports[0] + 1} " +
  "p1={ports[1] + '-x'} p2={ports[2] * 2} nn={natives['n'] + 1} nf={natives['f'] * 2} " +
  "ns={natives['s'] + 'x'} nb={not natives['b']} ne={natives['nest'][0] + 1} " +
  "bn={built['n'] + 1} bs={built['s'] + 'x'} lite={lite_rows[0]['timeout']}\""

const PROBE_LINE =
  'RECIPE r=4 ratio=2.0 big=1234567890123456790 zip=02134-x ver=True flag=True tag0=2.5 ' +
  'txt=True p0=8081 p1=8443-x p2=2.0 nn=17 nf=3.0 ns=07x nb=False ne=2.5 bn=17 bs=16x lite=7000'

function recipeFor(name: string, token: string): string {
  return `test:
  name: ${name}
  description: Declared element types on variables, a set row and a block setting
variables:
  limits:
    type: map
    value: {retries: 3, ratio: "1.0", big: "1234567890123456789", zip: "02134", ver: "1.10", flag: false, tags: '[1.5, "a"]', txt: "[1, 2]"}
    element_types: {retries: integer, ratio: float, big: integer, zip: string, ver: string, flag: boolean, tags: array, txt: string}
  ports:
    type: array
    value: [8080, "8443", "1.0"]
    element_types: [integer, string, float]
  natives:
    type: map
    value: {n: 16, f: 1.5, s: "07", b: true, nest: [1.5, "a"]}
  built:
    type: map
flow:
  - set:
      built: {n: "16", s: "16"}
    element_types: {built: {n: integer, s: string}}
  - block: sql-client
    label: SQLite typed option
    settings:
      operation: run_sql
      database_type: sqlite
      file: artifact://recipe-typed-${token}.db
      script_type: source
      sql: PRAGMA busy_timeout
      driver_options: {timeout: "7"}
    element_types: {driver_options: {timeout: integer}}
    capture: {rows: lite_rows}
  - block: log
    settings:
      message:
        expr: >-
          ${PROBE}
`
}

/** A copy with every JSON number written as its digit text, so a number stored either way reads the same. */
function numbersAsText(value: unknown): unknown {
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(numbersAsText)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, numbersAsText(entry)]))
  }
  return value
}

async function pollTerminal(request: APIRequestContext, executionId: string): Promise<string> {
  let status = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        status = ((((await resp.json()).data ?? {}) as { status?: string }).status ?? '') as string
        return ['passed', 'failed', 'stopped', 'skipped'].includes(status)
      },
      { timeout: 90_000, message: `execution ${executionId} should reach a terminal state` },
    )
    .toBe(true)
  return status
}

async function logMessages(request: APIRequestContext, executionId: string): Promise<string[]> {
  const resp = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(resp.ok(), `GET /executions/history/${executionId}: ${resp.status()}`).toBeTruthy()
  const logs = (((await resp.json()).data ?? {}) as { logs?: Array<{ message?: string }> }).logs ?? []
  return logs.map((entry) => entry.message ?? '')
}

test.describe('V-MCP-RECIPE-ELEMENT-TYPES: recipe element types', () => {
  let testId = ''

  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    if (testId) await deleteTest(request, testId)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('declared element types survive create, readback, amend and a run', async ({ page, request }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
    const token = runToken()
    const name = `Recipe Element Types ${token}`

    const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: recipeFor(name, token) })
    expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
    testId = created.payload.test_id as string

    // After an amend a declared number may come back as its JSON number: the same number, written by value.
    const expectStored = async (asWritten: (value: unknown) => unknown = (value) => value) => {
      const stored = asWritten(await getTest(request, testId)) as Record<string, any>
      expect(stored.variables.limits.value).toEqual({
        retries: '3',
        ratio: '1.0',
        big: '1234567890123456789',
        zip: '02134',
        ver: '1.10',
        flag: false,
        tags: '[1.5, "a"]',
        txt: '[1, 2]',
      })
      expect(stored.variables.limits.elementTypes).toEqual({
        retries: 'integer',
        ratio: 'float',
        big: 'integer',
        zip: 'string',
        ver: 'string',
        flag: 'boolean',
        tags: 'array',
        txt: 'string',
      })
      expect(stored.variables.ports.value).toEqual(['8080', '8443', '1.0'])
      expect(stored.variables.ports.elementTypes).toEqual(['integer', 'string', 'float'])
      expect(stored.variables.natives.value).toEqual({ n: '16', f: '1.5', s: '07', b: true, nest: '[1.5, "a"]' })
      expect(stored.variables.natives.elementTypes).toEqual({
        n: 'integer',
        f: 'float',
        s: 'string',
        b: 'boolean',
        nest: 'array',
      })
      const nodes = stored.workflow.nodes as Array<Record<string, any>>
      const setter = nodes.find((node) => node.data.elementType === 'variable-setter')
      expect(setter?.data.config.values.variables.built).toEqual({ n: '16', s: '16' })
      expect(setter?.data.variableElementTypes).toEqual({ built: { n: 'integer', s: 'string' } })
      const sql = nodes.find((node) => node.data.elementType === 'sql-client')
      const sqlNode = await getNode(request, testId, sql?.id as string)
      expect(sqlNode.data.config.values.driver_options).toEqual({ timeout: '7' })
      expect(sqlNode.data.elementTypes).toEqual({ driver_options: { timeout: 'integer' } })
    }

    await test.step('the created Test stores exact text and every element type', () => expectStored())

    await test.step('the readback carries the element types, validates, and amends to the same Test', async () => {
      const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: testId })
      expect(readback.payload.expressible, JSON.stringify(readback.payload)).toBe(true)
      const text = readback.payload.recipe as string
      expect(text).toContain('element_types:')
      expect(text).toMatch(/[{ ]big: 1234567890123456789[,}\n]/)
      expect(text).toMatch(/[{ ]ratio: 1\.0[,}\n]/)
      expect(text).toContain('retries: integer')
      const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe: text, test_ref: testId })
      expect(verdict.payload.valid, JSON.stringify(verdict.payload.findings)).toBe(true)
      const amended = callTool(MCP_PORT, 'amend_test_from_recipe', { test_ref: testId, recipe: text })
      expect(amended.payload.amended, JSON.stringify(amended.payload)).toBe(true)
      await expectStored(numbersAsText)
    })

    await test.step('a non-finite float element is refused', async () => {
      const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe: NON_FINITE_RECIPE })
      expect(verdict.payload.valid, JSON.stringify(verdict.payload)).toBe(false)
      const problems = (verdict.payload.findings as Array<{ problem: string }>).map((item) => item.problem)
      expect(problems).toEqual([
        "Variable 'm': key 'x' expects float, got string",
        "Variable 'a': item 1 expects float, got string",
      ])
    })

    await test.step('a tracked run reads every element as its declared type', async () => {
      const started = callTool(MCP_PORT, 'start_execution', { entity_type: 'test', ref: testId, environment: E2E_ENV_NAME })
      expect(started.isError, JSON.stringify(started.payload)).toBe(false)
      const executionId = started.payload.execution_id as string
      const status = await pollTerminal(request, executionId)
      const messages = await logMessages(request, executionId)
      expect(messages, messages.join('\n')).toContain(PROBE_LINE)
      expect(status, messages.join('\n')).toBe('passed')
    })
  })
})
