/**
 * V-FN-PUBLISH-BUMP-DEFAULT-KIND (functional): a changed default or output Kind suggests a minor version
 * Wireframe: none (functional)
 * Design Decisions: N/A (a changed input default or output Kind suggests a minor version)
 * REQ: REQ-3.1.2.2, REQ-3.1.2.8
 *
 * Seed (API): a `zz-` library Function at 1.0.0 with the optional string input `msg` (default `a`)
 * read by a body Log, or with the string output `res` (Literal, default `x`), and a `zz-` Test
 * holding its instance already in edit mode with a draft equal to 1.0.0. The thing under test (the
 * draft change in the parameter's Edit window and the publish suggestion) is done through the UI.
 *
 * Pass Criteria:
 * 1. The draft's `msg` default is changed from `a` to `b` in its Edit window and saved; the publish
 *    dialog suggests 1.1.0 with the minor chip.
 * 2. The draft's `msg` default is set to null with Set to null in its Edit window; the dialog
 *    suggests 1.1.0 with the minor chip.
 * 3. The draft's `res` default is changed from `x` to `y` in its Edit window; the dialog suggests
 *    1.1.0 with the minor chip.
 * 4. The draft's `res` Kind is changed to Expression in its Edit window; its row carries the
 *    expression badge and the dialog suggests 1.1.0 with the minor chip.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import {
  createValidTest,
  editModeSharedNode,
  logNode,
  openTest,
  publishLibraryFunction,
  startEdge,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { digIn, popToBreadcrumbSegment } from '../../helpers/workbench'
import {
  expectWindowValue,
  insertCodeValue,
  openEditWindow,
  rekindInWindow,
  saveWindow,
  setWindowValue,
  variableRow,
} from '../../helpers/variable-create'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-bump-default'
const MSG_INPUT = { name: 'msg', type: 'string', required: false, default: 'a', description: '' }
const RES_OUTPUT = { name: 'res', type: 'string', default: 'x', description: '' }

function body(): Record<string, unknown> {
  return {
    nodes: [logNode('bump-log', 'Print Msg', 'msg', { x: 200, y: 180 })],
    edges: [startEdge('bump-log')],
  }
}

function outputBody(): Record<string, unknown> {
  return {
    nodes: [logNode('bump-log', 'Print Body', "'body'", { x: 200, y: 180 })],
    edges: [startEdge('bump-log')],
  }
}

async function cleanup(
  request: APIRequestContext,
  testId: string,
  fn: SeededLibraryFunction | null,
): Promise<void> {
  await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  if (fn) await request.delete(`${BACKEND_URL}/functions/${fn.functionId}?cascade=true`).catch(() => undefined)
}

/** Change a string parameter default in its Edit window (the pencil opens it on the stored default) and save. */
async function editStringDefault(page: Page, name: string, from: string, value: string | null): Promise<void> {
  const win = await openEditWindow(page, name)
  await expectWindowValue(win, from)
  await setWindowValue(page, win, value)
  await saveWindow(page, win)
}

async function openEditModePublish(page: Page): Promise<Locator> {
  await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

/** Pop to the Test, open the publish dialog and expect the minor suggestion. */
async function expectMinorSuggestion(page: Page, testName: string): Promise<void> {
  await popToBreadcrumbSegment(page, testName)
  await expect(page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)).toBeVisible()
  const dialog = await openEditModePublish(page)
  // A changed default or output Kind is a minor change, not a patch.
  const trigger = dialog.locator('[data-testid="version-dropdown-trigger"]')
  await expect(trigger).toContainText('1.1.0', { timeout: 10_000 })
  await expect(trigger.locator('[data-testid="bump-chip-minor"]')).toBeVisible()
}

test.describe('V-FN-PUBLISH-BUMP-DEFAULT-KIND (functional): default and Kind changes suggest minor', () => {
  let testId = ''
  let fn: SeededLibraryFunction | null = null

  test.afterEach(async ({ request }) => {
    await cleanup(request, testId, fn)
    testId = ''
    fn = null
  })

  /** Seed the library Function and a Test holding it in edit mode, open it and drill in. */
  async function openDraft(
    page: Page,
    request: APIRequestContext,
    params: { inputs?: Array<Record<string, unknown>>; outputs?: Array<Record<string, unknown>> },
    workflow: Record<string, unknown>,
  ): Promise<string> {
    const tag = randomUUID().slice(0, 8)
    fn = await publishLibraryFunction(request, {
      name: `zz-bump-${tag}`,
      inputs: params.inputs,
      outputs: params.outputs,
      workflow,
    })
    const testName = `zz-fn-bump-default-${tag}`
    testId = await createValidTest(request, {
      name: testName,
      nodes: [
        editModeSharedNode(FN_NODE_ID, {
          functionId: fn.functionId,
          functionVersion: fn.version,
          label: fn.name,
          originalLibraryName: fn.name,
          draftInputs: params.inputs,
          draftOutputs: params.outputs,
          draftWorkflow: workflow,
        }),
      ],
      edges: [startEdge(FN_NODE_ID)],
    })
    await openTest(page, testId)
    await digIn(page, FN_NODE_ID)
    await expect(page.locator('[data-testid="workflow-node-bump-log"]')).toBeVisible({ timeout: 15_000 })
    return testName
  }

  test('a changed input default suggests a minor version', async ({ page, request }) => {
    const tag = randomUUID().slice(0, 8)
    fn = await publishLibraryFunction(request, {
      name: `zz-bump-${tag}`,
      inputs: [MSG_INPUT],
      workflow: body(),
    })
    const testName = `zz-fn-bump-default-${tag}`
    testId = await createValidTest(request, {
      name: testName,
      nodes: [
        editModeSharedNode(FN_NODE_ID, {
          functionId: fn.functionId,
          functionVersion: fn.version,
          label: fn.name,
          originalLibraryName: fn.name,
          draftInputs: [MSG_INPUT],
          draftWorkflow: body(),
        }),
      ],
      edges: [startEdge(FN_NODE_ID)],
    })

    await openTest(page, testId)
    await digIn(page, FN_NODE_ID)
    await expect(page.locator('[data-testid="workflow-node-bump-log"]')).toBeVisible({ timeout: 15_000 })
    await editStringDefault(page, 'msg', 'a', 'b')
    await expect(variableRow(page, 'msg').locator('[data-testid^="variable-value-"]')).toContainText('b')

    await popToBreadcrumbSegment(page, testName)
    await expect(page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)).toBeVisible()
    const dialog = await openEditModePublish(page)

    // A changed input default is a minor change, not a patch.
    const trigger = dialog.locator('[data-testid="version-dropdown-trigger"]')
    await expect(trigger).toContainText('1.1.0', { timeout: 10_000 })
    await expect(trigger.locator('[data-testid="bump-chip-minor"]')).toBeVisible()
  })

  test('an input default set to null suggests a minor version', async ({ page, request }) => {
    const testName = await openDraft(page, request, { inputs: [MSG_INPUT] }, body())
    // Per VMGR-111: Set to null in the Edit window sets the default to null.
    await editStringDefault(page, 'msg', 'a', null)
    await expect(variableRow(page, 'msg').locator('[data-testid^="variable-value-"]')).toHaveText('null')
    await expectMinorSuggestion(page, testName)
  })

  test('a changed output default suggests a minor version', async ({ page, request }) => {
    const testName = await openDraft(page, request, { outputs: [RES_OUTPUT] }, outputBody())
    await editStringDefault(page, 'res', 'x', 'y')
    await expect(variableRow(page, 'res').locator('[data-testid^="variable-value-"]')).toContainText('y')
    await expectMinorSuggestion(page, testName)
  })

  test('an output changed from Literal to Expression suggests a minor version', async ({ page, request }) => {
    const testName = await openDraft(page, request, { outputs: [RES_OUTPUT] }, outputBody())
    const win = await openEditWindow(page, 'res')
    // Per VMGR-108: an output's Kind is editable in its Edit window, with a confirm.
    await rekindInWindow(page, win, 'Expression')
    await insertCodeValue(page, "'computed'", win)
    await leaveExpressionEditor(win)
    await saveWindow(page, win)
    await expect(variableRow(page, 'res').locator('[data-testid^="expr-badge-"]')).toHaveCount(1)
    await expectMinorSuggestion(page, testName)
  })
})
