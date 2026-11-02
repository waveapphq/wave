/**
 * V-VMGR-CREATE-02: the creation windows with Set to null ticked
 * Design Decisions: VMGR-97, VMGR-98, VMGR-93, FIELD-13
 * REQ: REQ-3.1.3.24, REQ-3.1.3.11
 *
 * Seed (API, POST /tests): a `zz-` Test holding one Local Function `fn1` with one inner Log, the
 * shape V-VMGR-CREATE-01 seeds. The windows are opened from the Variable Manager; nothing is
 * created. The Test is deleted afterwards.
 *
 * Phase: no-data (seeds and deletes its own Test, no run).
 *
 * Pass Criteria:
 * 1. In the Variable, Function local, Input and Output windows a ticked Set to null hides Kind and
 *    the one-line value field and keeps its Open editor button, disabled (visually disabled, no click);
 *    the Type select keeps its half width;
 *    Set to null sits right under Mark as secret and one `null` field in the null look sits under
 *    it; the footer keeps Cancel and Create, and Create is enabled.
 * 2. Switching the Type while ticked keeps the tick and the one `null` field, with Open editor still
 *    disabled (Array, as drawn).
 * 3. Ticked, a window opens at one height whatever the type (an input: per its rows, as Create enum
 *    shows on String and Integer only), never taller than the same window holding its value, inside
 *    the screen, with the `null` field and Create in view and nothing to scroll to; unticked, it
 *    returns to the height it had before the tick.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { expectVisuallyDisabled } from '../../helpers/entry-editors'
import { BACKEND_URL } from '../../helpers/config'
import { createValidTest, localFunctionNode, logNode, openTest, startEdge } from '../../helpers/fn-seed'
import { expectNullLook } from '../../helpers/null-look'
import {
  cancelCreate,
  createNullField,
  expandVariableManager,
  openCreateModal,
  openFunctionCreateModal,
  setCreateName,
  setCreateType,
  setToNull,
  setToNullCheckbox,
  valueField,
} from '../../helpers/variable-create'
import { breadcrumbFunctionSegments, digIn } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const FN_ID = 'fn1'

type WindowKind = 'variable' | 'local' | 'input' | 'output'

const WINDOWS: ReadonlyArray<{ kind: WindowKind; label: string; hasKind: boolean }> = [
  { kind: 'variable', label: 'Variable window', hasKind: true },
  { kind: 'local', label: 'Function local window', hasKind: true },
  { kind: 'input', label: 'Input window', hasKind: false },
  { kind: 'output', label: 'Output window', hasKind: true },
]

/** The types the height rule is checked on: text, a number, and two list types. */
const HEIGHT_TYPES = ['string', 'integer', 'array', 'table'] as const

/** The rows a window shows for a type: an input offers Create enum on String and Integer only (VMGR-112). */
const rowSetOf = (kind: WindowKind, type: string): string =>
  kind === 'input' && (type === 'string' || type === 'integer') ? 'with Create enum' : 'same rows'

async function seedWithFunction(request: APIRequestContext, name: string): Promise<string> {
  return createValidTest(request, {
    name,
    nodes: [
      logNode('log1', 'Log', '"ok"'),
      localFunctionNode(FN_ID, 'MyFn', {
        nodes: [logNode('inner', 'Inner', '"x"')],
        edges: [startEdge('inner')],
      }),
    ],
    edges: [startEdge('log1')],
  })
}

async function openWindow(page: Page, kind: WindowKind): Promise<Locator> {
  if (kind === 'variable') return openCreateModal(page)
  return openFunctionCreateModal(page, kind === 'local' ? 'variable' : kind)
}

/** Stand in the Test for the Variable window and in `fn1` for the three Function windows. */
async function enterScope(page: Page, kind: WindowKind): Promise<void> {
  if (kind !== 'variable' && (await breadcrumbFunctionSegments(page).count()) === 0) {
    await digIn(page, FN_ID)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
  }
  await expandVariableManager(page)
}

async function box(target: Locator, what: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await target.boundingBox()
  expect(found, `${what} has a box`).not.toBeNull()
  return found!
}

/** The window's height once its responsive size has settled. */
async function settledHeight(modal: Locator): Promise<number> {
  let last = -1
  await expect
    .poll(async () => {
      const now = Math.round((await modal.boundingBox())?.height ?? 0)
      const stable = now === last
      last = now
      return stable
    })
    .toBe(true)
  return last
}

/** How far the window's form body can scroll: 0 means every field is in view. */
async function formOverflow(modal: Locator): Promise<number> {
  return modal.locator('[data-testid="create-variable-name"]').evaluate((el) => {
    let node: HTMLElement | null = el.parentElement
    while (node && getComputedStyle(node).overflowY !== 'auto') node = node.parentElement
    return node ? node.scrollHeight - node.clientHeight : 0
  })
}

/** A held null keeps its Open editor in place, visually disabled, so no gap opens (FIELD-13). */
async function expectOpenEditorHeld(openEditor: Locator): Promise<void> {
  await expect(openEditor, 'Open editor stays in place').toHaveCount(1)
  await expectVisuallyDisabled(openEditor, 'Open editor')
}

test.describe('V-VMGR-CREATE-02: creation windows with Set to null ticked', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('ticked Set to null hides Kind and the value field and disables Open editor in each of the four windows', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await seedWithFunction(request, `zz-v-vmgr-create-02-${randomUUID().slice(0, 8)}`)
    await openTest(page, testId)

    for (const window of WINDOWS) {
      await enterScope(page, window.kind)
      await test.step(`VMGR-97 ${window.label}: the ticked half of the wireframe`, async () => {
        const modal = await openWindow(page, window.kind)
        await setCreateName(page, 'ticked_value', modal)
        const kind = modal.locator('[data-testid="create-kind-select"]')
        const typeSelect = modal.locator('[data-testid="create-type-select"]')
        const line = valueField(modal).locator('input')
        const openEditor = modal.locator('[data-testid="open-value-editor-button"]')
        // Unticked, a String shows its Kind (not on an input), its one-line field and Open editor.
        if (window.hasKind) await expect(kind).toBeVisible()
        await expect(line).toBeVisible()
        await expect(openEditor).toBeVisible()

        await setToNull(page, modal)
        await expect(kind, 'Kind is hidden').toHaveCount(0)
        await expect(line, 'the value field is gone').toHaveCount(0)
        await expectOpenEditorHeld(openEditor)
        const nullField = createNullField(page, modal)
        await expectNullLook(nullField, `${window.label}: the null field`)
        await expect(modal.locator('[data-testid="create-cancel-button"]')).toBeVisible()
        await expect(modal.locator('[data-testid="create-submit-button"]')).toBeEnabled()

        // The Type select keeps its half of the row; Set to null sits right under Mark as secret.
        const name = await box(modal.locator('[data-testid="create-variable-name"]'), 'Name')
        const typeBox = await box(typeSelect, 'Type')
        expect(typeBox.width, 'Type stays half width').toBeLessThan(name.width * 0.6)
        const secretBox = await box(modal.locator('[data-testid="create-secret-checkbox"]'), 'Mark as secret')
        const nullBox = await box(setToNullCheckbox(page, modal), 'Set to null')
        const fieldBox = await box(nullField, 'null field')
        expect(nullBox.y, 'Set to null is under Mark as secret').toBeGreaterThan(secretBox.y)
        expect(Math.abs(nullBox.x - secretBox.x), 'the two boxes line up').toBeLessThan(2)
        expect(fieldBox.y, 'the null field is under Set to null').toBeGreaterThan(nullBox.y)
        const between = modal.locator('[data-testid="create-value-area"] label').first()
        await expect(between, 'the value label stays above the null field').toHaveText(
          window.kind === 'input' ? 'Default value' : 'Value',
        )

        // As drawn: an Array switched to while ticked keeps the one null field and no Open editor.
        await setCreateType(page, 'array', modal)
        await expect(typeSelect).toContainText('Array')
        await expect(setToNullCheckbox(page, modal)).toBeChecked()
        await expectNullLook(createNullField(page, modal), `${window.label}: the Array null field`)
        await expectOpenEditorHeld(openEditor)
        await expect(kind).toHaveCount(0)
        await cancelCreate(page, modal)
      })
    }
  })

  test('the window keeps its height rules when ticked', async ({ page, request }) => {
    test.setTimeout(240_000)
    testId = await seedWithFunction(request, `zz-v-vmgr-create-02-h-${randomUUID().slice(0, 8)}`)
    await openTest(page, testId)
    const viewport = page.viewportSize()
    expect(viewport, 'the page has a viewport').not.toBeNull()

    for (const window of WINDOWS) {
      await enterScope(page, window.kind)
      await test.step(`VMGR-97 ${window.label}: one ticked height that fits`, async () => {
        const ticked: Record<string, number> = {}
        const unticked: Record<string, number> = {}
        for (const type of HEIGHT_TYPES) {
          const modal = await openWindow(page, window.kind)
          await setCreateName(page, `h_${type}`, modal)
          if (type !== 'string') await setCreateType(page, type, modal)
          unticked[type] = await settledHeight(modal)

          await setToNull(page, modal)
          const height = await settledHeight(modal)
          ticked[type] = height
          expect(height, `a ticked ${type} window stays inside the screen`).toBeLessThanOrEqual(viewport!.height)
          const sheet = await box(modal, 'the window')
          const field = await box(createNullField(page, modal), 'the null field')
          const submit = await box(modal.locator('[data-testid="create-submit-button"]'), 'Create')
          expect(field.y + field.height, `the ${type} null field ends above Create`).toBeLessThanOrEqual(submit.y)
          expect(submit.y + submit.height, `Create sits inside the ${type} window`).toBeLessThanOrEqual(
            sheet.y + sheet.height,
          )
          expect(await formOverflow(modal), `a ticked ${type} window has nothing to scroll to`).toBeLessThanOrEqual(1)

          await setToNullCheckbox(page, modal).click()
          await expect(setToNullCheckbox(page, modal)).not.toBeChecked()
          expect(await settledHeight(modal), `unticked, the ${type} window returns to its height`).toBe(unticked[type])
          await cancelCreate(page, modal)
        }
        for (const rows of new Set(HEIGHT_TYPES.map((type) => rowSetOf(window.kind, type)))) {
          const heights = HEIGHT_TYPES.filter((type) => rowSetOf(window.kind, type) === rows).map((type) => ticked[type])
          expect(new Set(heights).size, `${window.label}: one ticked height for every type (${rows}: ${heights.join(', ')})`).toBe(1)
        }
        for (const type of HEIGHT_TYPES) {
          expect(ticked[type], `${window.label}: a ticked ${type} is never taller than the window holding its value`).toBeLessThanOrEqual(
            unticked[type],
          )
          for (const list of ['array', 'table'] as const) {
            if (rowSetOf(window.kind, list) !== rowSetOf(window.kind, type)) continue
            expect(ticked[type], `${window.label}: a ticked ${type} is never taller than a ${list}`).toBeLessThanOrEqual(
              unticked[list],
            )
          }
        }
      })
    }
  })
})
