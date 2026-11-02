/**
 * V-CANVAS-FN-PARAM-WINDOW: the variable, Function local, input and output windows are one window body
 * Design Decisions: VMGR-97, VMGR-98, VMGR-99, VMGR-110, VMGR-112
 * REQ: REQ-3.1.3.11, REQ-3.1.2.1, REQ-3.1.2.8, REQ-3.1.3.24
 *
 * Seed (API): a `zz-` Test holding one empty Local Function (`createValidTest`). The Variable window opens
 * from the Test's "+ Add"; the local, input and output windows from the in-Function "+ Add" menu.
 *
 * Pass Criteria:
 * 1. Every window reads top to bottom: Name, Description (parameters only), Type with Kind beside it
 *    (none on an input, whose Type is half width), the checkboxes one after another (an input: Required,
 *    Mark as secret, Set to null, Create enum), the value last.
 * 2. Kind offers Literal, Expression and Template on a String and Literal, Expression on an Integer in the
 *    variable, local and output windows; an input has no Kind. A Template and an Expression created in each
 *    are stored with `isTemplate` / `isExpression` and the source text, and their rows show the kind badge.
 * 3. Array, Map and Table open the "Edit value" window from the value field in all four windows: JSON typed
 *    in its Code view shows in its Visual view and is stored typed as the variable value or the parameter
 *    default.
 * 4. The value field is one same-height line: in all four windows a String and an Array field have the
 *    same height, and a resized window leaves it unchanged.
 * 5. At the smallest window size and on a short screen, scrolling each window to the end shows the whole
 *    value field (label, field at its floor, error line) above the footer for String, Template,
 *    Expression, Integer, Float, Boolean, Array, Map, Table, an enum's Default select, a Required input's
 *    default and Set to null.
 * 6. An input window opens with its String default field fully shown and nothing to scroll.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { getTest } from '../../helpers/element-types'
import {
  createValidTest,
  localFunctionNode,
  openTest,
  startEdge,
  storedLocalDefinition,
} from '../../helpers/fn-seed'
import {
  cancelCreate,
  createWindowOrder,
  fillCreateWindow,
  insertCodeValue,
  insertCreateCode,
  closeValueEditor,
  openCreateModal,
  openFunctionCreateModal,
  openValueEditor,
  setCreateKind,
  setCreateName,
  setCreateType,
  setToNull,
  setValueEditorView,
  submitCreate,
  variableRow,
  type CreateFieldKind,
} from '../../helpers/variable-create'
import { digIn, popToBreadcrumbSegment, saveTest } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const FN_ID = 'fn-param-window'

type WindowKind = 'variable' | 'local' | 'input' | 'output'

const FUNCTION_WINDOWS: WindowKind[] = ['local', 'input', 'output']
const KIND_WINDOWS: WindowKind[] = ['variable', 'local', 'output']

const SHORT_SCREEN = { width: 1280, height: 420 }
const DEFAULT_SCREEN = { width: 1280, height: 800 }

const VALUE_LABEL: Record<WindowKind, RegExp> = {
  variable: /^Value$/,
  local: /^Value$/,
  input: /^Default value$/,
  output: /^Value$/,
}

let testId = ''

async function seed(page: Page, request: APIRequestContext): Promise<string> {
  const testName = `zz-fn-param-window-${randomUUID().slice(0, 8)}`
  testId = await createValidTest(request, {
    name: testName,
    nodes: [localFunctionNode(FN_ID, 'Window_Fn', { nodes: [] })],
    edges: [startEdge(FN_ID)],
  })
  await openTest(page, testId)
  return testName
}

async function enterFunction(page: Page): Promise<void> {
  await digIn(page, FN_ID)
  await expect(page.getByTestId('add-variable-dropdown-trigger')).toBeVisible()
}

/** Open the window of `kind`; the variable window needs the Test scope, the others the Function's. */
async function openWindow(page: Page, kind: WindowKind): Promise<Locator> {
  if (kind === 'variable') return openCreateModal(page)
  return openFunctionCreateModal(page, kind === 'local' ? 'variable' : kind)
}

const control = (modal: Locator, testId: string): Locator => modal.locator(`[data-testid="${testId}"]`)

/** The options a Select offers, read with its list open; picks `choose` to close it. */
async function selectOptions(page: Page, trigger: Locator, choose: string): Promise<string[]> {
  await trigger.click()
  const options = page.getByRole('option')
  await expect(options.first()).toBeVisible()
  const labels = (await options.allTextContents()).map((text) => text.trim())
  await page.getByRole('option', { name: choose, exact: true }).click()
  await expect(trigger).toHaveText(choose)
  return labels
}

/** The tops of the form's blocks, in DOM order. */
async function blockTops(modal: Locator): Promise<number[]> {
  return control(modal, 'create-value-area').evaluate((area) =>
    Array.from((area.parentElement as HTMLElement).children).map((el) => el.getBoundingClientRect().top),
  )
}

/** The declaration a window created, wherever it is stored. */
async function storedEntry(
  request: APIRequestContext,
  kind: WindowKind,
  name: string,
): Promise<Record<string, unknown>> {
  if (kind === 'variable') {
    const variables = ((await getTest(request, testId)).variables ?? {}) as Record<string, Record<string, unknown>>
    expect(variables[name], `Test variable ${name} is stored`).toBeTruthy()
    return variables[name]
  }
  const stored = await storedLocalDefinition(request, testId, FN_ID)
  const list = { local: stored.variables, input: stored.inputs, output: stored.outputs }[kind]
  const entry = list.find((item) => item.name === name)
  expect(entry, `${kind} ${name} is stored`).toBeTruthy()
  return entry as Record<string, unknown>
}

/** The stored source of a window's value: a variable's `value`, a parameter's `default`. */
const valueKey = (kind: WindowKind): 'value' | 'default' => (kind === 'variable' || kind === 'local' ? 'value' : 'default')

// ---------------------------------------------------------------------------
// The whole value field at the smallest size and on a short screen
// ---------------------------------------------------------------------------

const LINE_FIELD = '[data-testid="window-value-field"] input'
const NUMBER_BOX = '[data-testid="scalar-edit-input"]'
const NULL_FIELD = '[data-testid="create-null-field"]'

interface ValueCell {
  label: string
  /** Window state set before any resize. */
  setup?: (page: Page, modal: Locator, name: string) => Promise<void>
  /** Edits that need focus, done after the resize (a pointer-down on the grip would blur them). */
  provoke?: (page: Page, modal: Locator, name: string) => Promise<void>
  /** The value editor inside the value area, and the height it never goes under. */
  editor: string
  floor: number
  /** An error line the cell raises inside the value area. */
  areaError?: { testId: string; text: string | RegExp }
  /** The number box's strip between the form and the footer. */
  strip?: string
  valueLabel?: RegExp
}

const ofType =
  (type: string) =>
  async (page: Page, modal: Locator): Promise<void> => {
    await setCreateType(page, type, modal)
    // The closing Type list hands focus back to its button; acting earlier loses that race.
    await expect(control(modal, 'create-type-select')).toBeFocused()
  }

async function emptyNumberBox(_page: Page, modal: Locator): Promise<void> {
  const box = control(modal, 'scalar-edit-input')
  await box.fill('')
  await expect(box).toBeFocused()
}

async function selfReference(page: Page, modal: Locator, name: string): Promise<void> {
  await insertCodeValue(page, `${name} + 1`, modal)
  await leaveExpressionEditor(modal)
}

function valueCells(kind: WindowKind): ValueCell[] {
  const kinds: ValueCell[] =
    kind === 'input'
      ? []
      : [
          {
            label: 'Template',
            setup: (page, modal) => setCreateKind(page, 'Template', modal),
            editor: '.cm-editor',
            floor: 20,
          },
          {
            label: 'Expression',
            setup: (page, modal) => setCreateKind(page, 'Expression', modal),
            provoke: selfReference,
            editor: '.cm-editor',
            floor: 20,
            areaError: { testId: 'create-cycle-error', text: /^Circular reference detected for variable / },
          },
        ]
  const inputOnly: ValueCell[] =
    kind === 'input'
      ? [
          {
            label: 'enum Default select',
            setup: async (_page, modal) => {
              await control(modal, 'param-create-enum-checkbox').click()
            },
            editor: '[data-testid="enum-value-select"]',
            floor: 30,
            areaError: { testId: 'create-enum-default-error', text: 'Default value is required' },
            // Per FIELD-12: a choice list's Default value carries the accessible red star.
            valueLabel: /^Default value\* required$/,
          },
          {
            label: 'Required default',
            setup: async (_page, modal) => {
              await control(modal, 'param-required-checkbox').click()
            },
            editor: LINE_FIELD,
            floor: 30,
          },
        ]
      : []
  return [
    { label: 'String', editor: LINE_FIELD, floor: 30 },
    ...kinds,
    {
      label: 'Integer',
      setup: ofType('integer'),
      provoke: emptyNumberBox,
      editor: NUMBER_BOX,
      floor: 28,
      strip: 'Enter a valid integer value',
    },
    {
      label: 'Float',
      setup: ofType('float'),
      provoke: emptyNumberBox,
      editor: NUMBER_BOX,
      floor: 28,
      strip: 'Enter a valid float value',
    },
    { label: 'Boolean', setup: ofType('boolean'), editor: '[data-testid="scalar-edit-body"]', floor: 24 },
    { label: 'Array', setup: ofType('array'), editor: LINE_FIELD, floor: 30 },
    { label: 'Map', setup: ofType('map'), editor: LINE_FIELD, floor: 30 },
    { label: 'Table', setup: ofType('table'), editor: LINE_FIELD, floor: 30 },
    ...inputOnly,
    {
      label: 'Set to null',
      setup: async (page, modal) => {
        await setCreateType(page, 'array', modal)
        await setToNull(page, modal)
      },
      editor: NULL_FIELD,
      floor: 30,
    },
  ]
}

interface Box {
  top: number
  bottom: number
  height: number
}

interface ValueFieldLayout {
  viewportHeight: number
  window: Box
  form: Box
  scrolledToEnd: boolean
  area: Box
  label: Box
  labelText: string
  editor: Box | null
  errors: Box[]
  strip: (Box & { text: string }) | null
  footerTop: number
}

/** Scroll the window's form to its end, as the author would, and read where the value field lies. */
async function scrollToValueEnd(modal: Locator, editor: string): Promise<ValueFieldLayout> {
  return control(modal, 'create-value-area').evaluate((area, editorSelector) => {
    const box = (el: Element): Box => {
      const rect = el.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, height: rect.height }
    }
    const form = area.parentElement as HTMLElement
    form.scrollTop = form.scrollHeight
    const win = area.closest('[data-testid="variable-create-modal"]') as HTMLElement
    const footer = (win.querySelector('[data-testid="create-submit-button"]') as HTMLElement).parentElement as HTMLElement
    const strip = win.querySelector('[data-testid="create-validation"]')
    const label = area.firstElementChild as HTMLElement
    const editorEl = area.querySelector(editorSelector)
    return {
      viewportHeight: window.innerHeight,
      window: box(win),
      form: box(form),
      scrolledToEnd: form.scrollTop + form.clientHeight >= form.scrollHeight - 1,
      area: box(area),
      label: box(label),
      labelText: label.textContent ?? '',
      editor: editorEl ? box(editorEl) : null,
      errors: Array.from(area.querySelectorAll('[role="alert"]')).map(box),
      strip: strip ? { ...box(strip), text: strip.textContent ?? '' } : null,
      footerTop: footer.getBoundingClientRect().top,
    }
  }, editor)
}

function expectWholeValueField(layout: ValueFieldLayout, cell: ValueCell, kind: WindowKind, where: string): void {
  const what = `${kind} window, ${cell.label}, ${where}`
  expect(layout.window.top, `${what}: the window is on screen`).toBeGreaterThanOrEqual(-0.5)
  expect(layout.window.bottom, `${what}: the window is on screen`).toBeLessThanOrEqual(layout.viewportHeight + 0.5)
  expect(layout.scrolledToEnd, `${what}: the form scrolled to its end`).toBe(true)
  expect(layout.form.bottom, `${what}: the form ends above the footer`).toBeLessThanOrEqual(layout.footerTop + 0.5)
  expect(layout.labelText.replace(/\s+/g, ' ').trim(), `${what}: the value label`).toMatch(
    cell.valueLabel ?? VALUE_LABEL[kind],
  )
  expect(layout.area.top, `${what}: the value label shows`).toBeGreaterThanOrEqual(layout.form.top - 0.5)
  expect(layout.area.bottom, `${what}: the whole value field shows`).toBeLessThanOrEqual(layout.form.bottom + 0.5)
  expect(layout.editor, `${what}: the editor is there`).not.toBeNull()
  expect(layout.editor!.height, `${what}: the editor keeps its full box`).toBeGreaterThanOrEqual(cell.floor)
  expect(layout.editor!.top, `${what}: the editor sits under the label`).toBeGreaterThanOrEqual(layout.label.bottom - 0.5)
  expect(layout.editor!.bottom, `${what}: the editor is whole`).toBeLessThanOrEqual(layout.area.bottom + 0.5)
  if (cell.areaError) {
    expect(layout.errors.length, `${what}: the error line shows`).toBeGreaterThan(0)
    for (const error of layout.errors) {
      expect(error.bottom, `${what}: the error line is whole`).toBeLessThanOrEqual(layout.area.bottom + 0.5)
    }
  }
  if (cell.strip) {
    expect(layout.strip?.text.trim(), `${what}: the number box names its problem`).toBe(cell.strip)
    expect(layout.strip!.top, `${what}: the strip is under the form`).toBeGreaterThanOrEqual(layout.form.bottom - 0.5)
    expect(layout.strip!.bottom, `${what}: the strip is above the footer`).toBeLessThanOrEqual(layout.footerTop + 0.5)
  }
}

/** Drag the corner grip far up and left, so the window stops at its floor. */
async function shrinkToFloor(page: Page, modal: Locator): Promise<void> {
  const before = (await modal.boundingBox())!
  const grip = (await control(modal, 'dialog-resize-corner').boundingBox())!
  await page.mouse.move(grip.x + 4, grip.y + 4)
  await page.mouse.down()
  await page.mouse.move(grip.x - 600, grip.y - 600, { steps: 12 })
  await page.mouse.up()
  const after = (await modal.boundingBox())!
  expect(after.height, 'the window shrank to its floor').toBeLessThanOrEqual(before.height)
}

async function checkValueCell(
  page: Page,
  kind: WindowKind,
  cell: ValueCell,
  where: 'smallest size' | 'short screen',
): Promise<void> {
  const name = `p0_${kind}`
  const modal = await openWindow(page, kind)
  await setCreateName(page, name, modal)
  if (cell.setup) await cell.setup(page, modal, name)
  if (where === 'smallest size') await shrinkToFloor(page, modal)
  if (cell.provoke) await cell.provoke(page, modal, name)
  if (cell.areaError) {
    await expect(control(modal, cell.areaError.testId)).toHaveText(cell.areaError.text)
  }
  if (cell.strip) await expect(control(modal, 'create-validation')).toHaveText(cell.strip)
  expectWholeValueField(await scrollToValueEnd(modal, cell.editor), cell, kind, where)
  await cancelCreate(page, modal)
}

/** Both passes: the short screen first, so no remembered window size carries into it. */
async function checkEveryValueCell(page: Page, kind: WindowKind): Promise<void> {
  await page.setViewportSize(SHORT_SCREEN)
  for (const cell of valueCells(kind)) {
    await test.step(`${cell.label} on a short screen`, () => checkValueCell(page, kind, cell, 'short screen'))
  }
  await page.setViewportSize(DEFAULT_SCREEN)
  for (const cell of valueCells(kind)) {
    await test.step(`${cell.label} at the smallest size`, () => checkValueCell(page, kind, cell, 'smallest size'))
  }
}

// ---------------------------------------------------------------------------

test.describe('V-CANVAS-FN-PARAM-WINDOW: one window body for variables and parameters', () => {
  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('the four windows keep one field order: Name, Description on parameters, Type and Kind, the checkboxes together, the value last', async ({
    page,
    request,
  }) => {
    await seed(page, request)
    const expected: Record<WindowKind, CreateFieldKind[]> = {
      variable: ['name', 'type+kind', 'secret', 'set-to-null', 'value'],
      local: ['name', 'type+kind', 'secret', 'set-to-null', 'value'],
      input: ['name', 'description', 'type', 'required', 'secret', 'set-to-null', 'create-enum', 'value'],
      output: ['name', 'description', 'type+kind', 'secret', 'set-to-null', 'value'],
    }

    for (const kind of ['variable', ...FUNCTION_WINDOWS] as WindowKind[]) {
      await test.step(`the ${kind} window`, async () => {
        if (kind === 'local') await enterFunction(page)
        const modal = await openWindow(page, kind)
        // Per VMGR-98: one body, the same order in every window; a String input shows every checkbox.
        expect(await createWindowOrder(page, modal)).toEqual(expected[kind])
        const tops = await blockTops(modal)
        expect(tops, 'the blocks stack top to bottom in that order').toEqual([...tops].sort((a, b) => a - b))
        const typeBox = (await control(modal, 'create-type-select').boundingBox())!
        if (kind === 'input') {
          await expect(control(modal, 'create-kind-select')).toHaveCount(0)
          const nameBox = (await control(modal, 'create-variable-name').boundingBox())!
          expect(typeBox.width, 'an input Type is half width').toBeLessThan(nameBox.width * 0.55)
        } else {
          const kindBox = (await control(modal, 'create-kind-select').boundingBox())!
          expect(Math.abs(kindBox.y - typeBox.y), 'Kind sits beside Type').toBeLessThan(2)
          expect(kindBox.x).toBeGreaterThan(typeBox.x + typeBox.width)
        }
        await expect(control(modal, 'param-description')).toHaveCount(kind === 'input' || kind === 'output' ? 1 : 0)
        await cancelCreate(page, modal)
      })
    }
  })

  test('Kind offers Literal and Expression, plus Template on a String, in the variable, local and output windows; the kind is stored and the row shows its badge', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const testName = await seed(page, request)
    const template = 'v-{{ 2 + 3 }}'

    for (const kind of KIND_WINDOWS) {
      await test.step(`the ${kind} window`, async () => {
        if (kind === 'local') await enterFunction(page)

        const stringWindow = await openWindow(page, kind)
        await setCreateName(page, `tpl_${kind}`, stringWindow)
        expect(await selectOptions(page, control(stringWindow, 'create-kind-select'), 'Template')).toEqual([
          'Literal',
          'Expression',
          'Template',
        ])
        await insertCodeValue(page, template, stringWindow)
        await leaveExpressionEditor(stringWindow)
        await submitCreate(page, stringWindow)
        await expect(stringWindow).toBeHidden()
        await expect(variableRow(page, `tpl_${kind}`).locator('[data-testid^="template-badge-"]')).toHaveText('{{ }}')

        const integerWindow = await openWindow(page, kind)
        await setCreateName(page, `expr_${kind}`, integerWindow)
        await setCreateType(page, 'integer', integerWindow)
        expect(await selectOptions(page, control(integerWindow, 'create-kind-select'), 'Expression')).toEqual([
          'Literal',
          'Expression',
        ])
        await insertCodeValue(page, '2 + 3', integerWindow)
        await leaveExpressionEditor(integerWindow)
        await submitCreate(page, integerWindow)
        await expect(integerWindow).toBeHidden()
        await expect(variableRow(page, `expr_${kind}`).locator('[data-testid^="expr-badge-"]')).toHaveText('{x}')
      })
    }

    await test.step('the input window has no Kind', async () => {
      const modal = await openWindow(page, 'input')
      await expect(control(modal, 'create-kind-select')).toHaveCount(0)
      await cancelCreate(page, modal)
    })

    await test.step('each kind is stored with its source text', async () => {
      await popToBreadcrumbSegment(page, testName)
      await saveTest(page)
      for (const kind of KIND_WINDOWS) {
        const key = valueKey(kind)
        const tpl = await storedEntry(request, kind, `tpl_${kind}`)
        expect(tpl, `${kind} Template`).toMatchObject({ type: 'string', [key]: template, isTemplate: true })
        expect(tpl.isExpression, `${kind} Template is not an Expression`).toBeFalsy()
        const expr = await storedEntry(request, kind, `expr_${kind}`)
        expect(expr, `${kind} Expression`).toMatchObject({ type: 'integer', [key]: '2 + 3', isExpression: true })
        expect(expr.isTemplate, `${kind} Expression is not a Template`).toBeFalsy()
      }
    })
  })

  test('Array, Map and Table open the Edit value window with Visual and Code in all four windows, and what was typed in Code is created', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const testName = await seed(page, request)
    // Per REQ-3.1.3.19: numbers are stored as their exact text, a list or map names each element's type.
    const lists = [
      {
        type: 'array',
        code: '[1, "two"]',
        stored: ['1', 'two'],
        elementTypes: ['integer', 'string'],
        visual: { 'array-edit-input-0': '1', 'array-edit-input-1': 'two' },
      },
      {
        type: 'map',
        code: '{"k": 5}',
        stored: { k: '5' },
        elementTypes: { k: 'integer' },
        visual: { 'map-edit-key-0': 'k', 'map-edit-value-0': '5' },
      },
      {
        type: 'table',
        code: '[{"id": 1, "name": "a"}]',
        // Per REQ-3.1.3.19: a table is stored with its column types.
        stored: {
          columns: [
            { name: 'id', type: 'integer' },
            { name: 'name', type: 'string' },
          ],
          rows: [['1', 'a']],
        },
        elementTypes: undefined,
        visual: { 'table-cell-0-0': '1', 'table-cell-0-1': 'a' },
      },
    ]

    for (const kind of ['variable', ...FUNCTION_WINDOWS] as WindowKind[]) {
      if (kind === 'local') await enterFunction(page)
      for (const list of lists) {
        await test.step(`the ${kind} window, ${list.type}`, async () => {
          const modal = await openWindow(page, kind)
          await setCreateName(page, `${list.type}_${kind}`, modal)
          await setCreateType(page, list.type, modal)
          // Per VMGR-110: the Visual / Code pickers live in the "Edit value" window.
          await insertCreateCode(page, list.code, modal)
          const sheet = await openValueEditor(page, modal)
          await setValueEditorView(page, sheet, 'Visual')
          for (const [testIdOf, text] of Object.entries(list.visual)) {
            await expect(control(sheet, testIdOf), `${testIdOf} shows what Code held`).toHaveValue(text)
          }
          await closeValueEditor(page, sheet)
          await submitCreate(page, modal)
          await expect(modal).toBeHidden()
          await expect(variableRow(page, `${list.type}_${kind}`)).toBeVisible()
        })
      }
    }

    await test.step('every list is stored typed', async () => {
      await popToBreadcrumbSegment(page, testName)
      await saveTest(page)
      for (const kind of ['variable', ...FUNCTION_WINDOWS] as WindowKind[]) {
        for (const list of lists) {
          const entry = await storedEntry(request, kind, `${list.type}_${kind}`)
          expect(entry.type, `${kind} ${list.type} type`).toBe(list.type)
          expect(entry[valueKey(kind)], `${kind} ${list.type} value`).toEqual(list.stored)
          expect(entry.elementTypes, `${kind} ${list.type} element types`).toEqual(list.elementTypes)
        }
      }
    })
  })

  test('the value field is one same-height line in all four windows, also when the window is resized', async ({
    page,
    request,
  }) => {
    // Tall enough that every window opens at its own height, with room to grow.
    await page.setViewportSize({ width: 1280, height: 1100 })
    await seed(page, request)
    const heights: number[] = []

    for (const kind of ['variable', ...FUNCTION_WINDOWS] as WindowKind[]) {
      if (kind === 'local') await enterFunction(page)
      for (const type of ['string', 'array']) {
        await test.step(`the ${kind} window, ${type}`, async () => {
          const modal = await openWindow(page, kind)
          if (type !== 'string') await setCreateType(page, type, modal)
          const field = modal.locator(LINE_FIELD)
          const windowBefore = (await modal.boundingBox())!.height
          const fieldBefore = (await field.boundingBox())!.height
          heights.push(fieldBefore)
          // A window at its floor only grows and one at the screen bottom only shrinks: try up, then down.
          for (const dy of [-96, 96]) {
            if (Math.abs((await modal.boundingBox())!.height - windowBefore) > 20) break
            const grip = (await control(modal, 'dialog-resize-corner').boundingBox())!
            await page.mouse.move(grip.x + 4, grip.y + 4)
            await page.mouse.down()
            await page.mouse.move(grip.x + 4, grip.y + 4 + dy, { steps: 8 })
            await page.mouse.up()
          }
          const windowDelta = (await modal.boundingBox())!.height - windowBefore
          const fieldDelta = (await field.boundingBox())!.height - fieldBefore
          expect(Math.abs(windowDelta), 'the window was resized').toBeGreaterThan(20)
          // Per VMGR-110: one same-height field per type.
          expect(Math.abs(fieldDelta), 'the value field keeps its height').toBeLessThanOrEqual(1)
          await cancelCreate(page, modal)
        })
      }
    }
    expect(Math.max(...heights) - Math.min(...heights), `every value field has one height: ${heights.join(', ')}`).toBeLessThanOrEqual(1)
  })

  for (const kind of ['variable', ...FUNCTION_WINDOWS] as WindowKind[]) {
    test(`the ${kind} window shows the whole value field of every type at its smallest size and on a short screen`, async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000)
      await seed(page, request)
      if (kind !== 'variable') await enterFunction(page)
      await checkEveryValueCell(page, kind)
    })
  }

  test('an input window opens with its String default field fully shown and nothing to scroll', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await seed(page, request)
    await enterFunction(page)
    const modal = await openWindow(page, 'input')
    const layout = await control(modal, 'create-value-area').evaluate((area) => {
      const form = area.parentElement as HTMLElement
      const editor = area.querySelector('[data-testid="window-value-field"] input') as HTMLElement
      const formRect = form.getBoundingClientRect()
      const editorRect = editor.getBoundingClientRect()
      return {
        overflow: form.scrollHeight - form.clientHeight,
        formTop: formRect.top,
        formBottom: formRect.bottom,
        editorTop: editorRect.top,
        editorBottom: editorRect.bottom,
        editorHeight: editorRect.height,
      }
    })
    expect(layout.overflow, 'the form has nothing to scroll').toBeLessThanOrEqual(1)
    expect(layout.editorTop).toBeGreaterThanOrEqual(layout.formTop)
    expect(layout.editorBottom, 'the String field is whole').toBeLessThanOrEqual(layout.formBottom)
    expect(layout.editorHeight, 'the String field keeps its full one-line height').toBeGreaterThanOrEqual(30)
    await fillCreateWindow(page, modal, 'opened_whole', { value: 'shown' })
    await submitCreate(page, modal)
    await expect(modal).toBeHidden()
    await expect(variableRow(page, 'opened_whole')).toBeVisible()
  })
})
