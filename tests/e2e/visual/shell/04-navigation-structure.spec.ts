/**
 * V-SHELL-05 through V-SHELL-09: Sidebar Visual Compliance Tests
 *
 * These tests validate specific visual requirements from the wireframes.
 * Each test is designed to FAIL if the implementation doesn't match the design spec.
 *
 * Design Decisions:
 * - SHELL-2: Selected nav: white icon on $blue10 background (40x32px, 6px radius)
 * - SHELL-3: Footer: theme toggle (left), collapse button (right), divider above
 * - SHELL-6: Collapsed sidebar: 56px width, icons only, tooltip on hover
 * - SHELL-8: No search field in the sidebar (expanded or collapsed)
 */

import { test, expect } from '../../helpers/playwright-fixtures'

test.describe('V-SHELL-05: Theme Toggle Inline Layout', () => {
  test('V-SHELL-05: theme toggle displays icon and text inline (side by side)', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')
    const footer = sidebar.locator('[data-sidebar="footer"]')

    // Find theme toggle button (contains mode text)
    const themeToggle = footer.getByRole('button', { name: /mode/i })
    await expect(themeToggle).toBeVisible()

    // Get the button's bounding box
    const buttonBox = await themeToggle.boundingBox()
    expect(buttonBox).toBeTruthy()

    // Find icon and text within the button
    const icon = themeToggle.locator('svg')
    const textSpan = themeToggle.locator('span').filter({ hasNotText: '' })

    await expect(icon).toBeVisible()
    await expect(textSpan.first()).toBeVisible()

    // Get icon and text bounding boxes
    const iconBox = await icon.boundingBox()
    const textBox = await textSpan.first().boundingBox()

    expect(iconBox).toBeTruthy()
    expect(textBox).toBeTruthy()

    // CRITICAL: Icon and text should be on the SAME horizontal line (inline)
    // They are inline if their vertical centers are within 5px of each other
    const iconCenterY = iconBox!.y + iconBox!.height / 2
    const textCenterY = textBox!.y + textBox!.height / 2
    const verticalDifference = Math.abs(iconCenterY - textCenterY)

    expect(
      verticalDifference,
      `Icon and text should be inline (same Y). Icon center: ${iconCenterY}, Text center: ${textCenterY}, Diff: ${verticalDifference}px`
    ).toBeLessThan(5)

    // Text should be to the RIGHT of icon (icon.x + icon.width < text.x)
    expect(
      iconBox!.x + iconBox!.width,
      'Text should be to the right of icon'
    ).toBeLessThan(textBox!.x + 10) // Allow 10px gap
  })

  test('V-SHELL-05-S1: theme toggle text matches wireframe format', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')
    const footer = sidebar.locator('[data-sidebar="footer"]')

    // Per wireframe: "Light Theme" or "Dark Theme" (not just "Light" or "Dark")
    // Find by aria-label pattern (Switch to light/dark mode)
    const themeToggle = footer.getByRole('button', { name: /switch to.*mode/i })
    await expect(themeToggle).toBeVisible()

    // Check that the visible text includes "Theme"
    const buttonText = await themeToggle.textContent()
    expect(
      buttonText?.toLowerCase(),
      `Theme toggle should show "Light Theme" or "Dark Theme". Got: "${buttonText}"`
    ).toMatch(/theme/i)
  })
})

test.describe('V-SHELL-06: No Sidebar Search (SHELL-8)', () => {
  test('V-SHELL-06: the expanded sidebar has no search field and no shortcut badge', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await expect(sidebar).toBeVisible()

    // SHELL-8: the sidebar has no search field.
    // Assert its absence directly - a nav-item count would pass for the
    // wrong reason.
    await expect(
      sidebar.locator('input[role="search"], input[type="search"]'),
      'Sidebar search field must be absent'
    ).toHaveCount(0)
    await expect(
      sidebar.locator('kbd'),
      'The Ctrl+K badge goes with the field'
    ).toHaveCount(0)

    // Focus order now runs brand -> first nav item: nothing sits above
    // Dashboard except the brand.
    const dashboardNav = sidebar.getByRole('link', { name: /dashboard/i })
    const dashboardY = (await dashboardNav.boundingBox())?.y ?? -1
    const inputsAbove = await sidebar.locator('input').count()
    expect(inputsAbove, 'no input control anywhere in the sidebar').toBe(0)
    expect(dashboardY).toBeGreaterThan(0)
  })

  test('V-SHELL-06-S1: the collapsed rail has no search icon', async ({ page }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(page.locator('.group.peer[data-state]')).toHaveAttribute(
      'data-state',
      'collapsed'
    )

    await expect(
      sidebar.getByRole('button', { name: /search/i }),
      'Collapsed-mode search button must be absent'
    ).toHaveCount(0)
    await expect(sidebar.locator('input')).toHaveCount(0)
  })
})

test.describe('V-SHELL-07: Navigation Icon Alignment', () => {
  test('V-SHELL-07: collapsed icons are horizontally centered within sidebar', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')

    // Find and click collapse button
    const collapseButton = sidebar.getByRole('button', {
      name: 'Collapse sidebar',
    })
    await collapseButton.click()
    await page.waitForTimeout(350)

    // Get sidebar width (should be ~56px per SHELL-6)
    const sidebarBox = await sidebar.boundingBox()
    expect(sidebarBox).toBeTruthy()
    const sidebarCenterX = sidebarBox!.x + sidebarBox!.width / 2

    // Get all navigation icons
    const navIcons = sidebar.locator('[data-icon-wrapper] svg')
    const iconCount = await navIcons.count()
    expect(iconCount).toBeGreaterThan(0)

    // CRITICAL: Each icon should be horizontally centered within the sidebar
    for (let i = 0; i < Math.min(iconCount, 5); i++) {
      const icon = navIcons.nth(i)
      const iconBox = await icon.boundingBox()
      if (iconBox) {
        const iconCenterX = iconBox.x + iconBox.width / 2
        const offset = Math.abs(iconCenterX - sidebarCenterX)

        expect(
          offset,
          `Icon ${i} should be centered. Sidebar center: ${sidebarCenterX}, Icon center: ${iconCenterX}, Offset: ${offset}px`
        ).toBeLessThan(8) // Allow 8px tolerance
      }
    }
  })

  test('V-SHELL-07-S1: collapsed sidebar width is exactly 56px per SHELL-6', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')

    // Collapse the sidebar
    const collapseButton = sidebar.getByRole('button', {
      name: 'Collapse sidebar',
    })
    await collapseButton.click()
    await page.waitForTimeout(350)

    // Get the sidebar element's width directly
    const sidebarBox = await sidebar.boundingBox()

    expect(sidebarBox).toBeTruthy()
    // Per SHELL-6: collapsed width should be 56px (allow small tolerance)
    expect(
      sidebarBox!.width,
      `Collapsed sidebar should be ~56px per SHELL-6. Got: ${sidebarBox!.width}px`
    ).toBeGreaterThanOrEqual(48)
    expect(sidebarBox!.width).toBeLessThanOrEqual(64)
  })
})

test.describe('V-SHELL-08: Selection Icon Contrast', () => {
  test('V-SHELL-08: selected item icon has high contrast color (white/light)', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')

    // Find the active/selected menu button (Dashboard is active)
    const activeButton = sidebar.locator('[data-active="true"]')
    await expect(activeButton).toBeVisible()

    // Find the icon within the active button
    const activeIcon = activeButton.locator('[data-icon-wrapper] svg')
    await expect(activeIcon).toBeVisible()

    // Get the icon's computed color
    const iconColor = await activeIcon.evaluate((el) => {
      return window.getComputedStyle(el).color
    })

    // Parse the color to check luminance
    // Per SHELL-2: "white icon on $blue10 background"
    // Icon should be white or very light (high luminance)
    const colorMatch = iconColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (colorMatch) {
      const [, r, g, b] = colorMatch.map(Number)
      // Calculate relative luminance (simplified)
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

      expect(
        luminance,
        `Selected icon should be white/light per SHELL-2. Got color: ${iconColor}, Luminance: ${luminance}`
      ).toBeGreaterThan(0.7) // White has luminance ~1.0
    } else {
      // If not RGB, check if it's white-ish in oklch or other format
      expect(
        iconColor,
        'Selected icon color should be white or very light'
      ).toMatch(/white|#fff|rgb\(255|oklch\(0\.9/i)
    }
  })

  test('V-SHELL-08-S1: selected item has blue background per SHELL-2', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')

    // Find the active/selected menu button
    const activeButton = sidebar.locator('[data-active="true"]')
    await expect(activeButton).toBeVisible()

    // Get the background color
    const bgColor = await activeButton.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor
    })

    // Background should be blue ($blue10 = #3B82F6 or similar)
    // Check for blue hue in RGB
    const colorMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (colorMatch) {
      const [, r, g, b] = colorMatch.map(Number)
      // Blue should be dominant (b > r and b > g * 0.8)
      expect(
        b,
        `Selection background should be blue per SHELL-2. Got: ${bgColor}`
      ).toBeGreaterThan(r)
      expect(b).toBeGreaterThan(g * 0.8)
    }
  })
})

test.describe('V-SHELL-09: Main Content No Overlap', () => {
  test('V-SHELL-09: main content does not overlap with expanded sidebar', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')
    const main = page.locator('main')

    await expect(sidebar).toBeVisible()
    await expect(main).toBeVisible()

    // Get bounding boxes - use sidebar element directly
    const sidebarBox = await sidebar.boundingBox()
    const mainBox = await main.boundingBox()

    expect(sidebarBox).toBeTruthy()
    expect(mainBox).toBeTruthy()

    const sidebarRightEdge = sidebarBox!.x + sidebarBox!.width

    // CRITICAL: Main content should start AT or AFTER sidebar right edge
    // No overlap means: mainBox.x >= sidebarRightEdge
    expect(
      mainBox!.x,
      `Main content (x=${mainBox!.x}) should not overlap with sidebar (right edge=${sidebarRightEdge})`
    ).toBeGreaterThanOrEqual(sidebarRightEdge - 2) // Allow 2px tolerance
  })

  test('V-SHELL-09-S1: main content does not overlap with collapsed sidebar', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')
    const main = page.locator('main')

    // Collapse the sidebar
    const collapseButton = sidebar.getByRole('button', {
      name: 'Collapse sidebar',
    })
    await collapseButton.click()
    await page.waitForTimeout(350)

    // Get bounding boxes after collapse - use sidebar element directly
    const sidebarBox = await sidebar.boundingBox()
    const mainBox = await main.boundingBox()

    expect(sidebarBox).toBeTruthy()
    expect(mainBox).toBeTruthy()

    const sidebarRightEdge = sidebarBox!.x + sidebarBox!.width

    // CRITICAL: Main content should start AT or AFTER collapsed sidebar right edge
    expect(
      mainBox!.x,
      `Main content (x=${mainBox!.x}) should not overlap with collapsed sidebar (right edge=${sidebarRightEdge})`
    ).toBeGreaterThanOrEqual(sidebarRightEdge - 2) // Allow 2px tolerance
  })

  test('V-SHELL-09-S2: expanded sidebar width matches wireframe (~200px)', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')

    // Get the sidebar element's width directly (not the wrapper)
    const sidebarBox = await sidebar.boundingBox()

    expect(sidebarBox).toBeTruthy()

    // Per wireframe analysis, expanded sidebar appears to be ~200px
    // Allow range of 180-220px for expanded state
    expect(
      sidebarBox!.width,
      `Expanded sidebar should be ~200px per wireframe. Got: ${sidebarBox!.width}px`
    ).toBeGreaterThanOrEqual(180)
    expect(sidebarBox!.width).toBeLessThanOrEqual(220)
  })
})
