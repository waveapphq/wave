/**
 * V-MCP-UPDATE-SUITE-FUNCTIONAL: update_suite over the MCP endpoint
 * Design Decisions: SECUI-7
 * REQ: REQ-5.2.7.2, REQ-5.2.7.9, REQ-5.2.7.13
 *
 * Pass Criteria:
 * 1. update_suite with a new description and one added Test (by name) answers updated with the
 *    next version; GET /suites/<id> shows the new description and the Test appended, and the
 *    name, tags and variables exactly as they were, the secret still holding its value.
 * 2. update_suite by name with remove_tests and remove_variables removes exactly that Test and
 *    that variable; every other field stays, and the secret the merge sent back masked still
 *    holds its value. remove_tests also takes a Test by its name, as add_tests does.
 * 3. An unknown Test ref is refused with its finding, a removal of a Test that is not a member
 *    (by id or by name) and a bare variable value are refused with theirs, and after each refusal
 *    the stored Suite is exactly as it was, the description sent alongside included.
 * 4. An unknown suite ref raises "Suite '<ref>' not found".
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
  seedTest,
  sweep,
} from './organize-tools'

const PREFIX = 'zz-mcp-update_suite-'
const FIRST_TEST = `${PREFIX}1`
const SECOND_TEST = `${PREFIX}2`
const THIRD_TEST = `${PREFIX}3`
const SUITE = `${PREFIX}4`
const UNKNOWN = `${PREFIX}9`
const DESCRIPTION = 'Payments, seeded through the API'
const NEW_DESCRIPTION = 'Payments, described by an assistant'
const TAGS = ['zz-mcp-payments', 'nightly']

test.describe('V-MCP-UPDATE-SUITE-FUNCTIONAL: update_suite', () => {
  test.beforeEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await sweep(request, PREFIX)
    await resetMcpSettings(page)
  })

  test('changes only what it names, removes one Test and one variable, and refuses a bad argument without touching the Suite', async ({
    request,
  }) => {
    const firstId = await seedTest(request, FIRST_TEST)
    const secondId = await seedTest(request, SECOND_TEST)
    const thirdId = await seedTest(request, THIRD_TEST)
    const suiteId = await seedEntity(request, '/suites', {
      name: SUITE,
      description: DESCRIPTION,
      tags: TAGS,
      tests: [firstId, secondId],
      variables: VARIABLES,
    })
    const seeded = await readEntity(request, '/suites', suiteId)
    expect(seeded.variables).toEqual(MASKED_VARIABLES)

    await test.step('a new description and one added Test leave every omitted field as it was', async () => {
      const result = callTool(MCP_PORT, 'update_suite', {
        suite_ref: suiteId,
        description: NEW_DESCRIPTION,
        add_tests: [THIRD_TEST],
      })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload).toEqual({
        updated: true,
        suite_id: suiteId,
        name: SUITE,
        version: '1.1.0',
        action_items: [],
      })
      const stored = await readEntity(request, '/suites', suiteId)
      expect(stored.version).toBe('1.1.0')
      expect(stored.description).toBe(NEW_DESCRIPTION)
      expect(stored.tests, 'the added Test is appended by its id').toEqual([firstId, secondId, thirdId])
      expect(stored.name).toBe(SUITE)
      expect(stored.tags).toEqual(TAGS)
      expect(stored.variables).toEqual(MASKED_VARIABLES)
      expect((await revealedVariables(request, '/suites', suiteId)).api_token.value).toBe(TOKEN)
    })

    await test.step('remove_tests and remove_variables remove exactly one Test and one variable', async () => {
      const result = callTool(MCP_PORT, 'update_suite', {
        suite_ref: SUITE,
        remove_tests: [firstId],
        remove_variables: ['retries'],
      })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload).toEqual({
        updated: true,
        suite_id: suiteId,
        name: SUITE,
        version: '1.2.0',
        action_items: [],
      })
      const stored = await readEntity(request, '/suites', suiteId)
      expect(stored.version).toBe('1.2.0')
      expect(stored.tests).toEqual([secondId, thirdId])
      expect(stored.variables).toEqual({
        region: MASKED_VARIABLES.region,
        api_token: { type: 'string', value: MASK, secret: true },
      })
      expect(stored.description).toBe(NEW_DESCRIPTION)
      expect(stored.name).toBe(SUITE)
      expect(stored.tags).toEqual(TAGS)
      const revealed = await revealedVariables(request, '/suites', suiteId)
      expect(revealed.api_token.value, 'the masked secret the merge sent back keeps its value').toBe(TOKEN)
    })

    await test.step('remove_tests takes a Test by its name, as add_tests does', async () => {
      const result = callTool(MCP_PORT, 'update_suite', { suite_ref: suiteId, remove_tests: [SECOND_TEST] })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload).toEqual({
        updated: true,
        suite_id: suiteId,
        name: SUITE,
        version: '1.3.0',
        action_items: [],
      })
      const stored = await readEntity(request, '/suites', suiteId)
      expect(stored.tests, 'only the named Test is removed').toEqual([thirdId])
      expect(stored.description).toBe(NEW_DESCRIPTION)
    })

    const before = await readEntity(request, '/suites', suiteId)

    await test.step('an unknown Test ref is refused and the Suite is unchanged', async () => {
      const result = callTool(MCP_PORT, 'update_suite', {
        suite_ref: suiteId,
        description: 'This description must not land',
        add_tests: [UNKNOWN],
      })
      expectRefused(result, 'updated', [
        inputFinding(
          'ATTACHED_TEST_NOT_FOUND',
          `Test '${UNKNOWN}' not found`,
          'Pass an existing test id or unique name',
        ),
      ])
      expect(await readEntity(request, '/suites', suiteId)).toEqual(before)
    })

    await test.step('removing a Test that is not a member is refused and the Suite is unchanged', async () => {
      const result = callTool(MCP_PORT, 'update_suite', {
        suite_ref: suiteId,
        remove_tests: [firstId, SECOND_TEST],
      })
      expectRefused(result, 'updated', [
        inputFinding('NOT_A_MEMBER', `Test '${firstId}' is not in this suite`),
        inputFinding('NOT_A_MEMBER', `Test '${SECOND_TEST}' is not in this suite`),
      ])
      expect(await readEntity(request, '/suites', suiteId)).toEqual(before)
    })

    await test.step('a bare variable value is refused and the Suite is unchanged', async () => {
      const result = callTool(MCP_PORT, 'update_suite', {
        suite_ref: suiteId,
        set_variables: { region: 'us-east' },
      })
      expectRefused(result, 'updated', [
        inputFinding(
          'UNTYPED_VARIABLE',
          "Variable 'region' must be an object with a type",
          'Use {"type": "string"}; add "value" to give it one',
        ),
      ])
      expect(await readEntity(request, '/suites', suiteId)).toEqual(before)
    })

    await test.step('an unknown suite ref raises its not found message', () => {
      expectRaised(
        callTool(MCP_PORT, 'update_suite', { suite_ref: UNKNOWN, description: NEW_DESCRIPTION }),
        'update_suite',
        `Suite '${UNKNOWN}' not found`,
      )
    })
  })
})
