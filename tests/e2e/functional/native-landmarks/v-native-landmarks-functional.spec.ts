/**
 * V-NATIVE-LANDMARKS: native elements on the variable manager and the console
 *
 * REQ: none
 *
 * Pass Criteria:
 * 1. Every variable row is a fieldset with the implicit role group and its
 *    name "Variable <name>", with no explicit role attribute.
 * 2. A row's box, within 1 pixel, is 63 pixels high
 *    (INLINE_VARIABLE_ROW_HEIGHT) and as wide as the panel, also for a
 *    variable whose name is far wider than the panel: the row does not grow
 *    past the panel, the panel does not scroll sideways, the name truncates
 *    (min-w-0 on the fieldset).
 * 3. A filter that matches no variable shows "No variables match filter" as an
 *    output with the implicit role status and no explicit role attribute; its
 *    box is as wide as the panel and 84 pixels high (py-8 plus the text-sm
 *    line), within 1 pixel (block on the output).
 * 4. The Test runs through the UI to passed; the Var Setter values reach the
 *    three downstream Log Blocks: the console carries
 *    [INFO] native-landmarks-alpha=alpha-set, [WARN] native-landmarks-count=7
 *    and [INFO] native-landmarks-wide=wide-set, and the rows show the runtime
 *    values alpha-set, 7 and wide-set.
 * 5. Every console entry is an article with the implicit role article, its
 *    name "<level>: <message>", and no explicit role attribute.
 * 6. Every console entry's box, within 1 pixel, is as wide as its list slot;
 *    the three Log Block entries are round(font size x 2.2) high with line
 *    height round(font size x 1.5).
 * 7. Criteria 1 to 3 hold after the run, after a reload, and on the
 *    read-only history page of a tracked run of the same Test (started through
 *    POST /executions, outcome passed; a Workbench run has no history page);
 *    criteria 5 and 6 hold in the live workbench and on that history page.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { clearSettledWorkbenchSession, openRunHistory, runTrackedTest } from '../../helpers/k8s-run'
import { expectConsoleLine } from '../../helpers/log-reader'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { runToEnd, selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const ROW_HEIGHT_PX = 63
// py-8 (32 + 32) around one text-sm line (20).
const NO_MATCH_HEIGHT_PX = 84
const NO_MATCH_TEXT = 'No variables match filter'
const NO_MATCH_FILTER = 'zz_native_landmarks_matches_nothing'

// 64 characters, the variable name limit; far wider than the 320px panel.
const WIDE_NAME = 'nl_wide_name_far_past_the_variable_manager_panel_width_truncates'
const VARIABLES = [
  { name: 'nl_alpha', runtime: 'alpha-set' },
  { name: 'nl_count', runtime: '7' },
  { name: WIDE_NAME, runtime: 'wide-set' },
]
const LOG_LINES = [
  { level: 'INFO', message: 'native-landmarks-alpha=alpha-set' },
  { level: 'WARN', message: 'native-landmarks-count=7' },
  { level: 'INFO', message: 'native-landmarks-wide=wide-set' },
]

const PANEL = '[data-testid="variable-manager-content"]'
const FILTER = 'input[aria-label="Filter variables"]'

let testId = ''

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'),
  ) as Record<string, unknown>
  fixture.name = `V-NATIVE-LANDMARKS ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return fixture
}

test.beforeAll(async ({ request }) => {
  await ensureEnvironment(request)
  const createResp = await request.post(`${BACKEND_URL}/tests`, { data: loadFixture() })
  const body = await createResp.json().catch(() => null)
  expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`).toBe(true)
  testId = (body.data?.id || body.id) as string

  const validateResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const validateBody = await validateResp.json().catch(() => null)
  expect(validateResp.ok(), `POST /tests/${testId}/validate failed: ${validateResp.status()}`).toBe(true)
  const errors = validateBody?.data?.errors ?? validateBody?.errors ?? []
  expect(errors, `validation errors: ${JSON.stringify(errors)}`).toEqual([])
})

test.afterAll(async ({ request }) => {
  if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
})

interface ElementFacts {
  tag: string
  roleAttr: string | null
  width: number
  height: number
  panelWidth: number
  panelScrollWidth: number
}

async function factsOf(element: Locator): Promise<ElementFacts> {
  return element.evaluate((el, panelSelector) => {
    const panel = el.closest(panelSelector) as HTMLElement
    const rect = el.getBoundingClientRect()
    return {
      tag: el.tagName,
      roleAttr: el.getAttribute('role'),
      width: rect.width,
      height: rect.height,
      panelWidth: panel.clientWidth,
      panelScrollWidth: panel.scrollWidth,
    }
  }, PANEL)
}

/** Criteria 1 and 2: every row is a fieldset of its expected size. */
async function expectNativeRows(page: Page, view: string): Promise<void> {
  for (const { name } of VARIABLES) {
    const row = variableRow(page, name)
    await expect(row, `${view}: the row of ${name} renders`).toHaveCount(1, { timeout: 15_000 })
    const facts = await factsOf(row)
    // The row is a native fieldset with no role attribute.
    expect(facts.tag, `${view}: the row of ${name} is a fieldset`).toBe('FIELDSET')
    expect(facts.roleAttr, `${view}: the row of ${name} has no explicit role`).toBeNull()
    await expect(
      page.locator(PANEL).getByRole('group', { name: `Variable ${name}`, exact: true }),
      `${view}: the row of ${name} keeps the role group and its name`,
    ).toHaveCount(1)
    expect(
      Math.abs(facts.height - ROW_HEIGHT_PX),
      `${view}: the row of ${name} is ${ROW_HEIGHT_PX}px high, got ${facts.height}`,
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(facts.width - facts.panelWidth),
      `${view}: the row of ${name} is as wide as the panel (${facts.panelWidth}px), got ${facts.width}`,
    ).toBeLessThanOrEqual(1)
  }

  // min-w-0 keeps the fieldset from growing to its min-content width.
  const wide = await factsOf(variableRow(page, WIDE_NAME))
  expect(
    wide.panelScrollWidth - wide.panelWidth,
    `${view}: the panel does not scroll sideways for the wide name`,
  ).toBeLessThanOrEqual(1)
  const nameTruncated = await variableRow(page, WIDE_NAME)
    .locator('[data-testid^="variable-name-"]')
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  expect(nameTruncated, `${view}: the wide name truncates inside its row`).toBe(true)
}

/** Criterion 3: the no match line is an output of its expected size. */
async function expectNativeNoMatch(page: Page, view: string): Promise<void> {
  const filter = page.locator(PANEL).locator(FILTER)
  await filter.fill(NO_MATCH_FILTER)
  const line = page.locator(PANEL).getByText(NO_MATCH_TEXT, { exact: true })
  await expect(line, `${view}: the no match line shows`).toBeVisible({ timeout: 10_000 })
  const facts = await factsOf(line)
  // A native output with no role attribute.
  expect(facts.tag, `${view}: the no match line is an output`).toBe('OUTPUT')
  expect(facts.roleAttr, `${view}: the no match line has no explicit role`).toBeNull()
  await expect(
    page.locator(PANEL).getByRole('status').filter({ hasText: NO_MATCH_TEXT }),
    `${view}: the no match line keeps the role status`,
  ).toHaveCount(1)
  expect(
    Math.abs(facts.width - facts.panelWidth),
    `${view}: the no match line is as wide as the panel (${facts.panelWidth}px), got ${facts.width}`,
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(facts.height - NO_MATCH_HEIGHT_PX),
    `${view}: the no match line is ${NO_MATCH_HEIGHT_PX}px high, got ${facts.height}`,
  ).toBeLessThanOrEqual(1)

  await filter.fill('')
  await expect(line, `${view}: clearing the filter brings the rows back`).toHaveCount(0)
  await expect(variableRow(page, VARIABLES[0].name)).toHaveCount(1)
}

interface EntryFacts {
  tag: string
  roleAttr: string | null
  label: string
  width: number
  height: number
  slotWidth: number
  fontSize: number
  lineHeight: number
}

/** Walk the virtualized console top to bottom and read every entry once. */
async function readConsoleEntries(page: Page): Promise<EntryFacts[]> {
  const log = page.getByRole('log').first()
  await expect(log, 'the console log is open').toBeVisible({ timeout: 10_000 })
  return log.evaluate(async (container) => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const byId = new Map<string, EntryFacts>()
    const read = () => {
      for (const el of Array.from(container.querySelectorAll('[data-testid^="log-entry-"]'))) {
        if (!el.querySelector('[data-testid="log-entry-message"]')) continue
        const id = el.getAttribute('data-testid') ?? ''
        if (byId.has(id)) continue
        const rect = el.getBoundingClientRect()
        const slot = el.parentElement as HTMLElement
        const style = getComputedStyle(el)
        byId.set(id, {
          tag: el.tagName,
          roleAttr: el.getAttribute('role'),
          label: el.getAttribute('aria-label') ?? '',
          width: rect.width,
          height: rect.height,
          slotWidth: slot.getBoundingClientRect().width,
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
        })
      }
    }
    container.scrollTop = 0
    await frame()
    await frame()
    for (let i = 0; i < 400; i++) {
      read()
      const before = container.scrollTop
      container.scrollTop = before + Math.max(1, Math.floor(container.clientHeight * 0.8))
      await frame()
      await frame()
      if (container.scrollTop <= before) {
        read()
        break
      }
    }
    return Array.from(byId.values())
  })
}

/** Criteria 5 and 6: every console entry is an article of its expected size. */
async function expectNativeEntries(page: Page, view: string): Promise<void> {
  const entries = await readConsoleEntries(page)
  expect(entries.length, `${view}: the console holds entries`).toBeGreaterThan(0)
  for (const entry of entries) {
    // A native article with no role attribute.
    expect(entry.tag, `${view}: "${entry.label}" is an article`).toBe('ARTICLE')
    expect(entry.roleAttr, `${view}: "${entry.label}" has no explicit role`).toBeNull()
    expect(
      Math.abs(entry.width - entry.slotWidth),
      `${view}: "${entry.label}" is as wide as its slot (${entry.slotWidth}px), got ${entry.width}`,
    ).toBeLessThanOrEqual(1)
  }
  for (const { level, message } of LOG_LINES) {
    const label = `${level}: ${message}`
    const entry = entries.find((e) => e.label === label)
    expect(entry, `${view}: the console carries "${label}"`).toBeDefined()
    const rowHeight = Math.round(entry!.fontSize * 2.2)
    const lineHeight = Math.round(entry!.fontSize * 1.5)
    expect(
      Math.abs(entry!.height - rowHeight),
      `${view}: "${label}" is ${rowHeight}px high, got ${entry!.height}`,
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(entry!.lineHeight - lineHeight),
      `${view}: "${label}" has a ${lineHeight}px line, got ${entry!.lineHeight}`,
    ).toBeLessThanOrEqual(1)
  }

  // The entries the virtualizer shows keep the role article and their names.
  const log = page.getByRole('log').first()
  const shown = log.locator('[data-testid^="log-entry-"]').filter({
    has: page.locator('[data-testid="log-entry-message"]'),
  })
  const shownLabels = await shown.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
  expect(shownLabels.length, `${view}: the console shows entries`).toBeGreaterThan(0)
  await expect(log.getByRole('article'), `${view}: each shown entry has the role article`).toHaveCount(
    shownLabels.length,
  )
  for (const label of shownLabels) {
    await expect(
      log.getByRole('article', { name: label, exact: true }).first(),
      `${view}: the entry keeps its name "${label}"`,
    ).toBeAttached()
  }
}

async function openConsole(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="console-panel"]').first()
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await page
      .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
      .first()
      .click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

test.describe('V-NATIVE-LANDMARKS: native elements on the variable manager and the console', () => {
  test('rows are fieldsets, the no match line is an output, console entries are articles, sizes unchanged', async ({
    page,
  }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)
    await expandVariableManager(page)

    await test.step('Edit view before the run: rows and the no match line', async () => {
      // Fail fast: the element checks come before the run.
      await expectNativeRows(page, 'edit view')
      await expectNativeNoMatch(page, 'edit view')
    })

    await test.step('Run through the UI: values reach every Log Block', async () => {
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expect(verdict, 'the session outcome').toBe('passed')
      for (const { level, message } of LOG_LINES) expectConsoleLine(entries, level, message)
      for (const { name, runtime } of VARIABLES) {
        await expect(
          variableRow(page, name).locator('[data-testid^="variable-value-"]'),
          `the row of ${name} shows its runtime value`,
        ).toContainText(runtime)
      }
    })

    await test.step('Edit view after the run: rows, no match line, console entries', async () => {
      await expectNativeRows(page, 'after the run')
      await expectNativeNoMatch(page, 'after the run')
      await openConsole(page)
      await expectNativeEntries(page, 'live console')
    })

    await test.step('After a reload: rows and the no match line', async () => {
      await page.reload()
      await waitForCanvasLoad(page)
      await expandVariableManager(page)
      await expectNativeRows(page, 'after reload')
      await expectNativeNoMatch(page, 'after reload')
    })

    await test.step('Read-only history page: rows, no match line, console entries', async () => {
      // A Workbench run creates no Execution, so it has no history page; a
      // tracked run of the same saved Test through POST /executions does.
      await clearSettledWorkbenchSession(page.request)
      const run = await runTrackedTest(page.request, testId)
      expect(run.verdict, 'the tracked run outcome').toBe('passed')
      await openRunHistory(page, run.executionId)
      await waitForCanvasLoad(page)
      await expandVariableManager(page)
      await expectNativeRows(page, 'history view')
      await expectNativeNoMatch(page, 'history view')
      await openConsole(page)
      await expectNativeEntries(page, 'history console')
    })
  })
})
