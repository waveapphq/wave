/**
 * V-CANVAS-BREADCRUMB-OVERFLOW: Long test name truncates inside breadcrumb
 *
 * Phase: no-data (parallel) - drives the workbench Save flow with a long name
 * to trigger the breadcrumb update; no fixture data.
 * Layout under test: canvas-breadcrumb-bar.tsx (left side `min-w-0 flex-1`,
 * right side `shrink-0`, name segment wrapped in multiline tooltip).
 *
 * Pass Criteria:
 *  1. After saving a workflow with a 200-char name, the breadcrumb's name
 *     segment is the last (and only here) clickable/text segment, and shows
 *     ellipsis (the inner span has scrollWidth > clientWidth).
 *  2. The Reset button and Status indicator stay visible on the right side
 *     (right edge inside the viewport, no horizontal page overflow).
 *  3. The breadcrumb container's left and right halves use the proper layout:
 *     left has `min-w-0 flex-1`, right has `shrink-0`.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  dragPaletteItemToCanvas,
  mockInventedTestReads,
  waitForCanvasLoad,
} from '../../helpers/canvas'

const LONG_NAME =
  'this is an exceptionally long test name designed to push the breadcrumb width past its layout cap so we can verify the truncation contract holds and the right side never gets pushed off-screen by an unbounded label segment'.slice(
    0,
    200,
  )

async function saveWithName(page: Page, name: string) {
  // The synthesized test does not exist on the server, so its post-save
  // re-read has to be answered here too or the canvas blocks.
  await mockInventedTestReads(page, ['test-breadcrumb-overflow'])
  // The Shell Script node we drop has no `script` parameter set, so a real POST
  // /tests would 400 on validation and the dialog would stay open. We don't
  // care about persistence here - we want the breadcrumb to render the long
  // name. Mock POST /tests to return a synthesized test so the FE save flow
  // closes the dialog and updates the breadcrumb path. (Mirrors the pattern
  // in v-save-01-S16.)
  await page.route('**/tests', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: 'test-breadcrumb-overflow',
            name,
            description: null,
            tags: [],
            workflow: { nodes: [], edges: [] },
          },
        }),
      })
    } else {
      await route.continue()
    }
  })

  await page.goto('/workbench')
  await waitForCanvasLoad(page)
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'shell script', { x: cb!.width / 2, y: cb!.height / 2 })

  await page.locator('[data-testid="toolbar-save-button"]').click()
  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible({ timeout: 10000 })

  const nameInput = dialog.locator('textarea#test-name')
  await nameInput.fill(name)

  await dialog.getByRole('button', { name: /Create Test/i }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })

  // Wait for the breadcrumb to reflect the saved test name.
  const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
  await expect(breadcrumb).toBeVisible()
  await expect(breadcrumb.locator('[data-testid="breadcrumb-path"]')).toContainText(
    name.slice(0, 30),
  )
  return breadcrumb
}

test.describe('V-CANVAS-BREADCRUMB-OVERFLOW: long name truncates and right side stays visible', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: 200-char name truncates inside the breadcrumb (scrollWidth > clientWidth) and hover surfaces the full name', async ({
    page,
  }) => {
    const breadcrumb = await saveWithName(page, LONG_NAME)

    // The breadcrumb path contains (or starts with) the long name and is
    // bounded by the viewport.
    await expect(breadcrumb.locator('[data-testid="breadcrumb-path"]')).toContainText(
      LONG_NAME.slice(0, 30),
    )
    const breadcrumbBox = await breadcrumb.boundingBox()
    const viewport = page.viewportSize()
    expect(breadcrumbBox).toBeTruthy()
    expect(viewport).toBeTruthy()
    expect(breadcrumbBox!.x + breadcrumbBox!.width).toBeLessThanOrEqual(
      viewport!.width + 1,
    )

    // The leaf TruncatedName's inner .truncate span clips with
    // `scrollWidth > clientWidth`. A "contains the name" check would miss an
    // inline-block tooltip wrapper that measures 0 (scrollWidth == clientWidth == 0).
    const leafSpan = breadcrumb.locator('[data-testid="breadcrumb-path"] .truncate').last()
    await expect(leafSpan).toBeVisible()
    const measured = await leafSpan.evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
    }))
    expect(measured.sw).toBeGreaterThan(measured.cw + 1)

    // Hover surfaces the Radix multiline tooltip (now portal-rendered via
    // TruncatedName's createPortal, not the legacy inline-block Tooltip
    // wrapper) with the full long name.
    await leafSpan.hover()
    const tooltip = page.getByRole('tooltip').first()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveText(LONG_NAME)
  })

  test('S2: Reset button and Status indicator stay visible on the right', async ({
    page,
  }) => {
    const breadcrumb = await saveWithName(page, LONG_NAME)
    const reset = breadcrumb.locator('[data-testid="breadcrumb-reset-link"]')
    const status = breadcrumb.locator('[data-testid="workflow-status"]')

    await expect(reset).toBeVisible()
    await expect(status).toBeVisible()

    const breadcrumbBox = await breadcrumb.boundingBox()
    const resetBox = await reset.boundingBox()
    const statusBox = await status.boundingBox()

    expect(breadcrumbBox).toBeTruthy()
    expect(resetBox).toBeTruthy()
    expect(statusBox).toBeTruthy()
    // Right side stays inside the breadcrumb container with no horizontal overflow.
    expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(
      breadcrumbBox!.x + breadcrumbBox!.width + 1,
    )
    expect(resetBox!.x + resetBox!.width).toBeLessThanOrEqual(
      breadcrumbBox!.x + breadcrumbBox!.width + 1,
    )
  })

  test('S3: layout uses min-w-0 flex-1 on left, shrink-0 on right', async ({ page }) => {
    const breadcrumb = await saveWithName(page, LONG_NAME)
    // The breadcrumb root has two direct flex children: left (path) and right (reset+status).
    const leftHalf = breadcrumb.locator('> div').first()
    const rightHalf = breadcrumb.locator('> div').last()
    const leftClass = (await leftHalf.getAttribute('class')) ?? ''
    const rightClass = (await rightHalf.getAttribute('class')) ?? ''
    expect(leftClass).toContain('min-w-0')
    expect(leftClass).toContain('flex-1')
    expect(rightClass).toContain('shrink-0')
  })

  test('S4: page does not horizontally overflow with a 200-char name', async ({ page }) => {
    await saveWithName(page, LONG_NAME)
    const html = page.locator('html')
    const sw = await html.evaluate((el) => el.scrollWidth)
    const cw = await html.evaluate((el) => el.clientWidth)
    expect(sw).toBeLessThanOrEqual(cw + 1)
  })
})
