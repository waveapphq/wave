/**
 * V-CANVAS-FN-PARAM-EDIT-01: editing an input's and an output's default in their Edit windows persists
 * Design Decisions: VMGR-106, VMGR-108, VMGR-113
 * REQ: REQ-3.1.1.5, REQ-3.1.2.1
 *
 * Seed (API): `fixture.json` - a Test with one Local Function `Function_1` declaring the String input
 * `user_id` (default `admin`) and the Integer output `result` (default 0).
 *
 * Pass Criteria:
 * 1. Drilled into Function_1, the pencil on `user_id` opens its Edit window on the Default view showing
 *    `admin`; the default changed to `guest` and saved is the stored input default.
 * 2. The pencil on `result` opens its Edit window on the Initial view showing 0; the default changed to 42 and
 *    saved is the stored output default (an integer may be carried as its digit string).
 * 3. After the Test save, a reload and a drill back in, the Edit windows show `guest` and 42.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import {
  cancelWindow,
  expectWindowValue,
  openEditWindow,
  saveWindow,
  setWindowValue,
  valueSwitch,
} from '../../helpers/variable-create'
import { saveTest } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-PARAM-EDIT-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: loadFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function drillIn(page: Page) {
  await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()
}

/** The pencil opens the parameter's Edit window on its stored default; the new default is saved. */
async function editDefault(page: Page, name: string, view: string, shown: string | number, next: string | number) {
  const win = await openEditWindow(page, name)
  await expect(valueSwitch(win)).toHaveText(view)
  await expectWindowValue(win, shown)
  await setWindowValue(page, win, next)
  await saveWindow(page, win)
}

/** The Edit window opened from the pencil shows `shown`; it closes again with nothing changed. */
async function expectDefault(page: Page, name: string, shown: string | number) {
  const win = await openEditWindow(page, name)
  await expectWindowValue(win, shown)
  await cancelWindow(page, win)
}

interface FunctionNodeData {
  data?: {
    localDefinition?: {
      inputs?: Array<{ name: string; default: unknown }>
      outputs?: Array<{ name: string; default: unknown }>
    }
  }
}

async function fetchFunctionSpec(
  request: APIRequestContext,
  testId: string,
): Promise<FunctionNodeData> {
  const resp = await request.get(`${BASE}/tests/${testId}/workflow`)
  const body = await resp.json()
  const workflow = body.data ?? body
  const fnNode = workflow.nodes.find((n: { id: string }) => n.id === 'fn-1') as FunctionNodeData
  expect(fnNode, 'Function node fn-1 missing from workflow').toBeTruthy()
  return fnNode
}

function expectStoredDefaults(spec: FunctionNodeData, input: string, output: string) {
  expect(spec.data?.localDefinition?.inputs?.[0]).toMatchObject({ name: 'user_id', default: input })
  expect(spec.data?.localDefinition?.outputs?.[0]?.name).toBe('result')
  // Integers may persist as exact digit strings, so compare as text.
  expect(String(spec.data?.localDefinition?.outputs?.[0]?.default)).toBe(output)
}

test.describe('V-CANVAS-FN-PARAM-EDIT-01: edit existing param row default value', () => {
  test('edit input + output defaults, save, reload, drill back - both new defaults persist', async ({
    page,
    request,
  }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await drillIn(page)
    expectStoredDefaults(await fetchFunctionSpec(request, testId), 'admin', '0')

    // Per VMGR-108: an input's value switch reads Default, an output's Initial.
    await editDefault(page, 'user_id', 'Default', 'admin', 'guest')
    await editDefault(page, 'result', 'Initial', 0, 42)

    await saveTest(page)
    expectStoredDefaults(await fetchFunctionSpec(request, testId), 'guest', '42')

    await openTest(page, testId)
    await drillIn(page)
    await expectDefault(page, 'user_id', 'guest')
    await expectDefault(page, 'result', 42)
    expectStoredDefaults(await fetchFunctionSpec(request, testId), 'guest', '42')
  })
})
