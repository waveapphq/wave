/**
 * V-CANVAS-01g: Palette Expanded State
 *
 * Design Decisions: CANVAS-97 through CANVAS-110, SFTP-10
 * REQ: REQ-3.1.1.1 (Drag-and-drop interface), REQ-4.2.1 (No-code test creation), REQ-4.2.3 (Intuitive drag-drop interface)
 *
 * Pass Criteria:
 * 1. Palette expanded width is 260px with search input
 * 2. Search filters content and shows "No results" for non-matches
 * 3. Sections (Recent, Most Used, Controls, Plugins) are collapsible
 * 4. Controls section contains control subgroups
 * 5. Plugins section shows subcategories with correct item counts
 * 6. Action buttons visible: "New Block" and "Block Library"
 * 7. Collapse button returns palette to 64px
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { expandPalette, waitForCanvasLoad } from '../../helpers/canvas'

test.describe('V-CANVAS-01g: Palette Expanded State', () => {
  // No backend data needed - tests UI components with hardcoded data
  // Runs in parallel no-data phase

  test('V-CANVAS-01g: expanded palette structure', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const palette = page.locator('[data-testid="block-palette"]')
    const paletteBox = await palette.boundingBox()
    expect(paletteBox?.width, 'Expanded width should be 260px').toBe(260)

    // Search input present
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await expect(searchInput).toBeVisible()

    // Key sections exist
    await expect(page.locator('[data-testid="palette-section-controls"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-section-plugins"]')).toBeVisible()
  })

  test('V-CANVAS-01g-S1: search filters and shows no results', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')

    // Search filters to matching items
    await searchInput.fill('HTTP')
    await expect(
      page.locator('[data-testid="palette-item-http-client"]')
    ).toBeVisible()

    // Non-existent search shows no results
    await searchInput.fill('xyznonexistent')
    await expect(page.locator('[data-testid="palette-no-results"]')).toBeVisible()

    // Clear button works
    await page.locator('[data-testid="palette-search-clear"]').click()
    await expect(searchInput).toHaveValue('')
  })

  test('V-CANVAS-01g-S2: sections are collapsible', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // Test CONTROLS section collapse/expand (tests the collapsible mechanism once)
    const controlsSection = page.locator('[data-testid="palette-section-controls"]')
    const sectionHeader = controlsSection.locator('[data-testid="section-header"]')

    await expect(controlsSection).toHaveAttribute('data-expanded', 'true')
    await sectionHeader.click()
    await expect(controlsSection).toHaveAttribute('data-expanded', 'false')

    // Re-expand
    await sectionHeader.click()
    await expect(controlsSection).toHaveAttribute('data-expanded', 'true')
  })

  test('V-CANVAS-01g-S3: CONTROLS section has control subgroups', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const controlsSection = page.locator('[data-testid="palette-section-controls"]')

    // Verify subgroups exist
    await expect(page.locator('[data-testid="palette-subgroup-conditionals"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subgroup-loops"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subgroup-flow"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subgroup-timing"]')).toBeVisible()

    // Expand conditionals subgroup to see items
    const conditionalsSubgroup = page.locator('[data-testid="palette-subgroup-conditionals"]')
    await conditionalsSubgroup.locator('[data-testid="subgroup-header"]').click()

    // Verify key control items appear when expanded
    await expect(conditionalsSubgroup.locator('[data-testid="palette-item-if-else"]')).toBeVisible()
    await expect(conditionalsSubgroup.locator('[data-testid="palette-item-assert"]')).toBeVisible()
  })

  test('V-CANVAS-01g-S4: PLUGINS section has subcategories with counts', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const pluginsSection = page.locator('[data-testid="palette-section-plugins"]')

    // Verify subcategories exist
    const expectedSubcategories = [
      { testId: 'palette-subcat-network', count: '3' },
      { testId: 'palette-subcat-remote', count: '8' },
      { testId: 'palette-subcat-database', count: '2' },
      { testId: 'palette-subcat-system', count: '5' },
      { testId: 'palette-subcat-kubernetes', count: '12' },
      { testId: 'palette-subcat-data', count: '4' },
    ]

    for (const { testId, count } of expectedSubcategories) {
      const subcategory = pluginsSection.locator(`[data-testid="${testId}"]`)
      await expect(subcategory).toBeVisible()
      await expect(subcategory.locator('[data-testid="subcategory-count"]')).toHaveText(count)
    }

    // PLUGIN-11: a group with no plugins advertises nothing - it is not
    // rendered at all, so the list ends at DATA.
    await expect(
      pluginsSection.locator('[data-testid="palette-subcat-custom"]'),
      'the empty Custom group is not rendered'
    ).toHaveCount(0)
  })

  test('V-CANVAS-01g-S5: plugin subcategory expands to show items', async ({ page }) => {
    // Test ONE subcategory expansion - if Network works, the mechanism works
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const networkSubcategory = page.locator('[data-testid="palette-subcat-network"]')
    await networkSubcategory.locator('[data-testid="subcategory-header"]').click()

    // Network plugins visible
    await expect(networkSubcategory.locator('[data-testid="palette-item-http-client"]')).toBeVisible()
    // Items are draggable
    const httpClient = networkSubcategory.locator('[data-testid="palette-item-http-client"]')
    await expect(httpClient).toHaveAttribute('draggable', 'true')
  })

  test('V-CANVAS-01g-S6: an empty plugin group is absent, not an empty state', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // PLUGIN-11: neither the CUSTOM header nor the text that advertised an
    // unbuilt capability is anywhere in the panel.
    const pluginsSection = page.locator('[data-testid="palette-section-plugins"]')
    await expect(pluginsSection.locator('[data-testid="palette-subcat-custom"]')).toHaveCount(0)
    await expect(pluginsSection.getByText(/custom/i)).toHaveCount(0)
    await expect(page.getByText(/no custom plugins/i)).toHaveCount(0)

    // Every group that IS rendered has at least one draggable plugin in it.
    const headers = pluginsSection.locator('[data-testid^="palette-subcat-"]')
    const count = await headers.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await expect(
        headers.nth(i).locator('[data-testid="subcategory-count"]')
      ).not.toHaveText('0')
    }
  })

  test('V-CANVAS-01g-S7: action buttons visible', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // New Function drag handle. The label is the words alone: the
    // leading "+" character is gone, and the plus is carried by the icon.
    const newFunctionButton = page.locator('[data-testid="palette-new-block-button"]')
    await expect(newFunctionButton).toBeVisible()
    await expect(newFunctionButton).toHaveText('New Function')
    await expect(newFunctionButton.locator('svg')).toHaveCount(1)

    // "Function Lib" button.
    const libraryButton = page.locator('[data-testid="palette-blocks-library-button"]')
    await expect(libraryButton).toBeVisible()
    await expect(libraryButton).toContainText(/Function Lib/)
  })

  test('V-CANVAS-01g-S8: collapse button returns to 64px', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const palette = page.locator('[data-testid="block-palette"]')
    await expect(palette).toHaveAttribute('data-state', 'expanded')

    await page.locator('[data-testid="palette-collapse-button"]').click()

    await expect(palette).toHaveAttribute('data-state', 'collapsed')
    const paletteBox = await palette.boundingBox()
    expect(paletteBox?.width, 'Collapsed width should be 64px').toBe(64)
  })
})
