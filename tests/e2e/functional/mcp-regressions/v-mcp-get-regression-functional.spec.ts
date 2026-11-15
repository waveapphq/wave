/**
 * V-MCP-GET-REGRESSION-FUNCTIONAL: get_regression over the MCP endpoint
 * Design Decisions: none (tool surface)
 * REQ: REQ-5.2.7.2, REQ-5.2.7.8, REQ-5.2.7.13
 *
 * Pass Criteria:
 * 1. get_regression by id returns the stored Regression: id, name, description, tags, the
 *    Suites as id and name rows in the stored order (not name order) and the variables with the
 *    secret masked.
 * 2. The answer agrees with GET /regressions/<id> (name, description, tags, Suite ids,
 *    variables) and with GET /regressions/<id>/suites (Suite names in order).
 * 3. get_regression by name returns the same answer as by id.
 * 4. An unknown name and an unknown id each raise "Regression '<ref>' not found".
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import {
  MASKED_VARIABLES,
  MCP_PORT,
  VARIABLES,
  expectRaised,
  readApi,
  readEntity,
  seedEntity,
  sweep,
} from '../mcp-suites/organize-tools'

const PREFIX = 'zz-mcp-get_regression-'
const FIRST_SUITE = `${PREFIX}1`
const SECOND_SUITE = `${PREFIX}2`
const REGRESSION = `${PREFIX}3`
const UNKNOWN_NAME = `${PREFIX}9`
const UNKNOWN_ID = '5e1a7c2d-9b3f-4d80-a6e2-3f4a5b6c7d8e'
const DESCRIPTION = 'Smoke pass, seeded through the API'
const TAGS = ['zz-mcp-smoke']

test.describe('V-MCP-GET-REGRESSION-FUNCTIONAL: get_regression', () => {
  test.beforeEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await resetMcpSettings(page)
  })

  test('returns the stored Regression by id and by name, and an unknown ref raises', async ({ request }) => {
    const firstId = await seedEntity(request, '/suites', { name: FIRST_SUITE })
    const secondId = await seedEntity(request, '/suites', { name: SECOND_SUITE })
    // Stored order is the reverse of name order, so a sorted answer shows.
    const regressionId = await seedEntity(request, '/regressions', {
      name: REGRESSION,
      description: DESCRIPTION,
      tags: TAGS,
      suites: [secondId, firstId],
      variables: VARIABLES,
    })
    let byId: Record<string, any> = {}

    await test.step('by id it returns the stored Regression, Suites in order, the secret masked', () => {
      const result = callTool(MCP_PORT, 'get_regression', { regression_ref: regressionId })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      byId = result.payload
      expect(byId).toEqual({
        id: regressionId,
        name: REGRESSION,
        description: DESCRIPTION,
        tags: TAGS,
        suites: [
          { id: secondId, name: SECOND_SUITE },
          { id: firstId, name: FIRST_SUITE },
        ],
        variables: MASKED_VARIABLES,
      })
    })

    await test.step('the answer agrees with the GET API for the same Regression', async () => {
      const stored = await readEntity(request, '/regressions', regressionId)
      expect(byId.name).toBe(stored.name)
      expect(byId.description).toBe(stored.description)
      expect(byId.tags).toEqual(stored.tags)
      expect(byId.suites.map((row: { id: string }) => row.id)).toEqual(stored.suites)
      expect(byId.variables).toEqual(stored.variables)
      const members = (await readApi(request, `/regressions/${regressionId}/suites`)) as { name: string }[]
      expect(byId.suites.map((row: { name: string }) => row.name)).toEqual(members.map((row) => row.name))
    })

    await test.step('by name it returns the same answer as by id', () => {
      const result = callTool(MCP_PORT, 'get_regression', { regression_ref: REGRESSION })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload).toEqual(byId)
    })

    await test.step('an unknown name and an unknown id raise the not found message', () => {
      expectRaised(
        callTool(MCP_PORT, 'get_regression', { regression_ref: UNKNOWN_NAME }),
        'get_regression',
        `Regression '${UNKNOWN_NAME}' not found`,
      )
      expectRaised(
        callTool(MCP_PORT, 'get_regression', { regression_ref: UNKNOWN_ID }),
        'get_regression',
        `Regression '${UNKNOWN_ID}' not found`,
      )
    })
  })
})
