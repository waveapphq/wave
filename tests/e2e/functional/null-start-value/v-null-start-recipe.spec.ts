/**
 * V-NULL-START-RECIPE: a recipe declaration with no value holds null
 * Wireframe: none (MCP recipe round trip)
 * Design Decisions: VMGR-93
 * REQ: REQ-3.1.3.20, REQ-5.2.7.3, REQ-5.2.7.6, REQ-5.2.7.7, REQ-5.2.7.12, REQ-5.2.7.13
 *
 * Phase: functional-workflow. Drives the live MCP listener through the recipe-authoring client.
 *
 * Pass Criteria:
 * 1. The served guide states that a type alone is a complete declaration; it does not say
 *    every variable needs a value or an expr.
 * 2. create_test_from_recipe accepts type-only declarations and declarations written
 *    `value: null`. Only the SECRET type-only one raises a manual action item.
 * 3. get_test_recipe reads a type-only declaration back as a bare type and a `value: null`
 *    declaration back as `value: null` under its own type.
 * 4. The stored test (GET /tests/{id}) keeps every declared type: the type-only ones carry no
 *    value key, the `value: null` ones carry null.
 * 5. Opened in the workbench, every one of them reads `null` in the null look under its
 *    declared type.
 * 6. reveal_secret on the secret with no value answers value_not_set with the wording the
 *    backend unit tests pin.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { openTest } from '../../helpers/fn-seed'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { expectNullLook } from '../../helpers/null-look'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'

const MCP_PORT = Number(BACKEND_PORT) + 765

/** Exact wording from backend/wavecore/mcp/tools/secrets.py, pinned by
 *  backend/tests/mcp/test_tools_secrets.py. */
const NOT_SET_MESSAGE = 'This secret has no value set; there is nothing to reveal.'

const GUIDE_SENTENCE = 'A `type` alone is a complete declaration'
const OLD_GUIDE_SENTENCE = 'Every variable needs a `value` or an `expr`'

/** Every recipe declaration, its declared type, and the exact stored form it compiles to. */
const DECLARATIONS: ReadonlyArray<{ name: string; type: string; stored: Record<string, unknown> }> = [
  { name: 'session', type: 'string', stored: { type: 'string' } },
  { name: 'attempts', type: 'integer', stored: { type: 'integer' } },
  { name: 'limit', type: 'integer', stored: { type: 'integer', value: null } },
  { name: 'labels', type: 'map', stored: { type: 'map', value: null } },
  { name: 'token', type: 'string', stored: { type: 'string', secret: true } },
]

function nullStartRecipe(name: string): string {
  return [
    'test:',
    `  name: ${name}`,
    '  description: Declarations with no value survive the recipe round trip',
    'variables:',
    '  session: {type: string}',
    '  attempts: {type: integer}',
    '  limit: {type: integer, value: null}',
    '  labels: {type: map, value: null}',
    '  token: {type: string, secret: true}',
    'flow:',
    '  - block: log',
    '    settings: {message: declarations authored}',
    '',
  ].join('\n')
}

/** One readback declaration exactly: these lines and no further line indented under it. */
function readbackBlock(name: string, lines: readonly string[]): RegExp {
  const body = lines.map((line) => `    ${line}\\n`).join('')
  return new RegExp(`^  ${name}:\\n${body}(?!    )`, 'm')
}

async function setTestVariableReveal(page: Page, on: boolean): Promise<void> {
  const resp = await page.request.put(`${BACKEND_URL}/admin/secret-masking`, {
    data: { test_variables: on },
  })
  expect(
    resp.ok(),
    `PUT /admin/secret-masking failed: ${resp.status()} - ${await resp.text()}`,
  ).toBeTruthy()
}

test.describe('V-NULL-START-RECIPE: a recipe declaration with no value holds null', () => {
  test.afterEach(async ({ page }) => {
    await setTestVariableReveal(page, false)
    await resetMcpSettings(page)
  })

  test('the guide documents it, the write accepts it, the readback and the panel read null', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    await test.step('NULL-START: the served guide says a type alone is a complete declaration', async () => {
      const guide = callTool(MCP_PORT, 'get_recipe_guide', {})
      expect(guide.isError).toBe(false)
      const text = String(guide.payload.guide ?? '')
      expect(text, 'the guide documents the type-only declaration').toContain(GUIDE_SENTENCE)
      expect(text, 'the old value-or-expr rule is gone').not.toContain(OLD_GUIDE_SENTENCE)
    })

    const name = `Null Start Recipe ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let testId = ''

    await test.step('NULL-START: the write accepts both forms; only the SECRET raises an action item', async () => {
      const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: nullStartRecipe(name) })
      expect(created.isError, JSON.stringify(created.payload)).toBe(false)
      expect(created.payload.created, 'type-only and value: null declarations are valid').toBe(true)
      testId = String(created.payload.test_id)
      const items = (created.payload.action_items ?? []) as Array<Record<string, unknown>>
      expect(
        items.map((item) => item.step),
        'a plain variable holding null is not something a person owes a value for',
      ).toEqual(['variables.token'])
      expect(items[0].code).toBe('NO_VALUE_VARIABLE')
    })

    await test.step('NULL-START: the readback keeps a bare type bare and writes value: null back', async () => {
      const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: testId })
      expect(readback.isError).toBe(false)
      const recipe = String(readback.payload.recipe ?? '')
      expect(recipe).toMatch(readbackBlock('session', ['type: string']))
      expect(recipe).toMatch(readbackBlock('attempts', ['type: integer']))
      expect(recipe).toMatch(readbackBlock('limit', ['type: integer', 'value: null']))
      expect(recipe).toMatch(readbackBlock('labels', ['type: map', 'value: null']))
      expect(recipe).toMatch(readbackBlock('token', ['type: string', 'secret: true']))
    })

    await test.step('NULL-START: the stored test keeps every declared type', async () => {
      const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
      const variables = (await resp.json()).data.variables as Record<string, unknown>
      for (const declaration of DECLARATIONS) {
        expect(variables[declaration.name], `${declaration.name} is stored as declared`).toEqual(
          declaration.stored,
        )
      }
    })

    await test.step('NULL-START: in the workbench every declaration reads null under its type', async () => {
      await openTest(page, testId)
      await expandVariableManager(page)
      for (const declaration of DECLARATIONS) {
        const row = variableRow(page, declaration.name)
        await expectNullLook(
          row.locator('[data-testid^="variable-value-"]'),
          `the ${declaration.name} row`,
        )
        await expect(
          row.locator('[data-testid^="type-badge-"]'),
          `${declaration.name} keeps its declared type`,
        ).toHaveText(declaration.type)
      }
    })

    await test.step('NULL-START: revealing a secret with no value says there is nothing to reveal', async () => {
      await setTestVariableReveal(page, true)
      const revealed = callTool(MCP_PORT, 'reveal_secret', {
        entity_type: 'test',
        ref: testId,
        secret_name: 'token',
        consent: true,
      })
      expect(revealed.isError).toBe(false)
      expect(revealed.payload.revealed).toBe(false)
      expect(revealed.payload.reason).toBe('value_not_set')
      expect(revealed.payload.message).toBe(NOT_SET_MESSAGE)
      expect(revealed.payload.value, 'a secret with no value has nothing to hand back').toBeUndefined()
    })
  })
})
