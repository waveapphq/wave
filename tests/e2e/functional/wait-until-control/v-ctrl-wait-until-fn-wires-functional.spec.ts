/**
 * V-CTRL-WAIT-UNTIL-FN-WIRES-FUNCTIONAL: a Function body's Wait Until wires are saved on the lanes its mode draws
 *
 * Design Decisions: WAIT-3
 * REQ: REQ-3.5.4.3 (Wait Until lanes and mode switch), REQ-3.1.2.4 (Function validation before save),
 *      REQ-5.2.4.3 (save pipeline repair reporting)
 *
 * Pass Criteria:
 * 1. A library Function saved through POST /functions with a Watch wait holding a retry wire and a
 *    next wire (on `then`, and on the unnamed exit) and a Retry wait whose next wire names no lane
 *    is stored with the Watch wait's next wire on the unnamed exit, the Retry wait's next wire on
 *    `then`, the retry wire gone and every other wire as sent, the way the Test canvas saves them.
 * 2. The same body as a Local Function inside a Test saved through POST /tests is stored the same
 *    way, and the save response lists only the retry wire as removed, with the Local Function as
 *    its function path.
 * 3. POST /functions lists the removed retry wire in its save response the way POST /tests does:
 *    with no function path when the wait is in the library Function's own flow, and with the Local
 *    Function as its function path when the wait is in a Local Function body of that flow.
 * 4. A new library version (POST /functions/{id}/versions) whose draft holds the retry wire lists it
 *    the same way, at the top and in a nested Local Function body, and stores the version's wires
 *    the way the Test canvas saves them.
 * 5. POST /functions/batch lists, under each created Function's id, the removed retry wire the way
 *    POST /functions does (no function path at the top, the Local Function when nested), and stores
 *    each Function's wires the way the Test canvas saves them.
 * 6. POST /tests/batch lists, under each created Test's id, the removed retry wire with the Local
 *    Function as its function path, the way POST /tests does, and stores each body the same way.
 * 7. PATCH /tests/batch lists, under each updated Test's id, the removed retry wire the way a single
 *    Test update does, and stores the body the same way.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  cleanUp,
  createFunction,
  libraryFunction,
  localFunctionBlock,
  postFunction,
  postTest,
  storedBlock,
  type FunctionBody,
  type Rec,
} from '../../helpers/fn-block'

const FN_BLOCK = 'fw-fn'
const FN_LABEL = 'fw_body'
const START = 'start-node'
const WATCH = 'fw-watch'
const RETRY = 'fw-retry'
const RETRY_WIRE = 'e-fw-watch-retry'
const WATCH_NEXT = 'e-fw-watch-next'
const RETRY_NEXT = 'e-fw-retry-next'

/** The repair text the Test save gives for the removed retry wire (Watch wait to the Log after the Retry wait). */
const RETRY_WIRE_REPAIR = 'Connection fw-watch -> fw-after-retry was removed'

type Lane = 'then' | null
type Where = 'top' | 'nested'

type Wire = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string
}

interface FnFixture {
  name: string
  variables: Rec[]
  workflow: { nodes: Rec[]; edges: Wire[] }
}

/** One entry of a save response's `repairs`. */
interface Repair {
  kind?: string
  id?: string
  message?: string
  function_path?: Array<{ node_id?: string }>
}

function readFixture(): FnFixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-fn-wait-wires.json'), 'utf-8')) as FnFixture
}

/** The fixture body with the Watch wait's next wire on `next` (null: the unnamed exit). */
function body(next: Lane): FunctionBody {
  const fixture = readFixture()
  const edges = fixture.workflow.edges.map((e) => {
    if (e.id !== WATCH_NEXT) return e
    const moved: Wire = { ...e }
    delete moved.sourceHandle
    if (next) moved.sourceHandle = next
    return moved
  })
  return { nodes: fixture.workflow.nodes, edges, variables: fixture.variables }
}

/** The fixture body as the library already holds it: no retry wire. */
function bodyWithoutRetryWire(): FunctionBody {
  const sent = body('then')
  return { ...sent, edges: (sent.edges as Wire[]).filter((e) => e.id !== RETRY_WIRE) }
}

/** A library Function flow holding `inner`: the flow itself, or one Local Function Block running it. */
function flowAt(where: Where, inner: FunctionBody): FunctionBody {
  if (where === 'top') return inner
  return {
    nodes: [localFunctionBlock(FN_BLOCK, FN_LABEL, inner)],
    edges: [{ id: 'e-fw-root', source: START, target: FN_BLOCK }],
  }
}

/** Each wire as (id, source, target, source handle, target handle). */
function wireRows(edges: readonly Wire[]): Array<Array<string | null>> {
  return edges.map((e) => [e.id, e.source, e.target, e.sourceHandle ?? null, e.targetHandle ?? null])
}

/** The wires the Test canvas would save: no retry wire on Watch, the Watch next wire unnamed, the Retry next wire on then. */
function expectedRows(): Array<Array<string | null>> {
  const kept = readFixture()
    .workflow.edges.filter((e) => e.id !== RETRY_WIRE)
    .map((e) => {
      if (e.id === WATCH_NEXT) return { ...e, sourceHandle: undefined }
      if (e.id === RETRY_NEXT) return { ...e, sourceHandle: 'then' }
      return e
    })
  return wireRows(kept)
}

function expectStoredBody(edges: readonly Wire[], where: string): void {
  const out = (source: string) =>
    JSON.stringify(edges.filter((e) => e.source === source).map((e) => [e.sourceHandle ?? null, e.target]))
  expect(
    wireRows(edges),
    `${where}: the stored wires (Watch wait ${out(WATCH)}, Retry wait ${out(RETRY)})`,
  ).toEqual(expectedRows())
}

/** Each repair of a save response as (kind, id, message, the node ids of its function path). */
function repairRows(answer: Rec | null): Array<[string?, string?, string?, string[]?]> {
  return ((answer?.repairs ?? []) as Repair[]).map((r) => [
    r.kind,
    r.id,
    r.message,
    (r.function_path ?? []).map((segment) => String(segment.node_id)),
  ])
}

/** The one repair a save of the fixture body lists: the retry wire, with the path to the body that held it. */
function retryWireRepair(functionPath: string[]): Array<[string, string, string, string[]]> {
  return [['edge', RETRY_WIRE, RETRY_WIRE_REPAIR, functionPath]]
}

const PATH_TO_BODY: Record<Where, string[]> = { top: [], nested: [FN_BLOCK] }
const PLACE_TITLE: Record<Where, string> = {
  top: "Watch wait in the library Function's own flow",
  nested: 'Watch wait in a Local Function body of the flow',
}

/** A library Function name under the 32 character cap. */
function functionName(what: string): string {
  return `v-wu-fn-${what}-${randomUUID().slice(0, 6)}`
}

async function storedFunctionEdges(
  request: APIRequestContext,
  functionId: string,
  where: Where = 'top',
  version?: string,
): Promise<Wire[]> {
  const query = version ? `?version=${encodeURIComponent(version)}` : ''
  const resp = await request.get(`${BACKEND_URL}/functions/${functionId}${query}`)
  expect(resp.ok(), `GET /functions/${functionId}${query}: ${resp.status()}`).toBeTruthy()
  let workflow = ((await resp.json()).data as { workflow?: { nodes?: Rec[]; edges?: Wire[] } }).workflow
  if (where === 'nested') {
    const holder = (workflow?.nodes ?? []).find((node) => node.id === FN_BLOCK) as { data?: Rec } | undefined
    expect(holder, `the stored flow holds the Local Function ${FN_BLOCK}`).toBeTruthy()
    workflow = ((holder?.data?.localDefinition ?? {}) as { workflow?: { edges?: Wire[] } }).workflow
  }
  return workflow?.edges ?? []
}

/** Publish `flow` as a new version of `functionId` through POST /functions/{id}/versions; returns status and body. */
async function postVersion(
  request: APIRequestContext,
  functionId: string,
  name: string,
  flow: FunctionBody,
  targetVersion: string,
): Promise<{ status: number; body: Rec | null }> {
  const resp = await request.post(`${BACKEND_URL}/functions/${functionId}/versions`, {
    data: {
      source_version: '1.0.0',
      target_version: targetVersion,
      draft_definition: {
        name,
        description: 'Function Block E2E library entry',
        tags: [],
        inputs: flow.inputs ?? [],
        outputs: flow.outputs ?? [],
        variables: flow.variables ?? [],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: flow.nodes, edges: flow.edges ?? [] },
      },
      changelog: 'Add a retry wire to the Watch wait',
      description: 'Function Block E2E library entry',
      tags: [],
      details: '',
    },
  })
  return { status: resp.status(), body: (await resp.json().catch(() => null)) as Rec | null }
}

/** A batch answer: what it created or updated, what failed, and each saved entity's repairs by its id. */
interface BatchAnswer {
  status: number
  created: unknown[]
  updated: string[]
  failed: unknown[]
  repairs: Record<string, unknown>
  text: string
}

async function batchAnswerOf(resp: { status(): number; json(): Promise<unknown> }): Promise<BatchAnswer> {
  const body = (await resp.json().catch(() => null)) as Rec | null
  // POST /functions/batch answers inside the `data` envelope; the Test batch answers bare.
  const data = ((body?.data ?? body) ?? {}) as Rec
  return {
    status: resp.status(),
    created: (data.created ?? []) as unknown[],
    updated: (data.updated ?? []) as string[],
    failed: (data.failed ?? []) as unknown[],
    repairs: (data.repairs ?? {}) as Record<string, unknown>,
    text: JSON.stringify(body),
  }
}

/** The repairs a batch answer lists for the entity saved as `id`. */
function batchRepairRows(answer: BatchAnswer, id: string): Array<[string?, string?, string?, string[]?]> {
  return repairRows({ repairs: answer.repairs[id] ?? [] })
}

/** A Test holding the Local Function `inner`, as POST /tests and the Test batch take it. */
function testPayload(what: string, inner: FunctionBody): Rec {
  return {
    name: `V-CTRL-WAIT-UNTIL-FN-WIRES ${what} ${Date.now()}-${randomUUID().slice(0, 6)}`,
    version: '1.0.0',
    description: 'Function Block E2E',
    workflow: testWorkflow(inner),
    variables: {},
    metadata: {},
  }
}

function testWorkflow(inner: FunctionBody): Rec {
  return {
    nodes: [localFunctionBlock(FN_BLOCK, FN_LABEL, inner)],
    edges: [{ id: 'e-fw-root', source: START, target: FN_BLOCK }],
  }
}

async function storedLocalEdges(request: APIRequestContext, testId: string): Promise<Wire[]> {
  const data = await storedBlock(request, testId, FN_BLOCK)
  return (data.localDefinition as { workflow: { edges: Wire[] } }).workflow.edges
}

const LANES: readonly Lane[] = ['then', null]
const PLACES: readonly Where[] = ['top', 'nested']

test.describe('V-CTRL-WAIT-UNTIL-FN-WIRES-FUNCTIONAL: a Function body keeps the next wire of each wait', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds, functionIds)
  })

  test('POST /functions stores the Watch next wire unnamed, the Retry next wire on then and drops only the retry wire', async ({
    request,
  }) => {
    for (const next of LANES) {
      await test.step(`Watch next wire on ${next ?? 'the unnamed exit'}`, async () => {
        const pin = await createFunction(request, libraryFunction(functionName(`wires-${next ?? 'exit'}`), body(next)))
        functionIds.push(pin.functionId)
        expectStoredBody(await storedFunctionEdges(request, pin.functionId), `library Function, next on ${next ?? 'exit'}`)
      })
    }
  })

  test('POST /tests stores a Local Function body the same way and reports only the retry wire', async ({
    request,
  }) => {
    for (const next of LANES) {
      await test.step(`Watch next wire on ${next ?? 'the unnamed exit'}`, async () => {
        const answer = await postTest(request, {
          name: `V-CTRL-WAIT-UNTIL-FN-WIRES ${next ?? 'exit'} ${Date.now()}-${randomUUID().slice(0, 6)}`,
          nodes: [localFunctionBlock(FN_BLOCK, FN_LABEL, body(next))],
          edges: [{ id: 'e-fw-root', source: START, target: FN_BLOCK }],
        })
        expect(answer.status, `POST /tests answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBe(201)
        testIds.push(answer.id as string)

        const data = await storedBlock(request, answer.id as string, FN_BLOCK)
        const workflow = (data.localDefinition as { workflow: { edges: Wire[] } }).workflow
        expectStoredBody(workflow.edges, `Local Function, next on ${next ?? 'exit'}`)
        const repairs = JSON.stringify(answer.body?.repairs)
        expect(
          repairRows(answer.body),
          `the save response lists only the retry wire, with the Local Function as its path: ${repairs}`,
        ).toEqual(retryWireRepair([FN_BLOCK]))
      })
    }
  })

  test('POST /functions lists the removed retry wire in its repairs, with the path to the body that held it', async ({
    request,
  }) => {
    for (const where of PLACES) {
      await test.step(PLACE_TITLE[where], async () => {
        const flow = flowAt(where, body('then'))
        const answer = await postFunction(request, libraryFunction(functionName(`rep-${where}`), flow))
        if (answer.id) functionIds.push(answer.id)
        expect(answer.status, `POST /functions answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBe(201)

        expect(
          repairRows(answer.body),
          `POST /functions lists the removed retry wire the way POST /tests does: ${JSON.stringify(answer.body?.repairs)}`,
        ).toEqual(retryWireRepair(PATH_TO_BODY[where]))
        expectStoredBody(await storedFunctionEdges(request, answer.id as string, where), `library Function, ${where}`)
      })
    }
  })

  test('a new library version lists the removed retry wire in its repairs, with the path to the body that held it', async ({
    request,
  }) => {
    for (const where of PLACES) {
      await test.step(PLACE_TITLE[where], async () => {
        const name = functionName(`ver-${where}`)
        const pin = await createFunction(request, libraryFunction(name, flowAt(where, bodyWithoutRetryWire())))
        functionIds.push(pin.functionId)

        const answer = await postVersion(request, pin.functionId, name, flowAt(where, body('then')), '1.0.1')
        expect(
          answer.status,
          `POST /functions/${pin.functionId}/versions answered ${answer.status}: ${JSON.stringify(answer.body)}`,
        ).toBe(201)
        expect(
          repairRows(answer.body),
          `the new version lists the removed retry wire the way POST /tests does: ${JSON.stringify(answer.body?.repairs)}`,
        ).toEqual(retryWireRepair(PATH_TO_BODY[where]))
        expectStoredBody(
          await storedFunctionEdges(request, pin.functionId, where, '1.0.1'),
          `library version 1.0.1, ${where}`,
        )
      })
    }
  })

  test('POST /functions/batch lists the removed retry wire under each created Function', async ({ request }) => {
    const items = PLACES.map((where) => libraryFunction(functionName(`bat-${where}`), flowAt(where, body('then'))))
    const answer = await batchAnswerOf(await request.post(`${BACKEND_URL}/functions/batch`, { data: { items } }))
    const created = answer.created as Array<{ id?: string; name?: string }>
    for (const fn of created) if (fn.id) functionIds.push(fn.id)

    expect(answer.status, `POST /functions/batch answered ${answer.status}: ${answer.text}`).toBe(200)
    expect(answer.failed, `nothing failed: ${answer.text}`).toEqual([])
    expect(created.map((fn) => fn.name), 'both Functions are created in order').toEqual(items.map((item) => item.name))
    for (const [index, where] of PLACES.entries()) {
      await test.step(PLACE_TITLE[where], async () => {
        const id = String(created[index].id)
        expect(
          batchRepairRows(answer, id),
          `the batch lists the removed retry wire under the Function the way POST /functions does: ${answer.text}`,
        ).toEqual(retryWireRepair(PATH_TO_BODY[where]))
        expectStoredBody(await storedFunctionEdges(request, id, where), `library Function from the batch, ${where}`)
      })
    }
  })

  test('POST /tests/batch lists the removed retry wire under each created Test', async ({ request }) => {
    const payloads = LANES.map((next) => testPayload(`batch ${next ?? 'exit'}`, body(next)))
    const answer = await batchAnswerOf(await request.post(`${BACKEND_URL}/tests/batch`, { data: payloads }))
    const created = answer.created as string[]
    testIds.push(...created)

    expect(answer.status, `POST /tests/batch answered ${answer.status}: ${answer.text}`).toBe(201)
    expect(answer.failed, `nothing failed: ${answer.text}`).toEqual([])
    expect(created, `both Tests are created: ${answer.text}`).toHaveLength(LANES.length)
    for (const [index, next] of LANES.entries()) {
      await test.step(`Watch next wire on ${next ?? 'the unnamed exit'}`, async () => {
        expect(
          batchRepairRows(answer, created[index]),
          `the batch lists the removed retry wire under the Test the way POST /tests does: ${answer.text}`,
        ).toEqual(retryWireRepair([FN_BLOCK]))
        expectStoredBody(await storedLocalEdges(request, created[index]), `Test from the batch, next on ${next ?? 'exit'}`)
      })
    }
  })

  test('PATCH /tests/batch lists the removed retry wire under each updated Test', async ({ request }) => {
    const saved = await postTest(request, {
      name: `V-CTRL-WAIT-UNTIL-FN-WIRES patch ${Date.now()}-${randomUUID().slice(0, 6)}`,
      ...(testWorkflow(bodyWithoutRetryWire()) as { nodes: Rec[]; edges: Rec[] }),
    })
    expect(saved.status, `POST /tests answered ${saved.status}: ${JSON.stringify(saved.body)}`).toBe(201)
    const testId = saved.id as string
    testIds.push(testId)

    const update = [{ id: testId, update: { workflow: testWorkflow(body('then')) } }]
    const answer = await batchAnswerOf(await request.patch(`${BACKEND_URL}/tests/batch`, { data: update }))

    expect(answer.status, `PATCH /tests/batch answered ${answer.status}: ${answer.text}`).toBe(200)
    expect(answer.updated, `the Test is updated: ${answer.text}`).toEqual([testId])
    expect(
      batchRepairRows(answer, testId),
      `the batch lists the removed retry wire under the Test the way a single update does: ${answer.text}`,
    ).toEqual(retryWireRepair([FN_BLOCK]))
    expectStoredBody(await storedLocalEdges(request, testId), 'Test updated by the batch')
  })
})
