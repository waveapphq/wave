/**
 * V-NUMBER-STORED-FORM-FUNCTIONAL: numbers a REST client sends are stored in plain form and shown as stored
 * Wireframe: none (functional)
 * Design Decisions: FIELD-1, VMGR-110
 * REQ: REQ-3.1.3.14
 *
 * `fixture-stored.json` holds an HTTP Retry Delay, a Variable Setter row and an Assert compare-to value that the spec
 * sends to POST /tests as the JSON number `1e-7`. A Suite (float variable sent as `30.0`), a library Function (float
 * input default `0.00001`) and Tests holding a Function Block integer list input are made through the REST API, all
 * `zz-11541-s8-*`.
 *
 * Pass Criteria:
 * 1. A Test saved with Retry Delay, a Setter row and an Assert compare-to value of `1e-7` stores `"0.0000001"` and
 *    opens with `0.0000001` in the Retry Delay box, the Setter row box and the compare-to box.
 * 2. The Test's JSON file in a backup holds `"retry_delay": "0.0000001"`.
 * 3. A float Suite variable created as `30.0` is stored as `30.0` and reopens in the Suite's variables as `30.0`.
 * 4. A Function published with a float input default `0.00001` shows `0.00001` in the Function view and as the gray
 *    default in the Function Block window.
 * 5. A Function Block integer list input holding `1234567890123456789` is stored with every digit and reopens with
 *    all 19 digits in its list editor; a list whose second item is `1e5` is refused with `Setting 'ids' of block
 *    'scale_ids' at item 2 is not a valid integer`.
 * 6. A PATCH of a Test's variables giving the integer variable `n` the value `2.5` is refused with `Value for
 *    variable 'n' is not a valid integer`, and the Test keeps its variables.
 * 7. A Test create or update whose body is a JSON string, not an object, is refused with 400 `The request body must
 *    be a JSON object` and writes nothing.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { numberInput } from '../../helpers/config-sheet'
import { BACKEND_URL } from '../../helpers/config'
import { valueBox } from '../../helpers/condition-builder'
import { readFixture, runToken } from '../../helpers/element-types'
import { entityVariableRow, openEntityVariables } from '../../helpers/entity-variables'
import { injectHttpHost } from '../../helpers/fixture-import'
import { logNode, openFunctionView, openTest, publishLibraryFunction, sharedNode, startEdge, validateTest } from '../../helpers/fn-seed'
import {
  createTest,
  deleteFunctionQuietly,
  deleteTestQuietly,
  discardSheet,
  expectTestRefused,
  functionName,
  nodeIdOf,
  openGroup,
  postJson,
  rawJson,
  sendJson,
  storedNode,
} from '../../helpers/number-rule'
import { expandVariableManager, setValueEditorView, variableRow } from '../../helpers/variable-create'
import { openBlockSheet, openFunctionBlockSheet } from '../../helpers/workbench'
import { readZipEntryText, zipEntryNames } from '../../helpers/zip-reader'

const TINY = '0.0000001'
const BIG = '1234567890123456789'
const LIST_BLOCK = 'e4a7c2d9-6b31-4f8e-a0d5-11541008c001'
const CALL_BLOCK = 'e4a7c2d9-6b31-4f8e-a0d5-11541008c002'
const DONE_BLOCK = 'e4a7c2d9-6b31-4f8e-a0d5-11541008c003'

/** A Test holding one Local Function `scale_ids` whose integer list input `ids` holds `items`. */
function listTest(items: unknown[]): Record<string, unknown> {
  return {
    name: `zz-11541-s8-ids-${runToken()}`,
    version: '1.0.0',
    description: 'A Function Block integer list input',
    workflow: {
      nodes: [
        {
          id: LIST_BLOCK,
          type: 'workflowNode',
          position: { x: 300, y: 100 },
          data: {
            label: 'Scale Ids',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            category: 'function',
            version: '1.0.0',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            localDefinition: {
              name: 'scale_ids',
              inputs: [{ name: 'ids', type: 'array', required: true }],
              outputs: [],
              variables: [],
              workflow: { nodes: [], edges: [] },
            },
            elementTypes: { ids: items.map(() => 'integer') },
            config: { values: { ids: items }, outputBindings: {}, profileBindings: [] },
          },
          measured: { width: 140, height: 62 },
        },
      ],
      edges: [startEdge(LIST_BLOCK)],
    },
    variables: {},
    metadata: {},
  }
}

test.describe('V-NUMBER-STORED-FORM-FUNCTIONAL: REST numbers are stored and shown in plain form', () => {
  const cleanups: Array<() => Promise<unknown>> = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined)
  })

  test('1e-7 from a REST client is stored, backed up and shown as 0.0000001; 30.0 stays 30.0', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const fixture = readFixture(__dirname, 'fixture-stored.json')
    const retry = nodeIdOf(fixture, 'Tiny Retry')
    const setter = nodeIdOf(fixture, 'Set Tiny')
    const check = nodeIdOf(fixture, 'Check Tiny')
    const body = rawJson(injectHttpHost({ ...fixture, name: `zz-11541-s8-stored-${runToken()}` }), { __TINY__: '1e-7' })
    expect(body).toContain('"retry_delay":1e-7')
    const testId = await createTest(request, body)
    cleanups.push(() => deleteTestQuietly(request, testId))
    expect((await validateTest(request, testId)).errors).toEqual([])

    await test.step('the stored Test holds plain digit text in each number place', async () => {
      expect((await storedNode(request, testId, retry)).data.config.values.retry_delay).toBe(TINY)
      expect((await storedNode(request, testId, setter)).data.config.values.variables.f).toBe(TINY)
      const assertion = (await storedNode(request, testId, check)).data.config.values.assertions[0]
      expect(assertion.reference_value).toBe(TINY)
    })

    await test.step('the Retry Delay, the Setter row and the compare-to value show 0.0000001', async () => {
      await openTest(page, testId)
      const http = await openBlockSheet(page, retry)
      await openGroup(http, 'Timeouts & Retries')
      await expect(numberInput(http, 'retry_delay')).toHaveValue(TINY)
      await discardSheet(page, http)
      const setterSheet = await openBlockSheet(page, setter)
      await expect(setterSheet.locator('[data-testid="scalar-edit-input"]')).toHaveValue(TINY)
      await discardSheet(page, setterSheet)
      const assertSheet = await openBlockSheet(page, check)
      await expect(valueBox(assertSheet, '0')).toHaveValue(TINY)
      await discardSheet(page, assertSheet)
    })

    await test.step('the backup file of the Test holds "0.0000001"', async () => {
      const backup = await request.post(`${BACKEND_URL}/api/backup/create`, {
        data: {
          entity_types: ['tests'],
          format: 'json',
          compression_method: 'deflate',
          compression_level: 6,
          secrets: 'encrypted',
        },
      })
      expect(backup.ok(), `POST /api/backup/create: ${backup.status()}`).toBeTruthy()
      const archive = await backup.body()
      const entry = zipEntryNames(archive).find((name) => name.endsWith('.json') && readZipEntryText(archive, name).includes(testId))
      expect(entry, 'the backup carries the Test as a JSON file').toBeTruthy()
      const text = readZipEntryText(archive, entry as string)
      expect(text).toMatch(/"retry_delay":\s*"0\.0000001"/)
      expect(text).not.toMatch(/"retry_delay":\s*1e-0?7/)
    })

    await test.step('a float Suite variable sent as 30.0 is stored and reopened as 30.0', async () => {
      const name = `zz-11541-s8-suite-${runToken()}`
      const created = await postJson(
        request,
        '/suites',
        `{"name": "${name}", "variables": {"rate": {"type": "float", "value": 30.0, "secret": false}}}`,
      )
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300)
      const suiteId = created.body.data.id as string
      cleanups.push(() => request.delete(`${BACKEND_URL}/suites/${suiteId}`))
      const stored = await (await request.get(`${BACKEND_URL}/suites/${suiteId}`)).json()
      expect(stored.data.variables.rate.value).toBe('30.0')
      const dialog = await openEntityVariables(page, 'suite', suiteId)
      const row = await entityVariableRow(dialog, 'rate')
      await expect(row.locator('[data-testid="scalar-edit-input"]')).toHaveValue('30.0')
      await dialog.locator('[data-testid="edit-dialog-cancel"]').click()
      await expect(dialog).toBeHidden()
    })
  })

  test('a float Function input default published as 0.00001 shows 0.00001 in the Function and on the Block', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const fn = await publishLibraryFunction(request, {
      name: functionName('rate'),
      inputs: [{ name: 'rate', type: 'float', required: false, default: 0.00001, description: 'A small rate' }],
    })
    cleanups.push(() => deleteFunctionQuietly(request, fn.functionId))
    const read = await (await request.get(`${BACKEND_URL}/functions/${fn.functionId}`)).json()
    const declared = JSON.stringify(read.data)
    expect(declared, 'the default is stored as plain digit text').toContain('"default":"0.00001"')

    await test.step('the Function view lists the input with 0.00001', async () => {
      await openFunctionView(page, fn.functionId, fn.version)
      await expandVariableManager(page)
      await expect(variableRow(page, 'rate')).toContainText('0.00001')
      await expect(variableRow(page, 'rate')).not.toContainText('1e-5')
    })

    await test.step('the Function Block window shows 0.00001 as the gray default', async () => {
      const call = sharedNode(CALL_BLOCK, {
        functionId: fn.functionId,
        functionVersion: fn.version,
        label: 'Call Rate',
        originalLibraryName: fn.name,
      })
      const testId = await createTest(request, {
        name: `zz-11541-s8-call-rate-${runToken()}`,
        version: '1.0.0',
        workflow: {
          nodes: [call, logNode(DONE_BLOCK, 'Rate Done', "'number-rate-done'")],
          edges: [startEdge(CALL_BLOCK), { id: 'e-call-done', source: CALL_BLOCK, target: DONE_BLOCK }],
        },
        variables: {},
        metadata: {},
      })
      cleanups.push(() => deleteTestQuietly(request, testId))
      await openTest(page, testId)
      const sheet = await openFunctionBlockSheet(page, CALL_BLOCK)
      await expect(numberInput(sheet, 'rate')).toHaveValue('0.00001')
      await discardSheet(page, sheet)
    })
  })

  test('a PATCH with 2.5 for an integer variable and a body that is no JSON object are refused, changing nothing', async ({
    request,
  }) => {
    test.setTimeout(60_000)
    const name = `zz-11541-s8-patch-${runToken()}`
    const testId = await createTest(request, {
      name,
      version: '1.0.0',
      workflow: { nodes: [], edges: [] },
      variables: { n: { type: 'integer', value: 5, scope: 'test' } },
      metadata: {},
    })
    cleanups.push(() => deleteTestQuietly(request, testId))
    const stored = async () => (await (await request.get(`${BACKEND_URL}/tests/${testId}`)).json()).data
    const before = await stored()

    await test.step('a PATCH of the variables with 2.5 for the integer n is refused, the variables kept', async () => {
      const answer = await sendJson(request, 'PATCH', `/tests/${testId}/variables`, {
        variables: { n: { type: 'integer', value: 2.5 } },
      })
      expect(answer.status, JSON.stringify(answer.body)).toBe(400)
      expect(answer.body.error?.message).toMatch(/^Value for variable 'n' is not a valid integer$/)
      expect((await stored()).variables).toEqual(before.variables)
    })

    await test.step('a create or update whose body is a JSON string is a bad request and writes nothing', async () => {
      const text = JSON.stringify(JSON.stringify({ name: `${name}-text`, workflow: { nodes: [], edges: [] } }))
      const created = await sendJson(request, 'POST', '/tests', text)
      expect(created.status, JSON.stringify(created.body)).toBe(400)
      expect(created.body.error?.message).toMatch(/^The request body must be a JSON object$/)
      const listed = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(`${name}-text`)}`)
      expect((await listed.json()).data ?? [], 'no Test is written').toHaveLength(0)

      const updated = await sendJson(request, 'PUT', `/tests/${testId}`, text)
      expect(updated.status, JSON.stringify(updated.body)).toBe(400)
      expect(updated.body.error?.message).toMatch(/^The request body must be a JSON object$/)
      expect(await stored(), 'the Test is unchanged').toEqual(before)
    })
  })

  test('a Function Block integer list input keeps 19 digits and refuses an item that is no integer', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    await test.step('an item 1e5 is refused naming the item', async () => {
      await expectTestRefused(request, listTest([1, '1e5']), [
        ['INVALID_SETTING_TYPE', "Setting 'ids' of block 'scale_ids' at item 2 is not a valid integer"],
      ])
    })

    const body = JSON.stringify(listTest([30, '__BIG__'])).replace('"__BIG__"', BIG)
    const testId = await createTest(request, body)
    cleanups.push(() => deleteTestQuietly(request, testId))

    await test.step('19 digits sent as a JSON number are stored with every digit', async () => {
      expect((await storedNode(request, testId, LIST_BLOCK)).data.config.values.ids).toEqual([30, BIG])
    })

    await test.step('the list editor shows all 19 digits', async () => {
      await openTest(page, testId)
      const sheet = await openFunctionBlockSheet(page, LIST_BLOCK)
      await sheet.locator('[data-testid="param-expand-ids"]').click()
      const editor = page.locator('[data-testid="value-editor-sheet"]')
      await expect(editor).toBeVisible()
      await setValueEditorView(page, editor, 'Visual')
      await expect(editor.locator('[data-testid="array-edit-input-0"]')).toHaveValue('30')
      await expect(editor.locator('[data-testid="array-edit-input-1"]')).toHaveValue(BIG)
      await editor.locator('[data-testid="value-editor-cancel-button"]').click()
      await expect(editor).toBeHidden()
      await discardSheet(page, sheet)
    })
  })
})
