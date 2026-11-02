/**
 * V-NUMBER-OPENSEARCH: the OpenSearch Percentile Percent and the time picker Amount keep the one number rule
 * Wireframe: N/A (the Stats popover and the time picker keep their look)
 * Design Decisions: OS-4, OS-7, OS-8, FIELD-9
 * REQ: REQ-3.1.3.14, REQ-3.3.3.2
 *
 * `fixture-opensearch.json` aggregates the run's own F-METRICS index over the fixed window 2026-09-25T10:00:00Z
 * to 10:04:59Z for the whole window: Count and a Percentile of `latency_ms` whose Percent the spec types in
 * the sheet. The index is created for the run and deleted afterwards.
 *
 * Pass Criteria:
 * 1. The From time picker's Relative Amount refuses a minus, a dot and letters (`-1.5x` leaves `15`).
 * 2. A Percent typed `99.90` shows `percentile 99.9 of latency_ms` on the popover's column line and
 *    `99.9th percentile of latency_ms` on the entry's trigger.
 * 3. Saved, the Block holds the Percent as typed (`99.90`) and the reopened popover shows `99.90`.
 * 4. The run passes and its Results table has the column `percentile 99.9 of latency_ms` holding a number.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, CA_CERT_PEM, OPENSEARCH_PASSWORD } from '../../helpers/config'
import {
  closeTimePicker,
  closeValueEditor,
  openListEditor,
  openStatEntry,
  pickTimeTab,
  saveListEditor,
  statColumnLine,
  statTrigger,
} from '../../helpers/config-sheet'
import { getActiveSessionId, getSessionVariables, importValidateAndNavigate, sessionTable } from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { discardBlockSheet, expectTypedAs } from '../../helpers/number-entry'
import {
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  F_METRICS,
  MAP_METRICS,
  openSearchIndexName,
  seedOpenSearch,
} from '../../helpers/opensearch-stack'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import { persistedValues } from '../file-picker/picker'
import { newToken, withToken } from '../shell-blocks/shell-helpers'

const OS_NODE = '220998ff-4a1e-4bd8-98af-e30ec56b31c6'
const COLUMN = 'percentile 99.9 of latency_ms'
const WORDS = '99.9th percentile of latency_ms'

let token = ''

function loadFixture(): Record<string, any> {
  const fixture = withToken(
    JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-opensearch.json'), 'utf-8')),
    token,
  ) as Record<string, any>
  const values = fixture.workflow.nodes.find((node: { id: string }) => node.id === OS_NODE).data.config.values
  values.password = OPENSEARCH_PASSWORD
  values.ca_cert = CA_CERT_PEM
  return fixture
}

const percentBox = (popover: Locator): Locator => popover.locator('[data-testid="stat-percent"]')

async function closePopover(page: Page, popover: Locator): Promise<void> {
  if (await popover.isVisible()) await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
}

test.describe('V-NUMBER-OPENSEARCH: the Percentile Percent and the time picker Amount', () => {
  test.beforeAll(async () => {
    token = newToken()
    const index = openSearchIndexName(token, 'metrics')
    await createOpenSearchIndex(index, MAP_METRICS)
    await seedOpenSearch(index, F_METRICS)
  })

  test.afterAll(async () => {
    if (token) await deleteOpenSearchIndexes(token)
  })

  test('99.90 names its column 99.9, reopens as typed and runs; the Amount box drops refused keys', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const testId = await importValidateAndNavigate(page, loadFixture(), { injectHttp: true })
    try {
      await test.step('1. the Relative Amount refuses a minus, a dot and letters', async () => {
        const sheet = await openBlockSheet(page, OS_NODE)
        const popover = await pickTimeTab(page, sheet, 'from', 'Relative')
        const amount = popover.getByRole('textbox', { name: 'Amount', exact: true })
        await expectTypedAs(amount, '-1.5x', '15')
        await closeTimePicker(page, popover)
        await discardBlockSheet(page, sheet)
      })

      await test.step('2. 99.90 reads 99.9 on the column line and on the trigger', async () => {
        const sheet = await openBlockSheet(page, OS_NODE)
        const stats = await openListEditor(page, sheet, 'stats')
        const popover = await openStatEntry(page, stats, 1)
        await expect(percentBox(popover)).toHaveValue('95')
        await expectTypedAs(percentBox(popover), '99.90', '99.90')
        await expect(statColumnLine(popover)).toHaveText(COLUMN)
        await closePopover(page, popover)
        await expect(statTrigger(stats, 1)).toHaveText(WORDS)
        await saveListEditor(stats)
        await saveBlockSheet(sheet)
      })

      await test.step('3. the Percent is saved and reopens as typed', async () => {
        await saveTest(page)
        const stats = (await persistedValues(request, testId))[OS_NODE].stats as Array<{ value: Record<string, unknown> }>
        expect(stats[1].value).toEqual({ stat: 'percentile', field: 'latency_ms', percent: '99.90' })
        const sheet = await openBlockSheet(page, OS_NODE)
        const editor = await openListEditor(page, sheet, 'stats')
        await expect(statTrigger(editor, 1)).toHaveText(WORDS)
        const popover = await openStatEntry(page, editor, 1)
        await expect(percentBox(popover)).toHaveValue('99.90')
        await closePopover(page, popover)
        await closeValueEditor(page, editor)
        await discardBlockSheet(page, sheet)
      })

      await test.step('4. the Results column carries the same name', async () => {
        const status = await startRun(page)
        await finishRun(page, status, 'opensearch-done')
        const rows = sessionTable(await getSessionVariables(page, await getActiveSessionId(page)), 'os_rows')
        expect(rows.columns.map((column) => column.name)).toEqual(['count', COLUMN])
        expect(rows.rows).toHaveLength(1)
        expect(String(rows.rows[0][1])).toMatch(/^\d+(\.\d+)?$/)
      })
    } finally {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })
})
