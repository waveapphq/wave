/**
 * V-MCP-LIST-SUITES-FUNCTIONAL: list_suites over the MCP endpoint
 * Design Decisions: none (tool surface)
 * REQ: REQ-5.2.7.2, REQ-5.2.7.8, REQ-5.2.7.13
 *
 * Pass Criteria:
 * 1. list_suites sends one row per Suite: no id twice, and the ids are exactly the ones the
 *    GET /suites list holds.
 * 2. Each seeded Suite's row is its id, name, description, tags, Test ids and variables as
 *    GET /suites/<id> shows them, the secret masked.
 * 3. search matches the name and the description case-insensitively: each search returns only
 *    the Suite it matches.
 * 4. A search that matches nothing returns no output at all, not an error.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import {
  MASKED_VARIABLES,
  MCP_PORT,
  VARIABLES,
  listRows,
  listViaApi,
  readEntity,
  seedEntity,
  seedTest,
  sweep,
} from './organize-tools'

const PREFIX = 'zz-mcp-list_suites-'
const MEMBER_TEST = `${PREFIX}1`
const FIRST_SUITE = `${PREFIX}2`
const SECOND_SUITE = `${PREFIX}3`
const THIRD_SUITE = `${PREFIX}4`
const NO_MATCH = `${PREFIX}none`
const MARKED_DESCRIPTION = 'Holds the Mixed Case Checkout marker'

test.describe('V-MCP-LIST-SUITES-FUNCTIONAL: list_suites', () => {
  const seeded: string[] = []

  test.beforeEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    const testId = await seedTest(request, MEMBER_TEST)
    seeded.length = 0
    seeded.push(
      await seedEntity(request, '/suites', {
        name: FIRST_SUITE,
        description: 'Plain description',
        tags: ['zz-mcp-list'],
        tests: [testId],
        variables: VARIABLES,
      }),
      await seedEntity(request, '/suites', { name: SECOND_SUITE, description: MARKED_DESCRIPTION }),
      await seedEntity(request, '/suites', { name: THIRD_SUITE, description: '' }),
    )
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await resetMcpSettings(page)
  })

  test('sends one row per Suite, each as the GET API shows it, the secret masked', async ({ request }) => {
    const answer = listRows('list_suites')
    expect(answer.isError, answer.texts.join('\n')).toBe(false)
    const ids = answer.rows.map((row) => String(row.id))
    expect(new Set(ids).size, 'no Suite is listed twice').toBe(ids.length)
    const apiIds = (await listViaApi(request, '/suites')).map((row) => String(row.id))
    expect([...ids].sort()).toEqual([...apiIds].sort())

    for (const suiteId of seeded) {
      const stored = await readEntity(request, '/suites', suiteId)
      const row = answer.rows.find((entry) => entry.id === suiteId)
      expect(row, `${stored.name} is listed`).toEqual({
        id: suiteId,
        name: stored.name,
        description: stored.description,
        tags: stored.tags,
        tests: stored.tests,
        variables: stored.variables,
      })
    }
    expect(answer.rows.find((entry) => entry.id === seeded[0])?.variables).toEqual(MASKED_VARIABLES)
  })

  test('search matches name and description case-insensitively, and no match returns no output', () => {
    const byName = listRows('list_suites', { search: THIRD_SUITE.toUpperCase() })
    expect.soft(byName.isError, byName.texts.join('\n')).toBe(false)
    expect
      .soft(byName.rows.map((row) => row.id), 'a search in other case matches the name')
      .toEqual([seeded[2]])

    const byDescription = listRows('list_suites', { search: 'mixed CASE checkout' })
    expect.soft(byDescription.isError, byDescription.texts.join('\n')).toBe(false)
    expect
      .soft(byDescription.rows.map((row) => row.id), 'a search in other case matches the description')
      .toEqual([seeded[1]])

    const none = listRows('list_suites', { search: NO_MATCH })
    expect.soft(none.isError, none.texts.join('\n')).toBe(false)
    expect.soft(none.texts, 'a search that matches nothing sends no output').toEqual([])
  })
})
