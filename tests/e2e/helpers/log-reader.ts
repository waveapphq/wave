/**
 * DOM-based helpers for reading console log entries during E2E tests.
 *
 * The console panel uses TanStack Virtual to render only the entries visible
 * in the scroll viewport - fine for users, a problem for tests that expect to
 * see every emitted message regardless of scroll position. These helpers
 * scroll the log container top-to-bottom and collect every unique entry that
 * passes through the visible window, keyed by the `log-entry-<id>` testid so
 * re-reads during overlapping scroll steps don't double-count.
 *
 * Assumes the console panel is open (tests open it before asserting on logs).
 */

import { expect, type Page } from '@playwright/test'

export interface LogEntry {
  level: string
  source: string
  message: string
}

/** A rendered console row, including the timestamp column the user reads. */
export interface LogRow extends LogEntry {
  /** The timestamp cell as rendered, e.g. "19:05:03.382 UTC". */
  timestamp: string
}

/**
 * Scroll the console log container from top to bottom, collecting every
 * rendered entry. Overlapping scroll steps ensure the virtualizer re-renders
 * with enough cushion that entries near step boundaries aren't skipped.
 *
 * Returns entries in the order the user would see them, deduplicated by the
 * stable log-entry-<id> data-testid the component renders on each row.
 */
async function ensureConsoleOpen(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="console-panel"]').first()
  if ((await panel.count()) === 0) {
    return
  }
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    // Toggle via the console header's aria-label button (no dedicated testid).
    await page
      .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
      .first()
      .click()
    // Wait for the expanded state to take effect so the scroll container exists.
    await page
      .locator('[data-testid="console-panel"][data-state="expanded"]')
      .first()
      .waitFor({ state: 'attached', timeout: 5000 })
  }
}

export async function getLogEntries(page: Page): Promise<LogEntry[]> {
  const rows = await getLogRows(page)
  return rows.map(({ level, source, message }) => ({ level, source, message }))
}

/**
 * Same traversal as getLogEntries, keeping each row's rendered timestamp.
 * Specs asserting on console ORDER read this: the timestamp is what the user
 * sees, so an ordering regression has to show up here.
 */
export async function getLogRows(page: Page): Promise<LogRow[]> {
  await ensureConsoleOpen(page)
  const container = page.locator('[role="log"]').first()
  if ((await container.count()) === 0) {
    return []
  }

  // Start at the top.
  await container.evaluate((el) => {
    ;(el as HTMLElement).scrollTop = 0
  })
  // Give the virtualizer one tick to render.
  await page.waitForTimeout(30)

  interface IndexedEntry extends LogRow {
    _id: string
    _order: number
  }
  // The console virtualizes: rows live inside one translated container, so a
  // row's offsetTop restarts per scroll window. `data-index` on the row
  // wrapper is the authoritative position in the full list.
  const collected = new Map<string, IndexedEntry>()

  // Read currently-visible rows. Filtering by the nested message testid
  // excludes the `log-entry-message` / `log-entry-source` spans that share
  // the log-entry- prefix.
  const rows = page.locator('[data-testid^="log-entry-"]').filter({
    has: page.locator('[data-testid="log-entry-message"]'),
  })
  const readVisible = async () => {
    const visible = await rows.evaluateAll((els) =>
      els.map((el) => {
        const indexAttr = el.closest('[data-index]')?.getAttribute('data-index')
        return {
          _id: el.getAttribute('data-testid') ?? '',
          timestamp: (el.querySelector('.log-timestamp')?.textContent ?? '').trim(),
          level: (el.querySelector('.level-badge')?.textContent ?? '').trim(),
          source: (el.querySelector('[data-testid="log-entry-source"]')?.textContent ?? '').trim(),
          message: (el.querySelector('[data-testid="log-entry-message"]')?.textContent ?? '').trim(),
          // Virtualizer index when present, else the DOM offset.
          _top: indexAttr !== null && indexAttr !== undefined
            ? Number(indexAttr)
            : (el as HTMLElement).offsetTop,
        }
      }),
    )
    for (const v of visible) {
      if (!collected.has(v._id)) {
        collected.set(v._id, {
          _id: v._id,
          _order: v._top,
          timestamp: v.timestamp,
          level: v.level,
          source: v.source,
          message: v.message,
        })
      }
    }
  }

  for (let i = 0; i < 400; i++) {
    await readVisible()

    // NOTE: no "stable size" early break - a single tall multiline entry
    // (e.g. a DEBUG trace or a logged error map with a stack trace) can span
    // several scroll steps without surfacing new rows, and breaking there
    // silently drops everything below it. Only terminal: cannot scroll further.

    // Scroll down by ~80% of the viewport for overlap, stop if we cannot.
    const progressed = await container.evaluate((el) => {
      const ht = el as HTMLElement
      const before = ht.scrollTop
      const next = before + Math.max(1, Math.floor(ht.clientHeight * 0.8))
      ht.scrollTop = next
      return ht.scrollTop > before
    })
    if (!progressed) {
      // One more read to capture the last frame, then stop.
      await page.waitForTimeout(30)
      await readVisible()
      break
    }

    await page.waitForTimeout(30)
  }

  return Array.from(collected.values())
    .sort((a, b) => a._order - b._order)
    .map(({ timestamp, level, source, message }) => ({ timestamp, level, source, message }))
}

/**
 * Return all visible log messages, in order.
 */
export async function getLogTexts(page: Page): Promise<string[]> {
  const entries = await getLogEntries(page)
  return entries.map((e) => e.message)
}

/**
 * Collect every entry's data-copy-text (the full copyable message, newlines
 * preserved) by scrolling the virtualized console top-to-bottom. Multiline
 * combined entries (e.g. the HTTP DEBUG trace) keep their line breaks here,
 * while textContent flattens them.
 */
export async function getLogCopyTexts(page: Page): Promise<string[]> {
  await ensureConsoleOpen(page)
  const container = page.locator('[role="log"]').first()
  if ((await container.count()) === 0) {
    return []
  }
  await container.evaluate((el) => {
    ;(el as HTMLElement).scrollTop = 0
  })
  await page.waitForTimeout(30)

  const collected = new Map<string, { text: string; top: number }>()
  for (let i = 0; i < 400; i++) {
    const rows = page.locator('[data-testid^="log-entry-"]').filter({
      has: page.locator('[data-testid="log-entry-message"]'),
    })
    const visible = await rows.evaluateAll((els) =>
      els.map((el) => {
        const indexAttr = el.closest('[data-index]')?.getAttribute('data-index')
        return {
          id: el.getAttribute('data-testid') ?? '',
          text: el.getAttribute('data-copy-text') ?? '',
          // Virtualizer index when present: offsetTop restarts per scroll window.
          top: indexAttr !== null && indexAttr !== undefined
            ? Number(indexAttr)
            : (el as HTMLElement).offsetTop,
        }
      }),
    )
    for (const v of visible) {
      if (!collected.has(v.id)) collected.set(v.id, { text: v.text, top: v.top })
    }
    const progressed = await container.evaluate((el) => {
      const ht = el as HTMLElement
      const before = ht.scrollTop
      ht.scrollTop = before + Math.max(1, Math.floor(ht.clientHeight * 0.8))
      return ht.scrollTop > before
    })
    if (!progressed) break
    await page.waitForTimeout(30)
  }
  return Array.from(collected.values())
    .sort((a, b) => a.top - b.top)
    .map((e) => e.text)
}

/**
 * Poll until a log message containing `marker` renders, then return the full
 * ordered text list. The workflow status flips terminal a beat before the
 * console finishes rendering the tail of the log stream (WS delivery +
 * virtualizer), so specs asserting on late lines must harvest via their run's
 * bookend marker instead of a bare getLogTexts.
 */
export async function waitForLogText(
  page: Page,
  marker: string,
  timeout = 15_000,
): Promise<string[]> {
  let texts: string[] = []
  await expect
    .poll(
      async () => {
        texts = await getLogTexts(page)
        return texts.some((t) => t.includes(marker))
      },
      { timeout, message: `expected the console to render "${marker}"` },
    )
    .toBeTruthy()
  return texts
}

/**
 * Clear the console log buffer via the header's Clear button. Console entries
 * accumulate across runs in one session; a test comparing a second run's output
 * against a first must reset between them.
 */
export async function clearConsoleLogs(page: Page): Promise<void> {
  await ensureConsoleOpen(page)
  const clearBtn = page
    .locator('[data-testid="console-panel-header"] button[aria-label="Clear console"]')
    .first()
  await clearBtn.click()
}

/** Open the console and set its minimum level, e.g. DEBUG to show the masked `Inputs:` echo. */
export async function setConsoleMinimumLevel(page: Page, level: string): Promise<void> {
  await ensureConsoleOpen(page)
  await page.locator('button[aria-label="Minimum log level"]').click()
  await page.getByRole('option', { name: level, exact: true }).click()
}

/**
 * Return log entries formatted as `[level] source: message`.
 */
export async function getLogLines(page: Page): Promise<string[]> {
  const entries = await getLogEntries(page)
  return entries.map((e) => `[${e.level}] ${e.source}: ${e.message}`)
}

/** Console entries as `[LEVEL] source: message` lines, for an assertion's failure text. */
export function formatEntries(entries: readonly LogEntry[]): string {
  return entries.map((entry) => `[${entry.level}] ${entry.source}: ${entry.message}`).join('\n')
}

/** The console carries a line of this level with exactly this message. */
export function expectConsoleLine(entries: readonly LogEntry[], level: string, message: string): void {
  expect(
    entries.some((entry) => entry.level === level && entry.message === message),
    `the console must carry [${level}] "${message}".\n${formatEntries(entries)}`,
  ).toBe(true)
}

/** Text made safe to embed in a RegExp that matches it literally. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const CLOCK = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
const DAY_MS = 24 * 60 * 60 * 1000

/** A row's rendered timestamp cell as milliseconds since midnight. */
export function clockMs(row: LogRow): number {
  const match = CLOCK.exec(row.timestamp)
  expect(match, `a console row must carry a timestamp, got "${row.timestamp}"`).not.toBeNull()
  const [, hours, minutes, seconds, millis] = match as RegExpExecArray
  return (
    ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(millis)
  )
}

/** How long after `first` the row `second` was written; midnight rollover folded back. */
export function elapsedMs(first: LogRow, second: LogRow): number {
  const delta = clockMs(second) - clockMs(first)
  return delta < 0 ? delta + DAY_MS : delta
}

/** A console message matcher: the exact message, or a pattern its message must match. */
export type LineMatcher = string | RegExp

function matchesLine(entry: LogEntry, line: LineMatcher): boolean {
  return typeof line === 'string' ? entry.message === line : line.test(entry.message)
}

/** The console carries `first` before `second`; the first line matching each one counts. */
export function expectLineBefore(entries: readonly LogEntry[], first: LineMatcher, second: LineMatcher): void {
  const firstAt = entries.findIndex((entry) => matchesLine(entry, first))
  const secondAt = entries.findIndex((entry) => matchesLine(entry, second))
  expect(firstAt, `the console must carry "${first}".\n${formatEntries(entries)}`).toBeGreaterThanOrEqual(0)
  expect(secondAt, `the console must carry "${second}".\n${formatEntries(entries)}`).toBeGreaterThanOrEqual(0)
  expect(firstAt, `"${first}" must come before "${second}".\n${formatEntries(entries)}`).toBeLessThan(secondAt)
}
