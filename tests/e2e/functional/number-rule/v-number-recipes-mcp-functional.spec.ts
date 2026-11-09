/**
 * V-NUMBER-RECIPES-MCP-FUNCTIONAL: recipes write numbers by the one number rule, and the readback writes them back
 * Wireframe: none (tool-surface behavior)
 * Design Decisions: FIELD-1
 * REQ: REQ-3.1.3.14, REQ-5.2.7.16
 *
 * Every recipe goes through the live MCP endpoint (`validate_recipe`, `create_test_from_recipe`, `get_test_recipe`,
 * `amend_test_from_recipe`). The created Tests and the Database profile are `zz-11541-s8-*` and removed afterwards.
 *
 * Pass Criteria:
 * 1. `validate_recipe` refuses a float variable `1.0e+5` and an integer variable `0x1F` (`Variable '<v>' expects
 *    float / integer, got string`), a Function input default `abc` (`Input 'x' expects integer, got string`), a Ping
 *    Interval `.nan` (`Setting 'interval' of block 'ping' expects float, got string`) and a Driver options entry
 *    `timeout: x` declared integer (`Setting 'driver_options' of block 'sql-client' at key 'timeout' is not a valid
 *    integer`), each as the only error.
 * 2. A recipe HTTP Retry Delay `2.50`, Backoff Factor `0.0000001`, Max Size `1234567890123456789` and a For Timeout
 *    `30.0` are stored as that text and open in the Block windows as typed; the run sends `"retry_delay":2.5`,
 *    `"retry_backoff_factor":0.0000001` and `"max_size":1234567890123456789`.
 * 3. `get_test_recipe` writes those numbers as plain YAML numbers (`retry_delay: 2.50`, `timeout: 30.0`,
 *    `- delay: 30`, `value: 0.0000001`), text in a text place stays quoted (`message: '30'`, `value: '2.50'`), and
 *    nothing is written with an exponent; an amend from it keeps `2.50` in the Retry Delay box.
 * 4. A labeled Delay, Set, Break, Continue, Halt and Note step reads back with `label:` beside the keyword, and an amend
 *    from the readback keeps every Block name on the canvas.
 * 5. A recipe binding `host` and `port` of a Database profile validates and creates; binding a field the profile
 *    lacks is refused `Profile '<p>' has no field 'portx'` with `Valid fields:` listing the profile's fields.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { numberInput } from '../../helpers/config-sheet'
import {
  BACKEND_URL,
  ensureEnvironment,
  HTTP_HEALTH_PORT,
  HTTP_TARGET_HOST,
  POSTGRES_PORT,
  SQL_TARGET_HOST,
} from '../../helpers/config'
import { getTest, runToken } from '../../helpers/element-types'
import { openTest } from '../../helpers/fn-seed'
import { finishRun, resolveEnvironmentId, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts, setConsoleMinimumLevel } from '../../helpers/log-reader'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import {
  deleteTestQuietly,
  discardSheet,
  ioLines,
  NUMBER_MCP_PORT,
  openGroup,
  recipeErrors,
  type Finding,
} from '../../helpers/number-rule'
import { resetOwnership } from '../../helpers/ownership'
import { openBlockSheet } from '../../helpers/workbench'
import { consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

const EXPONENT = /\d[eE][+-]?\d/
const LOG_STEP = '  - block: log\n    settings: {message: probe}\n'

type StoredNode = { id: string; data: Record<string, any> }

/** A recipe of one flow (indented YAML steps) under a fresh `zz-11541-s8-*` name. */
function recipe(name: string, flow: string, head = ''): string {
  return `test:\n  name: ${name}\n${head}flow:\n${flow}`
}

/** The stored node of an element type, by its Block name. */
async function nodeNamed(request: APIRequestContext, testId: string, label: string): Promise<StoredNode> {
  const nodes = (await getTest(request, testId)).workflow.nodes as StoredNode[]
  const node = nodes.find((entry) => entry.data.label === label)
  expect(node, `a Block named ${label} is stored`).toBeTruthy()
  return node as StoredNode
}

function expectOnlyError(result: ReturnType<typeof callTool>, expected: Finding): void {
  expect(result.payload.valid, JSON.stringify(result.payload)).toBe(false)
  expect(recipeErrors(result), JSON.stringify(result.payload.findings)).toEqual([expected])
}

test.describe('V-NUMBER-RECIPES-MCP-FUNCTIONAL: recipes and readbacks follow the number rule', () => {
  const cleanups: Array<() => Promise<unknown>> = []

  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, NUMBER_MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a number written in a form the rule refuses is refused, each with its own finding', async () => {
    test.setTimeout(240_000)
    const name = `zz-11541-s8-recipe-refusals-${runToken()}`
    const validate = (text: string) => callTool(NUMBER_MCP_PORT, 'validate_recipe', { recipe: text })

    await test.step('a float written 1.0e+5 and an integer written 0x1F are text', async () => {
      expectOnlyError(validate(recipe(name, LOG_STEP, 'variables:\n  f: {type: float, value: 1.0e+5}\n')), [
        'INVALID_VARIABLE_VALUE',
        "Variable 'f' expects float, got string",
      ])
      expectOnlyError(validate(recipe(name, LOG_STEP, 'variables:\n  i: {type: integer, value: 0x1F}\n')), [
        'INVALID_VARIABLE_VALUE',
        "Variable 'i' expects integer, got string",
      ])
    })

    await test.step('a Function input default abc is refused by its type', async () => {
      const functions =
        'functions:\n  - name: fx\n    inputs:\n      - {name: x, type: integer, default: abc}\n' +
        '    outputs: []\n    flow:\n      - block: log\n        settings: {message: in-fn}\n'
      expectOnlyError(validate(recipe(name, LOG_STEP, functions)), [
        'INVALID_VARIABLE_VALUE',
        "Input 'x' expects integer, got string",
      ])
    })

    await test.step('a Ping Interval .nan is text, refused by type with no bound finding', async () => {
      const flow = '  - block: ping\n    settings: {host: 127.0.0.1, count: 1, interval: .nan}\n'
      expectOnlyError(validate(recipe(name, flow)), [
        'INVALID_SETTING_TYPE',
        "Setting 'interval' of block 'ping' expects float, got string",
      ])
    })

    await test.step('a typed Driver options entry that is not an integer is refused at its key', async () => {
      const flow =
        '  - block: sql-client\n    settings:\n      operation: run_sql\n      database_type: sqlite\n' +
        '      file: artifact://number-rule.db\n      script_type: source\n      sql: SELECT 1\n' +
        '      driver_options: {timeout: x}\n    element_types: {driver_options: {timeout: integer}}\n'
      expectOnlyError(validate(recipe(name, flow)), [
        'INVALID_SETTING_TYPE',
        "Setting 'driver_options' of block 'sql-client' at key 'timeout' is not a valid integer",
      ])
    })
  })

  test('recipe numbers are stored as written, open as written, run, and read back as plain YAML numbers', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    const name = `zz-11541-s8-recipe-numbers-${runToken()}`
    const head =
      'variables:\n  tiny: {type: float, value: 0.0000001}\n  big: {type: integer, value: 1234567890123456789}\n' +
      '  code: {type: string, value: "2.50"}\n'
    const flow =
      '  - block: http-client\n    label: Typed Delay\n    settings:\n' +
      `      url: http://${HTTP_TARGET_HOST}:${HTTP_HEALTH_PORT}/health?who=recipe-numbers\n` +
      '      method: GET\n      retry_delay: 2.50\n      retry_backoff_factor: 0.0000001\n' +
      '      max_size: 1234567890123456789\n' +
      '  - for:\n      label: Timed Loop\n      count: 1\n      timeout: 30.0\n      body:\n' +
      '        - block: log\n          label: In Loop\n          settings: {message: in-loop}\n' +
      '  - delay: 30\n' +
      "  - block: log\n    label: Thirty Text\n    settings: {message: '30'}\n" +
      '  - block: log\n    label: Recipe Done\n    settings: {message: recipe-numbers-done}\n'
    const created = callTool(NUMBER_MCP_PORT, 'create_test_from_recipe', { recipe: recipe(name, flow, head) })
    expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
    const testId = created.payload.test_id as string
    cleanups.push(() => deleteTestQuietly(request, testId))

    const http = await nodeNamed(request, testId, 'Typed Delay')
    const loop = await nodeNamed(request, testId, 'Timed Loop')

    await test.step('the created Test stores each number as the text written', async () => {
      expect(http.data.config.values).toMatchObject({
        retry_delay: '2.50',
        retry_backoff_factor: '0.0000001',
        max_size: '1234567890123456789',
      })
      expect(loop.data.config.values.timeout).toBe('30.0')
      const variables = (await getTest(request, testId)).variables
      expect(variables.tiny.value).toBe('0.0000001')
      expect(variables.big.value).toBe('1234567890123456789')
      expect(variables.code.value).toBe('2.50')
    })

    await test.step('the Block windows show the numbers as written', async () => {
      await openTest(page, testId)
      const sheet = await openBlockSheet(page, http.id)
      await openGroup(sheet, 'Timeouts & Retries')
      await openGroup(sheet, 'Response')
      await expect(numberInput(sheet, 'retry_delay')).toHaveValue('2.50')
      await expect(numberInput(sheet, 'retry_backoff_factor')).toHaveValue('0.0000001')
      await expect(numberInput(sheet, 'max_size')).toHaveValue('1234567890123456789')
      await discardSheet(page, sheet)
      const loopSheet = await openBlockSheet(page, loop.id)
      await openGroup(loopSheet, 'Advanced')
      await expect(numberInput(loopSheet, 'timeout')).toHaveValue('30.0')
      await discardSheet(page, loopSheet)
    })

    await test.step('the run sends each number with every digit', async () => {
      await setConsoleMinimumLevel(page, 'DEBUG')
      const status = await startRun(page)
      await finishRun(page, status, 'recipe-numbers-done')
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      const inputs = ioLines(entries, 'Typed Delay', 'Inputs')
      expect(inputs).toHaveLength(1)
      for (const part of ['"retry_delay":2.5,', '"retry_backoff_factor":0.0000001,', '"max_size":1234567890123456789']) {
        expect(inputs[0]).toContain(part)
      }
      expect(inputs[0]).not.toMatch(EXPONENT)
    })

    await test.step('the readback writes stored digit text as plain YAML numbers, text stays quoted', async () => {
      const readback = callTool(NUMBER_MCP_PORT, 'get_test_recipe', { test_ref: testId })
      expect(readback.payload.expressible, JSON.stringify(readback.payload)).toBe(true)
      const text = readback.payload.recipe as string
      for (const line of [
        'retry_delay: 2.50\n',
        'retry_backoff_factor: 0.0000001\n',
        'max_size: 1234567890123456789\n',
        'timeout: 30.0\n',
        '- delay: 30\n',
        "message: '30'\n",
        'value: 0.0000001\n',
        'value: 1234567890123456789\n',
        "value: '2.50'\n",
      ]) {
        expect(text, `the readback holds "${line.trim()}"`).toContain(line)
      }
      // The random name can hold a digit, an "e" and a digit.
      expect(text.replaceAll(name, ''), 'no number is written with an exponent').not.toMatch(EXPONENT)

      const amended = callTool(NUMBER_MCP_PORT, 'amend_test_from_recipe', { test_ref: testId, recipe: text })
      expect(amended.payload.amended, JSON.stringify(amended.payload)).toBe(true)
      const again = await nodeNamed(request, testId, 'Typed Delay')
      expect(again.data.config.values.retry_delay).toBe('2.50')
      await openTest(page, testId)
      const sheet = await openBlockSheet(page, again.id)
      await openGroup(sheet, 'Timeouts & Retries')
      await expect(numberInput(sheet, 'retry_delay')).toHaveValue('2.50')
      await discardSheet(page, sheet)
    })
  })

  test('labeled control steps keep their label through a readback and an amend', async ({ page, request }) => {
    test.setTimeout(240_000)
    const labels = ['Wait 30', 'Count', 'Leave', 'Next', 'Stop here', 'Remark']
    const flow =
      '  - delay: 30\n    label: Wait 30\n' +
      '  - set: {counter: 1}\n    label: Count\n' +
      '  - for:\n      count: 1\n      body:\n        - break: {}\n          label: Leave\n' +
      '  - for:\n      count: 1\n      body:\n        - continue: {}\n          label: Next\n' +
      '  - block: log\n    settings: {message: labeled-done}\n' +
      '  - halt: {}\n    label: Stop here\n' +
      '  - note: {text: Reviewed}\n    label: Remark\n'
    const head = 'variables:\n  counter: {type: integer, value: 0}\n'
    const created = callTool(NUMBER_MCP_PORT, 'create_test_from_recipe', {
      recipe: recipe(`zz-11541-s8-recipe-labels-${runToken()}`, flow, head),
    })
    expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
    const testId = created.payload.test_id as string
    cleanups.push(() => deleteTestQuietly(request, testId))
    const storedLabels = async () =>
      ((await getTest(request, testId)).workflow.nodes as StoredNode[]).map((node) => String(node.data.label))

    const readback = callTool(NUMBER_MCP_PORT, 'get_test_recipe', { test_ref: testId })
    expect(readback.payload.expressible, JSON.stringify(readback.payload)).toBe(true)
    const text = readback.payload.recipe as string
    for (const label of labels) expect(text, `the readback names ${label}`).toContain(`label: ${label}\n`)
    expect(text).toMatch(/- delay: 30\n\s+label: Wait 30\n|- label: Wait 30\n\s+delay: 30\n/)

    const amended = callTool(NUMBER_MCP_PORT, 'amend_test_from_recipe', { test_ref: testId, recipe: text })
    expect(amended.payload.amended, JSON.stringify(amended.payload)).toBe(true)
    expect(await storedLabels()).toEqual(expect.arrayContaining(labels))

    await openTest(page, testId)
    for (const label of labels.filter((name) => name !== 'Remark')) {
      await expect(
        page.locator('[data-testid^="workflow-node-"]').filter({ hasText: label }).first(),
        `the canvas shows ${label}`,
      ).toBeVisible()
    }
  })

  test('a recipe binds host and port of a Database profile and is told the fields a profile has', async ({ request }) => {
    test.setTimeout(180_000)
    const token = runToken()
    const profileName = `zz-11541-s8-db-${token}`
    const environmentId = await resolveEnvironmentId(request)
    const config = {
      host: SQL_TARGET_HOST,
      port: Number(POSTGRES_PORT),
      database: 'wave',
      username: 'wave',
      password: '',
      verify_ssl: true,
      ca_cert: '',
      client_cert: '',
      client_key: '',
      driver_options: {},
    }
    const resp = await request.post(`${BACKEND_URL}/profiles`, {
      data: { name: profileName, type: 'database', tags: [], config, environment_values: { [environmentId]: config } },
    })
    expect(resp.ok(), `POST /profiles: ${resp.status()} ${await resp.text()}`).toBeTruthy()
    const profileId = (await resp.json()).data.id as string
    cleanups.push(() => request.delete(`${BACKEND_URL}/profiles/${profileId}`))
    const stored = (await (await request.get(`${BACKEND_URL}/profiles/${profileId}`)).json()).data
    const fields = new Set<string>(Object.keys(stored.config ?? {}))
    for (const values of Object.values((stored.environment_values ?? {}) as Record<string, object>)) {
      for (const key of Object.keys(values)) fields.add(key)
    }
    const valid = [...fields].sort().join(', ')
    expect(valid, 'the profile holds its typed fields').toContain('host, password, port')

    const boundStep = (bound: string) =>
      '  - block: sql-client\n    label: Profile Bound\n    settings:\n      operation: run_sql\n' +
      '      database_type: postgresql\n      host: {expr: "db.host"}\n      port: {expr: "db.port"}\n' +
      '      database: wave\n      username: wave\n      script_type: source\n      sql: SELECT 1\n' +
      `    profiles:\n      - profile: ${profileName}\n        alias: db\n        fields: [${bound}]\n`
    const name = `zz-11541-s8-recipe-profile-${token}`

    await test.step('host and port of the Database profile validate and create', async () => {
      const text = recipe(name, boundStep('host, port'))
      const verdict = callTool(NUMBER_MCP_PORT, 'validate_recipe', { recipe: text })
      expect(verdict.payload.valid, JSON.stringify(verdict.payload)).toBe(true)
      expect(recipeErrors(verdict)).toEqual([])
      const created = callTool(NUMBER_MCP_PORT, 'create_test_from_recipe', { recipe: text })
      expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
      cleanups.push(() => deleteTestQuietly(request, created.payload.test_id as string))
    })

    await test.step('a field the profile lacks is named with the fields it has', async () => {
      const verdict = callTool(NUMBER_MCP_PORT, 'validate_recipe', { recipe: recipe(`${name}-x`, boundStep('host, portx')) })
      expect(verdict.payload.valid, JSON.stringify(verdict.payload)).toBe(false)
      const findings = (verdict.payload.findings as Array<{ code: string; problem: string; fix: string }>).filter(
        (finding) => finding.code === 'UNKNOWN_PROFILE_FIELD',
      )
      expect(findings.map((finding) => [finding.problem, finding.fix])).toEqual([
        [`Profile '${profileName}' has no field 'portx'`, `Valid fields: ${valid}`],
      ])
    })
  })
})
