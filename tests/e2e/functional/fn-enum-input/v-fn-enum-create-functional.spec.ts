/**
 * V-FN-ENUM-CREATE: an enum input is created from the allowed values the author types
 * Design Decisions: VMGR-100, VMGR-104, VMGR-112, FNCFG-9
 * REQ: REQ-3.1.2.11
 *
 * Seed (API): a `zz-` Test holding one Local Function with an empty body (`createValidTest`) for the window
 * tests. The stale-pick test seeds a library Function (enum `level`: `low`, `high`, default `low`) with a
 * version 1.1.0 that lists only `low`, and a Test whose library Function Block on 1.0.0 and Local Function
 * Block (the same enum) both pick `high`. The input window, its allowed values, the Saves and the run are made
 * through the UI.
 *
 * Pass Criteria:
 * 1. Drilled into the Function, Add > Input parameter opens the input window; Type String, Integer or Float
 *    with Create enum shows the Allowed values list.
 * 2. For each Type (String `low`, `high`; Integer `1`, `2`; Float `0.5`, `1.5`) the typed allowed values are
 *    accepted as that type: no enum error, Create enabled once a default is picked; the Function Block, which
 *    exists before the input, starts on that default with nothing left to save (FNCFG-9).
 * 3. The list editor shows the Type read-only on every value; a value of the wrong type (`true` in a String list, `abc` in an
 *    Integer or Float list) is refused in the window with `Allowed value at index <i> (<value>) is not a
 *    valid <type>` and Create is off until it goes.
 * 4. After Save the stored input has the Type, `enumValues` typed by it (`[1, 2]`, never `["1", "2"]`),
 *    `required: true`, the picked `default` and no `secret`; it survives a reload.
 * 5. Create enum and Mark as secret exclude each other with their hints; the input is stored as the one
 *    ticked (secret with no enum keys, or enum with no secret).
 * 6. An enum input needs a default from its allowed values: its `Default value` caption carries the red star,
 *    with none picked the Default select reads `Default value is required` and Create is off; Required is
 *    locked on and Set to null is off and locked.
 * 7. A Local Function whose allowed values no longer hold the value its Function Block picked: the Block's
 *    value is dropped, the Test save is refused naming `Required parameter 'level' is missing`, a run started
 *    without saving is refused with `Cannot Run Test` naming the same, and once the Block picks `low` a library
 *    Function Block on the older version still runs with its pick `high`.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { enumTrigger, openOptions, pickEnum, saveButton } from '../../helpers/config-sheet'
import {
  addLibraryVersion,
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  publishLibraryFunction,
  setFunctionFields,
  sharedNode,
  startEdge,
  storedLocalDefinition,
  validateTest,
  VALIDATION,
} from '../../helpers/fn-seed'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { formatEntries } from '../../helpers/log-reader'
import {
  closeValueEditor,
  fillCreateWindow,
  openEditWindow,
  openFunctionCreateModal,
  openValueEditor,
  saveWindow,
  setAllowedValues,
  setValueEditorView,
  setWindowCheckbox,
  setWindowValue,
  variableRow,
  windowCheckbox,
} from '../../helpers/variable-create'
import {
  digIn,
  openFunctionBlockSheet,
  popToBreadcrumbSegment,
  runToEnd,
  saveBtn,
  saveTest,
  selectEnvironment,
} from '../../helpers/workbench'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_ID = 'fn-enum-create'

type EnumType = 'string' | 'integer' | 'float'

/** Per Type: the typed list, what is stored, and a wrong-typed list with its refusal. */
const ENUM_CASES: Array<{
  type: EnumType
  label: string
  typed: string[]
  stored: unknown[]
  wrong: string
  message: string
}> = [
  {
    type: 'string',
    label: 'String',
    typed: ['low', 'high'],
    stored: ['low', 'high'],
    wrong: '["low", "high", true]',
    message: 'Allowed value at index 2 (true) is not a valid string',
  },
  {
    type: 'integer',
    label: 'Integer',
    typed: ['1', '2'],
    stored: [1, 2],
    wrong: '[1, 2, "abc"]',
    message: 'Allowed value at index 2 (abc) is not a valid integer',
  },
  {
    type: 'float',
    label: 'Float',
    typed: ['0.5', '1.5'],
    stored: [0.5, 1.5],
    wrong: '[0.5, 1.5, "abc"]',
    message: 'Allowed value at index 2 (abc) is not a valid float',
  },
]

async function deleteTest(request: APIRequestContext, testId: string): Promise<void> {
  await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  if (!testId) return
  await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
}

async function seedAndDigIn(page: Page, request: APIRequestContext, testName: string): Promise<string> {
  const id = await createValidTest(request, {
    name: testName,
    nodes: [localFunctionNode(FN_ID, 'Enum_Fn', { nodes: [] })],
    edges: [startEdge(FN_ID)],
  })
  expect((await validateTest(request, id)).errors, 'the seeded Test validates with no error').toEqual([])
  await openTest(page, id)
  await digIn(page, FN_ID)
  await expect(page.getByTestId('add-variable-dropdown-trigger')).toBeVisible()
  return id
}

const control = (modal: Locator, testId: string): Locator => modal.locator(`[data-testid="${testId}"]`)

/** The hint a locked window checkbox points at. */
async function hintOf(modal: Locator, testId: string): Promise<Locator> {
  const id = await control(modal, testId).getAttribute('aria-describedby')
  expect(id, `${testId} points at its hint`).toBeTruthy()
  return modal.locator(`[id="${id}"]`)
}

/** The visible column labels of the list editor's header band. */
async function listHeader(sheet: Locator): Promise<string[]> {
  // The shown header text: a fixed Type header sits over an unseen pill that only sizes it.
  const texts = await control(sheet, 'array-edit-body').locator('div.sticky > span').allInnerTexts()
  return texts.map((text) => text.trim()).filter((text) => text !== '')
}

/** The stored input declaration by name, projected on the keys an enum input is judged by (VMGR-112). */
async function storedInput(
  request: APIRequestContext,
  testId: string,
  name: string,
  nodeId = FN_ID,
): Promise<Record<string, unknown>> {
  const { inputs } = await storedLocalDefinition(request, testId, nodeId)
  const input = inputs.find((entry) => entry.name === name)
  expect(input, `input ${name} is stored`).toBeTruthy()
  const declared = input as Record<string, unknown>
  return {
    type: declared.type,
    enumValues: declared.enumValues,
    required: declared.required === true,
    secret: declared.secret,
    default: declared.default,
  }
}

/** Per FNCFG-9: an enum input added after its Block exists starts on its default, written on the Block; the sheet shows it. */
async function expectStartsOnDefault(page: Page, nodeId: string, defaults: Array<[string, string]>): Promise<void> {
  const sheet = await openFunctionBlockSheet(page, nodeId)
  for (const [name, label] of defaults) {
    await expect(enumTrigger(sheet, name), `${name} starts on its default`).toHaveText(label)
  }
  await expect(saveButton(sheet), 'nothing to save: the default is already the Block value').toBeDisabled()
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

/** Pick a value for each enum input in the Function Block sheet and save it: a Required input needs one to save the Test. */
async function pickInBlock(page: Page, nodeId: string, picks: Array<[string, string]>): Promise<void> {
  const sheet = await openFunctionBlockSheet(page, nodeId)
  for (const [name, label] of picks) await pickEnum(page, sheet, name, label)
  await expect(saveButton(sheet)).toBeEnabled()
  await saveButton(sheet).click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

test.describe('V-FN-ENUM-CREATE: enum inputs from typed allowed values', () => {
  let testId = ''
  let libraryFunctionId = ''

  test.afterEach(async ({ request }) => {
    await deleteTest(request, testId)
    testId = ''
    if (libraryFunctionId) {
      await request.delete(`${BACKEND_URL}/functions/${libraryFunctionId}?cascade=true`).catch(() => undefined)
    }
    libraryFunctionId = ''
  })

  test('a String, Integer and Float enum is created from typed values, refuses a wrong-typed value, and keeps its values typed after Save and reload', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const testName = `zz-fn-enum-create-${randomUUID().slice(0, 8)}`
    testId = await seedAndDigIn(page, request, testName)

    for (const enumCase of ENUM_CASES) {
      await test.step(`a ${enumCase.label} enum from ${enumCase.typed.join(', ')}`, async () => {
        const name = `pick_${enumCase.type}`
        const modal = await openFunctionCreateModal(page, 'input')
        await fillCreateWindow(page, modal, name, {
          type: enumCase.type,
          createEnum: true,
          enumValues: enumCase.typed,
          value: enumCase.typed[0],
        })
        const submit = control(modal, 'create-submit-button')

        // Per VMGR-112: the Type sets every allowed value's type, so the typed values are accepted.
        await expect(control(modal, 'create-enum-error')).toHaveCount(0)
        await expect(submit).toBeEnabled()

        // Per VMGR-100: every allowed value takes the input's Type, shown read-only in the Type column.
        const sheet = await openValueEditor(page, modal, 'allowed-values')
        await setValueEditorView(page, sheet, 'Visual')
        // The header labels as shown (uppercase in the editor's style).
        expect((await listHeader(sheet)).map((label) => label.toLowerCase())).toEqual(['#', 'value', 'type'])
        const pills = sheet.locator('[data-testid^="array-type-"]')
        await expect(pills).toHaveCount(enumCase.typed.length)
        for (const pill of await pills.all()) await expect(pill).toHaveText(enumCase.type)
        await expect(sheet.locator('[data-testid^="array-type-"][role="combobox"]'), 'the Type is read-only').toHaveCount(0)
        await closeValueEditor(page, sheet)

        await setAllowedValues(modal, enumCase.wrong)
        await expect(control(modal, 'create-enum-error')).toHaveText(enumCase.message)
        await expect(submit).toBeDisabled()
        await setAllowedValues(modal, JSON.stringify(enumCase.stored))
        await expect(control(modal, 'create-enum-error')).toHaveCount(0)
        await expect(submit).toBeEnabled()
        await submit.click()
        await expect(modal).toBeHidden()
        await expect(variableRow(page, name)).toBeVisible()
      })
    }

    await test.step('Save stores each list typed by its Type, Required, with the picked default', async () => {
      await popToBreadcrumbSegment(page, testName)
      await expectStartsOnDefault(
        page,
        FN_ID,
        ENUM_CASES.map((enumCase) => [`pick_${enumCase.type}`, enumCase.typed[0]]),
      )
      await saveTest(page)
      for (const enumCase of ENUM_CASES) {
        // Per VMGR-112: an enum input carries its Type, is Required, never secret, with a default from the list.
        expect(await storedInput(request, testId, `pick_${enumCase.type}`)).toEqual({
          type: enumCase.type,
          enumValues: enumCase.stored,
          required: true,
          secret: undefined,
          default: enumCase.stored[0],
        })
      }
    })

    await test.step('a reload brings the inputs back with their stored values', async () => {
      await openTest(page, testId)
      await digIn(page, FN_ID)
      for (const enumCase of ENUM_CASES) {
        await expect(page.locator(`[data-testid="in-badge-param:input:pick_${enumCase.type}"]`)).toBeVisible()
        expect(await storedInput(request, testId, `pick_${enumCase.type}`), 'the reload changed nothing stored').toMatchObject({
          enumValues: enumCase.stored,
        })
      }
    })
  })

  test('Secret and Create enum exclude each other, and the input is stored as the one ticked', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const testName = `zz-fn-enum-secret-${randomUUID().slice(0, 8)}`
    testId = await seedAndDigIn(page, request, testName)

    await test.step('Create enum ticked: Mark as secret is off and a click cannot tick it', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await fillCreateWindow(page, modal, 'api_choice', { type: 'string' })
      await control(modal, 'param-create-enum-checkbox').click()
      const secret = control(modal, 'create-secret-checkbox')
      await expect(secret).toHaveAttribute('aria-disabled', 'true')
      await expect(await hintOf(modal, 'create-secret-checkbox')).toHaveText('off while enum is set')
      await secret.click({ force: true })
      await expect(secret).toHaveAttribute('data-state', 'unchecked')

      await control(modal, 'param-create-enum-checkbox').click()
      // Per VMGR-104: Required is locked on only while Create enum is on.
      const requiredBox = windowCheckbox(modal, 'required')
      await expect(requiredBox).not.toHaveAttribute('aria-disabled', 'true')
      await setWindowCheckbox(modal, 'required', false)
      await secret.click()
      await expect(secret).toHaveAttribute('data-state', 'checked')
      const createEnum = control(modal, 'param-create-enum-checkbox')
      await expect(createEnum).toHaveAttribute('aria-disabled', 'true')
      await expect(await hintOf(modal, 'param-create-enum-checkbox')).toHaveText('off while secret is set')
      await createEnum.click({ force: true })
      await expect(createEnum).toHaveAttribute('data-state', 'unchecked')
      await control(modal, 'create-submit-button').click()
      await expect(modal).toBeHidden()
      await expect(variableRow(page, 'api_choice').locator('[data-testid^="secret-badge-"]')).toBeVisible()
    })

    await test.step('an enum input is never secret', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await fillCreateWindow(page, modal, 'level_pick', {
        type: 'string',
        createEnum: true,
        enumValues: ['a', 'b'],
        value: 'a',
      })
      await expect(control(modal, 'create-secret-checkbox')).toHaveAttribute('data-state', 'unchecked')
      await control(modal, 'create-submit-button').click()
      await expect(modal).toBeHidden()
      await expect(variableRow(page, 'level_pick').locator('[data-testid^="secret-badge-"]')).toHaveCount(0)
    })

    await test.step('the stored inputs carry only the option that was ticked', async () => {
      await popToBreadcrumbSegment(page, testName)
      await expectStartsOnDefault(page, FN_ID, [['level_pick', 'a']])
      await saveTest(page)
      // Per VMGR-104: an input is never both secret and an enum.
      expect(await storedInput(request, testId, 'api_choice')).toEqual({
        type: 'string',
        enumValues: undefined,
        required: false,
        secret: true,
        default: undefined,
      })
      expect(await storedInput(request, testId, 'level_pick')).toEqual({
        type: 'string',
        enumValues: ['a', 'b'],
        required: true,
        secret: undefined,
        default: 'a',
      })
    })
  })

  test('an enum input needs a default picked from its allowed values', async ({ page, request }) => {
    test.setTimeout(120_000)
    const testName = `zz-fn-enum-default-${randomUUID().slice(0, 8)}`
    testId = await seedAndDigIn(page, request, testName)

    const modal = await openFunctionCreateModal(page, 'input')
    await fillCreateWindow(page, modal, 'tier', { type: 'string', createEnum: true, enumValues: ['gold', 'silver'] })
    const valueLabel = control(modal, 'create-value-area').locator('label').first()
    // Per FIELD-12: the required default carries the accessible red star.
    await expect(valueLabel).toHaveText('Default value* required')
    await expect(valueLabel.locator('span.text-destructive[aria-hidden="true"]')).toHaveText('*')

    // Per VMGR-112: with none picked the Default select says why Create is held.
    await expect(control(modal, 'create-enum-default-error')).toHaveText('Default value is required')
    await expect(control(modal, 'create-submit-button')).toBeDisabled()
    // Per VMGR-104: Required is locked on and Set to null is off and locked.
    const requiredBox = windowCheckbox(modal, 'required')
    await expect(requiredBox).toHaveAttribute('data-state', 'checked')
    await expect(await hintOf(modal, 'param-required-checkbox')).toHaveText('locked on while enum is set')
    const setNull = windowCheckbox(modal, 'set-to-null')
    await expect(setNull).toHaveAttribute('data-state', 'unchecked')
    await expect(setNull).toHaveAttribute('aria-disabled', 'true')
    await expect(await hintOf(modal, 'create-set-to-null-checkbox')).toHaveText('off while enum is set')
    await expect(control(modal, 'create-null-field')).toHaveCount(0)

    await setWindowValue(page, modal, 'gold')
    await expect(control(modal, 'create-enum-default-error')).toHaveCount(0)
    await control(modal, 'create-submit-button').click()
    await expect(modal).toBeHidden()

    await popToBreadcrumbSegment(page, testName)
    await expectStartsOnDefault(page, FN_ID, [['tier', 'gold']])
    await saveTest(page)
    expect(await storedInput(request, testId, 'tier')).toEqual({
      type: 'string',
      enumValues: ['gold', 'silver'],
      required: true,
      secret: undefined,
      default: 'gold',
    })
  })

  test('a Local Function enum that drops a picked value empties the Block, refuses the save and fails the run; an older library version runs unchanged', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    const level = {
      name: 'level',
      type: 'string',
      required: true,
      description: '',
      enumValues: ['low', 'high'],
      default: 'low',
    }
    const library = await publishLibraryFunction(request, {
      name: `zz-fn-enum-stale-${randomUUID().slice(0, 8)}`,
      inputs: [level],
      workflow: { nodes: [logNode('lib-print', 'Print Library', "'S=' + level", { x: 200, y: 180 })], edges: [startEdge('lib-print')] },
    })
    libraryFunctionId = library.functionId
    await addLibraryVersion(request, library, {
      sourceVersion: '1.0.0',
      targetVersion: '1.1.0',
      inputs: [{ ...level, enumValues: ['low'] }],
      workflow: { nodes: [logNode('lib-print', 'Print Library', "'S=' + level", { x: 200, y: 180 })], edges: [startEdge('lib-print')] },
    })
    const sharedId = randomUUID()
    const localId = randomUUID()
    const shared = sharedNode(sharedId, {
      functionId: library.functionId,
      functionVersion: library.version,
      label: 'Enum_Library',
      originalLibraryName: library.name,
      values: { level: 'high' },
    })
    const local = localFunctionNode(
      localId,
      'Enum_Local',
      {
        nodes: [logNode('local-print', 'Print Local', "'L=' + level", { x: 200, y: 180 })],
        edges: [startEdge('local-print')],
        inputs: [level],
      },
      { x: 560, y: 200 },
    ) as { data: Record<string, unknown> }
    setFunctionFields(local, { values: { level: 'high' } })
    const testName = `zz-fn-enum-stale-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, {
      name: testName,
      nodes: [shared, local as unknown as Record<string, unknown>],
      edges: [startEdge(sharedId), { id: 'e-shared-local', source: sharedId, target: localId }],
    })
    expect((await validateTest(request, testId)).errors, 'the seeded Test validates with no error').toEqual([])
    await openTest(page, testId)
    await selectEnvironment(page)

    await test.step('the Local Function drops high from its allowed values', async () => {
      await digIn(page, localId)
      const win = await openEditWindow(page, 'level')
      await setAllowedValues(win, '["low"]')
      await saveWindow(page, win)
      await popToBreadcrumbSegment(page, testName)
    })

    await test.step('the Local Function Block value is dropped; the library Block keeps its pick', async () => {
      // Per FNCFG-9: a pick the allowed values no longer hold is dropped and the field left empty.
      const localSheet = await openFunctionBlockSheet(page, localId)
      await expect(enumTrigger(localSheet, 'level')).toHaveText('Select…')
      const listbox = await openOptions(page, localSheet, 'level')
      await expect(listbox.getByRole('option')).toHaveText(['low'])
      await page.keyboard.press('Escape')
      await expect(listbox).toHaveCount(0)
      await localSheet.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(localSheet).toBeHidden()
      const sharedSheet = await openFunctionBlockSheet(page, sharedId)
      await expect(enumTrigger(sharedSheet, 'level')).toHaveText('high')
      await sharedSheet.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(sharedSheet).toBeHidden()
    })

    await test.step('the Test save is refused naming the empty Required input', async () => {
      await saveBtn(page).click()
      const dialog = page.locator(VALIDATION.dialog)
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog).toContainText('Cannot Save Test')
      await expect(dialog.locator(VALIDATION.list)).toContainText("Required parameter 'level' is missing")
      await dialog.locator(VALIDATION.closeBtn).click()
      await expect(dialog).toBeHidden()
      expect(await storedInput(request, testId, 'level', localId), 'the stored Test is unchanged').toMatchObject({
        enumValues: ['low', 'high'],
      })
    })

    await test.step('a run started without saving is refused naming the empty Required input', async () => {
      await page.locator('[data-testid="run-button"]').click()
      const dialog = page.locator(VALIDATION.dialog)
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog).toContainText('Cannot Run Test')
      await expect(dialog.locator(VALIDATION.list)).toContainText("Required parameter 'level' is missing")
      await dialog.locator(VALIDATION.closeBtn).click()
      await expect(dialog).toBeHidden()
      await expect(page.locator('[data-testid="workflow-status"]'), 'nothing ran').toHaveAttribute('data-status', 'idle')
    })

    await test.step('once the Local Block picks an allowed value, the library Block on 1.0.0 runs with its own pick', async () => {
      await pickInBlock(page, localId, [['level', 'low']])
      await saveTest(page)
      const { verdict, entries } = await runToEnd(page)
      const consoleText = formatEntries(entries)
      expect(verdict, consoleText).toBe('passed')
      // Per FNCFG-9: a Published Function changes only by a new version, so the Block on 1.0.0 is untouched.
      const printedLines = entries
        .filter((entry) => entry.message.startsWith('S=') || entry.message.startsWith('L='))
        .map((entry) => entry.message)
      expect(printedLines, consoleText).toEqual(['S=high', 'L=low'])
      await expectNodeStatus(page, sharedId, 'success')
    })
  })
})
