/**
 * V-ENTITY-VAR-ELEMENT-TYPES: a map variable of a Suite, a Regression and the System
 * scope keeps the type picked for every element - through the entity variable table,
 * a reload, and a run of a Test inside the Suite.
 * REQ: REQ-3.1.3.19, REQ-3.1.3.1, REQ-3.1.3.14
 *
 * Pass Criteria:
 * 1. In each scope's variable table the map's value sheet offers and keeps every
 *    element type.
 * 2. The saved Suite, Regression and System variables store exact text plus the declared
 *    element types (GET).
 * 3. Reopening each table shows every row with its declared type.
 * 4. A Test in the Suite reads `suite.m`, `regression.m` and `system.<name>` with every
 *    element as its declared type, and the Suite's integer scalar is a number too.
 *
 * Phase: functional-destructive (creates and deletes its own Suite, Regression, System
 * variable and Test).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  createEntity,
  entityVariableRow,
  newEntityVariableRow,
  openEntityValue,
  openEntityVariables,
  openSystemVariables,
  openSystemVariablesOnNewRow,
  saveVariablesDialog,
  setEntityRowType,
  variablesDialog,
} from '../../helpers/entity-variables'
import { openTest, validateTest } from '../../helpers/fn-seed'
import { selectEnvironment } from '../../helpers/workbench'
import {
  MAP_ROWS,
  deleteTest,
  expectMapRows,
  expectProbeLines,
  fillMapRows,
  mapElementTypes,
  mapProbe,
  mapProbeLine,
  readFixture,
  runToken,
  saveAndCloseSheet,
  settleRun,
  storedMap,
  substitute,
} from '../../helpers/element-types'

/** Fill the typed rows into the named map row's value sheet. */
async function typeMapRows(page: Page, dialog: Locator, name: string): Promise<void> {
  const sheet = await openEntityValue(page, await entityVariableRow(dialog, name))
  await fillMapRows(page, sheet, MAP_ROWS)
  await saveAndCloseSheet(page)
}

/** Reopen the named map row's value sheet and read every row's type back. */
async function expectTypedRows(page: Page, dialog: Locator, name: string): Promise<void> {
  const sheet = await openEntityValue(page, await entityVariableRow(dialog, name))
  await expectMapRows(sheet, MAP_ROWS)
  await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(sheet).toBeHidden()
}

test.describe('V-ENTITY-VAR-ELEMENT-TYPES: entity-scope map element types', () => {
  const token = runToken().replace(/-/g, '_')
  const systemName = `et_${token}`
  let suiteId = ''
  let regressionId = ''
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
    if (regressionId) await request.delete(`${BACKEND_URL}/regressions/${regressionId}`).catch(() => undefined)
    if (suiteId) await request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => undefined)
    await request.delete(`${BACKEND_URL}/variables/system/${systemName}`).catch(() => undefined)
  })

  test('Suite, Regression and System maps keep every element type into a run', async ({ page, request }) => {
    test.setTimeout(360_000)
    await ensureEnvironment(request)
    suiteId = await createEntity(request, '/suites', {
      name: `ET Suite ${token}`,
      variables: {
        count: { type: 'integer', value: '5', secret: false },
        m: { type: 'map', value: {}, secret: false },
      },
    })
    regressionId = await createEntity(request, '/regressions', { name: `ET Regression ${token}` })
    const attach = await request.put(`${BACKEND_URL}/regressions/${regressionId}`, {
      data: { suites: [suiteId], variables: { m: { type: 'map', value: {}, secret: false } } },
    })
    expect(attach.ok(), `PUT regression: ${attach.status()}`).toBeTruthy()

    await test.step('Suite: type the map rows, save, read the stored types, reopen', async () => {
      await typeMapRows(page, await openEntityVariables(page, 'suite', suiteId), 'm')
      await saveVariablesDialog(variablesDialog(page))
      const suite = (await (await request.get(`${BACKEND_URL}/suites/${suiteId}`)).json()).data
      expect(suite.variables.m.value).toEqual(storedMap())
      expect(suite.variables.m.elementTypes).toEqual(mapElementTypes())
      await expectTypedRows(page, await openEntityVariables(page, 'suite', suiteId), 'm')
    })

    await test.step('Regression: type the map rows, save, read the stored types, reopen', async () => {
      await typeMapRows(page, await openEntityVariables(page, 'regression', regressionId), 'm')
      await saveVariablesDialog(variablesDialog(page))
      const regression = (await (await request.get(`${BACKEND_URL}/regressions/${regressionId}`)).json()).data
      expect(regression.variables.m.value).toEqual(storedMap())
      expect(regression.variables.m.elementTypes).toEqual(mapElementTypes())
      await expectTypedRows(page, await openEntityVariables(page, 'regression', regressionId), 'm')
    })

    await test.step('System: add a map variable, type its rows, save, read the stored types, reopen', async () => {
      const dialog = await openSystemVariablesOnNewRow(page)
      const seeded = newEntityVariableRow(dialog)
      await setEntityRowType(page, seeded, 'Map')
      await seeded.locator('[data-testid="variable-name-input"]').fill(systemName)
      await typeMapRows(page, dialog, systemName)
      await saveVariablesDialog(dialog)
      const system = (await (await request.get(`${BACKEND_URL}/variables/system`)).json()).data.variables
      expect(system[systemName].value).toEqual(storedMap())
      expect(system[systemName].elementTypes).toEqual(mapElementTypes())
      await expectTypedRows(page, await openSystemVariables(page), systemName)
    })

    await test.step('a Test in the Suite reads every scope with its declared types', async () => {
      const fixture = substitute(readFixture(__dirname, 'element-types-probe.json'), {
        __SUITE_PROBE__: mapProbe('SUITE', 'suite.m'),
        __REG_PROBE__: mapProbe('REG', 'regression.m'),
        __SYS_PROBE__: mapProbe('SYS', `system.${systemName}`),
      })
      testId = await createEntity(request, '/tests', { ...fixture, name: `${fixture.name} ${token}` })
      const add = await request.post(`${BACKEND_URL}/suites/${suiteId}/tests`, { data: { test_id: testId } })
      expect(add.ok(), `add test to suite: ${add.status()}`).toBeTruthy()
      const validation = await validateTest(request, testId)
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])

      await openTest(page, testId)
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), [
        mapProbeLine('SUITE'),
        mapProbeLine('REG'),
        mapProbeLine('SYS'),
        'SCALAR 6',
      ])
    })
  })
})
