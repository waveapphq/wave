/**
 * V-VMGR-WIN-02: the variable window's value field, one face per type, kind and state
 * Design Decisions: VMGR-110, VMGR-111, FIELD-13
 * REQ: REQ-3.1.3.24, REQ-3.1.3.6
 *
 * Phase: no-data. Seed (API, POST /tests): one `zz-` Test holding one Test variable per face (String, Integer,
 * Boolean, Array, Map, Table, a null String, a secret String, an Integer expression) and one Log Block; each
 * test seeds its own Test, checks it validates with zero errors and deletes it afterwards. Every face is the
 * Edit window the variable's pencil opens. One test per theme: the dark project's theme, then the light theme
 * through the shell toggle.
 *
 * Pass Criteria (each face, in both themes):
 * 1. Every literal face is one 36 px field under `Value`, Type and Kind on one row above it; Type reads the type
 *    with its muted hint.
 * 2. String `hello`, Array `[1, 2, 3]` and Map `{}` are one-line monospace fields in their value colors with the
 *    icon-only Open editor button; Table `[{"host": "db-1", "port": 5432}, ...]` is the same, cut with "…".
 * 3. Integer `42` is a full-width box in the integer color with no Open editor button.
 * 4. Boolean is the 144 px `true` / `false` control with `true` pressed in filled indigo; no Open editor button.
 * 5. Set to null ticked: Kind is gone, Type stands alone at half width, `Set to null` reads ticked and the field
 *    reads `null` in the null look; the Open editor button stays, visually disabled.
 * 6. A saved secret: Mark as secret ticked; the field is the grayed masked control with the pencil and lock icons
 *    and eight dots in the muted gray; no Open editor button.
 * 7. An expression: Kind `Expression`; the expression box reads `n_int * 2` in the expression color; no Set to
 *    null row and no Open editor button.
 * 8. A screenshot of each face in each theme is attached.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { elementColor, resolvedColor } from '../../helpers/config-sheet'
import { createValidTest, logNode, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import { expectNullLook } from '../../helpers/null-look'
import { expectVisuallyDisabled } from '../../helpers/entry-editors'
import { toggleTheme } from '../../helpers/theme'
import { cancelWindow, openEditWindow, valueField, windowCheckbox } from '../../helpers/variable-create'
import { randomUUID } from 'node:crypto'

type Theme = 'dark' | 'light'

const TABLE_LINE = '[{"host": "db-1", "port": 5432}, {"host": "db-2", "port": 5433}]'
// The expression box's highlight color (cyan-400), the same in both themes.
const EXPRESSION_COLOR = '#22d3ee'

const VARIABLES: Record<string, Record<string, unknown>> = {
  s_str: { value: 'hello', type: 'string', scope: 'test' },
  n_int: { value: 42, type: 'integer', scope: 'test' },
  b_bool: { value: true, type: 'boolean', scope: 'test' },
  a_arr: { value: [1, 2, 3], type: 'array', scope: 'test' },
  m_map: { value: {}, type: 'map', scope: 'test' },
  t_tab: {
    value: [
      { host: 'db-1', port: 5432 },
      { host: 'db-2', port: 5433 },
    ],
    type: 'table',
    scope: 'test',
  },
  z_null: { value: null, type: 'string', scope: 'test' },
  sec: { value: 'hunter2-v4lue', type: 'string', scope: 'test', secret: true },
  e_expr: { value: 'n_int * 2', type: 'integer', scope: 'test', isExpression: true },
}

const control = (modal: Locator, id: string): Locator => modal.locator(`[data-testid="${id}"]`)
const openEditor = (modal: Locator): Locator => control(modal, 'open-value-editor-button')

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

const near = (actual: number, expected: number, what: string, tolerance = 1): void => {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance)
}

async function seed(request: APIRequestContext): Promise<string> {
  const testId = await createValidTest(request, {
    name: `zz-v-vmgr-window-02-${randomUUID().slice(0, 8)}`,
    nodes: [logNode('log-int', 'Log int', 'str(n_int)')],
    edges: [startEdge('log-int')],
    variables: VARIABLES,
  })
  const validation = await validateTest(request, testId)
  expect(validation.errors, 'the seeded Test validates with zero errors').toEqual([])
  return testId
}

/** An element's computed background color, as sRGB hex. */
function fillOf(target: Locator): Promise<string> {
  return target.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = getComputedStyle(el).backgroundColor
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  })
}

async function colorOf(page: Page, target: Locator, token: string, what: string): Promise<void> {
  expect(await elementColor(target, 'color'), what).toBe(await resolvedColor(page, token))
}

/** Type (with its muted hint) and, unless hidden, Kind on one row; the value field 36 px under `Value`. */
async function expectTypeRow(modal: Locator, type: string, hint: string, kind: string | null): Promise<void> {
  const page = modal.page()
  const typeSelect = control(modal, 'create-type-select')
  await expect(typeSelect).toContainText(type)
  await colorOf(page, typeSelect.getByText(hint, { exact: true }), 'var(--muted-foreground)', `the ${type} hint is muted`)
  const kindSelect = control(modal, 'create-kind-select')
  if (kind === null) {
    await expect(kindSelect, 'Kind is gone').toHaveCount(0)
    const nameBox = await box(control(modal, 'create-variable-name'), 'Name')
    near((await box(typeSelect, 'Type')).width, (nameBox.width - 12) / 2, 'Type stands alone at half width')
    return
  }
  await expect(kindSelect).toHaveText(kind)
  near((await box(kindSelect, 'Kind')).y, (await box(typeSelect, 'Type')).y, 'Kind sits beside Type')
}

/** A one-line text face: its exact text, monospace, its value color, 36 px, and the Open editor button. */
async function expectLineFace(modal: Locator, text: string, color: string): Promise<Locator> {
  const input = valueField(modal).locator('input')
  await expect(input).toHaveValue(text)
  near((await box(input, 'the value field')).height, 36, 'the value field height')
  expect(await input.evaluate((el) => getComputedStyle(el).fontFamily), 'the value is monospace').toMatch(/mono/i)
  await colorOf(modal.page(), input, color, `${text} takes its value color`)
  await expect(openEditor(modal)).toHaveAccessibleName('Open editor')
  await expect(openEditor(modal).locator('svg')).toHaveCount(1)
  return input
}

interface FaceCase {
  name: string
  title: string
  type: string
  hint: string
  kind: string | null
  check: (modal: Locator) => Promise<void>
}

const FACES: FaceCase[] = [
  {
    name: 's_str',
    title: 'String',
    type: 'String',
    hint: 'Text value',
    kind: 'Literal',
    check: async (modal) => {
      await expectLineFace(modal, 'hello', 'var(--color-sky-300)')
    },
  },
  {
    name: 'n_int',
    title: 'Integer',
    type: 'Integer',
    hint: 'Whole number',
    kind: 'Literal',
    check: async (modal) => {
      const input = control(modal, 'scalar-edit-input')
      await expect(input).toHaveValue('42')
      await colorOf(modal.page(), input, 'var(--color-violet-400)', '42 takes the integer color')
      const inputBox = await box(input, 'the number box')
      near(inputBox.height, 36, 'the number box height')
      near(inputBox.width, (await box(control(modal, 'create-variable-name'), 'Name')).width, 'the number box is full width')
      await expect(openEditor(modal), 'no Open editor for a number').toHaveCount(0)
    },
  },
  {
    name: 'b_bool',
    title: 'Boolean',
    type: 'Boolean',
    hint: 'True or false',
    kind: 'Literal',
    check: async (modal) => {
      const group = valueField(modal).locator('fieldset')
      const groupBox = await box(group, 'the true / false control')
      near(groupBox.width, 144, 'the true / false control width')
      near(groupBox.height, 36, 'the true / false control height')
      const yes = control(modal, 'scalar-edit-bool-true')
      const no = control(modal, 'scalar-edit-bool-false')
      await expect(yes).toHaveText('true')
      await expect(no).toHaveText('false')
      await expect(yes).toHaveAttribute('aria-pressed', 'true')
      await expect(no).toHaveAttribute('aria-pressed', 'false')
      expect(await fillOf(yes), '`true` is filled indigo').toBe(await resolvedColor(modal.page(), 'var(--color-indigo-600)'))
      expect((await box(yes, 'true')).x, '`true` comes first').toBeLessThan((await box(no, 'false')).x)
      await expect(openEditor(modal), 'no Open editor for a boolean').toHaveCount(0)
    },
  },
  {
    name: 'a_arr',
    title: 'Array',
    type: 'Array',
    hint: 'List of values',
    kind: 'Literal',
    check: async (modal) => {
      await expectLineFace(modal, '[1, 2, 3]', 'var(--color-amber-300)')
    },
  },
  {
    name: 'm_map',
    title: 'Map',
    type: 'Map',
    hint: 'Key-value pairs',
    kind: 'Literal',
    check: async (modal) => {
      await expectLineFace(modal, '{}', 'var(--color-emerald-400)')
    },
  },
  {
    name: 't_tab',
    title: 'Table',
    type: 'Table',
    hint: 'Tabular data',
    kind: 'Literal',
    check: async (modal) => {
      const input = await expectLineFace(modal, TABLE_LINE, 'var(--color-blue-500)')
      const cut = await input.evaluate((el) => ({
        overflow: getComputedStyle(el).textOverflow,
        wider: el.scrollWidth > el.clientWidth,
      }))
      expect(cut, 'the table line is cut with "…"').toEqual({ overflow: 'ellipsis', wider: true })
    },
  },
  {
    name: 'z_null',
    title: 'Set to null',
    type: 'String',
    hint: 'Text value',
    kind: null,
    check: async (modal) => {
      const setNull = windowCheckbox(modal, 'set-to-null')
      await expect(setNull).toHaveAttribute('data-state', 'checked')
      await expect(setNull).toBeEnabled()
      const nullField = control(modal, 'create-null-field')
      await expectNullLook(nullField, 'the null face')
      near((await box(nullField, 'the null field')).height, 36, 'the null field height')
      // FIELD-13: a null String keeps its Open editor in place, visually disabled, so the field keeps its width.
      await expect(openEditor(modal), 'Open editor stays for null').toHaveCount(1)
      await expectVisuallyDisabled(openEditor(modal), 'Open editor on null')
    },
  },
  {
    name: 'sec',
    title: 'Secret',
    type: 'String',
    hint: 'Text value',
    kind: 'Literal',
    check: async (modal) => {
      await expect(windowCheckbox(modal, 'secret')).toHaveAttribute('data-state', 'checked')
      const masked = valueField(modal).getByRole('button', { name: 'Value: Edit protected value', exact: true })
      await expect(masked).toHaveText('••••••••')
      await expect(masked.locator('svg.lucide-pencil')).toHaveCount(1)
      await expect(masked.locator('svg.lucide-lock')).toHaveCount(1)
      near((await box(masked, 'the masked field')).height, 36, 'the masked field height')
      expect(await fillOf(masked), 'the masked field is grayed').toBe(
        await resolvedColor(modal.page(), 'var(--color-bg-subtle)'),
      )
      // Soft, so the faces after it are still checked: the dots and icons are drawn in the muted gray.
      expect
        .soft(await elementColor(masked, 'color'), 'the dots and icons are muted gray')
        .toBe(await resolvedColor(modal.page(), 'var(--muted-foreground)'))
      await expect(openEditor(modal), 'no Open editor for a secret').toHaveCount(0)
    },
  },
  {
    name: 'e_expr',
    title: 'Expression',
    type: 'Integer',
    hint: 'Whole number',
    kind: 'Expression',
    check: async (modal) => {
      const source = valueField(modal).locator('.cm-content')
      await expect(source).toHaveText('n_int * 2')
      expect(await elementColor(valueField(modal).locator('.cm-expression').first(), 'color'), 'the expression color').toBe(
        EXPRESSION_COLOR,
      )
      await expect(windowCheckbox(modal, 'set-to-null'), 'an expression has no Set to null').toHaveCount(0)
      await expect(openEditor(modal), 'no Open editor for an expression').toHaveCount(0)
    },
  },
]

async function checkFace(page: Page, face: FaceCase, theme: Theme, testInfo: TestInfo): Promise<void> {
  const modal = await openEditWindow(page, face.name)
  await expect(modal.getByText('Edit variable', { exact: true })).toBeVisible()
  await expect(control(modal, 'create-variable-name')).toHaveValue(face.name)
  await expectTypeRow(modal, face.type, face.hint, face.kind)
  await expect(modal.locator('label').filter({ hasText: /^Value$/ })).toBeVisible()
  await face.check(modal)
  await testInfo.attach(`${face.title.toLowerCase().replaceAll(' ', '-')}-${theme}.png`, {
    body: await modal.screenshot(),
    contentType: 'image/png',
  })
  // Opening a window changes nothing, so Cancel closes it at once.
  await cancelWindow(page, modal)
}

test.describe('V-VMGR-WIN-02: the value field faces', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  for (const theme of ['dark', 'light'] as const) {
    test(`every face of the value field in the ${theme} theme`, async ({ page, request }, testInfo) => {
      testId = await seed(request)
      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const face of FACES) {
        await test.step(`${face.title} face`, () => checkFace(page, face, theme, testInfo))
      }
    })
  }
})
