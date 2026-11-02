/**
 * V-FIELD-CHOICE-AT-CREATION-FUNCTIONAL: choice lists and true / false hold a real value from the moment a Block is made
 * Design Decisions: FIELD-8, FIELD-2, SHELL-10, VMGR-112, VMGR-113, FNCFG-9
 * REQ: REQ-3.1.1.5, REQ-3.1.2.10, REQ-4.7.16
 *
 * Fixture `fixture-choice.json` (POST /tests, zero validation errors): Start, a Log `Anchor`, a Netcat `Talk` in
 * Talk mode with CRLF and Close after sending ticked, and a Local Function Block `Choice_Fn` with no inputs. The
 * expected values come from the MCP block catalog (`get_block`). Every Test is named `zz-11541-s10-*` and deleted.
 *
 * Pass Criteria:
 * 1. A palette drop (HTTP Request, SQL) and a Quick Insert (CSV Parser) store every choice-list and true / false
 *    field the catalog declares with its default, shown or hidden, and no free-entry field (saved with the
 *    Blocks disabled, so no window Save touched them); SQL holds `tls: false` for its PostgreSQL default.
 * 2. Duplicate and copy + paste of an HTTP Request whose Method, Verify Server Certificate and Proxy were changed
 *    store exactly the original Block's values.
 * 3. A Netcat choice row hidden by Mode Check stores nothing at Save; Mode Talk again shows CRLF line endings and
 *    Close after sending unticked and Send on Text, and Save stores `false`, `false` and `text`.
 * 4. Inputs added to a Local Function: a true / false input (default True) and an enum input (default `high`)
 *    start on their default on the existing Function Block; a new free-entry input (default `hello`) starts not set.
 * 5. Recipe compile writes every catalog choice default on each Block it makes, and each Required enum and
 *    true / false input of a Function step from the Function's default; free-entry fields left out stay unwritten.
 * 6. `get_test_recipe` reads back every stored choice value.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, HTTP_MAIN_PORT, HTTP_TARGET_HOST, ensureEnvironment } from '../../helpers/config'
import { readFixture, runToken } from '../../helpers/element-types'
import { importFixtureTest } from '../../helpers/fixture-import'
import { openTest } from '../../helpers/fn-seed'
import { deleteSeededTest, openGroup } from '../../helpers/list-fields'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { createFunctionParam } from '../../helpers/variable-create'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { digIn, openFunctionBlockSheet, popToBreadcrumbSegment, saveTest } from '../../helpers/workbench'
import {
  addsOneBlock,
  catalogChoiceDefaults,
  choiceTrigger,
  expectHolds,
  lineBox,
  pasteOnCanvas,
  pickChoice,
  setTrueFalse,
  storedNodes,
  storedValues,
  trueFalseBox,
  type Values,
} from '../../helpers/choice-tls'
import {
  disableBlock,
  dropBelow,
  nodeLocator,
  openConfig,
  openLaneCanvas,
  quickAddAfter,
  saveConfig,
} from '../canvas-lanes/lanes-helpers'

// One MCP port per stack, as the recipe specs use it.
const MCP_PORT = Number(BACKEND_PORT) + 765

const FIXTURE = 'fixture-choice.json'
const ANCHOR = '8c3666b2-29c3-421a-aede-2b84ebb2c71a'
const TALK = '8256efc2-5cce-44f0-9ab0-2b5837bcdf18'
const FN = '0b4a6873-c4f1-471c-a198-6e6e4f307cd4'

const ECHO_URL = `https://${HTTP_TARGET_HOST}:${HTTP_MAIN_PORT}/echo`
const HTTP_PALETTE = 'http'
const SQL_PALETTE = 'sql'
const CSV_QUICK = { query: 'csv', row: 'csv-parser' }

/** Free-entry HTTP fields a new Block leaves not set (FIELD-2). */
const HTTP_FREE_ENTRY = ['url', 'timeout', 'retry_count', 'retry_delay', 'headers', 'body', 'max_redirects']

interface Seeded {
  testId: string
  name: string
}

async function seed(page: Page): Promise<Seeded> {
  const testId = await importFixtureTest(page, readFixture(__dirname, FIXTURE))
  const response = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
  return { testId, name: (await response.json()).data.name as string }
}

test.describe('V-FIELD-CHOICE-AT-CREATION-FUNCTIONAL: choice values written when a Block is made', () => {
  const created: string[] = []

  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    for (const id of created.splice(0)) await deleteSeededTest(page, id)
    await resetOwnership(request)
  })

  test('a palette drop and a Quick Insert store every choice default of the catalog, shown or hidden', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const { testId } = await seed(page)
    created.push(testId)

    const catalog = await test.step('the catalog lists the choice defaults', async () => {
      await enableMcpUntilRestart(page, MCP_PORT)
      try {
        return {
          http: catalogChoiceDefaults(MCP_PORT, 'http-client'),
          csv: catalogChoiceDefaults(MCP_PORT, 'csv-parser'),
          sql: catalogChoiceDefaults(MCP_PORT, 'sql-client'),
        }
      } finally {
        await resetMcpSettings(page)
      }
    })

    await openLaneCanvas(page, testId)
    const http = await dropBelow(page, ANCHOR, null, HTTP_PALETTE)
    const csv = await quickAddAfter(page, http, CSV_QUICK)
    const sql = await dropBelow(page, csv, null, SQL_PALETTE)
    // Disabled Blocks skip the required checks, so the Test saves with what creation wrote and no window Save.
    for (const id of [http, csv, sql]) await disableBlock(page, id)
    await saveTest(page)

    await test.step('the palette HTTP Request holds every choice default and no free-entry value', async () => {
      const values = await storedValues(page.request, testId, http)
      expectHolds(values, catalog.http, 'HTTP Request holds the catalog choice defaults')
      expectHolds(
        values,
        { method: 'GET', verify_ssl: true, tls_min_version: '1.2', tls_max_version: '1.3', proxy_mode: 'wave-setting', body_mode: 'text', auth_enabled: false },
        'HTTP Request spot values',
      )
      for (const name of HTTP_FREE_ENTRY) expect(values, `${name} stays not set`).not.toHaveProperty(name)
    })

    await test.step('the Quick Insert CSV Parser holds every choice default, hidden rows included', async () => {
      const values = await storedValues(page.request, testId, csv)
      expectHolds(values, catalog.csv, 'CSV Parser holds the catalog choice defaults')
      expectHolds(values, { operation: 'parse', has_header: true, on_mismatch: 'fail' }, 'CSV Parser spot values')
      expect(values, 'CSV Content stays not set').not.toHaveProperty('csv_content')
    })

    await test.step('the palette SQL holds every choice default and TLS off for PostgreSQL', async () => {
      const values = await storedValues(page.request, testId, sql)
      expectHolds(values, catalog.sql, 'SQL holds the catalog choice defaults')
      expectHolds(values, { database_type: 'postgresql', tls: false }, 'SQL spot values')
    })
  })

  test("duplicate and copy + paste store the Block's own choice values", async ({ page }) => {
    test.setTimeout(180_000)
    const { testId } = await seed(page)
    created.push(testId)
    await openLaneCanvas(page, testId)
    const http = await dropBelow(page, ANCHOR, null, HTTP_PALETTE)

    await test.step('Method, Verify Server Certificate and Proxy are changed and saved', async () => {
      const sheet = await openConfig(page, http)
      await lineBox(sheet, 'url').fill(ECHO_URL)
      await pickChoice(page, sheet, 'method', 'DELETE')
      await openGroup(sheet, 'TLS / Certificates')
      await setTrueFalse(sheet, 'verify_ssl', false)
      await openGroup(sheet, 'Connection')
      await pickChoice(page, sheet, 'proxy_mode', 'Off')
      await saveConfig(sheet)
    })

    await clickNodeKebabItem(page, http, 'Copy')
    const pane = await page.locator('.react-flow__pane').boundingBox()
    expect(pane, 'the canvas pane is laid out').toBeTruthy()
    const pasted = await addsOneBlock(page, () => pasteOnCanvas(page, { x: pane!.width * 0.7, y: pane!.height * 0.75 }))
    // The duplicate lands over the original, so it is made last.
    const duplicate = await addsOneBlock(page, () => clickNodeKebabItem(page, http, 'Duplicate'))
    await saveTest(page)

    const original = await storedValues(page.request, testId, http)
    expectHolds(original, { method: 'DELETE', verify_ssl: false, proxy_mode: 'off' }, 'the original holds the changed choices')
    expect(await storedValues(page.request, testId, duplicate), 'the duplicate holds the same values').toEqual(original)
    expect(await storedValues(page.request, testId, pasted), 'the pasted copy holds the same values').toEqual(original)
    await expect(nodeLocator(page, pasted)).toBeVisible()
  })

  test('a hidden choice row stores nothing and starts on its default when it shows again', async ({ page }) => {
    test.setTimeout(180_000)
    const { testId } = await seed(page)
    created.push(testId)
    await openLaneCanvas(page, testId)

    await test.step('Mode Check hides CRLF line endings, Close after sending and Send; Save stores none of them', async () => {
      const sheet = await openConfig(page, TALK)
      await openGroup(sheet, 'Advanced')
      await expect(trueFalseBox(sheet, 'crlf')).toHaveAttribute('data-state', 'checked')
      await expect(trueFalseBox(sheet, 'close_after_send')).toHaveAttribute('data-state', 'checked')
      await pickChoice(page, sheet, 'mode', 'Check')
      await expect(sheet.locator('[data-testid="param-row-crlf"]')).toHaveCount(0)
      await expect(sheet.locator('[data-testid="param-row-send"]')).toHaveCount(0)
      await saveConfig(sheet)
      await saveTest(page)
      const values = await storedValues(page.request, testId, TALK)
      expect(values.mode).toBe('check')
      for (const name of ['crlf', 'close_after_send', 'send']) expect(values, `${name} is not stored`).not.toHaveProperty(name)
    })

    await test.step('Mode Talk shows the rows on their defaults and Save stores them', async () => {
      const sheet = await openConfig(page, TALK)
      await pickChoice(page, sheet, 'mode', 'Talk')
      await openGroup(sheet, 'Advanced')
      await expect(trueFalseBox(sheet, 'crlf')).toHaveAttribute('data-state', 'unchecked')
      await expect(trueFalseBox(sheet, 'close_after_send')).toHaveAttribute('data-state', 'unchecked')
      await expect(choiceTrigger(sheet, 'send')).toHaveText('Text')
      await saveConfig(sheet)
      await saveTest(page)
      expectHolds(
        await storedValues(page.request, testId, TALK),
        { mode: 'talk', send: 'text', crlf: false, close_after_send: false },
        'the rows shown again hold their defaults',
      )
    })
  })

  test('inputs added to a Local Function: choices start on their default, a free-entry input starts not set', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const { testId, name } = await seed(page)
    created.push(testId)
    await openTest(page, testId)
    await digIn(page, FN)
    await expect(page.getByTestId('add-variable-dropdown-trigger')).toBeVisible()

    await createFunctionParam(page, 'input', 'verbose', { type: 'boolean', value: 'true' })
    await createFunctionParam(page, 'input', 'level', { createEnum: true, enumValues: ['low', 'high'], value: 'high' })
    await createFunctionParam(page, 'input', 'note', { value: 'hello' })
    await popToBreadcrumbSegment(page, name)
    await expect(nodeLocator(page, FN)).toBeVisible()

    await test.step('the Function Block window shows the choices held and the free entry in gray', async () => {
      const sheet = await openFunctionBlockSheet(page, FN)
      await expect(trueFalseBox(sheet, 'verbose')).toHaveAttribute('data-state', 'checked')
      await expect(choiceTrigger(sheet, 'level')).toHaveText('high')
      await expect(sheet.locator('[data-testid="param-reset-note"]'), 'the free entry holds no value').toHaveCount(0)
      await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
      await expect(sheet).toHaveCount(0)
    })

    await saveTest(page)
    const values = await storedValues(page.request, testId, FN)
    expectHolds(values, { verbose: true, level: 'high' }, 'the new choice inputs hold their defaults')
    expect(values, 'the new free-entry input is not set').not.toHaveProperty('note')
  })

  test('recipe compile writes every choice default and the readback lists each stored choice value', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
    try {
      const blocks = ['http-client', 'csv-parser', 'netcat', 'sql-client'] as const
      const catalog = Object.fromEntries(blocks.map((id) => [id, catalogChoiceDefaults(MCP_PORT, id)])) as Record<
        (typeof blocks)[number],
        Values
      >
      const name = `zz-11541-s10-recipe-${runToken()}`
      const recipe = `test:
  name: ${name}
  description: Choice values written at compile
functions:
  - name: zz_s10_pick
    inputs:
      - {name: level, type: string, required: true, enumValues: [low, high], default: high}
      - {name: verbose, type: boolean, required: true, default: true}
      - {name: note, type: string, default: base}
    flow:
      - block: log
        settings:
          message: picked
flow:
  - block: http-client
    label: Recipe HTTP
    settings:
      url: ${ECHO_URL}
  - block: csv-parser
    label: Recipe CSV
    settings:
      csv_content: "a,b"
  - block: netcat
    label: Recipe Netcat
    settings:
      host: 127.0.0.1
      port: 9470
  - block: sql-client
    label: Recipe SQL
    settings:
      host: 127.0.0.1
      database: wave
      username: wave
      sql: SELECT 1
  - function: zz_s10_pick
`
      const result = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
      expect(result.payload.created, JSON.stringify(result.payload)).toBe(true)
      const testId = result.payload.test_id as string
      created.push(testId)

      const nodes = await storedNodes(request, testId)
      const byType = (type: string) => {
        const node = nodes.find((entry) => entry.data?.elementType === type)
        expect(node, `the ${type} Block is stored`).toBeTruthy()
        return (node!.data.config?.values ?? {}) as Values
      }

      await test.step('each created Block holds every choice default of the catalog', () => {
        for (const id of blocks) expectHolds(byType(id), catalog[id], `${id} holds the catalog choice defaults`)
        expectHolds(byType('sql-client'), { database_type: 'postgresql', tls: false }, 'SQL holds its dialect TLS')
        expect(byType('http-client'), 'Timeout stays not set').not.toHaveProperty('timeout')
      })

      await test.step('the Function step holds its Required enum and true / false defaults, not the free entry', () => {
        const fn = byType('function')
        expectHolds(fn, { level: 'high', verbose: true }, 'the Function Block choice inputs')
        expect(fn, 'the free-entry input is not written').not.toHaveProperty('note')
      })

      await test.step('get_test_recipe lists every stored choice value', () => {
        const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: testId })
        expect(readback.payload.expressible, JSON.stringify(readback.payload)).toBe(true)
        const text = readback.payload.recipe as string
        const stored: Array<[string, unknown]> = [
          ...blocks.flatMap((id) => Object.entries(catalog[id])),
          ...Object.entries(byType('function')),
        ]
        for (const [key, value] of stored) {
          const word = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          expect(text, `the readback writes ${key}: ${String(value)}`).toMatch(new RegExp(`^\\s+${key}: ['"]?${word}['"]?$`, 'm'))
        }
      })
    } finally {
      await resetMcpSettings(page)
    }
  })
})
