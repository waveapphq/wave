/**
 * V-CANVAS-FN-CFG-01: Function instance config modal - Local variant layout
 * Design Decisions: CANVAS-208 (Local variant: inline-editable NameField, no version selector, lifecycle badge NOT
 *   rendered inside the modal), CANVAS-207 (one Block window: Save gate and the 64-character description cap)
 * REQ: REQ-3.1.1.5 (Function instance parameter configuration)
 *
 * Pass Criteria:
 *   1. Modal opens on double-click of a Function node.
 *   2. Labeled `Name` row: `<label>` above an editable `NameField`; the input
 *      caps at 32 chars (`MAX_BLOCK_NAME_LENGTH`).
 *   3. Labeled `Description` row: `<label>` above an editable description
 *      textarea with the placeholder `Optional. Per-instance description for this Function.`
 *   4. INPUT PARAMETERS table has column headers `Name / Type / Value` and
 *      renders one row per declared input.
 *   5. OUTPUT VARIABLES table has column headers `Name / Type / Assign to`
 *      and renders one row per declared output.
 *   6. Footer: Profiles, Cancel and Save (Local; no Changelog / Details).
 *   7. NO L lifecycle badge inside the modal - the badge lives on the canvas
 *      node status bar (`node-function-lifecycle-badge`).
 *   8. Modal carries the shared right-edge resize handle.
 *   9. Clicking the `Name` caption puts the cursor in that sheet's Name field and
 *      `Description` in its Description field; with two Function sheets open, a
 *      caption click in the second sheet focuses the second sheet's field.
 *   10. The Description refuses a 65th character: 70 typed characters leave 64, the counter reads `64/64`
 *      in the destructive state, and after the window Save and the Test Save the stored Block description
 *      is those 64 characters.
 *
 * Phase: no-data (seeds via API so the DB state is irrelevant).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { validateTest } from '../../helpers/fn-seed'
import { storedBlock } from '../../helpers/list-fields'
import { configSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'

const FN_NODE_ID = 'fn-cfg-local-1'
const SECOND_FN_NODE_ID = 'fn-cfg-local-2'
const DESCRIPTION_PLACEHOLDER = 'Optional. Per-instance description for this Function.'
const DESCRIPTION_CAP = 64

function buildSeed(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'V-CANVAS-FN-CFG-01 seed: Local Function with one input + one output',
    workflow: {
      nodes: [
        {
          id: FN_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: 'Function_1',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: 'hello' },
              outputBindings: {},
              profileBindings: [],
            },
            localDefinition: {
              name: 'Function_1',
              description: 'seed description',
              workflow: { nodes: [], edges: [] },
              inputs: [
                { name: 'message', type: 'string', required: true },
              ],
              outputs: [{ name: 'result', type: 'string' }],
              variables: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [{ id: 'e-start', source: 'start-node', target: FN_NODE_ID }],
    },
    variables: {},
    metadata: {},
  }
}

async function seed(page: Page): Promise<string> {
  const name = `zz-11541-s2-fn-cfg-01-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const resp = await page.request.post(`${BACKEND_URL}/tests`, { data: buildSeed(name) })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  const testId = body.data.id as string
  expect((await validateTest(page.request, testId)).errors, 'the seed validates with zero errors').toEqual([])
  return testId
}

function emptyLocalFunction(id: string, label: string, y: number): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 300, y },
    data: {
      label,
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      category: 'function',
      version: '1.0.0',
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: {}, outputBindings: {}, profileBindings: [] },
      localDefinition: {
        name: label,
        description: `${label} description`,
        workflow: { nodes: [], edges: [] },
        inputs: [],
        outputs: [],
        variables: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

async function seedTwoFunctions(page: Page): Promise<string> {
  const name = `zz-11541-s2-fn-cfg-01-two-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name,
      version: '1.0.0',
      description: 'V-CANVAS-FN-CFG-01 seed: two Local Functions',
      workflow: {
        nodes: [
          emptyLocalFunction(FN_NODE_ID, 'Function_1', 200),
          emptyLocalFunction(SECOND_FN_NODE_ID, 'Function_2', 420),
        ],
        edges: [
          { id: 'e-start', source: 'start-node', target: FN_NODE_ID },
          { id: 'e-fn', source: FN_NODE_ID, target: SECOND_FN_NODE_ID },
        ],
      },
      variables: {},
      metadata: {},
    },
  })
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  const testId = (await resp.json()).data.id as string
  expect((await validateTest(page.request, testId)).errors, 'the seed validates with zero errors').toEqual([])
  return testId
}

/** Open a Function Block's sheet; the dispatched double-click reaches a Block an open sheet covers. */
async function openFunctionSheet(page: Page, nodeId: string, label: string): Promise<Locator> {
  const sheet = page.locator(`section[aria-label="${label} configuration"]`)
  const block = page.locator(`[data-testid="workflow-node-${nodeId}"]`).locator('button').first()
  await expect(async () => {
    if (!(await sheet.isVisible())) await block.dispatchEvent('dblclick')
    await expect(sheet).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 15_000 })
  return sheet
}

/** The window part under one heading: the heading and what follows it. */
function sectionOf(sheet: Locator, heading: string): Locator {
  return sheet.locator('h3').filter({ hasText: new RegExp(`^${heading}$`) }).locator('xpath=..')
}

function caption(sheet: Locator, text: 'Name' | 'Description'): Locator {
  return sheet.locator('label').filter({ hasText: new RegExp(`^${text}$`) })
}

/** Each caption of the sheet puts the cursor in that sheet's own field. */
async function expectCaptionsFocusTheirFields(sheet: Locator): Promise<void> {
  const name = sheet.getByTestId('function-name-input')
  const description = sheet.getByTestId('element-description-input')
  await caption(sheet, 'Description').click()
  await expect(description).toBeFocused()
  await caption(sheet, 'Name').click()
  await expect(name).toBeFocused()
  await caption(sheet, 'Description').click()
  await expect(description).toBeFocused()
}

async function open(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function deleteTest(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  if (testId) await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
}

test.describe('V-CANVAS-FN-CFG-01: Function modal - Local variant', () => {
  let testId = ''

  test.afterEach(async ({ page }) => {
    await deleteTest(page, testId)
    testId = ''
  })

  test('Local modal opens on double-click with the shipped layout', async ({ page }) => {
    testId = await seed(page)
    await open(page, testId)

    const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(fnNode).toBeVisible()
    // Body of the node is the double-click target.
    await fnNode.locator(`[data-testid="workflow-node-body-${FN_NODE_ID}"]`).dblclick()

    // Modal opens. Use the editable name input as the open signal.
    const nameInput = page.locator('[data-testid="function-name-input"]')
    await expect(nameInput).toBeVisible({ timeout: 10_000 })

    // (2) Labeled Name row: the caption above an editable NameField.
    await expect(caption(configSheet(page), 'Name')).toBeVisible()
    // NameField renders as <textarea rows={1}> per the shared NameField primitive.
    const nameTag = await nameInput.evaluate((el) => el.tagName)
    expect(['INPUT', 'TEXTAREA']).toContain(nameTag)
    expect(await nameInput.getAttribute('maxlength')).toBe('32')

    // (3) Labeled Description row.
    await expect(caption(configSheet(page), 'Description')).toBeVisible()
    const description = page.locator('[data-testid="element-description-input"]')
    await expect(description).toBeVisible()
    await expect(description).toHaveAttribute('placeholder', DESCRIPTION_PLACEHOLDER)

    // (4) INPUT PARAMETERS table column headers + at least one declared row.
    const inputsSection = sectionOf(configSheet(page), 'Input Parameters')
    await expect(inputsSection).toBeVisible()
    const inputHeaders = await inputsSection.locator('thead th').allTextContents()
    expect(inputHeaders).toEqual(['', 'Parameter', 'Type', 'Value'])
    const messageRow = page.locator('[data-testid="param-row-message"]')
    await expect(messageRow).toBeVisible()
    // Required input params carry a trailing red asterisk on the name.
    await expect(messageRow).toContainText('*')

    // (5) OUTPUT VARIABLES: the leading info column keeps both tables aligned; Secret marks the bound variable (SECUI-3).
    const outputsSection = sectionOf(configSheet(page), 'Output Variables')
    await expect(outputsSection).toBeVisible()
    const outputHeaders = await outputsSection.locator('thead th').allTextContents()
    expect(outputHeaders).toEqual(['', 'Parameter', 'Type', 'Secret', 'Assign to'])
    await expect(page.locator('[data-testid="output-row-result"]')).toBeVisible()

    // (6) Footer: Profiles, Cancel and Save on a Local Function; Changelog and Details are library actions.
    const footer = configSheet(page)
    await expect(footer.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(footer.getByRole('button', { name: 'Save' })).toBeVisible()
    await expect(footer.getByRole('button', { name: 'Profiles' })).toBeVisible()
    await expect(footer.getByRole('button', { name: 'Changelog' })).toHaveCount(0)
    await expect(footer.getByRole('button', { name: 'Details' })).toHaveCount(0)

    // (7) The lifecycle badge lives only on the canvas node status bar, never inside the window.
    const dialog = configSheet(page)
    await expect(dialog.locator('[data-testid="function-lifecycle-badge"]')).toHaveCount(0)

    // (8) Shared right-edge resize handle is present.
    await expect(dialog.locator('[data-testid="dialog-resize-handle"]')).toBeVisible()

    // (10) The Description refuses a 65th character (CANVAS-207).
    const typed = 'd'.repeat(DESCRIPTION_CAP + 6)
    const kept = typed.slice(0, DESCRIPTION_CAP)
    await expect(description).toHaveAttribute('maxlength', String(DESCRIPTION_CAP))
    await description.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Delete')
    await expect(description).toHaveValue('')
    await description.pressSequentially(typed)
    await expect(description).toHaveValue(kept)
    const counter = dialog.getByTestId('element-description-input-counter')
    await expect(counter).toHaveText(`${DESCRIPTION_CAP}/${DESCRIPTION_CAP}`)
    await expect(counter).toHaveAttribute('data-state', 'destructive')
    await saveBlockSheet(dialog)
    await saveTest(page)
    const stored = await storedBlock(page.request, testId, FN_NODE_ID)
    expect(stored.description, 'the stored description is the 64 characters the window kept').toBe(kept)
  })

  test('the Name and Description captions focus their own sheet\'s fields, also with two sheets open', async ({
    page,
  }) => {
    testId = await seedTwoFunctions(page)
    await open(page, testId)

    // (9) One sheet: each caption focuses its own field.
    const first = await openFunctionSheet(page, FN_NODE_ID, 'Function_1')
    await expectCaptionsFocusTheirFields(first)

    // (9) Two sheets: a caption click in the second sheet focuses the second sheet's field.
    const second = await openFunctionSheet(page, SECOND_FN_NODE_ID, 'Function_2')
    await expect(page.locator('[data-testid="element-config-sheet"]')).toHaveCount(2)
    await expect(second.getByTestId('function-name-input')).toHaveValue('Function_2')
    await caption(second, 'Name').click()
    await expect(second.getByTestId('function-name-input')).toBeFocused()
    await expect(first.getByTestId('function-name-input')).not.toBeFocused()
    await caption(second, 'Description').click()
    await expect(second.getByTestId('element-description-input')).toBeFocused()
    await expect(first.getByTestId('element-description-input')).not.toBeFocused()
  })
})
