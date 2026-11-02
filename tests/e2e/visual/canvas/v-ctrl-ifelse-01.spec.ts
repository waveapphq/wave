/**
 * V-CTRL-IFELSE-01: If/Else Control - Comprehensive Visual Tests
 *
 * Validates the If/Else conditional control's palette presence, canvas rendering,
 * config modal branch editor, branch management (add/remove Else If and Else),
 * label propagation to canvas handles, dynamic width expansion, and metadata display.
 *
 * Scenarios:
 * S1 - Palette search and canvas drop
 * S2 - Config modal opens with branch editor (IF + ELSE default)
 * S3 - Add and remove Else If branches
 * S4 - Delete and re-add Else branch
 * S5 - Branch labels update handle labels on canvas
 * S6 - Node width expands with more branches
 * S7 - Version and metadata display (changelog + details)
 * S8 - Half-built conditions block Save and never reach storage
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'

const BASE = `http://localhost:${BACKEND_PORT}`
const GUARD_NODE_ID = 'ie-guard'

/** One If/Else whose IF branch already carries a complete literal condition, so
 *  S8 starts from a saveable state and only the rows it adds can block Save. */
function buildGuardFixture(): Record<string, unknown> {
  return {
    name: `V-CTRL-IFELSE-01-S8 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'If/Else condition completeness guard.',
    workflow: {
      nodes: [
        {
          id: GUARD_NODE_ID,
          type: 'workflowNode',
          position: { x: 320, y: 200 },
          data: {
            label: 'If/Else',
            elementType: 'if-else',
            nodeType: 'control',
            category: 'conditional',
            version: '1.0.0',
            description: 'If/Else under test',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                branches: [
                  {
                    id: 'branch_0',
                    type: 'if',
                    label: 'first',
                    conditions: [
                      {
                        type: 'literal',
                        variable: 'mode',
                        value_type: 'string',
                        operator: 'equals',
                        reference_value: 'go',
                        reference_is_expression: false,
                        id: 'ie-cond-0',
                      },
                    ],
                  },
                  { id: 'branch_1', type: 'else', label: '' },
                ],
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [{ id: 'e-start', source: 'start-node', target: GUARD_NODE_ID, type: 'default' }],
    },
    variables: { mode: { value: 'go', type: 'string', scope: 'test' } },
    metadata: {},
  }
}

test.describe('V-CTRL-IFELSE-01: If/Else Control', () => {
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

  async function addIfElseNode(page: Page) {
    await setupPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('if')
    await page.waitForTimeout(100)

    const ifElseItem = page.locator('[data-testid="palette-item-if-else"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'if', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
    await page.waitForTimeout(300)
  }

  async function openConfigModal(page: Page) {
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]',
    )
    const node = workflowNodes.first()
    await node.locator('button').first().dispatchEvent('click')
    await expect(node).toHaveAttribute('data-selected', 'true')

    const gearButton = page.locator(
      '[data-testid="node-configure"]',
    )
    await gearButton.click()

    const modal = configSheet(page)
    await expect(modal).toBeVisible()
    return modal
  }

  async function closeModalWithCancel(modal: import('@playwright/test').Locator) {
    const page = modal.page()
    const cancelBtn = modal.locator('button:has-text("Cancel")')
    await cancelBtn.click()

    // The branch editor auto-initializes default branches on mount, so
    // hasChanges is true even if the user didn't edit anything.
    // If the unsaved changes dialog appears, click Discard to close.
    const unsavedClose = page.getByTestId('unsaved-close')
    if (await unsavedClose.isVisible({ timeout: 1000 }).catch(() => false)) {
      await unsavedClose.click()
    }

    await expect(modal).not.toBeVisible()
  }

  async function saveAndCloseModal(modal: import('@playwright/test').Locator) {
    const saveBtn = modal.locator('button:has-text("Save")')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(modal).not.toBeVisible()
  }

  /** Give a branch one COMPLETE condition. A literal row would need a variable
   *  to pick and the draft canvas declares none, so use an expression row. */
  async function addCompleteCondition(page: Page, body: import('@playwright/test').Locator) {
    await body.locator('[data-testid="assert-add-assertion"]').click()
    const expressionOption = body.locator('[data-testid="assert-add-expression"]')
    await expect(expressionOption).toBeVisible()
    await expressionOption.click()

    const editor = body.locator('[data-testid^="assert-expression-input-"] .cm-content').last()
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.type('1 == 1')
    await page.keyboard.press('Escape')
  }

  // ---------------------------------------------------------------------------
  // S1: If/Else appears in palette and can be dropped on canvas
  // ---------------------------------------------------------------------------

  test('S1: palette search and canvas drop', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await test.step('Search for "if" in palette and find If / Else item', async () => {
      await setupPalette(page)
      const searchInput = page.locator('[data-testid="palette-search-input"]')
      await searchInput.fill('if')
      await page.waitForTimeout(100)

      const ifElseItem = page.locator('[data-testid="palette-item-if-else"]')
      await expect(ifElseItem).toBeVisible()
    })

    await test.step('Drag If / Else onto canvas', async () => {
      const ifElseItem = page.locator('[data-testid="palette-item-if-else"]')
      const canvas = page.locator('[data-testid="workflow-canvas"]')
      const canvasBox = await canvas.boundingBox()

      await dragPaletteItemToCanvas(page, 'if', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
      await page.waitForTimeout(300)
    })

    await test.step('Verify node appears with GitFork icon and If / Else label', async () => {
      // Find the workflow node (not the icon sub-element)
      const workflowNodes = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      )
      await expect(workflowNodes.first()).toBeVisible()

      // Verify the icon has the git-fork data-icon attribute
      const icon = workflowNodes.first().locator('[data-testid="workflow-node-icon"]')
      await expect(icon).toHaveAttribute('data-icon', 'git-fork')

      // Verify the label text
      await expect(workflowNodes.first()).toContainText('If / Else')
    })

    await test.step('Verify node has branch output handles (default if/else branches)', async () => {
      // A freshly dropped If/Else node gets default branches (if + else),
      // so it renders branch output handles, not a default single handle.
      const branchHandles = page.locator('[data-testid^="handle-output-"]')
      await expect(branchHandles).toHaveCount(2)
    })
  })

  // ---------------------------------------------------------------------------
  // S2: Config modal opens and shows branch editor
  // ---------------------------------------------------------------------------

  test('S2: config modal shows branch editor with IF and ELSE', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addIfElseNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Verify modal title is "Edit Config"', async () => {
      const title = modal.locator('[class*="DialogTitle"], h2').first()
      await expect(title).toContainText('Edit Config')
    })

    await test.step('Verify condition branch editor is visible', async () => {
      const editor = modal.locator('[data-testid="condition-branch-editor"]')
      await expect(editor).toBeVisible()
    })

    await test.step('Verify IF branch with warning badge', async () => {
      // Find branch cards - there should be 2 (IF + ELSE)
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      await expect(branchCards).toHaveCount(2)

      // First branch should have IF badge with warning variant
      const firstBadge = branchCards.first().locator('[data-testid^="branch-badge-"]')
      await expect(firstBadge).toContainText('IF')
    })

    await test.step('Verify ELSE branch with default badge', async () => {
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      const lastBadge = branchCards.last().locator('[data-testid^="branch-badge-"]')
      await expect(lastBadge).toContainText('ELSE')
    })

    await test.step('Verify "+ Else If" and "+ Else" buttons', async () => {
      const addElseIfBtn = modal.locator('[data-testid="add-else-if-button"]')
      const addElseBtn = modal.locator('[data-testid="add-else-button"]')

      await expect(addElseIfBtn).toBeVisible()
      await expect(addElseBtn).toBeVisible()

      // Else button should be disabled since else already exists
      await expect(addElseBtn).toBeDisabled()
      // Else If button should be enabled
      await expect(addElseIfBtn).toBeEnabled()
    })

    await test.step('Close modal with Cancel', async () => {
      await closeModalWithCancel(modal)
    })
  })

  // ---------------------------------------------------------------------------
  // S3: Add and remove Else If branches
  // ---------------------------------------------------------------------------

  test('S3: add and remove Else If branches', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addIfElseNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Click "+ Else If" to add a branch', async () => {
      const addElseIfBtn = modal.locator('[data-testid="add-else-if-button"]')
      await addElseIfBtn.click()
      await page.waitForTimeout(100)
    })

    await test.step('Verify 3 branches: IF, ELSE IF, ELSE', async () => {
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      await expect(branchCards).toHaveCount(3)

      // Verify badge text in order
      const badges = modal.locator('[data-testid^="branch-badge-"]')
      await expect(badges.nth(0)).toContainText('IF')
      await expect(badges.nth(1)).toContainText('ELSE IF')
      await expect(badges.nth(2)).toContainText('ELSE')
    })

    await test.step('Verify ELSE IF has delete button and reorder arrows', async () => {
      // The ELSE IF branch card (second card)
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      const elseIfCard = branchCards.nth(1)

      // Delete button should be present
      const deleteBtn = elseIfCard.locator('[data-testid^="branch-delete-"]')
      await expect(deleteBtn).toBeVisible()

      // Reorder arrows (up/down) should be present for else_if type
      const moveUpBtn = elseIfCard.locator('[data-testid^="branch-move-up-"]')
      const moveDownBtn = elseIfCard.locator('[data-testid^="branch-move-down-"]')
      await expect(moveUpBtn).toBeVisible()
      await expect(moveDownBtn).toBeVisible()
    })

    await test.step('Delete the ELSE IF branch', async () => {
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      const elseIfCard = branchCards.nth(1)
      const deleteBtn = elseIfCard.locator('[data-testid^="branch-delete-"]')
      await deleteBtn.click()
      await page.waitForTimeout(100)
    })

    await test.step('Verify back to 2 branches: IF, ELSE', async () => {
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      await expect(branchCards).toHaveCount(2)

      const badges = modal.locator('[data-testid^="branch-badge-"]')
      await expect(badges.nth(0)).toContainText('IF')
      await expect(badges.nth(1)).toContainText('ELSE')
    })

    await test.step('Close modal', async () => {
      await closeModalWithCancel(modal)
    })
  })

  // ---------------------------------------------------------------------------
  // S4: Delete and re-add Else branch
  // ---------------------------------------------------------------------------

  test('S4: delete and re-add Else branch', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addIfElseNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Delete the ELSE branch', async () => {
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      // ELSE is the last card
      const elseCard = branchCards.last()
      const deleteBtn = elseCard.locator('[data-testid^="branch-delete-"]')
      await deleteBtn.click()
      await page.waitForTimeout(100)
    })

    await test.step('Verify only IF branch remains', async () => {
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      await expect(branchCards).toHaveCount(1)

      const badge = modal.locator('[data-testid^="branch-badge-"]')
      await expect(badge).toContainText('IF')
    })

    await test.step('Verify "+ Else" button is now enabled', async () => {
      const addElseBtn = modal.locator('[data-testid="add-else-button"]')
      await expect(addElseBtn).toBeEnabled()
    })

    await test.step('Click "+ Else" to re-add the Else branch', async () => {
      const addElseBtn = modal.locator('[data-testid="add-else-button"]')
      await addElseBtn.click()
      await page.waitForTimeout(100)
    })

    await test.step('Verify IF + ELSE branches visible', async () => {
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      await expect(branchCards).toHaveCount(2)

      const badges = modal.locator('[data-testid^="branch-badge-"]')
      await expect(badges.nth(0)).toContainText('IF')
      await expect(badges.nth(1)).toContainText('ELSE')
    })

    await test.step('Verify "+ Else" button is disabled again', async () => {
      const addElseBtn = modal.locator('[data-testid="add-else-button"]')
      await expect(addElseBtn).toBeDisabled()
    })

    await test.step('Close modal', async () => {
      await closeModalWithCancel(modal)
    })
  })

  // ---------------------------------------------------------------------------
  // S5: Branch labels update handle labels on canvas
  // ---------------------------------------------------------------------------

  test('S5: branch labels propagate to canvas handle names', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addIfElseNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Set IF branch label to "TCP Path"', async () => {
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      const ifCard = branchCards.first()
      const labelInput = ifCard.locator('[data-testid^="branch-label-"]')
      await labelInput.click()
      await labelInput.fill('TCP Path')
    })

    await test.step('Set ELSE branch label to "UDP Path"', async () => {
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      const elseCard = branchCards.last()
      const labelInput = elseCard.locator('[data-testid^="branch-label-"]')
      await labelInput.click()
      await labelInput.fill('UDP Path')
    })

    await test.step('Add a complete condition to the IF branch so the form is valid', async () => {
      // Branch bodies are expanded by default.
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      const ifCard = branchCards.first()
      const ifBody = ifCard.locator('[data-testid^="branch-body-"]')
      await expect(ifBody).toBeVisible()
      await addCompleteCondition(page, ifBody)
    })

    await test.step('Save the config', async () => {
      await saveAndCloseModal(modal)
    })

    await test.step('Verify canvas handles have updated accessible names', async () => {
      // The handles use title={handleLabel} where handleLabel = branch.label || default
      const outputHandles = page.locator('[data-testid^="handle-output-branch_"]')
      await expect(outputHandles).toHaveCount(2)

      // Check that the handles have the custom labels as accessible names
      const handle1 = outputHandles.first()
      const handle2 = outputHandles.last()
      await expect(handle1).toHaveAttribute('aria-label', 'TCP Path')
      await expect(handle2).toHaveAttribute('aria-label', 'UDP Path')
    })
  })

  // ---------------------------------------------------------------------------
  // S6: Node width expands with more branches
  // ---------------------------------------------------------------------------

  test('S6: node width expands with more branches', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addIfElseNode(page)

    let initialWidth: number

    await test.step('Record initial node width (no branches saved yet)', async () => {
      const node = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      ).first()
      const box = await node.boundingBox()
      expect(box, 'Node must be visible').not.toBeNull()
      initialWidth = box!.width
    })

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Add 3 ELSE IF branches (total 5 branches)', async () => {
      const addElseIfBtn = modal.locator('[data-testid="add-else-if-button"]')
      await addElseIfBtn.click()
      await page.waitForTimeout(100)
      await addElseIfBtn.click()
      await page.waitForTimeout(100)
      await addElseIfBtn.click()
      await page.waitForTimeout(100)

      // Verify 5 branches total: IF + 3 ELSE IF + ELSE
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      await expect(branchCards).toHaveCount(5)
    })

    await test.step('Add complete conditions to IF and ELSE IF branches for a valid form', async () => {
      const branchCards = modal.locator('[data-testid^="branch-card-"]')
      const count = await branchCards.count()

      for (let i = 0; i < count; i++) {
        const card = branchCards.nth(i)
        const badge = card.locator('[data-testid^="branch-badge-"]')
        const badgeText = await badge.textContent()

        // Skip ELSE - it does not need assertions
        if (badgeText?.trim() === 'ELSE') continue

        const body = card.locator('[data-testid^="branch-body-"]')
        await expect(body).toBeVisible()
        await addCompleteCondition(page, body)
      }
    })

    await test.step('Save config', async () => {
      await saveAndCloseModal(modal)
    })

    await test.step('Verify node is wider than initial and has 5 output handles', async () => {
      const node = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      ).first()
      const box = await node.boundingBox()
      expect(box, 'Node must be visible after save').not.toBeNull()

      // Node should be wider with 5 branches than with 2
      expect(
        box!.width,
        `Node width (${box!.width.toFixed(0)}px) should exceed initial (${initialWidth.toFixed(0)}px)`,
      ).toBeGreaterThan(initialWidth)

      // Verify 5 output handles visible
      const outputHandles = page.locator('[data-testid^="handle-output-branch_"]')
      await expect(outputHandles).toHaveCount(5)
    })
  })

  // ---------------------------------------------------------------------------
  // S7: Version and metadata display
  // ---------------------------------------------------------------------------

  test('S7: version and metadata display', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addIfElseNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Verify version shows "1.0.0"', async () => {
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await expect(versionSelector).toBeVisible()
      await expect(versionSelector).toContainText('1.0.0')
    })

    await test.step('Click Changelog button and verify content', async () => {
      const changelogBtn = modal.locator('button:has-text("Changelog")')
      await expect(changelogBtn).toBeVisible()
      await changelogBtn.click()

      // Changelog sub-dialog appears via portal. Use the title text to find it
      // uniquely (the main config dialog also contains "Changelog" button text).
      // Auto-naming labels the dropped node `If / Else_N` so the dialog
      // title is `If / Else_1 - Changelog`. Match the suffix.
      const changelogDialog = page.locator('[role="dialog"]').filter({ hasText: /If \/ Else.* - Changelog/ })
      await expect(changelogDialog).toBeVisible()

      // Verify some changelog entries from the If/Else 1.0.0 metadata
      await expect(changelogDialog).toContainText('N-branch conditional')

      // Close the changelog dialog via Escape (closes innermost dialog)
      await page.keyboard.press('Escape')
      await expect(changelogDialog).not.toBeVisible()
    })

    await test.step('Click Details button and verify content', async () => {
      const detailsBtn = modal.locator('button:has-text("Details")')
      await expect(detailsBtn).toBeVisible()
      await detailsBtn.click()

      // Details sub-dialog appears via portal. Title is "{name} - Documentation".
      const detailsDialog = page.locator('[role="dialog"]').filter({ hasText: /If \/ Else.* - Documentation/ })
      await expect(detailsDialog).toBeVisible()

      // Verify some details content from the If/Else 1.0.0 metadata
      await expect(detailsDialog).toContainText('If/Else Control')

      // Close the details dialog via Escape (closes innermost dialog)
      await page.keyboard.press('Escape')
      await expect(detailsDialog).not.toBeVisible()
    })

    await test.step('Close config modal', async () => {
      await closeModalWithCancel(modal)
    })
  })

  // ---------------------------------------------------------------------------
  // S8: half-built conditions must not save
  // ---------------------------------------------------------------------------

  test('S8: half-built conditions block Save and never reach storage', async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
    const resp = await page.request.post(`${BASE}/tests`, { data: buildGuardFixture() })
    const body = await resp.json().catch(() => null)
    expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
    const testId = body.data?.id ?? body.id

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator(`[data-testid="workflow-node-${GUARD_NODE_ID}"]`)
    await node.locator('button').first().dispatchEvent('click')
    await openSelectedBlockSheet(page)
    const modal = configSheet(page)
    await expect(modal).toBeVisible({ timeout: 10_000 })

    const ifBody = modal.locator('[data-testid="branch-body-branch_0"]')
    const saveBtn = modal.getByRole('button', { name: /^Save$/ })
    await expect(ifBody).toBeVisible()

    await test.step('A literal row with no variable outlines red and refuses Save', async () => {
      await ifBody.locator('[data-testid="assert-add-assertion"]').click()
      await ifBody.locator('[data-testid="assert-add-literal"]').click()
      await expect(ifBody.locator('[data-testid="assert-variable-2"]')).toHaveAttribute(
        'aria-invalid',
        'true',
      )
      await expect(saveBtn).toBeDisabled()
      // A collapsed card would hide the row, so the header says so too.
      await expect(modal.locator('[data-testid="branch-alert-branch_0"]')).toBeVisible()
    })

    await test.step('Picking the variable unlocks Save and clears the header marker', async () => {
      const anchor = ifBody.locator('[data-testid="assert-variable-2"]')
      await anchor.click()
      // An option's accessible name carries its type pill too, so match the row
      // by the name span that holds the exact variable name.
      const option = page
        .getByRole('option')
        .filter({ has: page.getByText('mode', { exact: true }) })
        .first()
      await expect(option).toBeVisible({ timeout: 5_000 })
      await option.click()
      await expect(anchor).toHaveValue('mode')
      await expect(modal.locator('[data-testid="branch-alert-branch_0"]')).toHaveCount(0)
      await expect(saveBtn).toBeEnabled()
    })

    await test.step('An empty expression row refuses Save until it carries text', async () => {
      await ifBody.locator('[data-testid="assert-add-assertion"]').click()
      await ifBody.locator('[data-testid="assert-add-expression"]').click()
      const exprRow = ifBody.locator('[data-testid="assert-expression-input-4"]')
      await expect(exprRow.locator('[class*="border-destructive"]').first()).toBeVisible()
      await expect(saveBtn).toBeDisabled()

      await exprRow.locator('.cm-content').first().click()
      await page.keyboard.type('1 == 1')
      await page.keyboard.press('Escape')
      await expect(saveBtn).toBeEnabled()
    })

    await test.step('Only complete conditions reach the saved test', async () => {
      await saveBtn.click()
      await expect(modal).toBeHidden({ timeout: 10_000 })

      const toolbarSave = page.locator('[data-testid="toolbar-save-button"]')
      await expect(toolbarSave).toBeEnabled({ timeout: 10_000 })
      await toolbarSave.click()
      await expect(toolbarSave).toBeDisabled({ timeout: 15_000 })

      const wfResp = await page.request.get(`${BASE}/tests/${testId}/workflow`)
      expect(wfResp.ok(), `GET workflow failed: ${wfResp.status()}`).toBeTruthy()
      const wfBody = (await wfResp.json()) as Record<string, unknown>
      const wfData = (wfBody.data ?? wfBody) as { nodes?: Array<Record<string, unknown>> }
      const saved = (wfData.nodes ?? []).find((n) => n.id === GUARD_NODE_ID)
      const values = (((saved?.data ?? {}) as Record<string, unknown>).config as
        | Record<string, unknown>
        | undefined)?.values as Record<string, unknown> | undefined
      const branches = (values?.branches as Array<Record<string, unknown>>) ?? []
      const conditions = (branches[0]?.conditions ?? []) as Array<Record<string, unknown>>
      const rows = conditions.filter((c) => c.type !== 'operator')
      expect(rows.length, `persisted rows: ${JSON.stringify(rows)}`).toBe(3)
      for (const row of rows) {
        const filled =
          row.type === 'literal'
            ? String(row.variable ?? '').trim().length > 0
            : String(row.expression ?? '').trim().length > 0
        expect(filled, `a half-built condition reached storage: ${JSON.stringify(row)}`).toBeTruthy()
      }
    })
  })
})
