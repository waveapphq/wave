/**
 * V-TESTDATA-SHEET-SESSIONS: what other sessions see of a test's files
 * Design Decisions: TDATA-13, TDATA-14, TDATA-15, TDATA-16
 * REQ: REQ-3.4.3.2, REQ-5.2.4.12
 *
 * Two isolated browser contexts share the one workbench slot: A holds the test,
 * B follows it. Every assertion reads observable state - the sheet's read-only
 * line, the rows both sessions render, the chip's state mark, the files the
 * server ends up holding - never mere presence.
 *
 * Pass Criteria:
 * 1. A session that does not hold the test reads its files and cannot change
 *    them: no Upload, no New folder, no row kebab, and a line saying why. Copy
 *    path and Download stay, because they are reads.
 * 2. An upload the holder started shows up in the follower's sheet, and it
 *    survives the follower taking the session over: the file still lands.
 * 3. Only the session holding the test and the one that started the upload can
 *    stop it. A stopped upload leaves an amber row in every session watching at
 *    the time, the file never lands, nothing about it is kept, and closing the
 *    sheet dismisses the row for good.
 * 4. The Test Data chip carries the state: the spinner while a file is on its
 *    way in, the exclamation mark alone once the uploads are over, nothing once
 *    the notice is dismissed.
 * 5. The close warning names the uploads that are still going.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/testdata-sheet/v-testdata-sheet-sessions.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import type { Browser, BrowserContext } from '@playwright/test'
import { throttleUploads } from '../../helpers/api-route'
import { FRONTEND_URL } from '../../helpers/config'
import { dragPaletteItemToCanvas, stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'
import { clearPointerLock } from '../../helpers/workbench'
import { SEL, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import {
  createTestDataFolder,
  listTestDataPaths,
  readTestDataUploads,
  uploadTestData,
} from '../../helpers/testdata'
import {
  createOwnTest,
  deleteOwnTest,
  loadFixture,
  marker,
  openSheet,
  openWorkbench,
} from './helpers'

const SHEET = '[data-testid="testdata-sheet"]'
const READ_ONLY_NOTE = 'Only the session holding this test can change its files.'
// 480 KB at 24 KB/s: the upload is genuinely in flight for about twenty seconds,
// on the server as well as in the tab, which is what a follower watches.
const SLOW_BYTES_PER_SECOND = 24 * 1024
const SLOW_FILE_BYTES = 480 * 1024

const open: BrowserContext[] = []

function textFile(name: string, body: string) {
  return { name, mimeType: 'text/plain', buffer: Buffer.from(body, 'utf-8') }
}

/** A file big enough that a throttled tab is still sending it a while later. */
function slowFile(name: string) {
  return { name, mimeType: 'text/plain', buffer: Buffer.alloc(SLOW_FILE_BYTES, 'x') }
}

/** A fresh isolated context on an empty workbench. */
async function openContext(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: FRONTEND_URL })
  open.push(context)
  const page = await context.newPage()
  await stubSessionRecovery(page)
  return page
}

/** A second context that mirrors the holder rather than opening the test itself. */
async function openFollower(browser: Browser): Promise<Page> {
  const page = await openContext(browser)
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
  await expect(page.locator(SEL.bannerPerson)).toBeVisible({ timeout: 20_000 })
  return page
}

/** The row one file owns in a session's sheet. */
function uploadRow(page: Page, name: string) {
  return page.locator(`[data-testid="testdata-upload-${name}"]`)
}

function cancelButton(page: Page, name: string) {
  return uploadRow(page, name).getByRole('button', {
    name: `Cancel upload of ${name}`,
    exact: true,
  })
}

let ownTestId: string | null = null

test.describe('Test Data sheet - other sessions', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => undefined)
    await deleteOwnTest(request, ownTestId)
    ownTestId = null
    await resetOwnership(request)
  })

  test('a session that does not hold the test reads its files and cannot change them', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000)
    const holderPage = await openContext(browser)
    const own = await createOwnTest(holderPage, loadFixture())
    ownTestId = own.id
    await uploadTestData(request, own.id, '', 'users.csv', `seed,${marker('users')}`, {
      mimeType: 'text/plain',
    })
    await openWorkbench(holderPage, own.id)
    await waitUntilHeld(request)
    const followerPage = await openFollower(browser)

    await test.step('1. the holder keeps every write action', async () => {
      const sheet = await openSheet(holderPage)
      await expect(sheet.getByTestId('testdata-upload-button')).toBeEnabled()
      await expect(sheet.getByTestId('testdata-new-folder-button')).toBeEnabled()
      await expect(sheet.getByTestId('testdata-read-only')).toHaveCount(0)
    })

    await test.step('1b. the follower reads the same files with nothing to change them', async () => {
      const sheet = await openSheet(followerPage)
      await expect(sheet.getByTestId('testdata-browser')).toHaveAttribute('data-read-only', 'true')
      await expect(sheet.getByText('users.csv')).toBeVisible({ timeout: 15_000 })
      await expect(sheet.getByTestId('testdata-read-only')).toHaveText(READ_ONLY_NOTE)
      await expect(sheet.getByTestId('testdata-upload-button')).toHaveCount(0)
      await expect(sheet.getByTestId('testdata-new-folder-button')).toHaveCount(0)
      await expect(sheet.getByTestId('testdata-upload-input')).toHaveCount(0)
      await expect(
        sheet.getByRole('button', { name: 'More actions for users.csv', exact: true }),
      ).toHaveCount(0)
      await expect(
        sheet.getByRole('button', { name: 'Download users.csv', exact: true }),
        'Download is a read, so it stays',
      ).toBeVisible()
    })
  })

  test('a follower sees the holder upload, and a take-over does not stop it', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000)
    const holderPage = await openContext(browser)
    const own = await createOwnTest(holderPage, loadFixture())
    ownTestId = own.id
    await openWorkbench(holderPage, own.id)
    await waitUntilHeld(request)
    const followerPage = await openFollower(browser)

    const holderSheet = await openSheet(holderPage)
    await openSheet(followerPage)
    // The holder alone sends slowly, so the upload is observable in both sheets.
    await throttleUploads(holderPage, SLOW_BYTES_PER_SECOND)

    await holderSheet.getByTestId('testdata-upload-input').setInputFiles([slowFile('held.txt')])

    await test.step('2. the follower renders a row it did not start', async () => {
      await expect(uploadRow(followerPage, 'held.txt')).toBeVisible({ timeout: 20_000 })
      await expect(uploadRow(followerPage, 'held.txt')).toHaveAttribute(
        'data-upload-status',
        'uploading',
      )
      await expect(uploadRow(holderPage, 'held.txt')).toBeVisible()
      expect(
        (await readTestDataUploads(request, own.id)).uploads.map((row) => row.name),
        'the upload belongs to the test on the server, not to the tab',
      ).toEqual(['held.txt'])
    })

    await test.step('2b. the follower takes the session over and the file still lands', async () => {
      await followerPage.locator(SEL.takeOver).click()
      await holderPage
        .getByRole('alertdialog', { name: 'Another session wants to take over' })
        .getByRole('button', { name: 'Hand over' })
        .click()
      await followerPage
        .getByRole('alertdialog', { name: 'You now hold the session' })
        .getByRole('button', { name: 'Start editing' })
        .click()
      await expect(holderPage.locator(SEL.canvasReadOnly)).toBeVisible({ timeout: 20_000 })

      await expect
        .poll(() => listTestDataPaths(request, own.id), {
          message: 'the upload in flight survived the take-over',
          timeout: 40_000,
        })
        .toContain('held.txt')
    })
  })

  test('only the holder and the session that started it can stop an upload', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000)
    const holderPage = await openContext(browser)
    const own = await createOwnTest(holderPage, loadFixture())
    ownTestId = own.id
    await openWorkbench(holderPage, own.id)
    await waitUntilHeld(request)
    const followerPage = await openFollower(browser)

    const holderSheet = await openSheet(holderPage)
    await openSheet(followerPage)
    await throttleUploads(holderPage, SLOW_BYTES_PER_SECOND)

    await holderSheet.getByTestId('testdata-upload-input').setInputFiles([slowFile('stopme.txt')])
    await expect(uploadRow(followerPage, 'stopme.txt')).toBeVisible({ timeout: 20_000 })

    await test.step('3. the follower only watches; the holder stops it', async () => {
      await expect(
        cancelButton(followerPage, 'stopme.txt'),
        'a session that neither holds the test nor started the upload only watches',
      ).toHaveCount(0)

      await expect(cancelButton(holderPage, 'stopme.txt')).toBeVisible({ timeout: 20_000 })
      await cancelButton(holderPage, 'stopme.txt').click()
    })

    await test.step('3b. both sessions keep an amber row and the file never lands', async () => {
      for (const page of [holderPage, followerPage]) {
        await expect(uploadRow(page, 'stopme.txt')).toHaveAttribute(
          'data-upload-status',
          'canceled',
          { timeout: 20_000 },
        )
        await expect(uploadRow(page, 'stopme.txt')).toContainText('Canceled')
      }
      expect(await listTestDataPaths(request, own.id)).not.toContain('stopme.txt')
      expect(
        (await readTestDataUploads(request, own.id)).interruptions,
        'a cancellation is never kept',
      ).toEqual([])
    })

    await test.step('3c. closing Test Data dismisses it, and it never comes back', async () => {
      await holderPage.locator(SHEET).getByRole('button', { name: 'Close' }).click()
      await expect(holderPage.locator(SHEET)).toBeHidden()
      await clearPointerLock(holderPage)

      await openSheet(holderPage)
      await expect(holderPage.locator('[data-upload-row]')).toHaveCount(0)
    })
  })

  test('the chip carries the state and the close warning names the uploads', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000)
    const holderPage = await openContext(browser)
    const own = await createOwnTest(holderPage, loadFixture())
    ownTestId = own.id
    // A folder occupies a name, so one file of the batch cannot land.
    await createTestDataFolder(request, own.id, 'notes')
    await openWorkbench(holderPage, own.id)
    await waitUntilHeld(request)

    const chipState = holderPage.getByTestId('breadcrumb-testdata-state')

    await test.step('4. nothing on the chip while nothing is happening', async () => {
      await expect(holderPage.getByTestId('breadcrumb-testdata-chip')).toBeVisible()
      await expect(chipState).toHaveCount(0)
    })

    // The close warning only opens over unsaved work, so the canvas is dirtied first.
    const box = await holderPage.locator(SEL.canvas).boundingBox()
    await dragPaletteItemToCanvas(holderPage, 'shell script', {
      x: (box as { width: number }).width / 2,
      y: (box as { height: number }).height / 2,
    })

    const sheet = await openSheet(holderPage)

    await test.step('4b. the exclamation mark alone once a file did not land', async () => {
      await sheet
        .getByTestId('testdata-upload-input')
        .setInputFiles([textFile('notes', 'cannot land')])
      const replace = holderPage.getByRole('alertdialog')
      await expect(replace).toContainText('notes already exists in the target folder.')
      await replace.getByRole('button', { name: 'Replace all', exact: true }).click()
      await clearPointerLock(holderPage)

      await expect(chipState).toHaveAttribute('data-interrupted', 'true', { timeout: 20_000 })
      await expect(chipState).toHaveAttribute('data-uploading', 'false')
      await expect(chipState.locator('svg[class*="animate-spin"]')).toHaveCount(0)
      expect(
        (await readTestDataUploads(request, own.id)).interruptions.map((row) => row.name),
      ).toEqual(['notes'])
    })

    await throttleUploads(holderPage, SLOW_BYTES_PER_SECOND)
    await sheet.getByTestId('testdata-upload-input').setInputFiles([slowFile('slow.txt')])

    await test.step('4c. the mark sits inside the spinner while a file is on its way in', async () => {
      await expect(chipState).toHaveAttribute('data-uploading', 'true', { timeout: 20_000 })
      await expect(chipState).toHaveAttribute('data-interrupted', 'true')
      await expect(chipState.locator('svg[class*="animate-spin"]')).toBeVisible()
    })

    await test.step('5. the close warning names the upload that is still going', async () => {
      await holderPage.locator('[data-testid="toolbar-close-button"]').click()
      const dialog = holderPage.locator('[role="dialog"]', { hasText: 'Unsaved Changes' })
      await expect(dialog).toContainText('1 test data upload is still going.')
      await expect(dialog).toContainText(
        'Leaving this test does not stop it; closing the tab does.',
      )
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await clearPointerLock(holderPage)
    })

    await test.step('4d. the spinner goes when the upload lands, the mark stays', async () => {
      await expect(chipState).toHaveAttribute('data-uploading', 'false', { timeout: 90_000 })
      await expect(chipState).toHaveAttribute('data-interrupted', 'true')
      expect(await listTestDataPaths(request, own.id)).toContain('slow.txt')
    })

    await test.step('4e. dismissing the notice clears the chip', async () => {
      const reopened = holderPage.locator(SHEET)
      await expect(reopened).toBeVisible()
      await reopened.getByRole('button', { name: 'Dismiss notes', exact: true }).click()
      await expect(chipState).toHaveCount(0)
      expect((await readTestDataUploads(request, own.id)).interruptions).toEqual([])
    })
  })
})
