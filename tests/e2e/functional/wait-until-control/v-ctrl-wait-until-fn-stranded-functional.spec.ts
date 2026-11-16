/**
 * V-CTRL-WAIT-UNTIL-FN-STRANDED-FUNCTIONAL: a Function save that removes a Watch wait's retry wire names it
 * as the reason the Block behind it is unreached
 *
 * Design Decisions: WAIT-3
 * REQ: REQ-3.5.4.3 (Wait Until lanes and mode switch), REQ-3.1.2.4 (Function validation before save),
 *      REQ-5.2.4.3 (save pipeline repair reporting)
 *
 * Pass Criteria:
 * 1. A library Function saved through POST /functions whose Watch-mode Wait Until has a retry wire that is
 *    the only way into a Block is refused, and the finding for that Block says its only wire came from
 *    the Watch wait's retry lane, which the save removed; nothing is stored.
 * 2. The same body as a Local Function inside a Test saved through POST /tests is refused with the same
 *    finding; nothing is stored.
 * 3. The same body as a Local Function inside a library Function saved through POST /functions is refused
 *    with the same finding, the way the Test save refuses a body nested in a body; nothing is stored.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  cleanUp,
  functionIdsNamed,
  libraryFunction,
  localFunctionBlock,
  messagesOf,
  postFunction,
  postTest,
  testIdsNamed,
  type FunctionBody,
  type Rec,
  type SaveAnswer,
} from '../../helpers/fn-block'

const NODE_UNREACHABLE = 'NODE_UNREACHABLE'
const START = 'start-node'
const WATCH = 'fw-watch'
const NEXT_LOG = 'fw-after-watch'
const STRANDED = 'fw-stranded'
const WATCH_LABEL = 'Watch ready'
const STRANDED_LABEL = 'Retry log'

/** The reason the save gives for the Block only the removed retry wire reached. */
const STRANDED_MESSAGE =
  `Block '${STRANDED_LABEL}' is not reachable from the Function's entry: its only wire came from the retry lane ` +
  `of Watch-mode Wait Until '${WATCH_LABEL}', which was removed`

interface FnFixture {
  variables: Rec[]
  workflow: { nodes: Array<Rec & { id: string; data: Rec }> }
}

function fixtureNode(fixture: FnFixture, id: string): Rec & { id: string; data: Rec } {
  const node = fixture.workflow.nodes.find((n) => n.id === id)
  expect(node, `fixture-fn-wait-wires.json holds ${id}`).toBeTruthy()
  return structuredClone(node as Rec & { id: string; data: Rec })
}

/** A Watch wait whose retry wire is the only way into a Log, and whose next wire leads to another Log. */
function strandingBody(): FunctionBody {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-fn-wait-wires.json'), 'utf-8'),
  ) as FnFixture
  const watch = fixtureNode(fixture, WATCH)
  watch.data.label = WATCH_LABEL
  const next = fixtureNode(fixture, NEXT_LOG)
  const stranded = fixtureNode(fixture, NEXT_LOG)
  stranded.id = STRANDED
  stranded.position = { x: 360, y: 320 }
  stranded.data.label = STRANDED_LABEL
  stranded.data.description = 'Reached only by the retry wire'
  ;(stranded.data.config as { values: Rec }).values.message = "'fw-stranded-ran'"
  return {
    nodes: [watch, next, stranded],
    edges: [
      { id: 'e-fw-start', source: START, target: WATCH, type: 'default' },
      { id: 'e-fw-watch-retry', source: WATCH, sourceHandle: 'retry', target: STRANDED, type: 'default' },
      { id: 'e-fw-watch-next', source: WATCH, target: NEXT_LOG, type: 'default' },
    ],
    variables: fixture.variables,
  }
}

function expectStrandedRefusal(answer: SaveAnswer, route: string): void {
  expect(answer.status, `${route} answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBe(422)
  expect(
    messagesOf(answer.findings, NODE_UNREACHABLE),
    `${route} names the removed retry wire as the reason the Block is unreached: ${JSON.stringify(answer.findings)}`,
  ).toEqual([STRANDED_MESSAGE])
}

test.describe('V-CTRL-WAIT-UNTIL-FN-STRANDED-FUNCTIONAL: the save says why a Block behind a removed retry wire is unreached', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds, functionIds)
  })

  test('POST /functions names the removed retry wire in the refusal for the Block only it reached', async ({
    request,
  }) => {
    const name = `v-wu-fn-stranded-${randomUUID().slice(0, 6)}`
    const answer = await postFunction(request, libraryFunction(name, strandingBody()))
    if (answer.id) functionIds.push(answer.id)

    expectStrandedRefusal(answer, 'POST /functions')
    const stored = await functionIdsNamed(request, name)
    functionIds.push(...stored)
    expect(stored, 'the refused library Function is not stored').toEqual([])
  })

  test('POST /functions names the removed retry wire for a Local Function body inside the library Function', async ({
    request,
  }) => {
    const name = `v-wu-fn-nested-${randomUUID().slice(0, 6)}`
    const answer = await postFunction(
      request,
      libraryFunction(name, {
        nodes: [localFunctionBlock('fw-fn', 'fw_body', strandingBody())],
        edges: [{ id: 'e-fw-root', source: START, target: 'fw-fn' }],
      }),
    )
    if (answer.id) functionIds.push(answer.id)

    expectStrandedRefusal(answer, 'POST /functions with the body nested in a Local Function')
    const stored = await functionIdsNamed(request, name)
    functionIds.push(...stored)
    expect(stored, 'the refused library Function is not stored').toEqual([])
  })

  test('POST /tests names the removed retry wire in the refusal for a Local Function body', async ({ request }) => {
    const name = `V-CTRL-WAIT-UNTIL-FN-STRANDED ${Date.now()}-${randomUUID().slice(0, 6)}`
    const answer = await postTest(request, {
      name,
      nodes: [localFunctionBlock('fw-fn', 'fw_body', strandingBody())],
      edges: [{ id: 'e-fw-root', source: START, target: 'fw-fn' }],
    })
    if (answer.id) testIds.push(answer.id)

    expectStrandedRefusal(answer, 'POST /tests')
    const stored = await testIdsNamed(request, name)
    testIds.push(...stored)
    expect(stored, 'the refused Test is not stored').toEqual([])
  })
})
