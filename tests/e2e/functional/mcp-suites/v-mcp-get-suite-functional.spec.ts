/**
 * V-MCP-GET-SUITE-FUNCTIONAL: get_suite over the MCP endpoint
 * Design Decisions: none (tool surface)
 * REQ: REQ-5.2.7.2, REQ-5.2.7.8, REQ-5.2.7.13
 *
 * Pass Criteria:
 * 1. get_suite by id returns the stored Suite: id, name, description, tags, the Tests as id and
 *    name rows in the stored order (not name order) and the variables with the secret masked.
 * 2. The answer agrees with GET /suites/<id> (name, description, tags, Test ids, variables) and
 *    with GET /suites/<id>/tests (Test names in order).
 * 3. get_suite by name returns the same answer as by id.
 * 4. An unknown name and an unknown id each raise "Suite '<ref>' not found".
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
  seedTest,
  sweep,
} from './organize-tools'

const PREFIX = 'zz-mcp-get_suite-'
const FIRST_TEST = `${PREFIX}1`
const SECOND_TEST = `${PREFIX}2`
const SUITE = `${PREFIX}3`
const UNKNOWN_NAME = `${PREFIX}9`
const UNKNOWN_ID = '7d0c3f5e-2b8a-4c61-9e47-0a1b2c3d4e5f'
const DESCRIPTION = 'Search flow, seeded through the API'
const TAGS = ['zz-mcp-search']

test.describe('V-MCP-GET-SUITE-FUNCTIONAL: get_suite', () => {
  test.beforeEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await resetMcpSettings(page)
  })

  test('returns the stored Suite by id and by name, and an unknown ref raises', async ({ request }) => {
    const firstId = await seedTest(request, FIRST_TEST)
    const secondId = await seedTest(request, SECOND_TEST)
    // Stored order is the reverse of name order, so a sorted answer shows.
    const suiteId = await seedEntity(request, '/suites', {
      name: SUITE,
      description: DESCRIPTION,
      tags: TAGS,
      tests: [secondId, firstId],
      variables: VARIABLES,
    })
    let byId: Record<string, any> = {}

    await test.step('by id it returns the stored Suite, Tests in order, the secret masked', () => {
      const result = callTool(MCP_PORT, 'get_suite', { suite_ref: suiteId })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      byId = result.payload
      expect(byId).toEqual({
        id: suiteId,
        name: SUITE,
        description: DESCRIPTION,
        tags: TAGS,
        tests: [
          { id: secondId, name: SECOND_TEST },
          { id: firstId, name: FIRST_TEST },
        ],
        variables: MASKED_VARIABLES,
      })
    })

    await test.step('the answer agrees with the GET API for the same Suite', async () => {
      const stored = await readEntity(request, '/suites', suiteId)
      expect(byId.name).toBe(stored.name)
      expect(byId.description).toBe(stored.description)
      expect(byId.tags).toEqual(stored.tags)
      expect(byId.tests.map((row: { id: string }) => row.id)).toEqual(stored.tests)
      expect(byId.variables).toEqual(stored.variables)
      const members = (await readApi(request, `/suites/${suiteId}/tests`)) as { name: string }[]
      expect(byId.tests.map((row: { name: string }) => row.name)).toEqual(members.map((row) => row.name))
    })

    await test.step('by name it returns the same answer as by id', () => {
      const result = callTool(MCP_PORT, 'get_suite', { suite_ref: SUITE })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload).toEqual(byId)
    })

    await test.step('an unknown name and an unknown id raise the not found message', () => {
      expectRaised(
        callTool(MCP_PORT, 'get_suite', { suite_ref: UNKNOWN_NAME }),
        'get_suite',
        `Suite '${UNKNOWN_NAME}' not found`,
      )
      expectRaised(
        callTool(MCP_PORT, 'get_suite', { suite_ref: UNKNOWN_ID }),
        'get_suite',
        `Suite '${UNKNOWN_ID}' not found`,
      )
    })
  })
})
