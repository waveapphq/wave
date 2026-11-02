/**
 * V-ENTRY-LOOK-BOXES: the row boxes of the list, map and table editors, the null button inside them, the disabled
 * expand of a null entry, and the 32 px Browse and Parts buttons
 * Design Decisions: FIELD-1, FIELD-5, FIELD-10, FIELD-13, VMGR-93
 * REQ: REQ-3.1.1.5, REQ-3.1.3.19, REQ-3.1.3.20
 *
 * Phase: functional-workflow. Each test imports `fixture-look-boxes.json` under a `zz-11541-s6a-` name, proves it
 * validates with zero errors and deletes it afterwards. Every look check runs in both themes.
 *
 * Pass Criteria:
 * 1. Map editor (HTTP Headers, Visual): the Key box, the literal value box, the null value box and the {x} value
 *    box are each 32 px tall; the Value box is 1.4 times as wide as the Key box (1.35 to 1.45) and the {x} box is
 *    as wide as the other value boxes.
 * 2. List editor (Retryable Codes, Visual): the literal, the null and the {x} item boxes are each 32 px tall.
 * 3. In the map, list and table editors the null button lies inside its value box at the right end, after the
 *    entry's control; a null entry reads `null` in the null look with its null button pressed; a literal entry's
 *    null button is not pressed; an {x} entry has no null button.
 * 4. Table editor (grid): with the pointer away, every cell shows its null button, not dimmed.
 * 5. A null text entry (Headers `X-Null`, nest `t`, items 0) and a null List or Map entry (nest `l` and `m`,
 *    items 1 and 2) keep their expand, disabled: opacity 0.5, the not-allowed cursor, and a click opens no
 *    editor; the text entry beside them keeps a live expand.
 * 6. The variable window's value field of a String, an Array, a Map and a Table keeps its Open editor drawn and
 *    disabled while Set to null is ticked, and live again once it is cleared.
 * 7. File I/O's path Browse is 32 x 32, centered on the path field and the size of the row's expand and {x}; in the
 *    Parts editor Browse and Remove are 32 x 32, the name, value and source boxes 32 px tall, and the text part row
 *    and the file part row are one height.
 * 8. Clicking a literal map entry's null button presses it and shows the null chip; the Block Save and the Test
 *    Save store that entry as null (GET /tests/{id}/workflow).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTest, getNode, readFixture } from '../../helpers/element-types'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import { browseButton, paramRow } from '../../helpers/config-sheet'
import { expectNullLook } from '../../helpers/null-look'
import {
  cancelCreate,
  openCreateModal,
  setCreateType,
  setWindowCheckbox,
  valueField,
  closeValueEditor,
  saveValueEditor,
} from '../../helpers/variable-create'
import {
  closeBlockSheet,
  closeVariableWindow,
  expandGroup,
  expectInside,
  expectVisuallyDisabled,
  inBothThemes,
  listItem,
  mapEntry,
  openBlockEditor,
  openPartsEditor,
  openVariableEditor,
  parkPointer,
  partRow,
  rectOf,
  tableCell,
  valueSheets,
  type EntryParts,
  type Rect,
} from '../../helpers/entry-editors'

const FIXTURE = 'fixture-look-boxes.json'
const HTTP_LOOK = 'ab168a03-f9b6-4415-a870-6cdf3419465c'
const HTTP_PARTS = '97748132-9c8d-4742-b613-d2a5863a1c8f'
const FILE_IO = 'fa30b7f2-6773-4b3c-827d-48e6376e4d8f'

const ROW_BOX_PX = 32
const PX = 0.5

function expectHeight(rect: Rect, px: number, what: string): void {
  expect(Math.abs(rect.height - px), `${what} is ${px} px tall (reads ${rect.height})`).toBeLessThanOrEqual(PX)
}

function expectSquare(rect: Rect, px: number, what: string): void {
  expectHeight(rect, px, what)
  expect(Math.abs(rect.width - px), `${what} is ${px} px wide (reads ${rect.width})`).toBeLessThanOrEqual(PX)
}

/** FIELD-13: the null button sits inside the value box at its right end, after the entry's control. */
async function expectNullButtonInside(box: Locator, control: Locator, nullButton: Locator, what: string): Promise<void> {
  const outer = await rectOf(box, `${what} value box`)
  const button = await rectOf(nullButton, `${what} null button`)
  expectInside(button, outer, `${what}: the null button lies inside the value box`)
  const rightGap = outer.x + outer.width - (button.x + button.width)
  expect(rightGap, `${what}: the null button sits at the box's right end (gap ${rightGap})`).toBeLessThanOrEqual(8)
  const inner = await rectOf(control, `${what} control`)
  expect(inner.x + inner.width, `${what}: the control ends before the null button`).toBeLessThanOrEqual(button.x + PX)
}

/** A null entry: the chip reads `null` in the null look and its null button is pressed (FIELD-5, VMGR-93). */
async function expectNullEntry(entry: EntryParts, what: string): Promise<void> {
  await expectNullLook(entry.nullChip, `${what} null chip`)
  await expect(entry.nullButton, `${what}: the null button is pressed`).toHaveAttribute('aria-pressed', 'true')
  await expectNullButtonInside(entry.valueBox, entry.nullChip, entry.nullButton, what)
}

/** A disabled expand takes no click: no editor opens. */
async function expectNoEditorFrom(page: Page, expand: Locator, what: string): Promise<void> {
  await expectVisuallyDisabled(expand, `${what} expand`)
  const before = await valueSheets(page).count()
  await expand.click({ force: true })
  // Proving a negative: an editor opened by the click mounts within a frame or two.
  await page.waitForTimeout(400)
  await expect(valueSheets(page), `${what}: a click on the disabled expand opens no editor`).toHaveCount(before)
}

/** Entries 0, 1 and 2 of a map or list: a literal, a null and an {x} entry, each one 32 px row box. */
async function expectRowBoxes(entries: EntryParts[], what: string): Promise<Rect[]> {
  const [literal, nulled, expression] = entries
  const boxes = [
    await rectOf(literal.valueBox, `${what} literal value box`),
    await rectOf(nulled.valueBox, `${what} null value box`),
    await rectOf(expression.exprBox, `${what} {x} value box`),
  ]
  boxes.forEach((box, index) => expectHeight(box, ROW_BOX_PX, `${what} ${['literal', 'null', '{x}'][index]} value box`))
  return boxes
}

async function checkHeadersEditor(page: Page, sheet: Locator): Promise<void> {
  const editor = await openBlockEditor(page, sheet, 'headers')
  const entries = [0, 1, 2].map((index) => mapEntry(editor, index))
  await expect(entries[0].keyInput).toHaveValue('X-Lit')
  await expect(entries[1].keyInput).toHaveValue('X-Null')
  await expect(entries[2].keyInput).toHaveValue('X-Expr')
  await expect(entries[2].exprToggle, 'X-Expr is held as {x}').toHaveAttribute('aria-pressed', 'true')

  const [literal, , expression] = await expectRowBoxes(entries, 'Headers')
  const key = await rectOf(entries[0].keyBox, 'Headers key box')
  expectHeight(key, ROW_BOX_PX, 'Headers key box')
  const ratio = literal.width / key.width
  expect(ratio, `Headers: the Value box is 1.4 times the Key box (reads ${ratio.toFixed(3)})`).toBeGreaterThanOrEqual(1.35)
  expect(ratio).toBeLessThanOrEqual(1.45)
  expect(Math.abs(expression.width - literal.width), 'Headers: the {x} box is as wide as a value box').toBeLessThanOrEqual(1)

  await expect(entries[0].nullButton, 'X-Lit: the null button is not pressed').toHaveAttribute('aria-pressed', 'false')
  await expectNullButtonInside(entries[0].valueBox, entries[0].valueInput, entries[0].nullButton, 'Headers X-Lit')
  await expectNullEntry(entries[1], 'Headers X-Null')
  await expect(entries[2].nullButton, 'X-Expr: an {x} entry has no null button').toHaveCount(0)

  await expect(entries[0].expand, 'X-Lit: a text entry keeps a live expand').toBeEnabled()
  await expectNoEditorFrom(page, entries[1].expand, 'Headers X-Null')
  await closeValueEditor(page, editor)
}

async function checkRetryableCodesEditor(page: Page, sheet: Locator): Promise<void> {
  await expandGroup(sheet, 'Timeouts & Retries')
  const editor = await openBlockEditor(page, sheet, 'retryable_status_codes')
  const items = [0, 1, 2].map((index) => listItem(editor, index))
  await expect(items[0].valueInput).toHaveValue('429')
  await expect(items[2].exprToggle, 'item 2 is held as {x}').toHaveAttribute('aria-pressed', 'true')
  await expectRowBoxes(items, 'Retryable Codes')
  await expect(items[0].nullButton).toHaveAttribute('aria-pressed', 'false')
  await expectNullButtonInside(items[0].valueBox, items[0].valueInput, items[0].nullButton, 'Retryable Codes item 0')
  await expectNullEntry(items[1], 'Retryable Codes item 1')
  await expect(items[2].nullButton, 'item 2: an {x} item has no null button').toHaveCount(0)
  await expectNoEditorFrom(page, items[1].expand, 'Retryable Codes item 1')
  await closeValueEditor(page, editor)
}

test.describe('V-ENTRY-LOOK-BOXES: entry row boxes, null buttons and disabled expands', () => {
  test('map and list editors of a Block draw every row part as one 32 px box with the null button inside', async ({
    page,
  }) => {
    let testId = ''
    try {
      testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
      await inBothThemes(page, async () => {
        const sheet = await openBlockSheet(page, HTTP_LOOK)
        await checkHeadersEditor(page, sheet)
        await checkRetryableCodesEditor(page, sheet)
        await closeBlockSheet(sheet)
      })
    } finally {
      if (testId) await deleteTest(page.request, testId)
    }
  })

  test('table cells show the null button at rest; null text, List and Map entries keep a disabled expand', async ({
    page,
  }) => {
    let testId = ''
    try {
      testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
      await inBothThemes(page, async () => {
        const grid = await openVariableEditor(page, 'grid')
        await parkPointer(page)
        for (const [row, column] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
          const cell = tableCell(grid, row, column)
          const what = `grid cell ${row},${column}`
          await expect(cell.nullButton, `${what}: the null button shows without hover`).toBeVisible()
          const shown = await cell.nullButton.evaluate((el) => {
            let opacity = 1
            for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
            return { opacity, visibility: getComputedStyle(el).visibility }
          })
          expect(shown, `${what}: the null button is drawn at rest, not dimmed`).toEqual({ opacity: 1, visibility: 'visible' })
          await expectNullButtonInside(cell.box, cell.control, cell.nullButton, what)
          expectHeight(await rectOf(cell.box, `${what} box`), ROW_BOX_PX, `${what} box`)
        }
        await expectNullLook(tableCell(grid, 0, 1).control, 'grid cell 0,1')
        await expect(tableCell(grid, 0, 1).nullButton).toHaveAttribute('aria-pressed', 'true')
        await expect(tableCell(grid, 0, 0).nullButton).toHaveAttribute('aria-pressed', 'false')
        await closeValueEditor(page, grid)
        await closeVariableWindow(page, 'grid')

        const nest = await openVariableEditor(page, 'nest')
        const entries = [0, 1, 2, 3].map((index) => mapEntry(nest, index))
        for (const [index, key] of ['t', 'l', 'm', 's'].entries()) await expect(entries[index].keyInput).toHaveValue(key)
        for (const [index, kind] of ['text', 'List', 'Map'].entries()) {
          await expectNullEntry(entries[index], `nest null ${kind} entry`)
          expectHeight(await rectOf(entries[index].valueBox, `nest ${kind} value box`), ROW_BOX_PX, `nest ${kind} value box`)
          await expectNoEditorFrom(page, entries[index].expand, `nest null ${kind} entry`)
        }
        await expect(entries[3].expand, 'nest s: a text entry keeps a live expand').toBeEnabled()
        await closeValueEditor(page, nest)
        await closeVariableWindow(page, 'nest')

        const items = await openVariableEditor(page, 'items')
        const rows = [0, 1, 2, 3].map((index) => listItem(items, index))
        for (const [index, kind] of ['text', 'List', 'Map'].entries()) {
          await expectNullEntry(rows[index], `items null ${kind} item`)
          await expectNoEditorFrom(page, rows[index].expand, `items null ${kind} item`)
        }
        await expect(rows[3].expand, 'items 3: a text item keeps a live expand').toBeEnabled()
        await closeValueEditor(page, items)
        await closeVariableWindow(page, 'items')
      })
    } finally {
      if (testId) await deleteTest(page.request, testId)
    }
  })

  test('Set to null keeps the Open editor of a String, Array, Map and Table value drawn and disabled', async ({
    page,
  }) => {
    let testId = ''
    try {
      testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
      await inBothThemes(page, async () => {
        const win = await openCreateModal(page)
        const openEditor = valueField(win).locator('[data-testid="open-value-editor-button"]')
        for (const type of ['String', 'Array', 'Map', 'Table']) {
          await setCreateType(page, type, win)
          await expect(openEditor, `${type}: Open editor is live before Set to null`).toBeEnabled()
          await setWindowCheckbox(win, 'set-to-null', true)
          await expect(win.locator('[data-testid="create-null-field"]'), `${type}: the value reads null`).toBeVisible()
          await expectVisuallyDisabled(openEditor, `${type} Open editor while Set to null is ticked`)
          await setWindowCheckbox(win, 'set-to-null', false)
          await expect(openEditor, `${type}: Open editor is live again once Set to null is cleared`).toBeEnabled()
        }
        await cancelCreate(page, win)
      })
    } finally {
      if (testId) await deleteTest(page.request, testId)
    }
  })

  test('Browse, the Parts Browse and Remove are 32 px and a text part row is as tall as a file part row', async ({
    page,
  }) => {
    let testId = ''
    try {
      testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
      await inBothThemes(page, async () => {
        const fileSheet = await openBlockSheet(page, FILE_IO)
        const browse = await rectOf(browseButton(fileSheet, 'path'), 'File I/O path Browse')
        expectSquare(browse, ROW_BOX_PX, 'File I/O path Browse')
        const field = await rectOf(paramRow(fileSheet, 'path').locator('[data-slot="input-group"]').first(), 'path field')
        const fieldMiddle = field.y + field.height / 2
        const browseMiddle = browse.y + browse.height / 2
        expect(Math.abs(fieldMiddle - browseMiddle), 'Browse sits on the path field, centered on it').toBeLessThanOrEqual(1)
        for (const [what, icon] of [
          ['expand', paramRow(fileSheet, 'path').locator('[data-testid="param-expand-path"]')],
          ['{x}', paramRow(fileSheet, 'path').locator('[data-slot="expression-toggle"]')],
        ] as const) {
          const box = await rectOf(icon, `path ${what}`)
          expectSquare(box, browse.height, `path ${what}, the size of Browse`)
        }
        await closeBlockSheet(fileSheet)

        const httpSheet = await openBlockSheet(page, HTTP_PARTS)
        await expandGroup(httpSheet, 'Body')
        const parts = await openPartsEditor(page, httpSheet)
        const text = partRow(parts, 0)
        const file = partRow(parts, 1)
        await expect(text.kind).toHaveText('Text')
        await expect(file.kind).toHaveText('File')
        await expect(text.browse, 'a text part has no Browse').toHaveCount(0)
        expectSquare(await rectOf(file.browse, 'file part Browse'), ROW_BOX_PX, 'file part Browse')
        expectSquare(await rectOf(text.remove, 'text part Remove'), ROW_BOX_PX, 'text part Remove')
        expectSquare(await rectOf(file.remove, 'file part Remove'), ROW_BOX_PX, 'file part Remove')
        for (const [what, box] of [
          ['text part name', text.name],
          ['text part value', text.value],
          ['file part name', file.name],
          ['file part source', file.source],
        ] as const) {
          expectHeight(await rectOf(box, what), ROW_BOX_PX, what)
        }
        // The row inside its divider: the last row draws no bottom divider.
        const inner = (row: Locator) => row.evaluate((el) => el.clientHeight)
        const [textRow, fileRow] = [await inner(text.row), await inner(file.row)]
        expect(textRow, 'the text part row holds its 32 px boxes').toBeGreaterThanOrEqual(ROW_BOX_PX)
        expect(Math.abs(textRow - fileRow), `a text part row (${textRow}) is as tall as a file part row (${fileRow})`).toBeLessThanOrEqual(PX)
        await parts.locator('[data-testid="parts-editor-cancel-button"]').click()
        await expect(parts).toBeHidden()
        await closeBlockSheet(httpSheet)
      })
    } finally {
      if (testId) await deleteTest(page.request, testId)
    }
  })

  test('a literal entry set to null through its null button is stored as null', async ({ page }) => {
    let testId = ''
    try {
      testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
      const sheet = await openBlockSheet(page, HTTP_LOOK)
      const editor = await openBlockEditor(page, sheet, 'headers')
      const literal = mapEntry(editor, 0)
      await expect(literal.keyInput).toHaveValue('X-Lit')
      await literal.nullButton.click()
      await expect(literal.nullButton, 'the null button reads pressed').toHaveAttribute('aria-pressed', 'true')
      await expectNullLook(literal.nullChip, 'X-Lit null chip')
      await expectNullButtonInside(literal.valueBox, literal.nullChip, literal.nullButton, 'Headers X-Lit')
      await saveValueEditor(editor)
      await closeValueEditor(page, editor)
      await saveBlockSheet(sheet)
      await saveTest(page)
      const node = await getNode(page.request, testId, HTTP_LOOK)
      expect(node.data.config.values.headers, 'X-Lit is stored as null, the other entries as they were').toEqual({
        'X-Lit': null,
        'X-Null': null,
        'X-Expr': 'suffix',
      })
      expect(node.data.expressionFields).toContain('headers.X-Expr')
    } finally {
      if (testId) await deleteTest(page.request, testId)
    }
  })
})
