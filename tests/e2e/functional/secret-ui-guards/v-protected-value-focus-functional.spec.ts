/**
 * V-PROTECTED-VALUE-FOCUS-FUNCTIONAL: "Edit Protected Value?" - keyboard focus and the stored value
 * Wireframe: none - the question's texts and look are unchanged
 * Design Decisions: SECFLD-1, SECUI-9
 * REQ: REQ-3.1.3.5, REQ-3.1.3.18
 *
 * The question is asked and answered with the keyboard on three surfaces: a block
 * dialog row with a stored secret text (SSH Session Open, Password), a block dialog
 * row with a stored secret number (Variable Setter, an integer row) and the masked
 * value field of a saved secret variable's Edit window. No plugin declares a secret number
 * parameter, so the Variable Setter row is the block dialog's stored secret number.
 *
 * Phase: functional-workflow (each test imports its own Test; no run).
 * Run: ./scripts/e2e-targeted-local.sh functional/secret-ui-guards/v-protected-value-focus-functional.spec.ts
 *
 * Pass Criteria:
 * 1. Block dialog, secret text: after Cancel and after Escape the question is gone, no
 *    editor opened, the row is still masked and keyboard focus is on the masked field.
 * 2. Block dialog, secret text: a block Save and a test Save after Cancel and Escape
 *    leave the same sealed value in the saved test.
 * 3. Block dialog, secret text: after "Delete & Edit" the row is its empty one value field
 *    (no editor sheet opens) with keyboard focus in its text box, and the saved test holds no
 *    value after a Save.
 * 4. Block dialog, secret number: criteria 1 and 2 hold for the masked number row.
 * 5. Block dialog, secret number: after "Delete & Edit" focus is in the row's own number
 *    input, which holds the type's preset 0, no editor sheet opened, and after a Save the
 *    saved test holds the preset 0 in place of the old sealed value.
 * 6. Edit window: Enter on the row pencil opens the window with the masked field and asks
 *    nothing; after Cancel and after Escape on the masked field's question the window stays
 *    open, the field is still masked and holds keyboard focus; a test Save after them leaves
 *    the same sealed value in the saved test.
 * 7. Edit window: after "Delete & Edit" the field is the empty text field and holds keyboard
 *    focus; saving the empty field and the test leaves the saved test with no value.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { configSheet, saveBtn } from '../../helpers/workbench'
import {
  cancelWindow,
  expandVariableManager,
  openEditWindow,
  saveWindow,
  setWindowValue,
  valueEditor,
  valueField,
  valueSwitch,
  variableRow,
} from '../../helpers/variable-create'
import { BACKEND_URL } from '../../helpers/config'

const MASKING_ALL_OFF = {
  run_output: false,
  test_variables: false,
  shared_variables: false,
  credential_inputs: false,
}

const SSH_NODE = 'ssh-open'
const SETTER_NODE = 'pin-setter'
const SECRET_VARIABLE = 'api_key'
const PLAIN_VARIABLE = 'plain_counter'

const STORED_SECRET_TEXT = 'focus-text-7q2m9x'
const STORED_SECRET_NUMBER = '4821'
const STORED_VARIABLE_TEXT = 'focus-var-3k8d1z'

const SEALED = /^wave:enc:v1:[A-Za-z0-9+/=_-]+$/
const SAVED_NOTE = 'Saved after the dismissals'

const FIXTURE: Record<string, unknown> = {
  name: 'Protected Value Focus E2E',
  version: '1.0.0',
  description:
    'A block with a stored secret text, a block with a stored secret number and a saved secret variable.',
  workflow: {
    nodes: [
      {
        id: SSH_NODE,
        type: 'workflowNode',
        position: { x: 400, y: 120 },
        data: {
          label: 'SSH Session Open',
          elementType: 'ssh-session-open',
          nodeType: 'plugin',
          category: 'network',
          version: '1.0.0',
          description: 'Stored secret text',
          hasNewerVersion: false,
          expressionFields: [],
          templateFields: [],
          config: {
            values: {
              host: 'example.host',
              port: 22,
              username: 'admin',
              password: STORED_SECRET_TEXT,
              host_key_verification: 'strict',
            },
            outputBindings: {},
            profileBindings: [],
          },
        },
        measured: { width: 120, height: 62 },
      },
      {
        id: SETTER_NODE,
        type: 'workflowNode',
        position: { x: 400, y: 220 },
        data: {
          label: 'Var Setter',
          elementType: 'variable-setter',
          nodeType: 'control',
          category: 'flow',
          version: '1.0.0',
          description: 'Stored secret number',
          hasNewerVersion: false,
          expressionFields: [],
          templateFields: [],
          variableExpressionKeys: [],
          variableTemplateKeys: [],
          variableTypes: { saved_pin: 'integer' },
          config: {
            values: { variables: { saved_pin: STORED_SECRET_NUMBER } },
            variableSecretKeys: ['saved_pin'],
            outputBindings: {},
            profileBindings: [],
          },
        },
        measured: { width: 120, height: 62 },
      },
    ],
    edges: [
      { id: 'e1', source: 'start-node', target: SSH_NODE, type: 'default' },
      { id: 'e2', source: SSH_NODE, target: SETTER_NODE, type: 'default' },
    ],
  },
  variables: {
    saved_pin: { value: 0, type: 'integer', scope: 'test', secret: true },
    [SECRET_VARIABLE]: { value: STORED_VARIABLE_TEXT, type: 'string', scope: 'test', secret: true },
    [PLAIN_VARIABLE]: { value: 7, type: 'integer', scope: 'test' },
  },
  metadata: { tags: [], suite_id: null, parent_suite: null },
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------

const maskedField = (scope: Locator): Locator =>
  scope.locator('button[aria-label="Edit protected value"]')

const editQuestion = (page: Page): Locator =>
  page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })

const valueEditorSheet = (page: Page): Locator => page.locator('[data-testid="value-editor-sheet"]')

const windowMasked = (win: Locator): Locator =>
  valueField(win).getByRole('button', { name: 'Value: Edit protected value', exact: true })

const pencil = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="edit-button-"]')

// ---------------------------------------------------------------------------
// Keyboard and focus
// ---------------------------------------------------------------------------

const hasFocus = (target: Locator): Promise<boolean> =>
  target.evaluate((element) => element === document.activeElement)

const holdsFocusInside = (target: Locator): Promise<boolean> =>
  target.evaluate((element) => element.contains(document.activeElement))

/** True while no control holds keyboard focus. */
const focusIsOnPageBody = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.activeElement === null || document.activeElement === document.body)

/** Tab from `start` until `target` holds keyboard focus. */
async function tabTo(page: Page, start: Locator, target: Locator, maxTabs = 4): Promise<void> {
  await start.focus()
  for (let pressed = 0; pressed < maxTabs && !(await hasFocus(target)); pressed += 1) {
    await page.keyboard.press('Tab')
  }
  await expect(target, 'Tab reaches the control').toBeFocused()
}

/** Ask the question with Enter on the control that holds focus. */
async function askWithEnter(page: Page): Promise<void> {
  await page.keyboard.press('Enter')
  const question = editQuestion(page)
  await expect(question).toBeVisible()
  // Keys pressed before focus moved into the question would go to the page behind it.
  await expect.poll(() => holdsFocusInside(question)).toBe(true)
}

/** Answer the question with the keyboard: Tab to the named button, then Enter. */
async function answerWithKeyboard(page: Page, answer: 'Cancel' | 'Delete & Edit'): Promise<void> {
  const button = editQuestion(page).getByRole('button', { name: answer, exact: true })
  for (let pressed = 0; pressed < 3 && !(await hasFocus(button)); pressed += 1) {
    await page.keyboard.press('Tab')
  }
  await expect(button, `Tab reaches "${answer}"`).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(editQuestion(page)).toHaveCount(0)
}

async function dismissWithEscape(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(editQuestion(page)).toHaveCount(0)
}

// ---------------------------------------------------------------------------
// Block dialog and Save
// ---------------------------------------------------------------------------

async function openBlockDialog(page: Page, nodeId: string): Promise<Locator> {
  await page.locator(`[data-testid="workflow-node-${nodeId}"]`).locator('button').first().dblclick()
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  return sheet
}

async function saveTest(page: Page): Promise<void> {
  await expect(saveBtn(page)).toBeEnabled()
  await saveBtn(page).click()
  await expect(saveBtn(page)).toBeDisabled({ timeout: 15_000 })
}

/** Apply the block dialog with its own Save, then save the test. */
async function saveBlockAndTest(page: Page): Promise<void> {
  const sheet = configSheet(page)
  const blockSave = sheet.getByRole('button', { name: /^Save$/ }).last()
  await expect(blockSave).toBeEnabled()
  await blockSave.click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  await saveTest(page)
}

// ---------------------------------------------------------------------------
// The saved test, read back over the API
// ---------------------------------------------------------------------------

interface SavedBlock {
  description: unknown
  values: Record<string, unknown>
}

async function savedBlock(page: Page, testId: string, nodeId: string): Promise<SavedBlock> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  const nodes = (body?.data?.nodes ?? body?.nodes ?? []) as Array<{
    id: string
    data?: { description?: unknown; config?: { values?: Record<string, unknown> } }
  }>
  const node = nodes.find((candidate) => candidate.id === nodeId)
  expect(node, `the saved test holds block ${nodeId}`).toBeTruthy()
  return { description: node?.data?.description, values: node?.data?.config?.values ?? {} }
}

/** A saved block with every secret literal decrypted, read from the plaintext export. */
async function plaintextBlock(page: Page, testId: string, nodeId: string): Promise<SavedBlock> {
  const resp = await page.request.get(
    `${BACKEND_URL}/tests/${testId}/export?format=json&secrets=plaintext`,
  )
  expect(resp.ok(), `GET /tests/${testId}/export: ${resp.status()}`).toBeTruthy()
  const parsed = JSON.parse(await resp.text()) as {
    workflow?: {
      nodes?: Array<{
        id: string
        data?: { description?: unknown; config?: { values?: Record<string, unknown> } }
      }>
    }
  }
  const node = (parsed.workflow?.nodes ?? []).find((candidate) => candidate.id === nodeId)
  expect(node, `the exported test holds block ${nodeId}`).toBeTruthy()
  return { description: node?.data?.description, values: node?.data?.config?.values ?? {} }
}

/** The saved variables with every secret in its sealed form, never masked. */
async function savedVariables(
  page: Page,
  testId: string,
): Promise<Record<string, { value?: unknown }>> {
  const resp = await page.request.get(
    `${BACKEND_URL}/tests/${testId}/export?format=json&secrets=encrypted`,
  )
  expect(resp.ok(), `GET /tests/${testId}/export: ${resp.status()}`).toBeTruthy()
  const parsed = JSON.parse(await resp.text()) as {
    variables?: Record<string, { value?: unknown }>
  }
  return parsed.variables ?? {}
}

const holdsNothing = (value: unknown): boolean =>
  value === undefined || value === null || value === ''

// ---------------------------------------------------------------------------
// Block dialog surfaces
// ---------------------------------------------------------------------------

interface BlockSurface {
  title: string
  nodeId: string
  /** The control right before the masked field in Tab order. */
  previousControl: (sheet: Locator) => Locator
  masked: (sheet: Locator) => Locator
  /** The row's own value control once the stored value is gone. */
  valueControl: (sheet: Locator) => Locator
  stored: (block: SavedBlock) => unknown
  /** What the row's own control holds once the stored value is dropped. */
  cleared: string
  /** A dropped text holds nothing; a number row presets its type's default. */
  presetsDefault: boolean
}

const BLOCK_SURFACES: BlockSurface[] = [
  {
    title: 'a stored secret text',
    nodeId: SSH_NODE,
    previousControl: (sheet) =>
      sheet.locator('[data-testid="param-row-username"] [data-testid="expression-toggle"]'),
    masked: (sheet) => maskedField(sheet.locator('[data-testid="param-row-password"]')),
    valueControl: (sheet) => sheet.locator('[data-testid="param-row-password"] [data-slot="input-group"] input'),
    stored: (block) => block.values.password,
    cleared: '',
    presetsDefault: false,
  },
  {
    title: 'a stored secret number',
    nodeId: SETTER_NODE,
    previousControl: (sheet) => sheet.locator('[data-testid="varset-secret-checkbox-0"]'),
    masked: (sheet) => maskedField(sheet),
    valueControl: (sheet) => sheet.locator('[data-testid="scalar-edit-input"]'),
    stored: (block) =>
      (block.values.variables as Record<string, unknown> | undefined)?.saved_pin,
    cleared: '0',
    presetsDefault: true,
  },
]

/** The state both dismissals leave in a block dialog row. */
async function expectRowKept(page: Page, masked: Locator, how: string): Promise<void> {
  await expect(configSheet(page), `${how}: the block dialog stays open`).toBeVisible()
  await expect(masked, `${how}: the row is still masked`).toHaveCount(1)
  await expect(valueEditorSheet(page), `${how}: no editor opened`).toHaveCount(0)
  await expect(masked, `${how}: focus is back on the masked field`).toBeFocused()
  expect(await focusIsOnPageBody(page), `${how}: focus is on the page body`).toBe(false)
}

/** The state both dismissals leave in the Edit window. */
async function expectWindowKept(page: Page, win: Locator, how: string): Promise<void> {
  await expect(win, `${how}: the Edit window stays open`).toBeVisible()
  await expect(windowMasked(win), `${how}: the field is still masked`).toHaveCount(1)
  await expect(windowMasked(win), `${how}: focus is back on the masked field`).toBeFocused()
  expect(await focusIsOnPageBody(page), `${how}: focus is on the page body`).toBe(false)
}

/** Enter on the row pencil opens the Edit window at once with the masked field; no question. */
async function openWithEnter(page: Page): Promise<Locator> {
  const row = variableRow(page, SECRET_VARIABLE)
  await expect(row).toBeVisible()
  await tabTo(page, row, pencil(page, SECRET_VARIABLE))
  await page.keyboard.press('Enter')
  const win = page.locator('[data-testid="variable-create-modal"][data-window-mode="edit"]')
  await expect(win).toBeVisible()
  await expect(win.locator('[data-testid="create-variable-name"]')).toHaveValue(SECRET_VARIABLE)
  await expect(editQuestion(page), 'the pencil asks nothing').toHaveCount(0)
  await expect(windowMasked(win)).toHaveCount(1)
  return win
}

let testId = ''

test.describe('V-PROTECTED-VALUE-FOCUS-FUNCTIONAL', () => {
  test.beforeEach(async ({ page }) => {
    // A stored secret shows masked only while the unmask settings are off.
    await page.request.put(`${BACKEND_URL}/admin/secret-masking`, { data: MASKING_ALL_OFF })
    testId = await importValidateAndNavigate(page, FIXTURE)
  })

  test.afterEach(async ({ page }) => {
    if (testId) await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
    testId = ''
  })

  for (const surface of BLOCK_SURFACES) {
    test(`block dialog, ${surface.title}: Cancel and Escape keep the value and return focus to the masked field`, async ({
      page,
    }) => {
      test.setTimeout(120_000)
      const before = await savedBlock(page, testId, surface.nodeId)
      expect(String(surface.stored(before)), 'the import sealed the value').toMatch(SEALED)

      const sheet = await openBlockDialog(page, surface.nodeId)
      const masked = surface.masked(sheet)
      await expect(masked).toHaveCount(1)

      await tabTo(page, surface.previousControl(sheet), masked)
      await askWithEnter(page)
      await answerWithKeyboard(page, 'Cancel')
      await expectRowKept(page, masked, 'Cancel')

      await askWithEnter(page)
      await dismissWithEscape(page)
      await expectRowKept(page, masked, 'Escape')

      // The block's Save needs a change of its own; the note also proves the Save landed.
      await sheet.locator('[data-testid="element-description-input"]').fill(SAVED_NOTE)
      await saveBlockAndTest(page)

      const after = await savedBlock(page, testId, surface.nodeId)
      expect(after.description, 'the Save reached the saved test').toBe(SAVED_NOTE)
      expect(surface.stored(after), 'the saved test still holds the same sealed value').toBe(
        surface.stored(before),
      )
    })

    test(`block dialog, ${surface.title}: Delete & Edit drops the stored value and focuses the row's own value control`, async ({
      page,
    }) => {
      test.setTimeout(120_000)
      const before = await savedBlock(page, testId, surface.nodeId)
      const sheet = await openBlockDialog(page, surface.nodeId)
      const masked = surface.masked(sheet)
      const control = surface.valueControl(sheet)

      await tabTo(page, surface.previousControl(sheet), masked)
      await askWithEnter(page)
      await answerWithKeyboard(page, 'Delete & Edit')

      await expect(masked, 'the row is no longer masked').toHaveCount(0)
      await expect(valueEditorSheet(page), 'the row edits in place, no editor sheet opens').toHaveCount(0)
      await expect(control).toHaveValue(surface.cleared)
      await expect(control, "focus is on the row's own value control").toBeFocused()
      expect(await focusIsOnPageBody(page), 'focus is on the page body').toBe(false)

      await saveBlockAndTest(page)
      const after = await savedBlock(page, testId, surface.nodeId)
      if (!surface.presetsDefault) {
        expect(
          holdsNothing(surface.stored(after)),
          `the saved test holds no value: ${JSON.stringify(surface.stored(after))}`,
        ).toBe(true)
      } else {
        expect(surface.stored(after), 'the old sealed value is gone').not.toBe(surface.stored(before))
        const plain = await plaintextBlock(page, testId, surface.nodeId)
        expect(surface.stored(plain), 'the saved test holds the preset').toBe(0)
      }
    })
  }

  test('Edit window: Cancel and Escape keep the value and return focus to the masked field', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await expandVariableManager(page)
    const before = (await savedVariables(page, testId))[SECRET_VARIABLE]?.value
    expect(String(before), 'the import sealed the value').toMatch(SEALED)

    const win = await openWithEnter(page)
    await tabTo(page, valueSwitch(win), windowMasked(win))
    await askWithEnter(page)
    await answerWithKeyboard(page, 'Cancel')
    await expectWindowKept(page, win, 'Cancel')

    await askWithEnter(page)
    await dismissWithEscape(page)
    await expectWindowKept(page, win, 'Escape')
    await cancelWindow(page, win)

    // The test's Save needs a change; an edit of another variable gives it one.
    const plain = await openEditWindow(page, PLAIN_VARIABLE)
    await expect(valueEditor(page, plain)).toHaveValue('7')
    await setWindowValue(page, plain, 99)
    await saveWindow(page, plain)
    await expect(variableRow(page, PLAIN_VARIABLE).locator('[data-testid^="variable-value-"]')).toHaveText('99')
    await saveTest(page)

    const after = await savedVariables(page, testId)
    expect(Number(after[PLAIN_VARIABLE]?.value), 'the Save reached the saved test').toBe(99)
    expect(after[SECRET_VARIABLE]?.value, 'the saved test still holds the same sealed value').toBe(
      before,
    )
  })

  test('Edit window: Delete & Edit empties the field and keeps focus on it', async ({ page }) => {
    test.setTimeout(120_000)
    await expandVariableManager(page)

    const win = await openWithEnter(page)
    await tabTo(page, valueSwitch(win), windowMasked(win))
    await askWithEnter(page)
    await answerWithKeyboard(page, 'Delete & Edit')

    await expect(windowMasked(win), 'the field is no longer masked').toHaveCount(0)
    const field = valueEditor(page, win)
    await expect(field).toHaveValue('')
    await expect(field, 'focus is on the empty value field').toBeFocused()
    expect(await focusIsOnPageBody(page), 'focus is on the page body').toBe(false)

    await saveWindow(page, win)
    await saveTest(page)

    const after = (await savedVariables(page, testId))[SECRET_VARIABLE]?.value
    expect(holdsNothing(after), `the saved test holds no value: ${JSON.stringify(after)}`).toBe(true)
  })
})
