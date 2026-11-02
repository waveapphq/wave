/**
 * V-NUMBER-BLOCKS-CATALOG-FUNCTIONAL: Get Tables and Get fields read a number row by the one number rule
 * Wireframe: none (functional)
 * Design Decisions: SQL-12, OS-13
 * REQ: REQ-3.1.3.14, REQ-3.4.1.6
 *
 * The pulls the SQL and OpenSearch windows start, sent as the window sends them, against the real `postgres` and
 * `opensearch` services. Each request carries the rows as a Block holds them.
 *
 * Pass Criteria:
 * 1. Get Tables with Port text `54x32` answers 422 `Cannot resolve Port: Setting 'port' is not a valid integer`;
 *    no pull starts.
 * 2. Get fields with Connect timeout text `45s` answers 422 `Cannot resolve Connect timeout: Setting
 *    'connect_timeout' is not a valid integer`.
 * 3. Port given as the digit text of the published port is that number: the pull connects and lists the tables.
 * 4. An emptied Connect timeout takes the Block default: the pull connects and lists the indexes.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  OPENSEARCH_ADMIN_PASSWORD,
  OPENSEARCH_ADMIN_USER,
  OPENSEARCH_PORT,
  OPENSEARCH_TARGET_HOST,
  POSTGRES_PORT,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
} from '../../helpers/config'

const ROUTES = { sql: '/sql-tools/catalog', opensearch: '/opensearch-tools/fields' } as const
type Catalog = keyof typeof ROUTES

const SQL_CONNECTION = {
  database_type: 'postgresql',
  host: SQL_TARGET_HOST,
  database: SQL_STACK_DATABASE,
  username: SQL_STACK_USER,
  password: SQL_STACK_PASSWORD,
}

const OPENSEARCH_CONNECTION = {
  url: `https://${OPENSEARCH_TARGET_HOST}:${OPENSEARCH_PORT}`,
  username: OPENSEARCH_ADMIN_USER,
  password: OPENSEARCH_ADMIN_PASSWORD,
  verify_ssl: false,
}

/** Start a pull the way the window does: the rows as held, no expression rows, no profile. */
async function startPull(
  request: APIRequestContext,
  catalog: Catalog,
  connection: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, any> }> {
  const resp = await request.post(`${BACKEND_URL}${ROUTES[catalog]}`, {
    data: {
      connection,
      refresh: true,
      expression_fields: [],
      template_fields: [],
      element_types: {},
      profile_bindings: [],
      environment_id: null,
      test_id: null,
    },
  })
  return { status: resp.status(), body: (await resp.json().catch(() => ({}))) as Record<string, any> }
}

/** Poll a started pull to its end and return its last answer. */
async function settledPull(request: APIRequestContext, catalog: Catalog, jobId: string): Promise<Record<string, any>> {
  let answer: Record<string, any> = {}
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}${ROUTES[catalog]}/${jobId}`)
        answer = ((await resp.json().catch(() => ({}))) as Record<string, any>).data ?? {}
        return answer.status
      },
      { timeout: 60_000, intervals: [250, 500, 1_000], message: `the ${catalog} pull ends` },
    )
    .toMatch(/^(done|failed|canceled)$/)
  return answer
}

test.describe('V-NUMBER-BLOCKS-CATALOG-FUNCTIONAL: catalog pulls read number rows by the rule', () => {
  test('text that is not an integer is refused by its label; digit text and an emptied box connect', async ({
    request,
  }) => {
    test.setTimeout(150_000)

    await test.step('Get Tables refuses Port text that is not an integer', async () => {
      const refused = await startPull(request, 'sql', { ...SQL_CONNECTION, port: '54x32' })
      expect(refused.status, JSON.stringify(refused.body)).toBe(422)
      expect(refused.body.error?.message).toBe("Cannot resolve Port: Setting 'port' is not a valid integer")
    })

    await test.step('Get fields refuses Connect timeout text that is not an integer', async () => {
      const refused = await startPull(request, 'opensearch', { ...OPENSEARCH_CONNECTION, connect_timeout: '45s' })
      expect(refused.status, JSON.stringify(refused.body)).toBe(422)
      expect(refused.body.error?.message).toBe(
        "Cannot resolve Connect timeout: Setting 'connect_timeout' is not a valid integer",
      )
    })

    await test.step('Port written as digit text is that port: Get Tables lists the tables', async () => {
      const started = await startPull(request, 'sql', { ...SQL_CONNECTION, port: String(POSTGRES_PORT) })
      expect(started.status, JSON.stringify(started.body)).toBeLessThan(300)
      const answer = await settledPull(request, 'sql', started.body.data.job_id as string)
      expect(answer.status, JSON.stringify(answer)).toBe('done')
      expect(Array.isArray(answer.tables), JSON.stringify(answer)).toBe(true)
    })

    await test.step('an emptied Connect timeout takes the default: Get fields lists the indexes', async () => {
      const started = await startPull(request, 'opensearch', { ...OPENSEARCH_CONNECTION, connect_timeout: '' })
      expect(started.status, JSON.stringify(started.body)).toBeLessThan(300)
      const answer = await settledPull(request, 'opensearch', started.body.data.job_id as string)
      expect(answer.status, JSON.stringify(answer)).toBe('done')
      expect(Array.isArray(answer.indexes), JSON.stringify(answer)).toBe(true)
    })
  })
})
