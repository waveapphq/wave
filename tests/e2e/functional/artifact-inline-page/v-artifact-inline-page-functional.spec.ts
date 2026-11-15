/**
 * V-ARTIFACT-INLINE-PAGE-FUNCTIONAL: An artifact opened inline never runs in WAVE's origin
 * Design Decisions: REPORT-1 (a page renders from the artifact endpoint)
 *
 * A run leaves an HTML page and an SVG drawing in its artifacts, the way a file
 * from a system under test lands there. Each carries a script that tries to read
 * WAVE's API. Opened inline, the page still renders and its script still runs,
 * but it runs walled off from WAVE, so the read is refused.
 *
 * Pass Criteria:
 *  1. The imported Test validates clean and its tracked run passes.
 *  2. page.html opened with disposition=inline runs its script, and the
 *     script's read of WAVE's API is refused.
 *  3. drawing.svg opened with disposition=inline behaves the same.
 *  4. A download keeps the file's own type and name.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/artifact-inline-page/v-artifact-inline-page-functional.spec.ts
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { validateTest } from '../../helpers/fn-seed'
import { runTrackedTest } from '../../helpers/k8s-run'
import { PAGE_ARTIFACTS, expectReadBlocked, loadFixture } from './inline-page'

interface ArtifactRow {
  id: string
  path: string
}

async function importFixture(request: APIRequestContext): Promise<string> {
  const fixture = loadFixture()
  fixture.name = `${fixture.name as string} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const response = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return ((body.data ?? body) as { id: string }).id
}

async function liveArtifacts(
  request: APIRequestContext,
  executionId: string,
): Promise<ArtifactRow[]> {
  const response = await request.get(
    `${BACKEND_URL}/artifacts?execution_id=${executionId}&per_page=100`,
  )
  expect(response.ok(), `GET /artifacts answered ${response.status()}`).toBeTruthy()
  return (await response.json()).data as ArtifactRow[]
}

test.describe('V-ARTIFACT-INLINE-PAGE-FUNCTIONAL: inline artifacts stay out of WAVE', () => {
  test('a page artifact opened inline runs its script, but the script cannot read WAVE', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    await ensureEnvironment(request)
    const testId = await importFixture(request)
    let executionId = ''

    try {
      let rows: ArtifactRow[] = []
      await test.step('the run leaves the page and the drawing', async () => {
        const validation = await validateTest(request, testId, 'run')
        expect(validation.errors, 'the fixture validates with zero errors').toHaveLength(0)
        const run = await runTrackedTest(request, testId)
        executionId = run.executionId
        expect(run.verdict, 'the File I/O writes pass').toBe('passed')
        rows = await liveArtifacts(request, executionId)
      })

      for (const artifact of PAGE_ARTIFACTS) {
        const row = rows.find((candidate) => candidate.path === artifact.path)
        if (!row) {
          throw new Error(`The run holds no ${artifact.path}. Listed: ${JSON.stringify(rows)}`)
        }
        const contentUrl = `${BACKEND_URL}/artifacts/content/${row.id}`

        await test.step(`${artifact.path} opened inline cannot read WAVE`, async () => {
          await expectReadBlocked(page, `${contentUrl}?disposition=inline`, artifact.path)
        })

        await test.step(`${artifact.path} downloads under its own type and name`, async () => {
          const response = await request.get(contentUrl)
          expect(response.status()).toBe(200)
          expect(response.headers()['content-type']).toContain(artifact.type)
          expect(response.headers()['content-disposition']).toBe(
            `attachment; filename="${artifact.path}"`,
          )
        })
      }
    } finally {
      if (executionId) {
        await request.delete(`${BACKEND_URL}/executions/${executionId}`).catch(() => undefined)
      }
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })
})
