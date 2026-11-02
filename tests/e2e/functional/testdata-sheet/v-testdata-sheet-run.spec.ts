/**
 * V-TESTDATA-SHEET-RUN: test data and a running test
 * Design Decisions: TDATA-1, TDATA-2, TDATA-5, FIO-2
 * REQ: REQ-3.4.3.2, REQ-3.4.1.10, REQ-5.2.4.12
 *
 * Two things only a run can prove: that testdata://<folder>/<file> resolves to
 * the test's own folder and hands a block the bytes that were uploaded, and
 * that test data cannot be changed while the test is running.
 *
 * Each case creates its own Test through POST /tests and deletes it in
 * teardown; the delete cascades and removes the test's data folder.
 *
 * Pass Criteria:
 * 1. A file uploaded through the API shows in the sheet before the run.
 * 2. The run passes and the Read block's Content is exactly the body the spec
 *    uploaded - a value written by this test, not a constant in the fixture.
 * 3. The bound session variable carries the same body.
 * 4. While the test runs, creating a folder is refused with the server's exact
 *    message on the sheet's blocked notice, and nothing is created.
 * 5. Once the run ends the same action succeeds and the folder appears in the
 *    listing.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/testdata-sheet/v-testdata-sheet-run.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogLines, waitForLogText } from '../../helpers/log-reader'
import { selectEnvironment } from '../../helpers/workbench'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import {
  createOwnTest,
  deleteOwnTest,
  fileRowOf,
  folderRowOf,
  loadFixture,
  marker,
  openSheet,
  openWorkbench,
  saveNameDialog,
  SHEET,
} from './helpers'
import {
  createTestDataFolder,
  listTestDataPaths,
  uploadTestData,
} from '../../helpers/testdata'

const RESOLVE_NODES = ['fileio-read-testdata', 'log-payload', 'log-resolve-done'] as const
const RESOLVE_BOOKEND = 'testdata-resolve-done'

async function annotateFailure(page: Page, verdict: string | null): Promise<void> {
  if (verdict === 'passed') return
  const nodeStatuses = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="workflow-node-"]')).map((node) => ({
      testId: node.getAttribute('data-testid'),
      status: node.getAttribute('data-execution-status'),
    })),
  )
  test.info().annotations.push({ type: 'workflow-status', description: verdict ?? 'null' })
  test.info().annotations.push({
    type: 'node-statuses',
    description: JSON.stringify(nodeStatuses),
  })
  test.info().annotations.push({
    type: 'error-logs',
    description: JSON.stringify(
      (await getLogLines(page)).filter(
        (line) => line.startsWith('[ERROR]') || line.startsWith('[WARN]'),
      ),
    ),
  })
}

let ownTestId: string | null = null

test.afterEach(async ({ request }) => {
  await deleteOwnTest(request, ownTestId)
  ownTestId = null
})

test.describe('Test Data sheet - the run', () => {
  test('a run resolves testdata://folder/file and the block reads the uploaded bytes', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    const own = await createOwnTest(page, loadFixture('resolve.fixture.json'))
    ownTestId = own.id
    // The body is written by this spec, so the run cannot pass on a constant.
    const payload = marker('payload-body')
    await createTestDataFolder(request, own.id, 'fixtures')
    await uploadTestData(request, own.id, 'fixtures', 'payload.txt', payload, {
      mimeType: 'text/plain',
    })

    await openWorkbench(page, own.id)

    await test.step('1. the sheet lists the uploaded file', async () => {
      const sheet = await openSheet(page)
      await expect(fileRowOf(page, 'fixtures/payload.txt')).toBeVisible()
      await sheet.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(page.locator(SHEET)).toHaveCount(0)
    })

    await test.step('2. the run passes and logs the uploaded bytes', async () => {
      await selectEnvironment(page)
      await page.getByTestId('run-button').click()

      const status = page.getByTestId('workflow-status')
      await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 15_000 })
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
      const verdict = await status.getAttribute('data-status')
      await annotateFailure(page, verdict)
      expect(verdict).toBe('passed')

      const logs = await waitForLogText(page, RESOLVE_BOOKEND)
      expect(
        logs.some((line) => line === payload),
        `expected the Read block to log the uploaded body ${payload}. Got:\n${logs.join('\n')}`,
      ).toBeTruthy()

      for (const nodeId of RESOLVE_NODES) {
        await expect(page.locator(`[data-testid="workflow-node-${nodeId}"]`)).toHaveAttribute(
          'data-execution-status',
          'success',
        )
      }
    })

    await test.step('3. the bound variable carries the same bytes', async () => {
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(
        variables.payload.value,
        'the Read output landed in the session variable unchanged',
      ).toBe(payload)
    })
  })

  test('test data cannot be changed while the test runs, and can once it stops', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    const own = await createOwnTest(page, loadFixture('running.fixture.json'))
    ownTestId = own.id
    await openWorkbench(page, own.id)

    await selectEnvironment(page)
    await page.getByTestId('run-button').click()
    const status = page.getByTestId('workflow-status')
    await expect(status).toHaveAttribute('data-status', 'running', { timeout: 20_000 })

    const sheet = await openSheet(page)
    const blocked = sheet.getByTestId('testdata-blocked')

    await test.step('4. creating a folder mid-run is refused with the server message', async () => {
      await sheet.getByTestId('testdata-new-folder-button').click()
      await saveNameDialog(page, 'while-running')

      await expect(blocked).toHaveText(
        `Test '${own.name}' is running; test data cannot be changed until it finishes`,
      )
      expect(
        await listTestDataPaths(request, own.id),
        'the refusal created nothing on the server',
      ).not.toContain('while-running')
    })

    await test.step('5. the same action succeeds once the run ends', async () => {
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
      const verdict = await status.getAttribute('data-status')
      await annotateFailure(page, verdict)
      expect(verdict).toBe('passed')

      await sheet.getByTestId('testdata-new-folder-button').click()
      await saveNameDialog(page, 'while-running')

      await expect(folderRowOf(page, 'while-running')).toBeVisible()
      await expect(blocked, 'a successful write clears the refusal').toHaveCount(0)
      expect(await listTestDataPaths(request, own.id)).toContain('while-running')
    })
  })
})
