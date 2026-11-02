/**
 * V-FN-LOCAL-SECRET-CURRENT-FUNCTIONAL: a Current value of a secret Function local or output is masked in the run log
 * Wireframe: none
 * Design Decisions: VMGR-108, VMGR-107
 * REQ: REQ-3.1.3.5, REQ-3.2.1.6, REQ-3.2.1.5
 *
 * Phase: functional-workflow. Setup seeds (none is the thing under test): a Test through
 * POST /tests (zero validation errors) whose Local Function declares the secret local `fn_tok`
 * and the secret output `fn_out`; its body Log prints each whole (masked) and its last six
 * characters (never masked), so the line proves which value the run used without showing it.
 * Every Current value goes through the variable window; every run goes through the UI.
 *
 * Pass Criteria:
 * 1. A Current value set before the run on the secret local and on the secret output is the
 *    value the run uses, and the run log masks both; no console line holds either value.
 * 2. A Current value of the secret local held while paused before the Function, with the run
 *    stopped before it reached the Function, is used by the next Run Current, and the run log
 *    masks it; no console line holds the value.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { importFixtureTest } from '../../helpers/fixture-import'
import { localFunctionNode, logNode, openTest, startEdge } from '../../helpers/fn-seed'
import { expectConsoleLine, formatEntries, getLogEntries, waitForLogText } from '../../helpers/log-reader'
import { SECRET_MASK } from '../../helpers/secret-canary'
import { editProtectedValue, openEditWindow, saveWindow, setWindowValue } from '../../helpers/variable-create'
import { digIn, popToBreadcrumbSegment, selectEnvironment } from '../../helpers/workbench'
import { runCurrentToEnd, runTestToEnd } from './fn-adhoc-drive'
import { expectPausedAt, setBreakpoint, startDebugRun, stopImmediate, waitForStatus } from '../var-current-edit/helpers'

const FN = 'fn-1'
const ROOT_LOG = 'root-log'
const BODY_LOG = 'fn-log'
const TEST_PREFIX = 'v-fn-local-secret-current-'

const tail = (value: string) => value.slice(-6)

/** A Test: a root Log, then a Local Function holding the secret local `fn_tok` and secret output `fn_out`. */
async function seedTest(page: Page, initial: string): Promise<string> {
  return importFixtureTest(page, {
    name: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    version: '1.0.0',
    description: 'A Local Function with a secret local and a secret output',
    workflow: {
      nodes: [
        logNode(ROOT_LOG, 'Root', "'root-ran'", { x: 200, y: 100 }),
        localFunctionNode(
          FN,
          'Function_1',
          {
            nodes: [
              logNode(
                BODY_LOG,
                'Body',
                "'tok=' + fn_tok + ' tail=' + fn_tok[-6:] + ' out=' + fn_out + ' otail=' + fn_out[-6:]",
              ),
            ],
            edges: [startEdge(BODY_LOG)],
            variables: [{ name: 'fn_tok', type: 'string', value: `tok-${initial}`, secret: true }],
            outputs: [{ name: 'fn_out', type: 'string', secret: true, default: `out-${initial}` }],
          },
          { x: 200, y: 260 },
        ),
      ],
      edges: [startEdge(ROOT_LOG), { id: 'e-root-fn', source: ROOT_LOG, target: FN }],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  })
}

/** Give a saved secret its Current value in its Edit window: the masked field is cleared first, then typed afresh. */
async function setSecretCurrent(page: Page, name: string, value: string): Promise<void> {
  const win = await openEditWindow(page, name, { view: 'Current' })
  await editProtectedValue(page, win)
  await setWindowValue(page, win, value)
  await saveWindow(page, win)
}

/** The body line, read once the run printed it: masked whole values, real tails, and no value anywhere. */
async function expectMaskedBodyLine(page: Page, tok: string, out: string): Promise<void> {
  await waitForLogText(page, 'tok=', 30_000)
  const entries = await getLogEntries(page)
  expectConsoleLine(
    entries,
    'INFO',
    `tok=${SECRET_MASK} tail=${tail(tok)} out=${SECRET_MASK} otail=${tail(out)}`,
  )
  const leaked = entries.filter((entry) => entry.message.includes(tok) || entry.message.includes(out))
  expect(leaked, `no console line holds a secret value.\n${formatEntries(entries)}`).toEqual([])
}

test.describe('V-FN-LOCAL-SECRET-CURRENT-FUNCTIONAL: Current values of a Function own secrets', () => {
  let testId: string | undefined

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = undefined
  })

  // Per VMGR-108: a Current value set before the run is the value the run uses; a secret stays masked.
  test('a Current value set before the run on a secret Function local and output is masked in the run log', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const tag = randomUUID().slice(0, 8)
    const tok = `cur-tok-${randomUUID()}`
    const out = `cur-out-${randomUUID()}`
    testId = await seedTest(page, tag)
    await openTest(page, testId)
    await selectEnvironment(page)

    await test.step('before any run, set the Current value of the secret local and output', async () => {
      await digIn(page, FN)
      await expect(page.locator(`[data-testid="workflow-node-${BODY_LOG}"]`)).toBeVisible()
      await setSecretCurrent(page, 'fn_tok', tok)
      await setSecretCurrent(page, 'fn_out', out)
      await popToBreadcrumbSegment(page, new RegExp(`^${TEST_PREFIX}`))
    })

    await test.step('Run: the run uses both values and the log masks them', async () => {
      await runTestToEnd(page)
      await expectMaskedBodyLine(page, tok, out)
    })
  })

  // Per VMGR-107: a Current value held while paused reaches the next Run Current, masked when secret.
  test('a Current value of a secret local held for a Function the stopped run never reached is masked in the next Run Current', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const tag = randomUUID().slice(0, 8)
    const tok = `held-tok-${randomUUID()}`
    testId = await seedTest(page, tag)
    await openTest(page, testId)
    await selectEnvironment(page)

    await test.step('pause before the Function', async () => {
      await setBreakpoint(page, ROOT_LOG)
      await startDebugRun(page)
      await expectPausedAt(page, ROOT_LOG)
    })

    await test.step('while paused, hold a Current value of the secret local', async () => {
      await digIn(page, FN)
      await expect(page.locator(`[data-testid="workflow-node-${BODY_LOG}"]`)).toBeVisible()
      await setSecretCurrent(page, 'fn_tok', tok)
      await popToBreadcrumbSegment(page, new RegExp(`^${TEST_PREFIX}`))
    })

    await test.step('stop the run before it reaches the Function', async () => {
      await stopImmediate(page)
      await waitForStatus(page, 'stopped')
      const entries = await getLogEntries(page)
      expect(
        entries.filter((entry) => entry.message.startsWith('tok=')),
        `the Function never ran.\n${formatEntries(entries)}`,
      ).toEqual([])
    })

    await test.step('Run Current on the Function Block: the held value is used and masked', async () => {
      await runCurrentToEnd(page, FN)
      await expectMaskedBodyLine(page, tok, `out-${tag}`)
    })
  })
})
