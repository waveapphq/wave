/**
 * V-MCP-UPDATE-REGRESSION-FUNCTIONAL: update_regression over the MCP endpoint
 * Design Decisions: SECUI-7
 * REQ: REQ-5.2.7.2, REQ-5.2.7.9, REQ-5.2.7.13
 *
 * Pass Criteria:
 * 1. update_regression with a new description and one added Suite (by name) answers updated
 *    with the next version; GET /regressions/<id> shows the new description and the Suite
 *    appended, and the name, tags and variables exactly as they were, the secret still holding
 *    its value.
 * 2. update_regression by name with remove_suites and remove_variables removes exactly that
 *    Suite and that variable; every other field stays, and the secret the merge sent back masked
 *    still holds its value. remove_suites also takes a Suite by its name, as add_suites does.
 * 3. An unknown Suite ref is refused with its finding, a removal of a Suite that is not a member
 *    (by id or by name) and a bare variable value are refused with theirs, and after each refusal
 *    the stored Regression is exactly as it was, the description sent alongside included.
 * 4. An unknown regression ref raises "Regression '<ref>' not found".
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import {
  MASK,
  MASKED_VARIABLES,
  MCP_PORT,
  TOKEN,
  VARIABLES,
  expectRaised,
  expectRefused,
  inputFinding,
  readEntity,
  revealedVariables,
  seedEntity,
  sweep,
} from '../mcp-suites/organize-tools'

const PREFIX = 'zz-mcp-update_regression-'
const FIRST_SUITE = `${PREFIX}1`
const SECOND_SUITE = `${PREFIX}2`
const THIRD_SUITE = `${PREFIX}3`
const REGRESSION = `${PREFIX}4`
const UNKNOWN = `${PREFIX}9`
const DESCRIPTION = 'Release gate, seeded through the API'
const NEW_DESCRIPTION = 'Release gate, described by an assistant'
const TAGS = ['zz-mcp-release', 'weekly']

test.describe('V-MCP-UPDATE-REGRESSION-FUNCTIONAL: update_regression', () => {
  test.beforeEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await resetMcpSettings(page)
  })

  test('changes only what it names, removes one Suite and one variable, and refuses a bad argument without touching the Regression', async ({
    request,
  }) => {
    const firstId = await seedEntity(request, '/suites', { name: FIRST_SUITE })
    const secondId = await seedEntity(request, '/suites', { name: SECOND_SUITE })
    const thirdId = await seedEntity(request, '/suites', { name: THIRD_SUITE })
    const regressionId = await seedEntity(request, '/regressions', {
      name: REGRESSION,
      description: DESCRIPTION,
      tags: TAGS,
      suites: [firstId, secondId],
      variables: VARIABLES,
    })
    const seeded = await readEntity(request, '/regressions', regressionId)
    expect(seeded.variables).toEqual(MASKED_VARIABLES)

    await test.step('a new description and one added Suite leave every omitted field as it was', async () => {
      const result = callTool(MCP_PORT, 'update_regression', {
        regression_ref: regressionId,
        description: NEW_DESCRIPTION,
        add_suites: [THIRD_SUITE],
      })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload).toEqual({
        updated: true,
        regression_id: regressionId,
        name: REGRESSION,
        version: '1.1.0',
        action_items: [],
      })
      const stored = await readEntity(request, '/regressions', regressionId)
      expect(stored.version).toBe('1.1.0')
      expect(stored.description).toBe(NEW_DESCRIPTION)
      expect(stored.suites, 'the added Suite is appended by its id').toEqual([firstId, secondId, thirdId])
      expect(stored.name).toBe(REGRESSION)
      expect(stored.tags).toEqual(TAGS)
      expect(stored.variables).toEqual(MASKED_VARIABLES)
      expect((await revealedVariables(request, '/regressions', regressionId)).api_token.value).toBe(TOKEN)
    })

    await test.step('remove_suites and remove_variables remove exactly one Suite and one variable', async () => {
      const result = callTool(MCP_PORT, 'update_regression', {
        regression_ref: REGRESSION,
        remove_suites: [firstId],
        remove_variables: ['retries'],
      })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload).toEqual({
        updated: true,
        regression_id: regressionId,
        name: REGRESSION,
        version: '1.2.0',
        action_items: [],
      })
      const stored = await readEntity(request, '/regressions', regressionId)
      expect(stored.version).toBe('1.2.0')
      expect(stored.suites).toEqual([secondId, thirdId])
      expect(stored.variables).toEqual({
        region: MASKED_VARIABLES.region,
        api_token: { type: 'string', value: MASK, secret: true },
      })
      expect(stored.description).toBe(NEW_DESCRIPTION)
      expect(stored.name).toBe(REGRESSION)
      expect(stored.tags).toEqual(TAGS)
      const revealed = await revealedVariables(request, '/regressions', regressionId)
      expect(revealed.api_token.value, 'the masked secret the merge sent back keeps its value').toBe(TOKEN)
    })

    await test.step('remove_suites takes a Suite by its name, as add_suites does', async () => {
      const result = callTool(MCP_PORT, 'update_regression', {
        regression_ref: regressionId,
        remove_suites: [SECOND_SUITE],
      })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload).toEqual({
        updated: true,
        regression_id: regressionId,
        name: REGRESSION,
        version: '1.3.0',
        action_items: [],
      })
      const stored = await readEntity(request, '/regressions', regressionId)
      expect(stored.suites, 'only the named Suite is removed').toEqual([thirdId])
      expect(stored.description).toBe(NEW_DESCRIPTION)
    })

    const before = await readEntity(request, '/regressions', regressionId)

    await test.step('an unknown Suite ref is refused and the Regression is unchanged', async () => {
      const result = callTool(MCP_PORT, 'update_regression', {
        regression_ref: regressionId,
        description: 'This description must not land',
        add_suites: [UNKNOWN],
      })
      expectRefused(result, 'updated', [
        inputFinding(
          'ATTACHED_SUITE_NOT_FOUND',
          `Suite '${UNKNOWN}' not found`,
          'Pass an existing suite id or unique name',
        ),
      ])
      expect(await readEntity(request, '/regressions', regressionId)).toEqual(before)
    })

    await test.step('removing a Suite that is not a member is refused and the Regression is unchanged', async () => {
      const result = callTool(MCP_PORT, 'update_regression', {
        regression_ref: regressionId,
        remove_suites: [firstId, SECOND_SUITE],
      })
      expectRefused(result, 'updated', [
        inputFinding('NOT_A_MEMBER', `Suite '${firstId}' is not in this regression`),
        inputFinding('NOT_A_MEMBER', `Suite '${SECOND_SUITE}' is not in this regression`),
      ])
      expect(await readEntity(request, '/regressions', regressionId)).toEqual(before)
    })

    await test.step('a bare variable value is refused and the Regression is unchanged', async () => {
      const result = callTool(MCP_PORT, 'update_regression', {
        regression_ref: regressionId,
        set_variables: { region: 'us-east' },
      })
      expectRefused(result, 'updated', [
        inputFinding(
          'UNTYPED_VARIABLE',
          "Variable 'region' must be an object with a type",
          'Use {"type": "string"}; add "value" to give it one',
        ),
      ])
      expect(await readEntity(request, '/regressions', regressionId)).toEqual(before)
    })

    await test.step('an unknown regression ref raises its not found message', () => {
      expectRaised(
        callTool(MCP_PORT, 'update_regression', { regression_ref: UNKNOWN, description: NEW_DESCRIPTION }),
        'update_regression',
        `Regression '${UNKNOWN}' not found`,
      )
    })
  })
})
