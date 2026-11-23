/**
 * V-FN-PUBLISH-RELOAD-NAME-FUNCTIONAL: a Function published from a saved Test's canvas keeps its library name after a reload
 * Wireframe: none (the existing Publish dialog and Shared Function window)
 * Design Decisions: CANVAS-209
 * REQ: REQ-3.1.1.5
 *
 * Seed: one Test holding a Local Function Block, saved through POST /tests. The publish creates the
 * library Function; the Test and the Function are deleted after.
 *
 * Pass Criteria:
 * 1. Publish the Local Function from the saved Test's canvas under a library name unlike its Block name,
 *    with no other edit.
 * 2. Reload: the server copy stores the library name on the now Shared Function Block.
 * 3. Its window shows `From library: <name>`, the Changelog and Documentation dialogs are titled with the name and
 *    the link opens the library on it; after the Function is deleted from the library and the Test is
 *    reloaded, the banner reads `Function '<name>' is no longer available in the library`.
 */

import { randomUUID } from 'node:crypto'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { cleanUp, closeBlockWindow, createTest, localFunctionBlock, logBlock, storedBlock } from '../../helpers/fn-block'
import { dismissLoadDialogIfPresent, openTest } from '../../helpers/fn-seed'
import { expectLibraryName, expectMissingBanner } from '../../helpers/library-name'
import { openFunctionBlockSheet, publishToLibrary } from '../../helpers/workbench'

const BLOCK_ID = 'fn-local-publish'

test.describe('V-FN-PUBLISH-RELOAD-NAME-FUNCTIONAL: the published Block keeps its library name', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds, functionIds)
  })

  test('publish from the canvas, reload, and every library surface names the Function', async ({ page, request }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    const library = `zz-b29-pub-${randomUUID().slice(0, 6)}`
    const testId = await createTest(request, {
      name: `zz-b29-publish-reload-${randomUUID().slice(0, 8)}`,
      nodes: [
        localFunctionBlock(BLOCK_ID, 'Local health check', {
          nodes: [logBlock('fn-log', 'Inner log', "'inside the Function'")],
        }),
      ],
    })
    testIds.push(testId)

    await test.step('1. publish from the saved Test with no other edit', async () => {
      await openTest(page, testId)
      functionIds.push(await publishToLibrary(page, BLOCK_ID, library))
    })

    await test.step('2. the reloaded server copy stores the library name', async () => {
      const data = await storedBlock(request, testId, BLOCK_ID)
      expect(data.functionLifecycle).toBe('shared')
      expect(data.functionId).toBe(functionIds[0])
      expect(data.originalLibraryName, 'the server copy keeps the library name').toBe(library)
      await openTest(page, testId)
    })

    await test.step('3. the window, its library actions and the missing banner name it', async () => {
      const sheet = await openFunctionBlockSheet(page, BLOCK_ID)
      await expectLibraryName(page, sheet, library)
      await closeBlockWindow(sheet)

      const deleted = await request.delete(`${BACKEND_URL}/functions/${functionIds[0]}?cascade=true`)
      expect(deleted.ok(), `DELETE /functions: ${deleted.status()}`).toBeTruthy()
      functionIds.splice(0)
      await openTest(page, testId)
      await dismissLoadDialogIfPresent(page)
      await expectMissingBanner(await openFunctionBlockSheet(page, BLOCK_ID), library)
    })
  })
})
