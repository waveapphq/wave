/**
 * V-RUNADHOC-STOP: Stopping an ad-hoc Run Current writes one WARN line per Block
 *
 * Canceling a run settles every Block it was standing on, and each settled
 * Block gets its own console line attributed to itself, ad-hoc pokes too. The
 * test-level framing lines ("execution started", "completed successfully",
 * "execution stopped by user") stay suppressed for an ad-hoc run, because they
 * would mislabel a single-Block poke as a fresh full-test run.
 *
 * Each phase runs in its own test against its own fixture import: a Stop leaves
 * the session terminal, and a second run in the same session inherits the prior
 * Block states.
 *
 * Pass Criteria:
 *  1. Run Current on a single Delay, stopped in flight: exactly ONE WARN
 *     "Stopped by user" line, whose Source is that Delay's own (EXEC-25)
 *  2. Run Current on a loop whose body Delay is in flight, stopped: exactly TWO
 *     such lines, one with the loop's Source and one with the body Delay's, and
 *     none with the Source of the body Log that already finished
 *  3. Neither console carries a test-level start or end framing line
 *
 * REQ: REQ-3.2.1.5 (Ad-hoc block execution), REQ-3.2.2.4 (execution control - stop)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogCopyTexts, waitForLogText, type LogEntry } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { clickNodeContextMenuItem, selectEnvironment } from '../../helpers/workbench'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'
import fs from 'fs'
import path from 'path'

const STOP_LINE = 'Stopped by user'

// The test-level framing an ad-hoc run must never write.
const TEST_LEVEL_FRAMING =
  /execution started|completed successfully|execution stopped by user|halted with status|canceled by backend shutdown/i

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture-stop.json'), 'utf-8')
  return JSON.parse(raw)
}

async function openFixture(page: Page): Promise<void> {
  await importValidateAndNavigate(page, loadFixture())
  await selectEnvironment(page)
}

async function expectNodeRunning(page: Page, nodeId: string): Promise<void> {
  await expect(page.locator(`[data-testid="workflow-node-${nodeId}"]`)).toHaveAttribute(
    'data-execution-status',
    'running',
    { timeout: 20_000 },
  )
}

async function stopAndSettle(page: Page): Promise<void> {
  await page.locator('[data-testid="action-stop-button"]').click()
  await expect(page.locator('[data-testid="stop-confirmation-dialog"]')).toBeVisible()
  await page.locator('[data-testid="stop-confirm-immediate"]').click()
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
    'data-status',
    'stopped',
    { timeout: 15_000 },
  )
}

/** The console rows with their full Source, which the source column cuts to its width. */
async function consoleRows(page: Page): Promise<LogEntry[]> {
  return consoleEntriesFromCopy(await getLogCopyTexts(page))
}

/** The per-Block cancellation lines, in console order. */
function stopLines(rows: LogEntry[]): LogEntry[] {
  return rows.filter((row) => row.message === STOP_LINE)
}

function describeRows(rows: LogEntry[]): string {
  return rows.map((row) => `[${row.level}] ${row.source}: ${row.message}`).join('\n')
}

test.describe('V-RUNADHOC-STOP: ad-hoc cancellation lines', () => {
  test('Run Current on one Block: one WARN line naming that Block, no test framing', async ({
    page,
  }) => {
    await openFixture(page)

    await clickNodeContextMenuItem(page, 'delay-solo', 'Run Current')
    await expectNodeRunning(page, 'delay-solo')
    await stopAndSettle(page)

    const rows = await consoleRows(page)
    const settled = stopLines(rows)

    expect(
      settled,
      `expected one cancellation line. Console:\n${describeRows(rows)}`,
    ).toHaveLength(1)
    expect(settled[0].level).toBe('WARN')
    expect(settled[0].source, 'the line is attributed to the Block it settled').toBe(
      blockSource('Delay', 'Solo Delay'),
    )

    const framing = rows.filter((row) => TEST_LEVEL_FRAMING.test(row.message))
    expect(
      framing.map((row) => row.message),
      'an ad-hoc run writes no test-level framing lines',
    ).toEqual([])
  })

  test('Run Current on a loop: one WARN line per settled Block, each naming its own', async ({
    page,
  }) => {
    await openFixture(page)

    await clickNodeContextMenuItem(page, 'for-adhoc', 'Run Current')
    // The body Log's marker proves the walk is inside the body, so the body
    // Delay after it is genuinely in flight when the Stop lands.
    await waitForLogText(page, 'adhoc-stop-body')
    await expectNodeRunning(page, 'delay-body')
    await stopAndSettle(page)

    const rows = await consoleRows(page)
    const settled = stopLines(rows)

    expect(
      settled,
      `expected two cancellation lines. Console:\n${describeRows(rows)}`,
    ).toHaveLength(2)
    for (const row of settled) {
      expect(row.level).toBe('WARN')
    }
    expect(
      settled.map((row) => row.source).sort((a, b) => a.localeCompare(b)),
      'each line names its own Block',
    ).toEqual([blockSource('Delay', 'Body Delay'), blockSource('For Loop', 'Adhoc Loop')])
    expect(
      settled.map((row) => row.source),
      'a Block that already finished is not settled',
    ).not.toContain(blockSource('Log', 'Body Log'))

    const framing = rows.filter((row) => TEST_LEVEL_FRAMING.test(row.message))
    expect(
      framing.map((row) => row.message),
      'an ad-hoc run writes no test-level framing lines',
    ).toEqual([])
  })
})
