/**
 * V-TESTDATA-02: the Test Data sheet before a test has any files.
 *
 * Phase: empty-db - one test opens the sheet on a brand new canvas that was
 * never saved, the other creates a saved test through the API and removes it
 * again in the same test, so the database is clean on either side.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 *
 * REQ: REQ-3.4.3.2, REQ-5.2.4.12
 * Design Decisions: TDATA-3, TDATA-4, TDATA-6
 *
 * Pass Criteria:
 *   TE-a  A saved test with no files shows the empty state: the "No test data
 *         yet" heading over its body copy and an "Upload files" button that
 *         opens the same hidden file input the toolbar uses. Upload and New
 *         folder are live; the filter row, the meta line and the footer note
 *         are absent because there is nothing to summarize (TDATA-6).
 *   TE-b  The empty state is listing-driven, not decoration: one file uploaded
 *         through the API and a press of Refresh replaces it with the file
 *         row, the singular "1 file - size" meta line and the footer note
 *         (TDATA-4, TDATA-6).
 *   TE-c  A canvas that was never saved has no folder to write into: the sheet
 *         reads "Save the test first to add files." and Upload and New folder
 *         are disabled AND visibly disabled (half opacity, not-allowed
 *         cursor). No filter row, no drop zone, no tree, no empty state and no
 *         footer note (TDATA-6).
 */

import { Buffer } from 'node:buffer'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { createValidTest, openTest, releaseWorkbenchOwnership } from '../../helpers/fn-seed'
import { uploadTestData } from '../../helpers/testdata'

const EMPTY_BODY =
  'Upload the files this test reads. Reference them as testdata:// paths where a block reads a file.'
const FOOTER_NOTE =
  'Reference a file as testdata://folder/name. Blocks read test data; they never change it.'
const SAVE_FIRST = 'Save the test first to add files.'

const PROBE_NAME = 'probe.txt'
const PROBE_BODY = 'one line\n'
const PROBE_BYTES = Buffer.byteLength(PROBE_BODY, 'utf8')

/** A one-block workflow: enough to be a saved test, nothing to run. */
const LOG_NODE = {
  id: 'log-empty-seed',
  type: 'workflowNode',
  position: { x: 200, y: 200 },
  data: {
    label: 'Log',
    elementType: 'log',
    nodeType: 'plugin',
    category: 'system',
    version: '1.0.0',
    description: 'Empty Sheet Seed',
    hasNewerVersion: false,
    expressionFields: ['message'],
    templateFields: [],
    config: {
      values: { message: "'no test data'", level: 'INFO' },
      outputBindings: {},
      profileBindings: [],
    },
  },
  measured: { width: 120, height: 62 },
}

const LOG_EDGES = [{ id: 'e1', source: 'start-node', target: 'log-empty-seed', type: 'default' }]

let createdTestId = ''

/** A workbench canvas with no test behind it: no session, no stored draft. */
async function openBlankWorkbench(page: Page): Promise<void> {
  await releaseWorkbenchOwnership(page.request)
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

async function openTestDataSheet(page: Page): Promise<Locator> {
  await page.getByTestId('breadcrumb-testdata-chip').click()
  const sheet = page.getByTestId('testdata-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('testdata-browser')).toBeVisible()
  return sheet
}

test.describe('V-TESTDATA-02: Test Data sheet with nothing in it', () => {
  test.afterEach(async ({ request }) => {
    if (createdTestId === '') return
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    // The database has to be clean again for the rest of the empty-db phase.
    const removed = await request.delete(`${BACKEND_URL}/tests/${createdTestId}`)
    createdTestId = ''
    expect(removed.ok(), `cleanup delete failed: ${removed.status()}`).toBeTruthy()
  })

  test('TE-a/TE-b: a saved test with no files shows the empty state until a file lands', async ({
    page,
    request,
  }) => {
    createdTestId = await createValidTest(request, {
      name: `V-TESTDATA-02 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nodes: [LOG_NODE],
      edges: LOG_EDGES,
    })
    await openTest(page, createdTestId)
    const sheet = await openTestDataSheet(page)

    const empty = page.getByTestId('testdata-empty-state')
    await expect(empty).toBeVisible()
    await expect(empty.getByText('No test data yet', { exact: true })).toBeVisible()
    await expect(empty.getByText(EMPTY_BODY, { exact: true })).toBeVisible()

    // Nothing to summarize: no filter row, no meta line, no footer note.
    await expect(page.getByTestId('testdata-filter')).toHaveCount(0)
    await expect(sheet.getByText(FOOTER_NOTE, { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('testdata-save-first')).toHaveCount(0)
    await expect(page.getByTestId('testdata-row')).toHaveCount(0)

    // The empty state renders inside the drop zone, so a drag still lands.
    const insideDropZone = await empty.evaluate(
      (el) => el.closest('[data-testid="testdata-dropzone"]') !== null,
    )
    expect(insideDropZone, 'the empty state sits inside the drop zone').toBe(true)

    // A saved test can be written to, so both toolbar buttons are live.
    for (const testId of ['testdata-upload-button', 'testdata-new-folder-button'] as const) {
      const button = page.getByTestId(testId)
      await expect(button).toBeEnabled()
      await expect(button).toHaveCSS('opacity', '1')
      await expect(button).toHaveCSS('cursor', 'pointer')
    }

    // "Upload files" opens the same hidden input the toolbar's Upload uses. The
    // listener swallows the default so no native file chooser opens.
    await page.getByTestId('testdata-upload-input').evaluate((input) => {
      input.addEventListener('click', (event) => {
        event.preventDefault()
        const counted = window as unknown as { uploadInputClicks?: number }
        counted.uploadInputClicks = (counted.uploadInputClicks ?? 0) + 1
      })
    })
    await empty.getByRole('button', { name: 'Upload files', exact: true }).click()
    const clicks = await page.evaluate(
      () => (window as unknown as { uploadInputClicks?: number }).uploadInputClicks ?? 0,
    )
    expect(clicks, 'the empty-state action opens the file input').toBe(1)

    // TE-b: the empty state is the listing, not decoration.
    const uploaded = await uploadTestData(request, createdTestId, '', PROBE_NAME, PROBE_BODY, {
      mimeType: 'text/plain',
    })
    expect(uploaded).toEqual({
      path: PROBE_NAME,
      size_bytes: PROBE_BYTES,
      replaced: false,
    })

    await page
      .getByTestId('testdata-sheet-drag-handle')
      .getByRole('button', { name: 'Refresh', exact: true })
      .click()

    await expect(empty).toHaveCount(0)
    await expect(page.locator(`[data-testid="testdata-row"][data-path="${PROBE_NAME}"]`)).toBeVisible()
    // One file reads "1 file", not "1 files".
    await expect(
      sheet.getByText(`1 file - ${PROBE_BYTES} B`, { exact: true }),
    ).toBeVisible()
    await expect(sheet.getByText(FOOTER_NOTE, { exact: true })).toBeVisible()
  })

  test('TE-c: an unsaved canvas has nothing to write into', async ({ page }) => {
    await openBlankWorkbench(page)

    // The chip is not gated on having saved the test (TDATA-3).
    await expect(page.getByTestId('breadcrumb-testdata-chip')).toBeVisible()
    const sheet = await openTestDataSheet(page)

    await expect(page.getByTestId('testdata-save-first')).toHaveText(SAVE_FIRST)

    for (const testId of ['testdata-upload-button', 'testdata-new-folder-button'] as const) {
      const button = page.getByTestId(testId)
      await expect(button).toBeDisabled()
      // Disabled has to read as disabled, not only announce it.
      await expect(button).toHaveCSS('opacity', '0.5')
      await expect(button).toHaveCSS('cursor', 'not-allowed')
    }

    // Nothing that needs a folder is rendered in this state.
    await expect(page.getByTestId('testdata-filter')).toHaveCount(0)
    await expect(page.getByTestId('testdata-dropzone')).toHaveCount(0)
    await expect(page.getByTestId('testdata-empty-state')).toHaveCount(0)
    await expect(page.getByTestId('testdata-blocked')).toHaveCount(0)
    await expect(sheet.getByRole('tree')).toHaveCount(0)
    await expect(sheet.getByText(FOOTER_NOTE, { exact: true })).toHaveCount(0)
  })
})
