/**
 * V-FN-FLOW-SAVE-CHECKS-FUNCTIONAL: the save checks every Block of a Function flow, on every save surface
 * Wireframe: none (functional, API saves plus one run)
 * Design Decisions: FNCFG-5, FNCFG-9
 * REQ: REQ-3.1.2.4, REQ-3.1.1.5
 *
 * Seeds (API): two library Functions (`POST /functions`): `greet` with a Required input `who`, and an empty
 * Function the Shared draft surface puts in edit mode. Each case is saved on the three surfaces of a
 * Function flow: the library save (`POST /functions`), a Local Function body and a Shared Function Block's
 * edit-mode draft (both `POST /tests`). Every name is `zz-11541-s7-`; what saves is deleted afterwards.
 *
 * Pass Criteria:
 * 1. A muted Log with no message and a muted Shared Function Block with an empty Required input never block
 *    a save: every surface stores the flow, and the stored Local body runs through the UI and passes with
 *    only the unmuted Log printed. The same two Blocks unmuted are refused with `Required parameter
 *    'message' is missing`, `Setting 'level' of block 'log' expects string, got integer` and `Required
 *    parameter 'who' is missing`.
 * 2. An undeclared name in a Template's `{{ }}`, in an output target and in a Variable Setter target is
 *    refused with `UNRESOLVED_VARIABLE_REFERENCE` `Variable 'nope' is not defined in this Function's scope
 *    (inputs, outputs, and local variables)` on every surface, and nothing is stored; the same sites with
 *    declared names save.
 * 3. A Variable Setter writing a declared input is refused with `INPUT_WRITE_FORBIDDEN` `Writes to declared
 *    input 'x'; inputs are read-only` and no undeclared-name finding, on every surface.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { openTest } from '../../helpers/fn-seed'
import {
  alertBadge,
  cleanUp,
  createFunction,
  csvBlock,
  editModeFunctionBlock,
  functionIdsNamed,
  libraryFunction,
  localFunctionBlock,
  logBlock,
  messagesOf,
  pluginBlock,
  postFunction,
  postTest,
  setterBlock,
  sharedFunctionBlock,
  testIdsNamed,
  zzName,
  type FunctionBody,
  type PinnedFunction,
  type Rec,
  type SaveAnswer,
} from '../../helpers/fn-block'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { runToEnd, selectEnvironment } from '../../helpers/workbench'

type Surface = 'library save' | 'Local body' | 'Shared draft'
const SURFACES: readonly Surface[] = ['library save', 'Local body', 'Shared draft']

const UNKNOWN_NOPE = "Variable 'nope' is not defined in this Function's scope (inputs, outputs, and local variables)"
const RAN = 'zz-11541-s7-flow-ran'
const FLOW_ID = 'fn-flow'

interface Saved {
  answer: SaveAnswer
  name: string
}

test.describe('V-FN-FLOW-SAVE-CHECKS-FUNCTIONAL: save checks in a Function flow', () => {
  const testIds: string[] = []
  const functionIds: string[] = []
  const seededIds: string[] = []
  let greet: PinnedFunction
  let draftSource: PinnedFunction

  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
    greet = await createFunction(
      request,
      libraryFunction(zzName('greet'), {
        inputs: [{ name: 'who', type: 'string', required: true, description: '' }],
        nodes: [logBlock('greet-log', 'Greet', "'hello ' + who")],
      }),
    )
    draftSource = await createFunction(request, libraryFunction(zzName('draft-src'), { nodes: [] }))
    seededIds.push(greet.functionId, draftSource.functionId)
  })

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds, functionIds)
  })

  test.afterAll(async ({ request }) => {
    await cleanUp(request, [], seededIds)
  })

  /** Save `body` as a Function flow on `surface`; what saves is kept for the cleanup. */
  async function saveOn(request: APIRequestContext, surface: Surface, body: FunctionBody): Promise<Saved> {
    const name = zzName('flow')
    let answer: SaveAnswer
    if (surface === 'library save') {
      answer = await postFunction(request, libraryFunction(name, body))
      if (answer.id) functionIds.push(answer.id)
    } else {
      const block =
        surface === 'Local body'
          ? localFunctionBlock(FLOW_ID, 'Flow_Fn', body)
          : editModeFunctionBlock(FLOW_ID, 'Flow_Fn', draftSource, body)
      answer = await postTest(request, { name, nodes: [block] })
      if (answer.id) testIds.push(answer.id)
    }
    return { answer, name }
  }

  /** The save was refused and nothing was stored under its name. */
  async function expectRefused(request: APIRequestContext, surface: Surface, saved: Saved): Promise<void> {
    expect(saved.answer.status, `${surface}: refused, ${JSON.stringify(saved.answer.body)}`).toBe(422)
    const stored = surface === 'library save' ? await functionIdsNamed(request, saved.name) : await testIdsNamed(request, saved.name)
    expect(stored, `${surface}: nothing is stored`).toEqual([])
  }

  function expectSaved(surface: Surface, saved: Saved): void {
    expect(saved.answer.status, `${surface}: saved, ${JSON.stringify(saved.answer.body)}`).toBe(201)
  }

  function mutedLog(disabled: boolean): Rec {
    return pluginBlock('muted-log', 'Muted Log', 'log', 'system', { values: { level: 5 }, disabled })
  }

  function mutedGreet(disabled: boolean): Rec {
    return sharedFunctionBlock('muted-greet', 'Greet_1', greet, { disabled })
  }

  test('a muted Block never blocks the save on any surface, and the stored flow runs past it', async ({ page, request }) => {
    test.setTimeout(180_000)
    let localTestId = ''
    for (const surface of SURFACES) {
      await test.step(`${surface}: the muted Blocks save, the same Blocks unmuted are refused`, async () => {
        const muted = await saveOn(request, surface, {
          nodes: [mutedLog(true), mutedGreet(true), logBlock('ran-log', 'Ran', `'${RAN}'`)],
        })
        expectSaved(surface, muted)
        if (surface === 'Local body') localTestId = muted.answer.id as string

        const live = await saveOn(request, surface, { nodes: [mutedLog(false), mutedGreet(false)] })
        await expectRefused(request, surface, live)
        expect(messagesOf(live.answer.findings, 'REQUIRED_PARAM_MISSING').sort()).toEqual([
          "Required parameter 'message' is missing",
          "Required parameter 'who' is missing",
        ])
        expect(messagesOf(live.answer.findings, 'INVALID_SETTING_TYPE')).toEqual([
          "Setting 'level' of block 'log' expects string, got integer",
        ])
      })
    }

    await test.step('the stored Local body opens with no badge and runs past the muted Blocks', async () => {
      await openTest(page, localTestId)
      await expect(alertBadge(page, FLOW_ID), 'the muted Blocks raise no badge').toHaveCount(0)
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expect(verdict, formatEntries(entries)).toBe('passed')
      expectConsoleLine(entries, 'INFO', RAN)
      expect(entries.some((entry) => entry.message.startsWith('hello ')), formatEntries(entries)).toBe(false)
    })
  })

  test('an undeclared name in a Template, an output target or a Setter target is refused on every surface', async ({
    request,
  }) => {
    const sites: Array<[string, (name: string) => Rec]> = [
      ['a Template marker', (name) => logBlock('tpl-log', 'Template Log', `Hi {{ ${name} }}`, { kind: 'template' })],
      ['an output target', (name) => csvBlock('count-csv', 'Count Rows', { outputBindings: { row_count: name } })],
      ['a Setter target', (name) => setterBlock('name-set', 'Set Name', { [name]: 'v' })],
    ]
    const declared: Pick<FunctionBody, 'inputs' | 'outputs' | 'variables'> = {
      inputs: [{ name: 'who', type: 'string', required: false, default: null, description: '' }],
      outputs: [{ name: 'rows', type: 'integer', description: '' }],
      variables: [{ name: 'seen', type: 'string', value: '' }],
    }
    const declaredNames: Record<string, string> = {
      'a Template marker': 'who',
      'an output target': 'rows',
      'a Setter target': 'seen',
    }
    for (const surface of SURFACES) {
      for (const [where, block] of sites) {
        await test.step(`${surface}: ${where}`, async () => {
          const refused = await saveOn(request, surface, { ...declared, nodes: [block('nope')] })
          await expectRefused(request, surface, refused)
          expect(messagesOf(refused.answer.findings, 'UNRESOLVED_VARIABLE_REFERENCE')).toEqual([UNKNOWN_NOPE])

          const clean = await saveOn(request, surface, { ...declared, nodes: [block(declaredNames[where])] })
          expectSaved(surface, clean)
        })
      }
    }
  })

  test('a Variable Setter writing a declared input is refused on every surface', async ({ request }) => {
    for (const surface of SURFACES) {
      await test.step(surface, async () => {
        const saved = await saveOn(request, surface, {
          inputs: [{ name: 'x', type: 'string', required: false, default: null, description: '' }],
          nodes: [setterBlock('write-input', 'Write Input', { x: 'v' })],
        })
        await expectRefused(request, surface, saved)
        expect(messagesOf(saved.answer.findings, 'INPUT_WRITE_FORBIDDEN')).toEqual([
          "Writes to declared input 'x'; inputs are read-only",
        ])
        expect(messagesOf(saved.answer.findings, 'UNRESOLVED_VARIABLE_REFERENCE')).toEqual([])
      })
    }
  })
})
