/**
 * OpenSearch details page tests (REQ-3.4.1.15, REQ-3.3.2.2, REQ-3.3.2.3, REQ-3.3.2.5, REQ-3.3.2.6, REQ-3.3.3.1,
 * REQ-3.3.3.2, REQ-3.3.3.6); OS-1, OS-2, OS-7, OS-8, OS-9, OS-11, OS-16.
 */

import { describe, it, expect } from 'vitest'
import {
  getControlMetadata,
  getControlChangelog,
  getControlDetails,
  getControlLatestVersion,
  getControlVersionEntry,
} from '@/features/workbench/docs/_loader'
import { getInputParams, getOutputParams } from '@/features/workbench/lib/node-parameters'
import { type InputParam } from '@/features/workbench/lib/node-parameters/types'

const ID = 'opensearch'

const DESCRIPTION =
  'Read what the application under test sent to OpenSearch, the matching documents in Search mode or numbers worked out from them in Aggregate mode, and hand them back as a table'

const CHANGELOG = [
  'Search: the matching documents with the fields you pick, sorted, up to Max results, paging past 10,000 in sort order',
  'Aggregate: a count, sum, average, min, max, percentile, unique count or increase per time slot and / or field value, set in a plain form',
  'From and To as in the OpenSearch Dashboards date picker: Absolute, Relative or Now, all in UTC',
  'Query in DQL or Query DSL, with WAVE variables escaped for where they land, or as an expression',
  'Every run checks the index pattern and the field names against the cluster, so a typo cannot pass as zero results',
  'Sign in with a username and password, an API key, a bearer token or a client certificate; TLS with Verify Server Certificate, CA Certificate, Client Certificate and Client Key',
  'Query editor: DQL and JSON coloring, checks while typing, field suggestions and Get fields',
  'Remotable: inside a Remote Execution body the block runs on the remote host, which needs nothing installed; SSH tunnels work too',
  'On error: Fail the block, or Record and continue with Success, Error and Reason',
]

/** Sheet order with the two Query twins counted once. */
const INPUT_LABELS = [
  'Cluster URL',
  'Index pattern',
  'From',
  'To',
  'Query language',
  'Query',
  'Mode',
  'Fields',
  'Max results',
  'Group by time',
  'Group by field',
  'Top values',
  'Stats',
  'Timeout',
  'Sort by',
  'Order',
  'Username',
  'Password',
  'API Key',
  'Bearer Token',
  'Verify Server Certificate',
  'CA Certificate',
  'Client Certificate',
  'Client Key',
  'Time field',
  'Connect timeout',
  'On error',
]

const OUTPUT_LABELS = ['Success', 'Results', 'Total results', 'Error', 'Reason']

const HEADINGS = [
  'Which mode',
  'Use Cases',
  'Search',
  'Search example: wait for the final line or an error, then collect the logs',
  'Aggregate',
  'Stats',
  'Results in Aggregate',
  'Aggregate example: errors per minute over the test window, then check the busiest minute',
  'Behavior',
  'From and To',
  'Query languages',
  'Variables in a query',
  'Query as an expression',
  'Max results and paging (Search)',
  'Checks on every run',
  'Failure reasons',
  'Connection and authentication',
  'Where the block runs',
  'Parameters',
  'Outputs',
]

const PARAMETER_LINES = [
  "- **Cluster URL**: The cluster's REST address with scheme and port: `https://opensearch.internal:9200` (required)",
  "- **Index pattern**: Where to look: one index, a wildcard such as `logs-*`, a comma list, exclusions with a leading minus, an alias, a data stream, or a date-math name such as `<logs-{now/d}>` for today's daily index. Sent as written; OpenSearch resolves it (required)",
  '- **From**: Start of the window: Absolute, Relative or Now, or a variable or expression with {} (default: 15 minutes ago, `now-15m`)',
  '- **To**: End of the window: Absolute, Relative or Now, or a variable or expression with {} (default: now)',
  '- **Query language**: DQL or Query DSL (default: DQL)',
  '- **Query**: A DQL line or the query part of a Query DSL request; with {}, an expression that gives the query; empty means no filter',
  '- **Mode**: Search returns the matching documents; Aggregate returns numbers worked out from them (default: Search)',
  '- **Fields**: The fields that come back, one column each, in this order; nested fields with dots, such as `user.name`. Empty returns the whole document as one column (default: `@timestamp`) (Search)',
  '- **Max results**: Lines Results keeps; 0 keeps every line (default: 10000) (Search)',
  '- **Group by time**: No, or Every 10 seconds, 30 seconds, 1 minute, 5 minutes, 15 minutes or 1 hour (default: Every 1 minute) (Aggregate)',
  '- **Group by field**: A field whose values each get their own rows (default: No field) (Aggregate)',
  "- **Top values**: How many of the grouped field's most common values get rows (default: 10) (Aggregate)",
  '- **Stats**: The numbers to work out, one column each: Count, Sum, Average, Min, Max, Percentile, Unique count, Increase or Custom (JSON) (default: Count) (Aggregate)',
  '- **Timeout**: Seconds for the whole block, paging included; when it runs out the search is ended on the cluster (default: 300)',
  '- **Sort by**: The field to sort on; any sortable field (default: the Time field) (Sort, Search)',
  '- **Order**: Newest first or Oldest first (default: Newest first) (Sort, Search)',
  '- **Username**: Login name (Authentication)',
  '- **Password**: A secret, masked everywhere (Authentication)',
  '- **API Key**: An API key the cluster issued; a secret (Authentication)',
  '- **Bearer Token**: A token such as a JSON Web Token; a secret (Authentication)',
  "- **Verify Server Certificate**: Check the cluster's certificate against CA Certificate when one is given, otherwise against the certificates WAVE trusts (Settings > Network > Certificates) (default: on) (TLS / Certificates, https only)",
  '- **CA Certificate**: The CA certificate: a file path, a variable reference or a PEM string; when set, it is the only certificate this block trusts (TLS / Certificates, https only)',
  '- **Client Certificate**: A client certificate for mutual TLS: a file path, a variable reference or a PEM string (TLS / Certificates, https only)',
  '- **Client Key**: The private key of the client certificate: a file path or a PEM string; a secret (TLS / Certificates, https only)',
  '- **Time field**: The date field the window reads (default: `@timestamp`) (Advanced)',
  '- **Connect timeout**: Seconds to wait for the cluster to accept the connection and finish the TLS handshake (default: 30) (Advanced)',
  '- **On error**: Fail the block, or Record and continue (default: Fail the block) (Failure Handling)',
]

const OUTPUT_LINES = [
  '- **Success**: True when the block finished; false when the block failed and On error is Record and continue',
  '- **Results**: A table. Search: one row per matching document and one column per entry in Fields. Aggregate: one row per time slot and / or field value, or one row for the whole window, with one column per stat. In Search, empty when nothing matched, with its columns kept',
  '- **Total results**: The exact number of matching documents, whatever Max results says',
  '- **Error**: The failure message (Record and continue only)',
  '- **Reason**: Unreachable, AuthFailed, RequestFailed, Timeout or Validation; empty when the block passed (Record and continue only)',
]

// The shared TLS rows and On error keep their shared descriptor wording; the page words them for this block.
const SHARED_WORDING = new Set(['verify_ssl', 'ca_cert', 'client_cert', 'client_key', 'on_error'])

const HEADING_LINE = /^\*\*[^*]+:\*\*$/
const BOLD_BULLET = /^- \*\*(.+?)\*\*/
const TABLE_SEPARATOR = /^\|[-| ]+\|$/

interface MarkdownTable {
  header: string[]
  rows: string[][]
}

function details(): string {
  return getControlDetails(ID, getControlLatestVersion(ID)) ?? ''
}

function lines(): string[] {
  return details().split('\n')
}

/** The lines under a `**Heading:**` line, up to the next heading line. */
function sectionLines(heading: string): string[] {
  const all = lines()
  const start = all.indexOf(`**${heading}:**`)
  if (start < 0) return []
  const rest = all.slice(start + 1)
  const end = rest.findIndex((line) => HEADING_LINE.test(line))
  return end < 0 ? rest : rest.slice(0, end)
}

/** Top-level `- **Label**` bullets under a `**Heading:**` line. */
function sectionBullets(heading: string): string[] {
  return sectionLines(heading)
    .map((line) => BOLD_BULLET.exec(line)?.[1])
    .filter((l): l is string => l !== undefined)
}

/** Full `- **Label**...` lines under a `**Heading:**` line. */
function sectionBulletLines(heading: string): string[] {
  return sectionLines(heading).filter((line) => BOLD_BULLET.test(line))
}

function cells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

/** The first table under a `**Heading:**` line. */
function tableUnder(heading: string): MarkdownTable {
  const section = sectionLines(heading)
  const start = section.findIndex((line) => line.startsWith('|'))
  expect(start, `a table under ${heading}`).toBeGreaterThanOrEqual(0)
  const rest = section.slice(start)
  const end = rest.findIndex((line) => !line.startsWith('|'))
  const tableLines = end < 0 ? rest : rest.slice(0, end)
  expect(TABLE_SEPARATOR.test(tableLines[1] ?? ''), `the separator row under ${heading}`).toBe(true)
  return { header: cells(tableLines[0]), rows: tableLines.slice(2).map(cells) }
}

/** The descriptors with twins counted once, at the first twin's place. */
function dedupedByWireName(rows: readonly InputParam[]): InputParam[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.name)) return false
    seen.add(row.name)
    return true
  })
}

describe('OpenSearch documentation', () => {
  describe('front matter (OS-16)', () => {
    it('parses metadata with the pinned description', () => {
      const meta = getControlMetadata(ID)

      expect(meta).toBeDefined()
      expect(meta!.id).toBe(ID)
      expect(meta!.description).toBe(DESCRIPTION)
    })

    it('ships 1.0.0 as the only version, dated in 2026', () => {
      expect(getControlLatestVersion(ID)).toBe('1.0.0')

      const entryOfVersion = getControlVersionEntry(ID, '1.0.0')
      expect(entryOfVersion).toBeDefined()
      expect(entryOfVersion!.releaseDate).toMatch(/^2026-\d{2}-\d{2}$/)
      expect(entryOfVersion!.deprecated).toBeUndefined()
      expect(getControlMetadata(ID)!.versions.map((v) => v.version)).toEqual(['1.0.0'])
    })

    it('logs the nine feature lines under 1.0.0, not the placeholder line', () => {
      const changelog = getControlChangelog(ID, '1.0.0')

      expect(changelog).toEqual(CHANGELOG)
      expect(changelog).not.toContain('Placeholder version')
    })
  })

  describe('body (OS-16)', () => {
    it('replaces the placeholder body', () => {
      expect(details()).not.toBe('')
      expect(details()).not.toContain('**Status:**')
      expect(details()).not.toContain('Not implemented')
    })

    it('carries every heading on its own line, in order', () => {
      expect(lines().filter((line) => HEADING_LINE.test(line))).toEqual(HEADINGS.map((h) => `**${h}:**`))
    })

    it('uses hyphens only, never an em-dash or an en-dash', () => {
      expect(details()).not.toMatch(/[\u2013\u2014]/)
      expect(getControlMetadata(ID)!.description).not.toMatch(/[\u2013\u2014]/)
      for (const line of getControlChangelog(ID, '1.0.0')) {
        expect(line).not.toMatch(/[\u2013\u2014]/)
      }
    })
  })

  describe('Parameters and Outputs parity (REQ-3.4.1.15)', () => {
    it('counts the two Query twins once, at the first twin\'s place', () => {
      const labels = dedupedByWireName(getInputParams(ID) ?? []).map((row) => row.label ?? row.name)

      expect(labels).toEqual(INPUT_LABELS)
    })

    it('lists each row once under Parameters in sheet order, and nothing else', () => {
      expect(sectionBullets('Parameters')).toEqual(INPUT_LABELS)
    })

    it('lists every descriptor label once under Parameters, deduplicated by wire name', () => {
      const labels = dedupedByWireName(getInputParams(ID) ?? []).map((row) => row.label ?? row.name)

      expect(labels.length).toBeGreaterThan(0)
      expect(sectionBullets('Parameters')).toEqual(labels)
    })

    it('words every Parameters line as pinned', () => {
      expect(sectionBulletLines('Parameters')).toEqual(PARAMETER_LINES)
    })

    it('opens each Parameters line with its row\'s description, apart from the shared TLS rows and On error', () => {
      const rows = dedupedByWireName(getInputParams(ID) ?? []).filter((row) => !SHARED_WORDING.has(row.name))
      const bullets = sectionBulletLines('Parameters')

      expect(rows).toHaveLength(22)
      for (const row of rows) {
        const prefix = `- **${row.label ?? row.name}**: `
        const bullet = bullets.find((line) => line.startsWith(prefix))
        expect(bullet, `the ${row.name} bullet`).toBeDefined()
        const description = row.description ?? ''
        const text = bullet!.slice(prefix.length).replaceAll('`', '')
        expect(description, row.name).not.toBe('')
        expect(text.slice(0, description.length), row.name).toBe(description)
      }
    })

    it('lists the outputs under Outputs in order, and nothing else (OS-8)', () => {
      expect(sectionBullets('Outputs')).toEqual(OUTPUT_LABELS)
    })

    it('lists the outputs in descriptor order', () => {
      const labels = (getOutputParams(ID) ?? []).map((out) => out.label ?? out.name)

      expect(labels).toEqual(OUTPUT_LABELS)
      expect(sectionBullets('Outputs')).toEqual(labels)
    })

    it('words every Outputs line as pinned', () => {
      expect(sectionBulletLines('Outputs')).toEqual(OUTPUT_LINES)
    })
  })

  describe('Which mode (OS-1, OS-16, REQ-3.3.3.1, REQ-3.3.3.2)', () => {
    it('shows the Which mode table', () => {
      expect(tableUnder('Which mode')).toEqual({
        header: ['You want', 'Mode', 'You check'],
        rows: [
          ["The lines themselves: an error, the final line, a test's whole log", 'Search', 'Results'],
          ['One count of matching lines, such as the errors in the window', 'Search or Aggregate', 'Total results'],
          [
            'A count per minute or per value, or a sum, average, percentile, unique count or how much a counter grew',
            'Aggregate',
            'Results',
          ],
        ],
      })
    })
  })

  describe('Stats (OS-7, OS-9, REQ-3.3.3.2)', () => {
    it('shows the Stats table, Unique count saying it is approximate', () => {
      expect(tableUnder('Stats')).toEqual({
        header: ['Stat', 'What you get', 'Column name'],
        rows: [
          ['Count', 'How many documents match. Needs no field', '`count`'],
          ['Sum', 'The sum of a field', '`sum of latency_ms`'],
          ['Average', 'The average of a field', '`average of latency_ms`'],
          ['Min', 'The lowest value of a field', '`min of latency_ms`'],
          ['Max', 'The highest value of a field', '`max of latency_ms`'],
          [
            'Percentile',
            "The value below which a given percent of the field's values fall. Set Percent, such as 95",
            '`percentile 95 of latency_ms`',
          ],
          [
            'Unique count',
            'How many different values a field has, such as distinct users. Approximate when a field has very many different values, as OpenSearch computes it',
            '`unique count of user.id`',
          ],
          [
            'Increase',
            'How much a running total, such as a request counter, grew. When the counter drops because the application restarted, that drop is skipped, not counted',
            '`increase of requests_total`',
          ],
          [
            'Custom (JSON)',
            'Anything the list does not offer: one OpenSearch aggregation written as JSON in the editor',
            "Shown in the stat's popover",
          ],
        ],
      })
    })
  })

  describe('corrected sentences (OS-2, OS-8, OS-9)', () => {
    it('says Authentication is collapsed, with no profile summary sentence', () => {
      const section = sectionLines('Connection and authentication')

      expect(section).toContain('- Authentication is collapsed. Fill at most one of these:')
      expect(details()).not.toContain('shows a summary when a profile is bound')
    })

    it('says a time slot with no documents shows 0 (OS-8)', () => {
      expect(sectionLines('Results in Aggregate')).toContain(
        '- A time slot with no documents shows 0, so a quiet minute is still a row',
      )
    })

    it('shows ISO bucket keys in the Aggregate example table (REQ-3.3.2.3)', () => {
      expect(
        tableUnder('Aggregate example: errors per minute over the test window, then check the busiest minute'),
      ).toEqual({
        header: ['@timestamp', 'count'],
        rows: [
          ['2026-09-25T10:00:00.000Z', '2'],
          ['2026-09-25T10:01:00.000Z', '0'],
          ['2026-09-25T10:02:00.000Z', '4'],
        ],
      })
      expect(details()).not.toContain('2026-09-25 10:00:00')
    })

    it('names reason Validation on the Time field check', () => {
      expect(tableUnder('Checks on every run')).toEqual({
        header: ['Check', 'When it fails', 'Result'],
        rows: [
          ['Index pattern matches an index', 'No index matches', 'The block ends amber, with a WARN naming the pattern'],
          [
            'Every field named in Query, Fields, Sort by, Time field, Group by field and Stats is known to the cluster',
            'A field is unknown, often a typo',
            'The block ends amber, with a WARN naming the field',
          ],
          ['Time field is a date field', 'It is not', 'The block fails with reason Validation, naming the field'],
          [
            'Every shard answered',
            'Some shards failed, or the search timed out on the cluster',
            'Partial results: the block ends amber, with a WARN naming the failed shards or the timeout',
          ],
          [
            'Top values covers every document (Aggregate)',
            'Some documents fall outside the kept values',
            'The block runs and logs a WARN with how many were left out',
          ],
          [
            'From and To make sense',
            'From is later than To, or later than now',
            'The block runs and logs a WARN naming both ends in UTC',
          ],
        ],
      })
    })
  })

  describe('failure reasons (OS-11)', () => {
    it('lists the five reasons the Reason output names, in order', () => {
      expect(tableUnder('Failure reasons').rows.map((row) => row[0])).toEqual([
        'Unreachable',
        'AuthFailed',
        'RequestFailed',
        'Timeout',
        'Validation',
      ])
    })
  })
})
