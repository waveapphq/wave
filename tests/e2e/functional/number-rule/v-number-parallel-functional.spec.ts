/**
 * V-NUMBER-PARALLEL: a Parallel branch Time limit is typed, saved and run by the one number rule
 * Wireframe: N/A (the BRANCHES section keeps its look)
 * Design Decisions: PARALLEL-3, PARALLEL-5
 * REQ: REQ-3.1.3.14
 *
 * `fixture-parallel.json` runs two five-second Delays in the branches `capped` and `sibling`; the spec gives
 * `capped` its Time limit in the Parallel sheet.
 *
 * Pass Criteria:
 * 1. The `capped` Time limit box refuses letters; 19 digits typed stay as all 19 digits (never `1e+21`) and a
 *    20th digit is dropped.
 * 2. The box refuses a minus key (`-5` leaves `5`); while it shows `0` the sheet's Save is held; with `060` it is not.
 * 3. `060` is saved as typed (the stored branch holds `time_limit` `060`) and the reopened box shows `060`.
 * 4. The run stops `capped` at 60 ms: the console holds the ERROR `Branch 'capped' exceeded its time limit of
 *    60 ms`, both Delays end stopped, the exit lane never runs and the Parallel Block fails.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { expectNodeStatus, finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import { getLogEntries } from '../../helpers/log-reader'
import { expectTypedAs, typeAtEnd, typeKeys } from '../../helpers/number-entry'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import { persistedValues } from '../file-picker/picker'

const PARALLEL = 'e5a9cca8-32da-457f-a456-9b5437543b08'
const CAPPED_DELAY = '008a8d3b-9638-420c-b000-75b62abd92dd'
const SIBLING_DELAY = '0ef92ac9-1234-4ee5-8667-62939fbcbf8d'
const THEN_LOG = '6ecb3af6-2c7a-4392-ab6b-259d5873fffd'
const NINETEEN = '1234567890123456789'
const EXPIRY = "Branch 'capped' exceeded its time limit of 60 ms"

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-parallel.json'), 'utf-8'))
}

const limitBox = (sheet: Locator): Locator => sheet.locator('[data-testid="parallel-branch-limit-branch_1"]')
const sheetSave = (sheet: Locator): Locator => sheet.getByRole('button', { name: 'Save', exact: true })

test.describe('V-NUMBER-PARALLEL: a branch Time limit by the one number rule', () => {
  test('the Time limit box keeps digits only, holds Save on 0, saves 060 as typed and the run stops the branch at 60 ms', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const testId = await importValidateAndNavigate(page, loadFixture())
    try {
      await test.step('1-2. letters and a minus never enter, 19 digits stay whole, 0 holds Save', async () => {
        const sheet = await openBlockSheet(page, PARALLEL)
        const box = limitBox(sheet)
        await expect(box).toHaveValue('')
        await expectTypedAs(box, 'abc', '')
        await expectTypedAs(box, NINETEEN, NINETEEN)
        await typeAtEnd(box, '0')
        await expect(box, 'a 20th digit is dropped').toHaveValue(NINETEEN)
        await expectTypedAs(box, '-5', '5')
        await typeKeys(box, '0')
        await expect(box).toHaveValue('0')
        await expect(sheetSave(sheet), 'the section is held while the box shows 0').toBeDisabled()
        await typeKeys(box, '060')
        await expect(box).toHaveValue('060')
        await expect(sheetSave(sheet)).toBeEnabled()
        await saveBlockSheet(sheet)
      })

      await test.step('3. 060 is stored as typed and reopens as typed', async () => {
        await saveTest(page)
        const branches = (await persistedValues(request, testId))[PARALLEL].branches as Array<Record<string, unknown>>
        expect(branches.find((branch) => branch.name === 'capped')?.time_limit).toBe('060')
        const sheet = await openBlockSheet(page, PARALLEL)
        await expect(limitBox(sheet)).toHaveValue('060')
        await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
        await expect(sheet).toHaveCount(0)
      })

      await test.step('4. the run stops the capped branch at 60 ms', async () => {
        const status = await startRun(page)
        const { verdict } = await finishRunAnyVerdict(page, status, 'parallel-before')
        await expect
          .poll(async () => (await getLogEntries(page)).filter((entry) => entry.level === 'ERROR').map((entry) => entry.message), {
            message: 'the console names the expired branch and its limit',
          })
          .toContainEqual(expect.stringContaining(EXPIRY))
        await expectNodeStatus(page, CAPPED_DELAY, 'stopped')
        await expectNodeStatus(page, SIBLING_DELAY, 'stopped')
        await expectNodeStatus(page, PARALLEL, 'failed')
        await expect(page.locator(`[data-testid="workflow-node-${THEN_LOG}"]`)).not.toHaveAttribute(
          'data-execution-status',
          'success',
        )
        expect(verdict).toBe('failed')
      })
    } finally {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })
})
