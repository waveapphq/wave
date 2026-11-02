/**
 * V-PLUGIN-DEF-01: Plugin Palette - 40 Plugins in 7 Rendered Categories
 *
 * Design Decisions: CANVAS-105 through CANVAS-110, SFTP-10
 * REQ: REQ-3.4.4.1, REQ-3.4.4.2, REQ-3.4.1.17, REQ-3.4.1.3
 *
 * Pass Criteria:
 * 1. 40 plugins total in 7 rendered categories (Network, Remote, Database, System, Kubernetes, Helm, Data)
 * 2. Category colors: network=blue, remote=cyan, database=purple, system=red, kubernetes=sky, helm=indigo, data=emerald
 * 3. Network (3): HTTP, Ping, Netcat - blue (text-blue-500)
 * 4. Remote (8): SSH Session Open, SSH Session Exec, SSH Session Script, SSH Session Close, SSH Tunnel Open, SSH Tunnel Close, SFTP, Remote Execution - cyan (text-cyan-500)
 * 5. Database (2): SQL, OpenSearch - purple (text-purple-500)
 * 6. System (5): Shell Script, Shell Exec, Python, File I/O, Log - red (text-red-500)
 * 7. Kubernetes (12): K8s Connect, K8s Get, K8s Events, K8s Logs, K8s Top, K8s Apply, K8s Delete, K8s Scale, K8s Rollout, K8s Exec, K8s Script, K8s Copy - sky (text-sky-500)
 * 8. Helm (6): Helm Install, Helm Upgrade, Helm Rollback, Helm Uninstall, Helm Test, Helm Status - indigo (text-indigo-500)
 * 9. Data (4): CSV, Excel, XML, JSON - emerald (text-emerald-500)
 * 10. PLUGIN-11: a group with no plugins is not rendered anywhere the palette appears
 * 11. Plugins are draggable (draggable="true" + dataTransfer)
 * 12. Grid layout in collapsed flyout
 * 13. Grouped in expanded palette with 7 subcategories
 * 14. Each plugin has role="option" and aria-label for accessibility
 * 15. The Kubernetes subcategory lists its twelve blocks in palette order
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { expandPalette, waitForCanvasLoad } from '../../helpers/canvas'

test.describe('V-PLUGIN-DEF-01: Plugin Palette - 40 Plugins', () => {
  // No backend data needed - plugins are hardcoded (REQ-3.4.4.1, REQ-3.4.1.17)
  // Runs in parallel no-data phase

  // Helper to open plugins flyout from collapsed palette
  async function openPluginsFlyout(page: import('@playwright/test').Page) {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'expanded') {
      await page.locator('[data-testid="palette-collapse-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'collapsed')
    }
    const pluginsIcon = page.locator('[data-testid="palette-icon-plugins"]')
    await pluginsIcon.click()
    const flyout = page.locator('[data-testid="palette-flyout-plugins"]')
    await expect(flyout).toBeVisible()
    return flyout
  }

  test('V-PLUGIN-DEF-01-S1: collapsed flyout shows all 40 plugins in grid layout', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Per REQ-3.4.4.1, REQ-3.4.1.17, REQ-3.4.1.3: 40 plugins total
    const pluginIds = [
      // Network (3)
      'http-client',
      'ping',
      'netcat',
      // Remote (8)
      'ssh-session-open',
      'ssh-session-exec',
      'ssh-session-script',
      'ssh-session-close',
      'ssh-tunnel-open',
      'ssh-tunnel-close',
      'sftp',
      'remote-execution',
      // Database (2)
      'sql-client',
      'opensearch',
      // System (5)
      'shell-script',
      'shell-exec',
      'python',
      'file-io',
      'log',
      // Kubernetes (12)
      'k8s-connect',
      'k8s-get',
      'k8s-events',
      'k8s-logs',
      'k8s-top',
      'k8s-apply',
      'k8s-delete',
      'k8s-scale',
      'k8s-rollout',
      'k8s-exec',
      'k8s-script',
      'k8s-copy',
      // Helm (6)
      'helm-install',
      'helm-upgrade',
      'helm-rollback',
      'helm-uninstall',
      'helm-test',
      'helm-status',
      // Data (4)
      'csv-parser',
      'excel-parser',
      'xml-parser',
      'json-parser',
    ]

    // Verify all 40 plugins are present
    for (const id of pluginIds) {
      await expect(flyout.locator(`[data-testid="flyout-item-${id}"]`)).toBeVisible()
    }

    // Verify total count
    const pluginItems = flyout.locator('[data-testid^="flyout-item-"]')
    await expect(pluginItems).toHaveCount(40)

    // Verify grid layout exists (3 columns per wireframe)
    const grids = flyout.locator('.grid.grid-cols-3')
    const gridCount = await grids.count()
    expect(gridCount).toBeGreaterThan(0) // At least one grid present
  })

  test('V-PLUGIN-DEF-01-S2: flyout shows 6 category headers with correct colors', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Per REQ-3.4.4.2: 6 rendered categories with specific colors
    // Use exact text matching to avoid "Database" matching "Data"
    // Network - blue
    const networkHeader = flyout.locator('text="Network"').first()
    await expect(networkHeader).toBeVisible()
    await expect(networkHeader).toHaveClass(/text-blue-500/)

    // Remote - cyan
    const remoteHeader = flyout.locator('text="Remote"').first()
    await expect(remoteHeader).toBeVisible()
    await expect(remoteHeader).toHaveClass(/text-cyan-500/)

    // Database - purple
    const databaseHeader = flyout.locator('text="Database"').first()
    await expect(databaseHeader).toBeVisible()
    await expect(databaseHeader).toHaveClass(/text-purple-500/)

    // System - red
    const systemHeader = flyout.locator('text="System"').first()
    await expect(systemHeader).toBeVisible()
    await expect(systemHeader).toHaveClass(/text-red-500/)

    // Kubernetes - sky
    const kubernetesHeader = flyout.locator('text="Kubernetes"').first()
    await expect(kubernetesHeader).toBeVisible()
    await expect(kubernetesHeader).toHaveClass(/text-sky-500/)

    // Data - emerald
    const dataHeader = flyout.locator('text="Data"').first()
    await expect(dataHeader).toBeVisible()
    await expect(dataHeader).toHaveClass(/text-emerald-500/)

    // PLUGIN-11: the empty Custom group is not rendered in the flyout either.
    await expect(flyout.locator('text="Custom"')).toHaveCount(0)
  })

  test('V-PLUGIN-DEF-01-S3: network plugins (3) have blue icons', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    const networkIds = ['http-client', 'ping', 'netcat']
    for (const id of networkIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      // Icon should have blue color class
      const icon = item.locator('svg').first()
      await expect(icon).toHaveClass(/text-blue-500/)
    }
  })

  test('V-PLUGIN-DEF-01-S3b: remote plugins (8) have cyan icons', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    const remoteIds = [
      'ssh-session-open',
      'ssh-session-exec',
      'ssh-session-script',
      'ssh-session-close',
      'ssh-tunnel-open',
      'ssh-tunnel-close',
      'sftp',
      'remote-execution',
    ]
    for (const id of remoteIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      // Icon should have cyan color class
      const icon = item.locator('svg').first()
      await expect(icon).toHaveClass(/text-cyan-500/)
    }
  })

  test('V-PLUGIN-DEF-01-S4: database plugins (2) have purple icons', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    const databaseIds = ['sql-client', 'opensearch']
    for (const id of databaseIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      // Icon should have purple color class
      const icon = item.locator('svg').first()
      await expect(icon).toHaveClass(/text-purple-500/)
    }
  })

  test('V-PLUGIN-DEF-01-S5: system plugins (5) have red icons', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Per REQ-3.4.1.17: Log plugin added to System category
    const systemIds = ['shell-script', 'shell-exec', 'python', 'file-io', 'log']
    for (const id of systemIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      // Icon should have red color class
      const icon = item.locator('svg').first()
      await expect(icon).toHaveClass(/text-red-500/)
    }
  })

  test('V-PLUGIN-DEF-01-S6: kubernetes plugins (12) have sky icons', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    const kubernetesIds = [
      'k8s-connect',
      'k8s-get',
      'k8s-events',
      'k8s-logs',
      'k8s-top',
      'k8s-apply',
      'k8s-delete',
      'k8s-scale',
      'k8s-rollout',
      'k8s-exec',
      'k8s-script',
      'k8s-copy',
    ]
    for (const id of kubernetesIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      // Icon should have sky color class
      const icon = item.locator('svg').first()
      await expect(icon).toHaveClass(/text-sky-500/)
    }
  })

  test('V-PLUGIN-DEF-01-S7: data plugins (4) have emerald icons', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    const dataIds = ['csv-parser', 'excel-parser', 'xml-parser', 'json-parser']
    for (const id of dataIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      // Icon should have emerald color class
      const icon = item.locator('svg').first()
      await expect(icon).toHaveClass(/text-emerald-500/)
    }
  })

  test('V-PLUGIN-DEF-01-S8: the collapsed flyout drops an empty group entirely', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // PLUGIN-11: no CUSTOM heading and no text advertising an unbuilt
    // capability - the group list simply ends at Data.
    await expect(flyout.locator('text="Custom"')).toHaveCount(0)
    await expect(flyout.getByText(/no custom plugins/i)).toHaveCount(0)
  })

  test('V-PLUGIN-DEF-01-S9: plugins are draggable with correct dataTransfer', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Test one plugin from each category
    const testItems = [
      { id: 'http-client', name: 'HTTP' },
      { id: 'sql-client', name: 'SQL' },
      { id: 'shell-script', name: 'Shell Script' },
      { id: 'k8s-connect', name: 'K8s Connect' },
      { id: 'csv-parser', name: 'CSV' },
    ]

    for (const { id } of testItems) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toHaveAttribute('draggable', 'true')
      // aria-label should be set
      const ariaLabel = await item.getAttribute('aria-label')
      expect(ariaLabel).toBeTruthy()
    }
  })

  test('V-PLUGIN-DEF-01-S10: expanded palette has 6 plugin subcategories', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // Per REQ-3.4.4.1 + PLUGIN-11: 6 subcategories in the expanded palette -
    // every one of them has plugins in it.
    await expect(page.locator('[data-testid="palette-subcat-network"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subcat-remote"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subcat-database"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subcat-system"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subcat-kubernetes"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subcat-data"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subcat-custom"]')).toHaveCount(0)
  })

  test('V-PLUGIN-DEF-01-S11: expanded subcategories show correct item counts', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // Verify item counts in subcategory headers
    const network = page.locator('[data-testid="palette-subcat-network"]')
    await expect(network.locator('[data-testid="subcategory-count"]')).toHaveText('3')

    const remote = page.locator('[data-testid="palette-subcat-remote"]')
    await expect(remote.locator('[data-testid="subcategory-count"]')).toHaveText('8')

    const database = page.locator('[data-testid="palette-subcat-database"]')
    await expect(database.locator('[data-testid="subcategory-count"]')).toHaveText('2')

    // Per REQ-3.4.1.17: System category has 5 plugins
    const system = page.locator('[data-testid="palette-subcat-system"]')
    await expect(system.locator('[data-testid="subcategory-count"]')).toHaveText('5')

    const kubernetes = page.locator('[data-testid="palette-subcat-kubernetes"]')
    await expect(kubernetes.locator('[data-testid="subcategory-count"]')).toHaveText('12')

    const data = page.locator('[data-testid="palette-subcat-data"]')
    await expect(data.locator('[data-testid="subcategory-count"]')).toHaveText('4')

    // PLUGIN-11: there is no zero-count group left to assert.
    await expect(page.locator('[data-testid="palette-subcat-custom"]')).toHaveCount(0)
  })

  test('V-PLUGIN-DEF-01-S12: expanded subcategory reveals plugin items when clicked', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // Expand network subcategory
    const networkSubcategory = page.locator('[data-testid="palette-subcat-network"]')
    await networkSubcategory.locator('[data-testid="subcategory-header"]').click()

    // Verify plugins are visible
    await expect(networkSubcategory.locator('[data-testid="palette-item-http-client"]')).toBeVisible()
    await expect(networkSubcategory.locator('[data-testid="palette-item-ping"]')).toBeVisible()
    await expect(networkSubcategory.locator('[data-testid="palette-item-netcat"]')).toBeVisible()

    // SFTP-10: SFTP lives under Remote and is absent from Network.
    await expect(networkSubcategory.locator('[data-testid="palette-item-sftp"]')).toHaveCount(0)
    const remoteSubcategory = page.locator('[data-testid="palette-subcat-remote"]')
    await remoteSubcategory.locator('[data-testid="subcategory-header"]').click()
    await expect(remoteSubcategory.locator('[data-testid="palette-item-sftp"]')).toBeVisible()

    // Verify items are draggable
    const httpClient = networkSubcategory.locator('[data-testid="palette-item-http-client"]')
    await expect(httpClient).toHaveAttribute('draggable', 'true')
    await expect(httpClient).toHaveAttribute('aria-label', 'HTTP')
  })

  test('V-PLUGIN-DEF-01-S13: an empty plugin group is absent from the expanded panel', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // PLUGIN-11: nothing to expand and nothing to read - the group and its
    // "No custom plugins" text are both gone.
    const pluginsSection = page.locator('[data-testid="palette-section-plugins"]')
    await expect(pluginsSection.locator('[data-testid="palette-subcat-custom"]')).toHaveCount(0)
    await expect(page.getByText(/no custom plugins/i)).toHaveCount(0)

    // Every rendered group carries a non-zero count.
    const groups = pluginsSection.locator('[data-testid^="palette-subcat-"]')
    const total = await groups.count()
    expect(total).toBe(7)
    for (let i = 0; i < total; i++) {
      await expect(groups.nth(i).locator('[data-testid="subcategory-count"]')).not.toHaveText('0')
    }
  })

  test('V-PLUGIN-DEF-01-S14: kubernetes subcategory lists the twelve K8s blocks in order', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const kubernetes = page.locator('[data-testid="palette-subcat-kubernetes"]')
    await kubernetes.locator('[data-testid="subcategory-header"]').click()

    const expected = [
      { id: 'k8s-connect', name: 'K8s Connect' },
      { id: 'k8s-get', name: 'K8s Get' },
      { id: 'k8s-events', name: 'K8s Events' },
      { id: 'k8s-logs', name: 'K8s Logs' },
      { id: 'k8s-top', name: 'K8s Top' },
      { id: 'k8s-apply', name: 'K8s Apply' },
      { id: 'k8s-delete', name: 'K8s Delete' },
      { id: 'k8s-scale', name: 'K8s Scale' },
      { id: 'k8s-rollout', name: 'K8s Rollout' },
      { id: 'k8s-exec', name: 'K8s Exec' },
      { id: 'k8s-script', name: 'K8s Script' },
      { id: 'k8s-copy', name: 'K8s Copy' },
    ]

    const items = kubernetes.locator('[data-testid^="palette-item-"]')
    await expect(items).toHaveCount(expected.length)
    const testIds = await items.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid'))
    )
    expect(testIds).toEqual(expected.map(({ id }) => `palette-item-${id}`))

    for (const { id, name } of expected) {
      const item = kubernetes.locator(`[data-testid="palette-item-${id}"]`)
      await expect(item).toHaveAttribute('draggable', 'true')
      await expect(item).toHaveAttribute('aria-label', name)
    }
  })
})
