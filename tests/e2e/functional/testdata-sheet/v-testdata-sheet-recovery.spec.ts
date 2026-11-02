/**
 * V-TESTDATA-SHEET-RECOVERY: the two ways back from a file that did not land
 * Design Decisions: TDATA-14, TDATA-17
 * REQ: REQ-3.4.3.2, REQ-5.2.4.12
 *
 * A file the server refused leaves a notice that belongs to the test, not to
 * the tab. The tab that still holds the bytes can send them again; a tab that
 * does not - after the test is reopened - is asked for the file instead, under
 * the name the row is waiting for.
 *
 * Pass Criteria:
 * 1. A refused upload leaves a row with the server's reason and a Retry, and
 *    Retry sends the same bytes to the same place: once the obstacle is gone the
 *    file lands, the row goes and the file appears in the tree.
 * 2. The notice outlives the tab that tried: reopening the test brings the row
 *    back with the same reason, no Retry (the bytes are gone) and Choose file.
 * 3. Choose file with a differently named file is reported on the row and sends
 *    nothing; with the expected name it lands where the original was going.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/testdata-sheet/v-testdata-sheet-recovery.spec.ts
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { clearPointerLock } from '../../helpers/workbench'
import {
  createTestDataFolder,
  deleteTestDataEntry,
  listTestDataPaths,
  readTestDataContent,
  readTestDataUploads,
} from '../../helpers/testdata'
import {
  createOwnTest,
  deleteOwnTest,
  fileRowOf,
  loadFixture,
  marker,
  openSheet,
  openWorkbench,
} from './helpers'

function textFile(name: string, body: string) {
  return { name, mimeType: 'text/plain', buffer: Buffer.from(body, 'utf-8') }
}

function uploadRow(page: Page, name: string): Locator {
  return page.locator(`[data-testid="testdata-upload-${name}"]`)
}

/** Upload one file through the sheet, answering the replace prompt the taken name raises. */
async function uploadOver(page: Page, sheet: Locator, name: string, body: string): Promise<void> {
  await sheet.getByTestId('testdata-upload-input').setInputFiles([textFile(name, body)])
  const replace = page.getByRole('alertdialog')
  await expect(replace).toContainText(`${name} already exists in the target folder.`)
  await replace.getByRole('button', { name: 'Replace all', exact: true }).click()
  await expect(replace).toBeHidden()
  await clearPointerLock(page)
}

let ownTestId: string | null = null

test.afterEach(async ({ request }) => {
  await deleteOwnTest(request, ownTestId)
  ownTestId = null
})

test.describe('Test Data sheet - a file that did not land', () => {
  test('Retry sends the same bytes once the obstacle is gone', async ({ page, request }) => {
    test.setTimeout(120_000)
    const own = await createOwnTest(page, loadFixture())
    ownTestId = own.id
    await createTestDataFolder(request, own.id, 'alpha')

    await openWorkbench(page, own.id)
    const sheet = await openSheet(page)
    const body = `retried,${marker('alpha')}`

    await test.step('1. the refusal leaves a row with the reason and a Retry', async () => {
      await uploadOver(page, sheet, 'alpha', body)

      const row = uploadRow(page, 'alpha')
      await expect(row).toHaveAttribute('data-upload-status', 'interrupted', { timeout: 20_000 })
      await expect(row).toContainText('Folder already exists: alpha')
      await expect(row.getByRole('button', { name: 'Retry alpha', exact: true })).toBeVisible()
      await expect(
        row.getByRole('button', { name: 'Choose file for alpha', exact: true }),
        'this tab still holds the bytes, so it is not asked for the file',
      ).toHaveCount(0)
      await expect(row.getByRole('button', { name: 'Dismiss alpha', exact: true })).toBeVisible()
      expect(
        (await readTestDataUploads(request, own.id)).interruptions.map((notice) => notice.reason),
      ).toEqual(['Folder already exists: alpha'])
    })

    await test.step('1b. with the folder gone, Retry lands the same bytes', async () => {
      await deleteTestDataEntry(request, own.id, 'alpha')

      await uploadRow(page, 'alpha').getByRole('button', { name: 'Retry alpha', exact: true }).click()

      await expect(uploadRow(page, 'alpha')).toHaveCount(0, { timeout: 30_000 })
      await expect(fileRowOf(page, 'alpha')).toBeVisible()
      expect(await readTestDataContent(request, own.id, 'alpha')).toBe(body)
      expect((await readTestDataUploads(request, own.id)).interruptions).toEqual([])
    })
  })

  test('after a reopen the row asks for the file instead, under the name it expects', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const own = await createOwnTest(page, loadFixture())
    ownTestId = own.id
    await createTestDataFolder(request, own.id, 'notes')

    await openWorkbench(page, own.id)
    const sheet = await openSheet(page)
    await uploadOver(page, sheet, 'notes', 'the first attempt')
    await expect(uploadRow(page, 'notes')).toHaveAttribute('data-upload-status', 'interrupted', {
      timeout: 20_000,
    })

    await test.step('2. the notice survives reopening the test, and Retry goes with the bytes', async () => {
      await openWorkbench(page, own.id)
      await openSheet(page)

      const row = uploadRow(page, 'notes')
      await expect(row).toBeVisible({ timeout: 20_000 })
      await expect(row).toContainText('Folder already exists: notes')
      await expect(row.getByRole('button', { name: 'Retry notes', exact: true })).toHaveCount(0)
      await expect(
        row.getByRole('button', { name: 'Choose file for notes', exact: true }),
      ).toBeVisible()
      await expect(row, 'the notice sits where the file was going').toHaveAttribute(
        'data-upload-folder',
        '',
      )
    })

    await test.step('3. a file under another name is reported, not uploaded', async () => {
      await page
        .locator('[data-testid="testdata-choose-input-notes"]')
        .setInputFiles([textFile('other.txt', 'wrong file')])

      await expect(uploadRow(page, 'notes')).toContainText('That is other.txt, not notes.')
      expect(
        await listTestDataPaths(request, own.id),
        'nothing was sent under the wrong name',
      ).not.toContain('other.txt')
    })

    await test.step('3b. the expected name lands where the original was going', async () => {
      await deleteTestDataEntry(request, own.id, 'notes')
      const body = `chosen,${marker('notes')}`

      await page
        .locator('[data-testid="testdata-choose-input-notes"]')
        .setInputFiles([textFile('notes', body)])

      await expect(uploadRow(page, 'notes')).toHaveCount(0, { timeout: 30_000 })
      await expect(fileRowOf(page, 'notes')).toBeVisible()
      expect(await readTestDataContent(request, own.id, 'notes')).toBe(body)
      expect((await readTestDataUploads(request, own.id)).interruptions).toEqual([])
    })
  })
})
