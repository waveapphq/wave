/**
 * V-SECRET-DEEP-LEAF: a secret leaf nested deeper than the masking depth stays masked in a stored run and its log
 * Wireframe: none (stored run and run log only)
 * Design Decisions: SECUI-1
 * REQ: REQ-3.1.3.5 (Secret variable masking), REQ-3.1.3.23 (WAVE's print form)
 * Design: no nesting depth exhausts masking; past the depth to which copies are compared, every leaf
 *         is still scrubbed.
 *
 * Phase: functional-workflow. API seed (POST /tests), no fixture file: a secret text variable, and one
 * Variable Setter that writes an unflagged map 120 levels deep whose innermost leaf is the secret's
 * text, then a Log Block printing the map. Validated with zero errors and run once as a tracked
 * execution (POST /executions).
 *
 * Pass Criteria:
 * 1. The stored run variables (`GET /executions/<id>/variables`) hold the secret as `********` and the
 *    unflagged map with every level kept and its leaf, 120 levels down, as `********`; the secret's
 *    text is nowhere in them.
 * 2. In the run log (`GET /executions/<id>/logs`) the Log Block's line prints the map in WAVE's print
 *    form with its leaf as `********`, and no log line, its Inputs and Outputs lines included,
 *    carries the secret's text.
 * 3. The run passes.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { cleanUp, createTest, logBlock, setterBlock } from '../../helpers/fn-block'
import { validateTest } from '../../helpers/fn-seed'
import { runTrackedTest } from '../../helpers/k8s-run'
import { formatEntries, type LogEntry } from '../../helpers/log-reader'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'

const SECRET = 'dl3af-s3cr3t-7q120'
const SOURCE = 'api_token'
const TARGET = 'deep_copy'

/** Maps around the leaf: past the 100 levels a masking pass compares copies to. */
const LEVELS = 120
const DEEP_KEY = 'dk9'
const LEAF_KEY = 'leaf'

const SETTER_ID = 'deep-leaf-setter'
const LOG_ID = 'deep-leaf-log'
const DONE_ID = 'deep-leaf-done'
const DONE = 'deep-leaf-done'

/** `LEVELS` maps, each holding the next under `DEEP_KEY`; the innermost holds `leaf` under `LEAF_KEY`. */
function deepMap(leaf: string): Record<string, unknown> {
  let value: Record<string, unknown> = { [LEAF_KEY]: leaf }
  for (let level = 1; level < LEVELS; level++) value = { [DEEP_KEY]: value }
  return value
}

/** The innermost map of a value shaped like `deepMap`, with the number of levels walked to reach it. */
function innermost(value: unknown): { levels: number; map: unknown } {
  let levels = 1
  let node = value
  while (node && typeof node === 'object' && DEEP_KEY in (node as Record<string, unknown>)) {
    node = (node as Record<string, unknown>)[DEEP_KEY]
    levels++
  }
  return { levels, map: node }
}

/** The deep map in WAVE's print form, its leaf masked. */
function maskedPrintForm(): string {
  const inner = `{"${LEAF_KEY}":"${SECRET_MASK}"}`
  return `${`{"${DEEP_KEY}":`.repeat(LEVELS - 1)}${inner}${'}'.repeat(LEVELS - 1)}`
}

let testIds: string[] = []
let executionIds: string[] = []

async function seedAndRun(request: APIRequestContext): Promise<string> {
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const testId = await createTest(request, {
    name: `zz-secret-deep-leaf-${randomUUID().slice(0, 8)}`,
    nodes: [
      setterBlock(SETTER_ID, 'Store a deep value', { [TARGET]: deepMap(SECRET) }, { position: { x: 200, y: 160 } }),
      logBlock(LOG_ID, LOG_ID, TARGET, { position: { x: 200, y: 260 } }),
      logBlock(DONE_ID, DONE_ID, `'${DONE}'`, { position: { x: 200, y: 360 } }),
    ],
    variables: {
      [SOURCE]: { type: 'string', scope: 'test', secret: true, value: SECRET },
      [TARGET]: { type: 'map', scope: 'test', value: {} },
    },
  })
  testIds.push(testId)
  const validation = await validateTest(request, testId, 'run')
  expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)

  const run = await runTrackedTest(request, testId)
  executionIds.push(run.executionId)
  expect(run.verdict, `tracked run ${run.executionId} passed`).toBe('passed')
  return run.executionId
}

async function readJson(request: APIRequestContext, path: string): Promise<Record<string, unknown>> {
  const resp = await request.get(`${BACKEND_URL}${path}`)
  expect(resp.ok(), `GET ${path} failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  return (body.data ?? body) as Record<string, unknown>
}

test.describe('V-SECRET-DEEP-LEAF: a secret leaf past the masking depth stays masked', () => {
  test.afterEach(async ({ request }) => {
    for (const id of executionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/executions/${id}`).catch(() => undefined)
    }
    await cleanUp(request, testIds)
    testIds = []
  })

  test('the stored run and the run log mask a secret leaf 120 levels deep in an unflagged map', async ({
    request,
  }) => {
    test.setTimeout(180_000)
    const executionId = await seedAndRun(request)

    await test.step('the stored run variables', async () => {
      const variables = await readJson(request, `/executions/${executionId}/variables`)
      expect(variables[SOURCE], 'the secret is the bare mask').toBe(SECRET_MASK)
      const { levels, map } = innermost(variables[TARGET])
      expect(levels, 'the unflagged map keeps every level').toBe(LEVELS)
      expect(map, `the leaf ${LEVELS} levels down is masked`).toEqual({ [LEAF_KEY]: SECRET_MASK })
      expectNoSecret(JSON.stringify(variables), 'the stored run variables', [SECRET])
    })

    await test.step('the run log', async () => {
      const logs = await readJson(request, `/executions/${executionId}/logs?limit=1000`)
      const entries = (logs.entries ?? []) as LogEntry[]
      const dump = formatEntries(entries)
      // A Log Block's own line is INFO; its Inputs and Outputs lines are DEBUG.
      const lines = (id: string) =>
        entries.filter((entry) => entry.source === `Log : ${id}` && entry.level === 'INFO').map((e) => e.message)
      expect(lines(DONE_ID), `the run reached its last Block:\n${dump}`).toEqual([DONE])
      expect(lines(LOG_ID), `the Log Block prints the map with its leaf masked:\n${dump}`).toEqual([maskedPrintForm()])
      expectNoSecret(JSON.stringify(entries), 'the run log', [SECRET])
    })
  })
})
