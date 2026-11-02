/**
 * V-CONSOLE-SOURCE-RESIZE: Console Source-Column Resize Handle Guard
 *
 * Two pre-existing regressions hid in the console's source/message column
 * resize handle, both rooted in lockstep drift between the spacers in the
 * resize-bar overlay (content.tsx) and the spacers in the log row
 * (log-entry.tsx):
 *
 *   1. Stale 12ch timestamp spacer in the resize-bar overlay after the
 *      log row's TIMESTAMP_WIDTH_CH was bumped to 18ch for the timezone
 *      token. The visible 1px line ended up six characters left of the
 *      actual source-column boundary, so users grabbed inside the
 *      source column rather than at the gap.
 *   2. ``all: unset`` on the resize button reset ``pointer-events`` to
 *      ``inherit``, picking up the parent overlay's
 *      ``pointer-events: none`` and silencing every hover/click. The
 *      Tailwind ``pointer-events-auto`` utility lost the cascade race
 *      against the inline ``all: unset``.
 *
 * This spec pins the affordance so the next refactor cannot quietly
 * reintroduce either failure mode. It runs against the live workbench
 * so any future change to timestamp
 * width or the resize-button styling is exercised end-to-end.
 *
 * Pass Criteria:
 *  1. Hovering the resize handle's hit area sets the inner line to
 *     2px width with ``bg-primary`` (visual contrast confirmation).
 *  2. The handle button has ``cursor-col-resize`` in its className.
 *  3. Dragging the handle by +60px / -120px shifts the source column
 *     width by the corresponding number of ch units (within ±1ch).
 *  4. The handle's horizontal center is aligned with the source
 *     column's right edge to within 2px.
 *  5. The source column keeps its set width at every console width: 20
 *     characters by default, where `Log : Say hello` shows whole; dragging
 *     right stops at 50 characters and dragging left stops at 10; the
 *     message takes the rest of the row.
 *
 * REQ: Console guards live alongside REQ-3.4.2.7 / REQ-3.7.2.8
 *      (real-time log streaming) - this is a guardrail spec, not a new
 *      requirement.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

/** The fixture with its first block under a Name of its own. */
function fixtureWithFirstBlockNamed(name: string): Record<string, unknown> {
  const fixture = loadFixture() as { workflow: { nodes: Array<{ data: { label: string } }> } }
  fixture.workflow.nodes[0].data.label = name
  return fixture as unknown as Record<string, unknown>
}

async function importAndOpen(
  page: Page,
  fixture: Record<string, unknown> = loadFixture(),
): Promise<string> {
  const baseName = (fixture as { name?: string }).name ?? 'Console Resize'
  const uniqueFixture = {
    ...fixture,
    name: `${baseName} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }

  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
  await ensureEnvironment(page.request)

  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: uniqueFixture,
  })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = body.data?.id || body.id

  const validateResp = await page.request.post(
    `http://localhost:${BACKEND_PORT}/tests/${testId}/validate`,
  )
  const validateBody = await validateResp.json().catch(() => null)
  expect(
    validateResp.ok(),
    `POST /tests/${testId}/validate failed: ${validateResp.status()}`,
  ).toBeTruthy()
  const errors =
    validateBody?.data?.errors ??
    validateBody?.error?.details?.[0]?.errors ??
    validateBody?.errors ??
    []
  expect(errors.length, `Fixture failed validation: ${JSON.stringify(errors)}`).toBe(0)

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

async function selectE2EEnv(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function ensureConsoleOpen(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="console-panel"]').first()
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    await page
      .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
      .first()
      .click()
    await expect(
      page.locator('[data-testid="console-panel"][data-state="expanded"]').first(),
    ).toBeAttached({ timeout: 5_000 })
  }
}

interface RowMetrics {
  sourceRight: number
  handleCenter: number
}

async function collectAlignmentMetrics(page: Page): Promise<RowMetrics> {
  const sourceRect = await page
    .locator('[data-testid="log-entry-source"]')
    .first()
    .boundingBox()
  const handleRect = await page
    .locator('[data-testid="source-resize-handle"]')
    .boundingBox()
  expect(sourceRect, 'source rect must resolve').not.toBeNull()
  expect(handleRect, 'handle rect must resolve').not.toBeNull()
  return {
    sourceRight: sourceRect!.x + sourceRect!.width,
    handleCenter: handleRect!.x + handleRect!.width / 2,
  }
}

async function getSourceColumnWidthPx(page: Page): Promise<number> {
  const rect = await page.locator('[data-testid="log-entry-source"]').first().boundingBox()
  expect(rect).not.toBeNull()
  return rect!.width
}

async function dragHandleBy(page: Page, deltaPx: number): Promise<void> {
  const handle = page.locator('[data-testid="source-resize-handle"]')
  const box = await handle.boundingBox()
  expect(box, 'handle bounding box must resolve').not.toBeNull()
  const startX = box!.x + box!.width / 2
  const startY = box!.y + box!.height / 2

  // Drive the drag through Playwright's pointer-input pipeline. This
  // matches how a real user would interact with the handle. The React
  // onMouseDown attaches at the React root via event delegation; the
  // synthetic mousedown event correctly bubbles from the button (or the
  // inner 1px line div topmost at click point) up to the root.
  //
  // Empirical note: the parent overlay has `pointer-events: none` and
  // the button uses `all: unset` inline + `pointer-events: auto` inline,
  // so the click lands on the inner line div (which has no
  // pointer-events override). The native mousedown bubbles through the
  // button, where React's listener fires onMouseDown.
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // Give React time to commit setIsDragging(true) and run the useEffect
  // that attaches the document-level mousemove handler.
  await page.waitForTimeout(80)
  // Move in one continuous step (with sub-steps so the document handler
  // sees a smooth curve). The handler reads e.clientX and computes the
  // delta from dragStartXRef.current set in handleResizeStart.
  await page.mouse.move(startX + deltaPx, startY, { steps: 12 })
  await page.waitForTimeout(20)
  await page.mouse.up()
  // Allow a frame for the post-up state update + virtualizer re-measure.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  )
}

const NAMED_BLOCK = 'Say hello'
const NAMED_SOURCE = 'Log : Say hello'
const NAMED_LINE = 'console-resize-line-a'
const DEFAULT_SOURCE_CHARS = 20
const WIDEST_SOURCE_CHARS = 50
const NARROWEST_SOURCE_CHARS = 10
const SOURCE_MESSAGE_GAP_PX = 16

/** The row that carries the fixture's first line. */
function namedRow(page: Page) {
  return page
    .locator('[data-testid^="log-entry-"]')
    .filter({ has: page.locator('[data-testid="log-entry-message"]', { hasText: NAMED_LINE }) })
}

interface SourceColumn {
  setChars: string
  shownChars: number
  text: string
  textPastCellPx: number
  gapToMessagePx: number
  messageEndsShortPx: number
}

/** The Source cell of the named row: its set width, its real width in characters, and the message beside it. */
async function readSourceColumn(page: Page): Promise<SourceColumn> {
  return namedRow(page).evaluate((row) => {
    const source = row.querySelector('[data-testid="log-entry-source"]') as HTMLElement
    const message = row.querySelector('[data-testid="log-entry-message"]') as HTMLElement
    const sourceStyle = globalThis.getComputedStyle(source)
    const probe = document.createElement('span')
    probe.style.fontFamily = sourceStyle.fontFamily
    probe.style.fontSize = sourceStyle.fontSize
    probe.style.visibility = 'hidden'
    probe.style.position = 'absolute'
    probe.style.whiteSpace = 'pre'
    probe.textContent = '0000000000'
    document.body.appendChild(probe)
    const chPx = probe.getBoundingClientRect().width / 10
    probe.remove()
    const written = document.createRange()
    written.selectNodeContents(source)
    const sourceBox = source.getBoundingClientRect()
    const messageBox = message.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    const rowStyle = globalThis.getComputedStyle(row)
    return {
      setChars: source.style.width,
      shownChars: Math.round(sourceBox.width / chPx),
      text: (source.textContent ?? '').trim(),
      textPastCellPx: written.getBoundingClientRect().right - sourceBox.right,
      gapToMessagePx: Math.round(messageBox.left - sourceBox.right),
      messageEndsShortPx: Math.round(
        rowBox.right - Number.parseFloat(rowStyle.paddingRight) - messageBox.right,
      ),
    }
  })
}

async function expectSourceColumn(page: Page, chars: number, what: string): Promise<SourceColumn> {
  await expect
    .poll(async () => (await readSourceColumn(page)).setChars, { message: `${what}: the set width` })
    .toBe(`${chars}ch`)
  const column = await readSourceColumn(page)
  expect(column.shownChars, `${what}: the width on screen, in characters`).toBe(chars)
  expect(column.gapToMessagePx, `${what}: the message starts right after the Source`).toBe(
    SOURCE_MESSAGE_GAP_PX,
  )
  expect(column.messageEndsShortPx, `${what}: the message takes the rest of the row`).toBe(0)
  return column
}

/** Drag the handle to one of the column's limits, repeating a drag the page did not take. */
async function dragToLimit(page: Page, deltaPx: number, chars: number): Promise<void> {
  await expect(async () => {
    await dragHandleBy(page, deltaPx)
    expect((await readSourceColumn(page)).setChars).toBe(`${chars}ch`)
  }).toPass({ timeout: 20_000 })
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('V-CONSOLE-SOURCE-RESIZE: Source-column resize regression guard', () => {
  test('hover, drag, and alignment all stay in lockstep with the live console', async ({ page }) => {
    // The default 1280x800 viewport leaves only ~695px of console width
    // after the sidebar - enough for MIN_SOURCE_WIDTH (10ch) only, not
    // enough room to actually drag. 1920x1080 frees the source column
    // up to ~105ch maximum, plenty of headroom for ±60px drags. The
    // regression we're guarding (spacer drift, lost hover) is layout
    // pixel math, not viewport-coupled, so a wider browser is fine.
    await page.setViewportSize({ width: 1920, height: 1080 })
    await importAndOpen(page)
    await selectE2EEnv(page)

    // Run the workflow so log lines populate the console.
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 20_000 })
    expect(await status.getAttribute('data-status')).toBe('passed')

    await ensureConsoleOpen(page)

    // Wait for the log entries to render (the virtualizer needs a real row
    // before the resize handle is mounted - the overlay renders only when
    // `entries.length > 0`).
    await expect(page.locator('[data-testid^="log-entry-"]').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="source-resize-handle"]')).toBeVisible()

    // ----- Pass Criterion 4: visual line ↔ hit area ↔ source column align
    // Layout note: log-entry.tsx renders a 16px spacer AFTER the source
    // column. The overlay button in content.tsx sits inside a parent span
    // of the same 16px width, with the visible 1px line centered via
    // `left-1/2 -translate-x-1/2`. So the handle's horizontal center
    // lands at sourceRight + 8 (middle of the gap). If the timestamp /
    // level spacers drift, this offset stretches by N*chWidth and the
    // assertion catches it.
    await test.step('handle center sits in the middle of the source/message gap', async () => {
      const { sourceRight, handleCenter } = await collectAlignmentMetrics(page)
      const expectedOffset = 8 // 16px gap, line at the middle
      expect(
        Math.abs(handleCenter - sourceRight - expectedOffset),
        `handleCenter=${handleCenter} sourceRight=${sourceRight} - expected handleCenter ≈ sourceRight + ${expectedOffset}. ` +
          `A larger drift hints the resize-bar spacers got out of sync with log-entry spacers (the 12ch->18ch timestamp regression).`,
      ).toBeLessThanOrEqual(2)
    })

    // ----- Pass Criteria 1 & 2: hover styling + cursor
    await test.step('hover bumps inner line width from 1px to 2px and cursor stays col-resize', async () => {
      const handle = page.locator('[data-testid="source-resize-handle"]')
      const innerLine = handle.locator('div').first()

      // Pointer-events: auto inline beats the parent overlay's
      // pointer-events: none, so the cursor wins the cascade race.
      const cursor = await handle.evaluate(
        (el) => globalThis.getComputedStyle(el as HTMLElement).cursor,
      )
      expect(cursor, 'cursor on the handle button should be col-resize').toBe('col-resize')

      // Push the cursor away from the handle so any prior hover state
      // is cleared, then read the unhovered (resting) width.
      await page.mouse.move(0, 0)
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      )
      const restingWidth = await innerLine.evaluate(
        (el) => globalThis.getComputedStyle(el as HTMLElement).width,
      )
      expect(
        restingWidth,
        `Resting inner-line width should be 1px (w-px). Got: ${restingWidth}`,
      ).toBe('1px')

      // Now hover via real mouse coordinates so the browser's :hover
      // pseudo-class kicks in for both the button (group) and the
      // descendant inner div (group-hover:w-[2px]). ``handle.hover()``
      // sometimes routes through Playwright's element-snapshot path
      // which doesn't always update the computed-style cache for
      // group-hover descendants in chromium headless.
      const box = await handle.boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
      // Confirm the hover landed via :hover lookup before reading the
      // descendant width - useful diagnostic if the assertion later fails.
      const buttonHovered = await handle.evaluate((el) =>
        (el as HTMLElement).matches(':hover'),
      )
      expect(
        buttonHovered,
        'mouse.move should have placed :hover on the resize handle button',
      ).toBeTruthy()

      // The inner div has ``transition-[transform,background-color]`` so the 1px -> 2px change
      // interpolates over the default 150ms duration. Poll the computed
      // width until it settles at 2px (or the transition window expires).
      // 500ms cap is well over the 150ms transition + browser jitter.
      await expect
        .poll(
          async () =>
            innerLine.evaluate((el) => globalThis.getComputedStyle(el as HTMLElement).width),
          {
            timeout: 1500,
            message:
              'Hovered inner-line width should settle at 2px (group-hover:w-[2px]). ' +
              'If this never happens, check that group-hover survives the all: unset reset on the resize button.',
          },
        )
        .toBe('2px')
    })

    // ----- Pass Criterion 3: drag delta translates to column width
    await test.step('drag +60px increases source column width; -120px brings it back narrower', async () => {
      const widthBefore = await getSourceColumnWidthPx(page)

      // Measure the actual ch width on this row's font so the assertion
      // tolerates the screen's monospace ch jitter without baking in a
      // browser-specific constant.
      const chPx = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="log-entry-source"]') as HTMLElement | null
        if (!el) return 0
        const probe = document.createElement('span')
        probe.style.fontFamily = globalThis.getComputedStyle(el).fontFamily
        probe.style.fontSize = globalThis.getComputedStyle(el).fontSize
        probe.style.visibility = 'hidden'
        probe.style.position = 'absolute'
        probe.style.whiteSpace = 'pre'
        probe.textContent = '0000000000'
        document.body.appendChild(probe)
        const w = probe.getBoundingClientRect().width / 10
        probe.remove()
        return w
      })
      expect(chPx, 'measured ch width must be > 0').toBeGreaterThan(0)
      const tolerancePx = chPx * 1.5 // ±1ch jitter plus a half-ch slack for the floor() in the drag delta math

      await dragHandleBy(page, +60)
      const widthAfterPlus = await getSourceColumnWidthPx(page)
      expect(
        widthAfterPlus - widthBefore,
        `+60px drag should widen source column by ~60px (chPx=${chPx.toFixed(2)}). Got delta=${(widthAfterPlus - widthBefore).toFixed(2)}.`,
      ).toBeGreaterThan(60 - tolerancePx)
      expect(widthAfterPlus - widthBefore).toBeLessThan(60 + tolerancePx)

      // Now drag back -120px from the new position (net effect: -60px from start).
      await dragHandleBy(page, -120)
      const widthAfterMinus = await getSourceColumnWidthPx(page)
      expect(
        widthAfterMinus - widthBefore,
        `+60px then -120px should leave source column ~60px narrower than start. Got delta=${(widthAfterMinus - widthBefore).toFixed(2)}.`,
      ).toBeLessThan(-60 + tolerancePx)
      expect(widthAfterMinus - widthBefore).toBeGreaterThan(-60 - tolerancePx)

      // Re-verify alignment after a couple of drags, not only on a fresh page-load.
      await expect(page.locator('[data-testid="source-resize-handle"]')).toBeVisible()
      const post = await collectAlignmentMetrics(page)
      const expectedOffset = 8
      expect(
        Math.abs(post.handleCenter - post.sourceRight - expectedOffset),
        `Post-drag drift: handleCenter=${post.handleCenter} sourceRight=${post.sourceRight}.`,
      ).toBeLessThanOrEqual(2)
    })
  })

  test('the source column keeps its width: 20 characters, 10 to 50 by dragging', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await importAndOpen(page, fixtureWithFirstBlockNamed(NAMED_BLOCK))
    await selectE2EEnv(page)

    await page.locator('[data-testid="run-button"]').click()
    await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute('data-status', 'passed', {
      timeout: 30_000,
    })
    await ensureConsoleOpen(page)
    await expect(namedRow(page)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="source-resize-handle"]')).toBeVisible()

    await test.step('20 characters by default, with the Source of the named block whole', async () => {
      const column = await expectSourceColumn(page, DEFAULT_SOURCE_CHARS, 'at a 1600 px window')
      expect(column.text).toBe(NAMED_SOURCE)
      expect(column.textPastCellPx, 'no letter of the Source runs past its cell').toBeLessThanOrEqual(0.5)
    })

    await test.step('the same 20 characters at a narrower window', async () => {
      await page.setViewportSize({ width: 1280, height: 900 })
      const column = await expectSourceColumn(page, DEFAULT_SOURCE_CHARS, 'at a 1280 px window')
      expect(column.text).toBe(NAMED_SOURCE)
      expect(column.textPastCellPx, 'no letter of the Source runs past its cell').toBeLessThanOrEqual(0.5)
      await page.setViewportSize({ width: 1600, height: 900 })
      await expectSourceColumn(page, DEFAULT_SOURCE_CHARS, 'back at a 1600 px window')
    })

    await test.step('dragging right stops at 50 characters', async () => {
      await dragToLimit(page, +400, WIDEST_SOURCE_CHARS)
      await expectSourceColumn(page, WIDEST_SOURCE_CHARS, 'after a long drag right')
      await dragHandleBy(page, +120)
      const column = await expectSourceColumn(page, WIDEST_SOURCE_CHARS, 'after a second drag right')
      expect(column.text).toBe(NAMED_SOURCE)
    })

    await test.step('dragging left stops at 10 characters', async () => {
      await dragToLimit(page, -500, NARROWEST_SOURCE_CHARS)
      await expectSourceColumn(page, NARROWEST_SOURCE_CHARS, 'after a long drag left')
      await dragHandleBy(page, -80)
      await expectSourceColumn(page, NARROWEST_SOURCE_CHARS, 'after a second drag left')
    })
  })
})
