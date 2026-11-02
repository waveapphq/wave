/**
 * V-PLUGIN-DEF-02: Plugin Icons from Centralized Registry
 *
 * Design Decisions: CANVAS-105 through CANVAS-110, SFTP-10
 * REQ: REQ-3.4.4.2
 *
 * Pass Criteria:
 * 1. Plugin icons render from centralized icon registry (icon-registry.ts)
 * 2. Each plugin displays correct icon matching its iconName in plugin-definitions.ts
 * 3. Icon colors match category color classes:
 *    - Network = blue (text-blue-500)
 *    - Remote = cyan (text-cyan-500)
 *    - Database = purple (text-purple-500)
 *    - System = red (text-red-500)
 *    - Kubernetes = sky (text-sky-500)
 *    - Data = emerald (text-emerald-500)
 * 4. Icons are SVG elements rendered by Lucide
 * 5. All 40 plugin icons render correctly without fallback
 * 6. Icon sizes are consistent (h-10 w-10 in flyout, h-5 w-5 in expanded list)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { expandPalette, waitForCanvasLoad } from '../../helpers/canvas'

test.describe('V-PLUGIN-DEF-02: Plugin Icons from Centralized Registry', () => {
  // No backend data needed - icons are hardcoded (REQ-3.4.4.2)
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

  test('V-PLUGIN-DEF-02-S1: all 40 plugin icons render as SVG elements', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // All plugin IDs
    const pluginIds = [
      'http-client', 'ping', 'netcat',
      'ssh-session-open', 'ssh-session-exec', 'ssh-session-script', 'ssh-session-close', 'ssh-tunnel-open', 'ssh-tunnel-close', 'sftp', 'remote-execution',
      'sql-client', 'opensearch',
      'shell-script', 'shell-exec', 'python', 'file-io', 'log',
      'k8s-connect', 'k8s-get', 'k8s-events', 'k8s-logs', 'k8s-top',
      'k8s-apply', 'k8s-delete', 'k8s-scale', 'k8s-rollout',
      'k8s-exec', 'k8s-script', 'k8s-copy',
      'helm-install', 'helm-upgrade', 'helm-rollback', 'helm-uninstall', 'helm-test', 'helm-status',
      'csv-parser', 'excel-parser', 'xml-parser', 'json-parser',
    ]

    // Each plugin item should have an SVG icon
    for (const id of pluginIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      const svg = item.locator('svg').first()
      await expect(svg).toBeVisible()
      // SVG should be rendered by Lucide (has lucide class or is an SVG element)
      const tagName = await svg.evaluate((el) => el.tagName.toLowerCase())
      expect(tagName).toBe('svg')
    }
  })

  test('V-PLUGIN-DEF-02-S2: network plugin icons have blue color class', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Network plugins: HTTP (Globe), Ping (Radio), Netcat (Cable)
    const networkPlugins = [
      { id: 'http-client', name: 'HTTP' },
      { id: 'ping', name: 'Ping' },
      { id: 'netcat', name: 'Netcat' },
    ]

    for (const { id } of networkPlugins) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      const svg = item.locator('svg').first()
      await expect(svg).toHaveClass(/text-blue-500/)
    }
  })

  test('V-PLUGIN-DEF-02-S2b: remote plugin icons have cyan color class', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Remote plugins: 8 distinct glyphs (LogIn / Terminal / FileTerminal /
    // LogOut / Cable / Unplug / FolderSync / ServerCog)
    const remotePlugins = [
      { id: 'ssh-session-open', name: 'SSH Session Open' },
      { id: 'ssh-session-exec', name: 'SSH Session Exec' },
      { id: 'ssh-session-script', name: 'SSH Session Script' },
      { id: 'ssh-session-close', name: 'SSH Session Close' },
      { id: 'ssh-tunnel-open', name: 'SSH Tunnel Open' },
      { id: 'ssh-tunnel-close', name: 'SSH Tunnel Close' },
      { id: 'sftp', name: 'SFTP' },
      { id: 'remote-execution', name: 'Remote Execution' },
    ]

    for (const { id } of remotePlugins) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      const svg = item.locator('svg').first()
      await expect(svg).toHaveClass(/text-cyan-500/)
    }
  })

  test('V-PLUGIN-DEF-02-S3: database plugin icons have purple color class', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Database plugins: SQL (Database), OpenSearch (SearchCode)
    const databasePlugins = [
      { id: 'sql-client', name: 'SQL' },
      { id: 'opensearch', name: 'OpenSearch' },
    ]

    for (const { id } of databasePlugins) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      const svg = item.locator('svg').first()
      await expect(svg).toHaveClass(/text-purple-500/)
    }
  })

  test('V-PLUGIN-DEF-02-S4: system plugin icons have red color class', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // System plugins: Shell Script (FileTerminal), Shell Exec (Terminal), Python (FileCode2), File I/O (FileInput), Log (ScrollText)
    const systemPlugins = [
      { id: 'shell-script', name: 'Shell Script' },
      { id: 'shell-exec', name: 'Shell Exec' },
      { id: 'python', name: 'Python' },
      { id: 'file-io', name: 'File I/O' },
      { id: 'log', name: 'Log' },
    ]

    for (const { id } of systemPlugins) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      const svg = item.locator('svg').first()
      await expect(svg).toHaveClass(/text-red-500/)
    }
  })

  test('V-PLUGIN-DEF-02-S5: kubernetes plugin icons have sky color class', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Kubernetes plugins: K8s Connect (Cable), K8s Get (PackageSearch),
    // K8s Events (History), K8s Logs (Logs), K8s Top (Gauge), K8s Apply (CloudUpload),
    // K8s Delete (Trash2), K8s Scale (Scaling), K8s Rollout (RefreshCw),
    // K8s Exec (Terminal), K8s Script (FileTerminal), K8s Copy (ArrowRightLeft)
    const kubernetesPlugins = [
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

    for (const { id } of kubernetesPlugins) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      const svg = item.locator('svg').first()
      await expect(svg).toHaveClass(/text-sky-500/)
    }
  })

  test('V-PLUGIN-DEF-02-S6: data plugin icons have emerald color class', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Data plugins: CSV (FileSpreadsheet), Excel (FileText), XML (FileType), JSON (FileJson)
    const dataPlugins = [
      { id: 'csv-parser', name: 'CSV' },
      { id: 'excel-parser', name: 'Excel' },
      { id: 'xml-parser', name: 'XML' },
      { id: 'json-parser', name: 'JSON' },
    ]

    for (const { id } of dataPlugins) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      const svg = item.locator('svg').first()
      await expect(svg).toHaveClass(/text-emerald-500/)
    }
  })

  test('V-PLUGIN-DEF-02-S7: flyout icon sizes are consistent (h-10 w-10)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Test a sample of icons for correct size classes in flyout view
    const samplePlugins = ['http-client', 'sql-client', 'shell-script', 'k8s-connect', 'csv-parser']

    for (const id of samplePlugins) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      const svg = item.locator('svg').first()
      // Icons in flyout should have h-10 w-10 classes
      await expect(svg).toHaveClass(/h-10/)
      await expect(svg).toHaveClass(/w-10/)
    }
  })

  test('V-PLUGIN-DEF-02-S8: expanded palette icons have smaller size (h-5 w-5)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // Expand network subcategory to see items
    const networkSubcategory = page.locator('[data-testid="palette-subcat-network"]')
    await networkSubcategory.locator('[data-testid="subcategory-header"]').click()

    // Test icon sizes in expanded list view
    const httpItem = networkSubcategory.locator('[data-testid="palette-item-http-client"]')
    await expect(httpItem).toBeVisible()
    const svg = httpItem.locator('svg').first()
    // Icons in expanded list should have h-5 w-5 classes
    await expect(svg).toHaveClass(/h-5/)
    await expect(svg).toHaveClass(/w-5/)
  })

  test('V-PLUGIN-DEF-02-S9: icons maintain correct colors in expanded palette', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // Expand multiple subcategories and verify icon colors

    // Network - blue
    const networkSubcategory = page.locator('[data-testid="palette-subcat-network"]')
    await networkSubcategory.locator('[data-testid="subcategory-header"]').click()
    const httpSvg = networkSubcategory.locator('[data-testid="palette-item-http-client"] svg').first()
    await expect(httpSvg).toHaveClass(/text-blue-500/)

    // Remote - cyan
    const remoteSubcategory = page.locator('[data-testid="palette-subcat-remote"]')
    await remoteSubcategory.locator('[data-testid="subcategory-header"]').click()
    const sshScriptSvg = remoteSubcategory.locator('[data-testid="palette-item-ssh-session-script"] svg').first()
    await expect(sshScriptSvg).toHaveClass(/text-cyan-500/)

    // Database - purple
    const databaseSubcategory = page.locator('[data-testid="palette-subcat-database"]')
    await databaseSubcategory.locator('[data-testid="subcategory-header"]').click()
    const sqlSvg = databaseSubcategory.locator('[data-testid="palette-item-sql-client"] svg').first()
    await expect(sqlSvg).toHaveClass(/text-purple-500/)

    // System - red
    const systemSubcategory = page.locator('[data-testid="palette-subcat-system"]')
    await systemSubcategory.locator('[data-testid="subcategory-header"]').click()
    const shellScriptSvg = systemSubcategory.locator('[data-testid="palette-item-shell-script"] svg').first()
    await expect(shellScriptSvg).toHaveClass(/text-red-500/)

    // Kubernetes - sky
    const kubernetesSubcategory = page.locator('[data-testid="palette-subcat-kubernetes"]')
    await kubernetesSubcategory.locator('[data-testid="subcategory-header"]').click()
    const k8sSvg = kubernetesSubcategory.locator('[data-testid="palette-item-k8s-connect"] svg').first()
    await expect(k8sSvg).toHaveClass(/text-sky-500/)

    // Data - emerald
    const dataSubcategory = page.locator('[data-testid="palette-subcat-data"]')
    await dataSubcategory.locator('[data-testid="subcategory-header"]').click()
    const csvSvg = dataSubcategory.locator('[data-testid="palette-item-csv-parser"] svg').first()
    await expect(csvSvg).toHaveClass(/text-emerald-500/)
  })

  test('V-PLUGIN-DEF-02-S10: every plugin renders its registered glyph', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openPluginsFlyout(page)

    // Glyph per plugin id, from plugin-definitions.ts. Cable, RefreshCw, Terminal and
    // FileTerminal are shared between blocks, so every check is scoped to one palette item.
    const pluginIconMap = [
      { id: 'http-client', iconClass: 'lucide-globe' },
      { id: 'sftp', iconClass: 'lucide-folder-sync' },
      { id: 'ping', iconClass: 'lucide-radio' },
      { id: 'netcat', iconClass: 'lucide-cable' },
      { id: 'ssh-session-open', iconClass: 'lucide-log-in' },
      { id: 'ssh-session-exec', iconClass: 'lucide-terminal' },
      { id: 'ssh-session-script', iconClass: 'lucide-file-terminal' },
      { id: 'ssh-session-close', iconClass: 'lucide-log-out' },
      { id: 'ssh-tunnel-open', iconClass: 'lucide-cable' },
      { id: 'ssh-tunnel-close', iconClass: 'lucide-unplug' },
      { id: 'remote-execution', iconClass: 'lucide-server-cog' },
      { id: 'sql-client', iconClass: 'lucide-database' },
      { id: 'opensearch', iconClass: 'lucide-search-code' },
      { id: 'shell-script', iconClass: 'lucide-file-terminal' },
      { id: 'shell-exec', iconClass: 'lucide-terminal' },
      // Lucide serves FileCode2 as file-code-corner and FileJson as file-braces.
      { id: 'python', iconClass: 'lucide-file-code-corner' },
      { id: 'file-io', iconClass: 'lucide-file-input' },
      { id: 'log', iconClass: 'lucide-scroll-text' },
      { id: 'k8s-connect', iconClass: 'lucide-cable' },
      { id: 'k8s-get', iconClass: 'lucide-package-search' },
      { id: 'k8s-events', iconClass: 'lucide-history' },
      { id: 'k8s-logs', iconClass: 'lucide-logs' },
      { id: 'k8s-top', iconClass: 'lucide-gauge' },
      { id: 'k8s-apply', iconClass: 'lucide-cloud-upload' },
      { id: 'k8s-delete', iconClass: 'lucide-trash-2' },
      { id: 'k8s-scale', iconClass: 'lucide-scaling' },
      { id: 'k8s-rollout', iconClass: 'lucide-refresh-cw' },
      { id: 'k8s-exec', iconClass: 'lucide-terminal' },
      { id: 'k8s-script', iconClass: 'lucide-file-terminal' },
      { id: 'k8s-copy', iconClass: 'lucide-arrow-right-left' },
      { id: 'helm-install', iconClass: 'lucide-package-plus' },
      { id: 'helm-upgrade', iconClass: 'lucide-circle-arrow-up' },
      { id: 'helm-rollback', iconClass: 'lucide-undo-2' },
      { id: 'helm-uninstall', iconClass: 'lucide-package-minus' },
      { id: 'helm-test', iconClass: 'lucide-flask-conical' },
      { id: 'helm-status', iconClass: 'lucide-activity' },
      { id: 'csv-parser', iconClass: 'lucide-file-spreadsheet' },
      { id: 'excel-parser', iconClass: 'lucide-sheet' },
      { id: 'xml-parser', iconClass: 'lucide-file-type' },
      { id: 'json-parser', iconClass: 'lucide-file-braces' },
    ]

    // The map covers every plugin the flyout renders.
    await expect(flyout.locator('[data-testid^="flyout-item-"]')).toHaveCount(pluginIconMap.length)

    for (const { id, iconClass } of pluginIconMap) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      await expect(item.locator(`svg.${iconClass}`)).toHaveCount(1)
    }

    // Nothing falls back to the unknown-icon glyph.
    await expect(flyout.locator('svg.lucide-circle-question-mark')).toHaveCount(0)
  })
})
