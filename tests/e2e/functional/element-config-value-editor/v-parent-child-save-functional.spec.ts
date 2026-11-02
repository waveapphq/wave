/**
 * V-PARENT-CHILD-SAVE-FUNCTIONAL: a config surface owns the floating "Edit value"
 * sheets opened from it.
 *
 * Wireframe: none
 * Design Decisions: SAVE-1, PYRUN-20, TDATA-9, FIELD-1, FIELD-7, FIELD-10
 * REQ: REQ-3.4.1.2
 *
 * Pass Criteria:
 * 1. The sheet a config row opens is NOT a DOM descendant of the config sheet.
 * 2. Dragging the config sheet by its handle moves the config and never the
 *    value sheet.
 * 3. The value sheet's maximize fills the viewport and restores its former size.
 * 4. Ctrl+Enter inside the value sheet applies that editor and leaves the config
 *    open and unsaved; Escape closes the value sheet only.
 * 5. With nothing changed anywhere the parent's Save is dead and closing asks
 *    nothing.
 * 6. Unsaved text in an open editor is an unsaved change of the parent: its Save
 *    goes live and closing it asks Keep Editing / Close / Save.
 * 7. One parent Save writes the parent's own edit and every open editor's value,
 *    as one undo step, and the stored Test carries all of them.
 * 8. The parent's Save is dead with exactly "Save is disabled: the Input Variables
 *    editor has errors" while an open editor with changes cannot be saved, and with
 *    exactly "Save is disabled: the settings have errors" while its own form is invalid;
 *    the question's Save carries the same note and is dead too.
 * 9. A Script Type switch that hides the Script row asks Keep Editing / Close first while
 *    the row's editor holds unsaved text; so does removing an Arguments item in the shared
 *    list editor while that item's own text editor holds unsaved text (FIELD-10): Keep
 *    Editing leaves the row or item exactly as it was, Close carries the action out and the
 *    row or item, its editor and its text all go. A clean editor closes with its item and
 *    asks nothing.
 * 10. One sheet per field (SFTP Download, Destination `artifact://out/a.txt`):
 *     (a) Browse replaces a clean Edit value sheet with the file picker and asks nothing;
 *     (b) Browse over an Edit value sheet holding typed text asks Keep Editing / Close /
 *     Save: Keep Editing leaves the sheet open and in front with no picker, Close keeps
 *     the field's value and the picker opens on it, Save writes the typed text into the
 *     field and the picker opens on it; (c) the edit control over a picker holding a
 *     changed Reference asks the same, and Save writes the Reference into the field
 *     before the Edit value sheet opens, while a clean picker closes at once; (d) an
 *     editor that cannot be saved turns the question's Save off with exactly "Save is
 *     disabled: the Destination editor has errors". The stored Test carries the last
 *     value written.
 * 11. The expression switch takes the field's sheets away: over an Edit value sheet
 *     holding typed text it asks Keep Editing / Close with no Save; Keep Editing leaves
 *     the field literal with the sheet open; Close takes the sheet and its text away, and
 *     the field, still holding its value, then asks the switch warning (FIELD-7), whose
 *     Clear switches it to an empty expression. A clean picker closes at once on the switch,
 *     and switching back to literal opens neither sheet.
 * 12. The suite variable grid takes the same rules through its own answers.
 *
 * Phase: functional-workflow (each test seeds its own Test / Suite through the API).
 * Run: ./scripts/e2e-targeted-local.sh functional/element-config-value-editor/v-parent-child-save-functional.spec.ts
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  createEntity,
  entityVariableRow,
  openEntityValue,
  openEntityVariables,
  saveVariablesDialog,
} from '../../helpers/entity-variables'
import { importFixtureTest } from '../../helpers/fixture-import'
import { valueEditorSheet } from '../../helpers/param-config'
import {
  editPreview,
  openListEditor,
} from '../../helpers/config-sheet'
import { listItem } from '../../helpers/entry-editors'
import { expandButton, switchWarning } from '../../helpers/value-field'
import { clearPointerLock, clickRedo, clickUndo } from '../../helpers/workbench'
import { deleteTest, openConfig, openTestOnCanvas, persistedNodes, saveWorkbench } from '../file-picker/picker'

const NODE = 'pcs-py'
const SEED_SCRIPT = 'x = 1'
const SEED_INTERPRETER = 'seed-interp'
const SEED_DESCRIPTION = 'Parent and child save'
const EDITED_DESCRIPTION = 'Parent edited its own field'

const CHILD_NOTE = 'Save is disabled: the Input Variables editor has errors'
const SETTINGS_NOTE = 'Save is disabled: the settings have errors'

/** A Python block whose rows open four different floating editors. */
function buildFixture(): Record<string, unknown> {
  return {
    name: 'V-PARENT-CHILD-SAVE',
    version: '1.0.0',
    description: 'A Python block whose parameter rows open floating value editors',
    workflow: {
      nodes: [
        {
          id: NODE,
          type: 'workflowNode',
          position: { x: 400, y: 160 },
          measured: { width: 120, height: 62 },
          data: {
            label: 'Python',
            elementType: 'python',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            description: SEED_DESCRIPTION,
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            config: {
              values: {
                script_type: 'source',
                script: SEED_SCRIPT,
                interpreter: SEED_INTERPRETER,
                arguments: [{ value: 'alpha' }, { value: 'beta' }],
                input_vars: {},
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [{ id: 'e-start', source: 'start-node', target: NODE }],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

const SFTP_NODE = 'pcs-sftp'
const SEED_DESTINATION = 'artifact://out/a.txt'
const DESTINATION_NOTE = 'Save is disabled: the Destination editor has errors'

/** An SFTP block on Download whose Destination opens an Edit value sheet or a save-as picker. */
function buildSftpFixture(): Record<string, unknown> {
  return {
    name: 'V-PARENT-CHILD-SAVE SFTP',
    version: '1.0.0',
    description: 'An SFTP Download block whose Destination opens one sheet at a time',
    workflow: {
      nodes: [
        {
          id: SFTP_NODE,
          type: 'workflowNode',
          position: { x: 400, y: 160 },
          measured: { width: 120, height: 62 },
          data: {
            label: 'SFTP',
            elementType: 'sftp',
            nodeType: 'plugin',
            category: 'remote',
            version: '1.0.0',
            description: 'Field sheets',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            config: {
              values: {
                session_id: 'pcs-session',
                operation: 'download',
                source: '/srv/in/a.txt',
                destination: SEED_DESTINATION,
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [{ id: 'e-start', source: 'start-node', target: SFTP_NODE }],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Import the fixture under a unique name and open it on the canvas. */
async function seedTest(page: Page, fixture: Record<string, unknown> = buildFixture()): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const testId = await importFixtureTest(page, fixture)
  await openTestOnCanvas(page, testId)
  return testId
}

/** Click a sheet's bare header at a point no other sheet covers, bringing it in front. */
async function raiseSheet(page: Page, sheet: Locator, handleId: string): Promise<void> {
  const point = await sheet.locator(`[data-testid="${handleId}"]`).evaluate((handle, id) => {
    const box = handle.getBoundingClientRect()
    const y = box.top + box.height / 2
    for (let x = box.left + 8; x < box.right - 8; x += 8) {
      const hit = document.elementFromPoint(x, y)
      const onHandle = hit?.closest(`[data-testid="${id}"]`) === handle
      if (onHandle && !hit?.closest('button, input, textarea, select, a, [role="combobox"]')) return { x, y }
    }
    return null
  }, handleId)
  expect(point, 'the sheet header offers a bare point no other sheet covers').not.toBeNull()
  await page.mouse.click(point!.x, point!.y)
  await expect(sheet).toHaveAttribute('data-active', 'true')
}

/** Bring the config sheet in front of the editors it opened. */
async function raiseConfig(page: Page, dialog: Locator): Promise<void> {
  await raiseSheet(page, dialog, 'element-config-sheet-drag-handle')
}

/** The Destination row's literal value as the row shows it. */
async function expectDestination(dialog: Locator, value: string): Promise<void> {
  await expect(editPreview(dialog, 'destination'), `the Destination field holds ${value}`).toHaveValue(value)
}

/** The picker's Reference line: the fixed scheme segment and the path box under it. */
async function expectReference(page: Page, scheme: string, path: string): Promise<void> {
  const picker = page.locator('[data-testid="file-reference-picker-sheet"]')
  await expect(picker.locator('[data-testid="picker-reference-scheme"]')).toHaveText(scheme)
  await expect(picker.locator('[data-testid="picker-reference-input"]')).toHaveValue(path)
}

/** Replace the whole text of a sheet's editor, leaving the draft unsaved. */
async function retype(page: Page, sheet: Locator, text: string): Promise<void> {
  await sheet.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.type(text)
}

/** The shared Keep Editing / Close / Save question every parent raises. */
const parentQuestion = (page: Page): Locator => page.locator('[data-testid="unsaved-changes-dialog"]')

const configSave = (dialog: Locator): Locator => dialog.getByRole('button', { name: /^Save$/ }).last()
const configCancel = (dialog: Locator): Locator => dialog.getByRole('button', { name: /^Cancel$/ }).last()

/** Leave the config sheet, discarding whatever it and its editors hold. */
async function closeConfigDiscarding(page: Page, dialog: Locator): Promise<void> {
  await revealFooter(dialog)
  await configCancel(dialog).click()
  const question = parentQuestion(page)
  await expect(question).toBeVisible()
  await question.locator('[data-testid="unsaved-close"]').click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  await clearPointerLock(page)
}

/** Which way the sheet can travel sideways without the viewport clamp eating the move. */
function sidewaysRoom(box: { x: number; width: number }, viewportWidth: number): number {
  if (box.x >= 70) return -60
  if (viewportWidth - (box.x + box.width) >= 70) return 60
  return 0
}

type Box = { x: number; y: number; width: number; height: number }

/** A point on the drag handle the front-most sheet does not cover, so the press lands on it. */
function handleGrabX(handle: Box, cover: Box): number {
  const preferred = handle.x + Math.min(60, handle.width / 3)
  const sameRows = handle.y + handle.height > cover.y && handle.y < cover.y + cover.height
  if (!sameRows || preferred < cover.x - 8) return preferred
  return cover.x - 8 > handle.x + 8 ? cover.x - 8 : cover.x + cover.width + 8
}

/** Drag a sheet by its header handle, pressing at a point nothing covers. */
async function dragSheetBy(
  page: Page,
  sheet: string | Locator,
  dx: number,
  dy: number,
  cover?: Box,
): Promise<void> {
  const handle =
    typeof sheet === 'string'
      ? page.locator(`[data-testid="${sheet}-drag-handle"]`)
      : sheet.locator('[data-testid="value-editor-sheet-drag-handle"]')
  const box = (await handle.boundingBox())!
  const startX = cover ? handleGrabX(box, cover) : box.x + Math.min(60, box.width / 3)
  expect(startX, 'the drag handle offers an uncovered point to press').toBeGreaterThan(box.x)
  expect(startX).toBeLessThan(box.x + box.width)
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + dx / 2, startY + dy / 2, { steps: 8 })
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 })
  await page.mouse.up()
}

/** The viewport clamp puts a parked sheet flush against the edge it was pushed to. */
async function restsAgainstEdge(
  page: Page,
  sheet: Locator,
  where: 'left' | 'bottom',
): Promise<boolean> {
  const box = (await sheet.boundingBox())!
  const view = page.viewportSize()!
  return where === 'left' ? box.x <= 4 : box.y + box.height >= view.height - 4
}

/** Park an editor against a viewport edge so the rows it covered stay clickable.
 *  The sheets are siblings, so a row under one is unreachable until the sheet moves. */
async function parkEditor(page: Page, sheet: Locator, where: 'left' | 'bottom'): Promise<void> {
  // The delta comes from the measured box: a fixed one leaves a wide sheet short of the clamp.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await restsAgainstEdge(page, sheet, where)) return
    const box = (await sheet.boundingBox())!
    const view = page.viewportSize()!
    const [dx, dy] =
      where === 'left'
        ? [-Math.round(box.x + 40), 0]
        : [0, Math.round(view.height - (box.y + box.height) + 40)]
    await dragSheetBy(page, sheet, dx, dy)
  }
  await expect(async () => {
    expect(await restsAgainstEdge(page, sheet, where), `the editor parked ${where}`).toBe(true)
  }).toPass({ timeout: 5_000 })
}

/** Scroll the config body so a parameter row sits at the top of the sheet, clear of any editor. */
async function revealRow(dialog: Locator, rowTestId: string): Promise<void> {
  await dialog
    .locator(`[data-testid="${rowTestId}"]`)
    .evaluate((element) => element.scrollIntoView({ block: 'start' }))
}

/** Scroll the config body to its footer so the Save / Cancel pair sits at the sheet's bottom. */
async function revealFooter(dialog: Locator): Promise<void> {
  await configSave(dialog).evaluate((element) => element.scrollIntoView({ block: 'end' }))
}

async function suiteVariables(
  request: APIRequestContext,
  suiteId: string,
): Promise<Record<string, { value: unknown }>> {
  const response = await request.get(`${BACKEND_URL}/suites/${suiteId}`)
  expect(response.ok(), `GET /suites/${suiteId} answered ${response.status()}`).toBeTruthy()
  return (await response.json()).data.variables
}

// ===========================================================================
// Suite
// ===========================================================================

test.describe('V-PARENT-CHILD-SAVE: a config surface owns the editors opened from it', () => {
  const tests: string[] = []
  const suites: string[] = []

  test.afterAll(async ({ request }) => {
    for (const testId of tests) await deleteTest(request, testId)
    for (const suiteId of suites) await request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => undefined)
  })

  // -------------------------------------------------------------------------
  // T1: the sheet floats on its own - not nested, not dragged along, its
  // own maximize, and its own keys.
  // -------------------------------------------------------------------------
  test('T1: the sheet opened from a config floats on its own', async ({ page, request }) => {
    const testId = await seedTest(page)
    tests.push(testId)
    const dialog = await openConfig(page, NODE)
    const viewport = page.viewportSize()!

    await expandButton(dialog, 'script').click()
    const sheet = valueEditorSheet(page)
    await expect(sheet).toBeVisible()

    // Per SAVE-1: the sheets are siblings in the sheet layer, never nested.
    await expect(
      page.locator('[data-testid="element-config-sheet"] [data-testid="value-editor-sheet"]'),
      'the value sheet is not a DOM descendant of the config sheet',
    ).toHaveCount(0)

    await test.step('maximize fills the viewport and restores', async () => {
      const before = (await sheet.boundingBox())!
      const maximize = sheet.locator('button[aria-label="Maximize"]')
      await expect(maximize).toHaveAttribute('aria-pressed', 'false')
      await maximize.click()
      await expect(maximize).toHaveAttribute('aria-pressed', 'true')
      await expect(async () => {
        const box = (await sheet.boundingBox())!
        expect(box.width, 'maximize grows the sheet').toBeGreaterThan(before.width)
        expect(box.width).toBeGreaterThanOrEqual(viewport.width * 0.85)
        expect(box.height).toBeGreaterThanOrEqual(viewport.height * 0.95)
      }).toPass({ timeout: 5_000 })
      await maximize.click()
      await expect(maximize).toHaveAttribute('aria-pressed', 'false')
      await expect(async () => {
        const box = (await sheet.boundingBox())!
        expect(Math.abs(box.width - before.width), 'restore returns the former width').toBeLessThan(2)
        expect(Math.abs(box.height - before.height), 'restore returns the former height').toBeLessThan(2)
      }).toPass({ timeout: 5_000 })
    })

    await test.step('Ctrl+Enter and Escape stay inside the value sheet', async () => {
      const childSave = sheet.locator('[data-testid="value-editor-save-button"]')
      await retype(page, sheet, 'x = 2')
      await expect(childSave).toBeEnabled()
      await page.keyboard.press('Control+Enter')
      // Per PYRUN-20: Ctrl+Enter is THIS editor's Save - it writes into the config
      // draft and never saves or closes the config behind it.
      await expect(editPreview(dialog, 'script'), 'Ctrl+Enter applied this editor draft').toHaveValue('x = 2')
      await expect(sheet, 'Ctrl+Enter left the editor open').toBeVisible()
      await expect(dialog, 'Ctrl+Enter did not close the config behind it').toBeVisible()
      await expect(
        configSave(dialog),
        'the config still holds an unsaved change, so Ctrl+Enter did not save it',
      ).toBeEnabled()

      // A clean editor, so Escape has nothing to ask about.
      await retype(page, sheet, 'x = 3')
      await childSave.click()
      await expect(childSave).toBeDisabled()
      await sheet.locator('.cm-content').first().click()
      await page.keyboard.press('Escape')
      await expect(sheet, 'Escape closed the front-most sheet').toBeHidden()
      await expect(dialog, 'Escape did not reach the config behind it').toBeVisible()
    })

    await test.step('dragging the config sheet never moves the value sheet', async () => {
      await expandButton(dialog, 'script').click()
      await expect(sheet).toBeVisible()
      const sheetBefore = (await sheet.boundingBox())!
      const configBefore = (await dialog.boundingBox())!
      const dx = sidewaysRoom(configBefore, viewport.width)
      expect(dx, 'the config sheet has room to move sideways').not.toBe(0)
      await dragSheetBy(page, 'element-config-sheet', dx, 0, sheetBefore)
      await expect(async () => {
        const configAfter = (await dialog.boundingBox())!
        expect(Math.abs(configAfter.x - configBefore.x), 'the config sheet moved').toBeGreaterThan(20)
      }).toPass({ timeout: 5_000 })
      const sheetAfter = (await sheet.boundingBox())!
      expect(Math.abs(sheetAfter.x - sheetBefore.x), 'the value sheet stayed put').toBeLessThan(2)
      expect(Math.abs(sheetAfter.y - sheetBefore.y), 'the value sheet stayed put').toBeLessThan(2)
    })

    // Nothing in this test was meant to save: the server still holds the seed.
    const nodes = await persistedNodes(request, testId)
    expect(nodes[NODE].config.values.script, 'no key inside the editor saved the block').toBe(SEED_SCRIPT)

    await closeConfigDiscarding(page, dialog)
  })

  // -------------------------------------------------------------------------
  // T2: the parent counts open editors, saves them in one step, and asks
  // before it closes.
  // -------------------------------------------------------------------------
  test('T2: the parent counts open editors and saves them in one step', async ({ page, request }) => {
    const testId = await seedTest(page)
    tests.push(testId)
    let dialog = await openConfig(page, NODE)
    const question = parentQuestion(page)

    await test.step('nothing changed anywhere: Save is dead and closing asks nothing', async () => {
      await expect(configSave(dialog)).toBeDisabled()
      await configCancel(dialog).click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
      await expect(question, 'a clean sheet closes at once').toHaveCount(0)
    })

    dialog = await openConfig(page, NODE)
    const sheets = page.locator('[data-testid="value-editor-sheet"]')
    // The Interpreter row allows a Template kind; an Arguments row does not, which
    // is what tells the two open sheets apart.
    const interpreterSheet = sheets.filter({ has: page.locator('[data-testid="kind-dropdown"]') })
    const argumentSheet = sheets.filter({ hasNot: page.locator('[data-testid="kind-dropdown"]') })

    await expandButton(dialog, 'interpreter').click()
    await expect(interpreterSheet).toBeVisible()
    await retype(page, interpreterSheet, 'child-interp')
    await expect(
      configSave(dialog),
      'unsaved text in an open editor is an unsaved change of the parent',
    ).toBeEnabled()

    // The editor's text was the only change, so discarding it makes the parent clean again.
    await interpreterSheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await page.locator('[data-testid="value-editor-unsaved-discard-button"]').click()
    await expect(sheets).toHaveCount(0)
    await expect(configSave(dialog)).toBeDisabled()
    await clearPointerLock(page)

    // Two editors open at once, plus the parent's own field.
    await expandButton(dialog, 'interpreter').click()
    await expect(interpreterSheet).toBeVisible()
    await retype(page, interpreterSheet, 'child-interp')
    await parkEditor(page, interpreterSheet, 'left')

    await revealRow(dialog, 'param-row-arguments')
    await openListEditor(page, dialog, 'arguments')
    await expect(argumentSheet).toBeVisible()
    await listItem(argumentSheet, 0).valueInput.fill('alpha-edited')

    await test.step('closing the parent asks first, and Keep Editing returns everything', async () => {
      await revealFooter(dialog)
      await configCancel(dialog).click()
      await expect(question).toBeVisible()
      await expect(question).toContainText('Unsaved changes')
      await question.locator('[data-testid="unsaved-keep-editing"]').click()
      await expect(question).toBeHidden()
      await expect(dialog).toBeVisible()
      await expect(interpreterSheet).toBeVisible()
      await expect(argumentSheet).toBeVisible()
      await clearPointerLock(page)
    })

    await dialog.locator('[data-testid="element-description-input"]').fill(EDITED_DESCRIPTION)

    // One Save: the parent's own field and BOTH open editors, in one write.
    await revealFooter(dialog)
    await configSave(dialog).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(sheets, 'the editors went with the sheet that owned them').toHaveCount(0)
    await clearPointerLock(page)

    dialog = await openConfig(page, NODE)
    await expect(dialog.locator('[data-testid="element-description-input"]')).toHaveValue(EDITED_DESCRIPTION)
    await expect(editPreview(dialog, 'interpreter')).toHaveValue('child-interp')
    await expect(editPreview(dialog, 'arguments')).toHaveValue('["alpha-edited", "beta"]')
    await configCancel(dialog).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    await test.step('a single undo reverses the whole save', async () => {
      await clickUndo(page)
      dialog = await openConfig(page, NODE)
      await expect(
        dialog.locator('[data-testid="element-description-input"]'),
        'one undo reversed the parent field',
      ).toHaveValue(SEED_DESCRIPTION)
      await expect(editPreview(dialog, 'interpreter'), 'the same undo reversed the editor value').toHaveValue(
        SEED_INTERPRETER,
      )
      await expect(editPreview(dialog, 'arguments')).toHaveValue('["alpha", "beta"]')
      await configCancel(dialog).click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
      await clickRedo(page)
    })

    await saveWorkbench(page)
    const nodes = await persistedNodes(request, testId)
    expect(nodes[NODE].description, 'the parent field reached the stored Test').toBe(EDITED_DESCRIPTION)
    expect(nodes[NODE].config.values.interpreter, 'the first editor value reached the stored Test').toBe(
      'child-interp',
    )
    expect(nodes[NODE].config.values.arguments, 'the second editor value reached the stored Test').toEqual([
      { value: 'alpha-edited' },
      { value: 'beta' },
    ])
  })

  // -------------------------------------------------------------------------
  // T3: the two disabled-Save notes, on the footer and in the question.
  // -------------------------------------------------------------------------
  test('T3: the disabled-Save note names the editor, then the settings', async ({ page }) => {
    const testId = await seedTest(page)
    tests.push(testId)
    const dialog = await openConfig(page, NODE)
    const note = dialog.locator('[data-testid="save-blocked-note"]')
    const sheet = valueEditorSheet(page)

    await test.step('an open editor with changes that cannot be saved names its row', async () => {
      await expandButton(dialog, 'input_vars').click()
      await expect(sheet).toBeVisible()
      await sheet.locator('[data-testid="map-add-entry"]').click()
      await sheet.locator('[data-testid="map-edit-key-0"]').fill('1bad')
      await sheet.locator('[data-testid="map-edit-value-0"]').fill('x')
      await expect(sheet.locator('[data-testid="value-editor-save-button"]')).toBeDisabled()
      await expect(note).toHaveText(CHILD_NOTE)
      await expect(configSave(dialog)).toBeDisabled()
    })

    await test.step('an editor that is discarded blocks nothing', async () => {
      await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
      const childQuestion = page.locator('[data-testid="value-editor-unsaved-dialog"]')
      await expect(childQuestion).toBeVisible()
      await childQuestion.locator('[data-testid="value-editor-unsaved-discard-button"]').click()
      await expect(sheet).toBeHidden()
      await expect(note).toHaveCount(0)
      await expect(configSave(dialog)).toBeDisabled()
      await clearPointerLock(page)
    })

    await test.step("the parent's own invalid form names the settings", async () => {
      // Script is required while Script Type is Source, so an empty one invalidates the form.
      await expandButton(dialog, 'script').click()
      await expect(sheet).toBeVisible()
      await retype(page, sheet, '')
      await sheet.locator('[data-testid="value-editor-save-button"]').click()
      await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
      await expect(sheet).toBeHidden()
      await expect(note).toHaveText(SETTINGS_NOTE)
      await expect(configSave(dialog)).toBeDisabled()
    })

    await test.step('the question carries the same note on its own dead Save', async () => {
      await configCancel(dialog).click()
      const question = parentQuestion(page)
      await expect(question).toBeVisible()
      await expect(question.locator('[data-testid="save-blocked-note"]')).toHaveText(SETTINGS_NOTE)
      await expect(question.locator('[data-testid="unsaved-save"]')).toBeDisabled()
      await question.locator('[data-testid="unsaved-close"]').click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
    })
  })

  // -------------------------------------------------------------------------
  // T4: a row the parent takes away asks first while its editor is dirty.
  // -------------------------------------------------------------------------
  test('T4: removing a row whose editor holds unsaved text asks first', async ({ page }) => {
    const testId = await seedTest(page)
    tests.push(testId)
    const dialog = await openConfig(page, NODE)
    const sheet = valueEditorSheet(page)
    const question = parentQuestion(page)
    const scriptType = dialog.getByRole('combobox', { name: 'Script Type' })

    const switchScriptType = async (label: 'Source' | 'File') => {
      await revealRow(dialog, 'param-row-script_type')
      await scriptType.click()
      await page.getByRole('option', { name: label, exact: true }).click()
    }

    await test.step('a Script Type switch that hides the Script row asks first', async () => {
      await expandButton(dialog, 'script').click()
      await expect(sheet).toBeVisible()
      await retype(page, sheet, 'x = 99')
      await parkEditor(page, sheet, 'bottom')

      await switchScriptType('File')
      await expect(question).toBeVisible()
      await expect(
        question.locator('[data-testid="unsaved-save"]'),
        'the row is going, so the question offers no Save',
      ).toHaveCount(0)

      // Keep Editing drops the action: the row stays exactly as it was.
      await question.locator('[data-testid="unsaved-keep-editing"]').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(scriptType, 'the switch was not applied').toContainText('Source')
      await expect(dialog.locator('[data-testid="param-row-script"]')).toBeVisible()
      await expect(sheet).toBeVisible()
      await expect(sheet.locator('.cm-content'), 'the unsaved text is intact').toContainText('x = 99')

      // Close carries the action out: the row, its editor and its text all go.
      await switchScriptType('File')
      await expect(question).toBeVisible()
      await question.locator('[data-testid="unsaved-close"]').click()
      await expect(scriptType).toContainText('File')
      await expect(dialog.locator('[data-testid="param-row-script"]')).toHaveCount(0)
      await expect(sheet, 'the removed row took its editor with it').toBeHidden()
      await clearPointerLock(page)
    })

    // FIELD-10: the items live in the shared list editor; a text item opens its own text editor.
    const sheets = page.locator('[data-testid="value-editor-sheet"]')
    const listSheet = sheets.filter({ has: page.locator('[data-testid="array-edit-body"]') })
    const itemSheet = sheets.filter({ hasNot: page.locator('[data-testid="array-edit-body"]') })

    await test.step('removing an Arguments item whose text editor holds unsaved text asks first', async () => {
      await revealRow(dialog, 'param-row-arguments')
      await openListEditor(page, dialog, 'arguments')
      await expect(listItem(listSheet, 1).valueInput).toHaveValue('beta')
      await listSheet.locator('[data-testid="array-expand-1"]').click()
      await expect(itemSheet).toBeVisible()
      await retype(page, itemSheet, 'beta-unsaved')
      await parkEditor(page, itemSheet, 'bottom')

      await raiseSheet(page, listSheet, 'value-editor-sheet-drag-handle')
      await listItem(listSheet, 1).remove.click()
      await expect(question).toBeVisible()
      await expect(question.locator('[data-testid="unsaved-save"]'), 'the item is going, so no Save').toHaveCount(0)
      await question.locator('[data-testid="unsaved-keep-editing"]').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(listItem(listSheet, 1).valueInput, 'Keep Editing keeps the item').toHaveValue('beta')
      await expect(itemSheet).toBeVisible()
      await expect(itemSheet.locator('.cm-content')).toContainText('beta-unsaved')

      await raiseSheet(page, listSheet, 'value-editor-sheet-drag-handle')
      await listItem(listSheet, 1).remove.click()
      await expect(question).toBeVisible()
      await question.locator('[data-testid="unsaved-close"]').click()
      await expect(listItem(listSheet, 1).valueInput).toHaveCount(0)
      await expect(itemSheet, 'the removed item took its editor with it').toBeHidden()
      await clearPointerLock(page)
    })

    await test.step('a clean item editor closes with its item and asks nothing', async () => {
      await listSheet.locator('[data-testid="array-expand-0"]').click()
      await expect(itemSheet).toBeVisible()
      await parkEditor(page, itemSheet, 'bottom')
      await raiseSheet(page, listSheet, 'value-editor-sheet-drag-handle')
      await listItem(listSheet, 0).remove.click()
      await expect(listItem(listSheet, 0).valueInput).toHaveCount(0)
      await expect(itemSheet).toBeHidden()
      await expect(question, 'a clean editor never stops the action').toHaveCount(0)
    })

    await closeConfigDiscarding(page, dialog)
  })

  // -------------------------------------------------------------------------
  // T5: the same rules on a second surface - the Suite variable grid,
  // which raises the question through its own answer test ids.
  // -------------------------------------------------------------------------
  test('T5: the suite variable grid takes the same rules', async ({ page, request }) => {
    const suiteId = await createEntity(request, '/suites', {
      name: `PCS Suite ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      variables: {
        note: { type: 'string', value: 'grid-seed', secret: false },
        other: { type: 'string', value: 'other-seed', secret: false },
      },
    })
    suites.push(suiteId)

    const grid = await openEntityVariables(page, 'suite', suiteId)
    const gridSave = grid.locator('[data-testid="edit-dialog-save"]')
    const gridCancel = grid.locator('[data-testid="edit-dialog-cancel"]')
    const question = parentQuestion(page)
    const sheet = valueEditorSheet(page)

    await expect(gridSave, 'nothing changed anywhere, so Save is dead').toBeDisabled()

    await openEntityValue(page, await entityVariableRow(grid, 'note'))
    await retype(page, sheet, 'grid-child-edit')
    await expect(gridSave, "the open editor's unsaved text is the grid's change").toBeEnabled()
    await parkEditor(page, sheet, 'left')

    await test.step('closing the grid asks first', async () => {
      await gridCancel.click()
      await expect(question).toBeVisible()
      await expect(
        question.locator('[data-testid="unsaved-discard"]'),
        'the middle answer reads Close here too',
      ).toHaveText('Close')
      await question.locator('[data-testid="unsaved-keep-editing"]').click()
      await expect(question).toBeHidden()
      await expect(sheet).toBeVisible()
      await clearPointerLock(page)
    })

    // One Save writes the open editor's value through to the Suite.
    await saveVariablesDialog(grid)
    const saved = await suiteVariables(request, suiteId)
    expect(saved.note.value, "the grid Save applied the open editor's value").toBe('grid-child-edit')

    await test.step('deleting a row whose editor is dirty asks first', async () => {
      await openEntityVariables(page, 'suite', suiteId)
      const otherRow = await entityVariableRow(grid, 'other')
      await openEntityValue(page, otherRow)
      await retype(page, sheet, 'other-unsaved')
      await parkEditor(page, sheet, 'left')

      await otherRow.locator('[data-testid="variable-delete-btn"]').click()
      await expect(question).toBeVisible()
      await expect(question.locator('[data-testid="unsaved-save"]')).toHaveCount(0)
      await question.locator('[data-testid="unsaved-keep-editing"]').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(grid.locator('[data-testid="variable-editor-row"]'), 'the row stayed').toHaveCount(2)
      await expect(sheet.locator('.cm-content')).toContainText('other-unsaved')

      await (await entityVariableRow(grid, 'other')).locator('[data-testid="variable-delete-btn"]').click()
      await expect(question).toBeVisible()
      await question.locator('[data-testid="unsaved-close"]').click()
      await expect(grid.locator('[data-testid="variable-editor-row"]')).toHaveCount(1)
      await expect(sheet, 'the removed row took its editor with it').toBeHidden()
      await clearPointerLock(page)
    })

    // Close discards the removal: the Suite still holds both variables.
    await gridCancel.click()
    await expect(question).toBeVisible()
    await question.locator('[data-testid="unsaved-discard"]').click()
    await expect(grid).toBeHidden({ timeout: 10_000 })
    const after = await suiteVariables(request, suiteId)
    expect(Object.keys(after).sort()).toEqual(['note', 'other'])
  })

  // -------------------------------------------------------------------------
  // T6: a field opens its Edit value sheet or its file picker, never both.
  // -------------------------------------------------------------------------
  test('T6: a field opens its Edit value sheet or its file picker, never both', async ({ page, request }) => {
    const testId = await seedTest(page, buildSftpFixture())
    tests.push(testId)
    const dialog = await openConfig(page, SFTP_NODE)
    const sheet = valueEditorSheet(page)
    const picker = page.locator('[data-testid="file-reference-picker-sheet"]')
    const question = parentQuestion(page)
    const edit = expandButton(dialog, 'destination')
    const browse = dialog.locator('[data-testid="param-browse-destination"]')
    const reference = picker.locator('[data-testid="picker-reference-input"]')
    const typed = 'artifact://typed/b.txt'
    const picked = 'artifact://picked/c.txt'

    await revealRow(dialog, 'param-row-destination')
    await expectDestination(dialog, SEED_DESTINATION)

    await test.step('(a) Browse replaces a clean Edit value sheet and asks nothing', async () => {
      await edit.click()
      await expect(sheet).toBeVisible()
      await raiseConfig(page, dialog)
      await browse.click()
      await expect(picker).toBeVisible()
      await expect(sheet, 'the clean Edit value sheet closed').toHaveCount(0)
      await expect(question, 'nothing unsaved, so nothing to ask').toHaveCount(0)
      await expectReference(page, 'artifact://', 'out/a.txt')
      await picker.locator('[data-testid="picker-cancel-button"]').click()
      await expect(picker).toHaveCount(0)
    })

    await test.step('(b) Browse over typed text asks Keep Editing / Close / Save', async () => {
      await edit.click()
      await expect(sheet).toBeVisible()
      await retype(page, sheet, typed)
      await raiseConfig(page, dialog)
      await browse.click()
      await expect(question).toBeVisible()
      await expect(question.locator('[data-testid="unsaved-keep-editing"]')).toHaveText('Keep Editing')
      await expect(question.locator('[data-testid="unsaved-close"]')).toHaveText('Close')
      await expect(question.locator('[data-testid="unsaved-save"]')).toBeEnabled()
      await expect(picker, 'no picker while the question is open').toHaveCount(0)

      await question.locator('[data-testid="unsaved-keep-editing"]').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(sheet).toHaveCount(1)
      await expect(sheet, 'Keep Editing brings the sheet back in front').toHaveAttribute('data-active', 'true')
      await expect(sheet.locator('.cm-content'), 'the typed text is intact').toHaveText(typed)
      await expect(picker).toHaveCount(0)
      await expectDestination(dialog, SEED_DESTINATION)

      await raiseConfig(page, dialog)
      await browse.click()
      await expect(question).toBeVisible()
      await question.locator('[data-testid="unsaved-close"]').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(sheet, 'Close took the Edit value sheet away').toHaveCount(0)
      await expect(picker).toBeVisible()
      await expectDestination(dialog, SEED_DESTINATION)
      await expectReference(page, 'artifact://', 'out/a.txt')
      await picker.locator('[data-testid="picker-cancel-button"]').click()
      await expect(picker).toHaveCount(0)

      await edit.click()
      await expect(sheet).toBeVisible()
      await expect(sheet.locator('.cm-content'), 'Close discarded the typed text').toHaveText(SEED_DESTINATION)
      await retype(page, sheet, typed)
      await raiseConfig(page, dialog)
      await browse.click()
      await expect(question).toBeVisible()
      await question.locator('[data-testid="unsaved-save"]').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(sheet).toHaveCount(0)
      await expect(picker).toBeVisible()
      await expectDestination(dialog, typed)
      await expectReference(page, 'artifact://', 'typed/b.txt')
    })

    await test.step('(c) the edit control over a changed picker asks the same; Save writes the Reference', async () => {
      await reference.fill('picked/c.txt')
      await raiseConfig(page, dialog)
      await edit.click()
      await expect(question).toBeVisible()
      await expect(question.locator('[data-testid="unsaved-keep-editing"]')).toHaveText('Keep Editing')
      await expect(question.locator('[data-testid="unsaved-close"]')).toHaveText('Close')
      await expect(question.locator('[data-testid="unsaved-save"]')).toBeEnabled()
      await expect(sheet).toHaveCount(0)
      await question.locator('[data-testid="unsaved-save"]').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(picker).toHaveCount(0)
      await expect(sheet).toBeVisible()
      await expectDestination(dialog, picked)
      await expect(sheet.locator('.cm-content'), 'the Edit value sheet opens on the new value').toHaveText(picked)

      await raiseConfig(page, dialog)
      await browse.click()
      await expect(picker).toBeVisible()
      await expect(sheet).toHaveCount(0)
      await expectReference(page, 'artifact://', 'picked/c.txt')
      await raiseConfig(page, dialog)
      await edit.click()
      await expect(sheet).toBeVisible()
      await expect(picker, 'a clean picker closes at once').toHaveCount(0)
      await expect(question).toHaveCount(0)
    })

    await test.step('(d) an editor that cannot be saved turns the question Save off', async () => {
      // A plain-string Edit value sheet is never invalid, so the field's picker holds the unselectable change.
      await raiseConfig(page, dialog)
      await browse.click()
      await expect(picker).toBeVisible()
      await reference.fill('')
      await expect(picker.locator('[data-testid="picker-use-button"]')).toBeDisabled()
      await raiseConfig(page, dialog)
      await edit.click()
      await expect(question).toBeVisible()
      await expect(question.locator('[data-testid="save-blocked-note"]')).toHaveText(DESTINATION_NOTE)
      await expect(question.locator('[data-testid="unsaved-save"]')).toBeDisabled()
      await question.locator('[data-testid="unsaved-close"]').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(picker).toHaveCount(0)
      await expect(sheet).toBeVisible()
      await expectDestination(dialog, picked)
    })

    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toHaveCount(0)
    await revealFooter(dialog)
    await configSave(dialog).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await saveWorkbench(page)
    const nodes = await persistedNodes(request, testId)
    expect(nodes[SFTP_NODE].config.values.destination, 'the stored Test carries the last value written').toBe(
      picked,
    )
  })

  // -------------------------------------------------------------------------
  // T7: switching the field to an expression takes its sheets away.
  // -------------------------------------------------------------------------
  test('T7: the expression switch takes the field sheets away', async ({ page }) => {
    const testId = await seedTest(page, buildSftpFixture())
    tests.push(testId)
    const dialog = await openConfig(page, SFTP_NODE)
    const sheet = valueEditorSheet(page)
    const picker = page.locator('[data-testid="file-reference-picker-sheet"]')
    const question = parentQuestion(page)
    const row = dialog.locator('[data-testid="param-row-destination"]')
    const toggle = row.locator('[data-testid="expression-toggle"]')
    const typed = 'artifact://typed/d.txt'

    await revealRow(dialog, 'param-row-destination')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await test.step('typed text: the switch asks Keep Editing / Close with no Save', async () => {
      await expandButton(dialog, 'destination').click()
      await expect(sheet).toBeVisible()
      await retype(page, sheet, typed)
      await raiseConfig(page, dialog)
      await toggle.click()
      await expect(question).toBeVisible()
      await expect(question.locator('[data-testid="unsaved-keep-editing"]')).toHaveText('Keep Editing')
      await expect(question.locator('[data-testid="unsaved-close"]')).toHaveText('Close')
      await expect(question.locator('[data-testid="unsaved-save"]'), 'the sheet is going, so no Save').toHaveCount(0)

      await question.locator('[data-testid="unsaved-keep-editing"]').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(toggle, 'Keep Editing leaves the field literal').toHaveAttribute('aria-pressed', 'false')
      await expect(sheet).toHaveCount(1)
      await expect(sheet).toHaveAttribute('data-active', 'true')
      await expect(sheet.locator('.cm-content'), 'the typed text is intact').toHaveText(typed)
      await expectDestination(dialog, SEED_DESTINATION)

      await raiseConfig(page, dialog)
      await toggle.click()
      await expect(question).toBeVisible()
      await question.locator('[data-testid="unsaved-close"]').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(sheet, 'the Edit value sheet and its text went').toHaveCount(0)
      // FIELD-7: the field still holds its value, so the switch warning asks; Clear switches it empty.
      const warning = switchWarning(page)
      await expect(warning).toBeVisible()
      await expect(toggle, 'the field stays literal while the warning asks').toHaveAttribute('aria-pressed', 'false')
      await warning.locator('[data-testid="switch-mode-clear-default"]').click()
      await expect(warning).toHaveCount(0)
      await expect(toggle, 'Clear switches the field to an expression').toHaveAttribute('aria-pressed', 'true')
      await expect(
        row.locator('[data-testid="param-input-destination"] .cm-content'),
        'switching never carries the value or the typed text into the expression',
      ).toHaveText('')
    })

    await test.step('switching back to literal opens neither sheet', async () => {
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect(question).toHaveCount(0)
      await expect(sheet).toHaveCount(0)
      await expect(picker).toHaveCount(0)
    })

    await test.step('a clean picker closes at once on the switch', async () => {
      await dialog.locator('[data-testid="param-browse-destination"]').click()
      await expect(picker).toBeVisible()
      await raiseConfig(page, dialog)
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await expect(question, 'nothing picked, so nothing to ask').toHaveCount(0)
      await expect(picker, 'the switch took the picker away').toHaveCount(0)

      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect(sheet).toHaveCount(0)
      await expect(picker).toHaveCount(0)
    })

    await closeConfigDiscarding(page, dialog)
  })
})
