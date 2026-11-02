/**
 * V-FN-EDIT-PUBLISH-CONTRACT (functional): a re-pin refreshes the contract.
 *
 * Publishing an edit-mode draft via "Publish and set New" re-pins the instance
 * to the new version AND refreshes its cached resolved I/O, so re-opening the
 * config modal renders the new version's full input + output contract instead
 * of empty sections.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import {
  publishLibraryFunction,
  rawPersistTest,
  openTest,
  dismissLoadDialogIfPresent,
} from '../../helpers/fn-seed'

const FN_NODE_ID = 'fn-edit-publish-contract-1'
const SRC_INPUT = 'src_input'
const ADDED_OUTPUT = 'added_output'

/** A Shared instance seeded ALREADY in edit mode, whose draft kept the source
 *  input and added one output (a MINOR bump). */
function editModeSharedNode(functionId: string, name: string): Record<string, unknown> {
  const draft = {
    name,
    description: '',
    tags: [],
    inputs: [{ name: SRC_INPUT, type: 'string', required: false }],
    outputs: [{ name: ADDED_OUTPUT, type: 'string' }],
    dependencies: { functions: [], plugins: [] },
    workflow: { nodes: [], edges: [] },
  }
  return {
    id: FN_NODE_ID,
    type: 'workflowNode',
    position: { x: 320, y: 200 },
    data: {
      label: name,
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId,
      functionVersion: '1.0.0',
      originalLibraryName: name,
      category: 'function',
      version: '1.0.0',
      hasNewerVersion: false,
      editMode: true,
      upstreamLink: { functionId, sourceVersion: '1.0.0' },
      draft,
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: {}, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

test.describe('V-FN-EDIT-PUBLISH-CONTRACT (functional)', () => {
  test('set New re-pin shows the new version input + output contract', async ({ page, request }) => {
    // Source v1.0.0 declares the input only; the draft adds the output.
    const fn = await publishLibraryFunction(request as APIRequestContext, {
      inputs: [{ name: SRC_INPUT, type: 'string', required: false }],
      outputs: [],
      changelog: 'Initial release',
      // The edit-mode publish dialog requires non-empty details (pre-filled from
      // the source version), so seed it or Publish stays disabled.
      details: 'Initial docs',
    })
    const testId = await rawPersistTest(request as APIRequestContext, {
      nodes: [editModeSharedNode(fn.functionId, fn.name)],
      edges: [{ id: `e-start-${FN_NODE_ID}`, source: 'start-node', target: FN_NODE_ID }],
    })

    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)
    await waitForCanvasLoad(page)

    // Publish the edit-mode draft.
    await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
    const editDialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(editDialog).toBeVisible({ timeout: 10_000 })
    await editDialog
      .locator('[data-testid="publish-edit-mode-changelog-input"]')
      .fill('Contract guard: added an output')

    const publishBtn = editDialog.getByRole('button', { name: 'Publish' })
    await expect(publishBtn).not.toHaveAttribute('aria-disabled', 'true')
    await publishBtn.click()

    // Choose "Publish and set New" to re-pin this instance to the new version.
    const outcome = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
    await expect(outcome).toBeVisible({ timeout: 10_000 })
    await outcome.getByRole('button', { name: 'Publish and set New' }).click()
    await expect(outcome).toBeHidden({ timeout: 10_000 })

    // Re-open the instance config modal.
    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await node.locator('button').first().dblclick()
    const config = configSheet(page)
    await expect(config).toBeVisible({ timeout: 10_000 })

    // The re-pinned version's full contract renders.
    await expect(config.getByText(SRC_INPUT)).toBeVisible()
    await expect(config.getByText(ADDED_OUTPUT)).toBeVisible()
  })
})
