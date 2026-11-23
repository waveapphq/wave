/**
 * V-MCP-RECIPE-FUNCTION-LIBRARY-NAME-FUNCTIONAL: a recipe-built Shared Function Block keeps its library Function's name
 * Wireframe: none (the existing Shared Function window)
 * Design Decisions: CANVAS-209
 * REQ: REQ-3.1.1.5, REQ-5.2.7.4
 *
 * Seed: one library Function published through POST /functions. The Test is made with
 * `create_test_from_recipe`, its Block labeled apart from the library name; everything is deleted after.
 *
 * Pass Criteria:
 * 1. The recipe-built Shared Function Block stores its library Function's name, and its window shows
 *    `From library: <name>`.
 * 2. Library actions use the library name: the Changelog and Documentation dialogs are titled with it and the
 *    From library link opens the library on it.
 * 3. The same after `amend_test_from_recipe`, which writes the name again on a Block that lost it.
 * 4. After the Function is deleted from the library, the banner reads
 *    `Function '<name>' is no longer available in the library`.
 * 5. Each holds in the edit window after the window is changed, the Test saved and reloaded. The read-only
 *    window of a tab watching the Test has no From library link; its Changelog and Documentation dialogs
 *    are titled with the library name.
 */

import { randomUUID } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { deleteTest } from '../../helpers/element-types'
import { closeBlockWindow, createFunction, libraryFunction, logBlock, saveBlockWindow } from '../../helpers/fn-block'
import { dismissLoadDialogIfPresent, openTest } from '../../helpers/fn-seed'
import { expectLibraryName, expectMissingBanner } from '../../helpers/library-name'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { SEL, openWorkbench, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import { openFunctionBlockSheet, saveTest } from '../../helpers/workbench'
import {
  MCP_PORT,
  createFromRecipe,
  freeSlot,
  putWorkflow,
  storedTestDoc,
  tool,
  uniqueName,
  type Doc,
} from './recipe-tool-helpers'

function recipeOf(testName: string, library: string, label: string): string {
  return `test:
  name: ${testName}
  description: A Shared Function Block built from a recipe
flow:
  - function: ${library}
    version: "1.0.0"
    label: ${label}
  - block: log
    settings: {message: done}
`
}

async function functionNode(request: Parameters<typeof storedTestDoc>[0], testId: string): Promise<Doc> {
  const nodes = (await storedTestDoc(request, testId)).workflow.nodes as Doc[]
  const node = nodes.find((item) => item.data?.elementType === 'function')
  expect(node, 'the Shared Function Block is stored').toBeTruthy()
  return node as Doc
}

test.describe('V-MCP-RECIPE-FUNCTION-LIBRARY-NAME-FUNCTIONAL: the library name on a recipe-built Block', () => {
  const tests: string[] = []
  const functions: string[] = []
  const contexts: BrowserContext[] = []

  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const context of contexts.splice(0)) await context.close().catch(() => undefined)
    for (const id of tests.splice(0)) await deleteTest(request, id)
    for (const id of functions.splice(0)) {
      await request.delete(`${BACKEND_URL}/functions/${id}?cascade=true`).catch(() => undefined)
    }
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('create, amend, save and reload, a watching tab and a deleted Function all name the library Function', async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(360_000)
    const library = `zz-b29-lib-${randomUUID().slice(0, 6)}`
    const pin = await createFunction(
      request,
      libraryFunction(library, { nodes: [logBlock('lib-log', 'Library log', "'from the library'")] }),
    )
    functions.push(pin.functionId)
    const testName = uniqueName('zz-b29-library-name')
    const testId = createFromRecipe(recipeOf(testName, library, 'Run the shared check'))
    tests.push(testId)
    const nodeId = String((await functionNode(request, testId)).id)

    await test.step('1 and 2. the created Block stores the name and its window names it', async () => {
      expect((await functionNode(request, testId)).data.originalLibraryName).toBe(library)
      await openTest(page, testId)
      const sheet = await openFunctionBlockSheet(page, nodeId)
      await expectLibraryName(page, sheet, library)
      await closeBlockWindow(sheet)
    })

    await test.step('3. an amend writes the name again', async () => {
      await freeSlot(page, request)
      // A Block that lost its library name gets it back from the amend.
      const workflow = (await storedTestDoc(request, testId)).workflow as Doc
      const stored = (workflow.nodes as Doc[]).find((node) => node.id === nodeId) as Doc
      delete stored.data.originalLibraryName
      await putWorkflow(request, testId, workflow)

      const amended = tool('amend_test_from_recipe', {
        test_ref: testId,
        recipe: recipeOf(testName, library, 'Run the amended check'),
      })
      expect(amended.amended, JSON.stringify(amended)).toBe(true)
      const node = await functionNode(request, testId)
      expect(node.data.label).toBe('Run the amended check')
      expect(node.data.originalLibraryName, 'the amend stamps the library name').toBe(library)

      await openTest(page, testId)
      const sheet = await openFunctionBlockSheet(page, nodeId)
      await expectLibraryName(page, sheet, library)
      await closeBlockWindow(sheet)
    })

    await test.step('5. edit the window, save the Test and reload', async () => {
      await openTest(page, testId)
      const sheet = await openFunctionBlockSheet(page, nodeId)
      await sheet.locator('[data-testid="function-name-input"]').fill('Renamed in the window')
      await saveBlockWindow(sheet)
      await saveTest(page)
      expect((await functionNode(request, testId)).data.originalLibraryName).toBe(library)
      await openTest(page, testId)
      const reloaded = await openFunctionBlockSheet(page, nodeId)
      await expectLibraryName(page, reloaded, library)
      await closeBlockWindow(reloaded)
    })

    await test.step('5. the read-only window of a watching tab', async () => {
      await openTest(page, testId)
      await waitUntilHeld(request)
      const watcher = await openWorkbench(browser)
      contexts.push(watcher.context)
      await expect(watcher.page.locator(SEL.canvasReadOnly)).toBeVisible({ timeout: 15_000 })
      const sheet = await openFunctionBlockSheet(watcher.page, nodeId)
      await expectLibraryName(watcher.page, sheet, library, true)
      await watcher.context.close()
      contexts.splice(0)
    })

    await test.step('4. with the Function deleted, the banner names it', async () => {
      const deleted = await request.delete(`${BACKEND_URL}/functions/${pin.functionId}?cascade=true`)
      expect(deleted.ok(), `DELETE /functions/${pin.functionId}: ${deleted.status()}`).toBeTruthy()
      functions.splice(0)
      await openTest(page, testId)
      await dismissLoadDialogIfPresent(page)
      const sheet = await openFunctionBlockSheet(page, nodeId)
      await expectMissingBanner(sheet, library)
    })
  })
})
