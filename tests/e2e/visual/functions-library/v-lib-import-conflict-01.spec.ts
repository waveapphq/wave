/**
 * V-LIB-IMPORT-CONFLICT-01: the shared Import dialog REVIEW step renders the
 * conflict-reason sublabel under a Function's name and defaults the resolution
 * to Auto-rename.
 *
 * Design Decisions: FNLIST-12
 * REQ: REQ-3.1.2.5
 *
 * Pass Criteria:
 * 1. An id-colliding row shows the muted "ID already in library" sublabel and
 *    the resolution Select defaults to Auto-rename.
 * 2. A name-colliding row shows "Name already in use".
 * 3. A name+id colliding row shows "Name and ID already in library".
 * 4. A clean (non-colliding) row shows no sublabel and no resolution Select.
 *
 * Self-seeds one library Function via POST /functions (no-data phase) and
 * validates crafted in-memory files that collide on each axis. Validate is a
 * dry-run, so nothing is committed; the seed is removed on teardown.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { publishLibraryFunction, type SeededLibraryFunction } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const RUN = randomUUID().slice(0, 8)
let seed: SeededLibraryFunction

/** A structurally-valid single-Function import document as an uploadable file.
 *  JSON is also valid YAML, so it parses regardless of extension handling. */
function craftFile(name: string, id: string): { name: string; mimeType: string; buffer: Buffer } {
  const doc = {
    id,
    name,
    description: '',
    tags: [],
    inputs: [],
    outputs: [],
    dependencies: { functions: [], plugins: [] },
    workflow: { nodes: [], edges: [] },
    version: '1.0.0',
  }
  return { name: 'import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) }
}

/** Open the /functions Import dialog, upload `file`, advance to the review step. */
async function openReview(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<ReturnType<Page['locator']>> {
  await page.goto('/functions')
  await expect(page.locator('[data-testid="functions-page"]')).toBeVisible()
  await page.locator('[data-testid="import-button"]').first().click()
  const dialog = page.locator('[data-testid="import-dialog"]')
  await expect(dialog).toBeVisible()
  await dialog.locator('[data-testid="file-input"]').setInputFiles(file)
  await dialog.locator('[data-testid="validate-button"]').click()
  await expect(dialog.locator('[data-testid="review-step"]')).toBeVisible()
  return dialog
}

test.describe('V-LIB-IMPORT-CONFLICT-01: import review conflict-reason sublabel', () => {
  test.beforeAll(async ({ request }) => {
    // A fresh name per beforeAll so a re-seed (e.g. dark then light project on a
    // shared backend) never duplicate-names; the dry-run files key off seed.name.
    seed = await publishLibraryFunction(request, { name: `GSeed-${randomUUID().slice(0, 8)}` })
  })

  test.afterAll(async ({ request }: { request: APIRequestContext }) => {
    await request.delete(`${BACKEND_URL}/functions/${seed.functionId}?cascade=true`).catch(() => {})
  })

  // Pass Criterion 1: id collision -> "ID already in library" + Auto-rename default.
  test('id collision shows "ID already in library" and defaults to Auto-rename', async ({ page }) => {
    const name = `GNew-${RUN}`
    const dialog = await openReview(page, craftFile(name, seed.functionId))
    const row = dialog.locator(`[data-testid="item-result-${name}"]`)
    await expect(row).toContainText('ID already in library')
    await expect(row.locator(`[data-testid="resolution-${name}"]`)).toContainText('Auto-rename')
  })

  // Pass Criterion 2: name collision -> "Name already in use".
  test('name collision shows "Name already in use"', async ({ page }) => {
    const dialog = await openReview(page, craftFile(seed.name, randomUUID()))
    const row = dialog.locator(`[data-testid="item-result-${seed.name}"]`)
    await expect(row).toContainText('Name already in use')
    await expect(row.locator(`[data-testid="resolution-${seed.name}"]`)).toContainText('Auto-rename')
  })

  // Pass Criterion 3: name + id collision -> "Name and ID already in library".
  test('name and id collision shows "Name and ID already in library"', async ({ page }) => {
    const dialog = await openReview(page, craftFile(seed.name, seed.functionId))
    const row = dialog.locator(`[data-testid="item-result-${seed.name}"]`)
    await expect(row).toContainText('Name and ID already in library')
  })

  // Pass Criterion 4: a clean row carries no sublabel and no resolution control.
  test('a clean row shows no conflict sublabel and no resolution control', async ({ page }) => {
    const name = `GClean-${RUN}`
    const dialog = await openReview(page, craftFile(name, randomUUID()))
    const row = dialog.locator(`[data-testid="item-result-${name}"]`)
    await expect(row).toBeVisible()
    // None of the three conflict sublabels ("... already in use/library") render.
    await expect(row).not.toContainText('already')
    await expect(row.locator(`[data-testid="resolution-${name}"]`)).toHaveCount(0)
  })
})
