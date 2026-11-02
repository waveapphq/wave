/**
 * V-PAGE-BLOCKED-FUNCTIONS: a failed Function read is never read as "nothing"
 *
 * Phase: functional-workflow. A failed per-version usage read never becomes an
 * empty map, so a version in use never reads as used by nothing. A failed library
 * read never becomes an empty library.
 *
 * Design Decisions: LIST-10 (a supporting read blocks its surface), LIST-18
 * (the blocked surface is whatever the failed read serves), LIST-13 (blocked
 * means inert, not covered).
 *
 * Pass Criteria:
 *  1. A failed usage read blocks the Function detail page and names the usage
 *     read; the versions themselves are on screen, so "used by nothing" was the
 *     only thing missing.
 *  2. With the page inert, the per-version delete control cannot be operated at
 *     all, even with the card and the wash deleted from the DOM.
 *  3. Forced live again, both delete paths refuse: no DELETE request is issued
 *     by either, the page says why, and the version is still on the server.
 *  4. A failed library read shows the library's own error state with its own
 *     Try Again, never the empty-library copy, and never blurs the canvas
 *     behind the open modal.
 *  5. Try Again over a restored backend fills the library.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { countApiFetches, failApiRoute } from '../../helpers/api-route'
import { expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import {
  FUNCTIONS_LIST_ROUTE,
  blockedRouteContent,
  expectBlockedWith,
  expectNotBlocked,
  functionRoute,
  functionUsageRoute,
  functionVersionRoute,
  startAtRoot,
  stripBlockedOverlay,
} from '../../helpers/page-block'
import {
  publishLibraryFunction,
  addLibraryVersion,
  releaseWorkbenchOwnership,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'

const STAMP = `${Date.now()}`
const USAGE_DETAIL = 'Dependency index unavailable'
const LIBRARY_DETAIL = 'Function catalog unavailable'
const USAGE_REFUSAL =
  'Could not load where this version is used. Try Again to load it, then delete.'
const EMPTY_LIBRARY_COPY = 'No published Functions yet. Build one in the canvas, then Publish it.'

const seeded: SeededLibraryFunction[] = []

async function seedFunction(request: APIRequestContext, name: string): Promise<SeededLibraryFunction> {
  const fn = await publishLibraryFunction(request, { name })
  seeded.push(fn)
  return fn
}

/** Free the single workbench slot and drop any leftover session. */
async function freeWorkbench(page: Page): Promise<void> {
  await releaseWorkbenchOwnership(page.request)
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
}

/** Click through the blur with a raw mouse press, so no actionability check hides the result. */
async function pressAt(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox()
  expect(box, `${selector} must be laid out`).toBeTruthy()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
}

test.describe('V-PAGE-BLOCKED-FUNCTIONS: a failed read never becomes an empty answer', () => {
  test.afterAll(async ({ request }) => {
    for (const fn of seeded) {
      await request.delete(`${BACKEND_URL}/functions/${fn.functionId}?cascade=true`).catch(
        () => undefined,
      )
    }
  })

  test('F1: a version whose usage read failed cannot be deleted by either path', async ({
    page,
    request,
  }) => {
    const fn = await seedFunction(request, `PBLK Usage ${STAMP}`)
    await addLibraryVersion(request, fn, { sourceVersion: '1.0.0', targetVersion: '1.1.0' })

    await startAtRoot(page)
    await failApiRoute(page, functionUsageRoute(fn.functionId), { detail: USAGE_DETAIL })
    const versionDeletes = countApiFetches(
      page,
      functionVersionRoute(fn.functionId, '1.0.0'),
      'DELETE',
    )
    const functionDeletes = countApiFetches(page, functionRoute(fn.functionId), 'DELETE')

    await page.goto(`/functions/${fn.functionId}`)
    await expectBlockedWith(page, 'Could not load where this version is used')

    // The versions read succeeded, so an unknown usage was the only gap.
    await expect(page.getByTestId('function-detail-page')).toBeVisible()
    await expect(page.locator('[data-testid="version-nav-item-1.0.0"]')).toBeVisible()

    // 1. Inert refuses the delete control even with every layer deleted.
    const removed = await stripBlockedOverlay(page)
    expect(removed, 'the blocked page must have had a layer over it').toBeGreaterThan(0)
    const dialog = page.getByRole('alertdialog')
    await pressAt(page, '[data-testid="version-delete-1.0.0"]')
    await page.waitForTimeout(500)
    await expect(dialog, 'an inert page must not open the delete dialog').toHaveCount(0)

    // 2. Forced live again, the guard is what refuses the delete - not the blur.
    await blockedRouteContent(page).evaluate((el) => el.removeAttribute('inert'))
    await page.locator('[data-testid="version-delete-1.0.0"]').click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('function-detail-page')).toContainText(USAGE_REFUSAL)
    expect(versionDeletes(), 'no per-version delete may be issued').toBe(0)

    // 3. The whole-Function delete is refused the same way.
    await page.locator('[data-testid="delete-function"]').click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/functions/${fn.functionId}$`))
    expect(functionDeletes(), 'no whole-Function delete may be issued').toBe(0)

    // 4. The server still has both versions.
    const check = await request.get(`${BACKEND_URL}/functions/${fn.functionId}/versions`)
    expect(check.ok(), 'the versions read must still answer').toBeTruthy()
    const body = await check.json()
    const versions = (body.data ?? body).versions as Array<{ version: string }>
    expect(versions.map((entry) => entry.version).sort()).toEqual(['1.0.0', '1.1.0'])
  })

  test('F2: a failed library read shows the library error, never an empty library', async ({
    page,
    request,
  }) => {
    // Seeded so the library is genuinely non-empty: without it the empty-copy
    // branch and the error branch could not be told apart.
    await seedFunction(request, `PBLK Library ${STAMP}`)
    let failing = true

    await freeWorkbench(page)
    await startAtRoot(page)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Routed only once the canvas is up, so the failure under test is the
    // library read and nothing the canvas needed.
    await failApiRoute(page, FUNCTIONS_LIST_ROUTE, () =>
      failing ? { detail: LIBRARY_DETAIL } : null,
    )

    await expandPalette(page)
    await page.locator('[data-testid="palette-blocks-library-button"]').click()
    const library = page.locator('[data-testid="functions-library"]')
    await expect(library).toBeVisible({ timeout: 15000 })

    const errorState = library.getByTestId('functions-library-error')
    await expect(errorState).toBeVisible({ timeout: 15000 })
    await expect(library.getByTestId('error-state-title')).toHaveText('Unable to load Functions')
    await expect(
      library,
      'a failed read must never be presented as an empty library',
    ).not.toContainText(EMPTY_LIBRARY_COPY)
    await expect(library.getByTestId('functions-library-grid')).toHaveCount(0)

    // The modal owns its own failure; the canvas behind it is untouched.
    await expectNotBlocked(page)

    // The grid renders only over a non-empty library, so it appearing is the
    // proof that the read landed and the seeded Function is in it.
    failing = false
    await errorState.getByRole('button', { name: 'Try Again' }).click()
    await expect(library.getByTestId('functions-library-grid')).toBeVisible({ timeout: 15000 })
    await expect(errorState).toHaveCount(0)
    await expectNotBlocked(page)
  })
})
