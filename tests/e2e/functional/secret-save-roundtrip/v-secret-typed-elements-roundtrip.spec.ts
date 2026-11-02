/**
 * V-SECRET-TYPED-ELEMENTS-ROUNDTRIP: a secret map or list keeps its declared element types
 * out of every read and still in force at run time.
 * REQ: REQ-3.1.3.19, REQ-3.1.3.5
 *
 * Pass Criteria:
 * 1. GET /tests/{id} returns the secret map and list as the bare placeholder with no
 *    element types, so no key is named and no item counted; a plain map keeps its types.
 * 2. A masked export (secrets=mask) carries no element types for the secrets either.
 * 3. A Suite's secret map reads back the same way (GET /suites/{id}).
 * 4. A run reads every secret element as its declared type: whole numbers add, the float
 *    doubles exactly, the zip code stays text.
 * 5. After an unrelated edit and a toolbar save (the secrets ride along masked) and a Suite
 *    save that echoes its masked secret, the secrets still read back with no element
 *    types, and a second run still reads every secret element as its declared type.
 * 6. A Variable Setter row marked secret keeps its element types sealed with its value:
 *    the workflow read and a masked export name no key and count no item of it.
 * 7. A run reads the setter's secret elements as their declared types, before and after an
 *    unrelated edit and a toolbar save that carries the sealed rows back.
 *
 * Phase: functional-workflow (creates its own Suite and Test, deletes both after).
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { openTest, validateTest } from '../../helpers/fn-seed'
import {
  expandVariableManager,
  openEditWindow,
  saveWindow,
  setWindowValue,
  variableRow,
} from '../../helpers/variable-create'
import { saveBtn, selectEnvironment } from '../../helpers/workbench'
import {
  deleteTest,
  expectProbeLines,
  getNode,
  getTest,
  importValidated,
  readFixture,
  runToken,
  settleRun,
} from '../../helpers/element-types'

const MASK = '********'
const SETTER_ID = '8b1f6d2e-4c3a-4e7b-9d15-6a2f0c8e3b71'
const SETTER_SECRET_ROWS = ['xm', 'xa']

type Declarations = Record<string, Record<string, unknown>>

/** A secret declaration reads back as the bare placeholder: no element types beside it. */
function expectOpaque(variables: Declarations, name: string): void {
  expect(variables[name].value, `${name} reads back masked`).toBe(MASK)
  expect(Object.keys(variables[name]), `${name} names no keys and counts no items`).not.toContain(
    'elementTypes',
  )
}

/** The setter's secret rows expose no readable element types: no key named, no item counted. */
function expectSetterRowsOpaque(node: Record<string, any>, surface: string): void {
  const record = (node.data?.variableElementTypes ?? {}) as Record<string, unknown>
  for (const name of SETTER_SECRET_ROWS) {
    expect(typeof record[name], `${surface}: ${name} element types are not readable`).not.toBe('object')
  }
  expect(JSON.stringify(record), `${surface}: no secret key is named`).not.toContain('zip')
}

/** Edit the plain counter in its Edit window and save the Test from the toolbar. */
async function editPlainCounterAndSave(page: Page, value: string): Promise<void> {
  await expandVariableManager(page)
  const win = await openEditWindow(page, 'plain_counter')
  await setWindowValue(page, win, value)
  await saveWindow(page, win)
  await expect(variableRow(page, 'plain_counter').locator('[data-testid^="variable-value-"]')).toHaveText(value)
  await expect(saveBtn(page)).toBeEnabled()
  await saveBtn(page).click()
  await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
}

async function suiteVariables(request: APIRequestContext, suiteId: string): Promise<Declarations> {
  const resp = await request.get(`${BACKEND_URL}/suites/${suiteId}`)
  expect(resp.ok(), `GET /suites/${suiteId}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data.variables as Declarations
}

test.describe('V-SECRET-TYPED-ELEMENTS-ROUNDTRIP: secret element types stay hidden and in force', () => {
  let testId = ''
  let suiteId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
    if (suiteId) await request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => undefined)
  })

  test('secret maps and lists read back opaque and run with their types', async ({ page, request }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    const token = runToken()
    const suite = await request.post(`${BACKEND_URL}/suites`, {
      data: {
        name: `Secret Typed Suite ${token}`,
        variables: {
          ss: {
            type: 'map',
            secret: true,
            value: { n: '16', zip: '02134' },
            elementTypes: { n: 'integer', zip: 'string' },
          },
          sp: { type: 'integer', value: '5', secret: false },
        },
      },
    })
    expect(suite.ok(), `POST /suites: ${suite.status()} ${await suite.text()}`).toBeTruthy()
    suiteId = (await suite.json()).data.id as string

    const fixture = readFixture(__dirname, 'element-types-fixture.json')
    const created = await request.post(`${BACKEND_URL}/tests`, {
      data: { ...fixture, name: `${fixture.name} ${token}` },
    })
    expect(created.ok(), `POST /tests: ${created.status()} ${await created.text()}`).toBeTruthy()
    testId = (await created.json()).data.id as string
    const added = await request.post(`${BACKEND_URL}/suites/${suiteId}/tests`, { data: { test_id: testId } })
    expect(added.ok(), `add the Test to the Suite: ${added.status()}`).toBeTruthy()
    const validation = await validateTest(request, testId)
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])

    await test.step('the Test read names no secret key and counts no secret item', async () => {
      const variables = (await getTest(request, testId)).variables as Declarations
      expectOpaque(variables, 'sm')
      expectOpaque(variables, 'sa')
      expect(variables.pm.elementTypes, 'a plain map keeps its element types').toEqual({ n: 'integer' })
    })

    await test.step('a masked export carries no secret element types', async () => {
      const resp = await request.get(`${BACKEND_URL}/tests/${testId}/export?format=json&secrets=mask`)
      expect(resp.ok(), `export: ${resp.status()}`).toBeTruthy()
      const exported = JSON.parse((await resp.body()).toString('utf-8')) as { variables: Declarations }
      expectOpaque(exported.variables, 'sm')
      expectOpaque(exported.variables, 'sa')
      expect(exported.variables.pm.elementTypes).toEqual({ n: 'integer' })
    })

    await test.step('the Suite read names no secret key', async () => {
      expectOpaque(await suiteVariables(request, suiteId), 'ss')
    })

    await test.step('a run reads every secret element as its declared type', async () => {
      await openTest(page, testId)
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), [
        'SEC n=17 f=2.0 zt=True a0=17 a1t=True pmn=42 sn=17 szt=True sp=5 plain=7',
      ])
    })

    await test.step('masked re-saves keep the secret element types in force', async () => {
      await openTest(page, testId)
      await editPlainCounterAndSave(page, '99')

      const variables = (await getTest(request, testId)).variables as Declarations
      expect(String(variables.plain_counter.value), 'the unrelated edit persisted').toBe('99')
      expectOpaque(variables, 'sm')
      expectOpaque(variables, 'sa')

      const echoed = await suiteVariables(request, suiteId)
      const put = await request.put(`${BACKEND_URL}/suites/${suiteId}`, {
        data: { variables: { ...echoed, sp: { ...echoed.sp, value: '6' } } },
      })
      expect(put.ok(), `PUT /suites: ${put.status()} ${await put.text()}`).toBeTruthy()
      expectOpaque(await suiteVariables(request, suiteId), 'ss')

      await openTest(page, testId)
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), [
        'SEC n=17 f=2.0 zt=True a0=17 a1t=True pmn=42 sn=17 szt=True sp=6 plain=99',
      ])
    })
  })

  test('a secret Variable Setter row keeps its element types sealed with its value', async ({ page, request }) => {
    test.setTimeout(240_000)
    testId = await importValidated(request, readFixture(__dirname, 'setter-element-types-fixture.json'))

    await test.step('the workflow read names no key and counts no item of the secret rows', async () => {
      expectSetterRowsOpaque(await getNode(request, testId, SETTER_ID), 'workflow read')
    })

    await test.step('a masked export carries no element types for the secret rows', async () => {
      const resp = await request.get(`${BACKEND_URL}/tests/${testId}/export?format=json&secrets=mask`)
      expect(resp.ok(), `export: ${resp.status()}`).toBeTruthy()
      const exported = JSON.parse((await resp.body()).toString('utf-8')) as {
        workflow: { nodes: Array<Record<string, any>> }
      }
      const setter = exported.workflow.nodes.find((node) => node.id === SETTER_ID)
      expect(setter, 'the export carries the setter').toBeTruthy()
      expectSetterRowsOpaque(setter!, 'masked export')
    })

    await test.step('a run reads the secret rows as their declared types', async () => {
      await openTest(page, testId)
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), ['XSEC n=17 zt=True a0=17 a1t=True plain=7'])
    })

    await test.step('an unrelated edit and a toolbar save keep the rows sealed and in force', async () => {
      await openTest(page, testId)
      await editPlainCounterAndSave(page, '99')
      expectSetterRowsOpaque(await getNode(request, testId, SETTER_ID), 'workflow read after a save')

      await openTest(page, testId)
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), ['XSEC n=17 zt=True a0=17 a1t=True plain=99'])
    })
  })
})
