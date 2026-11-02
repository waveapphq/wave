/**
 * V-CTRL-WAIT-UNTIL-FUNCTIONAL: Wait Until control end-to-end execution
 *
 * Design Decisions: WAIT-3, WAIT-4, WAIT-5, WAIT-6, WAIT-8, WAIT-9
 * REQ: REQ-3.5.4.3 (wait until condition with timeout), REQ-3.5.4.4 (poll-based checking)
 *
 * The retry lanes poll the REAL http-echo service (`/retry`, per-test key), so a
 * wait that passes only passes because the system it was watching actually
 * changed its answer between rounds.
 *
 * Pass Criteria (fixture.json, one run):
 * 1. P1 Retry succeeds: the lane runs until the endpoint flips to 200, `passed`
 *    binds true, `elapsed` covers at least two check intervals, and the run log
 *    carries one round marker per round
 * 2. P3 Retry times out with Fail Current Scope off: the node paints amber, the
 *    session is NOT failed, the timeout message is logged at WARN, and `then` runs
 * 3. P4 Watch with an already-true condition: passes inside the first round -
 *    `elapsed` is below one check interval
 * 4. P5 disabled: the retry lane never runs, `then` still does (WAIT-9)
 * 5. Every wait leaves through `then`, so the chain reaches its last marker
 *
 * Pass Criteria (fixture-fail-scope.json, second run):
 * 6. Fail Current Scope on: the timeout fails the block - the node paints failed
 *    (red), the timeout message is logged at ERROR, the flow stops at the wait
 *    (its `then` lane never runs), and the session ends failed
 *
 * Fail Current Scope needs its own workflow: it decides the whole session's
 * outcome, so "the session is NOT failed" (criterion 2) cannot be proven in the
 * same run that asserts "the session IS failed" (criterion 6).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogLines, getLogTexts, waitForLogText } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

/** Amber (#F59E0B) and red (#EF4444) from the execution border map. */
const WARNING_BORDER = 'rgb(245, 158, 11)'
const FAILED_BORDER = 'rgb(239, 68, 68)'

function loadFixture(file: string, keyPrefix: string): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, file), 'utf-8'),
  ) as { variables: Record<string, { value: unknown }> }
  // Per-test key: /retry holds a counter per key on the shared http-echo service.
  fixture.variables.run_key.value = `${keyPrefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
  return fixture as unknown as Record<string, unknown>
}

async function runToTerminalStatus(page: Page): Promise<string> {
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 15_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })
  return (await status.getAttribute('data-status')) ?? ''
}

function node(page: Page, nodeId: string) {
  return page.locator(`[data-testid="workflow-node-${nodeId}"]`)
}

async function borderColorOf(page: Page, nodeId: string): Promise<string> {
  return node(page, nodeId).evaluate((el) => getComputedStyle(el).borderColor)
}

test.describe('V-CTRL-WAIT-UNTIL-FUNCTIONAL: Wait Until end-to-end', () => {
  test('Retry succeeds, Retry times out informationally, Watch, and disabled (P1, P3, P4, P5)', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, loadFixture('fixture.json', 'main'), {
      injectHttp: true,
    })

    const statusVal = await runToTerminalStatus(page)
    await waitForLogText(page, 'wu-after')
    const logs = await getLogTexts(page)
    const lines = await getLogLines(page)
    const all = lines.join('\n')

    expect(statusVal, `Session must pass - no wait failed its scope.\n${all}`).toBe('passed')

    const occurrences = (marker: string) => logs.filter((t) => t.includes(marker)).length
    const indexOf = (marker: string) => logs.findIndex((t) => t.includes(marker))
    const assertPresent = (marker: string) =>
      expect(indexOf(marker) >= 0, `Expected "${marker}" in the run log.\n${all}`).toBeTruthy()
    const assertAbsent = (marker: string) =>
      expect(indexOf(marker) >= 0, `"${marker}" must NOT be in the run log.\n${all}`).toBeFalsy()

    const sessionId = await getActiveSessionId(page)
    const vars = await getSessionVariables(page, sessionId)
    const varDump = JSON.stringify(vars)

    await test.step('Bookends: the run entered and left the wait chain', () => {
      assertPresent('wu-before')
      assertPresent('wu-after')
    })

    await test.step('P1: the retry lane runs until the endpoint answers 200', async () => {
      expect(
        occurrences('wu-p1-round'),
        `The retry lane must run once per round - the endpoint fails twice before it answers 200.\n${all}`,
      ).toBeGreaterThanOrEqual(2)
      expect(vars.p1_passed?.value, `passed must bind true. ${varDump}`).toBe(true)
      expect(
        Number(vars.p1_elapsed?.value),
        `elapsed must cover at least two 300 ms check intervals. ${varDump}`,
      ).toBeGreaterThanOrEqual(600)
      assertPresent('wu-p1-then')
      expect(
        lines.some((l) => /^\[INFO\].*\[WAIT\] Condition met after \d+ ms$/.test(l)),
        `The run log must report the condition being met.\n${all}`,
      ).toBeTruthy()
      await expect(node(page, 'wait-p1')).toHaveAttribute('data-execution-status', 'success')
    })

    await test.step('P3: running out of time is informational - amber, session untouched', async () => {
      expect(vars.p3_passed?.value, `passed must bind false. ${varDump}`).toBe(false)
      expect(
        Number(vars.p3_elapsed?.value),
        `elapsed must reach the 1500 ms limit. ${varDump}`,
      ).toBeGreaterThanOrEqual(1500)
      expect(
        lines.some((l) => l.startsWith('[WARN]') && l.includes('wu-p3 gave up')),
        `The timeout message must be logged at WARN.\n${all}`,
      ).toBeTruthy()
      await expect(node(page, 'wait-p3')).toHaveAttribute('data-execution-status', 'warning')
      expect(
        await borderColorOf(page, 'wait-p3'),
        'an informational timeout paints the node amber',
      ).toBe(WARNING_BORDER)
      // Amber carries a WARN badge: the wait did not get what it waited for.
      const p3Badge = node(page, 'wait-p3').locator('[data-testid="node-run-state-badge"]')
      await expect(p3Badge).toHaveAttribute('data-state', 'warn')
      await expect(p3Badge).toHaveText('WARN')
      assertPresent('wu-p3-then')
    })

    await test.step('P4: Watch with an already-true condition passes inside round one', () => {
      expect(vars.p4_passed?.value, `passed must bind true. ${varDump}`).toBe(true)
      expect(
        Number(vars.p4_elapsed?.value),
        `A satisfied wait costs nothing - elapsed must stay under one 1000 ms interval. ${varDump}`,
      ).toBeLessThan(1000)
      assertPresent('wu-p4-then')
    })

    await test.step('P5: a disabled Wait Until skips its retry lane and continues (WAIT-9)', async () => {
      assertAbsent('wu-p5-retry')
      assertAbsent('wu-p5 gave up')
      assertPresent('wu-p5-then')
      await expect(node(page, 'wait-p5')).toHaveAttribute('data-disabled', 'true')
    })

    await test.step('Every wait left through then, in chain order', () => {
      const order = ['wu-before', 'wu-p1-then', 'wu-p3-then', 'wu-p4-then', 'wu-p5-then', 'wu-after']
      for (let i = 1; i < order.length; i++) {
        expect(
          indexOf(order[i - 1]) < indexOf(order[i]),
          `Expected "${order[i - 1]}" before "${order[i]}".\n${all}`,
        ).toBeTruthy()
      }
    })
  })

  test('P2: Fail Current Scope fails the wait and stops the flow there', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, loadFixture('fixture-fail-scope.json', 'fs'), {
      injectHttp: true,
    })

    const statusVal = await runToTerminalStatus(page)
    await waitForLogText(page, 'wufs gave up')
    const logs = await getLogTexts(page)
    const lines = await getLogLines(page)
    const all = lines.join('\n')

    const sessionId = await getActiveSessionId(page)
    const vars = await getSessionVariables(page, sessionId)

    await test.step('The wait fails as a block and the node paints red', async () => {
      expect(statusVal, `The session must end failed.\n${all}`).toBe('failed')
      expect(vars.fs_passed?.value, `passed must bind false. ${JSON.stringify(vars)}`).toBe(false)
      await expect(node(page, 'wait-fs')).toHaveAttribute('data-execution-status', 'failed')
      expect(await borderColorOf(page, 'wait-fs'), 'a failing timeout paints red').toBe(
        FAILED_BORDER,
      )
      expect(
        lines.some((l) => l.startsWith('[ERROR]') && l.includes('wufs gave up')),
        `The timeout message must be logged at ERROR.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('The retry lane ran, and the flow stopped at the failed wait', () => {
      expect(
        logs.some((t) => t.includes('wufs-round')),
        `Expected "wufs-round" in the run log - the retry lane runs each round.\n${all}`,
      ).toBeTruthy()
      for (const marker of ['wufs-then', 'wufs-after']) {
        expect(
          logs.some((t) => t.includes(marker)),
          `"${marker}" must not run - a failed wait stops the flow.\n${all}`,
        ).toBeFalsy()
      }
    })
  })
})
