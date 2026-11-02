/**
 * V-NULL-FUNCTION-INPUTS-FUNCTIONAL: the input rule on a Function Block
 * Wireframe: none (functional)
 * Design Decisions: FIELD-2
 * REQ: REQ-3.1.3.21, REQ-3.1.1.5, REQ-3.1.2.10
 *
 * Five Function Blocks running Local Functions that each declare a required input (`req_in`), an
 * input with a default (`def_in` = `def-value`) and an optional input with no default (`opt_in`).
 * Each input is a field of the Function Block, given as an expression. The refused Function
 * Blocks sit in Try/Catch blocks, so one run covers every case and passes.
 *
 * Pass Criteria:
 * 1. A required input given None is refused with `'req_in' is null`.
 * 2. A defaulted input given None is refused with `'def_in' is null`.
 * 3. An input expression that fails (`1 / 0`) is refused with the plain expression error
 *    `Expression evaluation failed for '1 / 0': division by zero`.
 * 4. In each refused Function Block no Block of the Function flow ran: the Block has no run state
 *    in the session and its Log line never printed; the Function Block is failed and the catch
 *    path ran.
 * 5. An optional input with no default given None reaches the Function flow: its Log prints `null`.
 * 6. A blank expression on the defaulted input gives the default: its Log prints `def-value`, and
 *    the optional input left out prints `null`.
 * 7. The run passes.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { expectConsoleLine, formatEntries, getLogCopyTexts, type LogEntry } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { readFixture } from '../../helpers/element-types'
import { deleteTest } from '../file-picker/picker'
import { BACKEND_URL } from '../../helpers/config'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

const DONE_MARKER = 'null-function-inputs-done'

const IDS = {
  tcA: '21269e0f-e82c-4f3d-8f8a-bfb14d325b96',
  fnA: '9824c1a1-0e31-4c5e-8dc6-8e970a4e2c33',
  aBody: '546e05e1-0137-4fce-af48-e07c37aab6e2',
  aCaught: '8a63033a-8602-49b2-8123-d5cff0abf263',
  tcB: '0507c984-6362-47a9-8a1b-9c9ea641a328',
  fnB: 'b753f18d-84b8-4327-9359-11472ae3c428',
  bBody: '7e692925-a22b-427a-93f9-9d9bc0a5e685',
  bCaught: '63517aa3-582c-4e77-8a53-952caac09b1d',
  fnC: 'a5fb2ff9-a80d-48d4-a004-fa761bacfe5d',
  cOpt: 'def71b61-c1d0-4d7e-9238-2d948e0623e1',
  cDef: '4d3b02e3-2244-44ba-8a13-1e376104fa78',
  tcD: '4432a2c0-beab-47dd-a439-7b1efb0bdb3a',
  fnD: 'e9adbbf3-3383-4112-9cf3-101d4c3de43e',
  dBody: 'fb5ebc05-4e43-497f-873c-8de98538f915',
  dCaught: '2ac206b3-d445-4a64-9860-504ef11a2f6d',
  fnE: 'c8ad54e8-ed29-4eb7-9d5a-c0a262ecff1e',
  eDef: '8eb3d5de-608c-42a5-94c0-69eeae36eb8f',
  eOpt: 'a25ad85b-3b5a-4ffb-a7fe-c96e76d67753',
  done: '941b9a8b-e099-4935-adea-bcb705e87890',
} as const

type RefusedBlock = {
  errorVar: string
  fnId: string
  bodyId: string
  bodyLine: string
  caughtLine: string
  message: string
}

/** The exact run-time messages (REQ-3.1.3.21). */
const REFUSED_BLOCKS: Record<'required' | 'defaulted' | 'unevaluable', RefusedBlock> = {
  required: {
    errorVar: 'err_a',
    fnId: IDS.fnA,
    bodyId: IDS.aBody,
    bodyLine: 'fn-a-body-ran',
    caughtLine: 'fn-a-caught',
    message: "'req_in' is null",
  },
  defaulted: {
    errorVar: 'err_b',
    fnId: IDS.fnB,
    bodyId: IDS.bBody,
    bodyLine: 'fn-b-body-ran',
    caughtLine: 'fn-b-caught',
    message: "'def_in' is null",
  },
  unevaluable: {
    errorVar: 'err_d',
    fnId: IDS.fnD,
    bodyId: IDS.dBody,
    bodyLine: 'fn-d-body-ran',
    caughtLine: 'fn-d-caught',
    message: "Expression evaluation failed for '1 / 0': division by zero",
  },
}

type CaughtError = { message?: string; node_id?: string }

/** Every Block's run state in the active workbench session, Function bodies included. */
async function blockStates(request: APIRequestContext): Promise<Record<string, string>> {
  const resp = await request.get(`${BACKEND_URL}/workbench/session`)
  expect(resp.ok(), `GET /workbench/session failed: ${resp.status()}`).toBeTruthy()
  const session = (await resp.json()).data as { block_states?: Record<string, string> } | null
  expect(session, 'the run left its session in place').toBeTruthy()
  return session?.block_states ?? {}
}

/** The messages one Log Block wrote, in console order. */
function linesOf(entries: readonly LogEntry[], blockName: string): string[] {
  const source = blockSource('Log', blockName)
  return entries.filter((entry) => entry.source === source).map((entry) => entry.message)
}

test.describe('V-NULL-FUNCTION-INPUTS-FUNCTIONAL: Function Block inputs refuse null', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
  })

  test('null to a required or defaulted input and a failing expression are refused before the Function flow', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await importValidateAndNavigate(
      page,
      readFixture(__dirname, 'fixture-function-inputs.json'),
    )

    const status = await startRun(page)
    const logs = await finishRun(page, status, DONE_MARKER)
    const all = logs.join('\n')
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const consoleText = formatEntries(entries)
    const vars: SessionVariables = await getSessionVariables(page, await getActiveSessionId(page))
    const states = await blockStates(request)

    await test.step('a Function flow that ran records its Blocks in the session (control for the checks below)', () => {
      expect(states[IDS.cOpt], 'a Function flow Block that ran has a run state').toBe('passed')
      expect(states[IDS.eDef], 'a Function flow Block that ran has a run state').toBe('passed')
    })

    const expectRefusedBeforeFlow = async (refused: RefusedBlock) => {
      const error = sessionValue(vars, refused.errorVar) as CaughtError
      expect(error.message, `${refused.errorVar} carries the exact refusal.\n${consoleText}`).toBe(
        refused.message,
      )
      expect(error.node_id, 'the refused Block is the Function Block').toBe(refused.fnId)
      expectConsoleLine(entries, 'WARN', `Try-path error caught: ${refused.message}`)
      expect(logs.includes(refused.caughtLine), `the catch path ran.\n${all}`).toBeTruthy()
      expect(states[refused.bodyId], 'no Block of the Function flow ran').toBeUndefined()
      expect(
        logs.some((line) => line.includes(refused.bodyLine)),
        `the Function flow Log must never print "${refused.bodyLine}".\n${all}`,
      ).toBeFalsy()
      await expectNodeStatus(page, refused.fnId, 'failed')
    }

    await test.step("a required input given None: 'req_in' is null, the Function flow never ran", async () => {
      await expectRefusedBeforeFlow(REFUSED_BLOCKS.required)
    })

    await test.step("a defaulted input given None: 'def_in' is null, the Function flow never ran", async () => {
      await expectRefusedBeforeFlow(REFUSED_BLOCKS.defaulted)
    })

    await test.step('an input expression that fails is refused with the plain expression error', async () => {
      await expectRefusedBeforeFlow(REFUSED_BLOCKS.unevaluable)
    })

    await test.step('an optional input with no default given None logs null inside the Function flow', async () => {
      expect(linesOf(entries, 'C Opt'), consoleText).toEqual(['null'])
      expect(linesOf(entries, 'C Def'), 'the defaulted input left out holds its default').toEqual([
        'def-value',
      ])
      await expectNodeStatus(page, IDS.fnC, 'success')
    })

    await test.step('a blank expression uses the default; an optional input left out is null', async () => {
      expect(linesOf(entries, 'E Def'), consoleText).toEqual(['def-value'])
      expect(linesOf(entries, 'E Opt'), consoleText).toEqual(['null'])
      await expectNodeStatus(page, IDS.fnE, 'success')
    })

    await test.step('the guards and the bookend succeeded', async () => {
      for (const id of [IDS.tcA, IDS.aCaught, IDS.tcB, IDS.bCaught, IDS.tcD, IDS.dCaught, IDS.done]) {
        await expectNodeStatus(page, id, 'success')
      }
    })
  })
})
