/**
 * V-CONTROL-PARALLEL-FUNCTIONAL: Parallel control end-to-end execution
 *
 * Design Decisions: PARALLEL-1, PARALLEL-2, PARALLEL-4
 * REQ: REQ-3.2.3.1, REQ-3.2.3.2, REQ-3.2.3.3, REQ-3.2.3.5, REQ-3.2.3.6,
 *      REQ-3.2.3.7, REQ-3.2.3.8
 *
 * Pass Criteria (fixture.json, one run):
 * 1. P1 Wait for all: both branches' writes are readable after the join, and the
 *    exit lane runs exactly once
 * 2. P2 Cross-branch coordination: a Watch-mode Wait Until in one branch is
 *    satisfied by a sibling's write - it waits out the sibling's work and passes
 * 3. P3 First to finish: the exit runs, the loser's in-flight block paints
 *    stopped, its tail paints skipped, and the run carries on
 * 4. P5 Nesting: a Parallel inside a branch releases its own join before the
 *    outer branch continues
 * 5. P6 Disabled: neither branch body runs - they render muted, the same as a
 *    disabled Switch's cases - and the flow leaves through the exit
 * 6. P4 Per-branch time limit: expiry fails the section, stops the sibling,
 *    skips the exit lane, and ends the run - so it comes last in the chain
 * 7. Every branch-scoped outcome names its branch in the run log
 *
 * Pass Criteria (fixture-assert-scope.json, second run):
 * 8. A failing split Assert with Fail Current Scope is not a branch failure: the
 *    branch carries on down its fail branch, the exit lane runs, and the run ends
 *    failed
 *
 * Pass Criteria (fixture-halt.json, third run):
 * 9. A Halt in a branch ends the section: the sibling's in-flight block stops,
 *    the exit lane is skipped, and the run carries the status the Halt declared
 *
 * Pass Criteria (fixture-no-exit.json, fourth run):
 * 10. A section with NOTHING wired to its then handle still owns its verdict: one
 *     failing lane ends the run failed, and the run never reports a clean pass
 *
 * Pass Criteria (fixture-race-no-exit.json, fifth run):
 * 11. The same section with nothing wired after it, all lanes healthy, still
 *     reports passed - and the losing one-Block lane of a race join reads
 *     stopped rather than running, on a run that passed outright
 *
 * Pass Criteria (fixture-stopped-lanes.json, sixth run):
 * 12. When a lane fails, every sibling lane still in flight is given a terminal
 *     state: a lane that is a single still-running Block reads stopped, the lane
 *     that finished keeps its own result, no Block anywhere is left running, and
 *     the run log names each stopped lane. With an exit wired the section behaves
 *     exactly as before - the exit lane never runs and the run ends failed
 *
 * Pass Criteria (fixture-section-limit.json, seventh run):
 * 13. A whole-section time limit that expires settles both one-Block lanes the
 *     same way, names them, skips the exit lane and ends the run failed
 *
 * Every case below fixture.json needs its own workflow: each decides the whole
 * session's outcome, so none can share a run with the others.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines, waitForLogText } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
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

test.describe('V-CONTROL-PARALLEL-FUNCTIONAL: Parallel end-to-end', () => {
  test('Wait for all, cross-branch coordination, first to finish, nesting, disabled, and a branch limit', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, loadFixture('fixture.json'))

    const statusVal = await runToTerminalStatus(page)
    await waitForLogText(page, 'exceeded its time limit')
    const logs = await getLogTexts(page)
    const lines = await getLogLines(page)
    const all = lines.join('\n')

    const occurrences = (marker: string) => logs.filter((t) => t.includes(marker)).length
    const indexOf = (marker: string) => logs.findIndex((t) => t.includes(marker))
    const assertPresent = (marker: string) =>
      expect(indexOf(marker) >= 0, `Expected "${marker}" in the run log.\n${all}`).toBeTruthy()
    const assertAbsent = (marker: string) =>
      expect(indexOf(marker) >= 0, `"${marker}" must NOT be in the run log.\n${all}`).toBeFalsy()
    const assertBefore = (first: string, second: string) =>
      expect(
        indexOf(first) >= 0 && indexOf(first) < indexOf(second),
        `Expected "${first}" before "${second}".\n${all}`,
      ).toBeTruthy()

    const sessionId = await getActiveSessionId(page)
    const vars = await getSessionVariables(page, sessionId)
    const varDump = JSON.stringify(vars)

    await test.step('The run entered the chain and ended on the capped section', () => {
      assertPresent('par-before')
      expect(statusVal, `An expired branch limit must fail the run.\n${all}`).toBe('failed')
    })

    await test.step('P1: both branches write, and both writes survive the join', async () => {
      assertPresent('p1-a')
      assertPresent('p1-b')
      // The exit lane composes what the two branches wrote, so a fork-time copy
      // or a join-time merge would leave it short.
      expect(vars.p1_seen?.value, `the join must see both writes. ${varDump}`).toBe('AB')
      expect(occurrences('p1-then'), `the exit lane runs once.\n${all}`).toBe(1)
      await expect(node(page, 'par-1')).toHaveAttribute('data-execution-status', 'success')
    })

    await test.step('P2: a Watch-mode wait is satisfied by a sibling branch', () => {
      expect(vars.p2_passed?.value, `the wait must complete. ${varDump}`).toBe(true)
      expect(
        Number(vars.p2_elapsed?.value),
        `the wait must outlast the sibling's 400 ms of work. ${varDump}`,
      ).toBeGreaterThanOrEqual(400)
      expect(vars.gate?.value, `the sibling's write is the live value. ${varDump}`).toBe('open')
      assertPresent('p2-opened')
      assertPresent('p2-waited')
      assertPresent('p2-then')
    })

    await test.step('P3: first to finish releases the join and stops the loser', async () => {
      assertPresent('p3-fast')
      assertAbsent('p3-slow')
      assertPresent('p3-then')
      await expect(node(page, 'delay-p3')).toHaveAttribute('data-execution-status', 'stopped')
      await expect(node(page, 'log-p3-slow')).toHaveAttribute('data-execution-status', 'skipped')
      expect(
        lines.some((l) => l.startsWith('[WARN]') && l.includes("Branch 'slow' stopped")),
        `The loser's stop must name its branch.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('P5: the inner join releases before the outer branch continues', () => {
      assertPresent('p5-i1')
      assertPresent('p5-i2')
      assertBefore('p5-i1', 'p5-inner-then')
      assertBefore('p5-i2', 'p5-inner-then')
      assertBefore('p5-inner-then', 'p5-outer-after')
      assertBefore('p5-outer-after', 'p5-then')
      expect(occurrences('p5-inner-then'), `the inner exit runs once.\n${all}`).toBe(1)
    })

    await test.step('P6: a disabled section skips its bodies and leaves through the exit', async () => {
      assertAbsent('p6-a')
      assertAbsent('p6-b')
      assertPresent('p6-then')
      await expect(node(page, 'par-5')).toHaveAttribute('data-disabled', 'true')
      // Under a disabled container the branch chains render muted (unreachable),
      // which is the same treatment a disabled Switch gives its cases: no
      // execution status at all. Only the exit lane carries one.
      await expect(node(page, 'log-p6-a')).not.toHaveAttribute('data-execution-status', /.*/)
      await expect(node(page, 'log-p6-b')).not.toHaveAttribute('data-execution-status', /.*/)
      await expect(node(page, 'log-p6-then')).toHaveAttribute('data-execution-status', 'success')
    })

    await test.step('P4: an expired branch limit ends the section and the run', async () => {
      expect(
        lines.some(
          (l) =>
            l.startsWith('[ERROR]') &&
            l.includes("Branch 'capped' exceeded its time limit of 200 ms"),
        ),
        `The expiry must name the branch and its limit.\n${all}`,
      ).toBeTruthy()
      expect(
        lines.some((l) => l.startsWith('[WARN]') && l.includes("Branch 'sibling' stopped")),
        `The sibling's stop must name its branch.\n${all}`,
      ).toBeTruthy()
      assertAbsent('p4-a')
      assertAbsent('p4-b')
      // The exit lane never runs, so nothing behind the section does either.
      assertAbsent('p4-then')
      assertAbsent('par-after')

      await expect(node(page, 'par-6')).toHaveAttribute('data-execution-status', 'failed')
      await expect(node(page, 'delay-p4a')).toHaveAttribute('data-execution-status', 'stopped')
      await expect(node(page, 'delay-p4b')).toHaveAttribute('data-execution-status', 'stopped')
      await expect(node(page, 'log-p4-a')).toHaveAttribute('data-execution-status', 'skipped')
      await expect(node(page, 'log-p4-b')).toHaveAttribute('data-execution-status', 'skipped')
    })

    await test.step('The sections ran in chain order', () => {
      const order = ['par-before', 'p1-then', 'p2-then', 'p3-then', 'p5-then', 'p6-then']
      for (let i = 1; i < order.length; i++) {
        assertBefore(order[i - 1], order[i])
      }
    })
  })

  test('A failing split Assert in a branch keeps the flow going and fails the run', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, loadFixture('fixture-assert-scope.json'))

    const statusVal = await runToTerminalStatus(page)
    await waitForLogText(page, 'as-after')
    const logs = await getLogTexts(page)
    const all = (await getLogLines(page)).join('\n')
    const present = (marker: string) => logs.some((t) => t.includes(marker))

    await test.step('The branch carries on down its failing Assert fail branch', async () => {
      expect(present('as-tail'), `The branch must continue past the Assert.\n${all}`).toBeTruthy()
      expect(present('as-sibling'), `The sibling branch must run.\n${all}`).toBeTruthy()
      await expect(node(page, 'assert-fail')).toHaveAttribute('data-execution-status', 'failed')
    })

    await test.step('The exit lane still runs, and so does the block behind it', () => {
      expect(
        logs.filter((t) => t.includes('as-then')).length,
        `The exit lane runs once.\n${all}`,
      ).toBe(1)
      expect(present('as-after'), `The flow continues past the section.\n${all}`).toBeTruthy()
    })

    await test.step('The run ends failed', () => {
      expect(statusVal, `A scope-failing Assert fails the run.\n${all}`).toBe('failed')
    })
  })

  test('A Halt in a branch ends the section and carries its declared status', async ({ page }) => {
    await importValidateAndNavigate(page, loadFixture('fixture-halt.json'))

    const statusVal = await runToTerminalStatus(page)
    await waitForLogText(page, 'halted with status')
    const logs = await getLogTexts(page)
    const lines = await getLogLines(page)
    const all = lines.join('\n')
    const present = (marker: string) => logs.some((t) => t.includes(marker))

    await test.step('The Halt fires with the scope it declared', () => {
      expect(present('hl-start'), `The run reached the section.\n${all}`).toBeTruthy()
      expect(
        logs.some((t) => t.includes('Halt (test): halt in a branch')),
        `The Halt must announce its scope.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('The sibling stops where it stood and the exit lane is skipped', async () => {
      await expect(node(page, 'delay-hl')).toHaveAttribute('data-execution-status', 'stopped')
      await expect(node(page, 'log-hl-b')).toHaveAttribute('data-execution-status', 'skipped')
      expect(present('hl-sibling'), `The sibling's tail must never run.\n${all}`).toBeFalsy()
      expect(present('hl-then'), `The exit lane must never run.\n${all}`).toBeFalsy()
      expect(present('hl-after'), `Nothing behind the section may run.\n${all}`).toBeFalsy()
      expect(
        lines.some((l) => l.startsWith('[WARN]') && l.includes("Branch 'worker' stopped")),
        `The sibling's stop must name its branch.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('The session ends with the status the Halt declared', () => {
      // A branch failure or a bare stop would end the run failed; only the
      // declared status reaching the session can make a cut-short run pass.
      expect(statusVal, `The Halt declared status passed.\n${all}`).toBe('passed')
      expect(
        logs.some((t) => t.includes('halted with status: passed')),
        `The terminal line must carry the declared status.\n${all}`,
      ).toBeTruthy()
    })
  })

  test('A failing lane with nothing wired after the section fails the run', async ({ page }) => {
    await importValidateAndNavigate(page, loadFixture('fixture-no-exit.json'))

    const statusVal = await runToTerminalStatus(page)
    await waitForLogText(page, 'halted with status')
    const logs = await getLogTexts(page)
    const all = (await getLogLines(page)).join('\n')
    const present = (marker: string) => logs.some((t) => t.includes(marker))

    await test.step('The run reached the section and the lane really failed', async () => {
      expect(present('ne-before'), `The run must reach the section.\n${all}`).toBeTruthy()
      await expect(node(page, 'log-ne-boom')).toHaveAttribute('data-execution-status', 'failed')
    })

    await test.step('The verdict belongs to the section, not to what is wired after it', async () => {
      expect(
        statusVal,
        `A failing lane must fail the run even with no exit wired.\n${all}`,
      ).toBe('failed')
      expect(
        present('completed successfully'),
        `The run must not report a clean pass.\n${all}`,
      ).toBeFalsy()
      expect(
        present('halted with status: failed'),
        `The terminal line must carry the failure.\n${all}`,
      ).toBeTruthy()
      await expect(node(page, 'par-ne')).toHaveAttribute('data-execution-status', 'failed')
    })
  })

  test('A passing section with no exit still passes, and a race loser stops', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, loadFixture('fixture-race-no-exit.json'))

    const statusVal = await runToTerminalStatus(page)
    await waitForLogText(page, 'completed successfully')
    const logs = await getLogTexts(page)
    const lines = await getLogLines(page)
    const all = lines.join('\n')
    const present = (marker: string) => logs.some((t) => t.includes(marker))

    await test.step('Nothing wired after a healthy section still reads as a pass', () => {
      expect(statusVal, `A healthy section must still pass.\n${all}`).toBe('passed')
      expect(
        present('completed successfully'),
        `The run must report the clean pass.\n${all}`,
      ).toBeTruthy()
      expect(present('rn-fast'), `The winning lane must run.\n${all}`).toBeTruthy()
    })

    await test.step('The losing one-Block lane is left stopped, not running', async () => {
      await expect(node(page, 'delay-rn-slow')).toHaveAttribute(
        'data-execution-status',
        'stopped',
      )
      expect(
        lines.some((l) => l.startsWith('[WARN]') && l.includes("Branch 'slow' stopped")),
        `The loser's stop must name its branch.\n${all}`,
      ).toBeTruthy()
      await expect(node(page, 'delay-rn-fast')).toHaveAttribute(
        'data-execution-status',
        'success',
      )
      await expect(node(page, 'log-rn-fast')).toHaveAttribute('data-execution-status', 'success')
      await expect(
        page.locator('[data-testid^="workflow-node-"][data-execution-status="running"]'),
        `No Block may be left running after the run ends.\n${all}`,
      ).toHaveCount(0)
    })
  })

  test('Sibling lanes still in flight settle stopped and the exit lane is skipped', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, loadFixture('fixture-stopped-lanes.json'))

    const statusVal = await runToTerminalStatus(page)
    await waitForLogText(page, 'halted with status')
    const logs = await getLogTexts(page)
    const lines = await getLogLines(page)
    const all = lines.join('\n')
    const present = (marker: string) => logs.some((t) => t.includes(marker))

    await test.step('The lane that finished keeps its own result', async () => {
      expect(present('sl-quick'), `The quick lane must run.\n${all}`).toBeTruthy()
      await expect(node(page, 'log-sl-quick')).toHaveAttribute(
        'data-execution-status',
        'success',
      )
      await expect(node(page, 'log-sl-boom')).toHaveAttribute('data-execution-status', 'failed')
    })

    await test.step('Each abandoned one-Block lane reads stopped and is named', async () => {
      await expect(node(page, 'delay-sl-adrift')).toHaveAttribute(
        'data-execution-status',
        'stopped',
      )
      await expect(node(page, 'delay-sl-marooned')).toHaveAttribute(
        'data-execution-status',
        'stopped',
      )
      for (const branch of ['adrift', 'marooned']) {
        expect(
          lines.some((l) => l.startsWith('[WARN]') && l.includes(`Branch '${branch}' stopped`)),
          `The run log must name the stopped lane "${branch}".\n${all}`,
        ).toBeTruthy()
      }
      await expect(
        page.locator('[data-testid^="workflow-node-"][data-execution-status="running"]'),
        `No Block may be left running after the run ends.\n${all}`,
      ).toHaveCount(0)
    })

    await test.step('With an exit wired the section behaves exactly as before', async () => {
      // The skipped exit lane paints skipped live, as the history spec reads it stored.
      await expect(node(page, 'log-sl-then')).toHaveAttribute('data-execution-status', 'skipped')
      expect(present('sl-then'), `The exit lane must not run.\n${all}`).toBeFalsy()
      expect(present('sl-after'), `Nothing behind the section may run.\n${all}`).toBeFalsy()
      expect(statusVal, `A failing lane must fail the run.\n${all}`).toBe('failed')
      expect(
        present('completed successfully'),
        `The run must not report a clean pass.\n${all}`,
      ).toBeFalsy()
    })
  })

  test('An expired section limit settles every lane it cut short', async ({ page }) => {
    await importValidateAndNavigate(page, loadFixture('fixture-section-limit.json'))

    const statusVal = await runToTerminalStatus(page)
    await waitForLogText(page, 'halted with status')
    const logs = await getLogTexts(page)
    const lines = await getLogLines(page)
    const all = lines.join('\n')
    const present = (marker: string) => logs.some((t) => t.includes(marker))

    await test.step('The expiry is reported against the whole section', () => {
      expect(
        lines.some(
          (l) =>
            l.startsWith('[ERROR]') &&
            l.includes('Parallel section exceeded its time limit of 500 ms'),
        ),
        `The expiry must name the section limit.\n${all}`,
      ).toBeTruthy()
      expect(statusVal, `An expired section limit must fail the run.\n${all}`).toBe('failed')
      expect(
        present('completed successfully'),
        `The run must not report a clean pass.\n${all}`,
      ).toBeFalsy()
    })

    await test.step('Both one-Block lanes read stopped and are named', async () => {
      await expect(node(page, 'delay-tl-north')).toHaveAttribute(
        'data-execution-status',
        'stopped',
      )
      await expect(node(page, 'delay-tl-south')).toHaveAttribute(
        'data-execution-status',
        'stopped',
      )
      for (const branch of ['north', 'south']) {
        expect(
          lines.some((l) => l.startsWith('[WARN]') && l.includes(`Branch '${branch}' stopped`)),
          `The run log must name the stopped lane "${branch}".\n${all}`,
        ).toBeTruthy()
      }
      await expect(
        page.locator('[data-testid^="workflow-node-"][data-execution-status="running"]'),
        `No Block may be left running after the run ends.\n${all}`,
      ).toHaveCount(0)
    })

    await test.step('The exit lane never runs', async () => {
      await expect(node(page, 'log-tl-then')).toHaveAttribute('data-execution-status', 'skipped')
      expect(present('tl-then'), `The exit lane must not run.\n${all}`).toBeFalsy()
    })
  })
})
