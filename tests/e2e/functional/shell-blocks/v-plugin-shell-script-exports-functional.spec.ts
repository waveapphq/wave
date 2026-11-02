/**
 * SH-4, SH-5: Shell Script variable exports
 * Design Decisions: SHRUN-6, SHRUN-7, SHRUN-8, SHRUN-9
 * REQ: REQ-3.4.1.1, REQ-3.1.3.5
 *
 * Pass Criteria (SH-4, typed exports and a secret one):
 * 1. The export table lists six rows under the columns Script Variable, Type, Secret and
 *    WAVE Variable. Every row has a Type select: the five bound rows are disabled and read
 *    Integer, Boolean, Array, Map and String; the unbound SPARE row is enabled and reads
 *    String. No row shows "from variable", and only TOKEN's Secret box is ticked.
 * 2. After the run COUNT binds the number 7, OK binds true, LIST binds ["a", "b c", ""],
 *    M binds {k1: "v1", k2: "v 2"}, and the secret TOKEN reads the mask.
 * 3. The TOKEN value is on no console text, no WS event and no session variable.
 * 4. The DEBUG Outputs echo shows TOKEN masked.
 * 5. SPARE is read and discarded: no session variable is named SPARE, and no WS event
 *    (the DEBUG Outputs echo included) carries its value.
 *
 * Pass Criteria (SH-5, an export never set and an exit hook that never ran):
 * 1. The set export binds 1, the never-set export keeps "keep-a", and the block passes:
 *    Success true, Reason and Error empty.
 * 2. Exactly one DEBUG message reads that the never-set export kept its value.
 * 3. That block paints success, and the removed failure message for an unset export is
 *    on no console entry.
 * 4. The block that hands its process to another program binds nothing from its exports
 *    (the bound variable keeps 9), Success true and Exit Code 0.
 * 5. Exactly one WARN console entry says the exports were not read because the script
 *    replaced WAVE's exit handler, and the block paints the amber warning state, not failed.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogEntries } from '../../helpers/log-reader'
import { openSessionEventCollector, type WsEvent } from '../../helpers/ws-events'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { closeConfig, deleteTest, openConfig } from '../file-picker/picker'
import { newToken, withToken } from './shell-helpers'

const NEVER_SET = "Variable export 'NEVER' was never set; the bound variable keeps its value"
const REMOVED_UNSET_FAILURE = "Script variable 'NEVER' was not set by the script"
const HOOK_NEVER_RAN = "Variable exports were not read: the script replaced WAVE's exit handler"

const createdTests: string[] = []

function loadFixture(file: string, token: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
  return withToken(raw as Record<string, unknown>, token)
}

function debugMessages(events: Array<Record<string, unknown>>): string[] {
  return events
    .map((event) => event.message)
    .filter((message): message is string => typeof message === 'string')
}

/** Distinct WS log entries (by entry id) at `level` whose message is exactly `text`. */
function logEventsReading(events: WsEvent[], level: string, text: string): string[] {
  const ids = events
    .filter((event) => event.level === level && event.message === text)
    .map((event) => String(event.id))
  return [...new Set(ids)]
}

/** Start the run, then subscribe while the leading Delay holds it. */
async function runWithCollector(page: Page, bookend: string) {
  const status = await startRun(page)
  const sid = await getActiveSessionId(page)
  const collector = await openSessionEventCollector(page, sid, [`log:${sid}`, `variable:${sid}`])
  await finishRun(page, status, bookend, 90_000)
  const events = await collector.harvest()
  await collector.close()
  return { sid, events }
}

type ExportRow = { name: string; type: string; binding: string; secret: boolean }

const TYPED_ROWS: ExportRow[] = [
  { name: 'COUNT', type: 'Integer', binding: 'count_v', secret: false },
  { name: 'OK', type: 'Boolean', binding: 'ok_v', secret: false },
  { name: 'LIST', type: 'Array', binding: 'list_v', secret: false },
  { name: 'M', type: 'Map', binding: 'map_v', secret: false },
  { name: 'TOKEN', type: 'String', binding: 'token_v', secret: true },
  { name: 'SPARE', type: 'String', binding: '', secret: false },
]

test.describe('SH-4, SH-5: Shell Script variable exports', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('SH-4: typed exports bind as their variable types, a secret export masks, an unbound export is discarded', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const secret = `shsec-tok-${token}`
    const spare = `spare-${token}`
    const testId = await importValidateAndNavigate(page, loadFixture('fixture-typed.json', token))
    createdTests.push(testId)

    await test.step('the export table: six rows, a Type select on each, TOKEN marked secret', async () => {
      const dialog = await openConfig(page, 'sh-typed')
      const table = dialog.locator('table:has([data-testid="output-list-name-0"])')
      await expect(table.locator('thead th')).toHaveText([
        '',
        'Script Variable',
        'Type',
        'Secret',
        'WAVE Variable',
      ])
      for (const [i, row] of TYPED_ROWS.entries()) {
        await expect(dialog.getByTestId(`output-list-name-${i}`)).toHaveValue(row.name)
        const type = dialog.getByTestId(`output-list-type-${i}`)
        await expect(type, `${row.name} Type`).toHaveText(row.type)
        if (row.binding === '') {
          await expect(type, `${row.name} is unbound, so its Type is a free select`).toBeEnabled()
        } else {
          await expect(type, `${row.name} is bound, so its Type is locked`).toBeDisabled()
        }
        await expect(
          dialog.getByTestId(`output-list-binding-${i}`).locator('[role="combobox"]').first(),
        ).toHaveValue(row.binding)
        const secretBox = dialog.getByTestId(`output-list-secret-${i}`)
        if (row.secret) await expect(secretBox).toBeChecked()
        else await expect(secretBox).not.toBeChecked()
      }
      await expect(dialog.getByTestId(`output-list-name-${TYPED_ROWS.length}`)).toHaveCount(0)
      await expect(table).not.toContainText('from variable')
      await closeConfig(dialog)
    })

    const { sid, events } = await runWithCollector(page, `SH-4-done-${token}`)
    const variables = await getSessionVariables(page, sid)

    await test.step('the exports bind as the bound variables types', async () => {
      expect(variables.count_v.value, 'COUNT binds a number, not text').toBe(7)
      expect(variables.ok_v.value).toBe(true)
      expect(variables.list_v.value).toEqual(['a', 'b c', ''])
      expect(variables.map_v.value).toEqual({ k1: 'v1', k2: 'v 2' })
      expect(variables.token_v.value, 'the secret TOKEN export reads the mask').toBe(SECRET_MASK)
    })

    await test.step('the TOKEN value leaks nowhere, and the Outputs echo masks it', async () => {
      const consoleTexts = (await getLogEntries(page)).map((entry) => entry.message).join('\n')
      expectNoSecret(consoleTexts, 'console', [secret])
      expectNoSecret(JSON.stringify(events), 'WS events', [secret])
      expectNoSecret(JSON.stringify(variables), 'session variables', [secret])
      const messages = debugMessages(events)
      const echo = messages.find((m) => m.startsWith('Outputs:') && m.includes('COUNT'))
      expect(echo, `no DEBUG Outputs echo for the block. Got:\n${messages.join('\n')}`).toBeTruthy()
      expect(echo!).toContain(`"TOKEN":"${SECRET_MASK}"`)
    })

    await test.step('the unbound SPARE export is read and discarded', async () => {
      expect(Object.keys(variables)).not.toContain('SPARE')
      const messages = debugMessages(events)
      expect(messages.filter((m) => m.includes(spare))).toEqual([])
      expect(JSON.stringify(events), 'no WS event carries the SPARE value').not.toContain(spare)
    })
  })

  test('SH-5: an export the script never set keeps its variable, and a replaced exit hook turns the block amber', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const testId = await importValidateAndNavigate(page, loadFixture('fixture-unset.json', token))
    createdTests.push(testId)

    const { sid, events } = await runWithCollector(page, `SH-5-done-${token}`)
    const variables = await getSessionVariables(page, sid)
    const entries = await getLogEntries(page)

    await test.step('an export never set is not a failure', async () => {
      expect(variables.a_one.value).toBe(1)
      expect(variables.a_never.value, 'the never-set export keeps the variable value').toBe('keep-a')
      expect(variables.a_ok.value).toBe(true)
      expect(variables.a_reason.value).toBe('')
      expect(variables.a_err.value).toBe('')
      expect(
        logEventsReading(events, 'DEBUG', NEVER_SET),
        `exactly one DEBUG line for NEVER. Got:\n${debugMessages(events).join('\n')}`,
      ).toHaveLength(1)
      await expectNodeStatus(page, 'sh-unset', 'success')
      expect(entries.filter((entry) => entry.message === REMOVED_UNSET_FAILURE)).toEqual([])
    })

    await test.step('a script that hands its process on leaves the exports unread, amber', async () => {
      expect(variables.b_two.value, 'the bound variable keeps its value').toBe(9)
      expect(variables.b_ok.value).toBe(true)
      expect(variables.b_code.value).toBe(0)
      const warns = entries.filter(
        (entry) => entry.level === 'WARN' && entry.message === HOOK_NEVER_RAN,
      )
      expect(warns, `WARN lines:\n${JSON.stringify(entries, null, 2)}`).toHaveLength(1)
      await expectNodeStatus(page, 'sh-hook-gone', 'warning')
    })
  })
})
