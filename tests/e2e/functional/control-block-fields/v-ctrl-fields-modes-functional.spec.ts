/**
 * V-CTRL-FIELDS-MODES: mode sections, lanes a Save takes away, the Note and a null For Count, saved and run
 * Design Decisions: FIELD-5, FIELD-8, WAIT-3, PARALLEL-3
 * REQ: REQ-3.5.1.11, REQ-3.5.4.3, REQ-3.2.3.6, REQ-3.5.1.2, REQ-3.5.1.3, REQ-3.5.1.15, REQ-3.5.0.3, REQ-3.5.1.1
 *
 * `fixture-modes.json` chains a For (a Continue and a Break in its body), a Try / Catch / Finally with Catch
 * wired, a Parallel, a Wait Until with a `retry` lane, a Note, an If/Else with IF, ELSE IF and ELSE each wired
 * to a Log, and a split Assert; it stores none of their choices.
 *
 * Pass Criteria:
 * 1. Branching Mode (`#mode-single` / `#mode-split`, `fail-current-scope`), Wait Mode (`#wait-mode-*`,
 *    `wait-fail-current-scope`), JOIN MODE (`#join-mode-*`) and Target Loop (`#target-loop-select`) keep their ids;
 *    a window Save writes every untouched choice with its default under `config.values`: Assert `mode: split`,
 *    `fail_current_scope: false`; Wait Until `mode: retry`, `fail_current_scope: false`; Try / Catch
 *    `enable_catch: true`, `enable_finally: false`; Parallel `join: all`; Break and Continue keep `target_loop`
 *    under `config.values`; no choice is stored beside `config.values`.
 * 2. Wait Until Retry to Watch, then Save: no stored edge leaves `retry` or `then`; the retry lane's edge is gone and
 *    the edge to the Log after the wait is the single exit Watch draws.
 * 3. Try / Catch with Catch turned off, then Save: the `catch` edge is gone, `try` and `then` stay.
 * 4. An Assert mode change, then Save: every edge out of the Assert is gone; no other stored edge changes.
 * 5. If/Else with ELSE IF deleted, then Save: the stored edges lose only the ELSE IF edge; the canvas draws no link
 *    from the gone lane and draws IF and ELSE from their own dots.
 * 6. Note text typed inline and a color picked store at `config.values.text` / `config.values.color` and nothing
 *    at `config.text` / `config.color`; the Note shows the text in the picked color.
 * 7. For Count: the null button stores `count: null`; the Test saves and the run passes with the loop body run
 *    zero times.
 * 8. A Watch Wait Until stored through `POST /tests` with a `retry` edge and its single exit wired to a Log: the save
 *    takes out only the retry edge, and the run passes through that Log and never runs the retry lane.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { importFixtureTest } from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { formatEntries } from '../../helpers/log-reader'
import { paramRow } from '../../helpers/config-sheet'
import { nullButton } from '../../helpers/value-field'
import { openBlockSheet, runToEnd, saveBlockSheet, saveTest, selectEnvironment } from '../../helpers/workbench'
import {
  LANE_VIEWPORT,
  edgeOnCanvas,
  edgesFrom,
  expectDrawnFromLane,
  laneDot,
  openLaneCanvas,
} from '../canvas-lanes/lanes-helpers'
import {
  deleteStoredTest,
  edgesBesides,
  lanesOut,
  loadFixture,
  nodeOf,
  storedWorkflow,
  valuesOf,
  type StoredWorkflow,
} from './stored-blocks'

test.use({ viewport: LANE_VIEWPORT })

const FOR = '5d2501d2-c0f2-43e7-b229-97b473933a25'
const FOR_LOG = '8b565212-24d5-4596-b355-65fa3bf0bc0e'
const CONTINUE = 'be23bae7-cc60-4b28-9994-f5bd88d68ea8'
const BREAK = '55a4cc1e-7412-46c8-84a3-382682cc47c2'
const TRY_CATCH = '89ac798b-3532-4c5f-b30f-664ad6066433'
const TRY_LOG = 'b7c21b0f-412f-4ec1-805c-b0c9e2b206c0'
const PARALLEL = 'ba98f041-43a9-4f03-838f-f1a19273a315'
const WAIT = '5dc04e27-d0c6-4d88-a38e-f9561fc455a5'
const RETRY_LOG = '8d83f9e4-ce2f-45e8-8437-b2a88b027ca9'
const WAIT_THEN_LOG = 'b38ef4c1-f06f-4b7c-af59-3f1158cbd20c'
const NOTE = 'aed80ae3-654d-4ce8-bedc-6cda17facbf6'
const IF_ELSE = '79ce438f-ba88-4763-8374-c486ca5e3bbf'
const IF_LOG = '1293e85d-06cc-4d27-a90f-8fcdb244ce99'
const ELIF_LOG = 'f2b4ce6d-ba05-429d-9712-2a7c1dfd2f3f'
const ELSE_LOG = 'd00867ec-e533-44d3-9d50-c22a706ecb11'
const ASSERT = '2c32a607-213e-48c0-9a88-dea402f9ff64'
const RETRY_EDGE = 'e-modes-wait-retry'
const WAIT_THEN_EDGE = 'e-modes-wait-then'
const FOR_LABEL = 'Count loop'

interface FixtureNode {
  id: string
  data: { config: { values: Record<string, unknown> } }
}

interface FixtureEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

interface ModesFixture extends Record<string, unknown> {
  name: string
  workflow: { nodes: FixtureNode[]; edges: FixtureEdge[] }
}

const modesFixture = (): ModesFixture => loadFixture('fixture-modes.json') as ModesFixture

/** Import the fixture with no repair and open it on the large lane canvas. */
async function openModes(page: Page): Promise<string> {
  const testId = await importFixtureTest(page, modesFixture(), { rejectRepairs: true })
  await openLaneCanvas(page, testId)
  return testId
}

async function renameBlock(sheet: Locator, name: string): Promise<void> {
  const box = sheet.getByTestId('element-name-input')
  await box.fill(name)
  await expect(box).toHaveValue(name)
}

const checkboxOf = (sheet: Locator, name: string): Locator => paramRow(sheet, name).locator('button[role="checkbox"]')

async function expectChecked(target: Locator, checked: boolean): Promise<void> {
  await expect(target).toHaveAttribute('data-state', checked ? 'checked' : 'unchecked')
}

const CHOICE_KEYS = ['mode', 'fail_current_scope', 'enable_catch', 'enable_finally', 'join', 'target_loop']

/** The choice keys a Block holds beside `config.values`, in `config` or in `data`. */
function choiceKeysBesideValues(workflow: StoredWorkflow, id: string): string[] {
  const { data } = nodeOf(workflow, id)
  return [...Object.keys(data.config), ...Object.keys(data)].filter((key) => CHOICE_KEYS.includes(key))
}

async function expectRunPasses(page: Page): Promise<string[]> {
  await selectEnvironment(page)
  const { verdict, entries } = await runToEnd(page)
  expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
  return entries.map((e) => e.message)
}

async function expectStoredValid(request: APIRequestContext, testId: string): Promise<void> {
  const { errors } = await validateTest(request, testId, 'run')
  expect(errors, `the stored Test validates clean: ${JSON.stringify(errors)}`).toEqual([])
}

test.describe('V-CTRL-FIELDS-MODES: mode sections, lanes and Note on the shared value path', () => {
  test('mode sections keep their ids and a window Save writes each untouched choice with its default', async ({
    page,
    request,
  }) => {
    const testId = await openModes(page)
    try {
      await test.step('the stored Test holds none of the choices', async () => {
        const seeded = await storedWorkflow(request, testId)
        expect(Object.keys(valuesOf(seeded, ASSERT))).toEqual(['assertions'])
        expect(Object.keys(valuesOf(seeded, WAIT)).sort()).toEqual(['check_interval', 'conditions', 'timeout'])
        expect(Object.keys(valuesOf(seeded, TRY_CATCH))).toEqual([])
        expect(Object.keys(valuesOf(seeded, PARALLEL))).toEqual(['branches'])
      })

      await test.step('Assert: Branching Mode shows Split, Fail Current Scope unticked', async () => {
        const sheet = await openBlockSheet(page, ASSERT)
        await expectChecked(sheet.locator('#mode-split'), true)
        await expectChecked(sheet.locator('#mode-single'), false)
        await expectChecked(sheet.locator('#fail-current-scope'), false)
        await renameBlock(sheet, 'Assert ready')
        await saveBlockSheet(sheet)
      })

      await test.step('Wait Until: Wait Mode shows Retry, Fail Current Scope unticked', async () => {
        const sheet = await openBlockSheet(page, WAIT)
        await expectChecked(sheet.locator('#wait-mode-retry'), true)
        await expectChecked(sheet.locator('#wait-mode-watch'), false)
        await expectChecked(sheet.locator('#wait-fail-current-scope'), false)
        await renameBlock(sheet, 'Wait ready')
        await saveBlockSheet(sheet)
      })

      await test.step('Try / Catch: Catch ticked, Finally unticked', async () => {
        const sheet = await openBlockSheet(page, TRY_CATCH)
        await expectChecked(checkboxOf(sheet, 'enable_catch'), true)
        await expectChecked(checkboxOf(sheet, 'enable_finally'), false)
        await renameBlock(sheet, 'Guard ready')
        await saveBlockSheet(sheet)
      })

      await test.step('Parallel: JOIN MODE shows Wait for all', async () => {
        const sheet = await openBlockSheet(page, PARALLEL)
        await expectChecked(sheet.locator('#join-mode-all'), true)
        await expectChecked(sheet.locator('#join-mode-first'), false)
        await renameBlock(sheet, 'Fan out ready')
        await saveBlockSheet(sheet)
      })

      for (const [id, name] of [
        [BREAK, 'Break ready'],
        [CONTINUE, 'Continue ready'],
      ] as const) {
        await test.step(`${name}: Target Loop shows the For`, async () => {
          const sheet = await openBlockSheet(page, id)
          await expect(sheet.locator('#target-loop-select')).toContainText(FOR_LABEL)
          await renameBlock(sheet, name)
          await saveBlockSheet(sheet)
        })
      }

      await test.step('the saved Test holds every choice with its default under config.values', async () => {
        await saveTest(page)
        const saved = await storedWorkflow(request, testId)
        expect(valuesOf(saved, ASSERT)).toMatchObject({ mode: 'split', fail_current_scope: false })
        expect(valuesOf(saved, WAIT)).toMatchObject({ mode: 'retry', fail_current_scope: false })
        expect(valuesOf(saved, TRY_CATCH)).toEqual({ enable_catch: true, enable_finally: false })
        expect(valuesOf(saved, PARALLEL)).toMatchObject({ join: 'all' })
        expect(valuesOf(saved, BREAK)).toEqual({ target_loop: FOR })
        expect(valuesOf(saved, CONTINUE)).toEqual({ target_loop: FOR })
        for (const id of [ASSERT, WAIT, TRY_CATCH, PARALLEL, BREAK, CONTINUE]) {
          expect(choiceKeysBesideValues(saved, id), `Block ${id} stores its choices only under config.values`).toEqual([])
        }
        await expectStoredValid(request, testId)
      })
    } finally {
      await deleteStoredTest(request, testId)
    }
  })

  test('a Wait Mode, Catch or Assert mode change drops only the edges of the lanes it takes away', async ({
    page,
    request,
  }) => {
    const testId = await openModes(page)
    try {
      const seeded = await storedWorkflow(request, testId)

      await test.step('Wait Until: Retry to Watch', async () => {
        const sheet = await openBlockSheet(page, WAIT)
        await sheet.locator('label[for="wait-mode-watch"]').click()
        await expectChecked(sheet.locator('#wait-mode-watch'), true)
        await saveBlockSheet(sheet)
      })

      await test.step('Try / Catch: Catch off', async () => {
        const sheet = await openBlockSheet(page, TRY_CATCH)
        await checkboxOf(sheet, 'enable_catch').click()
        await expectChecked(checkboxOf(sheet, 'enable_catch'), false)
        await saveBlockSheet(sheet)
      })

      await test.step('Assert: Split to Single', async () => {
        const sheet = await openBlockSheet(page, ASSERT)
        await sheet.locator('label[for="mode-single"]').click()
        await expectChecked(sheet.locator('#mode-single'), true)
        await saveBlockSheet(sheet)
      })

      await test.step('the stored edges lose only the lanes the changes took away', async () => {
        await saveTest(page)
        const saved = await storedWorkflow(request, testId)
        expect(valuesOf(saved, WAIT).mode).toBe('watch')
        expect(valuesOf(saved, TRY_CATCH).enable_catch).toBe(false)
        expect(valuesOf(saved, ASSERT).mode).toBe('single')

        expect(lanesOut(saved, WAIT), 'Watch keeps only the edge to the Log after the wait, on its single exit').toEqual([
          [null, WAIT_THEN_LOG],
        ])
        expect(saved.edges.map((e) => e.id), 'the retry lane edge is gone').not.toContain(RETRY_EDGE)
        expect(lanesOut(saved, TRY_CATCH), 'Catch off takes out the catch edge only').toEqual([
          ['then', PARALLEL],
          ['try', TRY_LOG],
        ])
        expect(lanesOut(saved, ASSERT), 'an Assert mode change takes out every edge of the Assert').toEqual([])
        expect(edgesBesides(saved, [WAIT, TRY_CATCH, ASSERT]), 'no other stored edge changes').toEqual(
          edgesBesides(seeded, [WAIT, TRY_CATCH, ASSERT]),
        )
        await expectStoredValid(request, testId)
      })
    } finally {
      await deleteStoredTest(request, testId)
    }
  })

  test('If/Else: deleting ELSE IF drops only its edge and the canvas draws no link from the gone lane', async ({
    page,
    request,
  }) => {
    const testId = await openModes(page)
    try {
      const seeded = await storedWorkflow(request, testId)
      expect(lanesOut(seeded, IF_ELSE)).toEqual([
        ['branch_elif', ELIF_LOG],
        ['branch_else', ELSE_LOG],
        ['branch_if', IF_LOG],
      ])

      await test.step('delete ELSE IF in the window and Save it', async () => {
        await expect(edgeOnCanvas(page, IF_ELSE, ELIF_LOG)).toHaveCount(1)
        const sheet = await openBlockSheet(page, IF_ELSE)
        await sheet.getByTestId('branch-delete-branch_elif').click()
        await expect(sheet.getByTestId('branch-card-branch_elif')).toHaveCount(0)
        await saveBlockSheet(sheet)
      })

      await test.step('the canvas draws no link from the gone lane; IF and ELSE keep theirs', async () => {
        await expect(laneDot(page, IF_ELSE, 'branch_elif'), 'the ELSE IF lane is gone').toHaveCount(0)
        await expect(edgeOnCanvas(page, IF_ELSE, ELIF_LOG), 'no link from the gone lane').toHaveCount(0)
        await expect(edgesFrom(page, IF_ELSE), 'only the IF and ELSE links leave the If/Else').toHaveCount(2)
        await expectDrawnFromLane(page, IF_ELSE, 'branch_if', IF_LOG)
        await expectDrawnFromLane(page, IF_ELSE, 'branch_else', ELSE_LOG)
      })

      await test.step('the stored edges lose only the ELSE IF edge', async () => {
        await saveTest(page)
        const saved = await storedWorkflow(request, testId)
        const branches = valuesOf(saved, IF_ELSE).branches as Array<{ id: string }>
        expect(branches.map((b) => b.id)).toEqual(['branch_if', 'branch_else'])
        expect(lanesOut(saved, IF_ELSE)).toEqual([
          ['branch_else', ELSE_LOG],
          ['branch_if', IF_LOG],
        ])
        expect(edgesBesides(saved, [IF_ELSE]), 'no other stored edge changes').toEqual(edgesBesides(seeded, [IF_ELSE]))
        await expectStoredValid(request, testId)
      })
    } finally {
      await deleteStoredTest(request, testId)
    }
  })

  test('Note text and color store under config.values; a null For Count saves and the loop runs zero times', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const testId = await openModes(page)
    try {
      const note = page.getByTestId(`note-node-${NOTE}`)

      await test.step('Note: type the text inline', async () => {
        await note.getByTestId('note-text-display').dblclick()
        const editor = note.getByTestId('note-text-editor')
        await expect(editor).toBeVisible()
        await editor.fill('Modes note edited')
        await note.getByTestId('note-edit-accept').click()
        await expect(note.getByTestId('note-text-display')).toHaveText('Modes note edited')
      })

      await test.step('Note: pick a color', async () => {
        await note.getByTestId('note-text-display').dblclick()
        await expect(note.getByTestId('note-text-editor')).toBeVisible()
        await note.getByTestId('note-color-picker').click()
        await page.getByTestId('note-color-green').click()
        await note.getByTestId('note-edit-accept').click()
        await expect(note.getByTestId('note-text-display')).toHaveText('Modes note edited')
        await expect(note.locator('.bg-green-50'), 'the Note shows the picked color').toHaveCount(1)
      })

      await test.step('For: the null button on Count', async () => {
        const sheet = await openBlockSheet(page, FOR)
        await nullButton(sheet, 'count').click()
        await expect(nullButton(sheet, 'count')).toHaveAttribute('aria-pressed', 'true')
        await saveBlockSheet(sheet)
      })

      await test.step('the Test saves with the Note under config.values and count null', async () => {
        await saveTest(page)
        const saved = await storedWorkflow(request, testId)
        const noteConfig = nodeOf(saved, NOTE).data.config
        expect(noteConfig.values).toEqual({ text: 'Modes note edited', color: 'green' })
        expect(noteConfig, 'nothing at config.text').not.toHaveProperty('text')
        expect(noteConfig, 'nothing at config.color').not.toHaveProperty('color')
        const forValues = valuesOf(saved, FOR)
        expect(Object.hasOwn(forValues, 'count'), 'count is stored').toBe(true)
        expect(forValues.count, 'count is stored as null').toBeNull()
        await expectStoredValid(request, testId)
      })

      await test.step('the run passes and the loop body runs zero times', async () => {
        const messages = await expectRunPasses(page)
        expect(messages, 'the loop body never runs').not.toContain('for=body')
        for (const line of ['try=ran', 'lane=one', 'lane=two', 'wait=then', 'if=if', 'assert=pass']) {
          expect(messages, `the run reaches ${line}`).toContain(line)
        }
        await expectNodeStatus(page, FOR, 'success')
        await expect(page.getByTestId(`workflow-node-${FOR_LOG}`)).not.toHaveAttribute('data-execution-status', 'success')
      })
    } finally {
      await deleteStoredTest(request, testId)
    }
  })

  test('a Watch Wait Until stored with a retry edge never runs the retry lane and runs the Log on its exit', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const base = modesFixture()
    const keep = new Set([WAIT, RETRY_LOG, WAIT_THEN_LOG])
    const nodes = base.workflow.nodes.filter((n) => keep.has(n.id))
    nodes.find((n) => n.id === WAIT)!.data.config.values.mode = 'watch'
    const edges: FixtureEdge[] = [
      { id: 'e-watch-start', source: 'start-node', target: WAIT },
      ...base.workflow.edges.filter((e) => e.id === RETRY_EDGE),
      { id: WAIT_THEN_EDGE, source: WAIT, target: WAIT_THEN_LOG },
    ]
    await ensureEnvironment(request)
    const resp = await request.post(`${BACKEND_URL}/tests`, {
      data: {
        ...base,
        name: `zz-ctrl-fields-modes-2 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        workflow: { nodes, edges },
      },
    })
    const body = await resp.json().catch(() => null)
    expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
    const testId = (body.data?.id ?? body.id) as string
    try {
      await test.step('the save takes out only the retry edge', async () => {
        const repairs = (body.repairs ?? []) as Array<{ kind?: string; id?: string }>
        expect(repairs.map((r) => [r.kind, r.id]), `the repairs: ${JSON.stringify(repairs)}`).toEqual([['edge', RETRY_EDGE]])
        const stored = await storedWorkflow(request, testId)
        expect(valuesOf(stored, WAIT).mode).toBe('watch')
        expect(lanesOut(stored, WAIT), 'the single exit keeps its Log').toEqual([[null, WAIT_THEN_LOG]])
        await expectStoredValid(request, testId)
      })

      await test.step('the run passes through the Log on the exit and never runs the retry lane', async () => {
        await openLaneCanvas(page, testId)
        const messages = await expectRunPasses(page)
        expect(messages, 'the Log on the exit runs').toContain('wait=then')
        expect(messages, 'the retry lane never runs').not.toContain('wait=retry')
        await expectNodeStatus(page, WAIT_THEN_LOG, 'success')
        await expect(page.getByTestId(`workflow-node-${RETRY_LOG}`)).not.toHaveAttribute('data-execution-status', 'success')
      })
    } finally {
      await deleteStoredTest(request, testId)
    }
  })
})
