/** OpenSearch stack helpers: seeding, cleanup, API tokens, oracles and task checks, all as `admin` over verified TLS. */

import https from 'node:https'
import { expect } from './playwright-fixtures'
import {
  CA_CERT_PEM,
  OPENSEARCH_ADMIN_PASSWORD,
  OPENSEARCH_ADMIN_USER,
  OPENSEARCH_PORT,
  OPENSEARCH_TARGET_HOST,
} from './config'

// --- transport ------------------------------------------------------------

/** One answer from the cluster: status, raw text, and the JSON body (null when the text is not JSON). */
export interface OpenSearchAnswer {
  status: number
  text: string
  json: any
}

/** An index mapping as `PUT <index>` takes it under `mappings`. */
export type OpenSearchMappings = { properties: Record<string, unknown> }

/** One document as `_bulk` indexes it. */
export type OpenSearchDoc = Record<string, unknown>

const PREFIX = 'wave-e2e-'
const TOKEN_RE = /^[a-z0-9]+$/
const REQUEST_TIMEOUT_MS = 60_000
const BULK_CHUNK = 5_000

/** A request to the secure node as `admin`, verified against the WAVE Test CA; a string body goes as NDJSON. */
export function openSearchRequest(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<OpenSearchAnswer> {
  const payload =
    body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  const headers: Record<string, string | number> = { Accept: 'application/json' }
  if (payload !== undefined) {
    headers['Content-Type'] = typeof body === 'string' ? 'application/x-ndjson' : 'application/json'
    headers['Content-Length'] = Buffer.byteLength(payload)
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: OPENSEARCH_TARGET_HOST,
        port: Number(OPENSEARCH_PORT),
        method,
        path,
        headers,
        ca: CA_CERT_PEM,
        rejectUnauthorized: true,
        auth: `${OPENSEARCH_ADMIN_USER}:${OPENSEARCH_ADMIN_PASSWORD}`,
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          let json: any = null
          try {
            json = JSON.parse(text)
          } catch {
            json = null
          }
          resolve({ status: res.statusCode ?? 0, text, json })
        })
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error(`${method} ${path} got no answer in ${timeoutMs} ms`)))
    req.on('error', reject)
    req.end(payload)
  })
}

function expectStatus(answer: OpenSearchAnswer, status: number, what: string): void {
  expect(answer.status, `${what} answered ${answer.status}: ${answer.text.slice(0, 600)}`).toBe(status)
}

function expectOwnName(name: string): void {
  expect(name.startsWith(PREFIX), `"${name}" must start with ${PREFIX} (shared-stack isolation)`).toBe(
    true,
  )
}

// --- indexes --------------------------------------------------------------

/** The index name for one purpose under a run token: `wave-e2e-<token>-<purpose>`. */
export function openSearchIndexName(token: string, purpose: string): string {
  return `${PREFIX}${token}-${purpose}`
}

/** Put the idempotent `wave-e2e` index template (0 replicas, so the single node stays green). */
export async function ensureOpenSearchTemplate(): Promise<void> {
  const answer = await openSearchRequest('PUT', '/_index_template/wave-e2e', {
    index_patterns: ['wave-e2e-*'],
    template: { settings: { number_of_replicas: 0 } },
  })
  expectStatus(answer, 200, 'PUT _index_template/wave-e2e')
}

/** Create one `wave-e2e-*` index with an explicit mapping; puts the template first. */
export async function createOpenSearchIndex(name: string, mappings: OpenSearchMappings): Promise<void> {
  expectOwnName(name)
  await ensureOpenSearchTemplate()
  const answer = await openSearchRequest('PUT', `/${encodeURIComponent(name)}`, { mappings })
  expectStatus(answer, 200, `PUT ${name}`)
}

/** Bulk-index documents with `refresh=true`, failing on any item error; answers the created ids in order. */
export async function seedOpenSearch(name: string, docs: readonly OpenSearchDoc[]): Promise<string[]> {
  expectOwnName(name)
  const ids: string[] = []
  const action = JSON.stringify({ index: { _index: name } })
  for (let start = 0; start < docs.length; start += BULK_CHUNK) {
    const chunk = docs.slice(start, start + BULK_CHUNK)
    const body = chunk.map((doc) => `${action}\n${JSON.stringify(doc)}\n`).join('')
    const answer = await openSearchRequest('POST', '/_bulk?refresh=true', body)
    expectStatus(answer, 200, `_bulk into ${name}`)
    expect(answer.json?.errors, `_bulk into ${name} reported errors: ${answer.text.slice(0, 600)}`).toBe(
      false,
    )
    const items = answer.json.items as Array<{ index: { _id: string } }>
    expect(items, `_bulk into ${name} answers one item per document`).toHaveLength(chunk.length)
    ids.push(...items.map((item) => item.index._id))
  }
  return ids
}

/** Delete every index of one run: `DELETE /wave-e2e-<token>-*` (idempotent). */
export async function deleteOpenSearchIndexes(token: string): Promise<void> {
  expect(TOKEN_RE.test(token), `"${token}" is not a run token`).toBe(true)
  const answer = await openSearchRequest('DELETE', `/${PREFIX}${token}-*`)
  expectStatus(answer, 200, `DELETE ${PREFIX}${token}-*`)
}

// --- API tokens -----------------------------------------------------------

/** A minted API token: `id` revokes it, `token` (`os_...`) is the API Key value. */
export interface OpenSearchApiToken {
  id: string
  token: string
}

/** Mint a one-day read token on `wave-e2e-*`; the name must be new for the node's whole life. */
export async function mintOpenSearchApiToken(name: string): Promise<OpenSearchApiToken> {
  expectOwnName(name)
  const answer = await openSearchRequest('POST', '/_plugins/_security/api/apitokens', {
    name,
    cluster_permissions: ['cluster_composite_ops_ro'],
    index_permissions: [{ index_pattern: ['wave-e2e-*'], allowed_actions: ['read'] }],
    duration_seconds: 86400,
  })
  expectStatus(answer, 200, `mint API token ${name}`)
  const id = answer.json?.id
  const token = answer.json?.token
  expect(typeof id, `the mint answer carries an id: ${Object.keys(answer.json ?? {})}`).toBe('string')
  expect(String(token).startsWith('os_'), 'the mint answer carries an os_ token').toBe(true)
  return { id, token }
}

/** Revoke a minted API token (it stays listed and still counts toward the node's cap). */
export async function revokeOpenSearchApiToken(id: string): Promise<void> {
  const answer = await openSearchRequest('DELETE', `/_plugins/_security/api/apitokens/${encodeURIComponent(id)}`)
  expectStatus(answer, 200, `revoke API token ${id}`)
}

// --- oracles --------------------------------------------------------------

/** The same search the spec expects the block to make, sent as `admin`; answers the parsed body. */
export async function openSearchOracle(index: string, body: Record<string, unknown>): Promise<any> {
  const answer = await openSearchRequest('POST', `/${encodeURIComponent(index)}/_search`, body)
  expectStatus(answer, 200, `oracle search on ${index}`)
  return answer.json
}

// The metadata fields the backend field list leaves out (connectivity/opensearch/_fields.py).
const METADATA_FIELDS = new Set([
  '_id',
  '_index',
  '_routing',
  '_source',
  '_seq_no',
  '_version',
  '_ignored',
  '_field_names',
  '_nested_path',
  '_doc_count',
  '_feature',
  '_data_stream_timestamp',
])

/** The count Get fields shows for an index pattern: `_field_caps` names, objects included, metadata left out. */
export async function openSearchFieldCount(index: string): Promise<number> {
  const answer = await openSearchRequest(
    'GET',
    `/${encodeURIComponent(index)}/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true`,
  )
  expectStatus(answer, 200, `_field_caps on ${index}`)
  return Object.keys(answer.json.fields as Record<string, unknown>).filter(
    (name) => !METADATA_FIELDS.has(name),
  ).length
}

// --- search tasks ---------------------------------------------------------

/** One search task on the cluster, parent or shard phase. */
export interface OpenSearchTask {
  id: string
  action: string
  description: string
  canceled: boolean
  runningMs: number
}

/** Which search tasks a check means: an index name (matched in the task description) or a predicate. */
export type SearchTaskMatch = string | ((task: OpenSearchTask) => boolean)

/** Every search task on the cluster now (`GET _tasks?actions=*search*&detailed=true`). */
export async function openSearchSearchTasks(): Promise<OpenSearchTask[]> {
  const answer = await openSearchRequest('GET', '/_tasks?actions=*search*&detailed=true')
  expectStatus(answer, 200, 'GET _tasks')
  const tasks: OpenSearchTask[] = []
  const nodes = (answer.json?.nodes ?? {}) as Record<string, { tasks?: Record<string, any> }>
  for (const node of Object.values(nodes)) {
    for (const [id, task] of Object.entries(node.tasks ?? {})) {
      tasks.push({
        id,
        action: String(task.action ?? ''),
        description: String(task.description ?? ''),
        canceled: task.cancelled === true,
        runningMs: Math.round(Number(task.running_time_in_nanos ?? 0) / 1e6),
      })
    }
  }
  return tasks
}

function matcher(match: SearchTaskMatch): (task: OpenSearchTask) => boolean {
  return typeof match === 'string' ? (task) => task.description.includes(match) : match
}

/** The matching search tasks that still run and are not canceled. */
export async function liveSearchTasks(match: SearchTaskMatch): Promise<OpenSearchTask[]> {
  const matches = matcher(match)
  return (await openSearchSearchTasks()).filter((task) => matches(task) && !task.canceled)
}

/** Wait until a matching search task runs on the cluster and is not canceled; answers those tasks. */
export async function waitForSearchTaskRunning(
  match: SearchTaskMatch,
  timeoutMs = 15_000,
): Promise<OpenSearchTask[]> {
  let live: OpenSearchTask[] = []
  await expect
    .poll(
      async () => {
        live = await liveSearchTasks(match)
        return live.length
      },
      { timeout: timeoutMs, intervals: [100, 250], message: 'a matching search task runs on the cluster' },
    )
    .toBeGreaterThan(0)
  return live
}

/** Wait until every matching search task is canceled or gone (the cluster ended the search). */
export async function waitForSearchTaskGone(match: SearchTaskMatch, timeoutMs = 5_000): Promise<void> {
  await expect
    .poll(async () => liveSearchTasks(match), {
      timeout: timeoutMs,
      intervals: [100, 250],
      message: `every matching search task is canceled or gone within ${timeoutMs} ms`,
    })
    .toEqual([])
}

// --- datasets -------------------------------------------------------------

/** The fixed window's From as the rows hold it. */
export const FIXED_FROM = '2026-09-25T10:00:00Z'
/** The fixed window's To as the rows hold it. */
export const FIXED_TO = '2026-09-25T10:04:59Z'
/** The fixed window's From as the INFO summary line prints it. */
export const FIXED_FROM_ISO = '2026-09-25T10:00:00.000Z'
/** The fixed window's To as the INFO summary line prints it. */
export const FIXED_TO_ISO = '2026-09-25T10:04:59.000Z'

/** MAP-LOGS: dotted names as nested objects. */
export const MAP_LOGS: OpenSearchMappings = {
  properties: {
    '@timestamp': { type: 'date' },
    log: { properties: { level: { type: 'keyword' } } },
    message: { type: 'text' },
    service: { properties: { name: { type: 'keyword' }, version: { type: 'keyword' } } },
    trace: { properties: { id: { type: 'keyword' } } },
    host: { properties: { name: { type: 'keyword' } } },
    latency_ms: { type: 'long' },
    user: {
      properties: { id: { type: 'keyword' }, name: { type: 'keyword' }, roles: { type: 'keyword' } },
    },
  },
}

type LogRow = [string, string, string, string, string, string, number, Record<string, unknown>]

// @timestamp, log.level, message, service.name, trace.id, host.name, latency_ms, user
const LOG_ROWS: LogRow[] = [
  ['2026-09-25T10:00:05.000Z', 'INFO', 'Batch started', 'batch', 't-001', 'web-1', 5, { id: 'u1', name: 'ann', roles: ['a', 'b'] }],
  ['2026-09-25T10:00:40.000Z', 'ERROR', 'Payment failed', 'checkout', 't-002', 'web-1', 812, { id: 'u2', name: 'bob' }],
  ['2026-09-25T10:00:50.000Z', 'ERROR', 'Card declined', 'checkout', 'a1"b', 'web-1', 640, { id: 'u3', name: 'cid' }],
  ['2026-09-25T10:01:30.000Z', 'INFO', 'Cart updated', 'search', 't-004', 'web-2', 98, { id: 'u1', name: 'ann' }],
  ['2026-09-25T10:02:10.000Z', 'ERROR', 'Timeout calling bank', 'checkout', 't-005', 'web-1', 1500, { id: 'u2', name: 'bob' }],
  ['2026-09-25T10:02:20.000Z', 'WARN', 'Retrying payment', 'checkout', 't-006', 'web-1', 300, { id: 'u2', name: 'bob' }],
  ['2026-09-25T10:02:40.000Z', 'ERROR', 'Payment failed', 'checkout', 't-007', 'web-1', 900, { id: 'u4', name: 'dee' }],
  ['2026-09-25T10:02:50.000Z', 'ERROR', 'Payment failed', 'checkout', 't-008', 'web-1', 700, { id: 'u5', name: 'eve' }],
  ['2026-09-25T10:02:55.000Z', 'ERROR', 'Stock check failed', 'search', 't-009', 'web-2', 450, { id: 'u1', name: 'ann' }],
  ['2026-09-25T10:04:00.000Z', 'INFO', 'Batch complete', 'batch', 't-010', 'batch-1', 12, { id: 'u6', name: 'fay' }],
]

/** F-LOGS: the ten log documents, in table order (document 1 first). */
export const F_LOGS: readonly OpenSearchDoc[] = LOG_ROWS.map(
  ([timestamp, level, message, service, trace, host, latency, user]) => ({
    '@timestamp': timestamp,
    log: { level },
    message,
    service: { name: service, version: '1.4.0' },
    trace: { id: trace },
    host: { name: host },
    latency_ms: latency,
    user,
  }),
)

/** MAP-METRICS: dotted names as nested objects. */
export const MAP_METRICS: OpenSearchMappings = {
  properties: {
    '@timestamp': { type: 'date' },
    service: { properties: { name: { type: 'keyword' } } },
    latency_ms: { type: 'long' },
    requests_total: { type: 'double' },
    user: { properties: { id: { type: 'keyword' } } },
    bytes: { type: 'double' },
    log: { properties: { level: { type: 'keyword' } } },
  },
}

type MetricRow = [string, string, number, number, string, number]

// @timestamp, service.name, latency_ms, requests_total, user.id, bytes
const METRIC_ROWS: MetricRow[] = [
  ['2026-09-25T10:00:10.000Z', 'checkout', 200, 100, 'u1', 10.5],
  ['2026-09-25T10:00:30.000Z', 'checkout', 240, 130, 'u2', 20.25],
  ['2026-09-25T10:00:50.000Z', 'search', 90, 160, 'u1', 5],
  ['2026-09-25T10:01:10.000Z', 'checkout', 210, 170, 'u3', 12],
  ['2026-09-25T10:01:30.000Z', 'search', 110, 200, 'u2', 7.5],
  ['2026-09-25T10:01:50.000Z', 'checkout', 250, 230, 'u1', 30],
  ['2026-09-25T10:02:10.000Z', 'batch', 40, 5, 'u4', 1],
  ['2026-09-25T10:02:40.000Z', 'checkout', 220, 40, 'u2', 9],
  ['2026-09-25T10:04:20.000Z', 'search', 100, 50, 'u5', 4],
  ['2026-09-25T10:04:40.000Z', 'batch', 60, 90, 'u4', 2],
]

/** F-METRICS: the ten metric documents, in table order (document 1 first). */
export const F_METRICS: readonly OpenSearchDoc[] = METRIC_ROWS.map(
  ([timestamp, service, latency, requests, user, bytes]) => ({
    '@timestamp': timestamp,
    service: { name: service },
    latency_ms: latency,
    requests_total: requests,
    user: { id: user },
    bytes,
    log: { level: 'INFO' },
  }),
)

/** B-PAGE mapping: `@timestamp` date, `seq` long. */
export const MAP_PAGE: OpenSearchMappings = {
  properties: { '@timestamp': { type: 'date' }, seq: { type: 'long' } },
}

/** B-PAGE: `seq` 1 to n, `@timestamp` cycling over 10:00:00Z to 10:00:04Z (five shared values). */
export function bulkPageDocs(n: number): OpenSearchDoc[] {
  return Array.from({ length: n }, (_unused, index) => ({
    '@timestamp': `2026-09-25T10:00:0${index % 5}.000Z`,
    seq: index + 1,
  }))
}

/** S-SLOW mapping: `@timestamp` date, `n` long. */
export const MAP_SLOW: OpenSearchMappings = {
  properties: { '@timestamp': { type: 'date' }, n: { type: 'long' } },
}

/** S-SLOW: `count` documents, `@timestamp` 10:00:00Z plus i ms, `n` = i. */
export function slowDocs(count = 2000): OpenSearchDoc[] {
  const base = Date.parse('2026-09-25T10:00:00.000Z')
  return Array.from({ length: count }, (_unused, index) => ({
    '@timestamp': new Date(base + index).toISOString(),
    n: index,
  }))
}

/** The slow Query DSL query: a filter-context `script` query, so it stays slow inside the block's `bool.filter` and sort. */
export function slowQuery(n: number): Record<string, unknown> {
  return {
    script: {
      script: {
        source: 'long s = 0; for (int i = 0; i < params.n; i++) { s += i; } return s >= 0;',
        params: { n },
      },
    },
  }
}

const SLOW_TARGET_MS = 4_000
const SLOW_MIN_MS = 3_000
const SLOW_MAX_MS = 5_000
// Painless stops any loop past 1,000,000 iterations.
const SLOW_MAX_N = 900_000

/** Pick N so one search of `slowQuery(N)` over `index` takes 3 to 5 s on the cluster (its own `took`). */
export async function calibrateSlowQuery(index: string): Promise<{ n: number; ms: number }> {
  let n = 100_000
  const tries: string[] = []
  for (let attempt = 0; attempt < 5; attempt++) {
    // No hits: a shard container needs about 10 s to download a 300 KB answer, whatever the query costs.
    const answer = await openSearchOracle(index, {
      size: 0,
      track_total_hits: true,
      query: { bool: { filter: [slowQuery(n)] } },
    })
    const ms = Number(answer.took)
    tries.push(`n=${n}: ${ms} ms`)
    if (ms >= SLOW_MIN_MS && ms <= SLOW_MAX_MS) return { n, ms }
    n = Math.min(SLOW_MAX_N, Math.max(10_000, Math.round((n * SLOW_TARGET_MS) / Math.max(ms, 1))))
  }
  throw new Error(`could not calibrate the slow query to 3-5 s on ${index}: ${tries.join(', ')}`)
}

/** A UTC day as a daily index stamps it: `YYYY.MM.DD`. */
export function utcDayStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '.')
}

const DAY_MS = 24 * 60 * 60 * 1000

/** D-DAILY index names: `wave-e2e-<token>-daily-<YYYY.MM.DD>` for today, yesterday and the day before (UTC). */
export function dailyIndexNames(token: string, now: Date): string[] {
  return [0, 1, 2].map((days) =>
    openSearchIndexName(token, `daily-${utcDayStamp(new Date(now.getTime() - days * DAY_MS))}`),
  )
}

/** D-DAILY documents, one per name of `dailyIndexNames`: `@timestamp` now minus 0, 1, 2 days; `message` the index date. */
export function dailyDocs(now: Date): OpenSearchDoc[] {
  return [0, 1, 2].map((days) => {
    const at = new Date(now.getTime() - days * DAY_MS)
    return { '@timestamp': at.toISOString(), message: utcDayStamp(at) }
  })
}
