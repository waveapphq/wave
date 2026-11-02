/**
 * V-CONSOLE-RUN-ORDER: consecutive runs stay in time order
 *
 * Ordering leads on the entry timestamp, so three runs of the same test render
 * run by run, never interleaved.
 *
 * The unit guard lives in frontend/tests/features/workbench/stores/log-store.test.ts;
 * this is the end-to-end proof, read off the rendered console rows.
 *
 * REQ: REQ-3.2.2 (console)
 *
 * Pass Criteria:
 * 1. Two runs of one test, with no Clear between them, leave both runs' lines in
 *    the console (each marker rendered exactly twice)
 * 2. The second run's FIRST line renders after the first run's LAST line
 * 3. Every rendered row's timestamp is greater than or equal to the row above it
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogRows, getLogTexts, type LogRow } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const FIRST_LINE = 'console-resize-line-a'
const LAST_LINE = 'console-resize-line-c'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'),
  ) as Record<string, unknown>
}

/** Milliseconds since midnight for a rendered "HH:MM:SS.mmm <zone>" cell. */
function msOfDay(timestamp: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(timestamp)
  expect(match, `console row timestamp is not readable: "${timestamp}"`).not.toBeNull()
  const [, h, m, s, ms] = match!
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms)
}

/** Unwrap a midnight rollover so a run spanning 23:59:59 -> 00:00:00 still reads
 *  as increasing time. Only a drop bigger than half a day counts as a new day. */
function timeline(rows: LogRow[]): number[] {
  let dayOffset = 0
  let previous = -1
  return rows.map((row) => {
    const raw = msOfDay(row.timestamp)
    if (previous >= 0 && raw < previous - 12 * 3600_000) dayOffset += 24 * 3600_000
    previous = raw
    return raw + dayOffset
  })
}

async function runAndWait(page: Page, expectedOccurrences: number): Promise<void> {
  await page.locator('[data-testid="run-button"]').click()
  await expect
    .poll(
      async () => (await getLogTexts(page)).filter((t) => t.includes(LAST_LINE)).length,
      {
        timeout: 60_000,
        message: `expected ${expectedOccurrences} rendered "${LAST_LINE}" line(s)`,
      },
    )
    .toBe(expectedOccurrences)
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 30_000 })
}

test.describe('V-CONSOLE-RUN-ORDER: two runs, one console', () => {
  test('the second run lands below the first, in timestamp order', async ({ page }) => {
    await importValidateAndNavigate(page, loadFixture())
    await selectEnvironment(page)

    await runAndWait(page, 1)
    // Deliberately NO Clear between the runs - accumulating across runs is the
    // behavior under test.
    await runAndWait(page, 2)

    const rows = await getLogRows(page)
    const rendered = rows.map((r) => `${r.timestamp} [${r.level}] ${r.message}`).join('\n')

    await test.step('Both runs are still on screen', () => {
      for (const marker of [FIRST_LINE, 'console-resize-line-b', LAST_LINE]) {
        expect(
          rows.filter((r) => r.message.includes(marker)).length,
          `"${marker}" must render once per run.\n${rendered}`,
        ).toBe(2)
      }
    })

    await test.step("The second run's first line sits below the first run's last line", () => {
      const firstRunLast = rows.findIndex((r) => r.message.includes(LAST_LINE))
      const secondRunFirst = rows.findIndex(
        (r, i) => i > firstRunLast && r.message.includes(FIRST_LINE),
      )
      const firstRunFirst = rows.findIndex((r) => r.message.includes(FIRST_LINE))
      expect(
        firstRunFirst < firstRunLast,
        `The first run's own lines must stay in order.\n${rendered}`,
      ).toBeTruthy()
      expect(
        secondRunFirst > firstRunLast,
        `The second run's first line must follow the first run's last line, not interleave with it.\n${rendered}`,
      ).toBeTruthy()
    })

    await test.step('Every row is at or after the row above it', () => {
      const stamps = timeline(rows)
      for (let i = 1; i < stamps.length; i++) {
        expect(
          stamps[i] >= stamps[i - 1],
          `Row ${i} goes back in time.\n${rendered}`,
        ).toBeTruthy()
      }
    })
  })
})
