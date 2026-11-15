/**
 * V-MCP-CREATE-SUITE-FUNCTIONAL: create_suite over the MCP endpoint
 * Design Decisions: none (tool surface; the Suites page is read as it stands)
 * REQ: REQ-5.2.7.2, REQ-5.2.7.9, REQ-5.2.7.13
 *
 * Pass Criteria:
 * 1. create_suite with a name, a description, a tag, two Tests (one by id, one by name) and typed
 *    variables with one secret answers created, the new id, the name, version 1.0.0 and no
 *    action items.
 * 2. GET /suites/<id> holds exactly that name, description and tag, the two Test ids in the
 *    order given and the variables with the secret masked; with the shared variables reveal on,
 *    the secret holds the value written.
 * 3. The Suites page lists the Suite once, with its name and "2 tests".
 * 4. A second create_suite with the same name is refused with the name conflict finding, and
 *    only the first Suite holds the name.
 * 5. create_suite naming an unknown Test is refused with the not found finding for that ref, and
 *    no Suite of that name exists.
 * 6. create_suite with a variable given as a bare value is refused with the untyped variable
 *    finding, and no Suite of that name exists.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import {
  MASKED_VARIABLES,
  MCP_PORT,
  TOKEN,
  VARIABLES,
  expectRefused,
  idsNamed,
  inputFinding,
  readEntity,
  revealedVariables,
  seedTest,
  sweep,
} from './organize-tools'

const PREFIX = 'zz-mcp-create_suite-'
const FIRST_TEST = `${PREFIX}1`
const SECOND_TEST = `${PREFIX}2`
const SUITE = `${PREFIX}3`
const REFUSED_MEMBER_SUITE = `${PREFIX}4`
const REFUSED_VARIABLE_SUITE = `${PREFIX}5`
const REPEATED_MEMBER_SUITE = `${PREFIX}6`
const UNKNOWN_TEST = `${PREFIX}9`
const DESCRIPTION = 'Checkout flow, created by an assistant'
const TAG = 'zz-mcp-checkout'

test.describe('V-MCP-CREATE-SUITE-FUNCTIONAL: create_suite', () => {
  test.beforeEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await resetMcpSettings(page)
  })

  test('creates the Suite the API and the Suites page show, and refuses a duplicate name, an unknown Test, an untyped variable and a repeated Test', async ({
    page,
    request,
  }) => {
    const firstId = await seedTest(request, FIRST_TEST)
    const secondId = await seedTest(request, SECOND_TEST)
    let suiteId = ''

    await test.step('create_suite answers created with the id, name and first version', () => {
      const result = callTool(MCP_PORT, 'create_suite', {
        name: SUITE,
        description: DESCRIPTION,
        tags: [TAG],
        tests: [firstId, SECOND_TEST],
        variables: VARIABLES,
      })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      suiteId = String(result.payload.suite_id ?? '')
      expect(result.payload).toEqual({
        created: true,
        suite_id: suiteId,
        name: SUITE,
        version: '1.0.0',
        action_items: [],
      })
    })

    await test.step('GET /suites/<id> holds exactly what was written, the secret masked', async () => {
      const stored = await readEntity(request, '/suites', suiteId)
      expect(stored.id).toBe(suiteId)
      expect(stored.name).toBe(SUITE)
      expect(stored.description).toBe(DESCRIPTION)
      expect(stored.tags).toEqual([TAG])
      expect(stored.tests, 'the Test given by name is stored by its id, in the order given').toEqual([
        firstId,
        secondId,
      ])
      expect(stored.variables).toEqual(MASKED_VARIABLES)
      expect(stored.version).toBe('1.0.0')
      const revealed = await revealedVariables(request, '/suites', suiteId)
      expect(revealed.api_token, 'the secret holds the value written').toEqual(VARIABLES.api_token)
      expect(revealed.api_token.value).toBe(TOKEN)
    })

    await test.step('the Suites page lists the Suite with its name and Test count', async () => {
      await page.goto(`/suites?search=${encodeURIComponent(SUITE)}`)
      await expect(page.locator('[data-testid="suites-page"]')).toBeVisible()
      const rows = page.locator('[data-testid="suites-table"] tbody tr')
      await expect(rows).toHaveCount(1)
      await expect(rows.locator('[data-testid="suite-name"]')).toHaveText(SUITE)
      await expect(rows.locator('[data-testid="suite-tests-count"]')).toHaveText('2 tests')
    })

    await test.step('a duplicate name is refused and the name stays with the first Suite', async () => {
      const result = callTool(MCP_PORT, 'create_suite', { name: SUITE, tests: [secondId] })
      expectRefused(result, 'created', [
        inputFinding('NAME_CONFLICT', `Suite with name '${SUITE}' already exists`),
      ])
      expect(await idsNamed(request, '/suites', SUITE)).toEqual([suiteId])
      expect((await readEntity(request, '/suites', suiteId)).tests).toEqual([firstId, secondId])
    })

    await test.step('an unknown Test is refused with its finding and creates nothing', async () => {
      const result = callTool(MCP_PORT, 'create_suite', {
        name: REFUSED_MEMBER_SUITE,
        tests: [firstId, UNKNOWN_TEST],
      })
      expectRefused(result, 'created', [
        inputFinding(
          'ATTACHED_TEST_NOT_FOUND',
          `Test '${UNKNOWN_TEST}' not found`,
          'Pass an existing test id or unique name',
        ),
      ])
      expect(await idsNamed(request, '/suites', REFUSED_MEMBER_SUITE)).toEqual([])
    })

    await test.step('a variable given as a bare value is refused and creates nothing', async () => {
      const result = callTool(MCP_PORT, 'create_suite', {
        name: REFUSED_VARIABLE_SUITE,
        variables: { region: 'eu-west' },
      })
      expectRefused(result, 'created', [
        inputFinding(
          'UNTYPED_VARIABLE',
          "Variable 'region' must be an object with a type",
          'Use {"type": "string"}; add "value" to give it one',
        ),
      ])
      expect(await idsNamed(request, '/suites', REFUSED_VARIABLE_SUITE)).toEqual([])
    })

    await test.step('a Test listed twice is refused and creates nothing', async () => {
      const result = callTool(MCP_PORT, 'create_suite', {
        name: REPEATED_MEMBER_SUITE,
        tests: [firstId, firstId],
      })
      expectRefused(result, 'created', [
        inputFinding('VALIDATION', `Test with ID '${firstId}' is listed more than once`),
      ])
      expect(await idsNamed(request, '/suites', REPEATED_MEMBER_SUITE)).toEqual([])
    })
  })
})
