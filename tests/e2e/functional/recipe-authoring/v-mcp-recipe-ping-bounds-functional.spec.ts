/**
 * V-MCP-RECIPE-PING-BOUNDS-FUNCTIONAL: every recipe tool refuses a Ping whose Minimum replies is above Count
 * Wireframe: none (tool surface)
 * Design Decisions: none (the shared field check's field-relative ceiling, REQ-3.4.2.2 Rules beyond type)
 * REQ: REQ-3.4.2.2, REQ-3.4.1.9
 *
 * Seed: one Test with a valid Ping saved through POST /tests for the amend; every recipe is built in the
 * spec and sent over the live MCP endpoint. Every Test is deleted after.
 *
 * Pass Criteria:
 * 1. `validate_recipe` of a Ping with Pass when At least N replies, Count 4 and Minimum replies 5 returns
 *    exactly one finding: `SETTING_ABOVE_MAXIMUM` at `flow[0]`, "Setting 'min_replies' of block 'ping' must
 *    be at most the value of setting 'count' (4), got 5", fix "Provide a value of at most 4".
 * 2. `create_test_from_recipe` refuses the same recipe with the same finding and stores nothing.
 * 3. `amend_test_from_recipe` refuses it on a seeded Test, which keeps its stored Ping.
 * 4. Minimum replies equal to Count validates clean.
 * 5. Count left out compares with its default 4; Count 2 with Minimum replies 3 names 2.
 * 6. Pass when not At least N replies, an expression on Minimum replies and an expression on Count
 *    validate clean; a Count that fails its own floor shows only Count's finding.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/recipe-authoring/v-mcp-recipe-ping-bounds-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { deleteTest } from '../../helpers/element-types'
import { createTest, pluginBlock } from '../../helpers/fn-block'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import {
  MCP_PORT,
  freeSlot,
  rows,
  storedTestDoc,
  storedTestsNamed,
  tool,
  uniqueName,
} from './recipe-tool-helpers'

/** The ceiling finding, word for word. */
function ceiling(count: number, value: number): [string, string, string, string] {
  return [
    'flow[0]',
    'SETTING_ABOVE_MAXIMUM',
    `Setting 'min_replies' of block 'ping' must be at most the value of setting 'count' (${count}), got ${value}`,
    `Provide a value of at most ${count}`,
  ]
}

/** One Ping on the loopback whose settings are written as given, YAML flow style. */
function pingRecipe(name: string, settings: string): string {
  return `test:
  name: ${name}
  description: A Ping whose Minimum replies meets its Count
variables:
  want_replies: {type: integer, value: 5}
  ping_count: {type: integer, value: 2}
flow:
  - block: ping
    label: Reach the loopback
    settings: {host: 127.0.0.1, interval: 0.2, ${settings}}
`
}

const ABOVE = 'count: 4, pass_when: min_replies, min_replies: 5'

test.describe('V-MCP-RECIPE-PING-BOUNDS-FUNCTIONAL: the Ping ceiling on every recipe tool', () => {
  const created: string[] = []

  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const id of created.splice(0)) await deleteTest(request, id)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('validate, create and amend refuse 5 over 4 with the exact finding', async ({ page, request }) => {
    test.setTimeout(240_000)
    const name = uniqueName('zz-b29-ping-bounds')
    const recipe = pingRecipe(name, ABOVE)

    await test.step('1. validate_recipe returns the exact finding', () => {
      const verdict = tool('validate_recipe', { recipe })
      expect(verdict.valid, JSON.stringify(verdict)).toBe(false)
      expect(rows(verdict)).toEqual([ceiling(4, 5)])
    })

    await test.step('2. create_test_from_recipe refuses it and stores nothing', async () => {
      const refused = tool('create_test_from_recipe', { recipe })
      if (refused.created) created.push(String(refused.test_id))
      expect(refused.created, JSON.stringify(refused)).toBe(false)
      expect(rows(refused)).toEqual([ceiling(4, 5)])
      expect(await storedTestsNamed(request, name), 'no Test of the refused recipe is stored').toEqual([])
    })

    await test.step('3. amend_test_from_recipe refuses it on a seeded Test', async () => {
      const seededName = uniqueName('zz-b29-ping-bounds-seeded')
      const values = { host: '127.0.0.1', interval: 0.2, count: 4, pass_when: 'min_replies', min_replies: 2 }
      const testId = await createTest(request, {
        name: seededName,
        nodes: [pluginBlock('ping-1', 'Reach the loopback', 'ping', 'network', { values })],
        variables: {
          want_replies: { type: 'integer', value: 5 },
          ping_count: { type: 'integer', value: 2 },
        },
      })
      created.push(testId)
      await freeSlot(page, request)

      const refused = tool('amend_test_from_recipe', { test_ref: testId, recipe: pingRecipe(seededName, ABOVE) })
      expect(refused.amended, JSON.stringify(refused)).toBe(false)
      expect(rows(refused)).toEqual([ceiling(4, 5)])

      const stored = (await storedTestDoc(request, testId)).workflow.nodes as Array<Record<string, any>>
      const ping = stored.find((node) => node.data.elementType === 'ping')
      expect(ping?.data.config.values, 'the stored Ping is unchanged').toEqual(values)
    })
  })

  test('4. Minimum replies equal to Count validates clean', () => {
    const verdict = tool('validate_recipe', {
      recipe: pingRecipe(uniqueName('zz-b29-ping-equal'), 'count: 4, pass_when: min_replies, min_replies: 4'),
    })
    expect(verdict.valid, JSON.stringify(verdict)).toBe(true)
    expect(rows(verdict)).toEqual([])
  })

  test('5. an unset Count compares with its default 4, and the message names the Count in effect', () => {
    const unset = tool('validate_recipe', {
      recipe: pingRecipe(uniqueName('zz-b29-ping-default'), 'pass_when: min_replies, min_replies: 5'),
    })
    expect(unset.valid, JSON.stringify(unset)).toBe(false)
    expect(rows(unset)).toEqual([ceiling(4, 5)])

    const unsetEqual = tool('validate_recipe', {
      recipe: pingRecipe(uniqueName('zz-b29-ping-default-equal'), 'pass_when: min_replies, min_replies: 4'),
    })
    expect(rows(unsetEqual), 'Minimum replies 4 under the default Count 4 is inside the bound').toEqual([])

    const two = tool('validate_recipe', {
      recipe: pingRecipe(uniqueName('zz-b29-ping-two'), 'count: 2, pass_when: min_replies, min_replies: 3'),
    })
    expect(rows(two)).toEqual([ceiling(2, 3)])
  })

  test('6. the ceiling holds only while it applies to literal values', () => {
    const passing: Array<[string, string]> = [
      ['Pass when is Any reply', 'count: 4, pass_when: any, min_replies: 5'],
      ['Pass when is At least X% replies', 'count: 4, pass_when: min_rate, min_rate: 50, min_replies: 5'],
      ['Minimum replies is an expression', 'count: 4, pass_when: min_replies, min_replies: {expr: "want_replies"}'],
      ['Count is an expression', 'count: {expr: "ping_count"}, pass_when: min_replies, min_replies: 5'],
    ]
    for (const [what, settings] of passing) {
      const verdict = tool('validate_recipe', { recipe: pingRecipe(uniqueName('zz-b29-ping-skip'), settings) })
      expect(rows(verdict), `${what}: no ceiling finding`).toEqual([])
      expect(verdict.valid, `${what}: ${JSON.stringify(verdict)}`).toBe(true)
    }

    // A Count that fails its own check shows only its own finding.
    const broken = tool('validate_recipe', {
      recipe: pingRecipe(uniqueName('zz-b29-ping-count-floor'), 'count: 0, pass_when: min_replies, min_replies: 5'),
    })
    expect(broken.valid, JSON.stringify(broken)).toBe(false)
    const problems = rows(broken).map((row) => row[2])
    expect(problems).toContain("Setting 'count' of block 'ping' must be at least 1, got 0")
    expect(
      problems.filter((problem) => problem.includes("'min_replies'")),
      'no ceiling finding while Count has its own',
    ).toEqual([])
  })
})
