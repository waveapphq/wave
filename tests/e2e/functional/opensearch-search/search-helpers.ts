/** Helpers for V-PLUGIN-OPENSEARCH-SEARCH-FUNCTIONAL: live documents, the run watch and the INFO summary lines. */

import { expect, type Page } from '../../helpers/playwright-fixtures'
import { escapeRegExp, getLogTexts, type LogEntry } from '../../helpers/log-reader'
import type { OpenSearchDoc } from '../../helpers/opensearch-stack'
import { blockSource } from '../shell-blocks/shell-helpers'

/** One L-LIVE document before seeding: its level and message. */
export type LiveLine = readonly [level: string, message: string]

/** L-LIVE `-live-a`: the ERROR sits between two INFO lines. */
export const LIVE_A: readonly LiveLine[] = [
  ['INFO', 'Batch started'],
  ['ERROR', 'Payment failed'],
  ['INFO', 'Batch complete'],
]

/** L-LIVE `-live-b`: no ERROR at all. */
export const LIVE_B: readonly LiveLine[] = [
  ['INFO', 'Batch started'],
  ['INFO', 'Cart updated'],
  ['INFO', 'Stock synced'],
  ['INFO', 'Batch complete'],
]

/** L-LIVE documents stamped at the seed time plus i x 10 ms. */
export function liveDocs(lines: readonly LiveLine[], seedMs: number): OpenSearchDoc[] {
  return lines.map(([level, message], i) => ({
    '@timestamp': new Date(seedMs + i * 10).toISOString(),
    log: { level },
    message,
  }))
}

/** Poll the console while the run goes on until a line matches. */
export async function waitForConsoleMessage(
  page: Page,
  pattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  await expect
    .poll(async () => (await getLogTexts(page)).some((text) => pattern.test(text)), {
      timeout: timeoutMs,
      intervals: [250, 500],
      message: `the run log must show a line matching ${pattern}`,
    })
    .toBe(true)
}

/** One parsed INFO summary line of a Search: `Search <index> from <from> to <to>: <n> results, <k> kept, <s> s`. */
export interface SearchSummary {
  from: string
  to: string
  total: number
  kept: number
}

/** The console entries the OpenSearch block of that Name wrote. */
export function blockEntries(entries: readonly LogEntry[], name: string): LogEntry[] {
  const source = blockSource('OpenSearch', name)
  return entries.filter((entry) => entry.source === source)
}

/** The INFO summary lines of one Search block on one index, oldest To first (a round's To is its own now). */
export function searchSummaries(
  entries: readonly LogEntry[],
  name: string,
  index: string,
): SearchSummary[] {
  const line = new RegExp(
    `^Search ${escapeRegExp(index)} from (\\S+) to (\\S+): (\\d+) results?, (\\d+) kept, \\d+\\.\\d{2} s$`,
  )
  return blockEntries(entries, name)
    .filter((entry) => entry.level === 'INFO')
    .map((entry) => line.exec(entry.message))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ from: match[1], to: match[2], total: Number(match[3]), kept: Number(match[4]) }))
    .sort((a, b) => Date.parse(a.to) - Date.parse(b.to))
}

/** The request bodies of a block's `POST /<index>/_search` DEBUG lines, first page first. */
export function searchBodies(
  entries: readonly LogEntry[],
  name: string,
  index: string,
): Array<Record<string, unknown>> {
  const head = `POST /${index}/_search `
  return blockEntries(entries, name)
    .filter((entry) => entry.level === 'DEBUG' && entry.message.startsWith(head))
    .map((entry) => JSON.parse(entry.message.slice(head.length)) as Record<string, unknown>)
    .sort((a, b) => Number('search_after' in a) - Number('search_after' in b))
}

/** Console text with each paging cursor (`"search_after":[...]`) of a request line cut out. */
export function withoutCursors(text: string): string {
  return text.replace(/"search_after":\[[^\]]*\]/g, '"search_after":[]')
}

/** A block's INFO and WARN lines as "LEVEL message", the elapsed seconds blanked, sorted: the harvest does not keep their order. */
export function summaryLines(entries: readonly LogEntry[], name: string): string[] {
  return blockEntries(entries, name)
    .filter((entry) => entry.level !== 'DEBUG')
    .map((entry) => `${entry.level} ${entry.message.replace(/, \d+\.\d{2} s$/, ', # s')}`)
    .sort()
}
