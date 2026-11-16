/**
 * V-MCP-CREATE-REGRESSION-FUNCTIONAL: create_regression over the MCP endpoint
 * Design Decisions: none (tool surface; the Regressions page is read as it stands)
 * REQ: REQ-5.2.7.2, REQ-5.2.7.9, REQ-5.2.7.13
 *
 * Pass Criteria:
 * 1. create_regression with a name, a description, a tag, two Suites (one by id, one by name)
 *    and typed variables with one secret answers created, the new id, the name, version 1.0.0
 *    and no action items.
 * 2. GET /regressions/<id> holds exactly that name, description and tag, the two Suite ids in
 *    the order given and the variables with the secret masked; with the shared variables reveal
 *    on, the secret holds the value written.
 * 3. The Regressions page lists the Regression once, with its name, "2 suites" and "2 tests".
 * 4. A second create_regression with the same name is refused with the name conflict finding,
 *    and only the first Regression holds the name.
 * 5. create_regression naming an unknown Suite is refused with the not found finding for that
 *    ref, and no Regression of that name exists.
 * 6. create_regression with a variable given as a bare value is refused with the untyped
 *    variable finding, and no Regression of that name exists.
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
  seedEntity,
  seedTest,
  sweep,
} from '../mcp-suites/organize-tools'

const PREFIX = 'zz-mcp-create_regression-'
const FIRST_TEST = `${PREFIX}1`
const SECOND_TEST = `${PREFIX}2`
const FIRST_SUITE = `${PREFIX}3`
const SECOND_SUITE = `${PREFIX}4`
const REGRESSION = `${PREFIX}5`
const REFUSED_MEMBER_REGRESSION = `${PREFIX}6`
const REFUSED_VARIABLE_REGRESSION = `${PREFIX}7`
const UNKNOWN_SUITE = `${PREFIX}9`
const DESCRIPTION = 'Release check, created by an assistant'
const TAG = 'zz-mcp-release'

test.describe('V-MCP-CREATE-REGRESSION-FUNCTIONAL: create_regression', () => {
  test.beforeEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await resetMcpSettings(page)
  })

  test('creates the Regression the API and the Regressions page show, and refuses a duplicate name, an unknown Suite and an untyped variable', async ({
    page,
    request,
  }) => {
    const firstSuiteId = await seedEntity(request, '/suites', {
      name: FIRST_SUITE,
      tests: [await seedTest(request, FIRST_TEST)],
    })
    const secondSuiteId = await seedEntity(request, '/suites', {
      name: SECOND_SUITE,
      tests: [await seedTest(request, SECOND_TEST)],
    })
    let regressionId = ''

    await test.step('create_regression answers created with the id, name and first version', () => {
      const result = callTool(MCP_PORT, 'create_regression', {
        name: REGRESSION,
        description: DESCRIPTION,
        tags: [TAG],
        suites: [firstSuiteId, SECOND_SUITE],
        variables: VARIABLES,
      })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      regressionId = String(result.payload.regression_id ?? '')
      expect(result.payload).toEqual({
        created: true,
        regression_id: regressionId,
        name: REGRESSION,
        version: '1.0.0',
        action_items: [],
      })
    })

    await test.step('GET /regressions/<id> holds exactly what was written, the secret masked', async () => {
      const stored = await readEntity(request, '/regressions', regressionId)
      expect(stored.id).toBe(regressionId)
      expect(stored.name).toBe(REGRESSION)
      expect(stored.description).toBe(DESCRIPTION)
      expect(stored.tags).toEqual([TAG])
      expect(stored.suites, 'the Suite given by name is stored by its id, in the order given').toEqual([
        firstSuiteId,
        secondSuiteId,
      ])
      expect(stored.variables).toEqual(MASKED_VARIABLES)
      expect(stored.version).toBe('1.0.0')
      const revealed = await revealedVariables(request, '/regressions', regressionId)
      expect(revealed.api_token, 'the secret holds the value written').toEqual(VARIABLES.api_token)
      expect(revealed.api_token.value).toBe(TOKEN)
    })

    await test.step('the Regressions page lists it with its name and its Suite and Test counts', async () => {
      await page.goto(`/regressions?search=${encodeURIComponent(REGRESSION)}`)
      await expect(page.locator('[data-testid="regressions-page"]')).toBeVisible()
      const rows = page.locator('[data-testid="regressions-table"] tbody tr')
      await expect(rows).toHaveCount(1)
      await expect(rows.locator('[data-testid="regression-name"]')).toHaveText(REGRESSION)
      await expect(rows.locator('[data-testid="regression-suites-count"]')).toHaveText('2 suites')
      await expect(rows.locator('[data-testid="regression-tests-count"]')).toHaveText('2 tests')
    })

    await test.step('a duplicate name is refused and the name stays with the first Regression', async () => {
      const result = callTool(MCP_PORT, 'create_regression', { name: REGRESSION, suites: [secondSuiteId] })
      expectRefused(result, 'created', [
        inputFinding('VALIDATION', `Regression with name '${REGRESSION}' already exists`),
      ])
      expect(await idsNamed(request, '/regressions', REGRESSION)).toEqual([regressionId])
      expect((await readEntity(request, '/regressions', regressionId)).suites).toEqual([
        firstSuiteId,
        secondSuiteId,
      ])
    })

    await test.step('an unknown Suite is refused with its finding and creates nothing', async () => {
      const result = callTool(MCP_PORT, 'create_regression', {
        name: REFUSED_MEMBER_REGRESSION,
        suites: [firstSuiteId, UNKNOWN_SUITE],
      })
      expectRefused(result, 'created', [
        inputFinding(
          'ATTACHED_SUITE_NOT_FOUND',
          `Suite '${UNKNOWN_SUITE}' not found`,
          'Pass an existing suite id or unique name',
        ),
      ])
      expect(await idsNamed(request, '/regressions', REFUSED_MEMBER_REGRESSION)).toEqual([])
    })

    await test.step('a variable given as a bare value is refused and creates nothing', async () => {
      const result = callTool(MCP_PORT, 'create_regression', {
        name: REFUSED_VARIABLE_REGRESSION,
        variables: { region: 'eu-west' },
      })
      expectRefused(result, 'created', [
        inputFinding(
          'UNTYPED_VARIABLE',
          "Variable 'region' must be an object with a type",
          'Use {"type": "string"}; add "value" to give it one',
        ),
      ])
      expect(await idsNamed(request, '/regressions', REFUSED_VARIABLE_REGRESSION)).toEqual([])
    })
  })
})
