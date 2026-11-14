/**
 * V-MCP-RECIPE-LANE-LIMIT-FUNCTIONAL: a Parallel lane limit takes no template
 * Wireframe: none (tool surface; no UI of its own)
 * Design Decisions: none (the value form rule of a setting's rows)
 * REQ: REQ-5.2.7.3, REQ-3.2.3.7
 *
 * Seed: none. Each recipe is built in the spec and sent over the live MCP endpoint; the stored
 * Tests are read with GET /tests?search=.
 *
 * Pass Criteria:
 * 1. A recipe whose second Parallel lane writes `time_limit: {template: "500"}`,
 *    `{template: 500}` or `{template: "{{ ms }}"}` is refused by `validate_recipe` with exactly one
 *    finding: `TEMPLATE_NOT_ALLOWED` at `flow[0].parallel.branches[1].time_limit`,
 *    "'branches.1.time_limit' takes no template; templates apply to a whole text setting, a
 *    Variable Setter row or entry, and a text compare-to value", fix "Use {expr: ...} for a
 *    computed value".
 * 2. `create_test_from_recipe` refuses the same recipe with the same one finding, and no Test of
 *    that name is stored.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/recipe-authoring/v-mcp-recipe-lane-limit-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { deleteTest, runToken } from '../../helpers/element-types'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

interface Finding {
  step: string
  code: string
  problem: string
  fix: string
}

const LANE_LIMIT_TEMPLATES = [
  { id: 'text', written: '{template: "500"}' },
  { id: 'number', written: '{template: 500}' },
  { id: 'marker', written: '{template: "{{ ms }}"}' },
]

const TAKES_NO_TEMPLATE = [
  [
    'flow[0].parallel.branches[1].time_limit',
    'TEMPLATE_NOT_ALLOWED',
    "'branches.1.time_limit' takes no template; templates apply to a whole text setting, " +
      'a Variable Setter row or entry, and a text compare-to value',
    'Use {expr: ...} for a computed value',
  ],
]

/** The findings of a tool answer as `[step, code, problem, fix]` rows. */
function rows(payload: Record<string, any>): string[][] {
  return ((payload.findings ?? []) as Finding[]).map((f) => [f.step, f.code, f.problem, f.fix])
}

/** Two Parallel lanes, the second one limited by `limit`, then a Log. */
function laneLimitRecipe(name: string, limit: string): string {
  return `test:
  name: ${name}
  description: A Parallel lane limit written as a template
variables:
  ms: {type: integer, value: 500}
flow:
  - parallel:
      branches:
        - name: ingest
          steps:
            - block: log
              settings: {message: ingest}
        - name: probe
          time_limit: ${limit}
          steps:
            - block: log
              settings: {message: probe}
  - block: log
    settings: {message: joined}
`
}

test.describe('V-MCP-RECIPE-LANE-LIMIT-FUNCTIONAL: a Parallel lane limit takes no template', () => {
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

  for (const form of LANE_LIMIT_TEMPLATES) {
    test(`a lane limit written ${form.written} is refused and nothing is stored`, async ({ request }) => {
      test.setTimeout(180_000)
      const name = `zz-mcp-lane-limit-${form.id}-${runToken()}`
      const recipe = laneLimitRecipe(name, form.written)

      await test.step('validate_recipe says the lane limit takes no template', () => {
        const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe })
        expect(verdict.payload.valid, JSON.stringify(verdict.payload)).toBe(false)
        expect(rows(verdict.payload), JSON.stringify(verdict.payload)).toEqual(TAKES_NO_TEMPLATE)
      })

      await test.step('create_test_from_recipe refuses it and stores nothing', async () => {
        const refused = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
        if (refused.payload.created) created.push(refused.payload.test_id as string)
        expect(refused.payload.created, JSON.stringify(refused.payload)).toBe(false)
        expect(rows(refused.payload), JSON.stringify(refused.payload)).toEqual(TAKES_NO_TEMPLATE)
        const list = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}`)
        expect(list.ok(), `GET /tests?search= failed: ${list.status()}`).toBeTruthy()
        expect((await list.json()).data ?? [], 'no Test of the refused recipe is stored').toHaveLength(0)
      })
    })
  }
})
