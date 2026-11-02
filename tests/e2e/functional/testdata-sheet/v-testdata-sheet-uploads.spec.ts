/**
 * V-TESTDATA-SHEET-UPLOADS: what the Test Data sheet does while files are going up
 * Design Decisions: TDATA-4, TDATA-5
 * REQ: REQ-3.4.3.2, REQ-5.2.4.12
 *
 * Every case creates its own Test through POST /tests and deletes it in
 * teardown. Uploads are driven through the hidden file input the sheet owns,
 * and every outcome is read back from the Test Data API.
 *
 * Pass Criteria:
 * 1. A name the listing already holds is caught before anything is sent: one
 *    prompt names the file, Cancel sends no request at all, and the stored
 *    bytes are untouched.
 * 2. Replace all sends exactly one upload request, its multipart body carries
 *    path before replace=true, the server answers 201 with replaced=true, and
 *    the stored bytes change.
 * 3. Three files selected at once start three uploads, each with its own row
 *    inside the tree; Upload and New folder stay live while they run.
 * 4. Under three seconds a row shows a spinner only; from three seconds it
 *    shows the percent and the time left the server worked out, plus Cancel.
 *    All three files then land.
 * 5. A file the server refuses keeps its own row with the server's reason and
 *    a Dismiss button; the other files in the same batch still land, and the
 *    refusal never reaches the sheet's blocked notice.
 * 6. Files dropped on a folder row upload into that folder, not the root, and
 *    their row sits under that folder in the tree while they arrive.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/testdata-sheet/v-testdata-sheet-uploads.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { throttleUploads } from '../../helpers/api-route'
import { clearPointerLock } from '../../helpers/workbench'
import {
  createOwnTest,
  deleteOwnTest,
  fileRowOf,
  folderRowOf,
  loadFixture,
  marker,
  openSheet,
  openWorkbench,
  rowOf,
} from './helpers'
import {
  createTestDataFolder,
  listTestDataPaths,
  readTestDataContent,
  readTestDataListing,
  uploadTestData,
} from '../../helpers/testdata'

/** Every upload request body the page sent, in order. */
function collectUploadPosts(page: Page): string[] {
  const bodies: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (!new URL(request.url()).pathname.endsWith('/testdata/upload')) return
    bodies.push(request.postDataBuffer()?.toString('utf-8') ?? request.postData() ?? '')
  })
  return bodies
}

function textFile(name: string, body: string) {
  return { name, mimeType: 'text/plain', buffer: Buffer.from(body, 'utf-8') }
}

/** Every row for a file on its way in, or one that did not land. */
function uploadRows(page: Page) {
  return page.locator('[data-upload-row]')
}

// 24 KB/s against 90 KB files: the upload is genuinely in flight, on the server
// as well as in the tab, for long enough to watch.
const SLOW_BYTES_PER_SECOND = 24 * 1024
const SLOW_FILE_BYTES = 90 * 1024

let ownTestId: string | null = null

test.afterEach(async ({ request }) => {
  await deleteOwnTest(request, ownTestId)
  ownTestId = null
})

test.describe('Test Data sheet - uploads', () => {
  test('a name that already exists is caught before the request, and Replace all sends replace=true', async ({
    page,
    request,
  }) => {
    const own = await createOwnTest(page, loadFixture())
    ownTestId = own.id
    const original = `original,${marker('users')}`
    await uploadTestData(request, own.id, '', 'users.csv', original, { mimeType: 'text/plain' })

    await openWorkbench(page, own.id)
    const sheet = await openSheet(page)
    const uploadPosts = collectUploadPosts(page)

    const replacement = `replacement,${marker('users')}`
    const replacementFile = {
      name: 'users.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(replacement, 'utf-8'),
    }

    await test.step('1. the conflict is named and Cancel sends nothing', async () => {
      await sheet.getByTestId('testdata-upload-input').setInputFiles([replacementFile])

      const confirmation = page.getByRole('alertdialog')
      await expect(confirmation.getByRole('heading')).toHaveText('Replace existing files?')
      await expect(confirmation).toContainText('users.csv already exists in the target folder.')
      expect(
        uploadPosts.length,
        'the conflict was found against the listing on screen, before any request',
      ).toBe(0)

      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(confirmation).toBeHidden()
      await clearPointerLock(page)

      expect(uploadPosts.length, 'Cancel dropped the whole batch').toBe(0)
      expect(
        await readTestDataContent(request, own.id, 'users.csv'),
        'the stored file is untouched',
      ).toBe(original)
    })

    await test.step('2. Replace all sends one request with replace=true and the bytes change', async () => {
      await sheet.getByTestId('testdata-upload-input').setInputFiles([replacementFile])

      const confirmation = page.getByRole('alertdialog')
      await expect(confirmation.getByRole('heading')).toHaveText('Replace existing files?')

      const uploadResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith('/testdata/upload'),
      )
      await confirmation.getByRole('button', { name: 'Replace all', exact: true }).click()
      await expect(confirmation).toBeHidden()
      await clearPointerLock(page)

      // 201 with replaced=true can only happen when the request carried
      // replace=true; without it the server answers 409 File already exists.
      // It also proves the file part came last: a field after the file part is
      // a 400 Send path and replace before the file.
      const response = await uploadResponse
      expect(response.status(), 'the upload was accepted').toBe(201)
      const answered = (await response.json()) as { path: string; replaced: boolean }
      expect(answered.path).toBe('users.csv')
      expect(answered.replaced, 'the server replaced an existing file').toBe(true)

      await expect
        .poll(() => readTestDataContent(request, own.id, 'users.csv'), {
          message: 'the replacement bytes reached the server',
          timeout: 20_000,
        })
        .toBe(replacement)

      expect(uploadPosts.length, 'exactly one upload request followed').toBe(1)
    })
  })

  test('three files start three rows: a spinner first, then percent, ETA and Cancel', async ({
    page,
    request,
  }) => {
    const own = await createOwnTest(page, loadFixture())
    ownTestId = own.id
    await openWorkbench(page, own.id)
    const sheet = await openSheet(page)

    // A real backend and a real upload, sent slowly so the rows stay observable
    // past the three second mark. Fake timers cannot be used against a live
    // upload, and holding the request would keep the server from ever seeing it.
    await throttleUploads(page, SLOW_BYTES_PER_SECOND)

    const names = ['alpha.txt', 'beta.txt', 'gamma.txt']
    const bodies = names.map((name) => `${name}:${marker('slow')}`.padEnd(SLOW_FILE_BYTES, 'x'))
    const startedAt = Date.now()
    await sheet
      .getByTestId('testdata-upload-input')
      .setInputFiles(names.map((name, index) => textFile(name, bodies[index])))

    // The spinner-only window is three seconds wide, so it is asserted first.
    await test.step('3. each file gets its own row, and under three seconds it is a spinner only', async () => {
      await expect(uploadRows(page)).toHaveCount(3)
      await expect(sheet.getByTestId('testdata-upload-percent')).toHaveCount(0)
      await expect(sheet.getByTestId('testdata-upload-eta')).toHaveCount(0)
      await expect(sheet.locator(`[aria-label="Uploading ${names[0]}"]`)).toBeVisible()
      await expect(
        sheet.getByRole('button', { name: `Cancel upload of ${names[0]}`, exact: true }),
      ).toHaveCount(0)
      for (const name of names) {
        await expect(sheet.getByTestId(`testdata-upload-${name}`)).toBeVisible()
      }
    })

    await test.step('3b. Upload and New folder stay live while the uploads run', async () => {
      await expect(sheet.getByTestId('testdata-upload-button')).toBeEnabled()
      await expect(sheet.getByTestId('testdata-new-folder-button')).toBeEnabled()
    })

    await test.step('4. from three seconds each row shows percent, an ETA and Cancel', async () => {
      await expect(sheet.getByTestId('testdata-upload-percent')).toHaveCount(3, {
        timeout: 20_000,
      })
      expect(
        Date.now() - startedAt,
        'the detail waits out the three second window instead of appearing at once',
      ).toBeGreaterThanOrEqual(2_500)

      for (const name of names) {
        const row = sheet.getByTestId(`testdata-upload-${name}`)
        await expect(row.getByTestId('testdata-upload-percent')).toHaveText(/^\d+%$/)
        await expect(row.getByTestId('testdata-upload-eta')).toHaveText(/(left|Estimating…)$/)
        await expect(
          row.getByRole('button', { name: `Cancel upload of ${name}`, exact: true }),
        ).toBeVisible()
      }
    })

    await test.step('4b. all three files land', async () => {
      await expect(uploadRows(page)).toHaveCount(0, { timeout: 60_000 })
      const paths = await listTestDataPaths(request, own.id)
      for (const [index, name] of names.entries()) {
        expect(paths).toContain(name)
        expect(await readTestDataContent(request, own.id, name)).toBe(bodies[index])
      }
    })
  })

  test('a refused file keeps its own row while the rest of the batch lands', async ({
    page,
    request,
  }) => {
    const own = await createOwnTest(page, loadFixture())
    ownTestId = own.id
    // A folder occupies the name one of the uploaded files carries, so the
    // server refuses that one file and only that one.
    await createTestDataFolder(request, own.id, 'notes')

    await openWorkbench(page, own.id)
    const sheet = await openSheet(page)

    const alphaBody = marker('alpha')
    const betaBody = marker('beta')
    await sheet
      .getByTestId('testdata-upload-input')
      .setInputFiles([
        textFile('alpha.txt', alphaBody),
        textFile('beta.txt', betaBody),
        textFile('notes', 'this one cannot land'),
      ])

    await test.step('5. the batch is confirmed once, naming the taken name', async () => {
      const confirmation = page.getByRole('alertdialog')
      await expect(confirmation).toContainText('notes already exists in the target folder.')
      await confirmation.getByRole('button', { name: 'Replace all', exact: true }).click()
      await expect(confirmation).toBeHidden()
      await clearPointerLock(page)
    })

    await test.step('5b. the refused file keeps its row and the others land', async () => {
      const refused = sheet.getByTestId('testdata-upload-notes')
      await expect(refused).toContainText('Folder already exists: notes')
      await expect(
        refused.getByRole('button', { name: 'Dismiss notes', exact: true }),
      ).toBeVisible()
      await expect(
        sheet.getByTestId('testdata-blocked'),
        'an upload refusal stays in its own row',
      ).toHaveCount(0)

      await expect(fileRowOf(page, 'alpha.txt')).toBeVisible()
      await expect(fileRowOf(page, 'beta.txt')).toBeVisible()
      const listing = await readTestDataListing(request, own.id)
      const paths = listing.entries.map((entry) => entry.path)
      expect(paths, 'one refusal did not stop the others').toContain('alpha.txt')
      expect(paths).toContain('beta.txt')
      expect(
        listing.entries.find((entry) => entry.path === 'notes')?.kind,
        'the folder that took the name is still a folder',
      ).toBe('dir')
      expect(await readTestDataContent(request, own.id, 'alpha.txt')).toBe(alphaBody)
      expect(await readTestDataContent(request, own.id, 'beta.txt')).toBe(betaBody)

      await refused.getByRole('button', { name: 'Dismiss notes', exact: true }).click()
      await expect(refused).toHaveCount(0)
    })
  })

  test('files dropped on a folder row upload into that folder', async ({ page, request }) => {
    const own = await createOwnTest(page, loadFixture())
    ownTestId = own.id
    await createTestDataFolder(request, own.id, 'inbox')

    await openWorkbench(page, own.id)
    const sheet = await openSheet(page)

    const droppedBody = marker('dropped')
    const dataTransfer = await page.evaluateHandle(
      ({ name, body }) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([body], name, { type: 'text/plain' }))
        return transfer
      },
      { name: 'dropped.txt', body: droppedBody },
    )

    await test.step('6. the hovered folder becomes the drop target', async () => {
      const folderRow = folderRowOf(page, 'inbox')
      await folderRow.dispatchEvent('dragover', { dataTransfer })
      await expect(folderRow).toHaveAttribute('data-drop-target', 'true')
      await expect(sheet.getByTestId('testdata-dropzone')).toHaveAttribute('data-dragging', 'true')
    })

    await test.step('6b. the row sits under that folder while the file arrives', async () => {
      await throttleUploads(page, SLOW_BYTES_PER_SECOND)
      await folderRowOf(page, 'inbox').dispatchEvent('drop', { dataTransfer })

      const row = page.getByTestId('testdata-upload-dropped.txt')
      await expect(row).toBeVisible({ timeout: 20_000 })
      await expect(row).toHaveAttribute('data-upload-folder', 'inbox')
      await expect(
        rowOf(page, 'inbox').locator('[data-upload-row="dropped.txt"]'),
        'the row is inside the folder it is going to, not above the tree',
      ).toHaveCount(1)
    })

    await test.step('6c. the dropped file lands inside that folder', async () => {
      await expect(fileRowOf(page, 'inbox/dropped.txt')).toBeVisible({ timeout: 60_000 })
      const paths = await listTestDataPaths(request, own.id)
      expect(paths, 'the drop resolved to the hovered folder').toContain('inbox/dropped.txt')
      expect(paths, 'nothing landed in the root').not.toContain('dropped.txt')
      expect(await readTestDataContent(request, own.id, 'inbox/dropped.txt')).toBe(droppedBody)
    })
  })
})
