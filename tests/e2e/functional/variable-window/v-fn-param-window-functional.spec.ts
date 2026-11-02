/**
 * V-FN-PARAM-WINDOW (functional): Function inputs and outputs through the one variable window
 * Design Decisions: VMGR-104, VMGR-106, VMGR-108, VMGR-111, VMGR-112, VMGR-113, VMGR-114, FNCFG-7, FNCFG-8, FNCFG-9,
 *   SECUI-10, SECUI-11
 * REQ: REQ-3.1.2.1, REQ-3.1.2.9, REQ-3.1.2.10, REQ-3.1.2.11, REQ-3.1.3.21
 *
 * Seeds (API): each test stores its own `zz-` Test through `POST /tests` and checks it validates with no error.
 * - rename: a Local Function `Rename_Fn` with the Required input `who_in` (its Function Block holds `ann`), the
 *   output `res_out` and the secret output `tok_out` (bound to the Test variables `got` and `sec_got`, Secret ticked
 *   on `tok_out`), written by a body Variable Setter from `who_in`; a root Log prints `got` and `sec_got`.
 * - drop: a Local Function `Drop_Fn` whose Function Block holds `abc` in the Required String `txt`, 3 in the
 *   Required Integer `cnt`, the expression `src + '!'` in the String `calc` and `high` in the enum `level`
 *   (`low`, `high`); its body Log adds 1 to `calc`.
 * - defaults: a Local Function `Defaults_Fn` with no inputs, the String local `taken` and the Boolean local
 *   `flag_loc`; its body Log prints `start`.
 * - allowed values: an empty Local Function `Rules_Fn`.
 * The windows, the Function Block sheet, the Saves and the runs go through the UI; the Function save and the
 * recipe checks go through `POST /functions` and the MCP endpoint (`validate_recipe`).
 *
 * Pass Criteria:
 * 1. Renaming an input and two outputs in their Edit windows shows the rename notice, keeps the Function Block's
 *    value (`ann` under the new input name) and bindings (Secret still ticked on the renamed secret output);
 *    the saved Test holds no old name and the run passes, printing `got=R-ann sec=********`, never the secret.
 * 2. Retyping a Local Function input empties a Function Block literal that no longer fits (`'abc'` for Integer)
 *    and the Block shows its alert icon; `3` stays when Integer becomes Float; the expression stays; narrowing the
 *    allowed values to `low` empties the picked `high`; a new Required input starts empty. The alert names each
 *    empty Required input, the Test save is refused naming them, and once they are set the run fails on the kept
 *    expression that no longer fits.
 * 3. In an input window a name a local holds is refused with `A variable with this name already exists` and `_id`
 *    with the parameter name rule, Create held off. A Required input with the default `dflt` and an enum input
 *    (`low`, `mid`, `high`) with the default `low`: the Function Block shows no default for `who`, and the enum
 *    input, added after the Block exists, starts on `low` (written when it appears); the alert names only `who`,
 *    and a Test run is refused before it starts naming `who`; once the Block gives `'caller'` and `mid`,
 *    running the Function alone prints `who=dflt level=low`, and with the Current value `high`
 *    `who=dflt level=high`.
 * 4. A click on the value caption of an enum input (`Default value` in Add, `Value` in Edit) reaches its select,
 *    which holds the focus;
 *    a true / false group is named by its caption (`Default value`, `Value`) and a click on the caption leaves
 *    the group unfocused.
 * 5. Allowed values `["", "high"]` show `Allowed value at index 0 is empty` and `["low", "high", "low"]`
 *    `Allowed value at index 2 (low) is already listed` under the list, Create held off, the Default select
 *    offering only the non-empty distinct values; a Function save and a recipe with either are refused naming
 *    the problem.
 * 6. The input window reads `Required (the Function Block must set a value)` and `Create enum (limit the Function
 *    Block to a fixed set of values)`. Mark as secret and Create enum lock each other off with `off while enum is
 *    set` / `off while secret is set`;
 *    a secret input's Set to null is held on with `A secret input has no default: the Function Block gives the
 *    value.`; a recipe input both secret and an enum is refused with
 *    `Input 'level' cannot be both secret and an enum`.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  codeField,
  enumTrigger,
  exprToggle,
  expectEmptyLiteralField,
  expectHeldValue,
  numberInput,
  openOptions,
  outputRow,
  paramRow,
  pickEnum,
  saveButton,
  setRowExpression,
} from '../../helpers/config-sheet'
import {
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  startEdge,
  validateTest,
  VALIDATION,
  type FunctionBlockFields,
  type LocalFunctionBody,
} from '../../helpers/fn-seed'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { formatEntries, getLogEntries, type LogEntry } from '../../helpers/log-reader'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { SECRET_MASK } from '../../helpers/secret-canary'
import {
  cancelCreate,
  cancelWindow,
  createFunctionParam,
  fillCreateWindow,
  openEditWindow,
  openFunctionCreateModal,
  renameInWindow,
  renameNotice,
  retypeInWindow,
  saveWindow,
  setAllowedValues,
  setCreateName,
  setCreateType,
  setWindowCheckbox,
  setWindowValue,
  submitCreate,
  variableRow,
  windowCheckbox,
  windowSaveButton,
} from '../../helpers/variable-create'
import {
  digIn,
  openFunctionBlockSheet,
  popToBreadcrumbSegment,
  resetRun,
  saveBtn,
  saveTest,
  selectEnvironment,
  setBlockExpression,
  setCurrentValue,
} from '../../helpers/workbench'
import { closeInspector } from '../var-current-edit/helpers'

const MCP_PORT = Number(BACKEND_PORT) + 765

const PARAMETER_NAME_RULE = 'Parameter name must start with a letter, contain only letters, numbers, underscores'
const NAME_TAKEN = 'A variable with this name already exists'
// Per VMGR-103: the reason a secret input's Set to null is held on.
const SECRET_INPUT_REASON = 'A secret input has no default: the Function Block gives the value.'

const required = (name: string): string => `Required parameter '${name}' is missing`

type Seeded = { testId: string; testName: string }

interface BlockValues extends FunctionBlockFields {
  outputBindings?: Record<string, string>
  outputSecretFields?: string[]
}

/** A Local Function Block with the values its sheet stores. */
function functionBlock(id: string, label: string, body: LocalFunctionBody, values: BlockValues = {}): Record<string, unknown> {
  const block = localFunctionNode(id, label, body, { x: 300, y: 200 }) as { data: Record<string, unknown> }
  block.data.expressionFields = [...(values.expressionFields ?? [])]
  block.data.config = {
    values: { ...(values.values ?? {}) },
    outputBindings: values.outputBindings ?? {},
    ...(values.outputSecretFields ? { outputSecretFields: values.outputSecretFields } : {}),
    profileBindings: [],
  }
  return block as unknown as Record<string, unknown>
}

/** A Variable Setter writing each entry as an expression of the given type. */
function setterNode(id: string, writes: Record<string, string>, types: Record<string, string>): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 200, y: 180 },
    data: {
      label: 'Variable Setter',
      elementType: 'variable-setter',
      nodeType: 'control',
      category: 'flow',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: Object.keys(writes),
      variableTypes: types,
      config: { values: { variables: writes }, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

const edge = (source: string, target: string): Record<string, unknown> => ({
  id: `e-${source}-${target}`,
  source,
  target,
})

const blockAlert = (page: Page, blockId: string): Locator =>
  page.locator(`[data-testid="workflow-node-${blockId}"] [data-testid="node-validation-alert"]`)

/** The issues the Block's alert icon lists, sorted. */
async function blockIssues(page: Page, blockId: string): Promise<string[]> {
  const alert = blockAlert(page, blockId)
  await expect(alert, 'the Block shows its alert icon').toBeVisible()
  await alert.hover()
  const items = page.locator('[role="tooltip"]').last().locator('li')
  await expect(items.first()).toBeAttached()
  const issues = (await items.allTextContents()).map((text) => text.trim()).sort((a, b) => a.localeCompare(b))
  await page.mouse.move(0, 0)
  return issues
}

/** Click Run and return the run's verdict and the console lines it added, once `done` holds for them. */
async function runAndRead(
  page: Page,
  done: (entries: LogEntry[]) => boolean,
  label: string,
): Promise<{ verdict: string; entries: LogEntry[] }> {
  const before = (await getLogEntries(page)).length
  await page.locator('[data-testid="run-button"]').click()
  let entries: LogEntry[] = []
  await expect
    .poll(
      async () => {
        entries = (await getLogEntries(page)).slice(before)
        return done(entries)
      },
      { timeout: 90_000, message: `${label}: the run printed its lines` },
    )
    .toBe(true)
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).toHaveAttribute('data-status', /passed|failed|stopped/, { timeout: 60_000 })
  test.info().annotations.push({ type: `${label}-console`, description: formatEntries(entries) })
  return { verdict: (await status.getAttribute('data-status')) ?? '', entries }
}

const printed = (entries: LogEntry[], prefix: string): string[] =>
  entries.filter((entry) => entry.message.startsWith(prefix)).map((entry) => entry.message)

const hasError = (entries: LogEntry[]): boolean => entries.some((entry) => entry.level === 'ERROR')

/** Run is refused before it starts, the dialog naming each problem; nothing runs. */
async function expectRunRefused(page: Page, problems: string[], absent: string[] = []): Promise<void> {
  await page.locator('[data-testid="run-button"]').click()
  const dialog = page.locator(VALIDATION.dialog)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await expect(dialog).toContainText('Cannot Run Test')
  for (const problem of problems) await expect(dialog.locator(VALIDATION.list)).toContainText(problem)
  for (const problem of absent) await expect(dialog.locator(VALIDATION.list)).not.toContainText(problem)
  await dialog.locator(VALIDATION.closeBtn).click()
  await expect(dialog).toBeHidden()
}

/** Every `message` text anywhere in a JSON answer. */
function messagesIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(messagesIn)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
    key === 'message' && typeof inner === 'string' ? [inner] : messagesIn(inner),
  )
}

/** The hint a locked window checkbox points at. */
async function hintOf(win: Locator, box: Locator): Promise<Locator> {
  const id = await box.getAttribute('aria-describedby')
  expect(id, 'the locked box points at its hint').toBeTruthy()
  return win.locator(`[id="${id}"]`)
}

const enumSelect = (win: Locator): Locator => win.locator('[data-testid="enum-value-select"] [role="combobox"]')

/** The value caption, with the red star a required choice-list default carries (FIELD-12). */
const valueCaption = (win: Locator, caption: string): Locator =>
  win.locator('[data-testid="create-value-area"]').getByText(new RegExp(`^${caption}(\\* required)?$`)).first()

/** The option labels the window's Default select offers; the list closes again. */
async function defaultOptions(page: Page, win: Locator): Promise<string[]> {
  await enumSelect(win).click()
  const listbox = page.locator('[role="listbox"]:not([cmdk-list])')
  await expect(listbox).toBeVisible()
  const labels = (await listbox.getByRole('option').allTextContents()).map((label) => label.trim())
  await page.keyboard.press('Escape')
  await expect(listbox).toHaveCount(0)
  await expect(win).toBeVisible()
  return labels
}

/** A click on the enum caption takes the person to its select: the select opens or takes focus, and keeps it once closed. */
async function expectCaptionFocusesSelect(page: Page, win: Locator, caption: string): Promise<void> {
  const trigger = enumSelect(win)
  await valueCaption(win, caption).click()
  const engaged = async (): Promise<boolean> =>
    (await trigger.getAttribute('aria-expanded')) === 'true' || (await trigger.evaluate((el) => el === document.activeElement))
  await expect.poll(engaged, { message: `a click on "${caption}" reaches the select` }).toBe(true)
  if ((await trigger.getAttribute('aria-expanded')) === 'true') {
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="listbox"]:not([cmdk-list])')).toHaveCount(0)
  }
  await expect(trigger, `the select holds the focus after a click on "${caption}"`).toBeFocused()
  await expect(win).toBeVisible()
}

/** The true / false group is named by its caption, and a click on the caption focuses nothing in it. */
async function expectCaptionNamesGroup(win: Locator, caption: string): Promise<void> {
  const group = win.getByRole('group', { name: caption, exact: true })
  await expect(group, `the true / false group is named "${caption}"`).toBeVisible()
  await valueCaption(win, caption).click()
  await expect(group.locator('button:focus'), `a click on "${caption}" focuses nothing in the group`).toHaveCount(0)
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

/** A recipe whose Function `pick_level` declares `level` with `declaration` and whose Function step sets it to `binding`. */
function levelRecipe(name: string, declaration: string, binding: string): string {
  return `test:
  name: ${name}
  description: An enum input declaration judged by the recipe checks
functions:
  - name: pick_level
    inputs:
      - {name: level, ${declaration}}
    flow:
      - block: log
        settings:
          message: {expr: "'L=' + str(level)"}
flow:
  - function: pick_level
    settings: {level: ${binding}}
`
}

function recipeProblems(payload: Record<string, any>): string[] {
  return ((payload.findings ?? []) as Array<{ problem: string }>).map((item) => item.problem)
}

test.describe('V-FN-PARAM-WINDOW: Function inputs and outputs in the one window', () => {
  const testIds: string[] = []
  const functionIds: string[] = []
  let mcpOn = false

  test.afterEach(async ({ page, request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of testIds.splice(0)) await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
    for (const id of functionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/functions/${id}?cascade=true`).catch(() => undefined)
    }
    if (mcpOn) await resetMcpSettings(page)
    mcpOn = false
  })

  /** Store a Test through POST /tests, check it validates with no error, and open it. */
  async function seedAndOpen(
    page: Page,
    request: APIRequestContext,
    prefix: string,
    nodes: Array<Record<string, unknown>>,
    edges: Array<Record<string, unknown>>,
    variables: Record<string, unknown> = {},
  ): Promise<Seeded> {
    const testName = `zz-${prefix}-${randomUUID().slice(0, 8)}`
    const testId = await createValidTest(request, { name: testName, nodes, edges, variables })
    testIds.push(testId)
    const validated = await validateTest(request, testId)
    expect(validated.errors, 'the seeded Test validates with no error').toEqual([])
    await openTest(page, testId)
    return { testId, testName }
  }

  test('renaming an input and its outputs in their windows keeps the Function Block bound, the secret masked and the run green', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    const fnId = randomUUID()
    const setterId = randomUUID()
    const logId = randomUUID()
    const { testId, testName } = await seedAndOpen(
      page,
      request,
      'fn-param-rename',
      [
        functionBlock(
          fnId,
          'Rename_Fn',
          {
            nodes: [setterNode(setterId, { res_out: "'R-' + who_in", tok_out: "'T-' + who_in" }, { res_out: 'string', tok_out: 'string' })],
            edges: [startEdge(setterId)],
            inputs: [{ name: 'who_in', type: 'string', required: true, description: '' }],
            outputs: [
              { name: 'res_out', type: 'string', description: '' },
              { name: 'tok_out', type: 'string', secret: true, description: '' },
            ],
          },
          {
            values: { who_in: 'ann' },
            outputBindings: { res_out: 'got', tok_out: 'sec_got' },
            outputSecretFields: ['tok_out'],
          },
        ),
        logNode(logId, 'Print Got', "'got=' + got + ' sec=' + sec_got", { x: 560, y: 200 }),
      ],
      [startEdge(fnId), edge(fnId, logId)],
      {
        got: { type: 'string', value: null, scope: 'test' },
        sec_got: { type: 'string', value: null, scope: 'test' },
      },
    )
    await selectEnvironment(page)
    await digIn(page, fnId)

    await test.step('the input and both outputs are renamed in their Edit windows', async () => {
      for (const [from, to] of [
        ['who_in', 'person'],
        ['res_out', 'result'],
        ['tok_out', 'tok_new'],
      ] as const) {
        const win = await openEditWindow(page, from)
        await renameInWindow(win, to)
        await expect(renameNotice(win)).toHaveText(`Renaming updates all references to ${from} across the Function.`)
        await saveWindow(page, win)
        await expect(variableRow(page, to)).toBeVisible()
        await expect(variableRow(page, from)).toHaveCount(0)
      }
    })

    await test.step('the Function Block keeps its value and its bindings under the new names', async () => {
      await popToBreadcrumbSegment(page, testName)
      await expect(blockAlert(page, fnId), 'the Function Block has nothing missing').toHaveCount(0)
      const sheet = await openFunctionBlockSheet(page, fnId)
      // Per FNCFG-9: a rename carries the value to the new name.
      await expectHeldValue(page, sheet, 'person', 'string', 'ann')
      await expect(paramRow(sheet, 'who_in')).toHaveCount(0)
      await expect(outputRow(sheet, 'result').locator('[role="combobox"]').first()).toHaveValue('got')
      await expect(outputRow(sheet, 'tok_new').locator('[role="combobox"]').first()).toHaveValue('sec_got')
      await expect(sheet.locator('[data-testid="output-secret-tok_new"]')).toHaveAttribute('data-state', 'checked')
      await closeBlockSheet(sheet)
    })

    await test.step('the saved Test holds none of the old names', async () => {
      await saveTest(page)
      const stored = JSON.stringify((await (await request.get(`${BACKEND_URL}/tests/${testId}`)).json()).data)
      for (const old of ['who_in', 'res_out', 'tok_out']) {
        expect(stored, `the saved Test holds ${old} nowhere`).not.toMatch(new RegExp(`\\b${old}\\b`))
      }
    })

    await test.step('the run passes and the renamed secret output stays masked', async () => {
      const { verdict, entries } = await runAndRead(
        page,
        (lines) => lines.some((entry) => entry.message.startsWith('got=')) || hasError(lines),
        'rename-run',
      )
      const consoleText = formatEntries(entries)
      expect(verdict, consoleText).toBe('passed')
      // Per FNCFG-7: the variable a secret output fills is masked, also after the output is renamed.
      expect(printed(entries, 'got='), consoleText).toEqual([`got=R-ann sec=${SECRET_MASK}`])
      expect(consoleText, 'the secret never shows on the console').not.toContain('T-ann')
    })
  })

  test('a Local Function input change drops the Function Block values it breaks and keeps the rest', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    const fnId = randomUUID()
    const bodyLogId = randomUUID()
    const { testName } = await seedAndOpen(
      page,
      request,
      'fn-param-drop',
      [
        functionBlock(
          fnId,
          'Drop_Fn',
          {
            nodes: [logNode(bodyLogId, 'Print Calc', "'C=' + str(calc + 1)", { x: 200, y: 180 })],
            edges: [startEdge(bodyLogId)],
            inputs: [
              { name: 'txt', type: 'string', required: true, description: '' },
              { name: 'cnt', type: 'integer', required: true, description: '' },
              { name: 'calc', type: 'string', required: false, description: '' },
              { name: 'level', type: 'string', required: true, description: '', enumValues: ['low', 'high'], default: 'low' },
            ],
          },
          { values: { txt: 'abc', cnt: 3, calc: "src + '!'", level: 'high' }, expressionFields: ['calc'] },
        ),
      ],
      [startEdge(fnId)],
      { src: { type: 'string', value: 'hello', scope: 'test' } },
    )
    await selectEnvironment(page)
    await expect(blockAlert(page, fnId), 'every Required input starts set').toHaveCount(0)
    await digIn(page, fnId)

    await test.step('three inputs are retyped, the allowed values narrowed and a Required input added', async () => {
      for (const [name, type] of [
        ['txt', 'integer'],
        ['cnt', 'float'],
        ['calc', 'integer'],
      ] as const) {
        const win = await openEditWindow(page, name)
        await retypeInWindow(page, win, type)
        await saveWindow(page, win)
      }
      const level = await openEditWindow(page, 'level')
      await setAllowedValues(level, '["low"]')
      await saveWindow(page, level)
      await createFunctionParam(page, 'input', 'extra', { required: true })
    })

    await popToBreadcrumbSegment(page, testName)

    await test.step('the Block shows its alert for each Required input left empty', async () => {
      // Per FNCFG-9: an emptied Required field and a new Required input show the Block's alert icon.
      expect(await blockIssues(page, fnId)).toEqual([required('extra'), required('level'), required('txt')])
    })

    await test.step('the Block sheet: broken literals empty, a fitting literal and the expression kept', async () => {
      const sheet = await openFunctionBlockSheet(page, fnId)
      // Per FNCFG-9: a literal that no longer fits is dropped; one that still fits stays.
      await expectEmptyLiteralField(sheet, 'txt', 'integer')
      await expectHeldValue(page, sheet, 'cnt', 'float', '3')
      // Per FNCFG-9: an expression is kept as written.
      await expect(exprToggle(sheet, 'calc')).toHaveAttribute('aria-pressed', 'true')
      await expect(codeField(sheet, 'calc')).toHaveText("src + '!'")
      // Per FNCFG-9: a pick the allowed values no longer hold is dropped.
      await expect(enumTrigger(sheet, 'level')).toHaveText('Select…')
      const listbox = await openOptions(page, sheet, 'level')
      await expect(listbox.getByRole('option')).toHaveText(['low'])
      await page.keyboard.press('Escape')
      await expect(listbox).toHaveCount(0)
      await expectEmptyLiteralField(sheet, 'extra', 'string')
      await closeBlockSheet(sheet)
    })

    await test.step('the Test save is refused naming each empty Required input', async () => {
      await saveBtn(page).click()
      const dialog = page.locator(VALIDATION.dialog)
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog).toContainText('Cannot Save Test')
      for (const name of ['txt', 'level', 'extra']) {
        await expect(dialog.locator(VALIDATION.list)).toContainText(required(name))
      }
      await dialog.locator(VALIDATION.closeBtn).click()
      await expect(dialog).toBeHidden()
    })

    await test.step('once set, the Test saves and the run fails on the kept expression', async () => {
      const sheet = await openFunctionBlockSheet(page, fnId)
      await numberInput(sheet, 'txt').fill('7')
      await pickEnum(page, sheet, 'level', 'low')
      await setRowExpression(page, sheet, 'extra', "'x'")
      await saveFunctionSheet(sheet)
      await expect(blockAlert(page, fnId)).toHaveCount(0)
      await saveTest(page)

      const { verdict, entries } = await runAndRead(page, hasError, 'drop-run')
      const consoleText = formatEntries(entries)
      // Per FNCFG-9: an expression that no longer fits fails when the run uses it.
      expect(verdict, consoleText).toBe('failed')
      await expectNodeStatus(page, fnId, 'failed')
      expect(printed(entries, 'C='), `the body Log never prints\n${consoleText}`).toEqual([])
    })
  })

  test('a Required input default and an enum default are used only when the Function runs alone', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    const fnId = randomUUID()
    const bodyLogId = randomUUID()
    const { testName } = await seedAndOpen(
      page,
      request,
      'fn-param-defaults',
      [
        functionBlock(fnId, 'Defaults_Fn', {
          nodes: [logNode(bodyLogId, 'Print Inputs', "'start'", { x: 200, y: 180 })],
          edges: [startEdge(bodyLogId)],
          variables: [
            { name: 'taken', type: 'string', value: 'x' },
            { name: 'flag_loc', type: 'boolean', value: false },
          ],
        }),
      ],
      [startEdge(fnId)],
    )
    await selectEnvironment(page)
    await digIn(page, fnId)

    await test.step('an input name a local holds, and _id, are refused in the input window', async () => {
      const win = await openFunctionCreateModal(page, 'input')
      const nameError = win.locator('[data-testid="create-name-error"]')
      await setCreateName(page, 'taken', win)
      await expect(nameError).toHaveText(NAME_TAKEN)
      await expect(windowSaveButton(win)).toBeDisabled()
      await setCreateName(page, '_id', win)
      await expect(nameError).toHaveText(PARAMETER_NAME_RULE)
      await expect(windowSaveButton(win)).toBeDisabled()
      await cancelCreate(page, win)
    })

    await test.step('a true / false value is named by its caption, Add and Edit', async () => {
      const win = await openFunctionCreateModal(page, 'input')
      await setCreateName(page, 'flag_in', win)
      await setCreateType(page, 'boolean', win)
      await expectCaptionNamesGroup(win, 'Default value')
      await cancelCreate(page, win)
      const local = await openEditWindow(page, 'flag_loc')
      await expectCaptionNamesGroup(local, 'Value')
      await cancelWindow(page, local)
    })

    await test.step('a Required input with a default and an enum input with a default are created', async () => {
      await createFunctionParam(page, 'input', 'who', { required: true, value: 'dflt' })
      const win = await openFunctionCreateModal(page, 'input')
      await fillCreateWindow(page, win, 'level', { createEnum: true, enumValues: ['low', 'mid', 'high'] })
      await expectCaptionFocusesSelect(page, win, 'Default value')
      await setWindowValue(page, win, 'low')
      await submitCreate(page, win)
      await expect(win).toBeHidden()
      await expect(variableRow(page, 'level')).toBeVisible()
      const edit = await openEditWindow(page, 'level')
      await expectCaptionFocusesSelect(page, edit, 'Value')
      await cancelWindow(page, edit)
    })

    await setBlockExpression(page, bodyLogId, 'message', "'who=' + who + ' level=' + level")
    await popToBreadcrumbSegment(page, testName)

    await test.step('the Function Block shows no default for who, starts the enum on its default and its alert names who', async () => {
      // Per VMGR-113: a Required input's default is never shown in a Function Block; it must set the value.
      expect(await blockIssues(page, fnId)).toEqual([required('who')])
      const sheet = await openFunctionBlockSheet(page, fnId)
      await expectEmptyLiteralField(sheet, 'who', 'string')
      // Per FNCFG-9: a choice-list input added after the Block exists starts on its default.
      await expect(enumTrigger(sheet, 'level')).toHaveText('low')
      await closeBlockSheet(sheet)
    })

    await test.step('a Test run whose Function Block leaves who empty is refused naming it', async () => {
      const before = (await getLogEntries(page)).length
      // Per VMGR-113: a Function Block never uses the default of a Required input.
      await expectRunRefused(page, [required('who')], [required('level')])
      const entries = (await getLogEntries(page)).slice(before)
      expect(printed(entries, 'who='), `the body Log never prints\n${formatEntries(entries)}`).toEqual([])
    })

    await test.step('the Function Block sets both inputs', async () => {
      const sheet = await openFunctionBlockSheet(page, fnId)
      await setRowExpression(page, sheet, 'who', "'caller'")
      await pickEnum(page, sheet, 'level', 'mid')
      await saveFunctionSheet(sheet)
      await expect(blockAlert(page, fnId)).toHaveCount(0)
    })

    await digIn(page, fnId)

    await test.step('running the Function alone uses each default, not the Function Block values', async () => {
      const { verdict, entries } = await runAndRead(
        page,
        (lines) => lines.some((entry) => entry.message.startsWith('who=')) || hasError(lines),
        'alone-defaults',
      )
      // Per VMGR-113: a run on its own uses the default when there is no Current value.
      expect(printed(entries, 'who='), formatEntries(entries)).toEqual(['who=dflt level=low'])
      expect(verdict).toBe('passed')
    })

    await test.step('an allowed Current value is what the next run alone uses', async () => {
      await resetRun(page)
      await setCurrentValue(page, 'level', 'high')
      await closeInspector(page, 'level')
      const { verdict, entries } = await runAndRead(
        page,
        (lines) => lines.some((entry) => entry.message.startsWith('who=')) || hasError(lines),
        'alone-current',
      )
      // Per FNCFG-8: a Current value set before the run is used before the default.
      expect(printed(entries, 'who='), formatEntries(entries)).toEqual(['who=dflt level=high'])
      expect(verdict).toBe('passed')
    })
  })

  test('allowed values refuse empty and repeated values, and an input is never both secret and an enum', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const fnId = randomUUID()
    await seedAndOpen(page, request, 'fn-param-rules', [functionBlock(fnId, 'Rules_Fn', { nodes: [] })], [startEdge(fnId)])
    await digIn(page, fnId)
    const win = await openFunctionCreateModal(page, 'input')
    // Per VMGR-114: the window names the Function Block, never the caller.
    await expect(win.getByText('Required (the Function Block must set a value)', { exact: true })).toBeVisible()
    await expect(
      win.getByText('Create enum (limit the Function Block to a fixed set of values)', { exact: true }),
    ).toBeVisible()
    await setCreateName(page, 'level', win)
    await setWindowCheckbox(win, 'create-enum', true)
    const enumError = win.locator('[data-testid="create-enum-error"]')

    await test.step('an empty allowed value is named and Create is held off', async () => {
      await setAllowedValues(win, '["", "high"]')
      // Per VMGR-112: each allowed value is never an empty text.
      await expect(enumError).toHaveText('Allowed value at index 0 is empty')
      await expect(enumError).toHaveClass(/text-destructive/)
      await expect(windowSaveButton(win)).toBeDisabled()
      expect(await defaultOptions(page, win), 'only the non-empty values are offered').toEqual(['high'])
    })

    await test.step('a repeated allowed value is named and Create is held off', async () => {
      await setAllowedValues(win, '["low", "high", "low"]')
      // Per VMGR-112: each allowed value is listed once.
      await expect(enumError).toHaveText('Allowed value at index 2 (low) is already listed')
      await expect(windowSaveButton(win)).toBeDisabled()
      expect(await defaultOptions(page, win), 'each value is offered once').toEqual(['low', 'high'])
    })

    await test.step('Mark as secret and Create enum lock each other off', async () => {
      await setAllowedValues(win, '["low", "high"]')
      await expect(enumError).toHaveCount(0)
      const secret = windowCheckbox(win, 'secret')
      const createEnum = windowCheckbox(win, 'create-enum')
      // Per VMGR-104: with Create enum on, Mark as secret is off and locked.
      await expect(secret).toHaveAttribute('aria-disabled', 'true')
      await expect(await hintOf(win, secret)).toHaveText('off while enum is set')
      await secret.click({ force: true })
      await expect(secret).toHaveAttribute('data-state', 'unchecked')

      await setWindowCheckbox(win, 'create-enum', false)
      await setWindowCheckbox(win, 'secret', true)
      // Per VMGR-104: with Mark as secret on, Create enum is off and locked.
      await expect(createEnum).toHaveAttribute('aria-disabled', 'true')
      await expect(await hintOf(win, createEnum)).toHaveText('off while secret is set')
      await createEnum.click({ force: true })
      await expect(createEnum).toHaveAttribute('data-state', 'unchecked')

      // Per VMGR-103: a secret input has no default, so Set to null is held on and says why.
      const setNull = windowCheckbox(win, 'set-to-null')
      await expect(setNull).toHaveAttribute('data-state', 'checked')
      await expect(setNull).toHaveAttribute('aria-disabled', 'true')
      await expect(setNull).toHaveAttribute('aria-description', SECRET_INPUT_REASON)
      await win.getByText('Set to null', { exact: true }).hover()
      await expect(page.getByRole('tooltip')).toHaveText(SECRET_INPUT_REASON)
      await page.mouse.move(0, 0)
      await cancelCreate(page, win)
    })

    await test.step('a Function save with an empty or a repeated allowed value is refused naming it', async () => {
      for (const [values, problem] of [
        [['', 'high'], "Enum input 'level' has an empty allowed value"],
        [['low', 'high', 'low'], "Allowed value 'low' of enum input 'level' is listed more than once"],
      ] as const) {
        const resp = await request.post(`${BACKEND_URL}/functions`, {
          data: {
            name: `zz-fn-param-rules-${randomUUID().slice(0, 8)}`,
            description: '',
            tags: [],
            inputs: [{ name: 'level', type: 'string', required: true, description: '', enumValues: values, default: 'high' }],
            outputs: [],
            dependencies: { functions: [], plugins: [] },
            workflow: { nodes: [], edges: [] },
            version: '1.0.0',
            changelog: 'Initial release',
            details: '',
          },
        })
        const body = await resp.json().catch(() => ({}))
        if (resp.ok() && body?.data?.id) functionIds.push(body.data.id)
        expect(resp.ok(), `the Function save is refused: ${JSON.stringify(body)}`).toBe(false)
        expect(messagesIn(body), JSON.stringify(body)).toContain(problem)
      }
    })

    await test.step('a recipe with an empty, a repeated or a secret enum input is refused naming it', async () => {
      await enableMcpUntilRestart(page, MCP_PORT)
      mcpOn = true
      const name = `zz-fn-param-recipe-${randomUUID().slice(0, 8)}`
      for (const [declaration, binding, problem] of [
        ['type: string, required: true, enumValues: ["", high], default: high', 'high', "Enum input 'level' has an empty allowed value"],
        [
          'type: string, required: true, enumValues: [low, high, low], default: low',
          'low',
          "Allowed value 'low' of enum input 'level' is listed more than once",
        ],
        [
          'type: string, required: true, secret: true, enumValues: [low, high], default: low',
          'low',
          "Input 'level' cannot be both secret and an enum",
        ],
      ] as const) {
        const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe: levelRecipe(name, declaration, binding) })
        expect(verdict.payload.valid, JSON.stringify(verdict.payload)).toBe(false)
        expect(recipeProblems(verdict.payload), JSON.stringify(verdict.payload)).toContain(problem)
      }
      const clean = callTool(MCP_PORT, 'validate_recipe', {
        recipe: levelRecipe(name, 'type: string, required: true, enumValues: [low, high], default: low', 'high'),
      })
      expect(clean.payload.valid, JSON.stringify(clean.payload)).toBe(true)
    })
  })
})
