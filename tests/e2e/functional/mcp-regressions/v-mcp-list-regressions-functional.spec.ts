/**
 * V-MCP-LIST-REGRESSIONS-FUNCTIONAL: list_regressions over the MCP endpoint
 * Design Decisions: none (tool surface)
 * REQ: REQ-5.2.7.2, REQ-5.2.7.8, REQ-5.2.7.13
 *
 * Pass Criteria:
 * 1. list_regressions sends one row per Regression: no id twice, and the ids are exactly the
 *    ones the GET /regressions list holds.
 * 2. Each seeded Regression's row is the row the GET /regressions list holds for it, and its
 *    name, description, tags, Suite ids and variables are what GET /regressions/<id> shows, the
 *    secret masked.
 * 3. search matches the name and the description case-insensitively: each search returns only
 *    the Regression it matches.
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
  sweep,
} from '../mcp-suites/organize-tools'

const PREFIX = 'zz-mcp-list_regressions-'
const MEMBER_SUITE = `${PREFIX}1`
const FIRST_REGRESSION = `${PREFIX}2`
const SECOND_REGRESSION = `${PREFIX}3`
const THIRD_REGRESSION = `${PREFIX}4`
const NO_MATCH = `${PREFIX}none`
const MARKED_DESCRIPTION = 'Holds the Mixed Case Release marker'

test.describe('V-MCP-LIST-REGRESSIONS-FUNCTIONAL: list_regressions', () => {
  const seeded: string[] = []

  test.beforeEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    const suiteId = await seedEntity(request, '/suites', { name: MEMBER_SUITE })
    seeded.length = 0
    seeded.push(
      await seedEntity(request, '/regressions', {
        name: FIRST_REGRESSION,
        description: 'Plain description',
        tags: ['zz-mcp-list'],
        suites: [suiteId],
        variables: VARIABLES,
      }),
      await seedEntity(request, '/regressions', { name: SECOND_REGRESSION, description: MARKED_DESCRIPTION }),
      await seedEntity(request, '/regressions', { name: THIRD_REGRESSION, description: '' }),
    )
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await resetMcpSettings(page)
  })

  test('sends one row per Regression, each as the GET API shows it, the secret masked', async ({ request }) => {
    const answer = listRows('list_regressions')
    expect(answer.isError, answer.texts.join('\n')).toBe(false)
    const ids = answer.rows.map((row) => String(row.id))
    expect(new Set(ids).size, 'no Regression is listed twice').toBe(ids.length)
    const apiRows = await listViaApi(request, '/regressions')
    expect([...ids].sort()).toEqual(apiRows.map((row) => String(row.id)).sort())

    for (const regressionId of seeded) {
      const row = answer.rows.find((entry) => entry.id === regressionId)
      expect(row, `${regressionId} matches its row in the GET list`).toEqual(
        apiRows.find((entry) => entry.id === regressionId),
      )
      const stored = await readEntity(request, '/regressions', regressionId)
      expect(row?.name).toBe(stored.name)
      expect(row?.description).toBe(stored.description)
      expect(row?.tags).toEqual(stored.tags)
      expect(row?.suites).toEqual(stored.suites)
      expect(row?.variables).toEqual(stored.variables)
    }
    expect(answer.rows.find((entry) => entry.id === seeded[0])?.variables).toEqual(MASKED_VARIABLES)
  })

  test('search matches name and description case-insensitively, and no match returns no output', () => {
    const byName = listRows('list_regressions', { search: THIRD_REGRESSION.toUpperCase() })
    expect.soft(byName.isError, byName.texts.join('\n')).toBe(false)
    expect
      .soft(byName.rows.map((row) => row.id), 'a search in other case matches the name')
      .toEqual([seeded[2]])

    const byDescription = listRows('list_regressions', { search: 'mixed CASE release' })
    expect.soft(byDescription.isError, byDescription.texts.join('\n')).toBe(false)
    expect
      .soft(byDescription.rows.map((row) => row.id), 'a search in other case matches the description')
      .toEqual([seeded[1]])

    const none = listRows('list_regressions', { search: NO_MATCH })
    expect.soft(none.isError, none.texts.join('\n')).toBe(false)
    expect.soft(none.texts, 'a search that matches nothing sends no output').toEqual([])
  })
})
