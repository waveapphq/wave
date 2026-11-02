/**
 * V-FN-BLOCK-SAVE-REFUSALS-FUNCTIONAL: a Function save refuses an unknown Block type, an expression that changes data, a long Block description and a true / false input with no default
 * Wireframe: none (functional, API saves)
 * Design Decisions: FNCFG-6
 * REQ: REQ-3.1.2.4, REQ-3.1.2.10
 *
 * Seeds (API): one empty library Function (`POST /functions`) that the Shared draft surface puts in edit
 * mode. The Function flows are saved through the library save (`POST /functions`) and as a Local
 * Function body or a Shared Function Block's edit-mode draft inside a Test (`POST /tests`). Every name is
 * `zz-11541-s7-`; what saves is deleted afterwards.
 *
 * Pass Criteria:
 * 1. A Function flow holding an unknown control type `x` is refused with `UNKNOWN_BLOCK_TYPE` `Unknown block
 *    type: 'x'` on every surface, and nothing is stored.
 * 2. A Log whose expression appends to a list is refused with `EXPRESSION_CHANGES_DATA` naming the reason,
 *    the Block and the field, on every surface, and nothing is stored.
 * 3. A library save whose flow holds a 65-character Block description is refused with `DESCRIPTION_TOO_LONG`
 *    `Block description must be at most 64 characters`; 64 characters save.
 * 4. A Test whose edit-mode draft declares a true / false input with no default, optional or Required, is
 *    refused with `BOOLEAN_INPUT_NO_DEFAULT` `Boolean input 'flag' needs a default`, and so is the library
 *    save; with the default `false` the Test saves and the stored draft keeps it.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  cleanUp,
  controlBlock,
  createFunction,
  editModeFunctionBlock,
  functionIdsNamed,
  libraryFunction,
  localFunctionBlock,
  logBlock,
  messagesOf,
  postFunction,
  postTest,
  storedBlock,
  testIdsNamed,
  zzName,
  type FunctionBody,
  type PinnedFunction,
  type Rec,
  type SaveAnswer,
} from '../../helpers/fn-block'

type Surface = 'library save' | 'Local body' | 'Shared draft'
const SURFACES: readonly Surface[] = ['library save', 'Local body', 'Shared draft']
const BLOCK_ID = 'fn-saved'

const CHANGES_DATA =
  'The append method changes data. An expression can only read data, not change it. ' +
  'To change a variable, add a Variable Setter Block. Block: Mutating Log. Field: message.'

interface Saved {
  answer: SaveAnswer
  name: string
}

test.describe('V-FN-BLOCK-SAVE-REFUSALS-FUNCTIONAL: what a Function save refuses', () => {
  const testIds: string[] = []
  const functionIds: string[] = []
  const seededIds: string[] = []
  let draftSource: PinnedFunction

  test.beforeAll(async ({ request }) => {
    draftSource = await createFunction(request, libraryFunction(zzName('refusal-src'), { nodes: [] }))
    seededIds.push(draftSource.functionId)
  })

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds, functionIds)
  })

  test.afterAll(async ({ request }) => {
    await cleanUp(request, [], seededIds)
  })

  async function saveOn(request: APIRequestContext, surface: Surface, body: FunctionBody): Promise<Saved> {
    const name = zzName('refusal')
    let answer: SaveAnswer
    if (surface === 'library save') {
      answer = await postFunction(request, libraryFunction(name, body))
      if (answer.id) functionIds.push(answer.id)
    } else {
      const block =
        surface === 'Local body'
          ? localFunctionBlock(BLOCK_ID, 'Saved_Fn', body)
          : editModeFunctionBlock(BLOCK_ID, 'Saved_Fn', draftSource, body)
      answer = await postTest(request, { name, nodes: [block] })
      if (answer.id) testIds.push(answer.id)
    }
    return { answer, name }
  }

  async function expectRefused(request: APIRequestContext, surface: Surface, saved: Saved): Promise<void> {
    expect(saved.answer.status, `${surface}: refused, ${JSON.stringify(saved.answer.body)}`).toBe(422)
    const stored = surface === 'library save' ? await functionIdsNamed(request, saved.name) : await testIdsNamed(request, saved.name)
    expect(stored, `${surface}: nothing is stored`).toEqual([])
  }

  test('an unknown Block type and an expression that changes data are refused on every surface', async ({ request }) => {
    for (const surface of SURFACES) {
      await test.step(`${surface}: unknown type`, async () => {
        const saved = await saveOn(request, surface, { nodes: [controlBlock('x-1', 'Mystery', 'x', 'control')] })
        await expectRefused(request, surface, saved)
        expect(messagesOf(saved.answer.findings, 'UNKNOWN_BLOCK_TYPE')).toEqual(["Unknown block type: 'x'"])
      })

      await test.step(`${surface}: an expression that changes data`, async () => {
        const saved = await saveOn(request, surface, {
          variables: [{ name: 'rows', type: 'array', value: [1] }],
          nodes: [logBlock('mutating-log', 'Mutating Log', 'str(rows.append(9))')],
        })
        await expectRefused(request, surface, saved)
        expect(messagesOf(saved.answer.findings, 'EXPRESSION_CHANGES_DATA')).toEqual([CHANGES_DATA])
      })
    }
  })

  test('a library save refuses a Block description over 64 characters', async ({ request }) => {
    const describedLog = (description: string): Rec =>
      logBlock('described-log', 'Described Log', "'hi'", { description })

    const long = await saveOn(request, 'library save', { nodes: [describedLog('d'.repeat(65))] })
    await expectRefused(request, 'library save', long)
    expect(messagesOf(long.answer.findings, 'DESCRIPTION_TOO_LONG')).toEqual([
      'Block description must be at most 64 characters',
    ])

    const fits = await saveOn(request, 'library save', { nodes: [describedLog('d'.repeat(64))] })
    expect(fits.answer.status, JSON.stringify(fits.answer.body)).toBe(201)
  })

  test('a true / false input with no default is refused in an edit-mode draft and a library save', async ({ request }) => {
    const flag = (extra: Rec): FunctionBody => ({
      inputs: [{ name: 'flag', type: 'boolean', description: '', ...extra }],
      nodes: [logBlock('flag-log', 'Print Flag', 'str(flag)')],
    })
    const noDefault: Array<[string, Rec]> = [
      ['optional', { required: false, default: null }],
      ['Required', { required: true }],
    ]
    for (const [kind, extra] of noDefault) {
      for (const surface of ['Shared draft', 'library save'] as const) {
        await test.step(`${surface}: ${kind} with no default`, async () => {
          const saved = await saveOn(request, surface, flag(extra))
          await expectRefused(request, surface, saved)
          expect(messagesOf(saved.answer.findings, 'BOOLEAN_INPUT_NO_DEFAULT')).toEqual([
            "Boolean input 'flag' needs a default",
          ])
        })
      }
    }

    await test.step('with a default the draft saves and keeps it', async () => {
      const saved = await saveOn(request, 'Shared draft', flag({ required: false, default: false }))
      expect(saved.answer.status, JSON.stringify(saved.answer.body)).toBe(201)
      const block = await storedBlock(request, saved.answer.id as string, BLOCK_ID)
      expect(((block.draft as Rec).inputs as Rec[]).map((input) => [input.name, input.default])).toEqual([['flag', false]])
    })
  })
})
