/**
 * V-CTRL-NOTE-01: Note Resize and Edge Anchoring
 *
 * Validates that the Note control:
 * 1.1 Can be resized vertically, horizontally, and diagonally
 * 1.2 Handles (ingress/egress) remain at top/bottom borders after each resize
 * 1.3 Connected edges stay anchored to handles after each resize
 * 1.4 All above hold after adding multiple lines of text
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'

/** Position tolerance in pixels for handle/edge anchoring checks */
const HANDLE_TOLERANCE = 15
const EDGE_TOLERANCE = 30

test.describe('V-CTRL-NOTE-01: Note Resize and Edge Anchoring', () => {
  // The default 1280x800 viewport leaves ~710 px of usable canvas after the
  // palette (~250 px) and Variable Manager (320 px) are subtracted. Dropping
  // three nodes at fractional ratios (0.6, 0.45, 0.75) on that narrow canvas
  // pushes the downstream HTTP under the Note and the Note's right resize
  // line up against the Variable Manager edge, which makes the horizontal
  // resize drag overshoot into the panel and select text instead of resizing.
  // 1920x1080 gives the canvas enough room that the three nodes don't crowd.
  test.use({ viewport: { width: 1920, height: 1080 } })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function setupPalette(page: Page) {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }
  }

  async function searchAndDrop(
    page: Page,
    searchTerm: string,
    paletteTestId: string,
    canvasXRatio: number,
    canvasYRatio: number,
  ) {
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)
    // Wait for palette to filter results
    const item = page.locator(`[data-testid="${paletteTestId}"]`)
    await expect(item).toBeVisible({ timeout: 5000 })

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(page, { term: searchTerm, testId: paletteTestId }, {
        x: canvasBox!.width * canvasXRatio,
        y: canvasBox!.height * canvasYRatio,
      })
    await page.waitForTimeout(300)
  }

  async function connectHandles(page: Page, source: Locator, target: Locator) {
    const sBox = await source.boundingBox()
    const tBox = await target.boundingBox()
    expect(sBox, 'Source handle must be visible').not.toBeNull()
    expect(tBox, 'Target handle must be visible').not.toBeNull()

    await page.mouse.move(sBox!.x + sBox!.width / 2, sBox!.y + sBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      tBox!.x + tBox!.width / 2,
      tBox!.y + tBox!.height / 2,
      { steps: 10 },
    )
    await page.mouse.up()
    await page.waitForTimeout(200)
  }

  function center(box: { x: number; y: number; width: number; height: number }) {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  /**
   * Get the React Flow node wrapper for the note.
   * This is the element whose dimensions are controlled by NodeResizer.
   */
  function rfWrapper(page: Page, noteId: string) {
    return page.locator(`.react-flow__node[data-id="${noteId}"]`)
  }

  /** Extract the note's node id from its data-testid */
  async function getNoteId(noteNode: Locator): Promise<string> {
    const testId = await noteNode.getAttribute('data-testid')
    return testId!.replace('note-node-', '')
  }

  /**
   * Verify ingress handle is at top border, egress handle at visual bottom border.
   * When the action row is visible (selected/editing), the output handle is offset
   * below the RF wrapper to align with the action row bottom.
   */
  async function verifyHandlePositions(
    page: Page,
    noteNode: Locator,
    label: string,
  ) {
    const noteId = await getNoteId(noteNode)
    const wrapperBox = await rfWrapper(page, noteId).boundingBox()
    expect(wrapperBox, `${label}: RF wrapper must have bounds`).not.toBeNull()

    const inputBox = await noteNode.locator('[data-testid="note-handle-input"]').boundingBox()
    const outputBox = await noteNode.locator('[data-testid="note-handle-output"]').boundingBox()
    expect(inputBox, `${label}: input handle must be visible`).not.toBeNull()
    expect(outputBox, `${label}: output handle must be visible`).not.toBeNull()

    const inputY = inputBox!.y + inputBox!.height / 2
    const outputY = outputBox!.y + outputBox!.height / 2
    const nodeTop = wrapperBox!.y

    // Determine expected bottom: action row bottom if visible, RF wrapper bottom otherwise
    const actionRow = noteNode.locator('[data-testid="node-status-bar"]')
    const hasActionRow = await actionRow.isVisible().catch(() => false)
    let expectedBottom: number
    if (hasActionRow) {
      const arBox = await actionRow.boundingBox()
      expectedBottom = arBox ? arBox.y + arBox.height : wrapperBox!.y + wrapperBox!.height
    } else {
      expectedBottom = wrapperBox!.y + wrapperBox!.height
    }

    expect(
      Math.abs(inputY - nodeTop),
      `${label}: input handle Y=${inputY.toFixed(0)} should be near node top=${nodeTop.toFixed(0)}`,
    ).toBeLessThan(HANDLE_TOLERANCE)

    expect(
      Math.abs(outputY - expectedBottom),
      `${label}: output handle Y=${outputY.toFixed(0)} should be near visual bottom=${expectedBottom.toFixed(0)}`,
    ).toBeLessThan(HANDLE_TOLERANCE)
  }

  /** Verify edge SVG paths reach the note's handles (not stranded) */
  async function verifyEdgeAnchoring(
    page: Page,
    noteNode: Locator,
    label: string,
  ) {
    const inputBox = await noteNode.locator('[data-testid="note-handle-input"]').boundingBox()
    const outputBox = await noteNode.locator('[data-testid="note-handle-output"]').boundingBox()
    expect(inputBox, `${label}: input handle visible`).not.toBeNull()
    expect(outputBox, `${label}: output handle visible`).not.toBeNull()

    const inputCenter = center(inputBox!)
    const outputCenter = center(outputBox!)

    // Extract edge path endpoints in screen coordinates
    const endpoints = await page.evaluate(() => {
      const result: Array<{ sx: number; sy: number; ex: number; ey: number }> = []
      const edges = document.querySelectorAll('.react-flow__edge')
      for (const edge of edges) {
        const path = edge.querySelector('path.react-flow__edge-path') as SVGPathElement | null
        if (!path) continue
        const len = path.getTotalLength()
        if (len === 0) continue
        const s = path.getPointAtLength(0)
        const e = path.getPointAtLength(len)
        const ctm = path.ownerSVGElement?.getScreenCTM()
        if (!ctm) continue
        const sp = new DOMPoint(s.x, s.y).matrixTransform(ctm)
        const ep = new DOMPoint(e.x, e.y).matrixTransform(ctm)
        result.push({ sx: sp.x, sy: sp.y, ex: ep.x, ey: ep.y })
      }
      return result
    })

    expect(endpoints.length, `${label}: should have edge paths`).toBeGreaterThanOrEqual(2)

    // At least one edge endpoint should be near the input handle
    const inputAnchored = endpoints.some(
      (ep) =>
        (Math.abs(ep.ex - inputCenter.x) < EDGE_TOLERANCE &&
          Math.abs(ep.ey - inputCenter.y) < EDGE_TOLERANCE) ||
        (Math.abs(ep.sx - inputCenter.x) < EDGE_TOLERANCE &&
          Math.abs(ep.sy - inputCenter.y) < EDGE_TOLERANCE),
    )

    // At least one edge endpoint should be near the output handle
    const outputAnchored = endpoints.some(
      (ep) =>
        (Math.abs(ep.sx - outputCenter.x) < EDGE_TOLERANCE &&
          Math.abs(ep.sy - outputCenter.y) < EDGE_TOLERANCE) ||
        (Math.abs(ep.ex - outputCenter.x) < EDGE_TOLERANCE &&
          Math.abs(ep.ey - outputCenter.y) < EDGE_TOLERANCE),
    )

    expect(inputAnchored, `${label}: an edge must reach input handle`).toBe(true)
    expect(outputAnchored, `${label}: an edge must reach output handle`).toBe(true)
  }

  /**
   * Resize the note by locating and dragging the actual resize control element.
   * Uses React Flow's resize control CSS classes for precise targeting.
   */
  async function resizeNote(
    page: Page,
    noteNode: Locator,
    direction: 'vertical' | 'horizontal' | 'diagonal',
    delta: number,
  ) {
    // Ensure the note is selected so resize controls are active
    await noteNode.click({ position: { x: 50, y: 20 }, force: true })
    await page.waitForTimeout(200)

    // Locate the specific resize control element
    // For diagonal, use top-left corner handle to avoid overlap with action row
    let control: Locator
    let deltaX = 0, deltaY = 0
    switch (direction) {
      case 'vertical':
        control = noteNode.locator('.react-flow__resize-control.line.bottom')
        deltaY = delta
        break
      case 'horizontal':
        control = noteNode.locator('.react-flow__resize-control.line.right')
        deltaX = delta
        break
      case 'diagonal':
        // Use top-left corner: dragging up-left increases both dimensions
        control = noteNode.locator('.react-flow__resize-control.handle.top.left')
        deltaX = -delta
        deltaY = -delta
        break
    }

    await expect(control, `${direction} resize control must exist`).toBeAttached()
    const controlBox = await control.boundingBox()
    expect(controlBox, `${direction} resize control must have bounds`).not.toBeNull()

    const startX = controlBox!.x + controlBox!.width / 2
    const startY = controlBox!.y + controlBox!.height / 2
    const endX = startX + deltaX
    const endY = startY + deltaY

    // Screenshot before resize to validate starting position
    await page.screenshot({ path: `test-results/resize-${direction}-before.png` })

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(endX, endY, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    // Screenshot after resize to validate result
    await page.screenshot({ path: `test-results/resize-${direction}-after.png` })
  }

  /**
   * Full setup: drop a Note node flanked by two HTTP Client nodes, connect edges.
   * Returns the note node locator and the note id.
   */
  async function setupNoteWithEdges(page: Page) {
    await setupPalette(page)

    // Drop HTTP Client at top (upstream)
    await searchAndDrop(page, 'http', 'palette-item-http-client', 0.6, 0.15)

    // Drop Note in the center
    await searchAndDrop(page, 'note', 'palette-item-note', 0.6, 0.45)

    // Drop another HTTP Client at the bottom (downstream)
    await searchAndDrop(page, 'http', 'palette-item-http-client', 0.6, 0.75)

    const noteNode = page.locator('[data-testid^="note-node-"]')
    await expect(noteNode, 'Note node should exist').toBeVisible()

    // Find workflow nodes sorted by Y position to identify upstream/downstream
    // Use polling assertion - React Flow renders nodes asynchronously under load
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]',
    )
    await expect.poll(
      () => workflowNodes.count(),
      { timeout: 5000, message: 'Should have 2 workflow nodes' },
    ).toBe(2)
    const nodeCount = await workflowNodes.count()

    // Sort by Y to get [upstream, downstream]
    const nodesWithY: Array<{ index: number; y: number }> = []
    for (let i = 0; i < nodeCount; i++) {
      const box = await workflowNodes.nth(i).boundingBox()
      nodesWithY.push({ index: i, y: box!.y })
    }
    nodesWithY.sort((a, b) => a.y - b.y)

    const upstreamNode = workflowNodes.nth(nodesWithY[0].index)
    const downstreamNode = workflowNodes.nth(nodesWithY[1].index)

    // Connect: upstream output -> note input
    const upstreamOutput = upstreamNode.locator('.react-flow__handle-bottom')
    const noteInput = noteNode.locator('[data-testid="note-handle-input"]')
    await connectHandles(page, upstreamOutput, noteInput)

    // Connect: note output -> downstream input
    const noteOutput = noteNode.locator('[data-testid="note-handle-output"]')
    const downstreamInput = downstreamNode.locator('.react-flow__handle-top')
    await connectHandles(page, noteOutput, downstreamInput)

    // Verify edges were created (at least 2 user-created edges)
    // Use polling assertion - React Flow renders edges asynchronously
    const edges = page.locator('.react-flow__edge')
    await expect.poll(() => edges.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(2)

    return { noteNode }
  }

  /**
   * Verify the bottom resize control is at the visual bottom of the note
   * (action row bottom when selected, RF wrapper bottom when not).
   */
  async function verifyBottomResizePosition(
    page: Page,
    noteNode: Locator,
    label: string,
  ) {
    const control = noteNode.locator('.react-flow__resize-control.line.bottom')
    await expect(control, `${label}: bottom resize line must exist`).toBeAttached()
    const controlBox = await control.boundingBox()
    expect(controlBox, `${label}: bottom resize line must have bounds`).not.toBeNull()

    const controlCenterY = controlBox!.y + controlBox!.height / 2

    // Determine expected visual bottom
    const actionRow = noteNode.locator('[data-testid="node-status-bar"]')
    const hasActionRow = await actionRow.isVisible().catch(() => false)
    let expectedBottom: number
    if (hasActionRow) {
      const arBox = await actionRow.boundingBox()
      expectedBottom = arBox!.y + arBox!.height
    } else {
      const noteId = await getNoteId(noteNode)
      const wrapperBox = await rfWrapper(page, noteId).boundingBox()
      expectedBottom = wrapperBox!.y + wrapperBox!.height
    }

    expect(
      Math.abs(controlCenterY - expectedBottom),
      `${label}: bottom resize control Y=${controlCenterY.toFixed(0)} should be near visual bottom=${expectedBottom.toFixed(0)}`,
    ).toBeLessThan(HANDLE_TOLERANCE)
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  test('S0: resize cursor at correct visual bottom edge', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const { noteNode } = await setupNoteWithEdges(page)

    // --- Step 1: click note to select ---
    await test.step('select note', async () => {
      await noteNode.click({ position: { x: 50, y: 20 }, force: true })
      await page.waitForTimeout(200)
      const actionRow = noteNode.locator('[data-testid="node-status-bar"]')
      await expect(actionRow, 'Action row must be visible after selection').toBeVisible()
    })

    // --- Step 2: debug DOM structure and verify bottom resize control ---
    await test.step('bottom resize control at action row bottom', async () => {
      await page.screenshot({ path: 'test-results/s0-selected-before-verify.png' })
      await verifyBottomResizePosition(page, noteNode, 'selected')
    })

    // --- Step 3: hover the bottom resize control and verify resize cursor ---
    await test.step('resize cursor on hover at visual bottom edge', async () => {
      // Use the actual resize control element's position (centered on the visual bottom edge)
      const bottomControl = noteNode.locator('.react-flow__resize-control.line.bottom')
      const controlBox = await bottomControl.boundingBox()
      expect(controlBox, 'Bottom resize control must have bounds').not.toBeNull()

      const hoverX = controlBox!.x + controlBox!.width / 2
      const hoverY = controlBox!.y + controlBox!.height / 2
      await page.mouse.move(hoverX, hoverY)
      await page.waitForTimeout(100)

      await page.screenshot({ path: 'test-results/s0-hover-bottom-resize.png' })

      // The resize control at this position should show a ns-resize cursor
      const cursor = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return el ? window.getComputedStyle(el).cursor : null
      }, { x: hoverX, y: hoverY })
      expect(
        cursor,
        `Cursor at visual bottom should be ns-resize, got "${cursor}"`,
      ).toMatch(/ns-resize|row-resize|n-resize|s-resize/)
    })
  })

  test('S1: resize in all directions with handle and edge verification', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const { noteNode } = await setupNoteWithEdges(page)
    const noteId = await getNoteId(noteNode)

    // Select the note (required for resize to be active)
    await noteNode.click({ position: { x: 50, y: 20 }, force: true })
    await page.waitForTimeout(200)

    // Record initial dimensions
    const initialBox = await rfWrapper(page, noteId).boundingBox()
    expect(initialBox, 'Initial RF wrapper bounds').not.toBeNull()

    // --- Initial state verification ---
    await test.step('initial: verify handle positions', async () => {
      await verifyHandlePositions(page, noteNode, 'initial')
    })
    await test.step('initial: verify edge anchoring', async () => {
      await verifyEdgeAnchoring(page, noteNode, 'initial')
    })

    // --- 1.1a: Vertical resize ---
    await test.step('1.1a: resize vertically', async () => {
      await resizeNote(page, noteNode, 'vertical', 60)
      const afterBox = await rfWrapper(page, noteId).boundingBox()
      expect(
        afterBox!.height,
        'Height should increase after vertical resize',
      ).toBeGreaterThan(initialBox!.height + 40)
    })
    await test.step('1.2a: handles correct after vertical resize', async () => {
      await verifyHandlePositions(page, noteNode, 'after-vert')
    })
    await test.step('1.3a: edges anchored after vertical resize', async () => {
      await verifyEdgeAnchoring(page, noteNode, 'after-vert')
    })

    // --- 1.1b: Horizontal resize ---
    const preHorizBox = await rfWrapper(page, noteId).boundingBox()
    await test.step('1.1b: resize horizontally', async () => {
      await resizeNote(page, noteNode, 'horizontal', 80)
      const afterBox = await rfWrapper(page, noteId).boundingBox()
      expect(
        afterBox!.width,
        'Width should increase after horizontal resize',
      ).toBeGreaterThan(preHorizBox!.width + 50)
    })
    await test.step('1.2b: handles correct after horizontal resize', async () => {
      await verifyHandlePositions(page, noteNode, 'after-horiz')
    })
    await test.step('1.3b: edges anchored after horizontal resize', async () => {
      await verifyEdgeAnchoring(page, noteNode, 'after-horiz')
    })

    // --- 1.1c: Diagonal resize ---
    const preDiagBox = await rfWrapper(page, noteId).boundingBox()
    await test.step('1.1c: resize diagonally', async () => {
      await resizeNote(page, noteNode, 'diagonal', 50)
      const afterBox = await rfWrapper(page, noteId).boundingBox()
      expect(
        afterBox!.width,
        'Width should increase after diagonal resize',
      ).toBeGreaterThan(preDiagBox!.width + 30)
      expect(
        afterBox!.height,
        'Height should increase after diagonal resize',
      ).toBeGreaterThan(preDiagBox!.height + 30)
    })
    await test.step('1.2c: handles correct after diagonal resize', async () => {
      await verifyHandlePositions(page, noteNode, 'after-diag')
    })
    await test.step('1.3c: edges anchored after diagonal resize', async () => {
      await verifyEdgeAnchoring(page, noteNode, 'after-diag')
    })
  })

  test('S1b: output handle and edge follow action row on select/edit/deselect', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const { noteNode } = await setupNoteWithEdges(page)

    // --- Deselected state: click empty canvas to deselect ---
    await test.step('deselected: handle at RF wrapper bottom, edges anchored', async () => {
      const canvas = page.locator('[data-testid="workflow-canvas"]')
      await canvas.click({ position: { x: 100, y: 50 }, force: true })
      await page.waitForTimeout(300)
      await verifyHandlePositions(page, noteNode, 'deselected')
      await verifyEdgeAnchoring(page, noteNode, 'deselected')
    })

    // --- Selected state: click note ---
    await test.step('selected: handle at action row bottom, edges anchored', async () => {
      await noteNode.click({ position: { x: 50, y: 20 }, force: true })
      await page.waitForTimeout(300)
      // Action row should be visible
      const actionRow = noteNode.locator('[data-testid="node-status-bar"]')
      await expect(actionRow, 'Action row visible when selected').toBeVisible()
      await verifyHandlePositions(page, noteNode, 'selected')
      await verifyEdgeAnchoring(page, noteNode, 'selected')
    })

    // --- Edit mode: double-click note ---
    await test.step('editing: handle at action row bottom, edges anchored', async () => {
      await noteNode.dblclick({ position: { x: 50, y: 20 }, force: true })
      await page.waitForTimeout(300)
      const actionRow = noteNode.locator('[data-testid="node-status-bar"]')
      await expect(actionRow, 'Action row visible when editing').toBeVisible()
      await verifyHandlePositions(page, noteNode, 'editing')
      await verifyEdgeAnchoring(page, noteNode, 'editing')
    })

    // --- Back to deselected: press Escape then click canvas ---
    await test.step('deselected again: handle snaps back, edges re-anchor', async () => {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      const canvas = page.locator('[data-testid="workflow-canvas"]')
      await canvas.click({ position: { x: 100, y: 50 }, force: true })
      await page.waitForTimeout(300)
      await verifyHandlePositions(page, noteNode, 'deselected-again')
      await verifyEdgeAnchoring(page, noteNode, 'deselected-again')
    })
  })

  test('S2: same validations after adding multiple lines of text', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const { noteNode } = await setupNoteWithEdges(page)
    const noteId = await getNoteId(noteNode)

    // Select the note
    await noteNode.click({ position: { x: 50, y: 20 }, force: true })
    await page.waitForTimeout(200)

    // --- 1.4: Enter edit mode and add multiple lines of text ---
    await test.step('1.4: add multiple lines of text', async () => {
      // Notes have no cog. Double-click
      // on the text body enters inline edit mode.
      await noteNode.locator('[data-testid="note-text-display"]').dblclick()
      await page.waitForTimeout(200)

      const textarea = page.locator('[data-testid="note-text-editor"]')
      await expect(textarea, 'Text editor should be visible').toBeVisible()

      await textarea.fill(
        'Line 1: First line of text\nLine 2: Second line\nLine 3: More content here\nLine 4: Additional text\nLine 5: Even more\nLine 6: Keep going\nLine 7: Almost done\nLine 8: Final line',
      )
      await page.waitForTimeout(100)

      // Accept the edit
      await noteNode.locator('[data-testid="note-edit-accept"]').click()
      await page.waitForTimeout(300)
    })

    // Verify the text was saved
    await test.step('verify text persisted', async () => {
      const display = noteNode.locator('[data-testid="note-text-display"]')
      await expect(display).toContainText('Line 1')
      await expect(display).toContainText('Line 8')
    })

    // Fit view so the expanded note is fully visible, then zoom out to ensure
    // the bottom resize control (47px below RF wrapper) stays within viewport
    await page.getByRole('button', { name: 'Fit View' }).click()
    await page.waitForTimeout(500)
    // Zoom out twice to give extra viewport margin for resize controls
    const zoomOut = page.getByRole('button', { name: 'Zoom out' })
    await zoomOut.click()
    await page.waitForTimeout(200)
    await zoomOut.click()
    await page.waitForTimeout(200)

    // Re-select (accepting edit exits edit mode, node should still be selected)
    await noteNode.click({ position: { x: 50, y: 20 }, force: true })
    await page.waitForTimeout(200)

    // Record dimensions with text
    const withTextBox = await rfWrapper(page, noteId).boundingBox()
    expect(withTextBox, 'RF wrapper with text').not.toBeNull()

    // --- Repeat 1.1-1.3 after text ---
    await test.step('initial with text: verify handles', async () => {
      await verifyHandlePositions(page, noteNode, 'text-initial')
    })
    await test.step('initial with text: verify edges', async () => {
      await verifyEdgeAnchoring(page, noteNode, 'text-initial')
    })

    // Vertical resize
    await test.step('1.1a-text: resize vertically', async () => {
      await resizeNote(page, noteNode, 'vertical', 60)
      const afterBox = await rfWrapper(page, noteId).boundingBox()
      expect(afterBox!.height).toBeGreaterThan(withTextBox!.height + 40)
    })
    await test.step('1.2a-text: handles after vertical resize', async () => {
      await verifyHandlePositions(page, noteNode, 'text-vert')
    })
    await test.step('1.3a-text: edges after vertical resize', async () => {
      await verifyEdgeAnchoring(page, noteNode, 'text-vert')
    })

    // Horizontal resize
    const preHorizBox = await rfWrapper(page, noteId).boundingBox()
    await test.step('1.1b-text: resize horizontally', async () => {
      await resizeNote(page, noteNode, 'horizontal', 80)
      const afterBox = await rfWrapper(page, noteId).boundingBox()
      expect(afterBox!.width).toBeGreaterThan(preHorizBox!.width + 50)
    })
    await test.step('1.2b-text: handles after horizontal resize', async () => {
      await verifyHandlePositions(page, noteNode, 'text-horiz')
    })
    await test.step('1.3b-text: edges after horizontal resize', async () => {
      await verifyEdgeAnchoring(page, noteNode, 'text-horiz')
    })

    // Diagonal resize
    const preDiagBox = await rfWrapper(page, noteId).boundingBox()
    await test.step('1.1c-text: resize diagonally', async () => {
      await resizeNote(page, noteNode, 'diagonal', 50)
      const afterBox = await rfWrapper(page, noteId).boundingBox()
      expect(afterBox!.width).toBeGreaterThan(preDiagBox!.width + 30)
      expect(afterBox!.height).toBeGreaterThan(preDiagBox!.height + 30)
    })
    await test.step('1.2c-text: handles after diagonal resize', async () => {
      await verifyHandlePositions(page, noteNode, 'text-diag')
    })
    await test.step('1.3c-text: edges after diagonal resize', async () => {
      await verifyEdgeAnchoring(page, noteNode, 'text-diag')
    })
  })
})
