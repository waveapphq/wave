/**
 * V-BACKUP-TESTDATA-TRAVEL: a backup carries a test's data files and a restore
 * brings them back
 *
 * Design Decisions: TDATA-1 (the files travel with the test - backup, restore),
 * TDATA-2 (test data is read-only to blocks).
 * REQ: REQ-3.4.3.2, REQ-5.2.4.9.5
 *
 * Phase: functional-destructive. The spec resets the store before and after
 * itself, the way the rest of this suite does, because a backup reads whatever
 * the store holds and a restore writes into it.
 *
 * The travel fixture reads two test data files through `testdata://` and logs
 * both, so every claim is anchored on bytes: the archive's own member bytes,
 * the stored bytes after the restore, and the restored test's run output.
 *
 * Pass Criteria:
 * 1. A backup of the tests entity carries every file as
 *    `tests/testdata/<test id>/<rel>`, holding the uploaded bytes.
 * 2. Validating that backup reports the file count on the tests summary.
 * 3. Deleting the test removes its data folder.
 * 4. Restoring brings the test back under the id it had, and its files with it,
 *    holding the archive's bytes.
 * 5. A run of the restored test resolves `testdata://<rel>` and logs the
 *    content back.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/backup-restore/v-backup-testdata-travel.spec.ts
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { exec } from '../../helpers/exec'
import { openTest } from '../../helpers/fn-seed'
import { expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { readZipEntryText, zipEntryNames } from '../../helpers/zip-reader'
import { readTestDataContent, readTestDataListing } from '../../helpers/testdata'
import {
  createTestViaApi,
  loadTravelFixture,
  TRAVEL_BOOKEND,
  TRAVEL_FILES,
  TRAVEL_NODES,
  uploadTravelFiles,
} from '../import-export/helpers'

const BACKUP_MEMBER_PREFIX = 'tests/testdata'

/** The id of every stored test that has this name. */
async function testIdsNamed(request: APIRequestContext, name: string): Promise<string[]> {
  const response = await request.get(`${BACKEND_URL}/tests/`)
  expect(response.ok(), `GET /tests/ failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const rows = (body.data ?? []) as Array<{ id: string; name: string }>
  return rows.filter((row) => row.name === name).map((row) => row.id)
}

test.describe('V-BACKUP-TESTDATA-TRAVEL: a restore brings a test back with its files', () => {
  test.beforeAll(async ({ request }) => {
    exec('./tests/e2e/scripts/reset.sh')
    await ensureEnvironment(request)
  })

  test.afterAll(async () => {
    exec('./tests/e2e/scripts/reset.sh')
  })

  test('BT1: the backup carries the files, the restore writes them back, and the restored test reads them', async ({
    page,
  }) => {
    test.setTimeout(180_000)

    const name = `Test Data Backup Travel ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const testId = await createTestViaApi(page, loadTravelFixture(), name)
    await uploadTravelFiles(page.request, testId)

    const backup = await test.step('1. The backup carries every file under tests/testdata/<test id>', async () => {
      const response = await page.request.post(`${BACKEND_URL}/api/backup/create`, {
        data: {
          entity_types: ['tests'],
          format: 'yaml',
          compression_method: 'deflate',
          compression_level: 6,
          secrets: 'mask',
        },
      })
      expect(response.ok(), `POST /api/backup/create failed: ${response.status()}`).toBeTruthy()
      expect(response.headers()['content-type']).toBe('application/zip')

      const buffer = await response.body()
      const members = zipEntryNames(buffer)
      for (const file of TRAVEL_FILES) {
        const member = `${BACKUP_MEMBER_PREFIX}/${testId}/${file.rel}`
        expect(members, `the backup carries "${member}"`).toContain(member)
        expect(
          readZipEntryText(buffer, member),
          `the archived member "${file.rel}" holds the uploaded bytes`,
        ).toBe(file.content)
      }
      return buffer
    })

    await test.step('2. Validating the backup reports the file count on the tests summary', async () => {
      const response = await page.request.post(`${BACKEND_URL}/api/backup/validate`, {
        multipart: {
          file: { name: 'travel-backup.zip', mimeType: 'application/zip', buffer: backup },
        },
      })
      expect(response.ok(), `POST /api/backup/validate failed: ${response.status()}`).toBeTruthy()
      const { data: body } = (await response.json()) as {
        data: { entity_summary: { tests: { total: number; testdata_files: number } } }
      }
      expect(body.entity_summary.tests.total, 'the archive holds the one seeded test').toBe(1)
      expect(
        body.entity_summary.tests.testdata_files,
        'the preview counts both archived files before anything is written',
      ).toBe(TRAVEL_FILES.length)
    })

    await test.step('3. Deleting the test takes its files with it', async () => {
      const deleted = await page.request.delete(`${BACKEND_URL}/tests/${testId}`)
      expect(deleted.ok(), `DELETE /tests/${testId} failed: ${deleted.status()}`).toBeTruthy()

      const listing = await page.request.get(`${BACKEND_URL}/tests/${testId}/testdata`)
      expect(listing.status(), 'the deleted test has no data folder left to list').toBe(404)
    })

    await test.step('4. The restore brings the test back under the id it had, with its files', async () => {
      const response = await page.request.post(`${BACKEND_URL}/api/backup/restore`, {
        multipart: {
          file: { name: 'travel-backup.zip', mimeType: 'application/zip', buffer: backup },
          entity_types: 'tests',
          conflict_resolution: 'skip',
          auto_repair: 'false',
        },
      })
      expect(
        response.ok(),
        `POST /api/backup/restore failed: ${response.status()} ${await response.text()}`,
      ).toBeTruthy()
      const { data: result } = await response.json()
      expect(result.tests.imported, 'the one archived test came back').toBe(1)
      expect(result.tests.items, 'no test was skipped or left out').toEqual([])

      const restored = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(restored.status(), `the restored test "${name}" answers under the id it had`).toBe(200)
      expect((await restored.json()).data.name).toBe(name)
      expect(
        await testIdsNamed(page.request, name),
        'the name belongs to that id alone: no copy under another id',
      ).toEqual([testId])

      const listing = await readTestDataListing(page.request, testId)
      expect(listing.total_files, 'both files came back with the test').toBe(TRAVEL_FILES.length)
      expect(
        listing.entries
          .filter((entry) => entry.kind === 'file')
          .map((entry) => entry.path)
          .sort(),
        'the nested folder kept its relative path',
      ).toEqual(TRAVEL_FILES.map((file) => file.rel).sort())

      for (const file of TRAVEL_FILES) {
        expect(
          await readTestDataContent(page.request, testId, file.rel),
          `"${file.rel}" was written back byte for byte`,
        ).toBe(file.content)
      }
    })

    await test.step('5. A run of the restored test resolves testdata:// and reads the content back', async () => {
      await openTest(page, testId)
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
})
