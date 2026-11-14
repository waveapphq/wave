/**
 * V-CTRL-FIELDS-PARALLEL: a lane time limit in {x} moves with its lane, and JOIN MODE is stored as picked
 * Design Decisions: PARALLEL-3, PARALLEL-5
 * REQ: REQ-3.1.1.3, REQ-3.2.3.6, REQ-3.2.3.7
 *
 * `fixture-parallel.json` runs the lanes `capped` and `probe`, each a five-second Delay with no limit, and
 * declares `probe_ms` = 60. One lane is limited per run, so exactly one lane stops.
 *
 * Pass Criteria:
 * 1. The Parallel window opens 880 px wide; every lane box is named `Time Limit` and its {x}
 *    `Time Limit expression mode`, and the lane {x} is pressed by that name.
 * 2. {x} on lane `probe` with `probe_ms` stores `branches.1.time_limit` in `expressionFields` and `probe_ms` as
 *    that lane's limit; the run logs exactly one lane limit ERROR, `Branch 'probe' exceeded its time limit of
 *    60 ms`, the Parallel Block ends `failed` and the verdict is `failed`.
 * 3. Moving `probe` up moves its flag to `branches.0.time_limit` and its limit with it; the next run again logs
 *    exactly one lane limit ERROR, for `probe`, the Parallel Block ends `failed` and the verdict is `failed`.
 * 4. JOIN MODE picks write `values.join`: `First to finish` stores `first`, then `Wait for all` stores `all`;
 *    the lanes and their flag stay as stored.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { openTest, validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { formatEntries } from '../../helpers/log-reader'
import { typeExpression } from '../../helpers/default-rule'
import { switchWarning } from '../../helpers/value-field'
import {
  configSheet,
  openBlockSheet,
  runToEnd,
  saveBlockSheet,
  saveTest,
  selectEnvironment,
} from '../../helpers/workbench'
import { deleteStoredTest, loadFixture, nodeOf, storedWorkflow } from './stored-blocks'

const PARALLEL = '839b31d4-d5c8-43e5-b0e1-180c0d62709e'
const CAPPED_DELAY = '3e806b0f-6665-47c2-b693-96b327d2d424'
const PROBE_DELAY = '5e9a0bcf-f983-4fb5-8159-e60dfc8ae399'
const THEN_LOG = '47293592-cd11-411a-87b8-f9bccc1494c1'
const CAPPED = 'branch_1'
const PROBE = 'branch_2'
const WINDOW_WIDTH = 880
const LANE_BOX_NAME = 'Time Limit'
const LANE_TOGGLE_NAME = 'Time Limit expression mode'
const LANE_EXPIRY = /^Branch '.*' exceeded its time limit of /
const PROBE_EXPIRY = "Branch 'probe' exceeded its time limit of 60 ms"

const CAPPED_LANE = { id: CAPPED, name: 'capped' }
const PROBE_LANE = { id: PROBE, name: 'probe', time_limit: 'probe_ms' }

const laneHeader = (sheet: Locator, lane: string): Locator => sheet.getByTestId(`parallel-branch-header-${lane}`)
const laneToggle = (sheet: Locator, lane: string): Locator =>
  laneHeader(sheet, lane).getByRole('button', { name: LANE_TOGGLE_NAME, exact: true })
const laneCards = (sheet: Locator): Locator => sheet.locator('[data-testid^="parallel-branch-card-"]')

/** The stored Parallel's lanes and its {x} flags. */
async function storedLanes(
  request: APIRequestContext,
  testId: string,
): Promise<{ branches: unknown; flags: string[] | undefined; join: unknown }> {
  const data = nodeOf(await storedWorkflow(request, testId), PARALLEL).data
  return { branches: data.config.values.branches, flags: data.expressionFields, join: data.config.values.join }
}

async function expectStoredValid(request: APIRequestContext, testId: string): Promise<void> {
  const { errors } = await validateTest(request, testId)
  expect(errors, `the stored Test validates clean: ${JSON.stringify(errors)}`).toEqual([])
}

/** Run the open Test; exactly one lane limit ERROR, for `probe`, the Parallel Block fails and so does the run. */
async function expectOnlyProbeExpires(page: Page): Promise<void> {
  await selectEnvironment(page)
  const { verdict, entries } = await runToEnd(page)
  const expiries = entries.filter((e) => e.level === 'ERROR' && LANE_EXPIRY.test(e.message)).map((e) => e.message)
  expect(expiries, `exactly one lane limit ERROR, for probe.\n${formatEntries(entries)}`).toEqual([PROBE_EXPIRY])
  await expectNodeStatus(page, PARALLEL, 'failed')
  await expectNodeStatus(page, PROBE_DELAY, 'stopped')
  await expectNodeStatus(page, CAPPED_DELAY, 'stopped')
  await expect(page.getByTestId(`workflow-node-${THEN_LOG}`), 'the exit lane never runs').not.toHaveAttribute(
    'data-execution-status',
    'success',
  )
  expect(verdict, 'the run verdict').toBe('failed')
}

test.describe('V-CTRL-FIELDS-PARALLEL: lane time limits and join mode', () => {
  test('an {x} lane limit stops only its lane, moves with its lane, and JOIN MODE is stored as picked', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    const testId = await importValidateAndNavigate(page, loadFixture('fixture-parallel.json'), { rejectRepairs: true })
    try {
      await test.step('1. the window opens 880 px wide and names each lane box and its {x}', async () => {
        const sheet = await openBlockSheet(page, PARALLEL)
        await expect(sheet.getByTestId('parallel-branch-editor')).toBeVisible()
        const frame = await configSheet(page).boundingBox()
        expect(frame, 'the window has a box').not.toBeNull()
        expect(Math.round(frame!.width), 'the Parallel window width').toBe(WINDOW_WIDTH)
        await expect(sheet.getByRole('textbox', { name: LANE_BOX_NAME, exact: true })).toHaveCount(2)
        await expect(sheet.getByRole('button', { name: LANE_TOGGLE_NAME, exact: true })).toHaveCount(2)
        for (const lane of [CAPPED, PROBE]) {
          await expect(sheet.getByTestId(`param-input-parallel-branch-limit-${lane}`)).toHaveAccessibleName(LANE_BOX_NAME)
          await expect(laneToggle(sheet, lane)).toHaveAttribute('aria-pressed', 'false')
        }
      })

      await test.step('2. {x} on probe with probe_ms is stored with its flag and stops only probe', async () => {
        const sheet = configSheet(page)
        await laneToggle(sheet, PROBE).click()
        await expect(switchWarning(page), 'an empty lane box switches without a question').toHaveCount(0)
        await expect(laneToggle(sheet, PROBE)).toHaveAttribute('aria-pressed', 'true')
        await typeExpression(page, sheet, `parallel-branch-limit-${PROBE}`, 'probe_ms')
        await saveBlockSheet(sheet)
        await saveTest(page)

        const stored = await storedLanes(request, testId)
        expect(stored.flags, 'the stored {x} flags').toEqual(['branches.1.time_limit'])
        expect(stored.branches, 'the stored lanes').toEqual([CAPPED_LANE, PROBE_LANE])
        await expectStoredValid(request, testId)
        await expectOnlyProbeExpires(page)
      })

      await test.step('3. moving probe up moves its flag and its limit; the run again stops only probe', async () => {
        await openTest(page, testId)
        const sheet = await openBlockSheet(page, PARALLEL)
        await sheet.getByTestId(`parallel-branch-move-up-${PROBE}`).click()
        await expect(laneCards(sheet).first()).toHaveAttribute('data-testid', `parallel-branch-card-${PROBE}`)
        await expect(laneToggle(sheet, PROBE), 'the {x} state moves with the lane').toHaveAttribute('aria-pressed', 'true')
        await expect(laneToggle(sheet, CAPPED)).toHaveAttribute('aria-pressed', 'false')
        await saveBlockSheet(sheet)
        await saveTest(page)

        const stored = await storedLanes(request, testId)
        expect(stored.flags, 'the flag follows the lane').toEqual(['branches.0.time_limit'])
        expect(stored.branches, 'the limit follows the lane').toEqual([PROBE_LANE, CAPPED_LANE])
        await expectStoredValid(request, testId)
        await expectOnlyProbeExpires(page)
      })

      await test.step('4. JOIN MODE picks write values.join', async () => {
        await openTest(page, testId)
        let sheet = await openBlockSheet(page, PARALLEL)
        await expect(sheet.locator('#join-mode-all')).toHaveAttribute('data-state', 'checked')
        await sheet.locator('label[for="join-mode-first"]').click()
        await expect(sheet.locator('#join-mode-first')).toHaveAttribute('data-state', 'checked')
        await saveBlockSheet(sheet)
        await saveTest(page)
        expect((await storedLanes(request, testId)).join, 'First to finish is stored').toBe('first')

        sheet = await openBlockSheet(page, PARALLEL)
        await expect(sheet.locator('#join-mode-first')).toHaveAttribute('data-state', 'checked')
        await sheet.locator('label[for="join-mode-all"]').click()
        await expect(sheet.locator('#join-mode-all')).toHaveAttribute('data-state', 'checked')
        await saveBlockSheet(sheet)
        await saveTest(page)
        const stored = await storedLanes(request, testId)
        expect(stored.join, 'Wait for all is stored').toBe('all')
        expect(stored.branches, 'the lanes stay as stored').toEqual([PROBE_LANE, CAPPED_LANE])
        expect(stored.flags, 'the flag stays as stored').toEqual(['branches.0.time_limit'])
      })
    } finally {
      await deleteStoredTest(request, testId)
    }
  })
})
