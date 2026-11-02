/** R cells: the Blocks of an If/Else or split Assert branch in a sub-flow paint the same during the run and after a reload. */

import { expect, test, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { openTest } from '../../helpers/fn-seed'
import type { WorkflowEdge, WorkflowNode } from '../../helpers/k8s-nodes'
import { getNodeStatuses } from '../../helpers/k8s-run'
import {
  container,
  failBlock,
  marker,
  type NestingGraph,
  type NestStep,
  type SlotKind,
} from '../../helpers/nesting-graph'
import { nodePaint, runCell, type NestCell } from './nesting-harness'
import { openSignalCell } from './signal-cell-open'

export const CELL_TIMEOUT_MS = 180_000
const RECOVERY_TIMEOUT_MS = 30_000
const BRANCHING_ID = 'inner'

type Outer = 'for-body' | 'try'
type Branch = Extract<SlotKind, 'if-branch' | 'assert-fail'>
type Shape = 'fails-in-branch' | 'fails-after-rejoin'
type Workflow = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }

const ROUTED_HANDLE: Readonly<Record<Branch, string>> = { 'if-branch': 'branch_0', 'assert-fail': 'fail' }

export type ReloadCellPlan = {
  cellId: string
  title: string
  chain: NestStep[]
  branch: Branch
  verdict: 'passed' | 'failed'
  /** Blocks the run gives a status, with the status it stores for each. */
  stored: Record<string, StoredStatus>
}

type StoredStatus = 'passed' | 'failed' | 'skipped'
const PAINT: Readonly<Record<StoredStatus, string>> = { passed: 'success', failed: 'failed', skipped: 'skipped' }

function branchStep(branch: Branch, body: NestStep[]): NestStep {
  const kind = branch === 'if-branch' ? 'if-else' : 'assert-split'
  return container(kind, BRANCHING_ID, body, { slot: branch })
}

function reloadPlan(outer: Outer, branch: Branch, shape: Shape): ReloadCellPlan {
  const cellId = `R.${outer}.${branch}.${shape}`
  const inBranch =
    shape === 'fails-in-branch'
      ? [branchStep(branch, [marker('in-branch'), failBlock('fail'), marker('after-fail')])]
      : [branchStep(branch, [marker('in-branch')]), failBlock('fail'), marker('after-fail')]
  const outerStep =
    outer === 'for-body'
      ? container('for', 'outer', inBranch, { options: { iterations: 1 } })
      : container('try-catch', 'outer', inBranch)
  const where = outer === 'for-body' ? 'a For Loop body' : 'a Try/Catch try path'
  const what = shape === 'fails-in-branch' ? 'fails inside the branch' : 'fails after the branch rejoins'
  const branchText = branch === 'if-branch' ? 'an If/Else if branch' : 'a split Assert fail branch'
  return {
    cellId,
    title: `${cellId}: a Block in ${branchText} inside ${where} ${what}; the paint survives a reload`,
    chain: [outerStep],
    branch,
    verdict: outer === 'try' ? 'passed' : 'failed',
    // The failure cuts off after-fail, so the run stores it skipped.
    stored: { 'in-branch': 'passed', fail: 'failed', 'after-fail': 'skipped' },
  }
}

export const reloadDescribeTitle = 'Matrix R: Blocks in a nested branch paint the same during the run and after a reload'

export function reloadPlans(): ReloadCellPlan[] {
  return [
    reloadPlan('for-body', 'if-branch', 'fails-in-branch'),
    reloadPlan('for-body', 'assert-fail', 'fails-in-branch'),
    reloadPlan('try', 'if-branch', 'fails-in-branch'),
    reloadPlan('for-body', 'if-branch', 'fails-after-rejoin'),
  ]
}

/** The same graph with the routed branch edge stored before its sibling, so the enclosing walker traces into it. */
function routedBranchFirst(branch: Branch): (graph: NestingGraph) => NestingGraph {
  const routed = (e: WorkflowEdge): boolean => e.source === BRANCHING_ID && e.sourceHandle === ROUTED_HANDLE[branch]
  return (graph) => ({
    ...graph,
    fixture: (published) => {
      const doc = graph.fixture(published)
      const workflow = doc.workflow as Workflow
      const edges = [...workflow.edges.filter(routed), ...workflow.edges.filter((e) => !routed(e))]
      return { ...doc, workflow: { ...workflow, edges } }
    },
  })
}

async function storedStates(page: Page): Promise<Record<string, string>> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session`)
  const body = (await response.json().catch(() => null)) as
    | { data?: { block_states?: Record<string, string> } }
    | null
  return body?.data?.block_states ?? {}
}

async function paintAfterReload(page: Page, cellId: string, ids: readonly string[]): Promise<Record<string, string | null>> {
  await page.reload()
  let paint: Record<string, string | null> = {}
  await expect
    .poll(
      async () => {
        const statuses = await getNodeStatuses(page)
        paint = Object.fromEntries(
          ids.map((id) => [id, statuses.find((s) => s.testId === `workflow-node-${id}`)?.status ?? null]),
        )
        return ids.every((id) => paint[id] !== null)
      },
      { timeout: RECOVERY_TIMEOUT_MS, message: `${cellId}: the reloaded canvas restores the run's paint` },
    )
    .toBe(true)
  return paint
}

export async function runReloadCell(page: Page, plan: ReloadCellPlan): Promise<void> {
  const opened = await openSignalCell(page, plan.cellId, { chain: plan.chain }, {
    requireValid: true,
    rewrite: routedBranchFirst(plan.branch),
  })
  if (!opened.cell) return
  const testId = opened.cell.testId
  await test.step(`${plan.cellId}: open the Test on the canvas`, () => openTest(page, testId))
  const cell: NestCell = { ...opened.cell, surface: 'canvas' }
  const run = await runCell(page, cell, { awaitBookend: plan.verdict === 'passed' })
  const ids = Object.keys(plan.stored)
  const expectedPaint = Object.fromEntries(ids.map((id) => [id, PAINT[plan.stored[id]]]))

  expect.soft(run.verdict, `${plan.cellId}: run verdict is ${plan.verdict}`).toBe(plan.verdict)
  const livePaint = Object.fromEntries(ids.map((id) => [id, nodePaint(run, id) ?? null]))
  expect.soft(livePaint, `${plan.cellId}: each Block paints its stored status during the run`).toEqual(expectedPaint)

  const stored = await storedStates(page)
  expect
    .soft(
      Object.fromEntries(ids.map((id) => [id, stored[id] ?? null])),
      `${plan.cellId}: the session API stores the result of every Block that ran and skipped for the cut-off one`,
    )
    .toEqual(plan.stored)

  const reloaded = await test.step(`${plan.cellId}: reload the page`, () => paintAfterReload(page, plan.cellId, ids))
  expect.soft(reloaded, `${plan.cellId}: each Block keeps its paint after a reload`).toEqual(expectedPaint)
}
