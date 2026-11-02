/**
 * V-SHEET-03: Sheet reopen affordance - raise + pulse
 * Wireframe: N/A (shared interaction affordance, no new visual surface)
 * Design Decisions: DraggableSheet family; shared refocusSheet;
 *   04-visual-workflow-builder "Sheets Opened from a Sheet"; 05-configuration-editors "File references"
 * REQ: Workbench Session Artifacts (criteria S1 to S4 below)
 *
 * Pass Criteria:
 *  1. S1: re-triggering the open control of an already-open sheet plays
 *     the select pulse (`animate-sheet-select-pulse` on the sheet root,
 *     cleared on animationend) and does NOT duplicate the surface, for all
 *     four triggers: (a) palette Function Lib button, (b) node config
 *     double-click AND the gear Configure action, (c) variable row watcher
 *     re-open, (d) breadcrumb Artifacts chip
 *  2. S2: with two sheets open, re-triggering the back one raises it
 *     (data-active moves to it) without opening a second instance
 *  3. S3: on an SFTP Download block, with the config sheet brought in front
 *     by its header, a second press of Destination's edit control leaves
 *     exactly one `value-editor-sheet`, carrying `data-active="true"` and the
 *     pulse, and the config sheet loses `data-active`; a second press of
 *     Destination's Browse does the same for `file-reference-picker-sheet`
 *     (the field holds one of the two at a time, so Browse replaces a clean
 *     Edit value sheet)
 *  4. S4: the same for the `profile-binding-sheet` opened by Profiles
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, expandPalette } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { openBlockSheet } from '../../helpers/workbench'

const PULSE = /animate-sheet-select-pulse/
const SFTP_NODE = 'sftp-node-1'

function buildFixture() {
  return {
    name: `Sheet Reopen Pulse ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    version: '1.0.0',
    description: 'One Log node + one variable for the sheet reopen-pulse triggers.',
    workflow: {
      nodes: [
        {
          id: 'log-node-1',
          type: 'workflowNode',
          position: { x: 400, y: 150 },
          data: {
            label: 'Log',
            elementType: 'log',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            description: 'Pulse Target',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            config: {
              values: { message: 'hello', level: 'INFO' },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
        {
          id: SFTP_NODE,
          type: 'workflowNode',
          position: { x: 400, y: 330 },
          data: {
            label: 'SFTP',
            elementType: 'sftp',
            nodeType: 'plugin',
            category: 'remote',
            version: '1.0.0',
            description: 'Reopen Target',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            config: {
              values: {
                session_id: 'sheet-reopen',
                operation: 'download',
                source: '/srv/in/a.txt',
                destination: 'artifact://out/a.txt',
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [
        { id: 'e1', source: 'start-node', target: 'log-node-1', type: 'default' },
        { id: 'e2', source: 'log-node-1', target: SFTP_NODE, type: 'default' },
      ],
    },
    variables: {
      greeting: { value: 'hello', type: 'string', scope: 'test' },
    },
    metadata: {},
    created_at: '2026-07-01T00:00:00.000000',
    updated_at: '2026-07-01T00:00:00.000000',
  }
}

const createdTests: string[] = []

async function importFixture(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/tests`, { data: buildFixture() })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  createdTests.push(data.id as string)
  return data.id as string
}

async function openFixtureCanvas(page: Page, testId: string) {
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

/** Assert the one-shot reopen pulse: class present, single instance, class clears. */
async function expectReopenPulse(sheet: Locator) {
  await expect(sheet, 'reopen pulses the sheet root').toHaveClass(PULSE)
  await expect(sheet, 'reopen must not duplicate the sheet').toHaveCount(1)
  await expect(sheet, 'pulse is one-shot (clears on animationend)').not.toHaveClass(PULSE, {
    timeout: 5_000,
  })
}

/** Drag a sheet by its header handle so its trigger control is unobstructed. */
async function dragSheetBy(page: Page, handle: Locator, dx: number, dy: number) {
  const box = await handle.boundingBox()
  const startX = box!.x + box!.width / 2
  const startY = box!.y + box!.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + dx, startY + dy, { steps: 5 })
  await page.mouse.up()
}

/** Click the bare header of a sheet at a point no other sheet covers, bringing it in front. */
async function raiseByHeader(page: Page, sheetTestId: string) {
  const handleId = `${sheetTestId}-drag-handle`
  const point = await page.locator(`[data-testid="${handleId}"]`).evaluate((handle, id) => {
    const box = handle.getBoundingClientRect()
    const y = box.top + box.height / 2
    for (let x = box.left + 8; x < box.right - 8; x += 8) {
      const hit = document.elementFromPoint(x, y)
      const onHandle = hit?.closest(`[data-testid="${id}"]`) === handle
      if (onHandle && !hit?.closest('button, input, textarea, select, a, [role="combobox"]')) return { x, y }
    }
    return null
  }, handleId)
  expect(point, `the ${sheetTestId} header offers a bare point no other sheet covers`).not.toBeNull()
  await page.mouse.click(point!.x, point!.y)
  await expect(page.locator(`[data-testid="${sheetTestId}"]`)).toHaveAttribute('data-active', 'true')
}

type PulseHost = HTMLElement & { pulseSeen?: boolean; pulseObserver?: MutationObserver }

/** Record from now on whether the sheet root takes the one-shot pulse class (it lasts one 750 ms animation). */
async function watchPulse(sheet: Locator) {
  await expect(sheet, 'no earlier pulse still running').not.toHaveClass(PULSE, { timeout: 5_000 })
  await sheet.evaluate((root) => {
    const host = root as PulseHost
    host.pulseSeen = false
    host.pulseObserver?.disconnect()
    host.pulseObserver = new MutationObserver(() => {
      if (host.classList.contains('animate-sheet-select-pulse')) host.pulseSeen = true
    })
    host.pulseObserver.observe(host, { attributes: true, attributeFilter: ['class'] })
  })
}

/** Assert the watched sheet root carried the pulse class after the press. */
async function expectPulsed(sheet: Locator, message: string) {
  await expect
    .poll(() => sheet.evaluate((root) => (root as PulseHost).pulseSeen === true), { message })
    .toBe(true)
}

/** Drag a React Flow node so its center lands on the given viewport point. */
async function dragNodeTo(page: Page, node: Locator, x: number, y: number) {
  const box = await node.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 10 })
  await page.mouse.up()
}

test.describe('V-SHEET-03: reopen raises + pulses (one shared affordance)', () => {
  test.beforeEach(async ({ page }) => {
    // Session-draft-leak guard: bare /workbench restores the backend draft.
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  })

  test.afterAll(async ({ request }) => {
    for (const testId of createdTests) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
    }
  })

  test('S1a: Function Lib button re-click pulses the open library sheet', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const libraryBtn = page.locator('[data-testid="palette-blocks-library-button"]')
    await libraryBtn.click()
    const library = page.locator('[data-testid="functions-library"]')
    await expect(library).toBeVisible()
    await expect(library).not.toHaveClass(PULSE)

    // S1 (a): the library button while the library is already open.
    await libraryBtn.click()
    await expectReopenPulse(library)
  })

  test('S1b: config double-click AND gear Configure pulse the open config sheet', async ({
    page,
    request,
  }) => {
    const testId = await importFixture(request)
    await openFixtureCanvas(page, testId)

    const node = page.locator('[data-testid="workflow-node-log-node-1"]')
    // Park the node in the top-left canvas corner FIRST: the config sheet
    // opens centered and is wide enough to cover a fit-viewed node, which
    // would block the re-trigger clicks below.
    await dragNodeTo(page, node, 390, 150)

    await node.dblclick()
    const configSheet = page.locator('[data-testid="element-config-sheet"]')
    await expect(configSheet).toBeVisible()

    // Park the sheet in the bottom-right corner (viewport-clamped), fully
    // clear of the parked node on both axes.
    await dragSheetBy(page, page.locator('[data-testid="element-config-sheet-drag-handle"]'), 900, 500)

    // S1 (b1): double-click on the node whose sheet is already open.
    await node.dblclick()
    await expectReopenPulse(configSheet)

    // S1 (b2): the gear Configure action routes through the same guard.
    await node.hover()
    await openBlockSheet(page, 'log-node-1')
    await expectReopenPulse(configSheet)
  })

  test('S1c: variable row re-open pulses the open watcher', async ({ page, request }) => {
    const testId = await importFixture(request)
    await openFixtureCanvas(page, testId)

    const panel = page.locator('[data-testid="variable-manager"]')
    if ((await panel.getAttribute('data-state')) === 'collapsed') {
      await panel.locator('button[aria-label="Expand Variable Manager"]').click()
      await expect(panel).toHaveAttribute('data-state', 'expanded')
    }

    const row = page.locator('[aria-label="Variable greeting"]')
    await expect(row).toBeVisible()
    await row.hover()
    await row.locator('[data-testid^="expand-button-"]').click()
    const watcher = page.locator('section[aria-label="Inspect variable greeting"]')
    await expect(watcher).toBeVisible()

    // Move the watcher off the panel row so the re-open control is reachable.
    await dragSheetBy(page, watcher.locator('[data-testid$="-drag-handle"]'), 0, -220)

    // S1 (c): re-opening the row whose watcher is already open.
    await row.hover()
    await row.locator('[data-testid^="expand-button-"]').click()
    await expectReopenPulse(watcher)
  })

  test('S1d: Artifacts chip re-click pulses the open Session Artifacts sheet', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const chip = page.locator('[data-testid="breadcrumb-artifacts-chip"]')
    await chip.click()
    const sheet = page.locator('[data-testid="session-artifacts-sheet"]')
    await expect(sheet).toBeVisible()

    // S1 (d): the chip while the sheet is already open.
    await chip.click()
    await expectReopenPulse(sheet)
  })

  test('S2: re-triggering the back sheet raises it (data-active moves)', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Open the artifacts sheet first, then the library on top of it.
    await page.locator('[data-testid="breadcrumb-artifacts-chip"]').click()
    const artifacts = page.locator('[data-testid="session-artifacts-sheet"]')
    await expect(artifacts).toBeVisible()

    await expandPalette(page)
    await page.locator('[data-testid="palette-blocks-library-button"]').click()
    const library = page.locator('[data-testid="functions-library"]')
    await expect(library).toBeVisible()

    // The freshly opened library is the front-most (active) sheet.
    await expect(library).toHaveAttribute('data-active', 'true')
    await expect(artifacts).not.toHaveAttribute('data-active', 'true')

    // S2: re-triggering the BACK sheet brings it to the front.
    await page.locator('[data-testid="breadcrumb-artifacts-chip"]').click()
    await expect(artifacts).toHaveAttribute('data-active', 'true')
    await expect(library).not.toHaveAttribute('data-active', 'true')
    await expect(artifacts).toHaveCount(1)
    await expect(library).toHaveCount(1)
  })

  test('S3: Destination edit and Browse bring their open sheet back in front of the config', async ({
    page,
    request,
  }) => {
    const testId = await importFixture(request)
    await openFixtureCanvas(page, testId)

    await page.locator(`[data-testid="workflow-node-${SFTP_NODE}"]`).dblclick()
    const configSheet = page.locator('[data-testid="element-config-sheet"]')
    await expect(configSheet).toBeVisible()
    const editButton = configSheet.locator('[data-testid="param-expand-destination"]')
    const browseButton = configSheet.locator('[data-testid="param-browse-destination"]')
    const valueSheet = page.locator('[data-testid="value-editor-sheet"]')
    const pickerSheet = page.locator('[data-testid="file-reference-picker-sheet"]')

    await test.step('the Edit value sheet', async () => {
      await editButton.click()
      await expect(valueSheet).toBeVisible()
      await raiseByHeader(page, 'element-config-sheet')
      await expect(valueSheet).not.toHaveAttribute('data-active')

      await watchPulse(valueSheet)
      await editButton.click()
      await expect(valueSheet, 'a second press opens no second copy').toHaveCount(1)
      await expect(valueSheet).toHaveAttribute('data-active', 'true')
      await expectPulsed(valueSheet, 'the Edit value sheet pulses on its second press')
      await expect(configSheet).not.toHaveAttribute('data-active')
    })

    await test.step('the file picker', async () => {
      await raiseByHeader(page, 'element-config-sheet')
      await browseButton.click()
      await expect(pickerSheet).toBeVisible()
      // Per 05 "File references": a field holds its Edit value sheet or its picker, never both.
      await expect(valueSheet).toHaveCount(0)
      await raiseByHeader(page, 'element-config-sheet')
      await expect(pickerSheet).not.toHaveAttribute('data-active')

      await watchPulse(pickerSheet)
      await browseButton.click()
      await expect(pickerSheet, 'a second press opens no second copy').toHaveCount(1)
      await expect(pickerSheet).toHaveAttribute('data-active', 'true')
      await expectPulsed(pickerSheet, 'the file picker pulses on its second press')
      await expect(configSheet).not.toHaveAttribute('data-active')
    })
  })

  test('S4: Profiles brings the open Profiles sheet back in front of the config', async ({
    page,
    request,
  }) => {
    const testId = await importFixture(request)
    await openFixtureCanvas(page, testId)

    await page.locator(`[data-testid="workflow-node-${SFTP_NODE}"]`).dblclick()
    const configSheet = page.locator('[data-testid="element-config-sheet"]')
    await expect(configSheet).toBeVisible()
    const profilesButton = configSheet.getByRole('button', { name: 'Profiles', exact: true })
    const profilesSheet = page.locator('[data-testid="profile-binding-sheet"]')

    await profilesButton.click()
    await expect(profilesSheet).toBeVisible()
    await raiseByHeader(page, 'element-config-sheet')
    await expect(profilesSheet).not.toHaveAttribute('data-active')

    await watchPulse(profilesSheet)
    await profilesButton.click()
    await expect(profilesSheet, 'a second press opens no second copy').toHaveCount(1)
    await expect(profilesSheet).toHaveAttribute('data-active', 'true')
    await expectPulsed(profilesSheet, 'the Profiles sheet pulses on its second press')
    await expect(configSheet).not.toHaveAttribute('data-active')
  })
})
