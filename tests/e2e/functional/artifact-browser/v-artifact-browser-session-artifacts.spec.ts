/**
 * V-ARTIFACT-BROWSER-SESSION-ARTIFACTS: the Session Artifacts download response
 * Design Decisions: ARTIF-15 (Session Artifacts sheet rows mirror the drill's
 *   file-row idiom), TDATA-7 (Copy path on every file and folder row)
 * REQ: REQ-3.7.1.4, REQ-5.2.4.12
 *
 * Runs a two-block workflow in the live workbench so the session holds
 * artifact://data/output.json, then downloads that row from the Session
 * Artifacts sheet and asserts the RESPONSE the shared file-surface content
 * builder actually sent - status, the three download headers, and the bytes -
 * rather than that a download button rendered.
 *
 * Pass Criteria:
 * 1. The workflow passes and the session artifacts listing holds data/output.json
 *    with the written byte length; the sheet row shows the file name over its
 *    folder.
 * 2. Downloading the row hands the browser the file under its bare name.
 * 3. That download's response is 200 and carries content-disposition attachment
 *    naming output.json, x-content-type-options nosniff, cache-control no-store.
 * 4. The response body equals the exact bytes the run wrote.
 * 5. disposition=inline flips only the disposition; the two guard headers stay.
 * 6. Copy path on the sheet row puts artifact://data/output.json on the clipboard
 *    and shows the copied cue with its screen-reader announcement.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/artifact-browser/v-artifact-browser-session-artifacts.spec.ts
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { getLogLines, waitForLogText } from '../../helpers/log-reader'
import { selectEnvironment } from '../../helpers/workbench'

const ARTIFACT_PATH = 'data/output.json'
const ARTIFACT_NAME = 'output.json'
const ARTIFACT_FOLDER = 'data'
const ARTIFACT_REFERENCE = `artifact://${ARTIFACT_PATH}`
const CONTENT_PATH = `/workbench/session/artifacts/content/${ARTIFACT_PATH}`
const BOOKEND = 'session-artifact-written'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-session-artifacts.json'), 'utf-8'),
  )
}

/** The exact bytes the fixture's File I/O Write block puts on disk. */
function writtenContent(fixture: Record<string, any>): string {
  const node = fixture.workflow.nodes.find(
    (candidate: Record<string, any>) => candidate.id === 'fileio-write-session-artifact',
  )
  return node.data.config.values.content as string
}

async function runToPassed(page: Page): Promise<void> {
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })

  const verdict = await status.getAttribute('data-status')
  if (verdict !== 'passed') {
    test.info().annotations.push({
      type: 'error-logs',
      description: JSON.stringify(
        (await getLogLines(page)).filter((e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]')),
      ),
    })
  }
  expect(verdict, 'the seeded workbench run passes').toBe('passed')
}

test.describe('Session artifact download', () => {
  test('the sheet row downloads through the shared content builder with the guard headers and the written bytes', async ({
    page,
  }) => {
    test.setTimeout(120_000)

    // Copy path goes through navigator.clipboard, which needs the grant.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    const fixture = loadFixture()
    const content = writtenContent(fixture)
    const contentBytes = Buffer.from(content, 'utf-8')

    await importValidateAndNavigate(page, fixture)
    await runToPassed(page)
    await waitForLogText(page, BOOKEND)

    await test.step('1. The run left the artifact in the session and the sheet lists it', async () => {
      const listing = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
      expect(listing.ok(), `GET session artifacts failed: ${listing.status()}`).toBeTruthy()
      const body = (await listing.json()) as {
        items: Array<{ path: string; size_bytes: number }>
      }
      const entry = body.items.find((item) => item.path === ARTIFACT_PATH)
      expect(
        entry,
        `Expected ${ARTIFACT_PATH}. Got: ${JSON.stringify(body.items.map((i) => i.path))}`,
      ).toBeTruthy()
      expect(entry!.size_bytes, 'the listing reports what the block wrote').toBe(contentBytes.length)

      await page.locator('[data-testid="breadcrumb-artifacts-chip"]').click()
      const sheet = page.locator('[data-testid="session-artifacts-sheet"]')
      await expect(sheet).toBeVisible()
      const row = sheet.locator('[data-testid="file-row"]').filter({ hasText: ARTIFACT_NAME })
      await expect(row).toHaveCount(1)
      await expect(
        row.getByTestId('artifact-file-subtitle'),
        'the row names the file over its folder',
      ).toHaveText(ARTIFACT_FOLDER)
    })

    await test.step('2-4. Downloading the row answers 200 with the guard headers and the written bytes', async () => {
      const row = page
        .locator('[data-testid="session-artifacts-sheet"] [data-testid="file-row"]')
        .filter({ hasText: ARTIFACT_NAME })
        .first()
      const responsePromise = page.waitForResponse((response) =>
        response.url().includes(CONTENT_PATH),
      )
      const downloadPromise = page.waitForEvent('download')
      await row.getByRole('button', { name: `Download ${ARTIFACT_NAME}`, exact: true }).click()

      const download = await downloadPromise
      expect(download.suggestedFilename(), 'the file arrives under its bare name').toBe(
        ARTIFACT_NAME,
      )

      const response = await responsePromise
      expect(response.status(), 'the content endpoint answers 200').toBe(200)
      const headers = response.headers()
      expect(headers['content-disposition'], 'a download, not an inline render').toContain(
        'attachment;',
      )
      expect(headers['content-disposition']).toContain(`filename="${ARTIFACT_NAME}"`)
      expect(headers['x-content-type-options'], 'the browser must not sniff the type').toBe(
        'nosniff',
      )
      expect(headers['cache-control'], 'an ephemeral session file is never cached').toBe('no-store')
      expect(
        (await response.body()).toString('utf-8'),
        'the served bytes are the bytes the run wrote',
      ).toBe(content)
    })

    await test.step('5. disposition=inline flips only the disposition', async () => {
      const inline = await page.request.get(`${BACKEND_URL}${CONTENT_PATH}?disposition=inline`)
      expect(inline.status()).toBe(200)
      const headers = inline.headers()
      expect(headers['content-disposition']).toContain('inline;')
      expect(headers['x-content-type-options']).toBe('nosniff')
      expect(headers['cache-control']).toBe('no-store')
      expect(await inline.text()).toBe(content)
    })

    await test.step('6. Copy path puts the artifact:// reference on the clipboard', async () => {
      const copyButton = page
        .locator('[data-testid="session-artifacts-sheet"] [data-testid="file-row"]')
        .filter({ hasText: ARTIFACT_NAME })
        .first()
        .getByTestId('copy-path-button')
      await expect(copyButton).not.toHaveAttribute('data-copied', 'true')

      await copyButton.click()
      await expect(copyButton, 'the copied cue appears on a real copy').toHaveAttribute(
        'data-copied',
        'true',
      )
      await expect(copyButton.locator('output')).toHaveText('Path copied')
      expect(
        await page.evaluate(() => navigator.clipboard.readText()),
        'the clipboard holds the block-usable reference',
      ).toBe(ARTIFACT_REFERENCE)
    })
  })
})
