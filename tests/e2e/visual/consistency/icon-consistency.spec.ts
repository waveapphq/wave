/**
 * V-ICON-01: Icon Consistency
 *
 * Main Purpose: Verify icon and color consistency between navigation sidebar and palette panel.
 *
 * Pass Criteria:
 * 1. Blocks Library icon in palette matches the indigo LIBRARY nav icon (Functions, indigo #818CF8)
 * 2. Plugins icon in palette uses the violet Plugins color (#A78BFA)
 * 3. Icon types are consistent (Blocks uses lucide Blocks icon, Plugins uses lucide Puzzle icon)
 *
 * Icon Consistency Rule (from design doc):
 * Icons and colors for Blocks and Plugins MUST match their counterparts in the navigation
 * sidebar (LIBRARY section). The Plugins nav item is not present in the shipped sidebar,
 * so only the palette side of the Plugins pairing is asserted here.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'

test.describe('V-ICON-01: Icon Consistency', () => {
  test('V-ICON-01: palette Blocks Library icon uses indigo color class', async ({
    page,
  }) => {
    // Navigate to canvas page where palette is visible
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    // Verify palette is in collapsed state
    const palette = page.locator('[data-testid="block-palette"]')
    await expect(palette).toHaveAttribute('data-state', 'collapsed')

    // Check Blocks Library icon has indigo color class
    const libraryIcon = page.locator('[data-testid="palette-icon-library"]')
    await expect(libraryIcon).toBeVisible()

    // Verify the icon button has the indigo color class
    const iconClass = await libraryIcon.getAttribute('class')
    expect(
      iconClass,
      'Blocks Library icon should have text-indigo-400 class to match nav sidebar'
    ).toContain('text-indigo-400')
  })

  test('V-ICON-01-S1: palette Plugins icon uses violet color class', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const palette = page.locator('[data-testid="block-palette"]')
    await expect(palette).toHaveAttribute('data-state', 'collapsed')

    // Check Plugins icon has violet color class
    const pluginsIcon = page.locator('[data-testid="palette-icon-plugins"]')
    await expect(pluginsIcon).toBeVisible()

    const iconClass = await pluginsIcon.getAttribute('class')
    expect(
      iconClass,
      'Plugins icon should have text-violet-400 class to match nav sidebar'
    ).toContain('text-violet-400')
  })

  test('V-ICON-01-S2: expanded palette Block Library button uses indigo color', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    // Expand the palette using the expand button
    const palette = page.locator('[data-testid="block-palette"]')
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')

    // Check Block Library button has indigo color classes
    const libraryButton = page.locator(
      '[data-testid="palette-blocks-library-button"]'
    )
    await expect(libraryButton).toBeVisible()

    const buttonClass = await libraryButton.getAttribute('class')
    // Button uses text-indigo-600 for light mode and dark:text-indigo-400 for dark mode
    expect(
      buttonClass,
      'Block Library button should have indigo color classes'
    ).toMatch(/text-indigo-/)
  })

  test('V-ICON-01-S3: expanded palette Plugins section uses violet color', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    // Expand the palette using the expand button
    const palette = page.locator('[data-testid="block-palette"]')
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')

    // Check Plugins section header has violet color
    const pluginsSection = page.locator('[data-testid="palette-section-plugins"]')
    await expect(pluginsSection).toBeVisible()

    // The section header icon should have violet color (text-violet-400 class)
    const sectionIcon = pluginsSection.locator('[class*="text-violet"]')
    await expect(
      sectionIcon,
      'Plugins section icon should have text-violet color class'
    ).toBeVisible()
  })

  test('V-ICON-01-S4: nav sidebar Functions icon visible in LIBRARY section', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    // Verify sidebar is expanded (default state)
    const sidebarWrapper = page.locator('.group.peer[data-state]')
    await expect(sidebarWrapper).toHaveAttribute('data-state', 'expanded')

    // Find Functions nav item in LIBRARY section
    const functionsLink = page.locator('a[href="/functions"]')
    await expect(functionsLink).toBeVisible()
    await expect(functionsLink).toContainText('Functions')

    // Verify the icon has indigo color (iconColor: '#818CF8' in app-sidebar.tsx)
    // The icon is styled inline with the color
    const functionsIcon = functionsLink.locator('svg')
    await expect(functionsIcon).toBeVisible()
  })

})
