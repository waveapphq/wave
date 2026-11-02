/**
 * V-FN-ENUM-CALL: the Function Block window sets an enum input from its allowed values
 * and keeps a literal typed into an input
 * Design Decisions: FNCFG-6
 * REQ: REQ-3.1.2.11, REQ-3.1.1.5, REQ-3.1.2.1
 *
 * Seeds (API):
 * - enum dropdown: a library Function holding three enum inputs (`level_str` String `low`,
 *   `high`; `level_int` Integer `1`, `2`; `level_float` Float `0.5`, `1.5`), deleted with
 *   cascade after; and a `zz-` Test holding its library instance plus a Local Function with
 *   `level_int` and `level_float`, persisted through the admin bulk endpoint because the write
 *   path refuses a Required input left unbound. The Integer and Float enum inputs are seeded
 *   in their stored shape (the Type, Required, `enumValues`, a default from the list);
 *   their creation in the window is covered by V-FN-ENUM-CREATE. The String enum `level` of a second Local
 *   Function is built through the UI; the Function Block windows are read through the UI.
 * - literal integer: a `zz-` Test holding a Local Function with an optional integer input `n`
 *   (no default) read by a body Log (`n`), and a Log after the Function Block printing the run marker.
 *   The value typed in the Function Block window is the thing under test and is made through the UI.
 * - picks: a library Function with the three enum inputs read by a body Log, and a raw-persisted
 *   `zz-` Test holding a Local Function with the same inputs and body, the library instance and a
 *   marker Log. The picks, the Saves and the run are made through the UI.
 * - stale pick: the same library Function; after the pick its version 1.1.0 is added through
 *   `POST /functions/{id}/versions` with other allowed values (another author changing the
 *   Function); the version switch and the Saves are made through the UI.
 * - run-start check: per Type a raw-persisted `zz-` Test with a variable `pick` holding a
 *   value outside the list and a Local Function whose enum input `level` is read by a body Log; the
 *   expression is typed through the UI.
 * - recipe: none; the recipes go over the live MCP endpoint (`validate_recipe`,
 *   `create_test_from_recipe`, `get_test_recipe`, `amend_test_from_recipe`); MCP settings are reset after the test.
 *
 * Pass Criteria:
 * 1. An enum input `level` (Type String, allowed `low`, `high`) added to a Function whose Block exists shows in
 *    the Function Block window as a select listing `low`, `high` in order, holding its default `low`.
 * 2. Every Type (String, Integer, Float), on a Local Function and on a library Function, shows as the
 *    select of its allowed values in order.
 * 3. A 5 typed into the literal-mode integer input `n` is a change the sheet saves, is stored
 *    as the field value 5, and the body prints 5.
 * 4. Picks `high`, `2`, `1.5` are stored as the field values `high`, 2, 1.5 (Local and
 *    library), and each body computes with them as text, integer and float.
 * 5. A pick the allowed values no longer hold (the Block switched to a version whose list changed) is dropped:
 *    each field is empty, the Block shows its alert icon naming each empty Required input, and the Test Save is
 *    refused with `Required parameter '<input>' is missing` for each Type; the stored Test is unchanged.
 * 6. A variable or expression given to an enum input that evaluates outside the list fails the
 *    Function Block when the run starts with `Parameter '<input>' must be one of: ...` naming the input; the body never runs.
 * 7. A recipe `- function:` step whose `settings` hold a value outside the list is refused by `validate_recipe`
 *    and `create_test_from_recipe` with `INVALID_ENUM_VALUE` `Setting '<input>' of block 'pick_level' must be
 *    one of: ...` for each Type, and nothing is created; the same recipe with listed values validates clean,
 *    creates a Function Block holding the values, reads back as the same `- function:` step with `settings`, and an
 *    amend of that readback changes the value on the same Block.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { dragSourceToCanvas, expandPalette } from '../../helpers/canvas'
import {
  enumTrigger,
  exprToggle,
  numberInput,
  openOptions,
  paramRow,
  pickEnum,
  saveButton,
  setRowExpression,
} from '../../helpers/config-sheet'
import {
  addLibraryVersion,
  createValidTest,
  dismissLoadDialogIfPresent,
  localFunctionNode,
  logNode,
  openTest,
  publishLibraryFunction,
  rawPersistTest,
  sharedNode,
  startEdge,
  VALIDATION,
} from '../../helpers/fn-seed'
import { expectConsoleLine, formatEntries, getLogEntries } from '../../helpers/log-reader'
import { expectNodeStatus, finishRun, finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { createFunctionParam, variableRow } from '../../helpers/variable-create'
import {
  digIn,
  openFunctionBlockSheet,
  popToBreadcrumbSegment,
  runToEnd,
  saveBtn,
  saveTest,
  selectEnvironment,
} from '../../helpers/workbench'
import { BACKEND_PORT, BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const RB_FN_ID = 'fn-literal-int'
const RB_MARKER = 'zz-literal-int-done'
const SEEDED_LOCAL_ID = 'fn-enum-seeded-local'
const LIBRARY_NODE_ID = 'fn-enum-library'

const PICK_LOCAL_ID = 'fn-enum-pick-local'
const PICK_LIBRARY_ID = 'fn-enum-pick-library'
const PICK_MARKER = 'zz-enum-pick-done'
const STALE_NODE_ID = 'fn-enum-stale'
const RUN_FN_ID = 'fn-enum-run'
const RUN_MARKER = 'zz-enum-run-done'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

interface EnumCase {
  name: string
  valueType: 'string' | 'integer' | 'float'
  values: Array<string | number>
  shown: string[]
}

const STRING_ENUM: EnumCase = { name: 'level_str', valueType: 'string', values: ['low', 'high'], shown: ['low', 'high'] }
const INTEGER_ENUM: EnumCase = { name: 'level_int', valueType: 'integer', values: [1, 2], shown: ['1', '2'] }
const FLOAT_ENUM: EnumCase = { name: 'level_float', valueType: 'float', values: [0.5, 1.5], shown: ['0.5', '1.5'] }
const ALL_ENUMS = [STRING_ENUM, INTEGER_ENUM, FLOAT_ENUM]

/** The option picked per enum and the field value the Block stores for it (FNCFG-6). */
const PICKS = [
  { name: 'level_str', label: 'high', stored: 'high' },
  { name: 'level_int', label: '2', stored: 2 },
  { name: 'level_float', label: '1.5', stored: 1.5 },
] as const
const STORED_PICKS = Object.fromEntries(PICKS.map(({ name, stored }) => [name, stored]))

/** Text concatenation and arithmetic that only hold for a text, an integer and a float value. */
const TYPED_PROBE = "'S=' + level_str + ' I=' + str(level_int + 1) + ' F=' + str(level_float * 2)"
const TYPED_LINE = 'S=high I=3 F=3.0'

/** Version 1.1.0 lists other values, so none of the picks is allowed there. */
const CHANGED_ENUMS: EnumCase[] = [
  { ...STRING_ENUM, values: ['low', 'medium'], shown: ['low', 'medium'] },
  { ...INTEGER_ENUM, values: [1, 3], shown: ['1', '3'] },
  { ...FLOAT_ENUM, values: [0.5, 2.5], shown: ['0.5', '2.5'] },
]
// Per FNCFG-9: a version switch empties a pick the new version does not allow, leaving the Required input unset.
const STALE_EMPTIED = ['level_float', 'level_int', 'level_str'].map((name) => `Required parameter '${name}' is missing`)

interface RunCase {
  enumCase: EnumCase
  pick: { type: string; value: unknown }
  binding: string
  actual: string
}

/** A variable or an expression that evaluates outside the list, per Type. */
const RUN_CASES: RunCase[] = [
  { enumCase: STRING_ENUM, pick: { type: 'string', value: 'medium' }, binding: 'pick', actual: 'medium' },
  { enumCase: INTEGER_ENUM, pick: { type: 'integer', value: 1 }, binding: 'pick * 3', actual: '3' },
  { enumCase: FLOAT_ENUM, pick: { type: 'float', value: 2.5 }, binding: 'pick', actual: '2.5' },
]

/** An enum input in its stored shape: its Type, Required, the allowed list of that type, a default from the list. */
function storedEnumInput(enumCase: EnumCase, name = enumCase.name): Record<string, unknown> {
  return {
    name,
    type: enumCase.valueType,
    required: true,
    description: '',
    enumValues: enumCase.values,
    default: enumCase.values[0],
  }
}

/** A Function body whose Log prints the typed probe under `tag`. */
function probeBody(tag: string): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } {
  return {
    nodes: [logNode('fn-print-levels', 'Print Levels', `'${tag} ' + ${TYPED_PROBE}`, { x: 200, y: 180 })],
    edges: [startEdge('fn-print-levels')],
  }
}

async function deleteTest(request: APIRequestContext, testId: string): Promise<void> {
  if (!testId) return
  await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
}

async function storedNode(request: APIRequestContext, testId: string, nodeId: string): Promise<Record<string, any>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
  const nodes = (await resp.json()).data.workflow.nodes as Array<Record<string, any>>
  const node = nodes.find((entry) => entry.id === nodeId)
  expect(node, `stored node ${nodeId}`).toBeTruthy()
  return node!
}

function functionNodeIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
    .evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace(/^workflow-node-/, '')))
}

/** Drop a new Local Function from the palette and return its node id. */
async function dropNewFunction(page: Page): Promise<string> {
  await expandPalette(page)
  const before = await functionNodeIds(page)
  const newFn = page.getByTestId('palette-new-block-button')
  await expect(newFn).toBeVisible()
  const box = await page.getByTestId('workflow-canvas').boundingBox()
  expect(box).toBeTruthy()
  await dragSourceToCanvas(page, newFn, { x: box!.width * 0.4, y: box!.height * 0.4 })
  await expect.poll(async () => (await functionNodeIds(page)).length).toBe(before.length + 1)
  const added = (await functionNodeIds(page)).filter((id) => !before.includes(id))
  expect(added, 'exactly one Function was added').toHaveLength(1)
  return added[0]
}

/** The option labels an enum select offers, in order; the list closes again with the sheet still open. */
async function offeredValues(page: Page, sheet: Locator, name: string): Promise<string[]> {
  const listbox = await openOptions(page, sheet, name)
  const labels = (await listbox.getByRole('option').allTextContents()).map((label) => label.trim())
  await page.keyboard.press('Escape')
  await expect(listbox).toHaveCount(0)
  await expect(sheet).toBeVisible()
  return labels
}

/** Per FNCFG-6: each enum input of the open Function Block window is the select of its allowed values, in order. */
async function expectEnumSelects(page: Page, sheet: Locator, where: string, cases: EnumCase[]): Promise<void> {
  for (const enumCase of cases) {
    await expect(paramRow(sheet, enumCase.name)).toBeVisible()
    const trigger = enumTrigger(sheet, enumCase.name)
    await expect.soft(trigger, `${where}: ${enumCase.name} is a select of its allowed values`).toBeVisible()
    if ((await trigger.count()) === 0) continue
    expect.soft(await offeredValues(page, sheet, enumCase.name), `${where}: ${enumCase.name} options`).toEqual(
      enumCase.shown,
    )
  }
}

async function closeBlockSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

async function saveFunctionSheet(sheet: Locator): Promise<void> {
  await expect(saveButton(sheet)).toBeEnabled()
  await saveButton(sheet).click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

/** Pick `high`, `2` and `1.5` in a Function Block window and save it. */
async function pickAll(page: Page, nodeId: string): Promise<void> {
  const sheet = await openFunctionBlockSheet(page, nodeId)
  for (const { name, label } of PICKS) await pickEnum(page, sheet, name, label)
  await saveFunctionSheet(sheet)
}

async function createStringEnumInput(page: Page, name: string, allowed: string[]): Promise<void> {
  await createFunctionParam(page, 'input', name, {
    type: 'string',
    createEnum: true,
    enumValues: allowed,
    value: allowed[0],
  })
}

/** The recipe of a Function step setting `level_str`, `level_int` and `level_float` to the given YAML values. */
function enumRecipe(name: string, values: [string, string, string]): string {
  return `test:
  name: ${name}
  description: Enum Function inputs judged against the allowed values
functions:
  - name: pick_level
    inputs:
      - {name: level_str, type: string, required: true, enumValues: [low, high], default: low}
      - {name: level_int, type: integer, required: true, enumValues: [1, 2], default: 1}
      - {name: level_float, type: float, required: true, enumValues: [0.5, 1.5], default: 0.5}
    flow:
      - block: log
        settings:
          message: {expr: "${TYPED_PROBE}"}
flow:
  - function: pick_level
    settings: {level_str: ${values[0]}, level_int: ${values[1]}, level_float: ${values[2]}}
`
}

interface RecipeFinding {
  step: string
  code: string
  problem: string
}

function enumFindings(payload: Record<string, any>): string[] {
  return ((payload.findings ?? []) as RecipeFinding[])
    .filter((item) => item.code === 'INVALID_ENUM_VALUE')
    .map((item) => item.problem)
    .sort((a, b) => a.localeCompare(b))
}

// Per FNCFG-6: a recipe value outside the list, one per Type, in the one Block save text.
const RECIPE_REFUSALS = [
  "Setting 'level_float' of block 'pick_level' must be one of: 0.5, 1.5",
  "Setting 'level_int' of block 'pick_level' must be one of: 1, 2",
  "Setting 'level_str' of block 'pick_level' must be one of: low, high",
].sort((a, b) => a.localeCompare(b))

/** The stored field values and expression fields of a Function Block. */
function storedFields(node: Record<string, any>): { values: Record<string, unknown>; expressionFields: string[] } {
  return { values: node.data.config?.values ?? {}, expressionFields: [...(node.data.expressionFields ?? [])].sort() }
}

test.describe('V-FN-ENUM-CALL: the Function Block window sets enum and literal inputs', () => {
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

  test('the Function Block window offers the allowed values as a dropdown, every value type, Local and library', async ({
    page,
    request,
  }) => {
    const testName = `zz-fn-enum-call-${randomUUID().slice(0, 8)}`
    const library = await publishLibraryFunction(request, {
      name: `zz-fn-enum-library-${randomUUID().slice(0, 8)}`,
      inputs: ALL_ENUMS.map((enumCase) => storedEnumInput(enumCase)),
    })
    libraryFunctionId = library.functionId
    // Raw-persisted: the write path refuses a Required input with no value, the state a dropped Block starts in.
    testId = await rawPersistTest(request, {
      name: testName,
      nodes: [
        localFunctionNode(
          SEEDED_LOCAL_ID,
          'Enum_Local',
          { nodes: [], inputs: [INTEGER_ENUM, FLOAT_ENUM].map((enumCase) => storedEnumInput(enumCase)) },
          { x: 120, y: 420 },
        ),
        sharedNode(LIBRARY_NODE_ID, {
          functionId: library.functionId,
          functionVersion: library.version,
          label: 'Enum_Library',
          originalLibraryName: library.name,
          position: { x: 420, y: 420 },
        }),
      ],
    })
    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)

    const fnId = await dropNewFunction(page)
    await digIn(page, fnId)
    await expect(page.getByTestId('add-variable-dropdown-trigger')).toBeVisible()
    await createStringEnumInput(page, 'level', ['low', 'high'])
    await expect(variableRow(page, 'level')).toBeVisible()
    await popToBreadcrumbSegment(page, testName)

    await test.step('a String enum built in the input window, Local Function', async () => {
      const sheet = await openFunctionBlockSheet(page, fnId)
      // Per FNCFG-9: a choice-list input added after the Block exists starts on its default.
      await expect(enumTrigger(sheet, 'level'), 'the new enum input starts on its default').toHaveText('low')
      await expectEnumSelects(page, sheet, 'Local, built in the window', [
        { name: 'level', valueType: 'string', values: ['low', 'high'], shown: ['low', 'high'] },
      ])
      await closeBlockSheet(sheet)
    })

    await test.step('Integer and Float enums, Local Function', async () => {
      const sheet = await openFunctionBlockSheet(page, SEEDED_LOCAL_ID)
      await expectEnumSelects(page, sheet, 'Local', [INTEGER_ENUM, FLOAT_ENUM])
      await closeBlockSheet(sheet)
    })

    await test.step('String, Integer and Float enums, library Function', async () => {
      const sheet = await openFunctionBlockSheet(page, LIBRARY_NODE_ID)
      await expectEnumSelects(page, sheet, 'Library', ALL_ENUMS)
      await closeBlockSheet(sheet)
    })
  })

  test('a number typed into a literal-mode integer input reaches the body', async ({ page, request }) => {
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: `zz-fn-literal-int-${randomUUID().slice(0, 8)}`,
      nodes: [
        localFunctionNode(RB_FN_ID, 'Literal_Int', {
          nodes: [logNode('fn-print-n', 'Print N', 'n', { x: 200, y: 180 })],
          edges: [startEdge('fn-print-n')],
          inputs: [{ name: 'n', type: 'integer', required: false }],
        }),
        logNode('rb-done', 'Done', `'${RB_MARKER}'`, { x: 520, y: 200 }),
      ],
      edges: [startEdge(RB_FN_ID), { id: 'e-fn-done', source: RB_FN_ID, target: 'rb-done' }],
    })
    await openTest(page, testId)

    const sheet = await openFunctionBlockSheet(page, RB_FN_ID)
    await expect(paramRow(sheet, 'n')).toBeVisible()
    // An input opens as its literal widget, the number box.
    await expect(exprToggle(sheet, 'n')).toHaveAttribute('data-state', 'off')
    await numberInput(sheet, 'n').pressSequentially('5')
    await expect(numberInput(sheet, 'n')).toHaveValue('5')

    // Per REQ-3.1.2.1: a literal typed in the Function Block window is the field value the sheet saves.
    await expect(saveButton(sheet), 'the typed 5 is a change the sheet can save').toBeEnabled()
    await saveButton(sheet).click()
    await expect(sheet).toBeHidden({ timeout: 10_000 })
    await saveBtn(page).click()
    await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })

    const node = await storedNode(request, testId, RB_FN_ID)
    expect(storedFields(node), `stored fields ${JSON.stringify(node.data)}`).toEqual({ values: { n: 5 }, expressionFields: [] })

    const status = await startRun(page)
    const { verdict } = await finishRunAnyVerdict(page, status, RB_MARKER)
    expect(verdict).toBe('passed')
    expectConsoleLine(await getLogEntries(page), 'INFO', '5')
  })

  test('a picked value is stored as its literal and reaches the body with its type, Local and library', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const library = await publishLibraryFunction(request, {
      name: `zz-fn-enum-picks-${randomUUID().slice(0, 8)}`,
      inputs: ALL_ENUMS.map((enumCase) => storedEnumInput(enumCase)),
      workflow: probeBody('LIB'),
    })
    libraryFunctionId = library.functionId
    testId = await rawPersistTest(request, {
      name: `zz-fn-enum-picks-${randomUUID().slice(0, 8)}`,
      nodes: [
        localFunctionNode(PICK_LOCAL_ID, 'Pick_Local', {
          ...probeBody('LOCAL'),
          inputs: ALL_ENUMS.map((enumCase) => storedEnumInput(enumCase)),
        }),
        sharedNode(PICK_LIBRARY_ID, {
          functionId: library.functionId,
          functionVersion: library.version,
          label: 'Pick_Library',
          originalLibraryName: library.name,
          position: { x: 560, y: 200 },
        }),
        logNode('pick-done', 'Done', `'${PICK_MARKER}'`, { x: 820, y: 200 }),
      ],
      edges: [
        startEdge(PICK_LOCAL_ID),
        { id: 'e-local-library', source: PICK_LOCAL_ID, target: PICK_LIBRARY_ID },
        { id: 'e-library-done', source: PICK_LIBRARY_ID, target: 'pick-done' },
      ],
    })
    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)

    await pickAll(page, PICK_LOCAL_ID)
    await pickAll(page, PICK_LIBRARY_ID)
    await saveTest(page)

    // Per FNCFG-6: a pick is stored as the literal of its Type.
    for (const nodeId of [PICK_LOCAL_ID, PICK_LIBRARY_ID]) {
      expect(storedFields(await storedNode(request, testId, nodeId)), `${nodeId} fields`).toEqual({
        values: STORED_PICKS,
        expressionFields: [],
      })
    }

    const status = await startRun(page)
    await finishRun(page, status, PICK_MARKER)
    const entries = await getLogEntries(page)
    expectConsoleLine(entries, 'INFO', `LOCAL ${TYPED_LINE}`)
    expectConsoleLine(entries, 'INFO', `LIB ${TYPED_LINE}`)
  })

  test('a pick the version switched to no longer allows is dropped, and the Save names each empty input', async ({
    page,
    request,
  }) => {
    const library = await publishLibraryFunction(request, {
      name: `zz-fn-enum-stale-${randomUUID().slice(0, 8)}`,
      inputs: ALL_ENUMS.map((enumCase) => storedEnumInput(enumCase)),
      workflow: probeBody('LIB'),
    })
    libraryFunctionId = library.functionId
    testId = await rawPersistTest(request, {
      name: `zz-fn-enum-stale-${randomUUID().slice(0, 8)}`,
      nodes: [
        sharedNode(STALE_NODE_ID, {
          functionId: library.functionId,
          functionVersion: library.version,
          label: 'Stale_Library',
          originalLibraryName: library.name,
        }),
      ],
      edges: [startEdge(STALE_NODE_ID)],
    })
    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)

    await test.step('the picks on version 1.0.0 save', async () => {
      await pickAll(page, STALE_NODE_ID)
      await saveTest(page)
      expect(storedFields(await storedNode(request, testId, STALE_NODE_ID)).values).toEqual(STORED_PICKS)
    })

    await addLibraryVersion(request, library, {
      sourceVersion: '1.0.0',
      targetVersion: '1.1.0',
      inputs: CHANGED_ENUMS.map((enumCase) => storedEnumInput(enumCase)),
      workflow: probeBody('LIB'),
    })

    await test.step('the Block switched to 1.1.0 drops the picks its lists do not hold', async () => {
      const sheet = await openFunctionBlockSheet(page, STALE_NODE_ID)
      const trigger = sheet.locator('[data-testid="version-dropdown-trigger"]')
      await trigger.click()
      const menu = page.locator('[data-testid="version-dropdown-menu"]')
      await expect(menu).toBeVisible()
      await menu.getByRole('menuitemradio', { name: /1\.1\.0/ }).click()
      await expect(trigger).toContainText('v1.1.0')
      await saveFunctionSheet(sheet)
      // Per FNCFG-9: switching a Block to another version empties a pick that version does not allow.
      const reopened = await openFunctionBlockSheet(page, STALE_NODE_ID)
      const rows = await reopened.locator('[data-testid^="param-row-level"]').allTextContents()
      test.info().annotations.push({ type: 'rows-after-switch', description: JSON.stringify(rows) })
      for (const enumCase of ALL_ENUMS) {
        await expect.soft(enumTrigger(reopened, enumCase.name), `${enumCase.name} is emptied`).toHaveText('Select…')
      }
      await closeBlockSheet(reopened)
    })

    await test.step('the Block shows its alert and the Save names each empty input; nothing is stored', async () => {
      const alert = page.locator(`[data-testid="workflow-node-${STALE_NODE_ID}"] [data-testid="node-validation-alert"]`)
      await expect.soft(alert, 'the Block shows its alert icon').toBeVisible()
      if (await alert.isVisible()) {
        await alert.hover()
        const issues = page.locator('[role="tooltip"]').last().locator('li')
        await expect(issues.first()).toBeAttached()
        expect.soft(((await issues.allTextContents()).map((text) => text.trim())).sort()).toEqual(STALE_EMPTIED)
        await page.mouse.move(0, 0)
      }

      await saveBtn(page).click()
      const dialog = page.locator(VALIDATION.dialog)
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog).toContainText('Cannot Save Test')
      for (const problem of STALE_EMPTIED) await expect(dialog.locator(VALIDATION.list)).toContainText(problem)
      await dialog.locator(VALIDATION.closeBtn).click()
      await expect(dialog).toBeHidden()

      const stored = await storedNode(request, testId, STALE_NODE_ID)
      expect(stored.data.functionVersion, 'the Test still pins 1.0.0').toBe('1.0.0')
      expect(storedFields(stored).values).toEqual(STORED_PICKS)
    })
  })

  for (const { enumCase, pick, binding, actual } of RUN_CASES) {
    test(`an enum of Type ${enumCase.valueType} bound to a value outside the list fails when the run starts and names the input`, async ({
      page,
      request,
    }) => {
      await ensureEnvironment(request)
      testId = await rawPersistTest(request, {
        name: `zz-fn-enum-run-${enumCase.valueType}-${randomUUID().slice(0, 8)}`,
        variables: { pick: { ...pick, scope: 'test' } },
        nodes: [
          localFunctionNode(RUN_FN_ID, 'Enum_Run', {
            nodes: [logNode('fn-print-level', 'Print Level', "'BODY ' + str(level)", { x: 200, y: 180 })],
            edges: [startEdge('fn-print-level')],
            inputs: [storedEnumInput(enumCase, 'level')],
          }),
          logNode('run-done', 'Done', `'${RUN_MARKER}'`, { x: 560, y: 200 }),
        ],
        edges: [startEdge(RUN_FN_ID), { id: 'e-run-done', source: RUN_FN_ID, target: 'run-done' }],
      })
      await openTest(page, testId)
      await dismissLoadDialogIfPresent(page)

      const sheet = await openFunctionBlockSheet(page, RUN_FN_ID)
      await setRowExpression(page, sheet, 'level', binding)
      await saveFunctionSheet(sheet)
      // Per FNCFG-6: a bound expression is checked when the run starts, not on Save.
      await saveTest(page)
      expect(storedFields(await storedNode(request, testId, RUN_FN_ID))).toEqual({
        values: { level: binding },
        expressionFields: ['level'],
      })

      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expect(verdict, formatEntries(entries)).toBe('failed')
      const listed = enumCase.values.join(', ')
      // Per FNCFG-6: the run names the input, its allowed values and the value it got.
      expectConsoleLine(
        entries,
        'ERROR',
        `Block 'Enum_Run' failed: Parameter 'level' must be one of: ${listed}; Actual value was '${actual}'.`,
      )
      await expectNodeStatus(page, RUN_FN_ID, 'failed')
      expect(
        entries.filter((entry) => entry.message.startsWith('BODY ') || entry.message === RUN_MARKER),
        'the body and the Blocks after the Function Block never run',
      ).toEqual([])
    })
  }

  test.describe('recipes', () => {
    let recipeName = ''

    test.beforeEach(async ({ page }) => {
      await enableMcpUntilRestart(page, MCP_PORT)
    })

    test.afterEach(async ({ page, request }) => {
      if (recipeName) {
        const found = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(recipeName)}`)
        const entries = ((await found.json().catch(() => ({}))).data ?? []) as Array<{ id: string; name: string }>
        for (const entry of entries.filter(({ name }) => name === recipeName)) await deleteTest(request, entry.id)
      }
      recipeName = ''
      await resetMcpSettings(page)
    })

    test('a recipe value outside the allowed values is refused; listed values create, read back and amend', async ({
      request,
    }) => {
      recipeName = `zz-11541-r1-fn-enum-recipe-${randomUUID().slice(0, 8)}`
      const listed = enumRecipe(recipeName, ['high', '2', '1.5'])

      await test.step('listed values validate clean', () => {
        const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe: listed })
        expect(verdict.payload.valid, JSON.stringify(verdict.payload.findings)).toBe(true)
        expect(enumFindings(verdict.payload)).toEqual([])
      })

      const outside = enumRecipe(recipeName, ['medium', '3', '2.5'])

      await test.step('validate_recipe refuses each value outside its list', () => {
        const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe: outside })
        expect(verdict.payload.valid, JSON.stringify(verdict.payload.findings)).toBe(false)
        expect(enumFindings(verdict.payload)).toEqual(RECIPE_REFUSALS)
      })

      await test.step('create_test_from_recipe creates nothing', async () => {
        const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: outside })
        expect(created.payload.created, JSON.stringify(created.payload)).toBe(false)
        expect(enumFindings(created.payload)).toEqual(RECIPE_REFUSALS)
        const found = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(recipeName)}`)
        expect((await found.json()).data ?? [], 'no Test is stored').toHaveLength(0)
      })

      // One recipe shape: the `- function:` step with `settings` creates, reads back and amends the same Block.
      let createdId = ''
      await test.step('the listed values create a Function Block holding them', async () => {
        const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: listed })
        expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
        createdId = String(created.payload.test_id ?? '')
        expect(createdId, JSON.stringify(created.payload)).not.toBe('')
        const block = await functionBlockOf(request, createdId)
        expect(storedFields(block), JSON.stringify(block.data)).toEqual({
          values: { level_str: 'high', level_int: 2, level_float: 1.5 },
          expressionFields: [],
        })
      })

      let readback = ''
      await test.step('the readback is the same function step with its settings', () => {
        const answer = callTool(MCP_PORT, 'get_test_recipe', { test_ref: createdId })
        expect(answer.payload.expressible, JSON.stringify(answer.payload)).toBe(true)
        readback = String(answer.payload.recipe ?? '')
        expect(readback, readback).toMatch(/^\s*- function: pick_level$/m)
        expect(readback, readback).toMatch(/^\s+settings:$/m)
        for (const line of [/^\s+level_str: high$/m, /^\s+level_int: 2$/m, /^\s+level_float: 1\.5$/m]) {
          expect(readback, readback).toMatch(line)
        }
        expect(readback, 'no call step in the readback').not.toMatch(/\bcall:/)
      })

      await test.step('an amend of the readback changes the value on the same Block', async () => {
        const before = await functionBlockOf(request, createdId)
        const amended = callTool(MCP_PORT, 'amend_test_from_recipe', {
          test_ref: createdId,
          recipe: readback.replace(/^(\s+level_str:) high$/m, '$1 low'),
        })
        expect(amended.payload.amended, JSON.stringify(amended.payload)).toBe(true)
        const after = await functionBlockOf(request, createdId)
        expect(after.data.label, 'the same Function Block').toBe(before.data.label)
        expect(storedFields(after).values).toEqual({ level_str: 'low', level_int: 2, level_float: 1.5 })
      })
    })
  })
})

/** The one Function Block of a stored Test. */
async function functionBlockOf(request: APIRequestContext, testId: string): Promise<Record<string, any>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
  const nodes = (await resp.json()).data.workflow.nodes as Array<Record<string, any>>
  const blocks = nodes.filter((node) => node.data?.elementType === 'function')
  expect(blocks, 'the Test holds one Function Block').toHaveLength(1)
  return blocks[0]
}
