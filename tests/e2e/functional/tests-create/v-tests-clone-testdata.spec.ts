/**
 * V-TESTS-CLONE-TESTDATA: a test's data files travel with Duplicate and go with Delete
 *
 * Phase: functional-workflow. A test's data files are part of the test, not a
 * shared pool: Duplicate hands the copy its own independent set, and Delete
 * takes the folder with the test. The copy is proved independent by deleting
 * the source it was cloned from and then running the clone - it still resolves
 * every testdata:// reference and reads back the exact bytes.
 *
 * Design Decisions: TDATA-1 (per-test folder, created on first upload, removed
 * when the test is deleted, copied by clone), TDATA-3 (the Test Data chip); a
 * run's single testdata:// root is the test's own folder, the files travel with
 * the test, and the sheet lists the test's files.
 * REQ: REQ-5.2.4.3, REQ-3.4.3.2, REQ-5.2.4.12
 *
 * Pass Criteria:
 *  1. Duplicate in the Tests list gives the clone its own copy of both files -
 *     same relative paths, same byte sizes - read back through
 *     GET /tests/{clone}/testdata.
 *  2. Deleting the source through the list takes its folder with it:
 *     GET /tests/{source}/testdata answers 404 NOT_FOUND with the message
 *     "Test not found: {source}", not an empty listing.
 *  3. The clone's files survive the source's delete unchanged.
 *  4. The clone's Test Data sheet lists both entries at their relative paths,
 *     and its meta line counts two files.
 *  5. A run of the clone resolves testdata://customers.csv and
 *     testdata://fixtures/orders.json against the CLONE's own folder and reads
 *     back the exact uploaded bytes, into the bound variables and onto the
 *     console.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/tests-create/v-tests-clone-testdata.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { createValidTest, openTest, releaseWorkbenchOwnership, validateTest } from '../../helpers/fn-seed'
import { chainEdges, markerNode, pluginNode, stackNodes } from '../../helpers/k8s-nodes'
import { getLogCopyTexts } from '../../helpers/log-reader'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import { clearPointerLock } from '../../helpers/workbench'
import {
  createTestDataFolder,
  readTestDataListing,
  uploadTestData,
} from '../../helpers/testdata'

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const SOURCE_NAME = `Clone Test Data ${SUFFIX}`
const CLONE_NAME = `${SOURCE_NAME} (Copy)`

const CSV_PATH = 'customers.csv'
const CSV_CONTENT = `id,name,region\n1,Ada,emea-${SUFFIX}\n`
const JSON_FOLDER = 'fixtures'
const JSON_PATH = `${JSON_FOLDER}/orders.json`
const JSON_CONTENT = `{"order": "${SUFFIX}", "status": "cloned"}`

const BOOKEND = `clone-testdata-done-${SUFFIX}`
const NODES = ['fileio-read-csv', 'fileio-read-json', 'log-csv', 'log-json', 'log-done'] as const

function buildWorkflow() {
  const nodes = stackNodes([
    pluginNode({
      id: 'fileio-read-csv',
      label: 'File I/O',
      elementType: 'file-io',
      category: 'system',
      description: 'Read Test Data CSV',
      values: { operation: 'read', path: `testdata://${CSV_PATH}` },
      outputBindings: { content: 'csv_text' },
    }),
    pluginNode({
      id: 'fileio-read-json',
      label: 'File I/O',
      elementType: 'file-io',
      category: 'system',
      description: 'Read Test Data JSON',
      values: { operation: 'read', path: `testdata://${JSON_PATH}` },
      outputBindings: { content: 'json_text' },
    }),
    markerNode({ id: 'log-csv', description: 'Log CSV Content', expression: 'csv_text' }),
    markerNode({ id: 'log-json', description: 'Log JSON Content', expression: 'json_text' }),
    markerNode({ id: 'log-done', description: 'Bookend', text: BOOKEND }),
  ])
  return {
    nodes,
    edges: chainEdges(NODES),
    variables: {
      csv_text: { value: '', type: 'string', scope: 'test' },
      json_text: { value: '', type: 'string', scope: 'test' },
    },
  }
}

/** The Tests list, filtered down to this spec's two rows. */
async function openFilteredTestsList(page: Page): Promise<void> {
  await page.goto('/tests')
  await expect(page.getByTestId('tests-page')).toBeVisible({ timeout: 20_000 })
  await page.getByPlaceholder(/Search tests/i).fill(SOURCE_NAME)
}

let sourceId = ''
let cloneId = ''

test.describe('V-TESTS-CLONE-TESTDATA: the files are part of the test', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
    const workflow = buildWorkflow()
    sourceId = await createValidTest(request, { name: SOURCE_NAME, ...workflow })

    await createTestDataFolder(request, sourceId, JSON_FOLDER)

    const csv = await uploadTestData(request, sourceId, '', CSV_PATH, CSV_CONTENT, {
      mimeType: 'text/plain',
    })
    expect(csv.path).toBe(CSV_PATH)
    expect(csv.size_bytes).toBe(Buffer.byteLength(CSV_CONTENT, 'utf-8'))
    expect(csv.replaced).toBe(false)

    const json = await uploadTestData(request, sourceId, JSON_FOLDER, 'orders.json', JSON_CONTENT, {
      mimeType: 'text/plain',
    })
    expect(json.path).toBe(JSON_PATH)
    expect(json.size_bytes).toBe(Buffer.byteLength(JSON_CONTENT, 'utf-8'))
    expect(json.replaced).toBe(false)

    const validation = await validateTest(request, sourceId, 'run')
    expect(
      validation.errors,
      `the seeded Test must validate clean. Got: ${JSON.stringify(validation.errors)}`,
    ).toEqual([])
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    await releaseWorkbenchOwnership(request)
    if (cloneId) await request.delete(`${BACKEND_URL}/tests/${cloneId}`).catch(() => undefined)
    await request.delete(`${BACKEND_URL}/tests/${sourceId}`).catch(() => undefined)
  })

  test('Duplicate copies the files, Delete removes them, and the clone runs from its own copy', async ({
    page,
    request,
  }) => {
    await test.step('the source carries both uploaded files', async () => {
      const listing = await readTestDataListing(request, sourceId)
      expect(listing.total_files, 'the source holds exactly the two uploaded files').toBe(2)
      expect(listing.entries.map((e) => e.path)).toEqual([CSV_PATH, JSON_FOLDER, JSON_PATH])
      expect(listing.total_bytes).toBe(
        Buffer.byteLength(CSV_CONTENT, 'utf-8') + Buffer.byteLength(JSON_CONTENT, 'utf-8'),
      )
    })

    await test.step('Duplicate in the Tests list produces the clone', async () => {
      await openFilteredTestsList(page)
      const sourceRow = page.locator(`[data-testid="test-row"][data-row-id="${sourceId}"]`)
      await expect(sourceRow, 'the source row must be in the filtered list').toBeVisible({
        timeout: 20_000,
      })

      await sourceRow.locator('[data-testid="action-menu-trigger"]').click()
      await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()

      const cloneRow = page
        .locator('[data-testid="test-row"]')
        .filter({ has: page.getByTestId('test-name').filter({ hasText: CLONE_NAME }) })
      await expect(cloneRow, 'Duplicate must add the copy to the list').toBeVisible({
        timeout: 20_000,
      })
      cloneId = (await cloneRow.getAttribute('data-row-id')) ?? ''
      expect(cloneId, 'the clone row must carry its id').toBeTruthy()
      expect(cloneId).not.toBe(sourceId)
      // A closed row menu can leave the pointer-events lock on <body>, which
      // swallows the next trigger click silently.
      await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toHaveCount(0)
      await clearPointerLock(page)
    })

    await test.step('the clone owns an independent copy of both files', async () => {
      const listing = await readTestDataListing(request, cloneId)
      expect(listing.entries.map((e) => e.path)).toEqual([CSV_PATH, JSON_FOLDER, JSON_PATH])
      expect(listing.total_files).toBe(2)
      const csv = listing.entries.find((e) => e.path === CSV_PATH)
      const json = listing.entries.find((e) => e.path === JSON_PATH)
      expect(csv?.kind).toBe('file')
      expect(csv?.size_bytes).toBe(Buffer.byteLength(CSV_CONTENT, 'utf-8'))
      expect(json?.kind).toBe('file')
      expect(json?.size_bytes).toBe(Buffer.byteLength(JSON_CONTENT, 'utf-8'))
      expect(
        listing.entries.find((e) => e.path === JSON_FOLDER)?.kind,
        'the folder came across as a folder',
      ).toBe('dir')
    })

    await test.step('deleting the source takes its folder with it', async () => {
      const sourceRow = page.locator(`[data-testid="test-row"][data-row-id="${sourceId}"]`)
      const confirm = page.getByRole('alertdialog')

      // On a loaded machine the row menu can close between opening it and reaching
      // Delete, so the pair is one gesture that is retried rather than two steps.
      await expect(async () => {
        await page.keyboard.press('Escape')
        await clearPointerLock(page)
        await sourceRow.locator('[data-testid="action-menu-trigger"]').click()
        await page
          .getByRole('menuitem', { name: 'Delete', exact: true })
          .click({ timeout: 2_000 })
        await expect(confirm, 'the delete confirmation opened').toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })

      await expect(confirm).toContainText(`Delete "${SOURCE_NAME}"?`)
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(sourceRow, 'the deleted source leaves the list').toHaveCount(0, {
        timeout: 20_000,
      })

      const gone = await request.get(`${BACKEND_URL}/tests/${sourceId}/testdata`)
      expect(
        gone.status(),
        'the deleted test answers 404, not an empty listing',
      ).toBe(404)
      const body = (await gone.json()) as { error?: { code?: string; message?: string } }
      expect(body.error?.code).toBe('NOT_FOUND')
      expect(body.error?.message).toBe(`Test not found: ${sourceId}`)
    })

    await test.step("the clone's files survive the source's delete", async () => {
      const listing = await readTestDataListing(request, cloneId)
      expect(listing.total_files).toBe(2)
      expect(listing.entries.map((e) => e.path)).toEqual([CSV_PATH, JSON_FOLDER, JSON_PATH])
    })

    await test.step("the clone's Test Data sheet lists both files", async () => {
      await openTest(page, cloneId)
      await page.getByTestId('breadcrumb-testdata-chip').click()

      const sheet = page.getByTestId('testdata-sheet')
      await expect(sheet).toBeVisible({ timeout: 15_000 })
      await expect(sheet, 'the meta line counts the copied files').toContainText('2 files')

      const csvRow = sheet.locator(`[data-testid="testdata-row"][data-path="${CSV_PATH}"]`)
      await expect(csvRow).toBeVisible()
      await expect(csvRow).toHaveAttribute('data-entry-type', 'file')

      const folderRow = sheet.locator(`[data-testid="testdata-row"][data-path="${JSON_FOLDER}"]`)
      await expect(folderRow).toBeVisible()
      await expect(folderRow).toHaveAttribute('data-entry-type', 'dir')

      const jsonRow = sheet.locator(`[data-testid="testdata-row"][data-path="${JSON_PATH}"]`)
      await expect(jsonRow, 'the nested file is listed under its folder').toBeVisible()
      await expect(jsonRow).toHaveAttribute('data-entry-type', 'file')

      await sheet.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(sheet).toHaveCount(0)
    })

    await test.step("a run of the clone reads its own copy back", async () => {
      const status = await startRun(page)
      const logs = await finishRun(page, status, BOOKEND)

      for (const id of NODES) {
        await expect(
          page.locator(`[data-testid="workflow-node-${id}"]`),
          `${id} must have succeeded`,
        ).toHaveAttribute('data-execution-status', 'success')
      }

      const vars = await getSessionVariables(page, await getActiveSessionId(page))
      expect(
        vars.csv_text?.value,
        'testdata://customers.csv resolved against the clone and read back exactly',
      ).toBe(CSV_CONTENT)
      expect(
        vars.json_text?.value,
        'testdata://fixtures/orders.json resolved against the clone and read back exactly',
      ).toBe(JSON_CONTENT)

      expect(
        logs.some((line) => line === JSON_CONTENT),
        `the JSON content reached the console. Got:\n${logs.join('\n')}`,
      ).toBeTruthy()
      expect(
        logs.some((line) => line === BOOKEND),
        'the bookend marker closed the run',
      ).toBeTruthy()

      // data-copy-text keeps the newlines that textContent flattens.
      const copyTexts = await getLogCopyTexts(page)
      expect(
        copyTexts.some((line) => line.includes(`id,name,region\n1,Ada,emea-${SUFFIX}`)),
        `the CSV content reached the console. Got:\n${copyTexts.join('\n---\n')}`,
      ).toBeTruthy()
    })
  })
})
