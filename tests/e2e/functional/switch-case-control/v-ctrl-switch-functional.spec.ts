/**
 * V-CTRL-SWITCH-FUNCTIONAL: Switch/Case Control End-to-End Execution Test
 *
 * One workflow chaining eight Switch blocks, each isolating one rule of the
 * control. Imported once, run once, every marker verified in a single pass.
 *
 *   S1 first case matches and breaks      -> only case 1 runs
 *   S2 break off, next case matches       -> both run, in order
 *   S3 break off, next case does NOT      -> only the first runs
 *   S4 nothing matches, default present   -> only the default runs
 *   S5 nothing matches, no default        -> nothing runs, then still does
 *   S6 case 1's body flips case 2's guard -> case 2 runs (lazy evaluation)
 *   S7 matched case with break off        -> falls through to the DEFAULT
 *   S8 matched case that breaks           -> never reaches the default
 *
 * Every Switch's `then` lane is wired and carries the flow to the next block,
 * so a lost egress breaks the chain rather than passing silently.
 *
 * Three further workflows cover the Switch that has NOTHING wired to its `then`
 * handle, each in its own run because each decides the whole session's outcome:
 *
 *   fixture-no-exit.json         a matched case chain fails with no exit wired
 *                                -> the run ends failed and never reports a
 *                                   clean pass
 *   fixture-no-exit-pass.json    a matched case chain passes with no exit wired
 *                                -> the run still ends passed, and the Switch
 *                                   ahead of it, whose exit IS wired, still
 *                                   carries the flow on
 *   fixture-exit-wired-fail.json the same failing case chain WITH the exit wired
 *                                -> unchanged: the exit lane never runs and the
 *                                   run ends failed
 *
 * REQ: REQ-3.5.1.20 (Switch/Case multi-branch decisions)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines, waitForLogText } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'
import { expectNodeStatus, finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import {
  toggleBreakpoint,
  setDebugOption,
  startDebugRun,
  expectPausedAt,
  waitForStatus,
  clickContinue,
  clickStepOver,
} from '../debug-step/helpers'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

/** Lane edge colors from the canvas edge styler (traversed green / dimmed gray). */
const TRAVERSED = 'rgb(34, 197, 94)'
const DIMMED = 'rgb(113, 113, 122)'

function loadFixtureFile(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<
    string,
    unknown
  >
}

function loadFixture(): Record<string, unknown> {
  return {
    ...loadFixtureFile('fixture.json'),
    name: `Switch/Case Control E2E ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }
}

async function getNodeStatuses(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, string | null> = {}
    document
      .querySelectorAll('[data-testid^="workflow-node-"][data-nodetype]')
      .forEach((n) => {
        const testId = n.getAttribute('data-testid') ?? ''
        out[testId.replace(/^workflow-node-/, '')] = n.getAttribute('data-execution-status')
      })
    return out
  })
}

test.describe('Switch/Case Control E2E Execution', () => {
  test('All Switch rules: break, fall-through, default, no-default, lazy guards (S1-S8)', async ({
    page,
  }) => {
    const fixture = loadFixture()

    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
    await ensureEnvironment(page.request)

    const createResp = await page.request.post(`${BASE}/tests`, { data: fixture })
    const createBody = await createResp.json().catch(() => null)
    expect(
      createResp.ok(),
      `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
    ).toBeTruthy()
    const testId = createBody.data?.id || createBody.id

    await test.step('Fixture passes validation with zero errors', async () => {
      const validateResp = await page.request.post(`${BASE}/tests/${testId}/validate`)
      const validateBody = await validateResp.json().catch(() => null)
      expect(
        validateResp.ok(),
        `POST /tests/${testId}/validate failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`,
      ).toBeTruthy()
      const errors =
        validateBody?.data?.errors ??
        validateBody?.error?.details?.[0]?.errors ??
        validateBody?.errors ??
        []
      expect(
        errors.length,
        `Fixture failed validation. Errors: ${JSON.stringify(errors)}`,
      ).toBe(0)
    })

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })

    const statusVal = await status.getAttribute('data-status')
    if (statusVal !== 'passed') {
      test.info().annotations.push({
        type: 'node-statuses',
        description: JSON.stringify(await getNodeStatuses(page)),
      })
      test.info().annotations.push({
        type: 'log-lines',
        description: JSON.stringify(await getLogLines(page)),
      })
    }
    expect(statusVal).toBe('passed')

    // The status flips terminal a beat before the console renders the tail.
    await waitForLogText(page, 'sw-after')
    const logs = await getLogTexts(page)
    const all = logs.join('\n')

    const indexOf = (marker: string) => logs.findIndex((t) => t.includes(marker))
    const assertPresent = (marker: string) =>
      expect(indexOf(marker) >= 0, `Expected "${marker}" in logs.\n${all}`).toBeTruthy()
    const assertAbsent = (marker: string) =>
      expect(indexOf(marker) >= 0, `"${marker}" should NOT be in logs.\n${all}`).toBeFalsy()
    const assertOrder = (first: string, second: string) =>
      expect(
        indexOf(first) < indexOf(second),
        `Expected "${first}" to be logged before "${second}".\n${all}`,
      ).toBeTruthy()

    await test.step('Bookends: the run entered and left the Switch chain', () => {
      assertPresent('sw-before')
      assertPresent('sw-after')
    })

    await test.step('S1: a matching case that breaks ends the pass', () => {
      assertPresent('s1-c1')
      assertAbsent('s1-c2')
      assertPresent('s1-then')
      assertOrder('s1-c1', 's1-then')
    })

    await test.step('S2: break off falls through into a matching next case', () => {
      assertPresent('s2-c1')
      assertPresent('s2-c2')
      assertOrder('s2-c1', 's2-c2')
      assertOrder('s2-c2', 's2-then')
    })

    await test.step('S3: break off with a non-matching next case runs only the first', () => {
      assertPresent('s3-c1')
      assertAbsent('s3-c2')
      assertPresent('s3-then')
    })

    await test.step('S4: nothing matches so the default runs', () => {
      assertAbsent('s4-c1')
      assertAbsent('s4-c2')
      assertPresent('s4-def')
      assertOrder('s4-def', 's4-then')
    })

    await test.step('S5: nothing matches, no default, then still runs', () => {
      assertAbsent('s5-c1')
      assertPresent('s5-then')
      expect(
        logs.some((t) => t.includes('No case matched')),
        `Expected the run log to report "No case matched".\n${all}`,
      ).toBeTruthy()
    })

    await test.step('S6: a case body flips the guard a later case is tested on', () => {
      // flip starts "off"; case 2's condition can only pass if it was evaluated
      // AFTER case 1's body wrote flip="on".
      assertPresent('s6-c1')
      assertPresent('s6-c2')
      assertOrder('s6-c1', 's6-c2')
    })

    await test.step('S7: fall-through reaches the DEFAULT', () => {
      assertPresent('s7-c1')
      assertAbsent('s7-c2')
      assertPresent('s7-def')
      assertOrder('s7-c1', 's7-def')
      assertOrder('s7-def', 's7-then')
    })

    await test.step('S8: a matching case that breaks never reaches the default', () => {
      assertPresent('s8-c1')
      assertAbsent('s8-c2')
      assertAbsent('s8-def')
    })

    await test.step('Every lane that ran is highlighted and the untaken lanes dim', async () => {
      const strokeOf = async (edgeId: string) =>
        page
          .locator(`[data-testid="rf__edge-${edgeId}"] .react-flow__edge-path`)
          .evaluate((el) => getComputedStyle(el).stroke)

      // Both S2 lanes ran in one pass - several case lanes can be live at once.
      expect(await strokeOf('e-s2-b0'), 's2 case 1 lane must paint as taken').toBe(TRAVERSED)
      expect(await strokeOf('e-s2-b1'), 's2 case 2 lane must paint as taken').toBe(TRAVERSED)
      expect(await strokeOf('e-s2-then'), 's2 then lane must paint as taken').toBe(TRAVERSED)

      // The un-taken siblings dim rather than reading as taken.
      expect(await strokeOf('e-s1-b1'), 's1 case 2 was never taken').toBe(DIMMED)
      expect(await strokeOf('e-s7-b1'), 's7 case 2 did not match').toBe(DIMMED)
      expect(await strokeOf('e-s8-b2'), 's8 broke before its default').toBe(DIMMED)

      // The status map still proves the un-taken bodies never ran.
      const statuses = await getNodeStatuses(page)
      const diag = JSON.stringify(statuses)
      expect(statuses['log-s1-c2'], `s1-c2 must not read as run. ${diag}`).not.toBe('success')
      expect(statuses['log-s8-def'], `s8 default must not read as run. ${diag}`).not.toBe('success')
    })
  })

  /**
   * The step-over completion hook lives in the walker that every scoped path
   * shares; this guards that a Step Over inside a case chain always ends.
   *
   * S6's first case is the only two-block case chain in the fixture:
   * `vs-6-flip` then `log-s6-c1`.
   */
  test('Step Over inside a case chain re-pauses on that chain next block', async ({ page }) => {
    await importValidateAndNavigate(page, loadFixture())

    await toggleBreakpoint(page, 'vs-6-flip')
    // An armed pause-on-first would park on the first block of the workflow.
    await setDebugOption(page, 'first', false)
    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'vs-6-flip', 60_000)

    await clickStepOver(page)
    await expectPausedAt(page, 'log-s6-c1', 30_000)

    await test.step('The step ended ON the next case-chain block, before it ran', async () => {
      const logs = await getLogTexts(page)
      expect(
        logs.some((t) => t.includes('s6-c1')),
        `The pause is BEFORE the next block. Got: ${logs.join(' | ')}`,
      ).toBeFalsy()
    })

    await test.step('Continuing finishes the chain and the rest of the workflow', async () => {
      await clickContinue(page)
      await waitForStatus(page, 'passed', 60_000)
      await waitForLogText(page, 'sw-after')
      const logs = await getLogTexts(page)
      expect(logs.some((t) => t.includes('s6-c1'))).toBeTruthy()
      expect(logs.some((t) => t.includes('s6-then'))).toBeTruthy()
    })
  })

  test('A failing case chain with nothing wired after it fails the run', async ({ page }) => {
    await importValidateAndNavigate(page, loadFixtureFile('fixture-no-exit.json'))

    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(page, status, 'halted with status')
    const all = logs.join('\n')
    const present = (marker: string) => logs.some((t) => t.includes(marker))

    await test.step('The run reached the Switch and the matched case really failed', async () => {
      expect(present('sne-before'), `The run must reach the Switch.\n${all}`).toBeTruthy()
      await expectNodeStatus(page, 'log-sne-boom', 'failed')
    })

    await test.step('The verdict belongs to the case chain, not to what is wired after it', async () => {
      expect(
        verdict,
        `A failing case chain must fail the run even with no exit wired.\n${all}`,
      ).toBe('failed')
      expect(
        present('completed successfully'),
        `The run must not report a clean pass.\n${all}`,
      ).toBeFalsy()
      expect(
        present('halted with status: failed'),
        `The terminal line must carry the failure.\n${all}`,
      ).toBeTruthy()
      await expectNodeStatus(page, 'sw-sne', 'failed')
    })
  })

  test('A passing case chain with nothing wired after it still reports passed', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, loadFixtureFile('fixture-no-exit-pass.json'))

    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(page, status, 'completed successfully')
    const all = logs.join('\n')
    const present = (marker: string) => logs.some((t) => t.includes(marker))

    await test.step('The Switch whose exit IS wired still carries the flow on', async () => {
      expect(present('snp-1-hit'), `The first matched case must run.\n${all}`).toBeTruthy()
      expect(present('snp-1-then'), `The wired exit lane must run.\n${all}`).toBeTruthy()
      await expectNodeStatus(page, 'log-snp-1-then', 'success')
    })

    await test.step('The Switch with no exit wired runs its case and ends the run passed', () => {
      expect(present('snp-2-hit'), `The second matched case must run.\n${all}`).toBeTruthy()
      expect(present('snp-2-miss'), `The unmatched case must not run.\n${all}`).toBeFalsy()
      expect(verdict, `A healthy case chain must still pass.\n${all}`).toBe('passed')
      expect(
        present('completed successfully'),
        `The run must report the clean pass.\n${all}`,
      ).toBeTruthy()
    })
  })

  test('A failing case chain with the exit wired behaves exactly as before', async ({ page }) => {
    await importValidateAndNavigate(page, loadFixtureFile('fixture-exit-wired-fail.json'))

    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(page, status, 'halted with status')
    const all = logs.join('\n')
    const present = (marker: string) => logs.some((t) => t.includes(marker))

    await test.step('The exit lane never runs and nothing behind it runs', async () => {
      await expectNodeStatus(page, 'log-sew-boom', 'failed')
      await expect(
        page.locator('[data-testid="workflow-node-log-sew-then"]'),
      ).toHaveAttribute('data-execution-status', 'skipped')
      expect(present('sew-then'), `The exit lane must not run.\n${all}`).toBeFalsy()
      expect(present('sew-after'), `Nothing behind the Switch may run.\n${all}`).toBeFalsy()
    })

    await test.step('The run still ends failed', () => {
      expect(verdict, `A failing case chain must fail the run.\n${all}`).toBe('failed')
      expect(
        present('completed successfully'),
        `The run must not report a clean pass.\n${all}`,
      ).toBeFalsy()
    })
  })
})
