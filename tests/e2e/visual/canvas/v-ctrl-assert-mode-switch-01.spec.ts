/**
 * V-CTRL-ASSERT-MODE-SWITCH-01: split-mode Assert handles auto-wire correctly
 *
 * A proximity drop of a Log near the pass or fail handle of a split-mode Assert persists
 * the edge with that ``sourceHandle``. ``mode`` defaults to ``"split"`` in the param and
 * in the node, so a fresh palette drop renders the pass/fail handles.
 *
 * The test seeds the Assert pre-configured in split mode to stay free of modal validation noise.
 *
 * Pass criteria: proximity drop of a Log below the Assert's pass handle creates
 * a persisted edge with ``sourceHandle === "pass"`` (the first free split-mode
 * handle).
 */
import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { dropLogAt, expandPalette, getWorkflowNodes } from '../../helpers/edge-drag'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet, openNodeSheet } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'

const ASSERT_NODE_ID = 'assert-split-1'

function buildSeed(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'Split-mode Assert auto-wire repro',
    workflow: {
      nodes: [
        {
          id: ASSERT_NODE_ID,
          type: 'workflowNode',
          position: { x: 200, y: 200 },
          data: {
            label: 'Assert_1',
            elementType: 'assert',
            nodeType: 'control',
            category: 'control',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                mode: 'split',
                // Current assertion shape: an expression row needs no declared
                // variable, so the seeded Assert is complete and Save is open.
                assertions: [
                  { id: 'assert-row-1', type: 'expression', expression: '1 == 1' },
                ],
                fail_current_scope: false,
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 160, height: 80 },
        },
      ],
      edges: [
        { id: 'edge-start-assert', source: 'start-node', target: ASSERT_NODE_ID },
      ],
    },
  }
}

test.describe('V-CTRL-ASSERT-MODE-SWITCH-01: split-mode Assert auto-edge', () => {
  test('dropping a Log below the pass handle auto-connects via sourceHandle="pass"', async ({
    page,
  }) => {
    // Seed a Test with the Assert already in split mode + a valid assertion row.
    const seedName = `V-CTRL-ASSERT-MODE-SWITCH ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const createResp = await page.request.post(`${BACKEND_URL}/tests`, { data: buildSeed(seedName) })
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()}`).toBeTruthy()
    const createBody = await createResp.json()
    const testId: string = createBody.data?.id ?? createBody.id
    expect(testId).toBeTruthy()

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Expand the palette up-front so the canvas layout (and therefore the
    // Assert's screen coords) is the same before and after the proximity drop.
    // dropLogAt also expands the palette, but doing it AFTER computing assertBox
    // shifts the canvas right and the drop coords land far to the left of the
    // intended target.
    await expandPalette(page)

    // Sanity: the seeded Assert is rendered with split-mode handles.
    await expect(page.locator('[data-testid="handle-output-pass"]')).toBeVisible()
    await expect(page.locator('[data-testid="handle-output-fail"]')).toBeVisible()

    // Locate the Assert node. Drop just below its bottom-center so the
    // proximity check (ELEMENT_PROXIMITY_THRESHOLD=100px, distance measured
    // from node's bottom-center) reliably picks the Assert as the source.
    // For a split-mode multi-handle node, findFreeHandle picks the first
    // free handle ('pass'); that's what we assert below.
    const assertNode = getWorkflowNodes(page).filter({ hasText: 'Assert_1' }).first()
    await expect(assertNode).toBeVisible()
    const assertBox = await assertNode.boundingBox()
    expect(assertBox).not.toBeNull()
    // Drop ~20px directly below the node's bottom-center.
    const passDropX = assertBox!.x + assertBox!.width / 2
    const passDropY = assertBox!.y + assertBox!.height + 20

    // Edge count before drop (Start -> Assert).
    const edgeCountBefore = await page.locator('.react-flow__edge').count()

    // Drop a Log via the palette proximity drop.
    await dropLogAt(page, passDropX, passDropY)

    // An auto-edge from the Assert to the new Log should have been created.
    await expect(page.locator('.react-flow__edge')).toHaveCount(edgeCountBefore + 1, { timeout: 5_000 })

    // Fill in the Log's required ``message`` parameter so the test will
    // round-trip cleanly through the save validator. (The required-param
    // gate is unrelated to the mode switch; without this step the
    // Save toolbar shows a "Cannot Save Test" modal and the API round-trip
    // below can't verify the edge.)
    const logNode = getWorkflowNodes(page).filter({ hasText: 'Log' }).first()
    await logNode.locator('button').first().click()
    await expect(logNode).toHaveAttribute('data-selected', 'true', { timeout: 5_000 })
    // Scope to the Log's configure button - the page-level selector matches every
    // node's cog, and the Log overlaps the Assert in this layout.
    await openNodeSheet(page, logNode)
    // A literal string message edits through the shared "Edit value" sheet.
    await setStringParam(configSheet(page), page, 'message', 'hi')
    await configSheet(page).getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('[data-testid="param-expand-message"]')).toHaveCount(0)

    // Persist via toolbar Save.
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 10_000 })

    // Fetch and find the edge whose source is the Assert.
    const fetched = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
    expect(fetched.ok()).toBeTruthy()
    const fetchedBody = await fetched.json()
    const workflow = fetchedBody.data?.workflow ?? fetchedBody.workflow
    const edges = workflow.edges as Array<{
      source: string
      target: string
      sourceHandle?: string | null
    }>

    const assertEdges = edges.filter((e) => e.source === ASSERT_NODE_ID)
    expect(assertEdges.length, 'expected exactly one new edge from the Assert').toBe(1)
    expect(
      assertEdges[0].sourceHandle,
      'split-mode Assert auto-edge must attach to "pass" handle, not single-mode default (sourceHandle undefined)',
    ).toBe('pass')
  })

  test('after switching split -> single, the auto-edge attaches with NO sourceHandle (single-mode default)', async ({
    page,
  }) => {
    // Seed an Assert in SPLIT mode + a valid assertion row, so the modal will
    // save cleanly when we flip mode to "single".
    const seedName = `V-CTRL-ASSERT-MODE-SWITCH-FLIP ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const createResp = await page.request.post(`${BACKEND_URL}/tests`, { data: buildSeed(seedName) })
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()}`).toBeTruthy()
    const createBody = await createResp.json()
    const testId: string = createBody.data?.id ?? createBody.id
    expect(testId).toBeTruthy()

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await expandPalette(page)

    // Sanity: seed renders in split mode.
    await expect(page.locator('[data-testid="handle-output-pass"]')).toBeVisible()
    await expect(page.locator('[data-testid="handle-output-fail"]')).toBeVisible()

    // Open the Assert config modal and switch mode to single.
    const assertNode = getWorkflowNodes(page).filter({ hasText: 'Assert_1' }).first()
    await assertNode.locator('button').first().click()
    await expect(assertNode).toHaveAttribute('data-selected', 'true', { timeout: 5_000 })
    await openNodeSheet(page, assertNode)
    await page.locator('label[for="mode-single"]').click()
    await configSheet(page).getByRole('button', { name: 'Save' }).click()

    // Single-mode handles: pass + fail must be gone, default handle present.
    await expect(page.locator('[data-testid="handle-output-pass"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="handle-output-fail"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="handle-output"]')).toBeVisible()

    // Drop a Log just below the Assert to trigger proximity auto-connect.
    const assertBox = await assertNode.boundingBox()
    expect(assertBox).not.toBeNull()
    const dropX = assertBox!.x + assertBox!.width / 2
    const dropY = assertBox!.y + assertBox!.height + 20
    const edgeCountBefore = await page.locator('.react-flow__edge').count()
    await dropLogAt(page, dropX, dropY)
    await expect(page.locator('.react-flow__edge')).toHaveCount(edgeCountBefore + 1, { timeout: 5_000 })

    // Fill in Log's required message.
    const logNode = getWorkflowNodes(page).filter({ hasText: 'Log' }).first()
    await logNode.locator('button').first().click()
    await expect(logNode).toHaveAttribute('data-selected', 'true', { timeout: 5_000 })
    await openNodeSheet(page, logNode)
    // A literal string message edits through the shared "Edit value" sheet.
    await setStringParam(configSheet(page), page, 'message', 'hi')
    await configSheet(page).getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('[data-testid="param-expand-message"]')).toHaveCount(0)

    // Persist + fetch and verify the new edge has NO sourceHandle (single-mode default).
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 10_000 })

    const fetched = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
    expect(fetched.ok()).toBeTruthy()
    const fetchedBody = await fetched.json()
    const workflow = fetchedBody.data?.workflow ?? fetchedBody.workflow
    const edges = workflow.edges as Array<{
      source: string
      target: string
      sourceHandle?: string | null
    }>
    const assertEdges = edges.filter((e) => e.source === ASSERT_NODE_ID)
    expect(assertEdges.length, 'expected exactly one new edge from the Assert').toBe(1)
    // Single-mode edges carry no sourceHandle.
    expect(
      assertEdges[0].sourceHandle ?? null,
      'single-mode Assert auto-edge must NOT carry the old split-mode "pass" handle',
    ).toBeNull()
  })

  test('editing a freshly-dropped Assert without changing mode preserves wired egress edges', async ({
    page,
  }) => {
    // When default mode is "split" (the param default), a freshly-dropped Assert has
    // ``data.config.values.mode === undefined`` in the store. Saving treats that as
    // "split" and keeps every wired egress.

    const seedName = `V-CTRL-ASSERT-EDIT-PRESERVE ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // Seed a fresh Assert (NO mode set - mimics palette drop) already wired
    // to a pass-Log and a fail-Log. Adding an expression and saving keeps both edges.
    const passLogId = 'pass-log-fresh'
    const failLogId = 'fail-log-fresh'
    const seed = {
      name: seedName,
      version: '1.0.0',
      description: 'BUG: fresh Assert edit must not wipe wired egress edges',
      workflow: {
        nodes: [
          {
            id: ASSERT_NODE_ID,
            type: 'workflowNode',
            position: { x: 200, y: 150 },
            data: {
              label: 'Assert_1',
              elementType: 'assert',
              nodeType: 'control',
              category: 'control',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              // No config.values.mode - fresh palette-drop shape.
              config: {
                values: {
                  assertions: [
                    { id: 'a1', type: 'expression', expression: '1 == 1' },
                  ],
                },
                outputBindings: {},
                profileBindings: [],
              },
            },
          },
          {
            id: passLogId,
            type: 'workflowNode',
            position: { x: 80, y: 380 },
            data: {
              label: 'Pass_Log',
              elementType: 'log',
              nodeType: 'plugin',
              version: '1.0.0',
              expressionFields: ['message'],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: { message: "'p'", level: 'INFO' }, profileBindings: [], outputBindings: {} },
            },
          },
          {
            id: failLogId,
            type: 'workflowNode',
            position: { x: 380, y: 380 },
            data: {
              label: 'Fail_Log',
              elementType: 'log',
              nodeType: 'plugin',
              version: '1.0.0',
              expressionFields: ['message'],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: { message: "'f'", level: 'INFO' }, profileBindings: [], outputBindings: {} },
            },
          },
        ],
        edges: [
          { id: 'e-start-assert', source: 'start-node', target: ASSERT_NODE_ID },
          { id: 'e-assert-pass', source: ASSERT_NODE_ID, target: passLogId, sourceHandle: 'pass' },
          { id: 'e-assert-fail', source: ASSERT_NODE_ID, target: failLogId, sourceHandle: 'fail' },
        ],
      },
    }
    const createResp = await page.request.post(`${BACKEND_URL}/tests`, { data: seed })
    expect(createResp.ok()).toBeTruthy()
    const testId: string = (await createResp.json()).data.id

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Both egress edges visible before edit.
    expect(await page.locator('.react-flow__edge').count()).toBe(3) // start->assert, assert->pass, assert->fail

    // Open the Assert modal. Don't touch mode. Don't add new assertions. Save.
    // (The seeded assertion is enough to make the form valid.)
    const assertNode = getWorkflowNodes(page).filter({ hasText: 'Assert_1' }).first()
    await assertNode.locator('button').first().click()
    await expect(assertNode).toHaveAttribute('data-selected', 'true', { timeout: 5_000 })
    await openNodeSheet(page, assertNode)
    // Save is dead on an untouched sheet, so edit the name - never the mode.
    await configSheet(page).locator('[data-testid="element-name-input"]').fill('Assert_1 edited')
    await configSheet(page).getByRole('button', { name: 'Save' }).click()
    // Modal closes - palette / branching radio gone.
    await expect(page.locator('label[for="mode-split"]')).toHaveCount(0)

    // The edges from the Assert must survive here.
    const edgeCountAfter = await page.locator('.react-flow__edge').count()
    expect(
      edgeCountAfter,
      'editing a fresh Assert (no mode change) must preserve its egress edges',
    ).toBe(3)
  })
})
