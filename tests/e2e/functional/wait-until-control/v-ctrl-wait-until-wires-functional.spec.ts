/**
 * V-CTRL-WAIT-UNTIL-WIRES-FUNCTIONAL: a Wait Until mode change keeps the wire to the next Block
 *
 * Design Decisions: WAIT-3
 * REQ: REQ-3.5.4.3 (Wait Until lanes and mode switch), REQ-5.2.4.3 (save pipeline repair reporting)
 *
 * Pass Criteria:
 * 1. Retry to Watch in the window: Save removes the retry lane and its wire, and the wire to the
 *    Log after the wait stays, drawn from the single exit Watch draws. The Test save reports no
 *    repair and stores that wire; reopened, the Test draws it and a run reaches the Log after it.
 * 2. A Test saved through the API in Watch mode with a retry wire and a next wire (create with the
 *    next wire on `then`, update with it on the unnamed exit) stores the next wire on the exit Watch
 *    draws, removes only the retry wire, and the save response lists only that removal.
 * 3. Watch to Retry in the window: the next wire stays and moves to the `then` lane, the retry lane
 *    holds no wire, the Test save stores the wire on `then`, and a run reaches the Log after it.
 * 4. A Test saved through the API with a Retry wait whose next wire names no lane (create with the
 *    retry wire beside it, update with no stored mode and the next wire alone) stores that wire on
 *    `then` and lists no repair; the canvas draws it from the `then` dot and a run reaches the Log.
 */

import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importFixtureTest } from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { getLogEntries } from '../../helpers/log-reader'
import {
  LANE_VIEWPORT,
  deleteTest,
  edgeOnCanvas,
  edgesFrom,
  expectDrawnFromLane,
  laneDot,
  nodeLocator,
  openConfig,
  openLaneCanvas,
  runToPass,
  saveCanvas,
  saveConfig,
  savedEdges,
  type SavedEdge,
} from '../canvas-lanes/lanes-helpers'

test.use({ viewport: LANE_VIEWPORT })

const START = 'start-node'
const WAIT = 'ww-wait'
const RETRY_LOG = 'ww-retry-log'
const AFTER_LOG = 'ww-after-log'
const RETRY_EDGE = 'e-ww-retry'
const NEXT_EDGE = 'e-ww-next'
const RETRY_TEXT = 'ww-retry-ran'
const AFTER_TEXT = 'ww-after-ran'

type WaitMode = 'retry' | 'watch'

interface FixtureEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  type?: string
}

interface FixtureNode {
  id: string
  data: { config: { values: Record<string, unknown> } }
}

interface WiresFixture extends Record<string, unknown> {
  name: string
  workflow: { nodes: FixtureNode[]; edges: FixtureEdge[] }
}

interface Repair {
  kind?: string
  id?: string
  message?: string
}

interface VariantOptions {
  /** The lane the wire to the Log after the wait leaves from; null is the unnamed exit. */
  next: 'then' | null
  /** Keep the retry Log and its wire on the retry lane. */
  retryWire: boolean
}

/** The seed with the Wait Until in `mode` and the wires `opts` asks for. */
function variant(mode: WaitMode, opts: VariantOptions): WiresFixture {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-watch-wires.json'), 'utf-8'),
  ) as WiresFixture
  const wait = fixture.workflow.nodes.find((n) => n.id === WAIT)
  expect(wait, 'the fixture holds the Wait Until').toBeTruthy()
  wait!.data.config.values.mode = mode
  if (!opts.retryWire) {
    fixture.workflow.nodes = fixture.workflow.nodes.filter((n) => n.id !== RETRY_LOG)
    fixture.workflow.edges = fixture.workflow.edges.filter((e) => e.id !== RETRY_EDGE)
  }
  fixture.workflow.edges = fixture.workflow.edges.map((e) => {
    if (e.id !== NEXT_EDGE) return e
    const next: FixtureEdge = { ...e }
    delete next.sourceHandle
    if (opts.next) next.sourceHandle = opts.next
    return next
  })
  return fixture
}

function uniqueName(base: string, tag: string): string {
  return `${base} ${tag} ${Date.now()}-${randomUUID().slice(0, 6)}`
}

/** Pick a Wait Mode in the Wait Until's window and Save the window. */
async function switchWaitMode(page: Page, mode: WaitMode): Promise<void> {
  const sheet = await openConfig(page, WAIT)
  await sheet.locator(`label[for="wait-mode-${mode}"]`).click()
  await expect(sheet.locator(`#wait-mode-${mode}`)).toHaveAttribute('data-state', 'checked')
  await saveConfig(sheet)
}

/** The canvas draws the wire to the Log after the wait, leaving `lane` (null: the single exit). */
async function expectNextWireDrawn(page: Page, lane: string | null): Promise<void> {
  await expect(
    edgeOnCanvas(page, WAIT, AFTER_LOG),
    `the canvas draws the wire ${WAIT} -> ${AFTER_LOG}`,
  ).toHaveCount(1)
  await expectDrawnFromLane(page, WAIT, lane, AFTER_LOG)
}

/** Toolbar Save; returns the repairs the Test save response lists. */
async function saveTestFromToolbar(page: Page, testId: string): Promise<Repair[]> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith(`/tests/${testId}`),
    ),
    saveCanvas(page),
  ])
  const body = (await response.json().catch(() => ({}))) as { repairs?: Repair[] }
  return body.repairs ?? []
}

/** The stored Test keeps the wire into the wait, and its only wire out leads to the Log after it on `lane`. */
function expectOnlyNextWire(edges: readonly SavedEdge[], lane: string | null): void {
  const out = edges.filter((e) => e.source === WAIT)
  const summary = JSON.stringify(out.map((e) => [e.sourceHandle ?? null, e.target]))
  expect(
    edges.filter((e) => e.target === WAIT).map((e) => e.source),
    'the stored Test keeps the wire into the Wait Until',
  ).toEqual([START])
  expect(
    out.map((e) => e.target),
    `the stored wires out of the Wait Until are the next wire only (lane, target): ${summary}`,
  ).toEqual([AFTER_LOG])
  expect(out[0].sourceHandle ?? null, `the stored next wire leaves lane ${lane ?? 'exit'}: ${summary}`).toBe(lane)
}

/** The stored Retry wait keeps its retry wire on `retry` and its next wire on `then`. */
function expectRetryLanes(edges: readonly SavedEdge[]): void {
  const out = edges.filter((e) => e.source === WAIT)
  expect(
    out.map((e) => [e.sourceHandle ?? null, e.target]).sort(),
    `the stored wires out of the Wait Until (lane, target): ${JSON.stringify(out)}`,
  ).toEqual([
    ['retry', RETRY_LOG],
    ['then', AFTER_LOG],
  ])
}

function expectOnlyRetryRepair(repairs: Repair[] | undefined): void {
  expect(
    (repairs ?? []).map((r) => [r.kind, r.id]),
    `the save response lists only the retry wire as removed: ${JSON.stringify(repairs)}`,
  ).toEqual([['edge', RETRY_EDGE]])
}

/** The stored Test is a Watch wait with only its next wire, on the exit Watch draws, and validates clean. */
async function expectStoredWatchWait(request: APIRequestContext, testId: string): Promise<void> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  const workflow = (body.data ?? body).workflow as { nodes: FixtureNode[]; edges: SavedEdge[] }
  const wait = workflow.nodes.find((n) => n.id === WAIT)
  expect(wait?.data.config.values.mode, 'the stored Wait Until is in Watch mode').toBe('watch')
  expectOnlyNextWire(workflow.edges, null)
  const validation = await validateTest(request, testId, 'run')
  expect(validation.errors, `the stored Test validates clean: ${JSON.stringify(validation.errors)}`).toEqual([])
}

/** A run reaches the Log after the wait: its line renders and the Block paints success. */
async function expectRunReachesAfterLog(page: Page): Promise<void> {
  await runToPass(page)
  await expect
    .poll(async () => (await getLogEntries(page)).map((e) => e.message), {
      timeout: 10_000,
      message: `the run reaches the Log after the Wait Until ("${AFTER_TEXT}")`,
    })
    .toContain(AFTER_TEXT)
  await expect(nodeLocator(page, AFTER_LOG)).toHaveAttribute('data-execution-status', 'success')
}

test.describe('V-CTRL-WAIT-UNTIL-WIRES-FUNCTIONAL: a mode change keeps the next wire', () => {
  test('Retry to Watch: the window Save drops only the retry wire, the save keeps the next wire, a run reaches the Log after the wait', async ({
    page,
    request,
  }) => {
    const testId = await importFixtureTest(page, variant('retry', { next: 'then', retryWire: true }), {
      rejectRepairs: true,
    })
    try {
      await openLaneCanvas(page, testId)

      await test.step('The seeded Retry wait draws its retry wire and its next wire', async () => {
        await expect(edgeOnCanvas(page, WAIT, RETRY_LOG)).toHaveCount(1)
        await expectDrawnFromLane(page, WAIT, 'retry', RETRY_LOG)
        await expectNextWireDrawn(page, 'then')
      })

      await test.step('Watch in the window: Save removes the retry lane and its wire, the next wire stays on the exit', async () => {
        await switchWaitMode(page, 'watch')
        await expect(laneDot(page, WAIT, 'retry'), 'Watch draws no retry lane').toHaveCount(0)
        await expect(edgeOnCanvas(page, WAIT, RETRY_LOG), 'the retry wire goes with its lane').toHaveCount(0)
        await expectNextWireDrawn(page, null)
      })

      await test.step('The Test save reports no repair and stores the next wire', async () => {
        const repairs = await saveTestFromToolbar(page, testId)
        expect(repairs, `the Test save repaired the canvas: ${JSON.stringify(repairs)}`).toEqual([])
        expectOnlyNextWire(await savedEdges(request, testId), null)
      })

      await test.step('Reopened, the Test draws the next wire and a run reaches the Log after the wait', async () => {
        await openLaneCanvas(page, testId)
        await expect(laneDot(page, WAIT, null), 'the reopened wait draws the single exit').toBeVisible()
        await expectNextWireDrawn(page, null)
        await expectRunReachesAfterLog(page)
        const messages = (await getLogEntries(page)).map((e) => e.message)
        expect(messages, 'a Watch wait never runs a retry lane').not.toContain(RETRY_TEXT)
      })
    } finally {
      await deleteTest(request, testId)
    }
  })

  test('API save of a Watch wait with a retry wire and a next wire keeps the next wire and reports only the retry wire', async ({
    page,
    request,
  }) => {
    const testIds: string[] = []
    try {
      await test.step('Create: POST /tests with the next wire on then', async () => {
        const fixture = variant('watch', { next: 'then', retryWire: true })
        const resp = await request.post(`${BACKEND_URL}/tests`, {
          data: { ...fixture, name: uniqueName(fixture.name, 'create') },
        })
        const body = await resp.json().catch(() => null)
        expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
        const testId = (body.data?.id ?? body.id) as string
        testIds.push(testId)
        expectOnlyRetryRepair(body.repairs)
        await expectStoredWatchWait(request, testId)
      })

      await test.step('Update: PUT /tests/{id} turns a Retry wait to Watch with the next wire on the exit', async () => {
        const testId = await importFixtureTest(page, variant('retry', { next: 'then', retryWire: true }), {
          rejectRepairs: true,
        })
        testIds.push(testId)
        const { workflow } = variant('watch', { next: null, retryWire: true })
        const resp = await request.put(`${BACKEND_URL}/tests/${testId}`, { data: { workflow } })
        const body = await resp.json().catch(() => null)
        expect(resp.ok(), `PUT /tests/${testId} failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
        expectOnlyRetryRepair(body.repairs)
        await expectStoredWatchWait(request, testId)
      })
    } finally {
      for (const testId of testIds) await deleteTest(request, testId)
    }
  })

  test('Watch to Retry: the window Save keeps the next wire on then, the save stores it there, a run reaches the Log after the wait', async ({
    page,
    request,
  }) => {
    const testId = await importFixtureTest(page, variant('watch', { next: null, retryWire: false }), {
      rejectRepairs: true,
    })
    try {
      await openLaneCanvas(page, testId)

      await test.step('The seeded Watch wait draws its next wire from the single exit', async () => {
        await expectNextWireDrawn(page, null)
      })

      await test.step('Retry in the window: Save adds the retry lane and the next wire moves to then', async () => {
        await switchWaitMode(page, 'retry')
        await expect(laneDot(page, WAIT, 'retry'), 'Retry draws the retry lane').toBeVisible()
        await expectNextWireDrawn(page, 'then')
        await expect(edgesFrom(page, WAIT), 'the new retry lane holds no wire').toHaveCount(1)
      })

      await test.step('The Test save reports no repair and stores the next wire on then', async () => {
        const repairs = await saveTestFromToolbar(page, testId)
        expect(repairs, `the Test save repaired the canvas: ${JSON.stringify(repairs)}`).toEqual([])
        expectOnlyNextWire(await savedEdges(request, testId), 'then')
      })

      await test.step('Reopened, the Test draws the next wire on then and a run reaches the Log after the wait', async () => {
        await openLaneCanvas(page, testId)
        await expect(laneDot(page, WAIT, 'retry'), 'the reopened wait draws the retry lane').toBeVisible()
        await expectNextWireDrawn(page, 'then')
        await expectRunReachesAfterLog(page)
      })
    } finally {
      await deleteTest(request, testId)
    }
  })

  test('API save of a Retry wait whose next wire names no lane stores it on then, and the canvas draws it from the then dot', async ({
    page,
    request,
  }) => {
    const testIds: string[] = []
    try {
      await test.step('Create: POST /tests with the retry wire and the next wire on no lane', async () => {
        const fixture = variant('retry', { next: null, retryWire: true })
        const resp = await request.post(`${BACKEND_URL}/tests`, {
          data: { ...fixture, name: uniqueName(fixture.name, 'retry-create') },
        })
        const body = await resp.json().catch(() => null)
        expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
        testIds.push((body.data?.id ?? body.id) as string)
        expectRetryLanes(await savedEdges(request, testIds[0]))
        expect(body.repairs ?? [], 'moving a wire to the lane its mode draws is not a removal').toEqual([])
      })

      await test.step('Update: PUT /tests/{id} with no stored mode and the next wire alone on no lane', async () => {
        const testId = await importFixtureTest(page, variant('retry', { next: 'then', retryWire: false }), {
          rejectRepairs: true,
        })
        testIds.push(testId)
        const { workflow } = variant('retry', { next: null, retryWire: false })
        const wait = workflow.nodes.find((n) => n.id === WAIT)
        delete wait!.data.config.values.mode
        const resp = await request.put(`${BACKEND_URL}/tests/${testId}`, { data: { workflow } })
        const body = await resp.json().catch(() => null)
        expect(resp.ok(), `PUT /tests/${testId} failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
        expectOnlyNextWire(await savedEdges(request, testId), 'then')
        expect(body.repairs ?? [], 'moving a wire to the lane its mode draws is not a removal').toEqual([])
        const validation = await validateTest(request, testId, 'run')
        expect(validation.errors, `the stored Test validates clean: ${JSON.stringify(validation.errors)}`).toEqual([])
      })

      await test.step('The canvas draws the next wire from the then dot and a run reaches the Log after the wait', async () => {
        await openLaneCanvas(page, testIds[0])
        await expect(laneDot(page, WAIT, 'retry'), 'the Retry wait draws the retry lane').toBeVisible()
        await expectDrawnFromLane(page, WAIT, 'retry', RETRY_LOG)
        await expectNextWireDrawn(page, 'then')
        await expectRunReachesAfterLog(page)
        const messages = (await getLogEntries(page)).map((e) => e.message)
        expect(messages, 'a condition that holds at the first check runs no retry lane').not.toContain(RETRY_TEXT)
      })
    } finally {
      for (const testId of testIds) await deleteTest(request, testId)
    }
  })
})
