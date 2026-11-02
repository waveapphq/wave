/**
 * V-RC-NESTED (functional): run-current parity for NESTED unsaved edits at
 * depth 1-3.
 *
 * REQ: REQ-5.2.1.24 ("Running with unsaved changes" / nesting depth rows).
 *
 * One nesting shape, three run entry points:
 *   depth 1: a Local Function body edit (disable d1-drop),
 *   depth 2: an edit-mode Shared INSIDE the local Function with an edited
 *            draft body (disable d2-drop),
 *   depth 3: a local Function INSIDE that draft with an edited body
 *            (disable d3-drop).
 *
 * Pass Criteria:
 *   1. Whole-Test run executes every unsaved edit (kept lines log, dropped
 *      lines do not) and is NOT rejected by the run gate even though a nested
 *      edit-mode draft is present (the EDIT_MODE_DRAFT_IN_BODY guard does
 *      not fire for context="run").
 *   2. A scoped Function run drilled at the Local parent executes the same
 *      nested draft edits (scope_mode=function + in-memory workflow).
 *   3. A library View run deep-folds edits made BELOW the synthetic root into
 *      the dispatched draft and executes them; undoing back to the baseline
 *      floor never blanks the View.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  publishLibraryFunction,
  createValidTest,
  localFunctionNode,
  sharedNode,
  logNode,
  startEdge,
  openTest,
  openFunctionView,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import {
  undoBtn,
  digIn,
  disableNode,
  popToBreadcrumbSegment,
  selectEnvironment,
  runToTerminal,
} from '../../helpers/workbench'
import { getLogEntries, getLogTexts } from '../../helpers/log-reader'
import { ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const EDIT_MODE_WARN_RE =
  /Function '.+' is in edit mode: changes are not published and this instance is unlinked from the shared library/

/** Library Function "Inner": d2-keep -> L3(d3-keep -> d3-drop) -> d2-drop. */
function seedInnerLib(request: APIRequestContext): Promise<SeededLibraryFunction> {
  return publishLibraryFunction(request, {
    name: `RCN-Inner-${randomUUID().slice(0, 6)}`,
    workflow: {
      nodes: [
        logNode('d2-keep', 'D2Keep', "'d2-keep'", { x: 200, y: 120 }),
        localFunctionNode(
          'l3',
          'L3',
          {
            nodes: [
              logNode('d3-keep', 'D3Keep', "'d3-keep'", { x: 200, y: 140 }),
              logNode('d3-drop', 'D3Drop', "'d3-drop'", { x: 200, y: 280 }),
            ],
            edges: [
              startEdge('d3-keep'),
              { id: 'e-d3k-d3d', source: 'd3-keep', target: 'd3-drop' },
            ],
          },
          { x: 200, y: 260 },
        ),
        logNode('d2-drop', 'D2Drop', "'d2-drop'", { x: 200, y: 420 }),
      ],
      edges: [
        startEdge('d2-keep'),
        { id: 'e-d2k-l3', source: 'd2-keep', target: 'l3' },
        { id: 'e-l3-d2d', source: 'l3', target: 'd2-drop' },
      ],
    },
  })
}

/** Test: d0-keep -> L1( Inner(shared) -> d1-drop ). */
function seedHostTest(
  request: APIRequestContext,
  inner: SeededLibraryFunction,
  name: string,
): Promise<string> {
  return createValidTest(request, {
    name,
    nodes: [
      logNode('d0-keep', 'D0Keep', "'d0-keep'", { x: 200, y: 120 }),
      localFunctionNode(
        'l1',
        'L1',
        {
          nodes: [
            sharedNode('inner-shared', {
              functionId: inner.functionId,
              functionVersion: inner.version,
              label: inner.name,
              position: { x: 200, y: 140 },
            }),
            logNode('d1-drop', 'D1Drop', "'d1-drop'", { x: 200, y: 300 }),
          ],
          edges: [
            startEdge('inner-shared'),
            { id: 'e-is-d1d', source: 'inner-shared', target: 'd1-drop' },
          ],
        },
        { x: 200, y: 280 },
      ),
    ],
    edges: [startEdge('d0-keep'), { id: 'e-d0-l1', source: 'd0-keep', target: 'l1' }],
  })
}

/** UI-stage the unsaved edits at depth 1, 2 and 3 (leaves the view drilled at
 *  depth 3: Test -> L1 -> Inner draft -> L3). The nested enter-edit goes
 *  through the drilled chrome's Edit Function button - the node kebab's tall
 *  menu cannot fit around a mid-screen node (drilling keeps the root
 *  viewport), while the chrome button is viewport-stable. */
async function stageNestedEdits(page: Page): Promise<void> {
  await digIn(page, 'l1')
  await expect(page.locator('[data-testid="workflow-node-inner-shared"]')).toBeVisible({
    timeout: 10_000,
  })
  await disableNode(page, 'd1-drop')

  // Nested enter-edit: drill into the clean Shared (read-only inspect), then
  // Edit Function from the chrome - the body becomes the editable draft.
  await digIn(page, 'inner-shared')
  await expect(page.locator('[data-testid="action-bar-edit-function-button"]')).toBeVisible({
    timeout: 15_000,
  })
  await page.locator('[data-testid="action-bar-edit-function-button"]').click()
  await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.locator('[data-testid="workflow-node-d2-keep"]')).toBeVisible({
    timeout: 10_000,
  })
  await disableNode(page, 'd2-drop')

  await digIn(page, 'l3')
  await expect(page.locator('[data-testid="workflow-node-d3-keep"]')).toBeVisible({
    timeout: 10_000,
  })
  await disableNode(page, 'd3-drop')
}

function expectKeptAndDropped(logs: string[], opts: { expectRoot: boolean }): void {
  const all = logs.join('\n')
  if (opts.expectRoot) {
    expect(logs.some((m) => m.includes('d0-keep')), `d0-keep must run\n${all}`).toBe(true)
  } else {
    expect(
      logs.some((m) => m.includes('d0-keep')),
      `d0-keep is outside the scoped run and must NOT run\n${all}`,
    ).toBe(false)
  }
  expect(logs.some((m) => m.includes('d2-keep')), `depth-2 draft keep line must run\n${all}`).toBe(true)
  expect(logs.some((m) => m.includes('d3-keep')), `depth-3 keep line must run\n${all}`).toBe(true)
  expect(
    logs.some((m) => m.includes('d1-drop')),
    `d1-drop is disabled in-memory at depth 1 and must NOT run\n${all}`,
  ).toBe(false)
  expect(
    logs.some((m) => m.includes('d2-drop')),
    `d2-drop is disabled in the depth-2 edit-mode draft and must NOT run\n${all}`,
  ).toBe(false)
  expect(
    logs.some((m) => m.includes('d3-drop')),
    `d3-drop is disabled in the depth-3 nested body and must NOT run\n${all}`,
  ).toBe(false)
}

test.describe('V-RC-NESTED (functional): nested unsaved edits execute at depth 1-3', () => {
  test('whole-Test run executes the depth 1-3 unsaved edits (run-gate fix)', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const inner = await seedInnerLib(request)
    const testId = await seedHostTest(request, inner, `V-RC-NESTED-WHOLE ${randomUUID().slice(0, 8)}`)
    await openTest(page, testId)
    await selectEnvironment(page)

    await stageNestedEdits(page)
    await popToBreadcrumbSegment(page, /V-RC-NESTED-WHOLE/)

    // Run gate: this run-current payload contains a
    // NESTED edit-mode draft, which the edit-mode draft guard admits in the
    // run context. A terminal passed state proves the gate admits it.
    const runReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith('/workbench/run'),
    )
    await runToTerminal(page)
    const body = (await runReq).postDataJSON()
    expect(body.workflow, 'dirty whole-Test run carries the in-memory workflow').toBeTruthy()

    expectKeptAndDropped(await getLogTexts(page), { expectRoot: true })

    // The nested edit-mode instance still emits the advisory WARN.
    const entries = await getLogEntries(page)
    expect(
      entries.some((e) => EDIT_MODE_WARN_RE.test(e.message)),
      `nested edit-mode WARN expected\n${JSON.stringify(entries)}`,
    ).toBe(true)
  })

  test('scoped Function run drilled at the Local parent executes the nested draft edits', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const inner = await seedInnerLib(request)
    const testId = await seedHostTest(request, inner, `V-RC-NESTED-SCOPE ${randomUUID().slice(0, 8)}`)
    await openTest(page, testId)
    await selectEnvironment(page)

    await stageNestedEdits(page)
    // Pop back to the Local parent scope; the primary Run is now a scoped run.
    await popToBreadcrumbSegment(page, /^L1$/)
    await expect(page.locator('[data-testid="workflow-node-inner-shared"]')).toBeVisible()

    const runReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith('/workbench/run'),
    )
    await runToTerminal(page)
    const body = (await runReq).postDataJSON()
    expect(body.scope_mode, 'drilled Run dispatches scope_mode=function').toBe('function')
    expect(body.workflow, 'scoped run carries the in-memory workflow').toBeTruthy()

    expectKeptAndDropped(await getLogTexts(page), { expectRoot: false })
  })

  test('library View run deep-folds edits below the synthetic root; undo never blanks the View', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const inner = await seedInnerLib(request)
    const outer = await publishLibraryFunction(request, {
      name: `RCN-Outer-${randomUUID().slice(0, 6)}`,
      workflow: {
        nodes: [
          sharedNode('inner-shared', {
            functionId: inner.functionId,
            functionVersion: inner.version,
            label: inner.name,
            position: { x: 200, y: 180 },
          }),
        ],
        edges: [startEdge('inner-shared')],
      },
    })
    await openFunctionView(page, outer.functionId, outer.version)
    await selectEnvironment(page)

    // Enter View edit mode, then edit BELOW the synthetic root: drill into
    // Inner, enter ITS edit mode via the chrome, disable d2-drop, drill into
    // L3, disable d3-drop.
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({
      timeout: 15_000,
    })
    await digIn(page, 'inner-shared')
    await expect(page.locator('[data-testid="action-bar-edit-function-button"]')).toBeVisible({
      timeout: 15_000,
    })
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.locator('[data-testid="workflow-node-d2-keep"]')).toBeVisible({
      timeout: 10_000,
    })
    await disableNode(page, 'd2-drop')
    await digIn(page, 'l3')
    await expect(page.locator('[data-testid="workflow-node-d3-keep"]')).toBeVisible({
      timeout: 10_000,
    })
    await disableNode(page, 'd3-drop')

    // No pop needed: in library-View mode the Run button dispatches the
    // whole-Function standalone run at ANY drill depth (runStandaloneFromView
    // short-circuits scoped dispatch).

    // The View run folds edits below the synthetic root,
    // never dispatching stale bodies. The dispatched draft must carry the
    // nested edit-mode draft with the disables inside.
    const runReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes(`/functions/${outer.functionId}/run`),
    )
    await page.locator('[data-testid="run-button"]').click()
    const body = (await runReq).postDataJSON()
    expect(body.draft, 'View run dispatches the in-memory draft').toBeTruthy()
    const draftNodes = (body.draft.workflow.nodes ?? []) as Array<{
      id: string
      data?: Record<string, any>
    }>
    const innerInDraft = draftNodes.find((n) => n.id === 'inner-shared')
    expect(innerInDraft?.data?.editMode, 'nested edit-mode marker folded into the draft').toBe(true)
    const nestedDraftNodes = (innerInDraft?.data?.draft?.workflow?.nodes ?? []) as Array<{
      id: string
      data?: Record<string, any>
    }>
    expect(
      nestedDraftNodes.find((n) => n.id === 'd2-drop')?.data?.disabled,
      'depth-2 disable folded into the nested draft',
    ).toBe(true)

    // End-to-end: kept lines run, dropped lines do not.
    await expect
      .poll(async () => (await getLogTexts(page)).join(' | '), { timeout: 60_000 })
      .toContain('d3-keep')
    expectKeptAndDropped(await getLogTexts(page), { expectRoot: false })

    // The View boot re-baselines on the loaded published
    // body, so undoing everything never blanks the canvas (the floor is never
    // the empty canvas reset() leaves behind).
    await expect(undoBtn(page)).toBeEnabled({ timeout: 30_000 })
    for (let i = 0; i < 12; i++) {
      if (await undoBtn(page).isDisabled()) break
      await undoBtn(page).click()
      await page.waitForTimeout(150)
    }
    await expect(undoBtn(page)).toBeDisabled()
    await expect(
      page.locator('[data-testid="workflow-node-view-shared-root"]'),
      'the undo floor is the loaded View, never a blank canvas',
    ).toBeVisible()
    await expect(page.locator('[data-testid="onboarding-placeholder"]')).toHaveCount(0)
  })
})
