/**
 * V-FIELD-HTTP-NULL-HEADER-FUNCTIONAL: a null header entry is sent with an empty value
 * Wireframe: none (functional)
 * Design Decisions: FIELD-13
 * REQ: REQ-3.1.3.21, REQ-3.1.3.20
 *
 * Real stack: `http-echo` (HTTPS echo, certificate check off). One run, two HTTP Request Blocks:
 * the `X-Trace` header entry is an expression giving `None` in the first and a stored literal null
 * in the second. HTTP Request reads a null header value as empty text, so neither Block fails.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests and validates with zero errors; the stored Test
 *    keeps the literal null entry as null (Save never turns it into text) and the expression
 *    entry as an expression.
 * 2. The run passes and both HTTP Request Blocks succeed with status 200.
 * 3. The headers http-echo received carry `x-trace` with an empty value for the expression null
 *    and for the stored null, beside the control header `x-leg`.
 * 4. Neither Block's console names a null refusal: no `'X-Trace' in 'headers' is null` line.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { readFixture, getTest, deleteTest } from '../../helpers/element-types'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionValue,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'

const FIXTURE = 'fixture-http-null-header.json'
const DONE_MARKER = 'http-null-header-done'
const REFUSAL = "'X-Trace' in 'headers' is null"

const IDS = {
  expression: 'b5928034-b6e7-403a-a10c-440eaec15b46',
  stored: 'fd4eff65-7c7e-4e5d-814d-2e275526bb0f',
  bookend: 'ea9d404c-5c15-49b4-b0ea-ebb90dd85bb5',
} as const

type Echo = { method?: string; headers: Record<string, string> }
type StoredNode = { id: string; data: { expressionFields?: string[]; config: { values: Record<string, any> } } }

function echoOf(raw: unknown): Echo {
  return JSON.parse(String(raw)) as Echo
}

test.describe('V-FIELD-HTTP-NULL-HEADER-FUNCTIONAL: a null header entry is sent empty', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    testId = ''
  })

  test('an expression giving None and a stored null header reach http-echo as X-Trace with no value', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000)
    testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE), { injectHttp: true })

    await test.step('the stored Test keeps the literal null entry and the expression entry', async () => {
      const stored = await getTest(request, testId)
      const nodes = stored.workflow.nodes as StoredNode[]
      const storedLeg = nodes.find((node) => node.id === IDS.stored)
      const expressionLeg = nodes.find((node) => node.id === IDS.expression)
      expect(storedLeg?.data.config.values.headers, 'the literal null entry is stored as null').toEqual({
        'X-Trace': null,
        'X-Leg': 'stored',
      })
      expect(expressionLeg?.data.expressionFields ?? []).toEqual(['headers.X-Trace'])
      expect(expressionLeg?.data.config.values.headers['X-Trace']).toBe('None')
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, DONE_MARKER)
    const all = logs.join('\n')
    const vars = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('both HTTP Request Blocks succeed with status 200', async () => {
      await expectNodeStatus(page, IDS.expression, 'success')
      await expectNodeStatus(page, IDS.stored, 'success')
      await expectNodeStatus(page, IDS.bookend, 'success')
      expect(sessionValue(vars, 'expr_status')).toBe(200)
      expect(sessionValue(vars, 'stored_status')).toBe(200)
    })

    await test.step('http-echo received X-Trace with an empty value from both Blocks', () => {
      const expressionEcho = echoOf(sessionValue(vars, 'expr_body'))
      const storedEcho = echoOf(sessionValue(vars, 'stored_body'))
      expect(expressionEcho.headers['x-leg'], 'the expression leg reached http-echo').toBe('expression')
      expect(expressionEcho.headers, 'None in an expression entry is sent as an empty header').toHaveProperty(
        'x-trace',
        '',
      )
      expect(storedEcho.headers['x-leg'], 'the stored leg reached http-echo').toBe('stored')
      expect(storedEcho.headers, 'a stored null entry is sent as an empty header').toHaveProperty('x-trace', '')
    })

    await test.step('no console line refuses the null header', () => {
      expect(
        logs.some((line) => line.includes(REFUSAL)),
        `a null header value is not refused.\n${all}`,
      ).toBeFalsy()
    })
  })
})
