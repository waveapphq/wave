/**
 * V-PYEDIT-06: Python script editor, help popover with the tips open
 * Design Decisions: PYRUN-13, PYRUN-18
 * REQ: REQ-3.4.1.2
 *
 * Runs in the no-data project list. Each test seeds its own Test through
 * POST /tests and afterAll deletes it. Theme-agnostic DOM assertions.
 *
 * Pass Criteria:
 * 1. Clicking "Show tips" expands the tips and the link then reads "Hide tips".
 * 2. The four subsections render in order: Inputs, Outputs, Logging and
 *    failure, Files and modules.
 * 3. Every tip line is a short sentence plus a mono example, verbatim PYRUN-13.
 * 4. The popover scrolls and the X scrolls with the content.
 * 5. "Hide tips" collapses them again.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { deletePythonTest, openPythonScriptSheet, seedAndOpenPythonTest } from './python-seed'

interface TipSection {
  heading: string
  tips: Array<{ text: string; example: string | null }>
}

/** PYRUN-13, verbatim and in order. A tip without an example carries none. */
const TIP_SECTIONS: TipSection[] = [
  {
    heading: 'Inputs',
    tips: [
      { text: 'Input Variables are globals', example: 'limit = float(threshold)' },
      { text: 'A table iterates as row dicts', example: 'for row in readings: row["temp_c"]' },
      { text: 'Floats arrive as Decimal', example: 'float(price) * 2' },
    ],
  },
  {
    heading: 'Outputs',
    tips: [
      {
        text: 'Assign a name to fill a Variable Export',
        example: 'summary = {"mean": mean_temp}',
      },
      { text: 'A list of dicts fills a table export', example: 'rows = [{"id": 1, "ok": True}]' },
      { text: 'Exports are read even when the script raises', example: null },
    ],
  },
  {
    heading: 'Logging and failure',
    tips: [
      {
        text: 'logging goes to the run console, print to Stdout',
        example: 'logging.info("done %d", count)',
      },
      {
        text: 'An exception or a failed assert fails the block with its traceback',
        example: 'assert ok, "no rows"',
      },
      { text: 'sys.exit ends with that exit code', example: 'sys.exit(2)' },
    ],
  },
  {
    heading: 'Files and modules',
    tips: [
      { text: 'Modules in the Working Directory import by name', example: 'import helpers' },
      {
        text: 'Test Data and Artifacts folders come from the environment',
        example: 'os.environ["WAVE_TESTDATA_DIR"]',
      },
    ],
  },
]

/** The cap the tips region is held to, so more tips than fit have to be scrolled to. */
const TIPS_MAX_HEIGHT_PX = 256

const created: string[] = []

const popover = (page: Page) => page.locator('[data-testid="python-help-popover"]')
const tipsToggle = (page: Page, label: string) =>
  popover(page).getByRole('button', { name: label })

interface TipsRegion {
  areaHeight: number
  contentHeight: number
  scrolls: boolean
}

/** The tips region: the box the cap holds it to, the height of the tips in it, and whether it scrolls. */
function tipsRegion(page: Page): Promise<TipsRegion> {
  return popover(page).evaluate((root) => {
    const viewport = root.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
    const area = viewport.parentElement as HTMLElement
    const content = viewport.firstElementChild as HTMLElement
    return {
      areaHeight: Math.round(area.getBoundingClientRect().height),
      contentHeight: Math.round(content.getBoundingClientRect().height),
      scrolls: viewport.scrollHeight > viewport.clientHeight,
    }
  })
}

/** Open the sheet, raise the help and expand the tips. */
async function openTips(page: Page, sheet: Locator): Promise<void> {
  await sheet.locator('[data-testid="value-editor-help-chip"]').click()
  await expect(popover(page)).toBeVisible()
  await tipsToggle(page, 'Show tips').click()
  await expect(tipsToggle(page, 'Hide tips')).toHaveAttribute('aria-expanded', 'true')
}

test.describe('V-PYEDIT-06: the tips of the Python script editor help', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deletePythonTest(request, testId)
  })

  test('V-PYEDIT-06 tips: four subsections, each line a sentence and a mono example', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-06 tips'))
    const sheet = await openPythonScriptSheet(page)
    await openTips(page, sheet)

    // PYRUN-13: the tips, verbatim, in the order the design lists them.
    const rendered = await popover(page).evaluate((root) =>
      Array.from(root.querySelectorAll('h4')).map((heading) => ({
        heading: heading.textContent ?? '',
        tips: Array.from((heading.nextElementSibling as HTMLElement).querySelectorAll('li')).map(
          (item) => ({
            text: item.querySelector('span')?.textContent ?? '',
            example: item.querySelector('code')?.textContent ?? null,
          }),
        ),
      })),
    )
    expect(rendered).toEqual(TIP_SECTIONS)

    const example = popover(page).locator('code').first()
    const font = await example.evaluate((element) => globalThis.getComputedStyle(element).fontFamily)
    expect(font.toLowerCase(), 'the example is set in a mono face').toContain('mono')
  })

  test('V-PYEDIT-06 region: the tips are capped, the X rides the content, Hide tips closes them', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-06 region'))
    const sheet = await openPythonScriptSheet(page)
    await openTips(page, sheet)

    const region = await tipsRegion(page)
    expect(region.areaHeight, 'the tips are held to their cap').toBeLessThanOrEqual(
      TIPS_MAX_HEIGHT_PX,
    )
    expect(region.contentHeight, 'there are more tips than fit').toBeGreaterThan(region.areaHeight)

    // Declared deviation (blueprint-tests section 3): the X rides the content
    // instead of being pinned over the visible area.
    const closePosition = await popover(page)
      .getByRole('button', { name: 'Close help' })
      .evaluate((element) => globalThis.getComputedStyle(element).position)
    expect(closePosition, 'the X is not pinned').not.toBe('sticky')
    expect(closePosition, 'the X is not pinned').not.toBe('fixed')

    await tipsToggle(page, 'Hide tips').click()
    await expect(tipsToggle(page, 'Show tips')).toHaveAttribute('aria-expanded', 'false')
    await expect(popover(page).locator('h4')).toHaveCount(0)
  })

  test('V-PYEDIT-06 scroll: the tips past the cap are reached by scrolling', async ({ page }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-06 scroll'))
    const sheet = await openPythonScriptSheet(page)
    await openTips(page, sheet)

    const region = await tipsRegion(page)
    expect(region.contentHeight, 'there are more tips than fit').toBeGreaterThan(region.areaHeight)
    expect(region.scrolls, 'the rest is reached by scrolling').toBe(true)
  })
})
