/**
 * V-TESTDATA-TRAVEL-EXPORT-IMPORT: a test's data files travel with it
 *
 * Design Decisions: TDATA-1 (the files travel with the test - export, import),
 * TDATA-2 (test data is read-only to blocks).
 * REQ: REQ-3.4.3.2, REQ-5.2.4.9
 *
 * The travel fixture reads two test data files through `testdata://` and logs
 * both, so every claim below is anchored on bytes: the archive's own member
 * bytes, the stored bytes after import, and the run's console output.
 *
 * Pass Criteria:
 * 1. Exporting a test that HAS files returns a zip whose members are the test
 *    document plus `testdata/<test id>/<rel>` for every file, and each member's
 *    bytes are the bytes that were uploaded.
 * 2. With the test deleted, import validate reports the archive's file count in
 *    `testdata_files`.
 * 3. Importing writes the files under the NEW test id with the archive's bytes,
 *    and a RUN of the imported test resolves `testdata://<rel>` and logs the
 *    content back.
 * 4. A test WITHOUT files still exports as a plain document, not a zip.
 * 5. Importing with overwrite replaces the existing test's files: the old ones
 *    are gone and only the archive's remain, byte for byte.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/import-export/v-testdata-travel.spec.ts
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { openTest } from '../../helpers/fn-seed'
import { expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { readZipEntryText, zipEntryNames } from '../../helpers/zip-reader'
import {
  createTestViaApi,
  loadTravelFixture,
  TRAVEL_BOOKEND,
  TRAVEL_FILES,
  TRAVEL_NESTED_FILE,
  TRAVEL_NODES,
  TRAVEL_ROOT_FILE,
  uploadTravelFiles,
  type TravelFile,
} from './helpers'
import {
  readTestDataContent,
  readTestDataListing,
  uploadTestData,
} from '../../helpers/testdata'

// The file only the live test carries, so an overwrite has something of its
// own to lose.
const STALE_FILE: TravelFile = {
  folder: '',
  name: 'stale-only.txt',
  rel: 'stale-only.txt',
  content: 'stale-bytes-that-must-not-survive-an-overwrite',
}
const STALE_ROOT_CONTENT = 'stale-root-bytes-that-the-archive-must-replace'

const createdTestIds: string[] = []

function uniqueName(label: string): string {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** The export filename stem: the backend drops anything that is not a word
 *  character, whitespace or a hyphen, then collapses whitespace to hyphens. */
function exportStem(name: string): string {
  return name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'test'
}

async function createTravelTest(page: Page, name: string): Promise<string> {
  await ensureEnvironment(page.request)
  const testId = await createTestViaApi(page, loadTravelFixture(), name)
  createdTestIds.push(testId)
  return testId
}

async function exportArchive(
  request: APIRequestContext,
  testId: string,
): Promise<{ buffer: Buffer; disposition: string }> {
  const response = await request.get(
    `${BACKEND_URL}/tests/${testId}/export?format=yaml&secrets=mask`,
  )
  expect(response.ok(), `GET /tests/${testId}/export failed: ${response.status()}`).toBeTruthy()
  expect(
    response.headers()['content-type'],
    'a test carrying test data downloads as a zip',
  ).toContain('zip')
  return { buffer: await response.body(), disposition: response.headers()['content-disposition'] }
}

interface ImportResult {
  imported: Array<{ name: string; id: string; action: string }>
  skipped: Array<{ name: string }>
  total_imported: number
}

async function importArchive(
  request: APIRequestContext,
  buffer: Buffer,
  conflictResolutions: Record<string, string> = {},
): Promise<ImportResult> {
  const response = await request.post(`${BACKEND_URL}/tests/import`, {
    multipart: {
      file: { name: 'travel-export.zip', mimeType: 'application/zip', buffer },
      conflict_resolutions: JSON.stringify(conflictResolutions),
    },
  })
  expect(
    response.ok(),
    `POST /tests/import failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  return (await response.json()).data as ImportResult
}

test.describe("V-TESTDATA-TRAVEL-EXPORT-IMPORT: a test's files travel with it", () => {
  test.afterEach(async ({ page }) => {
    while (createdTestIds.length > 0) {
      const id = createdTestIds.pop()
      await page.request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => {})
    }
  })

  test('TR1: export carries the files, import restores them under the new id, and the run reads them', async ({
    page,
  }) => {
    test.setTimeout(180_000)

    const name = uniqueName('Test Data Travel')
    const testId = await createTravelTest(page, name)
    await uploadTravelFiles(page.request, testId)
    const documentMember = `${exportStem(name)}.yaml`

    const archive = await test.step('1. The export zip carries the document and one member per file', async () => {
      const { buffer, disposition } = await exportArchive(page.request, testId)
      expect(disposition, 'the archive keeps the document stem').toContain(`${exportStem(name)}.zip`)

      expect(
        zipEntryNames(buffer).sort(),
        'the archive is the document plus testdata/<test id>/<rel> per file',
      ).toEqual(
        [
          documentMember,
          `testdata/${testId}/${TRAVEL_ROOT_FILE.rel}`,
          `testdata/${testId}/${TRAVEL_NESTED_FILE.rel}`,
        ].sort(),
      )

      for (const file of TRAVEL_FILES) {
        expect(
          readZipEntryText(buffer, `testdata/${testId}/${file.rel}`),
          `the archived member "${file.rel}" holds the uploaded bytes`,
        ).toBe(file.content)
      }
      expect(readZipEntryText(buffer, documentMember), 'the document is the test itself').toContain(
        name,
      )
      return buffer
    })

    await test.step('2. Deleting the test takes its files with it', async () => {
      const deleted = await page.request.delete(`${BACKEND_URL}/tests/${testId}`)
      expect(deleted.ok(), `DELETE /tests/${testId} failed: ${deleted.status()}`).toBeTruthy()
      createdTestIds.splice(createdTestIds.indexOf(testId), 1)

      const listing = await page.request.get(`${BACKEND_URL}/tests/${testId}/testdata`)
      expect(listing.status(), 'the deleted test has no data folder left to list').toBe(404)
    })

    await test.step('3. Import validate reports the archive file count', async () => {
      const response = await page.request.post(`${BACKEND_URL}/tests/import/validate`, {
        multipart: {
          file: { name: 'travel-export.zip', mimeType: 'application/zip', buffer: archive },
        },
      })
      expect(response.ok(), `POST /tests/import/validate failed: ${response.status()}`).toBeTruthy()
      const data = (await response.json()).data
      expect(data.total, 'the archive holds exactly one test').toBe(1)
      expect(data.importable, 'nothing blocks the import').toBe(1)
      expect(data.blocked).toBe(0)
      expect(data.tests[0].name).toBe(name)
      expect(data.tests[0].fatal_errors, 'the archived document imports as it stands').toEqual([])
      expect(
        data.tests[0].existing_test_id,
        'the deleted test leaves no name conflict behind',
      ).toBeNull()
      expect(
        data.tests[0].testdata_files,
        'the preview counts both archived files before anything is written',
      ).toBe(TRAVEL_FILES.length)
    })

    const importedId = await test.step('4. Import writes the files under the NEW test id', async () => {
      const result = await importArchive(page.request, archive)
      expect(result.total_imported).toBe(1)
      expect(result.imported[0].name).toBe(name)
      expect(result.imported[0].action).toBe('created')

      const newId = result.imported[0].id
      createdTestIds.push(newId)
      expect(newId, 'the import mints a new id rather than reusing the deleted one').not.toBe(testId)

      const listing = await readTestDataListing(page.request, newId)
      expect(listing.total_files, 'both files landed under the new id').toBe(TRAVEL_FILES.length)
      expect(
        listing.entries
          .filter((entry) => entry.kind === 'file')
          .map((entry) => entry.path)
          .sort(),
        'the nested folder kept its relative path',
      ).toEqual(TRAVEL_FILES.map((file) => file.rel).sort())

      for (const file of TRAVEL_FILES) {
        expect(
          await readTestDataContent(page.request, newId, file.rel),
          `"${file.rel}" was written back byte for byte`,
        ).toBe(file.content)
      }
      return newId
    })

    await test.step('5. A run of the imported test resolves testdata:// and reads the content back', async () => {
      await openTest(page, importedId)
      const status = await startRun(page)
      const logs = await finishRun(page, status, TRAVEL_BOOKEND)
      const all = logs.join('\n')

      for (const file of TRAVEL_FILES) {
        expect(
          logs.some((line) => line === file.content),
          `the run read "${file.rel}" back through testdata://. Console was:\n${all}`,
        ).toBeTruthy()
      }
      await expectNodesSuccess(page, TRAVEL_NODES)
    })
  })

  test('TR2: a test without files still exports as a plain document', async ({ page }) => {
    const name = uniqueName('Test Data Travel No Files')
    const testId = await createTravelTest(page, name)

    const listing = await readTestDataListing(page.request, testId)
    expect(listing.total_files, 'the test starts with no files').toBe(0)

    const response = await page.request.get(
      `${BACKEND_URL}/tests/${testId}/export?format=yaml&secrets=mask`,
    )
    expect(response.ok(), `GET /tests/${testId}/export failed: ${response.status()}`).toBeTruthy()
    expect(response.headers()['content-type'], 'no files means no archive').toContain('yaml')
    expect(response.headers()['content-disposition']).toContain(`${exportStem(name)}.yaml`)

    const body = await response.body()
    expect(
      body[0] === 0x50 && body[1] === 0x4b,
      'the download is the document itself, not a zip',
    ).toBeFalsy()
    expect(body.toString('utf-8'), 'the document is the test').toContain(name)
  })

  test("TR3: import with overwrite replaces the existing test's files", async ({ page }) => {
    const name = uniqueName('Test Data Travel Overwrite')
    const testId = await createTravelTest(page, name)
    await uploadTestData(
      page.request,
      testId,
      TRAVEL_ROOT_FILE.folder,
      TRAVEL_ROOT_FILE.name,
      TRAVEL_ROOT_FILE.content
    )

    const archive = await test.step('1. Export the one-file state that the archive will carry', async () => {
      const { buffer } = await exportArchive(page.request, testId)
      expect(zipEntryNames(buffer).sort(), 'the archive carries exactly one file').toEqual(
        [`${exportStem(name)}.yaml`, `testdata/${testId}/${TRAVEL_ROOT_FILE.rel}`].sort(),
      )
      expect(readZipEntryText(buffer, `testdata/${testId}/${TRAVEL_ROOT_FILE.rel}`)).toBe(
        TRAVEL_ROOT_FILE.content,
      )
      return buffer
    })

    await test.step('2. Move the live test on: a second file, and different bytes in the first', async () => {
      await uploadTestData(
        page.request,
        testId,
        STALE_FILE.folder,
        STALE_FILE.name,
        STALE_FILE.content
      )
      await uploadTestData(
        page.request,
        testId,
        TRAVEL_ROOT_FILE.folder,
        TRAVEL_ROOT_FILE.name,
        STALE_ROOT_CONTENT,
        { replace: true }
      )

      const listing = await readTestDataListing(page.request, testId)
      expect(listing.total_files, 'the live test now carries two files').toBe(2)
      expect(await readTestDataContent(page.request, testId, TRAVEL_ROOT_FILE.rel)).toBe(
        STALE_ROOT_CONTENT,
      )
    })

    await test.step('3. Overwrite leaves only what the archive carried', async () => {
      const result = await importArchive(page.request, archive, { [name]: 'overwrite' })
      expect(result.total_imported).toBe(1)
      expect(result.imported[0].action).toBe('overwritten')
      expect(result.imported[0].id, 'overwrite keeps the existing test id').toBe(testId)

      const listing = await readTestDataListing(page.request, testId)
      expect(
        listing.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path),
        "the archive is the source of truth for the overwritten test's files",
      ).toEqual([TRAVEL_ROOT_FILE.rel])
      expect(listing.total_files).toBe(1)

      expect(
        await readTestDataContent(page.request, testId, TRAVEL_ROOT_FILE.rel),
        "the archive's bytes replaced the live ones",
      ).toBe(TRAVEL_ROOT_FILE.content)

      const stale = await page.request.get(
        `${BACKEND_URL}/tests/${testId}/testdata/content/${STALE_FILE.rel}`,
      )
      expect(stale.status(), 'the file the archive never carried is gone').toBe(404)
    })
  })
})
