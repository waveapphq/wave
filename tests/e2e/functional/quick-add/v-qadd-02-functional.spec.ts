/**
 * V-QADD-02 (functional): the Quick Insert window's insert semantics, search
 * and keyboard, proven by what the workflow actually does.
 *
 * Design Decisions: CANVAS-231..237, CANVAS-241, CANVAS-247
 * REQ: REQ-4.2.5, REQ-5.2.1.47
 *
 * Pass Criteria:
 * 1. Enter on a clean canvas anchors on Start - the block runs.
 * 2. Enter with one block selected anchors on that block - it runs after it.
 * 3. Enter with nothing selected anchors on the last interacted block, and
 *    clicking a row does exactly what Enter does.
 * 4. Ctrl+Enter places at the viewport center with NO link - it never runs.
 * 5. Alt+Enter inserts nothing at all.
 * 6. Rows are drag sources (palette drop path).
 * 7. Search matches the typed text as a substring of the block name: "del"
 *    leaves exactly K8s Delete and Delay, and Enter inserts the highlighted one.
 * 8. Tab moves the highlight one row without taking focus out of the search
 *    box; PageDown pressed from the middle of a page lands on the last row the
 *    user could read and reveals a page of rows below it, PageUp from there
 *    reveals the page above it, neither steps over a row, and each clamps on
 *    the row at its end of the list.
 * 9. The caret returns to the search box after clicking a heading, and after
 *    clicking away to the canvas and back.
 * 10. Quick-adding a Function into its own edit-mode body is rejected with the
 *     same toast as the drop path.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, dragSourceToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, selectEnvironment, runToTerminal } from '../../helpers/workbench'
import {
  createValidTest,
  logNode,
  openTest,
  publishLibraryFunction,
  sharedNode,
  startEdge,
} from '../../helpers/fn-seed'
import { getLogTexts } from '../../helpers/log-reader'
import {
  applyQuickAddSearch,
  quickAddFunctionsResponse,
  QUICK_ADD_STATUS,
} from '../../helpers/quick-add'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { setStringParam } from '../../helpers/param-config'
import { randomUUID } from 'node:crypto'

const POPOVER = '[data-testid="quick-add-popover"]'
const WORKFLOW_NODES = '[data-testid^="workflow-node-"][data-nodetype]'
const ROWS = `${POPOVER} [data-slot="command-item"]`
const HIGHLIGHTED = `${ROWS}[data-selected="true"]`

/** A clean, session-free workbench canvas (only the Start node). */
async function openCleanCanvas(page: Page) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

async function openQuickAdd(page: Page) {
  await page.keyboard.press('Control+Space')
  await expect(page.locator(POPOVER)).toBeVisible({ timeout: 5_000 })
  await expect(page.locator(`${POPOVER} input`)).toBeFocused()
}

/** The rows the user can read right now: shown whole inside the list box. */
async function onScreenRowIds(page: Page): Promise<string[]> {
  return page.locator(ROWS).evaluateAll((els) => {
    const list = document.querySelector('[data-testid="quick-add-list"]') as HTMLElement
    const top = list.getBoundingClientRect().top + list.clientTop
    const bottom = top + list.clientHeight
    return els
      .filter((el) => {
        const box = el.getBoundingClientRect()
        return box.height > 0 && box.top >= top && box.bottom <= bottom
      })
      .map((el) => el.getAttribute('data-testid') as string)
  })
}

/** The row the keyboard is on right now. */
async function highlightedRowId(page: Page): Promise<string> {
  return (await page.locator(HIGHLIGHTED).getAttribute('data-testid')) as string
}

/**
 * What a page press owes the user: a boxful of rows, at most one of them
 * carried over from the last one, and no row passed over in between.
 */
function expectPageRevealed(ordered: string[], before: string[], after: string[]) {
  expect(after.length, 'the press left a full box of rows on screen').toBeGreaterThan(4)
  expect(
    after.filter((id) => before.includes(id)).length,
    'at most the row it stepped from is carried over: the rest of the box is new',
  ).toBeLessThanOrEqual(1)
  const seen = ordered.filter((id) => before.includes(id) || after.includes(id))
  expect(
    ordered.indexOf(seen[seen.length - 1]) - ordered.indexOf(seen[0]) + 1,
    'the rows on screen before and after the press are one unbroken run',
  ).toBe(seen.length)
}

/** Quick-add an item by query + insert key; the window closes on insert. */
async function quickAddInsert(page: Page, query: string, key: string) {
  await openQuickAdd(page)
  await page.locator(`${POPOVER} input`).fill(query)
  await page.keyboard.press(key)
  await expect(page.locator(POPOVER)).toHaveCount(0)
}

/** The single selected workflow node's testid (a placed block is always selected). */
async function selectedNodeTestId(page: Page): Promise<string> {
  const selected = page.locator(`${WORKFLOW_NODES}[data-selected="true"]`)
  await expect(selected).toHaveCount(1)
  return (await selected.getAttribute('data-testid')) as string
}

/** Open the node's config sheet (hit-test-free), set the Log message, Save. */
async function setLogMessage(page: Page, nodeTestId: string, message: string) {
  const node = page.locator(`[data-testid="${nodeTestId}"]`)
  await node.locator('button').first().dispatchEvent('click')
  await node.locator('[data-testid="node-configure"]').dispatchEvent('click')
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  // A literal string message edits through the shared "Edit value" sheet.
  await setStringParam(sheet, page, 'message', message)
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toHaveCount(0, { timeout: 5_000 })
}

function edgeCount(page: Page) {
  return page.locator('.react-flow__edge').count()
}

/** Clear the selection by clicking empty canvas, leaving "last interacted" intact. */
async function clearSelection(page: Page) {
  await page.locator('.react-flow__pane').click({ position: { x: 60, y: 480 } })
  await expect(page.locator(`${WORKFLOW_NODES}[data-selected="true"]`)).toHaveCount(0)
}

test.describe('V-QADD-02: Quick Insert insert modes end-to-end', () => {
  test('Enter anchors / Ctrl+Enter centers / Alt+Enter inserts nothing / rows drag, and the wiring runs', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    // A saved Test, so the run has a surface to execute (the clean-canvas
    // Start anchor is proved in the second test, which needs no run).
    const testId = await createValidTest(request, {
      name: `V-QADD-02 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nodes: [logNode('anchor', 'Anchor', "'anchor ran'", { x: 260, y: 140 })],
      edges: [startEdge('anchor')],
    })
    await openTest(page, testId)
    const fromStart = 'workflow-node-anchor'
    const baseEdges = await edgeCount(page)

    // --- 1. Enter with a block selected: anchored on the selection. ---
    await page.locator(`[data-testid="${fromStart}"]`).locator('button').first().dispatchEvent('click')
    await quickAddInsert(page, 'log', 'Enter')
    const afterSelection = await selectedNodeTestId(page)
    expect(afterSelection).not.toBe(fromStart)
    expect(await edgeCount(page), 'edge from the selected block egress').toBe(baseEdges + 1)
    // Placed one row below its anchor.
    const anchorBox = await page.locator(`[data-testid="${fromStart}"]`).boundingBox()
    const chainedBox = await page.locator(`[data-testid="${afterSelection}"]`).boundingBox()
    expect(chainedBox!.y).toBeGreaterThan(anchorBox!.y)
    await setLogMessage(page, afterSelection, 'after selection')

    // --- 2. Nothing selected: Enter falls back to the last interacted block,
    //        and clicking a row does exactly what Enter does. ---
    await clearSelection(page)
    await openQuickAdd(page)
    await page.locator(`${POPOVER} input`).fill('log')
    await page.locator('[data-testid="quick-add-item-log"]').click()
    await expect(page.locator(POPOVER)).toHaveCount(0)
    const afterLastInteracted = await selectedNodeTestId(page)
    expect(await edgeCount(page), 'a clicked row anchors, it does not center').toBe(baseEdges + 2)
    await setLogMessage(page, afterLastInteracted, 'after last interacted')

    // --- 3. Ctrl+Enter: viewport center, NO link. ---
    await quickAddInsert(page, 'log', 'Control+Enter')
    const centered = await selectedNodeTestId(page)
    expect([fromStart, afterSelection, afterLastInteracted]).not.toContain(centered)
    expect(await edgeCount(page), 'a center insert creates no edge').toBe(baseEdges + 2)
    await setLogMessage(page, centered, 'center placed')

    // --- 4. Alt+Enter inserts nothing at all. ---
    const beforeAlt = await page.locator(WORKFLOW_NODES).count()
    await openQuickAdd(page)
    await page.locator(`${POPOVER} input`).fill('log')
    await page.keyboard.press('Alt+Enter')
    await expect(page.locator(POPOVER), 'the window stays open - nothing was inserted').toBeVisible()
    await expect(page.locator(WORKFLOW_NODES)).toHaveCount(beforeAlt)
    await page.keyboard.press('Escape')
    await expect(page.locator(POPOVER)).toHaveCount(0)

    // --- 5. Drag a row onto the canvas (palette drop path). ---
    await openQuickAdd(page)
    await page.locator(`${POPOVER} input`).fill('log')
    const row = page.locator('[data-testid="quick-add-item-log"]')
    const canvasBox = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
    await dragSourceToCanvas(page, row, { x: 140, y: canvasBox!.height - 100 })
    await expect(page.locator(POPOVER)).toHaveCount(0)
    await expect(page.locator(WORKFLOW_NODES)).toHaveCount(5)
    expect(await edgeCount(page), 'the far drop stays unwired').toBe(baseEdges + 2)
    const known = new Set([fromStart, afterSelection, afterLastInteracted, centered])
    const allIds = await page.locator(WORKFLOW_NODES).evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid') as string),
    )
    const dragged = allIds.find((id) => !known.has(id)) as string
    expect(dragged).toBeTruthy()
    await setLogMessage(page, dragged, 'dragged from window')

    // --- 6. Run: only the blocks reachable from Start execute. ---
    await selectEnvironment(page)
    await runToTerminal(page)

    const logTexts = await getLogTexts(page)
    expect(logTexts, 'the seeded anchor ran').toContain('anchor ran')
    expect(logTexts, 'Enter chained from the selected block').toContain('after selection')
    expect(logTexts).toContain('after last interacted')
    // Unlinked blocks are unreachable from Start and never execute.
    expect(logTexts).not.toContain('center placed')
    expect(logTexts).not.toContain('dragged from window')

    for (const id of [fromStart, afterSelection, afterLastInteracted]) {
      await expect(page.locator(`[data-testid="${id}"]`)).toHaveAttribute(
        'data-execution-status',
        'success',
      )
    }
    for (const id of [centered, dragged]) {
      await expect(page.locator(`[data-testid="${id}"]`)).not.toHaveAttribute(
        'data-execution-status',
        'success',
      )
    }
  })

  test('substring search, Tab / PageDown highlight movement, and the caret that never leaves', async ({
    page,
  }) => {
    await openCleanCanvas(page)

    // --- Enter on a clean canvas anchors on Start - the new block is
    //     wired from it, which the canvas names on the edge itself. ---
    await quickAddInsert(page, 'log', 'Enter')
    const first = (await selectedNodeTestId(page)).replace('workflow-node-', '')
    await expect(
      page.getByRole('group', { name: `Edge from start-node to ${first}` }),
    ).toHaveCount(1)

    // --- "del" is a substring of the NAME - exactly K8s Delete then Delay.
    //     The Function half is searched on the server (CANVAS-241), so the
    //     count only means anything once that answer has landed; the built-ins
    //     beat settles on 2 whatever the server would have said. ---
    await openQuickAdd(page)
    const delFunctions = await applyQuickAddSearch(page, 'del')
    expect(
      delFunctions.names,
      'a sibling spec published a Function whose name contains "del"',
    ).toEqual([])
    // CANVAS-247: the heading a zero-row group cannot show, the line carries.
    await expect(page.locator(`${POPOVER} ${QUICK_ADD_STATUS}`)).toHaveText('No Functions match')
    await expect(page.locator(ROWS)).toHaveCount(2)
    await expect(page.locator(ROWS).nth(0)).toHaveAttribute('data-testid', 'quick-add-item-k8s-delete')
    await expect(page.locator(ROWS).nth(1)).toHaveAttribute('data-testid', 'quick-add-item-delay')

    // --- Tab moves the highlight one row and the caret stays in the box.
    //     Proven by what gets inserted, not by the highlight class. ---
    await page.keyboard.press('Tab')
    await expect(page.locator(`${POPOVER} input`), 'Tab never moves focus').toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator(POPOVER)).toHaveCount(0)
    const delayNode = await selectedNodeTestId(page)
    await expect(page.locator(`[data-testid="${delayNode}"]`)).toContainText('Delay')

    // --- With no Tab the first match is what Enter inserts. ---
    await quickAddInsert(page, 'del', 'Enter')
    const k8sDeleteNode = await selectedNodeTestId(page)
    await expect(page.locator(`[data-testid="${k8sDeleteNode}"]`)).toContainText('K8s Delete')

    // --- PageDown stops on the last row the user could read and reveals a
    //     page of rows below it. Pressed from the middle of the page, which is
    //     where the highlight sits after a few arrow presses - the only place
    //     the step can be wrong. ---
    await openQuickAdd(page)
    for (let press = 0; press < 3; press++) {
      await page.keyboard.press('ArrowDown')
    }
    const before = await onScreenRowIds(page)
    expect(before.length, 'the list box holds a page worth stepping over').toBeGreaterThan(4)
    expect(
      before.indexOf(await highlightedRowId(page)),
      'the press starts mid-page, not on the last row shown',
    ).toBeLessThan(before.length - 1)

    await page.keyboard.press('PageDown')

    const after = await onScreenRowIds(page)
    // Read after the press: a Function page that lands mid-test only ever
    // appends, so this order holds for every row either screenful named.
    const ordered = await page.locator(ROWS).evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid') as string),
    )
    expect(ordered.length, 'the unfiltered catalog is longer than one page').toBeGreaterThan(10)
    const landedDown = await highlightedRowId(page)
    expect(
      landedDown,
      'the press stops on the last row the user could read, never past it',
    ).toBe(before[before.length - 1])
    expect(after[0], 'and it stops there at the top, so the page below it shows').toBe(landedDown)
    expectPageRevealed(ordered, before, after)

    // --- PageUp is the mirror. The highlight is the top row shown, so the
    //     press starts the page above it and lands at the bottom of that page.
    //     Pressed on, it stops on the first row of the list. ---
    await page.keyboard.press('PageUp')

    const afterUp = await onScreenRowIds(page)
    expect(
      ordered.indexOf(await highlightedRowId(page)),
      'already on the top row shown, so it steps to the row above it',
    ).toBe(ordered.indexOf(landedDown) - 1)
    expectPageRevealed(ordered, after, afterUp)

    await page.keyboard.press('PageUp')
    await page.keyboard.press('PageUp')
    expect(
      await highlightedRowId(page),
      'the first row is where the key stops, however often it is pressed',
    ).toBe(ordered[0])

    // --- The caret returns after a press on a heading, and after
    //     clicking away to the canvas and back. ---
    await page.locator(`${POPOVER} [cmdk-group-heading]`).first().click()
    await expect(page.locator(`${POPOVER} input`)).toBeFocused()
    await page.locator('.react-flow__pane').click({ position: { x: 60, y: 480 } })
    await expect(page.locator(POPOVER), 'the window is non-blocking, it stays open').toBeVisible()
    await page.locator(`${POPOVER} [data-testid="quick-add-hint-pointer"]`).click()
    await expect(page.locator(`${POPOVER} input`)).toBeFocused()
    const retyped = quickAddFunctionsResponse(page, { search: 'del', page: 1 })
    await page.keyboard.type('del')
    await expect(page.locator(`${POPOVER} input`)).toHaveValue('del')
    // Same two-beat rule as above: count only after the Function half answers.
    await retyped
    await expect(page.locator(`${POPOVER} ${QUICK_ADD_STATUS}`)).toHaveText('No Functions match')
    await expect(page.locator(ROWS)).toHaveCount(2)

    // --- On a list that fits the box, the page key walks to the last row
    //     and clamps there, with nothing left to step over. ---
    await page.keyboard.press('PageDown')
    await expect(page.locator(HIGHLIGHTED)).toHaveAttribute(
      'data-testid',
      'quick-add-item-delay',
    )
    await page.keyboard.press('PageDown')
    await expect(
      page.locator(HIGHLIGHTED),
      'the last row is where the key stops, however often it is pressed',
    ).toHaveAttribute('data-testid', 'quick-add-item-delay')
    await page.keyboard.press('PageUp')
    await expect(page.locator(HIGHLIGHTED)).toHaveAttribute(
      'data-testid',
      'quick-add-item-k8s-delete',
    )
    await page.keyboard.press('PageUp')
    await expect(
      page.locator(HIGHLIGHTED),
      'and the first row is where it stops going the other way',
    ).toHaveAttribute('data-testid', 'quick-add-item-k8s-delete')

    await page.keyboard.press('Escape')
    await expect(page.locator(POPOVER)).toHaveCount(0)
  })

  test('Quick-adding a Function into its own edit-mode body is rejected with a toast', async ({
    page,
    request,
  }) => {
    const fn = await publishLibraryFunction(request, {
      name: `qadd_selfnest_${randomUUID().slice(0, 6)}`,
    })
    const testId = await createValidTest(request, {
      name: `V-QADD-02-SELFNEST ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nodes: [
        sharedNode('fn-self', {
          functionId: fn.functionId,
          functionVersion: fn.version,
          label: fn.name,
          originalLibraryName: fn.name,
          position: { x: 320, y: 180 },
        }),
      ],
      edges: [startEdge('fn-self')],
    })
    await openTest(page, testId)

    // Enter edit mode and drill into the editable draft body.
    await clickNodeKebabItem(page, 'fn-self', 'Edit')
    await expect(
      page.locator('[data-testid="workflow-node-fn-self"] [data-testid="edit-mode-mark-wrapper"]'),
    ).toBeVisible({ timeout: 10_000 })
    await page
      .locator('[data-testid="workflow-node-fn-self"] [data-testid="node-dig-in"]')
      .click()
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(breadcrumb.locator('svg.lucide-square-function').first()).toBeVisible({
      timeout: 10_000,
    })

    // Quick-add the SAME Function: rejected with the drop-path toast, no node.
    await page.locator('.react-flow__pane').click({ position: { x: 400, y: 300 }, force: true })
    await openQuickAdd(page)
    await page.locator(`${POPOVER} input`).fill(fn.name)
    await expect(page.locator(`[data-testid="quick-add-item-${fn.functionId}"]`)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator(POPOVER)).toHaveCount(0)

    const rejectToast = page.locator('[data-toast]', {
      hasText: 'cannot be nested inside itself',
    })
    await expect(rejectToast.first()).toBeVisible({ timeout: 5_000 })
    await expect(
      page.locator('[data-testid^="workflow-node-"][data-nodetype="function"]'),
    ).toHaveCount(0)
  })
})
