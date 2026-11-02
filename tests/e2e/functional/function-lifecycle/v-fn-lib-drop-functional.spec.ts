/**
 * V-FN-LIB-DROP-FUNCTIONAL: dragging a Library card onto the canvas creates
 * a shared Function reference node.
 *
 * Guards bundled here:
 *   - The card's drag payload MUST be set on `application/wave-block` with
 *     `type: 'function-published'`; the canvas drop handler reads only that.
 *   - The card's `effectAllowed` MUST match the canvas's `dropEffect='move'`;
 *     the HTML5 DnD spec rejects mismatched effects.
 *
 * Phase: functional-workflow. Self-seeds: POST /functions creates the lib
 * entry, POST /tests creates an empty host Test.
 *
 * V-FN-LIB-CONTRACT (same file): a library Function that lands on a canvas
 * carries its inputs. Seeds (API): a `zz-` library Function with the Required
 * string input `who` read by a body Log, and a `zz-` Test that is blank, holds a
 * For Loop (count 1) under Start, or holds an empty Local Function under Start.
 * The Block reaches the canvas through the UI: a drop from the Functions
 * Library on the Test flow, into the For Loop body, into the Local Function
 * body, a paste of a copied Block, and Quick Insert.
 *
 * Pass Criteria (V-FN-LIB-CONTRACT, each way in):
 *   1. The Block's sheet lists the input `who` right away, with no reload.
 *   2. `who` given the expression `'ann'` saves (no "Required parameter 'who' is missing")
 *      and the stored Block holds it as an expression field.
 *   3. A Block on a run path prints `who=ann` when the Test runs.
 *   4. Inside the Local Function body the input is listed again after the Test
 *      is opened anew.
 *   5. A library Function Block stored with no contract inside a library
 *      Function body (seeded `zz-` outer library Function) lists its inputs when
 *      the body opens: drilled in a Test, in the library View, and in edit mode,
 *      where a new binding saves into the draft.
 *   6. A contract read that fails (the versions request answers 500 once) blocks
 *      the page with "Could not load Function versions"; Try Again reads it again
 *      and the Block's sheet lists the input.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad, dragSourceToCanvas, expandPalette } from '../../helpers/canvas'
import { BACKEND_PORT, BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  createValidTest,
  localFunctionNode,
  logNode,
  openFunctionView,
  openTest as openSeededTest,
  publishLibraryFunction,
  sharedNode,
  startEdge,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { controlNode } from '../../helpers/k8s-nodes'
import { formatEntries } from '../../helpers/log-reader'
import { QUICK_ADD_POPOVER, applyQuickAddSearch } from '../../helpers/quick-add'
import {
  bindFunctionInputExpression,
  canvasBlockIds,
  digIn,
  dropLibraryFunctionBelow,
  dropLibraryFunctionBelowStart,
  openFunctionBlockSheet,
  popToBreadcrumbSegment,
  runToEnd,
  saveTest,
  selectEnvironment,
} from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const BASE = `http://localhost:${BACKEND_PORT}`

async function seedLibraryFunction(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const name = `DROP ${randomUUID().slice(0, 8)}`
  const resp = await request.post(`${BASE}/functions`, {
    data: {
      name,
      description: 'Library entry for V-FN-LIB-DROP-FUNCTIONAL.',
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `POST /functions failed: ${resp.status()} ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return { id: body!.data.id, name }
}

async function seedEmptyTest(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, {
    data: {
      name: `V-FN-LIB-DROP host ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Empty host Test for the library drop.',
      workflow: { nodes: [], edges: [] },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-FN-LIB-DROP-FUNCTIONAL: drag library card onto canvas', () => {
  test('drops a shared Function reference node onto the canvas', async ({ page, request }) => {
    const lib = await seedLibraryFunction(request)
    const testId = await seedEmptyTest(request)
    await openTest(page, testId)

    // Open the Library modal from the palette.
    await expandPalette(page)
    await page.locator('[data-testid="palette-blocks-library-button"]').click()
    const modal = page.locator('[aria-label="Functions Library"]')
    await expect(modal).toBeVisible({ timeout: 10_000 })

    // The card for our seeded library entry must be present.
    const card = modal.locator('[data-testid="library-card"]').filter({ hasText: lib.name }).first()
    await expect(card).toBeVisible()

    // Canvas has no Function nodes yet.
    const fnNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
    await expect(fnNodes).toHaveCount(0)

    // Drag the card to a canvas area OUTSIDE the library modal.
    // The modal is a fixed, viewport-centered overlay (z-50). Dropping
    // inside its footprint lands the event on the modal section instead
    // of the canvas wrapper, so we pick a coordinate just below the
    // modal's bottom edge and inside the canvas.
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    const modalBox = await modal.boundingBox()
    expect(box).toBeTruthy()
    expect(modalBox).toBeTruthy()
    const dropAbsX = box!.x + box!.width / 2
    const dropAbsY = modalBox!.y + modalBox!.height + 30
    await dragSourceToCanvas(page, card, {
      x: dropAbsX - box!.x,
      y: dropAbsY - box!.y,
    })

    // A shared Function node landed on the canvas, carrying the library
    // id and the same name.
    await expect(fnNodes).toHaveCount(1)
    const newNode = fnNodes.first()
    const badge = newNode.locator('[data-testid="node-function-lifecycle-badge"]')
    await expect(badge).toHaveAttribute('data-state', 'shared')
    await expect(newNode).toContainText(lib.name)
  })
})

const WHO_INPUT = { name: 'who', type: 'string', required: true, description: '' }
const FOR_ID = 'contract-for'
const HOST_ID = 'contract-host'
const BOUND = "'ann'"

type StoredNode = { id: string; data: Record<string, any> }

/** The stored field `who` of a Function Block: its value and whether it is an expression. */
function whoField(data: Record<string, any>): { value: unknown; expression: boolean } {
  return { value: data.config?.values?.who, expression: (data.expressionFields ?? []).includes('who') }
}

/** A stored Block found at any depth of the Test, Local Function bodies included. */
function findStoredNode(nodes: StoredNode[], id: string): StoredNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const inner = node.data?.localDefinition?.workflow?.nodes as StoredNode[] | undefined
    const found = inner ? findStoredNode(inner, id) : undefined
    if (found) return found
  }
  return undefined
}

async function storedTest(request: APIRequestContext, testId: string): Promise<Record<string, any>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data
}

/** The Block's sheet lists `who`; bind it to `'ann'`. */
async function bindWho(page: Page, blockId: string): Promise<void> {
  // Per V-FN-LIB-CONTRACT 1: the contract is on the Block as soon as it lands.
  await bindFunctionInputExpression(page, blockId, 'who', BOUND)
}

async function expectStoredBinding(
  request: APIRequestContext,
  testId: string,
  blockId: string,
  bound = BOUND,
): Promise<void> {
  const nodes = (await storedTest(request, testId)).workflow.nodes as StoredNode[]
  const stored = findStoredNode(nodes, blockId)
  expect(stored, `the Block ${blockId} is stored`).toBeTruthy()
  expect(whoField(stored!.data), JSON.stringify(stored!.data)).toEqual({ value: bound, expression: true })
}

async function expectRunPrintsWho(page: Page): Promise<void> {
  await selectEnvironment(page)
  const { verdict, entries } = await runToEnd(page)
  expect(
    entries.filter((e) => e.message.startsWith('who=')).map((e) => e.message),
    formatEntries(entries),
  ).toEqual(['who=ann'])
  expect(verdict, formatEntries(entries)).toBe('passed')
}

const OUTER_ID = 'contract-outer'
const INNER_ID = 'contract-inner'

/** A library Function whose body holds a Block of `inner`, stored with no contract on it. */
async function seedOuter(request: APIRequestContext, inner: SeededLibraryFunction): Promise<SeededLibraryFunction> {
  return publishLibraryFunction(request, {
    name: `zz-lib-contract-outer-${randomUUID().slice(0, 8)}`,
    workflow: {
      nodes: [
        sharedNode(INNER_ID, {
          functionId: inner.functionId,
          functionVersion: inner.version,
          label: inner.name,
          originalLibraryName: inner.name,
          values: { who: 'x' },
          position: { x: 200, y: 180 },
        }),
      ],
      edges: [startEdge(INNER_ID)],
    },
  })
}

function outerBlock(outer: SeededLibraryFunction): Record<string, unknown> {
  return sharedNode(OUTER_ID, {
    functionId: outer.functionId,
    functionVersion: outer.version,
    label: outer.name,
    originalLibraryName: outer.name,
  })
}

/** The inner Block's sheet lists `who`; close it again. */
async function expectSheetListsWho(page: Page): Promise<void> {
  await expect(page.locator(`[data-testid="workflow-node-${INNER_ID}"]`)).toBeVisible({ timeout: 15_000 })
  const sheet = await openFunctionBlockSheet(page, INNER_ID)
  await expect(sheet.locator('[data-testid="param-row-who"]'), "the inner Block's sheet lists who").toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
}

/** Quick Insert the library Function at the end of the flow; returns the new Block id. */
async function quickInsert(page: Page, fn: SeededLibraryFunction): Promise<string> {
  const before = await canvasBlockIds(page)
  await page.locator('[data-testid="workflow-canvas"] .react-flow__pane').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('Control+Space')
  await expect(page.locator(QUICK_ADD_POPOVER)).toBeVisible({ timeout: 5_000 })
  await applyQuickAddSearch(page, fn.name)
  const row = page.locator(`[data-testid="quick-add-item-${fn.functionId}"]`)
  await expect(row).toBeVisible()
  await row.click()
  await expect(page.locator(QUICK_ADD_POPOVER)).toHaveCount(0)
  const added = (await canvasBlockIds(page)).filter((id) => !before.includes(id))
  expect(added, 'Quick Insert added one Block').toHaveLength(1)
  return added[0]
}

test.describe('V-FN-LIB-CONTRACT (functional): a library Function that lands on a canvas carries its inputs', () => {
  let fn: SeededLibraryFunction | null = null
  let testId = ''
  let outerId = ''

  test.beforeEach(async ({ request }) => {
    await ensureEnvironment(request)
    fn = await publishLibraryFunction(request, {
      name: `zz-lib-contract-${randomUUID().slice(0, 8)}`,
      inputs: [WHO_INPUT],
      workflow: {
        nodes: [logNode('contract-log', 'Print Who', "f'who={who}'", { x: 200, y: 180 })],
        edges: [startEdge('contract-log')],
      },
    })
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    if (outerId) await request.delete(`${BACKEND_URL}/functions/${outerId}?cascade=true`).catch(() => undefined)
    if (fn) await request.delete(`${BACKEND_URL}/functions/${fn.functionId}?cascade=true`).catch(() => undefined)
    testId = ''
    outerId = ''
    fn = null
  })

  test('a library Function dropped on the Test flow lists its inputs, takes a binding and saves it', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await createValidTest(request, { name: `zz-lib-contract-flow-${randomUUID().slice(0, 8)}`, nodes: [] })
    await openSeededTest(page, testId)
    const blockId = await dropLibraryFunctionBelowStart(page, fn!.name)
    await bindWho(page, blockId)
    await saveTest(page)
    await expectStoredBinding(request, testId, blockId)
    await expectRunPrintsWho(page)
  })

  test('a library Function dropped into a For Loop body lists its inputs, takes a binding and saves it', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await createValidTest(request, {
      name: `zz-lib-contract-loop-${randomUUID().slice(0, 8)}`,
      nodes: [
        controlNode({
          id: FOR_ID,
          label: 'For Loop',
          elementType: 'for',
          category: 'loop',
          description: FOR_ID,
          values: { mode: 'count', count: 1, start: 0, end: 0 },
          position: { x: 300, y: 200 },
        }),
      ],
      edges: [startEdge(FOR_ID)],
    })
    await openSeededTest(page, testId)
    const blockId = await dropLibraryFunctionBelow(
      page,
      fn!.name,
      page.locator(`[data-testid="workflow-node-${FOR_ID}"] [data-testid="handle-output-body"]`),
    )
    await bindWho(page, blockId)
    await saveTest(page)
    await expectStoredBinding(request, testId, blockId)
    const edges = (await storedTest(request, testId)).workflow.edges as Array<Record<string, unknown>>
    expect(
      edges.some((e) => e.source === FOR_ID && e.target === blockId && e.sourceHandle === 'body'),
      `the Block sits in the For Loop body: ${JSON.stringify(edges)}`,
    ).toBe(true)
    await expectRunPrintsWho(page)
  })

  test('a library Function dropped into a Local Function body lists its inputs, also after the Test is opened again', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const testName = `zz-lib-contract-body-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, {
      name: testName,
      nodes: [localFunctionNode(HOST_ID, 'Host Fn', { nodes: [] })],
      edges: [startEdge(HOST_ID)],
    })
    await openSeededTest(page, testId)
    await digIn(page, HOST_ID)
    const blockId = await dropLibraryFunctionBelowStart(page, fn!.name)
    await bindWho(page, blockId)
    await popToBreadcrumbSegment(page, testName)
    await saveTest(page)
    await expectStoredBinding(request, testId, blockId)

    // Per V-FN-LIB-CONTRACT 4: a Test opened anew resolves the contract inside a Local Function body too.
    await openSeededTest(page, testId)
    await digIn(page, HOST_ID)
    const sheet = await openFunctionBlockSheet(page, blockId)
    await expect(sheet.locator('[data-testid="param-row-who"]')).toBeVisible()
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await popToBreadcrumbSegment(page, testName)
    await expectRunPrintsWho(page)
  })

  test('a pasted copy of a library Function Block lists its inputs, takes a binding and saves it', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await createValidTest(request, { name: `zz-lib-contract-paste-${randomUUID().slice(0, 8)}`, nodes: [] })
    await openSeededTest(page, testId)
    const sourceId = await dropLibraryFunctionBelowStart(page, fn!.name)
    // The paste lands over the source, so the source is bound first.
    await bindWho(page, sourceId)
    const before = await canvasBlockIds(page)
    const source = page.locator(`[data-testid="workflow-node-${sourceId}"]`)
    await source.locator('button').first().click()
    await expect(source).toHaveAttribute('data-selected', 'true')
    await page.keyboard.press('ControlOrMeta+c')
    await page.keyboard.press('ControlOrMeta+v')
    let pastedId = ''
    await expect
      .poll(async () => {
        pastedId = (await canvasBlockIds(page)).find((id) => !before.includes(id)) ?? ''
        return pastedId
      }, { message: 'the paste added one Block' })
      .not.toBe('')
    // The copy keeps the source's binding; a new one proves its sheet lists the input.
    await bindFunctionInputExpression(page, pastedId, 'who', "'bea'")
    await saveTest(page)
    await expectStoredBinding(request, testId, pastedId, "'bea'")
  })

  test('a library Function inserted with Quick Insert lists its inputs, takes a binding and saves it', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await createValidTest(request, { name: `zz-lib-contract-quick-${randomUUID().slice(0, 8)}`, nodes: [] })
    await openSeededTest(page, testId)
    const blockId = await quickInsert(page, fn!)
    await bindWho(page, blockId)
    await saveTest(page)
    await expectStoredBinding(request, testId, blockId)
    await expectRunPrintsWho(page)
  })

  test('a library Function Block inside a library Function body lists its inputs when the body opens in a Test', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const outer = await seedOuter(request, fn!)
    outerId = outer.functionId
    testId = await createValidTest(request, {
      name: `zz-lib-contract-drill-${randomUUID().slice(0, 8)}`,
      nodes: [outerBlock(outer)],
      edges: [startEdge(OUTER_ID)],
    })
    await openSeededTest(page, testId)
    await digIn(page, OUTER_ID)
    // Per V-FN-LIB-CONTRACT 5: the inner Block was stored with no contract; the open body reads it.
    await expectSheetListsWho(page)
  })

  test('a library Function Block inside a library Function body lists its inputs in the library View', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const outer = await seedOuter(request, fn!)
    outerId = outer.functionId
    await openFunctionView(page, outer.functionId, outer.version)
    await expectSheetListsWho(page)
  })

  test('a library Function Block inside a library Function body takes a binding and saves in edit mode', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const outer = await seedOuter(request, fn!)
    outerId = outer.functionId
    const testName = `zz-lib-contract-edit-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, { name: testName, nodes: [outerBlock(outer)], edges: [startEdge(OUTER_ID)] })
    await openSeededTest(page, testId)
    await clickNodeKebabItem(page, OUTER_ID, 'Edit')
    await expect(
      page.locator(`[data-testid="workflow-node-${OUTER_ID}"] [data-testid="edit-mode-mark-wrapper"]`),
    ).toBeVisible({ timeout: 10_000 })
    await digIn(page, OUTER_ID)
    await bindFunctionInputExpression(page, INNER_ID, 'who', BOUND)
    await popToBreadcrumbSegment(page, testName)
    await saveTest(page)

    const nodes = (await storedTest(request, testId)).workflow.nodes as StoredNode[]
    const draftNodes = (nodes.find((node) => node.id === OUTER_ID)?.data.draft?.workflow?.nodes ?? []) as StoredNode[]
    const inner = draftNodes.find((node) => node.id === INNER_ID)
    expect(whoField(inner?.data ?? {}), JSON.stringify(inner?.data)).toEqual({ value: BOUND, expression: true })
  })

  test('a contract read that fails blocks the page, and Try Again reads it and lists the inputs', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await createValidTest(request, { name: `zz-lib-contract-retry-${randomUUID().slice(0, 8)}`, nodes: [] })
    await openSeededTest(page, testId)
    const versionsPath = `/functions/${fn!.functionId}/versions`
    let failed = 0
    await page.route(
      (url) => url.pathname === versionsPath,
      async (route) => {
        if (failed > 0) return route.continue()
        failed += 1
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { message: 'versions read failed' } }),
        })
      },
    )
    const blockId = await quickInsert(page, fn!)

    // Per V-FN-LIB-CONTRACT 6 (no optional success): the failed read blocks the page with the Test-load card.
    const card = page.locator('[data-testid="page-blocked-card"]')
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card.locator('[data-testid="page-blocked-title"]')).toHaveText('Could not load Function versions')
    expect(failed, 'the contract read was refused once').toBe(1)
    await card.locator('[data-testid="page-blocked-retry"]').click()
    await expect(card).toHaveCount(0, { timeout: 10_000 })

    await bindWho(page, blockId)
    await saveTest(page)
    await expectStoredBinding(request, testId, blockId)
  })
})
