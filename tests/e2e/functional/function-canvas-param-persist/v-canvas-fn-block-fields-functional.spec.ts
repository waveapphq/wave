/**
 * V-CANVAS-FN-BLOCK-FIELDS: Function Block inputs open, show defaults and store values like Block fields
 * Wireframe: none
 * Design Decisions: FNCFG-6, FNCFG-7
 * REQ: REQ-3.1.1.5, REQ-3.1.2.1, REQ-3.1.3.19, REQ-3.1.3.20
 *
 * Seeds (API, POST /tests and POST /functions; every Test `zz-` named and deleted, the library
 * Function deleted with cascade):
 * - opening: Test variables `token` (string) and `base` (integer); a Local Function and a library
 *   Function Block, each with one optional input per field kind holding a value of its type
 *   (`abc`, 5, 2.5, true, `[1, 2, 3]`, `{a: 5}`, `[{id: 1}]`; the true / false input declares the default
 *   false), a string input given the variable `token` and an integer input given the expression `base + 1`.
 * - defaults: a Local Function whose optional inputs hold a default of every field kind, read by a
 *   body Log, then a marker Log; its Block holds the true / false input's default, written when the
 *   input appears (REQ-3.1.2.10).
 * - typed: a Local Function with an array input `nums` holding `[1, 2]` and a map input `opts`
 *   with no value, read by a body Log, then a marker Log.
 * - table: a Local Function with a table input `t_rows` holding the default `[{'id': 1}]`.
 * The Function Block window edits, the Saves and the runs are made through the UI.
 *
 * Pass Criteria:
 * 1. Every input holding a literal opens as the literal widget of its kind showing that value;
 *    an input holding a variable or an expression opens in expression mode with its text
 *    unchanged; Local and library alike.
 * 2. Opening and closing the Function Block window changes nothing: its Save stays off, the toolbar Save
 *    stays off, and a later Save of the Test keeps every field byte-identical.
 * 3. An unset free-entry input shows its default in gray in both modes, the expression editor in its
 *    Python literal form (`'hello'`, `7`, `1.5`, `[1, 2]`, `{'k': 1}`, `[{'id': 1}]`); switching modes
 *    copies nothing in, and a Save stores no value and no {x} flag for them; nothing is stored until a value
 *    is typed; the true / false input holds its default as a value, never gray.
 * 4. A typed value is stored; select all + Delete brings the gray default back and stores nothing for it;
 *    the run prints the defaults.
 * 5. The typed list and map editors store `[1, 2, 3]` and `{'a': 5}` with their items typed integer, and the
 *    body computes with them as numbers.
 * 6. A table input previews its rows' JSON with no quotes, gray when unset and full color when
 *    set; the set rows are stored as the table's columns and rows.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  codeField,
  codePlaceholder,
  expectHeldDefault,
  expectHeldValue,
  expectLiteralMode,
  exprToggle,
  numberInput,
  openFieldEditor,
  openListEditor,
  paramRow,
  saveButton,
  type FieldKind,
} from '../../helpers/config-sheet'
import { expectListRows, fillListRows, fillMapRows, getNode, saveAndCloseSheet } from '../../helpers/element-types'
import {
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  publishLibraryFunction,
  setFunctionFields,
  sharedNode,
  startEdge,
  type FunctionBlockFields,
} from '../../helpers/fn-seed'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { expectConsoleLine, getLogEntries } from '../../helpers/log-reader'
import { setStringParam, stringParamBox } from '../../helpers/param-config'
import { setValueEditorView } from '../../helpers/variable-create'
import { dragNodeBy, openFunctionBlockSheet, saveBtn, saveTest } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const LOCAL_ID = 'fn-fields-local'
const LIBRARY_ID = 'fn-fields-library'

interface LiteralCase {
  name: string
  kind: FieldKind
  value: unknown
  shown: string
}

/** One input per field kind holding a value of its type, and what the widget shows for it. */
const LITERALS: readonly LiteralCase[] = [
  { name: 'l_str', kind: 'string', value: 'abc', shown: 'abc' },
  { name: 'l_int', kind: 'integer', value: 5, shown: '5' },
  { name: 'l_float', kind: 'float', value: 2.5, shown: '2.5' },
  { name: 'l_bool', kind: 'boolean', value: true, shown: 'true' },
  { name: 'l_arr', kind: 'array', value: [1, 2, 3], shown: '[1, 2, 3]' },
  { name: 'l_map', kind: 'map', value: { a: 5 }, shown: '{"a": 5}' },
  { name: 'l_tbl', kind: 'table', value: [{ id: 1 }], shown: '[{"id": 1}]' },
]

/** Inputs given a variable and an expression: their text is not a literal of their type. */
const EXPRESSIONS = [
  { name: 'x_var', type: 'string', binding: 'token' },
  { name: 'x_expr', type: 'integer', binding: 'base + 1' },
] as const

interface DefaultCase {
  name: string
  kind: FieldKind
  value: unknown
  /** The gray default the one value field shows (FIELD-1, FIELD-2). */
  shown: string
  /** The gray default the empty expression editor shows. */
  code: string
}

/** The free-entry inputs: unset, each shows its default in gray (FIELD-2), in Python literal form in {x}. */
const DEFAULTS: readonly DefaultCase[] = [
  { name: 'd_str', kind: 'string', value: 'hello', shown: 'hello', code: "'hello'" },
  { name: 'd_int', kind: 'integer', value: 7, shown: '7', code: '7' },
  { name: 'd_float', kind: 'float', value: 1.5, shown: '1.5', code: '1.5' },
  { name: 'd_arr', kind: 'array', value: [1, 2], shown: '[1, 2]', code: '[1, 2]' },
  { name: 'd_map', kind: 'map', value: { k: 1 }, shown: '{"k": 1}', code: "{'k': 1}" },
  { name: 'd_tbl', kind: 'table', value: [{ id: 1 }], shown: '[{"id": 1}]', code: "[{'id': 1}]" },
]

/** A true / false input starts on its default, written when the input appears (FIELD-8, REQ-3.1.2.10). */
const BOOL_DEFAULT = { name: 'd_bool', kind: 'boolean', value: true, shown: 'true' } as const
const HELD_BOOL = { [BOOL_DEFAULT.name]: BOOL_DEFAULT.value }

const DEFAULTS_ID = 'fn-defaults'
const DEFAULTS_MARKER = 'zz-fn-defaults-done'
const DEFAULTS_LINE = "hello|7|1.5|True|[1, 2]|{'k': 1}|1"

const TYPED_ID = 'fn-typed'
const TYPED_MARKER = 'zz-fn-typed-done'

const TABLE_ID = 'fn-table'

function zzName(what: string): string {
  return `zz-fn-block-fields-${what}-${randomUUID().slice(0, 8)}`
}

function literalInputs(): Array<Record<string, unknown>> {
  return [
    // A true / false input declares a default (REQ-3.1.2.10).
    ...LITERALS.map(({ name, kind }) => ({ name, type: kind, required: false, ...(kind === 'boolean' ? { default: false } : {}) })),
    ...EXPRESSIONS.map(({ name, type }) => ({ name, type, required: false })),
  ]
}

function literalFields(): FunctionBlockFields {
  return {
    values: {
      ...Object.fromEntries(LITERALS.map(({ name, value }) => [name, value])),
      ...Object.fromEntries(EXPRESSIONS.map(({ name, binding }) => [name, binding])),
    },
    expressionFields: EXPRESSIONS.map(({ name }) => name),
  }
}

/** A Local Function node whose Block holds `fields`. */
function heldLocalNode(id: string, label: string, body: Parameters<typeof localFunctionNode>[2], fields: FunctionBlockFields) {
  return setFunctionFields(localFunctionNode(id, label, body), fields)
}

/** Every Function Block's fields and output bindings as the stored JSON text. */
async function storedBlocks(request: APIRequestContext, testId: string, ids: string[]): Promise<string> {
  const blocks: Record<string, unknown> = {}
  for (const id of ids) {
    const node = await getNode(request, testId, id)
    blocks[id] = {
      values: node.data.config?.values ?? null,
      expressionFields: node.data.expressionFields ?? null,
      templateFields: node.data.templateFields ?? null,
      outputBindings: node.data.config?.outputBindings ?? null,
    }
  }
  return JSON.stringify(blocks)
}

async function storedValues(request: APIRequestContext, testId: string, nodeId: string): Promise<Record<string, unknown>> {
  return ((await getNode(request, testId, nodeId)).data.config?.values ?? {}) as Record<string, unknown>
}

/** Type `text` key by key into a row's box, replacing what it shows (a gray default takes no fill). */
async function typeFieldText(sheet: Locator, name: string, text: string, box: Locator): Promise<void> {
  await expect(paramRow(sheet, name)).toBeVisible()
  await box.click()
  await box.press('ControlOrMeta+a')
  await box.pressSequentially(text)
  await expect(box).toHaveValue(text)
}

/** Select all + Delete in a row's box: the field goes back to not set (FIELD-3). */
async function clearToDefault(page: Page, box: Locator): Promise<void> {
  await box.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
}

async function cancelSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

async function saveSheet(sheet: Locator): Promise<void> {
  await expect(saveButton(sheet)).toBeEnabled()
  await saveButton(sheet).click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

/** Replace a string or table row's text through its Edit value sheet (a table in its Code view) in one input. */
async function replaceRowText(page: Page, sheet: Locator, name: string, text: string, view?: 'Code'): Promise<void> {
  const editorSheet = await openFieldEditor(page, sheet, name)
  if (view) await setValueEditorView(page, editorSheet, view)
  const editor = editorSheet.locator('.cm-content').first()
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.insertText(text)
  await expect(editor).toHaveText(text)
  await saveAndCloseSheet(page)
}

test.describe('V-CANVAS-FN-BLOCK-FIELDS: Function Block input fields', () => {
  let testId = ''
  let libraryFunctionId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
    if (libraryFunctionId) {
      await request.delete(`${BACKEND_URL}/functions/${libraryFunctionId}?cascade=true`).catch(() => undefined)
    }
    libraryFunctionId = ''
  })

  test.describe('opening', () => {
    test.beforeEach(async ({ page, request }) => {
      const library = await publishLibraryFunction(request, {
        name: `zz-fnbf-lib-${randomUUID().slice(0, 8)}`,
        inputs: literalInputs(),
      })
      libraryFunctionId = library.functionId
      testId = await createValidTest(request, {
        name: zzName('opening'),
        variables: {
          token: { type: 'string', value: 'tok-1', scope: 'test' },
          base: { type: 'integer', value: 4, scope: 'test' },
        },
        nodes: [
          heldLocalNode(LOCAL_ID, 'Fields_Local', { nodes: [], inputs: literalInputs() }, literalFields()),
          sharedNode(LIBRARY_ID, {
            functionId: library.functionId,
            functionVersion: library.version,
            label: 'Fields_Library',
            originalLibraryName: library.name,
            ...literalFields(),
            position: { x: 560, y: 200 },
          }),
        ],
        edges: [startEdge(LOCAL_ID), { id: 'e-local-library', source: LOCAL_ID, target: LIBRARY_ID }],
      })
      await openTest(page, testId)
    })

    test('Function Block inputs open as their literal widget and an expression or variable opens as its text, Local and library', async ({
      page,
    }) => {
      for (const [where, nodeId] of [
        ['Local', LOCAL_ID],
        ['library', LIBRARY_ID],
      ] as const) {
        await test.step(`${where} Function Block`, async () => {
          const sheet = await openFunctionBlockSheet(page, nodeId)
          for (const { name, kind, shown } of LITERALS) {
            await expectHeldValue(page, sheet, name, kind, shown)
          }
          for (const { name, binding } of EXPRESSIONS) {
            await expect(exprToggle(sheet, name), `${where} ${name} opens in expression mode`).toHaveAttribute(
              'aria-pressed',
              'true',
            )
            await expect(codeField(sheet, name), `${where} ${name} keeps its text`).toHaveText(binding)
          }
          await cancelSheet(sheet)
        })
      }
    })

    test('opening and closing the sheet changes nothing: Save stays off and a later Save keeps every field byte-identical', async ({
      page,
      request,
    }) => {
      const before = await storedBlocks(request, testId, [LOCAL_ID, LIBRARY_ID])

      for (const nodeId of [LOCAL_ID, LIBRARY_ID]) {
        const sheet = await openFunctionBlockSheet(page, nodeId)
        await expect(paramRow(sheet, 'l_str')).toBeVisible()
        await expect(saveButton(sheet), `${nodeId}: opening is no change`).toBeDisabled()
        await cancelSheet(sheet)
        await expect(saveBtn(page), `${nodeId}: closing leaves the Test unchanged`).toBeDisabled()
      }

      // A moved Block is the only change, so the Save rewrites every Function Block from what the canvas holds.
      await dragNodeBy(page, LOCAL_ID, { confirmTestId: 'toolbar-save-button' })
      await saveTest(page)
      expect(await storedBlocks(request, testId, [LOCAL_ID, LIBRARY_ID]), 'fields and config byte-identical').toBe(
        before,
      )
    })
  })

  test.describe('defaults', () => {
    test.beforeEach(async ({ page, request }) => {
      await ensureEnvironment(request)
      testId = await createValidTest(request, {
        name: zzName('defaults'),
        nodes: [
          heldLocalNode(DEFAULTS_ID, 'Defaults_Local', {
            nodes: [
              logNode(
                'fn-print-defaults',
                'Print Defaults',
                "f'{d_str}|{d_int}|{d_float}|{d_bool}|{d_arr}|{d_map}|{len(d_tbl)}'",
                { x: 200, y: 180 },
              ),
            ],
            edges: [startEdge('fn-print-defaults')],
            inputs: [...DEFAULTS, BOOL_DEFAULT].map(({ name, kind, value }) => ({ name, type: kind, required: false, default: value })),
          }, { values: HELD_BOOL }),
          logNode('defaults-done', 'Done', `'${DEFAULTS_MARKER}'`, { x: 560, y: 200 }),
        ],
        edges: [startEdge(DEFAULTS_ID), { id: 'e-defaults-done', source: DEFAULTS_ID, target: 'defaults-done' }],
      })
      await openTest(page, testId)
    })

    test('an unset input shows its default in gray in both modes and a mode switch stores nothing', async ({
      page,
      request,
    }) => {
      const sheet = await openFunctionBlockSheet(page, DEFAULTS_ID)

      await test.step('every free-entry kind opens showing its default in gray; true / false holds its default', async () => {
        for (const { name, kind, shown } of DEFAULTS) await expectHeldDefault(page, sheet, name, kind, shown)
        await expectHeldValue(page, sheet, BOOL_DEFAULT.name, BOOL_DEFAULT.kind, BOOL_DEFAULT.shown)
        await expect(saveButton(sheet)).toBeDisabled()
      })

      for (const { name, kind, shown, code } of DEFAULTS) {
        await test.step(`${name}: a switch to expression mode and back copies nothing in`, async () => {
          await exprToggle(sheet, name).click()
          await expect(exprToggle(sheet, name)).toHaveAttribute('aria-pressed', 'true')
          // The gray hint shows only over an empty editor: nothing is copied in.
          await expect(codePlaceholder(sheet, name), `${name}: the default shows gray in the code field`).toHaveText(code)
          await exprToggle(sheet, name).click()
          await expectHeldDefault(page, sheet, name, kind, shown)
        })
      }

      // Per FIELD-7: the switches copied nothing, so a Save of the window stores nothing for these fields.
      if (await saveButton(sheet).isEnabled()) await saveSheet(sheet)
      else await cancelSheet(sheet)
      if (await saveBtn(page).isEnabled()) await saveTest(page)
      const stored = await getNode(request, testId, DEFAULTS_ID)
      expect(stored.data.config?.values ?? {}, 'nothing more is stored').toEqual(HELD_BOOL)
      expect(stored.data.expressionFields ?? [], 'no {x} flag is stored').toEqual([])
    })

    test('a typed value is stored, clearing it brings the gray default back and stores nothing, and the run uses the default', async ({
      page,
      request,
    }) => {
      await test.step('a typed integer and string are the only values stored', async () => {
        const sheet = await openFunctionBlockSheet(page, DEFAULTS_ID)
        // Per FIELD-2: typing over the gray default replaces it.
        await typeFieldText(sheet, 'd_int', '9', numberInput(sheet, 'd_int'))
        await setStringParam(sheet, page, 'd_str', 'bye')
        await expectHeldValue(page, sheet, 'd_int', 'integer', '9')
        await expectHeldValue(page, sheet, 'd_str', 'string', 'bye')
        await saveSheet(sheet)
        await saveTest(page)
        expect(await storedValues(request, testId, DEFAULTS_ID)).toEqual({ ...HELD_BOOL, d_int: 9, d_str: 'bye' })
      })

      await test.step('clearing both brings the gray defaults back and stores nothing', async () => {
        const sheet = await openFunctionBlockSheet(page, DEFAULTS_ID)
        await expectHeldValue(page, sheet, 'd_int', 'integer', '9')
        // Per FIELD-3: select all + Delete in the field takes it back to not set.
        await clearToDefault(page, numberInput(sheet, 'd_int'))
        await expectHeldDefault(page, sheet, 'd_int', 'integer', '7')
        await clearToDefault(page, stringParamBox(sheet, 'd_str'))
        await expectHeldDefault(page, sheet, 'd_str', 'string', 'hello')
        await saveSheet(sheet)
        await saveTest(page)
        expect(await storedValues(request, testId, DEFAULTS_ID), 'a cleared value stores nothing').toEqual(HELD_BOOL)
      })

      await test.step('the run uses every default', async () => {
        const status = await startRun(page)
        await finishRun(page, status, DEFAULTS_MARKER)
        expectConsoleLine(await getLogEntries(page), 'INFO', DEFAULTS_LINE)
      })
    })
  })

  test('the typed list and map editors store numbers', async ({ page, request }) => {
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: zzName('typed'),
      nodes: [
        heldLocalNode(
          TYPED_ID,
          'Typed_Local',
          {
            nodes: [
              logNode(
                'fn-print-typed',
                'Print Typed',
                "str(nums[0] + nums[1] + nums[2]) + '|' + str(opts['a'] + 1)",
                { x: 200, y: 180 },
              ),
            ],
            edges: [startEdge('fn-print-typed')],
            inputs: [
              { name: 'nums', type: 'array', required: false },
              { name: 'opts', type: 'map', required: false },
            ],
          },
          { values: { nums: [1, 2] } },
        ),
        logNode('typed-done', 'Done', `'${TYPED_MARKER}'`, { x: 560, y: 200 }),
      ],
      edges: [startEdge(TYPED_ID), { id: 'e-typed-done', source: TYPED_ID, target: 'typed-done' }],
    })
    await openTest(page, testId)
    const sheet = await openFunctionBlockSheet(page, TYPED_ID)

    await test.step('adding 3 to [1, 2] keeps every item a number', async () => {
      await expectHeldValue(page, sheet, 'nums', 'array', '[1, 2]')
      const editor = await openListEditor(page, sheet, 'nums')
      await expect(editor).toBeVisible()
      await expectListRows(editor, [
        { text: '1', type: 'integer' },
        { text: '2', type: 'integer' },
      ])
      await fillListRows(page, editor, [{ text: '3', type: 'integer' }], 2)
      await saveAndCloseSheet(page)
      await expectHeldValue(page, sheet, 'nums', 'array', '[1, 2, 3]')
    })

    await test.step("a map entry 'a' typed integer 5 stays a number", async () => {
      await expectLiteralMode(sheet, 'opts', 'map')
      const editor = await openFieldEditor(page, sheet, 'opts')
      await fillMapRows(page, editor, [{ key: 'a', text: '5', type: 'integer' }])
      await saveAndCloseSheet(page)
      await expectHeldValue(page, sheet, 'opts', 'map', '{"a": 5}')
    })

    await saveSheet(sheet)
    await saveTest(page)
    // Per REQ-3.1.3.19: a typed item keeps its declared type; a number the editor typed travels as its exact text.
    const typed = await getNode(request, testId, TYPED_ID)
    const values = typed.data.config?.values as { nums: unknown[]; opts: Record<string, unknown> }
    expect(values.nums.map((item) => Number(item)), JSON.stringify(values)).toEqual([1, 2, 3])
    expect(Number(values.opts.a), JSON.stringify(values)).toBe(5)
    expect(typed.data.elementTypes, 'the typed items keep their declared integer type').toEqual({
      nums: ['integer', 'integer', 'integer'],
      opts: { a: 'integer' },
    })

    const status = await startRun(page)
    await finishRun(page, status, TYPED_MARKER)
    expectConsoleLine(await getLogEntries(page), 'INFO', '6|6')
  })

  test("a table input preview shows its rows' JSON with no quotes, gray when unset and full color when set", async ({
    page,
    request,
  }) => {
    testId = await createValidTest(request, {
      name: zzName('table'),
      nodes: [
        localFunctionNode(TABLE_ID, 'Table_Local', {
          nodes: [],
          inputs: [{ name: 't_rows', type: 'table', required: false, default: [{ id: 1 }] }],
        }),
      ],
      edges: [startEdge(TABLE_ID)],
    })
    await openTest(page, testId)
    const sheet = await openFunctionBlockSheet(page, TABLE_ID)

    await expectHeldDefault(page, sheet, 't_rows', 'table', '[{"id": 1}]')
    await replaceRowText(page, sheet, 't_rows', '[{"id": 2}]', 'Code')
    await expectHeldValue(page, sheet, 't_rows', 'table', '[{"id": 2}]')

    await saveSheet(sheet)
    await saveTest(page)
    // A table is stored as its columns and rows, each cell in its exact text (REQ-3.1.3.14).
    expect(await storedValues(request, testId, TABLE_ID)).toEqual({
      t_rows: { columns: [{ name: 'id', type: 'integer' }], rows: [['2']] },
    })
  })
})
