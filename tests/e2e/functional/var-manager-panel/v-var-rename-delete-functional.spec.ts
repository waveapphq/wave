/**
 * V-VAR-RENAME-DELETE: a rename follows every name site, a delete says what it breaks
 * Wireframe: none (functional)
 * Design Decisions: VMGR-105
 * REQ: REQ-3.1.3.11
 *
 * Setup (API): one blank `zz-` Test per test (`POST /tests`, no blocks, no variables), deleted
 * after, and the shared execution environment (`ensureEnvironment`). The variables, the blocks,
 * their settings, the output bindings, the parser query, the renames and the deletes are all built
 * through the UI.
 *
 * Pass Criteria:
 * 1. Renaming a variable bound as an HTTP output and one bound as an XML Parser query alias (in
 *    the Edit window) rewrites the binding target and the alias key in the queries, in their
 *    output types and in the binding; the old names appear nowhere in the saved Test; a run writes
 *    the renamed variables (`resp_code` = 200, `unit_price` = 19.99).
 * 2. Renaming a variable read by a Template variable and by an Expression variable rewrites both
 *    sources; after Save and a reload both name the new variable, the old name appears nowhere,
 *    and a run prints the same two lines as the run before the rename.
 * 3. Deleting a variable read by a Log expression setting and by an Assert condition row opens a
 *    dialog that reads "This action cannot be undone. The variable is used by 2 blocks -
 *    references will become unresolved."; Cancel keeps the variable and both readers.
 * 4. Deleting a variable only bound as an HTTP output opens a dialog that names the block and says
 *    the binding will be cleared; after Delete and Save the variable is gone and the binding is
 *    empty.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, HTTP_HEALTH_PORT, HTTP_TARGET_HOST, ensureEnvironment } from '../../helpers/config'
import { addLiteralRow, conditionBody, pickConditionVariable, pickOperator, setReference } from '../../helpers/condition-builder'
import { getActiveSessionId, getSessionVariables, sessionValue } from '../../helpers/fixture-import'
import { createValidTest, dismissLoadDialogIfPresent, openTest } from '../../helpers/fn-seed'
import { clearConsoleLogs, expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { openStringParamSheet, setStringParam } from '../../helpers/param-config'
import {
  createSimpleVariable,
  expandVariableManager,
  variableRow,
} from '../../helpers/variable-create'
import {
  dropBelowStart,
  openBlockSheet,
  runToEnd,
  saveBlockSheet,
  saveTest,
  selectEnvironment,
  setBlockExpression,
} from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { dropBelow } from '../canvas-lanes/lanes-helpers'
import {
  openDeleteDialog,
  pathsNaming,
  readStoredTest,
  renameVariable,
  storedNode,
  uniqueName,
} from './references-helpers'
import { createComputedVariable } from './unused-places'

const HEALTH_URL = `http://${HTTP_TARGET_HOST}:${HTTP_HEALTH_PORT}/health`
const PRICE_XML = '<root><price>19.99</price></root>'

/** Bind an output row to a variable the sheet's Save creates. */
async function bindToNewVariable(sheet: Locator, outputLabel: string, name: string): Promise<void> {
  const assign = sheet.getByRole('combobox', { name: `Assign ${outputLabel} to`, exact: true })
  await assign.fill(name)
  await expect(sheet.page().getByTestId('output-new-var-hint').filter({ hasText: `“${name}”` })).toHaveText(
    `“${name}” will be created as a new variable`,
  )
  await assign.press('Escape')
  await expect(sheet).toBeVisible()
}

/** An HTTP block under Start that GETs the health route and binds Status Code to a new variable. */
async function addHttpBlock(page: Page, statusVariable: string): Promise<string> {
  const httpId = await dropBelowStart(page, 'http')
  const sheet = await openBlockSheet(page, httpId)
  await setStringParam(sheet, page, 'url', HEALTH_URL)
  await bindToNewVariable(sheet, 'Status Code', statusVariable)
  await saveBlockSheet(sheet)
  return httpId
}

/** Paste XML into the value sheet in one input, so tag pairing leaves it alone. */
async function fillXmlContent(page: Page, sheet: Locator, xml: string): Promise<void> {
  const editor = await openStringParamSheet(sheet, page, 'xml_content')
  const content = editor.locator('.cm-content').first()
  await content.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(xml)
  await expect(content).toHaveText(xml)
  // The highlighted XML editor jitters sub-pixel, so the buttons are fired, not clicked by position.
  await editor.locator('[data-testid="value-editor-save-button"]').dispatchEvent('click')
  await editor.locator('[data-testid="value-editor-cancel-button"]').dispatchEvent('click')
  await expect(editor).toBeHidden()
}

/** Run the Test and return its console entries; the run must pass. */
async function runPassing(page: Page): Promise<Awaited<ReturnType<typeof runToEnd>>['entries']> {
  await selectEnvironment(page)
  const { verdict, entries } = await runToEnd(page)
  expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
  return entries
}

test.describe('V-VAR-RENAME-DELETE: renames and deletes in the Variable Manager', () => {
  let testId = ''

  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('renaming an HTTP output variable and an XML Parser query alias rewrites the binding and the alias keys, and a run writes the new names', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    testId = await createValidTest(request, { name: uniqueName('v-var-rename-bindings'), nodes: [] })
    await openTest(page, testId)
    await expandVariableManager(page)

    let httpId = ''
    let xmlId = ''
    await test.step('an HTTP block binds Status Code to http_code', async () => {
      httpId = await addHttpBlock(page, 'http_code')
    })

    await test.step('an XML Parser in Individual mode assigns //price/text() to price_val as Float', async () => {
      xmlId = await dropBelow(page, httpId, null, 'xml')
      const sheet = await openBlockSheet(page, xmlId)
      await fillXmlContent(page, sheet, PRICE_XML)
      await sheet.locator('#output-mode-individual').click()
      await sheet.locator('[data-testid="xml-query-xpath-0"]').fill('//price/text()')
      await sheet.locator('[data-testid="xml-query-alias-0"]').fill('price_val')
      const type = sheet.locator('[data-testid="xml-query-type-0"]')
      await type.click()
      await page.getByRole('option', { name: 'Float', exact: true }).click()
      await expect(type).toHaveText('Float')
      await saveBlockSheet(sheet)
    })

    await test.step('the saved Test binds http_code and the self-bound alias price_val', async () => {
      await expect(variableRow(page, 'http_code')).toBeVisible()
      await expect(variableRow(page, 'price_val')).toBeVisible()
      await saveTest(page)
      const stored = await readStoredTest(page, testId)
      expect(storedNode(stored, httpId).data.config?.outputBindings?.status_code).toBe('http_code')
      const xml = storedNode(stored, xmlId).data.config
      expect(xml?.values?.queries).toEqual({ price_val: '//price/text()' })
      expect(xml?.values?.query_output_types).toEqual({ price_val: 'float' })
      expect(xml?.outputBindings?.price_val).toBe('price_val')
    })

    await test.step('rename http_code to resp_code and price_val to unit_price in the Edit window', async () => {
      await renameVariable(page, 'http_code', 'resp_code')
      await renameVariable(page, 'price_val', 'unit_price')
      await saveTest(page)
    })

    await test.step('the saved Test carries the new names at every site and the old ones nowhere', async () => {
      const stored = await readStoredTest(page, testId)
      expect(Object.keys(stored.variables).sort()).toEqual(['resp_code', 'unit_price'])
      expect(storedNode(stored, httpId).data.config?.outputBindings?.status_code, 'HTTP binding target').toBe('resp_code')
      const xml = storedNode(stored, xmlId).data.config
      // Per VMGR-105: a query alias bound to itself is renamed as a key of the queries, the types and the bindings.
      expect(xml?.values?.queries, 'query alias key').toEqual({ unit_price: '//price/text()' })
      expect(xml?.values?.query_output_types, 'query output type key').toEqual({ unit_price: 'float' })
      expect(xml?.outputBindings?.unit_price, 'alias binding').toBe('unit_price')
      const everything = { workflow: stored.workflow, variables: stored.variables }
      expect(pathsNaming(everything, 'http_code'), 'http_code survives nowhere').toEqual([])
      expect(pathsNaming(everything, 'price_val'), 'price_val survives nowhere').toEqual([])
    })

    await test.step('a run writes the renamed variables', async () => {
      await runPassing(page)
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(Number(sessionValue(variables, 'resp_code')), 'Status Code written to resp_code').toBe(200)
      expect(String(sessionValue(variables, 'unit_price')), 'the query result written to unit_price').toBe('19.99')
      expect(variables.http_code, 'nothing writes the old name').toBeUndefined()
      expect(variables.price_val, 'nothing writes the old alias').toBeUndefined()
    })
  })

  test('renaming a variable read by a Template and an Expression variable rewrites both sources, and a run prints the same values', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    testId = await createValidTest(request, { name: uniqueName('v-var-rename-sources'), nodes: [] })
    await openTest(page, testId)

    await test.step('who, a Template greet and an Expression shout that read it', async () => {
      await createSimpleVariable(page, 'who', { value: 'Ada' })
      await createComputedVariable(page, 'greet', 'Template', 'Hello {{who}}!')
      await createComputedVariable(page, 'shout', 'Expression', 'who.upper()')
    })

    await test.step('two Logs print greet and shout', async () => {
      const greetLog = await dropBelowStart(page, 'log')
      await setBlockExpression(page, greetLog, 'message', 'greet')
      const shoutLog = await dropBelow(page, greetLog, null, 'log')
      await setBlockExpression(page, shoutLog, 'message', 'shout')
      await saveTest(page)
    })

    await test.step('the run before the rename prints Hello Ada! and ADA', async () => {
      const entries = await runPassing(page)
      expectConsoleLine(entries, 'INFO', 'Hello Ada!')
      expectConsoleLine(entries, 'INFO', 'ADA')
    })

    await test.step('rename who to person, Save and reload', async () => {
      await renameVariable(page, 'who', 'person')
      await saveTest(page)
      await page.reload()
      await waitForCanvasLoad(page)
      await dismissLoadDialogIfPresent(page)
      await expandVariableManager(page)
      await expect(variableRow(page, 'person')).toBeVisible()
      await expect(variableRow(page, 'who')).toHaveCount(0)
    })

    await test.step('both sources name person and who survives nowhere', async () => {
      const stored = await readStoredTest(page, testId)
      expect(stored.variables.greet, 'the Template source').toMatchObject({ value: 'Hello {{person}}!', isTemplate: true })
      expect(stored.variables.shout, 'the Expression source').toMatchObject({ value: 'person.upper()', isExpression: true })
      expect(pathsNaming({ workflow: stored.workflow, variables: stored.variables }, 'who')).toEqual([])
    })

    await test.step('the run after the rename prints the same two lines', async () => {
      await clearConsoleLogs(page)
      const entries = await runPassing(page)
      expectConsoleLine(entries, 'INFO', 'Hello Ada!')
      expectConsoleLine(entries, 'INFO', 'ADA')
    })
  })

  test('deleting a variable a Log setting and an Assert row read warns it is used by 2 blocks; Cancel keeps it', async ({
    page,
    request,
  }) => {
    testId = await createValidTest(request, { name: uniqueName('v-var-delete-used'), nodes: [] })
    await openTest(page, testId)
    await createSimpleVariable(page, 'checked', { value: 'x' })

    const logId = await dropBelowStart(page, 'log')
    await setBlockExpression(page, logId, 'message', 'checked')
    const assertId = await dropBelow(page, logId, null, 'assert')
    await test.step('an Assert row checks checked equals x', async () => {
      const sheet = await openBlockSheet(page, assertId)
      const body = conditionBody(sheet, 'assert')
      await addLiteralRow(body)
      await pickConditionVariable(page, body, '0', 'checked')
      await pickOperator(page, body, '0', 'equals')
      await setReference(body, '0', 'x')
      await saveBlockSheet(sheet)
      await saveTest(page)
    })

    await test.step('the delete dialog counts the 2 blocks that read checked', async () => {
      const dialog = await openDeleteDialog(page, 'checked')
      await expect(dialog).toHaveAccessibleDescription(
        'This action cannot be undone. The variable is used by 2 blocks - references will become unresolved.',
      )
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()
    })

    await test.step('Cancel keeps the variable and both readers', async () => {
      await expect(variableRow(page, 'checked')).toBeVisible()
      const stored = await readStoredTest(page, testId)
      expect(stored.variables).toHaveProperty('checked')
      expect(storedNode(stored, logId).data.config?.values?.message).toBe('checked')
      const rows = (storedNode(stored, assertId).data.config?.values?.assertions ?? []) as Array<{ variable?: string }>
      expect(rows.map((row) => row.variable)).toEqual(['checked'])
    })
  })

  test('deleting a variable only bound as an HTTP output names the block and says the binding will be cleared', async ({
    page,
    request,
  }) => {
    testId = await createValidTest(request, { name: uniqueName('v-var-delete-bound'), nodes: [] })
    await openTest(page, testId)
    await expandVariableManager(page)

    const httpId = await addHttpBlock(page, 'code_only')
    await saveTest(page)
    const label = storedNode(await readStoredTest(page, testId), httpId).data.label
    expect(label, 'the HTTP block has a name').toBeTruthy()

    await test.step('the delete dialog names the HTTP block and the cleared binding', async () => {
      const dialog = await openDeleteDialog(page, 'code_only')
      await expect(dialog).toHaveAccessibleDescription(
        `This action cannot be undone. The variable is bound as output by 1 block (${label}) - those bindings will be cleared.`,
      )
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(variableRow(page, 'code_only')).toHaveCount(0)
    })

    await test.step('after Save the variable is gone and the binding is empty', async () => {
      await saveTest(page)
      const stored = await readStoredTest(page, testId)
      expect(stored.variables).not.toHaveProperty('code_only')
      expect(storedNode(stored, httpId).data.config?.outputBindings?.status_code ?? '').toBe('')
    })
  })
})
