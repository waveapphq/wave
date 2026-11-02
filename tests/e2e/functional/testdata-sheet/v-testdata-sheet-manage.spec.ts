/**
 * V-TESTDATA-SHEET-MANAGE: the Test Data sheet manages a test's own files
 * Design Decisions: TDATA-1, TDATA-3, TDATA-4, TDATA-5, TDATA-6, TDATA-7
 * REQ: REQ-3.4.3.2, REQ-5.2.4.12
 *
 * Every case creates its own Test through POST /tests and deletes it in
 * teardown; the delete cascades and removes the test's data folder. What the
 * sheet did is read back from the Test Data API, never from the sheet itself.
 *
 * Pass Criteria:
 * 1. The breadcrumb chip opens the sheet, and a saved test with no files shows
 *    the empty state.
 * 2. New folder with nothing selected creates in the root and its dialog says
 *    so; an expanded folder with no children shows the "Empty folder" row.
 * 3. Selecting a folder retargets New folder and Upload at it; two files
 *    selected at once both land inside that folder.
 * 4. A selected file targets its own folder; a second click on the selected row
 *    clears the selection and the root is the target again.
 * 5. Rename moves a file and a folder, and a renamed folder carries its
 *    children; the bytes survive.
 * 6. Delete asks first: Cancel keeps the entry, Delete removes it from the
 *    listing.
 * 7. A file downloads its own bytes and a folder downloads as a zip.
 * 8. Copy path writes exactly testdata://<relative path> to the clipboard and
 *    marks the row copied.
 * 9. A test that was never saved offers no upload at all.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/testdata-sheet/v-testdata-sheet-manage.spec.ts
 */

import fs from 'fs'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'
import { clearPointerLock } from '../../helpers/workbench'
import {
  clickRowBody,
  clickRowMenuItem,
  createOwnTest,
  deleteOwnTest,
  fileRowOf,
  folderRowOf,
  loadFixture,
  marker,
  nameDialogTitle,
  openSheet,
  openWorkbench,
  rowOf,
  saveNameDialog,
} from './helpers'
import {
  createTestDataFolder,
  listTestDataPaths,
  readTestDataContent,
  readTestDataListing,
  uploadTestData,
} from '../../helpers/testdata'

let ownTestId: string | null = null

test.afterEach(async ({ request }) => {
  await deleteOwnTest(request, ownTestId)
  ownTestId = null
})

test.describe('Test Data sheet - managing a test\'s files', () => {
  test('the chip opens the sheet, and New folder and Upload follow the selection', async ({
    page,
    request,
  }) => {
    const own = await createOwnTest(page, loadFixture())
    ownTestId = own.id
    await openWorkbench(page, own.id)

    const sheet = await openSheet(page)
    await expect(sheet, 'the sheet names itself for assistive tech').toHaveAttribute(
      'aria-label',
      'Test Data',
    )

    await test.step('1. a saved test with no files shows the empty state', async () => {
      const empty = sheet.getByTestId('testdata-empty-state')
      await expect(empty).toBeVisible()
      await expect(empty).toContainText('No test data yet')
      expect(
        (await readTestDataListing(request, own.id)).total_files,
        'the empty state matches an empty folder on the server',
      ).toBe(0)
    })

    await test.step('2. New folder with nothing selected creates in the root', async () => {
      await sheet.getByTestId('testdata-new-folder-button').click()
      await expect(nameDialogTitle(page)).toHaveText('New folder in the root')
      await saveNameDialog(page, 'fixtures')
      // The row appears only after the create and the listing re-read landed.
      await expect(folderRowOf(page, 'fixtures')).toBeVisible()
      expect(
        await listTestDataPaths(request, own.id),
        'the folder exists on the server, not only on screen',
      ).toContain('fixtures')
    })

    await test.step('2b. the new folder is expanded and reports itself empty', async () => {
      const emptyFolder = page.getByTestId('testdata-empty-folder')
      await expect(emptyFolder).toBeVisible()
      await expect(emptyFolder).toHaveText('Empty folder')
    })

    await test.step('3. selecting the folder retargets New folder at it', async () => {
      await clickRowBody(folderRowOf(page, 'fixtures'))
      await expect(rowOf(page, 'fixtures')).toHaveAttribute('data-selected', 'true')
      await expect(folderRowOf(page, 'fixtures')).toHaveAttribute('data-selected', 'true')

      await sheet.getByTestId('testdata-new-folder-button').click()
      await expect(nameDialogTitle(page)).toHaveText('New folder in fixtures')
      await saveNameDialog(page, 'nested')
      await expect(folderRowOf(page, 'fixtures/nested')).toBeVisible()
      expect(await listTestDataPaths(request, own.id)).toContain('fixtures/nested')
    })

    const usersBody = `id,name\n1,${marker('user')}\n`
    const ordersBody = `{"order": "${marker('order')}"}`

    await test.step('3b. two files selected at once both land in the selected folder', async () => {
      await sheet.getByTestId('testdata-upload-input').setInputFiles([
        { name: 'users.csv', mimeType: 'text/csv', buffer: Buffer.from(usersBody, 'utf-8') },
        {
          name: 'orders.json',
          mimeType: 'application/json',
          buffer: Buffer.from(ordersBody, 'utf-8'),
        },
      ])
      await expect(fileRowOf(page, 'fixtures/users.csv')).toBeVisible()
      await expect(fileRowOf(page, 'fixtures/orders.json')).toBeVisible()

      const paths = await listTestDataPaths(request, own.id)
      expect(paths, 'the upload targeted the selected folder').toContain('fixtures/users.csv')
      expect(paths).toContain('fixtures/orders.json')
      expect(paths, 'nothing landed in the root').not.toContain('users.csv')
      expect(
        await readTestDataContent(request, own.id, 'fixtures/users.csv'),
        'the stored bytes are the ones the spec sent',
      ).toBe(usersBody)
      expect(await readTestDataContent(request, own.id, 'fixtures/orders.json')).toBe(ordersBody)
    })

    await test.step('4. a selected file targets its own folder', async () => {
      await clickRowBody(fileRowOf(page, 'fixtures/users.csv'))
      await expect(rowOf(page, 'fixtures/users.csv')).toHaveAttribute('data-selected', 'true')
      await expect(
        rowOf(page, 'fixtures'),
        'selecting a file releases the folder',
      ).not.toHaveAttribute('data-selected', 'true')

      await sheet.getByTestId('testdata-new-folder-button').click()
      await expect(nameDialogTitle(page)).toHaveText('New folder in fixtures')
      await page.getByTestId('edit-dialog-cancel').click()
      await expect(page.getByTestId('testdata-name-dialog')).toBeHidden()
      await clearPointerLock(page)
    })

    await test.step('4b. a second click on the selected row clears the selection', async () => {
      await clickRowBody(fileRowOf(page, 'fixtures/users.csv'))
      await expect(rowOf(page, 'fixtures/users.csv')).not.toHaveAttribute('data-selected', 'true')
      await expect(fileRowOf(page, 'fixtures/users.csv')).not.toHaveAttribute(
        'data-selected',
        'true',
      )

      await sheet.getByTestId('testdata-new-folder-button').click()
      await expect(
        nameDialogTitle(page),
        'with nothing selected the root is the target again',
      ).toHaveText('New folder in the root')
      await saveNameDialog(page, 'archive')
      await expect(folderRowOf(page, 'archive')).toBeVisible()
      expect(await listTestDataPaths(request, own.id)).toContain('archive')
    })
  })

  test('rename moves an entry and delete asks before it removes one', async ({
    page,
    request,
  }) => {
    const own = await createOwnTest(page, loadFixture())
    ownTestId = own.id
    const body = `id,name\n1,${marker('rename')}\n`
    await createTestDataFolder(request, own.id, 'fixtures')
    await uploadTestData(request, own.id, 'fixtures', 'users.csv', body, { mimeType: 'text/plain' })

    await openWorkbench(page, own.id)
    await openSheet(page)

    await test.step('5. renaming a file moves it and keeps its bytes', async () => {
      await clickRowMenuItem(page, fileRowOf(page, 'fixtures/users.csv'), 'users.csv', 'Rename')
      await expect(nameDialogTitle(page)).toHaveText('Rename users.csv')
      await expect(page.getByTestId('testdata-name-dialog')).toContainText(
        'Blocks that reference the old name will no longer find it.',
      )
      await saveNameDialog(page, 'customers.csv')

      await expect(fileRowOf(page, 'fixtures/customers.csv')).toBeVisible()
      const paths = await listTestDataPaths(request, own.id)
      expect(paths).toContain('fixtures/customers.csv')
      expect(paths, 'the old path is gone').not.toContain('fixtures/users.csv')
      expect(
        await readTestDataContent(request, own.id, 'fixtures/customers.csv'),
        'a rename moves the bytes, it does not rewrite them',
      ).toBe(body)
    })

    await test.step('5b. renaming a folder carries its children', async () => {
      await clickRowMenuItem(page, folderRowOf(page, 'fixtures'), 'fixtures', 'Rename')
      await expect(nameDialogTitle(page)).toHaveText('Rename fixtures')
      await saveNameDialog(page, 'seed-data')
      await expect(folderRowOf(page, 'seed-data')).toBeVisible()

      const paths = await listTestDataPaths(request, own.id)
      expect(paths).toContain('seed-data')
      expect(paths, 'the file moved with the folder').toContain('seed-data/customers.csv')
      expect(paths).not.toContain('fixtures')
      expect(paths).not.toContain('fixtures/customers.csv')
    })

    await test.step('6. Cancel on the delete confirmation keeps the file', async () => {
      await clickRowMenuItem(
        page,
        fileRowOf(page, 'seed-data/customers.csv'),
        'customers.csv',
        'Delete',
      )
      const confirmation = page.getByRole('alertdialog')
      await expect(confirmation).toBeVisible()
      await expect(confirmation.getByRole('heading')).toHaveText('Delete "customers.csv"?')
      await expect(confirmation).toContainText("The file is removed from this test's data.")
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(confirmation).toBeHidden()
      await clearPointerLock(page)

      expect(
        await listTestDataPaths(request, own.id),
        'a canceled confirmation deletes nothing',
      ).toContain('seed-data/customers.csv')
    })

    await test.step('6b. confirming removes the entry from the listing', async () => {
      await clickRowMenuItem(
        page,
        fileRowOf(page, 'seed-data/customers.csv'),
        'customers.csv',
        'Delete',
      )
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Delete', exact: true })
        .click()
      await expect(rowOf(page, 'seed-data/customers.csv')).toHaveCount(0)
      await clearPointerLock(page)

      expect(await listTestDataPaths(request, own.id)).not.toContain('seed-data/customers.csv')
    })
  })

  test('a file downloads its bytes, a folder downloads as a zip, and Copy path writes the reference', async ({
    page,
    request,
  }) => {
    const own = await createOwnTest(page, loadFixture())
    ownTestId = own.id
    const reportBody = `{"report": "${marker('report')}"}`
    await createTestDataFolder(request, own.id, 'fixtures')
    await uploadTestData(request, own.id, 'fixtures', 'report.json', reportBody, {
      mimeType: 'text/plain',
    })

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await openWorkbench(page, own.id)
    await openSheet(page)

    await test.step('7. the file download carries the stored bytes', async () => {
      const downloadPromise = page.waitForEvent('download')
      await fileRowOf(page, 'fixtures/report.json')
        .getByRole('button', { name: 'Download report.json', exact: true })
        .click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toBe('report.json')
      expect(
        fs.readFileSync((await download.path()) as string, 'utf-8'),
        'the downloaded bytes are what the spec uploaded',
      ).toBe(reportBody)
    })

    await test.step('7b. the folder download is a zip', async () => {
      const downloadPromise = page.waitForEvent('download')
      await folderRowOf(page, 'fixtures')
        .getByRole('button', { name: 'Download fixtures', exact: true })
        .click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toBe('testdata-fixtures.zip')
      const bytes = fs.readFileSync((await download.path()) as string)
      expect(
        bytes[0] === 0x50 && bytes[1] === 0x4b,
        `expected the zip PK magic, got ${bytes.subarray(0, 4).toString('hex')}`,
      ).toBeTruthy()
    })

    await test.step('8. Copy path writes testdata://<relative path>', async () => {
      const copyFile = fileRowOf(page, 'fixtures/report.json').getByTestId('copy-path-button')
      await copyFile.click()
      await expect(copyFile, 'the row shows the copied state').toHaveAttribute(
        'data-copied',
        'true',
      )
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        'testdata://fixtures/report.json',
      )
    })

    await test.step('8b. a folder copies its own reference with no trailing slash', async () => {
      await folderRowOf(page, 'fixtures').getByTestId('copy-path-button').click()
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
          message: 'the folder reference reached the clipboard',
        })
        .toBe('testdata://fixtures')
    })
  })

  test('a test that was never saved says to save first and disables both buttons', async ({
    page,
  }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    await stubSessionRecovery(page)
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const sheet = await openSheet(page)

    await test.step('9. the sheet refuses to take files before the test is saved', async () => {
      await expect(sheet.getByTestId('testdata-save-first')).toHaveText(
        'Save the test first to add files.',
      )
      await expect(sheet.getByTestId('testdata-upload-button')).toBeDisabled()
      await expect(sheet.getByTestId('testdata-new-folder-button')).toBeDisabled()
      await expect(
        sheet.getByTestId('testdata-dropzone'),
        'there is nowhere to drop files either',
      ).toHaveCount(0)
    })
  })
})
