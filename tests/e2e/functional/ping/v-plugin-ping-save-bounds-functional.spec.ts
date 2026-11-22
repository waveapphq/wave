/**
 * V-PLUGIN-PING-SAVE-BOUNDS-FUNCTIONAL: every save refuses a Ping whose Minimum replies is above Count
 * Wireframe: none (the existing validation dialog)
 * Design Decisions: PING-18, FIELDERR-1
 * REQ: REQ-3.4.2.2, REQ-3.4.1.9
 *
 * Seeds (API): the refused saves are sent inline; the canvas case stores its Test through the admin bulk
 * route, which a Test file edited by hand stands for; `fixture-save-bounds.json` imports through POST /tests.
 * Every Test and Function is named `zz-b29-` and deleted after.
 *
 * Pass Criteria:
 * 1. Saving through the backend API refuses a Ping with Pass when At least N replies, Count 4 and Minimum
 *    replies 5 with `SETTING_ABOVE_MAXIMUM` "Setting 'min_replies' of block 'ping' must be at most the value
 *    of setting 'count' (4), got 5": a Test save, a Local Function body inside a Test and a library Function
 *    save; an unset Count names its default 4.
 * 2. Canvas Save of the same Ping opens the "Cannot Save Test" dialog with that exact text.
 * 3. After a reload nothing was stored: the edit the canvas Save carried is not in the stored Test.
 * 4. The saves accept what the ceiling leaves alone: Minimum replies equal to Count, a Minimum replies
 *    the Pass when rule does not use, an unset Count with Minimum replies 4, and Minimum replies or Count
 *    from an expression. The fixture of them validates with zero errors and runs: the literal Blocks pass,
 *    the unset Count sends 4 requests, and each expression that breaks the bound fails its Block at the
 *    run with "Parameter 'min_replies' must be between 1 and <count>", caught by its Try/Catch.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, PING_LOOPBACK_HOST } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import {
  cleanUp,
  libraryFunction,
  localFunctionBlock,
  logBlock,
  messagesOf,
  pluginBlock,
  postFunction,
  postTest,
  type Rec,
} from '../../helpers/fn-block'
import { VALIDATION, dismissLoadDialogIfPresent, openTest, rawPersistTest, validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts } from '../../helpers/log-reader'
import { saveBtn, setBlockExpression } from '../../helpers/workbench'
import { consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

const CODE = 'SETTING_ABOVE_MAXIMUM'
const ceiling = (count: number, value: number): string =>
  `Setting 'min_replies' of block 'ping' must be at most the value of setting 'count' (${count}), got ${value}`

const BOOKEND = 'ping-bounds-done'
const PING_ID = 'zz-b29-ping'
const LOG_ID = 'zz-b29-log'

function pingValues(extra: Rec): Rec {
  return { host: PING_LOOPBACK_HOST, interval: 0.2, timeout: 10, pass_when: 'min_replies', ...extra }
}

function pingAt(values: Rec, y = 150): Rec {
  return pluginBlock(PING_ID, 'Reach the loopback', 'ping', 'network', { values, position: { x: 200, y } })
}

const zz = (what: string): string => `zz-b29-${what}-${randomUUID().slice(0, 6)}`

interface FixtureNode {
  id: string
  data: { description: string; config: { values: Rec } }
}

function loadFixture(): { name: string; workflow: { nodes: FixtureNode[] } } & Rec {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-save-bounds.json'), 'utf-8'))
}

test.describe('V-PLUGIN-PING-SAVE-BOUNDS-FUNCTIONAL: the Ping ceiling on every save', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds, functionIds)
  })

  test('1. the backend API refuses Minimum replies above Count on every save', async ({ request }) => {
    const refusedTests: Array<[string, Rec[], string]> = [
      ['a Test save', [pingAt(pingValues({ count: 4, min_replies: 5 }))], ceiling(4, 5)],
      ['a Test save with Count unset', [pingAt(pingValues({ min_replies: 5 }))], ceiling(4, 5)],
      ['a Test save with Count 2', [pingAt(pingValues({ count: 2, min_replies: 3 }))], ceiling(2, 3)],
      [
        'a Local Function body',
        [localFunctionBlock('zz-b29-fn', 'Local ping', { nodes: [pingAt(pingValues({ count: 4, min_replies: 5 }))] })],
        ceiling(4, 5),
      ],
    ]
    for (const [what, nodes, message] of refusedTests) {
      const answer = await postTest(request, { name: zz('ping-refused'), nodes })
      if (answer.id) testIds.push(answer.id)
      expect(answer.status, `${what}: ${JSON.stringify(answer.body)}`).toBe(422)
      expect(messagesOf(answer.findings, CODE), what).toEqual([message])
    }

    const fn = await postFunction(
      request,
      libraryFunction(zz('ping-fn'), { nodes: [pingAt(pingValues({ count: 4, min_replies: 5 }))] }),
    )
    if (fn.id) functionIds.push(fn.id)
    expect(fn.status, `a library Function save: ${JSON.stringify(fn.body)}`).toBe(422)
    expect(messagesOf(fn.findings, CODE)).toEqual([ceiling(4, 5)])
  })

  test('2 and 3. canvas Save shows the refusal and stores nothing', async ({ page, request }) => {
    test.setTimeout(180_000)
    const storedMessage = "'before the edit'"
    const testId = await rawPersistTest(request, {
      name: zz('ping-canvas'),
      nodes: [
        pingAt(pingValues({ count: 4, min_replies: 5 })),
        logBlock(LOG_ID, 'After the ping', storedMessage, { position: { x: 200, y: 290 } }),
      ],
      edges: [
        { id: 'e-start-ping', source: 'start-node', target: PING_ID },
        { id: 'e-ping-log', source: PING_ID, target: LOG_ID },
      ],
    })
    testIds.push(testId)
    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)

    await test.step('2. the Save dialog lists the exact text', async () => {
      await setBlockExpression(page, LOG_ID, 'message', "'after the edit'")
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      const dialog = page.locator(VALIDATION.dialog)
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(dialog.getByRole('heading', { name: 'Cannot Save Test', exact: true })).toBeVisible()
      await expect(dialog.locator(VALIDATION.list)).toContainText(ceiling(4, 5))
      await dialog.locator(VALIDATION.closeBtn).click()
      await expect(dialog).toHaveCount(0)
    })

    await test.step('3. after a reload the stored Test does not hold the edit', async () => {
      await openTest(page, testId)
      await dismissLoadDialogIfPresent(page)
      const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
      const nodes = (await resp.json()).data.workflow.nodes as Array<Record<string, any>>
      expect(nodes.find((node) => node.id === LOG_ID)?.data.config.values.message).toBe(storedMessage)
      expect(nodes.find((node) => node.id === PING_ID)?.data.config.values.min_replies).toBe(5)
    })
  })

  test('4. what the ceiling leaves alone saves, validates clean and runs', async ({ page, request }) => {
    test.setTimeout(180_000)
    const fixture = loadFixture()
    const values = (description: string): Rec => {
      const node = fixture.workflow.nodes.find((item) => item.data.description === description)
      expect(node, `the fixture holds "${description}"`).toBeTruthy()
      return (node as FixtureNode).data.config.values
    }
    const idOf = (description: string): string =>
      (fixture.workflow.nodes.find((item) => item.data.description === description) as FixtureNode).id
    // The fixture's data matches what each Block claims.
    expect(values('Equal to Count')).toMatchObject({ count: 2, pass_when: 'min_replies', min_replies: 2 })
    expect(values('Rule off')).toMatchObject({ count: 2, pass_when: 'any', min_replies: 5 })
    expect('count' in values('Count default'), 'Count is left unset').toBe(false)
    expect(values('Count default')).toMatchObject({ pass_when: 'min_replies', min_replies: 4 })
    expect(values('Replies expression')).toMatchObject({ count: 2, min_replies: 'want_replies' })
    expect(values('Count expression')).toMatchObject({ count: 'ping_count', min_replies: 3 })

    fixture.name = zz('ping-save-bounds')
    const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
    testIds.push(testId)
    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 150_000)
    const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as Record<
      string,
      { value: unknown; type: string }
    >
    const messages = consoleEntriesFromCopy(await getLogCopyTexts(page)).map((entry) => entry.message)

    for (const description of ['Equal to Count', 'Rule off', 'Count default']) {
      await expectNodeStatus(page, idOf(description), 'success')
    }
    for (const description of ['Replies expression', 'Count expression']) {
      await expectNodeStatus(page, idOf(description), 'failed')
    }
    expect(variables.p_rexpr_caught?.value, 'the Minimum replies expression failure is caught').toBe(true)
    expect(variables.p_cexpr_caught?.value, 'the Count expression failure is caught').toBe(true)
    for (const line of [
      'ping-bounds equal-ok=True ruleoff-ok=True default-ok=True default-sent=4',
      "ping-bounds replies-expr Parameter 'min_replies' must be between 1 and 2",
      "ping-bounds count-expr Parameter 'min_replies' must be between 1 and 1",
      BOOKEND,
    ]) {
      expect(messages, `the console carries "${line}"`).toContain(line)
    }
  })
})
