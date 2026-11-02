/**
 * V-LIBRARY-CARD-NAME-TOOLTIP (visual): Library card name tooltip is
 * conditional - it appears only when the name truncates. Short names get
 * no tooltip. Uses ConditionalTooltip + ResizeObserver-driven truncation
 * measurement.
 *
 * Pass Criteria:
 *   1. Render two LibraryCards: one with a short name (fits the row),
 *      one with a long name (overflows).
 *   2. The SHORT card name span has NO `cursor-help` and hovering does
 *      NOT surface a tooltip.
 *   3. The LONG card name span has `cursor-help` and hovering surfaces a
 *      tooltip whose body is the full name.
 */

import { test, expect, type APIRequestContext, type Locator } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, expandPalette } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

async function seedLibrary(request: APIRequestContext, name: string) {
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-LIBRARY-CARD-NAME-TOOLTIP seed',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial',
      details: '',
    },
  })
  expect(resp.ok(), `POST /functions ${name}: ${resp.status()}`).toBeTruthy()
}

async function createBlankTest(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-LIBRARY-CARD-NAME-TOOLTIP ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Blank Test',
      workflow: { nodes: [], edges: [] },
      variables: {},
    },
  })
  return (await resp.json()).data.id
}

const nameSelector = (name: string) =>
  `[data-testid="library-card-name"][aria-label="${name}"]`

/**
 * Budget for the truncation measurement to reach the DOM. It is generous on
 * purpose: the measurement pipeline runs on the page's main thread, which
 * under 8-shard CI contention shares cores with 7 other stacks.
 */
const CONVERGENCE_TIMEOUT_MS = 60_000

test.describe('V-LIBRARY-CARD-NAME-TOOLTIP (visual)', () => {
  test('Truncated card name gets cursor-help + tooltip; short card name does not', async ({
    page,
    request,
  }) => {
    // Seeding, two workbench loads and the convergence budget below all have
    // to fit inside one test under shard contention.
    test.setTimeout(180_000)

    // A short name (fits) and a long name of WIDE characters (overflows even
    // a ~220px grid column). Truncation is measured per-card against the
    // column width, so we render MULTIPLE cards (filler entries) to keep the
    // grid packed into narrow auto-fill columns - filtering down to a single
    // card would stretch its column wide and defeat the overflow.
    const shortName = `s_${randomUUID().slice(0, 4)}`
    // A full 32-char name of WIDE 'M' glyphs (~11px each -> ~340px) overflows
    // the ~280px name span in a 640px modal's 2-column grid. `padEnd` fills to
    // the 32-char cap (a bare `slice` would NOT pad and could stay short).
    const longName = `Wm${randomUUID().slice(0, 2)}`.padEnd(32, 'M')
    await seedLibrary(request, shortName)
    await seedLibrary(request, longName)
    for (let i = 0; i < 3; i += 1) {
      await seedLibrary(request, `fill_${i}_${randomUUID().slice(0, 4)}`)
    }

    const testId = await createBlankTest(request)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await expandPalette(page)
    const libraryBtn = page.locator('[data-testid="palette-blocks-library-button"]')
    await libraryBtn.click()
    const libraryHandle = page.locator('[data-testid="functions-library-drag-handle"]')
    await expect(libraryHandle).toBeVisible({ timeout: 10_000 })

    // Do NOT filter - keep all cards visible so the grid stays multi-column.
    // The CONTRACT is: `cursor-help` is present IFF the name span actually
    // overflows its container (scrollWidth > clientWidth). Asserting that
    // invariant per card is deterministic regardless of exact glyph widths.
    const longNameSpan = page.locator(nameSelector(longName))
    await expect(longNameSpan).toBeVisible({ timeout: 5_000 })
    const shortNameSpan = page.locator(nameSelector(shortName))
    await expect(shortNameSpan).toBeVisible({ timeout: 5_000 })

    // Settle webfonts BEFORE measuring: a late font swap changes the text
    // width without a box resize, silently flipping the ground truth after
    // the convergence poll (caught live as truncated:false/cursorHelp:true).
    await page.evaluate(() => document.fonts.ready.then(() => undefined))

    // Nudge the layout so the component's measurement (useLayoutEffect +
    // ResizeObserver, with window-resize + fonts.ready fallbacks) runs
    // against the FINAL grid column widths. On initial mount the card can
    // measure mid-layout before the grid settles its columns; a resize event
    // triggers the component's defensive re-measure.
    await page.setViewportSize({ width: 1320, height: 800 })
    await page.setViewportSize({ width: 1280, height: 800 })

    const measure = async (locator: Locator) =>
      locator.evaluate((el: Element) => ({
        truncated: (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth,
        cursorHelp: (el as HTMLElement).className.includes('cursor-help'),
      }))

    // Wait until the class agrees with the measured truncation on BOTH cards.
    // The ResizeObserver callback -> setState -> commit pipeline can straggle
    // past any fixed wait under sharded-CI CPU contention (a one-shot measure
    // at +400ms flaked with truncated:true/cursorHelp:false, then a 10s
    // protocol-sampled poll straggled past its own limit too). This watches
    // from INSIDE the page on the requestAnimationFrame cadence, so the commit
    // is seen on the frame it lands rather than on whatever sample a protocol
    // round-trip happens to take, and the budget is one contention-proof size.
    // A component regression still fails: convergence never happens, and the
    // per-card invariants below then report the measured values.
    await page
      .waitForFunction(
        (selectors: string[]) =>
          selectors.every((selector) => {
            const el = document.querySelector(selector)
            if (!(el instanceof HTMLElement)) return false
            return el.className.includes('cursor-help') === (el.scrollWidth > el.clientWidth)
          }),
        [nameSelector(longName), nameSelector(shortName)],
        { polling: 'raf', timeout: CONVERGENCE_TIMEOUT_MS },
      )
      .catch(() => {
        // Deliberate fall-through: the invariant assertions below fail with the
        // actual scrollWidth/cursor-help values, which a bare timeout hides.
      })

    const longM = await measure(longNameSpan)
    const shortM = await measure(shortNameSpan)

    // Invariant: cursor-help matches actual truncation for BOTH cards.
    expect(longM.cursorHelp, `long-name cursor-help must match truncation ${JSON.stringify(longM)}`).toBe(
      longM.truncated,
    )
    expect(shortM.cursorHelp, `short-name cursor-help must match truncation ${JSON.stringify(shortM)}`).toBe(
      shortM.truncated,
    )

    // The wide 32-char name is expected to overflow the ~300px grid column;
    // if it does, hovering must surface the full-name tooltip.
    expect(longM.truncated, `wide 32-char name should overflow the column; got ${JSON.stringify(longM)}`).toBe(
      true,
    )
    await longNameSpan.hover()
    await expect(page.locator('[role="tooltip"]', { hasText: longName }).first()).toBeVisible({
      timeout: 5_000,
    })

    // The short name fits, so it must not be truncated and must have no cursor-help.
    expect(shortM.truncated, 'short name must NOT truncate').toBe(false)
  })
})
