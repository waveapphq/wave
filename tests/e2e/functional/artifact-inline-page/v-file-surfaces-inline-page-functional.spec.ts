/**
 * V-FILE-SURFACES-INLINE-PAGE-FUNCTIONAL: A page opened inline from a Test's data or the workbench session never runs in WAVE's origin
 * Design Decisions: REPORT-1 (a page renders from the artifact endpoint)
 * REQ: REQ-5.2.4.12
 *
 * The same page and drawing the artifact spec uses, served by the two other
 * file surfaces: a Test's data folder and the workbench session's artifacts.
 * Opened inline, each still renders and its script still runs, but walled off
 * from WAVE, so its read of WAVE's API is refused.
 *
 * Pass Criteria:
 *  1. page.html and drawing.svg uploaded to a Test's data and opened with
 *     disposition=inline run their scripts, and the scripts' reads of WAVE's
 *     API are refused.
 *  2. A workbench run of the fixture passes, and page.html and drawing.svg
 *     opened inline from the session artifacts behave the same.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/artifact-inline-page/v-file-surfaces-inline-page-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importFixtureTest, importValidateAndNavigate } from '../../helpers/fixture-import'
import { startRun } from '../../helpers/k8s-run'
import { uploadTestData } from '../../helpers/testdata'
import { PAGE_ARTIFACTS, expectReadBlocked, loadFixture, pageContent } from './inline-page'

test.describe('V-FILE-SURFACES-INLINE-PAGE-FUNCTIONAL: inline pages on every file surface stay out of WAVE', () => {
  test("a page in a Test's data opened inline runs its script, but the script cannot read WAVE", async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const fixture = loadFixture()
    const testId = await importFixtureTest(page, fixture)

    try {
      for (const artifact of PAGE_ARTIFACTS) {
        await test.step(`${artifact.path} opened inline from the Test's data cannot read WAVE`, async () => {
          await uploadTestData(page.request, testId, '', artifact.path, pageContent(fixture, artifact.path), {
            mimeType: artifact.type,
          })
          await expectReadBlocked(
            page,
            `${BACKEND_URL}/tests/${testId}/testdata/content/${artifact.path}?disposition=inline`,
            artifact.path,
          )
        })
      }
    } finally {
      await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('a page in the workbench session opened inline runs its script, but the script cannot read WAVE', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const testId = await importValidateAndNavigate(page, loadFixture())

    try {
      await test.step('the workbench run leaves the page and the drawing in the session', async () => {
        const status = await startRun(page)
        await expect(status, 'the File I/O writes pass').toHaveAttribute('data-status', 'passed', {
          timeout: 60_000,
        })
      })

      for (const artifact of PAGE_ARTIFACTS) {
        await test.step(`${artifact.path} opened inline from the session cannot read WAVE`, async () => {
          await expectReadBlocked(
            page,
            `${BACKEND_URL}/workbench/session/artifacts/content/${artifact.path}?disposition=inline`,
            artifact.path,
          )
        })
      }
    } finally {
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })
})
