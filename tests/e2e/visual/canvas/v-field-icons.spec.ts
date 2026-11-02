/**
 * V-FIELD-ICONS: one meaning per icon - Inspect, the window full-size button and the field expand
 * Design Decisions: FIELD-11, FIELD-1, FIELD-13
 * REQ: REQ-3.1.3.11, REQ-3.1.3.19
 *
 * Phase: no-data. Seed (API, POST /tests): one `zz-11541-s1-` Test holding the String variable `run_id` (`r-42`),
 * the List variable `hosts` (`["alpha"]`), a Log Block that reads both and a Python Block with a one-line script;
 * each test seeds its own Test, checks it validates with zero errors and deletes it afterwards.
 * One test per theme: the dark project's theme, then the light theme through the shell toggle.
 *
 * Pass Criteria (in both themes):
 * 1. The Variable Manager row `run_id` shows `r-42` in the string color with the `STRING` badge, and its icons
 *    left to right: eye, magnifying glass (`Inspect run_id`), pencil, trash; no field-expand arrows on the row.
 * 2. The Edit value sheet of `hosts` reads `Edit value` with the `ARRAY` badge and the close X; its row `0` holds
 *    `alpha` in the string color with its ∅ inside the row box (not pressed), then the field expand (two diagonal
 *    arrows), the `string` type pill, move up / move down and the trash, left to right.
 * 3. The Python Script editor sheet's full-size button is the four-corner frame at the header's right end, after
 *    the close X; a click fills the window and shows four inward corners (pressed); a second click takes the
 *    sheet back to its size and the four-corner frame.
 * 4. A screenshot of the row, the Edit value sheet and the script sheet in each theme is attached.
 */

import { test, expect, type APIRequestContext, type Locator, type Page, type TestInfo } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { elementColor, resolvedColor } from '../../helpers/config-sheet'
import { createValidTest, logNode, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import { toggleTheme } from '../../helpers/theme'
import {
  cancelCreate,
  closeValueEditor,
  expandVariableManager,
  openEditWindow,
  openValueEditor,
  variableRow,
} from '../../helpers/variable-create'
import { openBlockSheet } from '../../helpers/workbench'
import { expandButton } from '../../helpers/value-field'
import { randomUUID } from 'node:crypto'

type Theme = 'dark' | 'light'

const PYTHON_ID = 'python-icons'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

async function box(target: Locator, what: string): Promise<Rect> {
  const found = await target.boundingBox()
  expect(found, `${what} has a box`).not.toBeNull()
  return found!
}

const near = (actual: number, expected: number, what: string, tolerance = 2): void => {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance)
}

function pythonNode(): Record<string, unknown> {
  return {
    id: PYTHON_ID,
    type: 'workflowNode',
    position: { x: 200, y: 360 },
    data: {
      label: 'Python',
      elementType: 'python',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: '',
      expressionFields: [],
      templateFields: [],
      config: {
        values: { script_type: 'source', script: 'print("ready")' },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

async function seed(request: APIRequestContext): Promise<string> {
  const testId = await createValidTest(request, {
    name: `zz-11541-s1-icons-${randomUUID().slice(0, 8)}`,
    nodes: [logNode('log-ids', 'Log ids', 'run_id + str(hosts)'), pythonNode()],
    edges: [startEdge('log-ids'), { id: 'e-log-python', source: 'log-ids', target: PYTHON_ID }],
    variables: {
      run_id: { value: 'r-42', type: 'string', scope: 'test' },
      hosts: { value: ['alpha'], type: 'array', scope: 'test' },
    },
  })
  const validation = await validateTest(request, testId)
  expect(validation.errors, 'the seeded Test validates with zero errors').toEqual([])
  return testId
}

async function attach(testInfo: TestInfo, name: string, target: Locator): Promise<void> {
  await testInfo.attach(name, { body: await target.screenshot(), contentType: 'image/png' })
}

/** Criterion 1: the Variable Manager row and its four icons; Inspect is the magnifying glass (FIELD-11). */
async function expectVariableRow(page: Page, testInfo: TestInfo, theme: Theme): Promise<void> {
  await expandVariableManager(page)
  const row = variableRow(page, 'run_id')
  await expect(row).toBeVisible()
  const value = row.locator('[data-testid^="variable-value-"]')
  await expect(value).toHaveText('r-42')
  expect(await elementColor(value, 'color'), 'r-42 takes the string color').toBe(
    await resolvedColor(page, 'var(--color-sky-300)'),
  )
  await expect(row.locator('[data-testid^="type-badge-"]')).toHaveText('STRING', { useInnerText: true })

  const icons = row.locator('button[data-testid]')
  await expect(icons).toHaveCount(4)
  const glyphs = await icons.evaluateAll((buttons) =>
    buttons.map((button) => {
      const svg = button.querySelector('svg')
      const lucide = Array.from(svg?.classList ?? []).find((name) => name.startsWith('lucide-') && name !== 'lucide-icon')
      return lucide ?? ''
    }),
  )
  expect(glyphs[0], 'the eye comes first').toMatch(/^lucide-eye/)
  expect(glyphs.slice(1), 'magnifying glass, pencil, trash').toEqual([
    'lucide-search',
    expect.stringMatching(/^lucide-pencil/),
    expect.stringMatching(/^lucide-trash/),
  ])
  const inspect = row.locator('[data-testid^="expand-button-"]')
  await expect(inspect).toHaveAccessibleName('Inspect run_id')
  await expect(inspect.locator('svg.lucide-search')).toHaveCount(1)
  await expect(row.locator('svg.lucide-maximize-2'), 'the field expand arrows never mean Inspect').toHaveCount(0)
  const boxes = await Promise.all([0, 1, 2, 3].map((index) => box(icons.nth(index), `icon ${index}`)))
  for (const index of [1, 2, 3]) {
    expect(boxes[index].x, 'the icons run left to right').toBeGreaterThan(boxes[index - 1].x)
  }
  await attach(testInfo, `field-icons-row-${theme}.png`, row)
}

/** Criterion 2: the list editor row and its field expand (FIELD-11, FIELD-13). */
async function expectListEditor(page: Page, testInfo: TestInfo, theme: Theme): Promise<void> {
  const win = await openEditWindow(page, 'hosts')
  const sheet = await openValueEditor(page, win)
  await expect(sheet.locator('h2')).toHaveText('Edit value')
  await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toHaveText('ARRAY', { useInnerText: true })
  const close = sheet.getByRole('button', { name: 'Close value editor', exact: true })
  await expect(close.locator('svg.lucide-x')).toHaveCount(1)

  await expect(sheet.locator('[data-testid="array-edit-index"]')).toHaveText(['0'])
  const input = sheet.locator('[data-testid="array-edit-input-0"]')
  await expect(input).toHaveValue('alpha')
  expect(await elementColor(input, 'color'), 'alpha takes the string color').toBe(
    await resolvedColor(page, 'var(--color-sky-300)'),
  )
  const empty = sheet.locator('[data-testid="array-edit-input-0-null"]')
  await expect(empty, 'each list row keeps its ∅').toHaveText('∅')
  await expect(empty).toHaveAttribute('aria-pressed', 'false')
  const expand = sheet.locator('[data-testid="array-expand-0"]')
  await expect(expand).toHaveAccessibleName('Open editor for Item 0')
  await expect(expand.locator('svg.lucide-maximize-2'), 'two diagonal arrows').toHaveCount(1)
  const typePill = sheet.locator('[data-testid="array-type-0"]')
  await expect(typePill).toContainText('string')
  const up = sheet.locator('[data-testid="array-move-up-0"]')
  const down = sheet.locator('[data-testid="array-move-down-0"]')
  const trash = sheet.locator('[data-testid="array-remove-0"]')

  const rowBox = await box(input.locator('xpath=ancestor::*[@data-slot="input-group"][1]'), 'the row box')
  const emptyBox = await box(empty, 'the ∅')
  expect(emptyBox.x, 'the ∅ sits inside the row box').toBeGreaterThan(rowBox.x)
  expect(emptyBox.x + emptyBox.width, 'the ∅ sits inside the row box').toBeLessThanOrEqual(rowBox.x + rowBox.width)
  const order = [
    ['the row box', rowBox],
    ['the expand', await box(expand, 'the expand')],
    ['the type pill', await box(typePill, 'the type pill')],
    ['move up', await box(up, 'move up')],
    ['move down', await box(down, 'move down')],
    ['the trash', await box(trash, 'the trash')],
  ] as const
  for (let index = 1; index < order.length; index += 1) {
    const [prevName, prev] = order[index - 1]
    const [name, next] = order[index]
    expect(next.x, `${name} sits right of ${prevName}`).toBeGreaterThanOrEqual(prev.x + prev.width - 1)
    near(next.y + next.height / 2, rowBox.y + rowBox.height / 2, `${name} shares the row`, 3)
  }
  await attach(testInfo, `field-icons-list-editor-${theme}.png`, sheet)
  await closeValueEditor(page, sheet)
  await cancelCreate(page, win)
}

/** Criterion 3: the four-corner full-size button of a script editor sheet, and its four inward corners (FIELD-11). */
async function expectFullSize(page: Page, testInfo: TestInfo, theme: Theme): Promise<void> {
  const config = await openBlockSheet(page, PYTHON_ID)
  await expandButton(config, 'script').click()
  const sheet = page.locator('[data-testid="value-editor-sheet"]')
  await expect(sheet).toBeVisible()
  const full = sheet.getByRole('button', { name: 'Maximize', exact: true })
  await expect(full).toHaveAttribute('aria-pressed', 'false')
  await expect(full.locator('svg.lucide-maximize'), 'the four-corner frame').toHaveCount(1)
  await expect(full.locator('svg.lucide-maximize-2'), 'never the field expand arrows').toHaveCount(0)
  const close = sheet.getByRole('button', { name: 'Close value editor', exact: true })
  const before = await box(sheet, 'the sheet')
  const fullBox = await box(full, 'the full-size button')
  expect(fullBox.x, 'the full-size button comes after the close X').toBeGreaterThanOrEqual(
    (await box(close, 'the close X')).x + 1,
  )
  expect(before.x + before.width - (fullBox.x + fullBox.width), 'it sits at the header right end').toBeLessThanOrEqual(24)
  await attach(testInfo, `field-icons-script-sheet-${theme}.png`, sheet)

  await full.click()
  await expect(full).toHaveAttribute('aria-pressed', 'true')
  await expect(full.locator('svg.lucide-minimize'), 'four inward corners').toHaveCount(1)
  await expect(full.locator('svg.lucide-maximize')).toHaveCount(0)
  const viewport = page.viewportSize()!
  await expect
    .poll(async () => (await box(sheet, 'the sheet')).height, { message: 'the sheet fills the window height' })
    .toBeGreaterThanOrEqual(viewport.height - 2)
  expect((await box(sheet, 'the sheet')).width, 'the sheet fills the window width').toBeGreaterThanOrEqual(
    Math.min(viewport.width, viewport.width * 0.9) - 2,
  )

  await full.click()
  await expect(full).toHaveAttribute('aria-pressed', 'false')
  await expect(full.locator('svg.lucide-maximize'), 'back to the four-corner frame').toHaveCount(1)
  await expect.poll(async () => (await box(sheet, 'the sheet')).width).toBeLessThanOrEqual(before.width + 2)
  const after = await box(sheet, 'the sheet')
  near(after.width, before.width, 'the width comes back')
  near(after.height, before.height, 'the height comes back')

  await closeValueEditor(page, sheet)
  await config.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(config).toHaveCount(0)
}

test.describe('V-FIELD-ICONS: one meaning per icon', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
    test(`Inspect, full size and expand in the ${theme} theme`, async ({ page, request }, testInfo) => {
      testId = await seed(request)
      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      await test.step('Variable Manager row', () => expectVariableRow(page, testInfo, theme))
      await test.step('list editor row', () => expectListEditor(page, testInfo, theme))
      await test.step('script sheet full size', () => expectFullSize(page, testInfo, theme))
    })
  }
})
