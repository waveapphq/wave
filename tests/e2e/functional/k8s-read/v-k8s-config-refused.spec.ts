/**
 * V-K8S-CONFIG-REFUSED (R8): the pre-run gate refuses a half-filled read Block.
 *
 * The file starts no executions except one deliberate control run, so it is the
 * cheapest in the k8s-read set and needs no cluster objects.
 *
 * What it proves:
 *   - the three unconditional holes: S-02 (`session`), L-02 (`pod`) and, on
 *     Logs, `container` - L-03 and L-04 both, since Container is required and
 *     the gate never looks at the pod, so a single-container pod and a
 *     multi-container one are refused alike
 *   - the conditional holes: G-38 (`name` in Name mode),
 *     E-06 (`object_name` while scoping), T-07 (`name` under Select by Name),
 *     Get's `kind_custom`, and the conjunctive Events custom-kind case
 *     (`object_kind_custom`); Get's `kind` and Events' `object_kind` (E-07) are
 *     not holes: left out, the run takes their default `Pod` (REQ-3.4.2.3)
 *   - both routes into the gate, because they are different code paths: the
 *     saved copy (persisted through the admin bulk route, since POST /tests and
 *     PUT /tests/{id} both answer 422 for these holes) and the dirty canvas
 *   - the negatives: with the condition NOT holding, the same empty field saves
 *     and passes the run gate, so this file would still pass if the gate
 *     refused everything without them
 *   - the dirty-canvas route in full, including that a
 *     VALID dirty canvas still runs with no false block
 *   - the same half-filled read Block inside a Local Function body is refused
 *     too
 *
 * The gate never calls a plugin's `validate()`, so the positivity refusals
 * (S-07, E-30, E-31, L-14, L-18, L-26) and the impersonation pairing (S-18)
 * are NOT gate refusals and are not covered here - they are run-time legs.
 *
 * Attribution: nothing runs, so there is no console to stamp. Every leg carries
 * its option id in the Block's `data.description`, in the test title, and in
 * the message of every assertion it makes.
 *
 * Design Decisions: K8SREAD-1, K8SREAD-2, K8SREAD-11, K8SREAD-20
 * REQ: REQ-3.1.2.4
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { importExpectingErrors } from '../../helpers/fixture-import'
import {
  VALIDATION,
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  postTestStatus,
  validateTest,
} from '../../helpers/fn-seed'
import {
  chainEdges,
  markerNode,
  stackNodes,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { ensureEnvironment } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'
import { finishRun, startRun } from '../../helpers/k8s-run'
import {
  HOLE_CASES,
  K8S_READ_LABEL,
  NEGATIVE_CASES,
  caseNodeId,
  emptyMessage,
  holeNode,
  missingMessage,
  negativeNode,
} from './cases-refused'

const RUN_DIALOG_TITLE = 'Cannot Run Test'
const RUN_STATUS = '[data-testid="workflow-status"]'
const RUN_BUTTON = '[data-testid="run-button"]'
const REQUIRED_PREFIX = 'Required parameter'

/** A unique Test name, so a re-run never collides with a leftover record. */
function uniqueName(leg: string): string {
  return `V-K8S-CONFIG-REFUSED ${leg} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** The same Block, saved switched off. A switched-off Block is skipped by both
 *  halves of the gate, which is what lets the holed workflow save at all. */
function switchedOff(node: WorkflowNode): WorkflowNode {
  return { ...node, data: { ...node.data, disabled: true } }
}

/** One workflow carrying every hole, in case-table order. */
function holeNodes(): WorkflowNode[] {
  return stackNodes(HOLE_CASES.map((hole) => holeNode(hole)))
}

function holeEdges(): WorkflowEdge[] {
  return chainEdges(HOLE_CASES.map((hole) => caseNodeId(hole.id)))
}

/** What the dialog must show for one hole. The Block name and the message are
 *  separate pieces the dialog composes, not one backend string. */
interface ExpectedRow {
  leaf: string
  message: string
}

function expectedRows(): ExpectedRow[] {
  return HOLE_CASES.map((hole) => ({
    leaf: K8S_READ_LABEL[hole.elementType],
    message: missingMessage(hole.param),
  }))
}

interface DialogRow extends ExpectedRow {
  /** The enclosing-Function trail, empty for a top-level Block. */
  trail: string[]
}

/** Read the dialog's rows piece by piece: the trail buttons, the leaf button
 *  and the message span, ignoring the decorative separators between them. */
async function readDialogRows(page: Page): Promise<DialogRow[]> {
  const rows = page.locator(`${VALIDATION.list} tbody tr`)
  const total = await rows.count()
  const out: DialogRow[] = []
  for (let index = 0; index < total; index++) {
    const cell = rows.nth(index).locator('td div').first()
    const buttons = (await cell.locator('button').allInnerTexts()).map((text) => text.trim())
    const message = (await cell.locator('span').last().innerText()).trim()
    out.push({ trail: buttons.slice(0, -1), leaf: buttons[buttons.length - 1] ?? '', message })
  }
  return out
}

function sortRows(rows: readonly ExpectedRow[]): ExpectedRow[] {
  return [...rows].sort((a, b) => `${a.leaf} ${a.message}`.localeCompare(`${b.leaf} ${b.message}`))
}

function plainRows(rows: readonly DialogRow[]): ExpectedRow[] {
  return rows.map(({ leaf, message }) => ({ leaf, message }))
}

/** Press Run and assert the gate blocked it. Returns the dialog locator. */
async function runAndExpectBlocked(page: Page) {
  await selectEnvironment(page)
  await page.locator(RUN_BUTTON).click()
  const dialog = page.locator(VALIDATION.dialog)
  await expect(dialog, 'the pre-run gate must open the validation dialog').toBeVisible({
    timeout: 10_000,
  })
  await expect(dialog).toContainText(RUN_DIALOG_TITLE)
  await expect(
    page.locator(RUN_STATUS),
    'no execution may start when the gate refuses',
  ).toHaveAttribute('data-status', 'idle')
  return dialog
}

/** Right-click the empty canvas and switch every Block back on. One action
 *  makes the canvas dirty and puts every hole into the in-memory body. */
async function enableAllOnCanvas(page: Page): Promise<void> {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  expect(box, 'the canvas must be on screen').toBeTruthy()
  const menu = page.locator('[role="menu"]')
  // Retry the open: under load a transient canvas overlay can swallow the first
  // right-click, the same way the node kebab helper guards its own open.
  await expect(async () => {
    await page.mouse.click(box!.x + box!.width - 50, box!.y + 50, { button: 'right' })
    await expect(menu).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await menu.getByText('Enable All').click()
  await expect(menu).toBeHidden()
}

test.describe('V-K8S-CONFIG-REFUSED: the pre-run gate refuses a half-filled read Block', () => {
  test('the golden fixture and the case table emit the same node shape', async () => {
    const golden = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, 'fixture-refused-golden.json'), 'utf-8'),
    ) as { workflow: { nodes: unknown[]; edges: unknown[] } }
    const goldenIds = ['G-38', 'E-06', 'L-02', 'T-07']
    const cases = goldenIds.map((id) => {
      const found = HOLE_CASES.find((hole) => hole.id === id)
      expect(found, `case ${id} must be in the case table`).toBeTruthy()
      return found!
    })
    expect(golden.workflow.nodes).toEqual(stackNodes(cases.map((hole) => holeNode(hole))))
    expect(golden.workflow.edges).toEqual(chainEdges(cases.map((hole) => caseNodeId(hole.id))))
  })

  test('a saved Test carrying every hole is refused before the run, one row per hole', async ({
    page,
  }) => {
    // The ordinary write path cannot seed this, which is why the fixture is
    // persisted through the admin bulk route.
    expect(
      await postTestStatus(page.request, {
        name: uniqueName('saved-probe'),
        nodes: holeNodes(),
        edges: holeEdges(),
      }),
      'POST /tests must refuse a workflow carrying these holes',
    ).toBe(422)

    const result = await importExpectingErrors(page, {
      name: uniqueName('saved'),
      workflow: { nodes: holeNodes(), edges: holeEdges() },
      variables: {},
    })

    expect(result.status, 'the run gate must refuse the saved copy').toBe(422)
    expect(result.errorCode).toBe('VALIDATION_ERRORS')
    expect(
      result.errors.length,
      `the gate must list every invalid Block at once: ${JSON.stringify(result.errors)}`,
    ).toBe(HOLE_CASES.length)

    const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)
    const apiRows = result.errors
      .map((entry) => ({
        code: String(entry.code),
        label: String(entry.node_label),
        elementType: String(entry.element_type),
        message: String(entry.message),
        path: String(entry.path),
      }))
      .sort(byPath)
    const expectedApiRows = HOLE_CASES.map((hole, index) => ({
      code: 'REQUIRED_PARAM_MISSING',
      label: K8S_READ_LABEL[hole.elementType],
      elementType: hole.elementType as string,
      message: missingMessage(hole.param),
      path: `nodes[${index}].data.config.values.${hole.param}`,
    })).sort(byPath)
    expect(apiRows).toEqual(expectedApiRows)

    const dialog = await runAndExpectBlocked(page)
    await expect(dialog.locator(VALIDATION.count)).toHaveText(String(HOLE_CASES.length))
    const rows = await readDialogRows(page)
    expect(rows.map((row) => row.trail)).toEqual(HOLE_CASES.map(() => []))
    expect(sortRows(plainRows(rows))).toEqual(sortRows(expectedRows()))
  })

  test('DIRTY-CANVAS: the same holes built on a dirty canvas are refused and the run never starts', async ({
    page,
  }) => {
    await ensureEnvironment(page.request)
    const marker = markerNode({
      id: 'dirty-head',
      description: 'DIRTY-CANVAS head',
      text: 'R8 DIRTY HEAD',
    })
    const testId = await createValidTest(page.request, {
      name: uniqueName('dirty'),
      nodes: stackNodes([marker, ...holeNodes().map(switchedOff)]),
      edges: chainEdges(['dirty-head', ...HOLE_CASES.map((hole) => caseNodeId(hole.id))]),
    })

    // The saved copy is legal: a switched-off Block is skipped by both halves.
    const saved = await validateTest(page.request, testId, 'run')
    expect(saved.status, 'the saved copy must pass the gate').toBe(200)
    expect(saved.errors).toEqual([])

    await openTest(page, testId)
    await enableAllOnCanvas(page)

    const dialog = await runAndExpectBlocked(page)
    await expect(dialog.locator(VALIDATION.count)).toHaveText(String(HOLE_CASES.length))
    expect(sortRows(plainRows(await readDialogRows(page)))).toEqual(sortRows(expectedRows()))
  })

  test('DIRTY-CANVAS regression trap: a valid dirty canvas still runs with no false block', async ({
    page,
  }) => {
    await ensureEnvironment(page.request)
    const head = markerNode({
      id: 'valid-head',
      description: 'DIRTY-CANVAS valid head',
      text: 'R8 VALID DIRTY HEAD',
    })
    const tail = switchedOff(
      markerNode({
        id: 'valid-tail',
        description: 'DIRTY-CANVAS valid tail',
        text: 'R8 VALID DIRTY TAIL',
      }),
    )
    const testId = await createValidTest(page.request, {
      name: uniqueName('valid-dirty'),
      nodes: stackNodes([head, tail]),
      edges: chainEdges(['valid-head', 'valid-tail']),
    })

    await openTest(page, testId)
    await enableAllOnCanvas(page)

    const status = await startRun(page)
    await expect(
      page.locator(VALIDATION.dialog),
      'a valid dirty canvas must not be blocked',
    ).toBeHidden()
    // The tail is only enabled in memory, so its marker proves the run used the
    // dirty body rather than the saved copy.
    const logs = await finishRun(page, status, 'R8 VALID DIRTY TAIL')
    expect(logs.some((line) => line.includes('R8 VALID DIRTY HEAD'))).toBe(true)
  })

  test('L-02: a required parameter that is blank is refused as empty, not as missing', async ({
    page,
  }) => {
    const blank = HOLE_CASES.find((hole) => hole.id === 'L-02')!
    const result = await importExpectingErrors(page, {
      name: uniqueName('blank'),
      workflow: {
        nodes: [holeNode(blank, { ...blank.values, pod: '   ' })],
        edges: chainEdges([caseNodeId(blank.id)]),
      },
      variables: {},
    })

    expect(result.status, 'L-02: a blank required parameter must be refused').toBe(422)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0].code).toBe('REQUIRED_PARAM_EMPTY')
    expect(result.errors[0].message).toBe(emptyMessage(blank.param))

    const dialog = await runAndExpectBlocked(page)
    await expect(dialog.locator(VALIDATION.count)).toHaveText('1')
    expect(await readDialogRows(page)).toEqual([
      { trail: [], leaf: K8S_READ_LABEL[blank.elementType], message: emptyMessage(blank.param) },
    ])
  })

  test('FN-BODY: a half-filled read Block inside a Local Function body is refused too', async ({
    page,
  }) => {
    const inner = HOLE_CASES.find((hole) => hole.id === 'G-38')!
    const fnLabel = 'K8s_Read_Fn'
    const fnNode = localFunctionNode('local-fn', fnLabel, {
      nodes: [logNode('fn-log', 'Log_1', "'FN-BODY body'"), holeNode(inner)],
      edges: chainEdges(['fn-log', caseNodeId(inner.id)]),
    })
    const result = await importExpectingErrors(page, {
      name: uniqueName('function-body'),
      workflow: { nodes: [fnNode], edges: chainEdges(['local-fn']) },
      variables: {},
    })

    expect(
      result.status,
      `FN-BODY: the gate must reach ${inner.id} inside a Local Function body: ${JSON.stringify(result.errors)}`,
    ).toBe(422)
    expect(
      await postTestStatus(page.request, {
        name: uniqueName('function-body-probe'),
        nodes: [fnNode],
        edges: chainEdges(['local-fn']),
      }),
      'FN-BODY: the same body must be refused at save too',
    ).toBe(422)
    const bodyRows = result.errors.filter((entry) =>
      String(entry.message).startsWith(REQUIRED_PREFIX),
    )
    expect(result.errors.length, JSON.stringify(result.errors)).toBe(1)
    expect(bodyRows.length).toBe(1)
    expect(bodyRows[0].code).toBe('REQUIRED_PARAM_MISSING')
    expect(bodyRows[0].message).toBe(missingMessage(inner.param))
    expect(bodyRows[0].node_label).toBe(K8S_READ_LABEL[inner.elementType])

    await runAndExpectBlocked(page)
    const required = (await readDialogRows(page)).filter((row) =>
      row.message.startsWith(REQUIRED_PREFIX),
    )
    expect(required).toEqual([
      {
        trail: [fnLabel],
        leaf: K8S_READ_LABEL[inner.elementType],
        message: missingMessage(inner.param),
      },
    ])
  })

  for (const negative of NEGATIVE_CASES) {
    test(`${negative.id} negative: ${negative.what} saves and passes the run gate`, async ({
      request,
    }) => {
      const testId = await createValidTest(request, {
        name: uniqueName(`negative-${negative.id}`),
        nodes: [negativeNode(negative)],
        edges: chainEdges([caseNodeId(`neg-${negative.id}`)]),
      })
      const result = await validateTest(request, testId, 'run')
      expect(
        result.status,
        `${negative.id}: ${negative.param} must not be required here - ${JSON.stringify(result.errors)}`,
      ).toBe(200)
      expect(result.errors).toEqual([])
      expect(
        result.warnings.filter((entry) => String(entry.message).startsWith(REQUIRED_PREFIX)),
      ).toEqual([])
    })
  }
})
